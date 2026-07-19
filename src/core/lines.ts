/**
 * Line generation (dedup-free) and the node↔line index.
 *
 * A **Line** (GLOSSARY "Line") is a drawn gridline with canonical identity
 * `(entryNode, axis)`. This is Layer B of the board model (see the game-core
 * design): line *objects* for rendering, hover, and the `generate*` helpers. The
 * rules layer never builds these — it steps coordinates directly along `AXES`.
 *
 * **Dedup-free enumeration.** For each axis, for each *entry node* (a node whose
 * predecessor `entryNode − axis` is off-board), walk `+axis` to the far face.
 * This yields every full line exactly once — the diagonal-duplication problem is
 * gone by construction, since there is no dedup step to get wrong.
 *
 * Pure rules layer: no rendering, network, or DOM imports.
 */

import { AXES } from './axes';
import { keyOf, inBounds, type Coord, type NodeKey } from './coords';

/** The canonical string identity of a line: `"<entryNodeKey>|<axisIndex>"`. */
export type LineId = string;

/** The line category, mirrored from its axis (orthogonal / face / space). */
export type LineCategory = (typeof AXES)[number]['category'];

/** A gridline: canonical id, its axis, ordered nodes, and its entry node. */
export interface Line {
  /** Canonical identity `"<entryNodeKey>|<axisIndex>"`. */
  readonly id: LineId;
  /** Index into `AXES` of this line's step vector. */
  readonly axisIndex: number;
  /** The line's category (from its axis). */
  readonly category: LineCategory;
  /** Ordered nodes from `entryNode` walking `+axis` to the far face. */
  readonly nodes: Coord[];
  /** The unique node where the line enters the board (`entryNode − axis` off-board). */
  readonly entryNode: Coord;
}

/** Add two coordinates componentwise. */
function add(a: Coord, b: Coord): Coord {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/** Subtract `b` from `a` componentwise. */
function sub(a: Coord, b: Coord): Coord {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** Scale a coordinate by an integer factor. */
function scale(a: Coord, k: number): Coord {
  return [a[0] * k, a[1] * k, a[2] * k];
}

/** The canonical line id for an entry node and axis index. */
function lineId(entryNode: Coord, axisIndex: number): LineId {
  return `${keyOf(entryNode)}|${axisIndex}`;
}

/**
 * Walk from `entryNode` along `+axis` collecting nodes until stepping off-board.
 * The caller guarantees `entryNode` is in-bounds and is a genuine entry
 * (`entryNode − axis` off-board), so the result is the maximal ordered run.
 */
function walkFullLine(entryNode: Coord, axis: Coord, size: number): Coord[] {
  const nodes: Coord[] = [];
  let cur: Coord = entryNode;
  while (inBounds(cur, size)) {
    nodes.push(cur);
    cur = add(cur, axis);
  }
  return nodes;
}

/**
 * Enumerate every full line of an `N×N×N` board exactly once.
 *
 * For each axis and each in-bounds node whose predecessor along the axis is
 * off-board (the entry node), walk `+axis` to the far face. No dedup step is
 * needed: each full line has exactly one entry node for its axis.
 */
export function generateAllLines(size: number): Line[] {
  const lines: Line[] = [];
  for (let axisIndex = 0; axisIndex < AXES.length; axisIndex++) {
    const axis = AXES[axisIndex]!;
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        for (let z = 0; z < size; z++) {
          const node: Coord = [x, y, z];
          // An entry node is one whose predecessor along the axis is off-board.
          if (inBounds(sub(node, axis.vec), size)) continue;
          const nodes = walkFullLine(node, axis.vec, size);
          lines.push({
            id: lineId(node, axisIndex),
            axisIndex,
            category: axis.category,
            nodes,
            entryNode: node,
          });
        }
      }
    }
  }
  return lines;
}

/**
 * Build the `nodeKey → lineIds` index that powers hover (each node lies on at
 * most 13 lines, one per axis). Every id appears at most once per node.
 */
export function buildLinesThroughNode(lines: Line[]): Map<NodeKey, LineId[]> {
  const index = new Map<NodeKey, LineId[]>();
  for (const line of lines) {
    for (const node of line.nodes) {
      const key = keyOf(node);
      const ids = index.get(key);
      if (ids) ids.push(line.id);
      else index.set(key, [line.id]);
    }
  }
  return index;
}

/**
 * Convenience: enumerate all lines for `size` and return the node↔line index.
 */
export function linesThroughNode(size: number): Map<NodeKey, LineId[]> {
  return buildLinesThroughNode(generateAllLines(size));
}

/** The result of a `generate*` validator: ok + line, or rejected with a reason. */
export interface GenerateLineResult {
  readonly ok: boolean;
  readonly line?: Line;
  readonly warning?: string;
}

/** True iff `coord` lies on at least one face of the board (min or max on an axis). */
function onFace(coord: Coord, size: number): boolean {
  return coord.some((c) => c === 0 || c === size - 1);
}

