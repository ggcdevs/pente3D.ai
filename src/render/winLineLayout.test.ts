/**
 * Tests for the PURE win-line layout planner (Task 4.9).
 *
 * `resolveWinLine` turns a `GameState.winningLine` (an ordered run of node keys, produced
 * by the rules core's five-in-a-row check) into the plain, THREE-free plan the win-line
 * glue (`winLine.ts`) draws as an individual **partial** mesh: the ordered `Coord` nodes
 * and the adjacent-pair segments that bridge them. This is the pure boundary — no THREE,
 * no DOM — so it gets the strict unit + mutation gate with genuine assertions on the
 * returned plan (agent-principles #2/#3), including the negative/edge cases: no win
 * (`undefined`/empty/single-node line → null), and a non-collinear line (a corrupt
 * `winningLine` → honest throw, never a silently-wrong mesh).
 *
 * Expected values are derived from a REAL win produced by `placePiece`/`Game` (not a
 * hand-built literal), so the winning-run node set the plan is checked against is the
 * genuine rules output (agent-principles #8: no volatile fact hardcoded).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveWinLine } from './winLineLayout.ts';
import * as coreLines from '../core/lines.ts';
import { Game } from '../core/game.ts';
import { coordsOf, keyOf, type Coord } from '../core/coords.ts';

/** Play a real five-in-a-row win for white along +x on row (y,z), return the won state. */
function forceLineWin(size: number, y: number, z: number): Game {
  const game = new Game(size);
  // White plays (0..4, y, z); black plays harmless spacers off the winning row.
  for (let i = 0; i < 5; i++) {
    game.place([i, y, z]);
    if (i < 4) game.place([i, y, z + 1]); // black spacer on an adjacent row
  }
  return game;
}

describe('resolveWinLine — a real five-in-a-row', () => {
  it('returns the ordered winning nodes and the adjacent-pair segments bridging them', () => {
    const size = 6;
    const state = forceLineWin(size, 2, 1).state();
    // Precondition: the rules core actually recorded a line win (not a capture win).
    expect(state.winner).toBe('white');
    expect(state.winningLine).toBeDefined();

    const plan = resolveWinLine(state.winningLine, size)!;
    expect(plan).not.toBeNull();

    // The plan's nodes are exactly the winning run's coords, in order.
    const expectedNodes: Coord[] = state.winningLine!.map((k) => coordsOf(k));
    expect(plan.nodes).toEqual(expectedNodes);

    // One segment per adjacent pair: N nodes → N−1 segments, each bridging neighbours.
    expect(plan.segments).toHaveLength(expectedNodes.length - 1);
    for (let i = 0; i < plan.segments.length; i++) {
      expect(plan.segments[i]!.a).toEqual(expectedNodes[i]);
      expect(plan.segments[i]!.b).toEqual(expectedNodes[i + 1]);
    }
  });

  it('spans exactly the winning run (endpoints are the first and last winning nodes)', () => {
    const size = 6;
    const state = forceLineWin(size, 4, 0).state();
    const line = state.winningLine!;
    const plan = resolveWinLine(line, size)!;

    const first = coordsOf(line[0]!);
    const last = coordsOf(line[line.length - 1]!);
    expect(plan.nodes[0]).toEqual(first);
    expect(plan.nodes[plan.nodes.length - 1]).toEqual(last);
    // Every plan node lies on the original winning run (no stray node introduced).
    const runKeys = new Set(line);
    for (const node of plan.nodes) expect(runKeys.has(keyOf(node))).toBe(true);
  });
});

describe('resolveWinLine — no line to draw (negative cases)', () => {
  it('returns null when there is no winning line (undefined)', () => {
    expect(resolveWinLine(undefined, 5)).toBeNull();
  });

  it('returns null for an empty winning line', () => {
    expect(resolveWinLine([], 5)).toBeNull();
  });

  it('returns null for a single-node winning line (nothing to bridge)', () => {
    // A one-node "line" cannot be drawn: there is no segment between two distinct nodes.
    expect(resolveWinLine(['2,2,2'], 5)).toBeNull();
  });
});

describe('resolveWinLine — a corrupt winning line throws (never a wrong mesh)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('throws, surfacing the core rejection reason, when the endpoints are not collinear', () => {
    // (0,0,0) → (1,2,0) is not a canonical-axis step: an honest failure beats a bogus line.
    // The thrown message must carry the offending line AND the core validator's warning
    // (not an empty string), so a diagnosis reads what was wrong — assert on both.
    expect(() => resolveWinLine(['0,0,0', '1,2,0'], 5)).toThrow(
      /invalid winning line.*"0,0,0".*not collinear/,
    );
  });

  it('throws a contract-violation error if the core returns ok with no line (defensive)', () => {
    // This branch is genuinely unreachable in production: `generatePartialLine` never
    // returns `{ ok: true }` without a `line`. Fault-inject that impossible contract
    // breach (agent-principles: spies allowed only to reach a genuinely-unreachable
    // defensive branch, and the test still asserts real behavior) and prove the guard
    // throws the contract-violation message rather than dereferencing undefined.
    vi.spyOn(coreLines, 'generatePartialLine').mockReturnValue({ ok: true });
    expect(() => resolveWinLine(['0,0,0', '4,0,0'], 5)).toThrow(/contract violated/);
  });
});
