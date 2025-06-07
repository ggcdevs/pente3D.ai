/**
 * Custom assertions and matchers for Pente3D tests
 */

import type { Board, Move, Player, Vector3, GameState, Line } from '@/core';
import type { Pente3DError } from '@/utils';

/**
 * Custom matchers for Jest
 */
declare global {
  namespace jest {
    interface Matchers<R> {
      toHavePieceAt(x: number, y: number, z: number): R;
      toHavePlayerAt(x: number, y: number, z: number, player: Player): R;
      toBeEmptyAt(x: number, y: number, z: number): R;
      toHaveSize(size: number): R;
      toHavePieceCount(count: number): R;
      toBePente3DError(code?: string): R;
      toBeValidMove(): R;
      toHaveWinner(player: Player | null): R;
    }
  }
}

/**
 * Check if a board has a piece at the given position
 */
export function toHavePieceAt(
  board: Board,
  x: number,
  y: number,
  z: number
): jest.CustomMatcherResult {
  const position = { x, y, z };
  const piece = board.getPieceAt(position);
  const pass = piece !== null;

  return {
    pass,
    message: () =>
      pass
        ? `Expected board not to have piece at (${x}, ${y}, ${z})`
        : `Expected board to have piece at (${x}, ${y}, ${z})`,
  };
}

/**
 * Check if a board has a specific player's piece at the given position
 */
export function toHavePlayerAt(
  board: Board,
  x: number,
  y: number,
  z: number,
  player: Player
): jest.CustomMatcherResult {
  const position = { x, y, z };
  const piece = board.getPieceAt(position);
  const pass = piece !== null && piece.player.id === player.id;

  return {
    pass,
    message: () =>
      pass
        ? `Expected board not to have ${player.color} piece at (${x}, ${y}, ${z})`
        : `Expected board to have ${player.color} piece at (${x}, ${y}, ${z})`,
  };
}

/**
 * Check if a board position is empty
 */
export function toBeEmptyAt(
  board: Board,
  x: number,
  y: number,
  z: number
): jest.CustomMatcherResult {
  const position = { x, y, z };
  const piece = board.getPieceAt(position);
  const pass = piece === null;

  return {
    pass,
    message: () =>
      pass
        ? `Expected board not to be empty at (${x}, ${y}, ${z})`
        : `Expected board to be empty at (${x}, ${y}, ${z})`,
  };
}

/**
 * Check board size
 */
export function toHaveSize(board: Board, size: number): jest.CustomMatcherResult {
  const pass = board.size === size;

  return {
    pass,
    message: () =>
      pass
        ? `Expected board not to have size ${size}`
        : `Expected board to have size ${size}, but has size ${board.size}`,
  };
}

/**
 * Check piece count on board
 */
export function toHavePieceCount(board: Board, count: number): jest.CustomMatcherResult {
  const actualCount = board.getPieceCount();
  const pass = actualCount === count;

  return {
    pass,
    message: () =>
      pass
        ? `Expected board not to have ${count} pieces`
        : `Expected board to have ${count} pieces, but has ${actualCount}`,
  };
}

/**
 * Check if an error is a Pente3DError with optional code check
 */
export function toBePente3DError(
  error: unknown,
  code?: string
): jest.CustomMatcherResult {
  const isPente3DError =
    error instanceof Error &&
    'code' in error &&
    typeof (error as any).code === 'string';

  if (!isPente3DError) {
    return {
      pass: false,
      message: () => `Expected error to be a Pente3DError, but got ${typeof error}`,
    };
  }

  if (code !== undefined) {
    const actualCode = (error as any).code;
    const pass = actualCode === code;
    return {
      pass,
      message: () =>
        pass
          ? `Expected error not to have code "${code}"`
          : `Expected error to have code "${code}", but got "${actualCode}"`,
    };
  }

  return {
    pass: true,
    message: () => `Expected error not to be a Pente3DError`,
  };
}

/**
 * Check if a move is valid
 */
