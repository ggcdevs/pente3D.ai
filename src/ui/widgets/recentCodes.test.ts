import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import {
  listRecentCodes,
  recordRecentCode,
  clearRecentCodes,
  RECENT_CODES_CAP,
  RECENT_CODES_KEY,
} from './recentCodes.ts';
import { generateGameCode, validateGameCode, CODE_ALPHABET, CODE_LENGTH } from './netModel.ts';

/**
 * PURE recent-game-codes store tests (Task C.1 — issue #13 picker "saved" list). Strict, genuine
 * assertions on the exact stored/listed values (agent-principles: specific expected values, never "it
 * ran"), with negative cases for every degrade-to-empty path (missing / corrupt / non-array / bad
 * entries), the dedupe/cap/newest-first invariant, the null-store no-op, and the round-trip that a
 * GENERATED code is always recordable+listable. The store is driven by an injected in-memory Storage,
 * exactly like config.test.ts, so it runs in node with no DOM.
 */

/** A spec-faithful in-memory `Storage`, mirroring config.test.ts's `memoryStorage`. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

/** A valid 6-char code fixture built from the alphabet (avoids hard-coding a length-specific literal). */
function code(seed: number): string {
  const a = CODE_ALPHABET;
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += a[(seed + i) % a.length];
  return s;
}

let storage: Storage;
beforeEach(() => {
  storage = memoryStorage();
});

describe('listRecentCodes — empty / degrade paths (never throws)', () => {
  it('returns [] when nothing has been stored', () => {
    expect(listRecentCodes(storage)).toEqual([]);
  });

  it('returns [] with no Storage at all (undefined resolves to absent global)', () => {
    // No globalThis.localStorage in the node test env → resolves null → [] (does not throw).
    expect(listRecentCodes()).toEqual([]);
  });

  it('returns [] when Storage is explicitly null (forced no-store)', () => {
    expect(listRecentCodes(null)).toEqual([]);
  });

  it('degrades unparseable JSON to [] (no throw)', () => {
    storage.setItem(RECENT_CODES_KEY, '{ not valid json');
    expect(listRecentCodes(storage)).toEqual([]);
  });

  it('degrades a non-array JSON value (object) to []', () => {
    storage.setItem(RECENT_CODES_KEY, JSON.stringify({ codes: [code(0)] }));
    expect(listRecentCodes(storage)).toEqual([]);
  });

  it('degrades a non-array JSON scalar (number) to []', () => {
    storage.setItem(RECENT_CODES_KEY, '42');
    expect(listRecentCodes(storage)).toEqual([]);
  });

  it('drops non-string entries inside an otherwise-valid array (keeps the valid ones)', () => {
    const good = code(0);
    storage.setItem(RECENT_CODES_KEY, JSON.stringify([good, 5, null, { x: 1 }, [good]]));
    expect(listRecentCodes(storage)).toEqual([good]);
  });

  it('drops malformed string entries (too short / bad chars) and canonicalizes the rest', () => {
    const good = code(3);
    // 'abc' too short, 'ABC230' has an excluded glyph '0' → both dropped; a lower-case valid code
    // is canonicalized and kept.
    storage.setItem(RECENT_CODES_KEY, JSON.stringify(['abc', 'ABC230', good.toLowerCase()]));
    expect(listRecentCodes(storage)).toEqual([good]);
  });
});

describe('recordRecentCode — records, canonicalizes, most-recent-first', () => {
  it('records a used code so it appears in the list', () => {
    const c = code(0);
    recordRecentCode(c, storage);
    expect(listRecentCodes(storage)).toEqual([c]);
  });

  it('stores the CANONICAL (trimmed, upper-cased) form, not the raw input', () => {
    const c = code(1);
    recordRecentCode(`  ${c.toLowerCase()}  `, storage);
    expect(listRecentCodes(storage)).toEqual([c]);
    // The persisted record itself holds the canonical form.
    expect(JSON.parse(storage.getItem(RECENT_CODES_KEY) as string)).toEqual([c]);
  });

  it('puts the most-recently-used code first (newest-first order)', () => {
    const a = code(0);
    const b = code(1);
    recordRecentCode(a, storage);
    recordRecentCode(b, storage);
    expect(listRecentCodes(storage)).toEqual([b, a]);
  });

  it('dedupes: re-using an existing code promotes it to the front, not a duplicate', () => {
    const a = code(0);
    const b = code(1);
    const c = code(2);
    recordRecentCode(a, storage);
    recordRecentCode(b, storage);
    recordRecentCode(c, storage);
    recordRecentCode(a, storage); // re-use the oldest
    expect(listRecentCodes(storage)).toEqual([a, c, b]);
  });

  it('dedupe treats differently-cased inputs as the SAME code (canonical compare)', () => {
    const a = code(0);
    recordRecentCode(a, storage);
    recordRecentCode(a.toLowerCase(), storage);
    expect(listRecentCodes(storage)).toEqual([a]);
  });
});

