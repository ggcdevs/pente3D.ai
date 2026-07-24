import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Task 6.1 e2e — the CORE net-wiring fix (issue #4): the scene renders the SESSION game when
 * networked, so there is ONE authoritative game per session. This drives the REAL app through the
 * `window.__pente` seams and asserts on observable board state (getState / getPieces / getHeadHash),
 * never a log line (agent-principles #3). It proves the WIRING the unit tests cannot:
 *
 *   1. LOCAL-ROUTES-THROUGH-SESSION — after hosting, `window.__pente.place(...)` places a piece AND
 *      the session's headHash advances, proving the scene routed the move through the SyncEngine
 *      (the shared authoritative game) rather than a disconnected scene-local game.
 *   2. TWO-CONTEXT MOVE-SYNC + headHash-match (6.1/6.7) — a host tab and a joiner tab in the SAME
 *      browser context share a BroadcastChannel-backed mock relay (a faithful relay: opaque JSON, no
 *      self-echo). A move on the host RE-RENDERS on the joiner's board (getState/getPieces reflect
 *      the peer's piece) and both tabs converge to an IDENTICAL headHash — the resync link the
 *      transport pump + engine.onChange + scene.adoptNetState now provide.
 *   3. JOINER-INHERITS-BOARD — a joiner who connects AFTER the host has moved inherits the host's
 *      board (the host's log is adopted on join), so the joiner starts from the shared position.
 *
 * A BroadcastChannel relay is used (not the external MQTT broker) so the UI e2e stays hermetic while
 * still exercising REAL cross-client message exchange between two live app instances — two pages in
 * one context share a BroadcastChannel. The full external-relay two-BROWSER matrix lands in 6.7.
 */

type Pente = {
  getState(): { pieces: Record<string, string>; turn: string; winner: string | null } | null;
  getPieces(): { node: string }[] | null;
  getHeadHash(): string | null;
  getNet(): { phase: string; seat: string | null; code: string | null } | null;
  getNetGameUuid(): string | null;
  place(coords: [number, number, number]): unknown;
  dispatch(id: string): boolean | null;
  setPendingJoinCode(code: string): void;
  leaveNet(): void;
};

/**
 * Install a BroadcastChannel-backed mock transport factory BEFORE the app boots. Two pages in the
 * SAME Playwright context share a BroadcastChannel keyed by the room code, so a publish on one page
 * is delivered to the OTHER page's SyncEngine — a real cross-client relay, hermetically (no MQTT).
 * It never echoes a message back to its own sender (faithful relay) and carries opaque JSON. A unique
 * `senderId` per page id lets the receiver drop its own messages.
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
      // Cache our last published body so we can re-send it when a NEW peer announces (defeats the
      // real relay's join-subscription race hermetically: a peer that arrives after our publish still
      // receives our current log — the same convergence the live relay achieves via re-publish).
      let lastBody: unknown = null;
      return {
        connect: (roomCode: string) => {
          channel = new BroadcastChannel(`pente-mock-${roomCode}`);
          channel.onmessage = (ev: MessageEvent) => {
            const data = ev.data as { from: string; kind: string; body?: unknown };
            if (data.from === sid) return; // faithful relay: never echo to the sender
            if (data.kind === 'msg') {
              msgCb(data.body);
            } else if (data.kind === 'hello') {
              present.add(data.from);
              presenceCb([...present]);
              // Announce ourselves back so the newcomer learns we are here too, and RE-SEND our last
              // published log so a late joiner inherits our current board (JOINER-INHERITS-BOARD).
              channel!.postMessage({ from: sid, kind: 'hello-ack' });
              if (lastBody !== null) {
                channel!.postMessage({ from: sid, kind: 'msg', body: lastBody });
              }
            } else if (data.kind === 'hello-ack') {
              present.add(data.from);
              presenceCb([...present]);
            }
          };
          // Announce our arrival so an already-present peer marks us present (and acks).
          channel.postMessage({ from: sid, kind: 'hello' });
          presenceCb([...present]);
          return Promise.resolve();
        },
        publish: (body: unknown) => {
          // Clone through JSON so the relay is opaque (no shared references between "peers").
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
      typeof p.getHeadHash === 'function' &&
      typeof p.place === 'function'
    );
  });
  // The session is created async (opens IndexedDB); wait until wired (getNet non-null offline).
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: { getNet(): unknown } }).__pente;
    return !!p && p.getNet() !== null;
  });
}

const net = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getNet());
const headHash = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getHeadHash());
const state = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getState());
const gameUuid = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getNetGameUuid());

async function waitConnected(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    return p.getNet()?.phase === 'connected';
  });
}

async function waitOffline(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    return p.getNet()?.phase === 'offline';
  });
}

/** Host a `new` game at a SPECIFIC room code (the panel's stash-code-then-hostGame seam). */
async function hostAt(page: import('@playwright/test').Page, code: string) {
  await page.evaluate((c: string) => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    p.setPendingJoinCode(c);
    p.dispatch('hostGame');
  }, code);
  await waitConnected(page);
}

test('LOCAL move routes through the session (headHash advances on the authoritative game)', async ({
  page,
}) => {
  await installBroadcastMock(page, 'solo-host');
  await ready(page);

  // Host: the session connects and claims white — now the scene's authoritative game is the session's.
  await page.evaluate(() =>
    (window as unknown as { __pente: Pente }).__pente.dispatch('hostGame'),
  );
  await waitConnected(page);
  expect((await net(page))?.seat).toBe('white');

  const before = await headHash(page);

  // Place via the scene seam. If the move routed through the session (issue #4 fix), the SESSION's
  // game changed — observable as the headHash advancing AND the piece rendering on the board.
  await page.evaluate(() =>
    (window as unknown as { __pente: Pente }).__pente.place([0, 0, 0]),
  );

  const after = await headHash(page);
  expect(after).not.toBe(before);
  const st = await state(page);
  expect(st?.pieces['0,0,0']).toBe('white');
});

test('TWO CONTEXTS: a host move re-renders on the joiner and both headHashes match (issue #4)', async ({
  browser,
}) => {
  // Two pages in ONE context share a BroadcastChannel — a real cross-client relay, hermetically.
  const context = await browser.newContext();
  const host = await context.newPage();
  const joiner = await context.newPage();
  await installBroadcastMock(host, 'host-tab');
  await installBroadcastMock(joiner, 'joiner-tab');

  await ready(host);
  await host.evaluate(() => (window as unknown as { __pente: Pente }).__pente.dispatch('hostGame'));
  await waitConnected(host);
  const code = (await net(host))?.code;
  expect(code).not.toBeNull();

  // Joiner joins the SAME room code (stash the code, dispatch joinGame — the widget's path).
  await ready(joiner);
  await joiner.evaluate((c: string) => {
    // Task C.2: Host/Join initiation moved to the drawer's Network-Game panel; join via the SAME
    // seam+command the panel uses (stash the validated code, then dispatch the argument-free joinGame).
    const pente = (
      window as unknown as {
        __pente: { setPendingJoinCode(x: string): void; dispatch(id: string): boolean };
      }
    ).__pente;
    pente.setPendingJoinCode(c);
    pente.dispatch('joinGame');
  }, code!);
  await waitConnected(joiner);
  expect((await net(joiner))?.seat).toBe('black');

  // HOST plays a move. It must reach the JOINER's board over the shared relay and re-render there.
  await host.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([2, 2, 2]));

  // Proof-by-behavior (#3): the JOINER actually receives + renders the host's piece.
  await joiner.waitForFunction(() => {
    const s = (window as unknown as { __pente: Pente }).__pente.getState();
    return s?.pieces['2,2,2'] === 'white';
  });
  const joinerState = await state(joiner);
  expect(joinerState?.pieces['2,2,2']).toBe('white');

  // Both authoritative logs converged to an IDENTICAL headHash (the 6.1/6.7 headHash-match proof).
  await joiner.waitForFunction(
    async ([expectedHash]) => {
      const p = (window as unknown as { __pente: Pente }).__pente;
      return p.getHeadHash() === expectedHash;
    },
    [await headHash(host)],
  );
  expect(await headHash(joiner)).toBe(await headHash(host));

  // JOINER replies with black's move; it must re-render on the HOST (bidirectional resync).
  await joiner.evaluate(() =>
    (window as unknown as { __pente: Pente }).__pente.place([3, 3, 3]),
  );
  await host.waitForFunction(() => {
    const s = (window as unknown as { __pente: Pente }).__pente.getState();
    return s?.pieces['3,3,3'] === 'black';
  });
  expect((await state(host))?.pieces['3,3,3']).toBe('black');
  expect(await headHash(host)).toBe(await headHash(joiner));

  const shot = resolve('e2e/artifacts/netwiring-two-context.png');
  mkdirSync(dirname(shot), { recursive: true });
  await joiner.screenshot({ path: shot });
  await context.close();
});

test('JOINER-INHERITS-BOARD: a late joiner adopts the host board that already has a move', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const host = await context.newPage();
  const joiner = await context.newPage();
  await installBroadcastMock(host, 'host2');
  await installBroadcastMock(joiner, 'joiner2');

  await ready(host);
  await host.evaluate(() => (window as unknown as { __pente: Pente }).__pente.dispatch('hostGame'));
  await waitConnected(host);
  const code = (await net(host))?.code;

  // Host moves BEFORE the joiner arrives — the board is non-empty at join time.
  await host.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([1, 1, 1]));
  expect((await state(host))?.pieces['1,1,1']).toBe('white');

  // Now the joiner connects; on connect the engines exchange logs and the joiner ADOPTS the host log.
  await ready(joiner);
  await joiner.evaluate((c: string) => {
    // Task C.2: Host/Join initiation moved to the drawer's Network-Game panel; join via the SAME
    // seam+command the panel uses (stash the validated code, then dispatch the argument-free joinGame).
    const pente = (window as unknown as { __pente: { setPendingJoinCode(x: string): void; dispatch(id: string): boolean } }).__pente;
    pente.setPendingJoinCode(c);
    pente.dispatch('joinGame');
  }, code!);
  await waitConnected(joiner);

  // The joiner inherits the host's existing move (observable on its rendered board), and converges.
  await joiner.waitForFunction(() => {
    const s = (window as unknown as { __pente: Pente }).__pente.getState();
    return s?.pieces['1,1,1'] === 'white';
  });
  expect((await state(joiner))?.pieces['1,1,1']).toBe('white');
  expect(await headHash(joiner)).toBe(await headHash(host));

  await context.close();
});

