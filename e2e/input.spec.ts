import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import controlsDefault from '../src/config/defaults/controls.json' with { type: 'json' };
import keybindingsDefault from '../src/config/defaults/keybindings.json' with { type: 'json' };

/**
 * Task 4.6 e2e — the input system + camera presets are an IO boundary, verified by driving
 * the REAL app and asserting on `window.__pente` (agent-principles #3: observable behavior,
 * never a log line). The pure logic (registry/scopes/keybindings/preset resolution) is
 * mutation-gated in Vitest; here we prove the wiring:
 *   - the active Fusion 360 preset is bound to the OrbitControls (orbit=middle, wheel zoom,
 *     zoom-distance limits from the tracked config SSOT);
 *   - a real scroll dolly is clamped by the preset's maxDistance;
 *   - a keybinding chord (`d` = showAllDiagonals) dispatches its command and the diagonal
 *     line groups actually become visible;
 *   - the same command id dispatched via the button path (`dispatch`) has the same effect;
 *   - an undo hotkey removes the just-placed piece (command → live Game).
 * Expected values derive from `controls.json` / `keybindings.json` so nothing is hardcoded
 * (agent-principles #8).
 */

interface CameraReadout {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}
interface CameraPresetReadout {
  name: string;
  orbitButton: string;
  panButton: string;
  rotateSpeed: number;
  panSpeed: number;
  zoomSpeed: number;
  zoomToCursor: boolean;
  minDistance: number;
  maxDistance: number;
}
interface InputReadout {
  scopes: string[];
  commands: string[];
}
interface KeyResolution {
  commandId: string | null;
  scopeId: string | null;
  handled: boolean;
}
interface LineGroupReadout {
  category: string;
  visible: boolean;
  blending: string;
  segmentCount: number;
  lineCount: number;
}
interface GameStateReadout {
  pieces: Record<string, 'white' | 'black'>;
  turn: 'white' | 'black';
}

type Pente = {
  getCamera(): CameraReadout | null;
  getCameraPreset(): CameraPresetReadout | null;
  getInput(): InputReadout | null;
  getVisibleLines(): LineGroupReadout[] | null;
  getState(): GameStateReadout | null;
  dispatch(id: string): boolean | null;
  pressKey(chord: string): KeyResolution | null;
  place(coords: [number, number, number]): GameStateReadout | null;
};

async function ready(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.getCameraPreset === 'function' &&
      typeof p.getInput === 'function' &&
      typeof p.pressKey === 'function' &&
      typeof p.dispatch === 'function' &&
      !!document.querySelector('canvas')
    );
  });
}

/**
 * Run `fn(__pente)` inside the page against the live inspection API. Playwright serializes
 * `fn` and the accessor, so `fn` must be self-contained (no closure over test variables) —
 * every call below obeys that. The `fn` is passed as a string arg and re-hydrated in-page.
 */
const get = <T,>(page: import('@playwright/test').Page, fn: (p: Pente) => T): Promise<T> =>
  page.evaluate((body: string): unknown => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    const revived = eval(`(${body})`) as (api: Pente) => unknown;
    return revived(p);
  }, fn.toString()) as Promise<T>;

test('the active Fusion 360 camera preset is bound to the controls from config', async ({
  page,
}) => {
  await ready(page);
  const preset = await get(page, (p) => p.getCameraPreset());
  expect(preset).not.toBeNull();
  const fusion = controlsDefault.presets.fusion360;

  // The active preset name + button mapping + zoom limits come straight from the SSOT.
  expect(preset!.name).toBe(controlsDefault.preset); // 'fusion360'
  expect(preset!.orbitButton).toBe('MIDDLE'); // fusion orbit gesture 'shift+middle' → MIDDLE
  expect(preset!.panButton).toBe('MIDDLE'); // fusion pan gesture 'middle' → MIDDLE
  expect(preset!.zoomToCursor).toBe(fusion.zoomToCursor);
  expect(preset!.minDistance).toBe(fusion.minDistance);
  expect(preset!.maxDistance).toBe(fusion.maxDistance);
  expect(preset!.zoomSpeed).toBe(fusion.zoomSpeed);

  // The input scope stack + command registry are installed.
  const input = await get(page, (p) => p.getInput());
  expect(input!.scopes).toContain('game');
  expect(input!.commands).toContain('undo');
  expect(input!.commands).toContain('showAllDiagonals');
});

