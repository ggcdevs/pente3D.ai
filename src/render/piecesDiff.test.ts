/**
 * Tests for the PURE pieces-diff planner (Task 4.5).
 *
 * `diffPieces` turns two `GameState.pieces` maps (prev → next) into the incremental
 * change the individual-piece glue (`pieces.ts`) applies: `adds` (create a mesh),
 * `removes` (dispose a mesh), `recolors` (swap a mesh's material when a node's occupant
 * changes identity — the undo/redo/history-scrub edge). This is the pure boundary — no
 * THREE, no DOM — so it gets the strict unit + mutation gate with genuine assertions on
 * the returned diff (agent-principles #2/#3), including the negative/edge cases:
 * no-op diff, capture-style multi-remove, recolor-not-add-or-remove, and the invariant
 * that a node lands in at most one bucket. Expected values are derived from real
 * `Game`/`placePiece` states where possible so no volatile fact is hardcoded
 * (agent-principles #8).
 */

import { describe, expect, it } from 'vitest';
import { diffPieces, type PieceDiff } from './piecesDiff.ts';
import type { Player } from '../core/gameState.ts';
import type { NodeKey } from '../core/coords.ts';
import { Game } from '../core/game.ts';
import { keyOf } from '../core/coords.ts';

/** Sort helpers so bucket-order is never load-bearing in an assertion. */
const byNode = <T extends { node: NodeKey }>(xs: readonly T[]): T[] =>
  [...xs].sort((a, b) => a.node.localeCompare(b.node));
const sortedRemoves = (xs: readonly NodeKey[]): NodeKey[] => [...xs].sort();

/** Every node key across the diff, to assert the at-most-one-bucket invariant. */
function allTouched(diff: PieceDiff): NodeKey[] {
  return [
    ...diff.adds.map((a) => a.node),
    ...diff.removes,
    ...diff.recolors.map((r) => r.node),
  ];
}

describe('diffPieces — adds', () => {
  it('reports each newly-occupied node as an add carrying its next-state owner', () => {
    const prev: Record<NodeKey, Player> = { '0,0,0': 'white' };
    const next: Record<NodeKey, Player> = {
      '0,0,0': 'white',
      '1,0,0': 'black',
      '2,0,0': 'white',
    };
    const diff = diffPieces(prev, next);
    expect(byNode(diff.adds)).toEqual([
      { node: '1,0,0', owner: 'black' },
      { node: '2,0,0', owner: 'white' },
    ]);
    expect(diff.removes).toEqual([]);
    expect(diff.recolors).toEqual([]);
  });

  it('reports every piece as an add when prev is empty', () => {
    const next: Record<NodeKey, Player> = { '0,0,0': 'white', '3,3,3': 'black' };
    const diff = diffPieces({}, next);
    expect(byNode(diff.adds)).toEqual([
      { node: '0,0,0', owner: 'white' },
      { node: '3,3,3', owner: 'black' },
    ]);
    expect(diff.removes).toEqual([]);
    expect(diff.recolors).toEqual([]);
  });
});

describe('diffPieces — removes', () => {
  it('reports each vacated node as a remove (a capture or a rewind)', () => {
    const prev: Record<NodeKey, Player> = {
      '0,0,0': 'white',
      '1,0,0': 'black',
      '2,0,0': 'black',
    };
    // The two black pieces were captured; only the white flank remains.
    const next: Record<NodeKey, Player> = { '0,0,0': 'white', '3,0,0': 'white' };
    const diff = diffPieces(prev, next);
    expect(sortedRemoves(diff.removes)).toEqual(['1,0,0', '2,0,0']);
    expect(byNode(diff.adds)).toEqual([{ node: '3,0,0', owner: 'white' }]);
    expect(diff.recolors).toEqual([]);
  });

  it('reports every piece as a remove when next is empty', () => {
    const prev: Record<NodeKey, Player> = { '0,0,0': 'white', '1,1,1': 'black' };
    const diff = diffPieces(prev, {});
    expect(sortedRemoves(diff.removes)).toEqual(['0,0,0', '1,1,1']);
    expect(diff.adds).toEqual([]);
    expect(diff.recolors).toEqual([]);
  });
});

describe('diffPieces — recolors', () => {
  it('reports a node whose occupant changed colour as a recolor, not add+remove', () => {
    const prev: Record<NodeKey, Player> = { '4,4,4': 'white' };
    const next: Record<NodeKey, Player> = { '4,4,4': 'black' };
    const diff = diffPieces(prev, next);
    expect(diff.recolors).toEqual([{ node: '4,4,4', from: 'white', to: 'black' }]);
    expect(diff.adds).toEqual([]);
    expect(diff.removes).toEqual([]);
  });

  it('distinguishes recolor (same node, new owner) from untouched (same node, same owner)', () => {
    const prev: Record<NodeKey, Player> = { '1,2,3': 'white', '3,2,1': 'black' };
    const next: Record<NodeKey, Player> = { '1,2,3': 'white', '3,2,1': 'white' };
    const diff = diffPieces(prev, next);
    // 1,2,3 is unchanged → in no bucket; 3,2,1 flipped → a single recolor.
    expect(diff.recolors).toEqual([{ node: '3,2,1', from: 'black', to: 'white' }]);
    expect(diff.adds).toEqual([]);
    expect(diff.removes).toEqual([]);
  });
});

