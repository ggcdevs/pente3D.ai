import { createScene } from './render/scene.ts';
import { createUi } from './ui/setup.ts';
import { onConfigChange } from './config/config.ts';
import { installInspectApi } from './debug/window.ts';
import { createLogger } from './debug/log.ts';
import { createAppNetSession } from './net/appSession.ts';
import { shouldRenderSessionGame } from './net/netRouting.ts';
import { shouldArchiveBeforeNetStart } from './net/rematch.ts';
import { deriveEndState, REMATCH_ACTION, type EndState } from './net/endState.ts';
import type { DivergenceView } from './ui/widgets/divergenceModel.ts';
import type { ResolutionChoice } from './net/resolution.ts';
import { NotifyGlue, type NotifyReadout, type NotificationApi } from './net/notifyGlue.ts';
import type { SeatMap } from './net/seats.ts';
import type { AdmissionReject } from './net/sync.ts';
import { headHash } from './core/eventLog.ts';
import { openDatabase, resolveDbName, type GameListing } from './persist/db.ts';
import {
  saveGame,
  loadGame as loadArchivedGame,
  loadConflicted,
  listArchivedGames,
  loadNetGameByUuid,
  archivedIdentity,
  archivedStartedAts,
  isEmptyShell,
  purgeLegacyNetRoomRecords,
  purgeEmptyShellRecords,
  rekeyArchiveRecordsByGameUuid,
  StartedAtLedger,
  type ArchivedMeta,
  type PersistedSeats,
} from './persist/archive.ts';
import type { Game } from './core/game.ts';
import type { ArchiveListing } from './ui/widgets/archiveModel.ts';
import type { SeedGame, SeedSources } from './ui/widgets/netPanelModel.ts';
import type { Proposal } from './net/admission.ts';
import type { NetSession } from './net/session.ts';
import {
  readActiveGame,
  clearActiveGame,
  isActiveGameStale,
} from './net/activeGame.ts';
import { seatOf } from './net/seats.ts';
import { resolvePlayerId } from './net/appSession.ts';
import { generateGameCode } from './ui/widgets/netModel.ts';
import {
  deriveRejoinPrompt,
  HIDDEN_REJOIN_PROMPT,
  type RejoinPromptView,
} from './ui/widgets/rejoinPromptModel.ts';

const log = createLogger('app:boot');

/**
 * The e2e-injectable `Notification` constructor seam (Task N.5.2, issue #20). A Playwright spec sets it
 * BEFORE the app boots (via `addInitScript`) to a SPY constructor, so the move-notification glue fires
 * a fake `Notification` it can assert on WITHOUT triggering a real OS permission prompt. Absent, the
 * glue uses the real `window.Notification` (or `null` where the browser lacks it — a silent degrade).
 */
declare global {
  interface Window {
    __penteNotifyNotificationCtor?: NotificationApi;
    /**
     * Test-only seam (Task V.5): how long the boot rejoin PROBE listens to the room, in ms. A Playwright
     * spec sets it BEFORE the app boots (via `addInitScript`) so a probe that has to cross a test
     * harness's process boundary is given a realistic deadline; absent, the session's own presence
     * settle window is used.
     */
    __penteRejoinProbeMs?: number;
    /**
     * The build's version, from git tags (issue #22). Set at boot from the compile-time
     * `__APP_VERSION__` so a browser agent (Playwright / cdp) can read WHICH build a page is
     * running without parsing asset hashes. The same value is written to `<base>version.json`.
     */
    __penteVersion?: string;
  }
}

// Task N.2.2 (issue #12): the finished-networked-game rematch is NO LONGER a blocking `window.confirm`
// (removed here — it froze the tab and hid the won board). It is now a NON-BLOCKING, view-only
// END-STATE overlay (`src/ui/widgets/endStateOverlay.ts`) driven by the pure `deriveEndState`
// (`src/net/endState.ts`) over the authoritative net game + the N.1 handshake + this client's seat.
// Either player proposes "Rematch" via the shared N.1 handshake; on MUTUAL accept BOTH clients reset
// to a fresh game in the SAME room with ALTERNATED colors (the seat-swap restart wired below).

const container = document.getElementById('app');
if (!container) {
  throw new Error('#app container not found');
}

const scene = createScene(container);

// --- Persistence UX (Task 5.8, re-keyed by V.5): autosave + the archive browser. -----------------
// The app (not the scene/core) owns persistence: it needs an IndexedDB handle, which the scene
// deliberately does not (src/core stays pure; the scene is render IO). The LOCAL board the scene holds
// is AUTOSAVED to the archive as it evolves, and the archive browser (a UI widget) reviews + loads any
// past or conflicted game. Both are IO glue verified by Playwright (asserting on window.__pente
// getState/getHistory/getArchive), not unit-gated.
//
// EVERY RECORD IS KEYED BY THE GAME'S OWN `uuid` (Task V.5, epic #47, design §2 "games keyed by
// UUID"). Two consequences, both deliberate:
//
//  - ACCUMULATION IS BY CONSTRUCTION, so the machinery that used to produce it is GONE. A new game is
//    a new uuid and therefore a new record; there is no autosave id in localStorage to mint at a
//    "game boundary" and no generation/lifecycle decision about when to mint one. One game has
//    exactly one record, always — which is what the games list (#37) inherits.
//  - ONE WRITER PER RECORD. A NETWORKED game's record belongs to `NetSession.persistGame`, which
//    writes it — with the identity-owned seat map — on every accepted move. The app does not write it
//    (see `autosaveTick`'s guard): two writers of one record is what made a game's
//    players/seats/startedAt depend on which of them wrote last.
//
// AND A RELOAD RESTORES NOTHING (design §6): boot lands on an EMPTY SLATE. Games are not lost — they
// are durable here by uuid and reachable from the games list; a game that was live in a ROOM is
// offered back by the rejoin prompt below.

/**
 * When each game this browser holds BEGAN, so re-persisting one keeps its original date (a resumed
 * board writes the SAME uuid-keyed record it was loaded from). Primed off the archive at boot; the
 * session holds its own for the games it persists (`persist/archive.ts` `StartedAtLedger`).
 */
const startedAts = new StartedAtLedger();

/** The hidden end-state used before the net session wires up (offline / pre-wiring): the networked
 *  end-state overlay shows nothing until there is a live, finished net game to describe. */
const HIDDEN_END_STATE: EndState = {
  show: false,
  winner: null,
  winReason: null,
  iWon: false,
  resultText: '',
  rematchUi: 'idle',
  rematchPrompt: null,
};

// The live networked END-STATE view-model the overlay renders (Task N.2.2, issue #12), set once the
// net session wires up (below). Until then (offline / pre-wiring) there is no net game, so the overlay
// is hidden — the same honest-until-wired pattern the other net holders use.
let getNetEndState: () => EndState = () => HIDDEN_END_STATE;

/** The hidden divergence card used before the net session wires up: there is nothing to resolve. */
const HIDDEN_DIVERGENCE: DivergenceView = {
  show: false,
  headline: '',
  explanation: '',
  sharedPly: 0,
  mine: [],
  theirs: [],
  options: [],
  ui: 'choose',
  incomingText: null,
  canAccept: false,
  note: null,
};

// The live DIVERGENCE-panel view-model + its two actions (Task V.4b, epic #47), set once the net
// session wires up (below). Until then there is no session, so the card is hidden and the actions are
// honest no-ops — the same honest-until-wired pattern the other net holders use.
let getNetDivergence: () => DivergenceView = () => HIDDEN_DIVERGENCE;
let proposeNetResolution: (choice: ResolutionChoice) => boolean = () => false;
let respondNetResolution: (accepted: boolean) => boolean = () => false;

