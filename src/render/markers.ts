/**
 * Instanced node markers (Task 4.3) — the Three.js IO boundary.
 *
 * The small translucent spheres marking every empty board node (render-ui design Part 1:
 * the "where can I play" affordance). They are a single `InstancedMesh` of N³ spheres —
 * one instance per node — because unlike pieces they are numerous, uniform, and never
 * animate individually; instancing keeps them one draw call. All the fiddly logic (the
 * `nodeKey ↔ instanceId` enumeration, which markers hide under a piece, which instances a
 * hover set glows) is the PURE `markersLayout.ts`; this file is the thin THREE glue that
 * reflects that plan onto GPU buffers, verified by Playwright against `window.__pente`
 * (`getMarkers`) + a screenshot, not by mutation testing (build plan Task 4.3 gating model).
 *
 * A hidden marker (its node is occupied) is collapsed to a zero-scale matrix — THREE has
 * no per-instance `visible` flag, and zero scale removes the sphere from the render while
 * keeping the instance slot stable so ids never renumber. Placement reuses the caller's
 * board-centered `worldOf` (picking's helper) so markers and pick spheres share a node
 * position exactly (DRY — the marker you see is the node you pick).
 */

import * as THREE from 'three';
import {
  buildMarkerIndex,
  resolveMarkerVisibility,
  markerInstancesFor,
  type MarkerIndex,
} from './markersLayout.ts';
import type { Coord, NodeKey } from '../core/coords.ts';
import type { GameState } from '../core/gameState.ts';
import { getConfig } from '../config/config.ts';

/** The `colors` config subset the markers need. */
export interface MarkerColorsConfig {
  emptySphere: string;
  hoverHighlight: string;
}

/** The `geometry` config subset the markers need. */
export interface MarkerGeometryConfig {
  markerRadius: number;
  sphereSegments: { width: number; height: number };
}

/** The `materials` config subset the markers need. */
export interface MarkerMaterialsConfig {
  markerOpacity: number;
  markerDepthWrite: boolean;
}

/** The `rendering` config subset the markers need (surface gloss). */
export interface MarkerRenderingConfig {
  marker: { roughness: number; metalness: number };
}

/** A plain, serializable readout for one queried node — for Playwright assertions. */
export interface MarkerNodeReadout {
  /** The queried node key. */
  node: NodeKey;
  /** The instance id backing it, or -1 if the node is not a board marker. */
  instanceId: number;
  /** Whether the marker is currently drawn (false when a piece occupies the node). */
  visible: boolean;
  /** True iff the marker is currently hover-highlighted (its instance colour is the glow). */
  highlighted: boolean;
  /**
   * The instance's ACTUAL rendered colour, read back from the live `instanceColor` GPU buffer
   * (not the logical `highlighted` flag) as a lowercase `#rrggbb` string. This is render truth:
   * it exposes what pixel each individual instance draws, so a test can prove a hover changed
   * ONLY the hovered instance and left every other instance's colour untouched — catching a
   * shared-material glow that a logical highlight flag would miss. `#000000` for id -1.
   */
  instanceColorHex: string;
}

/** A plain-number readout of the whole marker layer — for `window.__pente`. */
export interface MarkersReadout {
  /** Total marker instances (`N³`). */
  count: number;
  /** How many markers are currently drawn (empty nodes). */
  visibleCount: number;
  /** How many markers are currently hover-highlighted. */
  highlightedCount: number;
  /**
   * The shared material's effective emissive contribution: `emissiveIntensity` if the emissive
   * colour is non-black, else 0 (a black emissive contributes nothing regardless of intensity).
   * The hover glow MUST NOT drive this — any material-level emissive lights every instance at
   * once (the "hover one, all glow" bug), so a test asserting this stays 0 across a hover pins
   * the highlight to per-instance colour only.
   */
  materialEmissiveIntensity: number;
  /** Per-node detail for the queried node keys (order preserved). */
  nodes: MarkerNodeReadout[];
}

