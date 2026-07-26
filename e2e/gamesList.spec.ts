import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { GAMES_STORE } from '../src/persist/db.ts';
import { DEFAULT_MENU_ENTRIES } from '../src/ui/widgets/menuModel.ts';
import { STATUS_EMPTY_TEXT, shortHeadHash } from '../src/ui/widgets/archiveModel.ts';

/**
 * Task V.6 e2e (epic #47, ticket #37) — THE GAMES LIST IS THE ONLY ROUTE BACK TO A GAME.
 *
 * v3.1 deletes the code→game mapping (design §2) and lands every reload on an empty slate (§6), so the
 * archive browser stops being a nicety and becomes the way back in (§10). This spec drives the REAL
 * app and asserts on `window.__pente` REAL VALUES + the rendered DOM (agent-principles #3 — observable
 * behaviour, never a log line); the pure model (`archiveModel.ts`) is unit/mutation-gated separately.
 *
 *   - BROWSE finished AND unfinished: two real games — one played to a white win, one left mid-game —
 *     are both listed, each under its own status section, with the finished one offering no Resume;
 *   - NOTHING HIDDEN OR DUPLICATED: the rendered rows are exactly the archived games, one per game
 *     uuid (V.1 deleted the internal `net-room:{code}` records, so the listing has no marker filter
 *     left, and V.5's one-record-per-uuid leaves nothing to de-duplicate);
 *   - RESUME BY UUID lands on THAT game: the row's `data-game-uuid` becomes `getGameUuid()`, with the
 *     game's pieces and `headHash` — identity, not a board that merely looks right;
 *   - RESUME IS KEYED BY THE GAME, NOT THE RECORD: a game moved to a record key that is NOT its uuid
 *     (what a pre-V.5 build's store looks like before the boot re-key) still resumes — which the
 *     record-id path could not do, since no record answers to that id;
 *   - the EMPTY ANSWER IS STATED: with every game over, the Unfinished section is still rendered, with
 *     the model's note;
 *   - the NET PANEL's Resume selector is the SAME list: exactly the browser's unfinished games minus
 *     the board already loaded — the finished game is not offered as a seed.
 *
 * Copy, testids and status text all come from the modules under test, so nothing user-facing is
 * hardcoded here (agent-principles #8).
 */

const LOAD_COMMAND = DEFAULT_MENU_ENTRIES.find((e) => e.id === 'load')!.commandId;

interface GameStateReadout {
  pieces: Record<string, 'white' | 'black'>;
  turn: 'white' | 'black';
  winner: 'white' | 'black' | null;
}
interface ArchiveListing {
  id: string;
  meta: {
    players: Record<string, string>;
    result: string;
    startedAt: number;
    headHash: string;
    uuid: string;
  };
}
type Pente = {
  getState(): GameStateReadout | null;
  getHistory(): { maxPly: number; scrubbing: boolean } | null;
  getArchive(): Promise<ArchiveListing[]>;
  getHeadHash(): string | null;
  getGameUuid(): string | null;
  dispatch(id: string): boolean | null;
  place(coords: [number, number, number]): GameStateReadout | null;
};

/** A raw `games` record as stored — enough shape to clone one under a different key. */
interface RawRecord {
  id: string;
  log: unknown[];
  meta: Record<string, unknown>;
}

/** Per-test archive DB + a localStorage cleared on the first navigation only (the archive specs' isolation). */
async function isolate(page: Page): Promise<string> {
  const dbName = `pente3d-e2e-${crypto.randomUUID()}`;
  await page.addInitScript((name: string) => {
    (window as unknown as { __penteDbName: string }).__penteDbName = name;
    if (window.localStorage.getItem('__e2e_booted') === null) {
      window.localStorage.clear();
      window.localStorage.setItem('__e2e_booted', '1');
    }
  }, dbName);
  return dbName;
}

