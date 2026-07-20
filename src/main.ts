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

// Composable UI shell (Task 5.1): the config-driven widget overlay mounted over the canvas.
// Its zones/order are pure `layout` config; the container is the DOM glue. Kept in sync with
// live state so its widgets read the current game (design Part 6).
const ui = createUi(container);
ui.container.update(scene.getState(), null);

// Expose the inspection API so browser agents (Playwright, cdp) can read real state.
// Kept unconditional for the v1 walking skeleton; a prod gate lands with the real build.
installInspectApi(scene, ui);

log.info('app booted');
