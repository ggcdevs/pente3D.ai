import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Task 6.5 e2e — the phantom-presence fix (issue #5): a bogus / nonexistent room must NOT show a
 * phantom "opponent connected"; a real two-peer room MUST. This drives the REAL app through
 * `window.__pente` + the net widget and asserts on observable state (`getNet().peerPresent` + the
 * rendered OPPONENT presence dot), never a log line (agent-principles #3). Issue #44 replaced the
 * "Waiting for opponent…"/"Opponent connected" TEXT line with a per-color `.pente-hud-dot[data-present]`
 * on each seat's HUD row — so a phantom/absent opponent is the opponent row's dot reading
 * `data-present="false"`, and a genuine one reads `data-present="true"`.
 *
 * The transport is a BroadcastChannel-backed mock (the stable pattern from `netWiring.spec.ts`) that
 * faithfully models a LIVE presence handshake: a peer, on connect, broadcasts a live `hello`; a live
 * peer replies `hello-ack`, and ONLY peers we hear a live hello/hello-ack from are reported present.
 * There is no retention here — which is exactly the point: presence is earned by a FRESH handshake,
 * so a code nobody is live in yields no opponent. (The retained-vs-live distinction over real MQTT —
 * the deeper root cause where a crashed peer's retained snapshot must be ignored — is proven at the
 * unit + real-relay level in `mqttTransport.test.ts` / `presence.realrelay.test.ts`; here we prove
 * the WIRING: liveness reaches `session.onPresence` -> `getNet().peerPresent` -> the widget line.)
 *
 * Each page uses a UNIQUE senderId and closes its channel on disconnect; the two-peer test drives a
 * fresh random host code, so nothing leaks across tests.
 */

type Pente = {
  getNet(): { phase: string; seat: string | null; code: string | null; peerPresent: boolean } | null;
  dispatch(id: string): boolean | null;
};

/**
 * Install a BroadcastChannel mock modelling a LIVE presence handshake. On connect a peer broadcasts
 * `hello`; a peer already in the room replies `hello-ack`. A peer is reported present ONLY once we
 * hear its live hello/hello-ack — a code no live peer is in never produces a presence signal (the
 * issue #5 "no phantom opponent" guarantee, end-to-end). No retention: presence is earned live.
 */
async function installLivenessMock(page: import('@playwright/test').Page, senderId: string) {
  await page.addInitScript((sid: string) => {
    window.localStorage.clear(); // fresh identity per tab
    (
      window as unknown as { __penteNetTransportFactory: () => unknown }
    ).__penteNetTransportFactory = () => {
      let channel: BroadcastChannel | null = null;
      let presenceCb: (peers: readonly string[]) => void = () => {};
      const live = new Set<string>();
      return {
        connect: (roomCode: string) => {
          channel = new BroadcastChannel(`pente-live-${roomCode}`);
          channel.onmessage = (ev: MessageEvent) => {
            const data = ev.data as { from: string; kind: string };
            if (data.from === sid) return; // faithful relay: never echo to the sender
            if (data.kind === 'hello') {
              live.add(data.from);
              presenceCb([...live]);
              channel!.postMessage({ from: sid, kind: 'hello-ack' }); // confirm WE are live too
            } else if (data.kind === 'hello-ack') {
              live.add(data.from);
              presenceCb([...live]);
            } else if (data.kind === 'bye') {
              live.delete(data.from);
              presenceCb([...live]);
            }
          };
          channel.postMessage({ from: sid, kind: 'hello' });
          presenceCb([...live]);
          return Promise.resolve();
        },
        publish: () => {},
        onMessage: () => {},
        onPresence: (cb: (peers: readonly string[]) => void) => {
          presenceCb = cb;
        },
        disconnect: () => {
          channel?.postMessage({ from: sid, kind: 'bye' });
          channel?.close();
          channel = null;
        },
      };
    };
  }, senderId);
}

async function ready(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return !!p && typeof p.getNet === 'function' && typeof p.dispatch === 'function';
  });
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: { getNet(): unknown } }).__pente;
    return !!p && p.getNet() !== null;
  });
}

