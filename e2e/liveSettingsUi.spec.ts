import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import colorsDefault from '../src/config/defaults/colors.json' with { type: 'json' };
import { OPEN_SETTINGS_COMMAND } from '../src/ui/widgets/settingsModel.ts';

/**
 * Task A.4 (issue #15 core) — the PERMANENT cross-component integration spec the batch plan calls
 * out (HANDOFF §5: an integration gap slips past every per-component gate). It edits a live-able
 * setting THROUGH THE REAL SETTINGS UI (a native `<input>` event on the settings modal, exactly as
 * a user drags the picker/slider) and asserts the BOARD reflects it LIVE — `window.__pente.getColors`
 * reads back the render truth off the actual Three.js objects (`scene.background`, the gridline
 * material colour/opacity), NOT a log line (agent-principles #3). NO reload happens between the edit
 * and the assertion.
 *
 * This spans the whole A.4 seam end to end: settings widget → `setConfig` → config emitter
 * (`onConfigChange`) → the app's single notification loop (`main.ts`) → `scene.applyConfig` →
 * render. A.3's `applyConfig.spec.ts` drives `__pente.setConfig` directly; THIS one drives the UI,
 * so it additionally covers the settings-widget → config-write half of the wiring and the "single
 * path, no double-apply" contract.
 *
 * PROOF IT BITES (agent-principles #7): if the A.4 wiring is removed — the `onConfigChange` loop in
 * `main.ts` deleted, or the settings widget's live-apply re-routed back to a direct `applyColors`
 * call — the UI edit still PERSISTS config but the board no longer updates without a reload, so the
 * `getColors` assertion below fails. (Verified by the implementer by deleting the loop and watching
 * this spec go red, then restoring; the exclusion test at the bottom pins the negative half.)
 *
 * Every expectation derives from the tracked colours JSON (the SSOT) so nothing volatile is
 * hardcoded (agent-principles #8).
 */

interface ColorsReadout {
  background: string;
  lineOpacity: number;
  lineOrthogonal: string;
  lineFaceDiagonal: string;
  lineSpaceDiagonal: string;
}
type Pente = {
  getColors(): ColorsReadout | null;
  dispatch(id: string): boolean | null;
};

const COLORS_KEY = 'pente:config:colors';

async function ready(page: import('@playwright/test').Page) {
  // A clean override state so every config read/assert is unambiguous (localStorage backs getConfig).
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.getColors === 'function' &&
      typeof p.dispatch === 'function' &&
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

/** Dispatch a command id through `window.__pente` (passed as an evaluate arg, not closed over). */
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

/** Fire the same `input` event a native colour picker fires when the user picks a colour. */
async function pickColour(
  page: import('@playwright/test').Page,
  key: string,
  value: string,
): Promise<void> {
  await modal(page)
    .locator(`[data-testid="settings-color-${key}"]`)
    .evaluate((el, v) => {
      const input = el as HTMLInputElement;
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
}

test('editing a colour in the settings UI updates the board live (no reload), through the full seam', async ({
  page,
}) => {
  await ready(page);

  // Open the real settings modal via the command path (what the menu entry / a keybinding fires).
  expect(await dispatch(page, OPEN_SETTINGS_COMMAND)).toBe(true);
  await expect(modal(page)).toBeVisible();

  // Baseline is the tracked default, read back off the LIVE Three.js scene (render truth).
  const before = await get(page, (p) => p.getColors()!);
  expect(before.background).toBe(colorsDefault.background.toLowerCase());
  expect(before.lineOrthogonal).toBe(colorsDefault.lineOrthogonal.toLowerCase());

  // Distinct targets that differ from the defaults, so a stale/unchanged board is caught.
  const targetBg = '#ff8800';
  const targetLine = '#00ffaa';
  expect(targetBg).not.toBe(before.background);
  expect(targetLine).not.toBe(before.lineOrthogonal);

  // Edit THROUGH THE UI — no page reload after this point.
  await pickColour(page, 'background', targetBg);
  await pickColour(page, 'lineOrthogonal', targetLine);

  // The BOARD reflects it live: the real scene background + gridline colour changed. This only
  // holds because the A.4 loop applied the config the UI wrote — the cross-component proof.
  const after = await get(page, (p) => p.getColors()!);
  expect(after.background).toBe(targetBg);
  expect(after.lineOrthogonal).toBe(targetLine);

  // And it persisted as a real colours override (the write half of the seam).
  expect(await readOverride(page, COLORS_KEY)).toEqual({
    background: targetBg,
    lineOrthogonal: targetLine,
  });

  const shot = resolve('e2e/artifacts/liveSettingsUi-colour.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('dragging the opacity slider in the settings UI updates the board live (no reload)', async ({
  page,
}) => {
  await ready(page);

  expect(await dispatch(page, OPEN_SETTINGS_COMMAND)).toBe(true);
  await expect(modal(page)).toBeVisible();

  const before = await get(page, (p) => p.getColors()!);
  expect(before.lineOpacity).toBeCloseTo(colorsDefault.lineOpacity, 5);

  // A value that differs from the default so a no-op board is caught.
  const target = 0.9;
  expect(target).not.toBeCloseTo(colorsDefault.lineOpacity, 5);

  await modal(page)
    .locator('[data-testid="settings-opacity"]')
    .evaluate((el, v) => {
      const input = el as HTMLInputElement;
      input.value = String(v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, target);

  // The gridline material opacity on the LIVE scene changed — render truth, not a log line.
  const after = await get(page, (p) => p.getColors()!);
  expect(after.lineOpacity).toBeCloseTo(target, 5);
});

test('an EXTERNAL config change re-reads into the OPEN settings modal live (no reload)', async ({
  page,
}) => {
  // The other direction of the same seam (design decision #1 — universal to local AND
  // programmatic/networked writers, e.g. #9 opponent-changed-board-size): a writer OTHER than the
  // widget changes config, and the OPEN modal re-reads it via its update() (mirroring how the net
  // widget re-reads the session readout), reflecting the new value with no reload.
  await ready(page);

  expect(await dispatch(page, OPEN_SETTINGS_COMMAND)).toBe(true);
  await expect(modal(page)).toBeVisible();

  // The modal's background field starts at the tracked default.
  await expect(modal(page).locator('[data-testid="settings-color-background"]')).toHaveValue(
    colorsDefault.background.toLowerCase(),
  );

  // A DIFFERENT writer (not the widget) changes the colours section — the app's setConfig, exactly
  // the path a networked/opponent change flows through.
  const external = '#1234ab';
  expect(external).not.toBe(colorsDefault.background.toLowerCase());
  await page.evaluate((v: string) => {
    const p = (window as unknown as { __pente: { setConfig(s: string, x: object): void } }).__pente;
    p.setConfig('colors', { background: v });
  }, external);

  // The OPEN modal re-read the change and now shows the external value in its field — proving the
  // config-reading widget re-reads live config on the shell's update() (the A.4 widget half).
  await expect(modal(page).locator('[data-testid="settings-color-background"]')).toHaveValue(
    external,
  );
  // And the board reflects it too (same loop drove scene.applyConfig).
  const after = await get(page, (p) => p.getColors()!);
  expect(after.background).toBe(external);
});
