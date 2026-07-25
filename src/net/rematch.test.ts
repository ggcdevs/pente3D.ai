import { describe, expect, it } from 'vitest';
import { rematchGameUuid, shouldArchiveBeforeNetStart, shouldPromptRematch } from './rematch';
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

/**
 * `rematchGameUuid` — the rematch game's IDENTITY. Both peers reset into the same rematch
 * independently, from state they already share (the prior game's uuid + the generation being
 * entered), so the fresh game must come out IDENTICAL on both sides without a coordination
 * round-trip. Randomly-minted ids left each peer on its own game — two archive records for one
 * rematch, converging only by the accident that an empty log is a prefix of anything.
 */
describe('rematchGameUuid — one derived id both peers arrive at independently', () => {
  it('is DETERMINISTIC: the same prior game + generation yields the same uuid (the simultaneous reset)', () => {
    // This IS the simultaneous-rematch case: two peers, both on `g-prior` at generation 0, both
    // resetting into generation 1 — no message crosses, and they land on one game anyway.
    expect(rematchGameUuid('g-prior', 1)).toBe(rematchGameUuid('g-prior', 1));
    expect(rematchGameUuid('g-prior', 7)).toBe(rematchGameUuid('g-prior', 7));
  });

  it('DIFFERS per generation — a second rematch of the same game is a different game', () => {
    const first = rematchGameUuid('g-prior', 1);
    const second = rematchGameUuid('g-prior', 2);
    expect(second).not.toBe(first);
    expect(rematchGameUuid('g-prior', 3)).not.toBe(second);
  });

  it('DIFFERS per prior game — two rooms rematching at the same generation never collide', () => {
    expect(rematchGameUuid('g-one', 1)).not.toBe(rematchGameUuid('g-two', 1));
  });

  it('never returns the prior uuid, and never an empty string', () => {
    // Returning the prior uuid would make the "fresh" game indistinguishable from the finished one
    // (the sync channel would treat the reset as same-game traffic and the old board could resurrect).
    for (const prior of ['g-prior', '', 'a'.repeat(64)]) {
      const derived = rematchGameUuid(prior, 1);
      expect(derived).not.toBe(prior);
      expect(derived.length).toBeGreaterThan(0);
    }
  });

  it('mixes the two inputs at a FIXED boundary — no shift of prior/generation can collide', () => {
    // Guards against a concatenation with no delimiter, where ("g1", 11) and ("g11", 1) would hash the
    // same string and two different rematches would claim one uuid.
    expect(rematchGameUuid('g1', 11)).not.toBe(rematchGameUuid('g11', 1));
    expect(rematchGameUuid('g', 111)).not.toBe(rematchGameUuid('g1', 11));
  });
});
