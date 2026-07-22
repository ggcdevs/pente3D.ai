/**
 * Networking session (Task 5.5) — the app-level IO orchestration that wires the Stage 3
 * {@link SyncEngine} + the seat manager ({@link claimSeat}) behind a single, plain, subscribable
 * {@link NetSessionState} the networking widget (`src/ui/widgets/net.ts`) renders.
 *
 * ## What this is (and is not)
 *
 * This is the **IO glue** that host/join drive: it generates a room code (host), CLAIMS a seat
 * (seat manager), constructs a {@link SyncEngine} over an INJECTED {@link Transport}, connects it,
 * and tracks peer presence + the engine's conflict status — projecting all of that into the plain
 * {@link NetSessionState}. It touches the transport, an `IDBDatabase`, and a clock, so — exactly
 * like `scene.ts` / the DOM widgets — it is the **Playwright-verified IO boundary**, NOT mutation-
 * gated. The PURE parts it stands on are unit+mutation-gated in their own units: {@link SyncEngine}
 * / {@link decideSync} (`sync.ts`), {@link claimSeat} (`seats.ts`), and the view derivation +
 * code validation (`src/ui/widgets/netModel.ts`).
 *
 * The transport is injected (a `() => Transport` factory) so the app supplies the real
 * {@link MqttTransport} while a test supplies a {@link MockTransport} — a host and a join on a
 * shared {@link MockRelayHub} then exchange REAL sync messages and see each other's presence, so a
 * test asserts on the *other* client actually connecting, never on a log line (agent-principles #3).
 *
 * ## Seat model — v1 scope (stated, not disguised)
 *
 * v1 uses a **local, position-derived** seat assignment: the host takes white, a joiner takes
 * black, each via a genuine {@link claimSeat} against the session's seat-map view (so the identity-
 * owned reclaim + `room-full` rejection logic is exercised, not bypassed). A fully-negotiated
 * seat-map-over-the-relay handshake (two joiners racing the same seat; reclaim after a refresh via a
 * retained shared seat map) is the documented `seats.ts` deferred seam — it drops onto this same
 * `playerId` + `claimSeat` foundation without a rewrite. `TODO(shared-seat-map)`: negotiate the seat
 * map over a retained transport channel instead of assigning by host/join role.
 */

import { Game } from '../core/game';
import type { Coord } from '../core/coords';
import type { GameState, Player } from '../core/gameState';
import type { ArchivedMeta } from '../persist/archive';
import type { Transport } from './transport';
import { SyncEngine } from './sync';
import {
  initialHandshake,
  propose as hsPropose,
  respond as hsRespond,
  receiveProposal,
  receiveResponse,
  onGameAdvanced,
  onPeerGone,
  clearResolution,
  incomingPending,
  type HandshakeState,
} from './handshake';
import { claimSeat, emptySeatMap, seatOf, type SeatColor, type SeatMap } from './seats';
import { alternateSeats } from './endState';
import { canPlaceForSeat } from './turnGate';
import {
  generateGameCode,
  validateGameCode,
  normalizeGameCode,
  type NetPhase,
  type NetSeat,
  type NetSessionState,
  type JoinErrorReason,
} from '../ui/widgets/netModel';

/**
 * Dependencies a {@link NetSession} needs, all injected so it is testable without a live relay:
 * the transport factory (real MQTT in the app, a mock in tests), the archive DB the SyncEngine
 * writes a conflicted game to, this browser's stable `playerId` (owns a seat; GLOSSARY "playerId"),
 * the board size to build the game at, and injectable `rand`/`now` for a deterministic code + meta.
 */
export interface NetSessionDeps {
  /** Build a fresh transport for a room (real `MqttTransport`, or a `MockTransport` in tests). */
  createTransport(): Transport;
  /** The archive DB handle the SyncEngine flags a conflicted game into. */
  readonly db: IDBDatabase;
  /** This browser's stable playerId (owns a seat across reconnects; GLOSSARY "playerId"). */
  readonly playerId: string;
  /** The board edge length the networked game is built at. */
  readonly size: number;
  /** RNG for the host game code (inject `Math.random`; a fixed fn makes a test deterministic). */
  rand?: () => number;
  /** Clock for the archived-meta `startedAt` (inject `Date.now`). */
  now?: () => number;
}

/** Notified after every session-state change, so the UI shell can repaint the widget. */
export type NetChangeListener = (state: NetSessionState) => void;

