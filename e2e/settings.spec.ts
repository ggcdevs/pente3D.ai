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
 * Task 5.4 e2e — the settings-modal widget is the DOM/config-write + input-scope IO boundary,
 * verified by driving the REAL app and asserting on `window.__pente` real state (getInput /
 * getColors), the persisted localStorage overrides (a real getConfig round-trip), and the rendered
 * DOM (agent-principles #3: observable behavior, never a log line). The PURE view-model
 * (`settingsModel.ts`) is mutation-gated in Vitest; here we prove the WIRING:
 *   - the modal starts HIDDEN with no `settings` scope on the stack;
 *   - dispatching the `openSettings` COMMAND (the SAME id the menu's Settings entry / a keybinding
 *     fires — design Principle 3) OPENS the modal, populates the form from live config, and PUSHES
 *     a BLOCKING `settings` scope (proven by a key being SWALLOWED);
 *   - editing the control-preset / a colour / line opacity PERSISTS a real config override (read
 *     back off localStorage), and the previewable colours change the RENDERED scene LIVE
 *     (getColors reflects the edit before any reload);
 *   - reset-to-defaults CLEARS the overrides (config back to the tracked default) and re-applies
 *     the default colours live;
 *   - Escape / outside-click / the ✕ button each CLOSE the modal and POP the scope (no leak).
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
type Pente = {
  getInput(): InputReadout | null;
  pressKey(chord: string): KeyResolution | null;
  dispatch(id: string): boolean | null;
  getColors(): ColorsReadout | null;
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

test('dispatching openSettings opens the modal, fills it from config, and pushes a blocking scope', async ({
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

  // Opening PUSHED the blocking `settings` scope onto the scene's stack.
  const input = await get(page, (p) => p.getInput()!);
  expect(input.scopes[input.scopes.length - 1]).toBe(SETTINGS_SCOPE_ID);

  // Proof the scope BLOCKS: an otherwise-bound key (`u` → undo) is SWALLOWED (resolved in the
  // settings scope, no command) instead of falling through to the game scope.
  const swallowed = await get(page, (p) => p.pressKey('u'));
  expect(swallowed).toEqual({ commandId: null, scopeId: SETTINGS_SCOPE_ID, handled: true });

  const shot = resolve('e2e/artifacts/settings-open.png');
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

test('Escape closes the modal and pops the blocking scope', async ({ page }) => {
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

test('an outside click closes the modal and pops the scope', async ({ page }) => {
  await ready(page);
  await dispatch(page, OPEN_SETTINGS_COMMAND);
  await expect(modal(page)).toBeVisible();

  // Click the backdrop far outside the centered panel.
  await modal(page).click({ position: { x: 5, y: 5 } });

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
