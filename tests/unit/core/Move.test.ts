import { Move, Vector3, Player } from '@/core';

describe('Move', () => {
  let testCoords: Vector3;
  let testPlayer: Player;
  let capturedPieces: Vector3[];

  beforeEach(() => {
    testCoords = new Vector3(5, 5, 5);
    testPlayer = Player.createLocal('player1', 'black');
    capturedPieces = [
      new Vector3(4, 5, 5),
      new Vector3(3, 5, 5),
      new Vector3(6, 5, 5),
      new Vector3(7, 5, 5)
    ];
  });

  describe('constructor', () => {
    it('creates valid simple move', () => {
      const move = new Move(testCoords, testPlayer);
      expect(move.coords.equals(testCoords)).toBe(true);
      expect(move.player.equals(testPlayer)).toBe(true);
      expect(move.capturedPieces).toHaveLength(0);
      expect(move.timestamp).toBeLessThanOrEqual(Date.now());
      expect(move.timestamp).toBeGreaterThan(Date.now() - 1000);
    });

    it('creates valid capture move', () => {
      const move = new Move(testCoords, testPlayer, capturedPieces);
      expect(move.capturedPieces).toHaveLength(4);
      expect(move.capturedPieces[0].equals(capturedPieces[0])).toBe(true);
    });

    it('accepts IVector3 and IPlayer interfaces', () => {
      const move = new Move(
        { x: 1, y: 2, z: 3 },
        { id: 'p1', color: 'white', isLocal: true, captures: 0 }
      );
      expect(move.coords.x).toBe(1);
      expect(move.player.id).toBe('p1');
    });

    it('throws error for missing coordinates', () => {
      expect(() => new Move(null as any, testPlayer)).toThrow('Move coordinates are required');
    });

    it('throws error for missing player', () => {
      expect(() => new Move(testCoords, null as any)).toThrow('Move player is required');
    });

    it('throws error for odd number of captured pieces', () => {
      const oddCaptures = [new Vector3(1, 1, 1)];
      expect(() => new Move(testCoords, testPlayer, oddCaptures))
        .toThrow('Captured pieces must be in pairs');
    });

    it('accepts custom timestamp', () => {
      const customTime = Date.now() - 5000;
      const move = new Move(testCoords, testPlayer, [], customTime);
      expect(move.timestamp).toBe(customTime);
    });
  });

  describe('factory methods', () => {
    it('createSimple creates move without captures', () => {
      const move = Move.createSimple(testCoords, testPlayer);
      expect(move.capturedPieces).toHaveLength(0);
      expect(move.isCapture()).toBe(false);
    });

    it('createCapture creates move with captures', () => {
      const move = Move.createCapture(testCoords, testPlayer, capturedPieces);
      expect(move.capturedPieces).toHaveLength(4);
      expect(move.isCapture()).toBe(true);
    });
  });

  describe('utility methods', () => {
    let simpleMove: Move;
    let captureMove: Move;

    beforeEach(() => {
      simpleMove = Move.createSimple(testCoords, testPlayer);
      captureMove = Move.createCapture(testCoords, testPlayer, capturedPieces);
    });

    it('isCapture detects captures correctly', () => {
      expect(simpleMove.isCapture()).toBe(false);
      expect(captureMove.isCapture()).toBe(true);
    });

    it('getCaptureCount returns correct count', () => {
      expect(simpleMove.getCaptureCount()).toBe(0);
      expect(captureMove.getCaptureCount()).toBe(4);
    });

    it('getCoords returns coordinates', () => {
      expect(simpleMove.getCoords()).toBe(simpleMove.coords);
    });

    it('getPlayer returns player', () => {
      expect(simpleMove.getPlayer()).toBe(simpleMove.player);
    });

    it('toString format for simple move', () => {
      expect(simpleMove.toString()).toBe('Move(Vector3(5, 5, 5), player1)');
    });

    it('toString format for capture move', () => {
      expect(captureMove.toString()).toBe('Move(Vector3(5, 5, 5), player1 (captures 4))');
    });

    it('toJSON serialization', () => {
      const json = captureMove.toJSON();
      expect(json).toEqual({
        coords: { x: 5, y: 5, z: 5 },
        player: {
          id: 'player1',
          color: 'black',
          isLocal: true,
          captures: 0
        },
        timestamp: captureMove.timestamp,
        capturedPieces: capturedPieces.map(p => ({ x: p.x, y: p.y, z: p.z }))
      });
    });
  });

  describe('validation', () => {
    it('isValid returns true for valid move', () => {
      const move = Move.createSimple(testCoords, testPlayer);
      expect(move.isValid()).toBe(true);
    });

    it('isValid returns false for invalid timestamp', () => {
      const futureMove = new Move(testCoords, testPlayer, [], Date.now() + 2000);
      expect(futureMove.isValid()).toBe(false);
    });

    it('isValid returns false for odd captured pieces', () => {
      // This should throw in constructor, but testing the validation method
      const move = Move.createSimple(testCoords, testPlayer);
      (move as any).capturedPieces = [new Vector3(1, 1, 1)];
      expect(move.isValid()).toBe(false);
    });
  });

  describe('comparison', () => {
    it('equals compares moves correctly', () => {
      const move1 = new Move(testCoords, testPlayer, capturedPieces, 1000);
      const move2 = new Move(testCoords, testPlayer, capturedPieces, 1000);
      const move3 = new Move(testCoords, testPlayer, capturedPieces, 2000);
      const move4 = new Move(new Vector3(1, 1, 1), testPlayer, capturedPieces, 1000);

      expect(move1.equals(move2)).toBe(true);
      expect(move1.equals(move3)).toBe(false); // different timestamp
      expect(move1.equals(move4)).toBe(false); // different coords
    });
  });

  describe('immutability', () => {
    it('clone creates independent copy', () => {
      const move = Move.createCapture(testCoords, testPlayer, capturedPieces);
      const cloned = move.clone();
      
      expect(cloned).not.toBe(move);
      expect(cloned.equals(move)).toBe(true);
      expect(cloned.coords).not.toBe(move.coords);
      expect(cloned.player).not.toBe(move.player);
      expect(cloned.capturedPieces).not.toBe(move.capturedPieces);
    });

    it('captured pieces are independent copies', () => {
      const move = Move.createCapture(testCoords, testPlayer, capturedPieces);
      
      // Modify the original array
      capturedPieces.push(new Vector3(10, 10, 10));
      
      // Move's captured pieces should be unchanged
      expect(move.capturedPieces).toHaveLength(4);
      expect(capturedPieces).toHaveLength(5);
    });
  });

  describe('edge cases', () => {
    it('handles empty captured pieces array', () => {
      const move = new Move(testCoords, testPlayer, []);
      expect(move.capturedPieces).toHaveLength(0);
      expect(move.isCapture()).toBe(false);
    });

    it('handles large number of captures', () => {
      const manyCaptures = Array(20).fill(null).map((_, i) => 
        new Vector3(i, 0, 0)
      );
      const move = Move.createCapture(testCoords, testPlayer, manyCaptures);
      expect(move.getCaptureCount()).toBe(20);
    });
  });
});