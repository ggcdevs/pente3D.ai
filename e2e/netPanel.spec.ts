import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import layoutDefault from '../src/config/defaults/layout.json' with { type: 'json' };
import { CODE_LENGTH, CODE_ALPHABET, CODE_ERROR_TEXT } from '../src/ui/widgets/netModel.ts';
import { NET_PANEL_SCOPE_ID } from '../src/ui/widgets/netPanel.ts';

/**
 * issue #13 / #16 e2e — the Network-Game DRAWER PANEL is the DOM/dispatch IO boundary for the game-
 * code COMBOBOX (a text input + a dropdown of recent codes), verified by driving the REAL app and
 * asserting on `window.__pente` real state (getNet / getInput) + the rendered DOM + screenshots
 * (agent-principles #3: observable behavior, never a log line). The PURE combobox view-model
 * (`netPanelModel.ts`) is mutation-gated in Vitest; here we prove the WIRING:
 *   - the menu's "Network Game" entry opens the panel (a NON-blocking scope pushed — board stays live);
 *   - opening shows the input with a FRESH random PLACEHOLDER (an unambiguous-alphabet code of
 *     CODE_LENGTH) and an EMPTY value; Host/Join are enabled (the placeholder is always valid);
 *   - Host/Join with an EMPTY input use that placeholder code;
 *   - typing a custom code OVERRIDES the placeholder; a malformed typed code disables Host/Join +
 *     shows the error (a gate that BITES);
 *   - the dropdown lists the recent codes newest-first; clicking one fills the input; the per-row
 *     remove control drops just that code from the store.
 *
 * A deterministic in-page MOCK transport is injected before boot (the `appSession.ts` seam), so
 * host/join connect instantly and hermetically. The widget id / zone / command ids / alphabet all
 * derive from the config + model, so nothing is hardcoded (agent-principles #8).
 */

const MENU_ID = 'menuButton';
const NET_ID = 'connectionStatus';

interface NetState {
  phase: 'offline' | 'connecting' | 'connected' | 'conflict';
  code: string | null;
  seat: 'white' | 'black' | null;
  peerPresent: boolean;
  joinError: 'room-full' | 'connect-failed' | null;
}
interface InputReadout {
  scopes: string[];
  commands: string[];
}
type Pente = { getNet(): NetState | null; getInput(): InputReadout | null };

async function installMock(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    // Clear localStorage ONCE on the first load only — a `page.reload()` (used to reset the session to
    // offline while KEEPING the recent-codes store, which persists in localStorage) must NOT wipe it.
    if (!sessionStorage.getItem('__pentePanelCleared')) {
      window.localStorage.clear();
      sessionStorage.setItem('__pentePanelCleared', '1');
    }
    interface MockShared {
      presenceCb: (peers: readonly string[]) => void;
      room: string | null;
    }
    const shared: MockShared = { presenceCb: () => {}, room: null };
    (window as unknown as { __mockRoom(): string | null }).__mockRoom = () => shared.room;
    (
      window as unknown as { __penteNetTransportFactory: () => unknown }
    ).__penteNetTransportFactory = () => ({
      connect: (roomCode: string) => {
        shared.room = roomCode;
        shared.presenceCb([]);
        return Promise.resolve();
      },
      publish: () => {},
      onMessage: () => {},
      onPresence: (cb: (peers: readonly string[]) => void) => {
        shared.presenceCb = cb;
      },
      disconnect: () => {
        shared.room = null;
      },
    });
  });
}

async function ready(page: import('@playwright/test').Page) {
  await installMock(page);
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.getNet === 'function' &&
      typeof p.getInput === 'function' &&
      !!document.querySelector('[data-widget-id="menuButton"]') &&
      !!document.querySelector('[data-testid="netpanel-modal"]')
    );
  });
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: { getNet(): unknown } }).__pente;
    return !!p && p.getNet() !== null;
  });
}

