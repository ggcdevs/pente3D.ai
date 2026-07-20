/**
 * PURE node-pick-radius resolver (GitHub issue #3).
 *
 * Each board node has an invisible pick sphere in the instanced pick layer (`picking.ts`).
 * For picking to be truthful — "what you see is what you can hit" — that sphere must match
 * the node's VISIBLE geometry: an EMPTY node shows only its small marker, an OCCUPIED node
 * shows a larger piece. The original picker sized EVERY node's sphere to one generous,
 * piece-sized radius, so an empty node's oversized invisible sphere intercepted rays aimed
 * at a farther node's visible marker and the nearest-hit raycaster returned the wrong
 * (nearer) node — the occlusion "dead zone" reported in issue #3.
 *
 * This module isolates the radius DECISION from the Three.js scaling (`picking.ts`, the IO
 * glue): it is THREE-free / DOM-free and carries the strict unit + mutation gate. It builds
 * no scene state — it only maps `(occupied, marker/piece radius, padding, spacing)` to a
 * radius, so the same rule can be verified with genuine assertions on the returned number
 * (agent-principles #2/#3) rather than by mutating raycaster glue.
 */

/** The inputs to the per-node pick-radius decision. All lengths in world units. */
export interface PickRadiusInput {
  /** Whether a piece currently occupies this node (decides marker-vs-piece basis). */
  readonly occupied: boolean;
  /** The visible marker sphere radius (an EMPTY node's on-screen size). */
  readonly markerRadius: number;
  /** The visible piece sphere radius (an OCCUPIED node's on-screen size). */
  readonly pieceRadius: number;
  /** Node spacing — the pick radius is clamped to half of this so neighbours stay separable. */
  readonly spacing: number;
  /** Optional extra hit margin added to the visible radius (0 = exactly the visible size). */
  readonly padding: number;
}

/**
 * The pick-sphere radius for one node.
 *
 * - The base radius is the node's VISIBLE size: `pieceRadius` when occupied, else
 *   `markerRadius` — so an empty node's hitbox is marker-sized (the issue #3 fix), never
 *   piece-sized.
 * - `padding` is added as an optional hit margin on top of the visible size.
 * - The result is clamped to `spacing / 2`, the largest radius at which two adjacent nodes'
 *   spheres are at most tangent (never overlapping), so neighbouring nodes stay separable no
 *   matter how large the padding.
 */
export function resolveNodePickRadius(input: PickRadiusInput): number {
  const visible = input.occupied ? input.pieceRadius : input.markerRadius;
  const desired = visible + input.padding;
  const maxSeparable = input.spacing / 2;
  return Math.min(desired, maxSeparable);
}
