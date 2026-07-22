import { test, expect } from '@playwright/test';

/**
 * Task 6.4 e2e (issue #4a + the play-again gap) — the WIRING that the pure `rematch.ts` decisions
 * drive, verified by driving the REAL app through `window.__pente` and asserting on observable board
 * + archive state, never a log line (agent-principles #3):
 *
 *   1. HOST-ONTO-A-PLAYED-BOARD ARCHIVES + RESETS (issue #4a) — with pieces on the local board,
 *      hosting a game RESETS the visible board (getState back to empty) AND the just-abandoned local
 *      game is kept in the archive (a record whose headHash == the played board's head exists).
 *   2. JOIN-ONTO-A-PLAYED-BOARD does the same (host and join share one archive+reset seam).
 *   3. HOST-ONTO-AN-EMPTY-BOARD just starts — no spurious archive record is minted for the empty
 *      board (the pristine board is left untouched; nothing worth keeping).
 *   4. PLAY-AGAIN on a finished networked game (Task N.2.2, issue #12) — two contexts play a networked
 *      game to a real five-in-a-row; when it ends BOTH clients surface the non-blocking view-only
 *      end-state overlay, one proposes Rematch through the N.1 handshake and the other Accepts, and on
 *      MUTUAL accept a FRESH net game starts (a new empty authoritative board, still connected) rather
 *      than a dead end.
 *   5. DECLINE leaves the finished game as-is (no fresh game started).
 *
 * A BroadcastChannel-backed mock relay (two pages in one context) exchanges REAL cross-client sync
 * messages hermetically (no MQTT), exactly as `netWiring.spec.ts`. The rematch is driven through the
 * SAME session handshake API the overlay's buttons use (`window.__pente.propose('rematch')` /
 * `respond(accepted)`) so accept/decline is deterministic. The FULL overlay-visible-on-both-sides +
 * seat-swap proof lives in `rematchFlow.spec.ts`; these two tests pin the fresh-game / stays-won
 * OUTCOMES of the accept/decline paths.
 */

type Pente = {
  getState(): { pieces: Record<string, string>; turn: string; winner: string | null } | null;
  getHeadHash(): string | null;
  getNet(): { phase: string; seat: string | null; code: string | null } | null;
  getArchive(): Promise<readonly { id: string; meta: { headHash: string; result: string } }[]>;
  getHandshake(): { pending: { direction: string } | null; resolution: { outcome: string } | null } | null;
  place(coords: [number, number, number]): unknown;
  propose(action: string): boolean | null;
  respond(accepted: boolean): boolean | null;
  dispatch(id: string): boolean | null;
};

type Page = import('@playwright/test').Page;

/**
 * Install the BroadcastChannel mock transport (shared with the joiner via the room-code channel)
 * BEFORE the app boots. The rematch is driven explicitly via the session handshake API (Task N.2.2),
 * so no prompt seam is needed — the win no longer auto-restarts.
 */
async function installMock(page: Page, senderId: string) {
  await page.addInitScript(
    ({ sid }: { sid: string }) => {
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
              if (data.from === sid) return; // faithful relay: never echo to the sender
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
    },
    { sid: senderId },
  );
}

async function ready(page: Page) {
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
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: { getNet(): unknown } }).__pente;
    return !!p && p.getNet() !== null;
  });
}

const state = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getState());
const net = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getNet());
const headHash = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getHeadHash());
const archive = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getArchive());

async function place(page: Page, coords: [number, number, number]) {
  await page.evaluate((c) => (window as unknown as { __pente: Pente }).__pente.place(c), coords);
}

async function waitConnected(page: Page) {
  await page.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getNet()?.phase === 'connected',
  );
}

async function waitArchiveHas(page: Page, hash: string) {
  await page.waitForFunction(async (h) => {
    const list = await (window as unknown as { __pente: Pente }).__pente.getArchive();
    return list.some((r) => r.meta.headHash === h);
  }, hash);
}

