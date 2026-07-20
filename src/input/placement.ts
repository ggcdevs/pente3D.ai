/**
 * PURE placement + temp-mode wiring (Task 4.8).
 *
 * Two pieces of pure interaction logic, both THREE-free / DOM-free so they earn the strict
 * unit + mutation gate — the Three.js picking (`picking.ts`) and the scene glue (`scene.ts`,
 * `pieces.ts`) that raycast pointers, push/pop the scope, and render the translucent preview
 * are the IO boundary, verified by Playwright.
 *
 *   1. **`placementFromHit`** — the "click an empty node → `place`" rule (build plan Task
 *      4.8). A raycast hit (from `picking.ts`) resolves to a placeable coord ONLY when it is
 *      an **empty node**; a placed sphere (occupied), a gridline, or a miss (`null`) is not
 *      placeable. Placing onto an occupied node / a line is meaningless, and the core
 *      `placePiece` would reject the former anyway — this keeps the illegal cases from ever
 *      reaching the rules layer, and cleanly distinguishes "clicked nothing to place" from a
 *      genuine illegal move.
 *
 *   2. **The temp-placement state machine** + its `tempPlacement` scope (GLOSSARY "Temporary
 *      placement mode"; game-core Part 4). `t` enters a preview mode; moving the pointer sets
 *      the previewed node (a translucent piece the scene draws); `Enter` **confirms** —
 *      yielding the coord to commit as a real `place` and exiting — while `t` again **exits**,
 *      discarding the preview. The model is immutable: every transition returns a NEW state,
 *      so the caller can hold history without aliasing surprises (mirrors `scopes.ts`).
 *
 * The `tempPlacement` scope is **non-blocking** (game-core Part 4: modes don't block, so
 * camera keys still fall through under a preview). Its bindings come from config verbatim —
 * the confirm/exit chords are rebindable like any keybinding, never hardcoded here.
 */

import { coordsOf, type Coord } from '../core/coords.ts';
import type { NodeKey } from '../core/coords.ts';
import type { RaycastHit } from '../render/hover.ts';
import type { CommandId, Scope } from './scopes.ts';

/** The scope id temp mode pushes — a human id for diagnostics + `window.__pente` readouts. */
export const TEMP_SCOPE_ID = 'tempPlacement';

/** The command id the base (game) scope binds to *enter* temp mode. */
export const ENTER_TEMP_COMMAND = 'enterTempMode';
/** The command id the temp scope rebinds the enter-key to (so the same key toggles out). */
export const EXIT_TEMP_COMMAND = 'exitTempMode';
/** The command id that confirms the preview (retained from the base bindings in temp scope). */
export const CONFIRM_TEMP_COMMAND = 'confirmTempPiece';

/**
 * The immutable temp-placement model. `active` is the mode flag (set by `t`); `preview` is
 * the currently previewed node key (the translucent piece), or `null` when nothing is
 * previewed yet. A confirm is only meaningful when both are set.
 */
export interface TempPlacement {
  /** Whether temp-placement mode is currently active (a preview is being examined). */
  readonly active: boolean;
  /** The previewed node key (translucent piece), or `null` if none is previewed. */
  readonly preview: NodeKey | null;
}

/** The outcome of a confirm: the coord to commit (or `null`) plus the resulting model. */
export interface ConfirmResult {
  /** The coord to place as a real piece, or `null` when there is nothing to confirm. */
  readonly commit: Coord | null;
  /** The model after the confirm (mode exits on a real commit; unchanged otherwise). */
  readonly next: TempPlacement;
}

/** The initial temp-placement model: inactive, no preview. */
export function initialTemp(): TempPlacement {
  return { active: false, preview: null };
}

/**
 * Resolve a raycast hit to the coord to place, or `null`. Only an **empty node** is
 * placeable — a placed sphere (occupied), a gridline, or a miss yields `null`, so an illegal
 * or meaningless click never reaches the rules layer.
 */
export function placementFromHit(hit: RaycastHit | null): Coord | null {
  if (hit === null) return null;
  if (hit.kind === 'empty-node') return coordsOf(hit.node);
  return null;
}

/** Enter temp-placement mode: active, with no preview yet. */
export function enterTemp(): TempPlacement {
  return { active: true, preview: null };
}

/**
 * Set (or move) the previewed node while active. A no-op when inactive — a pointer move must
 * never conjure a preview outside temp mode. Immutable: returns a new model.
 */
export function setTempPreview(state: TempPlacement, node: NodeKey): TempPlacement {
  if (!state.active) return state;
  return { active: true, preview: node };
}

/**
 * Confirm the preview. With an active preview, returns the coord to commit and an exited
 * model (a confirmed piece leaves temp mode). With no preview (or inactive), commits nothing
 * and leaves the model unchanged — `Enter` is inert until a preview exists.
 */
export function confirmTemp(state: TempPlacement): ConfirmResult {
  if (!state.active || state.preview === null) {
    return { commit: null, next: state };
  }
  return { commit: coordsOf(state.preview), next: initialTemp() };
}

/** Exit temp-placement mode, discarding the mode flag AND any preview. */
export function exitTemp(_state: TempPlacement): TempPlacement {
  return initialTemp();
}

/**
 * Build the `tempPlacement` {@link Scope} pushed when temp mode is entered, DERIVED from the
 * base (game) keybindings so it needs no separate config and hardcodes no chord (rebindable —
 * game-core Part 2 "everything is config"). The rule (game-core Part 4's worked example —
 * "`game` binds `t → enterTempMode`; pushing `tempPlacement` binds `t → exitTempMode` and
 * `Enter → confirmTempPiece`"):
 *   - every key bound to **`enterTempMode`** is rebound to **`exitTempMode`**, so the SAME key
 *     that opened temp mode closes it (whatever the user rebound `t` to follows automatically);
 *   - every key bound to **`confirmTempPiece`** is kept (that is the confirm gesture);
 *   - **all other bindings are dropped**, so unrelated keys fall THROUGH the (non-blocking)
 *     preview to the game scope — camera controls still work under a preview.
 *
 * **Non-blocking**: an unbound key is not swallowed, it falls through (game-core Part 4).
 */
export function tempPlacementScope(base: Readonly<Record<string, CommandId>>): Scope {
  const bindings: Record<string, CommandId> = {};
  for (const [key, command] of Object.entries(base)) {
    if (command === ENTER_TEMP_COMMAND) bindings[key] = EXIT_TEMP_COMMAND;
    else if (command === CONFIRM_TEMP_COMMAND) bindings[key] = command;
  }
  return { id: TEMP_SCOPE_ID, bindings, blocking: false };
}
