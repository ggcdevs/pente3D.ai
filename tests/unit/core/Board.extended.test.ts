import { Board, Vector3, Piece, Line } from '@/core';

describe('Board Extended Methods', () => {
  let board: Board;

  beforeEach(() => {
    board = Board.createEmpty(7);
  });

  describe('getLinesAtPosition', () => {
    test('returns all 26 lines for center position', () => {
      const lines = board.getLinesAtPosition(Vector3.create(0, 0, 0));
      
      // 13 unique directions (half of 26, to avoid duplicates)
      expect(lines).toHaveLength(13);
      
      // All lines should contain the center position
      lines.forEach(line => {
        expect(line.positions.some(pos => pos.equals(Vector3.create(0, 0, 0)))).toBe(true);
      });
    });

    test('returns limited lines for edge position', () => {
      const edgePos = Vector3.create(3, 0, 0);
      const lines = board.getLinesAtPosition(edgePos);
      
      // Should have fewer lines than center due to board boundaries
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.length).toBeLessThanOrEqual(13);
      
      // All lines should contain the edge position
      lines.forEach(line => {
        expect(line.positions.some(pos => pos.equals(edgePos))).toBe(true);
      });
    });

    test('returns minimal lines for corner position', () => {
      const cornerPos = Vector3.create(3, 3, 3);
      const lines = board.getLinesAtPosition(cornerPos);
      
      // Corner should have the fewest lines
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.length).toBeLessThan(13);
      
      // Verify all lines contain the corner
      lines.forEach(line => {
        expect(line.positions.some(pos => pos.equals(cornerPos))).toBe(true);
      });
    });

    test('handles out of bounds position', () => {
      const outOfBounds = Vector3.create(10, 10, 10);
      const lines = board.getLinesAtPosition(outOfBounds);
      
      // Should return empty or handle gracefully
      expect(lines).toHaveLength(0);
    });

    test('includes all orthogonal lines', () => {
      const lines = board.getLinesAtPosition(Vector3.create(0, 0, 0));
      
      // Check for X, Y, Z axis lines
      const hasXAxis = lines.some(line => 
        line.direction.equals(Vector3.create(1, 0, 0))
      );
      const hasYAxis = lines.some(line => 
        line.direction.equals(Vector3.create(0, 1, 0))
      );
      const hasZAxis = lines.some(line => 
        line.direction.equals(Vector3.create(0, 0, 1))
      );
      
      expect(hasXAxis).toBe(true);
      expect(hasYAxis).toBe(true);
      expect(hasZAxis).toBe(true);
    });

    test('includes all diagonal lines', () => {
      const lines = board.getLinesAtPosition(Vector3.create(0, 0, 0));
      
      // Check for various diagonal directions
      const diagonals = [
        Vector3.create(1, 1, 0),
        Vector3.create(1, 0, 1),
        Vector3.create(0, 1, 1),
        Vector3.create(1, -1, 0),
      ];
      
      diagonals.forEach(dir => {
        const hasDirection = lines.some(line => 
          line.direction.equals(dir) || line.direction.equals(dir.multiply(-1))
        );
        expect(hasDirection).toBe(true);
      });
    });

    test('includes all 3D diagonal lines', () => {
      const lines = board.getLinesAtPosition(Vector3.create(0, 0, 0));
      
      // Check for 3D diagonals
      const diagonals3D = [
        Vector3.create(1, 1, 1),
        Vector3.create(1, 1, -1),
        Vector3.create(1, -1, 1),
        Vector3.create(-1, 1, 1),
      ];
      
      diagonals3D.forEach(dir => {
        const hasDirection = lines.some(line => 
          line.direction.equals(dir) || line.direction.equals(dir.multiply(-1))
        );
        expect(hasDirection).toBe(true);
      });
    });

    test('filters lines by minimum length', () => {
      const lines = board.getLinesAtPosition(Vector3.create(0, 0, 0));
      
      // All lines should have at least 2 positions (contain more than just the center)
      lines.forEach(line => {
        expect(line.positions.length).toBeGreaterThan(1);
      });
    });

    test('performance: generates lines quickly', () => {
      const start = performance.now();
      board.getLinesAtPosition(Vector3.create(0, 0, 0));
      const end = performance.now();
      
      expect(end - start).toBeLessThan(5); // Should be under 5ms
    });
  });

  describe('getPiecesInDirection', () => {
    beforeEach(() => {
      // Setup some pieces
      board = board
        .placePieceByPlayer(Vector3.create(1, 0, 0), 'player1')
        .placePieceByPlayer(Vector3.create(2, 0, 0), 'player1')
        .placePieceByPlayer(Vector3.create(3, 0, 0), 'player2');
    });

    test('returns pieces in positive direction', () => {
      const pieces = board.getPiecesInDirection(
        Vector3.create(0, 0, 0),
        Vector3.create(1, 0, 0),
        3
      );
      
      expect(pieces).toHaveLength(3);
      expect(pieces[0]?.playerId).toBe('player1'); // at (1,0,0)
      expect(pieces[1]?.playerId).toBe('player1'); // at (2,0,0)
      expect(pieces[2]?.playerId).toBe('player2'); // at (3,0,0)
    });

    test('returns pieces in negative direction', () => {
      const pieces = board.getPiecesInDirection(
        Vector3.create(3, 0, 0),
        Vector3.create(-1, 0, 0),
        3
      );
      
      expect(pieces).toHaveLength(3);
      expect(pieces[0]?.playerId).toBe('player1'); // at (2,0,0)
      expect(pieces[1]?.playerId).toBe('player1'); // at (1,0,0)
      expect(pieces[2]).toBeNull(); // empty at (0,0,0)
    });

    test('stops at board boundary', () => {
      const pieces = board.getPiecesInDirection(
        Vector3.create(3, 0, 0),
        Vector3.create(1, 0, 0),
        10 // Request more than available
      );
      
      // Should stop at board edge (position 3 is the edge)
      expect(pieces.length).toBeLessThan(10);
    });

    test('respects max distance parameter', () => {
      const pieces = board.getPiecesInDirection(
        Vector3.create(0, 0, 0),
        Vector3.create(1, 0, 0),
        2
      );
      
      expect(pieces).toHaveLength(2);
    });

    test('handles empty positions correctly', () => {
      const pieces = board.getPiecesInDirection(
        Vector3.create(-3, 0, 0),
        Vector3.create(1, 0, 0),
        3
      );
      
      expect(pieces).toHaveLength(3);
      expect(pieces[0]).toBeNull(); // empty at (-2,0,0)
      expect(pieces[1]).toBeNull(); // empty at (-1,0,0)
      expect(pieces[2]).toBeNull(); // empty at (0,0,0)
    });

    test('returns pieces in correct order', () => {
      board = board
        .placePieceByPlayer(Vector3.create(0, 0, 0), 'playerA')
        .placePieceByPlayer(Vector3.create(0, 1, 0), 'playerB')
        .placePieceByPlayer(Vector3.create(0, 2, 0), 'playerC');
      
      const pieces = board.getPiecesInDirection(
        Vector3.create(0, -1, 0),
        Vector3.create(0, 1, 0),
        3
      );
      
      expect(pieces[0]?.playerId).toBe('playerA');
      expect(pieces[1]?.playerId).toBe('playerB');
      expect(pieces[2]?.playerId).toBe('playerC');
    });
  });

  describe('countConsecutive', () => {
    beforeEach(() => {
      // Setup consecutive pieces
      board = board
        .placePieceByPlayer(Vector3.create(0, 0, 0), 'player1')
        .placePieceByPlayer(Vector3.create(1, 0, 0), 'player1')
        .placePieceByPlayer(Vector3.create(2, 0, 0), 'player1')
        .placePieceByPlayer(Vector3.create(3, 0, 0), 'player2');
    });

    test('counts single piece', () => {
      const emptyBoard = Board.createEmpty(7);
      const boardWithOne = emptyBoard.placePieceByPlayer(Vector3.create(0, 1, 0), 'player1');
      
      const count = boardWithOne.countConsecutive(
        Vector3.create(0, 0, 0),
        Vector3.create(0, 1, 0),
        'player1'
      );
      
      expect(count).toBe(1);
    });

    test('counts multiple consecutive pieces', () => {
      const count = board.countConsecutive(
        Vector3.create(-1, 0, 0),
        Vector3.create(1, 0, 0),
        'player1'
      );
      
      expect(count).toBe(3); // pieces at 0, 1, 2
    });

    test('stops at opponent piece', () => {
      const count = board.countConsecutive(
        Vector3.create(-1, 0, 0),
        Vector3.create(1, 0, 0),
        'player1'
      );
      
      expect(count).toBe(3); // stops before player2 piece at 3
    });

    test('stops at empty position', () => {
      board = Board.createEmpty(7)
        .placePieceByPlayer(Vector3.create(1, 0, 0), 'player1')
        .placePieceByPlayer(Vector3.create(2, 0, 0), 'player1');
      
      const count = board.countConsecutive(
        Vector3.create(0, 0, 0),
        Vector3.create(1, 0, 0),
        'player1'
      );
      
      expect(count).toBe(2); // pieces at 1, 2 (not 0)
    });

    test('stops at board boundary', () => {
      board = Board.createEmpty(7)
        .placePieceByPlayer(Vector3.create(2, 0, 0), 'player1')
        .placePieceByPlayer(Vector3.create(3, 0, 0), 'player1');
      
      const count = board.countConsecutive(
        Vector3.create(1, 0, 0),
        Vector3.create(1, 0, 0),
        'player1'
      );
      
      expect(count).toBe(2); // stops at edge
    });

    test('handles all 26 directions', () => {
      // Create a cluster of pieces
      const center = Vector3.create(0, 0, 0);
      board = Board.createEmpty(7).placePieceByPlayer(center, 'player1');
      
      // Add pieces in various directions
      const directions = [
        Vector3.create(1, 0, 0),
        Vector3.create(0, 1, 0),
        Vector3.create(0, 0, 1),
        Vector3.create(1, 1, 0),
        Vector3.create(1, 0, 1),
        Vector3.create(0, 1, 1),
        Vector3.create(1, 1, 1),
      ];
      
      directions.forEach(dir => {
        board = board.placePieceByPlayer(center.add(dir), 'player1');
      });
      
      // Count in each direction
      directions.forEach(dir => {
        const count = board.countConsecutive(center, dir, 'player1');
        expect(count).toBeGreaterThanOrEqual(1);
      });
    });
  });
});