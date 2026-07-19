/**
 * `placePiece` — the core move function.
 *
 * Given a `GameState` and target coordinates, it validates the move, places the
 * current player's piece, resolves custodian captures, checks for a win, flips the
 * turn, and returns a **new** state (see the game-core design, Part 2). It never
 * mutates its input. Illegal moves throw `IllegalMove`.
 *
 * This task implements **placement + validation** (Task 1.4) and **custodian
 * captures** (Task 1.5); win detection (Task 1.6) remains a clearly marked seam so
 * it slots in without touching the placement core. Pure rules layer: no rendering,
 * network, or DOM imports.
 */

import { keyOf, inBounds, type Coord } from './coords';
import { DIRECTIONS } from './axes';
import { IllegalMove, opponent, type GameState, type Player } from './gameState';

/**
 * Resolve custodian captures triggered by `player` placing at `placed` on a
 * board of edge length `size`.
 *
 * Standard Pente custodian rule (game-core design, Part 2): for each of the **26
 * directions** from the placed node, if the pattern is exactly `[opp, opp, self]`
 * — two adjacent opponent pieces immediately followed by one of the current
 * player's own pieces — those two opponents are removed and one capture **pair**
 * is scored. Exactly two: `[opp, opp, opp, self]` is not a capture, since the
 * third step is an opponent, not `self`. Placing between two opponents is safe,
 * because the just-placed node is `self`, never a flanked `opp`.
 *
 * Returns a **new** pieces map (the input is never mutated) and this player's
 * updated capture-pair count. Multiple simultaneous captures from one placement
 * are all counted.
 */
function resolveCaptures(
  pieces: Record<string, Player>,
  placed: Coord,
  player: Player,
  currentCaptures: number,
  size: number,
): { pieces: Record<string, Player>; captures: number } {
  const opp = opponent(player);
  const toRemove: string[] = [];

  for (const d of DIRECTIONS) {
    const a: Coord = [placed[0] + d[0], placed[1] + d[1], placed[2] + d[2]];
    const b: Coord = [placed[0] + 2 * d[0], placed[1] + 2 * d[1], placed[2] + 2 * d[2]];
    const c: Coord = [placed[0] + 3 * d[0], placed[1] + 3 * d[1], placed[2] + 3 * d[2]];
    // All three flank nodes must be on the board.
    if (!inBounds(a, size) || !inBounds(b, size) || !inBounds(c, size)) continue;
    if (
      pieces[keyOf(a)] === opp &&
      pieces[keyOf(b)] === opp &&
      pieces[keyOf(c)] === player
    ) {
      toRemove.push(keyOf(a), keyOf(b));
    }
  }

  if (toRemove.length === 0) {
    return { pieces, captures: currentCaptures };
  }

  // Copy and remove the flanked opponents — never mutate the input map.
  const next: Record<string, Player> = { ...pieces };
  for (const k of toRemove) {
    delete next[k];
  }
  // Each removed pair is one capture; toRemove holds two keys per pair.
  return { pieces: next, captures: currentCaptures + toRemove.length / 2 };
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
    state.size,
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
