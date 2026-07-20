import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import colorsDefault from '../src/config/defaults/colors.json' with { type: 'json' };
import { keyOf } from '../src/core/coords.ts';

/**
 * Task 4.3 node-markers e2e — the InstancedMesh marker layer is an IO boundary, verified by
 * driving the REAL app and asserting on `window.__pente` (`getMarkers`), not a log line
 * (agent-principles #3). The pure index/occupancy logic is mutation-gated in Vitest; here we
 * prove the wiring end-to-end on the real canvas:
 *   - the marker mesh renders N³ instances, all visible on an empty board (screenshot);
 *   - `getMarkers()` counts + per-node detail match the empty board;
 *   - placing a piece on a node HIDES exactly that node's marker (visibleCount drops by 1);
 *   - hovering an empty node GLOWS its marker (highlightedCount + per-node `highlighted`),
 *     and hovering empty space clears it;
 *   - nothing regressed: `pickAt`/placement still resolve empty nodes.
 * Nothing volatile is hardcoded except the board size the scene renders (agent-principles #8);
 * the marker count is derived from it, and the highlight colour SSOT is the tracked config.
 */

/** The board size the scene renders (mirrors scene.ts BOARD_SIZE). */
const BOARD_SIZE = 5;

type Player = 'white' | 'black';
interface GameStateReadout {
  size: number;
  pieces: Record<string, Player>;
  turn: Player;
}
interface MarkerNodeReadout {
  node: string;
  instanceId: number;
  visible: boolean;
  highlighted: boolean;
}
interface MarkersReadout {
  count: number;
  visibleCount: number;
  highlightedCount: number;
  nodes: MarkerNodeReadout[];
}
type RaycastHit =
  | { kind: 'empty-node'; node: string }
  | { kind: 'placed-sphere'; node: string }
  | { kind: 'line'; lineId: string };
interface HoverTarget {
  nodes: string[];
  lines: string[];
  pieces: string[];
}

type Pente = {
  place(coords: [number, number, number]): GameStateReadout | null;
  getState(): GameStateReadout | null;
  getMarkers(query?: readonly string[]): MarkersReadout | null;
  pickAt(x: number, y: number): RaycastHit | null;
  hoverAt(x: number, y: number): HoverTarget | null;
};

async function ready(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.getMarkers === 'function' &&
      typeof p.place === 'function' &&
      typeof p.hoverAt === 'function' &&
      !!document.querySelector('canvas')
    );
  });
}

/** Read the marker layer for a set of node keys (keys passed in — no test-side closure). */
function markers(
  page: import('@playwright/test').Page,
  query: string[],
): Promise<MarkersReadout> {
  return page.evaluate((q) => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    return p.getMarkers(q)!;
  }, query);
}

test('markers render N³ instances, all visible on an empty board', async ({ page }) => {
  await ready(page);

  const center = keyOf([2, 2, 2]);
  const corner = keyOf([0, 0, 0]);
  const m = await markers(page, [center, corner]);
  // One instance per board node; every marker drawn on an empty board; none highlighted.
  expect(m.count).toBe(BOARD_SIZE ** 3);
  expect(m.visibleCount).toBe(BOARD_SIZE ** 3);
  expect(m.highlightedCount).toBe(0);
  // Per-node detail: real instance ids (not -1), visible, un-highlighted.
  const centerRow = m.nodes.find((n) => n.node === center)!;
  const cornerRow = m.nodes.find((n) => n.node === corner)!;
  expect(centerRow.instanceId).toBeGreaterThanOrEqual(0);
  expect(cornerRow.instanceId).toBeGreaterThanOrEqual(0);
  expect(centerRow.instanceId).not.toBe(cornerRow.instanceId);
  expect(centerRow.visible).toBe(true);
  expect(cornerRow.visible).toBe(true);
  // A node that is not a board marker reports the -1 sentinel (no phantom instance).
  const off = await markers(page, [keyOf([9, 9, 9])]);
  expect(off.nodes[0]!.instanceId).toBe(-1);
  expect(off.nodes[0]!.visible).toBe(false);

  const shot = resolve('e2e/artifacts/markers-empty.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test("placing a piece HIDES exactly that node's marker", async ({ page }) => {
  await ready(page);

  const target = keyOf([2, 2, 2]);
  const neighbour = keyOf([2, 2, 3]);

  const before = await markers(page, [target, neighbour]);
  expect(before.nodes.find((n) => n.node === target)!.visible).toBe(true);

  // Place white at the center node. The rules core records it (observable).
  const state = await page.evaluate(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    return p.place([2, 2, 2]);
  });
  expect(state!.pieces[target]).toBe('white');

  const after = await markers(page, [target, neighbour]);
  // Exactly the occupied node's marker is now hidden; its neighbour stays visible.
  expect(after.nodes.find((n) => n.node === target)!.visible).toBe(false);
  expect(after.nodes.find((n) => n.node === neighbour)!.visible).toBe(true);
  // Visible count dropped by exactly one (one node became occupied).
  expect(after.visibleCount).toBe(before.visibleCount - 1);
  expect(after.count).toBe(before.count); // instance slots are stable — ids never renumber
  expect(after.nodes.find((n) => n.node === target)!.instanceId).toBe(
    before.nodes.find((n) => n.node === target)!.instanceId,
  );

  const shot = resolve('e2e/artifacts/markers-occupied.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('hovering an empty node GLOWS its marker; empty space clears it', async ({ page }) => {
  await ready(page);

  const center = keyOf([2, 2, 2]);
  // The orbit target is the board origin = center node; NDC (0,0) rays through it.
  const hit = await page.evaluate(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    return p.pickAt(0, 0);
  });
  expect(hit!.kind).toBe('empty-node');
  expect((hit as { node: string }).node).toBe(center);

  // Hover it: the hover target names the center node, and its marker instance glows.
  const target = await page.evaluate(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    return p.hoverAt(0, 0);
  });
  expect(target!.nodes).toContain(center);

  const glowed = await markers(page, [center]);
  expect(glowed.nodes[0]!.highlighted).toBe(true);
  // Exactly the hovered empty node's marker is highlighted (a single empty-node hover).
  expect(glowed.highlightedCount).toBe(1);

  // Hover empty space (a far NDC corner off the board) → nothing highlighted, marker restored.
  const cleared = await page.evaluate(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    return p.hoverAt(0.98, 0.98);
  });
  expect(cleared).toBeNull();
  const restored = await markers(page, [center]);
  expect(restored.nodes[0]!.highlighted).toBe(false);
  expect(restored.highlightedCount).toBe(0);
  // The marker is still visible (hover glow does not hide it).
  expect(restored.nodes[0]!.visible).toBe(true);

  // Nothing regressed: pickAt still resolves the empty center node as before.
  const rehit = await page.evaluate(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    return p.pickAt(0, 0);
  });
  expect(rehit!.kind).toBe('empty-node');
  expect((rehit as { node: string }).node).toBe(center);

  // The highlight colour SSOT is the tracked config value (load-bearing import).
  expect(colorsDefault.hoverHighlight).toMatch(/^#[0-9a-f]{6}$/i);

  const shot = resolve('e2e/artifacts/markers-hover.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});