/** The live markers handle: the instanced mesh + sync + hover-highlight + inspector. */
export interface MarkersHandle {
  /** The InstancedMesh container to add to the scene. */
  readonly object: THREE.Group;
  /** Reflect `state.pieces` onto marker visibility (hide the occupied nodes). */
  sync(state: GameState): void;
  /**
   * Apply the hover glow to exactly the markers at `nodes`, restoring every other marker to
   * its base colour. Idempotent; a marker that is hidden still records its highlight state
   * (so re-showing it later would glow) but a zero-scale instance draws nothing regardless.
   */
  highlight(nodes: readonly NodeKey[]): void;
  /** Plain-number readout; `query` node keys get per-node detail (visibility/highlight/id). */
  getMarkers(query?: readonly NodeKey[]): MarkersReadout;
  /** Free GPU resources. */
  dispose(): void;
}

/** World position of a node, board-centered by `spacing` (fallback when no `worldOf` given). */
function defaultWorldOf(size: number, spacing: number) {
  const c = (size - 1) / 2;
  return (node: Coord): { x: number; y: number; z: number } => ({
    x: (node[0] - c) * spacing,
    y: (node[1] - c) * spacing,
    z: (node[2] - c) * spacing,
  });
}

/**
 * Create the instanced node-marker layer for an `N×N×N` board. Reads `colors`, `geometry`,
 * `materials`, and `rendering` from the layered config store (no magic values). `worldOf`
 * places each instance — pass picking's helper so markers and pick spheres coincide; it
 * defaults to the shared board-centered convention when omitted.
 */
