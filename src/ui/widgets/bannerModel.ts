/**
 * PURE score/status banner view-model (Task 5.2) — render-ui design Part 6.
 *
 * The status banner shows the current player, each player's capture-pair count, and Undo /
 * Redo / Reset controls (design Part 6 "Widget roster"; GLOSSARY "Capture pair"). Turning a
 * live {@link GameState} + the game's history-reachability flags into the serializable
 * view-model the DOM renders is a DOM-free, deterministic derivation, so it earns the strict
 * unit + mutation gate. The `banner.ts` widget is the DOM/dispatch IO glue (Playwright).
 *
 * Two facts drive the model:
 *   - `state` (a {@link GameState}) gives whose **turn** it is, the per-player **captures**, and
 *     the **winner** (`null` while in progress). When the game is won the banner announces the
 *     winner instead of a turn — a placement can no longer happen, so "whose turn" is moot.
 *   - `history` (`{ canUndo, canRedo, canReset }`) is a *history* fact, NOT a state fact: whether
 *     a placement can be undone / redone / any move exists to reset. `GameState` is a single
 *     immutable snapshot and cannot know its own ply or redo tail, so the scene (which owns the
 *     `Game`) supplies these; the model turns them into per-button `enabled` flags. This keeps
 *     the pure model honest — it never guesses reachability from the piece map.
 *
 * The **button set is data**, not hardcoded DOM: each entry carries its stable `commandId` (the
 * SAME id a keybinding dispatches — design Principle 3 "one action layer": a button and a hotkey
 * fire the identical command), a `label`, and an `enabled` flag. The widget renders them and, on
 * click, dispatches `commandId` — it invents no command ids of its own.
 */

import type { GameState, Player } from '../../core/gameState.ts';

/** The three banner controls, in display order. Each maps to a command id (design Principle 3). */
export const BANNER_COMMANDS = {
  undo: 'undo',
  redo: 'redo',
  reset: 'reset',
} as const;

/** History-reachability flags supplied by the scene (owner of the `Game`), not read from state. */
export interface BannerHistory {
  /** Whether an undo is possible right now (a committed placement exists to undo). */
  readonly canUndo: boolean;
  /** Whether a redo is possible right now (a previously-undone placement remains). */
  readonly canRedo: boolean;
  /** Whether a reset is possible right now (any move has been made / game is not pristine). */
  readonly canReset: boolean;
}

/** A single rendered control in the banner: its command id, label, and whether it is enabled. */
export interface BannerButton {
  /** The stable command id dispatched on click — identical to the keybinding's command. */
  readonly commandId: string;
  /** The human label shown on the button (e.g. `'Undo'`). */
  readonly label: string;
  /** Whether the button is enabled; a disabled button dispatches nothing. */
  readonly enabled: boolean;
}

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
  /** The three controls (Undo / Redo / Reset) in display order, with per-button enabled flags. */
  readonly buttons: readonly BannerButton[];
}

/**
 * Derive the {@link BannerModel} from the live game state + the scene-supplied history flags.
 *
 * @param state   The current {@link GameState} (turn / captures / winner).
 * @param history The history-reachability flags (`canUndo` / `canRedo` / `canReset`) the scene
 *   computes from its `Game` — never inferred from the piece map here.
 * @returns The serializable banner view-model: status (turn vs winner + the player it names),
 *   both capture counts, and the ordered button set with each button's `enabled` flag.
 */
export function deriveBanner(state: GameState, history: BannerHistory): BannerModel {
  // Once won, announce the winner (a placement can no longer happen, so "whose turn" is moot);
  // otherwise announce whose move it is.
  const status: 'turn' | 'winner' = state.winner !== null ? 'winner' : 'turn';
  const player: Player = state.winner !== null ? state.winner : state.turn;

  const buttons: readonly BannerButton[] = [
    { commandId: BANNER_COMMANDS.undo, label: 'Undo', enabled: history.canUndo },
    { commandId: BANNER_COMMANDS.redo, label: 'Redo', enabled: history.canRedo },
    { commandId: BANNER_COMMANDS.reset, label: 'Reset', enabled: history.canReset },
  ];

  return {
    status,
    player,
    whiteCaptures: state.captures.white,
    blackCaptures: state.captures.black,
    buttons,
  };
}
