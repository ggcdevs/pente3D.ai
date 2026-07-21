import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import layoutDefault from '../src/config/defaults/layout.json' with { type: 'json' };

/**
 * Task 5.2 e2e — the score/status banner widget is the DOM/dispatch IO boundary, verified by
 * driving the REAL app and asserting on `window.__pente` real state + the rendered DOM (agent-
 * principles #3: observable behavior, never a log line). The PURE view-model (`bannerModel.ts`)
 * is mutation-gated in Vitest; here we prove the WIRING:
 *   - the banner mounts in its configured zone (`top-center` per the tracked layout) and shows
 *     the current player + both capture counts read back off the DOM;
 *   - a real Undo BUTTON CLICK (not a synthetic dispatch) fires the `undo` command → the live
 *     `Game` rewinds (the placed piece is gone in `getState`) AND the banner repaints (turn flips
 *     back) — proving button↔command↔state↔repaint end to end;
 *   - button enabled/disabled tracks REAL history reachability (`getBannerContext`): pristine →
 *     all disabled; after a place → Undo/Reset enabled, Redo disabled; after an undo → Redo on;
 *   - a real Reset button click clears the board.
 * The banner id + zone derive from `layout.json` so nothing is hardcoded (agent-principles #8).
 */

const BANNER_ID = 'statusBanner';

interface GameStateReadout {
  pieces: Record<string, 'white' | 'black'>;
  turn: 'white' | 'black';
  captures: { white: number; black: number };
  winner: 'white' | 'black' | null;
}
interface BannerContext {
  history: { canUndo: boolean; canRedo: boolean; canReset: boolean };
}
type Pente = {
  getState(): GameStateReadout | null;
  getBannerContext(): BannerContext | null;
  place(coords: [number, number, number]): GameStateReadout | null;
};

async function ready(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.getState === 'function' &&
      typeof p.getBannerContext === 'function' &&
      typeof p.place === 'function' &&
      !!document.querySelector('[data-widget-id="statusBanner"]')
    );
  });
}

const get = <T,>(page: import('@playwright/test').Page, fn: (p: Pente) => T): Promise<T> =>
  page.evaluate((body: string): unknown => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    const revived = eval(`(${body})`) as (api: Pente) => unknown;
    return revived(p);
  }, fn.toString()) as Promise<T>;

const banner = (page: import('@playwright/test').Page) =>
  page.locator(`[data-widget-id="${BANNER_ID}"]`);

