import { describe, it, expect } from 'vitest';
import { resolveLayout, type LayoutConfig } from './layout.ts';

/**
 * Task 5.1 — the PURE zone-based layout resolver (render-ui design Part 6). Given the `layout`
 * config (`widgetId → { zone, order, visible, offset }`) and the set of ids that actually have a
 * registered factory, it yields the ordered visible widgets per zone. Strict unit + mutation
 * gate: genuine assertions on the resolved plan plus the mandated negative cases —
 *   - hidden widgets dropped;
 *   - unknown ids (no registered factory) ignored gracefully;
 *   - widgets ordered within a zone by ascending `order`, id as the deterministic tiebreak;
 *   - reordering the config reorders the output.
 * No THREE, no DOM.
 */

const known = (...ids: string[]) => new Set(ids);

describe('resolveLayout — grouping + ordering', () => {
  it('groups widgets by zone and orders each zone by ascending `order`', () => {
    const config: LayoutConfig = {
      widgets: {
        a: { zone: 'top-left', order: 2, visible: true },
        b: { zone: 'top-left', order: 0, visible: true },
        c: { zone: 'top-left', order: 1, visible: true },
        d: { zone: 'bottom-center', order: 0, visible: true },
      },
    };
    const resolved = resolveLayout(config, known('a', 'b', 'c', 'd'));

    // top-left holds b(0), c(1), a(2) — sorted by order, NOT config-key order.
    expect(resolved.zones['top-left']!.map((w) => w.id)).toEqual(['b', 'c', 'a']);
    expect(resolved.zones['top-left']!.map((w) => w.order)).toEqual([0, 1, 2]);
    // bottom-center is its own zone with just d.
    expect(resolved.zones['bottom-center']!.map((w) => w.id)).toEqual(['d']);
    // Exactly those two zones are populated — no empty/extra zones.
    expect(Object.keys(resolved.zones).sort()).toEqual(['bottom-center', 'top-left']);
  });

  it('breaks an `order` tie by widget id, deterministically (not config-key order)', () => {
    // Keys inserted high-id-first; a naive "keep insertion order" would yield [z, a].
    const config: LayoutConfig = {
      widgets: {
        z: { zone: 'left', order: 5, visible: true },
        a: { zone: 'left', order: 5, visible: true },
      },
    };
    const resolved = resolveLayout(config, known('a', 'z'));
    expect(resolved.zones['left']!.map((w) => w.id)).toEqual(['a', 'z']);
  });

  it('breaks ties among several ids so the id comparator resolves BOTH directions', () => {
    // Multiple all-tied ids inserted shuffled (not already sorted, not reverse-sorted): the sort
    // must swap some adjacent pairs (id > other → +1) and keep others (id < other → −1),
    // exercising both arms of the id tiebreak. Result is the ids in ascending id order.
    const config: LayoutConfig = {
      widgets: {
        d: { zone: 'left', order: 0, visible: true },
        b: { zone: 'left', order: 0, visible: true },
        a: { zone: 'left', order: 0, visible: true },
        c: { zone: 'left', order: 0, visible: true },
      },
    };
    const resolved = resolveLayout(config, known('a', 'b', 'c', 'd'));
    expect(resolved.zones['left']!.map((w) => w.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('reordering the config (swapping `order`) reorders the output', () => {
    const base = {
      one: { zone: 'top-center', visible: true },
      two: { zone: 'top-center', visible: true },
    };
    const first = resolveLayout(
      { widgets: { one: { ...base.one, order: 0 }, two: { ...base.two, order: 1 } } },
      known('one', 'two'),
    );
    const swapped = resolveLayout(
      { widgets: { one: { ...base.one, order: 1 }, two: { ...base.two, order: 0 } } },
      known('one', 'two'),
    );
    expect(first.zones['top-center']!.map((w) => w.id)).toEqual(['one', 'two']);
    expect(swapped.zones['top-center']!.map((w) => w.id)).toEqual(['two', 'one']);
  });
});

describe('resolveLayout — hidden dropped (negative)', () => {
  it('drops a widget whose `visible` is false', () => {
    const config: LayoutConfig = {
      widgets: {
        shown: { zone: 'left', order: 0, visible: true },
        hidden: { zone: 'left', order: 1, visible: false },
      },
    };
    const resolved = resolveLayout(config, known('shown', 'hidden'));
    expect(resolved.zones['left']!.map((w) => w.id)).toEqual(['shown']);
  });

  it('omits a zone entirely when all its widgets are hidden', () => {
    const config: LayoutConfig = {
      widgets: {
        only: { zone: 'right', order: 0, visible: false },
      },
    };
    const resolved = resolveLayout(config, known('only'));
    expect(resolved.zones['right']).toBeUndefined();
    expect(Object.keys(resolved.zones)).toEqual([]);
  });
});

describe('resolveLayout — unknown id ignored (negative)', () => {
  it('ignores a layout entry whose id has no registered factory', () => {
    const config: LayoutConfig = {
      widgets: {
        real: { zone: 'top-right', order: 0, visible: true },
        ghost: { zone: 'top-right', order: 1, visible: true },
      },
    };
    // `ghost` is visible but NOT in knownIds → dropped, not thrown.
    const resolved = resolveLayout(config, known('real'));
    expect(resolved.zones['top-right']!.map((w) => w.id)).toEqual(['real']);
  });

  it('returns an empty plan (no throw) when NO ids are known', () => {
    const config: LayoutConfig = {
      widgets: { a: { zone: 'left', order: 0, visible: true } },
    };
    const resolved = resolveLayout(config, known());
    expect(resolved.zones).toEqual({});
  });

  it('drops a hidden AND unknown widget without touching the known one', () => {
    const config: LayoutConfig = {
      widgets: {
        keep: { zone: 'center', order: 0, visible: true },
        hiddenUnknown: { zone: 'center', order: 1, visible: false },
      },
    };
    const resolved = resolveLayout(config, known('keep'));
    expect(resolved.zones['center']!.map((w) => w.id)).toEqual(['keep']);
  });
});

describe('resolveLayout — offset passthrough', () => {
  it('passes an offset through verbatim on the resolved slot', () => {
    const config: LayoutConfig = {
      widgets: {
        nudged: { zone: 'left', order: 0, visible: true, offset: { x: 8, y: -4 } },
      },
    };
    const resolved = resolveLayout(config, known('nudged'));
    expect(resolved.zones['left']![0]!.offset).toEqual({ x: 8, y: -4 });
  });

  it('omits `offset` on the slot when the config has none', () => {
    const config: LayoutConfig = {
      widgets: { plain: { zone: 'left', order: 0, visible: true } },
    };
    const resolved = resolveLayout(config, known('plain'));
    const slot = resolved.zones['left']![0]!;
    expect(slot.offset).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(slot, 'offset')).toBe(false);
  });
});

describe('resolveLayout — empty config', () => {
  it('yields an empty plan for an empty widget map', () => {
    const resolved = resolveLayout({ widgets: {} }, known('anything'));
    expect(resolved.zones).toEqual({});
  });
});
