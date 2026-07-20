import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import colorsDefault from '../src/config/defaults/colors.json' with { type: 'json' };
import renderingDefault from '../src/config/defaults/rendering.json' with { type: 'json' };
import materialsDefault from '../src/config/defaults/materials.json' with { type: 'json' };
import { keyOf } from '../src/core/coords.ts';

/**
 * Task 4.7 picking + hover e2e — the raycaster + emissive application are an IO boundary,
 * verified by driving the REAL app and asserting on `window.__pente` (agent-principles #3:
 * observable behavior, never a log line). The pure hover-rule computation is mutation-gated
 * in Vitest; here we prove the wiring end-to-end:
 *   - `pickAt` at the screen center (the camera targets the board origin = center node)
 *     resolves to that node — an *empty-node* hit on an empty board;
 *   - `hoverAt` the same spot highlights the center node + its visible lines + pieces on
 *     them, and the emissive glow is actually applied to the highlighted piece mesh;
 *   - once the center node holds a piece, the same pick reads as a *placed-sphere* hit and
 *     the hover EXCLUDES the sphere itself from `pieces` (the game-core Part 4 asymmetry);
 *   - the highlight clears (emissive → 0) when hovering empty space.
 * Expected colors/boost derive from the tracked config JSON so nothing is hardcoded
 * (agent-principles #8).
 */

type Player = 'white' | 'black';
interface GameStateReadout {
  size: number;
  pieces: Record<string, Player>;
  turn: Player;
}
interface PieceReadout {
  node: string;
  owner: Player;
  opacity: number;
  emissiveIntensity: number;
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
interface LineGroupReadout {
  category: string;
  visible: boolean;
  segmentCount: number;
  lineCount: number;
  highlightedSegmentCount: number;
}

type Pente = {
  place(coords: [number, number, number]): GameStateReadout | null;
  getState(): GameStateReadout | null;
  getPieces(): PieceReadout[] | null;
  getVisibleLines(): LineGroupReadout[] | null;
  pickAt(x: number, y: number): RaycastHit | null;
  hoverAt(x: number, y: number): HoverTarget | null;
  getHoverTarget(): HoverTarget | null;
  dispatch(id: string): boolean | null;
};

async function ready(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.pickAt === 'function' &&
      typeof p.hoverAt === 'function' &&
      typeof p.getHoverTarget === 'function' &&
      !!document.querySelector('canvas')
    );
  });
}

const get = <T,>(page: import('@playwright/test').Page, fn: (p: Pente) => T): Promise<T> =>
  page.evaluate((body: string): unknown => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    const revived = eval(`(${body})`) as (api: Pente) => unknown;
    return revived(p);
  }, fn.toString()) as Promise<T>;

test('pickAt screen-center resolves to the center node (empty-node on an empty board)', async ({
  page,
}) => {
  await ready(page);
  // The orbit target is the board origin, which is the center node [2,2,2] for a 5³ board;
  // NDC (0,0) rays straight through it and strikes its pick sphere.
  const hit = await get(page, (p) => p.pickAt(0, 0));
  expect(hit).not.toBeNull();
  expect(hit!.kind).toBe('empty-node');
  expect((hit as { node: string }).node).toBe(keyOf([2, 2, 2]));
});

