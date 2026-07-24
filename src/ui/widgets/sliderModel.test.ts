import { describe, it, expect } from 'vitest';
import {
  resolveScrub,
  deriveSlider,
  deriveHistoryControls,
  HISTORY_COMMANDS,
  type HistoryFacts,
  type HistoryControls,
  type SliderModel,
} from './sliderModel.ts';

/**
 * Task 5.6 — the PURE history-slider view-model (render-ui design Part 6; GLOSSARY "History
 * slider"). Two DOM-free, THREE-free derivations under the strict unit + mutation gate:
 *   - `resolveScrub(value, maxPly)` — a raw slider value + live head ply → the CLAMPED viewed ply
 *     and whether it is live. Negative cases: below-range clamps to 0, above-range clamps to
 *     maxPly, a fractional value is floored, and a non-finite value snaps to live — so an
 *     out-of-range drag can never render a nonexistent snapshot.
 *   - `deriveSlider(facts)` — the ply/max/viewed facts → the serializable model the DOM renders
 *     (range bounds, value, `atLive`, `enabled`, label). Negative cases: a pristine game disables
 *     the slider; a stale out-of-range viewedPly is re-clamped before labelling; the head labels
 *     `Live` while an earlier ply labels `Move k / max`.
 * Genuine assertions on the derived values (not on the inputs), one-flag-at-a-time so no field can
 * borrow another's bit. No THREE, no DOM.
 */

describe('resolveScrub — clamp + live detection', () => {
  it('resolves an in-range integer value to exactly that viewed ply, not live below the head', () => {
    const r = resolveScrub(2, 5);
    expect(r.viewedPly).toBe(2);
    expect(r.atLive).toBe(false);
  });

  it('reports atLive true exactly at the head ply (end snaps to live)', () => {
    const r = resolveScrub(5, 5);
    expect(r.viewedPly).toBe(5);
    expect(r.atLive).toBe(true);
  });

  it('clamps a below-range (negative) value up to ply 0', () => {
    const r = resolveScrub(-3, 5);
    expect(r.viewedPly).toBe(0);
    expect(r.atLive).toBe(false);
  });

  it('clamps an above-range value down to the head ply and reports live', () => {
    // 9 > maxPly 5 → clamps to 5, which IS the head, so atLive must be true (drag past end = live).
    const r = resolveScrub(9, 5);
    expect(r.viewedPly).toBe(5);
    expect(r.atLive).toBe(true);
  });

  it('floors a fractional value to an integer snapshot index', () => {
    // 3.9 must floor to 3 (a real snapshot), not round to 4 — kills a round()/ceil() mutant.
    const r = resolveScrub(3.9, 5);
    expect(r.viewedPly).toBe(3);
    expect(r.atLive).toBe(false);
  });

  it('treats a NaN value as live at the head (defensive against a bad DOM read)', () => {
    const r = resolveScrub(Number.NaN, 4);
    expect(r.viewedPly).toBe(4);
    expect(r.atLive).toBe(true);
  });

  it('treats +Infinity as live at the head (non-finite guard, not an above-range clamp path)', () => {
    const r = resolveScrub(Number.POSITIVE_INFINITY, 4);
    expect(r.viewedPly).toBe(4);
    expect(r.atLive).toBe(true);
  });

  it('treats -Infinity as live at the head (non-finite guard fires before the clamp)', () => {
    const r = resolveScrub(Number.NEGATIVE_INFINITY, 4);
    expect(r.viewedPly).toBe(4);
    expect(r.atLive).toBe(true);
  });

  it('reports live at ply 0 for a pristine game (maxPly 0): head and floor coincide', () => {
    const r = resolveScrub(0, 0);
    expect(r.viewedPly).toBe(0);
    expect(r.atLive).toBe(true);
  });
});

