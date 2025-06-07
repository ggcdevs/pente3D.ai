/**
 * Test data builders for creating test objects
 * Uses the builder pattern for flexible test data creation
 */

import { Game, GameState, Board, Player, Move, Piece, Vector3, Line, WinResult } from '@/core';
import { Settings } from '@/storage';
import type { BoardSize, PlayerColor, GameOptions } from '@/types';

/**
 * Builder for creating Vector3 instances
 */
export class Vector3Builder {
  private x = 0;
  private y = 0;
  private z = 0;

  withX(x: number): this {
    this.x = x;
    return this;
  }

  withY(y: number): this {
    this.y = y;
    return this;
  }

  withZ(z: number): this {
    this.z = z;
    return this;
  }

  withCoords(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  build(): Vector3 {
    return Vector3.create(this.x, this.y, this.z);
  }
}

/**
 * Builder for creating Player instances
 */
export class PlayerBuilder {
  private id = 'player1';
  private color: PlayerColor = 'black';
  private isLocal = true;
  private connectionId?: string;

  withId(id: string): this {
    this.id = id;
    return this;
  }

  withColor(color: PlayerColor): this {
    this.color = color;
    return this;
  }

  asRemote(connectionId: string): this {
    this.isLocal = false;
    this.connectionId = connectionId;
    return this;
  }

  build(): Player {
    return new Player(this.id, this.color, this.isLocal, this.connectionId);
  }
}

/**
 * Builder for creating Board instances with pieces
 */
export class BoardBuilder {
  private size: BoardSize = 7;
  private pieces: Array<{ position: Vector3; player: Player }> = [];

  withSize(size: BoardSize): this {
    this.size = size;
    return this;
  }

  withPiece(x: number, y: number, z: number, player: Player): this {
    this.pieces.push({
      position: Vector3.create(x, y, z),
      player,
    });
    return this;
  }

  withPieces(pieces: Array<{ position: Vector3; player: Player }>): this {
    this.pieces = [...this.pieces, ...pieces];
    return this;
  }

  build(): Board {
    const board = new Board(this.size);
    for (const { position, player } of this.pieces) {
      board.placePiece(position, player);
    }
    return board;
  }
}

/**
 * Builder for creating Move instances
 */
export class MoveBuilder {
  private position = Vector3.create(0, 0, 0);
  private player = new Player('player1', 'black');
  private timestamp = Date.now();
  private capturedPieces: Vector3[] = [];

  withPosition(x: number, y: number, z: number): this {
    this.position = Vector3.create(x, y, z);
    return this;
  }

  withPlayer(player: Player): this {
    this.player = player;
    return this;
  }

  withTimestamp(timestamp: number): this {
    this.timestamp = timestamp;
    return this;
  }

  withCaptures(captures: Vector3[]): this {
    this.capturedPieces = captures;
    return this;
  }

  build(): Move {
    return new Move(this.position, this.player, this.timestamp, this.capturedPieces);
  }
}

/**
 * Builder for creating Game instances
 */
export class GameBuilder {
  private options: GameOptions = { boardSize: 7 };
  private moves: Move[] = [];

  withBoardSize(size: BoardSize): this {
    this.options.boardSize = size;
    return this;
  }

  withBlackFirst(blackFirst: boolean): this {
    this.options.blackFirst = blackFirst;
    return this;
  }

  withMoves(moves: Move[]): this {
    this.moves = moves;
    return this;
  }

  build(): Game {
    const game = new Game(this.options);
    
    // Apply moves
    for (const move of this.moves) {
      const state = game.getCurrentState();
      if (state.getCurrentPlayer().color === move.player.color) {
        game.placePiece(move.position);
      }
    }
    
    return game;
  }
}

/**
 * Builder for creating Settings instances
 */
export class SettingsBuilder {
  private settings = new Settings();

  withTheme(themeId: string): this {
    this.settings.setActiveTheme(themeId);
    return this;
  }

  withColor(key: string, color: string): this {
    // Use type assertion since setColor expects specific keys
    this.settings.setColor(key as any, color);
    return this;
  }

  withOpacity(key: string, opacity: number): this {
    // Use type assertion since setOpacity expects specific keys
    this.settings.setOpacity(key as any, opacity);
    return this;
  }

  build(): Settings {
    return this.settings;
  }
}

/**
 * Factory functions for common test scenarios
 */
export const TestDataFactory = {
  /**
   * Create a standard test board with some pieces
   */
  createTestBoard(size: BoardSize = 7): Board {
    const blackPlayer = new PlayerBuilder().withColor('black').build();
    const whitePlayer = new PlayerBuilder().withId('player2').withColor('white').build();
    
    return new BoardBuilder()
      .withSize(size)
      .withPiece(0, 0, 0, blackPlayer)
      .withPiece(1, 0, 0, whitePlayer)
      .withPiece(-1, 0, 0, blackPlayer)
      .build();
  },

  /**
   * Create a board with a winning line
   */
  createWinningBoard(): Board {
    const blackPlayer = new PlayerBuilder().withColor('black').build();
    
    return new BoardBuilder()
      .withSize(7)
      .withPiece(0, 0, 0, blackPlayer)
      .withPiece(1, 0, 0, blackPlayer)
      .withPiece(2, 0, 0, blackPlayer)
      .withPiece(3, 0, 0, blackPlayer)
      .withPiece(4, 0, 0, blackPlayer) // Five in a row
      .build();
  },

  /**
   * Create a board ready for capture
   */
  createCaptureBoard(): Board {
    const blackPlayer = new PlayerBuilder().withColor('black').build();
    const whitePlayer = new PlayerBuilder().withId('player2').withColor('white').build();
    
    return new BoardBuilder()
      .withSize(7)
      .withPiece(0, 0, 0, blackPlayer)
      .withPiece(1, 0, 0, whitePlayer)
      .withPiece(2, 0, 0, whitePlayer)
      // Place black at (3,0,0) to capture white pieces
      .build();
  },

  /**
   * Create test players
   */
  createTestPlayers(): { black: Player; white: Player } {
    return {
      black: new PlayerBuilder().withId('black-player').withColor('black').build(),
      white: new PlayerBuilder().withId('white-player').withColor('white').build(),
    };
  },

  /**
   * Create a game in progress
   */
  createGameInProgress(): Game {
    const { black, white } = this.createTestPlayers();
    
    return new GameBuilder()
      .withBoardSize(7)
      .withMoves([
        new MoveBuilder().withPosition(0, 0, 0).withPlayer(black).build(),
        new MoveBuilder().withPosition(1, 0, 0).withPlayer(white).build(),
        new MoveBuilder().withPosition(0, 1, 0).withPlayer(black).build(),
        new MoveBuilder().withPosition(1, 1, 0).withPlayer(white).build(),
      ])
      .build();
  },
};

/**
 * Convenience functions for quick object creation
 */
export function vector3(x: number, y: number, z: number): Vector3 {
  return new Vector3Builder().withCoords(x, y, z).build();
}

export function player(color: PlayerColor, id?: string): Player {
  return new PlayerBuilder()
    .withId(id || `${color}-player`)
    .withColor(color)
    .build();
}

export function move(x: number, y: number, z: number, player: Player): Move {
  return new MoveBuilder()
    .withPosition(x, y, z)
    .withPlayer(player)
    .build();
}