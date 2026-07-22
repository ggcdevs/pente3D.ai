import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Task N.5.2 e2e (issue #20) — the MOVE-NOTIFICATION + AUTO-RECONNECT glue, driven through the REAL app
 * over a hermetic BroadcastChannel relay (two pages in one context = a faithful cross-client relay, no
 * MQTT). Every assertion is proof-by-BEHAVIOUR on `window.__pente` real values + a screenshot, NEVER a
 * log line (agent-principles #3):
 *
 *   (a) YOUR-TURN FLASH WHILE HIDDEN — with the joiner's tab HIDDEN, a host move that makes it the
 *       joiner's turn flashes the joiner's `document.title` to the enumerated your-turn string; the
 *       title RESTORES to its base the instant the joiner's tab becomes visible again.
 *   (b) NO SELF-NOTIFY — the joiner's OWN move (even while hidden) does NOT flash its title.
 *   (c) BROWSER NOTIFICATION via a SPY, only hidden + permitted — with a spy `Notification` whose
 *       permission is `granted`, a host move while the joiner is hidden CONSTRUCTS one notification with
 *       the enumerated copy; a DENIED spy fires none.
 *   (c') ONE-TIME OPT-IN (design #20: 'opt-in, one-time permission') — with a spy whose permission starts
 *       `default`, the FIRST hidden your-turn move calls `Notification.requestPermission` exactly ONCE
 *       (`permissionRequests` → 1, spy request counter → 1) and fires no notification; a SECOND your-turn
 *       moment does NOT request again (the once-guard). When the prompt is accepted (grant lands async
 *       AFTER the triggering move), a subsequent hidden your-turn move then fires one notification.
 *   (d) AUTO-RECONNECT — after the joiner leaves the room (phase → offline, seat dropped) and its tab
 *       goes hidden→visible / fires `online`, the session RE-JOINS the same room, reclaiming the SAME
 *       sticky seat (phase → connected, seat unchanged) and re-converging with the host.
 *   GATE BITES — with the `notifications.titleFlash` config turned OFF, a host move while the joiner is
 *       hidden flashes NOTHING (the flag genuinely gates the side effect).
 *
 * The pure decisions (is-this-a-your-turn move / which channels / should-reconnect) are unit + mutation
 * gated in `src/net/notify.test.ts`; this spec proves the GLUE wiring those decisions to the real
 * `document.title` / `Notification` API / `visibilitychange`+`online` listeners + `session.reconnect`.
 */

/** The enumerated your-turn tab-title flash string (SSOT: `src/net/notify.ts` `YOUR_TURN_TITLE_FLASH`). */
const YOUR_TURN_FLASH = '(!) Your turn — Pente';

type Pente = {
  getState(): { pieces: Record<string, string>; turn: string; winner: string | null } | null;
  getPieces(): { node: string }[] | null;
  getHeadHash(): string | null;
  getNet(): { phase: string; seat: string | null; code: string | null } | null;
  getNotify(): {
    title: string;
    baseTitle: string;
    titleFlashCount: number;
    notificationCount: number;
    permissionRequests: number;
    lastFlash: string | null;
    lastNotification: { title: string; body: string } | null;
  };
  place(coords: [number, number, number]): unknown;
  dispatch(id: string): boolean | null;
  setPendingJoinCode(code: string): void;
  leaveNet(): void;
};

/**
 * Install (BEFORE boot) the BroadcastChannel mock transport (a faithful hermetic relay: opaque JSON, no
 * self-echo, re-sends the last log to a late peer) AND — optionally — a `Notification` SPY constructor
 * and a `notifications` config override in localStorage. The spy records every construction +
 * permission request on `window.__notifySpy` so the test asserts on real fire behaviour without a real
 * OS prompt. A fresh localStorage per page mints a distinct playerId (distinct seats).
 */
async function installMocks(
  page: Page,
  sid: string,
  opts: {
    notificationPermission?: NotificationPermission;
    configOverride?: Record<string, unknown>;
    grantOnRequest?: boolean;
  } = {},
) {
  await page.addInitScript(
    ({
      sid,
      permission,
      configOverride,
      grantOnRequest,
    }: {
      sid: string;
      permission: NotificationPermission | null;
      configOverride: Record<string, unknown> | null;
      grantOnRequest: boolean;
    }) => {
      window.localStorage.clear();
      if (configOverride !== null) {
        window.localStorage.setItem('pente:config:notifications', JSON.stringify(configOverride));
      }
      // The Notification spy: records constructions + permission requests. Installed as the app's
      // e2e-injectable ctor seam so the notify glue uses THIS instead of the real (prompting) API.
      if (permission !== null) {
        const spy = { constructed: [] as { title: string; body?: string }[], permissionRequests: 0 };
        (window as unknown as { __notifySpy: typeof spy }).__notifySpy = spy;
        class SpyNotification {
          static permission: NotificationPermission = permission;
          static requestPermission(): Promise<NotificationPermission> {
            spy.permissionRequests += 1;
            // A real accepted prompt flips the grant to 'granted' only when the returned Promise RESOLVES
            // (after the user acts) — never synchronously inside this call. Flipping on resolve (not in
            // the method body) is load-bearing: the move that TRIGGERED the request reads the grant
            // synchronously right after and must still see the pre-grant state, so it fires nothing. A
            // prompt left at 'default' models the user dismissing it. This is what test (c') exercises.
            if (grantOnRequest) {
              return Promise.resolve().then(() => {
                SpyNotification.permission = 'granted';
                return 'granted' as NotificationPermission;
              });
            }
            return Promise.resolve(SpyNotification.permission);
          }
          constructor(title: string, options?: { body?: string }) {
            spy.constructed.push({ title, body: options?.body });
          }
        }
        (
          window as unknown as { __penteNotifyNotificationCtor: unknown }
        ).__penteNotifyNotificationCtor = SpyNotification;
      }
      // BroadcastChannel faithful relay (mirrors netWiring.spec.ts).
      (
        window as unknown as { __penteNetTransportFactory: () => unknown }
      ).__penteNetTransportFactory = () => {
        let channel: BroadcastChannel | null = null;
        let msgCb: (msg: unknown) => void = () => {};
        let presenceCb: (peers: readonly string[]) => void = () => {};
        const present = new Set<string>([sid]);
        let lastBody: unknown = null;
        return {
          connect: (roomCode: string) => {
            channel = new BroadcastChannel(`pente-mock-${roomCode}`);
            channel.onmessage = (ev: MessageEvent) => {
              const data = ev.data as { from: string; kind: string; body?: unknown };
              if (data.from === sid) return;
              if (data.kind === 'msg') {
                msgCb(data.body);
              } else if (data.kind === 'hello') {
                present.add(data.from);
                presenceCb([...present]);
                channel!.postMessage({ from: sid, kind: 'hello-ack' });
                if (lastBody !== null) channel!.postMessage({ from: sid, kind: 'msg', body: lastBody });
              } else if (data.kind === 'hello-ack') {
                present.add(data.from);
                presenceCb([...present]);
              }
            };
            channel.postMessage({ from: sid, kind: 'hello' });
            presenceCb([...present]);
            return Promise.resolve();
          },
          publish: (body: unknown) => {
            lastBody = JSON.parse(JSON.stringify(body));
            channel?.postMessage({ from: sid, kind: 'msg', body: lastBody });
          },
          onMessage: (cb: (msg: unknown) => void) => {
            msgCb = cb;
          },
          onPresence: (cb: (peers: readonly string[]) => void) => {
            presenceCb = cb;
          },
          disconnect: () => {
            channel?.close();
            channel = null;
          },
        };
      };
    },
    {
      sid,
      permission: opts.notificationPermission ?? null,
      configOverride: opts.configOverride ?? null,
      grantOnRequest: opts.grantOnRequest ?? false,
    },
  );
}

async function ready(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.getNet === 'function' &&
      typeof p.getNotify === 'function' &&
      typeof p.place === 'function' &&
      typeof p.leaveNet === 'function'
    );
  });
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: { getNet(): unknown } }).__pente;
    return !!p && p.getNet() !== null;
  });
}

