/**
 * Win-detection tests (Task 1.6).
 *
 * Two ways to win, evaluated after a placement (game-core design, Part 2):
 *   - **Five-in-a-row** — a run of ≥5 same-colour pieces through the placed node
 *     along any of the 13 axes. `winner` is set and `winningLine` is populated with
 *     the run's node keys.
 *   - **Five capture pairs** — `captures[current] >= 5` pairs wins.
 * After a win, no further moves are allowed (placePiece throws IllegalMove).
 * Win detection always evaluates all 13 axes, independent of any view state
 * (GLOSSARY "Ruleset invariant").
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  initialState,
  IllegalMove,
  type GameState,
  type Player,
} from './gameState';
import { placePiece } from './placePiece';
import { keyOf, inBounds, type Coord } from './coords';
import { AXES } from './axes';

/** Build a state with explicit pieces, whose turn it is, and capture counts. */
function stateWith(
  pieces: Record<string, Player>,
  turn: Player,
  captures: Record<Player, number> = { white: 0, black: 0 },
): GameState {
  return { ...initialState(9), pieces, turn, captures };
}

describe('win — five in a row', () => {
  it('detects a win when placing completes a run of 5 (orthogonal)', () => {
    // white at x=0..3 along +x; place the 5th at x=4.
    const pieces: Record<string, Player> = {
      [keyOf([0, 4, 4])]: 'white',
      [keyOf([1, 4, 4])]: 'white',
      [keyOf([2, 4, 4])]: 'white',
      [keyOf([3, 4, 4])]: 'white',
    };
    const s = placePiece(stateWith(pieces, 'white'), [4, 4, 4]);
    expect(s.winner).toBe('white');
    expect(new Set(s.winningLine)).toEqual(
      new Set([
        keyOf([0, 4, 4]),
        keyOf([1, 4, 4]),
        keyOf([2, 4, 4]),
        keyOf([3, 4, 4]),
        keyOf([4, 4, 4]),
      ]),
    );
  });

  it('detects a win when the placed node is in the middle of the run', () => {
    // white at x=0,1,3,4; place the gap at x=2.
    const pieces: Record<string, Player> = {
      [keyOf([0, 4, 4])]: 'white',
      [keyOf([1, 4, 4])]: 'white',
      [keyOf([3, 4, 4])]: 'white',
      [keyOf([4, 4, 4])]: 'white',
    };
    const s = placePiece(stateWith(pieces, 'white'), [2, 4, 4]);
    expect(s.winner).toBe('white');
    expect(new Set(s.winningLine)).toEqual(
      new Set([
        keyOf([0, 4, 4]),
        keyOf([1, 4, 4]),
        keyOf([2, 4, 4]),
        keyOf([3, 4, 4]),
        keyOf([4, 4, 4]),
      ]),
    );
  });

  it('detects a win along a face-diagonal axis', () => {
    const pieces: Record<string, Player> = {
      [keyOf([0, 0, 4])]: 'white',
      [keyOf([1, 1, 4])]: 'white',
      [keyOf([2, 2, 4])]: 'white',
      [keyOf([3, 3, 4])]: 'white',
    };
    const s = placePiece(stateWith(pieces, 'white'), [4, 4, 4]);
    expect(s.winner).toBe('white');
    expect(new Set(s.winningLine)).toEqual(
      new Set([
        keyOf([0, 0, 4]),
        keyOf([1, 1, 4]),
        keyOf([2, 2, 4]),
        keyOf([3, 3, 4]),
        keyOf([4, 4, 4]),
      ]),
    );
  });

  it('detects a win along a space-diagonal axis', () => {
    const pieces: Record<string, Player> = {
      [keyOf([0, 0, 0])]: 'white',
      [keyOf([1, 1, 1])]: 'white',
      [keyOf([2, 2, 2])]: 'white',
      [keyOf([3, 3, 3])]: 'white',
    };
    const s = placePiece(stateWith(pieces, 'white'), [4, 4, 4]);
    expect(s.winner).toBe('white');
    expect(new Set(s.winningLine)).toEqual(
      new Set([
        keyOf([0, 0, 0]),
        keyOf([1, 1, 1]),
        keyOf([2, 2, 2]),
        keyOf([3, 3, 3]),
        keyOf([4, 4, 4]),
      ]),
    );
  });

  it('keeps the winner to move (turn does not flip on a win)', () => {
    const pieces: Record<string, Player> = {
      [keyOf([0, 4, 4])]: 'white',
      [keyOf([1, 4, 4])]: 'white',
      [keyOf([2, 4, 4])]: 'white',
      [keyOf([3, 4, 4])]: 'white',
    };
    const s = placePiece(stateWith(pieces, 'white'), [4, 4, 4]);
    expect(s.turn).toBe('white');
  });

  it('detects a win for black as well', () => {
    const pieces: Record<string, Player> = {
      [keyOf([0, 4, 4])]: 'black',
      [keyOf([1, 4, 4])]: 'black',
      [keyOf([2, 4, 4])]: 'black',
      [keyOf([3, 4, 4])]: 'black',
    };
    const s = placePiece(stateWith(pieces, 'black'), [4, 4, 4]);
    expect(s.winner).toBe('black');
  });
});

