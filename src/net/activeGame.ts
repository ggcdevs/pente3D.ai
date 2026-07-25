/**
 * PURE `activeNetworkedGame` BREADCRUMB store (Task V.1, epic #47 — the v3.1 net model, design §2).
 *
 * ## THE INVARIANT: this is SESSION state, NOT a code→game mapping — do not "generalize" it
 *
 * The v3.1 model is *"a room code is pure rendezvous, a game is a UUID, and there is NO mapping
 * between them, anywhere"*. The whole v3 bug cluster (#43/#46 resurrected games, #45's stale-snapshot
 * deadlock) came from ONE artifact this module deliberately does **not** re-create: a game persisted
 * **per room code** (`net-room:{code}`), which made a rendezvous channel own a game and killed the
 * "re-use code DUDEEE for every game" model the design exists to serve.
 *
 * What this module stores is a single **breadcrumb**: *"I am **currently mid-game** in room X as game
 * Y."* Its differences from a mapping are load-bearing, not cosmetic:
 *
 *  - **Single-valued.** ONE record under ONE constant key ({@link ACTIVE_GAME_KEY}) — never a
 *    per-code shard, never a list. Entering a second room REPLACES it. Nothing is retrievable *by a
 *    room code*, so there is no lookup to generalize into a mapping. If you ever find yourself adding
 *    a `code` parameter to a read here, that is the bug this file exists to prevent.
 *  - **It drives a PROMPT, never an auto-load** (design §6). A tab reload always lands on an empty
 *    slate; the breadcrumb only lets the app OFFER "rejoin DUDEEE?" — so it can only ever point at a
 *    genuinely in-progress game.
 *  - **It is cleared on completion** and expires quietly once stale ({@link isActiveGameStale}).
 *  - **It is NEVER published** — it is local session state, not protocol state. (Publishing it, e.g.
 *    as a retained MQTT message, would re-couple code↔game *at the broker*: the exact re-coupling
 *    design §4 rejected.)
 *
 * The game bytes themselves live in the IndexedDB archive keyed by the game **UUID** (the source of
 * truth); this breadcrumb only remembers WHICH uuid the current session is playing, so a returning
 * peer re-seeds from `archive[gameUuid]` — never from the room code.
 *
 * ## Shape
 *
 * Backed by an INJECTED {@link Storage} exactly like `src/config/config.ts` and
 * `src/ui/widgets/recentCodes.ts` (the design's `visitedRoomCodes`, which stays the SSOT for "codes I
 * have used" — this module deliberately does not duplicate it): defaulting to
 * `globalThis.localStorage` when present, `null` forces a no-op, and an in-memory store makes the
 * whole module node-testable without a DOM. It reads a DOM API (`localStorage`), so it is NOT
 * `src/core`; it imports no three/DOM/render/transport and stays pure logic.
 *
 * Robustness contract (mirrored from `recentCodes.ts`): a missing, unparseable or ill-typed record
 * degrades to `null` — {@link readActiveGame} NEVER throws. The stored `code` is CANONICAL (trimmed,
 * upper-cased, {@link validateGameCode}-valid) so the breadcrumb can only ever name a room the join
 * path would accept, and a record that fails validation is treated as absent rather than surfaced.
 */

import { validateGameCode } from '../ui/widgets/netModel';

/**
 * The breadcrumb: the room this browser is CURRENTLY mid-game in, the UUID of that game, and when the
 * fact was last observed. Not a mapping (see the module header) — session state with a lifetime.
 */
export interface ActiveNetworkedGame {
  /** The room code the session is live in, CANONICAL (trimmed, upper-cased) — rendezvous only. */
  readonly code: string;
  /** The stable UUID of the game being played, resolvable in the archive (the source of truth). */
  readonly gameUuid: string;
  /** Epoch millis when this fact was last observed — the input to {@link isActiveGameStale}. */
  readonly updatedAt: number;
}

/**
 * The ONE localStorage key the breadcrumb lives under, namespaced under the project's `pente:` root.
 * A CONSTANT: it is deliberately NOT derived from the room code (that derivation — `net-room:{code}`
 * — is the deleted v3 coupling this module replaces).
 */
export const ACTIVE_GAME_KEY = 'pente:activeNetworkedGame';

/**
 * How long a breadcrumb stays credible: 24h. Past this, "I am currently mid-game in room X" is no
 * longer a believable claim about a live session, so the rejoin prompt expires QUIETLY rather than
 * offering to rejoin a room nobody has been in for days (design §6 "a long-stale breadcrumb expires
 * quietly"). A day is the horizon at which "I stepped away mid-game" stops being the likely story.
 */
export const ACTIVE_GAME_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Resolve the injected storage, defaulting to `globalThis.localStorage` when present (as config.ts). */
function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  const g = globalThis as { localStorage?: Storage };
  return g.localStorage ?? null;
}

/**
 * Validate + canonicalize the three breadcrumb fields, or `null` if ANY of them is unusable. Shared
 * by the reader and the writer, so the stored form and the read form can never disagree (the
 * round-trip holds by construction) and a corrupt record degrades exactly like a rejected write.
 *
 * Each rejection is a real behavior, not defensive padding:
 *  - a non-string / invalid `code` could never be re-entered (and would crash the validator);
 *  - an empty / non-string `gameUuid` could never resolve an archived game;
 *  - a non-finite `updatedAt` would make the staleness predicate meaningless.
 */
