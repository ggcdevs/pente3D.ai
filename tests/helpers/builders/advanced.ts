/**
 * Advanced builder patterns and scenarios
 * Provides complex test data generation capabilities
 */

import { BoardBuilder, GameBuilder, PlayerBuilder, Vector3Builder } from '../builders';
import type { Board, Game, Player, Vector3 } from '@/core';

/**
 * Pattern generators for creating specific board configurations
 */
export class PatternGenerator {
  /**
   * Generate a spiral pattern
   */
  static spiral(size: number, player1: Player, player2: Player): Board {
    const builder = new BoardBuilder().withSize(size);
    const center = 0;
    let x = center, y = center, z = center;
    let dx = 1, dy = 0, dz = 0;
    let steps = 1;
    let stepCount = 0;
    let turnCount = 0;
    
    for (let i = 0; i < size * size; i++) {
      builder.withPiece(x, y, z, i % 2 === 0 ? player1 : player2);
      
      x += dx;
      y += dy;
      stepCount++;
      
      if (stepCount === steps) {
        stepCount = 0;
        turnCount++;
        
        // Change direction
        const temp = dx;
        dx = -dy;
        dy = temp;
        
        if (turnCount === 2) {
          turnCount = 0;
          steps++;
        }
      }
    }
    
    return builder.build();
  }

  /**
   * Generate a checkerboard pattern in 3D
   */
  static checkerboard3D(size: number, player1: Player, player2: Player): Board {
    const builder = new BoardBuilder().withSize(size);
    const halfSize = Math.floor(size / 2);
    
    for (let x = -halfSize; x <= halfSize; x++) {
      for (let y = -halfSize; y <= halfSize; y++) {
        for (let z = -halfSize; z <= halfSize; z++) {
          if ((x + y + z) % 2 === 0) {
            builder.withPiece(x, y, z, (x + y + z) % 4 === 0 ? player1 : player2);
          }
        }
      }
    }
    
    return builder.build();
  }

  /**
   * Generate concentric shells
   */
  static concentricShells(size: number, player1: Player, player2: Player): Board {
    const builder = new BoardBuilder().withSize(size);
    const maxRadius = Math.floor(size / 2);
    
    for (let radius = 0; radius <= maxRadius; radius++) {
      const player = radius % 2 === 0 ? player1 : player2;
      
      // Generate shell at this radius
      for (let x = -radius; x <= radius; x++) {
        for (let y = -radius; y <= radius; y++) {
          for (let z = -radius; z <= radius; z++) {
            // Check if on the surface of the shell
            const absSum = Math.abs(x) + Math.abs(y) + Math.abs(z);
            if (absSum === radius * 3 || 
                (Math.abs(x) === radius || Math.abs(y) === radius || Math.abs(z) === radius)) {
              builder.withPiece(x, y, z, player);
            }
          }
        }
      }
    }
    
    return builder.build();
  }
}

/**
 * Game scenario builders for complex test cases
 */
export class GameScenarios {
  /**
   * Create a game with multiple capture sequences
   */
  static captureSequence(): Game {
    const black = new PlayerBuilder().withColor('black').build();
    const white = new PlayerBuilder().withColor('white').build();
    
    return new GameBuilder()
      .withBoardSize(7)
      .withPositions([
        // Set up for black to capture
        { x: 0, y: 0, z: 0 }, // black
        { x: 1, y: 0, z: 0 }, // white
        { x: 0, y: 1, z: 0 }, // black
        { x: 2, y: 0, z: 0 }, // white
        { x: 3, y: 0, z: 0 }, // black - captures white pieces
        // Set up for white to capture
        { x: 0, y: 2, z: 0 }, // white
        { x: 1, y: 2, z: 0 }, // black
        { x: 2, y: 2, z: 0 }, // white
        { x: 1, y: 3, z: 0 }, // black
        { x: 3, y: 2, z: 0 }, // white - captures black piece
      ])
      .build();
  }

  /**
   * Create a game with complex tactical position
   */
  static tacticalPosition(): Game {
    return new GameBuilder()
      .withBoardSize(7)
      .withPositions([
        // Create multiple threats
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 2, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 3, z: 0 },
        { x: 3, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        // Fork position
        { x: 2, y: 1, z: 0 },
        { x: 1, y: 2, z: 0 },
      ])
      .build();
  }

  /**
   * Create an endgame position
   */
  static endgamePosition(): Game {
    const positions: Array<{ x: number; y: number; z: number }> = [];
    
    // Fill most of the board
    for (let i = 0; i < 40; i++) {
      const x = (i % 7) - 3;
      const y = Math.floor(i / 7) - 3;
      positions.push({ x, y, z: 0 });
    }
    
    return new GameBuilder()
      .withBoardSize(7)
      .withPositions(positions)
      .build();
  }
}

/**
 * Fluent API for creating test scenarios
 */
export class ScenarioBuilder {
  private players: { black?: Player; white?: Player } = {};
  private boardSize: 7 | 9 | 11 | 13 | 15 | 17 | 19 = 7;
  private moves: Array<{ x: number; y: number; z: number }> = [];
  private patterns: Array<(board: BoardBuilder) => void> = [];

  withPlayers(black?: Player, white?: Player): this {
    this.players.black = black || new PlayerBuilder().withColor('black').build();
    this.players.white = white || new PlayerBuilder().withColor('white').build();
    return this;
  }

