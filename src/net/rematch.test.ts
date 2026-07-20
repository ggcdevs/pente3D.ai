import { describe, expect, it } from 'vitest';
import { shouldArchiveBeforeNetStart, shouldPromptRematch } from './rematch';
import { initialState, type GameState, type Player } from '../core/gameState';

/**
 * Strict unit + mutation gate for the PURE host/join/play-again decisions (Task 6.4, issue #4a).
 *
 * - `shouldArchiveBeforeNetStart` is consulted before a HOST or a JOIN: a played local board is
 *   archived + reset, a pristine one is just started. Both the pristine boundary (`ply === 0` →
 *   false) and the played case (`ply > 0` → true) are asserted, so no mutant that flips `>` to `>=`
 *   / `<` / `===`, or hardcodes a constant, survives.
 * - `shouldPromptRematch` is consulted when the authoritative networked game changes: a WON game
 *   prompts for another, an in-progress game does not. Both winners and the in-progress case are
 *   asserted, so a mutant that inverts the null check or hardcodes a result is killed.
 */

const PLAYERS: readonly Player[] = ['white', 'black'];

/** A GameState with an explicit winner, for the rematch-prompt decision. */
function wonState(winner: Player): GameState {
  return { ...initialState(3), winner };
}

describe('shouldArchiveBeforeNetStart', () => {
  it('does NOT archive+reset a pristine board (ply 0 — nothing worth keeping)', () => {
    // An empty board has nothing to archive; hosting/joining just starts straight onto it.
    expect(shouldArchiveBeforeNetStart(0)).toBe(false);
  });

  it('ARCHIVES+RESETS after a single played move (ply 1 is the boundary, issue #4a)', () => {
    // The exact off-by-one a `>` → `>=`/`<` mutant would break: one played piece must archive+reset.
    expect(shouldArchiveBeforeNetStart(1)).toBe(true);
  });

  it('ARCHIVES+RESETS a many-move played board (ply > 1)', () => {
    expect(shouldArchiveBeforeNetStart(7)).toBe(true);
  });

  it('is exactly "ply > 0" across a range of plies (kills off-by-one / constant mutants)', () => {
    for (let ply = 0; ply <= 5; ply += 1) {
      expect(shouldArchiveBeforeNetStart(ply)).toBe(ply > 0);
    }
  });
});

describe('shouldPromptRematch', () => {
  it('does NOT prompt while the game is in progress (no winner)', () => {
    // The pristine/in-progress authoritative state must never surface the "play another?" prompt.
    expect(shouldPromptRematch(initialState(3))).toBe(false);
  });

  it('PROMPTS once the networked game has been WON (winner set)', () => {
    // A finished networked game is not a dead end: it prompts to start another (the play-again gap).
    for (const winner of PLAYERS) {
      expect(shouldPromptRematch(wonState(winner))).toBe(true);
    }
  });

  it('is exactly "winner !== null" (kills an inverted / hardcoded winner check)', () => {
    expect(shouldPromptRematch({ ...initialState(3), winner: null })).toBe(false);
    expect(shouldPromptRematch(wonState('white'))).toBe(true);
  });
});