// The live net session's identity-owned readouts (Task S.5, epic #35): seat OWNERS + game UUID + the
// last typed admission reject reason. Set once the session wires up (below); until then (offline /
// pre-wiring) there is no session, so they report `null` — the same honest-until-wired pattern the
// other net holders use. Exposed on `window.__pente` for the two-context session-model e2e (S.7).
let getNetSeatOwners: () => SeatMap | null = () => null;
let getNetGameUuid: () => string | null = () => null;
let getNetLastReject: () => AdmissionReject | null = () => null;

// The unified-entry action the Network-Game panel's Enter button drives (Task S.6, design §3): enter a
// room with a canonical code + the chosen seed proposal. Set once the net session wires up (below);
// until then (offline / pre-wiring) it is an honest no-op — the panel is present but entering does
// nothing until the session exists, never a crash (the same honest-until-wired pattern above).
let enterRoom: (code: string, proposal: Proposal) => void = () => {};

// The move-notification + auto-reconnect glue (Task N.5.2, issue #20), set once the net session wires
// up. Until then (offline / pre-wiring) there is no session to notify for, so the readout reports the
// pristine title with zeroed counters — the same honest-until-wired pattern the other net holders use.
let notifyGlue: NotifyGlue | null = null;
/** The live move-notification readout (`document.title` + fire counters) for `window.__pente` (#3). */
function getNotifyReadout(): NotifyReadout {
  return (
    notifyGlue?.readout() ?? {
      title: document.title,
      baseTitle: document.title,
      titleFlashCount: 0,
      notificationCount: 0,
      permissionRequests: 0,
      lastFlash: null,
      lastNotification: null,
    }
  );
}

/**
 * The record this autosave writes for `game`: the app's LOCAL board, keyed by the game's own uuid.
 *
 * `players` is the local placeholder because this is a board one person is playing on both sides —
 * UNLESS the stored record already carries an identity-owned seat map (`stored`, read from the archive
 * by {@link archivedIdentity}): that game has been in a room, its seats belong to real playerIds
 * (design §2.3), and the empty-room reclaim + the rejoin prompt's colour are derived from them. The app
 * updates the BOARD; it never establishes or replaces that identity, so both fields are carried forward
 * verbatim. `startedAt` comes from the ledger, so re-saving a game keeps the date it began rather than
 * being re-stamped on every move (which would shuffle it up the newest-first games list).
 */
function autosaveTarget(
  game: Game,
  stored?: { players: Readonly<Record<string, string>>; seats: PersistedSeats | null },
): { readonly recordId: string; readonly meta: ArchivedMeta } {
  const winner = game.state().winner;
  // The stored identity, only when the record really carries one (a game that has been in a room).
  const seats = stored?.seats ?? null;
  const identity = seats === null ? null : { players: stored!.players, seats };
  return {
    recordId: game.uuid,
    meta: {
      players: identity === null ? { white: 'You', black: 'You' } : identity.players,
      result: winner === null ? 'in-progress' : `${winner}-wins`,
      startedAt: startedAts.stampFor(game.uuid, Date.now()),
      ...(identity === null ? {} : { seats: identity.seats }),
    },
  };
}

// The archive DB handle for autosave/restore + the browser. Opened async; until it resolves,
// autosave is a no-op and the browser lists nothing (never a crash — the same honest-until-wired
// pattern the net session uses). Restore folds any autosaved log back into a Game on boot.
let archiveDb: IDBDatabase | null = null;

// REVIEW suspends autosave (Task 6.6). Reviewing an archived game loads it into the scene READ-ONLY:
// the player is just looking (and may scrub the slider), so the browsed game must NOT be persisted and
// the current autosave record must NOT be disturbed. While suspended, `autosaveTick` no-ops entirely —
// no mint, no save. A genuinely-new-game action clears it: RESUME (continue the browsed game as a fresh
// accumulating record), or dispatching reset / host / join (which start a new authoritative game). This
// is the honest read-only guarantee — a review can never mutate the archive (agent-principles #1).
let autosaveSuspended = false;

/**
 * The games whose archive record belongs to the SESSION (Task V.5, epic #47, design §2/§7): every game
 * this browser has run in a room. `NetSession.persistGame` writes those records — with the
 * identity-owned seat map the empty-room reclaim (design §6.4) and the rejoin prompt's colour both read
 * — and the app must never write one, because two writers of one record is what made a game's
 * players/seats/history depend on which of them wrote last.
 *
 * Ownership is a property of the RECORD, so it is remembered rather than re-derived from the live
 * session. Keying the guard on `getNetGameUuid()` alone was a data-loss bug: `session.gameUuid()` goes
 * `null` the instant the session disconnects, so leaving a room the scene had entered on the "Current
 * local board" seed (the one case where the scene's local game and the session's game are ONE uuid)
 * let the very next scene change overwrite the session's record from the stale local board —
 * destroying the seat map and replacing the networked log, silently.
 */
const sessionOwnedGames = new Set<string>();

/** Remember the game the session is running, if any (see {@link sessionOwnedGames}). */
function noteSessionOwnedGame(): void {
  const uuid = getNetGameUuid();
  if (uuid !== null) sessionOwnedGames.add(uuid);
}

/**
 * Hand the player a FRESH local board when the board they are about to play on belongs to a session
 * that is no longer running it — and report whether one was handed over.
 *
 * Ownership of a record is permanent ({@link sessionOwnedGames}), so once a session has run a game the
 * app will never write that record again. Normally the scene's local board is a different game
 * entirely; it is the SAME game when a room was entered on the "Current local board" seed from a
 * pristine board, and from the moment the session stops being authoritative
 * (`netRouting.placementRoute` sends placements back to the scene-local game) that board is one NOBODY
 * writes: the session no longer persists it and the app must not. Every move on it would be silently
 * lost. So the board is replaced by a fresh game with its own uuid, which the autosave owns and saves
 * normally. Nothing is lost: the board was pristine (a PLAYED board is left behind before a net start,
 * `shouldArchiveBeforeNetStart`), and the networked game itself is durable under its own uuid — listed,
 * and offered back by the rejoin prompt.
 *
 * Driven from EVERY route out of a live session, not just the explicit one: leaving the room
 * (`leaveNet`), and any involuntary stop — a refused/failed entry, or a fork that stops the game
 * (`conflict`) — via the session-change hook below. Idempotent (the fresh board is not session-owned,
 * so a second call does nothing).
 */
function handOverSessionOwnedBoard(): boolean {
  if (!sessionOwnedGames.has(scene.getGame().uuid)) return false;
  scene.dispatch('reset');
  return true;
}

/**
 * Autosave the scene's LOCAL board under its own game uuid (Task 5.8, re-keyed by V.5).
 *
 * There is no boundary decision left to make: a new game carries a new uuid, so it lands in its own
 * record and every past game keeps its own — accumulation by construction (this is what replaced the
 * autosave-id + `gameLifecycle` generation machinery, epic #47). A write error surfaces honestly.
 */
async function autosaveTick(): Promise<void> {
  if (archiveDb === null) return;
  // While a REVIEW is in effect (Task 6.6) autosave is fully suspended: the browsed game is read-only,
  // so nothing is written — the archive is left exactly as the review found it. Resume/reset/host clears
  // the suspension before starting a real game, so accumulation continues normally after.
  if (autosaveSuspended) return;
  const game = scene.getGame();
  // ONE WRITER PER RECORD: the SESSION owns the record of every game it has run (it writes the
  // identity-owned seat map with it), so the app never writes one of those records — while the session
  // is live AND after it has gone. Normally the scene's local board is a different game entirely; it is
  // the SAME game when a room was entered on the "Current local board" seed, which is exactly when this
  // guard is load-bearing. A board this refuses to write is never one the player is left playing on:
  // every route out of a live session hands them a fresh local board first
  // ({@link handOverSessionOwnedBoard}) — the explicit Leave AND an involuntary stop.
  noteSessionOwnedGame();
  if (sessionOwnedGames.has(game.uuid)) return;
  const target = autosaveTarget(game, await archivedIdentity(archiveDb, game.uuid));
  await saveGame(archiveDb, target.recordId, game, target.meta);
  // The archive just changed — refresh the seed-games cache so the Network-Game panel's Resume list
  // reflects it on the next open. Best-effort: a refresh failure only leaves a stale list, never a
  // broken save.
  await refreshSeedGames().catch((err: unknown) => log.error('seed-games refresh failed', err));
}

