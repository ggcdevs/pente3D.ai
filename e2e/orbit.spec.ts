import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

interface CameraReadout {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

/** Read the live camera from window.__pente inside the page. */
async function readCamera(page: import('@playwright/test').Page): Promise<CameraReadout> {
  return page.evaluate(() => {
    const api = (window as unknown as { __pente?: { getCamera(): CameraReadout | null } }).__pente;
    if (!api) throw new Error('window.__pente not installed');
    const cam = api.getCamera();
    if (!cam) throw new Error('getCamera() returned null');
    return cam;
  });
}

test('dragging the canvas orbits the scene (camera changes)', async ({ page }) => {
  await page.goto('/');

  // Wait for the walking-skeleton API to be installed and the canvas to exist.
  await page.waitForFunction(() => {
    const api = (window as unknown as { __pente?: unknown }).__pente;
    return !!api && !!document.querySelector('canvas');
  });

  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');

  // Prove WebGL actually initialized: getCamera must return usable numbers.
  const before = await readCamera(page);
  expect(Number.isFinite(before.position.x)).toBe(true);

  // Drag across the canvas center to orbit.
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 220, cy + 120, { steps: 24 });
  await page.mouse.up();

  // Give the render loop a couple frames to settle.
  await page.waitForTimeout(200);

  const after = await readCamera(page);

  // The orbit must have moved the camera position off its starting point.
  const dx = after.position.x - before.position.x;
  const dy = after.position.y - before.position.y;
  const dz = after.position.z - before.position.z;
  const moved = Math.hypot(dx, dy, dz);

  console.log('CAMERA before:', JSON.stringify(before));
  console.log('CAMERA after :', JSON.stringify(after));
  console.log('CAMERA moved distance:', moved.toFixed(4));

  expect(moved).toBeGreaterThan(0.01);

  // Save a screenshot artifact of the orbited scene.
  const shotPath = resolve('e2e/artifacts/orbited-scene.png');
  mkdirSync(dirname(shotPath), { recursive: true });
  await page.screenshot({ path: shotPath });
  console.log('SCREENSHOT saved to:', shotPath);
});