export function createMarkers(
  size: number,
  worldOf: (node: Coord) => { x: number; y: number; z: number } = defaultWorldOf(
    size,
    (getConfig('geometry') as unknown as { spacing: number }).spacing,
  ),
): MarkersHandle {
  const colors = getConfig('colors') as unknown as MarkerColorsConfig;
  const geometry = getConfig('geometry') as unknown as MarkerGeometryConfig;
  const materials = getConfig('materials') as unknown as MarkerMaterialsConfig;
  const rendering = getConfig('rendering') as unknown as MarkerRenderingConfig;

  const index: MarkerIndex = buildMarkerIndex(size);

  const object = new THREE.Group();
  object.name = 'markers';

  const geo = new THREE.SphereGeometry(
    geometry.markerRadius,
    geometry.sphereSegments.width,
    geometry.sphereSegments.height,
  );
  // Per-instance colour drives the hover glow (base colour → highlight colour); `instanceColor`
  // is multiplied into the material colour, so the material stays white and each instance's
  // `setColorAt` is the literal colour drawn. The glow MUST be per-instance only: the material
  // is shared across all N³ instances, so any material-level property (e.g. `emissive` /
  // `emissiveIntensity`) would light EVERY marker at once — the exact "hover one, all glow" bug.
  // Emissive cannot be varied per-instance on a MeshStandardMaterial without a custom shader,
  // so the highlight is expressed purely as a per-instance albedo swap (same technique the lines
  // layer uses) and the material carries NO emissive.
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: rendering.marker.roughness,
    metalness: rendering.marker.metalness,
    transparent: true,
    opacity: materials.markerOpacity,
    depthWrite: materials.markerDepthWrite,
  });
  const mesh = new THREE.InstancedMesh(geo, material, index.count);
  mesh.name = 'markers:spheres';
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(index.count * 3), 3);

  const baseColor = new THREE.Color(colors.emptySphere);
  const glowColor = new THREE.Color(colors.hoverHighlight);

  // The visible-scale matrix per instance (identity translation to its node); the hidden
  // matrix is the same but zero-scaled. We keep the shown/zero matrices per instance so a
  // sync only rewrites the changed instances.
  const shownMatrix: THREE.Matrix4[] = new Array(index.count);
  const zeroMatrix: THREE.Matrix4[] = new Array(index.count);
  const dummy = new THREE.Object3D();
  const ZERO = new THREE.Vector3(0, 0, 0);
  const NO_ROT = new THREE.Quaternion();
  for (let i = 0; i < index.count; i++) {
    const [x, y, z] = index.nodeOfInstance[i]!.split(',').map(Number) as Coord;
    const w = worldOf([x, y, z]);
    dummy.position.set(w.x, w.y, w.z);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    shownMatrix[i] = dummy.matrix.clone();
    zeroMatrix[i] = new THREE.Matrix4().compose(dummy.position.clone(), NO_ROT, ZERO);
    mesh.setMatrixAt(i, shownMatrix[i]!);
    mesh.setColorAt(i, baseColor);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  object.add(mesh);

  // Live per-instance state, so readouts report observed truth (not inferred).
  let visible: boolean[] = new Array<boolean>(index.count).fill(true);
  const highlighted: boolean[] = new Array<boolean>(index.count).fill(false);

  function sync(state: GameState): void {
    const next = resolveMarkerVisibility(index, state.pieces);
    for (let i = 0; i < index.count; i++) {
      if (next[i] === visible[i]) continue;
      mesh.setMatrixAt(i, next[i] ? shownMatrix[i]! : zeroMatrix[i]!);
    }
    visible = next;
    mesh.instanceMatrix.needsUpdate = true;
  }

  function highlight(nodes: readonly NodeKey[]): void {
    const on = new Set(markerInstancesFor(index, nodes));
    let changed = false;
    for (let i = 0; i < index.count; i++) {
      const want = on.has(i);
      if (want !== highlighted[i]) {
        // Per-instance colour swap ONLY — no material-level property is touched, so the glow
        // is confined to instance `i` and never bleeds onto the other N³−1 markers.
        mesh.setColorAt(i, want ? glowColor : baseColor);
        highlighted[i] = want;
        changed = true;
      }
    }
    if (changed && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  // Scratch colour reused for every read-back — the real per-instance colour is pulled from the
  // live `instanceColor` buffer via `getColorAt`, so the readout reflects the GPU state actually
  // drawn, never the logical `highlighted` flag.
  const readColor = new THREE.Color();
  function instanceColorHexOf(id: number): string {
    mesh.getColorAt(id, readColor);
    return `#${readColor.getHexString()}`;
  }

  function getMarkers(query: readonly NodeKey[] = []): MarkersReadout {
    let visibleCount = 0;
    let highlightedCount = 0;
    for (let i = 0; i < index.count; i++) {
      if (visible[i]) visibleCount++;
      if (highlighted[i]) highlightedCount++;
    }
    const nodes: MarkerNodeReadout[] = query.map((node) => {
      const id = index.instanceIdOf.get(node);
      return id === undefined
        ? { node, instanceId: -1, visible: false, highlighted: false, instanceColorHex: '#000000' }
        : {
            node,
            instanceId: id,
            visible: visible[id]!,
            highlighted: highlighted[id]!,
            instanceColorHex: instanceColorHexOf(id),
          };
    });
    // A black emissive contributes nothing however high the intensity, so report the effective
    // glow lever: 0 when the emissive colour is black. This is what actually lights the pixels,
    // and it is a SHARED (per-material, not per-instance) value — non-zero here means every
    // marker glows at once (the bug this readout exists to catch).
    const emissiveIsBlack =
      material.emissive.r === 0 && material.emissive.g === 0 && material.emissive.b === 0;
    return {
      count: index.count,
      visibleCount,
      highlightedCount,
      materialEmissiveIntensity: emissiveIsBlack ? 0 : material.emissiveIntensity,
      nodes,
    };
  }

  function dispose(): void {
    object.remove(mesh);
    mesh.dispose();
    geo.dispose();
    material.dispose();
  }

  return { object, sync, highlight, getMarkers, dispose };
}
