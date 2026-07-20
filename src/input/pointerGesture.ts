/**
 * PURE pointer-gesture disambiguation (GitHub issue #1).
 *
 * A trackpad orbit/pan gesture ends in a pointer release. Without disambiguation the
 * placement handler treats that release as a click-to-place, so a piece lands accidentally
 * while the player is only rotating/panning the camera. This module decides — from the
 * pointerdown and pointerup positions alone — whether a release is a genuine CLICK (place)
 * or a camera-manipulation DRAG (do not place).
 *
 * The rule is configurable via the layered config store's `interaction.dragGuard` section
 * ("everything is config, no magic values"): an enable flag (DEFAULT ENABLED) and a pixel
 * threshold. When ENABLED, a piece is placed only if the straight-line pointer travel is
 * `<= thresholdPx`. When DISABLED, behavior reverts to place-on-release regardless of drag,
 * so the toggle demonstrably changes behavior.
 *
 * THREE-free / DOM-free (it takes plain `{x, y}` positions, not a live `PointerEvent`), so
 * it earns the strict unit + mutation gate. The Three.js pointer plumbing that captures the
 * down/up positions off the real canvas lives in `scene.ts` — an IO boundary verified by
 * Playwright, exactly like the other scene glue.
 */

/** A pointer position in the same pixel space as the pointerdown/pointerup events. */
export interface PointerPos {
  readonly x: number;
  readonly y: number;
}

/** The `interaction.dragGuard` config: the enable flag and the click/drag pixel threshold. */
export interface DragGuardConfig {
  /** Whether the drag-vs-click guard is active. `false` reverts to place-on-release. */
  readonly enabled: boolean;
  /** Max straight-line pointer travel (px) that still counts as a click, guard enabled. */
  readonly thresholdPx: number;
}

/**
 * Decide whether a pointer release should place a piece.
 *
 * Place iff the guard is DISABLED (legacy place-on-release), OR the straight-line distance
 * between `down` and `up` is `<= thresholdPx` (a genuine click). A larger move is a
 * camera-manipulation drag and yields `false` (no placement).
 *
 * @param down The pointerdown position.
 * @param up   The pointerup position.
 * @param guard The resolved `interaction.dragGuard` config.
 * @returns `true` to place, `false` to suppress (the release was a drag).
 */
export function shouldPlaceFromPointer(
  down: PointerPos,
  up: PointerPos,
  guard: DragGuardConfig,
): boolean {
  if (!guard.enabled) return true;
  const dx = up.x - down.x;
  const dy = up.y - down.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return distance <= guard.thresholdPx;
}
