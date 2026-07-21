import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import layoutDefault from '../src/config/defaults/layout.json' with { type: 'json' };
import colorsDefault from '../src/config/defaults/colors.json' with { type: 'json' };
import boardDefault from '../src/config/defaults/board.json' with { type: 'json' };
import controlsDefault from '../src/config/defaults/controls.json' with { type: 'json' };
import {
  SETTINGS_SCOPE_ID,
  OPEN_SETTINGS_COMMAND,
  BOARD_SIZE_OPTIONS,
  COLOR_FIELDS,
} from '../src/ui/widgets/settingsModel.ts';

/**
 * Task 5.4 / B.2 (#24) e2e — the settings-panel widget is the DOM/config-write + input-scope IO
 * boundary, verified by driving the REAL app and asserting on `window.__pente` real state (getInput /
 * getColors / getCamera), the persisted localStorage overrides (a real getConfig round-trip), and
 * the rendered DOM (agent-principles #3: observable behavior, never a log line). The PURE view-model
 * (`settingsModel.ts`) is mutation-gated in Vitest; here we prove the WIRING:
 *   - the panel starts HIDDEN with no `settings` scope on the stack;
 *   - dispatching the `openSettings` COMMAND (the SAME id the menu's Settings entry / a keybinding
 *     fires — design Principle 3) OPENS the panel, populates the form from live config, and PUSHES
 *     a NON-blocking `settings` scope (#24 / Increment B) — proven by an otherwise-bound key FALLING
 *     THROUGH to the game scope (NOT swallowed), the opposite of the old centered blocking modal;
 *   - #24 MONEY-SHOT: with the panel OPEN, editing a colour / light-intensity applies to the board
 *     LIVE while the board stays VISIBLE + interactive (a camera-orbit drag on the canvas under the
 *     open panel STILL moves the camera) — the whole point of "edit while watching the board";
 *   - editing the control-preset / a colour / line opacity PERSISTS a real config override (read
 *     back off localStorage), and the previewable colours change the RENDERED scene LIVE
 *     (getColors reflects the edit before any reload);
 *   - reset-to-defaults CLEARS the overrides (config back to the tracked default) and re-applies
 *     the default colours live;
 *   - Escape / outside-click (on the live board) / the ✕ button each CLOSE the panel and POP the
 *     scope (no leak).
 * The widget id / zone / options / entries derive from the config + model so nothing is hardcoded
 * (agent-principles #8).
 */

const SETTINGS_ID = 'settings';
const COLORS_KEY = 'pente:config:colors';
const CONTROLS_KEY = 'pente:config:controls';
const BOARD_KEY = 'pente:config:board';

interface InputReadout {
  scopes: string[];
  commands: string[];
}
interface KeyResolution {
  commandId: string | null;
  scopeId: string | null;
  handled: boolean;
}
interface ColorsReadout {
  background: string;
  lineOpacity: number;
  lineOrthogonal: string;
  lineFaceDiagonal: string;
  lineSpaceDiagonal: string;
}
interface CameraReadout {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}
type Pente = {
  getInput(): InputReadout | null;
  pressKey(chord: string): KeyResolution | null;
  dispatch(id: string): boolean | null;
  getColors(): ColorsReadout | null;
  getCamera(): CameraReadout | null;
};

async function ready(page: import('@playwright/test').Page) {
  // Start each test from a clean override state so persistence assertions are unambiguous.
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.getInput === 'function' &&
      typeof p.dispatch === 'function' &&
      typeof p.getColors === 'function' &&
      !!document.querySelector('[data-widget-id="settings"]')
    );
  });
}

const get = <T,>(page: import('@playwright/test').Page, fn: (p: Pente) => T): Promise<T> =>
  page.evaluate((body: string): unknown => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    const revived = eval(`(${body})`) as (api: Pente) => unknown;
    return revived(p);
  }, fn.toString()) as Promise<T>;

/** Dispatch a command id through `window.__pente` (the id is passed as an evaluate arg, so it is
 * available in the browser context — a `.toString()`-serialized closure would not close over it). */
const dispatch = (page: import('@playwright/test').Page, id: string): Promise<boolean | null> =>
  page.evaluate((cmd: string) => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    return p.dispatch(cmd);
  }, id);

