import { test, expect } from '@playwright/test';

/**
 * Task 6.3 e2e — archive ACCUMULATION (issue #4). Stage 5 autosaved under ONE stable id, so every new
 * game OVERWROTE the previous record and the archive could only ever hold the current game. This spec
 * proves the WIRING of the pure game-lifecycle boundary detection (`persist/gameLifecycle.ts`, mutation-
 * gated in Vitest) end-to-end against the REAL app + IndexedDB, asserting on `window.__pente` real state
 * (getArchive / getHeadHash / getState) — observable behavior, never a log line (agent-principles #3):
 *
 *   - a game-BOUNDARY (a RESET after pieces were played) FINALIZES the current record AND mints a fresh
 *     one, so BOTH the finished/abandoned game and the new game are in the archive (COUNT grows, and the
 *     first game's headHash is still present) — the core accumulation fix;
 *   - an idle reset of a NEVER-PLAYED board does NOT litter the archive with an empty record (negative);
 *   - a GAME-OVER (a forced win) finalizes the won game as its own record flagged with the winner, and a
 *     subsequent reset-and-play accumulates the next game alongside it.
 *
 * The archive is isolated per-test (a fresh IndexedDB via the `__penteDbName` seam) and localStorage is
 * cleared on first load, exactly as `archive.spec.ts` does, so no two workers contend on the shared
 * `pente3d` store and the autosave-id minting is deterministic.
 */

interface GameStateReadout {
  pieces: Record<string, 'white' | 'black'>;
  turn: 'white' | 'black';
  winner: 'white' | 'black' | null;
}
interface ArchiveListing {
  id: string;
  meta: { players: Record<string, string>; result: string; startedAt: number; headHash: string };
}
type Pente = {
  getState(): GameStateReadout | null;
  getArchive(): Promise<ArchiveListing[]>;
  getHeadHash(): string | null;
  getNet(): { phase: string; seat: string | null; code: string | null } | null;
  dispatch(id: string): boolean | null;
  place(coords: [number, number, number]): GameStateReadout | null;
};

/** Give this test its OWN archive DB + a clean localStorage before boot (mirrors archive.spec.ts). */
async function isolate(page: import('@playwright/test').Page): Promise<void> {
  const dbName = `pente3d-e2e-${crypto.randomUUID()}`;
  await page.addInitScript((name: string) => {
    (window as unknown as { __penteDbName: string }).__penteDbName = name;
    if (window.localStorage.getItem('__e2e_booted') === null) {
      window.localStorage.clear();
      window.localStorage.setItem('__e2e_booted', '1');
    }
  }, dbName);
}

async function ready(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.getState === 'function' &&
      typeof p.getArchive === 'function' &&
      typeof p.getHeadHash === 'function' &&
      typeof p.dispatch === 'function' &&
      typeof p.place === 'function'
    );
  });
  // The pristine game is autosaved once the archive DB opens (async); wait for it so a getArchive read
  // is deterministic (the initial record exists before the first move).
  await page.waitForFunction(async () => {
    const p = (window as unknown as { __pente?: { getArchive(): Promise<unknown[]> } }).__pente;
    return !!p && (await p.getArchive()).length >= 1;
  });
}

const get = <T,>(page: import('@playwright/test').Page, fn: (p: Pente) => T): Promise<T> =>
  page.evaluate((body: string): unknown => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    const revived = eval(`(${body})`) as (api: Pente) => unknown;
    return revived(p);
  }, fn.toString()) as Promise<T>;

const getAsync = <T,>(
  page: import('@playwright/test').Page,
  fn: (p: Pente) => Promise<T>,
): Promise<T> =>
  page.evaluate((body: string): Promise<unknown> => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    const revived = eval(`(${body})`) as (api: Pente) => Promise<unknown>;
    return revived(p);
  }, fn.toString()) as Promise<T>;

/** Wait until an archive record whose headHash equals the live game's exists (a durable autosave). */
async function waitForAutosaved(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(async () => {
    const p = (window as unknown as { __pente?: Pente }).__pente;
    if (!p) return false;
    const head = p.getHeadHash();
    if (head === null) return false;
    return (await p.getArchive()).some((g) => g.meta.headHash === head);
  });
}

