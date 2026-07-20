/**
 * Individual piece meshes (Task 4.5) — the Three.js IO boundary.
 *
 * Pieces are deliberately **individual** `Mesh`es, not instanced (render-ui design Part
 * 1): realistic Pente piece counts are ~20–100, and individual meshes make history-
 * replay/undo add-remove and per-piece animation trivial. On every `GameState` change
 * this handle reconciles the live mesh set to the new `pieces` map via the PURE
 * `diffPieces` plan (render-ui design Part 2, incremental scene-update model): it creates
 * a mesh per newly-occupied node (fading in from 0 → its material opacity — the placement
 * seam), disposes the mesh at each vacated node (fading out first — the capture seam), and
 * swaps the material of any node whose occupant changed identity (the undo/redo/history-
 * scrub edge). A full board load (resize/game-load) is just a diff against the empty set.
 *
 * This file may import three (it is the render layer, NOT `src/core`); it holds ZERO game
 * logic and ZERO diff math — all of that lives in `piecesDiff.ts` and `src/core`. It is
 * verified by Playwright against `window.__pente` readouts (`getPieces`) + a screenshot,
 * not by mutation testing (build plan Task 4.5 gating model).
 *
 * Board placement mirrors the scene/marker/line convention: a node `(x,y,z)` maps to
 * world `((x − c)·spacing, (y − c)·spacing, (z − c)·spacing)` with `c = (size − 1)/2`,
 * so the board is centered on the origin.
 */

import * as THREE from 'three';
import { diffPieces } from './piecesDiff.ts';
import type { Player, GameState } from '../core/gameState.ts';
import { coordsOf, type NodeKey } from '../core/coords.ts';
import { getConfig } from '../config/config.ts';

/** The colors config subset the pieces need (per-colour piece color). */
export interface PieceColorsConfig {
  whitePiece: string;
  blackPiece: string;
}

/** The geometry config subset the pieces need. */
export interface PieceGeometryConfig {
  spacing: number;
  pieceRadius: number;
  sphereSegments: { width: number; height: number };
}

/** The `materials` config subset the pieces need (full-piece opacity target). */
export interface PieceMaterialsConfig {
  pieceOpacity: number;
}

/**
 * The `rendering` config subset the pieces need: the standard-material gloss params and
 * the placement/capture fade duration (ms). Config-driven — no magic values.
 */
export interface PieceRenderingConfig {
  piece: { roughness: number; metalness: number };
  pieceFadeMs: number;
}

/** A plain, serializable readout of one live piece — for Playwright assertions. */
export interface PieceReadout {
  /** The node the piece occupies. */
  node: NodeKey;
  /** The piece's colour. */
  owner: Player;
  /** The mesh's world position (board-centered), as plain numbers. */
  position: { x: number; y: number; z: number };
  /** The mesh's current material opacity (mid-fade values are between 0 and target). */
  opacity: number;
  /** True while the mesh is fading out toward disposal (a capture/rewind). */
  fadingOut: boolean;
  /** The material's current emissive intensity — >0 iff the piece is hover-highlighted. */
  emissiveIntensity: number;
}

/** The live pieces handle: the mesh container + inspectors + the diff-driven sync. */
export interface PiecesHandle {
  /** A group container holding every live piece mesh. */
  readonly object: THREE.Group;
  /** Reconcile the mesh set to `state.pieces` via the pure diff (add/remove/recolor). */
  sync(state: GameState): void;
  /** Advance in-flight fades by `deltaMs`; disposes meshes whose fade-out completed. */
  tick(deltaMs: number): void;
  /**
   * Apply the hover emissive-boost (glow) to exactly the pieces at `nodes`, restoring every
   * other piece's emissive to 0 (render-ui design Part 1: highlight reads as an emissive
   * boost, cleared by setting emissive → 0). Config-driven boost + colour; idempotent.
   */
  highlight(nodes: readonly NodeKey[], color: string, boost: number): void;
  /** Plain-number readout of every live piece (for `window.__pente`). */
  getPieces(): PieceReadout[];
  /** The number of live piece meshes currently in the scene (post-tick). */
  count(): number;
  /** Free GPU resources for every mesh. */
  dispose(): void;
}

/** One tracked piece mesh plus its fade state. */
interface PieceEntry {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  owner: Player;
  /** The material's target (fully-faded-in) opacity. */
  targetOpacity: number;
  /** Fade direction: +1 fading in, −1 fading out, 0 settled. */
  fadeDir: -1 | 0 | 1;
}

/** Map a player colour to its piece-color-config key. */
function colorKeyOf(owner: Player): keyof PieceColorsConfig {
  switch (owner) {
    case 'white':
      return 'whitePiece';
    case 'black':
      return 'blackPiece';
    default:
      throw new Error(`unknown piece owner: ${JSON.stringify(owner)}`);
  }
}

/** World position of a node, board-centered by `spacing`. */
function worldOf(node: NodeKey, size: number, spacing: number): THREE.Vector3 {
  const [x, y, z] = coordsOf(node);
  const c = (size - 1) / 2;
  return new THREE.Vector3((x - c) * spacing, (y - c) * spacing, (z - c) * spacing);
}