describe('diffPieces — no-op & invariants', () => {
  it('produces an empty diff for identical maps (nothing added/removed/recoloured)', () => {
    const same: Record<NodeKey, Player> = { '0,0,0': 'white', '1,0,0': 'black' };
    const diff = diffPieces(same, { ...same });
    expect(diff.adds).toEqual([]);
    expect(diff.removes).toEqual([]);
    expect(diff.recolors).toEqual([]);
  });

  it('produces an empty diff for two empty maps', () => {
    const diff = diffPieces({}, {});
    expect(diff).toEqual({ adds: [], removes: [], recolors: [] });
  });

  it('places every touched node in exactly one bucket (add | remove | recolor)', () => {
    const prev: Record<NodeKey, Player> = {
      '0,0,0': 'white', // unchanged
      '1,0,0': 'black', // recolored
      '2,0,0': 'white', // removed
    };
    const next: Record<NodeKey, Player> = {
      '0,0,0': 'white', // unchanged
      '1,0,0': 'white', // recolored
      '5,5,5': 'black', // added
    };
    const diff = diffPieces(prev, next);
    const touched = allTouched(diff);
    // No node appears twice across the three buckets.
    expect(new Set(touched).size).toBe(touched.length);
    // The unchanged node appears in NO bucket.
    expect(touched).not.toContain('0,0,0');
    expect(byNode(diff.adds)).toEqual([{ node: '5,5,5', owner: 'black' }]);
    expect(sortedRemoves(diff.removes)).toEqual(['2,0,0']);
    expect(diff.recolors).toEqual([{ node: '1,0,0', from: 'black', to: 'white' }]);
  });

  it('does not mutate either input map', () => {
    const prev: Record<NodeKey, Player> = { '0,0,0': 'white' };
    const next: Record<NodeKey, Player> = { '1,0,0': 'black' };
    diffPieces(prev, next);
    expect(prev).toEqual({ '0,0,0': 'white' });
    expect(next).toEqual({ '1,0,0': 'black' });
  });
});

describe('diffPieces — against real Game states', () => {
  it('a placement adds exactly the just-played piece against the live state', () => {
    const game = new Game(5);
    const before = game.state().pieces;
    game.place([2, 2, 2]);
    const after = game.state().pieces;
    const diff = diffPieces(before, after);
    expect(diff.adds).toEqual([{ node: keyOf([2, 2, 2]), owner: 'white' }]);
    expect(diff.removes).toEqual([]);
    expect(diff.recolors).toEqual([]);
  });

  it('a capturing move removes the two captured pieces and adds the placed one', () => {
    // White brackets two black pieces along +x: black at (1,0,0),(2,0,0), white flank
    // at (0,0,0), then white plays (3,0,0) to capture the pair.
    const game = new Game(5);
    game.place([0, 0, 0]); // white
    game.place([1, 0, 0]); // black
    game.place([4, 4, 4]); // white (spacer)
    game.place([2, 0, 0]); // black
    const before = game.state().pieces;
    game.place([3, 0, 0]); // white captures (1,0,0),(2,0,0)
    const after = game.state().pieces;

    // Sanity: the capture actually happened in the real core (observable, not inferred).
    expect(after[keyOf([1, 0, 0])]).toBeUndefined();
    expect(after[keyOf([2, 0, 0])]).toBeUndefined();

    const diff = diffPieces(before, after);
    expect(diff.adds).toEqual([{ node: keyOf([3, 0, 0]), owner: 'white' }]);
    expect(sortedRemoves(diff.removes)).toEqual([keyOf([1, 0, 0]), keyOf([2, 0, 0])]);
    expect(diff.recolors).toEqual([]);
  });

  it('undo of the last placement removes that piece (history-rewind path)', () => {
    const game = new Game(5);
    game.place([2, 2, 2]); // white
    game.place([2, 3, 2]); // black
    const before = game.state().pieces;
    game.undo(); // rewinds the black piece
    const after = game.state().pieces;
    const diff = diffPieces(before, after);
    expect(diff.removes).toEqual([keyOf([2, 3, 2])]);
    expect(diff.adds).toEqual([]);
    expect(diff.recolors).toEqual([]);
  });
});