/** Wait until the archive holds at least `n` records (a fresh id has been minted + persisted). */
async function waitForArchiveCount(page: import('@playwright/test').Page, n: number): Promise<void> {
  await page.waitForFunction(
    async (want: number) => {
      const p = (window as unknown as { __pente?: Pente }).__pente;
      return !!p && (await p.getArchive()).length >= want;
    },
    n,
  );
}

test('a RESET after playing FINALIZES the game and mints a fresh record (both are kept)', async ({
  page,
}) => {
  await isolate(page);
  await ready(page);

  // Play game A (three non-capturing pieces on the default size-5 board), then wait for its durable
  // autosave and capture its head — this is the record that must SURVIVE the next game starting.
  await get(page, (p) => p.place([0, 0, 0]));
  await get(page, (p) => p.place([4, 4, 4]));
  await get(page, (p) => p.place([0, 4, 0]));
  await waitForAutosaved(page);
  const gameAHead = await get(page, (p) => p.getHeadHash()!);
  const before = await getAsync(page, (p) => p.getArchive());
  expect(before).toHaveLength(1);
  expect(before[0]!.meta.headHash).toBe(gameAHead);

  // RESET → a game boundary: game A is finalized under its id, a fresh id is minted for the new game.
  await get(page, (p) => p.dispatch('reset'));
  // The board is now empty (the new game).
  expect(Object.keys((await get(page, (p) => p.getState()!)).pieces)).toHaveLength(0);

  // Play game B so its fresh record gets a distinct head, then wait for TWO records to exist.
  await get(page, (p) => p.place([1, 1, 1]));
  await waitForArchiveCount(page, 2);
  await waitForAutosaved(page); // game B's ply-1 head is now durable too

  const after = await getAsync(page, (p) => p.getArchive());
  const gameBHead = await get(page, (p) => p.getHeadHash()!);
  // ACCUMULATION: two distinct records — game A's finalized record STILL present (not overwritten),
  // plus the new game B. This is the exact Stage-5 regression the fix closes (observable, #3).
  expect(after.length).toBe(2);
  const heads = after.map((g) => g.meta.headHash);
  expect(heads).toContain(gameAHead);
  expect(heads).toContain(gameBHead);
  expect(gameAHead).not.toBe(gameBHead);
  // Distinct archive ids — a genuinely fresh record was minted, not the same id reused.
  expect(new Set(after.map((g) => g.id)).size).toBe(2);
});

test('an idle reset of a NEVER-PLAYED board mints NOTHING (archive not littered)', async ({
  page,
}) => {
  await isolate(page);
  await ready(page);
  // The pristine game is autosaved at boot (one record). Resetting a never-played board is a
  // pristine→pristine swap — the pure boundary logic mints no fresh id, so the archive stays at one.
  const initial = await getAsync(page, (p) => p.getArchive());
  expect(initial).toHaveLength(1);
  await get(page, (p) => p.dispatch('reset'));
  await get(page, (p) => p.dispatch('reset'));
  await get(page, (p) => p.dispatch('reset'));
  // Give any (erroneous) autosave writes time to land, then assert the count is UNCHANGED.
  await page.waitForTimeout(200);
  const after = await getAsync(page, (p) => p.getArchive());
  expect(after).toHaveLength(1);
});