describe('recordRecentCode — rejects malformed codes (never poisons the list)', () => {
  it('ignores an empty code (writes nothing)', () => {
    recordRecentCode('', storage);
    expect(listRecentCodes(storage)).toEqual([]);
    expect(storage.getItem(RECENT_CODES_KEY)).toBeNull();
  });

  it('ignores a whitespace-only code', () => {
    recordRecentCode('   ', storage);
    expect(listRecentCodes(storage)).toEqual([]);
  });

  it('ignores a too-short code', () => {
    recordRecentCode('ABC', storage);
    expect(listRecentCodes(storage)).toEqual([]);
  });

  it('ignores a code with an excluded/ambiguous glyph', () => {
    recordRecentCode('ABC230', storage); // '0' is excluded from the alphabet
    expect(listRecentCodes(storage)).toEqual([]);
  });

  it('is a no-op with a null store (nothing persisted, no throw)', () => {
    expect(() => recordRecentCode(code(0), null)).not.toThrow();
    // Prove nothing leaked into the injected storage either.
    recordRecentCode(code(0), null);
    expect(listRecentCodes(storage)).toEqual([]);
  });
});

describe('recentCodes — cap', () => {
  it(`retains at most RECENT_CODES_CAP (=${RECENT_CODES_CAP}) codes, evicting the oldest`, () => {
    // Record CAP+1 distinct codes; the very first must have been evicted.
    const recorded: string[] = [];
    for (let i = 0; i < RECENT_CODES_CAP + 1; i++) {
      const c = code(i);
      recorded.push(c);
      recordRecentCode(c, storage);
    }
    const list = listRecentCodes(storage);
    expect(list.length).toBe(RECENT_CODES_CAP);
    // Newest-first: the last-recorded is first; the very first-recorded was evicted.
    expect(list[0]).toBe(recorded[RECENT_CODES_CAP]);
    expect(list).not.toContain(recorded[0]);
  });

  it('a stored record longer than the cap is truncated on read (newest-first kept)', () => {
    const many = Array.from({ length: RECENT_CODES_CAP + 3 }, (_, i) => code(i));
    storage.setItem(RECENT_CODES_KEY, JSON.stringify(many));
    const list = listRecentCodes(storage);
    expect(list).toEqual(many.slice(0, RECENT_CODES_CAP));
  });

  it('a stored record with duplicates is deduped keeping the first (newest) occurrence', () => {
    const a = code(0);
    const b = code(1);
    storage.setItem(RECENT_CODES_KEY, JSON.stringify([a, b, a, b, a]));
    expect(listRecentCodes(storage)).toEqual([a, b]);
  });
});

describe('clearRecentCodes', () => {
  it('removes the stored record so the list is empty again', () => {
    recordRecentCode(code(0), storage);
    expect(listRecentCodes(storage)).not.toEqual([]);
    clearRecentCodes(storage);
    expect(listRecentCodes(storage)).toEqual([]);
    expect(storage.getItem(RECENT_CODES_KEY)).toBeNull();
  });

  it('clearing an already-empty store is a no-op (no throw)', () => {
    expect(() => clearRecentCodes(storage)).not.toThrow();
    expect(listRecentCodes(storage)).toEqual([]);
  });

  it('is a no-op with a null store (no throw)', () => {
    expect(() => clearRecentCodes(null)).not.toThrow();
  });
});

describe('RECENT_CODES_KEY', () => {
  it('is namespaced under the project pente: root', () => {
    expect(RECENT_CODES_KEY).toBe('pente:recentCodes');
  });
});

describe('property: every GENERATED code round-trips through the store (fast-check)', () => {
  it('a generated code validates, uses only the alphabet, and is recordable+first-listed', () => {
    fc.assert(
      fc.property(
        // A stream of rand() values in [0,1) drives the generator; fast-check varies them.
        fc.array(fc.double({ min: 0, max: 0.9999999, noNaN: true }), {
          minLength: CODE_LENGTH,
          maxLength: CODE_LENGTH * 4,
        }),
        (rands) => {
          let i = 0;
          const rng = () => rands[i++ % rands.length] ?? 0;
          const generated = generateGameCode(rng);

          // Generator invariant: every char is in the unambiguous alphabet, exact length.
          expect(generated.length).toBe(CODE_LENGTH);
          for (const ch of generated) expect(CODE_ALPHABET).toContain(ch);

          // Aligned with validation: a generated code always validates to itself.
          expect(validateGameCode(generated)).toEqual({ ok: true, code: generated });

          // Aligned with the store: recording a generated code lists it first (fresh store each run).
          const s = memoryStorage();
          recordRecentCode(generated, s);
          expect(listRecentCodes(s)[0]).toBe(generated);
        },
      ),
    );
  });

  it('the generator never emits an excluded/ambiguous glyph across many rng draws', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 0.9999999, noNaN: true }), (r) => {
        const generated = generateGameCode(() => r);
        for (const excluded of ['0', 'O', '1', 'I', 'L']) {
          expect(generated).not.toContain(excluded);
        }
      }),
    );
  });
});
