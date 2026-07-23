/**
 * Full-state sync engine (build plan Task 3.3; GLOSSARY "Conflict", "Event log";
 * game-core design, Part 3).
 *
 * ## The model
 *
 * The canonical state of a game is its **append-only event log**. Peers do not
 * overwrite a shared blob — each publishes its *entire* log and every receiver runs
 * a deterministic prefix/hash decision to converge:
 *
 *   - **ADOPT** iff the local log is a **strict** prefix of the remote log — the
 *     remote is a genuine forward extension of my history, so I replace mine with
 *     it (I now hold the longer, still-valid log).
 *   - **IGNORE** iff the remote log is a prefix of mine (including an *equal* log) —
 *     the remote is stale or a pure replay; adopting it would move me backward.
 *   - **CONFLICT** iff neither is a prefix of the other — the two histories
 *     **fork**. v1 response: stop the game, archive *both* forks flagged
 *     `conflicted`, and surface an error state (no silent auto-merge).
 *
 * Because ADOPT only ever accepts strict extensions and IGNORE drops everything
 * shorter-or-equal, delivery order does not matter: any permutation of a set of
 * messages **converges to the longest valid (non-forking) log**, and re-delivering
 * an old message is a no-op (replay-idempotent). This is exactly why the append-only
 * log + hash chain was chosen over a mutable shared state.
 *
 * ## Layering & purity
 *
 * {@link decideSync} and the {@link SyncMessage} codec are **pure** — no transport,
 * DOM, or clock — so they are unit-tested to 100% in isolation (agent-principles:
 * the IO adapter stays thin, the decision logic is separable). {@link SyncEngine}
 * wraps a core {@link Game}, a {@link Transport}, and the {@link flagConflicted}
 * archive call, wiring the pure decision to real message exchange. It carries no
 * rules of Pente (that is `src/core`) and imports nothing from three/render/ui.
 */

import { Game } from '../core/game';
import {
  emptyLog,
  append,
  headHash,
  isPrefix,
  firstDivergence,
  type Event,
  type EventLog,
} from '../core/eventLog';
import type { Coord } from '../core/coords';
import { opponent, type GameState, type Player } from '../core/gameState';
import { flagConflicted, type ArchivedMeta } from '../persist/archive';
import { createEmitter, type Emitter } from '../util/emitter';
import type { Transport, TransportMessage } from './transport';
import type { Proposal } from './admission';
import type { SeatMap } from './seats';

/** The sync wire-format version. Bumped only on a breaking message-shape change. */
export const SYNC_VERSION = 1 as const;

/**
 * The outbound/inbound sync message: the **full** event log plus a version tag and
 * the sender's `headHash` (a cheap integrity check the receiver re-verifies against
 * the log it reconstructs). The `log` is plain events (JSON-cloneable), matching the
 * archive/export form.
 *
 * ## `epoch` — the in-place fresh-game generation (N.2 rematch)
 *
 * A rematch resets BOTH peers to a fresh game OVER THE SAME CONNECTION (no
 * disconnect/re-host; design N.2 decision 2). A fresh game has a fresh empty log,
 * which is NOT a strict extension of the finished game's log — so raw prefix
 * convergence would either fork (conflict) or, worse, a late in-flight message from
 * the just-finished game would re-adopt the old board (empty is a prefix of the full
 * log). The `epoch` is the fresh-game GENERATION: it increments on every in-place
 * reset ({@link SyncEngine.resetGame}). Convergence is epoch-lexicographic — a HIGHER
 * remote epoch wins outright (the peer reset first; adopt its fresh game), a LOWER
 * remote epoch is stale (ignore), and only WITHIN the same epoch does the existing
 * prefix/hash decision apply. This makes the seamless in-place reset converge on the
 * same transport and makes any stale prior-epoch replay a no-op by construction.
 */
export interface SyncMessage {
  /** Wire-format version (must equal {@link SYNC_VERSION}). */
  readonly version: number;
  /**
   * The fresh-game GENERATION (N.2 in-place rematch). Starts at 0; incremented by
   * {@link SyncEngine.resetGame} on every seamless reset. A missing `epoch` on the
   * wire (a pre-epoch peer) is read as 0 — the same generation the first game runs in
   * — so an un-upgraded peer's first game still converges (backward-compat).
   */
  readonly epoch: number;
  /**
   * The game's UUID (minted at genesis, part of the hashed history — S.1). Carried
   * on the wire so the receiver reconstructs the log with the *same* genesis seed
   * and the {@link headHash} re-verification is meaningful: a matching headHash now
   * proves same-game-identity AND same-history, and a same-uuid/divergent-headHash
   * is a detectable genuine conflict. Required — the uuid is intrinsic to the chain.
   */
  readonly uuid: string;
  /** The sender's head hash — re-verified on receipt against the reconstructed log. */
  readonly headHash: string;
  /** The full append-only log as plain events, in order. */
  readonly log: readonly Event[];
}

/**
 * A **proposal** message: one player asks the peer to accept an out-of-band
 * `action` (e.g. `'rematch'`, `'undo'`, `'redo'` — an OPAQUE tag this layer never
 * interprets; the consumers #12/#18 give it meaning). It is held out-of-band and is
 * NOT part of the append-only move-log: a rejected proposal must leave no trace.
 *
 * `id` is a UNIQUE, sender-chosen identifier used to DEDUP on receipt so a
 * reconnect / retained re-delivery never replays a stale proposal, and to correlate
 * the {@link ResponseMessage} back to its proposal.
 */
export interface ProposalMessage {
  readonly kind: 'proposal';
  /** Unique proposal id (dedup on receive; correlates the response). */
  readonly id: string;
  /** Opaque action tag the consumer fills (`'rematch' | 'undo' | 'redo' | …`). */
  readonly action: string;
  /** The seat (by color) that raised the proposal. */
  readonly proposedBy: Player;
}

/**
 * A **response** message: the peer's accept/decline of a {@link ProposalMessage},
 * correlated by `proposalId`. Like a proposal it is out-of-band — never appended to
 * the move-log.
 */
export interface ResponseMessage {
  readonly kind: 'response';
  /** The {@link ProposalMessage.id} this responds to. */
  readonly proposalId: string;
  /** `true` = accepted, `false` = declined. */
  readonly accepted: boolean;
}

