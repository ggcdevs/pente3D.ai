import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { keyOf, coordsOf, inBounds, type Coord } from './coords';

describe('keyOf / coordsOf', () => {
  it('keyOf produces a comma-joined string', () => {
    expect(keyOf([1, 2, 3])).toBe('1,2,3');
  });

  it('coordsOf parses a key back into a numeric triple', () => {
    expect(coordsOf('1,2,3')).toEqual([1, 2, 3]);
  });

  it('round-trips coords → key → coords', () => {
    const c: Coord = [1, 2, 3];
    expect(coordsOf(keyOf(c))).toEqual(c);
  });

  it('round-trips key → coords → key', () => {
    expect(keyOf(coordsOf('4,5,6'))).toBe('4,5,6');
  });

  it('property: round-trip is identity for any in-range integer triple', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (x, y, z) => {
          const c: Coord = [x, y, z];
          expect(coordsOf(keyOf(c))).toEqual(c);
        },
      ),
    );
  });
});

describe('inBounds', () => {
  it('origin is in bounds', () => {
    expect(inBounds([0, 0, 0], 9)).toBe(true);
  });

  it('coordinate equal to size is out of bounds', () => {
    expect(inBounds([9, 0, 0], 9)).toBe(false);
  });

  it('negative coordinates are out of bounds', () => {
    expect(inBounds([-1, 0, 0], 9)).toBe(false);
    expect(inBounds([0, -1, 0], 9)).toBe(false);
    expect(inBounds([0, 0, -1], 9)).toBe(false);
  });

  it('last valid index (size-1) is in bounds', () => {
    expect(inBounds([8, 8, 8], 9)).toBe(true);
  });

  it('property: coord is in bounds iff every component is in 0..N-1', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -5, max: 15 }),
        fc.integer({ min: -5, max: 15 }),
        fc.integer({ min: -5, max: 15 }),
        fc.integer({ min: 1, max: 12 }),
        (x, y, z, n) => {
          const expected =
            x >= 0 && x < n && y >= 0 && y < n && z >= 0 && z < n;
          expect(inBounds([x, y, z], n)).toBe(expected);
        },
      ),
    );
  });
});