export function toBeValidMove(move: Move): jest.CustomMatcherResult {
  const pass = move.isValid();

  return {
    pass,
    message: () =>
      pass
        ? `Expected move at (${move.position.x}, ${move.position.y}, ${move.position.z}) not to be valid`
        : `Expected move at (${move.position.x}, ${move.position.y}, ${move.position.z}) to be valid`,
  };
}

/**
 * Check game state winner
 */
export function toHaveWinner(
  gameState: GameState,
  expectedWinner: Player | null
): jest.CustomMatcherResult {
  const actualWinner = gameState.getWinner();
  
  if (expectedWinner === null) {
    const pass = actualWinner === null;
    return {
      pass,
      message: () =>
        pass
          ? `Expected game not to have a winner`
          : `Expected game to have no winner, but ${actualWinner} won`,
    };
  }

  const pass = actualWinner === expectedWinner.color;
  return {
    pass,
    message: () =>
      pass
        ? `Expected game not to have ${expectedWinner.color} as winner`
        : `Expected game to have ${expectedWinner.color} as winner, but got ${actualWinner || 'no winner'}`,
  };
}

/**
 * Register custom matchers with Jest
 */
export function setupCustomMatchers(): void {
  expect.extend({
    toHavePieceAt,
    toHavePlayerAt,
    toBeEmptyAt,
    toHaveSize,
    toHavePieceCount,
    toBePente3DError,
    toBeValidMove,
    toHaveWinner,
  });
}

/**
 * Assertion helper functions for common test scenarios
 */
export const assertBoard = {
  /**
   * Assert that a board matches expected piece positions
   */
  matchesPositions(
    board: Board,
    expectedPositions: Array<{ x: number; y: number; z: number; player: Player }>
  ): void {
    for (const { x, y, z, player } of expectedPositions) {
      expect(board).toHavePlayerAt(x, y, z, player);
    }
  },

  /**
   * Assert that a board is empty
   */
  isEmpty(board: Board): void {
    expect(board).toHavePieceCount(0);
  },

  /**
   * Assert board has correct dimensions
   */
  hasCorrectDimensions(board: Board, expectedSize: number): void {
    expect(board).toHaveSize(expectedSize);
    
    // Check that all valid positions are within bounds
    const halfSize = Math.floor(expectedSize / 2);
    for (let x = -halfSize; x <= halfSize; x++) {
      for (let y = -halfSize; y <= halfSize; y++) {
        for (let z = -halfSize; z <= halfSize; z++) {
          expect(board.isValidPosition({ x, y, z })).toBe(true);
        }
      }
    }
    
    // Check that positions outside bounds are invalid
    expect(board.isValidPosition({ x: halfSize + 1, y: 0, z: 0 })).toBe(false);
    expect(board.isValidPosition({ x: -(halfSize + 1), y: 0, z: 0 })).toBe(false);
  },
};

export const assertGame = {
  /**
   * Assert game is in initial state
   */
  isInitialState(game: any): void {
    expect(game.getCurrentStateIndex()).toBe(0);
    expect(game.getMoveCount()).toBe(0);
    expect(game.isGameOver()).toBe(false);
    expect(game.getWinner()).toBeNull();
  },

  /**
   * Assert game has expected move count
   */
  hasMoveCount(game: any, expectedCount: number): void {
    expect(game.getMoveCount()).toBe(expectedCount);
  },

  /**
   * Assert current player
   */
  hasCurrentPlayer(game: any, expectedColor: 'black' | 'white'): void {
    expect(game.getCurrentPlayer().color).toBe(expectedColor);
  },
};

export const assertLine = {
  /**
   * Assert line has expected length
   */
  hasLength(line: Line, expectedLength: number): void {
    expect(line.coords.length).toBe(expectedLength);
  },

  /**
   * Assert line contains position
   */
  containsPosition(line: Line, x: number, y: number, z: number): void {
    const hasPosition = line.coords.some(
      (coord) => coord.x === x && coord.y === y && coord.z === z
    );
    expect(hasPosition).toBe(true);
  },

  /**
   * Assert line is complete (5 pieces)
   */
  isComplete(line: Line): void {
    expect(line.isComplete).toBe(true);
    expect(line.coords.length).toBe(5);
  },
};