/**
 * Drop the EMPTY SHELLS nothing is using any more (`persist/archive.ts` `purgeEmptyShellRecords`).
 *
 * One record per game means a board is persisted the moment it exists, so a boot and every reset leave
 * behind a board on which nothing ever happened. Unbounded, that is a store that grows a couple of rows
 * per page load and a boot whose every scan gets slower — invisible in the games list (which hides
 * shells) but real. Run at boot and at every LOCAL game boundary, so the husk count stays bounded by
 * what is actually in use rather than by how long the tab has been open.
 *
 * KEPT: the board currently loaded (legitimately empty, and about to be played on), every game a
 * session of ours owns (a net session writes its record the moment seats are negotiated, and the
 * empty-room reclaim re-seeds an unplayed game from it by uuid — design §6.4), and the game the
 * `activeNetworkedGame` breadcrumb names (the rejoin prompt has to be able to load it).
 */
async function purgeAbandonedBoards(): Promise<void> {
  if (archiveDb === null) return;
  // A REVIEW leaves the archive EXACTLY as it found it (Task 6.6) — that guarantee is about the whole
  // store, not just the browsed game, so a read-only browse collects nothing either. The next real
  // boundary (resume / reset / host) runs this again.
  if (autosaveSuspended) return;
  const keep = new Set(sessionOwnedGames);
  keep.add(scene.getGame().uuid);
  const crumb = readActiveGame()?.gameUuid;
  if (crumb !== undefined) keep.add(crumb);
  const husks = await purgeEmptyShellRecords(archiveDb, keep);
  if (husks.length > 0) log.info('purged empty-board records', { ids: husks });
}

/**
 * Resolves with the OPEN, MIGRATED archive once persistence is wired — or `null` if it could not be
 * opened (honest: persistence stays off, and the rejoin probe below has no game to offer). Awaited by
 * the boot rejoin probe, which needs the store migrated + the `startedAt` ledger primed before it reads
 * the game its breadcrumb names.
 */
const persistenceReady: Promise<IDBDatabase | null> = openDatabase(resolveDbName())
  .then(async (db) => {
    archiveDb = db;
    // MIGRATIONS FIRST, before anything reads or writes the store.
    //
    // 1. (V.1, epic #47) drop any v3 `net-room:{code}` shard this ORIGIN's store still holds.
    //    IndexedDB is per-origin, so a deployed v3 build's coordination records live in the SAME store
    //    this build reads — and v3.1 has no marker filter to hide them, so an un-migrated shard would
    //    render as a bogus user-facing game and be offered as a resume seed.
    const purged = await purgeLegacyNetRoomRecords(db);
    if (purged.length > 0) log.info('purged legacy net-room records', { ids: purged });
    // 2. (V.5, epic #47) re-key every record an older build stored under its retired autosave id onto
    //    the GAME's uuid, so a game archived before this build stays listed and resumable AND does not
    //    become a second record for one game the first time it is played again. Both counts are
    //    OBSERVED facts, not claims.
    const rekeyed = await rekeyArchiveRecordsByGameUuid(db);
    if (rekeyed.length > 0) log.info('re-keyed archive records by game uuid', { ids: rekeyed });
    // 3. (V.5, epic #47) drop the EMPTY SHELLS earlier sessions abandoned, so the store does not grow
    //    by a couple of rows per page load forever (see `purgeAbandonedBoards` for what is kept).
    await purgeAbandonedBoards();
    // Learn when every game this browser already holds BEGAN, before anything is written, so a game we
    // resume is re-persisted with its original date instead of being re-stamped "now".
    startedAts.adopt(await archivedStartedAts(db));
    // NOTHING IS RESTORED HERE (design §6): a reload lands on an EMPTY SLATE. The game that was live is
    // durable above by uuid — reachable from the games list, and offered back by the rejoin prompt when
    // it was being played in a room.
    scene.onStateChange(() => {
      void autosaveTick().catch((err: unknown) => log.error('autosave failed', err));
    });
    // A LOCAL game boundary (a reset, or an archived game loaded into the scene) abandons the board
    // that was loaded. If nothing ever happened on it, its record is a husk from this moment on — so
    // collect it here rather than letting a long session accumulate one per reset.
    scene.onNewGame(() => {
      void purgeAbandonedBoards().catch((err: unknown) =>
        log.error('empty-board purge failed', err),
      );
    });
    // Persist the initial state immediately so a fresh board is browsable even before the first move.
    const bootGame = scene.getGame();
    const bootTarget = autosaveTarget(bootGame);
    await saveGame(db, bootTarget.recordId, bootGame, bootTarget.meta);
    // Prime the seed-games cache off the now-open archive so the Network-Game panel's Resume list is
    // populated on its first open (before any autosave tick has run).
    await refreshSeedGames();
    log.info('autosave wired', { id: bootTarget.recordId });
    return db;
  })
  .catch((err: unknown) => {
    // Surface an init failure honestly; persistence stays off (never silently "saved").
    log.error('archive init failed', err);
    return null;
  });


// --- REJOIN PROMPT (Task V.5, epic #47, design §6) -----------------------------------------------
// A reload lands on an EMPTY SLATE, so the ONLY thing that offers a way straight back into a game that
// was live in a room is this prompt. It is an OFFER: nothing is loaded, entered or published until the
// player answers, and DECLINING forgets the breadcrumb (design §6) so the next reload is silent.
//
// The decision is the PURE `deriveRejoinPrompt`; this glue only supplies the facts (the breadcrumb, the
// archived game, the colour that game's own seat map owns for us) and performs the answer.

/** The live rejoin card the widget paints — hidden until (and unless) a probe produces an offer. */
let rejoinPrompt: RejoinPromptView = HIDDEN_REJOIN_PROMPT;

/**
 * What answering YES acts on, captured with the prompt: the room, and the game identity to carry into a
 * fresh room if the old one is busy. Kept beside the view so the answer cannot drift from the question
 * that was asked (e.g. a breadcrumb rewritten meanwhile).
 */
let rejoinTarget: { code: string; uuid: string; headHash: string } | null = null;

/**
 * PROBE for a rejoin offer at boot (design §6): read the breadcrumb, look at the room WITHOUT entering
 * it, and derive the card.
 *
 * The probe is deliberately the LAST thing: it costs a transport connection, so it only happens once
 * the pure model says an offer is possible at all — the breadcrumb is fresh AND the game it names is
 * really here. When it is not, the breadcrumb is cleared: a claim nothing can act on would otherwise
 * re-probe on every reload forever (design §6 "a stale `updatedAt` expires quietly"; the game itself is
 * untouched and stays reachable from the games list).
 *
 * Never throws into the boot path: a failed probe (an unreachable relay) or an unreadable archived game
 * is surfaced honestly in the log and leaves NO prompt and the breadcrumb INTACT — we learned nothing,
 * which is not the same as learning the room is empty.
 */
