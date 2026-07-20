/**
 * PURE pieces-diff planner (Task 4.5).
 *
 * Pieces are deliberately **individual** meshes, not instanced (render-ui design Part 1:
 * realistic piece counts are ~20–100, and individual meshes make history-replay/undo
 * add-remove and per-piece animation trivial). The scene-update model is *incremental*
 * (Part 2): on every `GameState` change the glue must add a mesh for each newly-occupied
 * node, remove the mesh at each vacated node (a capture, or a history-slider/undo
 * rewind), and swap the material for any node whose owner *changed identity* between
 * states — an edge that arises on undo/redo and history scrubbing where a node can be
 * re-occupied by the other colour without ever reading as empty in between.
 *
 * This module is the pure boundary of the piece renderer — no THREE, no DOM — so the
 * diff logic gets the strict unit + mutation gate with genuine assertions on the
 * returned diff, while `pieces.ts` stays a thin Playwright-verified shell (build plan
 * Task 4.5 gating model). It reads only core types (`GameState.pieces`, `Player`); it
 * builds no rules.
 */

import type { NodeKey } from '../core/coords.ts';
import type { Player } from '../core/gameState.ts';

/** A newly-occupied node: a mesh must be created here, coloured for `owner`. */
export interface PieceAdd {
  /** The node that gained a piece. */
  readonly node: NodeKey;
  /** The colour of the piece now on it. */
  readonly owner: Player;
}

/** A node whose occupant changed colour: swap the existing mesh's material. */
export interface PieceRecolor {
  /** The node whose occupant changed identity. */
  readonly node: NodeKey;
  /** The colour that used to be on it. */
  readonly from: Player;
  /** The colour that is on it now. */
  readonly to: Player;
}

/**
 * The incremental change between two `pieces` maps: the meshes to add, the node keys to
 * remove, and the meshes to recolour. Applying `removes` then `adds` then `recolors` to
 * a mesh set that mirrored `prev` yields one that mirrors `next`. Each node key appears
 * in at most one bucket — a node is added, removed, recoloured, or untouched, never two.
 */
export interface PieceDiff {
  /** Nodes occupied in `next` but not `prev` — create a mesh for each. */
  readonly adds: readonly PieceAdd[];
  /** Nodes occupied in `prev` but not `next` — dispose the mesh at each. */
  readonly removes: readonly NodeKey[];
  /** Nodes occupied in both but by a different colour — swap the mesh material. */
  readonly recolors: readonly PieceRecolor[];
}

/**
 * Compute the incremental {@link PieceDiff} taking the piece set `prev` to `next`.
 *
 * - A node in `next` but not `prev` → an **add** (owner = its colour in `next`).
 * - A node in `prev` but not `next` → a **remove**.
 * - A node in both with a **different** owner → a **recolor** (`from`/`to`).
 * - A node in both with the **same** owner → untouched (absent from every bucket).
 *
 * Pure and non-mutating: neither input map is read beyond its own-enumerable keys, and
 * nothing is written back. `prev`/`next` are the `GameState.pieces` records (occupied
 * nodes only; empty nodes are absent), so iterating keys visits exactly the pieces.
 */
export function diffPieces(
  prev: Readonly<Record<NodeKey, Player>>,
  next: Readonly<Record<NodeKey, Player>>,
): PieceDiff {
  const adds: PieceAdd[] = [];
  const removes: NodeKey[] = [];
  const recolors: PieceRecolor[] = [];

  // Walk `next`: every next-node is an add (absent in prev), a recolor (present but a
  // different owner), or unchanged (present, same owner).
  for (const node of Object.keys(next)) {
    const to = next[node]!;
    const from = prev[node];
    if (from === undefined) {
      adds.push({ node, owner: to });
    } else if (from !== to) {
      recolors.push({ node, from, to });
    }
  }

  // Walk `prev`: any prev-node absent from `next` is a remove. (Present-in-both nodes
  // were already classified above, so they are skipped here.)
  for (const node of Object.keys(prev)) {
    if (next[node] === undefined) {
      removes.push(node);
    }
  }

  return { adds, removes, recolors };
}
