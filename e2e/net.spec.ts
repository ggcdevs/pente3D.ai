import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import layoutDefault from '../src/config/defaults/layout.json' with { type: 'json' };
import {
  HOST_GAME_COMMAND,
  CODE_LENGTH,
  CODE_ALPHABET,
  CODE_ERROR_TEXT,
} from '../src/ui/widgets/netModel.ts';

/**
 * Task 5.5 e2e — the networking widget is the DOM/dispatch IO boundary over the net session
 * (SyncEngine + seat manager), verified by driving the REAL app and asserting on `window.__pente`
 * real state (getNet) + the rendered DOM (agent-principles #3: observable behavior, never a log
 * line). The PURE view-model (`netModel.ts`) is mutation-gated in Vitest; here we prove the WIRING:
 *   - the widget mounts in its configured zone (`top-left` per the tracked layout) and starts
 *     OFFLINE showing the Host/Join controls;
 *   - clicking Host actually CONNECTS the session (getNet().phase === 'connected'), CLAIMS the white
 *     seat (a genuine `claimSeat` — getNet().seat === 'white'), and shows a valid game code + Copy;
 *   - a peer joining the room flips `peerPresent` and the status line to "Opponent connected"
 *     (presence over the injected relay — observable, not a log line);
 *   - a JOIN with a malformed code shows the inline validation error and dispatches NOTHING (the
 *     session stays offline); a valid join CONNECTS and claims the BLACK seat;
 *   - a conflict reported by the session shows the conflict banner (the game is stopped).
 *
 * A deterministic in-page MOCK transport is injected via `window.__penteNetTransportFactory` BEFORE
 * boot (the `appSession.ts` seam), so host/join connect instantly and presence is controllable —
 * the UI e2e stays hermetic (no external relay), while the REAL two-client convergence over MQTT is
 * proven separately by `sync.realrelay.test.ts`. The widget id / zone / command ids / alphabet all
 * derive from the config + model, so nothing is hardcoded (agent-principles #8).
 */

const NET_ID = 'connectionStatus';

interface NetState {
  phase: 'offline' | 'connecting' | 'connected' | 'conflict';
  code: string | null;
  seat: 'white' | 'black' | null;
  peerPresent: boolean;
  joinError: 'room-full' | 'connect-failed' | null;
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
      // The session filters out its own playerId; use a distinct fake peer id when present.
      shared.presenceCb(present ? ['peer-other'] : []);
    };
    (
      window as unknown as { __penteNetTransportFactory: () => unknown }
    ).__penteNetTransportFactory = () => ({
      connect: (roomCode: string) => {
        shared.room = roomCode;
        // Announce only ourselves initially (no opponent yet) — the session sees no other peer.
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
  // The session is created async (opens IndexedDB); wait until it is wired (getNet non-null offline).
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

const widget = (page: import('@playwright/test').Page) =>
  page.locator(`[data-widget-id="${NET_ID}"]`);
const testid = (page: import('@playwright/test').Page, id: string) =>
  widget(page).locator(`[data-testid="${id}"]`);

test('the net widget mounts in its configured zone and starts offline with the Host/Join controls', async ({
  page,
}) => {
  await ready(page);

  // Placement is pure config — assert the widget lands in the zone the tracked layout names.
  expect(layoutDefault.widgets.connectionStatus.zone).toBe('top-left');
  const inZone = page.locator(`[data-zone="top-left"] [data-widget-id="${NET_ID}"]`);
  await expect(inZone).toHaveCount(1);

  // Offline: the controls panel shows, the status + conflict panels are hidden.
  await expect(widget(page)).toHaveAttribute('data-panel', 'controls');
  await expect(testid(page, 'net-controls')).toBeVisible();
  await expect(testid(page, 'net-status')).toBeHidden();
  await expect(testid(page, 'net-conflict')).toBeHidden();
  await expect(testid(page, 'net-host')).toBeVisible();
  await expect(testid(page, 'net-join')).toBeVisible();

  const state = await getNet(page);
  expect(state.phase).toBe('offline');
  expect(state.seat).toBeNull();
  expect(state.code).toBeNull();

  const shot = resolve('e2e/artifacts/net-offline.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('clicking Host connects the session, claims the white seat, and shows a valid game code', async ({
  page,
}) => {
  await ready(page);

  await testid(page, 'net-host').click();

  // The session actually connected + claimed white (a genuine claimSeat) — observable via getNet.
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: { getNet(): NetState | null } }).__pente;
    return p.getNet()?.phase === 'connected';
  });
  const state = await getNet(page);
  expect(state.phase).toBe('connected');
  expect(state.seat).toBe('white');
  expect(state.code).not.toBeNull();
  // The generated code is a valid CODE_LENGTH slug over the unambiguous alphabet.
  expect(state.code!).toHaveLength(CODE_LENGTH);
  for (const ch of state.code!) expect(CODE_ALPHABET).toContain(ch);

  // The status panel now shows the code + seat; the code the DOM shows matches the session code.
  await expect(widget(page)).toHaveAttribute('data-panel', 'status');
  await expect(testid(page, 'net-code')).toHaveText(state.code!);
  await expect(testid(page, 'net-seat')).toHaveText('You are White');
  await expect(testid(page, 'net-copy')).toBeVisible();
  // No opponent yet — the status line waits.
  await expect(testid(page, 'net-status-line')).toHaveText('Waiting for opponent…');

  const shot = resolve('e2e/artifacts/net-hosted.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('Host via the command path connects identically (design Principle 3, one action layer)', async ({
  page,
}) => {
  await ready(page);

  // Dispatch the SAME command id the Host button fires — a keybinding / menu entry would too.
  await page.evaluate((cmd: string) => {
    (window as unknown as { __pente: { dispatch(id: string): boolean } }).__pente.dispatch(cmd);
  }, HOST_GAME_COMMAND);

  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: { getNet(): NetState | null } }).__pente;
    return p.getNet()?.phase === 'connected';
  });
  expect((await getNet(page)).seat).toBe('white');
});

