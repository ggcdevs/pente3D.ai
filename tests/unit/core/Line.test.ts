import { Line, Vector3 } from '@/core';

describe('Line', () => {
  // Test Group A: Line Construction and Validation
  describe('construction', () => {
    it('should create valid line with continuous coordinates', () => {
      const coords = [
        new Vector3(0, 0, 0),
        new Vector3(1, 0, 0),
        new Vector3(2, 0, 0)
      ];
      const direction = new Vector3(1, 0, 0);
      const line = new Line(coords, direction);

      expect(line.coords).toHaveLength(3);
      expect(line.direction.equals(direction)).toBe(true);
      expect(line.isComplete).toBe(false);
    });

    it('should create line from 2 points with auto-direction', () => {
      const coords = [
        new Vector3(0, 0, 0),
        new Vector3(1, 1, 1)
      ];
      const line = Line.fromCoords(coords);

      expect(line.coords).toHaveLength(2);
      expect(line.direction.equals(new Vector3(1, 1, 1))).toBe(true);
    });

    it('should create complete line from 5 points', () => {
      const coords = [
        new Vector3(0, 0, 0),
        new Vector3(1, 0, 0),
        new Vector3(2, 0, 0),
        new Vector3(3, 0, 0),
        new Vector3(4, 0, 0)
      ];
      const direction = new Vector3(1, 0, 0);
      const line = new Line(coords, direction);

      expect(line.isComplete).toBe(true);
      expect(line.coords).toHaveLength(5);
    });

    it('should throw error for empty coordinates', () => {
      expect(() => new Line([], new Vector3(1, 0, 0)))
        .toThrow('Line must have at least one coordinate');
    });

    it('should throw error for missing direction', () => {
      expect(() => new Line([new Vector3(0, 0, 0)], null as any))
        .toThrow('Line direction is required');
    });

    it('should throw error for non-continuous coordinates', () => {
      const coords = [
        new Vector3(0, 0, 0),
        new Vector3(1, 0, 0),
        new Vector3(3, 0, 0) // Skip 2,0,0
      ];
      const direction = new Vector3(1, 0, 0);
      
      expect(() => new Line(coords, direction))
        .toThrow('Line is not continuous at index 2');
    });

    it('should accept single coordinate line', () => {
      const coords = [new Vector3(0, 0, 0)];
      const direction = new Vector3(1, 0, 0);
      const line = new Line(coords, direction);

      expect(line.coords).toHaveLength(1);
      expect(line.isComplete).toBe(false);
    });

    it('should calculate direction correctly with fromCoords factory', () => {
      const coords = [
        new Vector3(2, 3, 4),
        new Vector3(4, 6, 8)
      ];
      const line = Line.fromCoords(coords);

      expect(line.direction.equals(new Vector3(2, 3, 4))).toBe(true);
    });
  });

  // Test Group B: Line Operations
  describe('operations', () => {
    let line: Line;

    beforeEach(() => {
      const coords = [
        new Vector3(0, 0, 0),
        new Vector3(1, 1, 1),
        new Vector3(2, 2, 2)
      ];
      line = Line.fromCoords(coords);
    });

    it('should find coordinates correctly with contains()', () => {
      expect(line.contains(new Vector3(1, 1, 1))).toBe(true);
      expect(line.contains(new Vector3(0, 0, 0))).toBe(true);
      expect(line.contains(new Vector3(3, 3, 3))).toBe(false);
    });

    it('should extend line in positive direction', () => {
      const extended = line.extend();
      expect(extended).not.toBeNull();
      expect(extended!.coords).toHaveLength(4);
      expect(extended!.contains(new Vector3(3, 3, 3))).toBe(true);
    });

    it('should extend line in negative direction', () => {
      const extended = line.extendBackward();
      expect(extended).not.toBeNull();
      expect(extended!.coords).toHaveLength(4);
      expect(extended!.contains(new Vector3(-1, -1, -1))).toBe(true);
    });

    it('should correctly identify subsets with isSubsetOf()', () => {
      const superLine = Line.fromCoords([
        new Vector3(-1, -1, -1),
        new Vector3(0, 0, 0),
        new Vector3(1, 1, 1),
        new Vector3(2, 2, 2),
        new Vector3(3, 3, 3)
      ]);

      expect(line.isSubsetOf(superLine)).toBe(true);
      expect(superLine.isSubsetOf(line)).toBe(false);
    });

    it('should return correct length', () => {
      expect(line.getLength()).toBe(3);
    });

    it('should return correct start and end', () => {
      expect(line.getStart().equals(new Vector3(0, 0, 0))).toBe(true);
      expect(line.getEnd().equals(new Vector3(2, 2, 2))).toBe(true);
    });

    it('should not consider lines with different directions as subsets', () => {
      // Create a valid line with different direction
      const otherLine = new Line(
        [new Vector3(0, 0, 0), new Vector3(2, 0, 0)],
        new Vector3(2, 0, 0) // Different direction than (1,1,1)
      );
      
      expect(line.isSubsetOf(otherLine)).toBe(false);
    });
  });

  // Test Group C: Line Utilities
  describe('utility', () => {
    let line: Line;

    beforeEach(() => {
      line = Line.fromCoords([
        new Vector3(1, 2, 3),
        new Vector3(2, 3, 4),
        new Vector3(3, 4, 5)
      ]);
    });

    it('should have readable toString() format', () => {
      const str = line.toString();
      expect(str).toBe('Line(Vector3(1, 2, 3) -> Vector3(2, 3, 4) -> Vector3(3, 4, 5))');
    });

    it('should include all properties in toJSON()', () => {
      const json = line.toJSON();
      expect(json.coords).toHaveLength(3);
      expect(json.direction).toEqual({ x: 1, y: 1, z: 1 });
      expect(json.isComplete).toBe(false);
    });

    it('should create independent copy with clone()', () => {
      const cloned = line.clone();
      
      // Verify independence
      expect(cloned).not.toBe(line);
      expect(cloned.coords[0]).not.toBe(line.coords[0]);
      expect(cloned.direction).not.toBe(line.direction);
      
      // Verify equality
      expect(cloned.coords[0].equals(line.coords[0])).toBe(true);
      expect(cloned.direction.equals(line.direction)).toBe(true);
    });

    it('should maintain immutability of coordinates', () => {
      const coords = line.coords;
      const originalFirst = coords[0];
      
      // Try to modify (shouldn't affect line)
      coords[0] = new Vector3(99, 99, 99);
      
      expect(line.coords[0]).toBe(originalFirst);
    });

    it('should normalize direction vector correctly', () => {
      const coords = [
        new Vector3(0, 0, 0),
        new Vector3(2, 4, 6)
      ];
      const scaledDirection = new Vector3(2, 4, 6);
      const line = new Line(coords, scaledDirection);
      
      // Direction should be stored as-is
      expect(line.direction.equals(scaledDirection)).toBe(true);
    });
  });

  // Additional edge cases
  describe('edge cases', () => {
    it('should handle lines with IVector3 objects', () => {
      const coords = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 }
      ];
      const direction = { x: 1, y: 0, z: 0 };
      const line = new Line(coords, direction);

      expect(line.coords[0]).toBeInstanceOf(Vector3);
      expect(line.direction).toBeInstanceOf(Vector3);
    });

    it('should throw error for less than 2 coords in fromCoords', () => {
      expect(() => Line.fromCoords([new Vector3(0, 0, 0)]))
        .toThrow('Need at least 2 coordinates to determine direction');
    });

    it('should handle zero-length lines (same start and end)', () => {
      const coords = [new Vector3(5, 5, 5)];
      const direction = new Vector3(1, 0, 0);
      const line = new Line(coords, direction);

      expect(line.getStart().equals(line.getEnd())).toBe(true);
    });

    it('should handle large coordinate values', () => {
      const coords = [
        new Vector3(1000, 2000, 3000),
        new Vector3(1001, 2001, 3001)
      ];
      const line = Line.fromCoords(coords);

      expect(line.direction.equals(new Vector3(1, 1, 1))).toBe(true);
    });

    it('should handle negative coordinate values', () => {
      const coords = [
        new Vector3(-5, -5, -5),
        new Vector3(-3, -3, -3),
        new Vector3(-1, -1, -1)
      ];
      const line = Line.fromCoords(coords);

      expect(line.direction.equals(new Vector3(2, 2, 2))).toBe(true);
      expect(line.coords).toHaveLength(3);
    });
  });
});