test('HOST onto a played local board archives the played game and resets the board (issue #4a)', async ({
  page,
}) => {
  await installMock(page, 'host-played');
  await ready(page);

  // Play two local moves, then wait until the played board is durably autosaved (its head is in the
  // archive) so we assert on a persisted fact, not a race.
  await place(page, [0, 0, 0]);
  await place(page, [1, 1, 1]);
  const playedHead = await headHash(page);
  expect(playedHead).not.toBeNull();
  await waitArchiveHas(page, playedHead!);
  expect((await state(page))?.pieces['0,0,0']).toBe('white');

  // HOST: the played board must be archived + RESET before the networked game starts.
  await page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.dispatch('hostGame'));
  await waitConnected(page);

  // The visible/authoritative board is now EMPTY (the played local game was reset away).
  const st = await state(page);
  expect(st?.pieces).toEqual({});
  expect(Object.keys(st?.pieces ?? {})).toHaveLength(0);

  // The abandoned local game is KEPT in the archive (a record with its played head still exists).
  const list = await archive(page);
  expect(list.some((r) => r.meta.headHash === playedHead)).toBe(true);
});

test('JOIN onto a played local board archives + resets identically (host/join share one seam)', async ({
  page,
}) => {
  await installMock(page, 'join-played');
  await ready(page);

  await place(page, [2, 2, 2]);
  const playedHead = await headHash(page);
  await waitArchiveHas(page, playedHead!);

  // JOIN a (self-hosted mock) room by code — the join path must also archive + reset the local board.
  await page.evaluate(() => {
    // Task C.2: Host/Join initiation moved to the drawer's Network-Game panel; join via the SAME
    // seam+command the panel uses (stash the validated code, then dispatch the argument-free joinGame).
    const pente = (
      window as unknown as {
        __pente: { setPendingJoinCode(x: string): void; dispatch(id: string): boolean };
      }
    ).__pente;
    pente.setPendingJoinCode('ABCDEF');
    pente.dispatch('joinGame');
  });
  await waitConnected(page);

  const st = await state(page);
  expect(st?.pieces).toEqual({});
  const list = await archive(page);
  expect(list.some((r) => r.meta.headHash === playedHead)).toBe(true);
});

test('HOST onto an EMPTY board just starts — no spurious archive record is minted', async ({
  page,
}) => {
  await installMock(page, 'host-empty');
  await ready(page);

  // Baseline: a fresh app autosaves its (empty) starting game as ONE in-progress record.
  await page.waitForFunction(async () => {
    const l = await (window as unknown as { __pente: Pente }).__pente.getArchive();
    return l.length >= 1;
  });
  const before = (await archive(page)).length;

  // Host with a pristine board: nothing to archive, so the archive count does not grow from a reset.
  await page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.dispatch('hostGame'));
  await waitConnected(page);

  // No played game existed, so `shouldArchiveBeforeNetStart` returned false: no extra reset-mint.
  // (The count may still reflect the SAME single in-progress record being overwritten, not a new one.)
  const after = (await archive(page)).length;
  expect(after).toBe(before);
});

/** Host on `host`, join on `joiner`, then drive a REAL networked white five-in-a-row (host = white)
 *  until the host's board shows a `white` winner. Returns the room code (both peers stay connected). */
