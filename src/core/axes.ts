/**
 * The 13 canonical line-axes of the cubic Pente board.
 *
 * Through any node there are 26 directions to a Moore neighbor (`(±1,±1,±1)`
 * minus the origin). Each line-axis is an opposite pair of directions, so the
 * 26 directions collapse to **13 axes**. We canonicalize each axis's sign so its
 * first non-zero component is positive, giving one representative per pair.
 *
 * Axes are tagged by how many components are non-zero — the same categories the
 * view uses for line visibility, but here they belong to the pure rules layer:
 *   - 1 non-zero  → `orthogonal` (3 axes; cube-edge gridlines)
 *   - 2 non-zero  → `face`       (6 axes; face diagonals)
 *   - 3 non-zero  → `space`      (4 axes; space diagonals)
 *
 * This single table is the source of truth for both rules-stepping (captures,
 * win detection) and line generation. No rendering, network, or DOM here.
 */

import type { Coord } from './coords';

/** The visibility/line category an axis belongs to. */
export type LineCategory = 'orthogonal' | 'face' | 'space';

/** A canonical line-axis: its unit step vector and its category. */
export interface Axis {
  readonly vec: Coord;
  readonly category: LineCategory;
}

/** The first non-zero component of a vector (`undefined` only for `(0,0,0)`). */
function firstNonZero(vec: Coord): number | undefined {
  return vec.find((c) => c !== 0);
}

/** Number of non-zero components — the axis's dimensionality (1, 2, or 3). */
function nonZeroCount(vec: Coord): number {
  return vec.filter((c) => c !== 0).length;
}

/** Map a non-zero-component count to its line category. */
function categoryOf(count: number): LineCategory {
  return count === 1 ? 'orthogonal' : count === 2 ? 'face' : 'space';
}

/**
 * Build the canonical axis table: enumerate `{-1,0,1}³` minus the origin,
 * flip each vector's sign so its leading non-zero component is positive, dedupe,
 * and tag by non-zero-component count. Yields exactly 13 axes by construction.
 */
function buildAxes(): Axis[] {
  const seen = new Map<string, Axis>();
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        const raw: Coord = [dx, dy, dz];
        const lead = firstNonZero(raw)!;
        const vec: Coord = lead > 0 ? raw : [-dx, -dy, -dz];
        const key = vec.join(',');
        if (seen.has(key)) continue;
        seen.set(key, { vec, category: categoryOf(nonZeroCount(vec)) });
      }
    }
  }
  return [...seen.values()];
}

/** The 13 canonical line-axes, sign-canonicalized and categorized. */
export const AXES: readonly Axis[] = buildAxes();

/**
 * The 26 Moore-neighborhood directions — every axis and its negation.
 *
 * Rules-stepping that must consider *both* ways along each line (custodian
 * captures scan `[opp, opp, self]` from the placed node) uses these directions.
 * Derived from {@link AXES} so the axis table stays the single source of truth.
 */
export const DIRECTIONS: readonly Coord[] = AXES.flatMap(({ vec }): Coord[] => [
  [vec[0], vec[1], vec[2]],
  [-vec[0], -vec[1], -vec[2]],
]);
