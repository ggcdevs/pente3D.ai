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
 * board node, slightly larger than the visible marker/piece so the whole node cell is
 * clickable. Whether a picked node reads as an *empty node* or a *placed sphere* is decided
 * by the live `GameState.pieces` at pick time (the piece meshes are individual and share
 * the node's world position, so the pick sphere stands in for both). Line picking
 * intersects the three category `InstancedMesh`es and maps the struck instance back to its
 * `lineId` via the layout's segment→line ranges.
 *
 * Board placement mirrors the scene/line/piece convention: node `(x,y,z)` → world
 * `((x − c)·spacing, …)` with `c = (size − 1)/2`, so the board is centered on the origin.
 */

import * as THREE from 'three';
import { keyOf, type Coord, type NodeKey } from '../core/coords.ts';
import type { GameState } from '../core/gameState.ts';
import type { LineCategory, LineId } from '../core/lines.ts';
import { buildLineGroups, LINE_CATEGORIES, type LineGroups } from './linesLayout.ts';
import type { RaycastHit } from './hover.ts';

/** The geometry config subset picking needs (spacing + the node pick radius basis). */
export interface PickGeometryConfig {
  spacing: number;
  markerRadius: number;
  pieceRadius: number;
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
  /** World position (board-centered) of a node — exposed for tests/markers. */
  worldOf(node: Coord): { x: number; y: number; z: number };
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
  // Pick radius: generous — the larger of the piece and a padded marker — so the whole node
  // cell is clickable regardless of what occupies it. Never exceeds half the spacing so
  // adjacent nodes stay separable.
  const pickRadius = Math.min(
    spacing * 0.49,
    Math.max(geometry.pieceRadius, geometry.markerRadius * 1.5),
  );

  const object = new THREE.Group();
  object.name = 'pick:nodes';

  const geo = new THREE.SphereGeometry(pickRadius, 8, 6);
  const material = new THREE.MeshBasicMaterial();
  const count = size * size * size;
  const mesh = new THREE.InstancedMesh(geo, material, count);
  mesh.name = 'pick:node-spheres';
  // Invisible to the render (never drawn), but still raycastable — we intersect the mesh
  // object directly, so `visible = false` keeps it off-screen without disabling picking.
  mesh.visible = false;

  const nodeOfInstance: NodeKey[] = new Array(count);
  const dummy = new THREE.Object3D();
  let i = 0;
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        const node: Coord = [x, y, z];
        dummy.position.copy(worldVec(node, size, spacing));
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        nodeOfInstance[i] = keyOf(node);
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

  function worldOf(node: Coord): { x: number; y: number; z: number } {
    const v = worldVec(node, size, spacing);
    return { x: v.x, y: v.y, z: v.z };
  }

  function dispose(): void {
    object.remove(mesh);
    geo.dispose();
    material.dispose();
  }

  return { object, pickAt, worldOf, dispose };
}