test('a WIN finalizes the won game as its own record, and the next game accumulates alongside it', async ({
  page,
}) => {
  await isolate(page);
  await ready(page);

  // Force a white five-in-a-row along the x-axis at y=z=0 on the size-5 board. White plays the run;
  // black plays off to the side (non-capturing) so only white lines up. Move 9 (white's 5th) wins.
  // `place` is called via a coord passed as an argument (the `get` closure is stringified into the
  // page, so it cannot close over outer variables — the coord must ride as a literal arg).
  const placeAt = (c: [number, number, number]): Promise<GameStateReadout | null> =>
    page.evaluate((coord: [number, number, number]) => {
      const p = (window as unknown as { __pente: Pente }).__pente;
      return p.place(coord);
    }, c);
  const whiteRun: [number, number, number][] = [
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [3, 0, 0],
    [4, 0, 0],
  ];
  const blackAway: [number, number, number][] = [
    [0, 2, 2],
    [1, 2, 2],
    [2, 2, 2],
    [3, 2, 2],
  ];
  for (let i = 0; i < 5; i++) {
    await placeAt(whiteRun[i]!);
    if (i < 4) await placeAt(blackAway[i]!);
  }
  const won = await get(page, (p) => p.getState()!);
  expect(won.winner).toBe('white'); // observable: the game is actually over

  // The won game is finalized under its id, flagged with the winner. Wait for that durable record.
  await waitForAutosaved(page);
  await page.waitForFunction(async () => {
    const p = (window as unknown as { __pente?: Pente }).__pente;
    if (!p) return false;
    const head = p.getHeadHash();
    return (await p.getArchive()).some(
      (g) => g.meta.headHash === head && g.meta.result === 'white-wins',
    );
  });
  const wonHead = await get(page, (p) => p.getHeadHash()!);

  // RESET and play the next game → a fresh record accumulates; the won record remains flagged.
  await get(page, (p) => p.dispatch('reset'));
  await get(page, (p) => p.place([2, 2, 0]));
  await waitForArchiveCount(page, 2);

  const after = await getAsync(page, (p) => p.getArchive());
  expect(after.length).toBe(2);
  const wonRecord = after.find((g) => g.meta.headHash === wonHead);
  expect(wonRecord).toBeDefined();
  expect(wonRecord!.meta.result).toBe('white-wins'); // the finished game kept its winner flag
  // The other record is the fresh in-progress game (distinct head, not a winner).
  const other = after.find((g) => g.meta.headHash !== wonHead)!;
  expect(other.meta.result).toBe('in-progress');
});

// --- issue #7: N moves in ONE game must yield EXACTLY ONE archive record (never one-per-move) --------
// The regression is that "new game" was inferred from the authoritative `Game` OBJECT IDENTITY. A LOCAL
// game mutates ONE `Game` object in place (stable identity → one record, always fine), but a NETWORKED
// game ADOPTS each remote move by swapping in a NEW `Game` object (`SyncEngine` rebuilds from the peer's
// log), so the old logic minted a fresh archive record on EVERY ply. These two tests pin the invariant
// for both — and the networked one is the RED-against-the-bug case: with the old object-identity
// generation logic it produces N records (this `toBe(1)` FAILS); with the issue #7 fix, exactly 1.

test('LOCAL: playing N moves in ONE game keeps EXACTLY ONE archive record (no per-move records)', async ({
  page,
}) => {
  await isolate(page);
  await ready(page);
  // The boot pristine record is the single current-game record. Play several non-winning moves on the
  // default size-5 board; each is a mutation of the SAME local `Game`, so the ONE record just grows.
  const moves: [number, number, number][] = [
    [0, 0, 0],
    [4, 4, 4],
    [0, 4, 0],
    [4, 0, 4],
    [0, 0, 4],
    [4, 4, 0],
  ];
  // `place` rides the coord as a literal arg — the page-side closure cannot capture the loop variable.
  const placeArg = (c: [number, number, number]): Promise<unknown> =>
    page.evaluate((coord: [number, number, number]) => {
      (window as unknown as { __pente: Pente }).__pente.place(coord);
    }, c);
  for (const m of moves) await placeArg(m);
  await waitForAutosaved(page); // the head is durable at the final ply
  // Give any (erroneous per-move) mint writes time to land, then assert the count is still ONE.
  await page.waitForTimeout(200);
  const archive = await getAsync(page, (p) => p.getArchive());
  expect(archive).toHaveLength(1);
  // The single record IS the live game at its final ply (headHash matches) — not an early-ply leftover.
  expect(archive[0]!.meta.headHash).toBe(await get(page, (p) => p.getHeadHash()!));
});

/**
 * Combined per-page init for the NETWORKED accumulation test: a private archive DB (so `getArchive`
 * is isolated per tab) PLUS the BroadcastChannel-backed mock transport (from `netWiring.spec.ts`) so
 * two tabs in one context exchange REAL sync messages. `adoptNetState` swaps the scene's authoritative
 * `Game` object on every adopted remote move — exactly the identity churn that made the old logic mint
 * a record per ply. Written as ONE init script so the mock's `localStorage.clear()` cannot wipe the
 * dbName we just set (order-of-init-scripts hazard).
 */
async function isolateNet(
  page: import('@playwright/test').Page,
  senderId: string,
): Promise<void> {
  const dbName = `pente3d-e2e-${crypto.randomUUID()}`;
  await page.addInitScript(
    ({ sid, name }: { sid: string; name: string }) => {
      window.localStorage.clear();
      (window as unknown as { __penteDbName: string }).__penteDbName = name;
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
    { sid: senderId, name: dbName },
  );
}

const netReadout = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getNet());

