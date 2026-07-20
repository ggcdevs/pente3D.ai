/**
 * Instanced gridlines by category (Task 4.4) — the Three.js IO boundary.
 *
 * Builds three `InstancedMesh` groups (orthogonal / face / space) from the PURE
 * `resolveLineLayout` plan: each group is one thin box geometry instanced once per
 * *segment* (adjacent node pair), oriented + scaled to bridge its two nodes. The
 * categories toggle independently (render-ui design Part 1), each with a config-driven
 * additive/normal blend (Part 2: additive lines read as an order-independent glow).
 *
 * This file may import three (it is the render layer, NOT `src/core`); it holds ZERO
 * game logic and ZERO grouping/index math — all of that lives in `linesLayout.ts` and
 * `src/core`. It is verified by Playwright against `window.__pente` readouts
 * (`getVisibleLines`) + a screenshot, not by mutation testing (build plan Task 4.4).
 *
 * Board placement mirrors the marker/scene convention: a node `(x,y,z)` maps to world
 * `((x − c)·spacing, (y − c)·spacing, (z − c)·spacing)` with `c = (size − 1)/2`, so the
 * board is centered on the origin.
 */

import * as THREE from 'three';
import {
  resolveLineLayout,
  LINE_CATEGORIES,
  type BlendMode,
  type BlendingConfig,
  type LineSegment,
  type ResolvedLineLayout,
} from './linesLayout.ts';
import type { LineCategory, LineId } from '../core/lines.ts';
import type { Coord } from '../core/coords.ts';
import { getConfig } from '../config/config.ts';

/** The colors config subset the gridlines need (per-category line color). */
export interface LineColorsConfig {
  lineOrthogonal: string;
  lineFaceDiagonal: string;
  lineSpaceDiagonal: string;
  lineOpacity: number;
}

/** The geometry config subset the gridlines need. */
export interface LineGeometryConfig {
  spacing: number;
  lineThickness: number;
}

/** A plain, serializable readout of one category group — for Playwright assertions. */
export interface LineGroupReadout {
  /** The core category name. */
  category: LineCategory;
  /** Whether the group's mesh is currently drawn. */
  visible: boolean;
  /** How the group composites. */
  blending: BlendMode;
  /** Number of segment instances in the group's mesh. */
  segmentCount: number;
  /** Number of full lines in the group. */
  lineCount: number;
}

/** The live gridlines handle: the three meshes + inspectors + toggles. */
export interface LinesHandle {
  /** A group container holding the three category InstancedMeshes. */
  readonly object: THREE.Group;
  /** Plain-number readout of every category group (for `window.__pente`). */
  getVisibleLines(): LineGroupReadout[];
  /** The instance range `{start,count}` a `lineId` occupies in its group, or null. */
  rangeOf(category: LineCategory, lineId: LineId): { start: number; count: number } | null;
  /**
   * The currently-*visible* category meshes, tagged with their category — the raycast
   * targets for line picking (Task 4.7). Hidden categories are omitted so a hover never
   * resolves to an undrawn line (the visible-only hover rule, game-core Part 4).
   */
  pickables(): { category: LineCategory; mesh: THREE.InstancedMesh }[];
  /** Toggle a category's visibility at runtime (glue flips a flag, no rebuild). */
  setVisible(category: LineCategory, visible: boolean): void;
  /** Free GPU resources. */
  dispose(): void;
}

/** Map a core category to its per-category color-config key. */
function colorKeyOf(category: LineCategory): keyof LineColorsConfig {
  switch (category) {
    case 'orthogonal':
      return 'lineOrthogonal';
    case 'face':
      return 'lineFaceDiagonal';
    case 'space':
      return 'lineSpaceDiagonal';
    default:
      throw new Error(`unknown line category: ${JSON.stringify(category)}`);
  }
}

/** World position of a node, board-centered by `spacing`. */
function worldOf(node: Coord, size: number, spacing: number): THREE.Vector3 {
  const c = (size - 1) / 2;
  return new THREE.Vector3(
    (node[0] - c) * spacing,
    (node[1] - c) * spacing,
    (node[2] - c) * spacing,
  );
}

