/**
 * PURE history-slider view-model (Task 5.6) — render-ui design Part 6 "Widget roster: history
 * slider (read-only local scrubber over `game.stateAt(k)`)"; GLOSSARY "History slider". The
 * companion DOM glue is `historySlider.ts`; the state it scrubs comes from the scene's `Game`
 * (`src/core/game.ts` `stateAt(k)` / `ply()`), the O(1) per-ply snapshot cache.
 *
 * The history slider is a **read-only, local** cursor: sliding back renders an EARLIER derived
 * state for the local viewer only (later pieces vanish for this viewer); reaching the end snaps
 * back to live. It emits/syncs/mutates NOTHING — distinct from `undo` (a real, synced game
 * action). All of that "distinct-from-undo" contract lives in the scene seam + this model, never
 * in the `Game`.
 *
 * What is PURE here (this file) vs IO glue (`historySlider.ts` / the scene's scrub seam):
 *   - PURE: `resolveScrub` (a raw slider input value + the live ply → the CLAMPED viewed ply and
 *     whether that is live), and `deriveSlider` (the ply/max/viewed facts → the serializable
 *     view-model the DOM renders: range bounds, value, `atLive`, and the human label). Both are
 *     DOM-free, THREE-free, deterministic derivations, so they earn the strict unit + mutation
 *     gate exactly as {@link ./bannerModel.ts} / {@link ./netModel.ts} do.
 *   - IO glue: the actual `<input type=range>`, its `input` events, the scene's `scrubTo(k)` that
 *     re-renders `game.stateAt(k)` locally, and the `getHistory()` readout — all in the widget /
 *     scene (Playwright-verified).
 *
 * Every derivation is deterministic and the clamp has negative cases (a below-range or above-range
 * raw value is pulled back into `0..max`, and a non-finite value is treated as live), so an
 * out-of-range drag can never render a nonexistent snapshot (agent-principles: genuine tests,
 * negative cases; #3 observable behavior).
 *
 * HISTORY CONTROLS (issue #44): the Undo / Redo / Reset controls MOVED here from `bannerModel.ts`.
 * They belong under the slider — the slider IS the history widget — so their reachability→button
 * derivation (`deriveHistoryControls`) lives beside `deriveSlider`, sharing the same strict unit +
 * mutation gate. The buttons dispatch the SAME command ids a keybinding fires (design Principle 3,
 * "one action layer"); the widget renders them under the range and forwards clicks to `dispatch`.
 */

/**
 * The live history facts the model derives from — read off the scene's `Game`. `maxPly` is the
 * highest reachable ply (`game`'s snapshot count minus one: ply 0 is the initial state, ply k the
 * state after k committed placements, including any redo tail). `viewedPly` is the ply the local
 * viewer is currently looking at: `maxPly` when live, or an earlier ply while scrubbing back.
 */
export interface HistoryFacts {
  /** The highest reachable ply — the live head (and the slider's max). Always `>= 0`. */
  readonly maxPly: number;
  /** The ply currently rendered for the local viewer (`0..maxPly`). Equals `maxPly` when live. */
  readonly viewedPly: number;
}

/** The serializable history-slider view-model the DOM widget renders (and Playwright asserts on). */
export interface SliderModel {
  /** The slider's minimum value — always ply 0 (the initial, empty board). */
  readonly min: number;
  /** The slider's maximum value — the live head ply (`maxPly`). */
  readonly max: number;
  /** The slider's current value — the viewed ply (`0..max`). */
  readonly value: number;
  /**
   * Whether the viewer is at the live head (`viewedPly === maxPly`). The widget shows/hides its
   * "reviewing history" hint and the scene renders the live state exactly when this is true.
   */
  readonly atLive: boolean;
  /**
   * Whether the slider can move at all — false only for a pristine game (`maxPly === 0`, no plies
   * to scrub). The widget disables the range input then (nothing to review).
   */
  readonly enabled: boolean;
  /** The human position label, e.g. `Move 3 / 5` at ply 3 of 5, or `Live` at the head. */
  readonly label: string;
}

/** The result of resolving a raw slider input into a viewed ply: the clamped ply + live flag. */
export interface ScrubResolution {
  /** The clamped viewed ply, always in `0..maxPly`. */
  readonly viewedPly: number;
  /** Whether the resolved ply is the live head (`viewedPly === maxPly`). */
  readonly atLive: boolean;
}

/**
 * Resolve a raw slider input `value` against the live `maxPly` into the clamped viewed ply and
 * whether that is the live head. Pure and total:
 *   - a non-finite `value` (NaN / ±Infinity — a defensive guard against a bad DOM read) is treated
 *     as **live** (the head), never a nonexistent snapshot;
 *   - a below-range value clamps up to `0`; an above-range value clamps down to `maxPly`;
 *   - a fractional value is floored (slider steps are integers, but a programmatic drive might not
 *     be), so the viewed ply is always an integer snapshot index.
 *
 * `atLive` is derived from the CLAMPED ply (`=== maxPly`), so dragging to or past the end always
 * reports live — the "end snaps to live" contract (GLOSSARY "History slider").
 *
 * @param value  The raw slider value (an `<input type=range>` value, or a programmatic drive).
 * @param maxPly The live head ply (`game`'s highest reachable ply). Must be `>= 0`.
 */