/**
 * ## Admission messages (Task S.4, epic #35) — the room-ENTRY protocol
 *
 * These are DISTINCT from the in-game `'proposal'`/`'response'` handshake (rematch/undo/redo,
 * N.1): those negotiate an action WITHIN a live shared game; these negotiate WHICH game two
 * peers play when they first meet in a room (design §4 "Entry / admission protocol"). Keeping
 * them separate kinds means an admission `hello` can never be mistaken for a rematch proposal
 * and vice-versa — the pump routes each to the right consumer by `kind`.
 *
 * Every admission message carries a UNIQUE, sender-chosen `id`. Admission traffic is published
 * NON-RETAINED (design §Guardrails: "non-retained + id-deduped"), but a relay may still deliver
 * at-least-once and a reconnect must never replay a stale proposal — so a receiver DEDUPES on
 * `id` ({@link AdmissionDeduper}) and drops a re-seen message. The `id` is the dedup key; it is
 * NOT correlated the way a {@link ResponseMessage} correlates to a proposal (admission has no
 * accept/decline round-trip — the arbiter answers a `hello` with an `admit` or a `reject`).
 *
 * A **hello**: a peer announces its arrival with its stable `playerId`, its seed
 * {@link Proposal} (what game it brings — new/resume/current/defer), and an `arrivalTag` (its
 * live-presence arrival rank, feeding the initiator election in `admission.ts`). The arbiter
 * (or the elected initiator) reconciles the pair of proposals and answers.
 */
export interface HelloMessage {
  readonly kind: 'hello';
  /** Unique message id (dedup on receive; a reconnect must not replay a stale hello). */
  readonly id: string;
  /** The announcing peer's stable playerId (owns a seat across reconnects). */
  readonly playerId: string;
  /** The seed proposal this peer brings (design §3/§5; reconciled in `admission.ts`). */
  readonly proposal: Proposal;
  /** The peer's live-presence arrival rank — feeds the initiator election (earlier = smaller). */
  readonly arrivalTag: number;
}

/**
 * An **admit**: the arbiter's grant. It carries the AUTHORITATIVE game the pair agreed on (as a
 * full {@link SyncMessage} sync payload, so the admitted peer adopts it through the ordinary
 * hash-chain-verified {@link parseSyncMessage} path — same-identity is provable), plus the
 * durable identity-owned {@link SeatMap} that assigns each seat to its owning playerId. The
 * admitted peer validates the game (headHash re-verify) and takes the seat the map gives it.
 */
export interface AdmitMessage {
  readonly kind: 'admit';
  /** Unique message id (dedup on receive). */
  readonly id: string;
  /** The authoritative game to adopt — a full sync payload, hash-chain re-verifiable. */
  readonly game: { readonly kind: 'sync' } & SyncMessage;
  /** The identity-owned seat map (real playerIds; no `'host'` sentinel). */
  readonly seats: SeatMap;
}

/**
 * The typed reasons an admission is refused (design §7). A machine-readable reason surfaced to
 * the UI VERBATIM — never a silent failure or a mislabeled log (agent-principles: reject
 * honestly). This is the UNION of the seat-level ({@link import('./seats').ClaimRejection}) and
 * game-level ({@link import('./admission').ReconcileReject}) refusals, plus `seat-reserved`:
 *
 *   - `room-full`      — both seats are owned; the newcomer owns neither (spectate is #36).
 *   - `seat-reserved`  — a seat is reserved for an absent owner and the newcomer is not that owner.
 *   - `game-mismatch`  — the peers proposed DIFFERENT games (different uuids).
 *   - `game-divergent` — the SAME game uuid but forked histories (divergent headHash) — the #38 seam.
 */
export type AdmissionReject =
  | 'room-full'
  | 'seat-reserved'
  | 'game-mismatch'
  | 'game-divergent';

/** The set of valid {@link AdmissionReject} reasons — the single source of truth for validation. */
const ADMISSION_REJECT_REASONS: readonly AdmissionReject[] = [
  'room-full',
  'seat-reserved',
  'game-mismatch',
  'game-divergent',
];

/**
 * A **reject**: the arbiter's typed refusal. Carries a machine-readable {@link AdmissionReject}
 * the net panel surfaces to the user (design §7) — the seam #38 later turns `game-*` into a
 * merge/diff/rewind flow. Never a masked or mislabeled failure.
 */
export interface RejectMessage {
  readonly kind: 'reject';
  /** Unique message id (dedup on receive). */
  readonly id: string;
  /** The typed refusal reason, surfaced verbatim to the UI. */
  readonly reason: AdmissionReject;
}

/**
 * The networked wire message as a DISCRIMINATED UNION on `kind`:
 *
 *   - `'sync'`     — the existing full-log sync payload ({@link SyncMessage} fields),
 *                    unchanged on the wire except for the added `kind` tag.
 *   - `'proposal'` — an in-game out-of-band ask ({@link ProposalMessage}; rematch/undo/redo).
 *   - `'response'` — the accept/decline of a proposal ({@link ResponseMessage}).
 *   - `'hello'`    — a peer announcing room ENTRY with its seed proposal ({@link HelloMessage}).
 *   - `'admit'`    — the arbiter's grant: authoritative game + seat map ({@link AdmitMessage}).
 *   - `'reject'`   — the arbiter's typed refusal ({@link RejectMessage}).
 *
 * The `'hello'`/`'admit'`/`'reject'` ADMISSION kinds are deliberately DISTINCT from the in-game
 * `'proposal'`/`'response'` handshake so an entry negotiation can never be conflated with a
 * rematch/undo ask. Every message crossing the transport is one of these; {@link parseGameMessage}
 * validates the shape and narrows the kind before anything acts on it.
 */
export type GameMessage =
  | ({ readonly kind: 'sync' } & SyncMessage)
  | ProposalMessage
  | ResponseMessage
  | HelloMessage
  | AdmitMessage
  | RejectMessage;

/** An admission message (room-entry protocol) — the id-deduped, non-retained subset. */
export type AdmissionMessage = HelloMessage | AdmitMessage | RejectMessage;

/**
 * Validate an inbound `unknown` transport payload into a well-typed
 * {@link GameMessage} (pure — no side effects). Discriminates on `kind` and
 * validates EACH shape's required fields, throwing a {@link SyncError} on a
 * malformed message, an unknown `kind`, or a missing/mistyped field — errors
 * propagate honestly, never a silently-coerced half-message (agent-principles:
 * errors propagate honestly).
 *
 * BACKWARD-COMPAT: a message with NO `kind` field but the shape of a legacy sync
 * message (a numeric `version`, a string `headHash`, and an array `log`) is treated
 * as `kind: 'sync'`. A peer running the pre-union build publishes an un-kinded
 * {@link SyncMessage}; rejecting it would break sync the moment one side upgrades,
 * so an un-kinded-but-sync-shaped payload is accepted and tagged `'sync'`. Anything
 * else with no recognisable `kind`/shape is rejected (a truly malformed or
 * unknown-kind message must NOT be silently accepted).
 *
 * Note this validates the ENVELOPE (kind + field presence/types); the deeper
 * sync-payload integrity (the hash-chain re-verification) is done by
 * {@link parseSyncMessage} when a `'sync'` message is applied.
 */
