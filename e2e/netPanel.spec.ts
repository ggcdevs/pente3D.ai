import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import layoutDefault from '../src/config/defaults/layout.json' with { type: 'json' };
import { CODE_LENGTH, CODE_ALPHABET, CODE_ERROR_TEXT } from '../src/ui/widgets/netModel.ts';
import { NET_PANEL_SCOPE_ID } from '../src/ui/widgets/netPanel.ts';

/**
 * Task C.2 / issue #13 e2e — the Network-Game DRAWER PANEL is the DOM/dispatch IO boundary for the
 * game-code picker (custom / saved / random), verified by driving the REAL app and asserting on
 * `window.__pente` real state (getNet / getInput) + the rendered DOM + screenshots (agent-principles
 * #3: observable behavior, never a log line). The PURE picker view-model (`netPanelModel.ts`) is
 * mutation-gated in Vitest; here we prove the WIRING:
 *   - the menu's "Network Game" entry opens the panel (a NON-blocking scope pushed — board stays live);
 *   - opening RANDOM yields an unambiguous-alphabet code of CODE_LENGTH in the single code field;
 *   - CUSTOM validates a typed code (a malformed one disables Host/Join + shows the error);
 *   - SAVED lists the recent codes from the C.1 store (a prior host/join is remembered), and picking
 *     one feeds the field;
 *   - Host dispatches `hostGame` and CONNECTS the session (getNet phase/seat), recording the code;
 *   - Join dispatches `joinGame` with the chosen code and reaches the transport (the mock room).
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

/** Open the menu drawer and choose "Network Game" — the real user path (design Principle 3). */
async function openNetPanel(page: import('@playwright/test').Page) {
  await menu(page).locator('[data-testid="menu-button"]').click();
  await menu(page).locator('[data-testid="menu-entry-network"]').click();
  await expect(panel(page)).toHaveClass(/pente-netpanel-modal--open/);
}

test('the Network-Game entry mounts and, when chosen, opens the non-blocking picker panel', async ({
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

  // The three picker sources are present; random is active by default.
  await expect(pt(page, 'netpanel-source-custom')).toBeVisible();
  await expect(pt(page, 'netpanel-source-saved')).toBeVisible();
  await expect(pt(page, 'netpanel-source-random')).toBeVisible();
  await expect(panel(page)).toHaveAttribute('data-source', 'random');

  const shot = resolve('e2e/artifacts/netpanel-open.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('opening on RANDOM yields an unambiguous-alphabet code of the right length in the field', async ({
  page,
}) => {
  await ready(page);
  await openNetPanel(page);

  await expect(panel(page)).toHaveAttribute('data-source', 'random');
  const code = await pt(page, 'netpanel-code-input').inputValue();
  expect(code).toHaveLength(CODE_LENGTH);
  for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
  // A valid code enables Host + Join.
  await expect(panel(page)).toHaveAttribute('data-code-valid', 'true');
  await expect(pt(page, 'netpanel-host')).toBeEnabled();
  await expect(pt(page, 'netpanel-join')).toBeEnabled();

  // Regenerating produces a fresh (still-valid) code.
  await pt(page, 'netpanel-regen').click();
  const code2 = await pt(page, 'netpanel-code-input').inputValue();
  expect(code2).toHaveLength(CODE_LENGTH);
  for (const ch of code2) expect(CODE_ALPHABET).toContain(ch);
});

test('CUSTOM validates the typed code: a malformed one disables Host/Join and shows the error', async ({
  page,
}) => {
  await ready(page);
  await openNetPanel(page);

  await pt(page, 'netpanel-source-custom').click();
  await expect(panel(page)).toHaveAttribute('data-source', 'custom');

  // Too short → invalid, buttons disabled, the too-short message shown.
  await pt(page, 'netpanel-code-input').fill('ABC');
  await expect(panel(page)).toHaveAttribute('data-code-valid', 'false');
  await expect(pt(page, 'netpanel-error')).toHaveText(CODE_ERROR_TEXT['too-short']);
  await expect(pt(page, 'netpanel-host')).toBeDisabled();
  await expect(pt(page, 'netpanel-join')).toBeDisabled();

  // A valid (lower-cased) code → valid, buttons enabled, no error.
  const good = CODE_ALPHABET.slice(0, CODE_LENGTH);
  await pt(page, 'netpanel-code-input').fill(good.toLowerCase());
  await expect(panel(page)).toHaveAttribute('data-code-valid', 'true');
  await expect(pt(page, 'netpanel-error')).toBeHidden();
  await expect(pt(page, 'netpanel-host')).toBeEnabled();
});

test('Host dispatches hostGame, connects the session, and remembers the code in the SAVED list', async ({
  page,
}) => {
  await ready(page);
  await openNetPanel(page);

  // Host with a KNOWN custom code so we can assert the exact room + the saved-list entry.
  const code = CODE_ALPHABET.slice(0, CODE_LENGTH);
  await pt(page, 'netpanel-source-custom').click();
  await pt(page, 'netpanel-code-input').fill(code);
  await pt(page, 'netpanel-host').click();

  // The session actually CONNECTED and claimed white (observable via getNet), on THIS code.
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: { getNet(): NetState | null } }).__pente;
    return p.getNet()?.phase === 'connected';
  });
  const state = await getNet(page);
  expect(state.seat).toBe('white');
  expect(state.code).toBe(code);
  // The mock transport connected to exactly this room (the wiring reached the transport).
  const room = await page.evaluate(() =>
    (window as unknown as { __mockRoom(): string | null }).__mockRoom(),
  );
  expect(room).toBe(code);
  // The status widget (persistent, on the board) now shows the code + seat.
  const net = page.locator(`[data-widget-id="${NET_ID}"]`);
  await expect(net.locator('[data-testid="net-code"]')).toHaveText(code);
  await expect(net.locator('[data-testid="net-seat"]')).toHaveText('You are White');

  // Hosting recorded the code into the C.1 recent-codes store — the SAVED dropdown now lists it.
  await openNetPanel(page);
  await pt(page, 'netpanel-source-saved').click();
  const savedOptions = await pt(page, 'netpanel-saved').locator('option').allTextContents();
  expect(savedOptions).toContain(code);
});

