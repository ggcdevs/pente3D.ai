import { createScene } from './render/scene.ts';
import { createUi } from './ui/setup.ts';
import { installInspectApi } from './debug/window.ts';
import { createLogger } from './debug/log.ts';
import { createAppNetSession } from './net/appSession.ts';
import { shouldRenderSessionGame } from './net/netRouting.ts';
import { shouldArchiveBeforeNetStart, shouldPromptRematch } from './net/rematch.ts';
import { headHash } from './core/eventLog.ts';
import { openDatabase, resolveDbName } from './persist/db.ts';
import {
  saveGame,
  loadGame as loadArchivedGame,
  loadConflicted,
  listArchivedGames,
  type ArchivedMeta,
} from './persist/archive.ts';
import {
  initialLifecycle,
  nextLifecycle,
  observeLifecycle,
  type LifecycleState,
} from './persist/gameLifecycle.ts';
import type { Game } from './core/game.ts';
import type { ArchiveListing } from './ui/widgets/archiveModel.ts';

const log = createLogger('app:boot');

/**
 * The "play another?" prompt for a finished networked game (Task 6.4), as an injectable seam so the
 * Playwright e2e can drive accept / decline deterministically (like the `__penteNetTransportFactory`
 * seam). In the running app it is `window.confirm`; a test installs `window.__penteRematchPrompt`
 * BEFORE boot to answer the prompt without a real dialog. Returns `true` to start a fresh net game.
 */
declare global {
  interface Window {
    /** Test-only: answers the play-another? prompt (true = start a fresh net game). */
    __penteRematchPrompt?: () => boolean;
  }
}
function rematchPrompt(): boolean {
  const injected = window.__penteRematchPrompt;
  if (injected !== undefined) return injected();
  return window.confirm('Game over — play another?');
}

const container = document.getElementById('app');
if (!container) {
  throw new Error('#app container not found');
}

const scene = createScene(container);

// --- Persistence UX (Task 5.8): autosave, restore-on-load, archive browser. ---------------------
// The app (not the scene/core) owns persistence: it needs an IndexedDB handle, which the scene
// deliberately does not (src/core stays pure; the scene is render IO). The current local game is
// AUTOSAVED to the Stage 2 archive as it evolves and RESTORED on the next boot, and the archive
// browser (a UI widget) reviews + loads any past or conflicted game. All three are IO glue verified
// by the Task 5.8 Playwright spec (asserting on window.__pente getState/getHistory), not unit-gated.

/** The localStorage key holding the CURRENT game's autosave id (restored on boot; re-minted per game). */
const AUTOSAVE_ID_KEY = 'pente:autosave:id';

/** Resolve (creating on first run) the archive id the CURRENT game autosaves under. Re-minted at each
 *  game boundary (Task 6.3) so past games accumulate; the current id is persisted so a refresh resumes
 *  the same in-progress game rather than the last-finalized one. */
function resolveAutosaveId(): string {
  const existing = window.localStorage.getItem(AUTOSAVE_ID_KEY);
  if (existing !== null && existing.length > 0) return existing;
  const id = crypto.randomUUID();
  window.localStorage.setItem(AUTOSAVE_ID_KEY, id);
  return id;
}

// --- Archive ACCUMULATION (Task 6.3, issue #4) --------------------------------------------------
// Stage 5 autosaved under ONE stable id, so every new game OVERWROTE the previous record and the
// archive could only ever hold the current game. Now a fresh id is minted at each GAME BOUNDARY —
// game-over, reset, or host/join-onto-a-played-board — and the just-ended game is finalized under its
// own id, so EVERY game (finished OR abandoned, local OR networked) is kept as its own archive record.
// The DECISION (is this a boundary?) is the PURE `gameLifecycle` module (strict unit+mutation); this
// glue only reads the plain facts, mints ids, and writes to the archive.

/** The id the CURRENT game autosaves under. Re-minted (and persisted) at each boundary. */
let autosaveId = resolveAutosaveId();

/** The `startedAt` of the current game's record — reset when a fresh game boundary mints a new id. */
let autosaveStartedAt = Date.now();

