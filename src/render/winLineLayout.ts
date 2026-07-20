/**
 * PURE win-line layout planner (Task 4.9).
 *
 * A won game's `GameState.winningLine` is an ordered run of node keys (the five-or-more
 * same-colour pieces the rules core found through the winning move — game-core design
 * Part 2). The render-ui design (Part 1) draws it as a single **individual, partial**
 * mesh (`generatePartialLine`), not one of the instanced full-line groups: it is 0-or-1
 * in count and highlights a sub-segment, so an individual mesh keeps it trivial to add,
 * animate, and remove.
 *
 * This module is the pure boundary of that renderer — no THREE, no DOM — so the
 * endpoint-resolution / segment layout gets the strict unit + mutation gate with genuine
 * assertions on the returned plan, while `winLine.ts` stays a thin Playwright-verified
 * shell (build plan Task 4.9 gating model). It never builds rules: it reads only the
 * core `winningLine` and validates it through the core `generatePartialLine` helper.
 *
 * A capture win records **no** `winningLine` (game-core Part 2), so `resolveWinLine`
 * returns `null` there — there is nothing to draw; the render glue simply shows no mesh.
 */

import * as coreLines from '../core/lines.ts';
import { coordsOf, type Coord, type NodeKey } from '../core/coords.ts';

/** One drawn segment of the win line: the two node endpoints it bridges. */
export interface WinSegment {
  /** The segment's start node. */
  readonly a: Coord;
  /** The segment's end node (the next node along the run). */
  readonly b: Coord;
}

/** The plan the win-line glue draws: the ordered run nodes + the segments bridging them. */
export interface WinLinePlan {
  /** The winning run's nodes, in order from one end to the other. */
  readonly nodes: readonly Coord[];
  /** One segment per adjacent-node pair — `nodes.length − 1` of them. */
  readonly segments: readonly WinSegment[];
}

/**
 * Resolve a `GameState.winningLine` into a {@link WinLinePlan}, or `null` if there is no
 * drawable line.
 *
 * - `undefined` (no line win, e.g. a capture win) → `null`.
 * - An empty or single-node run → `null` (nothing to bridge: a segment needs two nodes).
 * - Otherwise the first and last node keys are validated through the core
 *   `generatePartialLine` (both in-bounds, collinear along a canonical axis); the
 *   canonical ordered sub-segment it returns becomes the plan's `nodes`, and each
 *   adjacent pair becomes a {@link WinSegment}.
 *
 * @throws {Error} if the run's endpoints are not collinear along any canonical axis, or
 *   are out of bounds — a corrupt `winningLine` fails honestly rather than drawing a
 *   wrong mesh (agent-principles: errors propagate, never masked).
 */
export function resolveWinLine(
  winningLine: readonly NodeKey[] | undefined,
  size: number,
): WinLinePlan | null {
  if (winningLine === undefined || winningLine.length < 2) {
    return null;
  }

  const a = coordsOf(winningLine[0]!);
  const b = coordsOf(winningLine[winningLine.length - 1]!);
  // `drawn = []`: the win line is never pre-registered, so the "already drawn" guard
  // never fires here; collinearity + bounds are the checks that matter.
  const result = coreLines.generatePartialLine(a, b, size, []);
  if (!result.ok) {
    throw new Error(`invalid winning line ${JSON.stringify(winningLine)}: ${result.warning}`);
  }
  // `generatePartialLine` guarantees `line` is defined whenever `ok` is true; assert it
  // (rather than an `|| line === undefined` guard the test can't distinguish from `!ok`)
  // so the type narrows AND a future contract break fails loudly here (agent-principles:
  // prefer an explicit assertion over a silently-redundant defensive branch).
  if (result.line === undefined) {
    throw new Error(`win-line contract violated: ok result carried no line for ${a}→${b}`);
  }

  const nodes = result.line.nodes;
  const segments: WinSegment[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    segments.push({ a: nodes[i]!, b: nodes[i + 1]! });
  }
  return { nodes, segments };
}