export function parseGameMessage(msg: unknown): GameMessage {
  if (typeof msg !== 'object' || msg === null) {
    throw new SyncError('game message must be an object');
  }
  const rec = msg as Record<string, unknown>;
  const kind = rec.kind;
  // Backward-compat: an un-kinded legacy sync message (pre-tagged-union peer).
  if (kind === undefined && looksLikeSync(rec)) {
    return { kind: 'sync', version: rec.version as number, epoch: epochOf(rec), uuid: rec.uuid as string, headHash: rec.headHash as string, log: rec.log as readonly Event[] };
  }
  switch (kind) {
    case 'sync': {
      if (!looksLikeSync(rec)) {
        throw new SyncError('sync message requires numeric version, string uuid, string headHash, and array log');
      }
      return { kind: 'sync', version: rec.version as number, epoch: epochOf(rec), uuid: rec.uuid as string, headHash: rec.headHash as string, log: rec.log as readonly Event[] };
    }
    case 'proposal': {
      if (typeof rec.id !== 'string') {
        throw new SyncError('proposal message requires a string id');
      }
      if (typeof rec.action !== 'string') {
        throw new SyncError('proposal message requires a string action');
      }
      if (rec.proposedBy !== 'white' && rec.proposedBy !== 'black') {
        throw new SyncError("proposal message requires proposedBy 'white' or 'black'");
      }
      return { kind: 'proposal', id: rec.id, action: rec.action, proposedBy: rec.proposedBy };
    }
    case 'response': {
      if (typeof rec.proposalId !== 'string') {
        throw new SyncError('response message requires a string proposalId');
      }
      if (typeof rec.accepted !== 'boolean') {
        throw new SyncError('response message requires a boolean accepted');
      }
      return { kind: 'response', proposalId: rec.proposalId, accepted: rec.accepted };
    }
    case 'hello': {
      if (typeof rec.id !== 'string') {
        throw new SyncError('hello message requires a string id');
      }
      if (typeof rec.playerId !== 'string') {
        throw new SyncError('hello message requires a string playerId');
      }
      // `Number.isFinite` returns false WITHOUT coercion for every non-number (string, null,
      // boolean, undefined) AND for NaN/±Infinity, so this single predicate rejects both a
      // non-numeric and a non-finite arrivalTag — no redundant `typeof` sub-clause for a mutant
      // to render equivalent (same technique as {@link normalizeEpoch}).
      if (!Number.isFinite(rec.arrivalTag)) {
        throw new SyncError('hello message requires a finite numeric arrivalTag');
      }
      const proposal = parseProposal(rec.proposal);
      // `Number.isFinite` guaranteed a finite number above but does not narrow `unknown`; the cast
      // is sound (the guard threw for anything else).
      return { kind: 'hello', id: rec.id, playerId: rec.playerId, proposal, arrivalTag: rec.arrivalTag as number };
    }
    case 'admit': {
      if (typeof rec.id !== 'string') {
        throw new SyncError('admit message requires a string id');
      }
      const game = parseAdmitGame(rec.game);
      const seats = parseSeatMap(rec.seats);
      return { kind: 'admit', id: rec.id, game, seats };
    }
    case 'reject': {
      if (typeof rec.id !== 'string') {
        throw new SyncError('reject message requires a string id');
      }
      if (!isAdmissionReject(rec.reason)) {
        throw new SyncError(
          `reject message requires a known reason (one of ${ADMISSION_REJECT_REASONS.join('/')}); got ${String(rec.reason)}`,
        );
      }
      return { kind: 'reject', id: rec.id, reason: rec.reason };
    }
    default:
      throw new SyncError(`unknown game message kind: ${String(kind)}`);
  }
}

/**
 * Whether `rec` has the field shape of a sync payload: a numeric `version`, a
 * string `headHash`, and an array `log`. Used both to accept an un-kinded legacy
 * sync message and to validate an explicit `kind: 'sync'` envelope.
 */
function looksLikeSync(rec: Record<string, unknown>): boolean {
  return (
    typeof rec.version === 'number' &&
    typeof rec.uuid === 'string' &&
    typeof rec.headHash === 'string' &&
    Array.isArray(rec.log)
  );
}

/**
 * Validate an inbound raw value into a well-typed {@link Proposal} (the seed proposal a
 * {@link HelloMessage} carries), throwing a {@link SyncError} on any malformed shape. Each of
 * the four kinds is validated for its OWN required fields — `resume`/`current` must carry a
 * string `uuid` + string `headHash`; `defer`/`new` carry no payload. An unknown kind, a
 * non-object, or a history proposal missing its identity is rejected honestly rather than
 * silently coerced (a half-parsed proposal would let a peer's malformed entry through).
 */
function parseProposal(raw: unknown): Proposal {
  if (typeof raw !== 'object' || raw === null) {
    throw new SyncError('hello message requires a proposal object');
  }
  const p = raw as Record<string, unknown>;
  switch (p.kind) {
    case 'defer':
      return { kind: 'defer' };
    case 'new':
      return { kind: 'new' };
    case 'resume':
    case 'current': {
      if (typeof p.uuid !== 'string' || p.uuid.length === 0) {
        throw new SyncError(`${p.kind} proposal requires a non-empty string uuid`);
      }
      if (typeof p.headHash !== 'string' || p.headHash.length === 0) {
        throw new SyncError(`${p.kind} proposal requires a non-empty string headHash`);
      }
      return { kind: p.kind, uuid: p.uuid, headHash: p.headHash };
    }
    default:
      throw new SyncError(`unknown proposal kind: ${String(p.kind)}`);
  }
}

/**
 * Validate the `game` field of an {@link AdmitMessage}: it must be a full `kind:'sync'` sync
 * ENVELOPE (so the admitted peer can adopt it through the hash-chain-verified sync path). This
 * validates the envelope only (via {@link parseGameMessage} recursion); the deeper chain
 * re-verification is done by {@link parseSyncMessage} when the game is actually applied.
 */
function parseAdmitGame(raw: unknown): { readonly kind: 'sync' } & SyncMessage {
  const inner = parseGameMessage(raw);
  if (inner.kind !== 'sync') {
    throw new SyncError(`admit message game must be a sync payload, got kind ${inner.kind}`);
  }
  return inner;
}

/**
 * Validate the `seats` field of an {@link AdmitMessage} into a {@link SeatMap}: each seat is a
 * string playerId or `null` (never a `'host'` sentinel — every owner is a real id). A missing
 * field, a non-object, or a seat that is neither a string nor `null` is rejected.
 */
function parseSeatMap(raw: unknown): SeatMap {
  if (typeof raw !== 'object' || raw === null) {
    throw new SyncError('admit message requires a seats object');
  }
  const s = raw as Record<string, unknown>;
  return { white: parseSeat(s.white, 'white'), black: parseSeat(s.black, 'black') };
}

