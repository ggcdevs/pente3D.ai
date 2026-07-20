/**
 * Tests for the PURE node-pick-radius resolver (GitHub issue #3).
 *
 * `resolveNodePickRadius` decides how large a single node's invisible pick sphere should be
 * so that "what you see is what you can hit": an EMPTY node's hitbox matches its small visible
 * marker; an OCCUPIED node's hitbox matches its larger visible piece. Before this fix
 * `createPicking` used one generous PIECE-sized radius for EVERY node, so an empty node's
 * oversized invisible sphere intercepted rays aimed at a farther node's visible marker — a
 * nearer node stole the pick (issue #3). This module is the pure, THREE-free decision that
 * `picking.ts` scales each instance by; it gets the strict unit + mutation gate with genuine
 * assertions on the returned radius (agent-principles #2/#3), including the negative/edge
 * cases: empty-vs-occupied divergence, the optional padding, and the half-spacing clamp that
 * keeps adjacent nodes separable. No volatile fact is hardcoded (agent-principles #8) — the
 * expected radii are computed from the same inputs the resolver reads.
 */

import { describe, expect, it } from 'vitest';
import { resolveNodePickRadius, type PickRadiusInput } from './pickRadius.ts';

/** A geometry akin to the tracked defaults (marker small, piece larger), padding off. */
const base: PickRadiusInput = {
  occupied: false,
  markerRadius: 0.14,
  pieceRadius: 0.42,
  spacing: 2,
  padding: 0,
};

describe('resolveNodePickRadius', () => {
  it('sizes an EMPTY node to its marker radius (not the larger piece radius)', () => {
    // The bug: an empty node was piece-sized (0.42). It must now be marker-sized (0.14) so its
    // invisible hitbox matches the small marker the player sees.
    const r = resolveNodePickRadius({ ...base, occupied: false });
    expect(r).toBe(0.14);
    // Explicitly NOT the piece radius — the exact over-sizing that caused issue #3.
    expect(r).not.toBe(0.42);
  });

  it('sizes an OCCUPIED node to its piece radius', () => {
    const r = resolveNodePickRadius({ ...base, occupied: true });
    expect(r).toBe(0.42);
  });

  it('empty and occupied radii diverge (occupied strictly larger for these defaults)', () => {
    const empty = resolveNodePickRadius({ ...base, occupied: false });
    const occ = resolveNodePickRadius({ ...base, occupied: true });
    expect(occ).toBeGreaterThan(empty);
  });

  it('adds the optional padding to the selected base radius', () => {
    const emptyPadded = resolveNodePickRadius({ ...base, occupied: false, padding: 0.05 });
    expect(emptyPadded).toBeCloseTo(0.19, 10); // 0.14 + 0.05
    const occPadded = resolveNodePickRadius({ ...base, occupied: true, padding: 0.05 });
    expect(occPadded).toBeCloseTo(0.47, 10); // 0.42 + 0.05
  });

  it('clamps to half the spacing so adjacent nodes never overlap (occupied, huge padding)', () => {
    // A padding large enough to exceed half-spacing must be clamped to spacing/2, keeping
    // neighbouring pick spheres tangent-at-most (separable), never overlapping.
    const r = resolveNodePickRadius({
      ...base,
      occupied: true,
      pieceRadius: 0.42,
      padding: 5,
      spacing: 2,
    });
    expect(r).toBe(1); // spacing * 0.5
  });

  it('clamps an oversized marker+padding for an empty node too', () => {
    const r = resolveNodePickRadius({
      ...base,
      occupied: false,
      markerRadius: 0.9,
      padding: 0.9,
      spacing: 2,
    });
    // 0.9 + 0.9 = 1.8 would overlap the neighbour; clamped to spacing/2 = 1.
    expect(r).toBe(1);
  });

  it('does not clamp when the padded radius is within half-spacing', () => {
    // 0.42 + 0.05 = 0.47 < 1 (half of spacing 2) → returned unclamped.
    const r = resolveNodePickRadius({ ...base, occupied: true, padding: 0.05 });
    expect(r).toBeCloseTo(0.47, 10);
    expect(r).toBeLessThan(1);
  });

  it('scales the half-spacing clamp with the spacing value', () => {
    // With spacing 0.5 the clamp is 0.25, below the piece radius 0.42 → piece is clamped down.
    const r = resolveNodePickRadius({ ...base, occupied: true, pieceRadius: 0.42, spacing: 0.5 });
    expect(r).toBe(0.25); // 0.5 * 0.5
  });
});
