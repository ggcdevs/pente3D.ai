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
import type { Player } from '../core/gameState';
import type { ArchivedMeta } from '../persist/archive';
import type { Transport } from './transport';
import { SyncEngine } from './sync';
import { claimSeat, emptySeatMap, type SeatColor, type SeatMap } from './seats';
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
 * A live networking session. Starts `offline`; {@link host} generates a code and connects as white,
 * {@link join} validates a code and connects as black. Exposes the plain {@link NetSessionState}
 * via {@link state} and change notifications via {@link onChange}. The move/undo path delegates to
 * the wrapped {@link SyncEngine} once connected.
 */
export class NetSession {
  private readonly deps: Required<Pick<NetSessionDeps, 'rand' | 'now'>> & NetSessionDeps;
  private readonly listeners = new Set<NetChangeListener>();

  private phase: NetPhase = 'offline';
  private code: string | null = null;
  private seat: NetSeat = null;
  private peerPresent = false;
  private joinError: JoinErrorReason | null = null;

  private engine: SyncEngine | null = null;
  private transport: Transport | null = null;

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
   * Host a new game: generate a fresh code, claim the white seat, and connect. Resolves once the
   * transport is connected (or leaves the session in an error state if the connect fails). A no-op
   * if a session is already live (offline is the only state host/join start from).
   */
  async host(): Promise<void> {
    if (this.phase !== 'offline') return;
    const code = generateGameCode(this.deps.rand);
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

  /** The wrapped SyncEngine, for the scene to read its `Game`/state once connected, or null. */
  syncEngine(): SyncEngine | null {
    return this.engine;
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
    this.emit();
  }

  /** Presence handler: mark the peer present iff any peer OTHER than us is in the room. */
  private onPresence(peers: readonly string[]): void {
    const others = peers.filter((id) => id !== this.deps.playerId);
    const present = others.length > 0;
    if (present === this.peerPresent) return;
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
}

/**
 * The placeholder owner seeded into the white seat when a JOINER claims, so `claimSeat`'s
 * white-preferred first-available rule lands the joiner on black. v1-local stand-in for the real
 * host's playerId, which a negotiated shared seat map would carry instead (`TODO(shared-seat-map)`).
 */
const HOST_PLACEHOLDER = 'host';