/**
 * Create the individual-piece renderer for an `N×N×N` board. Reads `colors`, `geometry`,
 * `materials`, and `rendering` (fade duration) from the layered config store (no magic
 * values). The returned handle keeps a `nodeKey → mesh` map and reconciles it to each
 * `GameState.pieces` via the pure `diffPieces`, exposing plain-number readouts for
 * `window.__pente`.
 */
export function createPieces(size: number): PiecesHandle {
  const colors = getConfig('colors') as unknown as PieceColorsConfig;
  const geometry = getConfig('geometry') as unknown as PieceGeometryConfig;
  const materials = getConfig('materials') as unknown as PieceMaterialsConfig;
  const rendering = getConfig('rendering') as unknown as PieceRenderingConfig;

  const object = new THREE.Group();
  object.name = 'pieces';

  // One shared sphere geometry — every piece is the same size; only material colour
  // differs. Individual meshes still (each gets its own material for per-piece fade).
  const geo = new THREE.SphereGeometry(
    geometry.pieceRadius,
    geometry.sphereSegments.width,
    geometry.sphereSegments.height,
  );

  const entries = new Map<NodeKey, PieceEntry>();
  const targetOpacity = materials.pieceOpacity;
  const fadeMs = rendering.pieceFadeMs;

  function makeMaterial(owner: Player): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(colors[colorKeyOf(owner)]),
      roughness: rendering.piece.roughness,
      metalness: rendering.piece.metalness,
      transparent: true,
      opacity: 0, // fade in from transparent — the placement seam
    });
  }

  function addPiece(node: NodeKey, owner: Player): void {
    const material = makeMaterial(owner);
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = `piece:${node}`;
    mesh.position.copy(worldOf(node, size, geometry.spacing));
    object.add(mesh);
    entries.set(node, { mesh, material, owner, targetOpacity, fadeDir: 1 });
  }

  function recolorPiece(node: NodeKey, to: Player): void {
    const entry = entries.get(node);
    if (!entry) return;
    entry.material.color.set(colors[colorKeyOf(to)]);
    entry.owner = to;
  }

  function startFadeOut(node: NodeKey): void {
    const entry = entries.get(node);
    if (!entry) return;
    entry.fadeDir = -1;
  }

  function disposeEntry(entry: PieceEntry): void {
    object.remove(entry.mesh);
    entry.material.dispose();
  }

  function sync(state: GameState): void {
    // Diff against the CURRENT live-owner set (settled + fading-in meshes), so a repeat
    // sync is idempotent and a piece already fading out is revived rather than duplicated.
    const prev: Record<NodeKey, Player> = {};
    for (const [node, entry] of entries) {
      if (entry.fadeDir !== -1) prev[node] = entry.owner;
    }
    const diff = diffPieces(prev, state.pieces);
    for (const node of diff.removes) startFadeOut(node);
    for (const add of diff.adds) {
      const existing = entries.get(add.node);
      if (existing && existing.fadeDir === -1) {
        // A node re-occupied before its fade-out finished: revive + recolor in place.
        existing.fadeDir = 1;
        recolorPiece(add.node, add.owner);
      } else {
        addPiece(add.node, add.owner);
      }
    }
    for (const rc of diff.recolors) recolorPiece(rc.node, rc.to);
  }

  function tick(deltaMs: number): void {
    const step = fadeMs > 0 ? deltaMs / fadeMs : Infinity;
    for (const [node, entry] of [...entries]) {
      if (entry.fadeDir === 0) continue;
      const next = entry.material.opacity + entry.fadeDir * step * entry.targetOpacity;
      if (entry.fadeDir === 1) {
        entry.material.opacity = Math.min(entry.targetOpacity, next);
        if (entry.material.opacity >= entry.targetOpacity) entry.fadeDir = 0;
      } else {
        entry.material.opacity = Math.max(0, next);
        if (entry.material.opacity <= 0) {
          disposeEntry(entry);
          entries.delete(node);
        }
      }
    }
  }

  function highlight(nodes: readonly NodeKey[], color: string, boost: number): void {
    const on = new Set(nodes);
    const glow = new THREE.Color(color);
    for (const [node, entry] of entries) {
      if (on.has(node)) {
        entry.material.emissive.copy(glow);
        entry.material.emissiveIntensity = boost;
      } else {
        entry.material.emissiveIntensity = 0;
      }
    }
  }

  function getPieces(): PieceReadout[] {
    const out: PieceReadout[] = [];
    for (const [node, entry] of entries) {
      out.push({
        node,
        owner: entry.owner,
        position: {
          x: entry.mesh.position.x,
          y: entry.mesh.position.y,
          z: entry.mesh.position.z,
        },
        opacity: entry.material.opacity,
        fadingOut: entry.fadeDir === -1,
        emissiveIntensity: entry.material.emissiveIntensity,
      });
    }
    return out;
  }

  function count(): number {
    return entries.size;
  }

  function dispose(): void {
    for (const entry of entries.values()) disposeEntry(entry);
    entries.clear();
    geo.dispose();
  }

  return { object, sync, tick, highlight, getPieces, count, dispose };
}
