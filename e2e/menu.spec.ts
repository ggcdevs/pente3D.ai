import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import layoutDefault from '../src/config/defaults/layout.json' with { type: 'json' };
import { DEFAULT_MENU_ENTRIES, MENU_SCOPE_ID } from '../src/ui/widgets/menuModel.ts';

/**
 * Task 5.3 e2e — the menu button + modal widget is the DOM/dispatch + input-scope IO boundary,
 * verified by driving the REAL app and asserting on `window.__pente` real state + the rendered DOM
 * (agent-principles #3: observable behavior, never a log line). The PURE view-model
 * (`menuModel.ts`) is mutation-gated in Vitest; here we prove the WIRING:
 *   - the menu button mounts in its configured zone (`top-right` per the tracked layout);
 *   - clicking the button OPENS the modal with the design entries (Settings/Host/Join/Load/Export),
 *     each carrying the command id it dispatches, read back off the DOM;
 *   - opening PUSHES a BLOCKING `menu` input scope onto the scene's stack (`getInput().scopes`);
 *     closing POPS it — proven for EVERY close path: Escape, outside-click, an entry choice, and
 *     the ✕ button. The blocking flag is proven by a key being SWALLOWED while the modal is open
 *     (`pressKey` resolves to the `menu` scope with no command);
 *   - choosing an entry DISPATCHES its command id (the same registry a keybinding uses).
 * The menu id + zone + entries derive from `layout.json` / `menuModel.ts` so nothing is hardcoded
 * (agent-principles #8).
 */

const MENU_ID = 'menuButton';

interface InputReadout {
  scopes: string[];
  commands: string[];
}
interface KeyResolution {
  commandId: string | null;
  scopeId: string | null;
  handled: boolean;
}
type Pente = {
  getInput(): InputReadout | null;
  pressKey(chord: string): KeyResolution | null;
};

async function ready(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.getInput === 'function' &&
      typeof p.pressKey === 'function' &&
      !!document.querySelector('[data-widget-id="menuButton"]')
    );
  });
}

const get = <T,>(page: import('@playwright/test').Page, fn: (p: Pente) => T): Promise<T> =>
  page.evaluate((body: string): unknown => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    const revived = eval(`(${body})`) as (api: Pente) => unknown;
    return revived(p);
  }, fn.toString()) as Promise<T>;

const menu = (page: import('@playwright/test').Page) =>
  page.locator(`[data-widget-id="${MENU_ID}"]`);
const button = (page: import('@playwright/test').Page) =>
  menu(page).locator('[data-testid="menu-button"]');
const modal = (page: import('@playwright/test').Page) =>
  menu(page).locator('[data-testid="menu-modal"]');

