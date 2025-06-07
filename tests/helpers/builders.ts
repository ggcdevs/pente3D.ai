/**
 * Test data builders for creating test objects
 * Uses the builder pattern for flexible test data creation
 */

import { Game, GameState, Board, Player, Move, Piece, Vector3, Line, WinResult } from '@/core';
import { Settings } from '@/storage';
import type { BoardSize, PlayerColor, GameOptions } from '@/types';

/**
 * Base builder class with common functionality
 */
abstract class BaseBuilder<T> {
  protected abstract doBuild(): T;
  
  build(): T {
    return this.doBuild();
  }
  
  /**
   * Build multiple instances with variations
   */
  buildMany(count: number, modifier?: (builder: this, index: number) => void): T[] {
    const results: T[] = [];
    for (let i = 0; i < count; i++) {
      const builder = Object.create(this);
      Object.assign(builder, this);
      if (modifier) {
        modifier(builder, i);
      }
      results.push(builder.build());
    }
    return results;
  }
}

/**
 * Builder for creating Vector3 instances
 */
export class Vector3Builder extends BaseBuilder<Vector3> {
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

  /**
   * Create from another Vector3
   */
  from(vector: Vector3): this {
    this.x = vector.x;
    this.y = vector.y;
    this.z = vector.z;
    return this;
  }

  /**
   * Create at a random position within bounds
   */
  withRandomCoords(min: number, max: number): this {
    this.x = Math.floor(Math.random() * (max - min + 1)) + min;
    this.y = Math.floor(Math.random() * (max - min + 1)) + min;
    this.z = Math.floor(Math.random() * (max - min + 1)) + min;
    return this;
  }

  /**
   * Create along a specific axis
   */
  alongAxis(axis: 'x' | 'y' | 'z', value: number): this {
    this.x = axis === 'x' ? value : 0;
    this.y = axis === 'y' ? value : 0;
    this.z = axis === 'z' ? value : 0;
    return this;
  }

  protected doBuild(): Vector3 {
    return Vector3.create(this.x, this.y, this.z);
  }
}

/**
 * Builder for creating Player instances
 */
export class PlayerBuilder extends BaseBuilder<Player> {
  private id = 'player1';
  private color: PlayerColor = 'black';
  private isLocal = true;
  private connectionId?: string;
  private static idCounter = 0;

  constructor() {
    super();
    // Auto-generate unique IDs
    this.id = `player-${++PlayerBuilder.idCounter}`;
  }

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

  asLocal(): this {
    this.isLocal = true;
    this.connectionId = undefined;
    return this;
  }

