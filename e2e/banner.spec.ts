import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import layoutDefault from '../src/config/defaults/layout.json' with { type: 'json' };

/**
 * Task 5.2 / issue #44 e2e — the score/status banner widget is the DOM IO boundary, verified by
 * driving the REAL app and asserting on `window.__pente` real state + the rendered DOM
 * (agent-principles #3: observable behavior, never a log line). The PURE view-model
 * (`bannerModel.ts`) is mutation-gated in Vitest; here we prove the WIRING:
 *   - the banner mounts in its configured zone (read off `layout.json`, agent-principles #8) and
 *     shows both capture counts + the current turn read back off the DOM;
 *   - the banner repaints the live turn after a placement.
 *
 * Issue #44 (live iteration) restructured the banner into a COMPACT PRESENCE HUD: there is no more
 * "X to move" / "White: N" text. The turn is shown STRUCTURALLY — the mover's per-color row is
 * `.pente-hud-row--active` and the other `.pente-hud-row--dim`; capture counts are RAW numbers in
 * `.pente-hud-count`. So the turn assertions read those classes off the live DOM, not a text string.
 * The Undo/Redo/Reset controls left the banner for the history slider (`history.spec.ts`).
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

/** The per-color HUD row (`.pente-hud-row--{color}`), scoped to the banner. */
const row = (page: import('@playwright/test').Page, color: 'white' | 'black') =>
  banner(page).locator(`.pente-hud-row--${color}`);

test('the banner mounts in its configured zone and shows player + captures', async ({ page }) => {
  await ready(page);

  // Placement is pure config — assert the banner lands in the zone the tracked layout names (#8).
  const zone = layoutDefault.widgets.statusBanner.zone;
  const inZone = page.locator(`[data-zone="${zone}"] [data-widget-id="${BANNER_ID}"]`);
  await expect(inZone).toHaveCount(1);

  // A pristine game: white to move, no captures — read the model back off the rendered DOM.
  const state = await get(page, (p) => p.getState()!);
  expect(state.turn).toBe('white');
  expect(state.winner).toBeNull();

  const status = banner(page).locator('[data-testid="banner-status"]');
  await expect(status).toHaveAttribute('data-status', 'turn');
  await expect(status).toHaveAttribute('data-player', 'white');

  // Issue #44: the turn is shown STRUCTURALLY — white to move → white row active, black row dim.
  // (No "X to move" text any more.) Assert the exact class toggles off the live DOM.
  await expect(row(page, 'white')).toHaveClass(/pente-hud-row--active/);
  await expect(row(page, 'white')).not.toHaveClass(/pente-hud-row--dim/);
  await expect(row(page, 'black')).toHaveClass(/pente-hud-row--dim/);
  await expect(row(page, 'black')).not.toHaveClass(/pente-hud-row--active/);

  // Capture counts are RAW numbers now (the row's color label supplies the name). Pristine → "0"/"0".
  await expect(banner(page).locator('[data-testid="banner-captures-white"]')).toHaveText('0');
  await expect(banner(page).locator('[data-testid="banner-captures-black"]')).toHaveText('0');

  // Off-turn's not fired yet: the observable flash counter starts at 0 (Task 6.2 cue, unchanged).
  await expect(status).toHaveAttribute('data-offturn-flashes', '0');

  // No winner → neither row shows the "wins" badge (they stay hidden).
  await expect(banner(page).locator('.pente-hud-row--white .pente-hud-wins')).toBeHidden();
  await expect(banner(page).locator('.pente-hud-row--black .pente-hud-wins')).toBeHidden();

  // Offline (no seat held): presence dots + "(You)" are NOT rendered (they only appear when
  // networked). Prove both color rows keep them hidden.
  for (const color of ['white', 'black'] as const) {
    await expect(row(page, color).locator('.pente-hud-dot')).toBeHidden();
    await expect(row(page, color).locator(`[data-testid="banner-you-${color}"]`)).toBeHidden();
  }

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
  // White to move → white row active, black dim (issue #44 structural turn cue).
  await expect(row(page, 'white')).toHaveClass(/pente-hud-row--active/);
  await expect(row(page, 'black')).toHaveClass(/pente-hud-row--dim/);

  // Place a white piece — the turn passes to black and the banner must repaint to say so.
  const placed = await get(page, (p) => p.place([2, 2, 2]));
  expect(placed!.pieces['2,2,2']).toBe('white');
  expect(placed!.turn).toBe('black');

  const status = banner(page).locator('[data-testid="banner-status"]');
  await expect(status).toHaveAttribute('data-player', 'black');
  // The active/dim toggle FLIPPED: black is now to move (active), white dimmed.
  await expect(row(page, 'black')).toHaveClass(/pente-hud-row--active/);
  await expect(row(page, 'black')).not.toHaveClass(/pente-hud-row--dim/);
  await expect(row(page, 'white')).toHaveClass(/pente-hud-row--dim/);
  await expect(row(page, 'white')).not.toHaveClass(/pente-hud-row--active/);
});

test('a win marks the winner row active and shows its "wins" badge (issue #44)', async ({
  page,
}) => {
  await ready(page);

  // Neither wins badge shows before there is a winner.
  await expect(banner(page).locator('.pente-hud-row--white .pente-hud-wins')).toBeHidden();
  await expect(banner(page).locator('.pente-hud-row--black .pente-hud-wins')).toBeHidden();

  // Play a REAL five-in-a-row for white along +x (black plays harmless far-face spacers so no
  // capture disturbs the run) — the rules core records a genuine line win (observable state, #3).
  const won = await get(page, (p) => {
    const blackSpacers: [number, number, number][] = [
      [0, 0, 4],
      [1, 0, 4],
      [2, 0, 4],
      [3, 0, 4],
    ];
    let last: GameStateReadout | null = null;
    for (let i = 0; i < 5; i++) {
      last = p.place([i, 0, 0]); // white
      if (i < 4) p.place(blackSpacers[i]!); // black spacer
    }
    return last!;
  });
  expect(won.winner).toBe('white');

  const status = banner(page).locator('[data-testid="banner-status"]');
  await expect(status).toHaveAttribute('data-status', 'winner');
  await expect(status).toHaveAttribute('data-player', 'white');

  // Issue #44 winner cue: the WINNER's row is active and shows the "wins" badge; the other row is
  // dimmed with NO badge. Assert both the class toggles and the badge visibility off the live DOM.
  await expect(row(page, 'white')).toHaveClass(/pente-hud-row--active/);
  await expect(banner(page).locator('.pente-hud-row--white .pente-hud-wins')).toBeVisible();
  await expect(banner(page).locator('.pente-hud-row--white .pente-hud-wins')).toHaveText('wins');
  await expect(row(page, 'black')).toHaveClass(/pente-hud-row--dim/);
  await expect(banner(page).locator('.pente-hud-row--black .pente-hud-wins')).toBeHidden();
});
