/**
 * PURE hover-target computation (Task 4.7).
 *
 * Given what a raycast struck (`RaycastHit`), the current `GameState`, the node↔line
 * index, and which line categories are currently *visible*, decide what to highlight —
 * a set of nodes, lines, and pieces. This is the exact hover rule set from game-core
 * Part 4 (and render-ui design Part 1), and it is deliberately isolated from the Three.js
 * raycaster (`picking.ts`) and the emissive-application glue (`scene.ts`) so the fiddly
 * rules get the strict unit + mutation gate with genuine assertions on the returned
 * target, while the IO layers stay thin Playwright-verified shells.
 *
 * The rules (only ever highlighting **visible** lines):
 *   - **Empty node** → highlight the node itself + its visible lines + every piece on
 *     those lines (so you see where you'd play and what it touches).
 *   - **Placed sphere** → highlight the connected visible line(s) + their pieces, but
 *     **NOT the sphere itself** (the deliberate asymmetry — game-core Part 4).
 *   - **Line** → highlight the whole line (if its category is visible) + every piece on
 *     it. A hover on a hidden-category line yields nothing.
 *
 * This module reads only core line objects + `GameState`; it holds ZERO THREE/DOM. It
 * builds no rules — it consumes the `linesThroughNode` index and line node lists that
 * `src/core/lines.ts` already produces (DRY).
 */

import type { Line, LineId, LineCategory } from '../core/lines.ts';
import { keyOf, type NodeKey } from '../core/coords.ts';
import type { GameState } from '../core/gameState.ts';

/**
 * What a raycast resolved to — a discriminated union produced by `picking.ts` (the IO
 * boundary) and consumed here (pure). `null` means the ray hit nothing pickable.
 */
export type RaycastHit =
  | { readonly kind: 'empty-node'; readonly node: NodeKey }
  | { readonly kind: 'placed-sphere'; readonly node: NodeKey }
  | { readonly kind: 'line'; readonly lineId: LineId };

/**
 * The computed highlight set: which node markers, gridlines, and pieces to glow. Every
 * list is deduplicated. `pieces` are the node keys of occupied nodes to emphasise; a
 * piece is a node in `GameState.pieces`.
 */
export interface HoverTarget {
  /** Node-marker keys to highlight (the hovered empty node; empty for sphere/line hovers). */
  readonly nodes: readonly NodeKey[];
  /** Line ids to highlight (visible-only). */
  readonly lines: readonly LineId[];
  /** Node keys of pieces to highlight (occupants of the highlighted lines / hovered line). */
  readonly pieces: readonly NodeKey[];
}

/**
 * The resolver's view of one line: its id, category, and ordered node keys. Carrying the
 * node keys *on* the ref means the hover hot-path never does a second map lookup — the
 * node↔line index yields fully-hydrated refs.
 */
interface LineRef {
  readonly id: LineId;
  readonly category: LineCategory;
  readonly nodeKeys: readonly NodeKey[];
}

/**
 * The pre-indexed line data the resolver needs, built once from `generateAllLines`. Both
 * maps hold fully-hydrated {@link LineRef}s (id + category + node keys), so the resolver is
 * O(lines-through-node) with no secondary lookups. Everything is derivable from the core
 * `Line[]` (DRY with `src/core/lines.ts`).
 */
export interface HoverLookup {
  /** `nodeKey → the lines passing through it` (its ≤13 axis lines). */
  readonly linesThrough: ReadonlyMap<NodeKey, readonly LineRef[]>;
  /** `lineId → its ref` — for the direct line-hit path. */
  readonly byId: ReadonlyMap<LineId, LineRef>;
}

/**
 * Build the {@link HoverLookup} from the core line objects. Pure derivation — the node↔line
 * index and each line's node-key list both come straight off `Line.nodes`, so this never
 * re-implements line generation (DRY with `src/core/lines.ts`).
 */
export function buildHoverLookup(lines: readonly Line[]): HoverLookup {
  const linesThrough = new Map<NodeKey, LineRef[]>();
  const byId = new Map<LineId, LineRef>();
  for (const line of lines) {
    const ref: LineRef = {
      id: line.id,
      category: line.category,
      nodeKeys: line.nodes.map((n) => keyOf(n)),
    };
    byId.set(ref.id, ref);
    for (const key of ref.nodeKeys) {
      const refs = linesThrough.get(key);
      if (refs) refs.push(ref);
      else linesThrough.set(key, [ref]);
    }
  }
  return { linesThrough, byId };
}

/** The node keys of the pieces (occupied nodes) that lie on `line`, in line order. */
function piecesOnLine(line: LineRef, state: GameState): NodeKey[] {
  return line.nodeKeys.filter((key) => state.pieces[key] !== undefined);
}

/**
 * The visible lines through a node + the pieces occupying those lines. Shared by the
 * empty-node and placed-sphere rules (which differ only in whether the hovered node itself
 * is added to `nodes`).
 *
 * No piece can appear twice: the ≤13 lines through the hovered node are distinct axes, and
 * two distinct points determine a unique line, so any *other* board node lies on at most
 * one of those lines. Both the `lines` and `pieces` lists are therefore duplicate-free by
 * construction — no dedup pass is needed (or reachable).
 */
function visibleLinesAndPieces(
  node: NodeKey,
  state: GameState,
  lookup: HoverLookup,
  visible: readonly LineCategory[],
): { lines: LineId[]; pieces: NodeKey[] } {
  const lines: LineId[] = [];
  const pieces: NodeKey[] = [];
  const through = lookup.linesThrough.get(node);
  if (through === undefined) return { lines, pieces };
  for (const line of through) {
    if (!visible.includes(line.category)) continue;
    lines.push(line.id);
    pieces.push(...piecesOnLine(line, state));
  }
  return { lines, pieces };
}

/**
 * Resolve a raycast hit into the highlight set, per the game-core Part 4 hover rules.
 * Returns `null` when nothing should highlight: a null hit, an unknown line id, or a hover
 * on a line whose category is hidden (the visible-only rule).
 *
 * @param hit The resolved raycast hit (`null` if the ray struck nothing pickable).
 * @param state The current game state — its `pieces` map decides which nodes glow.
 * @param lookup The pre-indexed line data (`buildHoverLookup`).
 * @param visible The line categories currently drawn; only these are ever highlighted.
 */
export function computeHoverTarget(
  hit: RaycastHit | null,
  state: GameState,
  lookup: HoverLookup,
  visible: readonly LineCategory[],
): HoverTarget | null {
  if (hit === null) return null;

  switch (hit.kind) {
    case 'empty-node': {
      // The hovered node + its visible lines + pieces on those lines.
      const { lines, pieces } = visibleLinesAndPieces(hit.node, state, lookup, visible);
      return { nodes: [hit.node], lines, pieces };
    }
    case 'placed-sphere': {
      // The connected visible lines + their pieces, but NOT the sphere itself (the
      // deliberate asymmetry — game-core Part 4). The hovered sphere is itself a piece on
      // those lines, so it is excluded from `pieces` too: hovering it must not make it glow.
      const { lines, pieces } = visibleLinesAndPieces(hit.node, state, lookup, visible);
      return { nodes: [], lines, pieces: pieces.filter((key) => key !== hit.node) };
    }
    case 'line': {
      // An unknown line id (never in `byId`) or a hidden-category line is not highlightable
      // (visible-only rule) — both yield null, never a fabricated target.
      const line = lookup.byId.get(hit.lineId);
      if (line === undefined || !visible.includes(line.category)) return null;
      return { nodes: [], lines: [line.id], pieces: piecesOnLine(line, state) };
    }
  }
}
