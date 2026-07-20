import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import colorsDefault from '../src/config/defaults/colors.json' with { type: 'json' };
import { keyOf } from '../src/core/coords.ts';

/**
 * Task 4.9 win-line e2e: the winning-line mesh is an IO boundary, verified by driving the
 * real app and asserting on `window.__pente` — `place()` drives the live `Game` to a real
 * five-in-a-row, `getState()` returns the genuine rules state (winner + winningLine), and
 * `getWinLine()` reports the actual mesh drawn in the scene. We prove observable behavior
 * (agent-principles #3), not a log line:
 *   - before the win: no win-line mesh is drawn;
 *   - on a forced five-in-a-row: the partial-line mesh appears, spanning EXACTLY the run
 *     the rules core recorded (its nodes == `state.winningLine`, one segment per pair),
 *     coloured from the tracked `colors.winningLine` config (no volatile fact hardcoded —
 *     agent-principles #8);
 *   - undo removes the win → the mesh is hidden again.
 */

type Player = 'white' | 'black';
interface GameStateReadout {
  size: number;
  pieces: Record<string, Player>;
  turn: Player;
  captures: { white: number; black: number };
  winner: Player | null;
  winningLine?: string[];
}
interface WinLineReadout {
  visible: boolean;
  nodes: string[];
  segmentCount: number;
  color: number;
  opacity: number;
}

type Pente = {
  place(coords: [number, number, number]): GameStateReadout | null;
  getState(): GameStateReadout | null;
  getWinLine(): WinLineReadout | null;
  pressKey(chord: string): unknown;
};

/** The tracked winning-line colour as a hex int, to assert the mesh colour is config-derived. */
function winColorHex(): number {
  return parseInt(colorsDefault.winningLine.replace('#', ''), 16);
}

async function api(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.place === 'function' &&
      typeof p.getState === 'function' &&
      typeof p.getWinLine === 'function' &&
      !!document.querySelector('canvas')
    );
  });
}

/** Play a real five-in-a-row for white along +x on row (y=0,z=0); return the won state. */
async function forceWin(page: import('@playwright/test').Page): Promise<GameStateReadout> {
  return page.evaluate(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    // White completes (0..4, 0, 0). Black plays harmless spacers on the far (z=4) face,
    // never two adjacent blacks bracketing whites (so no capture disturbs the run).
    const blackSpacers: [number, number, number][] = [
      [0, 0, 4],
      [1, 0, 4],
      [2, 0, 4],
      [3, 0, 4],
    ];
    let last: GameStateReadout | null = null;
    for (let i = 0; i < 5; i++) {
      last = p.place([i, 0, 0]); // white
      if (i < 4) p.place(blackSpacers[i]!); // black spacer (turn stays aligned)
    }
    if (!last) throw new Error('forceWin: place() returned null');
    return last;
  });
}

test('forced five-in-a-row → the win-line mesh appears along exactly the winning run', async ({
  page,
}) => {
  await api(page);

  // Before any win: no win-line mesh is drawn.
  const before = await page.evaluate(
    () => (window as unknown as { __pente: Pente }).__pente.getWinLine()!,
  );
  console.log('WINLINE before:', JSON.stringify(before));
  expect(before.visible).toBe(false);
  expect(before.nodes).toEqual([]);
  expect(before.segmentCount).toBe(0);

  const state = await forceWin(page);
  console.log('STATE after win:', JSON.stringify(state));

  // The rules core actually recorded a five-in-a-row line win for white.
  expect(state.winner).toBe('white');
  expect(state.winningLine).toBeDefined();
  const run = state.winningLine!;
  expect(run.length).toBeGreaterThanOrEqual(5);
  // Sanity: the run is the +x row we built.
  expect(run).toContain(keyOf([0, 0, 0]));
  expect(run).toContain(keyOf([4, 0, 0]));

  const win = await page.evaluate(
    () => (window as unknown as { __pente: Pente }).__pente.getWinLine()!,
  );
  console.log('WINLINE after win:', JSON.stringify(win));

  // The mesh is drawn, spanning exactly the winning run (nodes == state.winningLine),
  // one segment per adjacent pair, coloured from the tracked config (agent-principles #8).
  expect(win.visible).toBe(true);
  expect(win.nodes).toEqual(run);
  expect(win.segmentCount).toBe(run.length - 1);
  expect(win.color).toBe(winColorHex());
  expect(win.opacity).toBeGreaterThan(0);

  const shotPath = resolve('e2e/artifacts/winline-drawn.png');
  mkdirSync(dirname(shotPath), { recursive: true });
  await page.screenshot({ path: shotPath });
  console.log('SCREENSHOT saved to:', shotPath);
});

test('undo after the winning move → the win-line mesh is hidden again', async ({ page }) => {
  await api(page);
  const state = await forceWin(page);
  expect(state.winner).toBe('white');

  const drawn = await page.evaluate(
    () => (window as unknown as { __pente: Pente }).__pente.getWinLine()!,
  );
  expect(drawn.visible).toBe(true);

  // Undo the winning placement (the default `undo` keybinding path): the state at the
  // prior ply has no winner → the win-line mesh must be removed (observable behavior).
  const after = await page.evaluate(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    p.pressKey('u');
    return { state: p.getState()!, win: p.getWinLine()! };
  });
  console.log('AFTER undo — state.winner:', after.state.winner, 'win:', JSON.stringify(after.win));

  expect(after.state.winner).toBeNull();
  expect(after.win.visible).toBe(false);
  expect(after.win.nodes).toEqual([]);
  expect(after.win.segmentCount).toBe(0);
});
