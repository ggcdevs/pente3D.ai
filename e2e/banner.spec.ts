import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import layoutDefault from '../src/config/defaults/layout.json' with { type: 'json' };

/**
 * Task 5.2 e2e — the score/status banner widget is the DOM IO boundary, verified by driving the
 * REAL app and asserting on `window.__pente` real state + the rendered DOM (agent-principles #3:
 * observable behavior, never a log line). The PURE view-model (`bannerModel.ts`) is mutation-gated
 * in Vitest; here we prove the WIRING:
 *   - the banner mounts in its configured zone (`top-center` per the tracked layout) and shows
 *     the current player + both capture counts read back off the DOM;
 *   - the banner repaints the live turn after a placement.
 * Issue #44 relocated the Undo/Redo/Reset controls OUT of the banner and UNDER the history slider —
 * the button-click / enablement wiring is now proven in `history.spec.ts`. The banner id + zone
 * derive from `layout.json` so nothing is hardcoded (agent-principles #8).
 */

const BANNER_ID = 'statusBanner';

interface GameStateReadout {
  pieces: Record<string, 'white' | 'black'>;
  turn: 'white' | 'black';
  captures: { white: number; black: number };
  winner: 'white' | 'black' | null;
}
type Pente = {
  getState(): GameStateReadout | null;
  place(coords: [number, number, number]): GameStateReadout | null;
};

async function ready(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.getState === 'function' &&
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

  // Issue #44: the Undo/Redo/Reset controls are NO LONGER in the banner — they moved under the
  // history slider. The banner is now a pure score/status (+ merged net) readout.
  for (const commandId of ['undo', 'redo', 'reset']) {
    await expect(
      banner(page).locator(`[data-testid="banner-button-${commandId}"]`),
    ).toHaveCount(0);
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
