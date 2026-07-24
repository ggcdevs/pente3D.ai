import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import layoutDefault from '../src/config/defaults/layout.json' with { type: 'json' };

/**
 * Task 5.6 e2e — the history slider is the DOM/scrub IO boundary over the scene's READ-ONLY local
 * history seam, verified by driving the REAL app and asserting on `window.__pente` real state
 * (getState / getHistory) + the rendered DOM + a real range DRAG (agent-principles #3: observable
 * behavior, never a log line). The PURE view-model (`sliderModel.ts`) is mutation-gated in Vitest;
 * here we prove the WIRING:
 *   - the slider mounts in its configured zone (`bottom-center` per the tracked layout);
 *   - after placing N pieces, dragging the range BACK renders an EARLIER derived state — the
 *     rendered piece count (`getState().pieces`) DROPS to exactly the scrubbed ply, AND the
 *     canonical history is intact (`getHistory().maxPly` unchanged) — proving the scrub is
 *     viewer-local, NOT an undo (GLOSSARY "History slider": distinct from undo, syncs nothing);
 *   - dragging back to the END snaps to live (`atLive`, full piece count restored);
 *   - a real DRAG of the range thumb (pointer, not just a programmatic fill) changes the count;
 *   - placing a piece WHILE scrubbed back snaps the view to live (a real move returns to live);
 *   - a pristine game disables the slider (nothing to review).
 *
 * Issue #44 — the Undo / Redo / Reset controls RELOCATED here, directly UNDER the slider (out of the
 * banner). Their DOM/dispatch wiring is now proven here: the controls mount under the slider, their
 * enabled/disabled tracks REAL history reachability (`getBannerContext`), a real Undo BUTTON CLICK
 * rewinds the live game, and a real Reset button click clears the board.
 * The widget id + zone derive from `layout.json` so nothing is hardcoded (agent-principles #8).
 */

const HISTORY_ID = 'historySlider';

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
interface BannerContext {
  history: { canUndo: boolean; canRedo: boolean; canReset: boolean };
}
type Pente = {
  getState(): GameStateReadout | null;
  getHistory(): HistoryReadout | null;
  getBannerContext(): BannerContext | null;
  scrubTo(k: number): void;
  place(coords: [number, number, number]): GameStateReadout | null;
};

async function ready(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.getState === 'function' &&
      typeof p.getHistory === 'function' &&
      typeof p.getBannerContext === 'function' &&
      typeof p.scrubTo === 'function' &&
      typeof p.place === 'function' &&
      !!document.querySelector('[data-widget-id="historySlider"]')
    );
  });
}

const get = <T,>(page: import('@playwright/test').Page, fn: (p: Pente) => T): Promise<T> =>
  page.evaluate((body: string): unknown => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    const revived = eval(`(${body})`) as (api: Pente) => unknown;
    return revived(p);
  }, fn.toString()) as Promise<T>;

const widget = (page: import('@playwright/test').Page) =>
  page.locator(`[data-widget-id="${HISTORY_ID}"]`);
const range = (page: import('@playwright/test').Page) =>
  widget(page).locator('[data-testid="history-range"]');
const historyBtn = (page: import('@playwright/test').Page, commandId: string) =>
  widget(page).locator(`[data-testid="history-button-${commandId}"]`);

/** Place four non-capturing pieces on a size-5 board so the live head is ply 4 (distinct nodes). */
async function placeFour(page: import('@playwright/test').Page): Promise<void> {
  await get(page, (p) => p.place([0, 0, 0]));
  await get(page, (p) => p.place([4, 4, 4]));
  await get(page, (p) => p.place([0, 4, 0]));
  await get(page, (p) => p.place([4, 0, 4]));
}

