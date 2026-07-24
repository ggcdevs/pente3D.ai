import { describe, it, expect } from 'vitest';
import { deriveBanner } from './bannerModel.ts';
import { initialState, type GameState, type Player } from '../../core/gameState.ts';

/**
 * Task 5.2 — the PURE score/status banner view-model (render-ui design Part 6). Given a
 * {@link GameState}, `deriveBanner` yields the serializable model the DOM renders: status (turn vs
 * winner + the player it names) and both capture-pair counts (raw + formatted labels + divider).
 * Strict unit + mutation gate: genuine assertions on the derived model plus negative cases —
 *   - a won game announces the WINNER (not the turn), naming the winning player;
 *   - capture counts come from the state's per-player map, not swapped/duplicated.
 * The Undo/Redo/Reset controls MOVED to the history slider (issue #44); their derivation is now
 * tested in `sliderModel.test.ts` (`deriveHistoryControls`). No THREE, no DOM.
 */

/** A GameState builder: start from the pristine state and override only the fields under test. */
function stateWith(over: Partial<GameState>): GameState {
  return { ...initialState(3), ...over };
}

describe('deriveBanner — status (turn vs winner)', () => {
  it('announces the TURN with the player to move while the game is in progress', () => {
    const model = deriveBanner(stateWith({ turn: 'black', winner: null }));
    expect(model.status).toBe('turn');
    expect(model.player).toBe('black');
  });

  it('announces the WINNER (not the turn) once the game is won, naming the winner', () => {
    // turn is 'white' but black won — the model must name BLACK, proving it reads `winner`,
    // not `turn`, when a winner exists (kills a mutant that always reports `turn`).
    const model = deriveBanner(stateWith({ turn: 'white', winner: 'black' }));
    expect(model.status).toBe('winner');
    expect(model.player).toBe('black');
  });

  it('reports each player as the winner when they win (both arms of the winner branch)', () => {
    for (const winner of ['white', 'black'] as Player[]) {
      const model = deriveBanner(stateWith({ winner }));
      expect(model.status).toBe('winner');
      expect(model.player).toBe(winner);
    }
  });

  it('reports each player as the turn while in progress (both arms of the turn value)', () => {
    for (const turn of ['white', 'black'] as Player[]) {
      const model = deriveBanner(stateWith({ turn, winner: null }));
      expect(model.status).toBe('turn');
      expect(model.player).toBe(turn);
    }
  });
});

describe('deriveBanner — capture counts', () => {
  it('reports each player capture-pair count from the state map, not swapped', () => {
    const model = deriveBanner(stateWith({ captures: { white: 2, black: 3 } }));
    // Distinct, asymmetric values so a white↔black swap mutant is caught.
    expect(model.whiteCaptures).toBe(2);
    expect(model.blackCaptures).toBe(3);
  });

  it('reports zero captures for a pristine game', () => {
    const model = deriveBanner(initialState(3));
    expect(model.whiteCaptures).toBe(0);
    expect(model.blackCaptures).toBe(0);
  });
});

describe('deriveBanner — formatted, visually-separated capture labels (issue #14)', () => {
  // Issue #14: the DOM rendered "White: 0Black: 0" with no separation. The formatting is owned
  // by the PURE model (single source of truth) so it can be asserted exactly here: each player
  // gets its own "Name: N" label AND the model carries an explicit non-blank separator so the DOM
  // can place a visible divider between the two labels. Asserting the SPECIFIC strings — not
  // merely "contains a space" — so a mutant that drops the label prefix, swaps the count, or blanks
  // the separator is caught.
  it('formats each capture label as "Name: N" from the state map, not swapped', () => {
    const model = deriveBanner(stateWith({ captures: { white: 2, black: 3 } }));
    expect(model.whiteCapturesLabel).toBe('White: 2');
    expect(model.blackCapturesLabel).toBe('Black: 3');
  });

  it('formats zero-capture labels for a pristine game', () => {
    const model = deriveBanner(initialState(3));
    expect(model.whiteCapturesLabel).toBe('White: 0');
    expect(model.blackCapturesLabel).toBe('Black: 0');
  });

  it('carries a middle-dot separator so the two labels render visually apart', () => {
    const model = deriveBanner(initialState(3));
    // The exact glyph the design uses to separate the scores; a blank/empty separator would
    // reproduce the "White: 0Black: 0" run-together bug, so pin the literal.
    expect(model.capturesSeparator).toBe('·');
  });

  it('the separator is non-empty and not whitespace-only (guards the #14 regression)', () => {
    const model = deriveBanner(initialState(3));
    expect(model.capturesSeparator.trim().length).toBeGreaterThan(0);
  });

  it('composing label + separator + label yields a separated line (no run-together)', () => {
    const model = deriveBanner(stateWith({ captures: { white: 1, black: 4 } }));
    const line = `${model.whiteCapturesLabel} ${model.capturesSeparator} ${model.blackCapturesLabel}`;
    expect(line).toBe('White: 1 · Black: 4');
    // The two counts are never adjacent — the exact failure mode of issue #14.
    expect(line).not.toContain('0Black');
    expect(line).not.toMatch(/\d[A-Z]/);
  });
});
