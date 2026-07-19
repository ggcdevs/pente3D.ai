import { createScene } from './render/scene.ts';
import { installInspectApi } from './debug/window.ts';
import { createLogger } from './debug/log.ts';

const log = createLogger('app:boot');

const container = document.getElementById('app');
if (!container) {
  throw new Error('#app container not found');
}

const scene = createScene(container);

// Expose the inspection API so browser agents (Playwright, cdp) can read real state.
// Kept unconditional for the v1 walking skeleton; a prod gate lands with the real build.
installInspectApi(scene);

log.info('app booted');
