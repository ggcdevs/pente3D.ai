import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Task 6.2 e2e (issue #4c) — the SEAT-TURN GATE: in a networked game a client may place ONLY on its
 * own seat's turn; an off-turn attempt is BLOCKED (no move pushed onto the shared authoritative log)
 * and a SUBTLE cue pulses the banner's "X to move" line. Local (non-networked) games are unaffected.
 *
 * This drives the REAL app through `window.__pente` and asserts on observable state (getState /
 * getTurnGate / getHeadHash + the banner's `data-offturn-flashes`), never a log line (agent-principles
 * #3). It proves the WIRING the pure `canPlaceForSeat` unit test cannot:
 *
 *   1. OFF-TURN BLOCKED — the joiner (black) attempts a move while it is WHITE's turn. The board does
 *      NOT change (on either tab), the joiner's `getTurnGate().offTurnBlocks` advances, and the
 *      banner's off-turn flash counter advances — the subtle cue fired. The head hash is unchanged.
 *   2. ON-TURN ALLOWED — the host (white) then plays; it re-renders on the joiner and both converge.
 *      Now it is BLACK's turn, so the joiner's move is ALLOWED and re-renders on the host.
 *   3. LOCAL UNAFFECTED — a solo (non-networked) page places BOTH colours freely and never blocks.
 *
 * The BroadcastChannel mock relay (two pages in one context) is the same faithful, hermetic relay the
 * 6.1 netWiring spec uses — real cross-client message exchange without the external MQTT broker.
 */

type Pente = {
  getState(): { pieces: Record<string, string>; turn: string; winner: string | null } | null;
  getTurnGate(): { offTurnBlocks: number } | null;
  getHeadHash(): string | null;
  getNet(): { phase: string; seat: string | null; code: string | null } | null;
  place(coords: [number, number, number]): unknown;
  dispatch(id: string): boolean | null;
};

/**
 * Install a BroadcastChannel-backed mock transport factory BEFORE the app boots — two pages in the
 * SAME Playwright context share a BroadcastChannel keyed by the room code, so a publish on one page is
 * delivered to the OTHER page's SyncEngine (a real cross-client relay, hermetically). Faithful: never
 * echoes to the sender, carries opaque JSON, and re-sends the last log to a late joiner. Mirrors the
 * mock in `netWiring.spec.ts` so both 6.1 and 6.2 exercise the identical relay behavior.
 */
async function installBroadcastMock(page: import('@playwright/test').Page, senderId: string) {
  await page.addInitScript((sid: string) => {
    window.localStorage.clear();
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
              if (lastBody !== null) {
                channel!.postMessage({ from: sid, kind: 'msg', body: lastBody });
              }
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
  }, senderId);
}

async function ready(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.getNet === 'function' &&
      typeof p.getTurnGate === 'function' &&
      typeof p.place === 'function'
    );
  });
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: { getNet(): unknown } }).__pente;
    return !!p && p.getNet() !== null;
  });
}

const net = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getNet());
const state = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getState());
const turnGate = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getTurnGate());
const headHash = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getHeadHash());
const bannerFlashes = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-testid="banner-status"]');
    return Number(el?.getAttribute('data-offturn-flashes') ?? '-1');
  });

async function waitConnected(page: import('@playwright/test').Page) {
  await page.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getNet()?.phase === 'connected',
  );
}

async function joinRoom(page: import('@playwright/test').Page, code: string) {
  await page.evaluate((c: string) => {
    // Task C.2: Host/Join initiation moved to the drawer's Network-Game panel; join via the SAME
    // seam+command the panel uses (stash the validated code, then dispatch the argument-free joinGame).
    const pente = (window as unknown as { __pente: { setPendingJoinCode(x: string): void; dispatch(id: string): boolean } }).__pente;
    pente.setPendingJoinCode(c);
    pente.dispatch('joinGame');
  }, code);
  await waitConnected(page);
}