const getNet = (page: import('@playwright/test').Page): Promise<NetState> =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getNet()!);

const getInput = (page: import('@playwright/test').Page): Promise<InputReadout> =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getInput()!);

const menu = (page: import('@playwright/test').Page) =>
  page.locator(`[data-widget-id="${MENU_ID}"]`);
const panel = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid="netpanel-modal"]');
const pt = (page: import('@playwright/test').Page, id: string) =>
  panel(page).locator(`[data-testid="${id}"]`);

/** The input's placeholder attribute — the fresh random code offered for an untouched input. */
const placeholder = (page: import('@playwright/test').Page): Promise<string> =>
  pt(page, 'netpanel-code-input').getAttribute('placeholder').then((v) => v ?? '');

/** Open the menu drawer and choose "Network Game" — the real user path (design Principle 3). */
async function openNetPanel(page: import('@playwright/test').Page) {
  await menu(page).locator('[data-testid="menu-button"]').click();
  await menu(page).locator('[data-testid="menu-entry-network"]').click();
  await expect(panel(page)).toHaveClass(/pente-netpanel-modal--open/);
}

/** Host a KNOWN code by typing it, so a later run finds it in the recent-codes store. */
async function hostCode(page: import('@playwright/test').Page, code: string) {
  await openNetPanel(page);
  await pt(page, 'netpanel-code-input').fill(code);
  await pt(page, 'netpanel-host').click();
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: { getNet(): NetState | null } }).__pente;
    return p.getNet()?.phase === 'connected';
  });
}

test('the Network-Game entry mounts and, when chosen, opens the non-blocking combobox panel', async ({
  page,
}) => {
  await ready(page);

  // The panel widget is placed by config; it starts closed (slid off-screen).
  expect(layoutDefault.widgets.networkGame.zone).toBeTruthy();
  await expect(panel(page)).toBeHidden();
  // The menu entry exists and dispatches openNetwork.
  const entry = menu(page).locator('[data-testid="menu-entry-network"]');
  await menu(page).locator('[data-testid="menu-button"]').click();
  await expect(entry).toHaveText('Network Game');
  await expect(entry).toHaveAttribute('data-command', 'openNetwork');
  await entry.click();

  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toHaveClass(/pente-netpanel-modal--open/);
  // Opening PUSHED the NON-blocking networkGame scope (board stays live under the panel).
  const input = await getInput(page);
  expect(input.scopes[input.scopes.length - 1]).toBe(NET_PANEL_SCOPE_ID);

  // The unified combobox is present: a single input + the dropdown toggle (no source tabs).
  await expect(pt(page, 'netpanel-code-input')).toBeVisible();
  await expect(pt(page, 'netpanel-toggle')).toBeVisible();
  await expect(pt(page, 'netpanel-source-custom')).toHaveCount(0);
  await expect(pt(page, 'netpanel-source-saved')).toHaveCount(0);
  await expect(pt(page, 'netpanel-source-random')).toHaveCount(0);

  const shot = resolve('e2e/artifacts/netpanel-open.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('opening shows a FRESH random PLACEHOLDER (unambiguous alphabet, right length) with an empty value', async ({
  page,
}) => {
  await ready(page);
  await openNetPanel(page);

  // The value is empty; the PLACEHOLDER carries the fresh random code (greyed, not the value).
  await expect(pt(page, 'netpanel-code-input')).toHaveValue('');
  const ph = await placeholder(page);
  expect(ph).toHaveLength(CODE_LENGTH);
  for (const ch of ph) expect(CODE_ALPHABET).toContain(ch);

  // The placeholder is always valid → Host + Join are enabled with an empty input.
  await expect(panel(page)).toHaveAttribute('data-code-valid', 'true');
  await expect(pt(page, 'netpanel-host')).toBeEnabled();
  await expect(pt(page, 'netpanel-join')).toBeEnabled();
});

