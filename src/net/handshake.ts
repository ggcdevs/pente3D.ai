/**
 * The PURE, action-agnostic ask/accept handshake state machine (build plan N.1;
 * issues #12 rematch, #18 undo/redo). This is the SHARED primitive both #12 and #18
 * reuse: neither knows the other exists — they only supply an OPAQUE `action` tag and
 * specialize the {@link canPropose} predicate.
 *
 * ## The model
 *
 * A handshake holds **at most one pending proposal at a time**, entirely OUT-OF-BAND:
 * a proposal is a value carried in session memory, NEVER appended to the append-only
 * move-log (design doc guardrail: "a rejected proposal must leave no trace"). Every
 * transition is IMMUTABLE — each returns a NEW {@link HandshakeState}, never mutating
 * its input — so the state is a plain serialisable value the session can hold and diff.
 *
 * A pending proposal has a **direction**:
 *
 *   - `outgoing` — WE proposed (via {@link propose}); we await the peer's response.
 *   - `incoming` — the PEER proposed (via {@link receiveProposal}); we choose to
 *     {@link respond} accept/decline.
 *
 * Every proposal carries a **unique id** (minted by an injected id source, default
 * {@link randomId}). The id is the dedup key: {@link receiveProposal} of an id we have
 * already seen is an **idempotent no-op** (design guardrail: proposals are published
 * NON-RETAINED and unique-id-deduped so a reconnect / retained re-delivery never
 * replays a stale proposal). A response is correlated back to its proposal by that id.
 *
 * ## Resolution & no double-resolve
 *
 * A pending proposal RESOLVES exactly once — to `accepted` or `declined` — and the
 * resolution is recorded on the state ({@link resolution}). Resolving clears the
 * pending slot. A second response for the SAME id is ignored (design guardrail +
 * agent-principles: no double-resolve). The consumer reads {@link resolution} to fire
 * its effect (reset the board on an accepted rematch, roll back on an accepted undo)
 * and then {@link clearResolution}s once handled.
 *
 * ## Superseding & auto-cancel (at most one pending)
 *
 * Because only ONE proposal may be pending, a NEW proposal **supersedes** whatever was
 * pending — the documented rule (tested): the latest ask wins, the older pending slot
 * is discarded (it never resolved, so nothing was applied — safe by construction since
 * proposals are out-of-band). Auto-cancel signals also clear a pending proposal:
 *
 *   - {@link cancel} — the local player withdraws (or the consumer aborts).
 *   - {@link onGameAdvanced} — the game state moved on (a move landed), so a pending
 *     rematch/undo is stale and is dropped (design guardrail: "auto-cancel a pending
 *     proposal when the game advances").
 *   - {@link onPeerGone} — the proposer/peer dropped, so the handshake can't complete;
 *     drop the pending proposal (design guardrail: "or the proposer/peer drops").
 *
 * ## Purity & layering
 *
 * Every function here is pure (except the injected id source, which defaults to the
 * `crypto`-reading {@link randomId} and is injectable for deterministic tests). No
 * transport, DOM, three, or clock. The SyncEngine/session wiring that publishes a
 * {@link ProposalMessage} / {@link ResponseMessage} over the transport and feeds the
 * inbound ones back in is the GLUE (N.1 consumers), separately Playwright-verified.
 */

import type { Player } from '../core/gameState';
import { randomId } from '../util/randomId';
import type { ProposalMessage, ResponseMessage } from './sync';

/** Which side raised the pending proposal, from THIS client's point of view. */
export type ProposalDirection = 'outgoing' | 'incoming';

/**
 * A single pending proposal, held out-of-band. Immutable; the `action` is an OPAQUE
 * consumer tag this module never interprets. `proposedBy` is the seat (by color) that
 * raised it — carried through to the wire {@link ProposalMessage} and back so both
 * sides agree on who asked.
 */
export interface PendingProposal {
  /** Unique id — the dedup key and the response-correlation key. */
  readonly id: string;
  /** Opaque action tag the consumer fills (`'rematch' | 'undo' | 'redo' | …`). */
  readonly action: string;
  /** The seat (by color) that raised the proposal. */
  readonly proposedBy: Player;
  /** `outgoing` = we asked; `incoming` = the peer asked. */
  readonly direction: ProposalDirection;
}

/** How a pending proposal ended once it resolved. */
export type ResolutionOutcome = 'accepted' | 'declined';

/**
 * The recorded resolution of the most-recently-resolved proposal: which proposal (by
 * id + action + direction) and its outcome. The consumer reads this to fire its effect
 * exactly once, then calls {@link clearResolution}.
 */
