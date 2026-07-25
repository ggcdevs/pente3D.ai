/**
 * Networking session (Task 5.5) — the app-level IO orchestration that wires the Stage 3
 * {@link SyncEngine} + the seat manager ({@link claimSeat}) behind a single, plain, subscribable
 * {@link NetSessionState} the merged net-status sub-panel in the banner (`src/ui/widgets/banner.ts`,
 * issue #44) renders.
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
 * ## What a session leaves behind (V.1, epic #47 — the v3.1 model, design §2)
 *
 * A room CODE is pure rendezvous and identifies NO game: the v3 `net-room:{code}` record (a game +
 * seat map persisted per code) is DELETED, together with every code→game lookup — it was the root of
 * the resurrected-game bugs (#43/#46). What persists instead:
 *
 *  - the authoritative game + its identity-owned seat map in the **archive, keyed by the game's own
 *    UUID** ({@link persistGame}) — the source of truth, an ordinary listed record;
 *  - a single **`activeNetworkedGame` breadcrumb** ({@link markActiveGame}, `activeGame.ts`) saying
 *    "I am currently mid-game in room X as game Y", DUAL-TRACKED (design §2): the localStorage half
 *    is the reload path and is cleared when the game is decided, while the JS-var half
 *    ({@link NetSession.activeGame}) survives a win so this session's own return/rematch still finds
 *    the game it just finished.
 *
 * A returning peer therefore re-seeds from the BREADCRUMB's uuid via the archive, never from the code
 * — and the loaded game is a runtime value, never a per-room resurrection.
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
  loadNetGameByUuid,
  archivedStartedAts,
  playersFromSeats,
  type ArchivedMeta,
} from '../persist/archive';
import {
  readActiveGame,
  writeActiveGame,
  clearActiveGame,
  isActiveGameStale,
  type ActiveNetworkedGame,
} from './activeGame';
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
import {
  claimSeat,
  seatOf,
  emptySeatMap,
  type ClaimRejection,
  type SeatColor,
  type SeatMap,
} from './seats';
import {
  acceptsGame,
  decideAdmission,
  electInitiator,
  type OfferedGame,
  type Proposal,
  type Peer,
} from './admission';
import {
  toHelloMessage,
  toAdmitMessage,
  toAdoptAdmitMessage,
  toRejectMessage,
  toSyncMessage,
  parseSyncMessage,
  type HelloMessage,
  type AdmitMessage,
  type RejectMessage,
  type AdmissionMessage,
  type AdmissionReject,
  type SyncMessage,
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
import { rematchGameUuid } from './rematch';
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
   * Where the `activeNetworkedGame` BREADCRUMB is kept (`src/net/activeGame.ts`, design §2): the
   * single "I am currently mid-game in room X as game Y" record that lets a returning peer re-seed
   * from the GAME's uuid — never from the room code (there is no code→game mapping anywhere). Omit
   * for `globalThis.localStorage` (the browser app); pass `null` to disable it entirely (a headless
   * CLI, or a test that does not exercise reload/return recovery).
   */
  readonly storage?: Storage | null;
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

/**
 * Project a sync payload onto the two facts the pure seed rules judge ({@link OfferedGame}, design
 * §3): WHICH game it is, and whether it carries ANY history. "Empty" is a log with NO events —
 * genesis only — not merely an empty-looking board (a `place` + `undo` leaves the board bare and the
 * history real, and adopting that is not starting a fresh game).
 *
 * Used on BOTH sides of the wire so the seed rule is applied to the SAME projection whether we are
 * about to serve a game ({@link NetSession.arbitrate}) or have just been offered one
 * ({@link NetSession.onAdmit}) — one reading of "what game is this", never two.
 */
