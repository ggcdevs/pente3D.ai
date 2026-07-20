import { createScene } from './render/scene.ts';
import { createUi } from './ui/setup.ts';
import { installInspectApi } from './debug/window.ts';
import { createLogger } from './debug/log.ts';
import { createAppNetSession } from './net/appSession.ts';
import { shouldRenderSessionGame } from './net/netRouting.ts';
import { headHash } from './core/eventLog.ts';
import { openDatabase, resolveDbName } from './persist/db.ts';
import {
  saveGame,
  loadGame as loadArchivedGame,
  loadConflicted,
  listArchivedGames,
  type ArchivedMeta,
} from './persist/archive.ts';
import type { ArchiveListing } from './ui/widgets/archiveModel.ts';

const log = createLogger('app:boot');

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

/** The localStorage key holding the current local game's stable archive id (restored on boot). */
const AUTOSAVE_ID_KEY = 'pente:autosave:id';

/** Resolve (creating on first run) the stable archive id the current local game autosaves under. */
function resolveAutosaveId(): string {
  const existing = window.localStorage.getItem(AUTOSAVE_ID_KEY);
  if (existing !== null && existing.length > 0) return existing;
  const id = crypto.randomUUID();
  window.localStorage.setItem(AUTOSAVE_ID_KEY, id);
  return id;
}

const autosaveId = resolveAutosaveId();

// A single startedAt for the life of this local game so successive autosaves overwrite ONE record
// (the archive keys by id; overwriting keeps the archive current as the game grows — archive.ts).
const autosaveStartedAt = Date.now();

/** The metadata attached to the autosaved local game (single-player defaults; startedAt is stable). */
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

void openDatabase(resolveDbName())
  .then(async (db) => {
    archiveDb = db;
    // RESTORE ON LOAD: if a game was autosaved under our id, reconstruct it (fold its event log)
    // and swap it into the scene, so a refresh resumes exactly where the player left off. A corrupt
    // stored log surfaces honestly via the catch below (never a silently-broken board).
    const restored = await loadArchivedGame(db, autosaveId);
    if (restored !== undefined) {
      scene.loadGame(restored);
      refreshUi();
      log.info('autosaved game restored', { id: autosaveId, ply: restored.ply() });
    }
    // AUTOSAVE: persist the current game on every state change (place/undo/redo/reset/load). The
    // archive keys by id, so each save overwrites the one record, keeping it current. A write error
    // is surfaced honestly (never swallowed as a silent success).
    scene.onStateChange(() => {
      if (archiveDb === null) return;
      void saveGame(archiveDb, autosaveId, scene.getGame(), autosaveMeta()).catch((err: unknown) => {
        log.error('autosave failed', err);
      });
    });
    // Persist the initial state immediately so a fresh game is browsable even before the first move.
    await saveGame(db, autosaveId, scene.getGame(), autosaveMeta());
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
 * Reconstruct the archived game `id` and swap it into the scene for review (Task 5.8). A conflicted
 * record has no single game — we load its LOCAL fork (`mine`) so the browser can review the fork the
 * player was on (GLOSSARY "conflict": both forks are stored; resolution is a future feature). An
 * ordinary record reconstructs directly. An absent/corrupt record surfaces honestly (logged), never
 * a silent no-op masquerading as success.
 */
async function loadArchived(id: string): Promise<void> {
  if (archiveDb === null) return;
  try {
    const conflicted = await loadConflictedIfAny(archiveDb, id);
    const game = conflicted ?? (await loadArchivedGame(archiveDb, id));
    if (game === undefined) {
      log.error('archive load: no such game', { id });
      return;
    }
    scene.loadGame(game);
    refreshUi();
    log.info('archived game loaded', { id, ply: game.ply() });
  } catch (err: unknown) {
    log.error('archive load failed', { id, err });
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
    scene.setNetHooks({
      host: () => void session.host().then(refreshUi),
      join: () => void session.join(pendingJoinCode).then(refreshUi),
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
    // On EVERY session-state change — a local move, a REMOTE move adopted by the transport pump
    // (the resync link), presence, or a conflict — adopt the session's authoritative game into the
    // scene (re-rendering a remote move) and repaint the widgets. This is the render half of "ONE
    // authoritative game per session"; without it a peer's move never reaches the board (issue #4).
    session.onChange(() => {
      scene.adoptNetState();
      refreshUi();
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
const ui = createUi(container, {
  dispatch: (id) => scene.dispatch(id),
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
  loadArchived: (id) => loadArchived(id),
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
