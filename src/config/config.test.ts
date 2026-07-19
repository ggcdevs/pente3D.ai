/**
 * Tests for the layered config store (build plan Task 2.3).
 *
 * The config store resolves a section by deep-merging a localStorage override
 * over the tracked JSON default. Every assertion is on an observed return value
 * (the merged object, the fallback default, the persisted override) — never on a
 * log line (agent-principles #3). Negative cases (invalid override, corrupt
 * record, unknown key) are covered explicitly: an invalid override must fall back
 * to the default and never throw.
 *
 * `localStorage` is not a global in the node test environment. The config store
 * takes an injectable `Storage`, so these tests drive it with a tiny in-memory
 * implementation — the real behavior (read/write/parse/merge/reset) is exercised
 * end-to-end, nothing about the unit under test is mocked.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  getConfig,
  setConfig,
  resetConfig,
  getDefault,
  overrideStorageKey,
  OVERRIDE_KEY_PREFIX,
  CONFIG_SECTIONS,
  type ConfigSection,
} from './config';

/** A spec-faithful in-memory `Storage` for driving the config store in tests. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

let storage: Storage;
beforeEach(() => {
  storage = memoryStorage();
});

describe('getConfig — defaults', () => {
  it('returns the tracked default for a section when no override is stored', () => {
    const kb = getConfig('keybindings', storage);
    expect(kb.d).toBe('showAllDiagonals');
    expect(kb.u).toBe('undo');
    expect(kb.Escape).toBe('closeModal');
  });

  it('exposes the relay SSOT (wssUrl/username/password/topicRoot) as the default', () => {
    const relay = getConfig('relay', storage);
    expect(relay.wssUrl).toBe('wss://api.shitchell.com/289d700bfbd3-mqtt');
    expect(relay.username).toBe('pente');
    expect(relay.password).toBe('01cdb6fbbccb8a5d149027a14e37ef7bec9f76a66f7f1e58');
    expect(relay.topicRoot).toBe('pente/v1');
  });

  it('returns lineVisibility with orthogonal shown by default', () => {
    const lv = getConfig('lineVisibility', storage);
    expect(lv).toEqual({
      orthogonal: true,
      faceDiagonal: false,
      spaceDiagonal: false,
    });
  });

  it('getDefault returns a fresh deep copy each call (callers cannot mutate the shared default)', () => {
    const a = getDefault('lineVisibility') as Record<string, unknown>;
    a.orthogonal = false;
    const b = getDefault('lineVisibility') as Record<string, unknown>;
    expect(b.orthogonal).toBe(true);
  });
});

describe('getConfig — deep merge of overrides', () => {
  it('deep-merges a partial override over the default, keeping untouched keys', () => {
    // Override only the orbitButton of the fusion360 preset; everything else must survive.
    // Use a distinctive value ('right') so we can prove it did not leak into the web preset.
    storage.setItem(
      overrideStorageKey('controls'),
      JSON.stringify({ presets: { fusion360: { orbitButton: 'right' } } }),
    );
    // getConfig('controls') is typed from the JSON default, so preset names are
    // known keys — no index access, no `noUncheckedIndexedAccess` undefined.
    const controls = getConfig('controls', storage);
    expect(controls.preset).toBe('fusion360'); // untouched default
    expect(controls.presets.fusion360.orbitButton).toBe('right'); // overridden
    expect(controls.presets.fusion360.panModifier).toBe('shift'); // sibling untouched
    expect(controls.presets.fusion360.zoomToCursor).toBe(true); // sibling untouched
    expect(controls.presets.web.orbitButton).toBe('left'); // other preset untouched — override did NOT leak
    expect(controls.presets.web.panModifier).toBe('ctrl'); // untouched
  });

  it('a top-level override can flip a single boolean without dropping the others', () => {
    storage.setItem(
      overrideStorageKey('lineVisibility'),
      JSON.stringify({ faceDiagonal: true }),
    );
    expect(getConfig('lineVisibility', storage)).toEqual({
      orthogonal: true,
      faceDiagonal: true,
      spaceDiagonal: false,
    });
  });

  it('an override key not present in the default is added (merge, not intersect)', () => {
    storage.setItem(
      overrideStorageKey('keybindings'),
      JSON.stringify({ x: 'customCommand' }),
    );
    // 'x' is not in the default type; the merge adds it, so read it as a record.
    const kb = getConfig('keybindings', storage) as Record<string, string>;
    expect(kb.x).toBe('customCommand');
    expect(kb.d).toBe('showAllDiagonals'); // default still present
  });

  it('does not mutate the tracked default across calls when an override is applied', () => {
    storage.setItem(
      overrideStorageKey('lineVisibility'),
      JSON.stringify({ orthogonal: false }),
    );
    getConfig('lineVisibility', storage); // apply once
    storage.clear();
    // With the override gone, the default must be pristine.
    expect(getConfig('lineVisibility', storage).orthogonal).toBe(true);
  });
});

describe('setConfig — persist overrides', () => {
  it('persists an override that a subsequent getConfig deep-merges', () => {
    setConfig('lineVisibility', { spaceDiagonal: true }, storage);
    expect(getConfig('lineVisibility', storage)).toEqual({
      orthogonal: true,
      faceDiagonal: false,
      spaceDiagonal: true,
    });
  });

  it('the persisted record is the override only, not the full merged object', () => {
    setConfig('lineVisibility', { spaceDiagonal: true }, storage);
    const raw = storage.getItem(overrideStorageKey('lineVisibility'));
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({ spaceDiagonal: true });
  });

  it('with no store (null) setConfig is a no-op that does not throw and getConfig stays default', () => {
    expect(() => setConfig('lineVisibility', { spaceDiagonal: true }, null)).not.toThrow();
    // Nothing was persisted anywhere; a real store still yields the pristine default.
    expect(getConfig('lineVisibility', storage).spaceDiagonal).toBe(false);
  });

  it('deep-merges successive setConfig calls rather than replacing the override', () => {
    setConfig('lineVisibility', { faceDiagonal: true }, storage);
    setConfig('lineVisibility', { spaceDiagonal: true }, storage);
    expect(getConfig('lineVisibility', storage)).toEqual({
      orthogonal: true,
      faceDiagonal: true,
      spaceDiagonal: true,
    });
  });
});

describe('resetConfig — restore defaults', () => {
  it('removes the stored override so getConfig returns the pristine default', () => {
    setConfig('lineVisibility', { orthogonal: false, spaceDiagonal: true }, storage);
    expect(getConfig('lineVisibility', storage).orthogonal).toBe(false);
    resetConfig('lineVisibility', storage);
    expect(getConfig('lineVisibility', storage)).toEqual({
      orthogonal: true,
      faceDiagonal: false,
      spaceDiagonal: false,
    });
    expect(storage.getItem(overrideStorageKey('lineVisibility'))).toBeNull();
  });

  it('resetting a section with no override is a no-op that does not throw', () => {
    expect(() => resetConfig('colors', storage)).not.toThrow();
    expect(getConfig('colors', storage).background).toBe('#101014');
  });

  it('with no store (null) resetConfig is a no-op that does not throw', () => {
    // A previously-persisted override in a real store must be untouched by a null-store reset.
    setConfig('lineVisibility', { orthogonal: false }, storage);
    expect(() => resetConfig('lineVisibility', null)).not.toThrow();
    expect(getConfig('lineVisibility', storage).orthogonal).toBe(false);
  });
});

describe('invalid / corrupt overrides fall back to default (never throw)', () => {
  it('corrupt JSON in storage falls back to the default', () => {
    storage.setItem(overrideStorageKey('keybindings'), '{ this is not json');
    expect(() => getConfig('keybindings', storage)).not.toThrow();
    expect(getConfig('keybindings', storage).d).toBe('showAllDiagonals');
  });

  it('a JSON scalar (non-object) override is rejected and the default is used', () => {
    storage.setItem(overrideStorageKey('lineVisibility'), '42');
    expect(getConfig('lineVisibility', storage)).toEqual({
      orthogonal: true,
      faceDiagonal: false,
      spaceDiagonal: false,
    });
  });

  it('a JSON array override is rejected (not a section object) and the default is used', () => {
    storage.setItem(overrideStorageKey('colors'), '[1,2,3]');
    expect(getConfig('colors', storage).background).toBe('#101014');
  });

  it('a null override is rejected and the default is used', () => {
    storage.setItem(overrideStorageKey('relay'), 'null');
    expect(getConfig('relay', storage).topicRoot).toBe('pente/v1');
  });

  it('works with no Storage at all (undefined) — returns the plain default', () => {
    expect(getConfig('lineVisibility', undefined).orthogonal).toBe(true);
    expect(() => getConfig('lineVisibility', undefined)).not.toThrow();
  });
});

describe('overrideStorageKey — exact namespaced key', () => {
  it('exposes the namespace prefix "pente:config:" verbatim', () => {
    // Pins the literal SSOT prefix so it cannot silently change (or be emptied).
    expect(OVERRIDE_KEY_PREFIX).toBe('pente:config:');
  });

  it('builds the key as `<prefix><section>` for every section (exact string)', () => {
    // Assert the concrete composed key, not just `startsWith` — an empty prefix or
    // an empty template body would both change these exact strings.
    expect(overrideStorageKey('relay')).toBe('pente:config:relay');
    expect(overrideStorageKey('lineVisibility')).toBe('pente:config:lineVisibility');
    expect(overrideStorageKey('colors')).toBe('pente:config:colors');
    for (const section of CONFIG_SECTIONS) {
      expect(overrideStorageKey(section)).toBe(`pente:config:${section}`);
    }
  });
});

describe('deep merge — a scalar override replaces an object-valued default wholesale', () => {
  it('overriding an object-valued key with a scalar replaces it (not a no-op merge)', () => {
    // `controls.presets` is an object in the default. Overriding it with a STRING
    // must replace it wholesale. This distinguishes the merge guard `&&` from `||`:
    // with `||`, deepMerge would recurse into a scalar (Object.entries('x') === [])
    // and silently keep the object default, dropping the caller's scalar. Assert the
    // scalar actually wins.
    storage.setItem(
      overrideStorageKey('controls'),
      JSON.stringify({ presets: 'replaced-by-scalar' }),
    );
    const controls = getConfig('controls', storage) as unknown as {
      presets: unknown;
      preset: string;
    };
    expect(controls.presets).toBe('replaced-by-scalar');
    // A sibling scalar key at the same level is untouched by the object→scalar swap.
    expect(controls.preset).toBe('fusion360');
  });

  it('overriding a scalar-valued default key with an object replaces it wholesale too', () => {
    // The mirror direction: `preset` is a string default; an object override at that
    // key must replace it wholesale (base scalar is not a plain object, so `&&`/`||`
    // both take the else-branch here — this pins the wholesale-replace behavior).
    storage.setItem(
      overrideStorageKey('controls'),
      JSON.stringify({ preset: { nowAn: 'object' } }),
    );
    const controls = getConfig('controls', storage) as unknown as {
      preset: unknown;
    };
    expect(controls.preset).toEqual({ nowAn: 'object' });
  });
});

describe('render config sections (Task 4.2)', () => {
  // These sections back the Three.js render layer (render-ui design Part 4). They are
  // resolved through the same layered store, so the assertions below drive the real
  // getConfig/deep-merge/fallback path — the section values are observed, not inferred.

  it('colors gains a tempPiece entry alongside the existing palette', () => {
    // The temporary translucent piece (game-core: temp placement mode) needs its own
    // color; the render-ui design Part 4 lists it explicitly in the `colors` surface.
    const colors = getConfig('colors', storage);
    expect(colors.tempPiece).toBe('#4a90d9');
    // Existing palette entries must survive the expansion (no regression).
    expect(colors.background).toBe('#101014');
    expect(colors.emptySphere).toBe('#5a5a66');
    expect(colors.whitePiece).toBe('#f0f0f0');
    expect(colors.blackPiece).toBe('#1a1a1a');
    expect(colors.hoverHighlight).toBe('#ffd24a');
    expect(colors.winningLine).toBe('#4aff7a');
  });

  it('rendering exposes per-element roughness/metalness and an emissive boost', () => {
    const r = getConfig('rendering', storage);
    expect(r.piece.roughness).toBe(0.35);
    expect(r.piece.metalness).toBe(0.1);
    expect(r.marker.roughness).toBe(0.8);
    expect(r.marker.metalness).toBe(0);
    expect(r.emissiveBoost).toBe(0.6);
  });

  it('materials exposes marker/line opacity and depthWrite toggles', () => {
    const m = getConfig('materials', storage);
    expect(m.markerOpacity).toBe(0.55);
    expect(m.markerDepthWrite).toBe(false);
    expect(m.pieceOpacity).toBe(1);
    expect(m.tempPieceOpacity).toBe(0.4);
  });

  it('lighting exposes ambient + directional color/intensity/position', () => {
    const l = getConfig('lighting', storage);
    expect(l.ambient.color).toBe('#ffffff');
    expect(l.ambient.intensity).toBe(0.6);
    expect(l.directional.color).toBe('#ffffff');
    expect(l.directional.intensity).toBe(0.8);
    expect(l.directional.position).toEqual({ x: 5, y: 10, z: 7 });
  });

  it('geometry exposes marker/piece radius, line thickness and sphere segments', () => {
    const g = getConfig('geometry', storage);
    expect(g.spacing).toBe(2);
    expect(g.markerRadius).toBe(0.14);
    expect(g.pieceRadius).toBe(0.42);
    expect(g.lineThickness).toBe(0.02);
    expect(g.sphereSegments).toEqual({ width: 16, height: 12 });
  });

  it('blending exposes additive-vs-normal per line category', () => {
    const b = getConfig('blending', storage);
    expect(b.orthogonal).toBe('additive');
    expect(b.faceDiagonal).toBe('additive');
    expect(b.spaceDiagonal).toBe('additive');
  });

  it('deep-merges a partial override into a nested render section (real store path)', () => {
    // Overriding only rendering.piece.roughness must keep the sibling metalness and the
    // marker sub-object intact — the same deep-merge contract as every other section.
    storage.setItem(
      overrideStorageKey('rendering'),
      JSON.stringify({ piece: { roughness: 0.99 } }),
    );
    const r = getConfig('rendering', storage);
    expect(r.piece.roughness).toBe(0.99); // overridden
    expect(r.piece.metalness).toBe(0.1); // sibling untouched
    expect(r.marker.roughness).toBe(0.8); // sibling sub-object untouched
    expect(r.emissiveBoost).toBe(0.6); // untouched
  });

  it('a corrupt override on a render section falls back to the pristine default', () => {
    storage.setItem(overrideStorageKey('lighting'), '{ not json');
    expect(() => getConfig('lighting', storage)).not.toThrow();
    expect(getConfig('lighting', storage).ambient.intensity).toBe(0.6);
  });

  it('resetConfig restores a render section to its tracked default', () => {
    setConfig('geometry', { markerRadius: 0.99 }, storage);
    expect(getConfig('geometry', storage).markerRadius).toBe(0.99);
    resetConfig('geometry', storage);
    expect(getConfig('geometry', storage).markerRadius).toBe(0.14);
  });
});

describe('sections registry', () => {
  it('exposes exactly the eleven required sections', () => {
    expect([...CONFIG_SECTIONS].sort()).toEqual(
      [
        'blending',
        'colors',
        'controls',
        'geometry',
        'keybindings',
        'layout',
        'lighting',
        'lineVisibility',
        'materials',
        'relay',
        'rendering',
      ].sort(),
    );
  });

  it('every registered section has a loadable default object', () => {
    for (const section of CONFIG_SECTIONS) {
      const def = getDefault(section);
      expect(def).toBeTypeOf('object');
      expect(def).not.toBeNull();
    }
  });
});

describe('property: merge invariants', () => {
  const scalarOverride = fc.dictionary(
    fc.constantFrom('orthogonal', 'faceDiagonal', 'spaceDiagonal'),
    fc.boolean(),
  );

  it('every key set by an override appears verbatim in the merged result', () => {
    fc.assert(
      fc.property(scalarOverride, (override) => {
        const s = memoryStorage();
        s.setItem(overrideStorageKey('lineVisibility'), JSON.stringify(override));
        const merged = getConfig('lineVisibility', s) as Record<string, boolean>;
        for (const [k, v] of Object.entries(override)) {
          expect(merged[k]).toBe(v);
        }
      }),
    );
  });

  it('keys absent from the override retain their default value', () => {
    const def = getDefault('lineVisibility') as Record<string, boolean>;
    fc.assert(
      fc.property(scalarOverride, (override) => {
        const s = memoryStorage();
        s.setItem(overrideStorageKey('lineVisibility'), JSON.stringify(override));
        const merged = getConfig('lineVisibility', s) as Record<string, boolean>;
        for (const k of Object.keys(def)) {
          if (!(k in override)) {
            expect(merged[k]).toBe(def[k]);
          }
        }
      }),
    );
  });

  it('any non-object JSON override falls back to the exact default and never throws', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer(),
          fc.boolean(),
          fc.string(),
          fc.constant(null),
          fc.array(fc.integer()),
        ),
        (scalar) => {
          const s = memoryStorage();
          s.setItem(overrideStorageKey('lineVisibility'), JSON.stringify(scalar));
          const def = getDefault('lineVisibility');
          expect(getConfig('lineVisibility', s)).toEqual(def);
        },
      ),
    );
  });

  // A type guard so the section literal handed to the store is exhaustive-checked.
  it('ConfigSection type covers every runtime section', () => {
    const sections: ConfigSection[] = [...CONFIG_SECTIONS];
    expect(sections.length).toBe(CONFIG_SECTIONS.length);
  });
});
