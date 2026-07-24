import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import layoutDefault from '../src/config/defaults/layout.json' with { type: 'json' };
import {
  HOST_GAME_COMMAND,
  JOIN_GAME_COMMAND,
  CODE_LENGTH,
  CODE_ALPHABET,
} from '../src/ui/widgets/netModel.ts';

/**
 * Task 5.5 / C.2 / issue #44 e2e — the PERSISTENT connection/seat/turn/conflict STATUS display is now
 * MERGED INTO the score banner (issue #44 folded the former standalone `connectionStatus` widget into
 * `statusBanner`; Host/Join INITIATION still lives in the drawer's Network-Game panel,
 * `netPanel.spec.ts`). The merged net-status sub-panel keeps the same `net-*` testids/classes and a
 * `data-widget-id="connectionStatus"` marker so these selectors still resolve — now NESTED inside the
 * banner in `top-center`. Verified by driving the REAL app and asserting on `window.__pente` real
 * state (getNet) + the rendered DOM (agent-principles #3: observable behavior, never a log line):
 *   - the merged net-status marker sits INSIDE the banner in its `top-center` zone and starts idle
 *     (hidden sub-panel — NO inline Host button / Join input; those moved to the panel);
 *   - dispatching the SAME `hostGame` command the panel fires CONNECTS the session, CLAIMS the white
 *     seat, and the status shows a valid game code + Copy (design Principle 3, one action layer);
 *   - a peer joining flips `peerPresent` and the status line to "Opponent connected" (presence over
 *     the injected relay — observable, not a log line);
 *   - a JOIN via the command path + pending-code seam claims the BLACK seat and reaches the transport;
 *   - the Copy button copies the shown code.
 *
 * A deterministic in-page MOCK transport is injected via `window.__penteNetTransportFactory` BEFORE
 * boot (the `appSession.ts` seam), so host/join connect instantly and presence is controllable — the
 * UI e2e stays hermetic (no external relay), while the REAL two-client convergence over MQTT is proven
 * separately by `sync.realrelay.test.ts`. The widget id / zone / command ids / alphabet all derive
 * from the config + model, so nothing is hardcoded (agent-principles #8).
 */

const NET_ID = 'connectionStatus';

interface NetState {
  phase: 'offline' | 'connecting' | 'connected' | 'conflict';
  code: string | null;
  seat: 'white' | 'black' | null;
  peerPresent: boolean;
  joinError:
    | 'room-full'
    | 'seat-reserved'
    | 'game-mismatch'
    | 'game-divergent'
    | 'connect-failed'
    | null;
}
type Pente = { getNet(): NetState | null };

/**
 * Install the deterministic mock transport factory + clean localStorage BEFORE the app boots. The
 * mock connects immediately, records the room code on `window.__mockRoom`, and exposes
 * `window.__mockSetPeer(present)` to drive a presence change into the session (so a test can flip
 * "opponent connected" without a second real client). It carries opaque JSON like the real relay.
 */
async function installMock(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
    interface MockShared {
      presenceCb: (peers: readonly string[]) => void;
      room: string | null;
    }
    const shared: MockShared = { presenceCb: () => {}, room: null };
    (window as unknown as { __mockRoom(): string | null }).__mockRoom = () => shared.room;
    (window as unknown as { __mockSetPeer(present: boolean): void }).__mockSetPeer = (
      present: boolean,
    ) => {
      shared.presenceCb(present ? ['peer-other'] : []);
    };
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
      typeof p.dispatch === 'function' &&
      !!document.querySelector('[data-widget-id="connectionStatus"]')
    );
  });
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: { getNet(): unknown } }).__pente;
    return !!p && p.getNet() !== null;
  });
}

const getNet = (page: import('@playwright/test').Page): Promise<NetState> =>
  page.evaluate(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    return p.getNet()!;
  });

const setPeer = (page: import('@playwright/test').Page, present: boolean): Promise<void> =>
  page.evaluate((v: boolean) => {
    (window as unknown as { __mockSetPeer(p: boolean): void }).__mockSetPeer(v);
  }, present);

const dispatch = (page: import('@playwright/test').Page, cmd: string): Promise<boolean> =>
  page.evaluate(
    (id: string) =>
      (window as unknown as { __pente: { dispatch(id: string): boolean } }).__pente.dispatch(id),
    cmd,
  );

const setPendingJoinCode = (page: import('@playwright/test').Page, code: string): Promise<void> =>
  page.evaluate((c: string) => {
    (
      window as unknown as { __pente: { setPendingJoinCode(c: string): void } }
    ).__pente.setPendingJoinCode(c);
  }, code);

const widget = (page: import('@playwright/test').Page) =>
  page.locator(`[data-widget-id="${NET_ID}"]`);
const testid = (page: import('@playwright/test').Page, id: string) =>
  widget(page).locator(`[data-testid="${id}"]`);

