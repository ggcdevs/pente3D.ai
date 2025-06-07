/**
 * General test utilities and helpers
 */

import type { Game, GameState, Board, Vector3 } from '@/core';

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const startTime = Date.now();
  
  while (!condition()) {
    if (Date.now() - startTime > timeout) {
      throw new Error('Timeout waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * Wait for next animation frame
 */
export async function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Wait for multiple animation frames
 */
export async function waitFrames(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await nextFrame();
  }
}

/**
 * Simulate a series of moves in a game
 */
export async function simulateMoves(
  game: Game,
  moves: Array<{ x: number; y: number; z: number }>
): Promise<void> {
  for (const move of moves) {
    const success = game.placePiece(Vector3.create(move.x, move.y, move.z));
    if (!success) {
      throw new Error(`Failed to place piece at (${move.x}, ${move.y}, ${move.z})`);
    }
    // Wait a bit between moves to simulate real gameplay
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Get all valid positions for a board size
 */
export function getAllValidPositions(boardSize: number): Vector3[] {
  const positions: Vector3[] = [];
  const halfSize = Math.floor(boardSize / 2);
  
  for (let x = -halfSize; x <= halfSize; x++) {
    for (let y = -halfSize; y <= halfSize; y++) {
      for (let z = -halfSize; z <= halfSize; z++) {
        positions.push(Vector3.create(x, y, z));
      }
    }
  }
  
  return positions;
}

/**
 * Get random valid position for a board
 */
export function getRandomPosition(board: Board): Vector3 {
  const validPositions = getAllValidPositions(board.size).filter(
    (pos) => !board.getPieceAt(pos)
  );
  
  if (validPositions.length === 0) {
    throw new Error('No valid positions available');
  }
  
  const randomIndex = Math.floor(Math.random() * validPositions.length);
  return validPositions[randomIndex];
}

/**
 * Create a snapshot of game state for comparison
 */
export interface GameSnapshot {
  moveCount: number;
  currentPlayer: 'black' | 'white';
  boardPieces: Array<{
    position: { x: number; y: number; z: number };
    player: 'black' | 'white';
  }>;
  blackCaptures: number;
  whiteCaptures: number;
  isGameOver: boolean;
  winner: 'black' | 'white' | null;
}

export function createGameSnapshot(game: Game): GameSnapshot {
  const state = game.getCurrentState();
  const board = state.getBoard();
  const pieces: GameSnapshot['boardPieces'] = [];
  
  // Get all pieces on the board
  const positions = getAllValidPositions(board.size);
  for (const pos of positions) {
    const piece = board.getPieceAt(pos);
    if (piece) {
      pieces.push({
        position: { x: pos.x, y: pos.y, z: pos.z },
        player: piece.player.color,
      });
    }
  }
  
  return {
    moveCount: state.getMoveCount(),
    currentPlayer: state.getCurrentPlayer().color,
    boardPieces: pieces,
    blackCaptures: state.getPlayerByColor('black').captures,
    whiteCaptures: state.getPlayerByColor('white').captures,
    isGameOver: game.isGameOver(),
    winner: game.getWinner(),
  };
}

/**
 * Compare two game snapshots
 */
export function compareSnapshots(
  snapshot1: GameSnapshot,
  snapshot2: GameSnapshot
): { equal: boolean; differences: string[] } {
  const differences: string[] = [];
  
  if (snapshot1.moveCount !== snapshot2.moveCount) {
    differences.push(
      `Move count: ${snapshot1.moveCount} vs ${snapshot2.moveCount}`
    );
  }
  
  if (snapshot1.currentPlayer !== snapshot2.currentPlayer) {
    differences.push(
      `Current player: ${snapshot1.currentPlayer} vs ${snapshot2.currentPlayer}`
    );
  }
  
  if (snapshot1.blackCaptures !== snapshot2.blackCaptures) {
    differences.push(
      `Black captures: ${snapshot1.blackCaptures} vs ${snapshot2.blackCaptures}`
    );
  }
  
  if (snapshot1.whiteCaptures !== snapshot2.whiteCaptures) {
    differences.push(
      `White captures: ${snapshot1.whiteCaptures} vs ${snapshot2.whiteCaptures}`
    );
  }
  
  if (snapshot1.isGameOver !== snapshot2.isGameOver) {
    differences.push(
      `Game over: ${snapshot1.isGameOver} vs ${snapshot2.isGameOver}`
    );
  }
  
  if (snapshot1.winner !== snapshot2.winner) {
    differences.push(`Winner: ${snapshot1.winner} vs ${snapshot2.winner}`);
  }
  
  // Compare board pieces
  const pieces1Map = new Map(
    snapshot1.boardPieces.map((p) => [
      `${p.position.x},${p.position.y},${p.position.z}`,
      p.player,
    ])
  );
  
  const pieces2Map = new Map(
    snapshot2.boardPieces.map((p) => [
      `${p.position.x},${p.position.y},${p.position.z}`,
      p.player,
    ])
  );
  
  // Check for pieces in snapshot1 not in snapshot2
  for (const [pos, player] of pieces1Map) {
    if (!pieces2Map.has(pos)) {
      differences.push(`Piece at ${pos} (${player}) missing in snapshot2`);
    } else if (pieces2Map.get(pos) !== player) {
      differences.push(
        `Piece at ${pos}: ${player} vs ${pieces2Map.get(pos)}`
      );
    }
  }
  
  // Check for pieces in snapshot2 not in snapshot1
  for (const [pos, player] of pieces2Map) {
    if (!pieces1Map.has(pos)) {
      differences.push(`Extra piece at ${pos} (${player}) in snapshot2`);
    }
  }
  
  return {
    equal: differences.length === 0,
    differences,
  };
}

/**
 * Test performance of a function
 */
export async function measurePerformance<T>(
  fn: () => T | Promise<T>,
  iterations = 100
): Promise<{
  averageTime: number;
  minTime: number;
  maxTime: number;
  totalTime: number;
}> {
  const times: number[] = [];
  
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    times.push(end - start);
  }
  
  const totalTime = times.reduce((sum, time) => sum + time, 0);
  const averageTime = totalTime / iterations;
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  
  return { averageTime, minTime, maxTime, totalTime };
}

/**
 * Create a test environment with cleanup
 */
export function createTestEnvironment(): {
  cleanup: () => void;
  addCleanup: (fn: () => void) => void;
} {
  const cleanupFns: Array<() => void> = [];
  
  return {
    cleanup: () => {
      for (const fn of cleanupFns.reverse()) {
        fn();
      }
    },
    addCleanup: (fn: () => void) => {
      cleanupFns.push(fn);
    },
  };
}

/**
 * Suppress console methods during test
 */
export function suppressConsole(): () => void {
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
    info: console.info,
  };
  
  console.log = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();
  console.debug = jest.fn();
  console.info = jest.fn();
  
  return () => {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.debug = originalConsole.debug;
    console.info = originalConsole.info;
  };
}