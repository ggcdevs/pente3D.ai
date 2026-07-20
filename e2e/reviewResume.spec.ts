import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DEFAULT_MENU_ENTRIES } from '../src/ui/widgets/menuModel.ts';

/**
 * Task 6.6 e2e — REVIEW vs RESUME in the archive browser (game explorer). The pure decision
 * (`archiveModel.ts` `resolveArchiveActions` / the `canReview`/`canResume` row flags) is mutation-
 * gated in Vitest; HERE we prove the DOM/IndexedDB WIRING end-to-end against the REAL app, asserting on
 * `window.__pente` real state + the rendered buttons — observable behavior, never a log line (#3):
 *
 *   - an IN-PROGRESS row shows BOTH a Review and a Resume button (it can be continued);
 *   - a FINISHED (won) row shows Review but NO Resume button (negative — review-only), and its
 *     `data-can-resume` is `false` — the observable review-vs-resume distinction driven by the model;
 *   - REVIEW loads the archived game read-only (getState reflects it) and the current autosave record
 *     is NOT disturbed (its id/count are unchanged) — reviewing is just looking;
 *   - RESUME loads the archived game AND continues playing: a subsequent move is accepted (the board
 *     advances past the archived ply), and the continued game accumulates as a NEW archive record
 *     while the ORIGINAL record stays intact (its headHash still present, unchanged).
 *
 * The archive is isolated per-test (a fresh IndexedDB via the `__penteDbName` seam) and localStorage
 * is cleared on first load, exactly as `archive.spec.ts` / `archiveAccumulation.spec.ts` do.
 */

const LOAD_COMMAND = DEFAULT_MENU_ENTRIES.find((e) => e.id === 'load')!.commandId;

interface GameStateReadout {
  pieces: Record<string, 'white' | 'black'>;
  turn: 'white' | 'black';
  winner: 'white' | 'black' | null;
}
interface HistoryReadout {
  maxPly: number;
  viewedPly: number;
  scrubbing: boolean;
}
interface ArchiveListing {
  id: string;
  meta: { players: Record<string, string>; result: string; startedAt: number; headHash: string };
}
type Pente = {
  getState(): GameStateReadout | null;
  getHistory(): HistoryReadout | null;
  getArchive(): Promise<ArchiveListing[]>;
  getHeadHash(): string | null;
  dispatch(id: string): boolean | null;
  place(coords: [number, number, number]): GameStateReadout | null;
  scrubTo(k: number): void;
};

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
      typeof p.place === 'function' &&
      !!document.querySelector('[data-widget-id="archiveBrowser"]')
    );
  });
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

const placeAt = (
  page: import('@playwright/test').Page,
  c: [number, number, number],
): Promise<GameStateReadout | null> =>
  page.evaluate((coord: [number, number, number]) => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    return p.place(coord);
  }, c);

const dispatchLoad = (page: import('@playwright/test').Page): Promise<boolean | null> =>
  page.evaluate((id: string) => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    return p.dispatch(id);
  }, LOAD_COMMAND);

const widget = (page: import('@playwright/test').Page) =>
  page.locator('[data-widget-id="archiveBrowser"]');
const modal = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid="archive-modal"]');

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

async function waitForArchiveCount(
  page: import('@playwright/test').Page,
  n: number,
): Promise<void> {
  await page.waitForFunction(
    async (want: number) => {
      const p = (window as unknown as { __pente?: Pente }).__pente;
      return !!p && (await p.getArchive()).length >= want;
    },
    n,
  );
}

/** Play three non-capturing pieces (an in-progress ply-3 game on the default size-5 board). */
async function placeThree(page: import('@playwright/test').Page): Promise<void> {
  await get(page, (p) => p.place([0, 0, 0]));
  await get(page, (p) => p.place([4, 4, 4]));
  await get(page, (p) => p.place([0, 4, 0]));
}

/** Force a white five-in-a-row (a FINISHED game). White runs the x-axis; black plays off to the side. */
async function forceWhiteWin(page: import('@playwright/test').Page): Promise<void> {
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
    await placeAt(page, whiteRun[i]!);
    if (i < 4) await placeAt(page, blackAway[i]!);
  }
}