export interface Resolution {
  /** The {@link PendingProposal.id} that resolved. */
  readonly id: string;
  /** The opaque action that resolved (so the consumer routes it). */
  readonly action: string;
  /** The direction the resolved proposal had (who had asked). */
  readonly direction: ProposalDirection;
  /** `accepted` or `declined`. */
  readonly outcome: ResolutionOutcome;
}

/**
 * The whole handshake value: the (at most one) pending proposal and the last
 * resolution, if any. A plain serialisable value — the session holds it, every
 * transition returns a fresh one.
 */
export interface HandshakeState {
  /** The single in-flight proposal, or `null` when idle. */
  readonly pending: PendingProposal | null;
  /** The last proposal's resolution (until the consumer clears it), else `null`. */
  readonly resolution: Resolution | null;
}

/** An injectable unique-id source (default {@link randomId}); lets tests be deterministic. */
export type IdSource = () => string;

/** A fresh, idle handshake — no pending proposal, no resolution. */
export function initialHandshake(): HandshakeState {
  return { pending: null, resolution: null };
}

/**
 * Raise an OUTGOING proposal for the opaque `action`, seated as `proposedBy`, minting a
 * unique id from `idSource` (default {@link randomId}). Returns a new state whose
 * `pending` is the outgoing proposal AND the {@link ProposalMessage} to publish
 * NON-RETAINED to the peer — the id ties the two together so the peer's response
 * correlates back.
 *
 * A new proposal SUPERSEDES any currently-pending one (the at-most-one rule): the older
 * pending slot is discarded. It never resolved, so nothing was applied (proposals are
 * out-of-band), making supersede safe. Any prior `resolution` is also cleared — a new
 * ask starts a clean handshake.
 */
export function propose(
  // The prior state is intentionally unused: a new proposal SUPERSEDES whatever was
  // pending and starts a clean handshake, so the result does not depend on it. It is
  // kept in the signature for the uniform `(state, …)` transition shape (and the
  // supersede is exercised by proposing over a state that already has a pending). The
  // `^_` prefix satisfies `noUnusedParameters` / eslint's argsIgnorePattern.
  _state: HandshakeState,
  action: string,
  proposedBy: Player,
  idSource: IdSource = randomId,
): { readonly state: HandshakeState; readonly message: ProposalMessage } {
  const id = idSource();
  const pending: PendingProposal = { id, action, proposedBy, direction: 'outgoing' };
  const message: ProposalMessage = { kind: 'proposal', id, action, proposedBy };
  return { state: { pending, resolution: null }, message };
}

/**
 * Receive a peer's {@link ProposalMessage}, DEDUPED by id. If `p.id` matches the
 * currently-pending proposal's id, this is a re-delivery (a reconnect / duplicate) →
 * an IDEMPOTENT NO-OP (the same state is returned unchanged). Otherwise it records a
 * new INCOMING pending proposal, SUPERSEDING any prior pending one (at-most-one) and
 * clearing any stale resolution.
 *
 * Dedup is against the LIVE pending id (not a full history): a resolved proposal's slot
 * is already cleared, and the wire messages are NON-RETAINED, so the only replay this
 * layer must swallow is a duplicate of the still-in-flight proposal — which is exactly
 * what the pending-id check catches.
 */
export function receiveProposal(
  state: HandshakeState,
  p: ProposalMessage,
): HandshakeState {
  if (state.pending !== null && state.pending.id === p.id) {
    // Duplicate of the in-flight proposal — idempotent no-op (same value).
    return state;
  }
  const pending: PendingProposal = {
    id: p.id,
    action: p.action,
    proposedBy: p.proposedBy,
    direction: 'incoming',
  };
  return { pending, resolution: null };
}

/**
 * Respond to an INCOMING pending proposal, resolving it. Returns the new state (with the
 * pending slot cleared and the {@link resolution} recorded) AND the
 * {@link ResponseMessage} to publish back to the proposer.
 *
 * Only an incoming proposal whose id matches `proposalId` may be responded to; anything
 * else (no pending, an outgoing proposal, or a mismatched id — a stale response after a
 * supersede) is a NO-OP with NO message (there is nothing valid to answer). This is the
 * no-double-resolve guard on the responder side: once responded, the pending slot is
 * cleared, so a repeat `respond` finds no match and produces nothing.
 */