async function waitNetConnected(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    return p.getNet()?.phase === 'connected';
  });
}

test('NETWORKED (issue #7): N moves in ONE net game keep EXACTLY ONE archive record, not one-per-move', async ({
  browser,
}) => {
  // Two tabs in ONE context share a BroadcastChannel relay, each with its OWN archive DB. The host
  // and joiner ALTERNATE moves (the seat gate lets each place only on its turn), so within ONE net
  // game we drive N committed plies — every one adopted by the opponent swaps in a NEW `Game` object.
  const context = await browser.newContext();
  const host = await context.newPage();
  const joiner = await context.newPage();
  await isolateNet(host, 'host-acc');
  await isolateNet(joiner, 'joiner-acc');

  await ready(host);
  // Boot pristine record on the host (the single current-game record we assert stays singular).
  const bootHost = await getAsync(host, (p) => p.getArchive());
  expect(bootHost).toHaveLength(1);

  await host.evaluate(() => (window as unknown as { __pente: Pente }).__pente.dispatch('hostGame'));
  await waitNetConnected(host);
  const code = (await netReadout(host))?.code;
  expect(code).not.toBeNull();

  await ready(joiner);
  await joiner.evaluate((c: string) => {
    // Task C.2: Host/Join initiation moved to the drawer's Network-Game panel; join via the SAME
    // seam+command the panel uses (stash the validated code, then dispatch the argument-free joinGame).
    const pente = (window as unknown as { __pente: { setPendingJoinCode(x: string): void; dispatch(id: string): boolean } }).__pente;
    pente.setPendingJoinCode(c);
    pente.dispatch('joinGame');
  }, code!);
  await waitNetConnected(joiner);
  expect((await netReadout(joiner))?.seat).toBe('black');

  // Alternate five committed moves across the two tabs (white on the host, black on the joiner). Each
  // opponent ADOPTS the peer's move — swapping in a fresh `Game` object, the identity churn the bug
  // keyed a new record off. None of these is a five-in-a-row, so the ONE game runs the whole way.
  const placeOn = (page: import('@playwright/test').Page, c: [number, number, number]) =>
    page.evaluate((coord: [number, number, number]) => {
      (window as unknown as { __pente: Pente }).__pente.place(coord);
    }, c);
  const seq: { page: import('@playwright/test').Page; coord: [number, number, number] }[] = [
    { page: host, coord: [0, 0, 0] }, // white 1
    { page: joiner, coord: [0, 2, 2] }, // black 1
    { page: host, coord: [1, 0, 0] }, // white 2
    { page: joiner, coord: [1, 2, 2] }, // black 2
    { page: host, coord: [2, 0, 0] }, // white 3
  ];
  for (const { page, coord } of seq) {
    await placeOn(page, coord);
    // Wait until BOTH tabs have adopted this move (the peer swapped in a new authoritative Game object)
    // before the next placement, so the seat gate sees the correct turn and every ply is committed.
    const key = `${coord[0]},${coord[1]},${coord[2]}`;
    for (const p of [host, joiner]) {
      await p.waitForFunction((k: string) => {
        const s = (window as unknown as { __pente: Pente }).__pente.getState();
        return !!s && s.pieces[k] !== undefined;
      }, key);
    }
  }

  // Observable: the shared net game actually has all five pieces and both tabs converged.
  const hostState = await get(host, (p) => p.getState()!);
  expect(Object.keys(hostState.pieces)).toHaveLength(5);
  expect(await get(host, (p) => p.getHeadHash()!)).toBe(await get(joiner, (p) => p.getHeadHash()!));

  // Let any (erroneous per-move) mint writes settle, then the CORE assertion (RED against the bug):
  // the host archive still holds EXACTLY ONE record for this ONE game — not five (one per adopted ply).
  await waitForAutosaved(host);
  await host.waitForTimeout(300);
  const hostArchive = await getAsync(host, (p) => p.getArchive());
  expect(hostArchive).toHaveLength(1);
  // And that single record IS the live net game at its final ply (headHash matches) — accumulation,
  // not an early-ply leftover from a record that got abandoned by a spurious mint.
  expect(hostArchive[0]!.meta.headHash).toBe(await get(host, (p) => p.getHeadHash()!));

  await context.close();
});