// Generation token the pure boundary detector reads to learn "this is a DIFFERENT game" without
// diffing logs (`gameLifecycle` design). Bumped whenever the AUTHORITATIVE game's object identity
// changes — a scene reset/load swaps `scene.getGame()`, and a networked session brings its own game.
// Object identity is the honest, DRY signal (the scene/session already own the swap); we do not
// duplicate their reset/load/net-start logic here.
let generation = 0;
let lastGame: Game | null = null;

/** The lifecycle-tracking cursor threaded through the pure boundary decision (never mutated in place). */
let lifecycle: LifecycleState = initialLifecycle();

// The networked session's authoritative game, set once the net session wires up (below). Until then
// (offline / pre-wiring) there is no net game and the scene's local game is authoritative — the same
// honest-until-wired pattern the net hooks use. Returns the SESSION engine's live `Game` when a net
// game is authoritative, else null.
let netAuthoritativeGame: () => Game | null = () => null;

/** The authoritative game to archive: the networked SESSION's game when a net game is live, else the
 *  scene's local game. Both expose the same `Game` shape (log + ply + state) the archive persists. */
function authoritativeGame(): Game {
  return netAuthoritativeGame() ?? scene.getGame();
}

/** The current authoritative game's generation, bumped when its object identity changes (a new game). */
function currentGeneration(): number {
  const g = authoritativeGame();
  if (g !== lastGame) {
    generation += 1;
    lastGame = g;
  }
  return generation;
}

