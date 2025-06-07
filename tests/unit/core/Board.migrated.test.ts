import { Board, Vector3 } from '@/core';
import { 
  BoardBuilder, 
  PlayerBuilder, 
  PieceBuilder, 
  Vector3Builder 
} from '@/tests/helpers/builders';
import { GameScenarios } from '@/tests/helpers/builders/advanced';

describe('Board (Migrated)', () => {
  // Test Group D: Board Construction
  describe('construction', () => {
    it('should accept valid board sizes (7, 9, 11)', () => {
      // Using builders for consistency
      const board7 = new BoardBuilder().withSize(7).build();
      const board9 = new BoardBuilder().withSize(9).build();
      const board11 = new BoardBuilder().withSize(11).build();

      expect(board7.size).toBe(7);
      expect(board9.size).toBe(9);
      expect(board11.size).toBe(11);
    });

    it('should throw error for invalid board size', () => {
      // Builder validates sizes
      expect(() => new BoardBuilder().withSize(5 as any).build()).toThrow('Board size must be 7, 9, or 11');
      expect(() => new BoardBuilder().withSize(8 as any).build()).toThrow('Board size must be 7, 9, or 11');
      expect(() => new BoardBuilder().withSize(13 as any).build()).toThrow('Board size must be 7, 9, or 11');
    });

    it('should create empty board with no pieces', () => {
      const board = new BoardBuilder().build();
      expect(board.getPieceCount()).toBe(0);
      expect(board.getAllPieces()).toHaveLength(0);
    });

    it('should initialize board from pieces correctly', () => {
      // Use builders for test data
      const player = new PlayerBuilder().withColor('black').build();
      const board = new BoardBuilder()
        .withPiece(0, 0, 0, player)
        .withPiece(1, 1, 1, player)
        .build();
      
      expect(board.getPieceCount()).toBe(2);
      expect(board.hasPiece(new Vector3(0, 0, 0))).toBe(true);
      expect(board.hasPiece(new Vector3(1, 1, 1))).toBe(true);
    });

    it('should use builder patterns for complex scenarios', () => {
      // Using advanced builders for patterns
      const board = new BoardBuilder()
        .withPattern([
          '1.2',
          '.1.',
          '2.1'
        ])
        .build();
      
      expect(board.getPieceCount()).toBe(6);
    });

    it('should create boards with many pieces efficiently', () => {
      // Using buildMany for performance testing
      const boards = new BoardBuilder()
        .withRandomPieces(10)
        .buildMany(5);
      
      expect(boards).toHaveLength(5);
      boards.forEach(board => {
        expect(board.getPieceCount()).toBe(10);
      });
    });
  });

  // Test Group E: Coordinate Management
  describe('coordinates', () => {
    let board: Board;

    beforeEach(() => {
      board = new BoardBuilder().build();
    });

    it('should generate consistent coordinate keys', () => {
      // Use builders for test data
      const player = new PlayerBuilder().build();
      const coord = new Vector3Builder().withCoords(1, -2, 3).build();
      
      const newBoard = new BoardBuilder()
        .withPiece(coord.x, coord.y, coord.z, player)
        .build();
      
      expect(newBoard.hasPiece(coord)).toBe(true);
      
      // Same coordinate should retrieve same piece
      const retrieved = newBoard.getPiece(coord);
      expect(retrieved?.coords.equals(coord)).toBe(true);
    });

    it('should handle isInBounds for various positions', () => {
      // Use Vector3Builder helpers
      const positions = [
        new Vector3Builder().zero().build(), // Center
        new Vector3Builder().withX(3).build(), // X-axis
        new Vector3Builder().withY(-3).build(), // Y-axis
        new Vector3Builder().withCoords(3, 3, 3).build(), // Corner
      ];
      
      positions.forEach(pos => {
        expect(board.isInBounds(pos)).toBe(true);
      });
      
      // Out of bounds
      const outOfBounds = new Vector3Builder().withCoords(4, 4, 4).build();
      expect(board.isInBounds(outOfBounds)).toBe(false);
    });
  });

  // Test Group F: Game Scenarios
  describe('game scenarios', () => {
    it('should handle near-win scenarios', () => {
      const scenario = GameScenarios.nearWin('black');
      const board = scenario.board;
      
      // Board should have pieces set up for near-win
      expect(board.getPieceCount()).toBeGreaterThan(3);
      
      // Should have a potential winning line
      const lines = board.getAllLines();
      const potentialWinLines = lines.filter(line => {
        const blackCount = line.pieces.filter(p => p?.player.getColor() === 'black').length;
        return blackCount >= 4;
      });
      expect(potentialWinLines.length).toBeGreaterThan(0);
    });

    it('should create complex board states', () => {
      const scenario = GameScenarios.complexMiddleGame();
      const board = scenario.board;
      
      // Should have many pieces
      expect(board.getPieceCount()).toBeGreaterThan(20);
      
      // Should have mixed colors
      const pieces = board.getAllPieces();
      const blackCount = pieces.filter(p => p.player.getColor() === 'black').length;
      const whiteCount = pieces.filter(p => p.player.getColor() === 'white').length;
      
      expect(blackCount).toBeGreaterThan(0);
      expect(whiteCount).toBeGreaterThan(0);
      expect(Math.abs(blackCount - whiteCount)).toBeLessThanOrEqual(1);
    });
  });

  // Example of using performance assertions
  describe('performance', () => {
    it('should place pieces quickly', async () => {
      const { PerformanceAssertions } = await import('@/tests/helpers/performance');
      
      const board = new BoardBuilder().build();
      const player = new PlayerBuilder().build();
      const position = new Vector3Builder().withCoords(3, 3, 3).build();
      
      await PerformanceAssertions.assertCompleteWithin(() => {
        const piece = new PieceBuilder()
          .withCoords(position)
          .withPlayer(player)
          .build();
        board.placePiece(piece);
      }, 5); // Should complete within 5ms
    });
  });
});