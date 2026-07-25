/**
 * PURE `activeNetworkedGame` BREADCRUMB store tests (Task V.1, epic #47 — the v3.1 net model).
 *
 * Strict, genuine assertions on the exact stored/read values (agent-principles: specific expected
 * values, never "it ran"), a negative case for EVERY degrade-to-null path (absent / unparseable /
 * JSON `null` / scalar / array / bad code / bad uuid / bad `updatedAt`), the null-store no-op, the
 * staleness boundary, and fast-check properties for the round-trip, the clear, staleness monotonicity
 * and — the design's load-bearing invariant — that the storage KEY is a CONSTANT that never derives
 * from a room code and that at most ONE breadcrumb is ever stored (it is session state, not a
 * code→game mapping; design §2 and the V.1 guardrail).
 *
 * Driven by an injected in-memory `Storage` (mirroring `config.test.ts` / `recentCodes.test.ts`), so
 * it runs in node with no DOM.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import {
  readActiveGame,
  writeActiveGame,
  clearActiveGame,
  isActiveGameStale,
  ACTIVE_GAME_KEY,
  ACTIVE_GAME_MAX_AGE_MS,
  type ActiveNetworkedGame,
} from './activeGame.ts';
import { CODE_ALPHABET, CODE_LENGTH } from '../ui/widgets/netModel.ts';

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

/** A valid room code fixture built from the real alphabet (no length-specific literal). */
function code(seed: number): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[(seed + i) % CODE_ALPHABET.length];
  return s;
}

/** Arbitrary VALID room code (canonical: the alphabet, exactly CODE_LENGTH chars). */
const arbCode = fc
  .array(fc.constantFrom(...CODE_ALPHABET.split('')), {
    minLength: CODE_LENGTH,
    maxLength: CODE_LENGTH,
  })
  .map((cs) => cs.join(''));

/** Arbitrary non-empty game uuid (opaque id string — `randomId()` shapes plus adversarial ones). */
const arbUuid = fc.string({ minLength: 1, maxLength: 40 });

/** Arbitrary finite `updatedAt` epoch-millis stamp. */
const arbStamp = fc.integer({ min: 0, max: 4_000_000_000_000 });

/** Arbitrary valid breadcrumb. */
const arbCrumb: fc.Arbitrary<ActiveNetworkedGame> = fc.record({
  code: arbCode,
  gameUuid: arbUuid,
  updatedAt: arbStamp,
});

const CRUMB: ActiveNetworkedGame = { code: code(0), gameUuid: 'game-uuid-1', updatedAt: 1_000 };

let storage: Storage;
beforeEach(() => {
  storage = memoryStorage();
});

describe('the breadcrumb key — a CONSTANT, never derived from a room code (design §2 guardrail)', () => {
  it('is the namespaced `pente:activeNetworkedGame` record', () => {
    // Pinned deliberately: the key is a STORED-FORMAT contract (renaming it orphans every player's
    // in-progress breadcrumb), and it must contain no room code — it is single-valued session state.
    expect(ACTIVE_GAME_KEY).toBe('pente:activeNetworkedGame');
  });

  it('writes EVERY room code to that ONE key — a second room REPLACES the breadcrumb', () => {
    writeActiveGame({ code: code(0), gameUuid: 'g1', updatedAt: 1 }, storage);
    writeActiveGame({ code: code(7), gameUuid: 'g2', updatedAt: 2 }, storage);

    // Exactly one record exists, under the constant key: there is no `…:{code}` shard per room.
    expect(storage.length).toBe(1);
    expect(storage.key(0)).toBe(ACTIVE_GAME_KEY);
    // The LATER write won — a breadcrumb is single-valued session state, not an accumulating map.
    expect(readActiveGame(storage)).toEqual({ code: code(7), gameUuid: 'g2', updatedAt: 2 });
    // Nothing is retrievable under the code itself (a code→game lookup does not exist).
    expect(storage.getItem(code(0))).toBeNull();
    expect(storage.getItem(code(7))).toBeNull();
  });
});