async function probeForRejoin(session: NetSession, db: IDBDatabase): Promise<void> {
  const crumb = readActiveGame();
  if (crumb === null) return; // no breadcrumb: an ordinary empty-slate boot, nothing to ask
  const stale = isActiveGameStale(crumb, Date.now());
  const held = stale ? undefined : await loadNetGameByUuid(db, crumb.gameUuid);
  const known = {
    crumb: { code: crumb.code, gameUuid: crumb.gameUuid },
    stale,
    haveGame: held !== undefined,
    // DERIVED from the game's own identity-owned seat map (design §7): the prompt DISPLAYS this colour
    // and never negotiates one — which is what keeps #31/#40 shut.
    myColour: held?.seats == null ? null : seatOf(held.seats, resolvePlayerId()),
  };
  // Would ANY probe outcome produce an offer? `show` depends only on the three facts above (a property
  // `rejoinPromptModel.test.ts` pins), so this asks the model rather than restating its rule. The
  // `held === undefined` half is the same fact as `haveGame`, narrowing it for the load below.
  if (held === undefined || !deriveRejoinPrompt({ ...known, peerPresent: false, peerGameUuid: null }).show) {
    clearActiveGame();
    log.info('rejoin breadcrumb expired', { code: crumb.code, stale, held: held !== undefined });
    return;
  }
  // How long the probe listens. The default is the session's own presence settle window; a Playwright
  // spec may WIDEN it through the `window.__penteRejoinProbeMs` seam so a cross-process test double's
  // round-trip is not cut off under load. A deadline, never a gate: the room must still answer for the
  // "same game" outcome to be derived, so widening it cannot turn a failure into a pass.
  const probe = await session.probeRoom(crumb.code, window.__penteRejoinProbeMs);
  rejoinTarget = { code: crumb.code, uuid: crumb.gameUuid, headHash: headHash(held.game.log) };
  rejoinPrompt = deriveRejoinPrompt({
    ...known,
    peerPresent: probe.peerPresent,
    peerGameUuid: probe.peerGameUuid,
  });
  log.info('rejoin probe', {
    code: probe.code,
    peerPresent: probe.peerPresent,
    outcome: rejoinPrompt.outcome,
  });
  refreshUi();
}

/**
 * ANSWER the rejoin prompt — the one action behind both its buttons (and `window.__pente.answerRejoin`).
 * The card is dismissed either way: it asked a question, and it has been answered.
 *
 *  - **No** → CLEAR the breadcrumb (design §6). The player said they are not going back, so the next
 *    reload must not ask again. The game itself is untouched, in the archive, in the games list.
 *  - **Yes**, `rejoin` → re-enter the SAME room with dealer's choice: the breadcrumb re-seeds the game
 *    by uuid and the seat map reclaims our colour by identity (design §6.4) — no colour is negotiated.
 *  - **Yes**, `new-code` → someone else's game is in that room, so take OURS to a FRESH room rather than
 *    hijacking theirs: a `resume` seed naming our game by uuid + head, which the wire's seed matrix
 *    enforces (V.2).
 *
 * @returns `true` if an answer was applied, `false` if there was nothing being asked.
 */
function answerRejoin(confirmed: boolean): boolean {
  const view = rejoinPrompt;
  const target = rejoinTarget;
  if (!view.show || target === null) return false;
  rejoinPrompt = HIDDEN_REJOIN_PROMPT;
  rejoinTarget = null;
  if (!confirmed) {
    clearActiveGame();
    log.info('rejoin declined — breadcrumb cleared', { code: target.code });
    refreshUi();
    return true;
  }
  if (view.action === 'rejoin') {
    enterRoom(target.code, { kind: 'defer' });
  } else {
    enterRoom(generateGameCode(Math.random), {
      kind: 'resume',
      uuid: target.uuid,
      headHash: target.headHash,
    });
  }
  refreshUi();
  return true;
}

/**
 * The archived records that are GAMES to this app — the ONE rule both the archive browser and the
 * Resume seed list obey, so the two can never disagree about what counts as a game.
 *
 * Drops every {@link isEmptyShell} record (a board with no history and no result) EXCEPT the board the
 * player has loaded RIGHT NOW (the scene's live game, keyed by its uuid): it is legitimately empty at
 * boot, becomes the played game in place, and is what "Current local board" seeds from — so it is
 * always shown. Every OTHER empty shell is an abandoned husk (a board that was reset before a move, or
 * a room that was entered and left before one — the net session keeps its record for the by-uuid
 * reclaim, design §6.4), and showing one as a game would litter the only route back to real games
 * (#37) with boards that never happened.
 */
function userFacingGames(listings: readonly GameListing[]): readonly GameListing[] {
  const liveBoard = scene.getGame().uuid;
  return listings.filter((l) => l.id === liveBoard || !isEmptyShell(l));
}

/**
 * List every archived game for the browser (Task 5.8) — the app's `listArchivedGames` projected to
 * the widget's `ArchiveListing` shape. Resolves empty until the DB is open (honest, never a crash).
 */
async function listArchive(): Promise<readonly ArchiveListing[]> {
  if (archiveDb === null) return [];
  return userFacingGames(await listArchivedGames(archiveDb));
}

/**
 * The resume-able persisted games the Network-Game panel offers as seeds (Task S.6, design §3 "Resume
 * — pick from your games list"). A SYNCHRONOUS cache the panel reads on open (it can't await IndexedDB
 * mid-open), refreshed off the archive at boot and after every autosave ({@link refreshSeedGames}). The
 * rich games list is #37; here it is a simple newest-first projection. The CURRENT autosave record is
 * excluded — resuming the game you already have loaded is the separate "Current local board" seed, and
 * offering it under both would be a confusing duplicate. Each row carries the game's `uuid` + `headHash`
 * so the panel's `resolveProposal` builds a `resume(uuid, headHash)` proposal with no second DB read.
 */
let seedGamesCache: readonly SeedGame[] = [];

/** Rebuild {@link seedGamesCache} from the archive (async; called at boot + after each autosave). */
async function refreshSeedGames(): Promise<void> {
  if (archiveDb === null) return;
  const listings = await listArchivedGames(archiveDb);
  seedGamesCache = userFacingGames(listings)
    // Exclude the CURRENT game — the local autosave record (that is the "Current local board" seed),
    // and, while a networked game is live, its own uuid-keyed record: offering to "resume" the game
    // you are already playing is a confusing self-reference, not a seed.
    .filter((l) => l.id !== scene.getGame().uuid && l.meta.uuid !== getNetGameUuid())
    .map((l) => ({
      id: l.id,
      // A human, deterministic label — the seat players + outcome the archive round-trips. Rendered
      // via textContent in the panel (never eval'd), so opaque strings are safe.
      label: `${l.meta.players.white ?? '?'} vs ${l.meta.players.black ?? '?'} · ${l.meta.result}`,
      uuid: l.meta.uuid,
      headHash: l.meta.headHash,
    }));
}

/**
 * The seed sources the Network-Game panel offers (Task S.6, design §3): the resume-able games (the
 * cache above) + whether a live local game exists to seed as "Current local board". The scene always
 * holds a game, so `hasCurrent` is true — the option seeds the currently-loaded game (a played board
 * or a hand-set one). Read synchronously on panel open.
 */
function seedSources(): SeedSources {
  return { games: seedGamesCache, hasCurrent: true };
}

/**
 * The currently-loaded local game's identity for the `current` seed proposal (Task S.6): its stable
 * `uuid` (minted at genesis, S.1) + `headHash`. Read off the scene's live local game (NOT the net
 * session game — "Current local board" is the game you have loaded before entering a room). Never
 * `null` here (the scene always has a game); typed nullable to keep the panel's guard honest.
 */
function currentGame(): { readonly uuid: string; readonly headHash: string } | null {
  const g = scene.getGame();
  return { uuid: g.uuid, headHash: headHash(g.log) };
}

/**
 * Reconstruct the archived game `id` and swap it into the scene, returning the loaded `Game` (or
 * `undefined` on an absent/corrupt record — surfaced honestly, never a silent no-op masquerading as
 * success). Shared by REVIEW and RESUME (Task 6.6): both fold the stored log into a live `Game` and
 * render it; they differ only in what happens to the AUTOSAVE record afterward (see below). A
 * conflicted record has no single game — we load its LOCAL fork (`mine`) so the player can inspect
 * the fork they were on (GLOSSARY "conflict": both forks are stored; resolution is a future feature).
 */
