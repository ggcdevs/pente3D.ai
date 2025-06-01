import { Board, Vector3, Player, Piece, Line } from '@/core';
import { DIRECTIONS_3D } from '@/types';

describe('Board', () => {
  // Test Group D: Board Construction
  describe('construction', () => {
    it('should accept valid board sizes (7, 9, 11)', () => {
      const board7 = new Board(7);
      const board9 = new Board(9);
      const board11 = new Board(11);

      expect(board7.size).toBe(7);
      expect(board9.size).toBe(9);
      expect(board11.size).toBe(11);
    });

    it('should throw error for invalid board size', () => {
      expect(() => new Board(5 as any)).toThrow('Board size must be 7, 9, or 11');
      expect(() => new Board(8 as any)).toThrow('Board size must be 7, 9, or 11');
      expect(() => new Board(13 as any)).toThrow('Board size must be 7, 9, or 11');
    });

    it('should create empty board with no pieces', () => {
      const board = new Board(7);
      expect(board.getPieceCount()).toBe(0);
      expect(board.getAllPieces()).toHaveLength(0);
    });

    it('should initialize board from pieces correctly', () => {
      const player = Player.createLocal('test', 'black');
      const pieces = [
        Piece.createNormal(new Vector3(0, 0, 0), player),
        Piece.createNormal(new Vector3(1, 1, 1), player)
      ];
      
      const board = Board.fromPieces(pieces);
      expect(board.getPieceCount()).toBe(2);
      expect(board.hasPiece(new Vector3(0, 0, 0))).toBe(true);
      expect(board.hasPiece(new Vector3(1, 1, 1))).toBe(true);
    });

    it('should use createEmpty factory method', () => {
      const board = Board.createEmpty(9);
      expect(board.size).toBe(9);
      expect(board.getPieceCount()).toBe(0);
    });

    it('should default to size 7', () => {
      const board = new Board();
      expect(board.size).toBe(7);
    });
  });

  // Test Group E: Coordinate Management
  describe('coordinates', () => {
    let board: Board;

    beforeEach(() => {
      board = new Board(7);
    });

    it('should generate consistent coordinate keys', () => {
      // Access private method through placing/getting pieces
      const player = Player.createLocal('test', 'black');
      const coord = new Vector3(1, -2, 3);
      const piece = Piece.createNormal(coord, player);
      
      const newBoard = board.placePiece(piece);
      expect(newBoard.hasPiece(coord)).toBe(true);
      
      // Same coordinate should retrieve same piece
      const retrieved = newBoard.getPiece(coord);
      expect(retrieved?.coords.equals(coord)).toBe(true);
    });

    it('should handle isInBounds for center positions', () => {
      expect(board.isInBounds(new Vector3(0, 0, 0))).toBe(true);
      expect(board.isInBounds(new Vector3(1, 1, 1))).toBe(true);
      expect(board.isInBounds(new Vector3(-1, -1, -1))).toBe(true);
    });

    it('should handle isInBounds for edge positions', () => {
      const halfSize = Math.floor(board.size / 2); // 3 for size 7
      
      // Face centers (on the boundary)
      expect(board.isInBounds(new Vector3(halfSize, 0, 0))).toBe(true);
      expect(board.isInBounds(new Vector3(-halfSize, 0, 0))).toBe(true);
      expect(board.isInBounds(new Vector3(0, halfSize, 0))).toBe(true);
      expect(board.isInBounds(new Vector3(0, -halfSize, 0))).toBe(true);
      expect(board.isInBounds(new Vector3(0, 0, halfSize))).toBe(true);
      expect(board.isInBounds(new Vector3(0, 0, -halfSize))).toBe(true);
    });

    it('should handle isInBounds for corner positions', () => {
      const halfSize = Math.floor(board.size / 2); // 3 for size 7
      
      // All 8 corners
      expect(board.isInBounds(new Vector3(halfSize, halfSize, halfSize))).toBe(true);
      expect(board.isInBounds(new Vector3(halfSize, halfSize, -halfSize))).toBe(true);
      expect(board.isInBounds(new Vector3(halfSize, -halfSize, halfSize))).toBe(true);
      expect(board.isInBounds(new Vector3(halfSize, -halfSize, -halfSize))).toBe(true);
      expect(board.isInBounds(new Vector3(-halfSize, halfSize, halfSize))).toBe(true);
      expect(board.isInBounds(new Vector3(-halfSize, halfSize, -halfSize))).toBe(true);
      expect(board.isInBounds(new Vector3(-halfSize, -halfSize, halfSize))).toBe(true);
      expect(board.isInBounds(new Vector3(-halfSize, -halfSize, -halfSize))).toBe(true);
    });

    it('should reject out-of-bounds positions', () => {
      const halfSize = Math.floor(board.size / 2); // 3 for size 7
      
      expect(board.isInBounds(new Vector3(halfSize + 1, 0, 0))).toBe(false);
      expect(board.isInBounds(new Vector3(0, halfSize + 1, 0))).toBe(false);
      expect(board.isInBounds(new Vector3(0, 0, halfSize + 1))).toBe(false);
      expect(board.isInBounds(new Vector3(-halfSize - 1, 0, 0))).toBe(false);
      expect(board.isInBounds(new Vector3(0, -halfSize - 1, 0))).toBe(false);
      expect(board.isInBounds(new Vector3(0, 0, -halfSize - 1))).toBe(false);
    });

    it('should ensure coordinate keys are unique', () => {
      const player = Player.createLocal('test', 'black');
      let newBoard = board;
      
      const coords = [
        new Vector3(0, 0, 0),
        new Vector3(1, 1, 1),
        new Vector3(-1, -1, -1),
        new Vector3(3, -2, 1)
      ];
      
      coords.forEach(coord => {
        newBoard = newBoard.placePiece(Piece.createNormal(coord, player));
      });
      
      expect(newBoard.getPieceCount()).toBe(4);
      coords.forEach(coord => {
        expect(newBoard.hasPiece(coord)).toBe(true);
      });
    });

    it('should handle negative coordinates correctly', () => {
      const player = Player.createLocal('test', 'black');
      const negCoord = new Vector3(-2, -3, -1);
      const piece = Piece.createNormal(negCoord, player);
      
      const newBoard = board.placePiece(piece);
      expect(newBoard.hasPiece(negCoord)).toBe(true);
      expect(newBoard.getPiece(negCoord)?.coords.equals(negCoord)).toBe(true);
    });

    it('should respect board size for bounds checking', () => {
      const board7 = new Board(7);
      const board9 = new Board(9);
      const board11 = new Board(11);
      
      // Position that's in bounds for 9 and 11, but not 7
      const coord = new Vector3(4, 0, 0);
      expect(board7.isInBounds(coord)).toBe(false);
      expect(board9.isInBounds(coord)).toBe(true);
      expect(board11.isInBounds(coord)).toBe(true);
      
      // Position that's in bounds only for 11
      const coord2 = new Vector3(5, 0, 0);
      expect(board7.isInBounds(coord2)).toBe(false);
      expect(board9.isInBounds(coord2)).toBe(false);
      expect(board11.isInBounds(coord2)).toBe(true);
    });
  });

  // Test Group F: Piece Management
  describe('pieces', () => {
    let board: Board;
    let player1: Player;
    let player2: Player;

    beforeEach(() => {
      board = new Board(7);
      player1 = Player.createLocal('player1', 'black');
      player2 = Player.createLocal('player2', 'white');
    });

    it('should place piece correctly', () => {
      const coord = new Vector3(1, 2, 3);
      const piece = Piece.createNormal(coord, player1);
      
      const newBoard = board.placePiece(piece);
      expect(newBoard.hasPiece(coord)).toBe(true);
      expect(newBoard.getPiece(coord)?.player.id).toBe('player1');
    });

    it('should return new board instance on placePiece', () => {
      const piece = Piece.createNormal(Vector3.zero(), player1);
      const newBoard = board.placePiece(piece);
      
      expect(newBoard).not.toBe(board);
      expect(board.hasPiece(Vector3.zero())).toBe(false);
      expect(newBoard.hasPiece(Vector3.zero())).toBe(true);
    });

    it('should throw error for out of bounds placement', () => {
      const coord = new Vector3(10, 0, 0); // Out of bounds for size 7
      const piece = Piece.createNormal(coord, player1);
      
      expect(() => board.placePiece(piece))
        .toThrow('Piece placement out of bounds');
    });

    it('should throw error for occupied position', () => {
      const coord = new Vector3(0, 0, 0);
      const piece1 = Piece.createNormal(coord, player1);
      const piece2 = Piece.createNormal(coord, player2);
      
      const newBoard = board.placePiece(piece1);
      expect(() => newBoard.placePiece(piece2))
        .toThrow('Position already occupied');
    });

    it('should remove piece correctly', () => {
      const coord = new Vector3(1, 1, 1);
      const piece = Piece.createNormal(coord, player1);
      
      const boardWithPiece = board.placePiece(piece);
      expect(boardWithPiece.hasPiece(coord)).toBe(true);
      
      const boardWithoutPiece = boardWithPiece.removePiece(coord);
      expect(boardWithoutPiece.hasPiece(coord)).toBe(false);
      expect(boardWithoutPiece).not.toBe(boardWithPiece);
    });

    it('should return same board when removing from empty position', () => {
      const coord = new Vector3(1, 1, 1);
      const result = board.removePiece(coord);
      
      expect(result).toBe(board); // Same instance
    });

    it('should retrieve correct piece with getPiece', () => {
      const coord = new Vector3(2, -1, 0);
      const piece = Piece.createNormal(coord, player2);
      
      const newBoard = board.placePiece(piece);
      const retrieved = newBoard.getPiece(coord);
      
      expect(retrieved).not.toBeNull();
      expect(retrieved?.coords.equals(coord)).toBe(true);
      expect(retrieved?.player.id).toBe('player2');
    });

    it('should return all pieces with getAllPieces', () => {
      const coords = [
        new Vector3(0, 0, 0),
        new Vector3(1, 1, 1),
        new Vector3(-1, -1, -1)
      ];
      
      let newBoard = board;
      coords.forEach((coord, i) => {
        const player = i % 2 === 0 ? player1 : player2;
        newBoard = newBoard.placePiece(Piece.createNormal(coord, player));
      });
      
      const allPieces = newBoard.getAllPieces();
      expect(allPieces).toHaveLength(3);
      
      // Verify all pieces are present
      const pieceCoords = allPieces.map(p => p.coords);
      coords.forEach(coord => {
        expect(pieceCoords.some(pc => pc.equals(coord))).toBe(true);
      });
    });
  });

  // Test Group G: Moore Neighborhood
  describe('neighbors', () => {
    it('should return 26 neighbors for center position', () => {
      const board = new Board(7);
      const neighbors = board.getNeighbors(Vector3.zero());
      
      expect(neighbors).toHaveLength(26);
      
      // Verify all neighbors are adjacent
      neighbors.forEach(neighbor => {
        const diff = neighbor.subtract(Vector3.zero());
        const isAdjacent = DIRECTIONS_3D.some(dir => 
          diff.x === dir.x && diff.y === dir.y && diff.z === dir.z
        );
        expect(isAdjacent).toBe(true);
      });
    });

    it('should return fewer neighbors for face position', () => {
      const board = new Board(7);
      const facePos = new Vector3(3, 0, 0); // On +X face
      const neighbors = board.getNeighbors(facePos);
      
      expect(neighbors.length).toBeLessThan(26);
      expect(neighbors.length).toBe(17); // 26 - 9 (3x3 grid beyond face)
    });

    it('should return fewer neighbors for edge position', () => {
      const board = new Board(7);
      const edgePos = new Vector3(3, 3, 0); // On +X+Y edge
      const neighbors = board.getNeighbors(edgePos);
      
      expect(neighbors.length).toBeLessThan(17);
      expect(neighbors.length).toBe(11); // Corner of a face
    });

    it('should return 7 neighbors for corner position', () => {
      const board = new Board(7);
      const cornerPos = new Vector3(3, 3, 3); // Corner
      const neighbors = board.getNeighbors(cornerPos);
      
      expect(neighbors).toHaveLength(7); // Only inward-facing octant
    });

    it('should return unique neighbors', () => {
      const board = new Board(7);
      const neighbors = board.getNeighbors(new Vector3(1, 1, 1));
      
      const uniqueCoords = new Set(neighbors.map(n => `${n.x},${n.y},${n.z}`));
      expect(uniqueCoords.size).toBe(neighbors.length);
    });

    it('should return all adjacent neighbors', () => {
      const board = new Board(7);
      const center = new Vector3(1, 1, 1);
      const neighbors = board.getNeighbors(center);
      
      neighbors.forEach(neighbor => {
        const diff = neighbor.subtract(center);
        const distance = Math.max(Math.abs(diff.x), Math.abs(diff.y), Math.abs(diff.z));
        expect(distance).toBe(1); // All neighbors are exactly 1 unit away
      });
    });

    it('should handle size 7 board neighbor counts correctly', () => {
      const board = new Board(7);
      
      // Test various positions
      expect(board.getNeighbors(new Vector3(0, 0, 0))).toHaveLength(26); // Center
      expect(board.getNeighbors(new Vector3(3, 0, 0))).toHaveLength(17); // Face
      expect(board.getNeighbors(new Vector3(-3, -3, -3))).toHaveLength(7); // Corner
    });

    it('should handle size 11 board neighbor counts correctly', () => {
      const board = new Board(11);
      
      // Test various positions
      expect(board.getNeighbors(new Vector3(0, 0, 0))).toHaveLength(26); // Center
      expect(board.getNeighbors(new Vector3(5, 0, 0))).toHaveLength(17); // Face
      expect(board.getNeighbors(new Vector3(5, 5, 5))).toHaveLength(7); // Corner
      // Position (4,4,0) is actually not on boundary, so has all 26 neighbors
      expect(board.getNeighbors(new Vector3(4, 4, 0))).toHaveLength(26);
    });
  });

  // Test Group H: Line Generation - Full Lines
  describe('generateFullLine', () => {
    let board: Board;

    beforeEach(() => {
      board = new Board(7);
    });

    it('should generate face-to-face line (straight)', () => {
      const start = new Vector3(-3, 0, 0);
      const end = new Vector3(3, 0, 0);
      const line = board.generateFullLine(start, end);

      expect(line).not.toBeNull();
      expect(line!.coords).toHaveLength(7);
      expect(line!.getStart().equals(start)).toBe(true);
      expect(line!.getEnd().equals(end)).toBe(true);
      expect(line!.direction.equals(new Vector3(1, 0, 0))).toBe(true);
    });

    it('should generate edge-to-edge line (2D diagonal)', () => {
      const start = new Vector3(-3, -3, 0);
      const end = new Vector3(3, 3, 0);
      const line = board.generateFullLine(start, end);

      expect(line).not.toBeNull();
      expect(line!.coords).toHaveLength(7);
      expect(line!.direction.equals(new Vector3(1, 1, 0))).toBe(true);
    });

    it('should generate corner-to-corner line (3D diagonal)', () => {
      const start = new Vector3(-3, -3, -3);
      const end = new Vector3(3, 3, 3);
      const line = board.generateFullLine(start, end);

      expect(line).not.toBeNull();
      expect(line!.coords).toHaveLength(7);
      expect(line!.direction.equals(new Vector3(1, 1, 1))).toBe(true);
    });

    it('should return null for non-collinear points', () => {
      const start = new Vector3(0, 0, 0);
      const end = new Vector3(1, 2, 3); // Not a valid direction
      const line = board.generateFullLine(start, end);

      expect(line).toBeNull();
    });

    it('should return null for out-of-bounds start', () => {
      const start = new Vector3(-4, 0, 0); // Out of bounds
      const end = new Vector3(3, 0, 0);
      const line = board.generateFullLine(start, end);

      expect(line).toBeNull();
    });

    it('should return null for out-of-bounds end', () => {
      const start = new Vector3(-3, 0, 0);
      const end = new Vector3(4, 0, 0); // Out of bounds
      const line = board.generateFullLine(start, end);

      expect(line).toBeNull();
    });

    it('should handle same start and end with single point', () => {
      const point = new Vector3(0, 0, 0);
      const line = board.generateFullLine(point, point);

      expect(line).not.toBeNull();
      expect(line!.coords).toHaveLength(1);
      expect(line!.coords[0].equals(point)).toBe(true);
    });

    it('should create same line regardless of direction', () => {
      const start = new Vector3(-2, -2, -2);
      const end = new Vector3(2, 2, 2);
      
      const line1 = board.generateFullLine(start, end);
      const line2 = board.generateFullLine(end, start);

      expect(line1).not.toBeNull();
      expect(line2).not.toBeNull();
      
      // Same points, potentially different order
      const coords1 = line1!.coords.map(c => c.toString()).sort();
      const coords2 = line2!.coords.map(c => c.toString()).sort();
      expect(coords1).toEqual(coords2);
    });

    it('should work for all 26 directions', () => {
      const center = new Vector3(0, 0, 0);
      let validLines = 0;

      DIRECTIONS_3D.forEach(dir => {
        const dirVec = Vector3.fromObject(dir);
        const end = center.add(dirVec.multiply(2));
        if (board.isInBounds(end)) {
          const line = board.generateFullLine(center, end);
          if (line) validLines++;
        }
      });

      expect(validLines).toBe(26); // All directions should work from center
    });

    it('should complete in less than 1ms', () => {
      const start = new Vector3(-3, -3, -3);
      const end = new Vector3(3, 3, 3);
      
      const startTime = performance.now();
      const line = board.generateFullLine(start, end);
      const endTime = performance.now();

      expect(line).not.toBeNull();
      expect(endTime - startTime).toBeLessThan(1);
    });
  });

  // Test Group I: Line Generation - Partial Lines
  describe('generatePartialLine', () => {
    let board: Board;

    beforeEach(() => {
      board = new Board(7);
    });

    it('should create 5-point line with radius 2 at center', () => {
      const center = new Vector3(0, 0, 0);
      const direction = new Vector3(1, 0, 0);
      const line = board.generatePartialLine(center, direction, 2);

      expect(line.coords).toHaveLength(5);
      expect(line.contains(new Vector3(-2, 0, 0))).toBe(true);
      expect(line.contains(new Vector3(-1, 0, 0))).toBe(true);
      expect(line.contains(new Vector3(0, 0, 0))).toBe(true);
      expect(line.contains(new Vector3(1, 0, 0))).toBe(true);
      expect(line.contains(new Vector3(2, 0, 0))).toBe(true);
    });

    it('should create 3-point line with radius 1', () => {
      const center = new Vector3(0, 0, 0);
      const direction = new Vector3(0, 1, 0);
      const line = board.generatePartialLine(center, direction, 1);

      expect(line.coords).toHaveLength(3);
      expect(line.contains(new Vector3(0, -1, 0))).toBe(true);
      expect(line.contains(new Vector3(0, 0, 0))).toBe(true);
      expect(line.contains(new Vector3(0, 1, 0))).toBe(true);
    });

    it('should truncate line correctly at edge position', () => {
      const center = new Vector3(3, 0, 0); // On +X face
      const direction = new Vector3(1, 0, 0);
      const line = board.generatePartialLine(center, direction, 2);

      // Should only include points within bounds
      expect(line.coords.length).toBeLessThan(5);
      expect(line.contains(new Vector3(3, 0, 0))).toBe(true);
      expect(line.contains(new Vector3(2, 0, 0))).toBe(true);
      expect(line.contains(new Vector3(1, 0, 0))).toBe(true);
    });

    it('should truncate line correctly at corner position', () => {
      const corner = new Vector3(3, 3, 3);
      const direction = new Vector3(1, 1, 1);
      const line = board.generatePartialLine(corner, direction, 2);

      // Should include corner and two positions going inward
      expect(line.coords).toHaveLength(3);
      expect(line.contains(corner)).toBe(true);
      expect(line.contains(new Vector3(2, 2, 2))).toBe(true);
      expect(line.contains(new Vector3(1, 1, 1))).toBe(true);
    });

    it('should normalize direction correctly', () => {
      const center = new Vector3(0, 0, 0);
      const scaledDirection = new Vector3(2, 4, 6);
      const line = board.generatePartialLine(center, scaledDirection, 1);

      // Should normalize by dividing by max component (6), giving (0, 1, 1)
      // Actually, Math.round(2/6)=0, Math.round(4/6)=1, Math.round(6/6)=1
      expect(line.direction.equals(new Vector3(0, 1, 1))).toBe(true);
    });

    it('should support all 26 directions', () => {
      const center = new Vector3(0, 0, 0);
      
      DIRECTIONS_3D.forEach(dir => {
        const line = board.generatePartialLine(center, dir, 1);
        expect(line.coords.length).toBeGreaterThanOrEqual(3);
        expect(line.contains(center)).toBe(true);
      });
    });

    it('should create single point with zero radius', () => {
      const center = new Vector3(1, 1, 1);
      const direction = new Vector3(1, 0, 0);
      const line = board.generatePartialLine(center, direction, 0);

      expect(line.coords).toHaveLength(1);
      expect(line.coords[0].equals(center)).toBe(true);
    });

    it('should cap large radius by board bounds', () => {
      const center = new Vector3(0, 0, 0);
      const direction = new Vector3(1, 0, 0);
      const line = board.generatePartialLine(center, direction, 10); // Larger than board

      // Should be capped to board size
      expect(line.coords).toHaveLength(7); // Full width of size 7 board
      expect(line.contains(new Vector3(-3, 0, 0))).toBe(true);
      expect(line.contains(new Vector3(3, 0, 0))).toBe(true);
    });
  });

  // Test Group J: Lines Containing Position
  describe('getLinesContaining', () => {
    let board: Board;

    beforeEach(() => {
      board = new Board(7);
    });

    it('should find maximum lines at center position', () => {
      const lines = board.getLinesContaining(Vector3.zero());
      
      // Center position should have the maximum number of 5-lines
      expect(lines.length).toBeGreaterThan(50);
      
      // All lines should contain the center
      lines.forEach(line => {
        expect(line.contains(Vector3.zero())).toBe(true);
      });
    });

    it('should find fewer lines at edge position', () => {
      const edgePos = new Vector3(3, 0, 0); // On face
      const centerLines = board.getLinesContaining(Vector3.zero());
      const edgeLines = board.getLinesContaining(edgePos);

      expect(edgeLines.length).toBeLessThan(centerLines.length);
      
      // All lines should contain the edge position
      edgeLines.forEach(line => {
        expect(line.contains(edgePos)).toBe(true);
      });
    });

    it('should find minimum lines at corner position', () => {
      const cornerPos = new Vector3(3, 3, 3);
      const lines = board.getLinesContaining(cornerPos);

      // Corner has fewer lines than center, but still has several
      expect(lines.length).toBeLessThan(20);
      expect(lines.length).toBeGreaterThan(10);
      
      // All lines should contain the corner
      lines.forEach(line => {
        expect(line.contains(cornerPos)).toBe(true);
      });
    });

    it('should ensure all returned lines contain the position', () => {
      const pos = new Vector3(1, -1, 2);
      const lines = board.getLinesContaining(pos);

      lines.forEach(line => {
        expect(line.contains(pos)).toBe(true);
      });
    });

    it('should ensure all lines have requested length', () => {
      const pos = new Vector3(0, 0, 0);
      const length = 5;
      const lines = board.getLinesContaining(pos, length);

      lines.forEach(line => {
        expect(line.getLength()).toBe(length);
      });
    });

    it('should return no duplicate lines', () => {
      const pos = new Vector3(0, 0, 0);
      const lines = board.getLinesContaining(pos);

      // Check for duplicates by comparing start/end pairs
      const lineKeys = lines.map(line => 
        `${line.getStart().toString()}-${line.getEnd().toString()}`
      );
      const uniqueKeys = new Set(lineKeys);

      expect(uniqueKeys.size).toBe(lines.length);
    });

    it('should scale performance with board size', () => {
      const board7 = new Board(7);
      const board11 = new Board(11);
      
      const lines7 = board7.getLinesContaining(Vector3.zero());
      const lines11 = board11.getLinesContaining(Vector3.zero());

      // Larger board should have more possible lines
      expect(lines11.length).toBeGreaterThan(lines7.length);
    });

    it('should work with custom length parameter', () => {
      const pos = new Vector3(0, 0, 0);
      const lines3 = board.getLinesContaining(pos, 3);
      const lines5 = board.getLinesContaining(pos, 5);

      // Should have more 3-lines than or equal to 5-lines
      expect(lines3.length).toBeGreaterThanOrEqual(lines5.length);
      
      // Verify lengths
      lines3.forEach(line => expect(line.getLength()).toBe(3));
      lines5.forEach(line => expect(line.getLength()).toBe(5));
    });
  });

  // Additional Board utility tests
  describe('utilities', () => {
    it('should clear board correctly', () => {
      const player = Player.createLocal('test', 'black');
      let board = Board.createEmpty(7);
      
      // Add some pieces
      board = board.placePiece(Piece.createNormal(new Vector3(0, 0, 0), player));
      board = board.placePiece(Piece.createNormal(new Vector3(1, 1, 1), player));
      expect(board.getPieceCount()).toBe(2);

      // Clear the board
      const cleared = board.clear();
      expect(cleared.getPieceCount()).toBe(0);
      expect(cleared.size).toBe(7); // Size preserved
    });

    it('should check board equality correctly', () => {
      const player = Player.createLocal('test', 'black');
      const board1 = Board.createEmpty(7);
      const board2 = Board.createEmpty(7);

      // Empty boards are equal
      expect(board1.equals(board2)).toBe(true);

      // Add same piece to both
      const piece = Piece.createNormal(new Vector3(0, 0, 0), player);
      const board1WithPiece = board1.placePiece(piece);
      const board2WithPiece = board2.placePiece(piece);
      expect(board1WithPiece.equals(board2WithPiece)).toBe(true);

      // Different pieces
      const board1Different = board1.placePiece(
        Piece.createNormal(new Vector3(1, 1, 1), player)
      );
      expect(board1WithPiece.equals(board1Different)).toBe(false);

      // Different sizes
      const board3 = Board.createEmpty(9);
      expect(board1.equals(board3)).toBe(false);
    });

    it('should clone board correctly', () => {
      const player = Player.createLocal('test', 'black');
      let board = Board.createEmpty(7);
      
      // Add pieces
      board = board.placePiece(Piece.createNormal(new Vector3(0, 0, 0), player));
      board = board.placePiece(Piece.createNormal(new Vector3(1, 1, 1), player));

      const cloned = board.clone();
      
      // Should be equal but not same instance
      expect(cloned).not.toBe(board);
      expect(cloned.equals(board)).toBe(true);
      expect(cloned.getPieceCount()).toBe(2);
    });

    it('should have readable toString format', () => {
      const board = new Board(9);
      expect(board.toString()).toBe('Board(9x9x9, 0 pieces)');

      const player = Player.createLocal('test', 'black');
      const withPiece = board.placePiece(Piece.createNormal(Vector3.zero(), player));
      expect(withPiece.toString()).toBe('Board(9x9x9, 1 pieces)');
    });

    it('should serialize to JSON correctly', () => {
      const player = Player.createLocal('test', 'black');
      let board = Board.createEmpty(7);
      board = board.placePiece(Piece.createNormal(new Vector3(1, 2, 3), player));

      const json = board.toJSON();
      expect(json.size).toBe(7);
      expect(json.pieces).toBeInstanceOf(Map);
      expect(json.pieces.size).toBe(1);
      expect(json.pieces.has('1,2,3')).toBe(true);
    });
  });

  // Edge cases and stress tests
  describe('edge cases', () => {
    it('should handle maximum board size (11x11x11)', () => {
      const board = new Board(11);
      const maxCoord = 5; // floor(11/2)
      
      // Test all corners are accessible
      const corners = [
        new Vector3(maxCoord, maxCoord, maxCoord),
        new Vector3(-maxCoord, -maxCoord, -maxCoord),
        new Vector3(maxCoord, -maxCoord, maxCoord)
      ];
      
      corners.forEach(corner => {
        expect(board.isInBounds(corner)).toBe(true);
      });
    });

    it('should handle minimum board size (7x7x7)', () => {
      const board = new Board(7);
      const maxCoord = 3; // floor(7/2)
      
      // Verify bounds
      expect(board.isInBounds(new Vector3(maxCoord, 0, 0))).toBe(true);
      expect(board.isInBounds(new Vector3(maxCoord + 1, 0, 0))).toBe(false);
    });

    it('should handle all corner positions accessible', () => {
      const board = new Board(9);
      const max = 4;
      
      // All 8 corners
      for (let x of [-max, max]) {
        for (let y of [-max, max]) {
          for (let z of [-max, max]) {
            const corner = new Vector3(x, y, z);
            expect(board.isInBounds(corner)).toBe(true);
            expect(board.getNeighbors(corner)).toHaveLength(7);
          }
        }
      }
    });

    it('should handle all face centers accessible', () => {
      const board = new Board(7);
      const max = 3;
      
      const faceCenters = [
        new Vector3(max, 0, 0), new Vector3(-max, 0, 0),
        new Vector3(0, max, 0), new Vector3(0, -max, 0),
        new Vector3(0, 0, max), new Vector3(0, 0, -max)
      ];
      
      faceCenters.forEach(center => {
        expect(board.isInBounds(center)).toBe(true);
        expect(board.getNeighbors(center)).toHaveLength(17);
      });
    });

    it('should handle lines at board boundaries', () => {
      const board = new Board(7);
      
      // Line along an edge
      const edgeLine = board.generateFullLine(
        new Vector3(-3, -3, 0),
        new Vector3(3, -3, 0)
      );
      expect(edgeLine).not.toBeNull();
      expect(edgeLine!.coords).toHaveLength(7);
      
      // Line along a face diagonal
      const faceLine = board.generateFullLine(
        new Vector3(-3, -3, 3),
        new Vector3(3, 3, 3)
      );
      expect(faceLine).not.toBeNull();
      expect(faceLine!.coords).toHaveLength(7);
    });

    it('should handle concurrent modifications safely', () => {
      const player1 = Player.createLocal('p1', 'black');
      const player2 = Player.createLocal('p2', 'white');
      const board = Board.createEmpty(7);
      
      // Multiple immutable operations
      const board1 = board.placePiece(Piece.createNormal(new Vector3(0, 0, 0), player1));
      const board2 = board.placePiece(Piece.createNormal(new Vector3(1, 1, 1), player2));
      
      // Original board unchanged
      expect(board.getPieceCount()).toBe(0);
      expect(board1.getPieceCount()).toBe(1);
      expect(board2.getPieceCount()).toBe(1);
      
      // Boards are independent
      expect(board1.hasPiece(new Vector3(0, 0, 0))).toBe(true);
      expect(board1.hasPiece(new Vector3(1, 1, 1))).toBe(false);
      expect(board2.hasPiece(new Vector3(0, 0, 0))).toBe(false);
      expect(board2.hasPiece(new Vector3(1, 1, 1))).toBe(true);
    });
  });
});