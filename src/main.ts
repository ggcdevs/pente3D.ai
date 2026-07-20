import { createScene } from './render/scene.ts';
import { createUi } from './ui/setup.ts';
import { installInspectApi } from './debug/window.ts';
import { createLogger } from './debug/log.ts';

const log = createLogger('app:boot');

const container = document.getElementById('app');
if (!container) {
  throw new Error('#app container not found');
}

const scene = createScene(container);

// Composable UI shell (Task 5.1+): the config-driven widget overlay mounted over the canvas.
// Its zones/order are pure `layout` config; the container is the DOM glue. Widgets dispatch
// command ids through the scene's registry — the SAME path a keybinding uses (design Principle
// 3) — so a button and a hotkey fire the identical command. Kept in sync with live state so its
// widgets (Task 5.2 status banner) read the current game + history (design Part 6).
const ui = createUi(container, { dispatch: (id) => scene.dispatch(id) });

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