const net = (page: Page) => page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getNet());
const notify = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getNotify());
const spy = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __notifySpy?: { constructed: { title: string; body?: string }[]; permissionRequests: number } })
        .__notifySpy ?? null,
  );

async function waitConnected(page: Page) {
  await page.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getNet()?.phase === 'connected',
  );
}

/** Override `document.visibilityState` + `document.hidden` and dispatch `visibilitychange` (real edge). */
async function setVisibility(page: Page, visible: boolean) {
  await page.evaluate((vis: boolean) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (vis ? 'visible' : 'hidden'),
    });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !vis });
    document.dispatchEvent(new Event('visibilitychange'));
    if (vis) window.dispatchEvent(new Event('focus'));
  }, visible);
}

/** Host on `page` (dispatch hostGame the netWiring way) and return the room code. */
async function host(page: Page): Promise<string> {
  await page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.dispatch('hostGame'));
  await waitConnected(page);
  const code = (await net(page))?.code;
  expect(code).not.toBeNull();
  return code!;
}

/** Join `code` on `page` (stash + dispatch joinGame). */
async function join(page: Page, code: string) {
  await page.evaluate((c: string) => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    p.setPendingJoinCode(c);
    p.dispatch('joinGame');
  }, code);
  await waitConnected(page);
}

