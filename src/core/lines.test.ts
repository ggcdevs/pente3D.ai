import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  generateAllLines,
  buildLinesThroughNode,
  linesThroughNode,
  generateFullLine,
  generatePartialLine,
  assertUnitStep,
  type Line,
} from './lines';
import { AXES } from './axes';
import { keyOf, coordsOf, inBounds, type Coord } from './coords';

/** Add two coordinates componentwise. */
function add(a: Coord, b: Coord): Coord {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/** Subtract b from a componentwise. */
function sub(a: Coord, b: Coord): Coord {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

describe('generateAllLines — dedup-free enumeration', () => {
  it('produces the expected count per category for N=9', () => {
    const lines = generateAllLines(9);
    const byCat = { orthogonal: 0, face: 0, space: 0 } as Record<
      Line['category'],
      number
    >;
    for (const l of lines) byCat[l.category] += 1;
    expect(lines.length).toBe(2029);
    expect(byCat).toEqual({ orthogonal: 243, face: 918, space: 868 });
  });

  it('has no duplicate line ids (set size === array length)', () => {
    for (const N of [3, 4, 5, 9]) {
      const lines = generateAllLines(N);
      const ids = new Set(lines.map((l) => l.id));
      expect(ids.size).toBe(lines.length);
    }
  });

  it('every line: nodes collinear along its axis, in-bounds, ordered, entryNode−axis off-board', () => {
    const N = 9;
    const lines = generateAllLines(N);
    for (const line of lines) {
      const axis = AXES[line.axisIndex]!.vec;
      // entryNode is the first node
      expect(line.nodes[0]).toEqual(line.entryNode);
      // entryNode − axis is off-board
      expect(inBounds(sub(line.entryNode, axis), N)).toBe(false);
      // each successive node is prev + axis, all in-bounds
      for (let i = 0; i < line.nodes.length; i++) {
        const expected = add(line.entryNode, [
          axis[0] * i,
          axis[1] * i,
          axis[2] * i,
        ]);
        expect(line.nodes[i]).toEqual(expected);
        expect(inBounds(line.nodes[i]!, N)).toBe(true);
      }
      // node just past the end is off-board (maximal run)
      const past = add(line.nodes[line.nodes.length - 1]!, axis);
      expect(inBounds(past, N)).toBe(false);
      // every full line has ≥ 1 node (diagonals that only clip a corner are
      // single-node maximal runs — still enumerated exactly once)
      expect(line.nodes.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('property: for any N, the id set has the same size as the array (no dupes)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 12 }), (N) => {
        const lines = generateAllLines(N);
        const ids = new Set(lines.map((l) => l.id));
        expect(ids.size).toBe(lines.length);
      }),
    );
  });
});

describe('linesThroughNode index', () => {
  const N = 9;
  const lines = generateAllLines(N);
  const index = buildLinesThroughNode(lines);

  const cases: Array<[string, Coord]> = [
    ['corner', [0, 0, 0]],
    ['edge', [0, 0, 4]],
    ['center', [4, 4, 4]],
  ];

  for (const [label, node] of cases) {
    it(`lists exactly the lines containing the ${label} node, and each truly contains it`, () => {
      const key = keyOf(node);
      const ids = index.get(key) ?? [];
      // Independent brute-force set of lines that contain the node.
      const expected = new Set(
        lines
          .filter((l) => l.nodes.some((n) => keyOf(n) === key))
          .map((l) => l.id),
      );
      expect(new Set(ids)).toEqual(expected);
      // Every listed line actually contains the node.
      const byId = new Map(lines.map((l) => [l.id, l]));
      for (const id of ids) {
        const line = byId.get(id)!;
        expect(line.nodes.some((n) => keyOf(n) === key)).toBe(true);
      }
      // No line is listed more than once for a node.
      expect(new Set(ids).size).toBe(ids.length);
    });
  }

  it('center node lies on exactly 13 lines (one per axis)', () => {
    const ids = index.get(keyOf([4, 4, 4])) ?? [];
    expect(ids.length).toBe(13);
  });

  it('the exported linesThroughNode helper equals building over generateAllLines', () => {
    const built = linesThroughNode(N);
    const manual = buildLinesThroughNode(generateAllLines(N));
    expect(new Set(built.keys())).toEqual(new Set(manual.keys()));
    for (const k of built.keys()) {
      expect(new Set(built.get(k))).toEqual(new Set(manual.get(k)));
    }
  });
});

describe('generateFullLine', () => {
  const N = 9;
  const registered = generateAllLines(N);

  it('accepts two on-face, collinear, not-yet-registered endpoints — but a full board line IS already registered, so it rejects it', () => {
    // The orthogonal line along x through y=0,z=0 spans (0,0,0)..(8,0,0):
    // both endpoints are on faces and collinear, and it IS an existing full line.
    const res = generateFullLine([0, 0, 0], [8, 0, 0], N, registered);
    expect(res.ok).toBe(false);
    expect(res.warning).toBeTruthy();
  });

  it('rejects when an endpoint is out of bounds', () => {
    // (9,0,0) is off-board for N=9 (valid components are 0..8).
    const res = generateFullLine([0, 0, 0], [9, 0, 0], N, []);
    expect(res.ok).toBe(false);
    expect(res.warning).toMatch(/bounds/i);
  });

  it('rejects when the first endpoint is out of bounds (either order)', () => {
    const res = generateFullLine([-1, 0, 0], [8, 0, 0], N, []);
    expect(res.ok).toBe(false);
    expect(res.warning).toMatch(/bounds/i);
  });

  it('rejects when an endpoint is not on a face', () => {
    // (4,4,4) is interior (not on any face).
    const res = generateFullLine([4, 4, 4], [8, 4, 4], N, []);
    expect(res.ok).toBe(false);
    expect(res.warning).toMatch(/face/i);
  });

  it('rejects when the two endpoints are not collinear along an axis', () => {
    const res = generateFullLine([0, 0, 0], [8, 1, 0], N, []);
    expect(res.ok).toBe(false);
    expect(res.warning).toMatch(/collinear/i);
  });

  it('rejects when the line is already registered', () => {
    const res = generateFullLine([0, 0, 0], [8, 8, 8], N, registered);
    expect(res.ok).toBe(false);
    expect(res.warning).toMatch(/already/i);
  });

  it('accepts and returns the canonical full line when valid and not registered', () => {
    // With an empty registry the same span is valid; result must be the
    // canonical full line spanning face-to-face.
    const res = generateFullLine([0, 0, 0], [8, 0, 0], N, []);
    expect(res.ok).toBe(true);
    expect(res.line).toBeDefined();
    const line = res.line!;
    expect(line.nodes[0]).toEqual([0, 0, 0]);
    expect(line.nodes[line.nodes.length - 1]).toEqual([8, 0, 0]);
    expect(line.nodes.length).toBe(9);
    // Its id matches the canonical full line enumerated by generateAllLines.
    const match = registered.find((l) => l.id === line.id);
    expect(match).toBeDefined();
  });

  it('accepts endpoints given in reverse order (b before a)', () => {
    const res = generateFullLine([8, 0, 0], [0, 0, 0], N, []);
    expect(res.ok).toBe(true);
    expect(res.line!.entryNode).toEqual([0, 0, 0]);
  });
});

describe('generatePartialLine', () => {
  const N = 9;

  it('accepts a collinear subsegment not already drawn', () => {
    const res = generatePartialLine([1, 0, 0], [4, 0, 0], N, []);
    expect(res.ok).toBe(true);
    expect(res.line!.nodes).toEqual([
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
      [4, 0, 0],
    ]);
  });

  it('accepts a diagonal (space) subsegment', () => {
    const res = generatePartialLine([2, 2, 2], [5, 5, 5], N, []);
    expect(res.ok).toBe(true);
    expect(res.line!.nodes).toEqual([
      [2, 2, 2],
      [3, 3, 3],
      [4, 4, 4],
      [5, 5, 5],
    ]);
  });

  it('rejects a non-collinear pair', () => {
    const res = generatePartialLine([0, 0, 0], [2, 1, 0], N, []);
    expect(res.ok).toBe(false);
    expect(res.warning).toMatch(/collinear/i);
  });

  it('rejects identical endpoints (a === b is not collinear along any axis)', () => {
    const res = generatePartialLine([3, 3, 3], [3, 3, 3], N, []);
    expect(res.ok).toBe(false);
    expect(res.warning).toMatch(/collinear/i);
  });

  it('rejects a subsegment already drawn', () => {
    const seg = generatePartialLine([1, 0, 0], [4, 0, 0], N, []).line!;
    const res = generatePartialLine([1, 0, 0], [4, 0, 0], N, [seg]);
    expect(res.ok).toBe(false);
    expect(res.warning).toMatch(/already/i);
  });

  it('rejects endpoints that are out of bounds', () => {
    const res = generatePartialLine([0, 0, 0], [9, 0, 0], N, []);
    expect(res.ok).toBe(false);
  });

  it('property: any two distinct collinear in-bounds endpoints yield an ordered in-bounds segment', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: AXES.length - 1 }),
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 1, max: 8 }),
        (axisIdx, x, y, z, steps) => {
          const axis = AXES[axisIdx]!.vec;
          const a: Coord = [x, y, z];
          const b = add(a, [axis[0] * steps, axis[1] * steps, axis[2] * steps]);
          fc.pre(inBounds(b, 9));
          const res = generatePartialLine(a, b, 9, []);
          expect(res.ok).toBe(true);
          const nodes = res.line!.nodes;
          // ordered start→end, all in-bounds, consecutive by ±axis
          expect(nodes[0]).toEqual(a);
          expect(nodes[nodes.length - 1]).toEqual(b);
          for (const n of nodes) expect(inBounds(n, 9)).toBe(true);
        },
      ),
    );
  });
});

describe('line ids round-trip to (entryNode, axisIndex)', () => {
  it('id encodes entryNode key and axis index and is parseable', () => {
    const lines = generateAllLines(5);
    for (const l of lines) {
      const [entryKey, axisStr] = l.id.split('|');
      expect(coordsOf(entryKey!)).toEqual(l.entryNode);
      expect(Number(axisStr)).toBe(l.axisIndex);
    }
  });
});

describe('assertUnitStep — collinearAxis ±1 invariant tripwire', () => {
  it('passes for unit steps (+1 and -1): the invariant every canonical axis holds', () => {
    expect(() => assertUnitStep(1)).not.toThrow();
    expect(() => assertUnitStep(-1)).not.toThrow();
  });

  it('throws for a non-unit axis component (documents why the di*vi step-count trick is sound)', () => {
    expect(() => assertUnitStep(2)).toThrow(/must be ±1, got 2/);
    expect(() => assertUnitStep(0)).toThrow(/must be ±1, got 0/);
  });

  it('every non-zero component of every canonical axis satisfies the invariant', () => {
    for (const axis of AXES) {
      for (const c of axis.vec) {
        if (c !== 0) expect(() => assertUnitStep(c)).not.toThrow();
      }
    }
  });
});