test('Host with an EMPTY input uses the PLACEHOLDER code (connects on it, remembers it)', async ({
  page,
}) => {
  await ready(page);
  await openNetPanel(page);

  // Read the offered placeholder, then Host WITHOUT typing anything.
  const ph = await placeholder(page);
  await expect(pt(page, 'netpanel-code-input')).toHaveValue('');
  await pt(page, 'netpanel-host').click();

  // The session connected on EXACTLY the placeholder code (the empty→placeholder fallback bit).
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: { getNet(): NetState | null } }).__pente;
    return p.getNet()?.phase === 'connected';
  });
  const state = await getNet(page);
  expect(state.seat).toBe('white');
  expect(state.code).toBe(ph);
  const room = await page.evaluate(() =>
    (window as unknown as { __mockRoom(): string | null }).__mockRoom(),
  );
  expect(room).toBe(ph);

  // The status widget (persistent, on the board) now shows the placeholder code + seat.
  const net = page.locator(`[data-widget-id="${NET_ID}"]`);
  await expect(net.locator('[data-testid="net-code"]')).toHaveText(ph);
  await expect(net.locator('[data-testid="net-seat"]')).toHaveText('You are White');

  // Hosting recorded the placeholder code into the C.1 store — the dropdown now lists it.
  await openNetPanel(page);
  await pt(page, 'netpanel-toggle').click();
  await expect(pt(page, 'netpanel-recent')).toBeVisible();
  const codes = await pt(page, 'netpanel-recent-code').allTextContents();
  expect(codes).toContain(ph);
});

test('typing a custom code OVERRIDES the placeholder; a malformed one disables Host/Join (gate bites)', async ({
  page,
}) => {
  await ready(page);
  await openNetPanel(page);

  // Too short → invalid, buttons disabled, the too-short message shown (the validation gate BITES).
  await pt(page, 'netpanel-code-input').fill('ABC');
  await expect(panel(page)).toHaveAttribute('data-code-valid', 'false');
  await expect(pt(page, 'netpanel-error')).toHaveText(CODE_ERROR_TEXT['too-short']);
  await expect(pt(page, 'netpanel-host')).toBeDisabled();
  await expect(pt(page, 'netpanel-join')).toBeDisabled();

  // A bad-chars typed code also bites, with its own message.
  await pt(page, 'netpanel-code-input').fill(`${CODE_ALPHABET.slice(0, CODE_LENGTH - 1)}0`); // '0' excluded
  await expect(panel(page)).toHaveAttribute('data-code-valid', 'false');
  await expect(pt(page, 'netpanel-error')).toHaveText(CODE_ERROR_TEXT['bad-chars']);

  // A valid (lower-cased) typed code → valid, no error, buttons enabled, and it OVERRIDES the
  // placeholder: hosting connects on the TYPED code, not the offered random one.
  const typed = CODE_ALPHABET.slice(0, CODE_LENGTH);
  const ph = await placeholder(page);
  expect(typed).not.toBe(ph);
  await pt(page, 'netpanel-code-input').fill(typed.toLowerCase());
  await expect(panel(page)).toHaveAttribute('data-code-valid', 'true');
  await expect(pt(page, 'netpanel-error')).toBeHidden();
  await expect(pt(page, 'netpanel-host')).toBeEnabled();

  await pt(page, 'netpanel-host').click();
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: { getNet(): NetState | null } }).__pente;
    return p.getNet()?.phase === 'connected';
  });
  const state = await getNet(page);
  expect(state.code).toBe(typed); // the typed code won, not the placeholder
});