test('the banner mounts in its configured zone and shows player + captures', async ({ page }) => {
  await ready(page);

  // Placement is pure config — assert the banner lands in the zone the tracked layout names.
  expect(layoutDefault.widgets.statusBanner.zone).toBe('top-center');
  const inZone = page.locator(
    `[data-zone="top-center"] [data-widget-id="${BANNER_ID}"]`,
  );
  await expect(inZone).toHaveCount(1);

  // A pristine game: white to move, no captures — read the model back off the rendered DOM.
  const state = await get(page, (p) => p.getState()!);
  expect(state.turn).toBe('white');
  expect(state.winner).toBeNull();

  const status = banner(page).locator('[data-testid="banner-status"]');
  await expect(status).toHaveAttribute('data-status', 'turn');
  await expect(status).toHaveAttribute('data-player', 'white');
  await expect(status).toHaveText('White to move');

  await expect(banner(page).locator('[data-testid="banner-captures-white"]')).toHaveText(
    'White: 0',
  );
  await expect(banner(page).locator('[data-testid="banner-captures-black"]')).toHaveText(
    'Black: 0',
  );

  // Issue #14: the two scores must be visually separated, never rendered as "White: 0Black: 0".
  // A dedicated separator element carries the model's middle-dot divider between the labels.
  await expect(banner(page).locator('[data-testid="banner-captures-sep"]')).toHaveText('·');
  // Prove the separation on the REAL rendered layout: the black label's box starts to the right of
  // where the white label's box ends (a horizontal gap exists), so the counts can never run together.
  const whiteBox = await banner(page)
    .locator('[data-testid="banner-captures-white"]')
    .boundingBox();
  const blackBox = await banner(page)
    .locator('[data-testid="banner-captures-black"]')
    .boundingBox();
  expect(whiteBox).not.toBeNull();
  expect(blackBox).not.toBeNull();
  expect(blackBox!.x).toBeGreaterThan(whiteBox!.x + whiteBox!.width);
  // And the concatenated captures-row text reads with the divider, not run-together.
  await expect(banner(page).locator('.pente-banner-captures')).toHaveText('White: 0·Black: 0');

  // The three controls are present, each carrying the command id it dispatches.
  for (const commandId of ['undo', 'redo', 'reset']) {
    await expect(
      banner(page).locator(`[data-testid="banner-button-${commandId}"]`),
    ).toHaveAttribute('data-command', commandId);
  }

  const shot = resolve('e2e/artifacts/banner-default.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('the banner reflects the live turn after a placement', async ({ page }) => {
  await ready(page);
  await expect(banner(page).locator('[data-testid="banner-status"]')).toHaveText('White to move');

  // Place a white piece — the turn passes to black and the banner must repaint to say so.
  const placed = await get(page, (p) => p.place([2, 2, 2]));
  expect(placed!.pieces['2,2,2']).toBe('white');
  expect(placed!.turn).toBe('black');

  const status = banner(page).locator('[data-testid="banner-status"]');
  await expect(status).toHaveAttribute('data-player', 'black');
  await expect(status).toHaveText('Black to move');
});

test('button enabled/disabled tracks real history reachability', async ({ page }) => {
  await ready(page);
  const undoBtn = banner(page).locator('[data-testid="banner-button-undo"]');
  const redoBtn = banner(page).locator('[data-testid="banner-button-redo"]');
  const resetBtn = banner(page).locator('[data-testid="banner-button-reset"]');

  // Pristine: nothing to undo/redo/reset — every control disabled, matching getBannerContext.
  const ctx0 = await get(page, (p) => p.getBannerContext()!);
  expect(ctx0.history).toEqual({ canUndo: false, canRedo: false, canReset: false });
  await expect(undoBtn).toBeDisabled();
  await expect(redoBtn).toBeDisabled();
  await expect(resetBtn).toBeDisabled();

  // After a placement: undo + reset become available; redo is still not (no undone tail).
  await get(page, (p) => p.place([2, 2, 2]));
  const ctx1 = await get(page, (p) => p.getBannerContext()!);
  expect(ctx1.history).toEqual({ canUndo: true, canRedo: false, canReset: true });
  await expect(undoBtn).toBeEnabled();
  await expect(redoBtn).toBeDisabled();
  await expect(resetBtn).toBeEnabled();

  // After a real Undo button click: redo becomes available; undo goes back off (at ply 0).
  await undoBtn.click();
  const ctx2 = await get(page, (p) => p.getBannerContext()!);
  expect(ctx2.history).toEqual({ canUndo: false, canRedo: true, canReset: true });
  await expect(undoBtn).toBeDisabled();
  await expect(redoBtn).toBeEnabled();
});

test('a real Undo button click rewinds the live game and repaints the banner', async ({
  page,
}) => {
  await ready(page);

  // Place, so there is something to undo, and the turn is black.
  const placed = await get(page, (p) => p.place([1, 1, 1]));
  expect(placed!.pieces['1,1,1']).toBe('white');
  expect(placed!.turn).toBe('black');
  await expect(banner(page).locator('[data-testid="banner-status"]')).toHaveText('Black to move');

  // CLICK the real Undo button (not a synthetic dispatch). The click must fire the `undo`
  // command through the same registry a keybinding uses (design Principle 3).
  await banner(page).locator('[data-testid="banner-button-undo"]').click();

  // Proof-by-state (agent-principles #3): the placed piece is gone and it is white's turn again.
  const state = await get(page, (p) => p.getState()!);
  expect(state.pieces['1,1,1']).toBeUndefined();
  expect(state.turn).toBe('white');
  // And the banner repainted to reflect the rewound state.
  await expect(banner(page).locator('[data-testid="banner-status"]')).toHaveText('White to move');
});

test('a real Reset button click clears the board', async ({ page }) => {
  await ready(page);

  // Build up a couple of pieces.
  await get(page, (p) => p.place([0, 0, 0]));
  await get(page, (p) => p.place([1, 1, 1]));
  const mid = await get(page, (p) => p.getState()!);
  expect(Object.keys(mid.pieces).length).toBe(2);

  // CLICK Reset — the board returns to pristine (no pieces, white to move).
  await banner(page).locator('[data-testid="banner-button-reset"]').click();

  const after = await get(page, (p) => p.getState()!);
  expect(after.pieces).toEqual({});
  expect(after.turn).toBe('white');
  expect(after.winner).toBeNull();
  // Reset now has nothing to clear → the button disables itself again (reachability repaint).
  await expect(banner(page).locator('[data-testid="banner-button-reset"]')).toBeDisabled();
  await expect(banner(page).locator('[data-testid="banner-status"]')).toHaveText('White to move');
});
