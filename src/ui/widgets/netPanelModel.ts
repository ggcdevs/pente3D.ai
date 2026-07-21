/**
 * PURE Network-Game-panel view-model (Task C.2 — GitHub issue #13, the game-code picker). The
 * companion DOM glue is `netPanel.ts` (the drawer panel wiring Host/Join to the existing
 * `hostGame`/`joinGame`/`setPendingJoinCode` seams). Picker design resolved on issue #13:
 *
 *   Flow = ONE game-code field fed by a picker with three SOURCES, then a Host button (create this
 *   room) and a Join button (enter this room). One shared code, two actions.
 *     - CUSTOM — the user types a code.
 *     - SAVED  — the user picks a previously-used code from the recent-codes store (C.1).
 *     - RANDOM — an unambiguous-alphabet code generated via `generateGameCode` (netModel).
 *
 * This module owns the PURE decisions the panel makes: which source is active, what the EFFECTIVE
 * code is for that source, whether that effective code is {@link validateGameCode}-valid (so Host /
 * Join are enabled), and the human error for an invalid custom code. Turning the picker state +
 * the recent-codes list into the serializable model the DOM renders is DOM-free and deterministic,
 * so it earns the strict unit + mutation gate exactly as {@link ./netModel.ts} does. The `netPanel.ts`
 * widget is the DOM/dispatch IO glue (Playwright): it dispatches the SAME `hostGame`/`joinGame`
 * command ids a keybinding would (design Principle 3, one action layer) and records the used code
 * into the C.1 store.
 *
 * The effective code is derived, never a fourth stored copy: CUSTOM reads the typed text, SAVED
 * reads the chosen saved code, RANDOM reads the last generated code. A random source with no code
 * yet generated (the panel generates one on open) yields an empty effective code — Host/Join stay
 * disabled until one is present, so the buttons never dispatch an empty code (agent-principles:
 * negative cases; #3 observable behavior). Validation reuses the SAME `validateGameCode` the join
 * path uses, so the panel can never enable Host/Join for a code the transport would then reject.
 */

import { validateGameCode, type CodeError, CODE_ERROR_TEXT } from './netModel.ts';

/** The three picker sources feeding the single game-code field (issue #13). */
export type NetPanelSource =
  /** The user types a custom code. */
  | 'custom'
  /** The user picks a previously-used code from the recent-codes store (C.1). */
  | 'saved'
  /** A randomly-generated unambiguous-alphabet code. */
  | 'random';

/**
 * The picker's editable state — the single source of truth the DOM reflects and the pure mutations
 * below transform. Each source keeps its own field so switching source and back is lossless (a typed
 * custom code survives a peek at the saved list). The EFFECTIVE code is DERIVED from `source` +
 * these fields by {@link deriveNetPanel}, never stored separately.
 */
export interface NetPanelState {
  /** Which source is currently active. */
  readonly source: NetPanelSource;
  /** The raw text typed in the custom field (any case / whitespace; validated on derive). */
  readonly custom: string;
  /** The saved code currently chosen from the dropdown, or `null` when none is chosen. */
  readonly saved: string | null;
  /** The last generated random code, or `null` before one has been generated. */
  readonly random: string | null;
}

/** The initial picker state: RANDOM source (a code is generated on open), empty custom/saved. */
export function initialNetPanel(): NetPanelState {
  return { source: 'random', custom: '', saved: null, random: null };
}

/** Switch the active source (pure). Leaves every per-source field untouched (lossless switch). */
export function setPanelSource(state: NetPanelState, source: NetPanelSource): NetPanelState {
  return { ...state, source };
}

/**
 * Set the custom typed code AND make CUSTOM the active source (pure). Typing is an explicit choice
 * of the custom source, so a keystroke both records the text and selects custom — the field the user
 * is editing is the one the effective code reads from, with no separate "switch to custom" step.
 */
export function setPanelCustom(state: NetPanelState, custom: string): NetPanelState {
  return { ...state, custom, source: 'custom' };
}

/**
 * Choose a saved code AND make SAVED the active source (pure). Picking from the dropdown is an
 * explicit choice of the saved source, mirroring {@link setPanelCustom}.
 */
export function setPanelSaved(state: NetPanelState, saved: string): NetPanelState {
  return { ...state, saved, source: 'saved' };
}

