import { Vector3 } from '@/core/Vector3';

describe('Vector3', () => {
  describe('constructor', () => {
    test('creates valid instance with integer coordinates', () => {
      const vector = new Vector3(1, 2, 3);
      expect(vector.x).toBe(1);
      expect(vector.y).toBe(2);
      expect(vector.z).toBe(3);
    });

    test('rounds decimal coordinates to integers', () => {
      const vector = new Vector3(1.7, 2.3, 3.9);
      expect(vector.x).toBe(2);
      expect(vector.y).toBe(2);
      expect(vector.z).toBe(4);
    });

    test('throws error for invalid coordinates', () => {
      expect(() => new Vector3(NaN, 2, 3)).toThrow('finite numbers');
      expect(() => new Vector3(1, Infinity, 3)).toThrow('finite numbers');
      expect(() => new Vector3(1, 2, -Infinity)).toThrow('finite numbers');
    });
  });

  describe('factory methods', () => {
    test('fromArray creates Vector3 from array', () => {
      const vector = Vector3.fromArray([1, 2, 3]);
      expect(vector).toEqual(new Vector3(1, 2, 3));
    });

    test('fromObject creates Vector3 from object', () => {
      const vector = Vector3.fromObject({ x: 1, y: 2, z: 3 });
      expect(vector).toEqual(new Vector3(1, 2, 3));
    });

    test('zero creates origin vector', () => {
      const vector = Vector3.zero();
      expect(vector).toEqual(new Vector3(0, 0, 0));
    });
  });

  describe('arithmetic operations', () => {
    test('addition returns new instance', () => {
      const v1 = new Vector3(1, 2, 3);
      const v2 = new Vector3(4, 5, 6);
      const result = v1.add(v2);
      
      expect(result).toEqual(new Vector3(5, 7, 9));
      expect(result).not.toBe(v1); // Immutability
      expect(v1).toEqual(new Vector3(1, 2, 3)); // Original unchanged
    });

    test('subtraction returns new instance', () => {
      const v1 = new Vector3(5, 7, 9);
      const v2 = new Vector3(1, 2, 3);
      const result = v1.subtract(v2);
      
      expect(result).toEqual(new Vector3(4, 5, 6));
      expect(result).not.toBe(v1); // Immutability
    });

    test('multiplication returns new instance', () => {
      const v1 = new Vector3(1, 2, 3);
      const result = v1.multiply(2);
      
      expect(result).toEqual(new Vector3(2, 4, 6));
      expect(result).not.toBe(v1); // Immutability
    });

    test('multiplication with invalid scalar throws error', () => {
      const v1 = new Vector3(1, 2, 3);
      expect(() => v1.multiply(NaN)).toThrow('finite number');
      expect(() => v1.multiply(Infinity)).toThrow('finite number');
    });
  });

  describe('utility methods', () => {
    test('distance calculation is accurate', () => {
      const v1 = new Vector3(0, 0, 0);
      const v2 = new Vector3(3, 4, 0);
      expect(v1.distance(v2)).toBe(5); // 3-4-5 triangle
    });

    test('magnitude calculation is accurate', () => {
      const v1 = new Vector3(3, 4, 0);
      expect(v1.magnitude()).toBe(5);
    });

    test('normalize creates direction vector (rounded to integers)', () => {
      const v1 = new Vector3(3, 4, 0);
      const normalized = v1.normalize();
      // Since our Vector3 rounds to integers, normalized won't be exact unit vector
      // But it should be in the right direction
      expect(normalized.x).toBe(1); // 3/5 = 0.6 -> rounds to 1
      expect(normalized.y).toBe(1); // 4/5 = 0.8 -> rounds to 1
      expect(normalized.z).toBe(0); // 0/5 = 0 -> rounds to 0
    });

    test('normalize handles zero vector', () => {
      const v1 = Vector3.zero();
      const normalized = v1.normalize();
      expect(normalized).toEqual(Vector3.zero());
    });

    test('equals comparison works correctly', () => {
      const v1 = new Vector3(1, 2, 3);
      const v2 = new Vector3(1, 2, 3);
      const v3 = new Vector3(1, 2, 4);
      
      expect(v1.equals(v2)).toBe(true);
      expect(v1.equals(v3)).toBe(false);
      expect(v1.equals({ x: 1, y: 2, z: 3 })).toBe(true);
    });

    test('toString format is consistent', () => {
      const v1 = new Vector3(1, 2, 3);
      expect(v1.toString()).toBe('Vector3(1, 2, 3)');
    });

    test('toJSON serialization works', () => {
      const v1 = new Vector3(1, 2, 3);
      expect(v1.toJSON()).toEqual({ x: 1, y: 2, z: 3 });
    });

    test('clone creates independent copy', () => {
      const v1 = new Vector3(1, 2, 3);
      const cloned = v1.clone();
      
      expect(cloned).toEqual(v1);
      expect(cloned).not.toBe(v1);
    });
  });
});