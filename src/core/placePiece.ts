/**
 * `placePiece` — the core move function.
 *
 * Given a `GameState` and target coordinates, it validates the move, places the
 * current player's piece, resolves custodian captures, checks for a win, flips the
 * turn, and returns a **new** state (see the game-core design, Part 2). It never
 * mutates its input. Illegal moves throw `IllegalMove`.
 *
 * This task (1.4) implements **placement + validation** only; captures (Task 1.5)
 * and win detection (Task 1.6) are stubbed with clearly marked seams so later
 * tasks slot in without touching the placement/validation core. Pure rules layer:
 * no rendering, network, or DOM imports.
 */

import { keyOf, inBounds, type Coord } from './coords';
import { IllegalMove, type GameState, type Player } from './gameState';

/**
 * Resolve custodian captures triggered by `player` placing at `placed`.
 *
 * Stub for Task 1.5. Returns the pieces map and this player's new capture-pair
 * count unchanged; Task 1.5 will scan the 26 directions for `[opp, opp, self]`
 * brackets, remove the flanked pairs, and increment the count.
 */
function resolveCaptures(
  pieces: Record<string, Player>,
  _placed: Coord,
  _player: Player,
  currentCaptures: number,
): { pieces: Record<string, Player>; captures: number } {
  return { pieces, captures: currentCaptures };
}

/**
 * Determine whether `player` has won after placing at `placed`.
 *
 * Stub for Task 1.6. Reports no win; Task 1.6 will detect a run of ≥5 through the
 * placed node along any of the 13 axes, and 5 capture pairs, populating
 * `winningLine`.
 */
function checkWin(
  pieces: Record<string, Player>,
  placed: Coord,
  player: Player,
  captures: number,
): { winner: Player | null; winningLine?: readonly string[] } {
  void pieces;
  void placed;
  void player;
  void captures;
  return { winner: null };
}

/**
 * Place the current player's piece at `coords`, returning a new `GameState`.
 *
 * Steps (game-core design, Part 2):
 *   1. Validate — in-bounds, node empty, no existing winner.
 *   2. Place the current colour.
 *   3. Captures (Task 1.5 — stubbed here).
 *   4. Win check (Task 1.6 — stubbed here).
 *   5. Flip the turn (unless the game is now won) and return the new state.
 *
 * @throws {IllegalMove} if the target is off-board, occupied, or the game is over.
 */
export function placePiece(state: GameState, coords: Coord): GameState {
  // 1. Validate.
  if (state.winner !== null) {
    throw new IllegalMove('game is already won');
  }
  if (!inBounds(coords, state.size)) {
    throw new IllegalMove(`coordinates out of bounds: ${keyOf(coords)}`);
  }
  const key = keyOf(coords);
  if (Object.prototype.hasOwnProperty.call(state.pieces, key)) {
    throw new IllegalMove(`node already occupied: ${key}`);
  }

  const player = state.turn;

  // 2. Place — copy the map so the input is never mutated.
  let pieces: Record<string, Player> = { ...state.pieces, [key]: player };

  // 3. Captures (Task 1.5 seam).
  const captured = resolveCaptures(
    pieces,
    coords,
    player,
    state.captures[player],
  );
  pieces = captured.pieces;
  const captures: Record<Player, number> = {
    ...state.captures,
    [player]: captured.captures,
  };

  // 4. Win (Task 1.6 seam).
  const { winner, winningLine } = checkWin(
    pieces,
    coords,
    player,
    captures[player],
  );

  // 5. Flip the turn unless the game is now won.
  const next: GameState = {
    size: state.size,
    pieces,
    turn: winner === null ? (player === 'white' ? 'black' : 'white') : player,
    captures,
    winner,
    ...(winningLine !== undefined ? { winningLine } : {}),
  };
  return next;
}
