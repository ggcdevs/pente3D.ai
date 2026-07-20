import { describe, expect, it } from 'vitest';
import { canPlaceForSeat } from './turnGate';
import type { Player } from '../core/gameState';
import type { NetSeat } from '../ui/widgets/netModel';

/**
 * Strict unit + mutation gate for the PURE seat-turn decision (Task 6.2, issue #4c). The scene
 * consults this before a networked placement: it may place ONLY when it is the local seat's move, so a
 * client can never push an out-of-seat-order move onto the shared authoritative log. Every seat×turn
 * combination is asserted (positive AND negative), and the no-seat fall-through is pinned, so no mutant
 * that inverts the comparison, drops the null guard, or reads the wrong operand survives.
 */

const PLAYERS: readonly Player[] = ['white', 'black'];

describe('canPlaceForSeat', () => {
  it('ALLOWS white to place when it is white to move', () => {
    expect(canPlaceForSeat('white', 'white')).toBe(true);
  });

  it('ALLOWS black to place when it is black to move', () => {
    expect(canPlaceForSeat('black', 'black')).toBe(true);
  });

  it('BLOCKS white from placing when it is black to move (off-turn)', () => {
    // The core issue #4c guard: white must NOT push a move onto the shared log during black's turn.
    expect(canPlaceForSeat('white', 'black')).toBe(false);
  });

  it('BLOCKS black from placing when it is white to move (off-turn)', () => {
    expect(canPlaceForSeat('black', 'white')).toBe(false);
  });

  it('allows exactly when seat === turn — full seat×turn matrix', () => {
    // Exhaustive over both real seats × both turns: the result equals the seat-matches-turn predicate,
    // killing any mutant that reads the wrong operand or flips the comparison for one combination.
    for (const seat of PLAYERS) {
      for (const turn of PLAYERS) {
        expect(canPlaceForSeat(seat, turn)).toBe(seat === turn);
      }
    }
  });

  it('does NOT block when no seat is held (null) — honest non-blocking fall-through', () => {
    // Before a seat is claimed there is no turn to enforce; the gate must not block (and must not
    // depend on the turn value in this arm). Both turns are asserted so a mutant that drops the null
    // guard (falling into `null === turn` → false) is killed for at least one turn.
    const noSeat: NetSeat = null;
    expect(canPlaceForSeat(noSeat, 'white')).toBe(true);
    expect(canPlaceForSeat(noSeat, 'black')).toBe(true);
  });
});
