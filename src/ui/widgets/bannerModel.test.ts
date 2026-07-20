import { describe, it, expect } from 'vitest';
import { deriveBanner, BANNER_COMMANDS, type BannerHistory } from './bannerModel.ts';
import { initialState, type GameState, type Player } from '../../core/gameState.ts';

/**
 * Task 5.2 — the PURE score/status banner view-model (render-ui design Part 6). Given a
 * {@link GameState} + the scene's history-reachability flags, `deriveBanner` yields the
 * serializable model the DOM renders: status (turn vs winner + the player it names), both
 * capture-pair counts, and the ordered Undo/Redo/Reset button set with per-button `enabled`.
 * Strict unit + mutation gate: genuine assertions on the derived model plus negative cases —
 *   - a won game announces the WINNER (not the turn), naming the winning player;
 *   - each button's `enabled` follows the MATCHING history flag (not another flag), proven by
 *     flipping one flag at a time so no button can borrow another's bit;
 *   - capture counts come from the state's per-player map, not swapped/duplicated.
 * No THREE, no DOM.
 */

/** A GameState builder: start from the pristine state and override only the fields under test. */
function stateWith(over: Partial<GameState>): GameState {
  return { ...initialState(3), ...over };
}

const allHistory = (over: Partial<BannerHistory> = {}): BannerHistory => ({
  canUndo: true,
  canRedo: true,
  canReset: true,
  ...over,
});

describe('deriveBanner — status (turn vs winner)', () => {
  it('announces the TURN with the player to move while the game is in progress', () => {
    const model = deriveBanner(stateWith({ turn: 'black', winner: null }), allHistory());
    expect(model.status).toBe('turn');
    expect(model.player).toBe('black');
  });

  it('announces the WINNER (not the turn) once the game is won, naming the winner', () => {
    // turn is 'white' but black won — the model must name BLACK, proving it reads `winner`,
    // not `turn`, when a winner exists (kills a mutant that always reports `turn`).
    const model = deriveBanner(stateWith({ turn: 'white', winner: 'black' }), allHistory());
    expect(model.status).toBe('winner');
    expect(model.player).toBe('black');
  });

  it('reports each player as the winner when they win (both arms of the winner branch)', () => {
    for (const winner of ['white', 'black'] as Player[]) {
      const model = deriveBanner(stateWith({ winner }), allHistory());
      expect(model.status).toBe('winner');
      expect(model.player).toBe(winner);
    }
  });

  it('reports each player as the turn while in progress (both arms of the turn value)', () => {
    for (const turn of ['white', 'black'] as Player[]) {
      const model = deriveBanner(stateWith({ turn, winner: null }), allHistory());
      expect(model.status).toBe('turn');
      expect(model.player).toBe(turn);
    }
  });
});

describe('deriveBanner — capture counts', () => {
  it('reports each player capture-pair count from the state map, not swapped', () => {
    const model = deriveBanner(
      stateWith({ captures: { white: 2, black: 3 } }),
      allHistory(),
    );
    // Distinct, asymmetric values so a white↔black swap mutant is caught.
    expect(model.whiteCaptures).toBe(2);
    expect(model.blackCaptures).toBe(3);
  });

  it('reports zero captures for a pristine game', () => {
    const model = deriveBanner(initialState(3), allHistory());
    expect(model.whiteCaptures).toBe(0);
    expect(model.blackCaptures).toBe(0);
  });
});

describe('deriveBanner — button set (ids, order, labels)', () => {
  it('emits Undo/Redo/Reset in order, each bound to its command id', () => {
    const model = deriveBanner(initialState(3), allHistory());
    expect(model.buttons.map((b) => b.commandId)).toEqual([
      BANNER_COMMANDS.undo,
      BANNER_COMMANDS.redo,
      BANNER_COMMANDS.reset,
    ]);
    expect(model.buttons.map((b) => b.label)).toEqual(['Undo', 'Redo', 'Reset']);
  });

  it('binds the exact command ids the input layer dispatches (one action layer)', () => {
    // Pin the literal ids — these MUST match the scene's command registry / keybindings so a
    // button and a hotkey fire the identical command (design Principle 3).
    expect(BANNER_COMMANDS).toEqual({ undo: 'undo', redo: 'redo', reset: 'reset' });
  });
});

describe('deriveBanner — button enabled follows the matching history flag (negative)', () => {
  const byId = (model: ReturnType<typeof deriveBanner>, commandId: string) =>
    model.buttons.find((b) => b.commandId === commandId)!;

  it('all buttons enabled when every history flag is set', () => {
    const model = deriveBanner(initialState(3), allHistory());
    expect(model.buttons.map((b) => b.enabled)).toEqual([true, true, true]);
  });

  it('disables ONLY Undo when canUndo is false (others stay enabled)', () => {
    const model = deriveBanner(initialState(3), allHistory({ canUndo: false }));
    expect(byId(model, BANNER_COMMANDS.undo).enabled).toBe(false);
    expect(byId(model, BANNER_COMMANDS.redo).enabled).toBe(true);
    expect(byId(model, BANNER_COMMANDS.reset).enabled).toBe(true);
  });

  it('disables ONLY Redo when canRedo is false (others stay enabled)', () => {
    const model = deriveBanner(initialState(3), allHistory({ canRedo: false }));
    expect(byId(model, BANNER_COMMANDS.undo).enabled).toBe(true);
    expect(byId(model, BANNER_COMMANDS.redo).enabled).toBe(false);
    expect(byId(model, BANNER_COMMANDS.reset).enabled).toBe(true);
  });

  it('disables ONLY Reset when canReset is false (others stay enabled)', () => {
    const model = deriveBanner(initialState(3), allHistory({ canReset: false }));
    expect(byId(model, BANNER_COMMANDS.undo).enabled).toBe(true);
    expect(byId(model, BANNER_COMMANDS.redo).enabled).toBe(true);
    expect(byId(model, BANNER_COMMANDS.reset).enabled).toBe(false);
  });

  it('disables every button when the game is pristine (no history at all)', () => {
    const model = deriveBanner(
      initialState(3),
      { canUndo: false, canRedo: false, canReset: false },
    );
    expect(model.buttons.map((b) => b.enabled)).toEqual([false, false, false]);
  });
});
