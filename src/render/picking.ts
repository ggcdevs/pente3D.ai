/**
 * Raycast picking (Task 4.7) — the Three.js IO boundary that turns a pointer position into
 * a `RaycastHit` for the PURE hover resolver (`hover.ts`).
 *
 * The pure `computeHoverTarget` needs to know *what* the ray struck: an empty node, a
 * placed sphere, or a gridline (and which one). Resolving that is inherently IO — it
 * intersects Three.js geometry against a camera ray — so it lives here, THREE-side, and is
 * verified by Playwright driving the real canvas (`pickAt` on `window.__pente`) rather than
 * by mutation testing. The classification *rules* (empty-vs-placed, visible-only, the
 * placed-sphere asymmetry) stay pure in `hover.ts`.
 *
 * Node picking uses a dedicated **invisible instanced pick-sphere layer** — one sphere per
 * board node, sized to match the node's VISIBLE geometry so "what you see is what you can
 * hit" (GitHub issue #3): an EMPTY node's sphere is marker-sized, an OCCUPIED node's is
 * piece-sized (plus an optional small config padding). The base geometry is a UNIT sphere and
 * each instance is SCALED to its node's current radius via its matrix, so occupancy changes
 * only rewrite scales — never rebuild geometry. The per-node radius decision is the PURE,
 * THREE-free `resolveNodePickRadius` (`pickRadius.ts`, strict unit + mutation gate); this file
 * is the IO glue that applies it. `sync(state)` re-scales the changed instances on every board
 * change (wired through the scene's `syncBoard` choke point), so a placed piece grows its
 * hitbox and a captured/undone one shrinks it back.
 *
 * Before this fix EVERY node's sphere was one generous PIECE-sized radius, so in a dense
 * lattice viewed at an angle a near EMPTY node's oversized invisible sphere intercepted the
 * ray aimed at a FAR node's small visible marker (the nearest-hit raycaster then returned the
 * wrong, nearer node) — a "dead zone" over the far marker. Marker-sizing empty nodes removes it.
 *
 * Whether a picked node reads as an *empty node* or a *placed sphere* is still decided by the
 * live `GameState.pieces` at pick time (the piece meshes are individual and share the node's
 * world position, so the pick sphere stands in for both). Line picking intersects the three
 * category `InstancedMesh`es and maps the struck instance back to its `lineId` via the
 * layout's segment→line ranges.
 *
 * Board placement mirrors the scene/line/piece convention: node `(x,y,z)` → world
 * `((x − c)·spacing, …)` with `c = (size − 1)/2`, so the board is centered on the origin.
 */

import * as THREE from 'three';
import { keyOf, type Coord, type NodeKey } from '../core/coords.ts';
import type { GameState } from '../core/gameState.ts';
import type { LineCategory, LineId } from '../core/lines.ts';
import { buildLineGroups, LINE_CATEGORIES, type LineGroups } from './linesLayout.ts';
import { resolveNodePickRadius } from './pickRadius.ts';
import type { RaycastHit } from './hover.ts';

/** The geometry config subset picking needs (spacing + the node pick radius basis). */
export interface PickGeometryConfig {
  spacing: number;
  markerRadius: number;
  pieceRadius: number;
  /** Optional extra hit margin added to the visible radius (defaults to 0 when absent). */
  pickPadding?: number;
}

/** A category line mesh the picker may intersect, with its instance→line resolver. */
export interface PickableLineMesh {
  readonly category: LineCategory;
  readonly mesh: THREE.Object3D;
}

