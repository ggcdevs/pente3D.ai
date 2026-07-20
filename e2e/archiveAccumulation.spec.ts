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
