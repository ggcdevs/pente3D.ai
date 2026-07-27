/**
 * The regression test for a MEASURING INSTRUMENT that lied.
 *
 * The daemon tracked `lastMove` by diffing placements and never invalidated it, so after an undo the
 * CLI reported a "last move" naming a stone that was no longer on the board. The probe that found it
 * was two lines of a scenario:
 *
 *     move 2,2,2  → lastMove === '2,2,2'                          ✓
 *     undo        → lastMove names a stone that is ON the board    ✗  (lastMove=2,2,2 pieces=[] ply=0)
 *
 * Every case below is that invariant, stated as a rule: **whatever `lastMoveOf` returns is either
 * `null` or a node the game currently holds.** `cli/scenarios/last-move-truth.ts` asserts the same
 * thing through the real daemon over the relay; this pins the derivation itself.
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/game';
import { lastMoveOf, lastPlacedNode } from './lastMove';
import type { GameState } from '../src/core/gameState';

const SIZE = 5;

/**
 * The invariant the whole file exists for: a reported last move is a stone that is really there.
 * Asserted with `toContain` so a failure prints the reported key AND the board it was not on.
 */
function assertOnBoard(game: Game): void {
  const key = lastMoveOf(game);
  if (key === null) return;
  expect(Object.keys(game.state().pieces)).toContain(key);
}

describe('lastMoveOf — the reported last move is always a stone that is on the board', () => {
  it('is null on a fresh game (there is no last move to name)', () => {
    const game = new Game(SIZE);
    expect(lastMoveOf(game)).toBeNull();
    assertOnBoard(game);
  });

  it('is null with no live engine (offline)', () => {
    expect(lastMoveOf(null)).toBeNull();
  });

  it('names the move just played', () => {
    const game = new Game(SIZE);
    game.place([2, 2, 2]);
    expect(lastMoveOf(game)).toBe('2,2,2');
    assertOnBoard(game);
  });

  it('follows the SECOND move, not the first', () => {
    const game = new Game(SIZE);
    game.place([2, 2, 2]);
    game.place([0, 0, 0]);
    expect(lastMoveOf(game)).toBe('0,0,0');
    assertOnBoard(game);
  });

  it('THE BUG: after an undo it does not name the stone that was taken back', () => {
    const game = new Game(SIZE);
    game.place([2, 2, 2]);
    game.place([0, 0, 0]);
    game.undo();
    // The undone stone is gone from the board; the move before it is now the last one.
    expect(game.state().pieces['0,0,0']).toBeUndefined();
    expect(lastMoveOf(game)).toBe('2,2,2');
    assertOnBoard(game);
  });

  it('THE BUG, at the boundary: undone all the way back to an empty board it is null', () => {
    const game = new Game(SIZE);
    game.place([2, 2, 2]);
    game.undo();
    expect(game.ply()).toBe(0);
    expect(Object.keys(game.state().pieces)).toEqual([]);
    // Previously: '2,2,2' — a last move on a board with no stones at all.
    expect(lastMoveOf(game)).toBeNull();
    assertOnBoard(game);
  });

  it('follows a redo back forward', () => {
    const game = new Game(SIZE);
    game.place([2, 2, 2]);
    game.place([0, 0, 0]);
    game.undo();
    game.redo();
    expect(lastMoveOf(game)).toBe('0,0,0');
    assertOnBoard(game);
  });

  it('names the PLACED stone on a capturing move, never a captured one', () => {
    const game = new Game(SIZE);
    game.place([0, 0, 0]); // white
    game.place([1, 0, 0]); // black
    game.place([4, 0, 0]); // white, elsewhere
    game.place([2, 0, 0]); // black — the pair is now set up
    game.place([3, 0, 0]); // white closes the custodial pair: both blacks are removed
    expect(game.state().captures.white).toBe(1);
    expect(game.state().pieces['1,0,0']).toBeUndefined();
    expect(game.state().pieces['2,0,0']).toBeUndefined();
    expect(lastMoveOf(game)).toBe('3,0,0');
    assertOnBoard(game);
  });

  it('a fresh game (what a rematch reset installs) reports no last move', () => {
    const played = new Game(SIZE);
    played.place([2, 2, 2]);
    expect(lastMoveOf(played)).toBe('2,2,2');
    // `resetForRematch` swaps in a brand-new Game; the derivation carries nothing across.
    expect(lastMoveOf(new Game(SIZE))).toBeNull();
  });
});

describe('lastPlacedNode — total over any pair of states', () => {
  const state = (pieces: Record<string, 'white' | 'black'>): GameState => ({
    size: SIZE,
    pieces,
    turn: 'white',
    captures: { white: 0, black: 0 },
    winner: null,
  });

  it('returns the single added node', () => {
    expect(lastPlacedNode(state({}), state({ '1,1,1': 'white' }))).toBe('1,1,1');
  });

  it('is null when nothing was added', () => {
    expect(lastPlacedNode(state({ '1,1,1': 'white' }), state({ '1,1,1': 'white' }))).toBeNull();
  });

  it('is null when the transition only REMOVED stones (a rewind invents no move)', () => {
    expect(lastPlacedNode(state({ '1,1,1': 'white', '2,2,2': 'black' }), state({}))).toBeNull();
  });

  it('is null when two stones appeared at once — it refuses to guess which', () => {
    expect(
      lastPlacedNode(state({}), state({ '1,1,1': 'white', '2,2,2': 'black' })),
    ).toBeNull();
  });
});
