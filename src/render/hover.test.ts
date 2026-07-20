import { describe, it, expect } from 'vitest';
import { computeHoverTarget, buildHoverLookup, type RaycastHit } from './hover.ts';
import { generateAllLines, buildLinesThroughNode, type Line, type LineCategory } from '../core/lines.ts';
import { keyOf, type Coord, type NodeKey } from '../core/coords.ts';
import { initialState, type GameState, type Player } from '../core/gameState.ts';

/**
 * Task 4.7 hover-target computation — the PURE resolver (game-core Part 4). Given a
 * raycast hit + game state + the line index + the visible categories, it decides which
 * nodes / lines / pieces to highlight. Strict unit + mutation gate; genuine assertions on
 * the returned target (sets of ids), negative cases, and the deliberate placed-sphere
 * asymmetry. No THREE, no DOM — pure.
 */

const SIZE = 5;

/** Build the lookup from the real core enumeration (no hand-rolled fixtures). */
function lookup(size = SIZE) {
  const lines = generateAllLines(size);
  return { lines, hover: buildHoverLookup(lines) };
}

/** A state with the given pieces placed (turn/captures irrelevant to hover). */
function stateWith(pieces: Record<NodeKey, Player>, size = SIZE): GameState {
  return { ...initialState(size), pieces };
}

/** All lines (visible or not) that pass through a node, from the core index. */
function lineIdsThrough(node: Coord, size = SIZE): string[] {
  return buildLinesThroughNode(generateAllLines(size)).get(keyOf(node)) ?? [];
}

/** Find one full line of a given category that contains `node`. */
function lineThrough(lines: Line[], category: LineCategory, node: Coord): Line {
  const key = keyOf(node);
  const line = lines.find(
    (l) => l.category === category && l.nodes.some((n) => keyOf(n) === key),
  );
  if (!line) throw new Error(`no ${category} line through ${key}`);
  return line;
}

