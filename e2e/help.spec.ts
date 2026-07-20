import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import layoutDefault from '../src/config/defaults/layout.json' with { type: 'json' };
import keybindingsDefault from '../src/config/defaults/keybindings.json' with { type: 'json' };
import {
  deriveHelp,
  HELP_SCOPE_ID,
  SHOW_HELP_COMMAND,
  type HelpSources,
} from '../src/ui/widgets/helpModel.ts';

/**
 * Task 5.7 e2e — the help-overlay widget is the DOM + input-scope IO boundary, verified by driving
 * the REAL app and asserting on `window.__pente` real state (getInput / getHelpSources) + the
 * rendered DOM (agent-principles #3: observable behavior, never a log line). The PURE view-model
 * (`helpModel.ts`) is mutation-gated in Vitest; here we prove the WIRING:
 *   - the overlay mounts HIDDEN in its configured zone, no `help` scope on the stack;
 *   - the `?` KEYBINDING (tracked default → the `showHelp` command) OPENS the overlay and PUSHES a
 *     BLOCKING `help` scope (proven by a bound key being SWALLOWED);
 *   - the shortcut rows are GENERATED from the LIVE registry + bindings — the rendered rows EQUAL
 *     `deriveHelp(getHelpSources())`, and every rendered command is registered+bound (nothing
 *     hardcoded; the stale `closeModal` binding is absent — agent-principles #8);
 *   - dispatching the `showHelp` COMMAND directly also opens it (design Principle 3, one action layer);
 *   - Escape / outside-click / the ✕ button each CLOSE the overlay and POP the scope (no leak).
 * The widget id / zone / the `?` binding all derive from the config so nothing is hardcoded.
 */

const HELP_ID = 'helpOverlay';

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
  dispatch(id: string): boolean | null;
  getHelpSources(): HelpSources | null;
};

async function ready(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.getInput === 'function' &&
      typeof p.getHelpSources === 'function' &&
      !!document.querySelector('[data-widget-id="helpOverlay"]')
    );
  });
}

const get = <T,>(page: import('@playwright/test').Page, fn: (p: Pente) => T): Promise<T> =>
  page.evaluate((body: string): unknown => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    const revived = eval(`(${body})`) as (api: Pente) => unknown;
    return revived(p);
  }, fn.toString()) as Promise<T>;

// The help widget's ROOT element is the modal overlay itself, so it carries BOTH the container's
// `data-widget-id` and the widget's `data-testid="help-modal"` — they are the same element (not a
// descendant), exactly like the settings widget. Locate it by the combined attribute selector.
const overlay = (page: import('@playwright/test').Page) =>
  page.locator(`[data-widget-id="${HELP_ID}"]`);
const modal = (page: import('@playwright/test').Page) =>
  page.locator(`[data-widget-id="${HELP_ID}"][data-testid="help-modal"]`);

test('the help overlay mounts hidden in its configured zone with no help scope', async ({
  page,
}) => {
  await ready(page);

  // Placement is pure config — assert the overlay lands in the zone the tracked layout names.
  // (An untransformed anchor zone so the fixed-position full-viewport modal backdrop is not
  // clipped by a `transform`ed ancestor — the modal itself knows nothing about its placement.)
  expect(layoutDefault.widgets.helpOverlay.zone).toBe('bottom-right');
  const inZone = page.locator(`[data-zone="bottom-right"] [data-widget-id="${HELP_ID}"]`);
  await expect(inZone).toHaveCount(1);

  await expect(modal(page)).toBeHidden();
  const input0 = await get(page, (p) => p.getInput()!);
  expect(input0.scopes).not.toContain(HELP_SCOPE_ID);

  // The `?` binding + showHelp command exist in the real system (nothing hardcoded here).
  expect((keybindingsDefault as Record<string, string>)['?']).toBe(SHOW_HELP_COMMAND);
  expect(input0.commands).toContain(SHOW_HELP_COMMAND);
});

