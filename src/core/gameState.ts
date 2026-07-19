/**
 * The immutable game-state snapshot and its constructors.
 *
 * A `GameState` is a pure, view-agnostic snapshot of a Pente game (see the
 * game-core design, Part 2, and GLOSSARY "GameState"). It records only occupied
 * nodes, whose turn it is, capture-pair counts, and win state. Every state
 * transition (`placePiece`) returns a **new** snapshot; states are never mutated
 * in place. This is the pure rules layer: no rendering, network, or DOM.
 */

import type { NodeKey } from './coords';

/** A player's colour — the two seats of a Pente game. */
export type Player = 'white' | 'black';

/**
 * An immutable snapshot of a game.
 *
 * `pieces` holds only occupied nodes (`nodeKey → owner`); empty nodes are absent.
 * `captures` counts capture **pairs** (two opponent pieces removed = one pair).
 * `winner` is `null` until the game is won; `winningLine`, when set, is the run of
 * node keys to highlight.
 */
export interface GameState {
  /** Board edge length `N`; the board is `N×N×N`. */
  readonly size: number;
  /** Occupied nodes only: `nodeKey → owning player`. */
  readonly pieces: Readonly<Record<NodeKey, Player>>;
  /** The player to move. */
  readonly turn: Player;
  /** Capture-pair counts per player. */
  readonly captures: Readonly<Record<Player, number>>;
  /** The winner, or `null` while the game is still in progress. */
  readonly winner: Player | null;
  /** The winning run of node keys, present only once the game is won by a line. */
  readonly winningLine?: readonly NodeKey[];
}

/** Thrown by `placePiece` when a move violates the rules (occupied, off-board, game over). */
export class IllegalMove extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalMove';
  }
}

/** The opposite player. */
export function opponent(player: Player): Player {
  return player === 'white' ? 'black' : 'white';
}

/** A fresh game on an `N×N×N` board: empty, white to move, no captures, no winner. */
export function initialState(size: number): GameState {
  return {
    size,
    pieces: {},
    turn: 'white',
    captures: { white: 0, black: 0 },
    winner: null,
  };
}
