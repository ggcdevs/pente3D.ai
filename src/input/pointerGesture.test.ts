/**
 * Tests for the PURE pointer-gesture disambiguator (GitHub issue #1).
 *
 * On a trackpad an orbit/pan gesture ends in a pointer release that the placement handler
 * would otherwise treat as a click-to-place, so pieces land accidentally while rotating.
 * `shouldPlaceFromPointer` disambiguates DRAG from CLICK purely from the pointerdown and
 * pointerup positions plus the (config-driven) guard settings:
 *
 *   - guard ENABLED (default): place ONLY when the pointer moved <= `thresholdPx` between
 *     down and up (a genuine click). A larger move is a camera-manipulation drag → no place.
 *   - guard DISABLED: place on release regardless of movement (legacy place-on-release), so
 *     the config toggle demonstrably changes behavior.
 *
 * Distance is straight-line (Euclidean) in the same pixel space as the pointer events —
 * DOM-free / THREE-free — so it earns the strict unit + mutation gate. Assertions cover the
 * boundary (exactly at threshold = click), both drag axes, the diagonal, and the disabled
 * override (a big drag still places), never asserting on a log line (agent-principles #3).
 */

import { describe, expect, it } from 'vitest';
import { shouldPlaceFromPointer, type PointerPos, type DragGuardConfig } from './pointerGesture.ts';

const at = (x: number, y: number): PointerPos => ({ x, y });

describe('shouldPlaceFromPointer — guard enabled', () => {
  const guard: DragGuardConfig = { enabled: true, thresholdPx: 5 };

  it('places when the pointer did not move at all (a plain click)', () => {
    expect(shouldPlaceFromPointer(at(100, 100), at(100, 100), guard)).toBe(true);
  });

  it('places for a small jitter strictly under the threshold', () => {
    expect(shouldPlaceFromPointer(at(100, 100), at(103, 100), guard)).toBe(true);
  });

  it('places when movement is exactly at the threshold (<= is inclusive)', () => {
    // 3-4-5 right triangle: exactly 5px of travel.
    expect(shouldPlaceFromPointer(at(0, 0), at(3, 4), guard)).toBe(true);
  });

  it('does NOT place when the pointer moved past the threshold on X (a horizontal drag)', () => {
    expect(shouldPlaceFromPointer(at(100, 100), at(120, 100), guard)).toBe(false);
  });

  it('does NOT place when the pointer moved past the threshold on Y (a vertical drag)', () => {
    expect(shouldPlaceFromPointer(at(100, 100), at(100, 130), guard)).toBe(false);
  });

  it('does NOT place for a diagonal drag just past the threshold', () => {
    // (4,4) → 5.65px > 5px threshold.
    expect(shouldPlaceFromPointer(at(0, 0), at(4, 4), guard)).toBe(false);
  });

  it('measures absolute distance regardless of drag direction (negative delta)', () => {
    expect(shouldPlaceFromPointer(at(200, 200), at(180, 200), guard)).toBe(false);
  });
});

describe('shouldPlaceFromPointer — guard disabled reverts to place-on-release', () => {
  const guard: DragGuardConfig = { enabled: false, thresholdPx: 5 };

  it('places even for a large drag (the toggle changes behavior)', () => {
    expect(shouldPlaceFromPointer(at(0, 0), at(500, 500), guard)).toBe(true);
  });

  it('places for a plain click too (disabled never suppresses)', () => {
    expect(shouldPlaceFromPointer(at(10, 10), at(10, 10), guard)).toBe(true);
  });
});

describe('shouldPlaceFromPointer — threshold sensitivity', () => {
  it('a larger threshold admits a drag the default would reject', () => {
    const move: [PointerPos, PointerPos] = [at(0, 0), at(0, 20)];
    expect(shouldPlaceFromPointer(...move, { enabled: true, thresholdPx: 5 })).toBe(false);
    expect(shouldPlaceFromPointer(...move, { enabled: true, thresholdPx: 25 })).toBe(true);
  });

  it('a zero threshold rejects any movement at all but still allows a perfect click', () => {
    const guard: DragGuardConfig = { enabled: true, thresholdPx: 0 };
    expect(shouldPlaceFromPointer(at(5, 5), at(5, 5), guard)).toBe(true);
    expect(shouldPlaceFromPointer(at(5, 5), at(6, 5), guard)).toBe(false);
  });
});
