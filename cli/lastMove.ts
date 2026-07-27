/**
 * Which node the last committed placement put down — derived from the game, never remembered.
 *
 * ## Why this is not a tracked variable
 *
 * The daemon used to keep `lastMove` as mutable state, updated whenever a change ADDED exactly one
 * stone. Nothing ever invalidated it, so an undo, a resolution rewind or a rematch reset left the
 * CLI advertising a "last move" naming a stone that is not on the board and does not exist in the
 * current game — visible in a shipped `scenario:ff-boundary` run, where two peers holding the SAME
 * `headHash` rendered DIFFERENT last moves (one of them a stone that had been taken back, printed as
 * `? @ (4,4,4)` because the renderer could not find its colour).
 *
 * The CLI is the glue tier's measuring instrument, so a field it reports falsely is a test-integrity
 * defect, not cosmetics. Deriving it from the authoritative game removes the invalidation problem
 * instead of adding another invalidation site: there is no stale value to miss.
 *
 * ## How
 *
 * A placement ADDS exactly one stone — the mover's — even when it also captures (captures only
 * remove). So the node placed at ply `k` is the single key present in `stateAt(k)` and absent from
 * `stateAt(k-1)`, which `Game`'s O(1) per-ply snapshot cache hands over directly. Undo/redo move the
 * cursor, so the answer follows them for free.
 */
import type { Game } from '../src/core/game';
import type { GameState } from '../src/core/gameState';

/**
 * The node `curr` holds that `prev` did not — the stone the move between them placed. `null` when
 * the two states place no single new stone: the same state (ply 0, or an undo/redo pair), or a
 * transition that is not a single placement at all.
 *
 * The `!== 1` case is a real guard, not a formality: it is what makes the function total over any
 * two states a caller hands it (including a rewind, which only removes), so nothing invents a move.
 */
export function lastPlacedNode(prev: GameState, curr: GameState): string | null {
  const added = Object.keys(curr.pieces).filter((key) => prev.pieces[key] === undefined);
  return added.length === 1 ? added[0]! : null;
}

/**
 * The node of `game`'s last committed placement, or `null` when there is none (an empty game, a game
 * undone back to the start, a freshly reset rematch, or no live engine at all).
 */
export function lastMoveOf(game: Game | null): string | null {
  if (game === null) return null;
  // `stateAt` clamps, so ply 0 compares the initial state with itself → no added key → null.
  return lastPlacedNode(game.stateAt(game.ply() - 1), game.state());
}