/** Boot a host+joiner pair sharing a BroadcastChannel relay; returns the pages + the room code. */
async function bootPair(
  context: BrowserContext,
  joinerOpts: Parameters<typeof installMocks>[2] = {},
): Promise<{ host: Page; joiner: Page; code: string }> {
  const hostPage = await context.newPage();
  const joinerPage = await context.newPage();
  await installMocks(hostPage, 'host-tab');
  await installMocks(joinerPage, 'joiner-tab', joinerOpts);
  await ready(hostPage);
  const code = await host(hostPage);
  await ready(joinerPage);
  await join(joinerPage, code);
  expect((await net(joinerPage))?.seat).toBe('black');
  return { host: hostPage, joiner: joinerPage, code };
}

test('(a) a remote move while the tab is HIDDEN flashes the title; visible restores it', async ({
  browser,
}) => {
  const context = await browser.newContext();
  try {
    const { host: h, joiner: j } = await bootPair(context);

    const base = (await notify(j)).baseTitle;
    // Joiner goes to the background. It is the joiner's turn only AFTER white (host) moves.
    await setVisibility(j, false);

    // HOST (white) plays — it crosses the relay, the joiner adopts it, and NOW it is the joiner's turn.
    await h.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([2, 2, 2]));

    // The joiner's tab-title FLASHES to the enumerated your-turn string (proof-by-behaviour, not a log).
    await j.waitForFunction(
      (flash: string) =>
        (window as unknown as { __pente: Pente }).__pente.getNotify().title === flash,
      YOUR_TURN_FLASH,
    );
    const flashed = await notify(j);
    expect(flashed.title).toBe(YOUR_TURN_FLASH);
    expect(flashed.lastFlash).toBe(YOUR_TURN_FLASH);
    expect(flashed.titleFlashCount).toBe(1);

    const shot = resolve('e2e/artifacts/notifications-title-flash.png');
    mkdirSync(dirname(shot), { recursive: true });
    await j.screenshot({ path: shot });

    // Returning to VISIBLE restores the original title (the nudge is done once the user is looking).
    await setVisibility(j, true);
    await j.waitForFunction(
      (b: string) => (window as unknown as { __pente: Pente }).__pente.getNotify().title === b,
      base,
    );
    expect((await notify(j)).title).toBe(base);
  } finally {
    await context.close();
  }
});

test('(b) MY OWN move does NOT flash the title', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const { host: h, joiner: j } = await bootPair(context);

    // Host (white) plays first so it becomes the joiner's (black) turn — but the joiner is VISIBLE, so
    // no flash yet. Then the joiner hides and plays ITS OWN move: it becomes the host's turn, NOT the
    // joiner's, so `isRemoteMoveForMe` is false and the joiner's own move must never flash its title.
    await h.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([2, 2, 2]));
    await j.waitForFunction(
      () => (window as unknown as { __pente: Pente }).__pente.getState()?.pieces['2,2,2'] === 'white',
    );
    expect((await notify(j)).titleFlashCount).toBe(0); // visible when host moved → no flash

    await setVisibility(j, false);
    const base = (await notify(j)).baseTitle;
    // Joiner plays its OWN (black) move while hidden.
    await j.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([3, 3, 3]));
    await j.waitForFunction(
      () => (window as unknown as { __pente: Pente }).__pente.getState()?.pieces['3,3,3'] === 'black',
    );
    // Give any stray notification a real tick before asserting the negative.
    await j.waitForTimeout(300);
    const after = await notify(j);
    expect(after.titleFlashCount).toBe(0);
    expect(after.title).toBe(base);
  } finally {
    await context.close();
  }
});

