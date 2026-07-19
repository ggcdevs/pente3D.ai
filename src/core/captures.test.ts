/**
 * Custodian capture tests (Task 1.5).
 *
 * Standard Pente capture semantics (game-core design, Part 2):
 *   - Custodian, exactly two — flanking *exactly* two adjacent opponent pieces
 *     with your own along a direction removes those two and adds a capture pair.
 *   - Three-in-a-bracket is NOT captured.
 *   - Moving into a bracket is safe — you are only captured when the opponent
 *     plays the bracketing piece.
 *   - Works along all 26 directions (orthogonal, face, space).
 *   - Multiple simultaneous captures from one placement all count.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { initialState, type GameState, type Player } from './gameState';
import { placePiece } from './placePiece';
import { keyOf, type Coord } from './coords';
import { AXES } from './axes';

/** Build a state with explicit pieces, whose turn it is, captures. */
function stateWith(
  pieces: Record<string, Player>,
  turn: Player,
  captures: Record<Player, number> = { white: 0, black: 0 },
): GameState {
  return { ...initialState(9), pieces, turn, captures };
}

describe('captures — classic custodian bracket', () => {
  it('removes exactly two flanked opponents when closing the bracket', () => {
    // Layout along +x from x=1: self(1), opp(2), opp(3), then place self at 4.
    const pieces: Record<string, Player> = {
      [keyOf([1, 4, 4])]: 'white',
      [keyOf([2, 4, 4])]: 'black',
      [keyOf([3, 4, 4])]: 'black',
    };
    const s = placePiece(stateWith(pieces, 'white'), [4, 4, 4]);
    expect(s.pieces[keyOf([2, 4, 4])]).toBeUndefined();
    expect(s.pieces[keyOf([3, 4, 4])]).toBeUndefined();
    expect(s.pieces[keyOf([1, 4, 4])]).toBe('white');
    expect(s.pieces[keyOf([4, 4, 4])]).toBe('white');
    expect(s.captures.white).toBe(1);
    expect(s.captures.black).toBe(0);
  });
});

describe('captures — exactly two only', () => {
  it('does NOT capture three flanked opponents (self,opp,opp,opp,self)', () => {
    const pieces: Record<string, Player> = {
      [keyOf([1, 4, 4])]: 'white',
      [keyOf([2, 4, 4])]: 'black',
      [keyOf([3, 4, 4])]: 'black',
      [keyOf([4, 4, 4])]: 'black',
    };
    const s = placePiece(stateWith(pieces, 'white'), [5, 4, 4]);
    expect(s.pieces[keyOf([2, 4, 4])]).toBe('black');
    expect(s.pieces[keyOf([3, 4, 4])]).toBe('black');
    expect(s.pieces[keyOf([4, 4, 4])]).toBe('black');
    expect(s.captures.white).toBe(0);
  });
});

describe('captures — safe to move into a bracket', () => {
  it('placing self between two opponents is NOT captured', () => {
    // opp at 3, opp at 5; white plays into 4. white is not removed.
    const pieces: Record<string, Player> = {
      [keyOf([3, 4, 4])]: 'black',
      [keyOf([5, 4, 4])]: 'black',
    };
    const s = placePiece(stateWith(pieces, 'white'), [4, 4, 4]);
    expect(s.pieces[keyOf([4, 4, 4])]).toBe('white');
    expect(s.captures.white).toBe(0);
    expect(s.captures.black).toBe(0);
  });

  it('a single flanked opponent is NOT captured', () => {
    const pieces: Record<string, Player> = {
      [keyOf([3, 4, 4])]: 'white',
      [keyOf([4, 4, 4])]: 'black',
    };
    const s = placePiece(stateWith(pieces, 'white'), [5, 4, 4]);
    expect(s.pieces[keyOf([4, 4, 4])]).toBe('black');
    expect(s.captures.white).toBe(0);
  });
});