/** The live picking handle: the pick-sphere layer + the raycast resolver. */
export interface PickingHandle {
  /** The invisible node pick-sphere layer to add to the scene. */
  readonly object: THREE.Group;
  /**
   * Resolve an NDC pointer position to a {@link RaycastHit} (or `null`). `state` decides
   * empty-node vs placed-sphere for a node hit; `lineMeshes` are intersected for line hits.
   * The closest intersection across nodes + lines wins.
   */
  pickAt(
    ndcX: number,
    ndcY: number,
    camera: THREE.Camera,
    state: GameState,
    lineMeshes: readonly PickableLineMesh[],
  ): RaycastHit | null;
  /**
   * Resize every node's pick sphere to match its CURRENT visible geometry (issue #3):
   * marker-sized for an empty node, piece-sized for an occupied one. Call on every board
   * change (the `syncBoard` choke point) so an occupied node's hitbox grows to its piece and
   * an emptied node's shrinks back to its marker — keeping "what you see is what you can hit".
   */
  sync(state: GameState): void;
  /** World position (board-centered) of a node — exposed for tests/markers. */
  worldOf(node: Coord): { x: number; y: number; z: number };
  /**
   * The current pick-sphere radius for a node (world units), read back off the live instance
   * scale — for tests to prove an empty node is marker-sized and an occupied node piece-sized
   * (observable behavior, not inference — agent-principles #3). Returns null for an off-board node.
   */
  radiusOf(node: Coord): number | null;
  /** Free GPU resources. */
  dispose(): void;
}

/** World position of a node, board-centered by `spacing`. */
function worldVec(node: Coord, size: number, spacing: number): THREE.Vector3 {
  const c = (size - 1) / 2;
  return new THREE.Vector3(
    (node[0] - c) * spacing,
    (node[1] - c) * spacing,
    (node[2] - c) * spacing,
  );
}

/**
 * Build a reverse `category → (instanceId → lineId)` map from the pure line groups, so a
 * struck line instance can name its line. Each category group lays its lines out as
 * contiguous segment runs (`buildLineGroups`), so instance `i` belongs to whichever line's
 * `[start, start+count)` range contains `i`.
 */
function buildSegmentLineIndex(groups: LineGroups): Record<LineCategory, LineId[]> {
  const index = {} as Record<LineCategory, LineId[]>;
  for (const category of LINE_CATEGORIES) {
    const group = groups[category];
    const perInstance: LineId[] = new Array(group.segmentCount);
    for (const [lineId, range] of group.rangeOf) {
      for (let i = 0; i < range.count; i++) perInstance[range.start + i] = lineId;
    }
    index[category] = perInstance;
  }
  return index;
}

/**
 * Create the picker for an `N×N×N` board. Builds an invisible instanced pick-sphere layer
 * (one sphere per node) sized from `geometry`, and precomputes the node key + world
 * position per instance and the segment→line index for line hits.
 */