describe('readActiveGame — degrade paths (never throws, always null)', () => {
  it('returns null when nothing has been stored', () => {
    expect(readActiveGame(storage)).toBeNull();
  });

  it('returns null with no Storage at all (undefined resolves to the absent global)', () => {
    // No globalThis.localStorage in the node test env → resolves null → null (does not throw).
    expect(readActiveGame()).toBeNull();
  });

  it('returns null when Storage is explicitly null (forced no-store)', () => {
    expect(readActiveGame(null)).toBeNull();
  });

  it('degrades unparseable JSON to null', () => {
    storage.setItem(ACTIVE_GAME_KEY, '{ not valid json');
    expect(readActiveGame(storage)).toBeNull();
  });

  it('degrades a stored JSON `null` to null (no property access on null)', () => {
    storage.setItem(ACTIVE_GAME_KEY, 'null');
    expect(() => readActiveGame(storage)).not.toThrow();
    expect(readActiveGame(storage)).toBeNull();
  });

  it('degrades a JSON scalar (number) to null', () => {
    storage.setItem(ACTIVE_GAME_KEY, '42');
    expect(readActiveGame(storage)).toBeNull();
  });

  it('degrades a JSON array to null', () => {
    storage.setItem(ACTIVE_GAME_KEY, JSON.stringify([CRUMB]));
    expect(readActiveGame(storage)).toBeNull();
  });

  it('rejects a non-string `code` without throwing', () => {
    storage.setItem(ACTIVE_GAME_KEY, JSON.stringify({ ...CRUMB, code: 123 }));
    expect(() => readActiveGame(storage)).not.toThrow();
    expect(readActiveGame(storage)).toBeNull();
  });

  it('rejects a code that is not a valid room code (too short)', () => {
    storage.setItem(ACTIVE_GAME_KEY, JSON.stringify({ ...CRUMB, code: 'AB' }));
    expect(readActiveGame(storage)).toBeNull();
  });

  it('rejects a code with characters outside the alphabet', () => {
    storage.setItem(ACTIVE_GAME_KEY, JSON.stringify({ ...CRUMB, code: 'ABC-DE' }));
    expect(readActiveGame(storage)).toBeNull();
  });

  it('CANONICALIZES a stored lower-case / padded code (the same canonical form the join path uses)', () => {
    const canonical = code(3);
    storage.setItem(
      ACTIVE_GAME_KEY,
      JSON.stringify({ ...CRUMB, code: `  ${canonical.toLowerCase()} ` }),
    );
    expect(readActiveGame(storage)?.code).toBe(canonical);
  });

  it('rejects a missing `gameUuid`', () => {
    storage.setItem(ACTIVE_GAME_KEY, JSON.stringify({ code: CRUMB.code, updatedAt: 1 }));
    expect(readActiveGame(storage)).toBeNull();
  });

  it('rejects a non-string `gameUuid`', () => {
    storage.setItem(ACTIVE_GAME_KEY, JSON.stringify({ ...CRUMB, gameUuid: 7 }));
    expect(readActiveGame(storage)).toBeNull();
  });

  it('rejects an EMPTY `gameUuid` (it could never resolve an archived game)', () => {
    storage.setItem(ACTIVE_GAME_KEY, JSON.stringify({ ...CRUMB, gameUuid: '' }));
    expect(readActiveGame(storage)).toBeNull();
  });

  it('rejects a missing `updatedAt` (staleness could not be judged)', () => {
    storage.setItem(ACTIVE_GAME_KEY, JSON.stringify({ code: CRUMB.code, gameUuid: 'g' }));
    expect(readActiveGame(storage)).toBeNull();
  });

  it('rejects a non-number `updatedAt`', () => {
    storage.setItem(ACTIVE_GAME_KEY, JSON.stringify({ ...CRUMB, updatedAt: '1000' }));
    expect(readActiveGame(storage)).toBeNull();
  });

  it('rejects a non-FINITE `updatedAt` (JSON `1e999` parses to Infinity)', () => {
    storage.setItem(ACTIVE_GAME_KEY, `{"code":"${CRUMB.code}","gameUuid":"g","updatedAt":1e999}`);
    expect(readActiveGame(storage)).toBeNull();
  });

  it('never throws on ARBITRARY stored garbage, and any non-null read is a canonical breadcrumb', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const s = memoryStorage();
        s.setItem(ACTIVE_GAME_KEY, raw);
        const read = readActiveGame(s);
        if (read === null) return;
        // A surviving read is fully canonical: an upper-cased alphabet code of the right length, a
        // non-empty uuid and a finite stamp — so a hand-edited record can never yield a usable-looking
        // breadcrumb the rejoin path would then choke on.
        expect(read.code).toMatch(new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`));
        expect(read.gameUuid.length).toBeGreaterThan(0);
        expect(Number.isFinite(read.updatedAt)).toBe(true);
      }),
    );
  });
});

describe('writeActiveGame / readActiveGame — the round-trip', () => {
  it('round-trips the exact breadcrumb fields', () => {
    writeActiveGame(CRUMB, storage);
    expect(readActiveGame(storage)).toEqual(CRUMB);
  });

  it('stores the CANONICAL code, so a padded/lower-case write reads back canonical', () => {
    const canonical = code(5);
    writeActiveGame({ code: ` ${canonical.toLowerCase()}`, gameUuid: 'g', updatedAt: 9 }, storage);
    expect(readActiveGame(storage)).toEqual({ code: canonical, gameUuid: 'g', updatedAt: 9 });
  });

  it('IGNORES a write whose code is not a valid room code, leaving a prior breadcrumb intact', () => {
    writeActiveGame(CRUMB, storage);
    writeActiveGame({ code: 'nope!', gameUuid: 'g2', updatedAt: 2 }, storage);
    // A breadcrumb that cannot be re-entered is worse than none — the prior valid one survives.
    expect(readActiveGame(storage)).toEqual(CRUMB);
  });

  it('IGNORES a write with an empty gameUuid, leaving a prior breadcrumb intact', () => {
    writeActiveGame(CRUMB, storage);
    writeActiveGame({ code: code(4), gameUuid: '', updatedAt: 2 }, storage);
    expect(readActiveGame(storage)).toEqual(CRUMB);
  });

  it('IGNORES a write with a non-finite updatedAt, leaving a prior breadcrumb intact', () => {
    writeActiveGame(CRUMB, storage);
    writeActiveGame({ code: code(4), gameUuid: 'g2', updatedAt: Number.NaN }, storage);
    expect(readActiveGame(storage)).toEqual(CRUMB);
  });

  it('is a no-op with no Storage (null) — nothing to persist, no throw', () => {
    expect(() => writeActiveGame(CRUMB, null)).not.toThrow();
    expect(readActiveGame(null)).toBeNull();
  });

  it('is a no-op with no Storage at all (undefined → absent global)', () => {
    expect(() => writeActiveGame(CRUMB)).not.toThrow();
    expect(readActiveGame()).toBeNull();
  });

  it('round-trips ANY valid breadcrumb (property)', () => {
    fc.assert(
      fc.property(arbCrumb, (crumb) => {
        const s = memoryStorage();
        writeActiveGame(crumb, s);
        expect(readActiveGame(s)).toEqual(crumb);
      }),
    );
  });

  it('keeps exactly ONE breadcrumb — the last write wins, whatever the codes (property)', () => {
    fc.assert(
      fc.property(fc.array(arbCrumb, { minLength: 1, maxLength: 6 }), (crumbs) => {
        const s = memoryStorage();
        for (const crumb of crumbs) writeActiveGame(crumb, s);
        expect(s.length).toBe(1);
        expect(s.key(0)).toBe(ACTIVE_GAME_KEY);
        expect(readActiveGame(s)).toEqual(crumbs[crumbs.length - 1]);
        // No per-code shard was written for ANY of the codes seen (the anti-mapping invariant).
        for (const crumb of crumbs) expect(s.getItem(crumb.code)).toBeNull();
      }),
    );
  });
});

describe('clearActiveGame', () => {
  it('removes the record so the next read is null', () => {
    writeActiveGame(CRUMB, storage);
    expect(readActiveGame(storage)).not.toBeNull();

    clearActiveGame(storage);

    expect(readActiveGame(storage)).toBeNull();
    expect(storage.getItem(ACTIVE_GAME_KEY)).toBeNull();
    expect(storage.length).toBe(0);
  });

  it('is a no-op on an absent record (no throw)', () => {
    expect(() => clearActiveGame(storage)).not.toThrow();
    expect(readActiveGame(storage)).toBeNull();
  });

  it('is a no-op with no Storage (null / undefined)', () => {
    expect(() => clearActiveGame(null)).not.toThrow();
    expect(() => clearActiveGame()).not.toThrow();
  });

  it('a CLEARED breadcrumb reads null for any prior write (property)', () => {
    fc.assert(
      fc.property(arbCrumb, (crumb) => {
        const s = memoryStorage();
        writeActiveGame(crumb, s);
        clearActiveGame(s);
        expect(readActiveGame(s)).toBeNull();
      }),
    );
  });
});

describe('isActiveGameStale — the quiet-expiry predicate (design §6)', () => {
  it('a just-written breadcrumb is FRESH', () => {
    expect(isActiveGameStale({ ...CRUMB, updatedAt: 1_000 }, 1_000)).toBe(false);
  });

  it('is FRESH at EXACTLY the max age (the boundary is inclusive)', () => {
    expect(
      isActiveGameStale({ ...CRUMB, updatedAt: 1_000 }, 1_000 + ACTIVE_GAME_MAX_AGE_MS),
    ).toBe(false);
  });

  it('is STALE one millisecond past the max age', () => {
    expect(
      isActiveGameStale({ ...CRUMB, updatedAt: 1_000 }, 1_000 + ACTIVE_GAME_MAX_AGE_MS + 1),
    ).toBe(true);
  });

  it('the DEFAULT horizon is one DAY: a day old is fresh, a day and a millisecond is stale', () => {
    // The policy the design states ("a long-stale breadcrumb expires quietly") in concrete units, so
    // the default horizon is asserted behaviourally rather than trusted to arithmetic.
    const DAY_MS = 24 * 60 * 60 * 1000;
    expect(isActiveGameStale({ ...CRUMB, updatedAt: 0 }, DAY_MS)).toBe(false);
    expect(isActiveGameStale({ ...CRUMB, updatedAt: 0 }, DAY_MS + 1)).toBe(true);
  });

  it('honours an explicit maxAgeMs (a caller may tighten or widen the horizon)', () => {
    const crumb = { ...CRUMB, updatedAt: 100 };
    expect(isActiveGameStale(crumb, 150, 50)).toBe(false);
    expect(isActiveGameStale(crumb, 151, 50)).toBe(true);
  });

  it('treats a FUTURE stamp (clock skew) as fresh, never stale', () => {
    expect(isActiveGameStale({ ...CRUMB, updatedAt: 5_000 }, 1_000)).toBe(false);
  });

  it('is MONOTONE in updatedAt: if a NEWER stamp is stale, an older one is too (property)', () => {
    fc.assert(
      fc.property(arbStamp, arbStamp, arbStamp, fc.integer({ min: 0, max: 10_000_000 }), (u1, u2, now, maxAge) => {
        const older = Math.min(u1, u2);
        const newer = Math.max(u1, u2);
        const staleNewer = isActiveGameStale({ ...CRUMB, updatedAt: newer }, now, maxAge);
        const staleOlder = isActiveGameStale({ ...CRUMB, updatedAt: older }, now, maxAge);
        // Staleness only ever GROWS as the stamp gets older — never the other way round.
        if (staleNewer) expect(staleOlder).toBe(true);
        if (!staleOlder) expect(staleNewer).toBe(false);
      }),
    );
  });
});
