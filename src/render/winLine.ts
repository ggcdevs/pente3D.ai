/**
 * The winning-line mesh (Task 4.9) — the Three.js IO boundary.
 *
 * When a game is won by five-in-a-row, `GameState.winningLine` holds the ordered run of
 * winning nodes. The render-ui design (Part 1) draws it as a single **individual, partial**
 * line mesh (0-or-1 in count) rather than one of the instanced full-line groups: it is
 * dynamic and few, so an individual mesh keeps add/remove trivial. This handle reflects
 * the live state into that mesh — showing a config-coloured line spanning exactly the
 * winning run when the game is won by a line, and hiding it otherwise (a capture win
 * records no `winningLine`, and an in-progress or undone game has none).
 *
 * This file may import three (it is the render layer, NOT `src/core`); it holds ZERO game
 * logic and ZERO layout math — the endpoint/segment plan comes from the PURE
 * `resolveWinLine` (`winLineLayout.ts`) + `src/core`. It is verified by Playwright against
 * `window.__pente` (`getWinLine`) + a screenshot, not by mutation testing (build plan Task
 * 4.9 gating model).
 *
 * Board placement mirrors the scene/marker/line/piece convention: a node `(x,y,z)` maps to
 * world `((x − c)·spacing, (y − c)·spacing, (z − c)·spacing)` with `c = (size − 1)/2`, so
 * the board is centered on the origin.
 */

import * as THREE from 'three';
import { resolveWinLine, type WinSegment } from './winLineLayout.ts';
import type { GameState } from '../core/gameState.ts';
import type { Coord } from '../core/coords.ts';
import { getConfig } from '../config/config.ts';

/** The colors config subset the win line needs (its highlight colour). */
export interface WinLineColorsConfig {
  winningLine: string;
}

/** The geometry config subset the win line needs. */
export interface WinLineGeometryConfig {
  spacing: number;
  /** The base gridline thickness; the win line renders thicker (a prominence multiplier). */
  lineThickness: number;
}

/** The rendering config subset the win line needs (its prominence + opacity). */
export interface WinLineRenderingConfig {
  /** Multiplier on `lineThickness` so the winning line reads bolder than a gridline. */
  winLineThickness: number;
  /** The win-line material opacity (drawn opaque-ish over the board). */
  winLineOpacity: number;
}

/** A plain, serializable readout of the win line — for Playwright assertions. */
export interface WinLineReadout {
  /** Whether the win-line mesh is currently drawn. */
  visible: boolean;
  /** The winning run's node keys in order, or `[]` when nothing is drawn. */
  nodes: string[];
  /** Number of segment instances bridging the run (`nodes.length − 1`, or 0). */
  segmentCount: number;
  /** The mesh's material colour as a hex int, for a config-derived colour assertion. */
  color: number;
  /** The mesh's current material opacity (0 when hidden). */
  opacity: number;
}

/** The live win-line handle: the mesh container + inspector + the state-driven sync. */
export interface WinLineHandle {
  /** A group container holding the (single) win-line InstancedMesh, or empty when hidden. */
  readonly object: THREE.Group;
  /** Reflect `state.winningLine` into the mesh: draw the partial line, or hide it. */
  sync(state: GameState): void;
  /**
   * Live-set the winning-line colour (issue #15 `colors.winningLine` live-apply): mutate the shared
   * material's colour in place. Because the material is reused across every (re)built win-line mesh, a
   * currently-drawn win line recolours on the next frame AND a future win (built after this call) draws
   * in the new colour. No rebuild. Returns the applied colour as a hex int (matches `getWinLine().color`).
   */
  setColor(hex: string): number;
  /** Plain-number readout of the win line (for `window.__pente`). */
  getWinLine(): WinLineReadout;
  /** Free GPU resources. */
  dispose(): void;
}

/** World position of a node, board-centered by `spacing` (mirrors lines/pieces). */
function worldOf(node: Coord, size: number, spacing: number): THREE.Vector3 {
  const c = (size - 1) / 2;
  return new THREE.Vector3(
    (node[0] - c) * spacing,
    (node[1] - c) * spacing,
    (node[2] - c) * spacing,
  );
}

/**
 * Compose one segment's instance transform: a unit box along +Y scaled to the segment
 * length (Y) and `thickness` (X/Z), oriented `a → b`, centered at the midpoint. Mirrors
 * the instanced-gridline `segmentMatrix` so the win line sits exactly on the run.
 */
function segmentMatrix(
  segment: WinSegment,
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

/**
 * Create the winning-line renderer for an `N×N×N` board. Reads `colors`, `geometry`, and
 * `rendering` from the layered config store (no magic values). The returned handle keeps a
 * single reusable `InstancedMesh` (rebuilt to fit each winning run's segment count) and
 * reflects each `GameState` into it via the pure `resolveWinLine`, exposing a plain-number
 * readout for `window.__pente`.
 */
export function createWinLine(size: number): WinLineHandle {
  const colors = getConfig('colors') as unknown as WinLineColorsConfig;
  const geometry = getConfig('geometry') as unknown as WinLineGeometryConfig;
  const rendering = getConfig('rendering') as unknown as WinLineRenderingConfig;

  const object = new THREE.Group();
  object.name = 'winLine';

  const color = new THREE.Color(colors.winningLine);
  const thickness = geometry.lineThickness * rendering.winLineThickness;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: rendering.winLineOpacity,
  });

  /** The live mesh, rebuilt when the segment count changes; null when nothing is drawn. */
  let mesh: THREE.InstancedMesh | null = null;
  /** The winning run's node keys currently drawn (for the readout), or []. */
  let drawnNodes: string[] = [];

  function clearMesh(): void {
    if (mesh) {
      object.remove(mesh);
      mesh.dispose();
      mesh = null;
    }
    drawnNodes = [];
  }

  function sync(state: GameState): void {
    const plan = resolveWinLine(state.winningLine, size);
    if (plan === null) {
      clearMesh();
      return;
    }
    // (Re)build the instanced mesh sized to the run's segments and lay out each segment.
    clearMesh();
    const m = new THREE.InstancedMesh(geo, material, plan.segments.length);
    m.name = 'winLine:mesh';
    for (let i = 0; i < plan.segments.length; i++) {
      m.setMatrixAt(i, segmentMatrix(plan.segments[i]!, size, geometry.spacing, thickness));
    }
    m.instanceMatrix.needsUpdate = true;
    object.add(m);
    mesh = m;
    drawnNodes = plan.nodes.map((n) => `${n[0]},${n[1]},${n[2]}`);
  }

  /**
   * Live-set the win-line colour (issue #15): mutate the shared material's colour. The material is reused
   * across every mesh rebuild, so a drawn win line recolours immediately and a future win draws in the new
   * colour. Returns the applied colour as a hex int (the same value `getWinLine().color` reports).
   */
  function setColor(hex: string): number {
    material.color.set(hex);
    return material.color.getHex();
  }

  function getWinLine(): WinLineReadout {
    return {
      visible: mesh !== null,
      nodes: [...drawnNodes],
      segmentCount: mesh ? mesh.count : 0,
      color: material.color.getHex(),
      opacity: mesh ? material.opacity : 0,
    };
  }

  function dispose(): void {
    clearMesh();
    geo.dispose();
    material.dispose();
  }

  return { object, sync, setColor, getWinLine, dispose };
}