test('scroll-zoom is clamped by the preset maxDistance (a real dolly)', async ({ page }) => {
  await ready(page);
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);

  const maxDistance = controlsDefault.presets.fusion360.maxDistance;
  const dist = (c: CameraReadout) =>
    Math.hypot(
      c.position.x - c.target.x,
      c.position.y - c.target.y,
      c.position.z - c.target.z,
    );

  const before = await get(page, (p) => p.getCamera()!);
  expect(dist(before)).toBeLessThanOrEqual(maxDistance + 1e-6);

  // Scroll far OUT (positive deltaY dollies out) — many big steps to hit the clamp.
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 200);
  await page.waitForTimeout(100);

  const after = await get(page, (p) => p.getCamera()!);
  // The camera moved (a real zoom happened) but never past the configured maxDistance.
  expect(dist(after)).toBeGreaterThan(dist(before));
  expect(dist(after)).toBeLessThanOrEqual(maxDistance + 1e-3);
});

test('a keybinding chord dispatches its command (showAllDiagonals reveals the diagonals)', async ({
  page,
}) => {
  await ready(page);
  // Start: default config hides the diagonal categories (orthogonal-only default).
  const before = await get(page, (p) => p.getVisibleLines()!);
  const faceBefore = before.find((g) => g.category === 'face')!;
  const spaceBefore = before.find((g) => g.category === 'space')!;
  expect(faceBefore.visible).toBe(false);
  expect(spaceBefore.visible).toBe(false);

  // `d` is bound to showAllDiagonals in the tracked keybindings default (assert the SSOT).
  expect(keybindingsDefault['d']).toBe('showAllDiagonals');
  const resolution = await get(page, (p) => p.pressKey('d'));
  expect(resolution).toEqual({ commandId: 'showAllDiagonals', scopeId: 'game', handled: true });

  const after = await get(page, (p) => p.getVisibleLines()!);
  expect(after.find((g) => g.category === 'face')!.visible).toBe(true);
  expect(after.find((g) => g.category === 'space')!.visible).toBe(true);

  const shot = resolve('e2e/artifacts/input-diagonals.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('the button path (dispatch by id) drives the same command as the key path', async ({
  page,
}) => {
  await ready(page);
  // toggleOrthogonal via the registry directly — same registry a UI button would use.
  const beforeOrtho = await get(
    page,
    (p) => p.getVisibleLines()!.find((g) => g.category === 'orthogonal')!.visible,
  );
  const ran = await get(page, (p) => p.dispatch('toggleOrthogonal'));
  expect(ran).toBe(true);
  const afterOrtho = await get(
    page,
    (p) => p.getVisibleLines()!.find((g) => g.category === 'orthogonal')!.visible,
  );
  expect(afterOrtho).toBe(!beforeOrtho);

  // An unknown command id is a graceful no-op (returns false, nothing crashes).
  const unknown = await get(page, (p) => p.dispatch('noSuchCommand'));
  expect(unknown).toBe(false);
});

test('an undo hotkey removes the just-placed piece (command → live Game)', async ({ page }) => {
  await ready(page);
  const placed = await get(page, (p) => p.place([2, 2, 2]));
  expect(placed!.pieces['2,2,2']).toBe('white');

  // `u` is bound to undo in the tracked default.
  expect(keybindingsDefault['u']).toBe('undo');
  const resolution = await get(page, (p) => p.pressKey('u'));
  expect(resolution!.commandId).toBe('undo');

  const state = await get(page, (p) => p.getState()!);
  // The undo command rewound the placement: the piece is gone and it is white's turn again.
  expect(state.pieces['2,2,2']).toBeUndefined();
  expect(state.turn).toBe('white');
});