function canonicalize(code: unknown, gameUuid: unknown, updatedAt: unknown): ActiveNetworkedGame | null {
  if (typeof code !== 'string') return null;
  const validated = validateGameCode(code);
  if (!validated.ok) return null;
  if (typeof gameUuid !== 'string' || gameUuid.length === 0) return null;
  if (!isFiniteNumber(updatedAt)) return null;
  return { code: validated.code, gameUuid, updatedAt };
}

/**
 * Narrow an unknown to a FINITE number. `Number.isFinite` is total — unlike the global `isFinite` it
 * does no coercion, so it already rejects every non-number (a `'1000'` string included). A separate
 * `typeof` guard alongside it would therefore be a branch no input can distinguish, i.e. untestable
 * padding; this single check is the whole rule.
 */
function isFiniteNumber(value: unknown): value is number {
  return Number.isFinite(value);
}

/**
 * Read the stored breadcrumb, or `null` when there is none to trust. Degrades — never throws — on
 * every deviation: no store available, an absent key (`JSON.parse(null)` → `null`), unparseable JSON,
 * a stored JSON `null`, a scalar/array (no fields), or any field that fails {@link canonicalize}.
 *
 * @param storage Backing store; omit for `globalThis.localStorage`, pass `null` to force `null`.
 */
export function readActiveGame(storage?: Storage | null): ActiveNetworkedGame | null {
  const store = resolveStorage(storage);
  if (store === null) return null;

  // Read OUTSIDE the try: only the PARSE may legitimately fail (a corrupt record). Wrapping the
  // store access too would let a broken store masquerade as a corrupt record — and would make the
  // no-store guard above unobservable, since the resulting TypeError would be caught here.
  const raw = store.getItem(ACTIVE_GAME_KEY);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw as string);
  } catch {
    return null;
  }
  // `null` needs its own arm — property access on it would THROW rather than degrade. Any other
  // non-object (scalar, array) simply has no `code`/`gameUuid`/`updatedAt` and is rejected by
  // `canonicalize`, so no extra type guard is needed (and none is added: a guard whose branch
  // cannot change the result would be untestable padding).
  if (parsed === null) return null;
  const fields = parsed as Partial<Record<keyof ActiveNetworkedGame, unknown>>;
  return canonicalize(fields.code, fields.gameUuid, fields.updatedAt);
}

/**
 * Record the breadcrumb — "I am currently mid-game in `code` as game `gameUuid`, as of `updatedAt`" —
 * REPLACING any previous one (it is single-valued session state; see the module header). The code is
 * stored canonical.
 *
 * An input that fails {@link canonicalize} is IGNORED (nothing is written, and any prior breadcrumb
 * survives): a breadcrumb that could never be acted on — an un-enterable code, a uuid that resolves
 * no game, an unjudgeable stamp — is strictly worse than none, and destroying a usable prior one to
 * store it would lose a real in-progress game. Mirrors `recordRecentCode`'s ignore-the-invalid rule.
 * With no store available the call is a no-op (nothing durable to write).
 *
 * @param storage Backing store; omit for `globalThis.localStorage`, pass `null` to force a no-op.
 */
export function writeActiveGame(entry: ActiveNetworkedGame, storage?: Storage | null): void {
  const store = resolveStorage(storage);
  if (store === null) return;

  const canonical = canonicalize(entry.code, entry.gameUuid, entry.updatedAt);
  if (canonical === null) return;
  store.setItem(ACTIVE_GAME_KEY, JSON.stringify(canonical));
}

/**
 * Forget the breadcrumb — the game completed, or the player declined the rejoin prompt (design §6).
 * After this the app has no in-progress claim at all and a reload lands on a plain empty slate. A
 * no-op when there is nothing stored, or no store available.
 */
export function clearActiveGame(storage?: Storage | null): void {
  const store = resolveStorage(storage);
  if (store === null) return;
  store.removeItem(ACTIVE_GAME_KEY);
}

/**
 * Whether a breadcrumb is too old to be believed (design §6 "a stale `updatedAt` expires quietly").
 * Monotone in `updatedAt`: the older the stamp, the staler — and a stamp from the FUTURE (clock skew
 * between devices is normal) yields a negative age, i.e. fresh, never stale.
 *
 * The boundary is INCLUSIVE: exactly `maxAgeMs` old still counts as fresh, so the horizon reads as
 * "expires AFTER a day", not "at some point during the last millisecond of it".
 *
 * @param entry The breadcrumb to judge.
 * @param now Current epoch millis (injected — the caller owns the clock).
 * @param maxAgeMs The credibility horizon; defaults to {@link ACTIVE_GAME_MAX_AGE_MS}.
 */
export function isActiveGameStale(
  entry: ActiveNetworkedGame,
  now: number,
  maxAgeMs: number = ACTIVE_GAME_MAX_AGE_MS,
): boolean {
  return now - entry.updatedAt > maxAgeMs;
}