test('the slider mounts in its configured zone and starts live + disabled when pristine', async ({
  page,
}) => {
  await ready(page);

  // Placement is pure config — assert the slider lands in the zone the tracked layout names.
  expect(layoutDefault.widgets.historySlider.zone).toBe('bottom-center');
  const inZone = page.locator(
    `[data-zone="bottom-center"] [data-widget-id="${HISTORY_ID}"]`,
  );
  await expect(inZone).toHaveCount(1);

  // A pristine game: no plies to review → the range is disabled and the label reads Live.
  const hist = await get(page, (p) => p.getHistory()!);
  expect(hist).toEqual({ maxPly: 0, viewedPly: 0, scrubbing: false });
  await expect(range(page)).toBeDisabled();
  await expect(widget(page)).toHaveAttribute('data-at-live', 'true');
  await expect(widget(page).locator('[data-testid="history-label"]')).toHaveText('Live');

  const shot = resolve('e2e/artifacts/history-default.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('the range max tracks the live head as pieces are placed', async ({ page }) => {
  await ready(page);
  await placeFour(page);

  // Four plies → the live head is 4; the range spans 0..4 and sits at the head (Live).
  const hist = await get(page, (p) => p.getHistory()!);
  expect(hist.maxPly).toBe(4);
  expect(hist.viewedPly).toBe(4);
  expect(hist.scrubbing).toBe(false);
  await expect(range(page)).toHaveAttribute('max', '4');
  await expect(range(page)).toBeEnabled();
  await expect(widget(page)).toHaveAttribute('data-at-live', 'true');
  await expect(widget(page).locator('[data-testid="history-label"]')).toHaveText('Live');
});

test('scrubbing back renders an earlier state (fewer pieces) while the history stays intact', async ({
  page,
}) => {
  await ready(page);
  await placeFour(page);

  // Live head: all four pieces rendered.
  const live = await get(page, (p) => p.getState()!);
  expect(Object.keys(live.pieces).length).toBe(4);

  // Scrub the LOCAL view back to ply 2 (programmatic drive of the same seam the drag uses).
  await get(page, (p) => p.scrubTo(2));

  // Proof-by-state (agent-principles #3): the RENDERED state now has exactly 2 pieces — the later
  // two vanished for the local viewer — WHILE the canonical head is still 4 (history intact, this
  // is NOT an undo). The first two placed nodes remain; the last two are gone.
  const scrubbed = await get(page, (p) => p.getState()!);
  expect(Object.keys(scrubbed.pieces).length).toBe(2);
  expect(scrubbed.pieces['0,0,0']).toBe('white');
  expect(scrubbed.pieces['4,4,4']).toBe('black');
  expect(scrubbed.pieces['0,4,0']).toBeUndefined();
  expect(scrubbed.pieces['4,0,4']).toBeUndefined();

  const hist = await get(page, (p) => p.getHistory()!);
  expect(hist.maxPly).toBe(4); // head UNTOUCHED — the game did not rewind
  expect(hist.viewedPly).toBe(2);
  expect(hist.scrubbing).toBe(true);

  // The widget repainted to the reviewed position.
  await expect(widget(page)).toHaveAttribute('data-at-live', 'false');
  await expect(widget(page)).toHaveAttribute('data-value', '2');
  await expect(widget(page).locator('[data-testid="history-label"]')).toHaveText('Move 2 / 4');

  const shot = resolve('e2e/artifacts/history-scrubbed.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('a real range DRAG changes the rendered piece count via getState', async ({ page }) => {
  await ready(page);
  await placeFour(page);

  // Drag the real range thumb toward the start. `fill` on a range input dispatches a genuine
  // `input` event (the same event a mouse drag fires), driving the widget's scrub handler.
  await range(page).fill('1');

  // The rendered state dropped to exactly ply 1 — one piece — proving the DOM control drove the
  // scene's scrub seam end to end (observable behavior, not a log line).
  const afterDrag = await get(page, (p) => p.getState()!);
  expect(Object.keys(afterDrag.pieces).length).toBe(1);
  expect(afterDrag.pieces['0,0,0']).toBe('white');
  const hist = await get(page, (p) => p.getHistory()!);
  expect(hist.viewedPly).toBe(1);
  expect(hist.scrubbing).toBe(true);
});

test('dragging back to the end snaps to live and restores the full piece count', async ({
  page,
}) => {
  await ready(page);
  await placeFour(page);

  // Scrub back, then all the way forward to the head.
  await range(page).fill('1');
  expect(Object.keys((await get(page, (p) => p.getState()!)).pieces).length).toBe(1);

  await range(page).fill('4');

  // At the head: live again, all four pieces back, not scrubbing.
  const hist = await get(page, (p) => p.getHistory()!);
  expect(hist).toEqual({ maxPly: 4, viewedPly: 4, scrubbing: false });
  const restored = await get(page, (p) => p.getState()!);
  expect(Object.keys(restored.pieces).length).toBe(4);
  await expect(widget(page)).toHaveAttribute('data-at-live', 'true');
  await expect(widget(page).locator('[data-testid="history-label"]')).toHaveText('Live');
});

test('placing a piece while scrubbed back snaps the view to live', async ({ page }) => {
  await ready(page);
  await placeFour(page);

  // Scrub back to ply 1 (one piece rendered), then place a real move.
  await get(page, (p) => p.scrubTo(1));
  expect((await get(page, (p) => p.getHistory()!)).scrubbing).toBe(true);

  // A placement is a live game action — it snaps the view back to live and extends the head.
  await get(page, (p) => p.place([2, 2, 2]));

  const hist = await get(page, (p) => p.getHistory()!);
  expect(hist.scrubbing).toBe(false);
  expect(hist.maxPly).toBe(5); // the four originals + the new one
  expect(hist.viewedPly).toBe(5);
  // The rendered state is the live head: all five pieces present, including the just-placed one.
  const state = await get(page, (p) => p.getState()!);
  expect(Object.keys(state.pieces).length).toBe(5);
  expect(state.pieces['2,2,2']).toBe('white');
  await expect(widget(page)).toHaveAttribute('data-at-live', 'true');
});

test('the relocated Undo/Redo/Reset controls mount UNDER the slider, each with its command id', async ({
  page,
}) => {
  await ready(page);

  // Issue #44: the three history controls now live in the history-slider widget (out of the banner),
  // rendered under the range. Each carries the command id it dispatches (design Principle 3).
  for (const commandId of ['undo', 'redo', 'reset']) {
    await expect(historyBtn(page, commandId)).toHaveAttribute('data-command', commandId);
  }
  // They are gone from the banner (proven present-in-slider here, absent-in-banner in banner.spec).
  await expect(page.locator('[data-widget-id="statusBanner"] [data-testid^="history-button-"]')).toHaveCount(
    0,
  );
});

test('control enabled/disabled tracks real history reachability (relocated under the slider)', async ({
  page,
}) => {
  await ready(page);
  const undoBtn = historyBtn(page, 'undo');
  const redoBtn = historyBtn(page, 'redo');
  const resetBtn = historyBtn(page, 'reset');

  // Pristine: nothing to undo/redo/reset — every control disabled, matching getBannerContext (the
  // scene-computed reachability the container passes through to the slider on every update, #44).
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

test('a real Undo control click rewinds the live game (relocated under the slider)', async ({
  page,
}) => {
  await ready(page);

  // Place, so there is something to undo, and the turn is black.
  const placed = await get(page, (p) => p.place([1, 1, 1]));
  expect(placed!.pieces['1,1,1']).toBe('white');
  expect(placed!.turn).toBe('black');

  // CLICK the real Undo control (not a synthetic dispatch). The click must fire the `undo`
  // command through the same registry a keybinding uses (design Principle 3).
  await historyBtn(page, 'undo').click();

  // Proof-by-state (agent-principles #3): the placed piece is gone and it is white's turn again.
  const state = await get(page, (p) => p.getState()!);
  expect(state.pieces['1,1,1']).toBeUndefined();
  expect(state.turn).toBe('white');
});

test('a real Reset control click clears the board (relocated under the slider)', async ({
  page,
}) => {
  await ready(page);

  // Build up a couple of pieces.
  await get(page, (p) => p.place([0, 0, 0]));
  await get(page, (p) => p.place([1, 1, 1]));
  const mid = await get(page, (p) => p.getState()!);
  expect(Object.keys(mid.pieces).length).toBe(2);

  // CLICK Reset — the board returns to pristine (no pieces, white to move).
  await historyBtn(page, 'reset').click();

  const after = await get(page, (p) => p.getState()!);
  expect(after.pieces).toEqual({});
  expect(after.turn).toBe('white');
  expect(after.winner).toBeNull();
  // Reset now has nothing to clear → the button disables itself again (reachability repaint).
  await expect(historyBtn(page, 'reset')).toBeDisabled();
});
