import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { initialState, IllegalMove, type GameState } from './gameState';
import { placePiece } from './placePiece';
import { keyOf, type Coord } from './coords';

describe('placePiece — placement', () => {
  it('places the current color on an empty node', () => {
    const s = placePiece(initialState(9), [4, 4, 4]);
    expect(s.pieces[keyOf([4, 4, 4])]).toBe('white');
  });

  it('flips the turn after a placement', () => {
    const s = placePiece(initialState(9), [4, 4, 4]);
    expect(s.turn).toBe('black');
    const s2 = placePiece(s, [0, 0, 0]);
    expect(s2.turn).toBe('white');
    expect(s2.pieces[keyOf([0, 0, 0])]).toBe('black');
  });

  it('returns a new state and does not mutate the original', () => {
    const orig = initialState(9);
    const before = JSON.stringify(orig);
    const next = placePiece(orig, [4, 4, 4]);
    expect(next).not.toBe(orig);
    expect(next.pieces).not.toBe(orig.pieces);
    // Original is untouched.
    expect(JSON.stringify(orig)).toBe(before);
    expect(orig.pieces).toEqual({});
    expect(orig.turn).toBe('white');
  });
});

describe('placePiece — validation', () => {
  it('throws IllegalMove when the node is already occupied', () => {
    const s = placePiece(initialState(9), [4, 4, 4]);
    expect(() => placePiece(s, [4, 4, 4])).toThrow(IllegalMove);
  });

  it('throws IllegalMove when placing out of bounds (>= size)', () => {
    expect(() => placePiece(initialState(9), [9, 0, 0])).toThrow(IllegalMove);
  });

  it('throws IllegalMove when placing out of bounds (negative)', () => {
    expect(() => placePiece(initialState(9), [-1, 0, 0])).toThrow(IllegalMove);
  });

  it('throws IllegalMove when the game already has a winner', () => {
    const won: GameState = { ...initialState(9), winner: 'white' };
    expect(() => placePiece(won, [4, 4, 4])).toThrow(IllegalMove);
  });
});

describe('placePiece — immutability property', () => {
  it('never mutates the input state for any legal placement', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 0, max: 8 }),
        (x, y, z) => {
          const orig = initialState(9);
          const snapshot = JSON.stringify(orig);
          const coord: Coord = [x, y, z];
          placePiece(orig, coord);
          expect(JSON.stringify(orig)).toBe(snapshot);
        },
      ),
    );
  });

  it('replaying the same move sequence yields identical states', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.integer({ min: 0, max: 8 }),
            fc.integer({ min: 0, max: 8 }),
            fc.integer({ min: 0, max: 8 }),
          ),
          { minLength: 0, maxLength: 20 },
        ),
        (rawMoves) => {
          // Dedupe to keep every move legal (distinct empty nodes).
          const seen = new Set<string>();
          const moves: Coord[] = [];
          for (const [x, y, z] of rawMoves) {
            const k = `${x},${y},${z}`;
            if (seen.has(k)) continue;
            seen.add(k);
            moves.push([x, y, z]);
          }
          const play = (): GameState => {
            let s = initialState(9);
            for (const m of moves) s = placePiece(s, m);
            return s;
          };
          expect(JSON.stringify(play())).toBe(JSON.stringify(play()));
        },
      ),
    );
  });
});