test('SAVED: picking a remembered code feeds the field, and Join dispatches joinGame with it', async ({
  page,
}) => {
  await ready(page);

  // Seed the recent-codes store by hosting a known code first.
  await openNetPanel(page);
  const code = CODE_ALPHABET.slice(2, 2 + CODE_LENGTH);
  await pt(page, 'netpanel-source-custom').click();
  await pt(page, 'netpanel-code-input').fill(code);
  await pt(page, 'netpanel-host').click();
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: { getNet(): NetState | null } }).__pente;
    return p.getNet()?.phase === 'connected';
  });

  // Reload to reset the session to offline (the store persists in localStorage across the reload).
  await page.reload();
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: { getNet(): unknown } }).__pente;
    return !!p && p.getNet() !== null && p.getNet() !== undefined;
  });
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: { getNet(): NetState | null } }).__pente;
    return p.getNet()?.phase === 'offline';
  });

  await openNetPanel(page);
  await pt(page, 'netpanel-source-saved').click();
  // The remembered code is offered; select it → it feeds the single field.
  await pt(page, 'netpanel-saved').selectOption(code);
  await expect(pt(page, 'netpanel-code-input')).toHaveValue(code);
  await expect(panel(page)).toHaveAttribute('data-code-valid', 'true');

  // Join it → the session connects on THIS code with the black seat (the joiner) via the mock room.
  await pt(page, 'netpanel-join').click();
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: { getNet(): NetState | null } }).__pente;
    return p.getNet()?.phase === 'connected';
  });
  const state = await getNet(page);
  expect(state.seat).toBe('black');
  expect(state.code).toBe(code);
  const room = await page.evaluate(() =>
    (window as unknown as { __mockRoom(): string | null }).__mockRoom(),
  );
  expect(room).toBe(code);

  const shot = resolve('e2e/artifacts/netpanel-saved-join.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('choosing Host closes the panel (the transient drawer does not linger) and pops its scope', async ({
  page,
}) => {
  await ready(page);
  await openNetPanel(page);
  // Scope pushed while open.
  expect((await getInput(page)).scopes).toContain(NET_PANEL_SCOPE_ID);

  await pt(page, 'netpanel-source-random').click();
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
