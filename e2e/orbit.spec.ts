import { test, expect } from '@playwright/test';

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

  // Proof is the asserted camera delta, NOT a screenshot. We deliberately do
  // NOT write a decorative PNG here: a screenshot is an un-asserted side effect
  // (an image whose pixels no test inspects), and a gitignored PNG cannot be
  // regenerated from the tracked tree — so treating one as "e2e proof" is
  // proof-by-inference (agent-principles.md #3: proof = observable behavior).
  // Playwright's `screenshot: 'only-on-failure'` in playwright.config.ts still
  // captures a diagnostic image when this assertion FAILS, which is legitimate
  // debugging output, not a verification artifact.
  expect(moved).toBeGreaterThan(0.01);
});
