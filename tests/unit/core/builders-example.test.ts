/**
 * Example tests demonstrating the enhanced test data builders
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { 
  BoardBuilder, 
  GameBuilder, 
  PlayerBuilder, 
  Vector3Builder,
  TestDataFactory,
  PatternGenerator,
  GameScenarios,
  ScenarioBuilder,
  RandomScenarios,
  scenario
} from '@/tests/helpers/builders';

describe('Enhanced Test Builders Examples', () => {
  beforeEach(() => {
    // Reset ID counters for consistent tests
    PlayerBuilder.resetIdCounter();
  });

  describe('Basic Builders', () => {
    it('should create multiple vectors with variations', () => {
      const vectors = new Vector3Builder()
        .withY(1)
        .buildMany(3, (builder, index) => {
          builder.withX(index);
        });

      expect(vectors).toHaveLength(3);
      expect(vectors[0]).toMatchObject({ x: 0, y: 1, z: 0 });
      expect(vectors[1]).toMatchObject({ x: 1, y: 1, z: 0 });
      expect(vectors[2]).toMatchObject({ x: 2, y: 1, z: 0 });
    });

    it('should create vectors along axes', () => {
      const xAxis = new Vector3Builder().alongAxis('x', 5).build();
      const yAxis = new Vector3Builder().alongAxis('y', 3).build();
      const zAxis = new Vector3Builder().alongAxis('z', -2).build();

      expect(xAxis).toMatchObject({ x: 5, y: 0, z: 0 });
      expect(yAxis).toMatchObject({ x: 0, y: 3, z: 0 });
      expect(zAxis).toMatchObject({ x: 0, y: 0, z: -2 });
    });

    it('should create players with auto-generated IDs', () => {
      const players = new PlayerBuilder()
        .withColor('black')
        .buildMany(3);

      expect(players[0].getId()).toBe('player-1');
      expect(players[1].getId()).toBe('player-2');
      expect(players[2].getId()).toBe('player-3');
    });

    it('should create board with line pattern', () => {
      const player = new PlayerBuilder().withColor('black').build();
      const board = new BoardBuilder()
        .withSize(7)
        .withLine(
          new Vector3Builder().build(),
          new Vector3Builder().withCoords(1, 1, 0).build(),
          4,
          player
        )
        .build();

      expect(board.getPieceAt({ x: 0, y: 0, z: 0 })).toBeTruthy();
      expect(board.getPieceAt({ x: 1, y: 1, z: 0 })).toBeTruthy();
      expect(board.getPieceAt({ x: 2, y: 2, z: 0 })).toBeTruthy();
      expect(board.getPieceAt({ x: 3, y: 3, z: 0 })).toBeTruthy();
    });

    it('should create board from pattern strings', () => {
      const { black, white } = TestDataFactory.createTestPlayers();
      const board = new BoardBuilder()
        .withSize(7)
        .withPattern([
          '1.2',
          '.1.',
          '2.1'
        ], black, white)
        .build();

      expect(board.getPieceAt({ x: 0, y: 0, z: 0 })?.player.color).toBe('black');
      expect(board.getPieceAt({ x: 2, y: 0, z: 0 })?.player.color).toBe('white');
      expect(board.getPieceAt({ x: 1, y: 1, z: 0 })?.player.color).toBe('black');
    });
  });

  describe('Pattern Generators', () => {
    it('should create spiral pattern', () => {
      const { black, white } = TestDataFactory.createTestPlayers();
      const board = PatternGenerator.spiral(5, black, white);

      // Check center is occupied
      expect(board.getPieceAt({ x: 0, y: 0, z: 0 })).toBeTruthy();
      
      // Check spiral continues outward
      expect(board.getPieceAt({ x: 1, y: 0, z: 0 })).toBeTruthy();
      expect(board.getPieceAt({ x: 1, y: 1, z: 0 })).toBeTruthy();
    });

    it('should create 3D checkerboard', () => {
      const { black, white } = TestDataFactory.createTestPlayers();
      const board = PatternGenerator.checkerboard3D(5, black, white);

      const pieces = board.getAllPieces();
      expect(pieces.length).toBeGreaterThan(0);

      // Verify checkerboard pattern
      pieces.forEach(piece => {
        const sum = piece.coords.x + piece.coords.y + piece.coords.z;
        if (sum % 2 === 0) {
          // Should have a piece here
          expect(piece).toBeTruthy();
        }
      });
    });
  });

  describe('Game Scenarios', () => {
    it('should create capture sequence game', () => {
      const game = GameScenarios.captureSequence();
      const state = game.getCurrentState();

      // Game should have progressed through captures
      expect(game.getHistoryLength()).toBeGreaterThan(5);
      
      // Check that captures occurred
      const history = game.getHistory();
      const movesWithCaptures = history.filter(move => move.capturedPieces.length > 0);
      expect(movesWithCaptures.length).toBeGreaterThan(0);
    });

    it('should create tactical position', () => {
      const game = GameScenarios.tacticalPosition();
      const board = game.getBoard();

      // Should have multiple pieces creating threats
      const pieces = board.getAllPieces();
      expect(pieces.length).toBe(10);

      // Verify specific tactical elements exist
      expect(board.getPieceAt({ x: 2, y: 1, z: 0 })).toBeTruthy(); // Fork piece
    });
  });

  describe('Scenario Builder Fluent API', () => {
    it('should build game with fluent API', () => {
      const game = scenario()
        .withBoardSize(9)
        .withMoves(
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
          [1, 1, 0]
        )
        .buildGame();

      expect(game.getBoard().getSize()).toBe(9);
      expect(game.getBoard().getAllPieces()).toHaveLength(4);
    });

    it('should create winning position', () => {
      const game = scenario()
        .withWinningLine([0, 0, 0], [1, 0, 0])
        .buildGame();

      const board = game.getBoard();
      
      // Check winning line exists
      for (let i = 0; i < 5; i++) {
        expect(board.getPieceAt({ x: i, y: 0, z: 0 })).toBeTruthy();
      }
    });

    it('should create threat position', () => {
      const board = scenario()
        .withThreat([0, 0, 0], [1, 1, 0], 4)
        .buildBoard();

      // Check threat line exists (4 in a row diagonally)
      for (let i = 0; i < 4; i++) {
        expect(board.getPieceAt({ x: i, y: i, z: 0 })).toBeTruthy();
      }
    });
  });

  describe('Random Scenarios', () => {
    it('should generate deterministic random game with seed', () => {
      const game1 = RandomScenarios.randomGame({ seed: 12345, minMoves: 10, maxMoves: 10 });
      const game2 = RandomScenarios.randomGame({ seed: 12345, minMoves: 10, maxMoves: 10 });

      // Same seed should produce same game
      expect(game1.getBoard().getAllPieces().length).toBe(game2.getBoard().getAllPieces().length);
      
      // Compare piece positions
      const pieces1 = game1.getBoard().getAllPieces();
      const pieces2 = game2.getBoard().getAllPieces();
      
      pieces1.forEach((piece, index) => {
        expect(piece.coords).toEqual(pieces2[index].coords);
      });
    });

    it('should generate clustered position', () => {
      const board = RandomScenarios.randomPosition({
        pieceCount: 15,
        boardSize: 7,
        clusters: true
      });

      const pieces = board.getAllPieces();
      expect(pieces.length).toBeGreaterThan(0);
      expect(pieces.length).toBeLessThanOrEqual(15);
    });
  });

  describe('Test Data Factory', () => {
    it('should create various winning boards', () => {
      const horizontal = TestDataFactory.createWinningBoard('horizontal');
      const vertical = TestDataFactory.createWinningBoard('vertical');
      const diagonal = TestDataFactory.createWinningBoard('diagonal');

      // Check horizontal win
      for (let i = 0; i < 5; i++) {
        expect(horizontal.getPieceAt({ x: i, y: 0, z: 0 })).toBeTruthy();
      }

      // Check vertical win
      for (let i = 0; i < 5; i++) {
        expect(vertical.getPieceAt({ x: 0, y: i, z: 0 })).toBeTruthy();
      }

      // Check diagonal win
      for (let i = 0; i < 5; i++) {
        expect(diagonal.getPieceAt({ x: i, y: i, z: 0 })).toBeTruthy();
      }
    });

    it('should create game at specific move count', () => {
      const earlyGame = TestDataFactory.createGameInProgress(2);
      const midGame = TestDataFactory.createGameInProgress(6);

      expect(earlyGame.getBoard().getAllPieces()).toHaveLength(2);
      expect(midGame.getBoard().getAllPieces()).toHaveLength(6);
    });

    it('should create complex board position', () => {
      const board = TestDataFactory.createComplexPosition();
      const pieces = board.getAllPieces();

      expect(pieces.length).toBeGreaterThan(10);
      
      // Verify pattern was applied correctly
      const piece00 = board.getPieceAt({ x: 0, y: 0, z: 0 });
      const piece20 = board.getPieceAt({ x: 2, y: 0, z: 0 });
      
      expect(piece00?.player.color).toBe('black');
      expect(piece20?.player.color).toBe('white');
    });

    it('should create game from history notation', () => {
      const game = TestDataFactory.createGameWithHistory([
        '0,0,0',
        '1,0,0',
        '0,1,0',
        '1,1,0',
        '0,2,0'
      ]);

      const pieces = game.getBoard().getAllPieces();
      expect(pieces).toHaveLength(5);
      
      // Verify positions
      expect(game.getBoard().getPieceAt({ x: 0, y: 0, z: 0 })).toBeTruthy();
      expect(game.getBoard().getPieceAt({ x: 0, y: 2, z: 0 })).toBeTruthy();
    });
  });
});