/**
 * CODE REUSE FOR A NEW GAME (#43) — the single-browser /dev/ repro end-to-end. Host a game at a
 * chosen code, place pieces (leaving a persisted `net-room:{code}` record), leave, then re-host
 * ("New Game") at the SAME code. Re-using a code with `new` must MINT a FRESH game — an EMPTY board
 * with a DIFFERENT game uuid — never resurrect the prior board. The bug kept the prior pieces (the
 * durable empty-room reclaim adopted the persisted room game regardless of the `new` proposal kind).
 * Asserts on OBSERVABLE state (rendered pieces + game uuid), never a log line (agent-principles #3).
 */
test('CODE-REUSE-NEW: re-hosting the SAME code with New Game starts a FRESH empty board, new uuid (#43)', async ({
  page,
}) => {
  await installBroadcastMock(page, 'reuse-host');
  await ready(page);

  const CODE = 'REUSE1';

  // First game at CODE: host, then place a couple of pieces so a non-empty board is persisted.
  await hostAt(page, CODE);
  expect((await net(page))?.code).toBe(CODE);
  const firstUuid = await gameUuid(page);
  expect(firstUuid).not.toBeNull();
  // Place white's move (this solo host owns white; the turn gate blocks the absent black), leaving a
  // non-empty board — one piece is enough for the repro (a re-used code must not resurrect it).
  await page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([0, 0, 0]));
  expect((await state(page))?.pieces['0,0,0']).toBe('white');
  expect(Object.keys((await state(page))!.pieces).length).toBe(1);

  // Leave the room; the persisted room-state record for CODE now holds the played board.
  await page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.leaveNet());
  await waitOffline(page);

  // Re-host the SAME code — this is the "New Game at a re-used code" the user tried. It must start
  // OVER, not reclaim the old board.
  await hostAt(page, CODE);
  expect((await net(page))?.code).toBe(CODE);

  // FRESH: the board is empty and the game identity is DIFFERENT from the prior game. The bug kept
  // the prior piece + re-used firstUuid.
  const reuseState = await state(page);
  expect(Object.keys(reuseState!.pieces).length).toBe(0);
  const secondUuid = await gameUuid(page);
  expect(secondUuid).not.toBeNull();
  expect(secondUuid).not.toBe(firstUuid);
  // A `new` game claims white as first owner on a fresh board.
  expect((await net(page))?.seat).toBe('white');
});