/**
 * Notified after every OUT-OF-BAND handshake-state change (N.1: a proposal raised, a response
 * received, an auto-cancel), so the UI (#12 rematch overlay / #18 undo prompt) can react to an
 * incoming ask or the resolution of an outgoing one. Receives the fresh immutable {@link HandshakeState}.
 */
export type HandshakeChangeListener = (state: HandshakeState) => void;

/**
 * A live networking session. Starts `offline`; {@link host} generates a code and connects as white,
 * {@link join} validates a code and connects as black. Exposes the plain {@link NetSessionState}
 * via {@link state} and change notifications via {@link onChange}. The move/undo path delegates to
 * the wrapped {@link SyncEngine} once connected.
 */
export class NetSession {
  private readonly deps: Required<Pick<NetSessionDeps, 'rand' | 'now'>> & NetSessionDeps;
  private readonly listeners = new Set<NetChangeListener>();
  /** Subscribers to the OUT-OF-BAND handshake state (N.1: #12 rematch / #18 undo-redo). */
  private readonly handshakeListeners = new Set<HandshakeChangeListener>();

  private phase: NetPhase = 'offline';
  private code: string | null = null;
  private seat: NetSeat = null;
  private peerPresent = false;
  private joinError: JoinErrorReason | null = null;

  private engine: SyncEngine | null = null;
  private transport: Transport | null = null;

  /**
   * The OUT-OF-BAND ask/accept handshake state (N.1). Held here in session memory — NEVER appended to
   * the engine's append-only move-log — so a rejected/withdrawn proposal leaves no trace (design
   * guardrail). Immutable value; every transition swaps in a fresh one via {@link setHandshake}.
   */
  private handshake: HandshakeState = initialHandshake();

  constructor(deps: NetSessionDeps) {
    this.deps = {
      ...deps,
      rand: deps.rand ?? Math.random,
      now: deps.now ?? Date.now,
    };
  }

  /** The current plain, serializable session readout (what the widget renders). */
  state(): NetSessionState {
    return {
      phase: this.phase,
      code: this.code,
      seat: this.seat,
      peerPresent: this.peerPresent,
      joinError: this.joinError,
    };
  }

