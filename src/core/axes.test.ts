import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { AXES, type LineCategory } from './axes';
import type { Coord } from './coords';

/** The first non-zero component of a vector (undefined only for the zero vector). */
function firstNonZero(vec: Coord): number | undefined {
  return vec.find((c) => c !== 0);
}

/** Count of non-zero components — the "dimensionality" of an axis. */
function nonZeroCount(vec: Coord): number {
  return vec.filter((c) => c !== 0).length;
}

/** Negate every component of a vector. */
function negate(vec: Coord): Coord {
  return [-vec[0], -vec[1], -vec[2]];
}

describe('AXES — the 13 canonical line axes', () => {
  it('has exactly 13 axes', () => {
    expect(AXES.length).toBe(13);
  });

  it('has category counts {orthogonal:3, face:6, space:4}', () => {
    const counts: Record<LineCategory, number> = {
      orthogonal: 0,
      face: 0,
      space: 0,
    };
    for (const axis of AXES) counts[axis.category] += 1;
    expect(counts).toEqual({ orthogonal: 3, face: 6, space: 4 });
  });

  it("every axis's first non-zero component is > 0 (sign convention)", () => {
    for (const axis of AXES) {
      expect(firstNonZero(axis.vec)).toBeGreaterThan(0);
    }
  });

  it('no two axes are parallel (no axis equals another negated)', () => {
    for (let i = 0; i < AXES.length; i++) {
      for (let j = 0; j < AXES.length; j++) {
        if (i === j) continue;
        expect(AXES[i]!.vec).not.toEqual(negate(AXES[j]!.vec));
        expect(AXES[i]!.vec).not.toEqual(AXES[j]!.vec);
      }
    }
  });

  it('category matches the count of non-zero components (1→orthogonal, 2→face, 3→space)', () => {
    for (const axis of AXES) {
      const n = nonZeroCount(axis.vec);
      const expected: LineCategory =
        n === 1 ? 'orthogonal' : n === 2 ? 'face' : 'space';
      expect(axis.category).toBe(expected);
    }
  });

  it('every component of every axis is in {-1,0,1} and no axis is the zero vector', () => {
    for (const axis of AXES) {
      for (const c of axis.vec) expect([-1, 0, 1]).toContain(c);
      expect(nonZeroCount(axis.vec)).toBeGreaterThan(0);
    }
  });

  it('property: AXES is exactly the sign-canonicalized dedupe of {-1,0,1}³ minus origin', () => {
    // Independently enumerate the half-space of directions and compare as a set.
    const expected = new Set<string>();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const vec: Coord = [dx, dy, dz];
          const lead = firstNonZero(vec)!;
          const canon: Coord = lead > 0 ? vec : negate(vec);
          expected.add(canon.join(','));
        }
      }
    }
    const got = new Set(AXES.map((a) => a.vec.join(',')));
    expect(got.size).toBe(AXES.length); // AXES has no duplicates
    expect(got).toEqual(expected);
  });

  it('property: negating any AXES vec never lands on another AXES vec', () => {
    const set = new Set(AXES.map((a) => a.vec.join(',')));
    fc.assert(
      fc.property(fc.integer({ min: 0, max: AXES.length - 1 }), (i) => {
        const neg = negate(AXES[i]!.vec).join(',');
        expect(set.has(neg)).toBe(false);
      }),
    );
  });
});