test('the menu button mounts in its configured zone and the modal starts closed', async ({
  page,
}) => {
  await ready(page);

  // Placement is pure config — assert the button lands in the zone the tracked layout names.
  expect(layoutDefault.widgets.menuButton.zone).toBe('top-right');
  const inZone = page.locator(`[data-zone="top-right"] [data-widget-id="${MENU_ID}"]`);
  await expect(inZone).toHaveCount(1);

  // The modal exists but is hidden until the button is clicked; no `menu` scope on the stack yet.
  await expect(modal(page)).toBeHidden();
  await expect(button(page)).toHaveAttribute('aria-expanded', 'false');
  const input0 = await get(page, (p) => p.getInput()!);
  expect(input0.scopes).not.toContain(MENU_SCOPE_ID);

  const shot = resolve('e2e/artifacts/menu-closed.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('clicking the button opens the modal with the design entries and pushes a blocking scope', async ({
  page,
}) => {
  await ready(page);

  await button(page).click();

  // The modal is now visible and every design entry is present, each carrying its command id.
  await expect(modal(page)).toBeVisible();
  await expect(button(page)).toHaveAttribute('aria-expanded', 'true');
  for (const entry of DEFAULT_MENU_ENTRIES) {
    const el = menu(page).locator(`[data-testid="menu-entry-${entry.id}"]`);
    await expect(el).toHaveText(entry.label);
    await expect(el).toHaveAttribute('data-command', entry.commandId);
  }
  // The entries render in the pure-model order (Settings/Host/Join/Load/Export).
  const labels = await menu(page).locator('[data-testid^="menu-entry-"]').allTextContents();
  expect(labels).toEqual(DEFAULT_MENU_ENTRIES.map((e) => e.label));

  // Opening PUSHED the blocking `menu` scope onto the scene's stack (observable on getInput).
  const input = await get(page, (p) => p.getInput()!);
  expect(input.scopes[input.scopes.length - 1]).toBe(MENU_SCOPE_ID);

  // Proof the scope BLOCKS: an otherwise-bound key is SWALLOWED by the menu scope (resolved there,
  // no command) instead of falling through to the game scope below (agent-principles #3).
  const swallowed = await get(page, (p) => p.pressKey('u'));
  expect(swallowed).toEqual({ commandId: null, scopeId: MENU_SCOPE_ID, handled: true });

  const shot = resolve('e2e/artifacts/menu-open.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('Escape closes the modal and pops the blocking scope', async ({ page }) => {
  await ready(page);
  await button(page).click();
  const opened = await get(page, (p) => p.getInput()!);
  expect(opened.scopes).toContain(MENU_SCOPE_ID);

  await page.keyboard.press('Escape');

  await expect(modal(page)).toBeHidden();
  await expect(button(page)).toHaveAttribute('aria-expanded', 'false');
  // The blocking scope is POPPED — the stack no longer carries `menu`, and `u` falls through
  // to the game scope again (resolves the `undo` command).
  const closed = await get(page, (p) => p.getInput()!);
  expect(closed.scopes).not.toContain(MENU_SCOPE_ID);
  const afterEscape = await get(page, (p) => p.pressKey('u'));
  expect(afterEscape.scopeId).toBe('game');
  expect(afterEscape.commandId).toBe('undo');
});

test('an outside click closes the modal and pops the blocking scope', async ({ page }) => {
  await ready(page);
  await button(page).click();
  await expect(modal(page)).toBeVisible();

  // Click the backdrop (the modal overlay itself, outside the panel) — an outside click closes.
  // The overlay fills the viewport; click a far corner well outside the centered panel.
  await modal(page).click({ position: { x: 5, y: 5 } });

  await expect(modal(page)).toBeHidden();
  const closed = await get(page, (p) => p.getInput()!);
  expect(closed.scopes).not.toContain(MENU_SCOPE_ID);
});

test('choosing an entry closes the modal, pops the menu scope, and dispatches its command', async ({
  page,
}) => {
  await ready(page);
  await button(page).click();
  await expect(modal(page)).toBeVisible();

  // Choose "Export". Its command (`exportGame`) is not yet registered (lands in 5.8), so the
  // observable effect here is: the menu modal closes and its blocking scope is popped. The dispatch
  // is an honest no-op (registry returns false for an unknown id) — no crash, no scope pushed.
  await menu(page).locator('[data-testid="menu-entry-export"]').click();

  await expect(modal(page)).toBeHidden();
  const closed = await get(page, (p) => p.getInput()!);
  expect(closed.scopes).not.toContain(MENU_SCOPE_ID);
  // Only the base game scope remains (no leaked menu scope, and an unregistered entry pushes none).
  expect(closed.scopes[closed.scopes.length - 1]).toBe('game');
});

test('choosing "Settings" pops the menu scope and opens the settings modal (Task 5.4 wiring)', async ({
  page,
}) => {
  await ready(page);
  await button(page).click();
  await expect(modal(page)).toBeVisible();

  // Choosing Settings dispatches `openSettings` (now registered in 5.4): the menu modal closes and
  // its scope pops, AND the settings modal opens, pushing the blocking `settings` scope on top of
  // the game scope. This proves the one-action-layer wiring end-to-end (design Principle 3).
  await menu(page).locator('[data-testid="menu-entry-settings"]').click();

  await expect(modal(page)).toBeHidden();
  await expect(page.locator('[data-testid="settings-modal"]')).toBeVisible();
  const after = await get(page, (p) => p.getInput()!);
  expect(after.scopes).not.toContain(MENU_SCOPE_ID);
  expect(after.scopes[after.scopes.length - 1]).toBe('settings');
});

test('the ✕ button closes the modal and pops the scope; re-opening pushes exactly one scope', async ({
  page,
}) => {
  await ready(page);

  await button(page).click();
  const open1 = await get(page, (p) => p.getInput()!);
  const menuCount1 = open1.scopes.filter((s) => s === MENU_SCOPE_ID).length;
  expect(menuCount1).toBe(1);

  await menu(page).locator('[data-testid="menu-close"]').click();
  await expect(modal(page)).toBeHidden();
  const closed = await get(page, (p) => p.getInput()!);
  expect(closed.scopes).not.toContain(MENU_SCOPE_ID);

  // Re-open — the stack must carry exactly ONE menu scope, never two (idempotent open).
  await button(page).click();
  const open2 = await get(page, (p) => p.getInput()!);
  expect(open2.scopes.filter((s) => s === MENU_SCOPE_ID).length).toBe(1);
});