/** One seat of a {@link SeatMap}: a string playerId or `null`; anything else is rejected. */
function parseSeat(raw: unknown, color: 'white' | 'black'): string | null {
  if (raw === null) return null;
  if (typeof raw === 'string') return raw;
  throw new SyncError(`admit message ${color} seat must be a string playerId or null`);
}

/**
 * True iff `raw` is one of the four typed {@link AdmissionReject} reasons. Membership in the
 * fixed reason set is the ONLY predicate: `includes` returns false for every non-string (a
 * number/null/object never equals a string reason under SameValueZero), so no separate
 * `typeof === 'string'` sub-clause is needed — one predicate, nothing for a mutant to render
 * equivalent (same technique as the {@link normalizeEpoch}/arrivalTag guards).
 */
function isAdmissionReject(raw: unknown): raw is AdmissionReject {
  return (ADMISSION_REJECT_REASONS as readonly unknown[]).includes(raw);
}

/**
 * An id-based deduper for {@link AdmissionMessage}s (Task S.4). Admission traffic is published
 * NON-RETAINED, but a relay may deliver at-least-once and a reconnect could re-surface a message,
 * so the receiver must treat a re-seen `id` as a no-op — a stale proposal must NEVER replay
 * (design §Guardrails). This is the pure state machine that decides freshness; the transport glue
 * (S.5) constructs one per session and gates admission handling on {@link fresh}.
 *
 * It is deliberately SEPARATE from the sync-log replay-safety (which is intrinsic to the
 * append-only log's prefix/hash decision): admission messages are not a log, so they need their
 * own explicit dedup. Idempotent by construction — the FIRST sighting of an id returns `true`
 * exactly once; every later sighting of the SAME id returns `false`, whatever the order or count
 * (property-tested with fast-check).
 */
export class AdmissionDeduper {
  private readonly seen = new Set<string>();

  /**
   * Record `id` and report whether this is its FIRST sighting: `true` the first time an id is
   * seen (the message is fresh — handle it), `false` on every repeat (a duplicate — drop it).
   * Recording and reporting in one call makes the "seen-once" invariant impossible to violate by
   * forgetting to record after a check.
   */
  fresh(id: string): boolean {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    return true;
  }

  /** Whether `id` has been seen before (a pure query; does NOT record). */
  hasSeen(id: string): boolean {
    return this.seen.has(id);
  }
}

/**
 * Read the fresh-game {@link SyncMessage.epoch} off a raw sync record, defaulting a
 * MISSING or non-numeric `epoch` to 0 — the generation the first game runs in. A
 * pre-epoch peer publishes no `epoch`; treating it as 0 keeps its first game
 * converging with an upgraded peer (backward-compat, exactly as an un-kinded message
 * is treated as `kind: 'sync'`). A negative epoch is impossible from
 * {@link SyncEngine.resetGame} (it only increments from 0); a hostile/garbage
 * negative value is clamped to 0 so it can never out-rank a live generation.
 */
function epochOf(rec: Record<string, unknown>): number {
  return normalizeEpoch(rec.epoch);
}

/**
 * Normalize a raw `epoch` value to a whole, non-negative generation: a missing / non-numeric /
 * non-finite / negative value becomes 0 (the first generation), a fractional value is floored. The
 * single source of truth for reading an epoch off the wire — used both by the {@link parseGameMessage}
 * codec ({@link epochOf}) and by {@link SyncEngine.receive}'s public seam (which must not trust a
 * directly-injected message's epoch), so the two can never disagree.
 */
export function normalizeEpoch(raw: unknown): number {
  // A generation must be a FINITE number; anything else (missing field, string, boolean, NaN,
  // ±Infinity) is read as 0. `Number.isFinite` returns false without coercion for every non-number,
  // so this single guard rejects both non-numbers AND non-finite numbers — one predicate, no
  // redundant sub-condition for a mutant to render equivalent.
  if (!Number.isFinite(raw as number)) return 0;
  // Floor to a whole generation, then clamp a negative (hostile/garbage) value up to 0 so it can
  // never out-rank a live generation. `Math.max(0, …)` makes the clamp arithmetic (killable) rather
  // than a boundary predicate whose `<`/`<=` variants are indistinguishable at exactly 0.
  return Math.max(0, Math.floor(raw as number));
}

/** The three possible outcomes of comparing a local log against a remote one. */
export type SyncDecision =
  | { readonly action: 'adopt' }
  | { readonly action: 'ignore' }
  | { readonly action: 'conflict'; readonly divergePly: number };

/**
 * Decide how a `remote` log relates to the `local` one (pure — no side effects).
 *
 *   - `adopt`    — `local` is a **strict** prefix of `remote` (remote is longer and
 *                  agrees on every ply of `local`): take the remote.
 *   - `ignore`   — `remote` is a prefix of `local` (equal or shorter): stale/replay.
 *   - `conflict` — neither is a prefix of the other: the logs fork at `divergePly`.
 *
 * The order of the two prefix checks matters: an equal log satisfies *both*
 * `isPrefix(local, remote)` and `isPrefix(remote, local)`; testing "remote is a
 * prefix of local" first makes equal logs `ignore` (a replay), never a spurious
 * adopt of an identical log.
 */
export function decideSync(local: EventLog, remote: EventLog): SyncDecision {
  // Remote is a prefix of local (equal or older) → nothing new; drop it.
  if (isPrefix(remote, local)) return { action: 'ignore' };
  // Local is a strict prefix of remote (remote is longer, since equal was handled
  // above) → the remote is a valid forward extension; adopt it.
  if (isPrefix(local, remote)) return { action: 'adopt' };
  // Neither is a prefix → the histories fork.
  return { action: 'conflict', divergePly: firstDivergence(local, remote) };
}

/**
 * Epoch-aware sync decision (pure — no side effects): decide how a `remote` log at
 * `remoteEpoch` relates to the `local` log at `localEpoch`, where the epoch is the
 * in-place fresh-game GENERATION (N.2 rematch; see {@link SyncMessage.epoch}).
 *
 *   - remote epoch **higher** → the peer already reset to a newer game (it did the
 *     in-place rematch first): `adopt` its fresh log outright, whatever the logs say.
 *     The prefix comparison does not apply ACROSS generations — a new game's empty
 *     log is deliberately NOT a continuation of the old one.
 *   - remote epoch **lower** → the message is from a superseded generation (a late,
 *     in-flight publish from the just-finished game): `ignore` it. This is exactly
 *     what stops a stale won-game message from re-adopting the old board after a
 *     reset — the trap the seamless in-place reset would otherwise spring.
 *   - **same** epoch → defer to the ordinary same-generation {@link decideSync}
 *     (adopt strict extension / ignore prefix / conflict on a genuine fork).
 *
 * Because a reset only ever INCREMENTS the epoch and both peers reset deterministically
 * on the same accepted rematch, the epochs converge and delivery order still does not
 * matter: any permutation settles on the highest epoch, then the longest valid log
 * within it.
 */
