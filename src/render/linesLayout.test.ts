/**
 * Tests for the PURE gridline layout planner (Task 4.4).
 *
 * `linesLayout.ts` turns `generateAllLines(size)` (core) + the `lineVisibility` and
 * `blending` config sections into a plain, THREE-free plan the instanced-gridline glue
 * (`lines.ts`) consumes: three category groups (orthogonal / face / space), each with an
 * ordered instance buffer of *segments* (one instance per adjacent-node pair), a
 * `lineId → instance-range` map for subset targeting, a resolved visibility flag, and a
 * resolved blending mode. This is the pure boundary — no THREE, no DOM — so it gets the
 * strict unit + mutation gate with genuine assertions on observed values (agent-
 * principles #2/#3), including negative cases (bad config key/value rejected, out-of-
 * range instance lookups). Config category naming (`faceDiagonal`/`spaceDiagonal`) vs
 * core naming (`face`/`space`) is a real bug seam and is asserted explicitly.
 */

import { describe, expect, it } from 'vitest';
import { generateAllLines, type LineCategory } from '../core/lines.ts';
import {
  LINE_CATEGORIES,
  visibilityKeyOf,
  resolveLineVisibility,
  resolveLineBlending,
  buildLineGroups,
  resolveLineLayout,
  type LineVisibilityConfig,
  type BlendingConfig,
} from './linesLayout.ts';

const visibleAll: LineVisibilityConfig = {
  orthogonal: true,
  faceDiagonal: true,
  spaceDiagonal: true,
};
const blendAll: BlendingConfig = {
  orthogonal: 'additive',
  faceDiagonal: 'additive',
  spaceDiagonal: 'additive',
};

describe('LINE_CATEGORIES', () => {
  it('is the three core categories in orthogonal → face → space order', () => {
    expect(LINE_CATEGORIES).toEqual(['orthogonal', 'face', 'space']);
  });
});

describe('visibilityKeyOf', () => {
  it('maps each core category to its config key (face→faceDiagonal, space→spaceDiagonal)', () => {
    expect(visibilityKeyOf('orthogonal')).toBe('orthogonal');
    expect(visibilityKeyOf('face')).toBe('faceDiagonal');
    expect(visibilityKeyOf('space')).toBe('spaceDiagonal');
  });

  it('throws on an unknown category', () => {
    expect(() => visibilityKeyOf('diagonal' as unknown as LineCategory)).toThrow(
      /unknown line category/i,
    );
  });
});

describe('resolveLineVisibility', () => {
  it('reads each category from its correctly-named config key', () => {
    const v = resolveLineVisibility({
      orthogonal: true,
      faceDiagonal: false,
      spaceDiagonal: true,
    });
    expect(v).toEqual({ orthogonal: true, face: false, space: true });
  });

  it('does not conflate the two diagonal categories (face vs space keys are distinct)', () => {
    const v = resolveLineVisibility({
      orthogonal: false,
      faceDiagonal: true,
      spaceDiagonal: false,
    });
    expect(v.face).toBe(true);
    expect(v.space).toBe(false);
  });

  it('throws when a category flag is missing', () => {
    expect(() =>
      resolveLineVisibility({ orthogonal: true, faceDiagonal: true } as LineVisibilityConfig),
    ).toThrow(/lineVisibility\.spaceDiagonal/i);
  });

  it('throws when a category flag is not a boolean', () => {
    expect(() =>
      resolveLineVisibility({
        orthogonal: 'yes' as unknown as boolean,
        faceDiagonal: true,
        spaceDiagonal: true,
      }),
    ).toThrow(/lineVisibility\.orthogonal/i);
  });
});

describe('resolveLineBlending', () => {
  it('reads each blending mode from its correctly-named config key', () => {
    const b = resolveLineBlending({
      orthogonal: 'additive',
      faceDiagonal: 'normal',
      spaceDiagonal: 'additive',
    });
    expect(b).toEqual({ orthogonal: 'additive', face: 'normal', space: 'additive' });
  });

  it('does not conflate the two diagonal categories (face vs space)', () => {
    const b = resolveLineBlending({
      orthogonal: 'normal',
      faceDiagonal: 'additive',
      spaceDiagonal: 'normal',
    });
    expect(b.face).toBe('additive');
    expect(b.space).toBe('normal');
  });

  it('throws on an unrecognized blending mode', () => {
    expect(() =>
      resolveLineBlending({
        orthogonal: 'glow' as unknown as 'additive',
        faceDiagonal: 'additive',
        spaceDiagonal: 'additive',
      }),
    ).toThrow(/blending\.orthogonal/i);
  });

  it('throws when a blending mode is missing', () => {
    expect(() =>
      resolveLineBlending({ orthogonal: 'additive', faceDiagonal: 'normal' } as BlendingConfig),
    ).toThrow(/blending\.spaceDiagonal/i);
  });
});