describe('deriveSlider — model derivation', () => {
  const facts = (over: Partial<HistoryFacts>): HistoryFacts => ({
    maxPly: 5,
    viewedPly: 5,
    ...over,
  });

  it('derives Live at the head: value=max, atLive, and the "Live" label', () => {
    const m: SliderModel = deriveSlider(facts({ maxPly: 5, viewedPly: 5 }));
    expect(m.min).toBe(0);
    expect(m.max).toBe(5);
    expect(m.value).toBe(5);
    expect(m.atLive).toBe(true);
    expect(m.enabled).toBe(true);
    expect(m.label).toBe('Live');
  });

  it('derives an earlier ply: value=viewed, not atLive, and a "Move k / max" label', () => {
    const m = deriveSlider(facts({ maxPly: 5, viewedPly: 2 }));
    expect(m.value).toBe(2);
    expect(m.max).toBe(5);
    expect(m.atLive).toBe(false);
    // The label must name the VIEWED ply and the MAX (not swapped) — kills an order-swap mutant.
    expect(m.label).toBe('Move 2 / 5');
  });

  it('disables the slider for a pristine game (maxPly 0) — nothing to review', () => {
    const m = deriveSlider(facts({ maxPly: 0, viewedPly: 0 }));
    expect(m.enabled).toBe(false);
    expect(m.max).toBe(0);
    expect(m.atLive).toBe(true);
    expect(m.label).toBe('Live');
  });

  it('enables the slider as soon as one ply exists (maxPly 1)', () => {
    const m = deriveSlider(facts({ maxPly: 1, viewedPly: 1 }));
    expect(m.enabled).toBe(true);
  });

  it('re-clamps a stale above-range viewedPly down to max before labelling', () => {
    // viewedPly 9 > max 3 (a stale fact) → value clamps to 3, which is the head → Live.
    const m = deriveSlider(facts({ maxPly: 3, viewedPly: 9 }));
    expect(m.value).toBe(3);
    expect(m.atLive).toBe(true);
    expect(m.label).toBe('Live');
  });

  it('re-clamps a negative viewedPly up to 0 (an earlier, non-live position)', () => {
    const m = deriveSlider(facts({ maxPly: 4, viewedPly: -2 }));
    expect(m.value).toBe(0);
    expect(m.atLive).toBe(false);
    expect(m.label).toBe('Move 0 / 4');
  });

  it('floors a negative maxPly to 0 (defensive) rather than emitting a negative range', () => {
    const m = deriveSlider(facts({ maxPly: -1, viewedPly: -1 }));
    expect(m.max).toBe(0);
    expect(m.value).toBe(0);
    expect(m.enabled).toBe(false);
    expect(m.atLive).toBe(true);
  });
});

/**
 * Issue #44 — the history controls (Undo / Redo / Reset) MOVED here from `bannerModel.ts`. Given the
 * scene's history-reachability flags, `deriveHistoryControls` yields the ordered button set the
 * slider widget renders under the range: each button's stable command id, label, and `enabled` flag.
 * Strict unit + mutation gate: genuine assertions plus negative cases —
 *   - the buttons appear in order (Undo, Redo, Reset), each bound to its exact command id;
 *   - each button's `enabled` follows its MATCHING flag, proven by flipping one flag at a time so
 *     no button can borrow another's bit;
 *   - a pristine game (no reachability) disables every button.
 */
describe('deriveHistoryControls — button set (ids, order, labels)', () => {
  const allHistory = (over: Partial<HistoryControls> = {}): HistoryControls => ({
    canUndo: true,
    canRedo: true,
    canReset: true,
    ...over,
  });
  const byId = (buttons: ReturnType<typeof deriveHistoryControls>, commandId: string) =>
    buttons.find((b) => b.commandId === commandId)!;

  it('emits Undo/Redo/Reset in order, each bound to its command id', () => {
    const buttons = deriveHistoryControls(allHistory());
    expect(buttons.map((b) => b.commandId)).toEqual([
      HISTORY_COMMANDS.undo,
      HISTORY_COMMANDS.redo,
      HISTORY_COMMANDS.reset,
    ]);
    expect(buttons.map((b) => b.label)).toEqual(['Undo', 'Redo', 'Reset']);
  });

  it('binds the exact command ids the input layer dispatches (one action layer)', () => {
    // Pin the literal ids — these MUST match the scene's command registry / keybindings so a
    // button and a hotkey fire the identical command (design Principle 3).
    expect(HISTORY_COMMANDS).toEqual({ undo: 'undo', redo: 'redo', reset: 'reset' });
  });

  it('all buttons enabled when every history flag is set', () => {
    const buttons = deriveHistoryControls(allHistory());
    expect(buttons.map((b) => b.enabled)).toEqual([true, true, true]);
  });

  it('disables ONLY Undo when canUndo is false (others stay enabled)', () => {
    const buttons = deriveHistoryControls(allHistory({ canUndo: false }));
    expect(byId(buttons, HISTORY_COMMANDS.undo).enabled).toBe(false);
    expect(byId(buttons, HISTORY_COMMANDS.redo).enabled).toBe(true);
    expect(byId(buttons, HISTORY_COMMANDS.reset).enabled).toBe(true);
  });

  it('disables ONLY Redo when canRedo is false (others stay enabled)', () => {
    const buttons = deriveHistoryControls(allHistory({ canRedo: false }));
    expect(byId(buttons, HISTORY_COMMANDS.undo).enabled).toBe(true);
    expect(byId(buttons, HISTORY_COMMANDS.redo).enabled).toBe(false);
    expect(byId(buttons, HISTORY_COMMANDS.reset).enabled).toBe(true);
  });

  it('disables ONLY Reset when canReset is false (others stay enabled)', () => {
    const buttons = deriveHistoryControls(allHistory({ canReset: false }));
    expect(byId(buttons, HISTORY_COMMANDS.undo).enabled).toBe(true);
    expect(byId(buttons, HISTORY_COMMANDS.redo).enabled).toBe(true);
    expect(byId(buttons, HISTORY_COMMANDS.reset).enabled).toBe(false);
  });

  it('disables every button when the game is pristine (no history at all)', () => {
    const buttons = deriveHistoryControls({ canUndo: false, canRedo: false, canReset: false });
    expect(buttons.map((b) => b.enabled)).toEqual([false, false, false]);
  });
});