test('an IN-PROGRESS row offers BOTH Review and Resume', async ({ page }) => {
  await isolate(page);
  await ready(page);
  await placeThree(page);
  await waitForAutosaved(page);
  const id = (await getAsync(page, (p) => p.getArchive()))[0]!.id;

  await dispatchLoad(page);
  await expect(modal(page)).toBeVisible();

  const row = widget(page).locator(`[data-testid="archive-row-${id}"]`);
  await expect(row).toHaveAttribute('data-can-resume', 'true');
  await expect(widget(page).locator(`[data-testid="archive-review-${id}"]`)).toHaveCount(1);
  await expect(widget(page).locator(`[data-testid="archive-resume-${id}"]`)).toHaveCount(1);

  const shot = resolve('e2e/artifacts/review-resume-inprogress.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('a FINISHED (won) row offers Review but NO Resume (negative — review-only)', async ({
  page,
}) => {
  await isolate(page);
  await ready(page);
  await forceWhiteWin(page);
  expect((await get(page, (p) => p.getState()!)).winner).toBe('white');

  // Wait for the won game's durable record (flagged white-wins), then open the browser.
  await page.waitForFunction(async () => {
    const p = (window as unknown as { __pente?: Pente }).__pente;
    if (!p) return false;
    const head = p.getHeadHash();
    return (await p.getArchive()).some(
      (g) => g.meta.headHash === head && g.meta.result === 'white-wins',
    );
  });
  const wonHead = await get(page, (p) => p.getHeadHash()!);
  const won = (await getAsync(page, (p) => p.getArchive())).find(
    (g) => g.meta.headHash === wonHead,
  )!;

  await dispatchLoad(page);
  await expect(modal(page)).toBeVisible();

  const row = widget(page).locator(`[data-testid="archive-row-${won.id}"]`);
  // The model withholds Resume for a finished game: the flag is false AND the button is absent.
  await expect(row).toHaveAttribute('data-can-resume', 'false');
  await expect(widget(page).locator(`[data-testid="archive-review-${won.id}"]`)).toHaveCount(1);
  await expect(widget(page).locator(`[data-testid="archive-resume-${won.id}"]`)).toHaveCount(0);

  const shot = resolve('e2e/artifacts/review-resume-finished.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('REVIEW loads read-only and leaves the current autosave record UNDISTURBED', async ({
  page,
}) => {
  await isolate(page);
  await ready(page);
  await placeThree(page);
  await waitForAutosaved(page);
  const archiveBefore = await getAsync(page, (p) => p.getArchive());
  expect(archiveBefore).toHaveLength(1);
  const id = archiveBefore[0]!.id;
  const headBefore = archiveBefore[0]!.meta.headHash;

  // Scrub the live view to an empty board so a review-load is OBSERVABLE (the board changes back).
  await get(page, (p) => p.scrubTo(0));
  expect(Object.keys((await get(page, (p) => p.getState()!)).pieces)).toHaveLength(0);

  await dispatchLoad(page);
  await expect(modal(page)).toBeVisible();
  await widget(page).locator(`[data-testid="archive-review-${id}"]`).click();
  await expect(modal(page)).toBeHidden();

  // The reviewed game is rendered (three pieces back at the live head, not scrubbing).
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Pente }).__pente;
    const s = p?.getState();
    const h = p?.getHistory();
    return !!s && Object.keys(s.pieces).length === 3 && !!h && !h.scrubbing;
  });

  // Reviewing did NOT mint a new record: same single record, same headHash (undisturbed autosave).
  await page.waitForTimeout(200); // let any (erroneous) autosave write land
  const archiveAfter = await getAsync(page, (p) => p.getArchive());
  expect(archiveAfter).toHaveLength(1);
  expect(archiveAfter[0]!.id).toBe(id);
  expect(archiveAfter[0]!.meta.headHash).toBe(headBefore);
});

test('RESUME loads AND continues playing, accumulating a NEW record while the original stays intact', async ({
  page,
}) => {
  await isolate(page);
  await ready(page);

  // Build game A (in-progress, ply 3), archive it, then RESET so a fresh empty game is live and game A
  // is a durable ABANDONED record — the realistic "resume an earlier game" scenario.
  await placeThree(page);
  await waitForAutosaved(page);
  const gameAHead = await get(page, (p) => p.getHeadHash()!);
  const gameAId = (await getAsync(page, (p) => p.getArchive()))[0]!.id;
  await get(page, (p) => p.dispatch('reset'));
  // Play a piece in the new game so the reset boundary mints game A's sibling (archive grows to 2).
  await get(page, (p) => p.place([2, 2, 2]));
  await waitForArchiveCount(page, 2);
  await waitForAutosaved(page);
  const countBeforeResume = (await getAsync(page, (p) => p.getArchive())).length;
  expect(countBeforeResume).toBe(2);

  // RESUME game A: load it back and continue. The board returns to game A's 3 pieces at its head.
  await dispatchLoad(page);
  await expect(modal(page)).toBeVisible();
  await widget(page).locator(`[data-testid="archive-resume-${gameAId}"]`).click();
  await expect(modal(page)).toBeHidden();
  await page.waitForFunction(
    (head: string) => {
      const p = (window as unknown as { __pente?: Pente }).__pente;
      const s = p?.getState();
      return !!s && Object.keys(s.pieces).length === 3 && p!.getHeadHash() === head;
    },
    gameAHead,
  );

  // CONTINUE PLAYING: a real move is accepted on the resumed board (the head advances past game A).
  await placeAt(page, [2, 0, 2]);
  const resumedState = await get(page, (p) => p.getState()!);
  expect(Object.keys(resumedState.pieces)).toHaveLength(4);
  expect(resumedState.pieces['2,0,2']).toBe('black'); // move 4 is black's — the game genuinely continued
  const resumedHead = await get(page, (p) => p.getHeadHash()!);
  expect(resumedHead).not.toBe(gameAHead); // a new move → a new head, past the archived ply

  // The resumed play accumulates as a NEW record (archive grows to 3) — the fresh id the resume minted.
  await waitForArchiveCount(page, 3);
  await waitForAutosaved(page);
  const archiveAfter = await getAsync(page, (p) => p.getArchive());
  expect(archiveAfter.length).toBe(3);
  const heads = archiveAfter.map((g) => g.meta.headHash);
  // The ORIGINAL game A record is still present and UNCHANGED (resume did not clobber it).
  expect(heads).toContain(gameAHead);
  const originalStill = archiveAfter.find((g) => g.id === gameAId)!;
  expect(originalStill.meta.headHash).toBe(gameAHead);
  // ...and the continued game (resumedHead) is its own new record with a distinct head.
  expect(heads).toContain(resumedHead);
  expect(resumedHead).not.toBe(gameAHead);

  const shot = resolve('e2e/artifacts/review-resume-continued.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});
