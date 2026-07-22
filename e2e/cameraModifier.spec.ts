import { test, expect } from '@playwright/test';
import controlsDefault from '../src/config/defaults/controls.json' with { type: 'json' };

/**
 * Camera-controls modifier fix — e2e (the REAL proof; agent-principles #3: observable behavior,
 * never a log line). The pure gesture parse is mutation-gated in Vitest (`parseGesture.test.ts`);
 * here we drive the live app on the WEB preset and prove the wiring the maintainer asked for:
 *
 *   left-click-drag = ROTATE (orbit), Shift + left-click-drag = PAN, wheel = zoom.
 *
 * The bug: the old glue dropped a gesture's `shift+`/`ctrl+` modifier, so web's `orbit: "left"`
 * and pan (then `ctrl+left`) both resolved to LEFT and collided — pan won, so plain left DRAG
 * PANNED (the inverse of intended). The fix binds each button to its gesture's UN-modified action
 * (base LEFT = ROTATE) and lets OrbitControls' native ctrl/meta/shift → rotate↔pan inversion make
 * Shift+left PAN. `getCameraPreset().mouseButtons` reports the EFFECTIVE action, so a held Shift is
 * observable there too.
 *
 * We force the WEB preset via a localStorage `controls` override BEFORE boot (exactly how a stored
 * user override reaches the config store on load), because the preset is bound onto OrbitControls at
 * scene construction. Expected values derive from the tracked `controls.json` SSOT (agent-principles
 * #8). ROTATE=0 / DOLLY=1 / PAN=2 are THREE.MOUSE constants.
 */

const ROTATE = 0;
const PAN = 2;
const OVERRIDE_KEY = 'pente:config:controls';

interface CameraReadout {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}
interface CameraPresetReadout {
  name: string;
  orbitButton: string;
  panButton: string;
  mouseButtons: { LEFT: number | undefined; MIDDLE: number | undefined; RIGHT: number | undefined };
}
interface Pente {
  getCamera(): CameraReadout | null;
  getCameraPreset(): CameraPresetReadout | null;
}

const get = <T,>(page: import('@playwright/test').Page, fn: (p: Pente) => T): Promise<T> =>
  page.evaluate((body: string): unknown => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    const revived = eval(`(${body})`) as (api: Pente) => unknown;
    return revived(p);
  }, fn.toString()) as Promise<T>;

/** Force the WEB preset (the maintainer's preset) via a stored `controls` override before boot. */
async function bootWebPreset(page: import('@playwright/test').Page) {
  await page.addInitScript(
    ([key]) => window.localStorage.setItem(key, JSON.stringify({ preset: 'web' })),
    [OVERRIDE_KEY] as const,
  );
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.getCamera === 'function' &&
      typeof p.getCameraPreset === 'function' &&
      !!document.querySelector('canvas')
    );
  });
}

/** Canvas center in page pixels. */
async function center(page: import('@playwright/test').Page) {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas box');
  return { cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

test.describe('WEB preset: left = rotate, Shift+left = pan (camera-controls modifier fix)', () => {
  test('the WEB override actually took (base LEFT = ROTATE from the SSOT)', async ({ page }) => {
    await bootWebPreset(page);
    const preset = await get(page, (p) => p.getCameraPreset());
    expect(preset).not.toBeNull();
    // The stored override swapped the active preset to web (proves the boot fixture bites — an
    // un-applied override would leave the default fusion360).
    expect(preset!.name).toBe('web');
    expect(controlsDefault.presets.web.orbit).toBe('left'); // SSOT: un-modified LEFT
    expect(controlsDefault.presets.web.pan).toBe('shift+left'); // SSOT: Shift-gated LEFT (the fix)
    // At rest (no modifier held) LEFT rests at ROTATE — NOT pan (the old collision made it PAN).
    expect(preset!.mouseButtons.LEFT).toBe(ROTATE);
  });

  test('(a) no modifier: a left-drag ROTATES the camera (orbit, not pan)', async ({ page }) => {
    await bootWebPreset(page);
    const before = await get(page, (p) => p.getCamera()!);

    const { cx, cy } = await center(page);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 200, cy + 100, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(120);

    const after = await get(page, (p) => p.getCamera()!);
    const posMoved = Math.hypot(
      after.position.x - before.position.x,
      after.position.y - before.position.y,
      after.position.z - before.position.z,
    );
    const targetMoved = Math.hypot(
      after.target.x - before.target.x,
      after.target.y - before.target.y,
      after.target.z - before.target.z,
    );
    // Orbit swings the camera POSITION around a (near-)fixed target. A pan would instead translate
    // the target. So: position moved a lot, target essentially fixed → this was a ROTATE.
    expect(posMoved).toBeGreaterThan(0.1);
    expect(targetMoved).toBeLessThan(0.05);
  });

  test('(b) Shift held: mouseButtons.LEFT flips to PAN and a Shift+left-drag PANS', async ({
    page,
  }) => {
    await bootWebPreset(page);

    // A real DOM Shift keydown: our modifier observer sees it, so the EFFECTIVE readout flips…
    await page.keyboard.down('Shift');
    const held = await get(page, (p) => p.getCameraPreset()!);
    expect(held.mouseButtons.LEFT).toBe(PAN);

    // …and a left-drag WHILE Shift is held pans (OrbitControls' native inversion makes it pan):
    // the orbit TARGET translates, not just the camera angle.
    const before = await get(page, (p) => p.getCamera()!);
    const { cx, cy } = await center(page);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 200, cy + 100, { steps: 20 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.waitForTimeout(120);

    const after = await get(page, (p) => p.getCamera()!);
    const targetMoved = Math.hypot(
      after.target.x - before.target.x,
      after.target.y - before.target.y,
      after.target.z - before.target.z,
    );
    // A pan translates the orbit target (a rotate leaves it ~fixed) — so a moved target is the
    // observable proof this Shift+left-drag PANNED, not rotated.
    expect(targetMoved).toBeGreaterThan(0.1);
  });

  test('(c) Shift keyup restores mouseButtons.LEFT to ROTATE', async ({ page }) => {
    await bootWebPreset(page);
    expect((await get(page, (p) => p.getCameraPreset()!)).mouseButtons.LEFT).toBe(ROTATE);
    await page.keyboard.down('Shift');
    expect((await get(page, (p) => p.getCameraPreset()!)).mouseButtons.LEFT).toBe(PAN);
    await page.keyboard.up('Shift');
    // Released → back to the resting ROTATE. Proves the gate is transient, not a one-way flip.
    expect((await get(page, (p) => p.getCameraPreset()!)).mouseButtons.LEFT).toBe(ROTATE);
  });
});