/** The metadata attached to the current game's record (single-player defaults; result reflects a win). */
function autosaveMeta(): ArchivedMeta {
  const winner = scene.getState().winner;
  return {
    players: { white: 'You', black: 'You' },
    result: winner === null ? 'in-progress' : `${winner}-wins`,
    startedAt: autosaveStartedAt,
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
 * Autosave the authoritative game so past games ACCUMULATE (Task 6.3, issue #4). Each call asks the
 * PURE `nextLifecycle` — from the game's generation (bumped when a new `Game` is swapped in) + ply +
 * winner — for two independent actions, then does exactly the matching archive write:
 *   - `mintFresh` (a NEW game began over a played one — reset / load / net-start): the game just left
 *     is ALREADY durable under the current id (every in-game autosave kept it current), so we MINT a
 *     fresh id + `startedAt` (persisted) and save the new game under it — the old record stays intact.
 *     This is the accumulation point: one archive id per real game.
 *   - `finalizeCurrent` (the game reached a WINNER): save its terminal state under the CURRENT id.
 *     No mint — the fresh id is minted only when the NEXT game actually begins, so a won game is not
 *     prematurely stamped under a new id and duplicated.
 * A plain in-game move is neither: it just overwrites the current id, keeping the live game current.
 * The current id is persisted so a refresh resumes THIS in-progress game (not the last-finalized one).
 * A write error surfaces honestly (never swallowed as a silent success).
 */
async function autosaveTick(): Promise<void> {
  if (archiveDb === null) return;
  // While a REVIEW is in effect (Task 6.6) autosave is fully suspended: the browsed game is read-only,
  // so we neither mint nor save — the archive is left exactly as the review found it. Resume/reset/host
  // clears the suspension before starting a real game, so accumulation continues normally after.
  if (autosaveSuspended) return;
  const generation = currentGeneration();
  const game = authoritativeGame();
  const decision = nextLifecycle(lifecycle, observeLifecycle(generation, game.ply(), game.state()));
  lifecycle = decision.next;
  if (decision.mintFresh) {
    // A new game began: the game just left is already durable under the OLD id, so mint a fresh id
    // for the new game (the old record is left untouched — that is how past games accumulate).
    autosaveId = crypto.randomUUID();
    autosaveStartedAt = Date.now();
    window.localStorage.setItem(AUTOSAVE_ID_KEY, autosaveId);
    log.info('new game — minted fresh archive id', { id: autosaveId, generation });
  }
  if (decision.finalizeCurrent) {
    log.info('game won — finalizing archive record', { id: autosaveId, ply: game.ply() });
  }
  // Save the live game under the current id (the freshly-minted one on a mint, the same one otherwise;
  // on a finalize this captures the won game's terminal state under its own id).
  await saveGame(archiveDb, autosaveId, game, autosaveMeta());
}

void openDatabase(resolveDbName())
  .then(async (db) => {
    archiveDb = db;
    // RESTORE ON LOAD: if the current game was autosaved under our (persisted) id, reconstruct it
    // (fold its event log) and swap it into the scene, so a refresh resumes exactly where the player
    // left off — the IN-PROGRESS game, since a finalized game re-minted the id before the refresh. A
    // corrupt stored log surfaces honestly via the catch below (never a silently-broken board).
    const restored = await loadArchivedGame(db, autosaveId);
    if (restored !== undefined) {
      scene.loadGame(restored);
      refreshUi();
      log.info('autosaved game restored', { id: autosaveId, ply: restored.ply() });
    }
    // Seed the lifecycle cursor from the game now live (after any restore), so the first tick observes
    // the SAME generation and does not spuriously treat a restored game as a boundary.
    lastGame = authoritativeGame();
    lifecycle = { generation, ply: authoritativeGame().ply(), finalized: false };
    // AUTOSAVE + boundary detection on every state change (place/undo/redo/reset/load/net-adopt).
    scene.onStateChange(() => {
      void autosaveTick().catch((err: unknown) => log.error('autosave failed', err));
    });
    // Persist the initial state immediately so a fresh game is browsable even before the first move.
    await saveGame(db, autosaveId, authoritativeGame(), autosaveMeta());
    log.info('autosave wired', { id: autosaveId });
  })
  .catch((err: unknown) => {
    // Surface an init failure honestly; persistence stays off (never silently "saved").
    log.error('archive init failed', err);
  });

/**
 * List every archived game for the browser (Task 5.8) — the app's `listArchivedGames` projected to
 * the widget's `ArchiveListing` shape. Resolves empty until the DB is open (honest, never a crash).
 */
async function listArchive(): Promise<readonly ArchiveListing[]> {
  if (archiveDb === null) return [];
  return await listArchivedGames(archiveDb);
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
 * review, but autosave stays ACTIVE — swapping in the loaded `Game` bumps the generation, so the pure
 * Task 6.3 lifecycle detects a boundary over the just-abandoned live game and MINTS A FRESH record for
 * the resumed game (exactly as reset / host do). Continued play then accumulates under that fresh id and
 * the original archived record stays intact — no bespoke minting here (DRY: the one accumulation path in
 * `autosaveTick` owns id-minting). A networked game is resumed the same way: the user then Hosts from
 * the resumed board (reusing 6.4's played-board path), which archives + restarts as a fresh net game.
 */
async function resumeArchived(id: string): Promise<void> {
  if (archiveDb === null) return;
  try {
    // Ensure autosave is active (a prior review may have suspended it) so the load's boundary mints.
    autosaveSuspended = false;
    const game = await loadArchivedIntoScene(id);
    if (game === undefined) return;
    log.info('archived game resumed (continues under a fresh record)', { id, ply: game.ply() });
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

    // Host/join onto a played board (Task 6.4, issue #4a): before STARTING a networked game, archive
    // + reset the current LOCAL game iff it has actually been PLAYED — the PURE `shouldArchiveBeforeNetStart`
    // decides (played → yes, pristine → no) from the scene-local game's ply. The archive falls out of the
    // Task 6.3 lifecycle: dispatching `reset` swaps in a fresh `Game`, whose generation change finalizes the
    // just-abandoned local game under its own id. Identical for HOST and JOIN (the task's hard requirement),
    // so both go through this one seam — a pristine board is left untouched and just started.
    const archiveResetBeforeStart = (): void => {
      if (shouldArchiveBeforeNetStart(scene.getGame().ply())) {
        scene.dispatch('reset');
      }
    };
    scene.setNetHooks({
      host: () => {
        archiveResetBeforeStart();
        void session.host().then(refreshUi);
      },
      join: () => {
        archiveResetBeforeStart();
        void session.join(pendingJoinCode).then(refreshUi);
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
    });
    // Archive ACCUMULATION for NETWORKED games (Task 6.3): the authoritative game to persist while a
    // net game is live is the SESSION engine's game — its own `Game` object, distinct from the scene's
    // local one. Exposing it here lets the autosave bump its generation (a fresh net game is a new game
    // identity) so starting a networked game onto a played local board finalizes that local game and
    // mints a fresh record for the networked one. Same authoritative condition as `netGameState`, so
    // the archived game and the rendered game can never drift.
    netAuthoritativeGame = () => {
      if (!shouldRenderSessionGame(session.state())) return null;
      const engine = session.syncEngine();
      return engine === null ? null : engine.game();
    };
    // Play-another? on a finished networked game (Task 6.4). When the authoritative networked game
    // ENDS (a winner is set) we PROMPT the player to start another, and on accept start a fresh net
    // game in the SAME role (host mints a new code; a joiner rejoins its code). The PURE
    // `shouldPromptRematch` decides "has the net game ended?" from the authoritative state; the prompt
    // itself is an injectable seam (default `window.confirm`) so the Playwright e2e can drive accept /
    // decline deterministically. The prompt fires EXACTLY ONCE per finished game (`rematchPromptedFor`
    // guards against re-prompting on every subsequent idle session change once won).
    let rematchPromptedFor: string | null = null;
    const startFreshNetGame = (): void => {
      const code = session.state().code;
      const seat = session.state().seat;
      session.disconnect();
      // Preserve the role: a host re-hosts (a fresh code); a joiner rejoins the SAME room code so both
      // accepting peers meet again. `disconnect` returned us to offline, so host/join are live again.
      if (seat === 'black' && code !== null) {
        pendingJoinCode = code;
        void session.join(pendingJoinCode).then(refreshUi);
      } else {
        void session.host().then(refreshUi);
      }
    };
    const netHeadKey = (): string | null => {
      const game = netAuthoritativeGame();
      return game === null ? null : headHash(game.log);
    };
    const maybePromptRematch = (): void => {
      const netState = netGameState();
      if (netState === null || !shouldPromptRematch(netState)) return;
      // Fire once per finished game: key the guard on the authoritative head so a NEW finished game
      // (a later rematch that is also won) re-prompts, but the same won game does not re-prompt.
      const key = netHeadKey();
      if (key === null || key === rematchPromptedFor) return;
      rematchPromptedFor = key;
      if (rematchPrompt()) startFreshNetGame();
    };

    // On EVERY session-state change — a local move, a REMOTE move adopted by the transport pump
    // (the resync link), presence, or a conflict — adopt the session's authoritative game into the
    // scene (re-rendering a remote move) and repaint the widgets. This is the render half of "ONE
    // authoritative game per session"; without it a peer's move never reaches the board (issue #4).
    // A finished game additionally offers a rematch (Task 6.4).
    session.onChange(() => {
      scene.adoptNetState();
      refreshUi();
      maybePromptRematch();
    });
    refreshUi();
    log.info('net session wired');
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
  listArchive: () => listArchive(),
  // Task 6.6 review vs resume: Review loads read-only (browse the slider); Resume loads + continues
  // playing under a fresh accumulating record. Two DISTINCT app seams the widget's two buttons call.
  reviewArchived: (id) => reviewArchived(id),
  resumeArchived: (id) => resumeArchived(id),
  getHelpSources: () => scene.getHelpSources(),
  // Live colour preview: the settings modal drives the scene's applyColors seam so a colour /
  // opacity edit updates the rendered scene immediately (background + line opacity + line colours).
  applyColors: (preview) => scene.applyColors(preview),
  // Networking (Task 5.5): the net widget reads the live session readout via the scene's getNet,
  // stashes a validated join code via setPendingJoinCode, and copies the game code to the clipboard.
  getNet: () => scene.getNet(),
  setPendingJoinCode: (code) => scene.setPendingJoinCode(code),
  copyToClipboard: (text) => navigator.clipboard.writeText(text),
  // History slider (Task 5.6): the slider reads the scene's read-only history readout and drives
  // its local scrub seam — no command dispatch (it emits/syncs nothing; design Part 6 / GLOSSARY).
  getHistory: () => scene.getHistory(),
  scrubTo: (k) => scene.scrubTo(k),
});

/** Repaint every widget from the live state + the banner history context (Task 5.2). */
function refreshUi(): void {
  ui.container.update(scene.getState(), scene.getBannerContext());
}
refreshUi();
// Repaint on every board change (place/undo/redo/reset) so the banner's turn/captures/enabled
// stay live regardless of whether the change came from a button, a hotkey, or a canvas click.
scene.onStateChange(refreshUi);

// Expose the inspection API so browser agents (Playwright, cdp) can read real state.
// Kept unconditional for the v1 walking skeleton; a prod gate lands with the real build.
installInspectApi(scene, ui, { listArchive: () => listArchive() });

log.info('app booted');