  /** Subscribe to session-state changes; returns an unsubscribe fn. */
  onChange(listener: NetChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Host a new game and claim the white seat: create the room `rawCode` names, or — when no code (or
   * an INVALID one) is supplied — a freshly-generated one. This is the "create THIS room" half of the
   * issue #13 picker (custom / saved / random), where the user's chosen code IS the room; the
   * argument-free generate path stays as the fallback for a caller that has no code to offer. The
   * supplied code is validated + canonicalized by the SAME {@link validateGameCode} the join path
   * uses (so host and join can never disagree on a legal code), and an invalid/absent code degrades
   * to a generated one rather than refusing to host. Resolves once connected (or leaves the session
   * in an error state if the connect fails). A no-op if a session is already live.
   *
   * @param rawCode The chosen room code (any case / whitespace), or omitted/invalid to generate one.
   */
  async host(rawCode?: string): Promise<void> {
    if (this.phase !== 'offline') return;
    const chosen = rawCode === undefined ? null : validateGameCode(rawCode);
    const code = chosen !== null && chosen.ok ? chosen.code : generateGameCode(this.deps.rand);
    await this.start(code, 'white');
  }

  /**
   * Join an existing game by code. The code is validated first (pure {@link validateGameCode}); an
   * invalid code is refused HERE without touching the transport (the widget also validates before
   * dispatching, so this is the defensive backstop). A valid code connects and claims the black
   * seat. A no-op if a session is already live.
   *
   * @returns `true` if a join was attempted (code valid), `false` if the code was rejected.
   */
  async join(rawCode: string): Promise<boolean> {
    if (this.phase !== 'offline') return false;
    const validation = validateGameCode(rawCode);
    if (!validation.ok) return false;
    await this.start(validation.code, 'black');
    return true;
  }

  /**
   * Shared host/join startup: claim `preferredColor`'s seat, build the game + SyncEngine over a
   * fresh transport, wire presence + the connect, and connect to `code`. On a connect failure the
   * phase flips back to `offline` with a `connect-failed` join error (surfaced under the Join
   * input) — the error propagates into observable state, never swallowed silently.
   */
  private async start(code: string, preferredColor: SeatColor): Promise<void> {
    this.joinError = null;
    // Genuine seat claim against the session's seat-map view (identity-owned; see the class TODO on
    // the deferred shared-seat-map negotiation). `claimSeat` is first-available white-preferred, so
    // to seat a JOINER as black we present a map with white already taken by a placeholder "host"
    // owner; a HOST claims from the empty map and lands on white. Both roles thus go through the
    // real `claimSeat` (identity-owned reclaim + `room-full` logic exercised, not bypassed).
    const base: SeatMap =
      preferredColor === 'black' ? { white: HOST_PLACEHOLDER, black: null } : emptySeatMap();
    const claim = claimSeat(base, this.deps.playerId);
    if (!claim.ok) {
      this.joinError = 'room-full';
      this.emit();
      return;
    }
    this.seat = claim.color;
    this.code = normalizeGameCode(code);
    this.phase = 'connecting';
    this.emit();

    const transport = this.deps.createTransport();
    this.transport = transport;
    transport.onPresence((peers) => this.onPresence(peers));

    const game = new Game(this.deps.size);
    const meta = (): Omit<ArchivedMeta, 'result'> => ({
      players: { [claim.color]: this.deps.playerId },
      startedAt: this.deps.now(),
    });
    const engine = new SyncEngine(game, transport, this.deps.db, meta, claim.color as Player);
    this.engine = engine;
    // Reset the handshake for the new session — a fresh room has no pending proposal from a prior one.
    this.handshake = initialHandshake();
    // Re-emit on EVERY engine game change — crucially including a REMOTE move adopted by the
    // transport pump (which mutates the engine's game silently). This is the resync link that makes
    // a peer's move re-render the scene (issue #4): the app subscribes to the session's onChange and
    // adopts the session's authoritative game back into the rendered board. A conflict also folds the
    // engine status into the phase here, so the stopped/conflict state surfaces in the readout.
    //
    // AUTO-CANCEL on GAME-ADVANCED (N.1 guardrail): the authoritative game moved on (a local or a
    // REMOTE move landed, or a conflict stopped it), so any pending rematch/undo proposal is now stale
    // and is dropped out-of-band via the pure `onGameAdvanced`. `setHandshake` no-ops (and fires no
    // handshake listener) when nothing was pending, so an ordinary move with no proposal in flight is
    // unaffected. Done here — on the single engine-change seam — so BOTH sides drop a proposal the
    // instant the game advances, not only the mover's side.
    engine.onChange(() => {
      this.setHandshake(onGameAdvanced(this.handshake));
      this.reflectEngineStatus();
      this.emit();
    });
    // OUT-OF-BAND handshake inbound (N.1): the engine delivers only `'proposal'`/`'response'` here
    // (never `'sync'`, which stays on the move-log path), so feeding them to the pure state machine
    // keeps a proposal entirely off the append-only log. A duplicate proposal id is an idempotent
    // no-op (dedup); a response to our outgoing proposal resolves it. `setHandshake` fires the
    // handshake listeners only on a real change, so the UI reacts to an incoming ask / a resolution.
    engine.onMessage((msg) => {
      if (msg.kind === 'proposal') {
        this.setHandshake(receiveProposal(this.handshake, msg));
      } else {
        this.setHandshake(receiveResponse(this.handshake, msg));
      }
    });

    try {
      await engine.connect(this.code);
    } catch {
      // Connect failed — surface it in observable state (an honest error, not a swallowed one) and
      // return to offline so the user can retry with the same or a different code.
      transport.disconnect();
      this.phase = 'offline';
      this.seat = null;
      this.code = null;
      this.engine = null;
      this.transport = null;
      this.joinError = 'connect-failed';
      this.emit();
      return;
    }

    // Connected. The engine may already be in conflict if a diverging peer log arrived during
    // connect's initial publish/receive; reflect whatever the engine reports.
    this.reflectEngineStatus();
    if (this.phase === 'connecting') this.phase = 'connected';
    this.emit();
  }

  /** Place a synced move (delegates to the engine). Throws if offline or the engine refuses. */
  place(coords: Coord): void {
    this.requireEngine().place(coords);
    this.reflectEngineStatus();
    this.emit();
  }

  /** Undo this client's own last move (delegates to the engine's restricted undo). */
  undo(): void {
    this.requireEngine().undo();
    this.reflectEngineStatus();
    this.emit();
  }

  /**
   * Reset to a FRESH game IN PLACE — the N.2 seamless rematch (design decision 2: "both reset to a
   * fresh game in the SAME room/connection — no disconnect/re-host", "colors ALTERNATE every game").
   * Called by the app when the out-of-band rematch handshake RESOLVES to `accepted` on EITHER side.
   *
   * Unlike the earlier disconnect→re-host/re-join shortcut, this keeps the SAME transport and seat
   * ownership up (no present→absent presence flicker to the peer, no reconnect race): it just
   *
   *   1. ALTERNATES this client's seat deterministically ({@link alternateSeats} via {@link seatOf}) —
   *      each side derives its NEW color from its OWN current one, so the swap needs no coordination;
   *   2. swaps a fresh empty {@link Game} into the live {@link SyncEngine} and BUMPS its fresh-game
   *      epoch ({@link SyncEngine.resetGame}), which publishes the fresh log over the existing
   *      connection so the peer adopts the new generation and any stale finished-game message is
   *      ignored by epoch — the convergence the seamless reset turns on.
   *
   * A no-op returning `false` when there is no live engine/seat (offline) — there is no game to reset.
   * The handshake is cleared afterwards so the just-resolved rematch cannot re-fire and the next
   * game starts from an idle handshake.
   *
   * @returns `true` if the in-place reset ran, `false` if not connected/seated.
   */
  resetForRematch(): boolean {
    if (this.engine === null || this.seat === null) return false;
    const me = this.deps.playerId;
    // Alternate THIS client's seat from its own current color (deterministic; no peer coordination).
    const swapped = alternateSeats(
      this.seat === 'white' ? { white: me, black: null } : { white: null, black: me },
    );
    const nextColor = seatOf(swapped, me) ?? this.seat;
    this.seat = nextColor;
    // Swap a fresh empty game into the live engine over the SAME transport, re-basing the undo rule
    // onto the swapped color and bumping the epoch so the peer adopts the fresh generation.
    this.engine.resetGame(new Game(this.deps.size), nextColor as Player);
    // The rematch resolved and has now been applied — clear it so it cannot re-fire and the fresh
    // game starts from an idle handshake.
    this.handshake = clearResolution(this.handshake);
    this.reflectEngineStatus();
    this.emit();
    return true;
  }

  // ── Out-of-band handshake API (N.1: shared ask/accept primitive for #12 / #18) ──────────────────

  /** The current OUT-OF-BAND handshake state (pending proposal + last resolution), a plain value. */
  getHandshake(): HandshakeState {
    return this.handshake;
  }

  /** Subscribe to handshake-state changes (incoming ask / resolution / auto-cancel). Unsub fn. */
  onHandshakeChange(listener: HandshakeChangeListener): () => void {
    this.handshakeListeners.add(listener);
    return () => this.handshakeListeners.delete(listener);
  }

  /**
   * Raise an OUTGOING proposal for the opaque `action` (`'rematch' | 'undo' | 'redo' | …`, N.1
   * consumers give it meaning), seated as this client's own color: mint it via the pure
   * {@link hsPropose}, set the outgoing-pending state, and PUBLISH the {@link ProposalMessage}
   * NON-RETAINED over the transport so the peer receives it (out-of-band — it never touches the
   * move-log). A new proposal supersedes any prior pending one (the at-most-one rule lives in the
   * state machine). A no-op returning `false` when there is no live seat/engine (offline): there is
   * no room to publish into, so a proposal cannot be raised.
   *
   * @returns `true` if the proposal was raised + published, `false` if not connected/seated.
   */
  propose(action: string): boolean {
    if (this.engine === null || this.seat === null) return false;
    const { state, message } = hsPropose(this.handshake, action, this.seat as Player);
    // Publish first: if the transport refuses (e.g. a conflict stopped the game), the throw propagates
    // and the pending state is NOT set — the handshake and the publish never disagree about an ask.
    this.engine.publishHandshake(message);
    this.setHandshake(state);
    return true;
  }

  /**
   * Respond to the INCOMING pending proposal — accept or decline — via the pure {@link hsRespond}:
   * resolve the pending slot (recording the {@link Resolution} the consumer reads) and PUBLISH the
   * {@link ResponseMessage} back to the proposer so their outgoing proposal resolves too. Out-of-band
   * throughout — no move-log write. A no-op returning `false` when there is nothing valid to answer
   * (no incoming proposal, or offline): the state machine yields no message, so nothing is published.
   *
   * @returns `true` if a response was published, `false` if there was nothing to respond to.
   */
  respond(accepted: boolean): boolean {
    if (this.engine === null) return false;
    const incoming = incomingPending(this.handshake);
    if (incoming === null) return false;
    const { state, message } = hsRespond(this.handshake, incoming.id, accepted);
    if (message === null) return false;
    this.engine.publishHandshake(message);
    this.setHandshake(state);
    return true;
  }

  /**
   * Whether this client may place right now (Task 6.2, issue #4c): the pure {@link canPlaceForSeat}
   * gate over this client's claimed seat + whose turn it is in the authoritative game. `true` on the
   * local seat's turn, `false` on the opponent's — so the scene can block an out-of-seat-order move
   * and show a subtle cue instead of pushing it onto the shared log. With no live game (offline) there
   * is no turn to enforce and this is `true` (the scene only consults it for a live networked game).
   */
  canPlace(): boolean {
    if (this.engine === null) return true;
    return canPlaceForSeat(this.seat, this.engine.game().state().turn);
  }

  /** The wrapped SyncEngine, for the scene to read its `Game`/state once connected, or null. */
  syncEngine(): SyncEngine | null {
    return this.engine;
  }

  /**
   * The authoritative game state to RENDER while a session is live (Task 6.1, issue #4): the wrapped
   * engine's current game state, or `null` when there is no engine (offline). This is the ONE game
   * per session — the app adopts it into the scene on every session change, so both the local and the
   * remote move render from the same source of truth instead of a disconnected scene-local game.
   */
  gameState(): GameState | null {
    return this.engine === null ? null : this.engine.game().state();
  }

  /**
   * Leave the room and return to `offline`: disconnect the transport and drop the engine/seat. A
   * no-op while already offline. Idempotent (the transport's own `disconnect` is idempotent).
   */
  disconnect(): void {
    if (this.transport !== null) this.transport.disconnect();
    this.transport = null;
    this.engine = null;
    this.seat = null;
    this.code = null;
    this.peerPresent = false;
    this.joinError = null;
    this.phase = 'offline';
    // Leaving the room voids any out-of-band ask (there is no peer + no engine to complete it); reset
    // the handshake so a later re-host/re-join starts clean and never surfaces a stale proposal.
    this.setHandshake(initialHandshake());
    this.emit();
  }

  /** Presence handler: mark the peer present iff any peer OTHER than us is in the room. */
  private onPresence(peers: readonly string[]): void {
    const others = peers.filter((id) => id !== this.deps.playerId);
    const present = others.length > 0;
    if (present === this.peerPresent) return;
    // AUTO-CANCEL on PEER-GONE (N.1 guardrail): if the peer just DROPPED (present → absent), the
    // handshake can never complete (there is no one to accept our ask, and an incoming ask's proposer
    // is gone), so drop any pending proposal out-of-band via the pure `onPeerGone`. Only on the
    // present→absent edge — a peer ARRIVING must not clear a proposal. `setHandshake` no-ops when
    // nothing was pending. Evaluated before mutating `peerPresent` so the edge is unambiguous.
    if (this.peerPresent && !present) {
      this.setHandshake(onPeerGone(this.handshake));
    }
    this.peerPresent = present;
    this.emit();
  }

  /** Fold the engine's conflict status into the session phase (a fork stops the game). */
  private reflectEngineStatus(): void {
    if (this.engine !== null && this.engine.status().kind === 'conflict') {
      this.phase = 'conflict';
    }
  }

  private requireEngine(): SyncEngine {
    if (this.engine === null) throw new Error('net session: not connected');
    return this.engine;
  }

  private emit(): void {
    const snapshot = this.state();
    for (const listener of this.listeners) listener(snapshot);
  }

  /**
   * Swap in a new handshake state, notifying handshake subscribers ONLY when it actually changed
   * (referential inequality — every pure transition returns the SAME object when it is a no-op, e.g.
   * an auto-cancel with nothing pending or a deduped duplicate proposal). This keeps a spurious
   * "handshake changed" from firing on an ordinary move, and makes the notification an honest signal
   * of a real handshake transition (agent-principles: logs/signals state observed facts, not noise).
   */
  private setHandshake(next: HandshakeState): void {
    if (next === this.handshake) return;
    this.handshake = next;
    for (const listener of this.handshakeListeners) listener(next);
  }
}

/**
 * The placeholder owner seeded into the white seat when a JOINER claims, so `claimSeat`'s
 * white-preferred first-available rule lands the joiner on black. v1-local stand-in for the real
 * host's playerId, which a negotiated shared seat map would carry instead (`TODO(shared-seat-map)`).
 */
const HOST_PLACEHOLDER = 'host';