async function hostJoinAndWin(host: Page, joiner: Page): Promise<string> {
  await ready(host);
  await host.evaluate(() => (window as unknown as { __pente: Pente }).__pente.dispatch('hostGame'));
  await waitConnected(host);
  const code = (await net(host))?.code;
  expect(code).not.toBeNull();

  await ready(joiner);
  await joiner.evaluate((c: string) => {
    // Task C.2: Host/Join initiation moved to the drawer's Network-Game panel; join via the SAME
    // seam+command the panel uses (stash the validated code, then dispatch the argument-free joinGame).
    const pente = (window as unknown as { __pente: { setPendingJoinCode(x: string): void; dispatch(id: string): boolean } }).__pente;
    pente.setPendingJoinCode(c);
    pente.dispatch('joinGame');
  }, code!);
  await waitConnected(joiner);
  expect((await net(joiner))?.seat).toBe('black');

  // Drive a networked five-in-a-row in seat order: host (white) plays the winning line, the joiner
  // (black) plays spacers between them. Each move must be adopted by the other before the next (seat-
  // turn gate), so we wait for cross-client convergence between plies.
  const whiteLine: [number, number, number][] = [
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [3, 0, 0],
    [4, 0, 0],
  ];
  const blackSpacers: [number, number, number][] = [
    [0, 0, 4],
    [1, 0, 4],
    [2, 0, 4],
    [3, 0, 4],
  ];
  for (let i = 0; i < whiteLine.length; i += 1) {
    await place(host, whiteLine[i]!);
    const wk = `${whiteLine[i]![0]},${whiteLine[i]![1]},${whiteLine[i]![2]}`;
    await joiner.waitForFunction(
      (k) => (window as unknown as { __pente: Pente }).__pente.getState()?.pieces[k] === 'white',
      wk,
    );
    if (i < blackSpacers.length) {
      await place(joiner, blackSpacers[i]!);
      const bk = `${blackSpacers[i]![0]},${blackSpacers[i]![1]},${blackSpacers[i]![2]}`;
      await host.waitForFunction(
        (k) => (window as unknown as { __pente: Pente }).__pente.getState()?.pieces[k] === 'black',
        bk,
      );
    }
  }
  await host.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getState()?.winner === 'white',
  );
  return code!;
}

test('PLAY-AGAIN: a finished networked game, on a mutual-accept rematch, starts a fresh net game', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const host = await context.newPage();
  const joiner = await context.newPage();
  await installMock(host, 'pa-host');
  await installMock(joiner, 'pa-joiner');

  await hostJoinAndWin(host, joiner);

  // The host (white) proposes a Rematch through the SAME session handshake the overlay's button drives.
  expect(
    await host.evaluate(() => (window as unknown as { __pente: Pente }).__pente.propose('rematch')),
  ).toBe(true);
  // The joiner sees the INCOMING rematch ask cross the relay, then ACCEPTS it.
  await joiner.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getHandshake()?.pending?.direction === 'incoming',
  );
  expect(
    await joiner.evaluate(() => (window as unknown as { __pente: Pente }).__pente.respond(true)),
  ).toBe(true);

  // MUTUAL accept → a FRESH net game started on the host: still connected, empty board, no winner.
  await host.waitForFunction(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    const s = p.getState();
    return (
      p.getNet()?.phase === 'connected' && s !== null && s.winner === null && s.pieces['0,0,0'] === undefined
    );
  });
  const fresh = await state(host);
  expect(fresh?.winner).toBeNull();
  expect(fresh?.pieces).toEqual({});
  expect((await net(host))?.phase).toBe('connected');

  await context.close();
});

test('DECLINE: a finished networked game whose rematch is declined starts no fresh game', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const host = await context.newPage();
  const joiner = await context.newPage();
  await installMock(host, 'dc-host');
  await installMock(joiner, 'dc-joiner');

  await hostJoinAndWin(host, joiner);

  // The host proposes a Rematch; the joiner DECLINES it — the finished game must stay as-is.
  expect(
    await host.evaluate(() => (window as unknown as { __pente: Pente }).__pente.propose('rematch')),
  ).toBe(true);
  await joiner.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getHandshake()?.pending?.direction === 'incoming',
  );
  expect(
    await joiner.evaluate(() => (window as unknown as { __pente: Pente }).__pente.respond(false)),
  ).toBe(true);
  // The host observes the outgoing ask resolve to `declined` (proof the decline crossed back).
  await host.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getHandshake()?.resolution?.outcome === 'declined',
  );

  // Declined: the finished game stays WON on the board — no fresh empty game replaced it.
  const st = await state(host);
  expect(st?.winner).toBe('white');
  expect(st?.pieces['0,0,0']).toBe('white');

  await context.close();
});
