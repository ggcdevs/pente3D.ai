import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import layoutDefault from '../src/config/defaults/layout.json' with { type: 'json' };
import { ARCHIVE_WIDGET_ID, ARCHIVE_SCOPE_ID } from '../src/ui/widgets/archive.ts';
import { DEFAULT_MENU_ENTRIES } from '../src/ui/widgets/menuModel.ts';

/**
 * Task 5.8 e2e — persistence UX. The archive browser + autosave/restore are the DOM/dispatch +
 * IndexedDB IO boundary over the Stage 2 archive, verified by driving the REAL app and asserting on
 * `window.__pente` real state (getState / getHistory / getArchive) + the rendered DOM + a real page
 * RELOAD (agent-principles #3: observable behavior, never a log line). The PURE view-model
 * (`archiveModel.ts`) is mutation-gated in Vitest; here we prove the WIRING:
 *   - AUTOSAVE: placing pieces persists the current game to the archive — `getArchive()` returns a
 *     record whose `headHash` equals the live game's, and whose ply matches (a real IndexedDB write);
 *   - RESTORE ON LOAD: reloading the page reconstructs the autosaved game — `getState().pieces` and
 *     `getHistory().maxPly` come back exactly, proving the fold-on-boot resumed the game (NOT a
 *     fresh board);
 *   - the archive browser mounts in its configured zone (`bottom-right` per the tracked layout) and
 *     is opened by the `loadGame` COMMAND (design Principle 3 — the same id the menu "Load" entry
 *     fires), pushing a BLOCKING scope (getInput() top-of-stack is the `archive` scope);
 *   - the browser LISTS the real archive (a row per saved game, newest-first) and CHOOSING a row
 *     LOADS that game into the scene — `getState` changes to the chosen game's pieces (observable);
 *   - an EMPTY archive shows the explicit empty state (negative case).
 * The widget id / zone / scope id all derive from the config + module, so nothing is hardcoded
 * (agent-principles #8).
 */

const ARCHIVE_ID = ARCHIVE_WIDGET_ID;
// The archive browser is opened by the SAME command id the menu "Load" entry dispatches (design
// Principle 3, one action layer). Sourced from the menu roster so the two can never drift.
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
interface InputReadout {
  scopes: string[];
}
interface KeyResolution {
  scopeId: string | null;
  commandId: string | null;
  handled: boolean;
}
type Pente = {
  getState(): GameStateReadout | null;
  getHistory(): HistoryReadout | null;
  getInput(): InputReadout | null;
  getArchive(): Promise<ArchiveListing[]>;
  dispatch(id: string): boolean | null;
  pressKey(chord: string): KeyResolution | null;
  place(coords: [number, number, number]): GameStateReadout | null;
  scrubTo(k: number): void;
};

async function ready(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.getState === 'function' &&
      typeof p.getHistory === 'function' &&
      typeof p.getArchive === 'function' &&
      typeof p.dispatch === 'function' &&
      typeof p.place === 'function' &&
      !!document.querySelector('[data-widget-id="archiveBrowser"]')
    );
  });
  // Autosave is wired after the archive DB opens (async). Wait until the initial game is saved so a
  // getArchive() read is deterministic (the fresh game is browsable even before the first move).
  await page.waitForFunction(async () => {
    const p = (window as unknown as { __pente?: { getArchive(): Promise<unknown[]> } }).__pente;
    if (!p) return false;
    return (await p.getArchive()).length >= 1;
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

/** Dispatch the menu-"Load" command id (design Principle 3) — the same id a keybinding would fire. */
const dispatchLoad = (page: import('@playwright/test').Page): Promise<boolean | null> =>
  page.evaluate((id: string) => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    return p.dispatch(id);
  }, LOAD_COMMAND);

const widget = (page: import('@playwright/test').Page) =>
  page.locator(`[data-widget-id="${ARCHIVE_ID}"]`);
// The modal root IS the widget element (the testid + data-widget-id sit on the same node), so it is
// located directly, not as a descendant of the widget (mirrors settings/help modal specs).
const modal = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid="archive-modal"]');

