/**
 * PURE score/status banner view-model (Task 5.2) — render-ui design Part 6.
 *
 * The status banner shows the current player and each player's capture-pair count (design Part 6
 * "Widget roster"; GLOSSARY "Capture pair"). Turning a live {@link GameState} into the serializable
 * view-model the DOM renders is a DOM-free, deterministic derivation, so it earns the strict unit +
 * mutation gate. The `banner.ts` widget is the DOM IO glue (Playwright).
 *
 * The state (a {@link GameState}) gives whose **turn** it is, the per-player **captures**, and the
 * **winner** (`null` while in progress). When the game is won the banner announces the winner
 * instead of a turn — a placement can no longer happen, so "whose turn" is moot.
 *
 * HISTORY CONTROLS MOVED (issue #44): the Undo / Redo / Reset buttons — and their reachability→
 * enabled derivation — relocated to the history slider (`sliderModel.ts` `deriveHistoryControls`),
 * their conceptual home (directly under the slider). The banner no longer renders them; it is now a
 * pure score/status readout.
 */

import type { GameState, Player } from '../../core/gameState.ts';

/**
 * The visible divider rendered between the two capture-score labels (issue #14). A U+00B7 MIDDLE
 * DOT reads cleanly as `White: 0 · Black: 0`. Named so the model, the widget, and its tests share
 * one source of truth for the glyph.
 */
export const CAPTURES_SEPARATOR = '·';

/** The serializable banner view-model the DOM widget renders (and Playwright asserts on). */
export interface BannerModel {
  /**
   * The status line's kind: `'turn'` while the game is in progress (announce whose move it is),
   * `'winner'` once the game is won (announce the winner — turn is moot).
   */
  readonly status: 'turn' | 'winner';
  /** The player the status refers to: the player to move (`turn`) or the winner. */
  readonly player: Player;
  /** Capture-pair count for white (GLOSSARY "Capture pair"). */
  readonly whiteCaptures: number;
  /** Capture-pair count for black. */
  readonly blackCaptures: number;
  /**
   * White's fully-formatted score label (`'White: 0'`). The `'Name: N'` formatting lives here in
   * the pure model, not the DOM glue, so it is the single source of truth for the score text and
   * is exactly assertable under the unit + mutation gate (issue #14).
   */
  readonly whiteCapturesLabel: string;
  /** Black's fully-formatted score label (`'Black: 0'`). */
  readonly blackCapturesLabel: string;
  /**
   * The visible divider the DOM places BETWEEN the two capture labels (a middle dot, `'·'`). It is a
   * non-blank glyph on purpose: issue #14 was the two labels rendering adjacent (`'White: 0Black: 0'`)
   * with nothing between them, so the model owns an explicit separator the widget can render.
   */
  readonly capturesSeparator: string;
}

/**
 * Derive the {@link BannerModel} from the live game state.
 *
 * @param state The current {@link GameState} (turn / captures / winner).
 * @returns The serializable banner view-model: status (turn vs winner + the player it names) and
 *   both capture counts (raw + formatted labels + the divider).
 */
export function deriveBanner(state: GameState): BannerModel {
  // Once won, announce the winner (a placement can no longer happen, so "whose turn" is moot);
  // otherwise announce whose move it is.
  const status: 'turn' | 'winner' = state.winner !== null ? 'winner' : 'turn';
  const player: Player = state.winner !== null ? state.winner : state.turn;

  return {
    status,
    player,
    whiteCaptures: state.captures.white,
    blackCaptures: state.captures.black,
    whiteCapturesLabel: `White: ${state.captures.white}`,
    blackCapturesLabel: `Black: ${state.captures.black}`,
    capturesSeparator: CAPTURES_SEPARATOR,
  };
}