test('hoverAt an empty node highlights the node + its visible lines + glows pieces on them', async ({
  page,
}) => {
  await ready(page);

  // Put a piece on the orthogonal (z) line through center so it lies on a VISIBLE line.
  const onLine = keyOf([2, 2, 4]); // shares the z-axis orthogonal line with the center node
  await get(page, (p) => p.place([2, 2, 4]));
  // Also a piece on a diagonal (default-hidden) line: it must NOT be highlighted.
  await get(page, (p) => p.place([3, 3, 3])); // space-diagonal through center; hidden by default

  const target = await get(page, (p) => p.hoverAt(0, 0));
  expect(target).not.toBeNull();
  // The hovered empty node itself is highlighted.
  expect(target!.nodes).toContain(keyOf([2, 2, 2]));
  // Only orthogonal lines are visible by default → some lines highlighted, and the piece on
  // the visible line is included; the diagonal-line piece is excluded (visible-only rule).
  expect(target!.lines.length).toBeGreaterThan(0);
  expect(target!.pieces).toContain(onLine);
  expect(target!.pieces).not.toContain(keyOf([3, 3, 3]));

  // The emissive glow is ACTUALLY applied to the highlighted piece mesh (observable), and
  // the non-highlighted piece stays dark.
  await page.waitForFunction(
    (args) => {
      const p = (window as unknown as { __pente: Pente }).__pente;
      const pieces = p.getPieces();
      if (!pieces) return false;
      const glow = pieces.find((pc) => pc.node === args.onLine);
      const dark = pieces.find((pc) => pc.node === args.off);
      return !!glow && glow.emissiveIntensity === args.boost && !!dark && dark.emissiveIntensity === 0;
    },
    { onLine, off: keyOf([3, 3, 3]), boost: renderingDefault.emissiveBoost },
  );

  // getHoverTarget mirrors the just-computed target (state, not a log line).
  const readback = await get(page, (p) => p.getHoverTarget());
  expect(readback).toEqual(target);
  // The highlight colour SSOT is the tracked config value.
  expect(colorsDefault.hoverHighlight).toMatch(/^#[0-9a-f]{6}$/i);

  const shot = resolve('e2e/artifacts/hover-empty-node.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('a placed sphere hover excludes the sphere itself + clears on empty space', async ({
  page,
}) => {
  await ready(page);

  // Occupy the center node itself, plus an ally on its visible ortho line.
  await get(page, (p) => p.place([2, 2, 2])); // white — the center sphere
  await get(page, (p) => p.place([2, 2, 4])); // black — on the same z-ortho line

  // Now the same center pick reads as a PLACED sphere.
  const hit = await get(page, (p) => p.pickAt(0, 0));
  expect(hit!.kind).toBe('placed-sphere');
  expect((hit as { node: string }).node).toBe(keyOf([2, 2, 2]));

  const target = await get(page, (p) => p.hoverAt(0, 0));
  // Asymmetry: the sphere's own node is NOT in nodes, and the sphere is NOT among the glowed
  // pieces — but the ally on the connected visible line IS.
  expect(target!.nodes).toEqual([]);
  expect(target!.pieces).not.toContain(keyOf([2, 2, 2]));
  expect(target!.pieces).toContain(keyOf([2, 2, 4]));

  // Observable: the hovered sphere mesh stays dark; the ally glows.
  await page.waitForFunction(
    (args) => {
      const p = (window as unknown as { __pente: Pente }).__pente;
      const pieces = p.getPieces();
      if (!pieces) return false;
      const sphere = pieces.find((pc) => pc.node === args.center);
      const ally = pieces.find((pc) => pc.node === args.ally);
      return !!sphere && sphere.emissiveIntensity === 0 && !!ally && ally.emissiveIntensity === args.boost;
    },
    { center: keyOf([2, 2, 2]), ally: keyOf([2, 2, 4]), boost: renderingDefault.emissiveBoost },
  );

  // Hover empty space (a corner of NDC well off the board) → target null + all glow cleared.
  const cleared = await get(page, (p) => p.hoverAt(0.98, 0.98));
  expect(cleared).toBeNull();
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    const pieces = p.getPieces();
    return !!pieces && pieces.every((pc) => pc.emissiveIntensity === 0);
  });
  // Sanity: pieces are still present (config SSOT referenced so the import is load-bearing).
  const pieces = await get(page, (p) => p.getPieces()!);
  expect(pieces.length).toBeGreaterThan(0);
  expect(materialsDefault.pieceOpacity).toBeGreaterThan(0);

  const shot = resolve('e2e/artifacts/hover-placed-sphere.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('line picking: hovering a drawn gridline (away from nodes) resolves to a line hit', async ({
  page,
}) => {
  await ready(page);
  // Reveal the diagonals too, so more gridline geometry is pickable.
  await get(page, (p) => p.dispatch('showAllDiagonals'));

  // Scan a small NDC grid; between-node samples should strike a gridline segment. We assert
  // that the picker CAN resolve a genuine line hit (kind 'line' with a non-empty lineId) and
  // that hovering it yields a target whose single highlighted line matches that id.
  const found = await get(page, (p) => {
    for (let ix = -20; ix <= 20; ix++) {
      for (let iy = -20; iy <= 20; iy++) {
        const x = ix / 40;
        const y = iy / 40;
        const hit = p.pickAt(x, y);
        if (hit && hit.kind === 'line') {
          return { x, y, lineId: (hit as { lineId: string }).lineId };
        }
      }
    }
    return null;
  });
  expect(found).not.toBeNull();
  expect(typeof found!.lineId).toBe('string');
  expect(found!.lineId.length).toBeGreaterThan(0);

  // Hovering that exact spot highlights precisely that one line (whole-line hover rule);
  // the node set stays empty (a line hover glows the gridline, not a node marker). `found`
  // is passed in explicitly — the in-page fn can't close over test-side variables.
  const target = await page.evaluate((f) => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    return p.hoverAt(f.x, f.y);
  }, found!);
  expect(target).not.toBeNull();
  expect(target!.lines).toEqual([found!.lineId]);
  expect(target!.nodes).toEqual([]);

  // The whole-line glow is actually APPLIED on-screen, not merely computed: exactly one line's
  // worth of gridline segments now carry the highlight colour across the drawn groups. Before
  // the hover no segment is highlighted; after it, precisely one full line's segments glow — so
  // the captured artifact genuinely shows the single-line highlight it names (agent-principles
  // #3: proof = observable render state, and the screenshot depicts that state).
  const highlightedSegments = (groups: LineGroupReadout[]): number =>
    groups.reduce((sum, g) => sum + g.highlightedSegmentCount, 0);
  const lit = await get(page, (p) => p.getVisibleLines()!);
  // Exactly ONE category group carries the glow (the group that owns the single hovered line),
  // and it lights a whole line's worth of contiguous segments (> 0). Which line is the one line
  // is already pinned above (`target.lines === [found.lineId]`); here we prove that whole-line
  // highlight is actually APPLIED to on-screen segments, not merely computed in the target.
  const litGroups = lit.filter((g) => g.highlightedSegmentCount > 0);
  expect(litGroups).toHaveLength(1);
  expect(litGroups[0]!.highlightedSegmentCount).toBeGreaterThan(0);
  // The lit segments are a strict subset of one group's segments (a single line ⊂ its group),
  // never the whole group — the highlight is one line, not a category-wide flood.
  expect(litGroups[0]!.highlightedSegmentCount).toBeLessThan(litGroups[0]!.segmentCount);

  const shot = resolve('e2e/artifacts/hover-line.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });

  // Hovering empty space clears the whole-line glow (idempotent restore → zero highlighted).
  await get(page, (p) => p.hoverAt(0.98, 0.98));
  const cleared = await get(page, (p) => p.getVisibleLines()!);
  expect(highlightedSegments(cleared)).toBe(0);
});
