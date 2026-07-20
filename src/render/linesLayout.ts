/**
 * PURE gridline layout planner (Task 4.4).
 *
 * Turns `generateAllLines(size)` (core, Layer B) plus the tracked `lineVisibility` and
 * `blending` config sections into a plain, THREE-free plan the instanced-gridline glue
 * (`lines.ts`) consumes. Gridlines are drawn as **segments** — one instance per adjacent
 * node pair of a line — so a line maps to a contiguous *range* of instances within its
 * category group. Three groups (orthogonal / face / space) because the categories toggle
 * independently (render-ui design Part 1; game-core Part 4).
 *
 * This is the pure boundary of the gridline renderer — no THREE, no DOM — so the fiddly
 * grouping / index-range / config-resolution logic gets the strict unit + mutation gate,
 * while `lines.ts` stays a thin Playwright-verified shell (build plan Task 4.4 gating
 * model). It never builds rules: it only reads core line objects and view config.
 *
 * Naming seam: the config sections key the diagonals as `faceDiagonal` / `spaceDiagonal`
 * (user-facing), while core categories are `face` / `space`. `visibilityKeyOf` is the
 * single translation point so the mismatch can never silently cross a category.
 */

import { generateAllLines, type Line, type LineCategory, type LineId } from '../core/lines.ts';
import type { Coord } from '../core/coords.ts';

/** The three line categories, in canonical (draw/toggle) order. */
export const LINE_CATEGORIES: readonly LineCategory[] = ['orthogonal', 'face', 'space'] as const;

/** The `lineVisibility` config key of each category (user-facing diagonal names). */
export type VisibilityKey = 'orthogonal' | 'faceDiagonal' | 'spaceDiagonal';

/** The `lineVisibility` config section shape (mirrors `defaults/lineVisibility.json`). */
export type LineVisibilityConfig = Record<VisibilityKey, boolean>;

/** A per-line-category blending mode. */
export type BlendMode = 'additive' | 'normal';

/** The `blending` config section shape (mirrors `defaults/blending.json`). */
export type BlendingConfig = Record<VisibilityKey, BlendMode>;

/** Map a core line category to its `lineVisibility`/`blending` config key. */
export function visibilityKeyOf(category: LineCategory): VisibilityKey {
  switch (category) {
    case 'orthogonal':
      return 'orthogonal';
    case 'face':
      return 'faceDiagonal';
    case 'space':
      return 'spaceDiagonal';
    default:
      throw new Error(`unknown line category: ${JSON.stringify(category)}`);
  }
}

/** A resolved per-category record keyed by the *core* category names. */
export type ByCategory<T> = Record<LineCategory, T>;

/**
 * Resolve the `lineVisibility` config into a per-core-category boolean record. Each flag
 * is read from its correctly-named config key and validated to be a real boolean — a
 * missing or ill-typed flag throws (honest failure, never a silently-off category).
 */
export function resolveLineVisibility(config: LineVisibilityConfig): ByCategory<boolean> {
  const out = {} as ByCategory<boolean>;
  for (const category of LINE_CATEGORIES) {
    const key = visibilityKeyOf(category);
    const value = config[key];
    if (typeof value !== 'boolean') {
      throw new Error(
        `invalid lineVisibility.${key}: ${JSON.stringify(value)} (expected a boolean)`,
      );
    }
    out[category] = value;
  }
  return out;
}

/**
 * Resolve the `blending` config into a per-core-category blend-mode record. Each mode is
 * read from its correctly-named config key and validated against the known modes — an
 * unrecognized or missing mode throws.
 */
export function resolveLineBlending(config: BlendingConfig): ByCategory<BlendMode> {
  const out = {} as ByCategory<BlendMode>;
  for (const category of LINE_CATEGORIES) {
    const key = visibilityKeyOf(category);
    const value = config[key];
    if (value !== 'additive' && value !== 'normal') {
      throw new Error(
        `invalid blending.${key}: ${JSON.stringify(value)} (expected "additive" or "normal")`,
      );
    }
    out[category] = value;
  }
  return out;
}

/** A single drawn segment: the two node endpoints and the id of the line it belongs to. */
export interface LineSegment {
  /** The segment's start node. */
  readonly a: Coord;
  /** The segment's end node (the next node along the line). */
  readonly b: Coord;
  /** The canonical id of the line this segment is part of. */
  readonly lineId: LineId;
}

/** A contiguous half-open instance range `[start, start + count)` within a group. */
export interface InstanceRange {
  readonly start: number;
  readonly count: number;
}

/** One category's instanced-gridline group: its lines, its segment buffer, and the map. */
export interface LineGroup {
  /** The lines of this category, in the order their segments were laid out. */
  readonly lines: readonly Line[];
  /** The flattened per-segment instance buffer for the whole group. */
  readonly segments: readonly LineSegment[];
  /** Total number of segment instances (`segments.length`). */
  readonly segmentCount: number;
  /** `lineId → instance-range` — the contiguous slice of `segments` a line owns. */
  readonly rangeOf: ReadonlyMap<LineId, InstanceRange>;
}

/** The three category groups of a board, keyed by core category. */
export type LineGroups = ByCategory<LineGroup>;

/**
 * Build the three category groups for an `N×N×N` board from `generateAllLines`. Every
 * full line is placed in exactly one group and laid out as a contiguous run of segment
 * instances (one per adjacent-node pair); a line's `InstanceRange` records where its run
 * sits so the glue can target an individual line (hover, highlight) inside the shared
 * InstancedMesh.
 */
export function buildLineGroups(size: number): LineGroups {
  const lines = generateAllLines(size);
  const groups = {} as LineGroups;
  for (const category of LINE_CATEGORIES) {
    const catLines = lines.filter((l) => l.category === category);
    const segments: LineSegment[] = [];
    const rangeOf = new Map<LineId, InstanceRange>();
    for (const line of catLines) {
      const start = segments.length;
      for (let i = 0; i < line.nodes.length - 1; i++) {
        segments.push({ a: line.nodes[i]!, b: line.nodes[i + 1]!, lineId: line.id });
      }
      rangeOf.set(line.id, { start, count: segments.length - start });
    }
    groups[category] = {
      lines: catLines,
      segments,
      segmentCount: segments.length,
      rangeOf,
    };
  }
  return groups;
}

/** A category group enriched with its resolved visibility flag + blending mode. */
export interface ResolvedLineGroup extends LineGroup {
  /** Whether this category is currently drawn (from `lineVisibility`). */
  readonly visible: boolean;
  /** How this category composites (from `blending`). */
  readonly blending: BlendMode;
}

/** The full resolved gridline plan: three groups, each with geometry + view config. */
export type ResolvedLineLayout = ByCategory<ResolvedLineGroup>;

/**
 * Resolve the complete gridline plan: build the segment groups for `size`, then attach
 * each category's resolved visibility flag and blending mode. Visibility is a *flag* on
 * the full group, not a filter on its segments — a hidden category still carries its
 * whole instance buffer so the glue toggles a boolean instead of rebuilding geometry.
 */
export function resolveLineLayout(
  size: number,
  visibility: LineVisibilityConfig,
  blending: BlendingConfig,
): ResolvedLineLayout {
  const groups = buildLineGroups(size);
  const visible = resolveLineVisibility(visibility);
  const blend = resolveLineBlending(blending);
  const out = {} as ResolvedLineLayout;
  for (const category of LINE_CATEGORIES) {
    out[category] = {
      ...groups[category],
      visible: visible[category],
      blending: blend[category],
    };
  }
  return out;
}