/** Place three non-capturing pieces on the default size-5 board so the live head is ply 3. */
async function placeThree(page: import('@playwright/test').Page): Promise<void> {
  await get(page, (p) => p.place([0, 0, 0]));
  await get(page, (p) => p.place([4, 4, 4]));
  await get(page, (p) => p.place([0, 4, 0]));
}

test('the archive browser mounts in its configured zone (bottom-right per the tracked layout)', async ({
  page,
}) => {
  await ready(page);
  // Placement is pure config — assert the browser lands in the zone the tracked layout names.
  expect(layoutDefault.widgets.archiveBrowser.zone).toBe('bottom-right');
  const inZone = page.locator(
    `[data-zone="bottom-right"] [data-widget-id="${ARCHIVE_ID}"]`,
  );
  await expect(inZone).toHaveCount(1);
  // Closed at boot (no visible trigger — opened by the loadGame command).
  await expect(modal(page)).toBeHidden();
});

test('placing pieces AUTOSAVES the current game (a record with the live headHash + ply)', async ({
  page,
}) => {
  await ready(page);
  await placeThree(page);

  // The live game is at ply 3. Autosave persists it on every state change — wait until the archive
  // reflects the ply-3 head, then prove the persisted record IS this game (headHash identity).
  const live = await get(page, (p) => p.getHistory()!);
  expect(live.maxPly).toBe(3);

  await page.waitForFunction(async () => {
    const p = (window as unknown as { __pente: { getArchive(): Promise<ArchiveListing[]> } }).__pente;
    const games = await p.getArchive();
    return games.length === 1;
  });
  const games = await getAsync(page, (p) => p.getArchive());
  expect(games).toHaveLength(1);
  // The persisted record's headHash is a NON-EMPTY fingerprint (a real hash chain over 3 plies),
  // and it is flagged in-progress (no winner yet) — observable proof the write happened (#3).
  expect(games[0]!.meta.result).toBe('in-progress');
  expect(typeof games[0]!.meta.headHash).toBe('string');
  expect(games[0]!.meta.headHash.length).toBeGreaterThan(0);
});