test('OFF-TURN placement is blocked with a subtle cue; ON-TURN placement is allowed (issue #4c)', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const host = await context.newPage(); // white
  const joiner = await context.newPage(); // black
  await installBroadcastMock(host, 'host-4c');
  await installBroadcastMock(joiner, 'joiner-4c');

  await ready(host);
  await host.evaluate(() => (window as unknown as { __pente: Pente }).__pente.dispatch('hostGame'));
  await waitConnected(host);
  const code = (await net(host))?.code;
  expect(code).not.toBeNull();
  expect((await net(host))?.seat).toBe('white');

  await ready(joiner);
  await joinRoom(joiner, code!);
  expect((await net(joiner))?.seat).toBe('black');

  // Sanity: a fresh game is WHITE to move on both tabs, and no off-turn blocks yet.
  expect((await state(joiner))?.turn).toBe('white');
  expect((await turnGate(joiner))?.offTurnBlocks).toBe(0);
  expect(await bannerFlashes(joiner)).toBe(0);
  const hashBeforeBlock = await headHash(joiner);

  // (1) OFF-TURN: the JOINER (black) attempts a move while it is WHITE's turn. The gate must BLOCK it.
  await joiner.evaluate(() =>
    (window as unknown as { __pente: Pente }).__pente.place([0, 0, 0]),
  );

  // Proof-by-behavior (#3): the board did NOT change — no black piece appeared — and the block counter
  // advanced. The banner's off-turn flash counter advanced too, so the subtle cue fired.
  expect((await state(joiner))?.pieces['0,0,0']).toBeUndefined();
  expect((await turnGate(joiner))?.offTurnBlocks).toBe(1);
  await joiner.waitForFunction(() => {
    const el = document.querySelector('[data-testid="banner-status"]');
    return Number(el?.getAttribute('data-offturn-flashes') ?? '-1') >= 1;
  });
  expect(await bannerFlashes(joiner)).toBe(1);
  // The shared authoritative head is unchanged (no move was published to the log).
  expect(await headHash(joiner)).toBe(hashBeforeBlock);
  // Nothing reached the host either — its board is still empty and it never blocked (it did not act).
  expect(Object.keys((await state(host))!.pieces).length).toBe(0);
  expect((await turnGate(host))?.offTurnBlocks).toBe(0);

  // (2) ON-TURN: the HOST (white) plays — allowed. It re-renders on the joiner and both converge.
  await host.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([0, 0, 0]));
  await joiner.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getState()?.pieces['0,0,0'] === 'white',
  );
  expect((await state(joiner))?.pieces['0,0,0']).toBe('white');
  expect(await headHash(joiner)).toBe(await headHash(host));

  // Now it is BLACK's turn, so the JOINER's move is ALLOWED (no new block) and re-renders on the host.
  expect((await state(joiner))?.turn).toBe('black');
  await joiner.evaluate(() =>
    (window as unknown as { __pente: Pente }).__pente.place([1, 1, 1]),
  );
  await host.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getState()?.pieces['1,1,1'] === 'black',
  );
  expect((await state(host))?.pieces['1,1,1']).toBe('black');
  expect(await headHash(host)).toBe(await headHash(joiner));
  // The joiner's ON-TURN move did NOT add a block, and the cue did NOT fire again (still exactly 1).
  expect((await turnGate(joiner))?.offTurnBlocks).toBe(1);
  expect(await bannerFlashes(joiner)).toBe(1);

  const shot = resolve('e2e/artifacts/turngate-offturn-blocked.png');
  mkdirSync(dirname(shot), { recursive: true });
  await joiner.screenshot({ path: shot });
  await context.close();
});

test('LOCAL (non-networked) game is UNAFFECTED — both colours place freely, never blocked', async ({
  page,
}) => {
  await installBroadcastMock(page, 'solo-4c');
  await ready(page);

  // No host/join: a plain single-player game. White then black then white — all placements succeed,
  // and the seat-turn gate NEVER blocks (the task's hard requirement that local games are unaffected).
  await page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([0, 0, 0]));
  await page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([1, 1, 1]));
  await page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([2, 2, 2]));

  const st = await state(page);
  expect(st?.pieces['0,0,0']).toBe('white');
  expect(st?.pieces['1,1,1']).toBe('black');
  expect(st?.pieces['2,2,2']).toBe('white');
  expect((await turnGate(page))?.offTurnBlocks).toBe(0);
  expect(await bannerFlashes(page)).toBe(0);
});