describe('buildLineGroups', () => {
  it('partitions every line into exactly one category group, losing none', () => {
    const size = 5;
    const all = generateAllLines(size);
    const groups = buildLineGroups(size);
    const total = groups.orthogonal.lines.length + groups.face.lines.length + groups.space.lines.length;
    expect(total).toBe(all.length);
    // Each group holds only its own category.
    for (const cat of LINE_CATEGORIES) {
      for (const line of groups[cat].lines) {
        expect(line.category).toBe(cat);
      }
    }
  });

  it('assigns one segment instance per adjacent-node pair (segments = nodes − 1)', () => {
    const size = 5;
    const groups = buildLineGroups(size);
    for (const cat of LINE_CATEGORIES) {
      const g = groups[cat];
      let expectedSegments = 0;
      for (const line of g.lines) expectedSegments += line.nodes.length - 1;
      expect(g.segmentCount).toBe(expectedSegments);
    }
  });

  it('gives each line a contiguous, non-overlapping instance range covering its group', () => {
    const size = 5;
    const groups = buildLineGroups(size);
    for (const cat of LINE_CATEGORIES) {
      const g = groups[cat];
      let cursor = 0;
      for (const line of g.lines) {
        const range = g.rangeOf.get(line.id);
        expect(range).toBeDefined();
        expect(range!.start).toBe(cursor);
        expect(range!.count).toBe(line.nodes.length - 1);
        cursor += range!.count;
      }
      // Ranges exactly tile [0, segmentCount): the running cursor lands on the total.
      expect(cursor).toBe(g.segmentCount);
    }
  });

  it('rangeOf resolves a known lineId to its own range and returns undefined for an unknown id', () => {
    const groups = buildLineGroups(4);
    const orth = groups.orthogonal;
    const firstId = orth.lines[0]!.id;
    const range = orth.rangeOf.get(firstId);
    expect(range).toEqual({ start: 0, count: orth.lines[0]!.nodes.length - 1 });
    expect(orth.rangeOf.get('9,9,9|0')).toBeUndefined();
  });

  it('segment endpoints are consecutive nodes of the owning line', () => {
    const groups = buildLineGroups(4);
    const g = groups.orthogonal;
    const line = g.lines[0]!;
    const range = g.rangeOf.get(line.id)!;
    for (let s = 0; s < range.count; s++) {
      const seg = g.segments[range.start + s]!;
      expect(seg.a).toEqual(line.nodes[s]);
      expect(seg.b).toEqual(line.nodes[s + 1]);
      expect(seg.lineId).toBe(line.id);
    }
  });

  it('on a 3-cube the orthogonal group has 27 lines and 54 segments (3 axes × 9 lines × 2)', () => {
    // N=3: each axis has N² = 9 full lines, each spanning N=3 nodes → 2 segments.
    const groups = buildLineGroups(3);
    expect(groups.orthogonal.lines.length).toBe(27);
    expect(groups.orthogonal.segmentCount).toBe(54);
  });
});

describe('resolveLineLayout', () => {
  it('attaches the resolved visibility + blending to each group', () => {
    const layout = resolveLineLayout(5, {
      orthogonal: true,
      faceDiagonal: false,
      spaceDiagonal: true,
    }, blendAll);
    expect(layout.orthogonal.visible).toBe(true);
    expect(layout.face.visible).toBe(false);
    expect(layout.space.visible).toBe(true);
    expect(layout.orthogonal.blending).toBe('additive');
  });

  it('preserves the per-group segment geometry independent of visibility', () => {
    // Hidden groups still carry their full instance buffer (glue toggles a flag, does
    // not rebuild) — proves visibility is a flag, not a filter on segments.
    const visible = resolveLineLayout(5, visibleAll, blendAll);
    const hiddenFace = resolveLineLayout(5, { ...visibleAll, faceDiagonal: false }, blendAll);
    expect(hiddenFace.face.visible).toBe(false);
    expect(hiddenFace.face.segmentCount).toBe(visible.face.segmentCount);
    expect(hiddenFace.face.segments.length).toBe(visible.face.segments.length);
  });

  it('carries the distinct blending mode per category', () => {
    const layout = resolveLineLayout(4, visibleAll, {
      orthogonal: 'additive',
      faceDiagonal: 'normal',
      spaceDiagonal: 'additive',
    });
    expect(layout.orthogonal.blending).toBe('additive');
    expect(layout.face.blending).toBe('normal');
    expect(layout.space.blending).toBe('additive');
  });
});