async function loadArchivedIntoScene(id: string): Promise<Game | undefined> {
  const conflicted = await loadConflictedIfAny(archiveDb!, id);
  const game = conflicted ?? (await loadArchivedGame(archiveDb!, id));
  if (game === undefined) {
    log.error('archive load: no such game', { id });
    return undefined;
  }
  scene.loadGame(game);
  refreshUi();
  return game;
}

/**
 * REVIEW an archived game (Task 6.6): load it read-only for browsing via the history slider. The game
 * is swapped into the scene, but autosave is SUSPENDED — so the browsed game is never persisted and the
 * current autosave record is left exactly as the review found it (the user is just looking; scrubbing
 * the slider is a read-only local feature, `scene.scrubTo`). The suspension ends when the user starts a
 * real game (reset / host / join) or RESUMES the browsed game — a real move only happens via RESUME.
 */
async function reviewArchived(id: string): Promise<void> {
  if (archiveDb === null) return;
  try {
    // Suspend BEFORE the swap so the load's own onStateChange tick is a no-op (never mints/overwrites).
    autosaveSuspended = true;
    const game = await loadArchivedIntoScene(id);
    if (game === undefined) return;
    log.info('archived game loaded for review (autosave suspended)', { id, ply: game.ply() });
  } catch (err: unknown) {
    log.error('archive review failed', { id, err });
  }
}

/**
 * RESUME an archived game (Task 6.6): load it and make it the live CONTINUABLE game. Same swap as
 * review, but autosave stays ACTIVE — so continued play is written back to THE SAME record the game was
 * loaded from (V.5: records are keyed by the game's uuid, so a game has one record whether it is being
 * played for the first time or picked up again, and its `startedAt` is preserved by the ledger). The
 * board just abandoned keeps its own record, as every past game does. A networked game is resumed the
 * same way: the user then enters a room from the resumed board (the "Current local board" seed).
 */
async function resumeArchived(id: string): Promise<void> {
  if (archiveDb === null) return;
  try {
    // Ensure autosave is active (a prior review may have suspended it) so continued play is written.
    autosaveSuspended = false;
    const game = await loadArchivedIntoScene(id);
    if (game === undefined) return;
    log.info('archived game resumed (continues under its own record)', { id, ply: game.ply() });
  } catch (err: unknown) {
    log.error('archive resume failed', { id, err });
  }
}

/**
 * If `id` names a conflicted game, load its LOCAL fork; otherwise resolve `undefined` (so the caller
 * falls back to an ordinary load). `loadConflicted` throws for a non-conflicted record, so we probe
 * the listing's result first to avoid catching that expected throw as an error.
 */
async function loadConflictedIfAny(
  db: IDBDatabase,
  id: string,
): Promise<import('./core/game.ts').Game | undefined> {
  const listing = (await listArchivedGames(db)).find((l) => l.id === id);
  if (listing === undefined || listing.meta.result !== 'conflicted') return undefined;
  const forks = await loadConflicted(db, id);
  return forks?.mine;
}

