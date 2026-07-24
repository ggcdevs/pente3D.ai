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
 * `netPanel.spec.ts`).
 *
 * Issue #44 (live iteration) restructured the merged HUD into a COMPACT PRESENCE HUD:
 *   - the game CODE lives in a tap-to-copy `net-copy` ROW (the whole row is the copy button) holding
 *     `net-code`; on a successful copy the row gets `data-copied="true"` and its icon flips to `✓`
 *     (no "Copy"/"Copied" text button any more);
 *   - the connection/seat text lines are GONE — presence is shown by a per-color `.pente-hud-dot`
 *     with `data-present`, and the local seat by `.pente-hud-you` / `banner-you-{color}`;
 *   - the conflict / join-error ALERTS keep their `data-widget-id="connectionStatus"` marker.
 * The code row + presence dots are direct children of the banner, so they scope to `statusBanner`, not
 * the `connectionStatus` alerts marker.
 *
 * Verified by driving the REAL app and asserting on `window.__pente` real state (getNet) + the
 * rendered DOM (agent-principles #3: observable behavior, never a log line). The widget id / zone /
 * command ids / alphabet all derive from config + model, so nothing is hardcoded (agent-principles #8).
 *
 * A deterministic in-page MOCK transport is injected via `window.__penteNetTransportFactory` BEFORE
 * boot (the `appSession.ts` seam), so host/join connect instantly and presence is controllable — the
 * UI e2e stays hermetic (no external relay), while the REAL two-client convergence over MQTT is proven
 * separately by `sync.realrelay.test.ts`.
 */

const NET_ID = 'connectionStatus';
const BANNER_ID = 'statusBanner';

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

/** The merged conflict/join-error ALERTS marker (still carries `data-widget-id="connectionStatus"`). */
const alerts = (page: import('@playwright/test').Page) =>
  page.locator(`[data-widget-id="${NET_ID}"]`);
/** The whole banner — the code row + presence dots + seat markers live directly under it (issue #44). */
const banner = (page: import('@playwright/test').Page) =>
  page.locator(`[data-widget-id="${BANNER_ID}"]`);
const testid = (page: import('@playwright/test').Page, id: string) =>
  banner(page).locator(`[data-testid="${id}"]`);
/** The per-color presence dot (`.pente-hud-dot`) inside its color's HUD row. */
const dot = (page: import('@playwright/test').Page, color: 'white' | 'black') =>
  banner(page).locator(`.pente-hud-row--${color} .pente-hud-dot`);

test('the merged net-status sits INSIDE the banner and starts offline hidden (no inline Host/Join, no presence dots)', async ({
  page,
}) => {
  await ready(page);

  // Issue #44: the net status is merged into the banner. The conflict/join-error alerts marker is
  // NESTED inside the banner, which sits in the zone the tracked layout gives the banner (#8).
  const zone = layoutDefault.widgets.statusBanner.zone;
  const inBanner = page.locator(
    `[data-zone="${zone}"] [data-widget-id="${BANNER_ID}"] [data-widget-id="${NET_ID}"]`,
  );
  await expect(inBanner).toHaveCount(1);

  // Offline: nothing to alert about → the alerts marker is HIDDEN (leaves no gap). Its data-panel
  // stays 'controls' and the conflict line stays hidden underneath.
  await expect(alerts(page)).toBeHidden();
  await expect(alerts(page)).toHaveAttribute('data-panel', 'controls');
  await expect(testid(page, 'net-conflict')).toBeHidden();

  // Offline: no code → the tap-to-copy code row is HIDDEN (nothing to copy).
  await expect(testid(page, 'net-copy')).toBeHidden();

  // Offline (no seat held): the presence dots + "(You)" are NOT rendered on either color row.
  for (const color of ['white', 'black'] as const) {
    await expect(dot(page, color)).toBeHidden();
    await expect(testid(page, `banner-you-${color}`)).toBeHidden();
  }

  // The inline Host button / Join input are GONE (moved to the drawer's Network-Game panel, #13).
  await expect(testid(page, 'net-host')).toHaveCount(0);
  await expect(testid(page, 'net-join')).toHaveCount(0);
  await expect(testid(page, 'net-join-input')).toHaveCount(0);
  // And the old text status/seat lines are GONE (replaced by dots + "(You)", issue #44).
  await expect(testid(page, 'net-status-line')).toHaveCount(0);
  await expect(testid(page, 'net-seat')).toHaveCount(0);

  const state = await getNet(page);
  expect(state.phase).toBe('offline');
  expect(state.seat).toBeNull();
  expect(state.code).toBeNull();

  const shot = resolve('e2e/artifacts/net-offline.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('hosting via the command path connects the session, claims white, and shows a valid code + presence', async ({
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

  // The tap-to-copy code row is now visible showing the real code.
  await expect(testid(page, 'net-copy')).toBeVisible();
  await expect(testid(page, 'net-code')).toHaveText(state.code!);

  // Issue #44: the seat is shown by "(You)" on the held color's row (white here), NOT a text line.
  await expect(testid(page, 'banner-you-white')).toBeVisible();
  await expect(testid(page, 'banner-you-white')).toHaveText('(You)');
  await expect(testid(page, 'banner-you-black')).toBeHidden();

  // Presence: my own (white) row shows a PRESENT dot; the peer (black) is absent → not-present dot.
  await expect(dot(page, 'white')).toBeVisible();
  await expect(dot(page, 'white')).toHaveAttribute('data-present', 'true');
  await expect(dot(page, 'black')).toBeVisible();
  await expect(dot(page, 'black')).toHaveAttribute('data-present', 'false');

  const shot = resolve('e2e/artifacts/net-hosted.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('a peer joining the room flips peerPresent and the opponent presence dot to present', async ({
  page,
}) => {
  await ready(page);
  await dispatch(page, HOST_GAME_COMMAND);
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: { getNet(): NetState | null } }).__pente;
    return p.getNet()?.phase === 'connected';
  });
  expect((await getNet(page)).peerPresent).toBe(false);
  // Before the peer arrives: the opponent (black) dot is not-present (subtle hollow/pulse).
  await expect(dot(page, 'black')).toHaveAttribute('data-present', 'false');

  await setPeer(page, true);

  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: { getNet(): NetState | null } }).__pente;
    return p.getNet()?.peerPresent === true;
  });
  expect((await getNet(page)).peerPresent).toBe(true);
  // The opponent dot flips to PRESENT (the presence change reached the rendered DOM — observable #3).
  await expect(dot(page, 'black')).toHaveAttribute('data-present', 'true');
  // My own (white) dot stays present throughout.
  await expect(dot(page, 'white')).toHaveAttribute('data-present', 'true');
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
  // Issue #44: the held seat is shown by "(You)" on white's row (not a text line).
  await expect(testid(page, 'banner-you-white')).toBeVisible();
  await expect(dot(page, 'white')).toHaveAttribute('data-present', 'true');

  // The room the mock transport connected to is the code (the wiring reached the transport).
  const room = await page.evaluate(() =>
    (window as unknown as { __mockRoom(): string | null }).__mockRoom(),
  );
  expect(room).toBe(code);
});

test('the code row copies the game code to the clipboard and flips to the copied state (✓)', async ({
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

  // The WHOLE row is the copy affordance (issue #44). Before the copy, it is not in the copied state.
  await expect(testid(page, 'net-copy')).not.toHaveAttribute('data-copied', 'true');

  await testid(page, 'net-copy').click();

  // Success is observable: the row flags `data-copied="true"` and its icon flips to ✓ (issue #44 —
  // no "Copied" text button any more). And the code genuinely reached the clipboard.
  await expect(testid(page, 'net-copy')).toHaveAttribute('data-copied', 'true');
  await expect(banner(page).locator('.pente-hud-copy-icon')).toHaveText('✓');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe(code);
});
