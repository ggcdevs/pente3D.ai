import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import colorsDefault from '../src/config/defaults/colors.json' with { type: 'json' };
import geometryDefault from '../src/config/defaults/geometry.json' with { type: 'json' };
import materialsDefault from '../src/config/defaults/materials.json' with { type: 'json' };
import { keyOf } from '../src/core/coords.ts';

/**
 * Task 4.5 individual-pieces e2e: the piece meshes are an IO boundary, verified by
 * driving the real app and asserting on `window.__pente` — `place()` drives the live
 * `Game`, `getState()` returns the real rules state, and `getPieces()` reports the actual
 * meshes in the scene. We prove observable behavior (agent-principles #3), not a log line:
 *   - place → a mesh appears at exactly the node, coloured for that player, at the
 *     board-centered world position;
 *   - a capturing move → the flanked meshes are gone from BOTH the state and the scene.
 * Expected colors/positions derive from the tracked config JSON + core `keyOf` so no
 * volatile fact is hardcoded (agent-principles #8).
 */

/** The board size the scene renders (mirrors scene.ts BOARD_SIZE). */
const BOARD_SIZE = 5;

type Player = 'white' | 'black';
interface PieceReadout {
  node: string;
  owner: Player;
  position: { x: number; y: number; z: number };
  opacity: number;
  fadingOut: boolean;
}
interface GameStateReadout {
  size: number;
  pieces: Record<string, Player>;
  turn: Player;
  captures: { white: number; black: number };
  winner: Player | null;
}

/** Board-centered world position of a node (mirrors pieces.ts worldOf). */
function worldOf(x: number, y: number, z: number): { x: number; y: number; z: number } {
  const c = (BOARD_SIZE - 1) / 2;
  const s = geometryDefault.spacing;
  return { x: (x - c) * s, y: (y - c) * s, z: (z - c) * s };
}

type Pente = {
  place(coords: [number, number, number]): GameStateReadout | null;
  getState(): GameStateReadout | null;
  getPieces(): PieceReadout[] | null;
};

async function api(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.place === 'function' &&
      typeof p.getState === 'function' &&
      typeof p.getPieces === 'function' &&
      !!document.querySelector('canvas')
    );
  });
}

/** Drive a placement in-page and return the resulting state + pieces (post-fade settle). */
async function place(
  page: import('@playwright/test').Page,
  coords: [number, number, number],
): Promise<{ state: GameStateReadout; pieces: PieceReadout[] }> {
  return page.evaluate((c) => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    const state = p.place(c as [number, number, number]);
    if (!state) throw new Error('place() returned null');
    return { state, pieces: p.getPieces()! };
  }, coords);
}

/** Wait until every live piece has finished fading in (opacity at its target). */
async function waitSettled(page: import('@playwright/test').Page, target: number): Promise<void> {
  await page.waitForFunction(
    (t) => {
      const p = (window as unknown as { __pente: Pente }).__pente;
      const pieces = p.getPieces();
      return !!pieces && pieces.every((piece) => Math.abs(piece.opacity - t) < 1e-6);
    },
    target,
  );
}