describe('captures — all direction categories', () => {
  it('captures along an orthogonal direction', () => {
    const dir: Coord = [1, 0, 0];
    const pieces: Record<string, Player> = {
      [keyOf([1, 4, 4])]: 'white',
      [keyOf([2, 4, 4])]: 'black',
      [keyOf([3, 4, 4])]: 'black',
    };
    void dir;
    const s = placePiece(stateWith(pieces, 'white'), [4, 4, 4]);
    expect(s.pieces[keyOf([2, 4, 4])]).toBeUndefined();
    expect(s.pieces[keyOf([3, 4, 4])]).toBeUndefined();
    expect(s.captures.white).toBe(1);
  });

  it('captures along a face-diagonal direction', () => {
    // anchor self(1,1,4), opp(2,2,4), opp(3,3,4), place self(4,4,4).
    const pieces: Record<string, Player> = {
      [keyOf([1, 1, 4])]: 'white',
      [keyOf([2, 2, 4])]: 'black',
      [keyOf([3, 3, 4])]: 'black',
    };
    const s = placePiece(stateWith(pieces, 'white'), [4, 4, 4]);
    expect(s.pieces[keyOf([2, 2, 4])]).toBeUndefined();
    expect(s.pieces[keyOf([3, 3, 4])]).toBeUndefined();
    expect(s.captures.white).toBe(1);
  });

  it('captures along a space-diagonal direction', () => {
    const pieces: Record<string, Player> = {
      [keyOf([1, 1, 1])]: 'white',
      [keyOf([2, 2, 2])]: 'black',
      [keyOf([3, 3, 3])]: 'black',
    };
    const s = placePiece(stateWith(pieces, 'white'), [4, 4, 4]);
    expect(s.pieces[keyOf([2, 2, 2])]).toBeUndefined();
    expect(s.pieces[keyOf([3, 3, 3])]).toBeUndefined();
    expect(s.captures.white).toBe(1);
  });
});

describe('captures — multiple simultaneous', () => {
  it('counts every bracket closed by one placement', () => {
    // Place white at [4,4,4]; brackets along +x and -x both close.
    const pieces: Record<string, Player> = {
      // +x bracket: opp(5), opp(6), self(7)
      [keyOf([5, 4, 4])]: 'black',
      [keyOf([6, 4, 4])]: 'black',
      [keyOf([7, 4, 4])]: 'white',
      // -x bracket: opp(3), opp(2), self(1)
      [keyOf([3, 4, 4])]: 'black',
      [keyOf([2, 4, 4])]: 'black',
      [keyOf([1, 4, 4])]: 'white',
    };
    const s = placePiece(stateWith(pieces, 'white'), [4, 4, 4]);
    expect(s.pieces[keyOf([5, 4, 4])]).toBeUndefined();
    expect(s.pieces[keyOf([6, 4, 4])]).toBeUndefined();
    expect(s.pieces[keyOf([3, 4, 4])]).toBeUndefined();
    expect(s.pieces[keyOf([2, 4, 4])]).toBeUndefined();
    expect(s.captures.white).toBe(2);
  });
});

describe('captures — no bracket, no capture', () => {
  it('a lone placement on an empty board captures nothing', () => {
    const s = placePiece(initialState(9), [4, 4, 4]);
    expect(s.captures.white).toBe(0);
    expect(s.captures.black).toBe(0);
    expect(s.pieces[keyOf([4, 4, 4])]).toBe('white');
  });

  it('does not capture when the far flank is empty (opp,opp,empty)', () => {
    const pieces: Record<string, Player> = {
      [keyOf([2, 4, 4])]: 'black',
      [keyOf([3, 4, 4])]: 'black',
    };
    const s = placePiece(stateWith(pieces, 'white'), [1, 4, 4]);
    expect(s.pieces[keyOf([2, 4, 4])]).toBe('black');
    expect(s.pieces[keyOf([3, 4, 4])]).toBe('black');
    expect(s.captures.white).toBe(0);
  });
});

describe('captures — symmetric across all 26 directions (property)', () => {
  it('a [opp,opp,self] bracket captures in every direction', () => {
    // Enumerate all 26 directions (each axis and its negation).
    const directions: Coord[] = [];
    for (const { vec } of AXES) {
      directions.push([vec[0], vec[1], vec[2]]);
      directions.push([-vec[0], -vec[1], -vec[2]]);
    }
    expect(directions.length).toBe(26);

    fc.assert(
      fc.property(fc.integer({ min: 0, max: 25 }), (di) => {
        const d = directions[di]!;
        // Center at [4,4,4]; anchor self is two steps out, opps at 1 and 2 steps.
        const center: Coord = [4, 4, 4];
        const opp1: Coord = [center[0] + d[0], center[1] + d[1], center[2] + d[2]];
        const opp2: Coord = [
          center[0] + 2 * d[0],
          center[1] + 2 * d[1],
          center[2] + 2 * d[2],
        ];
        const anchor: Coord = [
          center[0] + 3 * d[0],
          center[1] + 3 * d[1],
          center[2] + 3 * d[2],
        ];
        const pieces: Record<string, Player> = {
          [keyOf(opp1)]: 'black',
          [keyOf(opp2)]: 'black',
          [keyOf(anchor)]: 'white',
        };
        const s = placePiece(stateWith(pieces, 'white'), center);
        expect(s.pieces[keyOf(opp1)]).toBeUndefined();
        expect(s.pieces[keyOf(opp2)]).toBeUndefined();
        expect(s.captures.white).toBe(1);
      }),
    );
  });
});
