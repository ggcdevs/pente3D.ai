import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import layoutDefault from '../src/config/defaults/layout.json' with { type: 'json' };
import { DEFAULT_MENU_ENTRIES, MENU_SCOPE_ID } from '../src/ui/widgets/menuModel.ts';

/**
 * Task 5.3 / #24 e2e — the menu button + slide-in DRAWER widget is the DOM/dispatch + input-scope
 * IO boundary, verified by driving the REAL app and asserting on `window.__pente` real state + the
 * rendered DOM (agent-principles #3: observable behavior, never a log line). The PURE view-model
 * (`menuModel.ts`) is mutation-gated in Vitest; here we prove the WIRING:
 *   - the menu button mounts in its configured zone (`top-right` per the tracked layout);
 *   - clicking the button OPENS the drawer with the design entries (Settings/Host/Join/Load/Export),
 *     each carrying the command id it dispatches, read back off the DOM;
 *   - opening PUSHES a NON-blocking `menu` input scope onto the scene's stack (`getInput().scopes`);
 *     closing POPS it — proven for EVERY close path: Escape, outside-click, an entry choice, and
 *     the ✕ button;
 *   - #24 NON-BLOCKING PROOF: while the drawer is OPEN, an otherwise-bound key FALLS THROUGH the
 *     `menu` scope to the game scope (it is NOT swallowed — the exact opposite of the old blocking
 *     modal), AND a camera-orbit drag on the canvas STILL moves the camera (`getCamera` delta) —
 *     proving the board stays fully interactive under the open drawer;
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
interface CameraReadout {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}
type Pente = {
  getInput(): InputReadout | null;
  pressKey(chord: string): KeyResolution | null;
  getCamera(): CameraReadout | null;
};

async function ready(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.getInput === 'function' &&
      typeof p.pressKey === 'function' &&
      typeof p.getCamera === 'function' &&
      !!document.querySelector('canvas') &&
      !!document.querySelector('[data-widget-id="menuButton"]')
    );
  });
}

/** Read the live camera from window.__pente (the #24 non-blocking proof reads this delta). */
async function readCamera(page: import('@playwright/test').Page): Promise<CameraReadout> {
  return page.evaluate(() => {
    const api = (window as unknown as { __pente?: { getCamera(): CameraReadout | null } }).__pente;
    if (!api) throw new Error('window.__pente not installed');
    const cam = api.getCamera();
    if (!cam) throw new Error('getCamera() returned null');
    return cam;
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

  // The drawer exists but is slid off-screen (closed) until the button is clicked; no `menu` scope
  // on the stack yet. Closed = NO `--open` class AND translated fully off the LEFT edge (its right
  // edge is at or left of x=0), which is what makes it non-interactive + hidden (#16). Playwright's
  // toBeHidden() confirms the CSS visibility:hidden that the closed state carries.
  await expect(modal(page)).toBeHidden();
  await expect(modal(page)).not.toHaveClass(/pente-menu-drawer--open/);
  await expect
    .poll(() => modal(page).evaluate((el) => el.getBoundingClientRect().right))
    .toBeLessThanOrEqual(1); // slid off the left edge (translateX(-100%): right edge at/left of x=0)
  await expect(button(page)).toHaveAttribute('aria-expanded', 'false');
  const input0 = await get(page, (p) => p.getInput()!);
  expect(input0.scopes).not.toContain(MENU_SCOPE_ID);

  const shot = resolve('e2e/artifacts/menu-closed.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('clicking the button opens the drawer with the design entries and pushes a NON-blocking scope', async ({
  page,
}) => {
  await ready(page);

  await button(page).click();

  // The drawer is now visible, slid ON-screen (open = the `--open` class + its left edge snapped to
  // x=0, no longer translated off-screen), and every design entry is present with its command id.
  await expect(modal(page)).toBeVisible();
  await expect(modal(page)).toHaveClass(/pente-menu-drawer--open/);
  // Poll the resting position so the slide-in transition (~200ms) has settled: anchored to the LEFT
  // edge, slid fully in (translateX(0) → left ≈ 0). Polling (not a one-shot read) is what proves the
  // panel ANIMATES from off-screen to on-screen rather than popping — a mid-tween read would be < 0.
  await expect
    .poll(() => modal(page).evaluate((el) => el.getBoundingClientRect().left))
    .toBeCloseTo(0, 0);
  await expect(button(page)).toHaveAttribute('aria-expanded', 'true');
  for (const entry of DEFAULT_MENU_ENTRIES) {
    const el = menu(page).locator(`[data-testid="menu-entry-${entry.id}"]`);
    await expect(el).toHaveText(entry.label);
    await expect(el).toHaveAttribute('data-command', entry.commandId);
  }
  // The entries render in the pure-model order (Settings/Host/Join/Load/Export).
  const labels = await menu(page).locator('[data-testid^="menu-entry-"]').allTextContents();
  expect(labels).toEqual(DEFAULT_MENU_ENTRIES.map((e) => e.label));

  // Opening PUSHED the `menu` scope onto the scene's stack (observable on getInput).
  const input = await get(page, (p) => p.getInput()!);
  expect(input.scopes[input.scopes.length - 1]).toBe(MENU_SCOPE_ID);

  // #24 NON-BLOCKING proof (key path): an otherwise-bound key is NOT swallowed by the `menu` scope
  // — it FALLS THROUGH to the game scope below and resolves its command (`u` → `undo`). This is the
  // exact OPPOSITE of the old blocking modal, which reported {scopeId:'menu', commandId:null}.
  const fellThrough = await get(page, (p) => p.pressKey('u'));
  expect(fellThrough.scopeId).toBe('game');
  expect(fellThrough.commandId).toBe('undo');
  expect(fellThrough.handled).toBe(true);

  // Screenshot the OPEN drawer over the live board (the board fills the viewport to the drawer's
  // right; the drawer overlays only the LEFT edge).
  const shot = resolve('e2e/artifacts/menu-open.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('#24: with the drawer OPEN, a camera-orbit drag STILL moves the camera (board stays live)', async ({
  page,
}) => {
  await ready(page);

  // Open the drawer, then orbit the canvas UNDERNEATH it. The old blocking modal drew a
  // full-viewport backdrop that ate this drag; the non-blocking drawer must let it through.
  await button(page).click();
  await expect(modal(page)).toBeVisible();
  await expect(modal(page)).toHaveClass(/pente-menu-drawer--open/);
  const input = await get(page, (p) => p.getInput()!);
  expect(input.scopes).toContain(MENU_SCOPE_ID); // the drawer really is open (scope on the stack)

  const before = await readCamera(page);
  expect(Number.isFinite(before.position.x)).toBe(true);

  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  // Drag on the RIGHT portion of the canvas, well clear of the LEFT-edge drawer (264px wide).
  const cx = box.x + box.width * 0.7;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 220, cy + 120, { steps: 24 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const after = await readCamera(page);
  const moved = Math.hypot(
    after.position.x - before.position.x,
    after.position.y - before.position.y,
    after.position.z - before.position.z,
  );
  // The camera MUST have moved — proof the drawer is non-blocking (the board is live under it).
  // Under the OLD blocking modal this delta was ~0 (the backdrop swallowed the drag).
  expect(moved).toBeGreaterThan(0.01);

  // The pointerdown that began the orbit ALSO landed outside the panel, so the drawer closed and
  // its scope popped (outside-click semantics) — the camera still moved, and no scope leaked.
  const closed = await get(page, (p) => p.getInput()!);
  expect(closed.scopes).not.toContain(MENU_SCOPE_ID);
});

test('Escape closes the drawer and pops the scope', async ({ page }) => {
  await ready(page);
  await button(page).click();
  const opened = await get(page, (p) => p.getInput()!);
  expect(opened.scopes).toContain(MENU_SCOPE_ID);

  await page.keyboard.press('Escape');

  await expect(modal(page)).toBeHidden();
  await expect(modal(page)).not.toHaveClass(/pente-menu-drawer--open/);
  await expect(button(page)).toHaveAttribute('aria-expanded', 'false');
  // The `menu` scope is POPPED — the stack no longer carries it, and `u` still resolves to the
  // game scope's `undo` (it fell through even while open — asserted above — and still does now).
  const closed = await get(page, (p) => p.getInput()!);
  expect(closed.scopes).not.toContain(MENU_SCOPE_ID);
  const afterEscape = await get(page, (p) => p.pressKey('u'));
  expect(afterEscape.scopeId).toBe('game');
  expect(afterEscape.commandId).toBe('undo');
});

test('an outside click (on the live board) closes the drawer and pops the scope', async ({
  page,
}) => {
  await ready(page);
  await button(page).click();
  await expect(modal(page)).toBeVisible();

  // There is NO backdrop (the drawer overlays only the LEFT edge). Click the canvas/board on the
  // RIGHT — well clear of the 264px LEFT-edge panel — which is "outside" and closes the drawer.
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.5);

  await expect(modal(page)).toBeHidden();
  await expect(modal(page)).not.toHaveClass(/pente-menu-drawer--open/);
  const closed = await get(page, (p) => p.getInput()!);
  expect(closed.scopes).not.toContain(MENU_SCOPE_ID);
});

test('choosing an entry closes the drawer, pops the menu scope, and dispatches its command', async ({
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

  // Choosing Settings dispatches `openSettings` (now registered in 5.4): the menu drawer closes and
  // its scope pops, AND the settings panel opens, pushing the NON-blocking `settings` scope (#24 /
  // Increment B) on top of the game scope. This proves the one-action-layer wiring end-to-end
  // (design Principle 3).
  await menu(page).locator('[data-testid="menu-entry-settings"]').click();

  await expect(modal(page)).toBeHidden();
  await expect(page.locator('[data-testid="settings-modal"]')).toBeVisible();
  const after = await get(page, (p) => p.getInput()!);
  expect(after.scopes).not.toContain(MENU_SCOPE_ID);
  expect(after.scopes[after.scopes.length - 1]).toBe('settings');
});

test('the ✕ button closes the drawer and pops the scope; re-opening pushes exactly one scope', async ({
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