export function decideSyncEpoched(
  localEpoch: number,
  local: EventLog,
  remoteEpoch: number,
  remote: EventLog,
): SyncDecision {
  if (remoteEpoch > localEpoch) return { action: 'adopt' };
  if (remoteEpoch < localEpoch) return { action: 'ignore' };
  return decideSync(local, remote);
}

/**
 * The result of asking whether a player may emit an `undo`: permitted, or refused
 * with a machine-readable reason.
 */
export type UndoDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: UndoRejection };

/** Why a networked undo was refused (design: restricted undo — option 2). */
export type UndoRejection = 'nothing-to-undo' | 'not-your-move';

/**
 * Decide whether the player seated as `myColor` may `undo` from the given live
 * `state` at ply `ply` (pure — no side effects). This is the **restricted**
 * networked-undo rule (game-core design Part 3: "a client only emits an `undo`
 * event for its **own last move**"):
 *
 *   - `nothing-to-undo` — `ply === 0`: no committed move exists to step back.
 *   - `not-your-move`   — the last committed move was the *opponent's*, so this
 *                         client may not undo it.
 *   - `ok`              — there is a move and its mover is `myColor`.
 *
 * The last mover's color is derived from `state.turn`: a normal `place` flips the
 * turn, so the just-moved player is `opponent(state.turn)`. On a **winning** move
 * the turn does *not* flip, and `state.turn` stays the winner — who is exactly the
 * last mover — so the rule still correctly attributes a winning move to its player
 * (a player may undo its own winning move; the opponent may not).
 */
export function decideUndo(
  state: GameState,
  ply: number,
  myColor: Player,
): UndoDecision {
  if (ply === 0) return { ok: false, reason: 'nothing-to-undo' };
  const lastMover = state.winner === null ? opponent(state.turn) : state.turn;
  if (lastMover !== myColor) return { ok: false, reason: 'not-your-move' };
  return { ok: true };
}

/**
 * Build a `kind: 'sync'` {@link GameMessage} carrying `log`'s full history and head
 * hash. The `kind` tag makes it a member of the {@link GameMessage} union so a
 * receiver can discriminate it from a `'proposal'` / `'response'`; the remaining
 * fields are the unchanged {@link SyncMessage} payload, so existing sync traffic
 * round-trips identically apart from the added tag.
 */
export function toSyncMessage(
  log: EventLog,
  epoch = 0,
): { readonly kind: 'sync' } & SyncMessage {
  return {
    kind: 'sync',
    version: SYNC_VERSION,
    epoch,
    uuid: log.uuid,
    headHash: headHash(log),
    log: log.entries.map((entry) => entry.event),
  };
}

/**
 * Build a `kind:'hello'` admission message (Task S.4). `id` is the sender-chosen UNIQUE id used
 * to dedup on receive; `playerId` is the announcing peer's stable identity; `proposal` is its
 * seed proposal; `arrivalTag` is its live-presence arrival rank for the initiator election.
 */
export function toHelloMessage(
  id: string,
  playerId: string,
  proposal: Proposal,
  arrivalTag: number,
): HelloMessage {
  return { kind: 'hello', id, playerId, proposal, arrivalTag };
}

/**
 * Build a `kind:'admit'` admission message (Task S.4) carrying the authoritative `game` (a full
 * sync payload the admitted peer adopts through the hash-chain-verified path) and the durable
 * identity-owned `seats` map. `id` is the UNIQUE dedup id.
 */
export function toAdmitMessage(
  id: string,
  game: { readonly kind: 'sync' } & SyncMessage,
  seats: SeatMap,
): AdmitMessage {
  return { kind: 'admit', id, game, seats };
}

/**
 * Build a `kind:'reject'` admission message (Task S.4) carrying a typed {@link AdmissionReject}
 * reason surfaced verbatim to the UI. `id` is the UNIQUE dedup id.
 */
export function toRejectMessage(id: string, reason: AdmissionReject): RejectMessage {
  return { kind: 'reject', id, reason };
}

/**
 * Validate an inbound {@link SyncMessage} and reconstruct its {@link EventLog},
 * recomputing the hash chain from the events and asserting it matches the message's
 * claimed `headHash`. Throws on a wrong version, a malformed shape, or a headHash
 * mismatch (tamper/corruption) — errors propagate honestly, never a silent
 * half-built log (agent-principles: errors propagate honestly).
 */
export function parseSyncMessage(msg: SyncMessage): EventLog {
  if (typeof msg !== 'object' || msg === null) {
    throw new SyncError('sync message must be an object');
  }
  if (msg.version !== SYNC_VERSION) {
    throw new SyncError(
      `unsupported sync version ${String(msg.version)} (expected ${SYNC_VERSION})`,
    );
  }
  if (!Array.isArray(msg.log)) {
    throw new SyncError('sync message log must be an array of events');
  }
  if (typeof msg.uuid !== 'string' || msg.uuid.length === 0) {
    throw new SyncError('sync message requires a non-empty string uuid');
  }
  // Seed with the message's uuid so the reconstructed genesis hash matches the
  // sender's — the uuid is intrinsic to the chain (S.1). The headHash check below
  // then proves same-identity-and-history in one comparison.
  let log: EventLog = emptyLog(msg.uuid);
  for (const event of msg.log) {
    log = append(log, event);
  }
  if (headHash(log) !== msg.headHash) {
    throw new SyncError(
      `sync message headHash mismatch: claimed ${String(msg.headHash)}, ` +
        `computed ${headHash(log)}`,
    );
  }
  return log;
}

/** Thrown when an inbound sync message is malformed, mis-versioned, or tampered. */
export class SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncError';
  }
}

/** The engine's status: live, or stopped by a fork (with the archived record id). */
export type SyncStatus =
  | { readonly kind: 'ok' }
  | { readonly kind: 'conflict'; readonly conflictId: string; readonly divergePly: number };

/**
 * Supplies the {@link ArchivedMeta} to attach when a conflict is archived. Called
 * lazily (only on conflict) so the caller can inject live player/timing info.
 */
export type MetaProvider = () => Omit<ArchivedMeta, 'result'>;

/**
 * Wraps a {@link Game} + {@link Transport}, applying the order/replay-safe full-state
 * sync decision on every inbound message and stopping the game on a fork.
 *
 * On a local move the engine appends to its `Game` and publishes the full log. On
 * receipt it runs the epoch-aware {@link decideSyncEpoched}; `adopt` replaces the
 * local game with the remote log (and advances the generation on a higher remote
 * epoch), `ignore` is a no-op (including a superseded prior-generation message), and
 * `conflict` archives both forks via {@link flagConflicted}, flips {@link status} to
 * `conflict`, and refuses all further local moves (the game is stopped).
 *
 * A rematch resets to a fresh game IN PLACE over the same transport via
 * {@link resetGame} — bumping the fresh-game {@link SyncMessage.epoch} rather than
 * disconnecting/re-hosting (design N.2 decision 2).
 */
