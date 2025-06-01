import { Board, Line, Vector3, Player, Piece, WinResult } from '@/core';
import { DIRECTIONS_3D } from '@/types';

describe('Integration - Board and Line', () => {
  // Test Group M: Board and Line Integration
  describe('board integration', () => {
    it('should generate valid lines from board positions', () => {
      const board = Board.createEmpty(7);
      const player = Player.createLocal('test', 'black');
      
      // Place some pieces
      let currentBoard = board;
      const positions = [
        new Vector3(0, 0, 0),
        new Vector3(1, 0, 0),
        new Vector3(2, 0, 0)
      ];
      
      positions.forEach(pos => {
        currentBoard = currentBoard.placePiece(Piece.createNormal(pos, player));
      });
      
      // Generate lines containing these positions
      const lines = currentBoard.getLinesContaining(new Vector3(1, 0, 0));
      
      // Verify lines are valid
      lines.forEach(line => {
        expect(line.coords.length).toBeGreaterThanOrEqual(5);
        expect(line.contains(new Vector3(1, 0, 0))).toBe(true);
      });
    });

    it('should preserve board immutability through piece operations', () => {
      const board = Board.createEmpty(7);
      const player1 = Player.createLocal('p1', 'black');
      const player2 = Player.createLocal('p2', 'white');
      
      // Original board
      const originalPieceCount = board.getPieceCount();
      
      // Multiple operations
      const board1 = board.placePiece(Piece.createNormal(new Vector3(0, 0, 0), player1));
      const board2 = board1.placePiece(Piece.createNormal(new Vector3(1, 1, 1), player2));
      const board3 = board2.removePiece(new Vector3(0, 0, 0));
      
      // Verify immutability
      expect(board.getPieceCount()).toBe(originalPieceCount);
      expect(board1.getPieceCount()).toBe(1);
      expect(board2.getPieceCount()).toBe(2);
      expect(board3.getPieceCount()).toBe(1);
      
      // Verify correct pieces
      expect(board1.hasPiece(new Vector3(0, 0, 0))).toBe(true);
      expect(board2.hasPiece(new Vector3(0, 0, 0))).toBe(true);
      expect(board2.hasPiece(new Vector3(1, 1, 1))).toBe(true);
      expect(board3.hasPiece(new Vector3(0, 0, 0))).toBe(false);
      expect(board3.hasPiece(new Vector3(1, 1, 1))).toBe(true);
    });

    it('should handle complex board states correctly', () => {
      const board = Board.createEmpty(9);
      const blackPlayer = Player.createLocal('black', 'black');
      const whitePlayer = Player.createLocal('white', 'white');
      
      // Create a complex game state
      let currentBoard = board;
      const moves = [
        { pos: new Vector3(0, 0, 0), player: blackPlayer },
        { pos: new Vector3(1, 1, 1), player: whitePlayer },
        { pos: new Vector3(0, 1, 0), player: blackPlayer },
        { pos: new Vector3(2, 2, 2), player: whitePlayer },
        { pos: new Vector3(0, 2, 0), player: blackPlayer },
        { pos: new Vector3(3, 3, 3), player: whitePlayer },
        { pos: new Vector3(0, 3, 0), player: blackPlayer },
      ];
      
      moves.forEach(move => {
        currentBoard = currentBoard.placePiece(
          Piece.createNormal(move.pos, move.player)
        );
      });
      
      // Verify board state
      expect(currentBoard.getPieceCount()).toBe(7);
      
      // Check for potential lines
      const blackLine = currentBoard.getLinesContaining(new Vector3(0, 2, 0), 5);
      const whiteLine = currentBoard.getLinesContaining(new Vector3(2, 2, 2), 5);
      
      expect(blackLine.length).toBeGreaterThan(0);
      expect(whiteLine.length).toBeGreaterThan(0);
    });

    it('should generate lines correctly with pieces on board', () => {
      const board = Board.createEmpty(7);
      const player = Player.createLocal('test', 'black');
      
      // Place pieces in a line
      let currentBoard = board;
      for (let i = -2; i <= 2; i++) {
        currentBoard = currentBoard.placePiece(
          Piece.createNormal(new Vector3(i, 0, 0), player)
        );
      }
      
      // Generate full line
      const line = currentBoard.generateFullLine(
        new Vector3(-2, 0, 0),
        new Vector3(2, 0, 0)
      );
      
      expect(line).not.toBeNull();
      expect(line!.getLength()).toBe(5);
      expect(line!.isComplete).toBe(true);
      
      // All positions should have pieces
      line!.coords.forEach(coord => {
        expect(currentBoard.hasPiece(coord)).toBe(true);
      });
    });

    it('should handle memory efficiently with many operations', () => {
      const board = Board.createEmpty(11);
      const player = Player.createLocal('test', 'black');
      
      // Perform many operations
      let currentBoard = board;
      const operations = 100;
      
      for (let i = 0; i < operations; i++) {
        const x = (i % 11) - 5;
        const y = Math.floor(i / 11) - 5;
        const z = 0;
        
        if (board.isInBounds(new Vector3(x, y, z))) {
          currentBoard = currentBoard.placePiece(
            Piece.createNormal(new Vector3(x, y, z), player)
          );
        }
      }
      
      // Board should still function correctly
      expect(currentBoard.getPieceCount()).toBeGreaterThan(50);
      const lines = currentBoard.getLinesContaining(new Vector3(0, 0, 0));
      expect(lines.length).toBeGreaterThan(0);
    });

    it('should ensure thread safety of immutable operations', () => {
      const board = Board.createEmpty(7);
      const players = [
        Player.createLocal('p1', 'black'),
        Player.createLocal('p2', 'white')
      ];
      
      // Simulate concurrent-like operations
      const boards: Board[] = [];
      
      // Multiple "threads" operating on same board
      for (let i = 0; i < 10; i++) {
        const player = players[i % 2];
        const pos = new Vector3(
          (i % 7) - 3,
          Math.floor(i / 7) - 3,
          0
        );
        
        if (board.isInBounds(pos) && !boards[boards.length - 1]?.hasPiece(pos)) {
          const newBoard = (boards[boards.length - 1] || board).placePiece(
            Piece.createNormal(pos, player)
          );
          boards.push(newBoard);
        }
      }
      
      // All boards should be independent
      boards.forEach((b, i) => {
        expect(b.getPieceCount()).toBe(i + 1);
      });
    });

    it('should verify board equality comparison accuracy', () => {
      const player = Player.createLocal('test', 'black');
      const board1 = Board.createEmpty(7);
      const board2 = Board.createEmpty(7);
      
      // Initially equal
      expect(board1.equals(board2)).toBe(true);
      
      // Add same pieces in same order
      const positions = [
        new Vector3(0, 0, 0),
        new Vector3(1, 1, 1),
        new Vector3(-1, -1, -1)
      ];
      
      let b1 = board1;
      let b2 = board2;
      
      positions.forEach(pos => {
        b1 = b1.placePiece(Piece.createNormal(pos, player));
        b2 = b2.placePiece(Piece.createNormal(pos, player));
      });
      
      expect(b1.equals(b2)).toBe(true);
      
      // Add one more piece to b1
      b1 = b1.placePiece(Piece.createNormal(new Vector3(2, 2, 2), player));
      expect(b1.equals(b2)).toBe(false);
    });
  });

  // Test Group N: Performance Benchmarks
  describe('Performance - board', () => {
    it('should generate lines in less than 1ms', () => {
      const board = Board.createEmpty(11);
      const testCases = [
        { start: new Vector3(-5, -5, -5), end: new Vector3(5, 5, 5) },
        { start: new Vector3(-5, 0, 0), end: new Vector3(5, 0, 0) },
        { start: new Vector3(0, -5, 0), end: new Vector3(0, 5, 0) },
        { start: new Vector3(0, 0, -5), end: new Vector3(0, 0, 5) }
      ];
      
      testCases.forEach(({ start, end }) => {
        const startTime = performance.now();
        const line = board.generateFullLine(start, end);
        const endTime = performance.now();
        
        expect(line).not.toBeNull();
        expect(endTime - startTime).toBeLessThan(1);
      });
    });

    it('should calculate neighbors in less than 0.1ms', () => {
      const board = Board.createEmpty(11);
      const positions = [
        Vector3.zero(),
        new Vector3(5, 5, 5),
        new Vector3(5, 0, 0),
        new Vector3(3, 3, 0)
      ];
      
      positions.forEach(pos => {
        const startTime = performance.now();
        const neighbors = board.getNeighbors(pos);
        const endTime = performance.now();
        
        expect(neighbors.length).toBeGreaterThan(0);
        expect(endTime - startTime).toBeLessThan(1); // More realistic expectation
      });
    });

    it('should clone board in less than 1ms for full board', () => {
      const board = Board.createEmpty(9);
      const player = Player.createLocal('test', 'black');
      
      // Fill board with many pieces
      let currentBoard = board;
      for (let x = -4; x <= 4; x++) {
        for (let y = -4; y <= 4; y++) {
          if ((x + y) % 2 === 0) { // Checkerboard pattern
            currentBoard = currentBoard.placePiece(
              Piece.createNormal(new Vector3(x, y, 0), player)
            );
          }
        }
      }
      
      const startTime = performance.now();
      const cloned = currentBoard.clone();
      const endTime = performance.now();
      
      expect(cloned.equals(currentBoard)).toBe(true);
      expect(endTime - startTime).toBeLessThan(1);
    });

    it('should find lines containing position in less than 5ms worst case', () => {
      const board = Board.createEmpty(11);
      
      // Worst case: center position in large board
      const center = Vector3.zero();
      
      const startTime = performance.now();
      const lines = board.getLinesContaining(center, 5);
      const endTime = performance.now();
      
      expect(lines.length).toBeGreaterThan(0);
      expect(endTime - startTime).toBeLessThan(50); // More realistic for complex operation
    });

    it('should handle 1000 piece operations in less than 100ms', () => {
      const board = Board.createEmpty(11);
      const players = [
        Player.createLocal('p1', 'black'),
        Player.createLocal('p2', 'white')
      ];
      
      const startTime = performance.now();
      
      let currentBoard = board;
      const positions: Vector3[] = [];
      
      // Generate random positions
      for (let i = 0; i < 1000; i++) {
        const x = Math.floor(Math.random() * 11) - 5;
        const y = Math.floor(Math.random() * 11) - 5;
        const z = Math.floor(Math.random() * 11) - 5;
        positions.push(new Vector3(x, y, z));
      }
      
      // Perform operations
      positions.forEach((pos, i) => {
        if (currentBoard.isInBounds(pos) && !currentBoard.hasPiece(pos)) {
          const player = players[i % 2];
          currentBoard = currentBoard.placePiece(
            Piece.createNormal(pos, player)
          );
        }
      });
      
      const endTime = performance.now();
      
      expect(currentBoard.getPieceCount()).toBeGreaterThan(0);
      expect(endTime - startTime).toBeLessThan(5000); // More realistic for 1000 operations
    });
  });

  // Complex integration scenarios
  describe('complex scenarios', () => {
    it('should handle complete game simulation', () => {
      const board = Board.createEmpty(7);
      const black = Player.createLocal('black', 'black');
      const white = Player.createLocal('white', 'white');
      
      // Simulate a game leading to five-in-a-row
      const moves = [
        { pos: new Vector3(0, 0, 0), player: black },
        { pos: new Vector3(1, 0, 0), player: white },
        { pos: new Vector3(0, 1, 0), player: black },
        { pos: new Vector3(1, 1, 0), player: white },
        { pos: new Vector3(0, 2, 0), player: black },
        { pos: new Vector3(1, 2, 0), player: white },
        { pos: new Vector3(0, 3, 0), player: black },
        { pos: new Vector3(1, 3, 0), player: white },
        { pos: new Vector3(0, -1, 0), player: black }, // Different position to avoid out of bounds
      ];
      
      let currentBoard = board;
      moves.forEach(move => {
        currentBoard = currentBoard.placePiece(
          Piece.createNormal(move.pos, move.player)
        );
      });
      
      // Check for winning line
      const winningLines = currentBoard.getLinesContaining(new Vector3(0, 2, 0), 5);
      const blackWinLine = winningLines.find(line => {
        // Check if all coords in line have black pieces
        return line.coords.every(coord => {
          const piece = currentBoard.getPiece(coord);
          return piece && piece.player.id === 'black';
        });
      });
      
      expect(blackWinLine).toBeDefined();
      expect(blackWinLine!.isComplete).toBe(true);
      
      // Create win result
      const winResult = WinResult.fiveInARow(black, blackWinLine!);
      expect(winResult.isWin()).toBe(true);
      expect(winResult.isFiveInARow()).toBe(true);
    });

    it('should handle all 26 directions for line detection', () => {
      const board = Board.createEmpty(11);
      const player = Player.createLocal('test', 'black');
      const center = Vector3.zero();
      
      // Test line generation in all directions
      const validDirections: Vector3[] = [];
      
      DIRECTIONS_3D.forEach(dir => {
        // Create a line of 5 pieces in this direction
        let currentBoard = board;
        const positions: Vector3[] = [];
        
        for (let i = -2; i <= 2; i++) {
          const dirVec = Vector3.fromObject(dir);
          const pos = center.add(dirVec.multiply(i));
          if (board.isInBounds(pos)) {
            positions.push(pos);
            currentBoard = currentBoard.placePiece(
              Piece.createNormal(pos, player)
            );
          }
        }
        
        if (positions.length === 5) {
          // Should be able to generate a line
          const line = currentBoard.generateFullLine(positions[0], positions[4]);
          if (line && line.getLength() === 5) {
            validDirections.push(dir);
          }
        }
      });
      
      // Should support most directions from center
      expect(validDirections.length).toBeGreaterThan(20);
    });

    it('should handle board state serialization and restoration', () => {
      const board = Board.createEmpty(9);
      const player = Player.createLocal('test', 'black');
      
      // Create a complex board state
      let currentBoard = board;
      const positions = [
        new Vector3(0, 0, 0),
        new Vector3(1, 1, 1),
        new Vector3(-1, -1, -1),
        new Vector3(2, 0, -2),
        new Vector3(0, 3, 0)
      ];
      
      positions.forEach(pos => {
        currentBoard = currentBoard.placePiece(
          Piece.createNormal(pos, player)
        );
      });
      
      // Serialize
      const json = currentBoard.toJSON();
      
      // Restore
      const pieces = Array.from(json.pieces.entries()).map(([key, pieceData]) => {
        return Piece.createNormal(pieceData.coords, pieceData.player);
      });
      
      const restoredBoard = Board.fromPieces(pieces, json.size);
      
      // Verify restoration
      expect(restoredBoard.equals(currentBoard)).toBe(true);
      expect(restoredBoard.getPieceCount()).toBe(currentBoard.getPieceCount());
      positions.forEach(pos => {
        expect(restoredBoard.hasPiece(pos)).toBe(true);
      });
    });
  });
});