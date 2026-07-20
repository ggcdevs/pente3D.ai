/**
 * Tests for the PURE placement + temp-mode wiring (Task 4.8).
 *
 * Two pieces of pure logic, both THREE-free / DOM-free (strict unit + mutation gate):
 *
 *   - `placementFromHit(hit)` — the "click an empty node → place" rule: a raycast hit
 *     resolves to a placeable coord ONLY for an empty node; a placed sphere, a line, or a
 *     miss (`null`) is NOT placeable (you cannot play onto an occupied node or a gridline).
 *   - the **temp-placement state machine** + its `tempPlacement` scope: `t` enters a
 *     preview mode (translucent piece), moving the pointer updates the previewed node,
 *     `Enter` confirms (commits the preview → a real `place`), and `t` again exits
 *     (discards). The scope binds `t → exitTempMode` and `Enter → confirmTempPiece`,
 *     non-blocking so camera keys still fall through under the preview (game-core Part 4).
 *
 * Genuine assertions on the resolved coord / model transitions / scope bindings, plus
 * negatives (occupied node, line, miss, confirm with no preview, exit clears preview).
 */

import { describe, expect, it } from 'vitest';
import type { RaycastHit } from '../render/hover.ts';
import {
  placementFromHit,
  enterTemp,
  setTempPreview,
  confirmTemp,
  exitTemp,
  initialTemp,
  tempPlacementScope,
  TEMP_SCOPE_ID,
  type TempPlacement,
} from './placement.ts';

describe('placementFromHit — click an empty node → place coord', () => {
  it('resolves an empty-node hit to its coord triple', () => {
    const hit: RaycastHit = { kind: 'empty-node', node: '2,3,4' };
    expect(placementFromHit(hit)).toEqual([2, 3, 4]);
  });

  it('resolves the ORIGIN node correctly (no off-by-one / sign flip)', () => {
    expect(placementFromHit({ kind: 'empty-node', node: '0,0,0' })).toEqual([0, 0, 0]);
  });

  it('a placed sphere is NOT placeable — you cannot play onto an occupied node', () => {
    expect(placementFromHit({ kind: 'placed-sphere', node: '1,1,1' })).toBeNull();
  });

  it('a line hit is NOT placeable — a gridline is not a node', () => {
    expect(placementFromHit({ kind: 'line', lineId: 'x@0,0,0' })).toBeNull();
  });

  it('a miss (null hit) is NOT placeable', () => {
    expect(placementFromHit(null)).toBeNull();
  });
});

describe('temp-placement state machine', () => {
  it('starts inactive with no preview', () => {
    const s: TempPlacement = initialTemp();
    expect(s).toEqual({ active: false, preview: null });
  });

  it('enterTemp activates the mode with no preview yet', () => {
    expect(enterTemp()).toEqual({ active: true, preview: null });
  });

  it('setTempPreview records/moves the previewed node while active', () => {
    const entered = enterTemp();
    const previewed = setTempPreview(entered, '2,2,2');
    expect(previewed).toEqual({ active: true, preview: '2,2,2' });
    // Moving the pointer replaces the preview (not append/accumulate).
    const moved = setTempPreview(previewed, '3,1,0');
    expect(moved).toEqual({ active: true, preview: '3,1,0' });
  });

  it('setTempPreview is immutable — the source state is not mutated', () => {
    const entered = enterTemp();
    setTempPreview(entered, '2,2,2');
    expect(entered.preview).toBeNull();
  });

  it('setTempPreview on an inactive state is a no-op (no phantom preview off-mode)', () => {
    const s = setTempPreview(initialTemp(), '2,2,2');
    expect(s).toEqual({ active: false, preview: null });
  });

  it('confirmTemp with a preview yields the coord to place AND exits the mode', () => {
    const s = setTempPreview(enterTemp(), '4,0,2');
    const result = confirmTemp(s);
    expect(result.commit).toEqual([4, 0, 2]);
    expect(result.next).toEqual({ active: false, preview: null });
  });

  it('confirmTemp with NO preview commits nothing and stays active (Enter is inert)', () => {
    const s = enterTemp();
    const result = confirmTemp(s);
    expect(result.commit).toBeNull();
    expect(result.next).toEqual({ active: true, preview: null });
  });

  it('confirmTemp while inactive commits nothing and stays inactive', () => {
    const result = confirmTemp(initialTemp());
    expect(result.commit).toBeNull();
    expect(result.next).toEqual({ active: false, preview: null });
  });

  it('exitTemp discards the mode AND any preview', () => {
    const s = setTempPreview(enterTemp(), '2,2,2');
    expect(exitTemp(s)).toEqual({ active: false, preview: null });
  });
});

describe('tempPlacementScope — the scope pushed by temp mode', () => {
  it('has the canonical scope id (matches the game-core "tempPlacement" scope name)', () => {
    // Assert the LITERAL value, not `=== TEMP_SCOPE_ID` (which would be tautological) — the
    // scope id is the name the scope stack reports (GLOSSARY "Context / scope") and must not
    // silently become empty.
    expect(TEMP_SCOPE_ID).toBe('tempPlacement');
  });

  it('DERIVES from the base bindings: the enter key rebinds to exit, confirm is kept, non-blocking', () => {
    // The base (game) map — exactly the shape of the tracked keybindings default.
    const scope = tempPlacementScope({
      t: 'enterTempMode',
      Enter: 'confirmTempPiece',
      d: 'showAllDiagonals',
      u: 'undo',
    });
    expect(scope.id).toBe('tempPlacement');
    // `t` (the enter key) is rebound to exitTempMode — same key toggles out (game-core Part 4).
    // `Enter` (confirm) is kept. Unrelated keys (d, u) are DROPPED so they fall through the
    // non-blocking preview to the game scope (camera/diagonal keys still work).
    expect(scope.bindings).toEqual({ t: 'exitTempMode', Enter: 'confirmTempPiece' });
    expect(scope.blocking).toBe(false);
  });

  it('follows a REBOUND enter key — no hardcoded chord (rebindable)', () => {
    // A user rebinds temp-enter to `p` and confirm to Space: the derived scope uses those very
    // keys, proving nothing is hardcoded — `p` exits, Space confirms.
    const scope = tempPlacementScope({ p: 'enterTempMode', ' ': 'confirmTempPiece' });
    expect(scope.bindings).toEqual({ p: 'exitTempMode', ' ': 'confirmTempPiece' });
  });

  it('is empty when the base binds neither enter nor confirm (drops everything unrelated)', () => {
    // No enter/confirm bindings → an empty (fall-through-only) temp scope, never a phantom key.
    const scope = tempPlacementScope({ d: 'showAllDiagonals', u: 'undo' });
    expect(scope.bindings).toEqual({});
  });
});
