import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import lightingDefault from '../src/config/defaults/lighting.json' with { type: 'json' };
import colorsDefault from '../src/config/defaults/colors.json' with { type: 'json' };

/**
 * Task 4.1 scene-bootstrap e2e: the renderer/camera/lights/resize are an IO boundary,
 * verified by driving the real app and asserting on `window.__pente` readouts — the
 * lights/background must come FROM config, and a viewport resize must actually change
 * the renderer's drawing-buffer size + camera aspect (observable behavior, not a log
 * line; agent-principles #2/#3). The default config JSON is imported here so the
 * expected values are the single source of truth — no hardcoded volatile facts
 * (agent-principles #8).
 */

interface Vec3 {
  x: number;
  y: number;
  z: number;
}
interface LightingReadout {
  background: number;
  ambient: { color: number; intensity: number };
  directional: { color: number; intensity: number; position: Vec3 };
}
interface ViewportReadout {
  width: number;
  height: number;
  aspect: number;
}

/** `#rrggbb` → integer, mirroring the app's pure resolver, for building expectations. */
function hexToInt(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

async function readLighting(page: import('@playwright/test').Page): Promise<LightingReadout> {
  return page.evaluate(() => {
    const api = (window as unknown as { __pente?: { getLighting(): LightingReadout | null } })
      .__pente;
    if (!api) throw new Error('window.__pente not installed');
    const l = api.getLighting();
    if (!l) throw new Error('getLighting() returned null');
    return l;
  });
}

async function readViewport(page: import('@playwright/test').Page): Promise<ViewportReadout> {
  return page.evaluate(() => {
    const api = (window as unknown as { __pente?: { getViewportSize(): ViewportReadout | null } })
      .__pente;
    if (!api) throw new Error('window.__pente not installed');
    const v = api.getViewportSize();
    if (!v) throw new Error('getViewportSize() returned null');
    return v;
  });
}

test('scene lights + background are built from config (getLighting)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => {
    const api = (window as unknown as { __pente?: { getLighting?: unknown } }).__pente;
    return !!api && typeof api.getLighting === 'function' && !!document.querySelector('canvas');
  });

  const lighting = await readLighting(page);
  console.log('LIGHTING readout:', JSON.stringify(lighting));

  // Every value must equal the tracked default config, resolved (hex → int).
  expect(lighting.background).toBe(hexToInt(colorsDefault.background));
  expect(lighting.ambient.color).toBe(hexToInt(lightingDefault.ambient.color));
  expect(lighting.ambient.intensity).toBeCloseTo(lightingDefault.ambient.intensity, 5);
  expect(lighting.directional.color).toBe(hexToInt(lightingDefault.directional.color));
  expect(lighting.directional.intensity).toBeCloseTo(lightingDefault.directional.intensity, 5);
  expect(lighting.directional.position).toEqual(lightingDefault.directional.position);
});

test('renderer size + camera aspect track the viewport across a resize', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForFunction(() => {
    const api = (window as unknown as { __pente?: { getViewportSize?: unknown } }).__pente;
    return !!api && typeof api.getViewportSize === 'function' && !!document.querySelector('canvas');
  });

  const before = await readViewport(page);
  console.log('VIEWPORT before:', JSON.stringify(before));
  // Aspect must be a finite, positive number consistent with a real render surface.
  expect(before.width).toBeGreaterThan(0);
  expect(before.height).toBeGreaterThan(0);
  expect(before.aspect).toBeCloseTo(before.width / before.height, 3);

  // Resize the window; the app's resize handler must update the renderer + camera.
  await page.setViewportSize({ width: 640, height: 900 });
  await page.waitForFunction(
    (prevW) => {
      const api = (window as unknown as { __pente?: { getViewportSize(): ViewportReadout | null } })
        .__pente;
      const v = api?.getViewportSize();
      return !!v && v.width !== prevW;
    },
    before.width,
  );

  const after = await readViewport(page);
  console.log('VIEWPORT after :', JSON.stringify(after));
  expect(after.width).not.toBe(before.width);
  expect(after.aspect).not.toBeCloseTo(before.aspect, 2);
  expect(after.aspect).toBeCloseTo(after.width / after.height, 3);

  const shotPath = resolve('e2e/artifacts/scene-bootstrap.png');
  mkdirSync(dirname(shotPath), { recursive: true });
  await page.screenshot({ path: shotPath });
  console.log('SCREENSHOT saved to:', shotPath);
});