test('the merged net-status sits INSIDE the banner (top-center) and starts offline hidden (no inline Host/Join)', async ({
  page,
}) => {
  await ready(page);

  // Issue #44: the net status is merged into the banner. Its marker is NESTED inside the banner
  // widget, which sits in the `top-center` zone the tracked layout gives the banner.
  expect(layoutDefault.widgets.statusBanner.zone).toBe('top-center');
  const inBanner = page.locator(
    `[data-zone="top-center"] [data-widget-id="statusBanner"] [data-widget-id="${NET_ID}"]`,
  );
  await expect(inBanner).toHaveCount(1);

  // Offline: the net sub-panel has NOTHING to show — the controls are empty (#13 moved Host/Join to
  // the drawer, #16 removed the board hint), so the sub-panel is HIDDEN and leaves no gap in the
  // banner. Its data-panel stays 'controls' and the status/conflict lines stay hidden underneath.
  await expect(widget(page)).toBeHidden();
  await expect(widget(page)).toHaveAttribute('data-panel', 'controls');
  await expect(testid(page, 'net-status-line')).toBeHidden();
  await expect(testid(page, 'net-conflict')).toBeHidden();

  // The inline Host button / Join input are GONE (moved to the drawer's Network-Game panel, #13).
  await expect(testid(page, 'net-host')).toHaveCount(0);
  await expect(testid(page, 'net-join')).toHaveCount(0);
  await expect(testid(page, 'net-join-input')).toHaveCount(0);

  const state = await getNet(page);
  expect(state.phase).toBe('offline');
  expect(state.seat).toBeNull();
  expect(state.code).toBeNull();

  const shot = resolve('e2e/artifacts/net-offline.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('hosting via the command path connects the session, claims white, and the status widget shows a valid code', async ({
  page,
}) => {
  await ready(page);

  // The panel's Host button and any keybinding dispatch this identical id (design Principle 3).
  await dispatch(page, HOST_GAME_COMMAND);

  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: { getNet(): NetState | null } }).__pente;
    return p.getNet()?.phase === 'connected';
  });
  const state = await getNet(page);
  expect(state.phase).toBe('connected');
  expect(state.seat).toBe('white');
  expect(state.code).not.toBeNull();
  expect(state.code!).toHaveLength(CODE_LENGTH);
  for (const ch of state.code!) expect(CODE_ALPHABET).toContain(ch);

  await expect(widget(page)).toHaveAttribute('data-panel', 'status');
  await expect(testid(page, 'net-code')).toHaveText(state.code!);
  await expect(testid(page, 'net-seat')).toHaveText('You are White');
  await expect(testid(page, 'net-copy')).toBeVisible();
  await expect(testid(page, 'net-status-line')).toHaveText('Waiting for opponent…');

  const shot = resolve('e2e/artifacts/net-hosted.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('a peer joining the room flips peerPresent and the status line to "Opponent connected"', async ({
  page,
}) => {
  await ready(page);
  await dispatch(page, HOST_GAME_COMMAND);
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: { getNet(): NetState | null } }).__pente;
    return p.getNet()?.phase === 'connected';
  });
  expect((await getNet(page)).peerPresent).toBe(false);
  await expect(testid(page, 'net-status-line')).toHaveText('Waiting for opponent…');

  await setPeer(page, true);

  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: { getNet(): NetState | null } }).__pente;
    return p.getNet()?.peerPresent === true;
  });
  expect((await getNet(page)).peerPresent).toBe(true);
  await expect(testid(page, 'net-status-line')).toHaveText('Opponent connected');
});

test('joining via the pending-code seam + command connects and ESTABLISHES the room (first owner → white)', async ({
  page,
}) => {
  await ready(page);

  const code = CODE_ALPHABET.slice(0, CODE_LENGTH); // a valid, canonical code
  // The panel stashes the validated code here, then dispatches the argument-free joinGame command.
  await setPendingJoinCode(page, code);
  await dispatch(page, JOIN_GAME_COMMAND);

  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: { getNet(): NetState | null } }).__pente;
    return p.getNet()?.phase === 'connected';
  });
  const state = await getNet(page);
  expect(state.phase).toBe('connected');
  // The #31 redesign removed role-derived seats: a lone peer entering an EMPTY room (no resident
  // answers its hello within the settle window) ESTABLISHES the game as its FIRST OWNER — white,
  // by first-available at genuine game creation (design §2.3/§4). "Join" no longer forces black; a
  // second peer arriving later is admitted onto the free black seat (the two-context specs prove that).
  expect(state.seat).toBe('white');
  expect(state.code).toBe(code);
  await expect(widget(page)).toHaveAttribute('data-panel', 'status');
  await expect(testid(page, 'net-seat')).toHaveText('You are White');

  // The room the mock transport connected to is the code (the wiring reached the transport).
  const room = await page.evaluate(() =>
    (window as unknown as { __mockRoom(): string | null }).__mockRoom(),
  );
  expect(room).toBe(code);
});

test('the Copy button copies the game code to the clipboard and reports success', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ready(page);
  await dispatch(page, HOST_GAME_COMMAND);
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: { getNet(): NetState | null } }).__pente;
    return p.getNet()?.phase === 'connected';
  });
  const code = (await getNet(page)).code!;

  await testid(page, 'net-copy').click();

  await expect(testid(page, 'net-copy')).toHaveText('Copied');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe(code);
});
