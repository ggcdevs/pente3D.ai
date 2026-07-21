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

/** The sync wire-format version. Bumped only on a breaking message-shape change. */
export const SYNC_VERSION = 1 as const;

/**
 * The outbound/inbound sync message: the **full** event log plus a version tag and
 * the sender's `headHash` (a cheap integrity check the receiver re-verifies against
 * the log it reconstructs). The `log` is plain events (JSON-cloneable), matching the
 * archive/export form.
 */
export interface SyncMessage {
  /** Wire-format version (must equal {@link SYNC_VERSION}). */
  readonly version: number;
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
 * The networked wire message as a DISCRIMINATED UNION on `kind`:
 *
 *   - `'sync'`     — the existing full-log sync payload ({@link SyncMessage} fields),
 *                    unchanged on the wire except for the added `kind` tag.
 *   - `'proposal'` — an out-of-band ask ({@link ProposalMessage}).
 *   - `'response'` — the accept/decline of a proposal ({@link ResponseMessage}).
 *
 * Every message crossing the transport is one of these; {@link parseGameMessage}
 * validates the shape and narrows the kind before anything acts on it.
 */
export type GameMessage =
  | ({ readonly kind: 'sync' } & SyncMessage)
  | ProposalMessage
  | ResponseMessage;

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
    return { kind: 'sync', version: rec.version as number, headHash: rec.headHash as string, log: rec.log as readonly Event[] };
  }
  switch (kind) {
    case 'sync': {
      if (!looksLikeSync(rec)) {
        throw new SyncError('sync message requires numeric version, string headHash, and array log');
      }
      return { kind: 'sync', version: rec.version as number, headHash: rec.headHash as string, log: rec.log as readonly Event[] };
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
    typeof rec.headHash === 'string' &&
    Array.isArray(rec.log)
  );
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
export function toSyncMessage(log: EventLog): { readonly kind: 'sync' } & SyncMessage {
  return {
    kind: 'sync',
    version: SYNC_VERSION,
    headHash: headHash(log),
    log: log.entries.map((entry) => entry.event),
  };
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
  let log: EventLog = emptyLog();
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
 * receipt it runs {@link decideSync}; `adopt` replaces the local game with the
 * remote log, `ignore` is a no-op, and `conflict` archives both forks via
 * {@link flagConflicted}, flips {@link status} to `conflict`, and refuses all
 * further local moves (the game is stopped).
 */
export class SyncEngine {
  private _game: Game;
  private readonly transport: Transport;
  private readonly db: IDBDatabase;
  private readonly meta: MetaProvider;
  private readonly size: number;
  /** This client's own seat color — the basis of the restricted-undo rule. */
  private readonly myColor: Player;
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
    this.transport.publish(toSyncMessage(this._game.log) as TransportMessage);
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
    const decision = decideSync(this._game.log, remote);
    switch (decision.action) {
      case 'ignore':
        // Stale / replay: the game did not change, so no listener fires (a spurious re-render on an
        // ignored replay would be a lie about state changing — keep the notification truthful).
        return;
      case 'adopt':
        // Adopt the peer's strict extension as the new authoritative game, then notify so the
        // scene re-renders the REMOTE move (the issue #4 resync link).
        this._game = Game.fromLog(this.size, remote);
        this.emitChange();
        return;
      case 'conflict':
        // The logs forked and the game is stopped: archive both forks and notify so the UI reflects
        // the stopped/conflicted state (the phase flips synchronously inside onConflict).
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
   * Transport message pump: VALIDATE the raw payload into a typed
   * {@link GameMessage} (never a blind cast), then route by kind. A `'sync'`
   * message goes through the guarded, replay-safe {@link receive}; a `'proposal'` /
   * `'response'` is emitted to {@link onMessage} subscribers so the out-of-band
   * handshake (never the append-only log) handles it. A malformed / unknown-kind
   * payload throws a {@link SyncError} out of {@link parseGameMessage} — it is NOT
   * silently dropped.
   */
  private onTransportMessage(raw: TransportMessage): void {
    const msg = parseGameMessage(raw);
    if (msg.kind === 'sync') {
      this.receive(msg);
      return;
    }
    // 'proposal' | 'response': out-of-band, never touches the move-log. Deliver to the
    // handshake seam (the N.1 consumers subscribe via onMessage).
    this.messages.emit(msg);
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