// Networking session (Task 5.5): the SyncEngine + seat manager wiring the net widget drives. It is
// an app-level object (needs an IndexedDB handle + a transport), so the app owns it and wires it to
// the scene's net hooks. The join code the widget types is stashed here, then read on `join`. The
// session is created async (opening IndexedDB); until it resolves the scene reports an offline
// session and host/join are no-ops (never a crash — design Principle 3). Board size is the scene's
// live board size so the networked game matches the rendered board.
let pendingJoinCode = '';
void createAppNetSession(scene.getState().size)
  .then((session) => {
    // The pure decision (`netRouting.ts`) that a networked game is authoritative: exactly when a
    // placement routes to the session. When true, the scene renders the session's ONE authoritative
    // game (issue #4); when false (offline / stopped-conflict) it renders its own local game. Keeping
    // this in the pure module (not an `if` in the scene) makes every phase boundary negatively tested.
    const netGameState = () =>
      shouldRenderSessionGame(session.state()) ? session.gameState() : null;

    // Host/join onto a played board (Task 6.4, issue #4a): before STARTING a networked game, leave the
    // current LOCAL game behind iff it has actually been PLAYED — the PURE `shouldArchiveBeforeNetStart`
    // decides (played → yes, pristine → no) from the scene-local game's ply. Dispatching `reset` swaps in
    // a fresh `Game`; the played board it replaces is already durable under its OWN uuid (every autosave
    // tick kept it current), so nothing has to be finalized here. Identical for HOST and JOIN (the task's
    // hard requirement), so both go through this one seam — a pristine board is left untouched.
    const startNetGame = (begin: () => void): void => {
      if (shouldArchiveBeforeNetStart(scene.getGame().ply())) {
        scene.dispatch('reset');
      }
      begin();
    };
    /**
     * Drive one room-ENTRY attempt (`enter`/`host`/`join`/`reconnect`) and repaint whatever it settled
     * on. A REFUSED entry is not an error — the session records its typed `joinError` and this repaints
     * the panel with it. A genuinely FAILED entry (e.g. the seed's archived log is corrupt — an
     * `ArchiveError`) rejects; the session has already returned itself to `offline`, so we log the real
     * error and repaint from that honest state rather than leaving an UNHANDLED rejection and a stale
     * widget behind (agent-principles: errors propagate honestly, never silently).
     */
    const driveEntry = (attempt: Promise<unknown>): void => {
      void attempt.then(refreshUi).catch((err: unknown) => {
        log.error('room entry failed', err);
        refreshUi();
      });
    };
    scene.setNetHooks({
      host: () => {
        // Host the chosen room code (issue #13: the picked code IS the room). The Network-Game panel
        // stashes the code via `setPendingJoinCode` before dispatching `hostGame`; the session uses
        // it (an empty/absent code degrades to a generated one). Consume-once so a later un-coded host
        // (e.g. a keybinding) generates a fresh code instead of re-using a stale one.
        const code = pendingJoinCode;
        pendingJoinCode = '';
        startNetGame(() => driveEntry(session.host(code)));
      },
      join: () => {
        const code = pendingJoinCode;
        pendingJoinCode = '';
        startNetGame(() => driveEntry(session.join(code)));
      },
      setPendingJoinCode: (code) => {
        pendingJoinCode = code;
      },
      getNet: () => session.state(),
      // Route a local placement through the session so the SyncEngine publishes it to the peer, then
      // return the session's authoritative state for the scene to render (issue #4). IllegalMove /
      // stopped-game errors propagate honestly from the engine.
      place: (coords) => {
        session.place(coords);
        const state = session.gameState();
        if (state === null) throw new Error('net place: no live session game');
        return state;
      },
      // Seat-turn gate (Task 6.2, issue #4c): the scene asks whether this client may place before
      // routing a networked move. The session evaluates the pure `canPlaceForSeat` gate over its seat +
      // the authoritative turn, so an off-turn click is blocked (with a subtle cue) instead of pushing
      // an out-of-seat-order move onto the shared log.
      canPlace: () => session.canPlace(),
      getNetGameState: netGameState,
      // The authoritative session game's head hash when a net game is live (issue #4): computed off
      // the wrapped engine's log, so `window.__pente.getHeadHash` reports the SHARED fingerprint and a
      // net move (which never touches the local game) is observable as a changed head.
      getNetHeadHash: () => {
        if (!shouldRenderSessionGame(session.state())) return null;
        const engine = session.syncEngine();
        return engine === null ? null : headHash(engine.game().log);
      },
      // Re-broadcast the authoritative log to the room (Task 6.7). Delegates to the engine's
      // idempotent `publishState` (adopting an already-received log is a receiver no-op), so it never
      // moves a peer backward — it only fills the LIVE relay's non-retained subscription gap. A no-op
      // with no live engine. This is the genuine "resync" a reconnect button would use; the
      // two-context live-relay e2e drives it to converge deterministically without weakening the proof.
      resync: () => {
        session.syncEngine()?.publishState();
      },
      // Leave the networked room (the "Leave room" capability): disconnect the session, which drops
      // this client's transport presence — so the PEER observes a present→absent edge and its own
      // session auto-cancels any pending out-of-band proposal (the `onPeerGone` guardrail). A no-op
      // offline; idempotent. `refreshUi` repaints the now-offline net widget.
      leaveNet: () => {
        session.disconnect();
        // The game played in that room belongs to the SESSION's record (design §2/§7), so the app will
        // never write it again — which is why leaving hands the player a fresh local board when the
        // scene's board IS that game ({@link handOverSessionOwnedBoard}). The same handover runs on the
        // session-change hook for every INVOLUNTARY stop, so this call is the explicit path, not the
        // only one; it is idempotent either way.
        handOverSessionOwnedBoard();
        refreshUi();
      },
      // Out-of-band ask/accept handshake (N.1, issues #12/#18): the shared primitive #12 rematch and
      // #18 undo/redo build on. `getHandshake` surfaces the session's pending proposal + last
      // resolution for `window.__pente.getHandshake` (a two-context e2e proves an ask crossed the
      // relay and resolved). `propose`/`respond` publish the NON-RETAINED proposal/response over the
      // SAME transport the sync path uses — never onto the append-only move-log. Auto-cancel (on a
      // game-advance or a peer drop) lives inside the session, so a stale proposal never lingers.
      getHandshake: () => session.getHandshake(),
      propose: (action) => session.propose(action),
      respond: (accepted) => session.respond(accepted),
      // Networked mutual-confirm undo/redo (N.3.2, issue #18): the banner Undo/Redo buttons enable on
      // whether a PROPOSAL is currently valid (the session's `canProposeUndo`/`canProposeRedo` — the
      // restricted last-mover-only rule + the single-pending invariant), and the incoming accept/decline
      // PROMPT view-model the banner surfaces (`deriveUndoRedoPrompt` over the handshake + seat). Both are
      // pure derivations folded in the session over the authoritative net game; the banner renders the
      // prompt copy via `textContent` (opponent-derived color from the fixed `Player` union, never eval'd).
      getNetUndoRedoAvail: () => session.undoRedoAvail(),
      getUndoRedoPrompt: () => session.undoRedoPrompt(),
    });
    // The live networked END-STATE view-model the overlay renders (Task N.2.2, issue #12): fold the
    // AUTHORITATIVE net game state + the N.1 handshake + this client's seat through the PURE
    // `deriveEndState`. Offline / no live net game → there is no net end-state, so the overlay shows
    // nothing (a LOCAL game-over never surfaces this networked overlay). `deriveEndState`'s own `show`
    // still gates on a winner, so an in-progress net game also shows nothing.
    getNetEndState = (): EndState => {
      const netState = netGameState();
      if (netState === null) return HIDDEN_END_STATE;
      return deriveEndState(netState, session.getHandshake(), session.state().seat);
    };
    // Session-model readouts (Task S.5, epic #35): the live game's identity-owned seat OWNERS + UUID +
    // last typed admission reject reason, read straight off the session for `window.__pente`. These are
    // the two-context e2e's proof-by-state that admission converged both clients onto one game with
    // DISTINCT real seat owners (the #31 fix), and that a refused entry surfaces its honest typed reason.
    // DIVERGENCE panel (Task V.4b, epic #47, absorbs #38): the live card the session derives through
    // the pure `deriveDivergence` (the open divergence + the shared N.1 handshake), and the two
    // actions that drive the resolution handshake. `proposeResolution` publishes an out-of-band
    // `resolve:<headHash>` ask; `respondResolution` answers the peer's. Nothing lands until BOTH sides
    // agree — `maybeApplyResolution` (below) applies it on the accepted resolution.
    getNetDivergence = () => session.divergenceView();
    proposeNetResolution = (choice) => session.proposeResolution(choice);
    respondNetResolution = (accepted) => session.respondResolution(accepted);
    getNetSeatOwners = () => session.seatOwners();
    getNetGameUuid = () => session.gameUuid();
    getNetLastReject = () => session.lastRejectReason();

    // Unified entry (Task S.6, design §3): the Network-Game panel's single Enter button routes HERE with
    // the canonical code + the chosen seed proposal. It goes through the SAME `startNetGame` boundary
    // the old host/join hooks use (leave a played local board behind, durable under its own uuid), then
    // drives `NetSession.enter(code, proposal)` — the S.5 admission protocol seats this peer by identity
    // rather than by which button was pressed (the #31 fix). A `defer`/`new` mirrors the old join/host;
    // `current`/`resume` carry a real game identity the protocol reconciles against the peer's.
    enterRoom = (code, proposal) => {
      startNetGame(() => driveEntry(session.enter(code, proposal)));
    };

    // MUTUAL-ACCEPT in-place rematch reset (Task N.2.2, plan N.2 decision 2: "both reset to a fresh
    // game in the SAME room/connection — NO disconnect/re-host", "colors ALTERNATE every game"). When
    // the out-of-band rematch handshake RESOLVES to `accepted` (either WE proposed and the peer
    // accepted, or the peer proposed and WE accepted), BOTH clients reset SEAMLESSLY to a FRESH game
    // over the SAME live connection with their seats SWAPPED — no transport teardown, so the peer sees
    // NO present→absent presence flicker and there is no reconnect race. The seamless reset is
    // `session.resetForRematch()`: it swaps this client's seat deterministically (each side alternates
    // from its OWN current color — no coordination), swaps a fresh empty `Game` into the live
    // `SyncEngine`, and bumps the sync epoch so the peer adopts the fresh generation and any late
    // finished-game message is ignored by epoch (see `SyncEngine.resetGame`). Fired ONCE per accepted
    // rematch resolution (guarded on the resolution id); `resetForRematch` clears the resolution so the
    // handshake settles idle for the next game.
    let handledRematchId: string | null = null;
    const maybeRematchReset = (): void => {
      const res = session.getHandshake().resolution;
      if (res === null || res.action !== REMATCH_ACTION || res.outcome !== 'accepted') return;
      if (res.id === handledRematchId) return;
      handledRematchId = res.id;
      // A rematch is a NEW game with its own uuid, so it lands in its own archive record and the
      // just-finished one keeps its own — no boundary bookkeeping here (V.5: records are keyed by the
      // game, so one-record-per-GAME holds by construction, remote moves included).
      session.resetForRematch();
      refreshUi();
    };

    // MOVE-NOTIFICATION + AUTO-RECONNECT glue (Task N.5.2, issue #20). Concentrates the DOM /
    // browser-API side effects the PURE `notify.ts` decisions gate: the tab-title flash + browser
    // Notification on a your-turn OPPONENT move (fired only while the tab is HIDDEN, config-driven,
    // permission requested once on opt-in), and the `visibilitychange`→visible / `online` auto-reconnect
    // that re-joins the SAME room reclaiming the sticky seat (`session.reconnect`). The `Notification`
    // constructor is read from an e2e-injectable seam (`window.__penteNotifyNotificationCtor`) so a spec
    // drives a spy without a real OS permission prompt; absent it, the real `window.Notification` (or
    // `null` where the browser lacks it — a graceful silent degrade) is used. It reads the live session
    // phase/game/seat/ply through accessors, so a background→return reconnect and a your-turn nudge both
    // derive from the SAME authoritative session state the board renders (never a duplicated fact).
    const injectedNotificationCtor = window.__penteNotifyNotificationCtor;
    const notificationCtor: NotificationApi | null =
      injectedNotificationCtor !== undefined
        ? injectedNotificationCtor
        : typeof window.Notification === 'undefined'
          ? null
          : (window.Notification as unknown as NotificationApi);
    notifyGlue = new NotifyGlue({
      doc: document,
      win: window,
      notificationCtor,
      getPhase: () => session.state().phase,
      getGameState: () => session.gameState(),
      getPly: () => session.ply(),
      getSeat: () => session.state().seat,
      reconnect: () => driveEntry(session.reconnect()),
    });

    // Was the session AUTHORITATIVE at the previous change? Read through the SAME pure predicate the
    // scene routes placements and rendering by (`netRouting`), so "the session is running the game" is
    // one rule with one answer — a second, hand-rolled phase list here could drift from the one that
    // decides where a placement actually goes.
    let sessionWasAuthoritative = shouldRenderSessionGame(session.state());
    // On EVERY session-state change — a local move, a REMOTE move adopted by the transport pump
    // (the resync link), presence, or a conflict — adopt the session's authoritative game into the
    // scene (re-rendering a remote move) and repaint the widgets. This is the render half of "ONE
    // authoritative game per session"; without it a peer's move never reaches the board (issue #4).
    // A finished game surfaces the non-blocking end-state overlay via the refreshed `getNetEndState`.
    // The notify glue also observes the change to fire the your-turn tab-title flash / browser
    // Notification when the ADOPTED change was an opponent move that made it this client's turn (#20).
    session.onChange(() => {
      // Remember the game the session is running BEFORE anything else reacts: from here on its record
      // is the session's to write, and stays so after the session goes offline (`sessionOwnedGames`).
      noteSessionOwnedGame();
      // THE SESSION JUST STOPPED RUNNING THE GAME — by a refused/failed entry, a fork that stopped it
      // (`conflict`), or a disconnect. Placements now go to the scene-LOCAL game, so if that game is
      // one a session owns the player would be moving on a board nothing saves: hand them a fresh one,
      // exactly as leaving the room does (`handOverSessionOwnedBoard` — it is the same fact, so it is
      // the same remedy on every path that reaches it, not only the one the player chose).
      const authoritative = shouldRenderSessionGame(session.state());
      if (sessionWasAuthoritative && !authoritative && handOverSessionOwnedBoard()) {
        log.info('local board handed over after the session stopped', {
          phase: session.state().phase,
          // The board the player is on NOW — the fresh one this just swapped in.
          freshBoard: scene.getGame().uuid,
        });
      }
      sessionWasAuthoritative = authoritative;
      scene.adoptNetState();
      notifyGlue?.onSessionChange();
      refreshUi();
    });
    // MUTUAL-ACCEPT networked undo/redo apply (Task N.3.2, plan N.3 decision 3, issue #18: "opponent
    // confirms → both roll back one"; redo the same via a proposal). When the out-of-band undo/redo
    // handshake RESOLVES to `accepted` on EITHER side (WE proposed and the peer accepted, or the peer
    // proposed and WE accepted), BOTH clients apply the undo/redo to their OWN engine + publish, so the
    // two logs converge by the same prefix/hash path as any move. The undo/redo was held OUT-OF-BAND on
    // the handshake until this point — a decline or auto-cancel (a move lands / peer drops) never
    // resolves to `accepted`, so both games stay untouched. `applyAcceptedUndoRedo` guards on the
    // resolution (only an accepted `'undo'`/`'redo'`) and CLEARS it, so it fires once per acceptance and
    // never re-applies; a `'rematch'` accept is `maybeRematchReset`'s job (the two consumers stay
    // decoupled on their action tag). No manual id-guard is needed here — the clear makes it idempotent.
    const maybeApplyUndoRedo = (): void => {
      session.applyAcceptedUndoRedo();
    };
    // MUTUAL-ACCEPT DIVERGENCE RESOLUTION apply (Task V.4b, epic #47, absorbs #38). When the shared
    // handshake resolves to `accepted` for a `resolve:` action on EITHER side, BOTH clients apply the
    // agreed history to their own engine and publish, so the two logs converge — the proposer keeps
    // and republishes, the responder adopts (replay-validated). A decline or a peer-gone auto-cancel
    // never resolves to `accepted`, so both games stay untouched, exactly as #18 guarantees.
    // `applyAcceptedResolution` guards on the action and CLEARS the resolution, so it fires once.
    const maybeApplyResolution = (): void => {
      session.applyAcceptedResolution();
    };
    // Out-of-band handshake changes (N.1, #12/#18): an incoming ask, a resolution, or an auto-cancel.
    // Repaint the widgets so the #12 rematch overlay + the #18 undo/redo prompt reflect the pending
    // proposal / resolution, fire the MUTUAL-ACCEPT seat-swap restart when the rematch handshake
    // resolves to `accepted`, and apply the MUTUAL-ACCEPT undo/redo when that handshake does. Kept
    // separate from the sync `onChange` because a handshake transition is NOT a move — it never touches
    // the board/log directly — so it must not run the adopt path; it only refreshes the out-of-band
    // state view and drives the accepted-rematch reset / accepted-undo-redo apply.
    session.onHandshakeChange(() => {
      refreshUi();
      maybeRematchReset();
      maybeApplyUndoRedo();
      maybeApplyResolution();
    });
    refreshUi();
    log.info('net session wired');
    // BOOT REJOIN PROBE (V.5, design §6): once persistence is migrated and the session exists, look at
    // the room the breadcrumb names and OFFER a way back. Deliberately after the session is fully wired
    // (the offer's YES drives `enterRoom`) and never blocking the boot: a failure only means no offer.
    void persistenceReady.then((db) => {
      if (db === null) return;
      return probeForRejoin(session, db).catch((err: unknown) => {
        log.error('rejoin probe failed — no prompt shown, breadcrumb kept', err);
      });
    });
  })
  .catch((err: unknown) => {
    // Surface an init failure honestly; the net widget stays offline (never silently "connected").
    log.error('net session init failed', err);
  });

