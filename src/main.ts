import { createScene } from './render/scene.ts';
import { createUi } from './ui/setup.ts';
import { installInspectApi } from './debug/window.ts';
import { createLogger } from './debug/log.ts';
import { createAppNetSession } from './net/appSession.ts';

const log = createLogger('app:boot');

const container = document.getElementById('app');
if (!container) {
  throw new Error('#app container not found');
}

const scene = createScene(container);

// Networking session (Task 5.5): the SyncEngine + seat manager wiring the net widget drives. It is
// an app-level object (needs an IndexedDB handle + a transport), so the app owns it and wires it to
// the scene's net hooks. The join code the widget types is stashed here, then read on `join`. The
// session is created async (opening IndexedDB); until it resolves the scene reports an offline
// session and host/join are no-ops (never a crash — design Principle 3). Board size is the scene's
// live board size so the networked game matches the rendered board.
let pendingJoinCode = '';
void createAppNetSession(scene.getState().size)
  .then((session) => {
    scene.setNetHooks({
      host: () => void session.host().then(refreshUi),
      join: () => void session.join(pendingJoinCode).then(refreshUi),
      setPendingJoinCode: (code) => {
        pendingJoinCode = code;
      },
      getNet: () => session.state(),
    });
    // Repaint the net widget on every session-state change (connect/presence/conflict), regardless
    // of what triggered it — the same pattern the board uses via onStateChange.
    session.onChange(() => refreshUi());
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
  // Live colour preview: the settings modal drives the scene's applyColors seam so a colour /
  // opacity edit updates the rendered scene immediately (background + line opacity + line colours).
  applyColors: (preview) => scene.applyColors(preview),
  // Networking (Task 5.5): the net widget reads the live session readout via the scene's getNet,
  // stashes a validated join code via setPendingJoinCode, and copies the game code to the clipboard.
  getNet: () => scene.getNet(),
  setPendingJoinCode: (code) => scene.setPendingJoinCode(code),
  copyToClipboard: (text) => navigator.clipboard.writeText(text),
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
installInspectApi(scene, ui);

log.info('app booted');
