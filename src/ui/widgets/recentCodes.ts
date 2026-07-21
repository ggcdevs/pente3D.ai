/**
 * PURE recent-game-codes store (Task C.1 — GitHub issue #13, the game-code picker's "saved" list).
 *
 * The picker (custom / saved / random — issue #13) needs the codes the user has recently used to
 * host or join a game, so it can offer them in the input's dropdown. This module is that store: it
 * records a code the moment it is used and lists the most-recent {@link RECENT_CODES_CAP} back,
 * newest-first, deduplicated.
 *
 * It is backed by an INJECTED {@link Storage} exactly like `src/config/config.ts` — defaulting to
 * `globalThis.localStorage` when present, accepting an in-memory store under test — so the whole
 * store is node-testable without a DOM and can be pointed at any backing store. It reads a DOM API
 * (`localStorage`), so it is NOT `src/core`; it imports no three/DOM/render/ui and stays pure logic.
 *
 * Robustness contract (agent-principles: a *user's* stored record must never break the app, mirrored
 * from config.ts): a missing, unparseable, or ill-typed stored record degrades to an EMPTY list —
 * {@link listRecentCodes} NEVER throws on a corrupt record. Non-string / malformed entries inside an
 * otherwise-valid array are dropped, not surfaced, so a hand-edited or version-skewed record can only
 * ever yield fewer valid codes, never a crash.
 *
 * A recorded code is stored in its CANONICAL form (trimmed, upper-cased) and only if it
 * {@link validateGameCode}-validates — that same validator canonicalizes, so the two can never
 * disagree on the stored shape — meaning the dropdown can never offer a malformed code that the join
 * path would then reject. The list is the SSOT for "codes I have used"; nothing else duplicates it.
 */

import { validateGameCode } from './netModel.ts';

/**
 * How many recent codes are retained and listed, newest-first. A small cap keeps the dropdown short
 * and the stored record tiny; recording a new distinct code past the cap evicts the oldest.
 */
export const RECENT_CODES_CAP = 8;

/** The localStorage prefix for the recent-codes record. Namespaced under the project's `pente:` root. */
export const RECENT_CODES_KEY = 'pente:recentCodes';

/** Resolve the injected storage, defaulting to `globalThis.localStorage` when present (as config.ts). */
function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  const g = globalThis as { localStorage?: Storage };
  return g.localStorage ?? null;
}

/**
 * Read the stored recent-codes list, canonicalized and filtered to only well-formed codes.
 *
 * The stored record is a JSON array of code strings, newest-first. This reader degrades any deviation
 * to an empty list rather than throwing:
 *   - no store available, or the key is absent → `[]`;
 *   - unparseable JSON → `[]`;
 *   - a parsed value that is not an array → `[]`;
 *   - non-string or invalid entries WITHIN a valid array → silently dropped (the rest survive).
 *
 * Every surviving entry is re-validated through {@link validateGameCode} and returned in its canonical
 * (trimmed, upper-cased) form, and the result is deduplicated newest-first — so even a record written
 * by an older/buggier version can only ever yield a shorter list of legal, canonical codes.
 *
 * @param storage Backing store; omit to use `globalThis.localStorage`, pass `null` to force empty.
 * @returns The recent codes, newest-first, deduped, capped at {@link RECENT_CODES_CAP}.
 */
export function listRecentCodes(storage?: Storage | null): string[] {
  const store = resolveStorage(storage);
  if (store === null) return [];

  const parsed = parseStoredArray(store.getItem(RECENT_CODES_KEY));
  const canonical: string[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'string') continue;
    const result = validateGameCode(entry);
    if (result.ok) canonical.push(result.code);
  }
  return dedupeCap(canonical);
}

/**
 * Parse a stored raw value into the array of entries to validate, degrading ANY deviation to an empty
 * array (never throwing): an absent key (`null`), unparseable JSON, or a parsed non-array all yield
 * `[]`. Returning `unknown[]` (not `string[]`) is deliberate — the caller re-validates each entry, so
 * this only has to guarantee "an iterable array", not that its elements are well-formed.
 *
 * The `try` returns the parsed-and-array-checked value on the success path and the `catch` a distinct
 * `[]` — there is no shared fall-through, so a mutant that empties either arm changes an OBSERVABLE
 * result (a valid stored array would return `[]`, or an unparseable record would throw), and every
 * such mutant is killed by a test.
 */
function parseStoredArray(raw: string | null): unknown[] {
  try {
    const parsed: unknown = JSON.parse(raw as string);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Record a code the user just used to host or join, moving it to the FRONT of the recent list, and
 * persist the updated list. Pure of surprises:
 *   - the code is canonicalized (via {@link validateGameCode}) and recorded only if it validates; an
 *     invalid or empty code is IGNORED (nothing is written), so the dropdown never gains a code the
 *     join path would reject;
 *   - an already-present code is promoted to the front rather than duplicated (dedupe, most-recent-
 *     first), so re-using a code re-orders instead of growing the list;
 *   - the list is capped at {@link RECENT_CODES_CAP}; recording past the cap evicts the oldest;
 *   - with no store available (`resolveStorage` → null) the call is a no-op — there is nowhere durable
 *     to write, so nothing is persisted (mirrors config.ts `setConfig`'s null-store no-op).
 *
 * @param code The raw code the user used (any case / surrounding whitespace tolerated).
 * @param storage Backing store; omit to use `globalThis.localStorage`, pass `null` to force no-op.
 */
export function recordRecentCode(code: string, storage?: Storage | null): void {
  const store = resolveStorage(storage);
  if (store === null) return;

  const result = validateGameCode(code);
  if (!result.ok) return;
  const canonical = result.code;

  // Prepend the freshly-used code to the existing list (read through the same validating reader, so a
  // corrupt record can't poison the write) and re-cap. `dedupeCap` keeps the FIRST occurrence, so the
  // prepended code wins and any prior occurrence deeper in the list is dropped — that promotion is the
  // dedupe, no separate filter needed (a filter here would be redundant, i.e. an equivalent mutant).
  const updated = dedupeCap([canonical, ...listRecentCodes(store)]);
  store.setItem(RECENT_CODES_KEY, JSON.stringify(updated));
}

/**
 * Deduplicate a newest-first list keeping the FIRST occurrence of each code (so the most-recent
 * position wins), then truncate to {@link RECENT_CODES_CAP}. Splitting this out keeps the "capped,
 * deduped, newest-first" invariant in exactly one place for both the reader and the writer.
 */
function dedupeCap(codes: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const code of codes) {
    if (seen.has(code)) continue;
    seen.add(code);
    out.push(code);
    if (out.length === RECENT_CODES_CAP) break;
  }
  return out;
}

/**
 * Remove the stored recent-codes record entirely (e.g. a "clear history" affordance). With no store
 * available the call does nothing. Mirrors config.ts `resetConfig`'s `removeItem` no-op-on-absent.
 */
export function clearRecentCodes(storage?: Storage | null): void {
  const store = resolveStorage(storage);
  if (store === null) return;
  store.removeItem(RECENT_CODES_KEY);
}