export function resolveScrub(value: number, maxPly: number): ScrubResolution {
  if (!Number.isFinite(value)) {
    return { viewedPly: maxPly, atLive: true };
  }
  const floored = Math.floor(value);
  // Clamp into `0..maxPly`. Using min/max (not `<`/`>` ternaries) keeps the boundary killable:
  // a min↔max swap changes the result at the exact ply-0 / ply-maxPly boundaries the tests hit,
  // where the equivalent `<`-vs-`<=` mutants would otherwise survive.
  const clamped = Math.max(0, Math.min(maxPly, floored));
  return { viewedPly: clamped, atLive: clamped === maxPly };
}

/**
 * Derive the {@link SliderModel} from the live {@link HistoryFacts}. Pure and deterministic:
 *   - **min** is always 0; **max** is `maxPly`; **value** is the clamped `viewedPly`.
 *   - **atLive** is `viewedPly === maxPly` (after clamping viewedPly into `0..maxPly`, so a stale
 *     out-of-range fact can never mislabel the position).
 *   - **enabled** is `maxPly > 0` — a pristine game has no plies to scrub.
 *   - **label** is `Live` at the head, else `Move {viewedPly} / {maxPly}`.
 *
 * @param facts The live history facts read off the scene's `Game`.
 * @returns The serializable model the DOM renders.
 */
export function deriveSlider(facts: HistoryFacts): SliderModel {
  // Floor a defensive negative maxPly to 0 and clamp viewedPly into `0..max` — via min/max (not
  // `<`/`>` ternaries) so the ply-0 / ply-max boundaries stay killable (see resolveScrub).
  const max = Math.max(0, facts.maxPly);
  const viewed = Math.max(0, Math.min(max, facts.viewedPly));
  const atLive = viewed === max;
  return {
    min: 0,
    max,
    value: viewed,
    atLive,
    enabled: max > 0,
    label: atLive ? 'Live' : `Move ${viewed} / ${max}`,
  };
}

/**
 * The three history controls, in display order. Each maps to a command id (design Principle 3, one
 * action layer): a button and a hotkey fire the identical command. MOVED here from `bannerModel.ts`
 * (issue #44) — the controls now render under the history slider, their conceptual home.
 */
export const HISTORY_COMMANDS = {
  undo: 'undo',
  redo: 'redo',
  reset: 'reset',
} as const;

/**
 * History-reachability flags supplied by the scene (owner of the `Game`), not read from state.
 * Drive whether each of Undo / Redo / Reset is currently enabled. This is a *history* fact — a
 * single immutable `GameState` snapshot cannot know its own ply or redo tail — so the scene computes
 * it and the model turns it into per-button `enabled` flags (never inferred from the piece map).
 */
export interface HistoryControls {
  /** Whether an undo is possible right now (a committed placement exists to undo). */
  readonly canUndo: boolean;
  /** Whether a redo is possible right now (a previously-undone placement remains). */
  readonly canRedo: boolean;
  /** Whether a reset is possible right now (any move has been made / game is not pristine). */
  readonly canReset: boolean;
}

/** A single rendered history control: its command id, label, and whether it is enabled. */
export interface HistoryButton {
  /** The stable command id dispatched on click — identical to the keybinding's command. */
  readonly commandId: string;
  /** The human label shown on the button (e.g. `'Undo'`). */
  readonly label: string;
  /** Whether the button is enabled; a disabled button dispatches nothing. */
  readonly enabled: boolean;
}

/**
 * Derive the ordered Undo / Redo / Reset controls from the scene-supplied reachability flags. Pure
 * and deterministic: each button's `enabled` follows its MATCHING flag (never another's bit), the
 * order is fixed (Undo, Redo, Reset), and each carries the stable command id the widget dispatches.
 *
 * @param history The history-reachability flags (`canUndo` / `canRedo` / `canReset`) the scene
 *   computes from its `Game` — never inferred from the piece map here.
 * @returns The ordered button set with each button's `enabled` flag.
 */
export function deriveHistoryControls(history: HistoryControls): readonly HistoryButton[] {
  return [
    { commandId: HISTORY_COMMANDS.undo, label: 'Undo', enabled: history.canUndo },
    { commandId: HISTORY_COMMANDS.redo, label: 'Redo', enabled: history.canRedo },
    { commandId: HISTORY_COMMANDS.reset, label: 'Reset', enabled: history.canReset },
  ];
}
