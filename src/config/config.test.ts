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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import {
  getConfig,
  setConfig,
  resetConfig,
  getDefault,
  onConfigChange,
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

  it('ships a BLANK relay default (creds injected at deploy from the RELAY_CONFIG repo variable; issue #22)', () => {
    // The tracked default is intentionally blank so the repo is portable and holds no
    // endpoint/creds — the GitHub Actions deploy overwrites relay.json from the
    // `RELAY_CONFIG` repo variable. Blank wssUrl/username/password means networked
    // host/join fails GRACEFULLY (mqtt.connect('') → ECONNREFUSED, honest error) while
    // LOCAL play is unaffected. Developers supply their own relay locally via the
    // localStorage override (see README "Local relay for dev"). topicRoot stays pinned
    // to the protocol namespace so it is never a secret.
    const relay = getConfig('relay', storage);
    expect(relay.wssUrl).toBe('');
    expect(relay.username).toBe('');
    expect(relay.password).toBe('');
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

  it('returns the interaction drag-guard default: enabled with a positive px threshold (issue #1)', () => {
    const interaction = getConfig('interaction', storage);
    // DEFAULT ENABLED — the drag-vs-click guard is on out of the box.
    expect(interaction.dragGuard.enabled).toBe(true);
    expect(interaction.dragGuard.thresholdPx).toBe(6);
  });

  it('returns the board-size default (Task 5.4 SSOT the scene reads for N)', () => {
    // The scene resolves its board edge length from this section (no magic value in scene.ts);
    // the settings modal writes it via setConfig. Assert the concrete default the scene renders.
    const board = getConfig('board', storage);
    expect(board.size).toBe(5);
  });

  it('persists + reads back a board-size override (the settings-modal write path)', () => {
    setConfig('board', { size: 7 }, storage);
    expect(getConfig('board', storage).size).toBe(7);
    // resetConfig restores the default (the modal's reset-to-defaults, per-section).
    resetConfig('board', storage);
    expect(getConfig('board', storage).size).toBe(5);
  });

  it('returns the notifications default (#20 SSOT: title-flash ON, browser-notification ON, sound OFF)', () => {
    // Design decision #20 (locked): the tab-title flash is on by default (no permission needed); the
    // browser Notification channel is on-BY-CONFIG but still gated by the runtime permission grant
    // (the pure decision layer treats config.browserNotification && permission-granted); sound is off.
    const notifications = getConfig('notifications', storage);
    expect(notifications).toEqual({ titleFlash: true, browserNotification: true, sound: false });
  });

  it('persists + reads back a notifications override, per-field (localStorage override path)', () => {
    // A user who opts out of the title flash keeps the other defaults (deep-merge over the default).
    setConfig('notifications', { titleFlash: false }, storage);
    expect(getConfig('notifications', storage)).toEqual({
      titleFlash: false,
      browserNotification: true,
      sound: false,
    });
    resetConfig('notifications', storage);
    expect(getConfig('notifications', storage)).toEqual({
      titleFlash: true,
      browserNotification: true,
      sound: false,
    });
  });
});

describe('getConfig — interaction.dragGuard (issue #1)', () => {
  it('a localStorage override can disable the guard, reverting to place-on-release', () => {
    storage.setItem(
      overrideStorageKey('interaction'),
      JSON.stringify({ dragGuard: { enabled: false } }),
    );
    const interaction = getConfig('interaction', storage);
    expect(interaction.dragGuard.enabled).toBe(false);
    // The sibling threshold survives the partial override (deep merge, not replace).
    expect(interaction.dragGuard.thresholdPx).toBe(6);
  });

  it('a localStorage override can raise the threshold while leaving enabled untouched', () => {
    storage.setItem(
      overrideStorageKey('interaction'),
      JSON.stringify({ dragGuard: { thresholdPx: 40 } }),
    );
    const interaction = getConfig('interaction', storage);
    expect(interaction.dragGuard.thresholdPx).toBe(40);
    expect(interaction.dragGuard.enabled).toBe(true); // sibling untouched
  });

  it('setConfig persists a partial override that getConfig deep-merges', () => {
    setConfig('interaction', { dragGuard: { enabled: false, thresholdPx: 12 } }, storage);
    const interaction = getConfig('interaction', storage);
    expect(interaction.dragGuard).toEqual({ enabled: false, thresholdPx: 12 });
  });

  it('a corrupt override falls back to the pristine default (never throws)', () => {
    storage.setItem(overrideStorageKey('interaction'), '{ not valid json');
    const interaction = getConfig('interaction', storage);
    expect(interaction.dragGuard).toEqual({ enabled: true, thresholdPx: 6 });
  });

  it('a scalar (non-object) override is rejected and the default is used', () => {
    storage.setItem(overrideStorageKey('interaction'), '99');
    expect(getConfig('interaction', storage).dragGuard).toEqual({
      enabled: true,
      thresholdPx: 6,
    });
  });
});

describe('getConfig — deep merge of overrides', () => {
  it('deep-merges a partial override over the default, keeping untouched keys', () => {
    // Override only the orbit gesture of the fusion360 preset; everything else must survive.
    // Use a distinctive value ('right') so we can prove it did not leak into the web preset.
    storage.setItem(
      overrideStorageKey('controls'),
      JSON.stringify({ presets: { fusion360: { orbit: 'right' } } }),
    );
    // getConfig('controls') is typed from the JSON default, so preset names are
    // known keys — no index access, no `noUncheckedIndexedAccess` undefined.
    const controls = getConfig('controls', storage);
    expect(controls.preset).toBe('fusion360'); // untouched default
    expect(controls.presets.fusion360.orbit).toBe('right'); // overridden
    expect(controls.presets.fusion360.pan).toBe('middle'); // sibling untouched
    expect(controls.presets.fusion360.zoomToCursor).toBe(true); // sibling untouched
    expect(controls.presets.web.orbit).toBe('left'); // other preset untouched — override did NOT leak
    expect(controls.presets.web.pan).toBe('ctrl+left'); // untouched
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
    // Optional pick-hitbox margin (issue #3): the extra radius added to a node's VISIBLE
    // size for its invisible pick sphere. Small, so empty-node hitboxes stay marker-sized.
    expect(g.pickPadding).toBe(0.03);
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
  it('exposes exactly the fourteen required sections', () => {
    expect([...CONFIG_SECTIONS].sort()).toEqual(
      [
        'blending',
        'board',
        'colors',
        'controls',
        'geometry',
        'interaction',
        'keybindings',
        'layout',
        'lighting',
        'lineVisibility',
        'materials',
        'notifications',
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

describe('onConfigChange — config-change notification (Task A.2, issue #15)', () => {
  // The change emitter is MODULE-GLOBAL (one config-owned notifier). Every subscription made in
  // a test is registered here and torn down after the test so listeners never leak across cases —
  // a leaked listener would fire on a LATER test's write and corrupt its counts. `track(off)`
  // returns the unsubscribe so a test can still call it early to exercise the unsubscribe path.
  let toClean: Array<() => void>;
  beforeEach(() => {
    toClean = [];
  });
  const track = (off: () => void): (() => void) => {
    toClean.push(off);
    return off;
  };
  // vitest afterEach via onTestFinished-style cleanup: run every tracked unsubscribe.
  afterEach(() => {
    for (const off of toClean) off();
  });

  it('setConfig notifies subscribers with the changed SECTION NAME after the write', () => {
    const seen: ConfigSection[] = [];
    track(onConfigChange((s) => seen.push(s)));
    setConfig('lineVisibility', { spaceDiagonal: true }, storage);
    // The delivered payload is the section NAME only — not the value.
    expect(seen).toEqual(['lineVisibility']);
  });

  it('the notification fires AFTER the write lands — a subscriber re-reading getConfig sees the NEW value', () => {
    // Proof-by-behavior: capture what getConfig returns at notification time. If emit ran BEFORE
    // setItem, the subscriber would still read the old default. It must read the new value.
    let observedAtNotify: boolean | undefined;
    track(
      onConfigChange((s) => {
        if (s === 'lineVisibility') {
          observedAtNotify = getConfig('lineVisibility', storage).spaceDiagonal;
        }
      }),
    );
    setConfig('lineVisibility', { spaceDiagonal: true }, storage);
    expect(observedAtNotify).toBe(true);
  });

  it('emits the SECTION NAME ONLY, never the written value (SSOT re-read contract)', () => {
    // Pin that the payload is exactly the string section id, not the partial/merged object.
    const payloads: unknown[] = [];
    track(onConfigChange((s) => payloads.push(s)));
    setConfig('geometry', { markerRadius: 0.99 }, storage);
    expect(payloads).toEqual(['geometry']);
    expect(typeof payloads[0]).toBe('string');
  });

  it('resetConfig notifies with the section name after removing the override', () => {
    setConfig('lineVisibility', { orthogonal: false }, storage);
    const seen: ConfigSection[] = [];
    track(onConfigChange((s) => seen.push(s)));
    resetConfig('lineVisibility', storage);
    expect(seen).toEqual(['lineVisibility']);
    // And the write really happened — the section is back to its default.
    expect(getConfig('lineVisibility', storage).orthogonal).toBe(true);
  });

  it('resetConfig on a store with NO existing override still notifies (the write path ran)', () => {
    // removeItem executes whether or not a key existed; the reset write path ran, so networked /
    // programmatic resetters get a notification to re-apply the default. (Distinct from the
    // null-store case below, where no store means no write and no emit.)
    const seen: ConfigSection[] = [];
    track(onConfigChange((s) => seen.push(s)));
    resetConfig('colors', storage);
    expect(seen).toEqual(['colors']);
  });

  it('setConfig with NO store (null) is a no-op that does NOT notify (nothing was written)', () => {
    const listener = vi.fn();
    track(onConfigChange(listener));
    setConfig('lineVisibility', { spaceDiagonal: true }, null);
    expect(listener).not.toHaveBeenCalled();
  });

  it('resetConfig with NO store (null) is a no-op that does NOT notify (nothing was written)', () => {
    const listener = vi.fn();
    track(onConfigChange(listener));
    resetConfig('lineVisibility', null);
    expect(listener).not.toHaveBeenCalled();
  });

  it('a listener for one section is still called on a DIFFERENT section change (single emitter) — but can filter by name', () => {
    // The notifier is ONE emitter carrying the section name; listeners self-filter. Prove the
    // payload lets a listener ignore sections it does not care about (the wiring pattern) while
    // still being invoked. This pins that the SECTION NAME is what discriminates delivery.
    const relevant: ConfigSection[] = [];
    track(
      onConfigChange((s) => {
        if (s === 'geometry') relevant.push(s);
      }),
    );
    setConfig('lineVisibility', { spaceDiagonal: true }, storage); // ignored by the filter
    setConfig('geometry', { markerRadius: 0.5 }, storage); // acted on
    expect(relevant).toEqual(['geometry']);
  });

  it('unsubscribe stops delivery — a torn-down listener receives no further notifications', () => {
    const seen: ConfigSection[] = [];
    const off = onConfigChange((s) => seen.push(s));
    setConfig('lineVisibility', { spaceDiagonal: true }, storage);
    off();
    setConfig('geometry', { markerRadius: 0.5 }, storage);
    // Only the pre-unsubscribe write was delivered.
    expect(seen).toEqual(['lineVisibility']);
  });

  it('two subscribers both receive the same change; unsubscribing one leaves the other', () => {
    const a: ConfigSection[] = [];
    const b: ConfigSection[] = [];
    const offA = onConfigChange((s) => a.push(s));
    track(onConfigChange((s) => b.push(s)));
    setConfig('colors', { background: '#000000' }, storage);
    expect(a).toEqual(['colors']);
    expect(b).toEqual(['colors']);
    offA();
    resetConfig('colors', storage);
    expect(a).toEqual(['colors']); // a is gone
    expect(b).toEqual(['colors', 'colors']); // b still receives
  });

  it('a listener that THROWS propagates the error out of setConfig (not masked) — and the write already landed', () => {
    // agent-principles: errors propagate honestly and are never swallowed. The emitter does not
    // wrap listeners in try/catch, so a broken subscriber surfaces to the writer's caller. Crucially
    // the WRITE happened first, so the store is NOT corrupted — the throw only signals the bad
    // subscriber. We assert the EXACT error propagates and the persisted value is intact.
    const boom = new Error('subscriber blew up');
    track(
      onConfigChange(() => {
        throw boom;
      }),
    );
    expect(() => setConfig('geometry', { markerRadius: 0.77 }, storage)).toThrow(boom);
    // The write landed before the throw — durable state is correct despite the broken listener.
    expect(getConfig('geometry', storage).markerRadius).toBe(0.77);
  });

  it('the pure resolvers do NOT notify — reading config never fires a change (no listener leak into getConfig)', () => {
    // getConfig / getDefault are pure reads; only the two WRITERS notify. A read firing a change
    // event would be a side effect leaking into the pure path — assert it does not happen.
    const listener = vi.fn();
    track(onConfigChange(listener));
    getConfig('lineVisibility', storage);
    getDefault('colors');
    getConfig('relay', storage);
    expect(listener).not.toHaveBeenCalled();
  });

  it('property: every setConfig write on a real store delivers exactly its own section name, once', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...CONFIG_SECTIONS), { minLength: 0, maxLength: 12 }),
        (sections) => {
          const s = memoryStorage();
          const seen: ConfigSection[] = [];
          const off = onConfigChange((sec) => seen.push(sec));
          try {
            for (const sec of sections) setConfig(sec, {}, s);
            // One notification per write, in order, each carrying its own section name.
            expect(seen).toEqual(sections);
          } finally {
            off();
          }
        },
      ),
    );
  });
});