export function createPicking(
  size: number,
  geometry: PickGeometryConfig,
): PickingHandle {
  const spacing = geometry.spacing;
  const padding = geometry.pickPadding ?? 0;

  const object = new THREE.Group();
  object.name = 'pick:nodes';

  // A UNIT sphere is the base geometry; each instance is SCALED to its node's current pick
  // radius (issue #3). Varying the radius per instance via the matrix scale — rather than one
  // shared oversized geometry — is what lets an empty node's hitbox stay marker-sized while an
  // occupied node's grows to its piece, all in one draw with no geometry rebuilds.
  const geo = new THREE.SphereGeometry(1, 8, 6);
  const material = new THREE.MeshBasicMaterial();
  const count = size * size * size;
  const mesh = new THREE.InstancedMesh(geo, material, count);
  mesh.name = 'pick:node-spheres';
  // Invisible to the render (never drawn), but still raycastable — we intersect the mesh
  // object directly, so `visible = false` keeps it off-screen without disabling picking.
  mesh.visible = false;

  const nodeOfInstance: NodeKey[] = new Array(count);
  const worldOfInstance: THREE.Vector3[] = new Array(count);
  const instanceOfNode = new Map<NodeKey, number>();
  const dummy = new THREE.Object3D();
  const NO_ROT = new THREE.Quaternion();

  /** Resolve a node's pick radius from its occupancy — pure decision, THREE-free. */
  function radiusFor(occupied: boolean): number {
    return resolveNodePickRadius({
      occupied,
      markerRadius: geometry.markerRadius,
      pieceRadius: geometry.pieceRadius,
      spacing,
      padding,
    });
  }

  /** Write instance `i`'s matrix at its fixed world position, scaled uniformly to `radius`. */
  function setInstanceRadius(i: number, radius: number): void {
    dummy.position.copy(worldOfInstance[i]!);
    dummy.scale.set(radius, radius, radius);
    dummy.quaternion.copy(NO_ROT);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }

  // The pick radius currently applied to each instance, so `sync` only rewrites the changed
  // ones and `radiusOf` reports observed truth (not an inferred value).
  const radii: number[] = new Array(count);
  const emptyRadius = radiusFor(false);
  let i = 0;
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        const node: Coord = [x, y, z];
        const key = keyOf(node);
        worldOfInstance[i] = worldVec(node, size, spacing);
        nodeOfInstance[i] = key;
        instanceOfNode.set(key, i);
        // The board starts empty → every node is marker-sized.
        setInstanceRadius(i, emptyRadius);
        radii[i] = emptyRadius;
        i++;
      }
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  object.add(mesh);

  const segmentLineIndex = buildSegmentLineIndex(buildLineGroups(size));
  const raycaster = new THREE.Raycaster();

  function pickAt(
    ndcX: number,
    ndcY: number,
    camera: THREE.Camera,
    state: GameState,
    lineMeshes: readonly PickableLineMesh[],
  ): RaycastHit | null {
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

    // Nearest node-sphere intersection.
    const nodeHits = raycaster.intersectObject(mesh, false);
    const nodeHit = nodeHits[0];

    // Nearest line-segment intersection across the three category meshes.
    let lineHit: { distance: number; category: LineCategory; instanceId: number } | null = null;
    for (const { category, mesh: lineMesh } of lineMeshes) {
      const hits = raycaster.intersectObject(lineMesh, false);
      const hit = hits[0];
      if (hit && hit.instanceId !== undefined) {
        if (lineHit === null || hit.distance < lineHit.distance) {
          lineHit = { distance: hit.distance, category, instanceId: hit.instanceId };
        }
      }
    }

    // The closest of the two wins. A node hit ties-break to the node (spheres sit at nodes,
    // and a gridline through the same node is co-located — the node is the intended target).
    const nodeDist = nodeHit?.distance ?? Infinity;
    const lineDist = lineHit?.distance ?? Infinity;

    if (nodeHit !== undefined && nodeHit.instanceId !== undefined && nodeDist <= lineDist) {
      const node = nodeOfInstance[nodeHit.instanceId]!;
      return state.pieces[node] !== undefined
        ? { kind: 'placed-sphere', node }
        : { kind: 'empty-node', node };
    }
    if (lineHit !== null) {
      const lineId = segmentLineIndex[lineHit.category][lineHit.instanceId];
      if (lineId !== undefined) return { kind: 'line', lineId };
    }
    return null;
  }

  /**
   * Re-scale every node's pick sphere to its CURRENT occupancy (issue #3): occupied → piece
   * radius, empty → marker radius. Only the instances whose radius actually changed are
   * rewritten, so a single placement touches one instance. An off-board `pieces` key names no
   * instance and is ignored.
   */
  function sync(state: GameState): void {
    let changed = false;
    const occRadius = radiusFor(true);
    // Fast path: assume every node empty, then bump the occupied ones. `pieces` holds only the
    // occupied nodes, so this visits exactly the pieces plus the ones that just emptied.
    for (let idx = 0; idx < count; idx++) {
      const want = state.pieces[nodeOfInstance[idx]!] !== undefined ? occRadius : emptyRadius;
      if (want !== radii[idx]) {
        setInstanceRadius(idx, want);
        radii[idx] = want;
        changed = true;
      }
    }
    if (changed) mesh.instanceMatrix.needsUpdate = true;
  }

  function worldOf(node: Coord): { x: number; y: number; z: number } {
    const v = worldVec(node, size, spacing);
    return { x: v.x, y: v.y, z: v.z };
  }

  function radiusOf(node: Coord): number | null {
    const idx = instanceOfNode.get(keyOf(node));
    return idx === undefined ? null : radii[idx]!;
  }

  function dispose(): void {
    object.remove(mesh);
    geo.dispose();
    material.dispose();
  }

  return { object, pickAt, sync, worldOf, radiusOf, dispose };
}