const net = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getNet());

/** The presence dot on a given seat's HUD row inside the banner (issue #44 replaced the text line). */
const dot = (page: import('@playwright/test').Page, color: 'white' | 'black') =>
  page.locator(
    `[data-widget-id="statusBanner"] .pente-hud-row--${color} .pente-hud-dot`,
  );

async function waitConnected(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    return p.getNet()?.phase === 'connected';
  });
}

/** Join `code` through the widget's real input path (what a user does). */
async function joinCode(page: import('@playwright/test').Page, code: string) {
  await page.evaluate((c: string) => {
    // Task C.2: Host/Join initiation moved to the drawer's Network-Game panel; join via the SAME
    // seam+command the panel uses (stash the validated code, then dispatch the argument-free joinGame).
    const pente = (window as unknown as { __pente: { setPendingJoinCode(x: string): void; dispatch(id: string): boolean } }).__pente;
    pente.setPendingJoinCode(c);
    pente.dispatch('joinGame');
  }, code);
}

test('joining a BOGUS/nonexistent code shows NO opponent (issue #5: no phantom presence)', async ({
  page,
}) => {
  await installLivenessMock(page, 'lonely-joiner');
  await ready(page);

  // A valid-format code that nobody is live in (`DEADXX` — all chars in the code alphabet).
  await joinCode(page, 'DEADXX');
  await waitConnected(page);

  // Give any (wrong) phantom-presence a generous window to appear, then assert it never did: there
  // is no live peer to answer our hello, so peerPresent must stay false.
  await page.waitForTimeout(800);
  const state = await net(page);
  expect(state?.phase).toBe('connected');
  expect(state?.peerPresent).toBe(false);
  // Issue #44: no phantom opponent → the OPPONENT's presence dot stays not-present. The lone joiner
  // establishes as the first owner (white, §2.3/§4), so its opponent is BLACK.
  expect(state?.seat).toBe('white');
  await expect(dot(page, 'black')).toBeVisible();
  await expect(dot(page, 'black')).toHaveAttribute('data-present', 'false');
  // The local seat's own dot IS present (we are live in the room).
  await expect(dot(page, 'white')).toHaveAttribute('data-present', 'true');

  const shot = resolve('e2e/artifacts/presence-dead-room.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('a REAL two-peer room DOES show the opponent (issue #5: genuine presence still works)', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const host = await context.newPage();
  const joiner = await context.newPage();
  await installLivenessMock(host, 'live-host');
  await installLivenessMock(joiner, 'live-joiner');

  await ready(host);
  await host.evaluate(() => (window as unknown as { __pente: Pente }).__pente.dispatch('hostGame'));
  await waitConnected(host);
  const code = (await net(host))?.code;
  expect(code).not.toBeNull();

  // Before the joiner arrives, the host has no opponent (no live peer answered its hello).
  expect((await net(host))?.peerPresent).toBe(false);

  await ready(joiner);
  await joinCode(joiner, code!);
  await waitConnected(joiner);

  // The live hello/ack handshake completes over the shared channel: BOTH tabs see an opponent.
  await joiner.waitForFunction(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    return p.getNet()?.peerPresent === true;
  });
  await host.waitForFunction(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    return p.getNet()?.peerPresent === true;
  });
  expect((await net(joiner))?.peerPresent).toBe(true);
  expect((await net(host))?.peerPresent).toBe(true);
  // Issue #44: the host (white) now sees its OPPONENT (black) dot flip to present — the genuine
  // presence reached the rendered DOM (observable #3, not a text line any more).
  expect((await net(host))?.seat).toBe('white');
  await expect(dot(host, 'black')).toBeVisible();
  await expect(dot(host, 'black')).toHaveAttribute('data-present', 'true');

  const shot = resolve('e2e/artifacts/presence-two-peer.png');
  mkdirSync(dirname(shot), { recursive: true });
  await host.screenshot({ path: shot });
  await context.close();
});