async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.getState === 'function' &&
      typeof p.getArchive === 'function' &&
      typeof p.getHeadHash === 'function' &&
      typeof p.getGameUuid === 'function' &&
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

/** Wait until the LIVE game is durably autosaved (a record whose headHash IS the live head). */
async function waitForAutosaved(page: Page): Promise<void> {
  await page.waitForFunction(async () => {
    const p = (window as unknown as { __pente?: Pente }).__pente;
    if (!p) return false;
    const head = p.getHeadHash();
    if (head === null) return false;
    return (await p.getArchive()).some((g) => g.meta.headHash === head);
  });
}

const get = <T,>(page: Page, fn: (p: Pente) => T): Promise<T> =>
  page.evaluate((body: string): unknown => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    const revived = eval(`(${body})`) as (api: Pente) => unknown;
    return revived(p);
  }, fn.toString()) as Promise<T>;

const getAsync = <T,>(page: Page, fn: (p: Pente) => Promise<T>): Promise<T> =>
  page.evaluate((body: string): Promise<unknown> => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    const revived = eval(`(${body})`) as (api: Pente) => Promise<unknown>;
    return revived(p);
  }, fn.toString()) as Promise<T>;

const placeAt = (page: Page, c: [number, number, number]): Promise<unknown> =>
  page.evaluate((coord: [number, number, number]) => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    return p.place(coord);
  }, c);

const dispatch = (page: Page, id: string): Promise<boolean | null> =>
  page.evaluate((commandId: string) => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    return p.dispatch(commandId);
  }, id);

const widget = (page: Page) => page.locator('[data-widget-id="archiveBrowser"]');
const modal = (page: Page) => page.locator('[data-testid="archive-modal"]');
const rowByUuid = (page: Page, uuid: string) =>
  widget(page).locator(`.pente-archive-row[data-game-uuid="${uuid}"]`);
const groupOf = (page: Page, status: string) =>
  widget(page).locator(`[data-testid="archive-group-${status}"]`);

async function openBrowser(page: Page): Promise<void> {
  await dispatch(page, LOAD_COMMAND);
  await expect(modal(page)).toBeVisible();
}

/** Play three non-capturing pieces — an UNFINISHED (in-progress) ply-3 game. */
async function playUnfinished(page: Page): Promise<void> {
  await placeAt(page, [0, 0, 0]);
  await placeAt(page, [4, 4, 4]);
  await placeAt(page, [0, 4, 0]);
}

/** Force a white five-in-a-row — a FINISHED game. White runs the x-axis; black plays off to the side. */
async function playToWhiteWin(page: Page): Promise<void> {
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
  expect((await get(page, (p) => p.getState()!)).winner).toBe('white');
}

/** One game's identity as the test tracks it: the portable uuid + the head it was left at. */
interface GameId {
  uuid: string;
  head: string;
}

const identify = async (page: Page): Promise<GameId> => ({
  uuid: (await get(page, (p) => p.getGameUuid()))!,
  head: (await get(page, (p) => p.getHeadHash()))!,
});

/** Read a record straight out of the app's object store (bypassing every app-level filter). */
const rawGet = (page: Page, dbName: string, id: string): Promise<RawRecord | null> =>
  page.evaluate(
    ([name, store, key]) =>
      new Promise<RawRecord | null>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction(store, 'readonly').objectStore(store).get(key);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            db.close();
            resolve((req.result as RawRecord | undefined) ?? null);
          };
        };
      }),
    [dbName, GAMES_STORE, id] as const,
  );