/**
 * Record a freshly-generated random code AND make RANDOM the active source (pure). The generation
 * itself (drawing from the alphabet via an injected rng) is `generateGameCode` in `netModel.ts`; this
 * only stores the result and selects the random source, so the model stays deterministic under test.
 */
export function setPanelRandom(state: NetPanelState, random: string): NetPanelState {
  return { ...state, random, source: 'random' };
}

/** A saved-code option the dropdown renders (its value; newest-first order comes from the store). */
export interface NetPanelSavedOption {
  /** The canonical saved code. */
  readonly code: string;
  /** Whether this option is the currently-chosen saved code. */
  readonly selected: boolean;
}

/** The serializable Network-Game-panel view-model the DOM renders (and Playwright asserts on). */
export interface NetPanelModel {
  /** The active source (drives which picker control is highlighted). */
  readonly source: NetPanelSource;
  /** The raw custom text to show in the custom field. */
  readonly customText: string;
  /** The saved-code dropdown options, newest-first, with the chosen one flagged. */
  readonly savedOptions: readonly NetPanelSavedOption[];
  /** The generated random code to show (or `null` before one is generated). */
  readonly randomCode: string | null;
  /**
   * The EFFECTIVE code the single field shows for the active source — the raw custom text, the chosen
   * saved code, or the generated random code. May be an empty string (custom untouched / no random
   * generated yet); {@link codeValid} then governs whether the buttons are enabled.
   */
  readonly effectiveCode: string;
  /**
   * The CANONICAL (trimmed, upper-cased) effective code when it validates, or `null` when it does
   * not — this is exactly what the widget stashes via `setPendingJoinCode` and records into the C.1
   * store, so the panel never hands a malformed code to the transport or the store.
   */
  readonly canonicalCode: string | null;
  /** Whether the effective code validates (so Host + Join are enabled). */
  readonly codeValid: boolean;
  /**
   * The human error for the effective code when it is invalid, or `null` when valid. Reuses the SAME
   * {@link CODE_ERROR_TEXT} labels the inline join validation uses (SSOT), so the panel and the join
   * path never disagree on why a code is rejected.
   */
  readonly codeError: string | null;
}

/**
 * Derive the {@link NetPanelModel} from the picker {@link NetPanelState} + the recent-codes list.
 * Pure and deterministic:
 *   - **effectiveCode** — the field feeding Host/Join for the active source: `custom` → the raw typed
 *     text; `saved` → the chosen saved code (or `''` when none is chosen); `random` → the generated
 *     code (or `''` before one is generated).
 *   - **canonicalCode / codeValid / codeError** — run the effective code through the SAME
 *     {@link validateGameCode} the join path uses. A valid code yields its canonical form and
 *     enables the buttons; an invalid one yields `null` + the human reason and disables them.
 *   - **savedOptions** — the recent codes verbatim (already newest-first, deduped, canonical from the
 *     C.1 store), each flagged if it is the chosen saved code.
 *
 * @param state The picker state.
 * @param recentCodes The recent codes (newest-first, canonical) from the C.1 store.
 * @returns The serializable model the DOM renders.
 */
export function deriveNetPanel(
  state: NetPanelState,
  recentCodes: readonly string[],
): NetPanelModel {
  const effectiveCode = effectiveCodeFor(state);
  const validation = validateGameCode(effectiveCode);
  const codeValid = validation.ok;
  const canonicalCode = validation.ok ? validation.code : null;
  const codeError = validation.ok ? null : codeErrorText(validation.reason);

  const savedOptions: NetPanelSavedOption[] = recentCodes.map((code) => ({
    code,
    selected: code === state.saved,
  }));

  return {
    source: state.source,
    customText: state.custom,
    savedOptions,
    randomCode: state.random,
    effectiveCode,
    canonicalCode,
    codeValid,
    codeError,
  };
}

/** The effective code for the active source (the branch-per-source core of {@link deriveNetPanel}). */
function effectiveCodeFor(state: NetPanelState): string {
  switch (state.source) {
    case 'custom':
      return state.custom;
    case 'saved':
      return state.saved ?? '';
    case 'random':
      return state.random ?? '';
  }
}

/** Map a validation reason to its human label (SSOT: the same table the inline join error uses). */
function codeErrorText(reason: CodeError): string {
  return CODE_ERROR_TEXT[reason];
}