describe('computeHoverTarget', () => {
  const ALL: readonly LineCategory[] = ['orthogonal', 'face', 'space'];

  it('null hit → null target (nothing hovered)', () => {
    const { hover } = lookup();
    expect(computeHoverTarget(null, stateWith({}), hover, ALL)).toBeNull();
  });

  it('empty node → highlights the node + its VISIBLE lines + pieces on those lines', () => {
    const { lines, hover } = lookup();
    // Center node of a 5³ board lies on all 13 axes.
    const center: Coord = [2, 2, 2];
    // Place a black piece on one orthogonal line through center and a white on a face line.
    const ortho = lineThrough(lines, 'orthogonal', center);
    const face = lineThrough(lines, 'face', center);
    const orthoPieceNode = ortho.nodes.find((n) => keyOf(n) !== keyOf(center))!;
    const facePieceNode = face.nodes.find((n) => keyOf(n) !== keyOf(center))!;
    const state = stateWith({
      [keyOf(orthoPieceNode)]: 'black',
      [keyOf(facePieceNode)]: 'white',
    });

    // Only orthogonal visible: the face piece must NOT be highlighted (visible-only rule).
    const hit: RaycastHit = { kind: 'empty-node', node: keyOf(center) };
    const target = computeHoverTarget(hit, state, hover, ['orthogonal']);
    expect(target).not.toBeNull();
    // The hovered node itself is highlighted.
    expect(target!.nodes).toContain(keyOf(center));
    // Only visible (orthogonal) lines through center are highlighted; face/space excluded.
    expect(target!.lines).toContain(ortho.id);
    expect(target!.lines).not.toContain(face.id);
    // Every highlighted line is an orthogonal one (no hidden-category line leaked in).
    for (const id of target!.lines) {
      expect(lines.find((l) => l.id === id)!.category).toBe('orthogonal');
    }
    // The piece on the visible ortho line is highlighted; the one on the hidden face line is not.
    expect(target!.pieces).toContain(keyOf(orthoPieceNode));
    expect(target!.pieces).not.toContain(keyOf(facePieceNode));
  });

  it('empty node with ALL categories visible → highlights every axis line through it', () => {
    const { hover } = lookup();
    const center: Coord = [2, 2, 2];
    const hit: RaycastHit = { kind: 'empty-node', node: keyOf(center) };
    const target = computeHoverTarget(hit, stateWith({}), hover, ALL);
    const expected = lineIdsThrough(center).sort();
    expect([...target!.lines].sort()).toEqual(expected);
    // 13 axes through the fully-interior center node.
    expect(target!.lines).toHaveLength(13);
  });

  it('placed sphere → highlights the connected VISIBLE lines + their pieces, NOT the sphere', () => {
    const { lines, hover } = lookup();
    const center: Coord = [2, 2, 2];
    const ortho = lineThrough(lines, 'orthogonal', center);
    // Another piece on the same ortho line (should be highlighted); one on a hidden face line.
    const ally = ortho.nodes.find((n) => keyOf(n) !== keyOf(center))!;
    const face = lineThrough(lines, 'face', center);
    const faceMate = face.nodes.find((n) => keyOf(n) !== keyOf(center))!;
    const state = stateWith({
      [keyOf(center)]: 'white',
      [keyOf(ally)]: 'black',
      [keyOf(faceMate)]: 'white',
    });

    const hit: RaycastHit = { kind: 'placed-sphere', node: keyOf(center) };
    const target = computeHoverTarget(hit, state, hover, ['orthogonal']);
    // Asymmetry: the hovered sphere's OWN node is NOT highlighted.
    expect(target!.nodes).not.toContain(keyOf(center));
    expect(target!.nodes).toEqual([]);
    // The connected visible ortho line is highlighted; the hidden face line is not.
    expect(target!.lines).toContain(ortho.id);
    expect(target!.lines).not.toContain(face.id);
    // The ally on the visible line is highlighted; the sphere itself is not; the hidden-line
    // mate is not.
    expect(target!.pieces).toContain(keyOf(ally));
    expect(target!.pieces).not.toContain(keyOf(center));
    expect(target!.pieces).not.toContain(keyOf(faceMate));
  });

  it('line → highlights the whole visible line + all pieces on it (node set stays empty)', () => {
    const { lines, hover } = lookup();
    const face = lines.find((l) => l.category === 'face')!;
    // Occupy two nodes of that line with pieces.
    const p0 = face.nodes[0]!;
    const p1 = face.nodes[1]!;
    const state = stateWith({ [keyOf(p0)]: 'white', [keyOf(p1)]: 'black' });

    const hit: RaycastHit = { kind: 'line', lineId: face.id };
    // Face category visible here.
    const target = computeHoverTarget(hit, state, hover, ['face']);
    expect(target!.lines).toEqual([face.id]);
    // Every occupied node ON the line is a highlighted piece; nodes set stays empty (line hover
    // highlights the gridline, not node markers).
    expect([...target!.pieces].sort()).toEqual([keyOf(p0), keyOf(p1)].sort());
    expect(target!.nodes).toEqual([]);
  });

  it('line hover on a HIDDEN category → nothing (visible-only rule)', () => {
    const { lines, hover } = lookup();
    const space = lines.find((l) => l.category === 'space')!;
    const state = stateWith({ [keyOf(space.nodes[0]!)]: 'white' });
    const hit: RaycastHit = { kind: 'line', lineId: space.id };
    // space NOT in the visible set → the line is not highlightable.
    const target = computeHoverTarget(hit, state, hover, ['orthogonal', 'face']);
    expect(target).toBeNull();
  });

  it('unknown lineId → null (defensive; never fabricates a target)', () => {
    const { hover } = lookup();
    const hit: RaycastHit = { kind: 'line', lineId: 'not-a-real-line' };
    expect(computeHoverTarget(hit, stateWith({}), hover, ALL)).toBeNull();
  });

  it('empty node with NO lines (a node off every registered line) → node only, no lines/pieces', () => {
    const { hover } = lookup();
    // A key that is not a board node has no lines through it.
    const hit: RaycastHit = { kind: 'empty-node', node: '99,99,99' };
    const target = computeHoverTarget(hit, stateWith({}), hover, ALL);
    expect(target!.nodes).toEqual(['99,99,99']);
    expect(target!.lines).toEqual([]);
    expect(target!.pieces).toEqual([]);
  });

  it('every highlighted piece appears exactly once across the highlighted lines', () => {
    const { hover } = lookup();
    const center: Coord = [2, 2, 2];
    // Two pieces, each on a distinct orthogonal line through center (z-line and y-line).
    const state = stateWith({ [keyOf([2, 2, 3])]: 'white', [keyOf([2, 3, 2])]: 'black' });
    const hit: RaycastHit = { kind: 'empty-node', node: keyOf(center) };
    const target = computeHoverTarget(hit, state, hover, ['orthogonal']);
    // Both placed pieces lie on visible orthogonal lines through center → both highlighted,
    // each listed exactly once (no piece can sit on two axis-lines through the same node).
    expect([...target!.pieces].sort()).toEqual([keyOf([2, 2, 3]), keyOf([2, 3, 2])].sort());
    expect(target!.pieces).toHaveLength(2);
    expect(new Set(target!.pieces).size).toBe(target!.pieces.length);
    expect(new Set(target!.lines).size).toBe(target!.lines.length);
  });
});