function offeredGameOf(payload: SyncMessage): OfferedGame {
  return { uuid: payload.uuid, empty: payload.log.length === 0 };
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
  /**
   * The playerIds CURRENTLY present in the room (the live-presence snapshot from
   * {@link onPresence}), always including our own id. This feeds {@link claimSeat}'s
   * reject-reason distinction: when the arbiter refuses a newcomer because both seats are
   * owned, a blocking owner who is ABSENT yields `seat-reserved` (its seat is held for its
   * return — scenario 5), whereas all-owners-present yields `room-full` (a full active game —
   * scenario 1). Distinct from the {@link peerPresent} boolean, which only asks "is anyone
   * else here"; the arbiter needs to know WHICH ids are present to name the reason.
   */
  private presentPeers: ReadonlySet<string> = new Set();
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
   * Each hello carries the peer's OWN `arrivalTag` (the shared, comparable live-presence arrival
   * value it stamped from its clock), which is what {@link electInitiator}'s "earlier arrival, then
   * lower playerId" order compares against OUR own {@link myArrivalTag} — so BOTH peers, seeing the
   * SAME two tags, independently elect the SAME initiator (design §11). Using each peer's own tag
   * (not a locally-observed receive order) is what makes the election agree across peers regardless
   * of which hello a given peer happened to receive first.
   */
  private readonly seenHellos = new Map<string, HelloMessage>();

  /**
   * THIS peer's own `arrivalTag` — the value it stamped into its own hello (`this.deps.now()` at
   * {@link enter}). Held so the settle-window election can rank OURSELVES by the SAME shared tag it
   * ranks every remote peer by (design §11 "earlier live-presence arrival, then lower playerId"),
   * instead of the old bug that hardcoded self to `arrivalOrder: 0` and always elected itself.
   * `null` while offline / before an enter.
   */
  private myArrivalTag: number | null = null;

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
   * observable, never swallowed). A `resume`/`current` seed naming a game whose seats are all owned by
   * OTHER identities is likewise refused before the transport is touched, with the seat manager's own
   * typed reason as the join error ({@link buildProvisionalSeat}). A no-op if a session is already live
   * (`phase !== 'offline'`).
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
    // Stamp OUR own live-presence arrival tag once, from the injected clock — the SAME value we put
    // on our hello and the one the settle-window election ranks us by, so both peers compare the two
    // shared tags and agree on the winner (design §11).
    const myArrivalTag = this.deps.now();
    this.myArrivalTag = myArrivalTag;
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
    let provisional;
    try {
      // Learn when every game this browser already holds BEGAN, before we seed or adopt one, so a game
      // we return to is re-persisted with its original date instead of being re-stamped "now" (see
      // {@link primeStartedAts}). A store we cannot read fails the entry through the same honest path
      // as a seed we cannot load (below) — never a silently mis-dated archive.
      await this.primeStartedAts();
      provisional = await this.buildProvisionalSeat(code, proposal);
    } catch (err) {
      // A seed we cannot even LOAD — a corrupt/illegal archived log surfaces as an `ArchiveError` — is
      // a genuine FAILURE, not a refusal, so the error itself propagates VERBATIM (never masked, never
      // relabelled as one of the seat/reject reasons it is not). It must ALSO not leave this session
      // reporting `connecting` with no transport (a readout that lies), so we return to `offline`.
      //
      // And offline is not enough: with no `joinError` the panel repaints to a plain offline state and
      // the player is told NOTHING about why their Enter did nothing (the V.1 review finding). So we
      // set the DISTINCT `seed-unreadable` reason — its own typed reason with its own human label, not
      // a borrowed `connect-failed`/`game-mismatch` — and emit it, exactly as an admission reject is
      // surfaced. The re-throw still hands the real error to the caller (`main.ts` logs it), so the
      // failure is both visible to the player and diagnosable in the console.
      this.resetToOffline('seed-unreadable');
      this.emit();
      throw err;
    }
    if (provisional.kind === 'refused') {
      // The seed named a specific game we cannot honestly enter on. Either we HOLD it but its
      // identity-owned seat map owns no seat for us — both seats belong to other playerIds (design §2.3:
      // absence never vacates ownership), reachable whenever this browser's `pente:playerId` is lost
      // while its archive survives — or we do NOT hold it at all (`seed-unavailable`). Both refuse HERE,
      // before the transport is touched, surfacing the typed reason as the user-facing `joinError`
      // (design §7 — every refusal carries a human message) rather than entering on a game we could not
      // serve, which would put an unhonourable claim on the wire.
      this.resetToOffline(provisional.reason);
      this.emit();
      return;
    }
    const connected = await this.beginEngine(code, provisional.game, provisional.color, provisional.seatMap);
    if (!connected) return; // beginEngine surfaced connect-failed + reset to offline.

    // Announce our arrival so a resident/co-arriver reconciles against our proposal. The hello
    // carries the SAME `myArrivalTag` we stamped above (not a fresh `now()`), so the value a co-
    // arriver ranks us by in its election is IDENTICAL to the value we rank ourselves by in ours, and
    // the identity-owned seat map of the game we BRING (design §7 — a deferring arbiter seats itself
    // against that map instead of inventing a colour for a game whose owners it has never seen).
    this.publishAdmission(
      toHelloMessage(
        this.deps.newMessageId(),
        this.deps.playerId,
        proposal,
        provisional.seatMap,
        myArrivalTag,
      ),
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
   * alone it re-establishes from the game its breadcrumb names (`buildProvisionalSeat`). A no-op
   * returning `false` when there is no remembered room or a session is already live (the defensive
   * backstop for the `shouldReconnect` gate).
   *
   * WHY `defer` and not the game we were on: while we were away the pair may legitimately have moved
   * on — the peer played its turn (design §5's one-move auto fast-forward: *"they should be able to at
   * least reasonably play their turn while you step away"*), or started a new game. Naming our own
   * stale head as a `current` seed would turn those ordinary cases into `game-divergent` /
   * `seed-refused` refusals of our own room. So the RETURN is deliberately permissive — and that
   * permissiveness is bounded to the entry itself: the moment the entry resolves, the session gates on
   * the AGREED game ({@link SyncEngine.agreeOn}), so a reconnected peer is no more adoptable by a
   * passing publisher than any other (the seed does not stay a licence for the session's lifetime).
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
   * Build the PROVISIONAL game + seat this peer runs on until the settle window finalizes it. There
   * are exactly TWO sources — a game named by a UUID, or a genuinely fresh empty game. A room CODE is
   * never one of them (V.1, epic #47: the `net-room:{code}` game-per-code record is deleted; a code
   * is pure rendezvous and identifies no game — design §2):
   *
   *  - **`resume`/`current`** — load the game whose `uuid` the proposal names (design §3) from the
   *    archive, so our engine holds the SAME identity we publish in our hello. We reclaim the seat that
   *    game's persisted seat map owns for us (or take first-available white if it records no owner yet).
   *    A uuid this browser does NOT hold REFUSES the entry (`seed-unavailable`) — never a fall-through
   *    to a fresh game, which would announce a game we cannot serve and mislabel every refusal it
   *    causes downstream.
   *  - **`defer` (dealer's choice / a reconnect) with a FRESH `activeNetworkedGame` breadcrumb for
   *    THIS room** — re-seed the game the BREADCRUMB names, by UUID, from the archive. This is what
   *    carries a returning peer back onto the game it was mid-way through: it re-seeds an empty room
   *    as the color it owned (black stays black) instead of grabbing white by arrival (design §6.4,
   *    scenario 4), and carries a `reconnect()` back onto its in-progress game. The breadcrumb is
   *    SESSION state ("I am currently mid-game in room X as game Y"), not a mapping — it is
   *    single-valued, cleared on completion and expires quietly ({@link isActiveGameStale}); entering
   *    a DIFFERENT room, or returning long after, brings nothing. GATED to `defer` (issue #43): a
   *    `new` proposal is a "start over" request, so it must NOT adopt the breadcrumb's game — re-using
   *    a code with "New Game" mints a fresh one and REPLACES the breadcrumb.
   *  - **`new`, or `defer` with no usable breadcrumb** — a genuinely fresh game, first-available white
   *    on an empty map (true creation).
   *
   * This is the pre-settle placeholder so the engine is live to publish a hello + receive admission;
   * it is REPLACED by the resident's/initiator's authoritative game if we are admitted, and kept (as
   * the established game) only if we turn out to be alone.
   *
   * A `resume`/`current` seed comes back REFUSED for either of two honest reasons: we hold that exact
   * game but its persisted seat map owns both seats for OTHER playerIds, so there is no seat to enter it
   * on (see {@link seedFromUuid}); or this browser does not hold the named game at all
   * (`seed-unavailable`). Both are returned, not thrown — {@link enter} turns them into an honest
   * `joinError` and stays offline.
   */
  private async buildProvisionalSeat(
    code: string,
    proposal: Proposal,
  ): Promise<
    | { kind: 'seeded'; game: Game; color: SeatColor; seatMap: SeatMap }
    | { kind: 'refused'; reason: ClaimRejection | 'seed-unavailable' }
  > {
    // 1. A concrete resume/current: seed the actual game named by the proposal's uuid.
    if (proposal.kind === 'resume' || proposal.kind === 'current') {
      const seeded = await this.seedFromUuid(proposal.uuid);
      if (seeded.kind === 'seeded') return seeded;
      // We hold the game but own no seat in it → refuse the entry with the seat manager's own reason
      // rather than silently establishing some OTHER game under a `resume` proposal (which the
      // arbiter would then have to refuse as `game-mismatch` — a mislabeled version of this fact).
      if (seeded.kind === 'unclaimable') return { kind: 'refused', reason: seeded.reason };
      // The named game is NOT in this browser's archive. We refuse the entry with its own typed reason
      // rather than falling through to a fresh game: a `resume`/`current` announces THAT uuid in its
      // hello, so bringing an empty game instead would put a claim on the wire we cannot honour — and
      // every downstream consequence is then mislabelled (a peer proposing the SAME game gets
      // `game-mismatch`, "you and the other player brought different games", when both brought the
      // same one and this browser simply does not have it). There is nothing to degrade TO: the player
      // asked for a specific game, so the honest answer is that it is not here.
      return { kind: 'refused', reason: 'seed-unavailable' };
    }
    // 2. `defer` ("dealer's choice" / a reconnect) with a FRESH breadcrumb for THIS room: re-seed the
    //    game the breadcrumb NAMES BY UUID (design §2/§6.4, scenario 4) — the return path that keeps a
    //    returning owner on its in-progress game + owned color (#40/#35).
    //
    //    GATED to `defer` (issue #43): a `new` proposal is a request to START OVER, so it must NEVER
    //    adopt the breadcrumb's game — re-using a code with "New Game" mints a fresh one (case 3) and
    //    replaces the breadcrumb. Adopting the prior game for `new` was the #43 bug.
    //    (`resume`/`current` never reach here — they returned above with the game their uuid names.)
    if (proposal.kind === 'defer') {
      const uuid = this.resumableBreadcrumbUuid(code);
      if (uuid !== null) {
        const seeded = await this.seedFromUuid(uuid);
        // A breadcrumb naming a game we no longer hold — or one whose seats are owned by other
        // playerIds, so we could not sit down at it — falls through to a fresh game (the honest
        // degrade this branch promises: we bring an empty game rather than a wrong one). Unlike a
        // `resume`, a `defer` did not ASK for that specific game: the breadcrumb is a hint about what
        // we were last doing, so an unusable hint degrades to "dealer's choice" instead of refusing
        // an entry the player never aimed at a particular game.
        if (seeded.kind === 'seeded') return seeded;
      }
    }
    // 3. Genuine creation (a `new` proposal, or a `defer` with no owned seat here): a fresh empty game,
    //    first-available white on an empty map. claimSeat on an
    //    empty map always succeeds; assert rather than branch on an unreachable reject (keeps the
    //    tripwire, agent-principles).
    const game = new Game(this.deps.size);
    // First-available on an EMPTY map always succeeds — the reject branch (and presence) is
    // never reached; pass our own present-set for honesty.
    const claim = claimSeat(emptySeatMap(), this.deps.playerId, this.presentPeers);
    if (!claim.ok) throw new Error('provisional claim on an empty map must succeed');
    return { kind: 'seeded', game, color: claim.color, seatMap: claim.seatMap };
  }

  /**
   * Seed a provisional from the archived game whose stable `uuid` matches (a `resume`/`current`
   * proposal, or the game our breadcrumb names). Three OBSERVABLE outcomes, no throw:
   *
   *  - `seeded` — the reconstructed game + our seat + its persisted seat map. Our seat is a RECLAIM
   *    when that map already owns one for us, else first-available white (e.g. a local game being
   *    carried into a room for the first time, whose record has no owners yet).
   *  - `absent` — we hold no such game (nothing to seed from).
   *  - `unclaimable` — we DO hold the game, but its seat map owns both seats for other playerIds, so
   *    we cannot be a player of it. That is a real, reachable state (a game archived from a session
   *    whose `pente:playerId` this browser has since lost), and the seat manager's own typed reason
   *    (`seat-reserved` / `room-full`) is the honest account of it. The caller decides what to do with
   *    that fact — a `resume` refuses the entry with the reason, a `defer` degrades to a fresh game —
   *    because masking it here (as a throw, or as a silent fresh game) would either wedge `enter` or
   *    mislabel the outcome.
   */
  private async seedFromUuid(
    uuid: string,
  ): Promise<
    | { kind: 'seeded'; game: Game; color: SeatColor; seatMap: SeatMap }
    | { kind: 'absent' }
    | { kind: 'unclaimable'; reason: ClaimRejection }
  > {
    const loaded = await loadNetGameByUuid(this.deps.db, uuid);
    if (loaded === undefined) return { kind: 'absent' };
    const seatMap: SeatMap = loaded.seats ?? emptySeatMap();
    // Reclaim our owned seat, or take first-available on a map with a free seat. Presence is
    // immaterial to WHICH seat we get; it only colors the refusal reason, so pass our own snapshot.
    const claim = claimSeat(seatMap, this.deps.playerId, this.presentPeers);
    if (!claim.ok) return { kind: 'unclaimable', reason: claim.reason };
    return { kind: 'seeded', game: loaded.game, color: claim.color, seatMap: claim.seatMap };
  }

  /**
   * The gameUuid our `activeNetworkedGame` BREADCRUMB names, IF it is one we may re-seed from when
   * entering `code`, else `null` (`src/net/activeGame.ts`, design §2/§6). Three honest refusals:
   * no breadcrumb at all; a breadcrumb for a DIFFERENT room (session state says we were mid-game
   * somewhere else — entering this room brings nothing, and there is no per-code record to consult
   * because none exists); or one whose `updatedAt` is stale (it expires quietly rather than dragging
   * a days-old game into a live room).
   *
   * This is NOT a code→game lookup: the breadcrumb is a single record whose OWN code is compared
   * against the room we are entering. There is exactly one, and it is replaced (never accumulated)
   * whenever a session becomes live somewhere else.
   */
  private resumableBreadcrumbUuid(code: string): string | null {
    // The LIVE-SESSION half first (design §2 "Dual-tracked"): it is written by the same seam as the
    // localStorage half but SURVIVES a win, so a peer that drops after a decided game and comes back
    // still finds the game it just finished — rather than establishing a brand-new empty one over it
    // and orphaning the result (which is also what the rematch flow needs to stay reachable). The
    // localStorage half is the RELOAD path, and it deliberately holds no finished game.
    const crumb = this.activeGame ?? readActiveGame(this.deps.storage);
    if (crumb === null) return null;
    if (crumb.code !== code) return null;
    if (isActiveGameStale(crumb, this.deps.now())) return null;
    return crumb.gameUuid;
  }

  /**
   * The `startedAt` stamp this session archives a given game uuid with. Established ONCE per game and
   * then reused, from one of two sources:
   *
   *  - ADOPTED from the archive by {@link primeStartedAts} — a game this browser already holds began
   *    when it began, so a return/resume/adopt must write that same date back;
   *  - MINTED from the clock in {@link startedAtFor} for a game we are persisting for the first time
   *    (a genuinely new game, or one adopted from a peer that this browser has never archived).
   *
   * Reuse is what keeps the per-change autosave from re-stamping the record on every move and
   * shuffling it to the top of the (startedAt-sorted) archive listing. Both halves are asserted in
   * `session.test.ts` ("stamped ONCE per game", "a return PRESERVES the archived startedAt").
   */
  private readonly startedAts = new Map<string, number>();

  /**
   * Prime {@link startedAts} from the archive so every game this browser ALREADY HOLDS keeps the date
   * it began on when we re-persist it.
   *
   * Without this, `startedAtFor` mints a fresh stamp for any uuid this JS session has not persisted
   * yet — which silently REWRITES the archived `startedAt` of every game we return to (a breadcrumb
   * return, a `resume`/`current` seed, or an arbiter's game we adopt over the wire and happen to hold
   * archived). That is user-visible: {@link listArchivedGames} sorts by `startedAt` and the games list
   * renders it as the game's date, and that list is the only route back to a game (design §10, #37).
   *
   * Runs once per {@link enter}, BEFORE any game is seeded or adopted, over the archive's metadata
   * cursor (no logs are folded). Doing it here — rather than at each persist — keeps the stamp lookup
   * SYNCHRONOUS afterwards, which the design requires: the app's autosave reads {@link gameStartedAt}
   * synchronously on the same state change the session persists on, so an async read per write would
   * let the two writers of one record disagree about its date.
   */
  private async primeStartedAts(): Promise<void> {
    for (const [uuid, startedAt] of await archivedStartedAts(this.deps.db)) {
      this.startedAts.set(uuid, startedAt);
    }
  }

  /** The `startedAt` for `uuid` — the stamp established for it (minted here on genuinely first use). */
  private startedAtFor(uuid: string): number {
    const known = this.startedAts.get(uuid);
    if (known !== undefined) return known;
    const stamp = this.deps.now();
    this.startedAts.set(uuid, stamp);
    return stamp;
  }

  /**
   * The most recent durable {@link persistGame} write in flight, exposed via {@link whenPersisted}.
   * A caller that must observe this game's persisted state on a LATER return (the empty-room reclaim)
   * awaits it after {@link enter}, so it reads a COMMITTED write, not a racing one — the durability
   * guarantee is deterministic, never a "usually committed by then" flake (agent-principles #2: proof
   * must be reliably observable). A rejected write surfaces through {@link whenPersisted} rather than
   * being silently swallowed. `enter` itself does NOT block on it (see {@link finishEnter}).
   */
  private pendingPersist: Promise<void> = Promise.resolve();

  /**
   * Persist the authoritative game + its identity-owned seat map into the archive UNDER THE GAME'S
   * OWN UUID (design §2: "games keyed by UUID" are the source of truth). This is the durable value a
   * later return re-seeds from — reached via the breadcrumb's uuid or the games list (#37), NEVER via
   * the room code: the record is keyed by the game, so re-using a code can no longer resurrect it
   * (the #43/#46 root cause). It is an ORDINARY archive record — no internal marker, nothing hidden
   * from the listing.
   *
   * Called on every engine change plus every establish/admit/arbitrate/rematch, so the stored bytes
   * are the live log rather than a snapshot from entry time. Records the in-flight write in
   * {@link pendingPersist} so a test/caller can await durability; a failed write rejects honestly
   * (never a swallowed error).
   */
  private persistGame(): Promise<void> {
    const engine = this.engine;
    if (engine === null || this.seatMap === null) return Promise.resolve();
    const game = engine.game();
    const winner = game.state().winner;
    const write = saveGame(this.deps.db, game.uuid, game, {
      // The seat OWNERS are the honest "players" of a networked game (real playerIds, no sentinel).
      players: playersFromSeats(this.seatMap),
      result: winner === null ? 'in-progress' : `${winner}-wins`,
      startedAt: this.startedAtFor(game.uuid),
      seats: this.seatMap,
    });
    this.pendingPersist = write;
    return write;
  }

  /**
   * The `activeNetworkedGame` breadcrumb's **JS-var half** (design §2: "Dual-tracked: localStorage for
   * reload recovery, a JS var for the live session — the JS var survives a win so the rematch flow
   * works; localStorage is re-set only on mutual rematch").
   *
   * Written by {@link markActiveGame} alongside the localStorage half, but — unlike it — NOT cleared
   * when the game is decided: within one live session (a drop-and-return, a rematch) the just-finished
   * game must stay reachable, or the returning peer establishes a fresh empty game and ORPHANS the
   * result. It carries the same `updatedAt`, so {@link isActiveGameStale} judges it by the same rule,
   * and it dies with the JS session — a brand-new browser session after a decided game reaches that
   * game through the games list (design §6/§10, #37), never through a stale "currently mid-game" claim.
   */
  private activeGame: ActiveNetworkedGame | null = null;

  /**
   * Record — or CLEAR — the `activeNetworkedGame` BREADCRUMB for the live session (design §2).
   *
   * It says "I am CURRENTLY mid-game in room X as game Y". Both halves are refreshed while the game is
   * live; when the game is DECIDED the two diverge deliberately (design §2 "dual-tracked"):
   *
   *  - the **localStorage** half is CLEARED — a reload must not prompt to rejoin a game that is over;
   *  - the **JS-var** half ({@link activeGame}) survives, so this session's own return / rematch still
   *    finds the finished game instead of silently replacing it with an empty one.
   *
   * Neither is cleared on {@link disconnect} — a background drop / tab reload is exactly what the
   * breadcrumb exists to recover from — and neither is ever published (local session state, not
   * protocol state).
   */
  private markActiveGame(): void {
    const engine = this.engine;
    const code = this.code;
    if (engine === null || code === null) return;
    const game = engine.game();
    const crumb: ActiveNetworkedGame = {
      code,
      gameUuid: game.uuid,
      updatedAt: this.deps.now(),
    };
    this.activeGame = crumb;
    if (game.state().winner !== null) {
      clearActiveGame(this.deps.storage);
      return;
    }
    writeActiveGame(crumb, this.deps.storage);
  }

  /**
   * Persist the live game (by uuid) AND refresh the breadcrumb — the two halves of "what this session
   * leaves behind", kept together so no call site can update one and forget the other. The archive
   * write is fire-and-forget durability (awaitable via {@link whenPersisted}); the breadcrumb is
   * synchronous localStorage.
   */
  private saveSessionState(): void {
    void this.persistGame();
    this.markActiveGame();
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
      //
      // BUT: an admission `reject` can arrive and settle us offline WHILE this connect is still
      // in flight (the reject handler tears the transport down, which then makes this very connect
      // throw). In that race the reject reason is the TRUE outcome — do NOT overwrite it with a
      // generic `connect-failed`. We detect it by identity: `this.transport` is nulled/replaced the
      // moment something else settled us, so a mismatch means "already handled — leave joinError as
      // the reject reason it set" (design §7: the reject reason must survive to the net panel).
      if (this.transport === transport) {
        transport.disconnect();
        this.resetToOffline('connect-failed');
        this.emit();
      }
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
    // The engine carries THIS player's seed so the move-sync channel applies the design §3 rule to a log
    // belonging to a DIFFERENT game (`SyncEngine`'s seed gate) — the third place a game can cross into
    // this browser, and the one the admission protocol never sees.
    const engine = new SyncEngine(
      game,
      transport,
      this.deps.db,
      meta,
      color as Player,
      this.myProposal ?? { kind: 'new' },
    );
    this.engine = engine;
    // Reset the handshake for the new session — a fresh room has no pending proposal from a prior one.
    this.handshake = initialHandshake();
    // Re-emit on EVERY engine game change — crucially including a REMOTE move adopted by the
    // transport pump (which mutates the engine's game silently). This is the resync link that makes
    // a peer's move re-render the scene (issue #4). A conflict also folds the engine status into the
    // phase here. AUTO-CANCEL on GAME-ADVANCED (N.1 guardrail): a landed move drops any stale proposal.
    engine.onChange(() => {
      this.setHandshake(onGameAdvanced(this.handshake));
      // Keep the durable, uuid-keyed archive record and the breadcrumb CURRENT with every accepted
      // move (local or adopted): the archive is the source of truth a returning peer re-seeds from
      // (design §2), so persisting only at entry would hand a returner a snapshot from before the
      // moves it missed. A decided game CLEARS the breadcrumb here (see `markActiveGame`).
      this.saveSessionState();
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

    // Simultaneous arrival → elect the initiator deterministically over the SHARED arrival tags:
    // ourselves ranked by the tag we stamped on our own hello, each co-arriver by the tag on ITS
    // hello. Because both peers compare the identical pair of tags (earlier arrival, then lower
    // playerId), they independently elect the SAME initiator — no double-establish even when both
    // settle timers fire before either admit crosses a real relay (design §4 Case 2 / §11). This
    // replaces the old bug that hardcoded self to `arrivalOrder: 0` (so every peer elected itself).
    const myArrivalTag = this.myArrivalTag;
    if (myArrivalTag === null) throw new Error('election requires our own arrival tag');
    const peers: Peer[] = [
      { playerId: this.deps.playerId, arrivalOrder: myArrivalTag },
      ...others.map((h) => ({ playerId: h.playerId, arrivalOrder: h.arrivalTag })),
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
   * hello), persist the game + refresh the breadcrumb, and reach `connected`. The provisional was
   * already seeded by {@link buildProvisionalSeat} — a FRESH game + first-available white for genuine
   * creation, or the game our breadcrumb named + our reclaimed seat when we are RETURNING (design
   * §6.4), so a returning owner re-seeds an empty room as the color it owned, not white-by-arrival.
   */
  private establishAlone(): void {
    this.established = true;
    // Entry is resolved: this game is the one this session is on, so the move-sync channel gates on IT
    // from here rather than on the entry seed (see {@link SyncEngine.agreeOn} / `GameGate` — without
    // this a `defer`/reconnect entry would keep accepting ANY game a publisher offered, forever).
    this.agreeOnLiveGame();
    this.reflectEngineStatus();
    if (this.phase === 'connecting') this.phase = 'connected';
    // Persist the game (by uuid) + record the breadcrumb, so a later return into an empty room re-seeds
    // this game and reclaims by identity (design §6.4). Fire-and-forget the durable write — a failure
    // rejects honestly (unhandled), never masked; the in-memory state is already correct for this session.
    this.saveSessionState();
    this.emit();
  }

  /**
   * ESTABLISH the room as the elected initiator (design §4 Case 2 "two arrived together"): keep OUR
   * provisional game + reclaimed seat as the authoritative one, then reconcile every co-arriver's
   * proposal against ours, seat each admitted peer onto the durable map, and publish an `admit`
   * (agreed game + seat map) or a typed `reject` to each. We become the arbiter.
   *
   * Crucially we START from the PROVISIONAL seat map {@link buildProvisionalSeat} already populated
   * — NOT a fresh `emptySeatMap()` that would grab first-available WHITE. That provisional map holds
   * the color we OWN (reclaim-by-identity, design §2.3/§6.4): a returning owner of BLACK that wins
   * the election re-seeds as BLACK, exactly as `establishAlone` keeps its reclaimed color. Seeding
   * from empty here would violate reclaim-by-identity (the #2 review finding). Our own seat is
   * already recorded in the provisional map (asserted below as a tripwire, not silently assumed).
   */
  private establishAsInitiator(others: readonly HelloMessage[]): void {
    // Keep the seat + durable map buildProvisionalSeat seeded for US (our reclaimed color, or first-
    // available white for a genuine creation). Our own seat MUST already be owned in that map — the
    // provisional claim seated us before we ever published a hello; assert rather than re-claim on an
    // empty map (which would discard a reclaimed BLACK and grab white).
    let seatMap = this.seatMap;
    if (seatMap === null || this.seat === null || seatOf(seatMap, this.deps.playerId) === null) {
      throw new Error('initiator must already own a seat in its provisional map');
    }

    // Entry is resolved on OUR game before we answer anybody, so the move-sync channel gates on it
    // rather than on the entry seed. Arbitration may still move us onto a co-arriver's game (the
    // deferring-arbiter row), and `admitOntoNewcomerGame` re-points the agreement at THAT game itself —
    // which is why this runs first and is not re-derived afterwards.
    this.agreeOnLiveGame();

    // Arbitrate every co-arriver against ours; a divergent/mismatched pair is a typed reject to THAT
    // peer (design §5). We keep the game our engine holds — `arbitrate` judges the newcomer's seed
    // against exactly that, and never against a proposal naming a game we do not have — EXCEPT when we
    // deferred, where it admits the co-arriver onto ITS game and we adopt that instead (design §3).
    for (const hello of others) {
      seatMap = this.arbitrate(hello, seatMap);
    }
    this.seatMap = seatMap;
    this.established = true;
    this.reflectEngineStatus();
    if (this.phase === 'connecting') this.phase = 'connected';
    this.saveSessionState();
    this.emit();
  }

  /**
   * Arbitrate ONE newcomer's `hello` against the current durable `seatMap` (design §3/§4/§5): reconcile
   * its proposal against ours, check that the newcomer's SEED accepts the game we would actually serve,
   * validate its seat, and publish an `admit` (agreed game + updated seat map) or a TYPED `reject`.
   * Returns the (possibly-updated) seat map. Shared by the initiator
   * ({@link establishAsInitiator}) and the live arbiter ({@link onHello}) so both apply IDENTICAL
   * rules — the single arbitration path, never two subtly-different copies.
   */
  private arbitrate(hello: HelloMessage, seatMap: SeatMap): SeatMap {
    // WIRE ENFORCEMENT (design §3; the user's rule in #46) — the SENDING half, decided by the ONE pure
    // rule {@link decideAdmission} rather than re-composed here. It judges the newcomer's seed against
    // the game our ENGINE ACTUALLY HOLDS, not the one our proposal named: OUR proposal may have been
    // `new` while our board has since moved on (a resident can play while alone), so
    // `reconcile(new, new)` agrees on "a fresh game" our engine no longer holds. That is the structural
    // #46/#43 fix on the serving side — "New Game" can never be handed a game in progress, whoever is
    // arbitrating — and it is where DEALER'S CHOICE ADOPTS in the direction where the deferrer is the
    // arbiter: it holds nothing, so the agreed game is the newcomer's and we admit it to keep its own.
    //
    // Decided BEFORE `claimSeat` so a refused newcomer never occupies a seat in our durable map for a
    // game it is never going to play (the reject is about the GAME, and it settles the entry).
    const engine = this.requireEngine();
    const payload = toSyncMessage(engine.game().log, engine.epoch());
    const decision = decideAdmission(
      this.myProposal ?? { kind: 'new' },
      offeredGameOf(payload),
      hello.proposal,
    );
    if (!decision.ok) {
      this.publishAdmission(toRejectMessage(this.deps.newMessageId(), hello.playerId, decision.reason));
      return seatMap;
    }
    if (decision.serve === 'theirs') {
      // DEALER'S CHOICE ADOPTS with US as the arbiter (design §3): the agreed game is the NEWCOMER's,
      // and so are its seats — a different map, decided against different owners (see below).
      return this.admitOntoNewcomerGame(engine, hello, decision.uuid, seatMap);
    }
    // Reconciled + serveable → seat the newcomer (identity-reclaim or first-available on the map).
    // The present-set decides the REFUSAL reason when both seats are owned: `room-full` if every
    // owner is present (scenario 1 — a full active game), `seat-reserved` if a blocking owner is
    // ABSENT (scenario 5 — the arbiter survives, but the dropped owner's seat is held for its
    // return). The newcomer is in `presentPeers` (it just announced via a hello → presence), so an
    // absent OTHER owner is the sole way to reach `seat-reserved`.
    const claim = claimSeat(seatMap, hello.playerId, this.presentPeers);
    if (!claim.ok) {
      this.publishAdmission(toRejectMessage(this.deps.newMessageId(), hello.playerId, claim.reason));
      return seatMap;
    }
    // Admit with the very payload the acceptance was judged against — so what we CHECKED and what we
    // SEND can never be two different games.
    this.publishAdmission(toAdmitMessage(this.deps.newMessageId(), hello.playerId, payload, claim.seatMap));
    return claim.seatMap;
  }

  /**
   * Admit a newcomer onto the game IT brought — design §3's dealer's-choice row in the direction where
   * the DEFERRER is the arbiter. We hold nothing worth keeping (`decideAdmission` only reaches here for
   * a `defer` seed whose own game is still EMPTY), so the pair plays the newcomer's game and WE move.
   *
   * Moving means the SEATS move too. Seats are identity-owned ON THE GAME (design §7), and the game we
   * are moving onto already has owners — possibly including an ABSENT third player whose seat is
   * reserved (design §2.3: "absence never vacates ownership"). Our own provisional map describes a
   * different game entirely and has no authority over this one, so we claim OUR seat against the map
   * the hello carried FOR THAT GAME:
   *
   *  - the newcomer keeps the colour it owns there (it is not re-negotiated onto ours);
   *  - an absent third owner keeps its seat, and if that leaves nothing for us the entry is REFUSED
   *    with the seat manager's own typed reason (`seat-reserved` / `room-full`) — we do not get to
   *    evict an owner by being the arbiter;
   *  - both peers then persist THAT game's own map under THAT game's uuid, so a later reclaim/resume
   *    reads the ownership the game always had.
   *
   * We agree onto the game BEFORE publishing the admit, so the newcomer's answering publish is one this
   * channel accepts ({@link SyncEngine.agreeOn}) however fast it arrives, and we re-seat the engine on
   * the claimed colour so the turn gate and the restricted-undo rule read the seat we actually own
   * there. The game itself is adopted through the ORDINARY move-sync seam when the newcomer publishes
   * it, so the archive record + breadcrumb follow the game we really end up on rather than a guess.
   */
  private admitOntoNewcomerGame(
    engine: SyncEngine,
    hello: HelloMessage,
    uuid: string,
    seatMap: SeatMap,
  ): SeatMap {
    const claim = claimSeat(hello.seats, this.deps.playerId, this.presentPeers);
    if (!claim.ok) {
      this.publishAdmission(toRejectMessage(this.deps.newMessageId(), hello.playerId, claim.reason));
      return seatMap;
    }
    if (seatOf(claim.seatMap, hello.playerId) === null) {
      // The newcomer announced a map for its own game that seats SOMEBODY ELSE in both seats and not
      // itself — a map no honest client produces (a peer always claims its seat before it announces).
      // Admitting it would durably record a game whose two owners are absent strangers, so refuse with
      // the same reason a full room gives rather than persist a seating nobody present owns.
      this.publishAdmission(toRejectMessage(this.deps.newMessageId(), hello.playerId, 'room-full'));
      return seatMap;
    }
    // Take the seat we own in THEIR game, and agree onto that game BEFORE the admit goes out: the
    // newcomer publishes its log the moment it handles the admit, and this is what makes that log one
    // we accept (the move-sync gate) instead of a foreign game.
    this.seat = claim.color;
    this.seatMap = claim.seatMap;
    engine.reseat(claim.color as Player);
    engine.agreeOn(uuid);
    this.publishAdmission(toAdoptAdmitMessage(this.deps.newMessageId(), hello.playerId, uuid, claim.seatMap));
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
   *
   * An `admit`/`reject` ADDRESSED TO ANOTHER PEER is dropped here. The relay gives a room ONE topic,
   * so every admission message reaches everyone, and the arbiter answers each `hello` individually:
   * without this check a refusal aimed at one newcomer settles a DIFFERENT one offline — carrying a
   * reason for a choice it never made — and a grant aimed at one newcomer is read by another, which
   * finds itself unseated in the enclosed map and tears itself down as `room-full`. Both were
   * reachable with three peers arriving together (a `current` resident, a `new` newcomer refused
   * `seed-refused`, and an innocent dealer's-choice peer knocked out by it), and `seed-refused` makes
   * exactly that mixed-seed room a routine case. A `hello` is deliberately NOT addressed: it is an
   * announcement to the room, and every peer needs it for the settle-window election.
   */
  private onAdmission(msg: AdmissionMessage): void {
    switch (msg.kind) {
      case 'hello':
        this.onHello(msg);
        return;
      case 'admit':
        if (msg.to !== this.deps.playerId) return;
        this.onAdmit(msg);
        return;
      case 'reject':
        if (msg.to !== this.deps.playerId) return;
        this.onReject(msg);
        return;
    }
  }

  /** Handle a peer's `hello`: arbitrate it if established, else record it for the settle election. */
  private onHello(hello: HelloMessage): void {
    // Record the hello (keyed by playerId) so the settle-window election ranks this peer by the
    // arrivalTag IT stamped — the shared value both peers compare, not a local receive order.
    if (!this.seenHellos.has(hello.playerId)) {
      this.seenHellos.set(hello.playerId, hello);
    }
    if (!this.established || this.engine === null || this.seatMap === null) return;

    // We are the live ARBITER (design §4 Case 1): arbitrate the newcomer against our durable seat map
    // (the SAME rule the initiator applies), updating our seat map with the seat it granted.
    this.seatMap = this.arbitrate(hello, this.seatMap);
    // Persist the updated durable seat map so a reserved/absent owner survives our own later drop.
    this.saveSessionState();
    this.emit();
  }

  /**
   * Handle the arbiter's `admit`. The grant names WHICH game the pair agreed on ({@link AdmittedGame}),
   * and the two directions are handled differently:
   *
   *  - **the arbiter SERVES it** — ENFORCE OUR OWN SEED against the offered game (design §3 — a `new`
   *    entry adopts an EMPTY game only; only dealer's choice adopts a peer's real game), then ADOPT it
   *    wholesale. The admit game has a DIFFERENT genesis uuid than our provisional game, so it cannot go
   *    through the prefix-based sync `receive` (that is same-uuid convergence, and two empty logs with
   *    different uuids would falsely CONFLICT). Instead we re-verify the payload's hash chain
   *    ({@link parseSyncMessage} — a tampered/mismatched payload throws honestly, never a masked
   *    adoption) and swap the reconstructed game into a fresh engine over the SAME live transport.
   *  - **the arbiter DEFERRED and the agreed game is OURS** — it holds nothing and named our game by
   *    uuid, so there is nothing to adopt: we KEEP the game we brought (its history is already ours,
   *    already hash-verified when we seeded it) and only take the seat. A named uuid that is not the
   *    game we brought is refused `game-mismatch` — the arbiter agreed us onto a game neither of us is
   *    on, which is exactly what that reason says.
   *
   * Either way we then take the seat the map assigns us and publish once so the two peers converge — for
   * the deferring arbiter that publish IS how it receives the game it just adopted us onto. A game our
   * seed refuses, or a seat map that does not seat us, ends the entry with a TYPED reason (never a silent
   * adoption). Only fires while `connecting`; a duplicate racing an establish is ignored.
   */
  private onAdmit(admit: AdmitMessage): void {
    if (this.phase !== 'connecting') return; // already finalized (e.g. a duplicate racing an establish).
    const engine = this.engine;
    const transport = this.transport;
    // Both are live for the whole of `connecting` (`enter` built them before publishing our hello and
    // only a settle/admit/reject tears them down), so this is a tripwire, not a branch we expect.
    if (engine === null || transport === null) return this.finishEnter();
    // WIRE ENFORCEMENT (design §3) — the RECEIVING half, and the honest answer to the user's rule in
    // #46: *"i would expect my phone to reject any non-empty gamestate data"* when it chose New Game.
    // The arbiter applied the SAME pure rule before admitting us, so reaching a refusal here means the
    // peer did not enforce it (an older or modified client) — precisely the case the threat model says
    // we must survive on our own ("the opponent's client is the validator", design §5). We re-judge the
    // bytes we were ACTUALLY sent against OUR OWN seed and refuse honestly rather than silently adopting
    // a game we did not ask for, surfacing the typed reason verbatim (lastReject + joinError) exactly as
    // an arbiter reject. Checked before the seat, mirroring `arbitrate`'s order (the game first).
    //
    // A `null` proposal is unreachable here (`onAdmit` only runs while `connecting`, which means `enter`
    // set one); `new` is the conservative stand-in — the one seed that accepts nothing but an empty
    // game — so an impossible null can never be the reason we adopt a game unchecked.
    //
    // The `'newcomer'`-sourced grant needs no seed check: the game is the one WE brought, so our own seed
    // accepts it by construction (a `resume`/`current` accepts its own uuid; that identity IS the check
    // below). Re-running `acceptsGame` on our own game would be a branch that can never refuse.
    const refusal =
      admit.agreed.source === 'arbiter'
        ? acceptsGame(this.myProposal ?? { kind: 'new' }, offeredGameOf(admit.agreed.game))
        : admit.agreed.uuid === engine.game().uuid
          ? { ok: true as const }
          : { ok: false as const, reason: 'game-mismatch' as const };
    if (!refusal.ok) {
      this.lastReject = refusal.reason;
      this.tearDownToOffline(refusal.reason);
      return this.finishEnter();
    }
    const mySeat = seatOf(admit.seats, this.deps.playerId);
    if (mySeat === null) {
      // The admit does not seat us — treat as an honest room-full-style refusal (we own no seat) and
      // surface it as the human join error (design §7), not a silent drop. `tearDownToOffline` carries
      // the reason to the emit so the net panel shows it (unlike a bare `disconnect()` which nulls it).
      this.lastReject = 'room-full';
      this.tearDownToOffline('room-full');
      return this.finishEnter();
    }
    // The game we run from here: the arbiter's payload (hash chain re-verified, identity + history
    // intact), or — when it deferred onto OUR game — the very game our provisional engine already holds.
    const game =
      admit.agreed.source === 'arbiter'
        ? Game.fromLog(this.deps.size, parseSyncMessage(admit.agreed.game))
        : engine.game();
    // Swap the agreed game + our admitted seat into a fresh engine over the SAME transport (no
    // reconnect / presence flicker). ATTACH re-registers the transport's message pump onto the NEW
    // engine (the old provisional engine registered it on connect; "latest registration wins"), so a
    // subsequent move is delivered to THIS engine and renders — then publishes our adopted state.
    const admitted = this.wireEngine(transport, game, mySeat, admit.seats);
    // Entry is resolved: THIS is the game the pair agreed on, so the move-sync channel gates on it from
    // here rather than on our entry seed — otherwise a `defer` entry (every Join, every reconnect)
    // would go on accepting any game any publisher offered for the rest of the session.
    admitted.agreeOn(game.uuid);
    admitted.attach();
    this.reflectEngineStatus();
    if (this.phase === 'connecting') this.phase = 'connected';
    // Persist the ADOPTED game under ITS uuid + point the breadcrumb at it, so if the arbiter later
    // leaves and we become the sole resident, our own return reclaims this seat + game by identity
    // (design §2/§6.4). This is what makes scenario 4 (both drop, both rejoin) preserve ownership.
    this.saveSessionState();
    this.emit();
    this.finishEnter();
  }

  /**
   * Handle the arbiter's typed `reject`: record the machine reason (for the debug/e2e readout) AND
   * surface it as the human-facing {@link joinError} that the net panel renders, then go offline
   * (design §7 — EVERY reject carries a human message, never a silent drop). Every
   * {@link AdmissionReject} reason (`room-full` / `seat-reserved` / `game-mismatch` /
   * `game-divergent`) is also a {@link JoinErrorReason}, so the reason flows through
   * {@link tearDownToOffline} INTO `resetToOffline(reason)` and survives to the emit — unlike the
   * round-3 bug where `disconnect()` (→ `resetToOffline(null)`) nulled it before any emit.
   */
  private onReject(reject: RejectMessage): void {
    if (this.phase !== 'connecting') return;
    this.lastReject = reject.reason;
    this.tearDownToOffline(reject.reason);
    this.finishEnter();
  }

  /**
   * Resolve the pending {@link enter} promise exactly once (settle → establish/admit/reject done).
   * Deliberately does NOT block on the durable {@link persistGame} write: `enter` reports the
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
   * The `startedAt` stamp this session archives the LIVE game's record with, or `null` when there is no
   * live game. Read by the app's autosave (`main.ts`), which writes the SAME uuid-keyed record while a
   * networked game is authoritative, so both writers stamp the record identically instead of alternately
   * re-dating it (which would jitter the games-list order between two values).
   *
   * It is the game's date, not this session's clock: {@link startedAts} adopts what the archive already
   * holds for a game we returned to and only mints for a game being persisted for the first time. Both
   * this readout and the record it stamps are asserted after a real page reload + re-entry in
   * `e2e/breadcrumbReload.spec.ts` (the wiring `main.ts` is excluded from unit coverage for).
   */
  gameStartedAt(): number | null {
    const engine = this.engine;
    if (engine === null) return null;
    return this.startedAtFor(engine.game().uuid);
  }

  /**
   * Resolve once the most recent durable {@link persistGame} write has COMMITTED (design §2/§6.4).
   * A return that must observe this game's persisted seat map + log (the empty-room reclaim) awaits
   * this after {@link enter} so it reads a settled write, not a racing one — the
   * durability is deterministic rather than "usually committed by then" (agent-principles #2: proof
   * must be reliably observable). Resolves immediately when nothing was persisted (a reject/offline
   * entry). A failed write rejects here rather than being swallowed.
   */
  async whenPersisted(): Promise<void> {
    await this.pendingPersist;
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
    if (this.engine === null || this.seat === null || this.seatMap === null) return false;
    const me = this.deps.playerId;
    // Alternate the WHOLE identity-owned seat map (a pure involution: white↔black), NOT just this
    // client's own color. Both peers alternate their own copy of the same map deterministically, so
    // the swap needs no coordination and stays identity-stable: {white:A,black:B} → {white:B,black:A}.
    // This is the durable ownership a later reconnect reclaims from — leaving it at the PRE-swap map
    // (the #40 bug) let a resident arbiter re-admit a returner onto its OLD color → two same-color
    // seats → turn-gate deadlock.
    const swapped = alternateSeats(this.seatMap);
    const nextColor = seatOf(swapped, me) ?? this.seat;
    this.seat = nextColor;
    this.seatMap = swapped;
    // Swap a fresh empty game into the live engine over the SAME transport, re-basing the undo rule
    // onto the swapped color and bumping the epoch so the peer adopts the fresh generation.
    //
    // The fresh game's uuid is DERIVED, not randomized ({@link rematchGameUuid}): both peers reset into
    // the same rematch from the same prior game at the same generation, so deriving from those two shared
    // facts puts them on ONE game at genesis. Independently-minted random ids left each peer on its own
    // game — two archive records for one rematch, converging only by the accident that an empty log is a
    // prefix of anything, which is precisely the adoption the design §3 seed gate must be free to refuse.
    const priorUuid = this.engine.game().uuid;
    const nextEpoch = this.engine.epoch() + 1;
    this.engine.resetGame(
      new Game(this.deps.size, rematchGameUuid(priorUuid, nextEpoch)),
      nextColor as Player,
    );
    // Persist the SWAPPED seat map + the fresh rematch game under the NEW game's uuid, and re-point the
    // breadcrumb at it (design §2/§6.4) — reusing the SAME durable seam `enter`/establish use, so a
    // subsequent return (empty-room reclaim OR resident re-admission) reclaims the CURRENT color and the
    // CURRENT game, not the stale pre-swap ones (#40 fix). Records the write in `pendingPersist` so
    // `whenPersisted()` observes durability; a failure rejects honestly.
    this.saveSessionState();
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
    this.tearDownToOffline(null);
  }

  /**
   * Tear the transport down and return to `offline`, carrying an optional {@link JoinErrorReason}
   * INTO {@link resetToOffline} so it survives to the {@link emit} (design §7: a reject must surface
   * a human reason). {@link disconnect} passes `null` (a clean leave); {@link onReject} passes the
   * typed reject reason so the net panel shows exactly why — WITHOUT `resetToOffline(null)` nulling
   * the reason first (the round-3 silent-failure bug: setting `joinError` then calling `disconnect`
   * overwrote it before any emit reached the widget).
   */
  private tearDownToOffline(err: JoinErrorReason | null): void {
    if (this.transport !== null) this.transport.disconnect();
    this.resetToOffline(err);
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

  /**
   * Tell the engine that the game it is running is the one this session has SETTLED on
   * ({@link SyncEngine.agreeOn}) — called at each point entry resolves (establish alone / as
   * initiator). From that moment the move-sync channel gates cross-game traffic on the AGREED GAME
   * instead of the entry seed, which is what stops a `defer` entry (Join, and every auto-reconnect)
   * from accepting a stranger's game for the rest of the session. A no-op offline (nothing to agree).
   */
  private agreeOnLiveGame(): void {
    const engine = this.engine;
    if (engine !== null) engine.agreeOn(engine.game().uuid);
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
    this.presentPeers = new Set();
    this.joinError = err;
    this.established = false;
    this.myProposal = null;
    this.seenHellos.clear();
    this.myArrivalTag = null;
    this.phase = 'offline';
  }

  /** Presence handler: mark the peer present iff any peer OTHER than us is in the room. */
  private onPresence(peers: readonly string[]): void {
    // Record the full present-id snapshot (always including ourselves) so the arbiter's
    // claimSeat can distinguish `room-full` (all owners present) from `seat-reserved` (a
    // blocking owner absent). Kept in sync on EVERY presence tick, even when the boolean
    // peerPresent is unchanged (e.g. a third peer arrives while one was already present).
    this.presentPeers = new Set([this.deps.playerId, ...peers]);
    const others = peers.filter((id) => id !== this.deps.playerId);
    const present = others.length > 0;
    // RE-ANNOUNCE our hello when a peer JOINS while we are still resolving our OWN entry (design §4
    // Case 2 "each sees the other within the window"). Our FIRST hello was published in `enter`
    // BEFORE any co-arriver had subscribed, so a peer that connects a moment later never received it
    // and — seeing no hello from us — would wrongly decide it is "truly alone" and establish,
    // producing a double-white. Re-carrying the SAME proposal + arrivalTag now makes our hello reach
    // the newcomer so BOTH peers see each other within the window and run the identical election.
    // Only while `connecting` (pre-settle, not yet established/admitted): an established arbiter must
    // NOT re-announce a hello (it answers newcomers with admit/reject, never re-enters the election),
    // and a re-announce is idempotent for the newcomer (its own dedup-by-id would drop a stale
    // repeat, but each re-announce carries a FRESH id so it is delivered — the arrivalTag it ranks us
    // by is unchanged, so the election outcome is stable no matter how many times it is re-heard).
    if (present && !this.peerPresent && this.phase === 'connecting' && this.myProposal !== null && this.myArrivalTag !== null) {
      this.publishAdmission(
        toHelloMessage(
          this.deps.newMessageId(),
          this.deps.playerId,
          this.myProposal,
          // The SAME provisional map the first hello carried (our seat in the game we brought) — a
          // re-announce must be identical in substance or the two hellos would describe two games.
          this.seatMap ?? emptySeatMap(),
          this.myArrivalTag,
        ),
      );
    }
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