export function respond(
  state: HandshakeState,
  proposalId: string,
  accepted: boolean,
): { readonly state: HandshakeState; readonly message: ResponseMessage | null } {
  const p = state.pending;
  if (p === null || p.direction !== 'incoming' || p.id !== proposalId) {
    return { state, message: null };
  }
  const resolution: Resolution = {
    id: p.id,
    action: p.action,
    direction: 'incoming',
    outcome: accepted ? 'accepted' : 'declined',
  };
  const message: ResponseMessage = { kind: 'response', proposalId: p.id, accepted };
  return { state: { pending: null, resolution }, message };
}

/**
 * Receive the peer's {@link ResponseMessage} to OUR outgoing proposal, resolving it.
 * Only resolves when there is an OUTGOING pending proposal whose id matches
 * `r.proposalId`; anything else (no pending, an incoming proposal, or a mismatched id —
 * a duplicate response after the proposal already resolved and cleared, or a response
 * to a superseded proposal) is an IDEMPOTENT NO-OP. This is the no-double-resolve guard
 * on the proposer side.
 */
export function receiveResponse(
  state: HandshakeState,
  r: ResponseMessage,
): HandshakeState {
  const p = state.pending;
  if (p === null || p.direction !== 'outgoing' || p.id !== r.proposalId) {
    return state;
  }
  const resolution: Resolution = {
    id: p.id,
    action: p.action,
    direction: 'outgoing',
    outcome: r.accepted ? 'accepted' : 'declined',
  };
  return { pending: null, resolution };
}

/**
 * Clear whatever proposal is pending (local withdraw / consumer abort). If nothing is
 * pending, returns the state unchanged (referentially — no spurious new object). The
 * pending proposal is DROPPED, not resolved: it never accepted, so no effect fires and
 * no resolution is recorded — a cancel leaves no trace, exactly like a never-sent ask.
 */
export function cancel(state: HandshakeState): HandshakeState {
  if (state.pending === null) return state;
  return { pending: null, resolution: state.resolution };
}

/**
 * Auto-cancel on GAME-ADVANCED: a move landed, so any pending rematch/undo proposal is
 * now stale and is dropped (design guardrail: "auto-cancel a pending proposal when the
 * game advances"). Delegates to {@link cancel} — same drop-without-resolving semantics —
 * so the game-advance and manual-cancel paths can never diverge.
 */
export function onGameAdvanced(state: HandshakeState): HandshakeState {
  return cancel(state);
}

/**
 * Auto-cancel on PEER-GONE: the proposer/peer dropped, so the handshake can never
 * complete; the pending proposal is dropped (design guardrail: "or the proposer/peer
 * drops"). Delegates to {@link cancel} for identical drop semantics.
 */
export function onPeerGone(state: HandshakeState): HandshakeState {
  return cancel(state);
}

/**
 * Clear a recorded {@link resolution} once the consumer has fired its effect, so the
 * effect fires exactly once. If there is no resolution, returns the state unchanged
 * (referentially). Leaves any pending proposal untouched.
 */
export function clearResolution(state: HandshakeState): HandshakeState {
  if (state.resolution === null) return state;
  return { pending: state.pending, resolution: null };
}

// ── Pure selectors ────────────────────────────────────────────────────────────

/** The OUTGOING pending proposal (we asked), or `null`. */
export function outgoingPending(state: HandshakeState): PendingProposal | null {
  return state.pending !== null && state.pending.direction === 'outgoing'
    ? state.pending
    : null;
}

/** The INCOMING pending proposal (the peer asked), or `null`. */
export function incomingPending(state: HandshakeState): PendingProposal | null {
  return state.pending !== null && state.pending.direction === 'incoming'
    ? state.pending
    : null;
}

/** The last recorded {@link Resolution}, or `null` if none is outstanding. */
export function resolution(state: HandshakeState): Resolution | null {
  return state.resolution;
}

/** True iff any proposal is pending (either direction) — no new ask should race it. */
export function hasPending(state: HandshakeState): boolean {
  return state.pending !== null;
}

/**
 * The action-agnostic `canPropose` PREDICATE SHAPE the consumers specialize. It answers
 * one universal precondition — you may not raise a new proposal while one is already
 * pending (the at-most-one rule surfaced as a guard, so a UI can disable the button) —
 * combined with a CONSUMER predicate that encodes the action-specific rule (e.g. #18's
 * `decideUndo`: only the last mover may undo; #12's "the game has ended").
 *
 * `consumerAllows` is the consumer's pure decision (over its own `GameState`/seat/
 * `myColor`, evaluated by the caller). This keeps the who-may-propose-WHAT logic in the
 * consumer while the one shared invariant (no concurrent pending) lives here, so every
 * consumer enforces it identically.
 */
export function canPropose(
  state: HandshakeState,
  consumerAllows: boolean,
): boolean {
  return !hasPending(state) && consumerAllows;
}