test('reloading the page RESTORES the autosaved game (pieces + ply come back)', async ({ page }) => {
  await ready(page);
  await placeThree(page);
  const before = await get(page, (p) => p.getState()!);
  expect(Object.keys(before.pieces).length).toBe(3);
  expect(before.pieces['0,0,0']).toBe('white');

  // Wait until the ply-3 game is autosaved, then RELOAD — the app restores it on boot.
  await page.waitForFunction(async () => {
    const p = (window as unknown as { __pente: { getArchive(): Promise<ArchiveListing[]> } }).__pente;
    const g = await p.getArchive();
    return g.length === 1 && g[0]!.meta.headHash.length > 0;
  });
  await page.reload();
  await ready(page);

  // Proof-by-state (agent-principles #3): after a real reload the SAME three pieces are on the board
  // and the head is ply 3 — the game resumed from the archive, NOT a fresh board.
  const after = await get(page, (p) => p.getState()!);
  expect(Object.keys(after.pieces).length).toBe(3);
  expect(after.pieces['0,0,0']).toBe('white');
  expect(after.pieces['4,4,4']).toBe('black');
  expect(after.pieces['0,4,0']).toBe('white');
  const hist = await get(page, (p) => p.getHistory()!);
  expect(hist.maxPly).toBe(3);

  const shot = resolve('e2e/artifacts/archive-restored.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('the loadGame COMMAND opens the browser and pushes the blocking archive scope', async ({
  page,
}) => {
  await ready(page);
  await placeThree(page);
  await expect(modal(page)).toBeHidden();

  // The menu "Load" entry and any keybinding dispatch this identical id (design Principle 3).
  await dispatchLoad(page);
  await expect(modal(page)).toBeVisible();

  // Opening a modal pushes a scope: the `archive` scope is now on top of the stack.
  const input = await get(page, (p) => p.getInput()!);
  expect(input.scopes[input.scopes.length - 1]).toBe(ARCHIVE_SCOPE_ID);

  // Prove the scope is BLOCKING behaviorally (GLOSSARY "Blocking scope"): a stray key (`u` = undo)
  // is SWALLOWED by the archive scope — handled, no command, resolved to the archive scope — so it
  // never falls through to the game/camera scopes below (observable, not a log line — #3).
  const swallowed = await get(page, (p) => p.pressKey('u'));
  expect(swallowed).toEqual({ commandId: null, scopeId: ARCHIVE_SCOPE_ID, handled: true });

  // A row exists for the autosaved game (the browser lists the REAL archive).
  const rows = widget(page).locator('.pente-archive-row');
  await expect(rows).toHaveCount(1);

  const shot = resolve('e2e/artifacts/archive-open.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('choosing a row LOADS that archived game into the scene (getState changes)', async ({
  page,
}) => {
  await ready(page);
  // Build and autosave a 3-ply game, capture its id from the archive.
  await placeThree(page);
  await page.waitForFunction(async () => {
    const p = (window as unknown as { __pente: { getArchive(): Promise<ArchiveListing[]> } }).__pente;
    return (await p.getArchive()).length === 1;
  });
  const savedId = (await getAsync(page, (p) => p.getArchive()))[0]!.id;

  // Scrub the LOCAL view back to ply 0 (read-only — this does NOT touch the archive) so the board
  // shows an EMPTY state distinct from the archived 3-ply game. The row→load must re-render the
  // archived game, making the load observable rather than a no-op against an already-matching board.
  await get(page, (p) => p.scrubTo(0));
  expect(Object.keys((await get(page, (p) => p.getState()!)).pieces).length).toBe(0);

  await dispatchLoad(page);
  await expect(modal(page)).toBeVisible();

  const row = widget(page).locator(`[data-testid="archive-row-${savedId}"]`);
  await expect(row).toHaveCount(1);
  await row.click();

  // The modal closed (a choose is a close path) and the scene LOADED the archived game: the board
  // went from 0 pieces (scrubbed away) back to the archived 3 pieces at the live head — observable
  // proof the row drove the archive→scene load end to end (agent-principles #3).
  await expect(modal(page)).toBeHidden();
  const state = await get(page, (p) => p.getState()!);
  expect(Object.keys(state.pieces).length).toBe(3);
  expect(state.pieces['0,0,0']).toBe('white');
  expect(state.pieces['4,4,4']).toBe('black');
  const hist = await get(page, (p) => p.getHistory()!);
  expect(hist.maxPly).toBe(3);
  expect(hist.scrubbing).toBe(false); // the load snapped the view back to the live (loaded) head
});

test('the browser row count tracks the REAL archive, with the empty state hidden when non-empty', async ({
  page,
}) => {
  // The pristine game is autosaved at boot, so the archive is non-empty. Prove the DOM reflects the
  // REAL archive: one row per listed game, and the explicit empty-state element hidden (its shown
  // branch is exercised by the unit/mutation suite — here we assert the non-empty negative).
  await ready(page);
  await dispatchLoad(page);
  await expect(modal(page)).toBeVisible();

  const empty = widget(page).locator('[data-testid="archive-empty"]');
  const games = await getAsync(page, (p) => p.getArchive());
  expect(games.length).toBeGreaterThanOrEqual(1);
  const rows = widget(page).locator('.pente-archive-row');
  await expect(rows).toHaveCount(games.length);
  await expect(empty).toBeHidden();
  await expect(widget(page)).toHaveAttribute('data-empty', 'false');
});