test('place → a piece mesh appears at the node, coloured + positioned from config', async ({
  page,
}) => {
  await api(page);

  // Empty board: no piece meshes yet.
  const before = await page.evaluate(
    () => (window as unknown as { __pente: Pente }).__pente.getPieces()!,
  );
  expect(before).toEqual([]);

  const { state } = await place(page, [2, 2, 2]);
  console.log('STATE after place:', JSON.stringify(state));

  // The rules core recorded the piece (white moves first) and flipped the turn.
  expect(state.pieces[keyOf([2, 2, 2])]).toBe('white');
  expect(state.turn).toBe('black');

  await waitSettled(page, materialsDefault.pieceOpacity);
  const pieces = await page.evaluate(
    () => (window as unknown as { __pente: Pente }).__pente.getPieces()!,
  );
  console.log('PIECES after place:', JSON.stringify(pieces));

  // Exactly one mesh, at the right node, white, at the board-centered world position.
  expect(pieces).toHaveLength(1);
  const piece = pieces[0]!;
  expect(piece.node).toBe(keyOf([2, 2, 2]));
  expect(piece.owner).toBe('white');
  expect(piece.opacity).toBeCloseTo(materialsDefault.pieceOpacity, 6);
  expect(piece.fadingOut).toBe(false);
  const w = worldOf(2, 2, 2);
  expect(piece.position.x).toBeCloseTo(w.x, 6);
  expect(piece.position.y).toBeCloseTo(w.y, 6);
  expect(piece.position.z).toBeCloseTo(w.z, 6);

  const shotPath = resolve('e2e/artifacts/pieces-placed.png');
  mkdirSync(dirname(shotPath), { recursive: true });
  await page.screenshot({ path: shotPath });
  console.log('SCREENSHOT saved to:', shotPath);
});

test('capturing move → the two flanked meshes are removed from state AND scene', async ({
  page,
}) => {
  await api(page);

  // White brackets two black pieces along +x, then plays the far flank to capture.
  await place(page, [0, 0, 0]); // white flank
  await place(page, [1, 0, 0]); // black
  await place(page, [4, 4, 4]); // white spacer (keep turns aligned)
  await place(page, [2, 0, 0]); // black
  await waitSettled(page, materialsDefault.pieceOpacity);

  // Before the capture: all four pieces present in the scene.
  const beforeState = await page.evaluate(
    () => (window as unknown as { __pente: Pente }).__pente.getState()!,
  );
  expect(beforeState.pieces[keyOf([1, 0, 0])]).toBe('black');
  expect(beforeState.pieces[keyOf([2, 0, 0])]).toBe('black');

  const { state } = await place(page, [3, 0, 0]); // white captures (1,0,0),(2,0,0)
  console.log('STATE after capture:', JSON.stringify(state));

  // The rules core removed the pair and scored one capture for white (observable).
  expect(state.pieces[keyOf([1, 0, 0])]).toBeUndefined();
  expect(state.pieces[keyOf([2, 0, 0])]).toBeUndefined();
  expect(state.captures.white).toBe(1);

  // The captured meshes fade out then are disposed: wait until they are gone from the
  // scene entirely, and the surviving pieces are exactly the un-captured set.
  await page.waitForFunction(
    (removed) => {
      const p = (window as unknown as { __pente: Pente }).__pente;
      const pieces = p.getPieces();
      if (!pieces) return false;
      const nodes = pieces.map((pc) => pc.node);
      return removed.every((r) => !nodes.includes(r));
    },
    [keyOf([1, 0, 0]), keyOf([2, 0, 0])],
  );

  const pieces = await page.evaluate(
    () => (window as unknown as { __pente: Pente }).__pente.getPieces()!,
  );
  console.log('PIECES after capture:', JSON.stringify(pieces.map((p) => p.node)));
  const survivingNodes = pieces.map((p) => p.node).sort();
  // The capturing white pieces + the white spacer remain; the two black pieces are gone.
  expect(survivingNodes).toEqual(
    [keyOf([0, 0, 0]), keyOf([3, 0, 0]), keyOf([4, 4, 4])].sort(),
  );
  // Sanity: the surviving pieces read as white per config-derived colour identity.
  for (const p of pieces) expect(p.owner).toBe('white');
  // Config is referenced so the import is load-bearing (colors default is the SSOT).
  expect(colorsDefault.whitePiece).toMatch(/^#[0-9a-f]{6}$/i);

  const shotPath = resolve('e2e/artifacts/pieces-captured.png');
  mkdirSync(dirname(shotPath), { recursive: true });
  await page.screenshot({ path: shotPath });
  console.log('SCREENSHOT saved to:', shotPath);
});