test('(c) a browser Notification fires via the spy ONLY when hidden + permission granted', async ({
  browser,
}) => {
  // GRANTED spy: a host move while the joiner is hidden constructs exactly one notification.
  const grantedCtx = await browser.newContext();
  try {
    const { host: h, joiner: j } = await bootPair(grantedCtx, { notificationPermission: 'granted' });
    await setVisibility(j, false);
    await h.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([2, 2, 2]));
    await j.waitForFunction(
      () => (window as unknown as { __pente: Pente }).__pente.getNotify().notificationCount === 1,
    );
    const s = await spy(j);
    expect(s?.constructed.length).toBe(1);
    expect(s?.constructed[0].title).toBe(YOUR_TURN_FLASH);
    expect(s?.constructed[0].body).toBe('Your turn');
    expect((await notify(j)).notificationCount).toBe(1);
  } finally {
    await grantedCtx.close();
  }

  // DENIED spy: the SAME hidden your-turn move fires NO browser notification (permission gates it).
  const deniedCtx = await browser.newContext();
  try {
    const { host: h, joiner: j } = await bootPair(deniedCtx, { notificationPermission: 'denied' });
    await setVisibility(j, false);
    await h.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([2, 2, 2]));
    // The title still flashes (no permission needed), so wait on THAT, then assert zero notifications.
    await j.waitForFunction(
      (flash: string) =>
        (window as unknown as { __pente: Pente }).__pente.getNotify().title === flash,
      YOUR_TURN_FLASH,
    );
    await j.waitForTimeout(300);
    expect((await spy(j))?.constructed.length).toBe(0);
    expect((await notify(j)).notificationCount).toBe(0);
  } finally {
    await deniedCtx.close();
  }
});

test("(c') the one-time opt-in: permission 'default' requests ONCE, then a post-grant move fires", async ({
  browser,
}) => {
  // DISMISSED-PROMPT context: permission starts 'default' and STAYS 'default' after the request (the
  // user dismissed the prompt). This drives the `ctor.permission === 'default'` opt-in branch that the
  // granted/denied cases (test c) can never reach — proving `requestPermission` is actually invoked and
  // the once-guard holds across multiple your-turn moments.
  const dismissCtx = await browser.newContext();
  try {
    const { host: h, joiner: j } = await bootPair(dismissCtx, {
      notificationPermission: 'default',
      grantOnRequest: false,
    });
    await setVisibility(j, false);
    // Baseline: no request has happened yet (the opt-in fires on the FIRST your-turn moment, not boot).
    expect((await notify(j)).permissionRequests).toBe(0);
    expect((await spy(j))?.permissionRequests).toBe(0);

    // First your-turn move while hidden → the opt-in requests the permission exactly once.
    await h.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([2, 2, 2]));
    await j.waitForFunction(
      () => (window as unknown as { __pente: Pente }).__pente.getNotify().permissionRequests === 1,
    );
    // The glue actually CALLED Notification.requestPermission (spy proof, not just the internal counter).
    await j.waitForFunction(() => (window as unknown as { __notifySpy: { permissionRequests: number } }).__notifySpy.permissionRequests === 1);
    // Permission is still 'default' (dismissed) → NO notification fired despite the your-turn move.
    expect((await notify(j)).notificationCount).toBe(0);
    expect((await spy(j))?.constructed.length).toBe(0);

    // Drive a SECOND your-turn moment: joiner plays its own (black) move, then the host (white) plays
    // again → joiner's turn once more while hidden. The once-guard must NOT request permission again.
    await j.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([3, 3, 3]));
    await h.waitForFunction(
      () => (window as unknown as { __pente: Pente }).__pente.getState()?.pieces['3,3,3'] === 'black',
    );
    await h.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([4, 4, 4]));
    await j.waitForFunction(
      () => (window as unknown as { __pente: Pente }).__pente.getState()?.pieces['4,4,4'] === 'white',
    );
    await j.waitForTimeout(300); // let any stray second request settle before asserting the once-guard
    expect((await notify(j)).permissionRequests).toBe(1); // once-guard: STILL one, not two
    expect((await spy(j))?.permissionRequests).toBe(1);
    expect((await notify(j)).notificationCount).toBe(0); // still ungranted → still no notification
  } finally {
    await dismissCtx.close();
  }

  // GRANT-ON-REQUEST context: the prompt is accepted, so `requestPermission` flips the grant to
  // 'granted' AFTER it resolves. The move that TRIGGERED the request predates the grant (fires nothing),
  // but a SUBSEQUENT your-turn move — now that permission is granted — constructs a notification.
  const grantCtx = await browser.newContext();
  try {
    const { host: h, joiner: j } = await bootPair(grantCtx, {
      notificationPermission: 'default',
      grantOnRequest: true,
    });
    await setVisibility(j, false);

    // First your-turn move: requests the permission (grant lands async), fires nothing yet.
    await h.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([2, 2, 2]));
    await j.waitForFunction(
      () => (window as unknown as { __pente: Pente }).__pente.getNotify().permissionRequests === 1,
    );
    // Wait until the async grant has actually landed on the spy ctor (permission is now 'granted').
    await j.waitForFunction(
      () =>
        (window as unknown as { __penteNotifyNotificationCtor: { permission: string } })
          .__penteNotifyNotificationCtor.permission === 'granted',
    );
    expect((await notify(j)).notificationCount).toBe(0); // the triggering move predates the grant

    // Second your-turn move — permission is granted now — fires exactly one notification, once-guarded
    // so it does NOT request permission a second time.
    await j.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([3, 3, 3]));
    await h.waitForFunction(
      () => (window as unknown as { __pente: Pente }).__pente.getState()?.pieces['3,3,3'] === 'black',
    );
    await h.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([4, 4, 4]));
    await j.waitForFunction(
      () => (window as unknown as { __pente: Pente }).__pente.getNotify().notificationCount === 1,
    );
    const s = await spy(j);
    expect(s?.permissionRequests).toBe(1); // once-guard held across both moves
    expect(s?.constructed.length).toBe(1);
    expect(s?.constructed[0].title).toBe(YOUR_TURN_FLASH);
    expect(s?.constructed[0].body).toBe('Your turn');
    expect((await notify(j)).notificationCount).toBe(1);
  } finally {
    await grantCtx.close();
  }
});