  /**
   * Create player with auto-generated connection ID
   */
  asRemoteWithAutoId(): this {
    this.isLocal = false;
    this.connectionId = `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    return this;
  }

  /**
   * Reset the ID counter (useful between tests)
   */
  static resetIdCounter(): void {
    PlayerBuilder.idCounter = 0;
  }

  protected doBuild(): Player {
    return new Player(this.id, this.color, this.isLocal, this.connectionId);
  }
}

/**
 * Builder for creating Board instances with pieces
 */
export class BoardBuilder extends BaseBuilder<Board> {
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

  /**
   * Add a line of pieces
   */
  withLine(start: Vector3, direction: Vector3, length: number, player: Player): this {
    for (let i = 0; i < length; i++) {
      this.pieces.push({
        position: Vector3.create(
          start.x + direction.x * i,
          start.y + direction.y * i,
          start.z + direction.z * i
        ),
        player,
      });
    }
    return this;
  }

  /**
   * Add pieces in a pattern
   */
  withPattern(pattern: string[], player1: Player, player2: Player, z = 0): this {
    pattern.forEach((row, y) => {
      row.split('').forEach((cell, x) => {
        if (cell === '1') {
          this.withPiece(x, y, z, player1);
        } else if (cell === '2') {
          this.withPiece(x, y, z, player2);
        }
      });
    });
    return this;
  }

  /**
   * Create a board with random pieces
   */
  withRandomPieces(count: number, player1: Player, player2: Player): this {
    const placed = new Set<string>();
    const halfSize = Math.floor(this.size / 2);
    
    for (let i = 0; i < count; i++) {
      let position: Vector3;
      let key: string;
      
      do {
        position = new Vector3Builder()
          .withRandomCoords(-halfSize, halfSize)
          .build();
        key = `${position.x},${position.y},${position.z}`;
      } while (placed.has(key));
      
      placed.add(key);
      this.withPiece(position.x, position.y, position.z, i % 2 === 0 ? player1 : player2);
    }
    
    return this;
  }

  /**
   * Clear all pieces
   */
  clear(): this {
    this.pieces = [];
    return this;
  }

  /**
   * Create from an existing board
   */
  fromBoard(board: Board): this {
    this.size = board.getSize();
    this.pieces = [];
    
    const allPieces = board.getAllPieces();
    for (const piece of allPieces) {
      this.pieces.push({
        position: piece.coords,
        player: piece.player,
      });
    }
    
    return this;
  }

  protected doBuild(): Board {
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
export class MoveBuilder extends BaseBuilder<Move> {
  private position = Vector3.create(0, 0, 0);
  private player = new Player('player1', 'black');
  private timestamp = Date.now();
  private capturedPieces: Vector3[] = [];

  withPosition(x: number, y: number, z: number): this {
    this.position = Vector3.create(x, y, z);
    return this;
  }

  withVector3(position: Vector3): this {
    this.position = position;
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

  /**
   * Add a single capture
   */
  withCapture(x: number, y: number, z: number): this {
    this.capturedPieces.push(Vector3.create(x, y, z));
    return this;
  }

  /**
   * Set relative timestamp (milliseconds from now)
   */
  withRelativeTimestamp(millisecondsAgo: number): this {
    this.timestamp = Date.now() - millisecondsAgo;
    return this;
  }

  protected doBuild(): Move {
    return new Move(this.position, this.player, this.timestamp, this.capturedPieces);
  }
}

/**
 * Builder for creating Game instances
 */
export class GameBuilder extends BaseBuilder<Game> {
  private options: GameOptions = { boardSize: 7 };
  private moves: Move[] = [];
  private initialBoard?: Board;

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

  /**
   * Add moves by position only (alternating players)
   */
  withPositions(positions: Array<{ x: number; y: number; z: number }>): this {
    const blackPlayer = new PlayerBuilder().withColor('black').build();
    const whitePlayer = new PlayerBuilder().withColor('white').build();
    
    this.moves = positions.map((pos, index) => 
      new MoveBuilder()
        .withPosition(pos.x, pos.y, pos.z)
        .withPlayer(index % 2 === 0 ? blackPlayer : whitePlayer)
        .withRelativeTimestamp((positions.length - index) * 1000)
        .build()
    );
    
    return this;
  }

  /**
   * Start from a specific board state
   */
  withInitialBoard(board: Board): this {
    this.initialBoard = board;
    return this;
  }

  /**
   * Create a game at a specific move number
   */
  atMove(moveNumber: number): this {
    if (moveNumber < this.moves.length) {
      this.moves = this.moves.slice(0, moveNumber);
    }
    return this;
  }

  protected doBuild(): Game {
    const game = new Game(this.options);
    
    // If initial board provided, set it up
    if (this.initialBoard) {
      // This would require a method to set board state in Game
      // For now, we'll apply moves sequentially
    }
    
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
export class SettingsBuilder extends BaseBuilder<Settings> {
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

  /**
   * Apply dark theme settings
   */
  withDarkTheme(): this {
    this.settings.setActiveTheme('dark');
    return this;
  }

  /**
   * Apply high contrast settings
   */
  withHighContrast(): this {
    this.settings.setActiveTheme('high-contrast');
    return this;
  }

  /**
   * Set all settings from an object
   */
  withSettings(settings: Record<string, any>): this {
    Object.entries(settings).forEach(([key, value]) => {
      if (key.includes('Color')) {
        this.withColor(key, value as string);
      } else if (key.includes('Opacity')) {
        this.withOpacity(key, value as number);
      }
    });
    return this;
  }

  protected doBuild(): Settings {
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
  createWinningBoard(direction: 'horizontal' | 'vertical' | 'diagonal' = 'horizontal'): Board {
    const blackPlayer = new PlayerBuilder().withColor('black').build();
    const start = Vector3.create(0, 0, 0);
    
    const directions = {
      horizontal: Vector3.create(1, 0, 0),
      vertical: Vector3.create(0, 1, 0),
      diagonal: Vector3.create(1, 1, 0),
    };
    
    return new BoardBuilder()
      .withSize(7)
      .withLine(start, directions[direction], 5, blackPlayer)
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
   * Create remote players for network testing
   */
  createNetworkPlayers(): { local: Player; remote: Player } {
    return {
      local: new PlayerBuilder().withId('local-player').withColor('black').asLocal().build(),
      remote: new PlayerBuilder().withId('remote-player').withColor('white').asRemoteWithAutoId().build(),
    };
  },

  /**
   * Create a game in progress
   */
  createGameInProgress(moveCount = 4): Game {
    const positions = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 2, z: 0 },
      { x: 1, y: 2, z: 0 },
      { x: 0, y: 3, z: 0 },
      { x: 1, y: 3, z: 0 },
    ];
    
    return new GameBuilder()
      .withBoardSize(7)
      .withPositions(positions.slice(0, moveCount))
      .build();
  },

  /**
   * Create a complex board position
   */
  createComplexPosition(): Board {
    const { black, white } = this.createTestPlayers();
    
    return new BoardBuilder()
      .withSize(7)
      .withPattern([
        '1.2.1..',
        '.2.2.1.',
        '..1.2..',
        '.1.1.2.',
        '2.2.1..',
        '.....1.',
        '.......',
      ], black, white)
      .build();
  },

  /**
   * Create board with threats
   */
  createBoardWithThreats(): Board {
    const { black, white } = this.createTestPlayers();
    
    return new BoardBuilder()
      .withSize(7)
      // Black has 4 in a row (threat)
      .withLine(Vector3.create(0, 0, 0), Vector3.create(1, 0, 0), 4, black)
      // White has 3 in a row (potential threat)
      .withLine(Vector3.create(0, 2, 0), Vector3.create(1, 0, 0), 3, white)
      .build();
  },

  /**
   * Create a draw position (board full)
   */
  createDrawPosition(): Board {
    const { black, white } = this.createTestPlayers();
    const board = new BoardBuilder().withSize(5); // Smaller for easier fill
    
    // Fill the board in a pattern that prevents wins
    for (let x = -2; x <= 2; x++) {
      for (let y = -2; y <= 2; y++) {
        for (let z = -2; z <= 2; z++) {
          const sum = Math.abs(x) + Math.abs(y) + Math.abs(z);
          board.withPiece(x, y, z, sum % 2 === 0 ? black : white);
        }
      }
    }
    
    return board.build();
  },

  /**
   * Create game with specific history
   */
  createGameWithHistory(history: string[]): Game {
    const positions = history.map(pos => {
      const [x, y, z] = pos.split(',').map(Number);
      return { x, y, z };
    });
    
    return new GameBuilder()
      .withBoardSize(7)
      .withPositions(positions)
      .build();
  },

  /**
   * Create settings for testing
   */
  createTestSettings(theme: 'default' | 'dark' | 'high-contrast' = 'default'): Settings {
    const builder = new SettingsBuilder();
    
    switch (theme) {
      case 'dark':
        return builder.withDarkTheme().build();
      case 'high-contrast':
        return builder.withHighContrast().build();
      default:
        return builder.build();
    }
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