  withBoardSize(size: 7 | 9 | 11 | 13 | 15 | 17 | 19): this {
    this.boardSize = size;
    return this;
  }

  withMove(x: number, y: number, z: number): this {
    this.moves.push({ x, y, z });
    return this;
  }

  withMoves(...moves: Array<[number, number, number]>): this {
    moves.forEach(([x, y, z]) => this.moves.push({ x, y, z }));
    return this;
  }

  withWinningLine(start: [number, number, number], direction: [number, number, number]): this {
    this.patterns.push((board) => {
      const startVec = Vector3.create(...start);
      const dirVec = Vector3.create(...direction);
      board.withLine(startVec, dirVec, 5, this.players.black!);
    });
    return this;
  }

  withThreat(position: [number, number, number], direction: [number, number, number], length: number): this {
    this.patterns.push((board) => {
      const startVec = Vector3.create(...position);
      const dirVec = Vector3.create(...direction);
      board.withLine(startVec, dirVec, length, this.players.black!);
    });
    return this;
  }

  buildGame(): Game {
    if (!this.players.black || !this.players.white) {
      this.withPlayers();
    }

    const builder = new GameBuilder().withBoardSize(this.boardSize);

    if (this.patterns.length > 0) {
      // Build board with patterns first
      const boardBuilder = new BoardBuilder().withSize(this.boardSize);
      this.patterns.forEach(pattern => pattern(boardBuilder));
      const board = boardBuilder.build();
      
      // Convert board pieces to moves
      const pieces = board.getAllPieces();
      const moves = pieces.map(piece => ({
        x: piece.coords.x,
        y: piece.coords.y,
        z: piece.coords.z
      }));
      
      builder.withPositions(moves);
    } else if (this.moves.length > 0) {
      builder.withPositions(this.moves);
    }

    return builder.build();
  }

  buildBoard(): Board {
    if (!this.players.black || !this.players.white) {
      this.withPlayers();
    }

    const builder = new BoardBuilder().withSize(this.boardSize);

    // Apply patterns
    this.patterns.forEach(pattern => pattern(builder));

    // Apply individual moves
    this.moves.forEach((move, index) => {
      const player = index % 2 === 0 ? this.players.black! : this.players.white!;
      builder.withPiece(move.x, move.y, move.z, player);
    });

    return builder.build();
  }
}

/**
 * Random scenario generators
 */
export class RandomScenarios {
  private static random = Math.random;

  /**
   * Set custom random function for deterministic tests
   */
  static setRandom(fn: () => number): void {
    this.random = fn;
  }

  /**
   * Generate a random valid game
   */
  static randomGame(options?: {
    minMoves?: number;
    maxMoves?: number;
    boardSize?: 7 | 9 | 11 | 13 | 15 | 17 | 19;
    seed?: number;
  }): Game {
    const minMoves = options?.minMoves || 5;
    const maxMoves = options?.maxMoves || 20;
    const boardSize = options?.boardSize || 7;
    
    if (options?.seed !== undefined) {
      // Simple seedable random
      let seed = options.seed;
      this.setRandom(() => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      });
    }

    const moveCount = Math.floor(this.random() * (maxMoves - minMoves + 1)) + minMoves;
    const positions: Array<{ x: number; y: number; z: number }> = [];
    const used = new Set<string>();
    const halfSize = Math.floor(boardSize / 2);

    for (let i = 0; i < moveCount; i++) {
      let position: { x: number; y: number; z: number };
      let key: string;

      do {
        position = {
          x: Math.floor(this.random() * boardSize) - halfSize,
          y: Math.floor(this.random() * boardSize) - halfSize,
          z: Math.floor(this.random() * boardSize) - halfSize,
        };
        key = `${position.x},${position.y},${position.z}`;
      } while (used.has(key));

      used.add(key);
      positions.push(position);
    }

    return new GameBuilder()
      .withBoardSize(boardSize)
      .withPositions(positions)
      .build();
  }

  /**
   * Generate a random position with specific characteristics
   */
  static randomPosition(options: {
    pieceCount: number;
    boardSize?: 7 | 9 | 11 | 13 | 15 | 17 | 19;
    favorCenter?: boolean;
    clusters?: boolean;
  }): Board {
    const { black, white } = new PlayerBuilder().buildMany(2, (b, i) => 
      b.withColor(i === 0 ? 'black' : 'white')
    );
    
    const builder = new BoardBuilder().withSize(options.boardSize || 7);
    const halfSize = Math.floor((options.boardSize || 7) / 2);

    if (options.clusters) {
      // Generate clustered pieces
      const clusterCenters = Math.floor(options.pieceCount / 5);
      
      for (let c = 0; c < clusterCenters; c++) {
        const center = {
          x: Math.floor(this.random() * (options.boardSize || 7)) - halfSize,
          y: Math.floor(this.random() * (options.boardSize || 7)) - halfSize,
          z: 0,
        };

        for (let i = 0; i < 5; i++) {
          const offset = {
            x: Math.floor(this.random() * 3) - 1,
            y: Math.floor(this.random() * 3) - 1,
            z: Math.floor(this.random() * 3) - 1,
          };

          builder.withPiece(
            center.x + offset.x,
            center.y + offset.y,
            center.z + offset.z,
            this.random() < 0.5 ? black : white
          );
        }
      }
    } else {
      builder.withRandomPieces(options.pieceCount, black, white);
    }

    return builder.build();
  }
}

// Export convenience factory
export const scenario = () => new ScenarioBuilder();