test('pressing "?" opens the overlay, pushes a blocking scope, and generates rows from the live registry+bindings', async ({
  page,
}) => {
  await ready(page);

  // The `?` keybinding dispatches the showHelp command (the SAME id a UI trigger would).
  const res = await get(page, (p) => p.pressKey('?'));
  expect(res).toMatchObject({ commandId: SHOW_HELP_COMMAND, scopeId: 'game', handled: true });

  await expect(modal(page)).toBeVisible();

  // Opening PUSHED the blocking `help` scope (observable on getInput).
  const input = await get(page, (p) => p.getInput()!);
  expect(input.scopes[input.scopes.length - 1]).toBe(HELP_SCOPE_ID);

  // Proof the scope BLOCKS: an otherwise-bound key (`u` → undo) is SWALLOWED by the help scope.
  const swallowed = await get(page, (p) => p.pressKey('u'));
  expect(swallowed).toEqual({ commandId: null, scopeId: HELP_SCOPE_ID, handled: true });

  // The rendered rows are GENERATED from the live sources — they EQUAL deriveHelp(getHelpSources()).
  const sources = await get(page, (p) => p.getHelpSources()!);
  const expectedModel = deriveHelp(sources);
  expect(expectedModel.rows.length).toBeGreaterThan(0);

  // Read the rendered rows back off the DOM (command + keys per row, in DOM order).
  const rendered = await overlay(page)
    .locator('[data-testid^="help-row-"]')
    .evaluateAll((els) =>
      els.map((el) => ({
        commandId: el.getAttribute('data-command'),
        keys: (el.getAttribute('data-keys') ?? '').split(', '),
      })),
    );
  expect(rendered).toEqual(
    expectedModel.rows.map((r) => ({ commandId: r.commandId, keys: [...r.keys] })),
  );

  // Every rendered command is REGISTERED and BOUND (nothing hardcoded / no phantom rows).
  const registered = new Set(sources.commandIds);
  const boundCommands = new Set(Object.values(sources.bindings));
  for (const row of rendered) {
    expect(registered.has(row.commandId!)).toBe(true);
    expect(boundCommands.has(row.commandId!)).toBe(true);
  }

  // The stale `closeModal` binding (bound in keybindings, registered by no command) is ABSENT — a
  // generated list, not a copy of the bindings (agent-principles #8).
  expect((keybindingsDefault as Record<string, string>).Escape).toBe('closeModal');
  expect(rendered.map((r) => r.commandId)).not.toContain('closeModal');

  // `?` itself is a real shortcut in the list: showHelp is registered + bound to `?`.
  const helpRow = rendered.find((r) => r.commandId === SHOW_HELP_COMMAND);
  expect(helpRow).toBeDefined();
  expect(helpRow!.keys).toContain('?');

  const shot = resolve('e2e/artifacts/help-open.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('dispatching the showHelp command directly opens the overlay (one action layer)', async ({
  page,
}) => {
  await ready(page);

  // Literal id inside the evaluated closure — the `get` helper eval's the function in the browser,
  // so it cannot close over the imported SHOW_HELP_COMMAND constant. It equals 'showHelp' (asserted
  // in the first test), so a literal here is safe and keeps the one-action-layer proof intact.
  const ran = await get(page, (p) => p.dispatch('showHelp'));
  expect(ran).toBe(true);
  expect(SHOW_HELP_COMMAND).toBe('showHelp');
  await expect(modal(page)).toBeVisible();
  const input = await get(page, (p) => p.getInput()!);
  expect(input.scopes[input.scopes.length - 1]).toBe(HELP_SCOPE_ID);
});

test('Escape closes the overlay and pops the blocking scope', async ({ page }) => {
  await ready(page);
  await get(page, (p) => p.pressKey('?'));
  await expect(modal(page)).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(modal(page)).toBeHidden();
  const closed = await get(page, (p) => p.getInput()!);
  expect(closed.scopes).not.toContain(HELP_SCOPE_ID);
  // The blocking scope is gone — `u` falls through to the game scope again (resolves `undo`).
  const afterEscape = await get(page, (p) => p.pressKey('u'));
  expect(afterEscape.scopeId).toBe('game');
  expect(afterEscape.commandId).toBe('undo');
});

test('an outside click closes the overlay and pops the scope', async ({ page }) => {
  await ready(page);
  await get(page, (p) => p.pressKey('?'));
  await expect(modal(page)).toBeVisible();

  // Click the backdrop (the full-viewport overlay OUTSIDE the centered panel) — an outside click
  // closes. The panel is centred; a point halfway between the modal's left edge and the panel's
  // left edge (at the panel's vertical middle) lands on the backdrop itself — its pointerdown,
  // caught in capture on the document, closes the modal.
  const box = await modal(page).boundingBox();
  const panelBox = await overlay(page).locator('.pente-help-panel').boundingBox();
  expect(box).not.toBeNull();
  expect(panelBox).not.toBeNull();
  const backdropX = (box!.x + panelBox!.x) / 2;
  const midY = panelBox!.y + panelBox!.height / 2;
  await page.mouse.click(backdropX, midY);

  await expect(modal(page)).toBeHidden();
  const closed = await get(page, (p) => p.getInput()!);
  expect(closed.scopes).not.toContain(HELP_SCOPE_ID);
});

test('the ✕ button closes the overlay and pops the scope; re-opening pushes exactly one scope', async ({
  page,
}) => {
  await ready(page);

  await get(page, (p) => p.pressKey('?'));
  const open1 = await get(page, (p) => p.getInput()!);
  expect(open1.scopes.filter((s) => s === HELP_SCOPE_ID).length).toBe(1);

  await overlay(page).locator('[data-testid="help-close"]').click();
  await expect(modal(page)).toBeHidden();
  const closed = await get(page, (p) => p.getInput()!);
  expect(closed.scopes).not.toContain(HELP_SCOPE_ID);

  // Re-open — the stack must carry exactly ONE help scope, never two (idempotent open).
  await get(page, (p) => p.pressKey('?'));
  const open2 = await get(page, (p) => p.getInput()!);
  expect(open2.scopes.filter((s) => s === HELP_SCOPE_ID).length).toBe(1);
});