// Composable UI shell (Task 5.1+): the config-driven widget overlay mounted over the canvas.
// Its zones/order are pure `layout` config; the container is the DOM glue. Widgets dispatch
// command ids through the scene's registry — the SAME path a keybinding uses (design Principle
// 3) — so a button and a hotkey fire the identical command. Kept in sync with live state so its
// widgets (Task 5.2 status banner) read the current game + history (design Part 6).
/** Command ids that START a genuinely new authoritative game — each ends any REVIEW (Task 6.6). */
const NEW_GAME_COMMANDS = new Set(['reset', 'hostGame', 'joinGame']);

const ui = createUi(container, {
  dispatch: (id) => {
    // A review suspends autosave (read-only browse). Starting a real game — reset / host / join,
    // whatever the source (button, menu, or keybinding all route through this one dispatch choke
    // point) — ends the review so the fresh game is tracked and accumulated normally again (6.6).
    if (NEW_GAME_COMMANDS.has(id)) autosaveSuspended = false;
    return scene.dispatch(id);
  },
  // Modal/mode widgets (Task 5.3: the menu modal) push/pop input scopes on the scene's stack —
  // a blocking scope while a modal is open, popped when it closes (design Part 5 / GLOSSARY).
  pushScope: (scope) => scene.pushScope(scope),
  popScope: () => scene.popScope(),
  // Settings modal (Task 5.4): the widget hands its open() here; wire it to the scene's
  // `openSettings` command so the menu's "Settings" entry / a keybinding opens the modal.
  registerOpener: (open) => scene.setOpenSettings(open),
  // Help overlay (Task 5.7): the widget hands its open() here; wire it to the scene's `showHelp`
  // command so the `?` keybinding (or any UI trigger) opens the overlay. Its shortcut list is
  // GENERATED from the scene's live registry + bindings (getHelpSources), never a hardcoded list.
  registerOpenHelp: (open) => scene.setOpenHelp(open),
  // Archive browser (Task 5.8): the widget hands its open() here; wire it to the scene's `loadGame`
  // command so the menu's "Load" entry / a keybinding opens the browser. The browser reads the
  // archive via listArchive and loads a chosen game via loadArchived (both over IndexedDB).
  registerOpenArchive: (open) => scene.setOpenArchive(open),
  // Network-Game panel (Task C.2, issue #13): the widget hands its open() here; wire it to the
  // scene's `openNetwork` command so the menu's "Network Game" entry opens the drawer panel.
  registerOpenNetwork: (open) => scene.setOpenNetwork(open),
  listArchive: () => listArchive(),
  // Task 6.6 review vs resume: Review loads read-only (browse the slider); Resume loads + continues
  // playing under a fresh accumulating record. Two DISTINCT app seams the widget's two buttons call.
  reviewArchived: (id) => reviewArchived(id),
  resumeArchived: (id) => resumeArchived(id),
  getHelpSources: () => scene.getHelpSources(),
  // Networking (Task 5.5): the net widget reads the live session readout via the scene's getNet,
  // stashes a validated join code via setPendingJoinCode, and copies the game code to the clipboard.
  getNet: () => scene.getNet(),
  setPendingJoinCode: (code) => scene.setPendingJoinCode(code),
  // Unified entry seed selection (Task S.6, issue #35): the Network-Game panel reads the resume-able
  // games + whether a current local board exists (`seedSources`), the current game's identity for the
  // `current` proposal (`currentGame`), and enters the room with the chosen code + proposal (`enter`).
  seedSources: () => seedSources(),
  currentGame: () => currentGame(),
  enter: (code, proposal) => enterRoom(code, proposal),
  copyToClipboard: (text) => navigator.clipboard.writeText(text),
  // History slider (Task 5.6): the slider reads the scene's read-only history readout and drives
  // its local scrub seam — no command dispatch (it emits/syncs nothing; design Part 6 / GLOSSARY).
  getHistory: () => scene.getHistory(),
  scrubTo: (k) => scene.scrubTo(k),
  // Networked END-STATE overlay (Task N.2.2, issue #12): the overlay reads the live end-state view-
  // model (the app's `deriveEndState` over the authoritative net game + N.1 handshake + seat) and
  // drives a rematch through the SAME session handshake API `window.__pente.propose`/`respond` use —
  // Rematch → `scene.propose('rematch')`, Accept/Decline → `scene.respond(accepted)`. On MUTUAL accept
  // the session's handshake resolves and `maybeRematchReset` (above) swaps seats + restarts.
  getEndState: () => getNetEndState(),
  proposeRematch: () => scene.propose(REMATCH_ACTION),
  respondRematch: (accepted) => scene.respond(accepted),
  // Networked undo/redo prompt Accept/Decline (Task N.3.2, issue #18): the banner's incoming-undo/redo
  // prompt routes accept/decline through the SAME session handshake `respond` (`window.__pente.respond`
  // uses) — on mutual accept the app applies the undo/redo on the resolution (`applyAcceptedUndoRedo`).
  respondUndoRedo: (accepted) => scene.respond(accepted),
  // DIVERGENCE panel (Task V.4b, epic #47): the card reads the live view-model the session derives,
  // and its buttons drive the SAME session resolution API `window.__pente.proposeResolution` /
  // `respondResolution` use — one action layer for a button and a test (design Principle 3).
  getDivergence: () => getNetDivergence(),
  proposeResolution: (choice) => proposeNetResolution(choice),
  respondResolution: (accepted) => respondNetResolution(accepted),
  // REJOIN PROMPT (Task V.5, epic #47, design §6): the card reads the live offer the boot probe
  // derived, and its two buttons route through the SAME `answerRejoin` seam `window.__pente` uses.
  getRejoinPrompt: () => rejoinPrompt,
  answerRejoin: (confirmed) => answerRejoin(confirmed),
});

