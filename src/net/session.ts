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
 * ## Seat model — negotiated admission (S.5, epic #35, closes #31)
 *
 * Seats are **identity-owned and negotiated over the relay**, NOT derived from which button was
 * pressed (the #31 both-Join-both-Black bug is gone). {@link enter} drives the decentralized
 * admission protocol (design §4): a peer announces a `hello` with its seed {@link Proposal}, waits a
 * short PRESENCE SETTLE WINDOW, then branches — a **resident** established in the room arbitrates and
 * `admit`/`reject`s it; **truly alone** it establishes the room from its own proposal (minting a game
 * + claiming white as the first owner, or re-seeding a resumed one); **two arrived together** run a
 * deterministic {@link electInitiator} (earlier arrival, then lower playerId) and the initiator
 * reconciles both proposals, publishes the agreed game + seat map, and the other adopts (or is
 * rejected with a TYPED reason). Every seat owner is a real `playerId` or `null` — no `'host'`
 * sentinel. Reclaim-by-identity + reserve-vacated (a returning owner reclaims its seat; "room full" =
 * both seats owned) come from the pure {@link claimSeat}. {@link host}/{@link join} are thin wrappers
 * over {@link enter} (host = a `new` proposal, join = `defer`), and {@link reconnect} re-enters the
 * remembered room to reclaim the sticky seat.
 *
 * This is the **IO glue** (Playwright-verified, NOT mutation-gated): the PURE decisions it composes —
 * {@link reconcile} + {@link electInitiator} (`admission.ts`), {@link claimSeat} (`seats.ts`), the
 * admission-message codec + id-dedup (`sync.ts`), and the view derivation (`netModel.ts`) — carry the
 * strict unit + mutation gate in their own units.
 */

import { Game } from '../core/game';
import type { Coord } from '../core/coords';
import type { GameState, Player } from '../core/gameState';
import {
  saveGame,
  loadNetGame,
  loadNetGameByUuid,
  NET_ROOM_RESULT,
  type ArchivedMeta,
} from '../persist/archive';
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
import { claimSeat, seatOf, emptySeatMap, type SeatColor, type SeatMap } from './seats';
import {
  reconcile,
  electInitiator,
  type Proposal,
  type Peer,
} from './admission';
import {
  toHelloMessage,
  toAdmitMessage,
  toRejectMessage,
  toSyncMessage,
  parseSyncMessage,
  type HelloMessage,
  type AdmitMessage,
  type RejectMessage,
  type AdmissionMessage,
  type AdmissionReject,
} from './sync';
import { randomId } from '../util/randomId';
import { alternateSeats } from './endState';
import {
  UNDO_ACTION,
  REDO_ACTION,
  canProposeUndo,
  canProposeRedo,
  deriveUndoRedoPrompt,
  type UndoRedoPrompt,
} from './undoRedo';
import { canPlaceForSeat } from './turnGate';
import {
  generateGameCode,
  validateGameCode,
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
  /**
   * How long {@link NetSession.enter} waits for presence + hellos to STABILIZE before branching
   * (design §4 "settle window"). A newcomer must give a resident (or a co-arriving peer) time to
   * announce itself before deciding "truly alone" and establishing the room — too short and a
   * genuine simultaneous arrival races into a double-establish; the window is the coordination
   * point. Injectable so a unit test drives a `0`-ms window deterministically; defaults to a short
   * real delay in the app.
   */
  settleMs?: number;
  /**
   * Mint a UNIQUE id for an admission message (dedup key on the wire; design §Guardrails). Inject a
   * deterministic counter in tests; defaults to {@link randomId}. Kept off the sync/log path — an
   * admission id is never appended to the move-log.
   */
  newMessageId?: () => string;
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
 * A live networking session. Starts `offline`; {@link enter} drives the negotiated admission protocol
 * (S.5) to join a room and settle on a game + seat ({@link host}/{@link join}/{@link reconnect} are
 * thin wrappers over it). Exposes the plain {@link NetSessionState} via {@link state} + the identity-
 * owned seat owners / game uuid / last reject via {@link seatOwners}/{@link gameUuid}/
 * {@link lastRejectReason}, and change notifications via {@link onChange}. The move/undo path
 * delegates to the wrapped {@link SyncEngine} once connected.
 */
export class NetSession {
  private readonly deps: Required<
    Pick<NetSessionDeps, 'rand' | 'now' | 'settleMs' | 'newMessageId'>
  > &
    NetSessionDeps;
  private readonly listeners = new Set<NetChangeListener>();
  /** Subscribers to the OUT-OF-BAND handshake state (N.1: #12 rematch / #18 undo-redo). */
  private readonly handshakeListeners = new Set<HandshakeChangeListener>();

  private phase: NetPhase = 'offline';
  private code: string | null = null;
  private seat: NetSeat = null;
  private peerPresent = false;
  private joinError: JoinErrorReason | null = null;

  /**
   * The identity-owned seat map for the live game (S.2 — real playerIds, no sentinel). Persisted
   * ONTO the session game (its owner is the {@link engine}'s game, whose uuid is intrinsic to the
   * hash-chain): the durable value that makes reclaim-by-identity + reserve-vacated work across a
   * reconnect. `null` while offline. Exposed on `window.__pente` for the two-context e2e (S.7).
   */
  private seatMap: SeatMap | null = null;

  /**
   * The LAST admission {@link AdmissionReject} reason the arbiter answered our entry with, or `null`
   * if none since the last {@link enter}. A TYPED reason surfaced to the UI VERBATIM (design §7),
   * never a masked/mislabeled failure — a rejected peer stays offline and the net panel can show
   * exactly why. Exposed on `window.__pente` for the S.7 scenario proofs (reject-by-behavior).
   */
  private lastReject: AdmissionReject | null = null;

  /**
   * The seed {@link Proposal} the CURRENT {@link enter} announced (what game this peer brought). Held
   * so the arbiter path can reconcile a newcomer's proposal against OUR proposal when WE are the
   * resident/initiator, and so a re-announce on presence re-carries the same proposal. `null` offline.
   */
  private myProposal: Proposal | null = null;

  /**
   * Whether THIS peer has ESTABLISHED the room (design §4 Case 2 "truly alone" / the elected
   * initiator): it minted/re-seeded the authoritative game + seat map and now acts as the ARBITER
   * for any later {@link HelloMessage}. A non-established peer that sent a hello is a NEWCOMER waiting
   * for an `admit`/`reject`. Reset to `false` on every {@link enter}/{@link disconnect}.
   */
  private established = false;

  /**
   * The hellos seen from OTHER peers during (and after) the settle window, keyed by playerId — the
   * input to the initiator election (design §4 Case 2) and to the arbiter's per-newcomer reconcile.
   * `arrivalTag` is the OBSERVED live-presence arrival rank we assign as each peer's hello arrives
   * (monotonic), feeding {@link electInitiator}'s "earlier arrival, then lower playerId" order.
   */
  private readonly seenHellos = new Map<string, HelloMessage>();

  /** Monotonic counter minting each seen peer's local arrival rank (earlier = smaller). */
  private arrivalCounter = 0;

  /** The pending settle-window timer id, cleared on resolve/{@link disconnect} so it never double-fires. */
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  /** Resolves once {@link enter} has finished driving the protocol (settle → establish/admit/reject). */
  private enterResolve: (() => void) | null = null;

  /**
   * The room code of the LAST session {@link enter} ran (N.5.2, #20). Retained across a
   * background→return drop so {@link reconnect} can RE-ENTER the SAME room, reclaiming this browser's
   * sticky {@link NetSessionDeps.playerId} seat by IDENTITY (design §2.3). Set on every enter; NOT
   * cleared by {@link disconnect} (a graceful leave / background drop is exactly what a later reconnect
   * resumes), only overwritten by the next enter.
   */
  private lastCode: string | null = null;

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
      // A short real settle window in the app (long enough for a resident's hello to cross the relay,
      // short enough not to stall entry); a test injects `0` to drive the branch deterministically.
      settleMs: deps.settleMs ?? 400,
      newMessageId: deps.newMessageId ?? randomId,
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
   * ENTER a room `rawCode` with a seed `proposal` — the single S.5 entry point that drives the
   * decentralized admission protocol (design §4), REPLACING the old role-derived `host()`/`join()`
   * seat seeding (the #31 fix: seats are no longer derived from which BUTTON was pressed).
   *
   * The sequence:
   *  1. Connect the transport to the room and announce a `hello{ playerId, proposal, arrivalTag }`
   *     (S.4) so any resident/co-arriver learns what game we bring and who we are.
   *  2. Wait a short PRESENCE SETTLE WINDOW ({@link NetSessionDeps.settleMs}) for presence + hellos
   *     to stabilize, then BRANCH:
   *     - **(c) a resident is established** (it already holds a game and answers our hello as the
   *       ARBITER) → it reconciles our proposal + validates our seat and sends `admit`/`reject`;
   *       we adopt or surface the typed reject and go offline.
   *     - **(a) truly alone** → we ESTABLISH the room from our own proposal: `new` mints a game +
   *       claims white as the first owner; `resume`/`current` re-seeds the persisted game and
   *       reclaims our owned seat. We then act as arbiter for the next arrival.
   *     - **(b) two arrived together** (we each saw the other's hello within the window) →
   *       {@link electInitiator} deterministically (earlier arrival, then lower playerId); the
   *       initiator {@link reconcile}s BOTH proposals, publishes the agreed game + seat map, and the
   *       other validates & adopts (or rejects). This kills the initial double-white race (#31).
   *
   * On a connect failure the phase returns to `offline` with a `connect-failed` join error (honest,
   * observable, never swallowed). A no-op if a session is already live (`phase !== 'offline'`).
   */
  async enter(rawCode: string, proposal: Proposal): Promise<void> {
    if (this.phase !== 'offline') return;
    const validation = validateGameCode(rawCode);
    const code = validation.ok ? validation.code : generateGameCode(this.deps.rand);

    this.joinError = null;
    this.lastReject = null;
    this.myProposal = proposal;
    this.established = false;
    this.seenHellos.clear();
    this.arrivalCounter = 0;
    // Remember the room for a background→return reconnect (N.5.2, #20): the reconnect re-enters the
    // SAME room reclaiming this browser's sticky playerId seat via `claimSeat`/admission.
    this.lastCode = code;
    this.code = code;
    this.phase = 'connecting';
    this.emit();

    // Build + wire + connect the engine over a fresh transport with a PROVISIONAL seat/game seeded
    // from our proposal + any DURABLE state we persisted for this room/game (design §2.3/§6.4): a
    // returning owner reloads its persisted game (SAME uuid + seat) so an empty-room re-establish
    // RECLAIMS the color it owned rather than grabbing first-available white, and a resume/current
    // proposal seeds the real game whose uuid it published in its hello (so the arbiter never refuses
    // its own resume as `game-mismatch`). The authoritative game + seat map are still FINALIZED after
    // the settle window (we may adopt a resident's/initiator's game), but we need a live engine to
    // publish our hello and to receive admission traffic on `onAdmission`.
    const provisional = await this.buildProvisionalSeat(code, proposal);
    const connected = await this.beginEngine(code, provisional.game, provisional.color, provisional.seatMap);
    if (!connected) return; // beginEngine surfaced connect-failed + reset to offline.

    // Announce our arrival so a resident/co-arriver reconciles against our proposal.
    this.publishAdmission(
      toHelloMessage(this.deps.newMessageId(), this.deps.playerId, proposal, this.deps.now()),
    );

    // Wait for presence + hellos to settle, then branch (resident-admit / alone-establish / elect).
    await new Promise<void>((resolve) => {
      this.enterResolve = resolve;
      this.settleTimer = setTimeout(() => this.onSettle(), this.deps.settleMs);
    });
  }

  /**
   * Host a new game (issue #13 "create this room"): {@link enter} the code with a `new` proposal, so
   * this peer mints a fresh game + claims white as the first owner when it establishes. Kept as a thin
   * wrapper over {@link enter} so the app's existing `hostGame` command path is unchanged.
   *
   * @param rawCode The chosen room code (any case / whitespace), or omitted/invalid to generate one.
   */
  async host(rawCode?: string): Promise<void> {
    await this.enter(rawCode ?? '', { kind: 'new' });
  }

  /**
   * Join an existing game by code (issue #13 "enter this room"): {@link enter} the code with a
   * `defer` ("dealer's choice") proposal, so this peer adopts whatever game the resident/initiator
   * brings and takes the seat the admission gives it — NO role-derived black-seeding (the #31 fix).
   * The code is validated first; an invalid code is refused HERE without touching the transport (the
   * widget also validates before dispatching, so this is the defensive backstop).
   *
   * @returns `true` if a join was attempted (code valid), `false` if the code was rejected.
   */
  async join(rawCode: string): Promise<boolean> {
    if (this.phase !== 'offline') return false;
    const validation = validateGameCode(rawCode);
    if (!validation.ok) return false;
    await this.enter(validation.code, { kind: 'defer' });
    return true;
  }

  /**
   * Auto-reconnect after a background→return drop (N.5.2, issue #20): re-ENTER the SAME room,
   * reclaiming this browser's sticky {@link NetSessionDeps.playerId} seat. This is the GLUE side
   * effect the pure {@link shouldReconnect} (`notify.ts`) gates.
   *
   * It re-enters with a `defer` proposal: the returning owner reclaims its seat by IDENTITY (design
   * §2.3 reclaim-by-identity — the seat map remembers who it is), so it does not need to re-propose a
   * concrete game; the resident (if any) admits it back onto its reserved seat, and if it is truly
   * alone it re-establishes from a fresh game. A no-op returning `false` when there is no remembered
   * room or a session is already live (the defensive backstop for the `shouldReconnect` gate).
   *
   * @returns `true` if a reconnect was attempted, `false` if there was nothing to reconnect to.
   */
  async reconnect(): Promise<boolean> {
    if (this.phase !== 'offline') return false;
    if (this.lastCode === null) return false;
    await this.enter(this.lastCode, { kind: 'defer' });
    return true;
  }

  /**
   * Build the PROVISIONAL game + seat this peer runs on until the settle window finalizes it. It
   * seeds from the DURABLE, persisted state that makes reclaim-by-identity survive an EMPTY room
   * (design §2.3/§6.4) — NOT always a fresh empty game (the old #31-followup bug):
   *
   *  - **`resume`/`current`** — load the game whose `uuid` the proposal names (design §3) from the
   *    archive, so our engine holds the SAME identity we publish in our hello. Without this the
   *    arbiter's honesty guard rejects its OWN resume as `game-mismatch` (the provisional fresh uuid
   *    would differ from the reconciled `existing` uuid). We reclaim the seat that game's persisted
   *    seat map owns for us (or take first-available white if it records no owner yet).
   *  - **`defer`/`new`, but we OWN a seat in this room's persisted game** — reload that persisted
   *    game + seat map and RECLAIM our color. This is what lets the FIRST returning owner re-seed an
   *    empty room as the color it owned (black stays black) instead of grabbing white by arrival
   *    (design §6.4, scenario 4).
   *  - **otherwise** — a genuinely fresh game, first-available white on an empty map (true creation).
   *
   * This is the pre-settle placeholder so the engine is live to publish a hello + receive admission;
   * it is REPLACED by the resident's/initiator's authoritative game if we are admitted, and kept (as
   * the established game) only if we turn out to be alone.
   */
  private async buildProvisionalSeat(
    code: string,
    proposal: Proposal,
  ): Promise<{
    game: Game;
    color: SeatColor;
    seatMap: SeatMap;
  }> {
    // 1. A concrete resume/current: seed the actual game named by the proposal's uuid.
    if (proposal.kind === 'resume' || proposal.kind === 'current') {
      const seeded = await this.seedFromUuid(proposal.uuid);
      if (seeded !== null) return seeded;
      // The named game is not in our archive — fall through to a fresh game (an honest degrade: we
      // could not resume what we do not hold, so we bring an empty game rather than a wrong one).
    }
    // 2. defer/new (or a resume we could not resolve): if we already OWN a seat in this room's
    //    persisted game, reload it and reclaim our color — the durable empty-room reclaim.
    const room = await this.loadRoomState(code);
    if (room !== null && seatOf(room.seatMap, this.deps.playerId) !== null) {
      const claim = claimSeat(room.seatMap, this.deps.playerId);
      if (!claim.ok) throw new Error('reclaim of an owned seat must succeed');
      return { game: room.game, color: claim.color, seatMap: claim.seatMap };
    }
    // 3. Genuine creation: a fresh empty game, first-available white on an empty map. claimSeat on an
    //    empty map always succeeds; assert rather than branch on an unreachable reject (keeps the
    //    tripwire, agent-principles).
    const game = new Game(this.deps.size);
    const claim = claimSeat(emptySeatMap(), this.deps.playerId);
    if (!claim.ok) throw new Error('provisional claim on an empty map must succeed');
    return { game, color: claim.color, seatMap: claim.seatMap };
  }

  /**
   * Seed a provisional from the archived game whose stable `uuid` matches (a `resume`/`current`
   * proposal). Returns the reconstructed game + our reclaimed seat + its persisted seat map, or
   * `null` if we hold no such game. If the persisted seat map records no owner for us yet (e.g. a
   * local game being seeded into a room for the first time), we take first-available white.
   */
  private async seedFromUuid(
    uuid: string,
  ): Promise<{ game: Game; color: SeatColor; seatMap: SeatMap } | null> {
    const loaded = await loadNetGameByUuid(this.deps.db, uuid);
    if (loaded === undefined) return null;
    const seatMap: SeatMap = loaded.seats ?? emptySeatMap();
    const claim = claimSeat(seatMap, this.deps.playerId);
    if (!claim.ok) throw new Error('seed-from-uuid claim must succeed (owner or first-available)');
    return { game: loaded.game, color: claim.color, seatMap: claim.seatMap };
  }

  /**
   * The IndexedDB key under which this session persists a room's authoritative game + identity-owned
   * seat map (design §2.4 "each peer's persisted game"): a room-scoped autosave id. Keeping it
   * room-scoped is what lets the FIRST returning owner re-seed an empty room by IDENTITY — it looks
   * the room up by code, reclaims the color the persisted seat map says it owns, and re-publishes the
   * same game uuid.
   */
  private roomStateId(code: string): string {
    return `net-room:${code}`;
  }

  /**
   * Load this room's persisted authoritative game + seat map (the durable value that survives an
   * empty room), or `null` if this browser has never established/adopted a game in this room. A
   * corrupt record surfaces its {@link ArchiveError} honestly rather than being masked.
   */
  private async loadRoomState(code: string): Promise<{ game: Game; seatMap: SeatMap } | null> {
    const loaded = await loadNetGame(this.deps.db, this.roomStateId(code));
    if (loaded === undefined || loaded.seats === null) return null;
    return { game: loaded.game, seatMap: loaded.seats };
  }

  /**
   * The most recent durable {@link persistRoomState} write in flight, exposed via {@link whenPersisted}.
   * A caller that must observe this room's persisted state on a LATER reconnect (the empty-room reclaim)
   * awaits it after {@link enter}, so it reads a COMMITTED write, not a racing one — the durability
   * guarantee is deterministic, never a "usually committed by then" flake (agent-principles #2: proof
   * must be reliably observable). A rejected write surfaces through {@link whenPersisted} rather than
   * being silently swallowed. `enter` itself does NOT block on it (see {@link finishEnter}).
   */
  private pendingPersist: Promise<void> = Promise.resolve();

  /**
   * Persist this room's authoritative game + identity-owned seat map under the room-scoped id (design
   * §2.3/§2.4), so a later reconnect into an EMPTY room reclaims the seat by identity and re-seeds the
   * same game. Called whenever we establish, adopt an admit, or update our durable seat map as the
   * arbiter. Records the in-flight write in {@link pendingPersist} so {@link finishEnter} can await
   * durability; a failed write rejects honestly (never a swallowed error).
   */
  private persistRoomState(): Promise<void> {
    const engine = this.engine;
    const code = this.code;
    if (engine === null || code === null || this.seatMap === null) return Promise.resolve();
    const write = saveGame(this.deps.db, this.roomStateId(code), engine.game(), {
      players: {},
      // The INTERNAL room-state marker (design §2.4) — excluded from the user-facing archive listing
      // + resume lookup so this durable coordination shard never shows as a spurious extra game.
      result: NET_ROOM_RESULT,
      startedAt: this.deps.now(),
      seats: this.seatMap,
    });
    this.pendingPersist = write;
    return write;
  }

  /**
   * Build + wire + connect the {@link SyncEngine} over a fresh transport with the given authoritative
   * `game` + this peer's `color` + `seatMap`. Shared by {@link enter} (provisional) and the establish/
   * adopt finalizers. On a connect failure it surfaces `connect-failed` and returns to offline.
   *
   * @returns `true` if connected (the engine is live), `false` if the connect failed (offline again).
   */
  private async beginEngine(
    code: string,
    game: Game,
    color: SeatColor,
    seatMap: SeatMap,
  ): Promise<boolean> {
    const transport = this.deps.createTransport();
    this.transport = transport;
    transport.onPresence((peers) => this.onPresence(peers));

    const engine = this.wireEngine(transport, game, color, seatMap);

    try {
      await engine.connect(code);
    } catch {
      // Connect failed — surface it in observable state (an honest error, not a swallowed one) and
      // return to offline so the user can retry with the same or a different code.
      transport.disconnect();
      this.resetToOffline('connect-failed');
      this.emit();
      return false;
    }
    this.reflectEngineStatus();
    return true;
  }

  /**
   * Build the {@link SyncEngine} for `game`/`color` over an ALREADY-CONNECTED `transport` and wire all
   * of its seams (change / in-game handshake / admission), setting this session's seat + seat map. Does
   * NOT connect — the caller either connects a fresh transport ({@link beginEngine}) or reuses a live
   * one ({@link onAdmit} adopting the arbiter's authoritative game over the SAME connection). Kept
   * separate so adopting an admit can REPLACE the provisional game without a transport teardown /
   * reconnect flicker — the admit game has a DIFFERENT genesis uuid than the provisional one, so it
   * cannot be adopted through the prefix-based sync `receive` (that is same-uuid convergence); it is
   * swapped in wholesale here, then published once so the two peers converge.
   */
  private wireEngine(
    transport: Transport,
    game: Game,
    color: SeatColor,
    seatMap: SeatMap,
  ): SyncEngine {
    this.seat = color;
    this.seatMap = seatMap;
    const meta = (): Omit<ArchivedMeta, 'result'> => ({
      players: { [color]: this.deps.playerId },
      startedAt: this.deps.now(),
    });
    const engine = new SyncEngine(game, transport, this.deps.db, meta, color as Player);
    this.engine = engine;
    // Reset the handshake for the new session — a fresh room has no pending proposal from a prior one.
    this.handshake = initialHandshake();
    // Re-emit on EVERY engine game change — crucially including a REMOTE move adopted by the
    // transport pump (which mutates the engine's game silently). This is the resync link that makes
    // a peer's move re-render the scene (issue #4). A conflict also folds the engine status into the
    // phase here. AUTO-CANCEL on GAME-ADVANCED (N.1 guardrail): a landed move drops any stale proposal.
    engine.onChange(() => {
      this.setHandshake(onGameAdvanced(this.handshake));
      this.reflectEngineStatus();
      this.emit();
    });
    // OUT-OF-BAND in-game handshake inbound (N.1: rematch/undo/redo) — kept off the move-log.
    engine.onMessage((msg) => {
      if (msg.kind === 'proposal') {
        this.setHandshake(receiveProposal(this.handshake, msg));
      } else {
        this.setHandshake(receiveResponse(this.handshake, msg));
      }
    });
    // ADMISSION inbound (S.5): the room-ENTRY protocol. The engine dedups by id and delivers only
    // FRESH hello/admit/reject here, so a replayed/stale proposal never re-fires (design §Guardrails).
    engine.onAdmission((msg) => this.onAdmission(msg));
    return engine;
  }

  /**
   * The settle-window expiry (design §4): presence + hellos have stabilized, so BRANCH. We have
   * already published our hello and collected any hellos peers sent. Decide, deterministically:
   *
   *  - We saw ANOTHER peer's hello → **simultaneous arrival**: {@link electInitiator} over the set
   *    {us + everyone we heard}. If WE win, reconcile every proposal and publish the agreed game +
   *    seat map (admit each newcomer); if we LOSE, we already sent our hello — wait for the winner's
   *    `admit`/`reject` (handled in {@link onAdmission}), so this is a no-op here.
   *  - We saw NO other hello → **truly alone**: ESTABLISH the room from our own proposal (keep our
   *    provisional game/seat) and become the arbiter for the next arrival.
   *
   * A resident that already answered our hello with an `admit` before the window expired would have
   * finalized us in {@link onAdmission}; this only fires if no admit/reject arrived.
   */
  private onSettle(): void {
    this.settleTimer = null;
    if (this.phase !== 'connecting') return this.finishEnter(); // already admitted/rejected/left.

    const others = [...this.seenHellos.values()];
    if (others.length === 0) {
      // Truly alone → establish from our provisional game/seat and arbitrate future arrivals.
      this.establishAlone();
      return this.finishEnter();
    }

    // Simultaneous arrival → elect the initiator deterministically.
    const peers: Peer[] = [
      { playerId: this.deps.playerId, arrivalOrder: 0 },
      ...others.map((h) => ({ playerId: h.playerId, arrivalOrder: this.arrivalOf(h) })),
    ];
    const initiator = electInitiator(peers);
    if (initiator === this.deps.playerId) {
      // WE run reconciliation over both proposals + publish the agreed game + seat map.
      this.establishAsInitiator(others);
    }
    // If we lost the election we keep waiting for the winner's admit/reject (onAdmission finalizes).
    // Do NOT resolve enter() yet in that case — a genuine outcome still arrives over the relay.
    if (initiator === this.deps.playerId) return this.finishEnter();
  }

  /**
   * ESTABLISH the room as the lone arriver (design §4 Case 2 "truly alone"): keep our provisional game
   * + seat as the authoritative game + seat map, mark ourselves ESTABLISHED (so we arbitrate the next
   * hello), persist the durable room state, and reach `connected`. The provisional was already seeded
   * by {@link buildProvisionalSeat} — a FRESH game + first-available white for genuine creation, or a
   * RELOADED persisted game + reclaimed seat when we already owned a seat in this room (design §6.4),
   * so a returning owner re-seeds an empty room as the color it owned, not white-by-arrival.
   */
  private establishAlone(): void {
    this.established = true;
    this.reflectEngineStatus();
    if (this.phase === 'connecting') this.phase = 'connected';
    // Persist the room's game + seat map so a later reconnect into an empty room reclaims by identity
    // (design §6.4). Fire-and-forget the durable write — a failure rejects honestly (unhandled), never
    // masked; the in-memory state is already correct for this session.
    void this.persistRoomState();
    this.emit();
  }

  /**
   * ESTABLISH the room as the elected initiator (design §4 Case 2 "two arrived together"): reconcile
   * OUR proposal against each co-arriver's, mint/keep the agreed authoritative game, build the durable
   * seat map (we take the first-available seat, each admitted peer the next), and publish an `admit`
   * (agreed game + seat map) or a typed `reject` to each. We keep our own game + seat and become the
   * arbiter.
   */
  private establishAsInitiator(others: readonly HelloMessage[]): void {
    // Reconcile every co-arriver's proposal against ours; a divergent/mismatched pair is a typed
    // reject to THAT peer (design §5). We keep our own agreed game (the `new`/`current` we brought).
    // Seat OURSELVES first (first-available white on the empty durable map); an empty-map claim always
    // succeeds, so assert rather than branch on an unreachable reject (keeps the tripwire).
    const mine = claimSeat(emptySeatMap(), this.deps.playerId);
    if (!mine.ok) throw new Error('initiator self-claim on an empty map must succeed');
    let seatMap = mine.seatMap;
    this.seat = mine.color;
    this.seatMap = seatMap;

    for (const hello of others) {
      seatMap = this.arbitrate(hello, seatMap);
    }
    this.seatMap = seatMap;
    this.established = true;
    this.reflectEngineStatus();
    if (this.phase === 'connecting') this.phase = 'connected';
    void this.persistRoomState();
    this.emit();
  }

  /**
   * Arbitrate ONE newcomer's `hello` against the current durable `seatMap` (design §4/§5): reconcile
   * its proposal against ours, validate its seat, and publish an `admit` (agreed game + updated seat
   * map) or a TYPED `reject`. Returns the (possibly-updated) seat map. Shared by the initiator
   * ({@link establishAsInitiator}) and the live arbiter ({@link onHello}) so both apply IDENTICAL
   * rules — the single arbitration path, never two subtly-different copies.
   */
  private arbitrate(hello: HelloMessage, seatMap: SeatMap): SeatMap {
    const result = reconcile(this.myProposal ?? { kind: 'new' }, hello.proposal);
    if (!result.ok) {
      this.publishAdmission(toRejectMessage(this.deps.newMessageId(), result.reason));
      return seatMap;
    }
    // Honesty guard (agent-principles: never mask): reconciliation may agree on an `existing` game
    // that is NOT the one we hold — a resume of a PARTNER's game we never persisted (the S.6/#37
    // resume-a-shared-game seam). We can only serve the game our engine actually holds; if the agreed
    // game's uuid differs from ours, reject `game-mismatch` rather than silently serving the wrong
    // game. For this build's proposals (new/defer) the agreed game is always our own, so this never
    // fires here — but it refuses to ship a happy-path that would mis-serve a future resume proposal.
    const ourUuid = this.gameUuid();
    if (result.game.kind === 'existing' && ourUuid !== null && result.game.uuid !== ourUuid) {
      this.publishAdmission(toRejectMessage(this.deps.newMessageId(), 'game-mismatch'));
      return seatMap;
    }
    // Reconciled + serveable → seat the newcomer (identity-reclaim or first-available on the map).
    const claim = claimSeat(seatMap, hello.playerId);
    if (!claim.ok) {
      this.publishAdmission(toRejectMessage(this.deps.newMessageId(), claim.reason));
      return seatMap;
    }
    this.publishAdmission(
      toAdmitMessage(this.deps.newMessageId(), this.currentSyncPayload(), claim.seatMap),
    );
    return claim.seatMap;
  }

  /**
   * Inbound ADMISSION message (S.5, design §4). Routes by kind:
   *  - `hello` — a peer announced ENTRY. If WE are the established arbiter, reconcile its proposal +
   *    seat it and answer `admit`/`reject`; otherwise record it (feeding the settle-window election).
   *  - `admit` — the arbiter granted us: adopt the authoritative game (hash-chain-verified) + take
   *    the seat the map assigns us. Finalizes a pending {@link enter}.
   *  - `reject` — the arbiter refused us with a TYPED reason: record it, go offline (surfaced to the
   *    UI verbatim — never masked). Finalizes a pending {@link enter}.
   */
  private onAdmission(msg: AdmissionMessage): void {
    switch (msg.kind) {
      case 'hello':
        this.onHello(msg);
        return;
      case 'admit':
        this.onAdmit(msg);
        return;
      case 'reject':
        this.onReject(msg);
        return;
    }
  }

  /** Handle a peer's `hello`: arbitrate it if established, else record it for the settle election. */
  private onHello(hello: HelloMessage): void {
    if (!this.seenHellos.has(hello.playerId)) {
      this.arrivalCounter += 1;
      this.seenHellos.set(hello.playerId, hello);
      this.arrivalOrders.set(hello.playerId, this.arrivalCounter);
    }
    if (!this.established || this.engine === null || this.seatMap === null) return;

    // We are the live ARBITER (design §4 Case 1): arbitrate the newcomer against our durable seat map
    // (the SAME rule the initiator applies), updating our seat map with the seat it granted.
    this.seatMap = this.arbitrate(hello, this.seatMap);
    // Persist the updated durable seat map so a reserved/absent owner survives our own later drop.
    void this.persistRoomState();
    this.emit();
  }

  /**
   * Handle the arbiter's `admit`: ADOPT the authoritative game wholesale and take the seat the map
   * assigns us. The admit game has a DIFFERENT genesis uuid than our provisional game, so it cannot go
   * through the prefix-based sync `receive` (that is same-uuid convergence, and two empty logs with
   * different uuids would falsely CONFLICT). Instead we re-verify the payload's hash chain
   * ({@link parseSyncMessage} — a tampered/mismatched payload throws honestly, never a masked
   * adoption) and swap the reconstructed game into a fresh engine over the SAME live transport
   * ({@link wireEngine}), then publish once so the two peers converge. Only fires while `connecting`;
   * a duplicate racing an establish is ignored.
   */
  private onAdmit(admit: AdmitMessage): void {
    if (this.phase !== 'connecting') return; // already finalized (e.g. a duplicate racing an establish).
    const mySeat = seatOf(admit.seats, this.deps.playerId);
    if (mySeat === null) {
      // The admit does not seat us — treat as an honest room-full-style refusal (we own no seat).
      this.lastReject = 'room-full';
      this.disconnect();
      return this.finishEnter();
    }
    const transport = this.transport;
    if (transport === null) return this.finishEnter();
    // Re-verify the authoritative game's hash chain, then reconstruct it (identity + history intact).
    const log = parseSyncMessage(admit.game);
    const game = Game.fromLog(this.deps.size, log);
    // Swap the admitted game + our admitted seat into a fresh engine over the SAME transport (no
    // reconnect / presence flicker). ATTACH re-registers the transport's message pump onto the NEW
    // engine (the old provisional engine registered it on connect; "latest registration wins"), so a
    // subsequent move is delivered to THIS engine and renders — then publishes our adopted state.
    const engine = this.wireEngine(transport, game, mySeat, admit.seats);
    engine.attach();
    this.reflectEngineStatus();
    if (this.phase === 'connecting') this.phase = 'connected';
    // Persist the adopted game + seat map so if the arbiter later leaves and we become the sole
    // resident, our own reconnect (or a re-establish) reclaims this seat + game by identity (design
    // §2.3/§6.4). This is what makes scenario 4 (both drop, both rejoin) preserve ownership.
    void this.persistRoomState();
    this.emit();
    this.finishEnter();
  }

  /** Handle the arbiter's typed `reject`: record the reason, surface it, and go offline. */
  private onReject(reject: RejectMessage): void {
    if (this.phase !== 'connecting') return;
    this.lastReject = reject.reason;
    // A seat-level room-full also feeds the netModel joinError so the existing widget surfaces it.
    if (reject.reason === 'room-full') this.joinError = 'room-full';
    this.disconnect();
    this.finishEnter();
  }

  /** The current authoritative game as a `kind:'sync'` payload (for an admit). */
  private currentSyncPayload(): ReturnType<typeof toSyncMessage> {
    const engine = this.engine;
    if (engine === null) throw new Error('cannot build sync payload without a live engine');
    return toSyncMessage(engine.game().log, engine.epoch());
  }

  /**
   * Resolve the pending {@link enter} promise exactly once (settle → establish/admit/reject done).
   * Deliberately does NOT block on the durable {@link persistRoomState} write: `enter` reports the
   * live session state as soon as it is negotiated (a fast, timer-driven path), and the durability
   * ordering a later reconnect needs is awaited separately via {@link whenPersisted} — coupling the
   * two would make `enter` sensitive to the archive write's async completion (it stalls a fake-timer
   * test), for no observable benefit to the caller (the seat/game state is already correct here).
   */
  private finishEnter(): void {
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    const resolve = this.enterResolve;
    this.enterResolve = null;
    if (resolve !== null) resolve();
  }

  /**
   * Resolve once the most recent durable {@link persistRoomState} write has COMMITTED (design
   * §2.3/§6.4). A reconnect that must observe this room's persisted seat map + game (the empty-room
   * reclaim) awaits this after {@link enter} so it reads a settled write, not a racing one — the
   * durability is deterministic rather than "usually committed by then" (agent-principles #2: proof
   * must be reliably observable). Resolves immediately when nothing was persisted (a reject/offline
   * entry). A failed write rejects here rather than being swallowed.
   */
  async whenPersisted(): Promise<void> {
    await this.pendingPersist;
  }

  /** The observed arrival rank of a seen hello's peer (earlier = smaller), else a large fallback. */
  private arrivalOf(hello: HelloMessage): number {
    return this.arrivalOrders.get(hello.playerId) ?? Number.MAX_SAFE_INTEGER;
  }

  /** Per-peer observed arrival rank (assigned as each hello arrives), feeding the initiator election. */
  private readonly arrivalOrders = new Map<string, number>();

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

  /** Redo this client's own previously-undone move (delegates to the engine's restricted redo). */
  redo(): void {
    this.requireEngine().redo();
    this.reflectEngineStatus();
    this.emit();
  }

  /**
   * Apply an ACCEPTED out-of-band undo/redo resolution (the #18 mutual-confirm apply half). Called by
   * the app when the shared N.1 handshake RESOLVES to `accepted` for an `'undo'` / `'redo'` action on
   * EITHER side (WE proposed and the peer accepted, or the peer proposed and WE accepted): BOTH clients
   * fold the action into their own engine + publish, so the two logs converge by the same prefix/hash
   * path as any move. This is where the undo/redo — held OUT-OF-BAND on the handshake until this point —
   * is finally applied to the game/log; a declined or auto-cancelled proposal never reaches here, so
   * both games stay untouched (the #18 "held out-of-band until BOTH accept" guarantee).
   *
   * It reads the session's own {@link HandshakeState.resolution}: only an `accepted` resolution whose
   * action is `'undo'` or `'redo'` applies (a `'rematch'` accept is {@link resetForRematch}'s job; a
   * decline does nothing). Applies exactly the matching engine action, then CLEARS the resolution so it
   * cannot re-fire and the handshake settles idle for the next ask. A no-op returning `false` when
   * there is no live engine, or the current resolution is not an accepted undo/redo.
   *
   * @returns `true` iff an accepted undo/redo was applied, `false` otherwise.
   */
  applyAcceptedUndoRedo(): boolean {
    if (this.engine === null) return false;
    const res = this.handshake.resolution;
    if (res === null || res.outcome !== 'accepted') return false;
    if (res.action !== UNDO_ACTION && res.action !== REDO_ACTION) return false;
    // Apply the AGREED action to OUR engine (which publishes → the peer adopts the strict extension).
    // Use the UNCONDITIONAL apply variants, NOT the restricted `engine.undo()`: who may PROPOSE was
    // gated upstream (decideUndo/decideRedo via canProposeUndo/canProposeRedo) before the ask was
    // raised, but the APPLY runs on BOTH clients — and the RESPONDER's seat is NOT the last mover's, so
    // the restricted `engine.undo()` would refuse the undo the responder just accepted and the boards
    // would diverge. `applyAgreedUndo`/`redo` step the last move regardless of seat (mutual consent was
    // already established); a core IllegalMove would still propagate honestly rather than be masked.
    if (res.action === UNDO_ACTION) {
      this.engine.applyAgreedUndo();
    } else {
      this.engine.redo();
    }
    // The accepted undo/redo has now been applied — clear the resolution so it cannot re-fire and the
    // next ask starts from an idle handshake (mirrors resetForRematch). setHandshake notifies the
    // handshake listeners so the prompt/idle UI repaints, and no-ops if there was nothing to clear.
    this.setHandshake(clearResolution(this.handshake));
    this.reflectEngineStatus();
    this.emit();
    return true;
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

  /**
   * Whether this client may PROPOSE an undo / a redo right now (Task N.3.2, issue #18) — the flags the
   * networked banner Undo/Redo buttons enable on. Folds the authoritative game state + ply + redo-tail
   * fact + this client's seat + the N.1 handshake through the PURE {@link canProposeUndo} /
   * {@link canProposeRedo} (which combine the restricted last-mover-only rule with the single-pending
   * invariant). With no live engine/seat (offline) neither is proposable (there is no networked game),
   * so both are `false` — the LOCAL buttons then use the scene's own `canUndo`/`canRedo` history facts.
   */
  undoRedoAvail(): { readonly canUndo: boolean; readonly canRedo: boolean } {
    if (this.engine === null || this.seat === null) {
      return { canUndo: false, canRedo: false };
    }
    const game = this.engine.game();
    const state = game.state();
    const seat = this.seat as Player;
    return {
      canUndo: canProposeUndo(state, game.ply(), seat, this.handshake),
      canRedo: canProposeRedo(state, game.canRedo(), seat, this.handshake),
    };
  }

  /**
   * The INCOMING undo/redo accept/decline prompt view-model (Task N.3.2, issue #18): the PURE
   * {@link deriveUndoRedoPrompt} over the N.1 handshake + this client's seat. `show` is `true` only when
   * the PEER has an `'undo'`/`'redo'` proposal awaiting our response; the copy names the opponent color
   * (from the fixed `Player` union, never opponent free text — the consuming widget renders it via
   * `textContent`). Offline / no incoming ask → a hidden prompt.
   */
  undoRedoPrompt(): UndoRedoPrompt {
    return deriveUndoRedoPrompt(this.handshake, this.seat);
  }

  /** The wrapped SyncEngine, for the scene to read its `Game`/state once connected, or null. */
  syncEngine(): SyncEngine | null {
    return this.engine;
  }

  /**
   * The authoritative game's move-log length (ply) while a session is live, or `0` offline (N.5.2,
   * issue #20). The move-notification glue tracks this across session changes to detect a FORWARD
   * opponent move (the ply GREW) — the trigger the pure {@link isRemoteMoveForMe} reads. Sourced from
   * the wrapped engine's `Game.ply()` (the canonical move-log length, capture-independent), NOT from a
   * piece count (captures remove pieces without shortening the log), so an undo shrinks it and a
   * capturing move still grows it — exactly what the trigger needs.
   */
  ply(): number {
    return this.engine === null ? 0 : this.engine.game().ply();
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
    this.resetToOffline(null);
    // Leaving the room voids any out-of-band ask (there is no peer + no engine to complete it); reset
    // the handshake so a later re-host/re-join starts clean and never surfaces a stale proposal.
    this.setHandshake(initialHandshake());
    this.emit();
  }

  /**
   * The identity-owned seat map of the live game (S.2), or `null` offline — the durable value that
   * makes reclaim-by-identity + reserve-vacated work. Exposed on `window.__pente` so the two-context
   * e2e (S.7) asserts on BOTH clients' seat OWNERS (real playerIds, no sentinel) — proof-by-state.
   */
  seatOwners(): SeatMap | null {
    return this.seatMap;
  }

  /**
   * The live game's stable UUID (minted at genesis, intrinsic to the hash-chain — S.1), or `null`
   * offline. Exposed on `window.__pente` so the e2e proves BOTH clients converged on the SAME game
   * identity after admission (design §2.2) — a same-uuid/divergent-headHash is a genuine conflict.
   */
  gameUuid(): string | null {
    return this.engine === null ? null : this.engine.game().uuid;
  }

  /**
   * The LAST admission {@link AdmissionReject} reason this peer was refused with since the last
   * {@link enter}, or `null`. A TYPED reason surfaced to the UI VERBATIM (design §7) — exposed on
   * `window.__pente` so the S.7 reject scenarios assert the honest reason by observable state.
   */
  lastRejectReason(): AdmissionReject | null {
    return this.lastReject;
  }

  /** Publish an admission message (hello/admit/reject) over the room transport — never onto the log. */
  private publishAdmission(msg: AdmissionMessage): void {
    if (this.transport === null) return;
    this.transport.publish(msg);
  }

  /** Tear the session back to `offline`, clearing all live + admission state. `err` is the joinError. */
  private resetToOffline(err: JoinErrorReason | null): void {
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    this.transport = null;
    this.engine = null;
    this.seat = null;
    this.seatMap = null;
    this.code = null;
    this.peerPresent = false;
    this.joinError = err;
    this.established = false;
    this.myProposal = null;
    this.seenHellos.clear();
    this.arrivalOrders.clear();
    this.arrivalCounter = 0;
    this.phase = 'offline';
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
      // ARBITER HANDOFF (design §2.4 "whoever is currently in the room validates newcomers", §6.5):
      // when the peer we were playing leaves and we are now the SOLE resident holding an established
      // game + our seat, WE become the arbiter for the next arrival — otherwise a stranger entering
      // an "empty" room (from the relay's view) would see no resident to refuse it and could take a
      // RESERVED seat. An admitted peer (which was NOT the establisher) thus assumes arbitration on
      // its partner's departure; the durable seat map it persisted keeps the absent owner reserved.
      if (this.phase === 'connected' && this.engine !== null && this.seatMap !== null && this.seat !== null) {
        this.established = true;
      }
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
