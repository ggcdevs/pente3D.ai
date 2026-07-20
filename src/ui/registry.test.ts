import { describe, it, expect } from 'vitest';
import { createWidgetRegistry, type Widget, type WidgetFactory } from './registry.ts';

/**
 * Task 5.1 — the PURE widget registry (design Part 6). Maps `widgetId → factory`; the container
 * asks it for a factory by id. Strict unit + mutation gate: genuine assertions on lookup + the
 * known-id set, plus the mandated negative/asymmetry cases —
 *   - a DUPLICATE id at construction THROWS (authoring bug, never silently overwritten);
 *   - looking up an UNKNOWN id returns `undefined` (a graceful miss for a stale layout id).
 * No THREE, no DOM: the factory's `mount` is stubbed to a plain object, never invoked here.
 */

/** A test factory that never actually mounts (we only assert on the registry structure). */
function fakeFactory(id: string): WidgetFactory {
  return {
    id,
    mount(): Widget {
      throw new Error('mount is DOM glue — not exercised by the pure registry test');
    },
  };
}

describe('createWidgetRegistry — lookup', () => {
  it('registers each factory under its id and returns it via get', () => {
    const a = fakeFactory('a');
    const b = fakeFactory('b');
    const reg = createWidgetRegistry([a, b]);
    expect(reg.get('a')).toBe(a);
    expect(reg.get('b')).toBe(b);
    expect(reg.has('a')).toBe(true);
    expect(reg.has('b')).toBe(true);
  });

  it('ids() returns exactly the registered ids', () => {
    const reg = createWidgetRegistry([fakeFactory('x'), fakeFactory('y'), fakeFactory('z')]);
    expect(reg.ids().sort()).toEqual(['x', 'y', 'z']);
  });

  it('knownIds() returns a Set of exactly the registered ids', () => {
    const reg = createWidgetRegistry([fakeFactory('p'), fakeFactory('q')]);
    const known = reg.knownIds();
    expect(known).toBeInstanceOf(Set);
    expect([...known].sort()).toEqual(['p', 'q']);
    expect(known.has('p')).toBe(true);
    expect(known.has('nope')).toBe(false);
  });

  it('an empty registry has no ids and knows nothing', () => {
    const reg = createWidgetRegistry([]);
    expect(reg.ids()).toEqual([]);
    expect(reg.knownIds().size).toBe(0);
    expect(reg.has('anything')).toBe(false);
  });
});

describe('createWidgetRegistry — unknown id (graceful miss, negative)', () => {
  it('get returns undefined and has returns false for an unregistered id', () => {
    const reg = createWidgetRegistry([fakeFactory('only')]);
    expect(reg.get('missing')).toBeUndefined();
    expect(reg.has('missing')).toBe(false);
  });
});

describe('createWidgetRegistry — duplicate id (throws, negative)', () => {
  it('throws on two factories sharing an id, naming the id', () => {
    expect(() => createWidgetRegistry([fakeFactory('dup'), fakeFactory('dup')])).toThrow(
      /duplicate widget id: "dup"/,
    );
  });

  it('does NOT throw when ids are distinct (the guard is specific to collisions)', () => {
    expect(() => createWidgetRegistry([fakeFactory('one'), fakeFactory('two')])).not.toThrow();
  });
});