/** THREE blend constant for a resolved blend mode. */
function threeBlending(mode: BlendMode): THREE.Blending {
  return mode === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
}

/**
 * Compose the per-segment instance transform: a unit box along +Y is scaled to the
 * segment length (in Y) and to `thickness` in X/Z, oriented from `a → b`, and centered
 * at the segment midpoint. Returns the matrix for one instance.
 */
function segmentMatrix(
  segment: LineSegment,
  size: number,
  spacing: number,
  thickness: number,
): THREE.Matrix4 {
  const a = worldOf(segment.a, size, spacing);
  const b = worldOf(segment.b, size, spacing);
  const dir = new THREE.Vector3().subVectors(b, a);
  const length = dir.length();
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.clone().normalize(),
  );
  const scale = new THREE.Vector3(thickness, length, thickness);
  return new THREE.Matrix4().compose(mid, quat, scale);
}

/** Build one category's InstancedMesh from its resolved group + view config. */
function buildGroupMesh(
  category: LineCategory,
  layout: ResolvedLineLayout,
  size: number,
  colors: LineColorsConfig,
  geometry: LineGeometryConfig,
): THREE.InstancedMesh {
  const group = layout[category];
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colors[colorKeyOf(category)]),
    transparent: true,
    opacity: colors.lineOpacity,
    blending: threeBlending(group.blending),
    depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geo, material, group.segmentCount);
  mesh.name = `gridlines:${category}`;
  for (let i = 0; i < group.segments.length; i++) {
    mesh.setMatrixAt(i, segmentMatrix(group.segments[i]!, size, spacing(geometry), geometry.lineThickness));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.visible = group.visible;
  return mesh;
}

/** Extract spacing, isolated so a future non-uniform spacing has one edit point. */
function spacing(geometry: LineGeometryConfig): number {
  return geometry.spacing;
}

/**
 * Create the instanced gridlines for an `N×N×N` board. Reads `lineVisibility`,
 * `blending`, `colors`, and `geometry` from the layered config store (no magic values),
 * resolves the PURE layout, and builds the three category meshes. The returned handle
 * exposes plain-number readouts + a runtime visibility toggle for `window.__pente`.
 */
export function createLines(size: number): LinesHandle {
  // The `blending` JSON default widens to `string` per key; the pure resolver validates
  // each value against the known modes at runtime, so this cast can never smuggle a bad
  // mode past the gate — `resolveLineBlending` throws honestly on anything unrecognized.
  const layout = resolveLineLayout(
    size,
    getConfig('lineVisibility'),
    getConfig('blending') as unknown as BlendingConfig,
  );
  const colors = getConfig('colors') as unknown as LineColorsConfig;
  const geometry = getConfig('geometry') as unknown as LineGeometryConfig;

  const object = new THREE.Group();
  object.name = 'gridlines';
  const meshes = {} as Record<LineCategory, THREE.InstancedMesh>;
  for (const category of LINE_CATEGORIES) {
    const mesh = buildGroupMesh(category, layout, size, colors, geometry);
    meshes[category] = mesh;
    object.add(mesh);
  }

  function getVisibleLines(): LineGroupReadout[] {
    return LINE_CATEGORIES.map((category) => ({
      category,
      visible: meshes[category].visible,
      blending: layout[category].blending,
      segmentCount: layout[category].segmentCount,
      lineCount: layout[category].lines.length,
    }));
  }

  function rangeOf(
    category: LineCategory,
    lineId: LineId,
  ): { start: number; count: number } | null {
    return layout[category].rangeOf.get(lineId) ?? null;
  }

  function pickables(): { category: LineCategory; mesh: THREE.InstancedMesh }[] {
    return LINE_CATEGORIES.filter((category) => meshes[category].visible).map((category) => ({
      category,
      mesh: meshes[category],
    }));
  }

  function setVisible(category: LineCategory, visible: boolean): void {
    meshes[category].visible = visible;
  }

  function dispose(): void {
    for (const category of LINE_CATEGORIES) {
      const mesh = meshes[category];
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      object.remove(mesh);
    }
  }

  return { object, getVisibleLines, rangeOf, pickables, setVisible, dispose };
}