export class SyncEngine {
  private _game: Game;
  /**
   * The in-place fresh-game GENERATION (N.2 rematch; see {@link SyncMessage.epoch}).
   * Starts at 0 for the first game; {@link resetGame} increments it when both peers
   * reset to a fresh game over the SAME connection. Stamped on every published sync
   * message and compared on receive so a seamless reset converges and a stale
   * prior-generation message can never re-adopt the finished board.
   */
  private _epoch = 0;
  private readonly transport: Transport;
  private readonly db: IDBDatabase;
  private readonly meta: MetaProvider;
  private readonly size: number;
  /**
   * This client's own seat color — the basis of the restricted-undo rule. NOT readonly:
   * an in-place rematch reset ({@link resetGame}) ALTERNATES colors (N.2 decision 2), so
   * this client's seat changes with the fresh game and the undo rule must follow it.
   */
  private myColor: Player;
  private _status: SyncStatus = { kind: 'ok' };
  private _conflict: { mine: EventLog; theirs: EventLog } | null = null;
  /** The in-flight conflict-archival write, if any (for {@link whenSettled}). */
  private _archiving: Promise<void> = Promise.resolve();
  /** Subscribers notified after every game mutation (local move OR remote adopt/conflict). */
  private readonly changeListeners = new Set<() => void>();
  /**
   * Emitter for inbound OUT-OF-BAND handshake messages (`'proposal'` / `'response'`) — the seam the
   * N.1 handshake state machine (#12/#18) subscribes via {@link onMessage}. Kept separate from the
   * sync path so a proposal never touches the append-only move-log.
   */
  private readonly messages: Emitter<ProposalMessage | ResponseMessage> = createEmitter();
  /**
   * Emitter for inbound ADMISSION messages (`'hello'` / `'admit'` / `'reject'`) — the room-ENTRY
   * seam the S.5 session subscribes via {@link onAdmission}. Deliberately separate from the
   * in-game {@link messages} handshake seam so an entry negotiation can never be conflated with a
   * rematch/undo ask, and never touches the append-only move-log.
   */
  private readonly admission: Emitter<AdmissionMessage> = createEmitter();
  /**
   * Dedups inbound ADMISSION messages by their unique `id`: a re-delivered / replayed admission
   * message is dropped so a stale proposal never replays (design §Guardrails: non-retained +
   * id-deduped). Sync messages are NOT deduped here — their replay-safety is intrinsic to the
   * append-only log's prefix/hash decision, a different mechanism for a different concern.
   */
  private readonly admissionDedup = new AdmissionDeduper();

  /**
   * @param game The initial local game (usually fresh; may already hold moves).
   * @param transport The room transport (already-constructed; `connect` is called
   *   by {@link connect}).
   * @param db The IndexedDB handle used to archive a conflicted game.
   * @param meta Supplies archive metadata lazily, only if a conflict occurs.
   * @param myColor This client's own seat color (from the seat manager). It gates
   *   the restricted networked undo: only the player who made the last move may
   *   undo it.
   */
  constructor(
    game: Game,
    transport: Transport,
    db: IDBDatabase,
    meta: MetaProvider,
    myColor: Player,
  ) {
    this._game = game;
    this.transport = transport;
    this.db = db;
    this.meta = meta;
    this.size = game.state().size;
    this.myColor = myColor;
  }

  /** The live game (its log is the canonical, syncable source of truth). */
  game(): Game {
    return this._game;
  }

  /**
   * Subscribe to game changes — fired after EVERY mutation of the wrapped game, whether from a
   * local {@link place} / {@link undo} or from adopting a peer's log / detecting a conflict on
   * {@link receive}. This is the seam the app-level session wires so a REMOTE move re-renders the
   * scene: without it, the transport pump mutates `_game` silently and the rendered board goes
   * stale (the core issue #4 "no resync" gap). Returns an unsubscribe fn.
   */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /** Notify every change subscriber (after a local or remote game mutation). */
  private emitChange(): void {
    for (const listener of this.changeListeners) listener();
  }

  /** The engine status — `ok`, or `conflict` once a fork stops the game. */
  status(): SyncStatus {
    return this._status;
  }

  /**
   * Connect the transport to `roomCode`, wire the inbound handler, then publish our
   * current log so a peer already in the room converges onto (or forks from) us.
   */
  async connect(roomCode: string): Promise<void> {
    this.transport.onMessage((raw) => this.onTransportMessage(raw));
    await this.transport.connect(roomCode);
    this.publishState();
  }

  /**
   * ATTACH this engine to an ALREADY-CONNECTED transport (S.5 admission adopt): (re)register the
   * inbound message pump so THIS engine receives subsequent room traffic, then publish our current
   * log so the peer converges. The non-async half of {@link connect} without the `transport.connect`
   * — for when a session ADOPTS an authoritative game (a different genesis uuid) over a live transport
   * by swapping in a fresh engine: the transport's `onMessage` still points at the OLD engine until
   * this re-registers it (the "latest registration wins" transport contract), so a move arriving after
   * the adopt would otherwise be delivered to the discarded engine and never render. Idempotent.
   */
  attach(): void {
    this.transport.onMessage((raw) => this.onTransportMessage(raw));
    this.publishState();
  }

  /**
   * Place the current player's piece at `coords` as a real, synced move: apply it
   * locally, then publish the full log. Refused once the game is stopped by a
   * conflict.
   *
   * @throws if the game is stopped by a conflict, or if the move is illegal
   *   (propagated verbatim from the core `Game`).
   */
  place(coords: Coord): void {
    this.assertLive();
    this._game.place(coords);
    this.publishState();
    this.emitChange();
  }

  /**
   * Undo this client's **own last move** as a real, synced action, then publish
   * the extended log so the peer adopts it and steps back too.
   *
   * The restriction is enforced by the pure {@link decideUndo}: undo is refused
   * (a {@link SyncError} is thrown, and **no** `undo` event is appended or
   * published) unless there is a committed move to undo *and* the player who made
   * it is this client (`myColor`). This is the restricted networked-undo rule
   * (game-core design Part 3): a client only emits `undo` for its own last move;
   * shared cooperative undo is the deferred alternative.
   *
   * On success the `undo` is an appended event (never a truncation): the log
   * grows, the peer sees a strict extension of its history and adopts it, and both
   * sides fold the `undo` to step their cursor back — convergence by the same
   * prefix/hash path as any move.
   *
   * @throws {SyncError} if the game is stopped by a conflict, or if the undo is
   *   not permitted (nothing to undo / not this client's move). The reason is in
   *   the message. Refused undos leave the game and log untouched.
   */
  undo(): void {
    this.assertLive();
    const decision = decideUndo(this._game.state(), this._game.ply(), this.myColor);
    if (!decision.ok) {
      throw new SyncError(
        decision.reason === 'nothing-to-undo'
          ? 'cannot undo: nothing-to-undo'
          : 'cannot undo: not-your-move (a client may only undo its own last move)',
      );
    }
    this._game.undo();
    this.publishState();
    this.emitChange();
  }