const readOverride = (page: import('@playwright/test').Page, key: string): Promise<unknown> =>
  page.evaluate((k: string) => {
    const raw = window.localStorage.getItem(k);
    return raw === null ? null : JSON.parse(raw);
  }, key);

const modal = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid="settings-modal"]');

test('the settings modal mounts hidden with no settings scope on the stack', async ({ page }) => {
  await ready(page);

  // Placement is pure config — the widget mounts into the zone the tracked layout names.
  expect(layoutDefault.widgets.settings.zone).toBe('top-right');
  const inZone = page.locator(`[data-zone="top-right"] [data-widget-id="${SETTINGS_ID}"]`);
  await expect(inZone).toHaveCount(1);

  await expect(modal(page)).toBeHidden();
  const input0 = await get(page, (p) => p.getInput()!);
  expect(input0.scopes).not.toContain(SETTINGS_SCOPE_ID);
});

test('dispatching openSettings opens the panel, fills it from config, and pushes a NON-blocking scope', async ({
  page,
}) => {
  await ready(page);

  // Open via the COMMAND path — exactly what the menu's Settings entry / a keybinding dispatches.
  const ran = await dispatch(page, OPEN_SETTINGS_COMMAND);
  expect(ran).toBe(true);

  await expect(modal(page)).toBeVisible();

  // Board-size options come from the model (BOARD_SIZE_OPTIONS); the tracked default is selected.
  const boardValues = await modal(page)
    .locator('[data-testid="settings-board-size"] option')
    .evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
  expect(boardValues).toEqual(BOARD_SIZE_OPTIONS.map((n) => String(n)));
  await expect(modal(page).locator('[data-testid="settings-board-size"]')).toHaveValue(
    String(boardDefault.size),
  );

  // Preset dropdown lists the configured presets, the active one selected.
  const presetValues = await modal(page)
    .locator('[data-testid="settings-preset"] option')
    .evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
  expect(new Set(presetValues)).toEqual(new Set(Object.keys(controlsDefault.presets)));
  await expect(modal(page).locator('[data-testid="settings-preset"]')).toHaveValue(
    controlsDefault.preset,
  );

  // Every colour field is present and seeded from the tracked colours default.
  for (const field of COLOR_FIELDS) {
    const input = modal(page).locator(`[data-testid="settings-color-${field.key}"]`);
    await expect(input).toHaveValue(
      (colorsDefault as Record<string, string>)[field.key].toLowerCase(),
    );
  }

  // Opening PUSHED the NON-blocking `settings` scope onto the scene's stack.
  const input = await get(page, (p) => p.getInput()!);
  expect(input.scopes[input.scopes.length - 1]).toBe(SETTINGS_SCOPE_ID);

  // #24 / Increment B NON-BLOCKING proof (key path): an otherwise-bound key is NOT swallowed by the
  // `settings` scope — it FALLS THROUGH to the game scope below and resolves its command (`u` →
  // `undo`). This is the exact OPPOSITE of the old centered blocking modal, which reported
  // {scopeId:'settings', commandId:null}. The scope that decides is `game`, not `settings`.
  const fellThrough = await get(page, (p) => p.pressKey('u'));
  expect(fellThrough.scopeId).toBe('game');
  expect(fellThrough.commandId).toBe('undo');
  expect(fellThrough.handled).toBe(true);

  const shot = resolve('e2e/artifacts/settings-open.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('#24 MONEY-SHOT: with the settings panel OPEN, a colour edit updates the board LIVE while the board stays VISIBLE + interactive (no reload)', async ({
  page,
}) => {
  // The whole point of Increment B (#24): open Settings WITHIN the drawer context and EDIT WHILE
  // WATCHING the board. This asserts BOTH halves at once, off real render/camera state (never a log
  // line — agent-principles #3):
  //   1. a colour edit made through the settings UI reflects on the LIVE board immediately (getColors
  //      reads back the real Three.js scene background), with NO reload — reusing Increment A's
  //      setConfig → onConfigChange → scene.applyConfig path;
  //   2. the board is STILL INTERACTIVE under the open panel — a camera-orbit drag on the canvas
  //      moves the camera (getCamera delta). Under the OLD blocking modal the full-viewport backdrop
  //      swallowed this drag (delta ~0) and the settings scope swallowed every key.
  await ready(page);

  expect(await dispatch(page, OPEN_SETTINGS_COMMAND)).toBe(true);
  await expect(modal(page)).toBeVisible();

  // The panel really is open (its scope is on the stack) AND the board stays live under it.
  const openInput = await get(page, (p) => p.getInput()!);
  expect(openInput.scopes[openInput.scopes.length - 1]).toBe(SETTINGS_SCOPE_ID);

  // --- Half 1: edit a colour through the UI; the LIVE board reflects it with no reload. ---------
  const before = await get(page, (p) => p.getColors()!);
  const target = '#ff8800';
  expect(target).not.toBe(before.background);
  await modal(page).locator('[data-testid="settings-color-background"]').evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = '#ff8800';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const afterEdit = await get(page, (p) => p.getColors()!);
  expect(afterEdit.background).toBe(target); // the real scene background changed LIVE

  // --- Half 2: the board is still interactive — orbit the canvas UNDER the open panel. ----------
  const camBefore = await get(page, (p) => p.getCamera()!);
  expect(Number.isFinite(camBefore.position.x)).toBe(true);

  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  // Drag on the LEFT of the canvas, well clear of the 320px right-edge settings panel.
  const cx = box.x + box.width * 0.3;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 220, cy + 120, { steps: 24 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const camAfter = await get(page, (p) => p.getCamera()!);
  const moved = Math.hypot(
    camAfter.position.x - camBefore.position.x,
    camAfter.position.y - camBefore.position.y,
    camAfter.position.z - camBefore.position.z,
  );
  // The camera MUST have moved — proof the panel is non-blocking (board live under it).
  expect(moved).toBeGreaterThan(0.01);

  // The LIVE edit survives the interaction — the board still shows the edited colour (no reload).
  const stillEdited = await get(page, (p) => p.getColors()!);
  expect(stillEdited.background).toBe(target);

  // Money-shot: the board (edited to #ff8800) visible + live with the settings panel open over it.
  const shot = resolve('e2e/artifacts/settings-live-while-open.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('changing the control preset persists a real config override', async ({ page }) => {
  await ready(page);
  await dispatch(page, OPEN_SETTINGS_COMMAND);
  await expect(modal(page)).toBeVisible();

  // Pick a preset different from the default and assert it is persisted (a real getConfig-shaped
  // override in localStorage — observable behavior, not a log line).
  const target = Object.keys(controlsDefault.presets).find((p) => p !== controlsDefault.preset)!;
  await modal(page).locator('[data-testid="settings-preset"]').selectOption(target);

  expect(await readOverride(page, CONTROLS_KEY)).toEqual({ preset: target });
});

test('editing the background colour previews live AND persists', async ({ page }) => {
  await ready(page);
  await dispatch(page, OPEN_SETTINGS_COMMAND);
  await expect(modal(page)).toBeVisible();

  const before = await get(page, (p) => p.getColors()!);
  expect(before.background).toBe(colorsDefault.background.toLowerCase());

  // A native <input type=color> only fires `input` via a value set + dispatched event.
  await modal(page).locator('[data-testid="settings-color-background"]').evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = '#ff8800';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // The rendered scene background changed LIVE (before any reload) — render truth via getColors.
  const after = await get(page, (p) => p.getColors()!);
  expect(after.background).toBe('#ff8800');

  // And it persisted as a colours override (lower-cased canonical form).
  expect(await readOverride(page, COLORS_KEY)).toEqual({ background: '#ff8800' });
});

test('editing a line colour previews live on the gridlines AND persists', async ({ page }) => {
  await ready(page);
  await dispatch(page, OPEN_SETTINGS_COMMAND);
  await expect(modal(page)).toBeVisible();

  await modal(page).locator('[data-testid="settings-color-lineOrthogonal"]').evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = '#00ffaa';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  const after = await get(page, (p) => p.getColors()!);
  expect(after.lineOrthogonal).toBe('#00ffaa');
  expect(await readOverride(page, COLORS_KEY)).toEqual({ lineOrthogonal: '#00ffaa' });
});

test('editing line opacity previews live AND persists', async ({ page }) => {
  await ready(page);
  await dispatch(page, OPEN_SETTINGS_COMMAND);
  await expect(modal(page)).toBeVisible();

  await modal(page).locator('[data-testid="settings-opacity"]').evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = '0.9';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  const after = await get(page, (p) => p.getColors()!);
  expect(after.lineOpacity).toBeCloseTo(0.9, 5);
  expect(await readOverride(page, COLORS_KEY)).toEqual({ lineOpacity: 0.9 });
});

test('changing the board size persists an override the scene reads on reload', async ({ page }) => {
  await ready(page);
  await dispatch(page, OPEN_SETTINGS_COMMAND);
  await expect(modal(page)).toBeVisible();

  const target = BOARD_SIZE_OPTIONS.find((n) => n !== boardDefault.size)!;
  await modal(page).locator('[data-testid="settings-board-size"]').selectOption(String(target));

  expect(await readOverride(page, BOARD_KEY)).toEqual({ size: target });
});

test('reset-to-defaults clears every override and re-applies the default colours live', async ({
  page,
}) => {
  await ready(page);
  await dispatch(page, OPEN_SETTINGS_COMMAND);
  await expect(modal(page)).toBeVisible();

  // Dirty several sections first.
  await modal(page).locator('[data-testid="settings-color-background"]').evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = '#123456';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const target = Object.keys(controlsDefault.presets).find((p) => p !== controlsDefault.preset)!;
  await modal(page).locator('[data-testid="settings-preset"]').selectOption(target);
  expect(await readOverride(page, COLORS_KEY)).not.toBeNull();
  expect(await readOverride(page, CONTROLS_KEY)).not.toBeNull();

  // Reset — every owned override is removed (config back to tracked defaults).
  await modal(page).locator('[data-testid="settings-reset"]').click();
  expect(await readOverride(page, COLORS_KEY)).toBeNull();
  expect(await readOverride(page, CONTROLS_KEY)).toBeNull();
  expect(await readOverride(page, BOARD_KEY)).toBeNull();

  // The rendered background is restored to the tracked default LIVE (not just persisted).
  const colors = await get(page, (p) => p.getColors()!);
  expect(colors.background).toBe(colorsDefault.background.toLowerCase());

  // The form re-rendered from defaults: the background input shows the default again.
  await expect(modal(page).locator('[data-testid="settings-color-background"]')).toHaveValue(
    colorsDefault.background.toLowerCase(),
  );
});

test('Escape closes the panel and pops the settings scope', async ({ page }) => {
  await ready(page);
  await dispatch(page, OPEN_SETTINGS_COMMAND);
  await expect(modal(page)).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(modal(page)).toBeHidden();
  const closed = await get(page, (p) => p.getInput()!);
  expect(closed.scopes).not.toContain(SETTINGS_SCOPE_ID);
  // `u` falls through to the game scope again (resolves undo) — the block is gone.
  const afterEscape = await get(page, (p) => p.pressKey('u'));
  expect(afterEscape.scopeId).toBe('game');
  expect(afterEscape.commandId).toBe('undo');
});

test('an outside click (on the live board) closes the panel and pops the scope', async ({ page }) => {
  await ready(page);
  await dispatch(page, OPEN_SETTINGS_COMMAND);
  await expect(modal(page)).toBeVisible();

  // #24: there is NO backdrop (the panel overlays only the right edge). Click the canvas/board on
  // the LEFT — well clear of the 320px right-edge panel — which is "outside" and closes the panel.
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.5);

  await expect(modal(page)).toBeHidden();
  const closed = await get(page, (p) => p.getInput()!);
  expect(closed.scopes).not.toContain(SETTINGS_SCOPE_ID);
});

test('the ✕ button closes the modal; re-opening pushes exactly one scope', async ({ page }) => {
  await ready(page);

  await dispatch(page, OPEN_SETTINGS_COMMAND);
  const open1 = await get(page, (p) => p.getInput()!);
  expect(open1.scopes.filter((s) => s === SETTINGS_SCOPE_ID).length).toBe(1);

  await modal(page).locator('[data-testid="settings-close"]').click();
  await expect(modal(page)).toBeHidden();
  const closed = await get(page, (p) => p.getInput()!);
  expect(closed.scopes).not.toContain(SETTINGS_SCOPE_ID);

  // Re-open — exactly ONE settings scope, never two (idempotent open).
  await dispatch(page, OPEN_SETTINGS_COMMAND);
  const open2 = await get(page, (p) => p.getInput()!);
  expect(open2.scopes.filter((s) => s === SETTINGS_SCOPE_ID).length).toBe(1);
});
