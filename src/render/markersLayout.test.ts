import { describe, it, expect } from 'vitest';
import {
  buildMarkerIndex,
  resolveMarkerVisibility,
  markerInstancesFor,
  type MarkerIndex,
} from './markersLayout.ts';
import { keyOf, type Coord, type NodeKey } from '../core/coords.ts';
import type { Player } from '../core/gameState.ts';

/**
 * Task 4.3 node-marker layout — the PURE index + occupancy/visibility logic (render-ui
 * design Part 1). Given a board size it enumerates the N³ node markers in a canonical
 * order and yields the `nodeKey ↔ instanceId` map; given a `pieces` map it decides which
 * markers are HIDDEN (a marker vanishes when a piece sits on its node) and maps a set of
 * hover node keys onto the instance ids to glow. Strict unit + mutation gate; genuine
 * assertions on the returned index/visibility, plus negative cases. No THREE, no DOM.
 *
 * The enumeration MUST match `picking.ts`'s pick-sphere order (x outer, y, z inner) so a
 * marker and its pick sphere share an instance id / world position — the two layers agree
 * exactly. That ordering is asserted below.
 */

const SIZE = 5;

/** Rebuild the canonical enumeration independently for cross-checking (x outer, z inner). */
function expectedOrder(size: number): NodeKey[] {
  const out: NodeKey[] = [];
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        out.push(keyOf([x, y, z] as Coord));
      }
    }
  }
  return out;
}

describe('buildMarkerIndex', () => {
  it('enumerates exactly N³ markers, one per board node, no dupes', () => {
    const index = buildMarkerIndex(SIZE);
    expect(index.count).toBe(SIZE * SIZE * SIZE);
    expect(index.nodeOfInstance).toHaveLength(SIZE * SIZE * SIZE);
    expect(new Set(index.nodeOfInstance).size).toBe(SIZE * SIZE * SIZE);
  });

  it('uses the picking enumeration order (x outer, y, z inner)', () => {
    const index = buildMarkerIndex(SIZE);
    expect(index.nodeOfInstance).toEqual(expectedOrder(SIZE));
    // Spot-check the boundary transitions the nesting produces.
    expect(index.nodeOfInstance[0]).toBe(keyOf([0, 0, 0]));
    expect(index.nodeOfInstance[1]).toBe(keyOf([0, 0, 1]));
    expect(index.nodeOfInstance[SIZE]).toBe(keyOf([0, 1, 0]));
    expect(index.nodeOfInstance[SIZE * SIZE]).toBe(keyOf([1, 0, 0]));
    expect(index.nodeOfInstance[SIZE * SIZE * SIZE - 1]).toBe(
      keyOf([SIZE - 1, SIZE - 1, SIZE - 1]),
    );
  });

  it('the instanceIdOf map inverts nodeOfInstance exactly', () => {
    const index = buildMarkerIndex(SIZE);
    expect(index.instanceIdOf.size).toBe(index.count);
    for (let i = 0; i < index.count; i++) {
      expect(index.instanceIdOf.get(index.nodeOfInstance[i]!)).toBe(i);
    }
    // An off-board key is absent (not silently mapped to 0).
    expect(index.instanceIdOf.get(keyOf([SIZE, SIZE, SIZE]))).toBeUndefined();
  });

  it('handles a 1³ board (single marker at the origin)', () => {
    const index = buildMarkerIndex(1);
    expect(index.count).toBe(1);
    expect(index.nodeOfInstance).toEqual([keyOf([0, 0, 0])]);
    expect(index.instanceIdOf.get(keyOf([0, 0, 0]))).toBe(0);
  });
});

describe('resolveMarkerVisibility', () => {
  const index: MarkerIndex = buildMarkerIndex(SIZE);

  it('every marker is visible on an empty board', () => {
    const vis = resolveMarkerVisibility(index, {});
    expect(vis).toHaveLength(index.count);
    expect(vis.every((v) => v === true)).toBe(true);
  });

  it('hides EXACTLY the markers whose node is occupied, leaves the rest visible', () => {
    const occupied: Record<NodeKey, Player> = {
      [keyOf([2, 2, 2])]: 'white',
      [keyOf([0, 0, 0])]: 'black',
    };
    const vis = resolveMarkerVisibility(index, occupied);
    // The two occupied nodes are hidden.
    expect(vis[index.instanceIdOf.get(keyOf([2, 2, 2]))!]).toBe(false);
    expect(vis[index.instanceIdOf.get(keyOf([0, 0, 0]))!]).toBe(false);
    // Exactly two are hidden; everyone else is visible.
    expect(vis.filter((v) => v === false)).toHaveLength(2);
    expect(vis[index.instanceIdOf.get(keyOf([1, 1, 1]))!]).toBe(true);
    expect(vis[index.instanceIdOf.get(keyOf([4, 4, 4]))!]).toBe(true);
  });

  it('ignores a pieces entry for an off-board node (no marker to hide)', () => {
    const vis = resolveMarkerVisibility(index, { [keyOf([9, 9, 9])]: 'white' });
    expect(vis.filter((v) => v === false)).toHaveLength(0);
  });
});

describe('markerInstancesFor', () => {
  const index: MarkerIndex = buildMarkerIndex(SIZE);

  it('maps a set of node keys onto their instance ids (order preserved)', () => {
    const ids = markerInstancesFor(index, [keyOf([0, 0, 1]), keyOf([1, 0, 0])]);
    expect(ids).toEqual([
      index.instanceIdOf.get(keyOf([0, 0, 1]))!,
      index.instanceIdOf.get(keyOf([1, 0, 0]))!,
    ]);
  });

  it('empty input → no instances', () => {
    expect(markerInstancesFor(index, [])).toEqual([]);
  });

  it('silently skips node keys that are not board markers (no phantom instance)', () => {
    const ids = markerInstancesFor(index, [keyOf([2, 2, 2]), keyOf([9, 9, 9])]);
    expect(ids).toEqual([index.instanceIdOf.get(keyOf([2, 2, 2]))!]);
  });
});