  /**
   * Re-apply this client's **own** previously-undone move as a real, synced action (the mirror of
   * {@link undo}), then publish the extended log so the peer adopts it and steps forward too.
   *
   * This is the APPLY half of the #18 mutual-confirm REDO: it is called only after BOTH clients have
   * accepted the out-of-band `'redo'` proposal (the handshake holds the ask out-of-band; nothing is
   * appended here until that mutual accept). Like {@link undo}, a `redo` is an appended EVENT (never a
   * truncation): the log grows, the peer sees a strict extension and adopts it, and both sides fold the
   * `redo` to step their cursor forward — convergence by the same prefix/hash path as any move.
   *
   * The permission (only the player whose undone move is being re-applied may redo — the pure
   * {@link decideRedo} in `undoRedo.ts`) is enforced UPSTREAM by the session before it proposes, exactly
   * as {@link undo}'s {@link decideUndo} gate is applied before an undo is proposed. Here the raw core
   * `redo` is called; it throws {@link IllegalMove} verbatim if there is no redo tail, and the error
   * propagates honestly (never a masked no-op).
   *
   * @throws if the game is stopped by a conflict ({@link SyncError}), or if there is nothing to redo
   *   (the core `Game.redo`'s `IllegalMove`, propagated verbatim).
   */
  /**
   * Apply an AGREED undo — step the last committed move back UNCONDITIONALLY (no per-seat restriction)
   * — then publish so the peer adopts the strict extension and steps back too. This is the APPLY half
   * of the #18 mutual-confirm UNDO, invoked on BOTH clients only after the out-of-band `'undo'`
   * handshake resolved to `accepted`.
   *
   * It deliberately does NOT apply {@link decideUndo}'s restricted last-mover-only rule the way
   * {@link undo} does: that rule gates who may *propose* an undo (enforced upstream by the session's
   * `canProposeUndo` before an ask is raised). Once BOTH players have agreed, the last move is stepped
   * back on each side regardless of which seat this client holds — otherwise the RESPONDER (whose seat
   * is NOT the last mover's) would refuse to apply the undo it just accepted, and the two boards would
   * diverge. The core `Game.undo` is unrestricted (it steps the cursor); this wraps it with the
   * publish/notify so both peers converge one step back by the same prefix/hash path as any move.
   *
   * @throws if the game is stopped by a conflict ({@link SyncError}), or if there is nothing to undo
   *   (the core `Game.undo`'s `IllegalMove`, propagated verbatim — never masked).
   */
  applyAgreedUndo(): void {
    this.assertLive();
    this._game.undo();
    this.publishState();
    this.emitChange();
  }

  /**
   * Apply an AGREED redo — re-apply the last-undone move UNCONDITIONALLY — then publish so the peer
   * adopts it and steps forward too. The APPLY half of the #18 mutual-confirm REDO, invoked on BOTH
   * clients only after the out-of-band `'redo'` handshake resolved to `accepted`. Like
   * {@link applyAgreedUndo} it applies no per-seat restriction (who may *propose* a redo is gated
   * upstream by the session's `canProposeRedo`); once both agreed, each side re-applies the move so the
   * two boards converge one step forward.
   *
   * @throws if the game is stopped by a conflict ({@link SyncError}), or if there is nothing to redo
   *   (the core `Game.redo`'s `IllegalMove`, propagated verbatim).
   */
  redo(): void {
    this.assertLive();
    this._game.redo();
    this.publishState();
    this.emitChange();
  }

  /**
   * Apply a local move **without** publishing — used to construct a divergent
   * history in tests and by callers that batch a publish. Still refused once
   * stopped.
   */
  placeLocalOnly(coords: Coord): void {
    this.assertLive();
    this._game.place(coords);
  }

  /** Publish our current full log to the room (idempotent; safe to call anytime). */
  publishState(): void {
    this.transport.publish(toSyncMessage(this._game.log, this._epoch) as TransportMessage);
  }

  /** The current fresh-game {@link _epoch} (0 for the first game; incremented per {@link resetGame}). */
  epoch(): number {
    return this._epoch;
  }

  /**
   * Reset to a FRESH game IN PLACE, over the SAME transport — the N.2 seamless rematch
   * (design decision 2: "both reset to a fresh game in the same room/connection — no
   * disconnect/re-host"). Swaps in `newGame` (a fresh, empty {@link Game}), BUMPS the
   * fresh-game {@link _epoch}, publishes the new (empty) log stamped with that higher
   * epoch so the peer adopts the fresh generation, and notifies change subscribers so
   * the scene re-renders the empty board.
   *
   * The epoch bump is what makes this converge without a disconnect: the peer — which
   * either reset independently on the same accepted rematch (also bumping to the same
   * epoch) or is still on the old game — sees a HIGHER-or-equal epoch and adopts the
   * fresh game rather than forking on the non-extending empty log. Any late in-flight
   * message from the just-finished (lower-epoch) game is ignored by the same rule, so
   * the finished board can never resurrect over the reset.
   *
   * @param newGame The fresh game to run the rematch in (its log becomes canonical).
   * @param newMyColor This client's seat color in the fresh game — colors ALTERNATE on
   *   a rematch (N.2 decision 2), so the restricted-undo rule ({@link myColor}) is
   *   re-based onto the swapped seat.
   * @throws {SyncError} if the game is stopped by a conflict — a forked, stopped game
   *   exchanges no further traffic, rematch reset included ({@link assertLive}).
   */
  resetGame(newGame: Game, newMyColor: Player): void {
    this.assertLive();
    this._game = newGame;
    this.myColor = newMyColor;
    this._epoch += 1;
    this.publishState();
    this.emitChange();
  }

  /**
   * Publish an OUT-OF-BAND handshake message (a `'proposal'` or `'response'`) to the room over the
   * SAME transport the sync path uses (N.1 glue for #12/#18). It is emphatically NOT a sync message:
   * it is never appended to the append-only move-log and never enters the retained `/state` snapshot —
   * the transport's `publish` writes the NON-RETAINED `/events` topic, so a reconnecting peer never
   * replays a stale proposal from a retained slot (the unique-id dedup in the handshake state machine
   * covers any at-least-once re-delivery). Separate from {@link publishState} so a proposal and a log
   * publish can never be conflated, and so the move-log publish path is untouched.
   *
   * Refused once a conflict has stopped the game ({@link assertLive}): a stopped game exchanges no
   * further traffic of any kind, handshake included.
   */
  publishHandshake(msg: ProposalMessage | ResponseMessage): void {
    this.assertLive();
    this.transport.publish(msg as TransportMessage);
  }