describe('win — not yet', () => {
  it('does NOT win on a run of only 4', () => {
    // white at x=0..2; place the 4th at x=3 → run of 4, no win.
    const pieces: Record<string, Player> = {
      [keyOf([0, 4, 4])]: 'white',
      [keyOf([1, 4, 4])]: 'white',
      [keyOf([2, 4, 4])]: 'white',
    };
    const s = placePiece(stateWith(pieces, 'white'), [3, 4, 4]);
    expect(s.winner).toBeNull();
    expect(s.winningLine).toBeUndefined();
    // Turn flips normally when no win.
    expect(s.turn).toBe('black');
  });

  it('does NOT win when opponent pieces interrupt the run', () => {
    // white at 0,1; black at 2; white at 3,4; placing 2 is impossible (occupied),
    // so instead: white at 0,1,3,4 and black already at 2 — no 5-run through 0..4.
    const pieces: Record<string, Player> = {
      [keyOf([0, 4, 4])]: 'white',
      [keyOf([1, 4, 4])]: 'white',
      [keyOf([2, 4, 4])]: 'black',
      [keyOf([3, 4, 4])]: 'white',
    };
    const s = placePiece(stateWith(pieces, 'white'), [4, 4, 4]);
    expect(s.winner).toBeNull();
  });
});

describe('win — five capture pairs', () => {
  it('wins when the placement reaches 5 capture pairs', () => {
    // Start at 4 pairs; a bracket closes for the 5th pair.
    // +x bracket: opp(5), opp(6), self(7); place white at [4,4,4].
    const pieces: Record<string, Player> = {
      [keyOf([5, 4, 4])]: 'black',
      [keyOf([6, 4, 4])]: 'black',
      [keyOf([7, 4, 4])]: 'white',
    };
    const s = placePiece(
      stateWith(pieces, 'white', { white: 4, black: 0 }),
      [4, 4, 4],
    );
    expect(s.captures.white).toBe(5);
    expect(s.winner).toBe('white');
    // Capture win has no winning line.
    expect(s.winningLine).toBeUndefined();
    expect(s.turn).toBe('white');
  });

  it('does NOT win at 4 capture pairs', () => {
    // Start at 3 pairs; one bracket closes → 4 pairs, no win.
    const pieces: Record<string, Player> = {
      [keyOf([5, 4, 4])]: 'black',
      [keyOf([6, 4, 4])]: 'black',
      [keyOf([7, 4, 4])]: 'white',
    };
    const s = placePiece(
      stateWith(pieces, 'white', { white: 3, black: 0 }),
      [4, 4, 4],
    );
    expect(s.captures.white).toBe(4);
    expect(s.winner).toBeNull();
    expect(s.turn).toBe('black');
  });
});

describe('win — no moves after a win', () => {
  it('placePiece throws once a winner is set', () => {
    const pieces: Record<string, Player> = {
      [keyOf([0, 4, 4])]: 'white',
      [keyOf([1, 4, 4])]: 'white',
      [keyOf([2, 4, 4])]: 'white',
      [keyOf([3, 4, 4])]: 'white',
    };
    const won = placePiece(stateWith(pieces, 'white'), [4, 4, 4]);
    expect(won.winner).toBe('white');
    expect(() => placePiece(won, [8, 8, 8])).toThrow(IllegalMove);
  });
});

describe('win — five-in-a-row along every axis (property)', () => {
  it('a completed 5-run through the placed node wins, on any axis, any color', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: AXES.length - 1 }),
        // Which of the 5 collinear cells is the just-placed one.
        fc.integer({ min: 0, max: 4 }),
        fc.constantFrom<Player>('white', 'black'),
        (axisIdx, placedIdx, color) => {
          const { vec } = AXES[axisIdx]!;
          // Centre the run on the board centre and step outward symmetrically, so
          // every cell stays in bounds for any axis (components are −1/0/1, and
          // the offset from centre is at most ±2 ⇒ each coord in 2..6).
          const centre: Coord = [4, 4, 4];
          const cells: Coord[] = [];
          for (let i = 0; i < 5; i++) {
            const off = i - 2;
            cells.push([
              centre[0] + off * vec[0],
              centre[1] + off * vec[1],
              centre[2] + off * vec[2],
            ]);
          }
          // Sanity: all in bounds on a size-9 board.
          for (const c of cells) expect(inBounds(c, 9)).toBe(true);

          const placed = cells[placedIdx]!;
          const pieces: Record<string, Player> = {};
          cells.forEach((c, i) => {
            if (i !== placedIdx) pieces[keyOf(c)] = color;
          });

          const s = placePiece(stateWith(pieces, color), placed);
          expect(s.winner).toBe(color);
          expect(new Set(s.winningLine)).toEqual(
            new Set(cells.map((c) => keyOf(c))),
          );
        },
      ),
    );
  });

  it('a run of only 4 through the placed node never wins, on any axis', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: AXES.length - 1 }),
        fc.integer({ min: 0, max: 3 }),
        fc.constantFrom<Player>('white', 'black'),
        (axisIdx, placedIdx, color) => {
          const { vec } = AXES[axisIdx]!;
          // Centre-anchored so all 4 cells stay in bounds for any axis sign.
          const centre: Coord = [4, 4, 4];
          const cells: Coord[] = [];
          for (let i = 0; i < 4; i++) {
            const off = i - 2;
            cells.push([
              centre[0] + off * vec[0],
              centre[1] + off * vec[1],
              centre[2] + off * vec[2],
            ]);
          }
          for (const c of cells) expect(inBounds(c, 9)).toBe(true);
          const placed = cells[placedIdx]!;
          const pieces: Record<string, Player> = {};
          cells.forEach((c, i) => {
            if (i !== placedIdx) pieces[keyOf(c)] = color;
          });
          const s = placePiece(stateWith(pieces, color), placed);
          expect(s.winner).toBeNull();
        },
      ),
    );
  });
});
