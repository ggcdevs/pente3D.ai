import { Piece, Vector3, Player } from '@/core';

describe('Piece', () => {
  let testCoords: Vector3;
  let testPlayer: Player;

  beforeEach(() => {
    testCoords = new Vector3(5, 5, 5);
    testPlayer = Player.createLocal('player1', 'black');
  });

  describe('constructor', () => {
    it('creates valid normal piece', () => {
      const piece = new Piece(testCoords, testPlayer, false);
      expect(piece.coords.equals(testCoords)).toBe(true);
      expect(piece.player.equals(testPlayer)).toBe(true);
      expect(piece.isTemporary).toBe(false);
      expect(piece.placedAt).toBeLessThanOrEqual(Date.now());
      expect(piece.placedAt).toBeGreaterThan(Date.now() - 1000);
    });

    it('creates valid temporary piece', () => {
      const piece = new Piece(testCoords, testPlayer, true);
      expect(piece.isTemporary).toBe(true);
      expect(piece.isPermanent()).toBe(false);
    });

    it('accepts IVector3 and IPlayer interfaces', () => {
      const piece = new Piece(
        { x: 1, y: 2, z: 3 },
        { id: 'p1', color: 'white', isLocal: true, captures: 0 }
      );
      expect(piece.coords.x).toBe(1);
      expect(piece.player.id).toBe('p1');
    });

    it('throws error for missing coordinates', () => {
      expect(() => new Piece(null as any, testPlayer)).toThrow('Piece coordinates are required');
    });

    it('throws error for missing player', () => {
      expect(() => new Piece(testCoords, null as any)).toThrow('Piece player is required');
    });

    it('accepts custom placedAt timestamp', () => {
      const customTime = Date.now() - 5000;
      const piece = new Piece(testCoords, testPlayer, false, customTime);
      expect(piece.placedAt).toBe(customTime);
    });

    it('defaults isTemporary to false', () => {
      const piece = new Piece(testCoords, testPlayer);
      expect(piece.isTemporary).toBe(false);
    });
  });

  describe('factory methods', () => {
    it('createNormal creates permanent piece', () => {
      const piece = Piece.createNormal(testCoords, testPlayer);
      expect(piece.isTemporary).toBe(false);
      expect(piece.isPermanent()).toBe(true);
    });

    it('createTemporary creates temporary piece', () => {
      const piece = Piece.createTemporary(testCoords, testPlayer);
      expect(piece.isTemporary).toBe(true);
      expect(piece.isPermanent()).toBe(false);
    });
  });

  describe('getters', () => {
    let piece: Piece;

    beforeEach(() => {
      piece = Piece.createNormal(testCoords, testPlayer);
    });

    it('getCoords returns coordinates', () => {
      expect(piece.getCoords()).toBe(piece.coords);
    });

    it('getPlayer returns player', () => {
      expect(piece.getPlayer()).toBe(piece.player);
    });

    it('getType returns correct type', () => {
      expect(piece.getType()).toBe('normal');
      const tempPiece = Piece.createTemporary(testCoords, testPlayer);
      expect(tempPiece.getType()).toBe('temporary');
    });
  });

  describe('state queries', () => {
    let normalPiece: Piece;
    let tempPiece: Piece;

    beforeEach(() => {
      normalPiece = Piece.createNormal(testCoords, testPlayer);
      tempPiece = Piece.createTemporary(testCoords, testPlayer);
    });

    it('isPermanent returns correct state', () => {
      expect(normalPiece.isPermanent()).toBe(true);
      expect(tempPiece.isPermanent()).toBe(false);
    });

    it('belongsTo checks player ownership', () => {
      const otherPlayer = Player.createLocal('player2', 'white');
      expect(normalPiece.belongsTo(testPlayer)).toBe(true);
      expect(normalPiece.belongsTo(otherPlayer)).toBe(false);
    });

    it('isAt checks coordinates', () => {
      expect(normalPiece.isAt(testCoords)).toBe(true);
      expect(normalPiece.isAt(new Vector3(1, 1, 1))).toBe(false);
    });
  });

  describe('transformations', () => {
    let normalPiece: Piece;
    let tempPiece: Piece;

    beforeEach(() => {
      normalPiece = Piece.createNormal(testCoords, testPlayer);
      tempPiece = Piece.createTemporary(testCoords, testPlayer);
    });

    it('makeTemporary converts permanent to temporary', () => {
      const converted = normalPiece.makeTemporary();
      expect(converted).not.toBe(normalPiece);
      expect(converted.isTemporary).toBe(true);
      expect(converted.placedAt).toBe(normalPiece.placedAt);
    });

    it('makeTemporary returns same instance if already temporary', () => {
      const result = tempPiece.makeTemporary();
      expect(result).toBe(tempPiece);
    });

    it('makePermanent converts temporary to permanent', () => {
      const originalTime = tempPiece.placedAt;
      const converted = tempPiece.makePermanent();
      expect(converted).not.toBe(tempPiece);
      expect(converted.isTemporary).toBe(false);
      expect(converted.placedAt).toBeGreaterThanOrEqual(originalTime);
    });

    it('makePermanent returns same instance if already permanent', () => {
      const result = normalPiece.makePermanent();
      expect(result).toBe(normalPiece);
    });

    it('moveTo creates new piece at different coordinates', () => {
      const newCoords = new Vector3(1, 2, 3);
      const moved = normalPiece.moveTo(newCoords);
      
      expect(moved).not.toBe(normalPiece);
      expect(moved.coords.equals(newCoords)).toBe(true);
      expect(moved.player.equals(normalPiece.player)).toBe(true);
      expect(moved.isTemporary).toBe(normalPiece.isTemporary);
      expect(moved.placedAt).toBe(normalPiece.placedAt);
    });

    it('moveTo accepts IVector3 interface', () => {
      const moved = normalPiece.moveTo({ x: 7, y: 8, z: 9 });
      expect(moved.coords.x).toBe(7);
      expect(moved.coords.y).toBe(8);
      expect(moved.coords.z).toBe(9);
    });
  });

  describe('validation', () => {
    it('isValid returns true for valid piece', () => {
      const piece = Piece.createNormal(testCoords, testPlayer);
      expect(piece.isValid()).toBe(true);
    });

    it('isValid returns false for invalid timestamp', () => {
      const futurePiece = new Piece(testCoords, testPlayer, false, Date.now() + 2000);
      expect(futurePiece.isValid()).toBe(false);
    });

    it('isValid handles missing properties gracefully', () => {
      const piece = Piece.createNormal(testCoords, testPlayer);
      (piece as any).coords = null;
      expect(piece.isValid()).toBe(false);
    });
  });

  describe('comparison', () => {
    it('equals compares pieces correctly', () => {
      const piece1 = Piece.createNormal(testCoords, testPlayer);
      const piece2 = Piece.createNormal(testCoords, testPlayer);
      const piece3 = Piece.createTemporary(testCoords, testPlayer);
      const piece4 = Piece.createNormal(new Vector3(1, 1, 1), testPlayer);

      expect(piece1.equals(piece2)).toBe(true);
      expect(piece1.equals(piece3)).toBe(false); // different type
      expect(piece1.equals(piece4)).toBe(false); // different coords
    });
  });

  describe('utility methods', () => {
    it('toString format for normal piece', () => {
      const piece = Piece.createNormal(testCoords, testPlayer);
      expect(piece.toString()).toBe('Piece(Vector3(5, 5, 5), player1, permanent)');
    });

    it('toString format for temporary piece', () => {
      const piece = Piece.createTemporary(testCoords, testPlayer);
      expect(piece.toString()).toBe('Piece(Vector3(5, 5, 5), player1, temporary)');
    });

    it('toJSON serialization', () => {
      const piece = Piece.createNormal(testCoords, testPlayer);
      const json = piece.toJSON();
      expect(json).toEqual({
        coords: { x: 5, y: 5, z: 5 },
        player: {
          id: 'player1',
          color: 'black',
          isLocal: true,
          captures: 0
        },
        isTemporary: false
      });
    });
  });

  describe('immutability', () => {
    it('clone creates independent copy', () => {
      const piece = Piece.createNormal(testCoords, testPlayer);
      const cloned = piece.clone();
      
      expect(cloned).not.toBe(piece);
      expect(cloned.equals(piece)).toBe(true);
      expect(cloned.coords).not.toBe(piece.coords);
      expect(cloned.player).not.toBe(piece.player);
      expect(cloned.placedAt).toBe(piece.placedAt);
    });

    it('transformations return new instances', () => {
      const piece = Piece.createNormal(testCoords, testPlayer);
      const tempPiece = piece.makeTemporary();
      const movedPiece = piece.moveTo(new Vector3(1, 2, 3));
      
      // Verify all are different instances
      expect(tempPiece).not.toBe(piece);
      expect(movedPiece).not.toBe(piece);
      
      // Verify original is unchanged
      expect(piece.isTemporary).toBe(false);
      expect(piece.coords.equals(testCoords)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles pieces at origin', () => {
      const origin = Vector3.zero();
      const piece = Piece.createNormal(origin, testPlayer);
      expect(piece.coords.x).toBe(0);
      expect(piece.coords.y).toBe(0);
      expect(piece.coords.z).toBe(0);
    });

    it('handles state transitions correctly', () => {
      const piece = Piece.createNormal(testCoords, testPlayer);
      const temp = piece.makeTemporary();
      const perm = temp.makePermanent();
      
      expect(piece.isTemporary).toBe(false);
      expect(temp.isTemporary).toBe(true);
      expect(perm.isTemporary).toBe(false);
      expect(perm.placedAt).toBeGreaterThanOrEqual(temp.placedAt);
    });
  });
});