  /**
   * Apply a received {@link SyncMessage} through the pure decision. Public so tests
   * (and out-of-order replay scenarios) can inject messages directly; the transport
   * handler routes through here too.
   *
   * Once a conflict has stopped the game the inbound path is **frozen**: a stopped
   * game neither adopts a strict extension nor re-conflicts — the fork is already
   * archived and the game is over, so a later message (from the transport pump OR a
   * direct caller) must NOT mutate the supposedly-frozen game. This guard lives here,
   * on the single state-mutating entry point, rather than only at the transport pump,
   * so the invariant holds for every caller (agent-principles: keep the tripwire;
   * errors/invariants must not be bypassed via a public seam).
   */
  receive(msg: SyncMessage): void {
    if (this._status.kind === 'conflict') return;
    const remote = parseSyncMessage(msg);
    // A missing/garbage epoch on the wire (a pre-epoch peer, or a directly-injected message on this
    // public seam) reads as generation 0 via the SAME normalizer the codec uses, so an un-upgraded
    // peer's first game still converges and the two epoch reads can never disagree.
    const remoteEpoch = normalizeEpoch(msg.epoch);
    const decision = decideSyncEpoched(this._epoch, this._game.log, remoteEpoch, remote);
    switch (decision.action) {
      case 'ignore':
        // Stale / replay — INCLUDING a message from a SUPERSEDED epoch (a late in-flight publish
        // from the just-finished game after an in-place rematch reset): the game did not change, so
        // no listener fires (a spurious re-render on an ignored replay would be a lie about state
        // changing — keep the notification truthful). This is what stops the finished board from
        // resurrecting over the fresh rematch game.
        return;
      case 'adopt':
        // Adopt the peer's log as the new authoritative game, then notify so the scene re-renders
        // (the issue #4 resync link). ACROSS a higher remote epoch this adopts the peer's FRESH
        // rematch game (it reset first) and advances our generation to match, so we never fork on
        // the non-extending empty log and both sides settle on the same epoch.
        this._epoch = Math.max(this._epoch, remoteEpoch);
        this._game = Game.fromLog(this.size, remote);
        this.emitChange();
        return;
      case 'conflict':
        // The logs forked WITHIN the same epoch and the game is stopped: archive both forks and
        // notify so the UI reflects the stopped/conflicted state (the phase flips synchronously
        // inside onConflict). A cross-epoch difference is never a conflict — it is a generation
        // change, handled by adopt/ignore above.
        this._archiving = this.onConflict(remote, decision.divergePly);
        this.emitChange();
        return;
    }
  }

  /**
   * Subscribe to inbound NON-sync {@link GameMessage}s (currently `'proposal'` /
   * `'response'`) as they arrive over the transport — the seam the out-of-band
   * handshake state machine wires (N.1 consumers #12/#18). Returns an unsubscribe
   * fn. `'sync'` messages are NOT delivered here: they are applied to the game log
   * through {@link receive}, never handed to the handshake, so the two concerns stay
   * separate.
   */
  onMessage(listener: (msg: ProposalMessage | ResponseMessage) => void): () => void {
    return this.messages.subscribe(listener);
  }

  /**
   * Subscribe to inbound ADMISSION messages (`'hello'` / `'admit'` / `'reject'`) as they arrive
   * over the transport — the room-ENTRY seam the S.5 session wires to run the admission protocol
   * (design §4). Returns an unsubscribe fn. Only FRESH messages are delivered: a re-seen `id` is
   * dropped by the {@link admissionDedup} at the pump, so a subscriber never handles a replayed /
   * stale proposal. Kept separate from {@link onMessage} (the in-game handshake) and from
   * {@link receive} (the sync log) so the three concerns stay independent.
   */
  onAdmission(listener: (msg: AdmissionMessage) => void): () => void {
    return this.admission.subscribe(listener);
  }

  /**
   * Transport message pump: VALIDATE the raw payload into a typed
   * {@link GameMessage} (never a blind cast), then route by kind. A `'sync'`
   * message goes through the guarded, replay-safe {@link receive}; a `'proposal'` /
   * `'response'` is emitted to {@link onMessage} subscribers so the out-of-band
   * handshake (never the append-only log) handles it; a `'hello'` / `'admit'` /
   * `'reject'` ADMISSION message is DEDUPED by id and, only if fresh, emitted to
   * {@link onAdmission} subscribers (a replayed/stale admission message is dropped).
   * A malformed / unknown-kind payload throws a {@link SyncError} out of
   * {@link parseGameMessage} — it is NOT silently dropped.
   */
  private onTransportMessage(raw: TransportMessage): void {
    const msg = parseGameMessage(raw);
    switch (msg.kind) {
      case 'sync':
        this.receive(msg);
        return;
      case 'proposal':
      case 'response':
        // Out-of-band in-game handshake, never touches the move-log. Deliver to the
        // handshake seam (the N.1 consumers subscribe via onMessage).
        this.messages.emit(msg);
        return;
      case 'hello':
      case 'admit':
      case 'reject':
        // Admission (room entry): dedup by id so a replayed/stale message never re-fires, then
        // deliver only a FRESH one to the onAdmission seam. Never touches the move-log.
        if (this.admissionDedup.fresh(msg.id)) {
          this.admission.emit(msg);
        }
        return;
    }
  }

  /**
   * Handle a fork: archive both logs flagged `conflicted`, record the conflict
   * status (with the archive id + diverge ply), and stop the game. Archiving is
   * best-effort-durable; the status flips synchronously so the game stops
   * immediately even before the async write settles.
   */
  private async onConflict(theirs: EventLog, divergePly: number): Promise<void> {
    const mine = this._game.log;
    this._conflict = { mine, theirs };
    const conflictId = `conflict-${headHash(mine)}-${headHash(theirs)}`;
    this._status = { kind: 'conflict', conflictId, divergePly };
    const meta: ArchivedMeta = { ...this.meta(), result: 'conflicted' };
    await flagConflicted(this.db, conflictId, {
      mineLog: mine,
      theirsLog: theirs,
      meta,
      size: this.size,
    });
  }

  /** The two forked logs once a conflict has stopped the game, else `null`. */
  conflictForks(): { readonly mine: EventLog; readonly theirs: EventLog } | null {
    return this._conflict;
  }

  /**
   * Resolve once any in-flight conflict archival write has settled — so a caller
   * (or test) can deterministically read the conflicted record back after a fork,
   * without racing the async archive write.
   */
  async whenSettled(): Promise<void> {
    await this._archiving;
  }

  /** Throw if the game has been stopped by a conflict. */
  private assertLive(): void {
    if (this._status.kind === 'conflict') {
      throw new SyncError('game stopped: unresolved conflict');
    }
  }
}