test('(d) auto-reconnect: after leaving, a visible/online edge re-joins the SAME seat', async ({
  browser,
}) => {
  const context = await browser.newContext();
  try {
    const { host: h, joiner: j } = await bootPair(context);
    const seatBefore = (await net(j))?.seat;
    expect(seatBefore).toBe('black');

    // The joiner LEAVES the room (background drop): phase → offline, seat dropped. The session retains
    // the room code + role, so a later visibility/online edge can resume it.
    await j.evaluate(() => (window as unknown as { __pente: Pente }).__pente.leaveNet());
    await j.waitForFunction(
      () => (window as unknown as { __pente: Pente }).__pente.getNet()?.phase === 'offline',
    );
    expect((await net(j))?.seat).toBeNull();

    // Simulate background→return: the tab becomes visible (and fire `online`). The pure `shouldReconnect`
    // gate holds (offline + visible), so the glue calls `session.reconnect()` — re-joining the SAME room.
    await setVisibility(j, false);
    await setVisibility(j, true);
    await j.evaluate(() => window.dispatchEvent(new Event('online')));

    // The session re-establishes and reclaims the SAME sticky seat (phase → connected, seat 'black').
    await waitConnected(j);
    expect((await net(j))?.seat).toBe('black');

    // Re-converged: a host move after reconnect reaches the re-joined joiner (proof the seat is live).
    await h.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([4, 4, 4]));
    await j.waitForFunction(
      () => (window as unknown as { __pente: Pente }).__pente.getState()?.pieces['4,4,4'] === 'white',
    );
    expect((await net(j))?.code).toBe((await net(h))?.code);
  } finally {
    await context.close();
  }
});

test('GATE BITES: notifications.titleFlash OFF → a hidden your-turn move flashes NOTHING', async ({
  browser,
}) => {
  const context = await browser.newContext();
  try {
    // Joiner boots with the titleFlash channel turned OFF via a localStorage config override.
    const { host: h, joiner: j } = await bootPair(context, {
      configOverride: { titleFlash: false, browserNotification: false, sound: false },
    });
    await setVisibility(j, false);
    const base = (await notify(j)).baseTitle;

    // Host plays — it becomes the joiner's turn while hidden. With the flag OFF, NO flash may occur.
    await h.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([2, 2, 2]));
    // Confirm the move actually landed on the joiner (so we know the your-turn moment genuinely arrived).
    await j.waitForFunction(
      () => (window as unknown as { __pente: Pente }).__pente.getState()?.pieces['2,2,2'] === 'white',
    );
    await j.waitForTimeout(300);
    const after = await notify(j);
    expect(after.titleFlashCount).toBe(0);
    expect(after.title).toBe(base);
    expect(after.lastFlash).toBeNull();
  } finally {
    await context.close();
  }
});