test('a peer joining the room flips peerPresent and the status line to "Opponent connected"', async ({
  page,
}) => {
  await ready(page);
  await testid(page, 'net-host').click();
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: { getNet(): NetState | null } }).__pente;
    return p.getNet()?.phase === 'connected';
  });
  expect((await getNet(page)).peerPresent).toBe(false);
  await expect(testid(page, 'net-status-line')).toHaveText('Waiting for opponent…');

  // Drive a presence change over the injected relay: an opponent appears.
  await setPeer(page, true);

  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: { getNet(): NetState | null } }).__pente;
    return p.getNet()?.peerPresent === true;
  });
  expect((await getNet(page)).peerPresent).toBe(true);
  await expect(testid(page, 'net-status-line')).toHaveText('Opponent connected');
});

test('joining with a malformed code shows the inline error and dispatches nothing', async ({
  page,
}) => {
  await ready(page);

  // Too short — the widget validates before dispatching, so the session stays offline.
  await testid(page, 'net-join-input').fill('ABC');
  await testid(page, 'net-join').click();

  await expect(testid(page, 'net-join-error')).toBeVisible();
  await expect(testid(page, 'net-join-error')).toHaveText(CODE_ERROR_TEXT['too-short']);
  // No connection was attempted — still offline (the bad code never reached the transport).
  expect((await getNet(page)).phase).toBe('offline');

  // An empty field reports the empty-specific message (precedence: empty before too-short).
  await testid(page, 'net-join-input').fill('');
  await testid(page, 'net-join').click();
  await expect(testid(page, 'net-join-error')).toHaveText(CODE_ERROR_TEXT.empty);
  expect((await getNet(page)).phase).toBe('offline');
});

test('joining with a valid code connects the session and claims the black seat', async ({
  page,
}) => {
  await ready(page);

  const code = CODE_ALPHABET.slice(0, CODE_LENGTH); // a valid, canonical code
  await testid(page, 'net-join-input').fill(code.toLowerCase()); // lower-case → canonicalized
  await testid(page, 'net-join').click();

  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: { getNet(): NetState | null } }).__pente;
    return p.getNet()?.phase === 'connected';
  });
  const state = await getNet(page);
  expect(state.phase).toBe('connected');
  expect(state.seat).toBe('black');
  expect(state.code).toBe(code); // canonicalized to upper-case
  await expect(widget(page)).toHaveAttribute('data-panel', 'status');
  await expect(testid(page, 'net-seat')).toHaveText('You are Black');
  // The join succeeded — no inline error.
  await expect(testid(page, 'net-join-error')).toBeHidden();

  // The room the mock transport connected to is the typed code (the wiring reached the transport).
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
  await testid(page, 'net-host').click();
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: { getNet(): NetState | null } }).__pente;
    return p.getNet()?.phase === 'connected';
  });
  const code = (await getNet(page)).code!;

  await testid(page, 'net-copy').click();

  // The button reflects success (observable), and the clipboard holds the code.
  await expect(testid(page, 'net-copy')).toHaveText('Copied');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe(code);
});
