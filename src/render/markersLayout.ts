/**
 * PURE node-marker layout planner (Task 4.3).
 *
 * Node markers are the small translucent spheres that mark every empty board node — the
 * "where can I play" affordance (render-ui design Part 1). They are drawn as a single
 * `InstancedMesh` of N³ spheres (`markers.ts`), one instance per board node, so the fiddly
 * bits — the canonical `nodeKey ↔ instanceId` enumeration, which markers are HIDDEN
 * because a piece occupies their node, and which instances a hover set maps onto — are
 * isolated here, THREE-free, under the strict unit + mutation gate. `markers.ts` stays a
 * thin Playwright-verified shell (build plan Task 4.3 gating model).
 *
 * The enumeration order (x outer, y, z inner) is deliberately identical to the pick-sphere
 * order in `picking.ts`, and marker world positions reuse picking's `worldOf` helper (DRY),
 * so a marker instance and its pick sphere share an id and a world position — the marker
 * you see and the node you pick are guaranteed to be the same node.
 *
 * This module reads only core types (`NodeKey`, `Player`, `GameState.pieces`); it holds
 * ZERO THREE/DOM and builds no game rules.
 */

import { keyOf, type Coord, type NodeKey } from '../core/coords.ts';
import type { Player } from '../core/gameState.ts';

/**
 * The canonical node-marker index for an `N×N×N` board: the ordered node keys (one per
 * instance, in the shared pick-sphere order) and the inverse `nodeKey → instanceId` map.
 * Built once per board; the visibility/hover resolvers below index into it.
 */
export interface MarkerIndex {
  /** Number of marker instances (`N³`). */
  readonly count: number;
  /** `instanceId → nodeKey`, in enumeration order (x outer, y, z inner). */
  readonly nodeOfInstance: readonly NodeKey[];
  /** `nodeKey → instanceId`; a key absent from the board is absent from the map. */
  readonly instanceIdOf: ReadonlyMap<NodeKey, number>;
}

/**
 * Build the {@link MarkerIndex} for an `N×N×N` board. Enumerates the nodes with x as the
 * outermost loop and z innermost — the SAME nesting `picking.ts` uses — so instance `i`
 * names the identical node in both layers. The inverse map is derived from the same walk,
 * so the two views can never drift.
 */
export function buildMarkerIndex(size: number): MarkerIndex {
  const count = size * size * size;
  // Decompose each linear instance id into (x,y,z) with x outermost, z innermost — the
  // same nesting `picking.ts` walks. `Array.from` (not a hand-written `for` counter) means
  // there is NO mutable loop-index to flip into a non-terminating loop, so every mutant
  // here is killed *deterministically* by a wrong enumeration a test asserts on — not by a
  // jittery timeout on an infinite loop (agent-principles #7: a gate must reject reliably).
  const nodeOfInstance: NodeKey[] = Array.from({ length: count }, (_, i) => {
    const x = Math.floor(i / (size * size));
    const y = Math.floor(i / size) % size;
    const z = i % size;
    return keyOf([x, y, z] as Coord);
  });
  const instanceIdOf = new Map<NodeKey, number>();
  nodeOfInstance.forEach((key, i) => instanceIdOf.set(key, i));
  return { count, nodeOfInstance, instanceIdOf };
}

/**
 * Resolve the per-instance visibility for the current `pieces` map: a marker is visible
 * iff its node is empty, and HIDDEN when a piece occupies it (the marker gives way to the
 * piece mesh — render-ui design Part 1). Returns a `boolean[]` aligned to `instanceId`.
 * `pieces` entries for off-board nodes are ignored (they map to no instance).
 */
export function resolveMarkerVisibility(
  index: MarkerIndex,
  pieces: Readonly<Record<NodeKey, Player>>,
): boolean[] {
  const visible = new Array<boolean>(index.count).fill(true);
  for (const node of Object.keys(pieces)) {
    const id = index.instanceIdOf.get(node);
    if (id !== undefined) visible[id] = false;
  }
  return visible;
}

/**
 * Map a set of node keys (e.g. the hover highlight's `nodes`) onto their marker instance
 * ids, preserving input order. Node keys with no marker on the board are silently skipped
 * — a hover target may name a node outside this board only through a bug, and yielding no
 * instance for it is safer than fabricating one.
 */
export function markerInstancesFor(
  index: MarkerIndex,
  nodes: readonly NodeKey[],
): number[] {
  const ids: number[] = [];
  for (const node of nodes) {
    const id = index.instanceIdOf.get(node);
    if (id !== undefined) ids.push(id);
  }
  return ids;
}