/**
 * The axis index along which `a → b` is collinear, plus the unit step, or
 * `undefined` if the two nodes are not collinear along any canonical axis.
 *
 * `a` and `b` are collinear along axis `v` iff `b − a = k·v` for some non-zero
 * integer `k` (using the canonical, sign-positive representative direction).
 */
function collinearAxis(
  a: Coord,
  b: Coord,
): { axisIndex: number; step: Coord; count: number } | undefined {
  const d = sub(b, a);
  if (d[0] === 0 && d[1] === 0 && d[2] === 0) return undefined;
  for (let axisIndex = 0; axisIndex < AXES.length; axisIndex++) {
    const v = AXES[axisIndex]!.vec;
    // Find k such that d = k·v, consistent across all non-zero components,
    // and zero components of v must have zero delta.
    let k: number | undefined;
    let consistent = true;
    for (let i = 0; i < 3; i++) {
      const vi = v[i]!;
      const di = d[i]!;
      if (vi === 0) {
        if (di !== 0) {
          consistent = false;
          break;
        }
      } else {
        const ki = di / vi;
        if (!Number.isInteger(ki)) {
          consistent = false;
          break;
        }
        if (k === undefined) k = ki;
        else if (k !== ki) {
          consistent = false;
          break;
        }
      }
    }
    if (!consistent || k === undefined || k === 0) continue;
    // Orient the step so nodes run a → b.
    const step: Coord = k > 0 ? v : [-v[0], -v[1], -v[2]];
    return { axisIndex, step, count: Math.abs(k) };
  }
  return undefined;
}

/**
 * Build the canonical full line that passes through `a` (collinear along
 * `axisIndex`): find its entry node by walking `−axis` off-board, then walk the
 * full run. Used by `generateFullLine` to normalize any on-face endpoint pair
 * to its canonical `(entryNode, axis)` line.
 */
function canonicalFullLineThrough(
  a: Coord,
  axisIndex: number,
  size: number,
): Line {
  const axis = AXES[axisIndex]!.vec;
  // Walk backward to the entry node.
  let entry: Coord = a;
  while (inBounds(sub(entry, axis), size)) {
    entry = sub(entry, axis);
  }
  const nodes = walkFullLine(entry, axis, size);
  return {
    id: lineId(entry, axisIndex),
    axisIndex,
    category: AXES[axisIndex]!.category,
    nodes,
    entryNode: entry,
  };
}

/**
 * Validate and produce a **full line** from two endpoints.
 *
 * Valid iff: both endpoints are in-bounds and on faces, they are collinear along
 * a canonical axis, and the resulting full line is **not already registered**.
 * Otherwise the result carries a `warning` explaining the rejection (endpoint
 * off a face, not collinear, or already drawn). Endpoints may be given in either
 * order.
 */
export function generateFullLine(
  a: Coord,
  b: Coord,
  size: number,
  registered: readonly Line[],
): GenerateLineResult {
  if (!inBounds(a, size) || !inBounds(b, size)) {
    return { ok: false, warning: 'endpoint out of bounds' };
  }
  if (!onFace(a, size) || !onFace(b, size)) {
    return { ok: false, warning: 'both endpoints must be on a board face' };
  }
  const col = collinearAxis(a, b);
  if (!col) {
    return {
      ok: false,
      warning: 'endpoints are not collinear along any axis',
    };
  }
  const line = canonicalFullLineThrough(a, col.axisIndex, size);
  if (registered.some((l) => l.id === line.id)) {
    return { ok: false, warning: 'line is already registered' };
  }
  return { ok: true, line };
}

/**
 * Validate and produce a **partial line** (subsegment) from two endpoints.
 *
 * Valid iff: both endpoints are in-bounds, collinear along a canonical axis, and
 * the resulting segment is **not already drawn**. Returns the ordered segment
 * `a → b`. Its id is `(a, axisIndex)` — the segment's own entry is `a` (it is not
 * a full board line). Otherwise a `warning` explains the rejection.
 */
export function generatePartialLine(
  a: Coord,
  b: Coord,
  size: number,
  drawn: readonly Line[],
): GenerateLineResult {
  if (!inBounds(a, size) || !inBounds(b, size)) {
    return { ok: false, warning: 'endpoint out of bounds' };
  }
  const col = collinearAxis(a, b);
  if (!col) {
    return {
      ok: false,
      warning: 'endpoints are not collinear along any axis',
    };
  }
  const nodes: Coord[] = [];
  for (let i = 0; i <= col.count; i++) {
    nodes.push(add(a, scale(col.step, i)));
  }
  const id = lineId(a, col.axisIndex);
  const line: Line = {
    id,
    axisIndex: col.axisIndex,
    category: AXES[col.axisIndex]!.category,
    nodes,
    entryNode: a,
  };
  if (drawn.some((l) => l.id === line.id)) {
    return { ok: false, warning: 'segment is already drawn' };
  }
  return { ok: true, line };
}