/** Move a record to a different key, in one transaction (simulating a store an older build left). */
const rawRekey = (page: Page, dbName: string, record: RawRecord, toId: string): Promise<void> =>
  page.evaluate(
    ([name, store, rec, key]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(name as string);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(store as string, 'readwrite');
          const os = tx.objectStore(store as string);
          os.delete((rec as RawRecord).id);
          os.put({ ...(rec as RawRecord), id: key as string });
          tx.onerror = () => reject(tx.error);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    [dbName, GAMES_STORE, record, toId] as const,
  );

test('the browser lists a FINISHED and an UNFINISHED game, each under its own section', async ({
  page,
}) => {
  await isolate(page);
  await ready(page);

  // Game A: left mid-game (UNFINISHED). Game B: played to a white win (FINISHED).
  await playUnfinished(page);
  await waitForAutosaved(page);
  const gameA = await identify(page);
  await dispatch(page, 'reset');
  await playToWhiteWin(page);
  await waitForAutosaved(page);
  const gameB = await identify(page);
  expect(gameB.uuid).not.toBe(gameA.uuid);

  await openBrowser(page);

  // Both games are listed, each under the section its state puts it in — UNFINISHED FIRST.
  await expect(groupOf(page, 'unfinished')).toHaveAttribute('data-count', '1');
  await expect(groupOf(page, 'finished')).toHaveAttribute('data-count', '1');
  await expect(groupOf(page, 'unfinished').locator(`[data-game-uuid="${gameA.uuid}"]`)).toHaveCount(1);
  await expect(groupOf(page, 'finished').locator(`[data-game-uuid="${gameB.uuid}"]`)).toHaveCount(1);
  // No conflicted section at all — an empty section is not headed over nothing.
  await expect(groupOf(page, 'conflicted')).toHaveCount(0);

  // The unfinished game can be CONTINUED; the finished one is review-only (the negative case that
  // makes the state distinction observable rather than decorative).
  await expect(rowByUuid(page, gameA.uuid)).toHaveAttribute('data-status', 'unfinished');
  await expect(rowByUuid(page, gameA.uuid)).toHaveAttribute('data-can-resume', 'true');
  await expect(rowByUuid(page, gameA.uuid).locator('.pente-archive-resume')).toHaveCount(1);
  await expect(rowByUuid(page, gameB.uuid)).toHaveAttribute('data-status', 'finished');
  await expect(rowByUuid(page, gameB.uuid)).toHaveAttribute('data-can-resume', 'false');
  await expect(rowByUuid(page, gameB.uuid).locator('.pente-archive-resume')).toHaveCount(0);
  await expect(rowByUuid(page, gameB.uuid).locator('.pente-archive-review')).toHaveCount(1);

  // NOTHING HIDDEN, NOTHING DUPLICATED: one row per archived game, one row per game uuid.
  const listed = await getAsync(page, (p) => p.getArchive());
  const rows = widget(page).locator('.pente-archive-row');
  await expect(rows).toHaveCount(listed.length);
  const renderedUuids = await rows.evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-game-uuid')),
  );
  expect(new Set(renderedUuids).size).toBe(renderedUuids.length);
  expect(renderedUuids.slice().sort()).toEqual(listed.map((g) => g.meta.uuid).sort());

  const shot = resolve('e2e/artifacts/games-list-finished-and-unfinished.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('RESUMING the unfinished row BY UUID makes exactly that game the live board', async ({
  page,
}) => {
  await isolate(page);
  await ready(page);

  await playUnfinished(page);
  await waitForAutosaved(page);
  const gameA = await identify(page);
  const boardA = await get(page, (p) => p.getState()!);
  expect(Object.keys(boardA.pieces)).toHaveLength(3);

  // Move on: a won game becomes the live board, so a resume of A is a real, observable change.
  await dispatch(page, 'reset');
  await playToWhiteWin(page);
  await waitForAutosaved(page);
  const gameB = await identify(page);
  expect(await get(page, (p) => p.getGameUuid())).toBe(gameB.uuid);

  await openBrowser(page);
  // Click Resume on the row that NAMES game A's uuid — the list's own identity handle.
  await rowByUuid(page, gameA.uuid).locator('.pente-archive-resume').click();
  await expect(modal(page)).toBeHidden();

  // The LOADED GAME IS GAME A — by identity (uuid), not by a board that merely looks right.
  await page.waitForFunction(
    (want: string) => {
      const p = (window as unknown as { __pente?: Pente }).__pente;
      return p?.getGameUuid() === want;
    },
    gameA.uuid,
  );
  expect(await get(page, (p) => p.getHeadHash())).toBe(gameA.head);
  const resumed = await get(page, (p) => p.getState()!);
  expect(resumed.pieces).toEqual(boardA.pieces);
  expect(resumed.winner).toBeNull();
  expect((await get(page, (p) => p.getHistory()!)).maxPly).toBe(3);

  // …and it CONTINUES: the next move is accepted on the resumed board (a resume, not a review).
  await placeAt(page, [2, 0, 2]);
  const continued = await get(page, (p) => p.getState()!);
  expect(Object.keys(continued.pieces)).toHaveLength(4);
  expect(continued.pieces['2,0,2']).toBe('black');
  expect(await get(page, (p) => p.getGameUuid())).toBe(gameA.uuid); // same GAME, advanced

  const shot = resolve('e2e/artifacts/games-list-resumed-by-uuid.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('RESUME follows the GAME uuid, not the record key — a game stored under a foreign key still resumes', async ({
  page,
}) => {
  const dbName = await isolate(page);
  await ready(page);

  await playUnfinished(page);
  await waitForAutosaved(page);
  const gameA = await identify(page);
  const boardA = await get(page, (p) => p.getState()!);

  // Move to a different live board so a resume of A is observable.
  await dispatch(page, 'reset');
  await placeAt(page, [2, 2, 2]);
  await waitForAutosaved(page);
  const gameB = await identify(page);

  // Re-key game A's record to a key that is NOT its uuid — exactly the shape a pre-V.5 build's store
  // has before the boot re-key runs (the record lives under a retired autosave id). No reload here, so
  // the migration does not tidy it away: the browser must cope with it as it stands.
  const FOREIGN_KEY = 'autosave-from-an-older-build';
  const recordA = await rawGet(page, dbName, gameA.uuid);
  expect(recordA).not.toBeNull();
  expect(recordA!.meta.uuid).toBe(gameA.uuid);
  await rawRekey(page, dbName, recordA!, FOREIGN_KEY);
  expect(await rawGet(page, dbName, gameA.uuid)).toBeNull();

  await openBrowser(page);
  // The row still identifies the GAME by uuid while its record key is something else entirely.
  const row = rowByUuid(page, gameA.uuid);
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-id', FOREIGN_KEY);
  await expect(row).toHaveAttribute('data-status', 'unfinished');

  // Resuming loads game A. Had the row handed the RECORD key to the resume path, nothing would answer
  // to it — no record is stored under game A's uuid any more, and no record's `meta.uuid` is
  // `FOREIGN_KEY` — so this only converges because the uuid is what the resume is keyed by.
  await row.locator('.pente-archive-resume').click();
  await expect(modal(page)).toBeHidden();
  await page.waitForFunction(
    (want: string) => {
      const p = (window as unknown as { __pente?: Pente }).__pente;
      return p?.getGameUuid() === want;
    },
    gameA.uuid,
  );
  expect(await get(page, (p) => p.getHeadHash())).toBe(gameA.head);
  expect((await get(page, (p) => p.getState()!)).pieces).toEqual(boardA.pieces);
  expect(gameB.uuid).not.toBe(gameA.uuid); // the board we came from really was a different game
});