test('the dropdown lists recent codes newest-first; clicking one fills the input, then Join uses it', async ({
  page,
}) => {
  await ready(page);

  // Seed two codes into the store by hosting them in order (a then b → b is newest).
  const a = CODE_ALPHABET.slice(0, CODE_LENGTH);
  const b = CODE_ALPHABET.slice(2, 2 + CODE_LENGTH);
  await hostCode(page, a);
  await page.reload();
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: { getNet(): unknown } }).__pente;
    return !!p && p.getNet() !== null;
  });
  await hostCode(page, b);

  // Reset the session to offline (the store persists across the reload).
  await page.reload();
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: { getNet(): NetState | null } }).__pente;
    return p.getNet()?.phase === 'offline';
  });

  await openNetPanel(page);
  await pt(page, 'netpanel-toggle').click();
  await expect(pt(page, 'netpanel-recent')).toBeVisible();
  // Newest-first: b (hosted last) precedes a.
  const codes = await pt(page, 'netpanel-recent-code').allTextContents();
  expect(codes).toEqual([b, a]);

  // Clicking a recent code fills the input with it.
  await pt(page, 'netpanel-recent-code').filter({ hasText: a }).click();
  await expect(pt(page, 'netpanel-code-input')).toHaveValue(a);
  await expect(panel(page)).toHaveAttribute('data-code-valid', 'true');

  // Join it → connects on THIS code. With no resident in the (single-context) room, this lone peer
  // ESTABLISHES the game as its first owner → white (the #31 redesign removed role-derived seats; the
  // second peer to arrive is admitted onto black — the two-context specs prove that). This test's job
  // is the combobox → Join SEAM (the chosen recent code drives the connect), not the seat color.
  await pt(page, 'netpanel-join').click();
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: { getNet(): NetState | null } }).__pente;
    return p.getNet()?.phase === 'connected';
  });
  const state = await getNet(page);
  expect(state.seat).toBe('white');
  expect(state.code).toBe(a);

  const shot = resolve('e2e/artifacts/netpanel-recent-join.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('the per-row remove control drops JUST that code from the store', async ({ page }) => {
  await ready(page);

  const a = CODE_ALPHABET.slice(0, CODE_LENGTH);
  const b = CODE_ALPHABET.slice(2, 2 + CODE_LENGTH);
  await hostCode(page, a);
  await page.reload();
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: { getNet(): unknown } }).__pente;
    return !!p && p.getNet() !== null;
  });
  await hostCode(page, b);
  await page.reload();
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: { getNet(): NetState | null } }).__pente;
    return p.getNet()?.phase === 'offline';
  });

  await openNetPanel(page);
  await pt(page, 'netpanel-toggle').click();
  await expect(pt(page, 'netpanel-recent-row')).toHaveCount(2);

  // Remove b (newest) via its per-row remove control → only a remains, in the DOM and the store.
  const rowB = pt(page, 'netpanel-recent-row').filter({ hasText: b });
  await rowB.locator('[data-testid="netpanel-recent-remove"]').click();
  await expect(pt(page, 'netpanel-recent-row')).toHaveCount(1);
  await expect(pt(page, 'netpanel-recent-code')).toHaveText(a);

  // Prove it persisted: reopen the panel and the removed code is gone.
  await pt(page, 'netpanel-close').click();
  await openNetPanel(page);
  await pt(page, 'netpanel-toggle').click();
  const codes = await pt(page, 'netpanel-recent-code').allTextContents();
  expect(codes).toEqual([a]);
  expect(codes).not.toContain(b);
});

test('choosing Host closes the panel (the transient drawer does not linger) and pops its scope', async ({
  page,
}) => {
  await ready(page);
  await openNetPanel(page);
  // Scope pushed while open.
  expect((await getInput(page)).scopes).toContain(NET_PANEL_SCOPE_ID);

  await pt(page, 'netpanel-host').click();

  // The panel closed (its scope popped) — the status display persists on the board, not the drawer.
  await expect(panel(page)).not.toHaveClass(/pente-netpanel-modal--open/);
  await page.waitForFunction(
    (scopeId: string) => {
      const p = (window as unknown as { __pente: { getInput(): InputReadout | null } }).__pente;
      const scopes = p.getInput()?.scopes ?? [];
      return !scopes.includes(scopeId);
    },
    NET_PANEL_SCOPE_ID,
  );
});
