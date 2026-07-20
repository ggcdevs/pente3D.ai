import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import lineVisibilityDefault from '../src/config/defaults/lineVisibility.json' with { type: 'json' };
import blendingDefault from '../src/config/defaults/blending.json' with { type: 'json' };
import { generateAllLines } from '../src/core/lines.ts';

/**
 * Task 4.4 instanced-gridlines e2e: the three category InstancedMeshes are an IO
 * boundary, verified by driving the real app and asserting on `window.__pente`
 * `getVisibleLines` — the per-category visibility + blending must come FROM config, and
 * the instance/line counts must match what the PURE core (`generateAllLines`) yields for
 * the rendered board (observable behavior, not a log line; agent-principles #2/#3). The
 * default config JSON + the core generator are imported here so every expected value has
 * a single source of truth — no hardcoded volatile facts (agent-principles #8).
 */

/** The board size the scene renders (mirrors scene.ts BOARD_SIZE). */
const BOARD_SIZE = 5;

type BlendMode = 'additive' | 'normal';
interface LineGroupReadout {
  category: 'orthogonal' | 'face' | 'space';
  visible: boolean;
  blending: BlendMode;
  segmentCount: number;
  lineCount: number;
}

/** Expected per-category line + segment counts, derived from the pure core generator. */
function expectedCounts(size: number): Record<string, { lines: number; segments: number }> {
  const all = generateAllLines(size);
  const out: Record<string, { lines: number; segments: number }> = {
    orthogonal: { lines: 0, segments: 0 },
    face: { lines: 0, segments: 0 },
    space: { lines: 0, segments: 0 },
  };
  for (const line of all) {
    out[line.category]!.lines += 1;
    out[line.category]!.segments += line.nodes.length - 1;
  }
  return out;
}

async function readLines(
  page: import('@playwright/test').Page,
): Promise<LineGroupReadout[]> {
  return page.evaluate(() => {
    const api = (window as unknown as { __pente?: { getVisibleLines(): LineGroupReadout[] | null } })
      .__pente;
    if (!api) throw new Error('window.__pente not installed');
    const l = api.getVisibleLines();
    if (!l) throw new Error('getVisibleLines() returned null');
    return l;
  });
}

test('gridlines: per-category visibility + blending + counts come from config/core', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => {
    const api = (window as unknown as { __pente?: { getVisibleLines?: unknown } }).__pente;
    return !!api && typeof api.getVisibleLines === 'function' && !!document.querySelector('canvas');
  });

  const groups = await readLines(page);
  console.log('VISIBLE LINES readout:', JSON.stringify(groups));

  // Exactly the three categories, in canonical order.
  expect(groups.map((g) => g.category)).toEqual(['orthogonal', 'face', 'space']);

  const byCat = Object.fromEntries(groups.map((g) => [g.category, g]));
  const counts = expectedCounts(BOARD_SIZE);

  // Visibility must match the tracked lineVisibility default (orthogonal on, diagonals off).
  expect(byCat.orthogonal!.visible).toBe(lineVisibilityDefault.orthogonal);
  expect(byCat.face!.visible).toBe(lineVisibilityDefault.faceDiagonal);
  expect(byCat.space!.visible).toBe(lineVisibilityDefault.spaceDiagonal);

  // Blending must match the tracked blending default (config key → core category).
  expect(byCat.orthogonal!.blending).toBe(blendingDefault.orthogonal);
  expect(byCat.face!.blending).toBe(blendingDefault.faceDiagonal);
  expect(byCat.space!.blending).toBe(blendingDefault.spaceDiagonal);

  // Line + segment counts must match the pure core generator for the rendered board.
  for (const cat of ['orthogonal', 'face', 'space'] as const) {
    expect(byCat[cat]!.lineCount).toBe(counts[cat]!.lines);
    expect(byCat[cat]!.segmentCount).toBe(counts[cat]!.segments);
  }

  // Sanity: the diagonal groups still carry their full instance buffers even though they
  // are hidden by default — visibility is a flag, not a filter (proves the group was
  // built, not skipped).
  expect(byCat.face!.segmentCount).toBeGreaterThan(0);
  expect(byCat.space!.segmentCount).toBeGreaterThan(0);

  const shotPath = resolve('e2e/artifacts/gridlines.png');
  mkdirSync(dirname(shotPath), { recursive: true });
  await page.screenshot({ path: shotPath });
  console.log('SCREENSHOT saved to:', shotPath);
});