test('with every game over, the UNFINISHED section still shows — and SAYS there is nothing to resume', async ({
  page,
}) => {
  await isolate(page);
  await ready(page);

  await playToWhiteWin(page);
  await waitForAutosaved(page);
  const won = await identify(page);

  await openBrowser(page);
  // The section a player opens this list for is rendered even holding nothing, with the model's note —
  // an empty answer stated, not implied by a missing heading (the archive itself is NOT empty).
  await expect(widget(page)).toHaveAttribute('data-empty', 'false');
  await expect(groupOf(page, 'unfinished')).toHaveAttribute('data-count', '0');
  const note = widget(page).locator('[data-testid="archive-group-empty-unfinished"]');
  await expect(note).toBeVisible();
  await expect(note).toHaveText(STATUS_EMPTY_TEXT.unfinished);
  // …while the finished game IS listed (so the empty section is about resumability, not emptiness).
  await expect(groupOf(page, 'finished').locator(`[data-game-uuid="${won.uuid}"]`)).toHaveCount(1);
  await expect(widget(page).locator('.pente-archive-resume')).toHaveCount(0);

  const shot = resolve('e2e/artifacts/games-list-nothing-to-resume.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test("the net panel's Resume selector IS the browser's unfinished list, minus the loaded board", async ({
  page,
}) => {
  await isolate(page);
  await ready(page);

  // Game A — unfinished, abandoned. Game C — finished. Game D — unfinished AND currently loaded.
  await playUnfinished(page);
  await waitForAutosaved(page);
  const gameA = await identify(page);
  await dispatch(page, 'reset');
  await playToWhiteWin(page);
  await waitForAutosaved(page);
  const gameC = await identify(page);
  await dispatch(page, 'reset');
  await placeAt(page, [2, 2, 2]);
  await waitForAutosaved(page);
  const gameD = await identify(page);

  // The BROWSER's unfinished section holds A and D (D is the board on screen); C is finished.
  await openBrowser(page);
  const unfinishedUuids = await groupOf(page, 'unfinished')
    .locator('.pente-archive-row')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-game-uuid')));
  expect(unfinishedUuids.slice().sort()).toEqual([gameA.uuid, gameD.uuid].sort());
  await expect(groupOf(page, 'finished').locator(`[data-game-uuid="${gameC.uuid}"]`)).toHaveCount(1);
  await page.locator('[data-testid="archive-close"]').click();
  await expect(modal(page)).toBeHidden();

  // The PANEL's Resume selector is that same list minus the loaded board: exactly game A. The seed
  // cache is refreshed after each autosave write, so the panel is (re)opened until it settles — the
  // panel reads the cache once, on open.
  const panel = page.locator('[data-testid="netpanel-modal"]');
  const seedRows = panel.locator('[data-testid="netpanel-game-row"]');
  const readSeedRows = async (): Promise<string[]> => {
    await page.locator('[data-widget-id="menuButton"] [data-testid="menu-button"]').click();
    await page.locator('[data-widget-id="menuButton"] [data-testid="menu-entry-network"]').click();
    await expect(panel).toHaveClass(/pente-netpanel-modal--open/);
    if (await panel.locator('[data-testid="netpanel-seed-resume"]').isEnabled()) {
      await panel.locator('[data-testid="netpanel-seed-resume"]').click();
    }
    const ids = await seedRows.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-game-id') ?? ''),
    );
    return ids;
  };
  let seeded: string[] = [];
  await expect
    .poll(async () => {
      seeded = await readSeedRows();
      if (seeded.length !== 1) {
        await panel.locator('[data-testid="netpanel-close"]').click();
      }
      return seeded.length;
    })
    .toBe(1);

  // The one seed row IS game A: its record key, and a label carrying game A's head fingerprint (the
  // shared derivation's, imported from the model — no copy hardcoded here).
  expect(seeded).toEqual([gameA.uuid]);
  await expect(seedRows.first()).toHaveAttribute('data-game-id', gameA.uuid);
  await expect(panel.locator('[data-testid="netpanel-game"]').first()).toContainText(
    shortHeadHash(gameA.head),
  );
  // The FINISHED game is NOT offered as a seed — a game that is over cannot be brought into a room to
  // continue (the same rule the browser's missing Resume button states).
  expect(seeded).not.toContain(gameC.uuid);

  const shot = resolve('e2e/artifacts/games-list-seed-selector.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});