/** Repaint every widget from the live state + the banner history context (Task 5.2). */
function refreshUi(): void {
  ui.container.update(scene.getState(), scene.getBannerContext());
}
refreshUi();
// Repaint on every board change (place/undo/redo/reset) so the banner's turn/captures/enabled
// stay live regardless of whether the change came from a button, a hotkey, or a canvas click.
scene.onStateChange(refreshUi);

// Live settings apply with NO reload (Task A.3/A.4, issue #15): on every config-section change —
// whether from the local settings UI or a programmatic/networked writer — do BOTH halves of the
// single notification path:
//   1. scene.applyConfig(section): re-read the section (SSOT) onto the running Three.js objects so
//      the BOARD reflects the change live (A.3). A documented no-op for the reload/next-game
//      sections (board/controls/geometry), so firing it for any section is safe.
//   2. refreshUi(): repaint every widget via container.update. Config-READING widgets (the settings
//      modal) re-read live config in their own update() — mirroring how the net widget re-reads the
//      session readout — so an OPEN modal reflects a config change made ANYWHERE (a local edit, a
//      reset, or an opponent's networked change, #9) with no reload. This is the A.4 wiring seam:
//      the settings UI writes config, and this ONE loop is what applies it to board AND widgets.
// `setConfig`/`resetConfig` emit the SECTION NAME only (the SSOT is getConfig, which the appliers +
// widgets re-read), so no value is duplicated onto the event. We NEVER write config from inside this
// listener (that would re-emit → loop); we react by re-reading + re-applying only (design guardrail).
// The scene owns teardown of its own objects; this app-level subscription lives for the page's
// lifetime alongside the scene.
onConfigChange((section) => {
  scene.applyConfig(section);
  refreshUi();
});

// Expose the inspection API so browser agents (Playwright, cdp) can read real state.
// Kept unconditional for the v1 walking skeleton; a prod gate lands with the real build.
installInspectApi(scene, ui, {
  listArchive: () => listArchive(),
  // The networked end-state view-model (Task N.2.2, issue #12) — derived in the app over the net
  // session + seat, so it is supplied here (not from the scene) for `window.__pente.getEndState`.
  getEndState: () => getNetEndState(),
  // The move-notification readout (Task N.5.2, issue #20) — the app-level notify glue's live
  // document.title + fire counters, for `window.__pente.getNotify` (the #20 e2e's proof-by-behaviour).
  getNotify: () => getNotifyReadout(),
  // Session-model readouts (Task S.5, epic #35) — the live net session's identity-owned seat owners +
  // game UUID + last typed admission reject reason, for the two-context session-model e2e (S.7).
  getNetSeatOwners: () => getNetSeatOwners(),
  getNetGameUuid: () => getNetGameUuid(),
  getNetLastReject: () => getNetLastReject(),
  // DIVERGENCE readouts (Task V.4b, epic #47) — the live card + the two resolution actions, exposed
  // so the two-context e2e proves BOTH clients opened the SAME divergence and that agreeing converges
  // them to one `headHash` (proof-by-state, never a log line — agent-principles #3).
  getDivergence: () => getNetDivergence(),
  proposeResolution: (choice) => proposeNetResolution(choice),
  respondResolution: (accepted) => respondNetResolution(accepted),
  // REJOIN PROMPT (Task V.5, epic #47, design §6): the card reads the live offer the boot probe
  // derived, and its two buttons route through the SAME `answerRejoin` seam `window.__pente` uses.
  getRejoinPrompt: () => rejoinPrompt,
  answerRejoin: (confirmed) => answerRejoin(confirmed),
});

// Publish the build fingerprint (issue #22). `__APP_VERSION__` is substituted at build time from
// `git describe` (vite.config.ts `define`); the matching `<base>version.json` carries the branch,
// sha and build timestamp alongside it.
window.__penteVersion = __APP_VERSION__;

log.info('app booted', { version: __APP_VERSION__ });
