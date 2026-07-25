/**
 * The game archive (build plan Task 2.2; GLOSSARY "Game archive").
 *
 * Every game is persisted for later review as its **event log + metadata**
 * (game-core design, Part 3). This layer sits on top of the raw IndexedDB wrapper
 * (`db.ts`, Task 2.1): it builds a `GameRecord` from a core `Game`, and on load
 * reconstructs a `Game` by folding the stored log. Because a log fully determines a
 * game (the fold is deterministic), a save→load round-trip yields a byte-for-byte
 * identical game — same `headHash`, derived state, and ply.
 *
 * **Conflicted games are archived too** (game-core design, Part 3; GLOSSARY
 * "conflict"). When a sync forks — neither log is a prefix of the other — the game
 * is saved flagged `conflicted`, storing *both* forked logs so a future conflict-
 * resolution feature can reopen the exact fork. Both forks reconstruct into `Game`s
 * via {@link loadConflicted}.
 *
 * Errors propagate honestly: a corrupt or illegal stored log surfaces as an
 * {@link ArchiveError} naming the game id, never a silently broken `Game`
 * (agent-principles: errors propagate honestly, proof-by-behavior).
 *
 * This layer is *not* `src/core`: it may use IndexedDB (a DOM API) via `db.ts`. It
 * builds only on the core (`Game`, `EventLog`, serialize) and `db.ts` — it must not
 * import three/render/ui.
 */

import { Game } from '../core/game';
import { headHash, type Event, type EventLog } from '../core/eventLog';
import { importGame, type GameExport } from '../core/serialize';
import {
  getGame,
  putGame,
  listGames,
  deleteGame,
  type GameListing,
  type GameRecord,
} from './db';

/** The identity-owned seat map persisted with a networked game (design §2.3). */
export interface PersistedSeats {
  readonly white: string | null;
  readonly black: string | null;
}

/**
 * The archive record's human `players` map for a NETWORKED game: the REAL seat owners (playerIds),
 * omitting a seat nobody owns yet rather than recording a `null`/sentinel "player".
 *
 * Shared by the two writers of a networked game's record — `NetSession.persistGame` (which owns it in
 * the browser AND the CLI) and the app's autosave (`main.ts`, which writes the same uuid-keyed record
 * while a net game is authoritative) — so the projection lives in ONE place and the two can never
 * disagree about it.
 */
export function playersFromSeats(seats: PersistedSeats): Record<string, string> {
  const players: Record<string, string> = {};
  if (seats.white !== null) players.white = seats.white;
  if (seats.black !== null) players.black = seats.black;
  return players;
}

/**
 * The `meta.result` marker of a **v3** internal `net-room:{code}` record — a game + seat map that v3
 * persisted per room CODE, the coupling epic #47 deleted (design §1/§2 "Deleted: `net-room:{code}`").
 *
 * v3.1 never writes one. It exists only so {@link purgeLegacyNetRoomRecords} can RECOGNIZE the shards
 * a deployed v3 build already wrote into a real user's IndexedDB — the store is per-ORIGIN, so the
 * same origin's v3 and v3.1 builds share it. Their game bytes are not user data at risk: v3's autosave
 * archived the same authoritative net game under the app's own autosave id, so a shard is a duplicate
 * of a listed game plus a room-scoped seat map that means nothing in a model with no code→game link.
 */
export const LEGACY_NET_ROOM_RESULT = 'net-room';

/** The board size assumed for archived games when none is stored (v1 default). */
const DEFAULT_SIZE = 9;

/**
 * Archive metadata supplied by the caller when saving. The archive derives and
 * attaches `headHash` and (for conflicts) `result` itself — the caller provides the
 * human-facing fields only.
 */
export interface ArchivedMeta {
  /** Seat → display name / id. */
  readonly players: Readonly<Record<string, string>>;
  /**
   * Outcome marker for an ordinary save, e.g. `'in-progress' | 'white-wins'`.
   * {@link flagConflicted} overrides this to `'conflicted'`.
   */
  readonly result: string;
  /** Epoch millis when the game began. */
  readonly startedAt: number;
  /**
   * The identity-owned seat map bound to this game (design §2.3), if this is a
   * networked game whose seats have been negotiated. `{ white, black }` = the real
   * `playerId` owning each seat, or `null`. Persisted so a returning owner reclaims
   * its exact color across an EMPTY room (design §6.4); absent for a local game.
   */
  readonly seats?: {
    readonly white: string | null;
    readonly black: string | null;
  };
}

/** Thrown when a stored record cannot be reconstructed into a valid game. */
export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveError';
  }
}

/**
 * A conflicted record: an ordinary `GameRecord` (whose `log` mirrors the local fork
 * for listing/compat) plus the canonical `forks` (both plain event logs) and the
 * board `size` needed to reconstruct each fork.
 */
interface ConflictedRecord extends GameRecord {
  /**
   * The two forked event logs, as plain events (game-core design "both forks"),
   * each with its own game uuid so a fork reconstructs with the *right* identity.
   * A conflict is either same-uuid/divergent-history (the two uuids coincide) or
   * two-different-games (the uuids differ); storing both keeps that distinction
   * (design §5). A record written before S.1 has no `forkUuids`; each fork then
   * lazily mints one on load.
   */
  readonly forks: {
    readonly mine: StoredLog;
    readonly theirs: StoredLog;
  };
  /** Per-fork game uuids, mirroring `forks`. Absent on pre-S.1 records. */
  readonly forkUuids?: {
    readonly mine: string;
    readonly theirs: string;
  };
  /** Board size for reconstructing both forks. */
  readonly size: number;
}

/** The two reconstructed forks of a conflicted game. */
export interface ConflictedGame {
  /** The local fork. */
  readonly mine: Game;
  /** The remote fork. */
  readonly theirs: Game;
}

/** The storable form of a log: plain, JSON-cloneable event records (no hash chain). */
type StoredLog = readonly Readonly<Record<string, unknown>>[];

/**
 * Flatten an `EventLog` to its plain, ordered event array for storage — the same
 * plain events `serialize.exportGame` produces. Each event is spread into a fresh
 * plain object so the result is a structured-cloneable `Record` (what IndexedDB and
 * the store's `GameRecord.log` type expect), not a live union instance.
 */
function toPlainLog(log: EventLog): StoredLog {
  return log.entries.map((entry) => ({ ...entry.event }));
}

/**
 * Reconstruct a `Game` from a stored plain event log of the given size, translating
 * any core error (corrupt/unknown event, illegal move sequence) into an
 * {@link ArchiveError} that names the id — never returning a broken `Game`.
 *
 * `uuid` is threaded into the reconstruction so a save→load round-trip preserves the
 * game's identity (and thus its `headHash`). A record written before S.1 stored no
 * uuid; passing `undefined` lets {@link importGame} lazily mint a fresh one — correct
 * for a legacy/local game that was never networked (design §2.2).
 */
function gameFromStoredLog(
  id: string,
  size: number,
  log: readonly unknown[],
  uuid: string | undefined,
): Game {
  const dump: GameExport = { uuid, size, settings: {}, log: log as readonly Event[] };
  try {
    return importGame(dump);
  } catch (e) {
    throw new ArchiveError(
      `archived game "${id}" has a corrupt or illegal log: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}

/**
 * Save (insert or overwrite) a game under `id` as its plain event log plus
 * metadata. The board `size` is stored on the record so {@link loadGame} can
 * reconstruct on the *same* board — the module's round-trip contract holds for any
 * board size, not just the default. The `headHash` is derived from the game and
 * stored in the metadata for O(1) identity in the listing. Overwriting the same id
 * is how autosave keeps the archive current as a game grows.
 */
export async function saveGame(
  db: IDBDatabase,
  id: string,
  game: Game,
  meta: ArchivedMeta,
): Promise<void> {
  const record: GameRecord & { readonly size: number } = {
    id,
    log: toPlainLog(game.log),
    size: game.state().size,
    meta: {
      players: meta.players,
      result: meta.result,
      startedAt: meta.startedAt,
      uuid: game.uuid,
      headHash: headHash(game.log),
      // Persist the identity-owned seat map WITH the game (design §2.3) when the caller
      // supplies one (a networked game). Omitted for a local game so its record stays
      // seat-less rather than carrying a spurious empty map.
      ...(meta.seats !== undefined ? { seats: meta.seats } : {}),
    },
  };
  await putGame(db, record);
}

/**
 * Load and reconstruct the game stored under `id`, or resolve `undefined` if no such
 * game exists.
 *
 * @throws {ArchiveError} if the stored log is corrupt or describes an illegal game.
 */
export async function loadGame(
  db: IDBDatabase,
  id: string,
): Promise<Game | undefined> {
  const record = await getGame(db, id);
  if (record === undefined) return undefined;
  const size = (record as Partial<ConflictedRecord>).size ?? DEFAULT_SIZE;
  // A record written before S.1 has no `meta.uuid`; pass it through as-is (possibly
  // undefined) so importGame lazily mints one for legacy games while a modern record
  // preserves its stored identity across the round-trip.
  return gameFromStoredLog(id, size, record.log, record.meta.uuid);
}

/**
 * Load the game stored under `id` AND its persisted identity-owned seat map (design §2.3),
 * or `undefined` if no such record exists. The seat map is the durable value that makes
 * reclaim-by-identity survive an EMPTY room (design §6.4): a returning owner reloads its
 * persisted game and reclaims the exact color it owned. A record with no stored `seats`
 * (a local game, or one saved before the field existed) yields `seats: null`.
 *
 * @throws {ArchiveError} if the stored log is corrupt or describes an illegal game.
 */
export async function loadNetGame(
  db: IDBDatabase,
  id: string,
): Promise<{ game: Game; seats: PersistedSeats | null } | undefined> {
  const record = await getGame(db, id);
  if (record === undefined) return undefined;
  const size = (record as Partial<ConflictedRecord>).size ?? DEFAULT_SIZE;
  const game = gameFromStoredLog(id, size, record.log, record.meta.uuid);
  const seats = record.meta.seats ?? null;
  return { game, seats };
}

/**
 * Load the archived game whose stable `uuid` (design §2.2, the portable identity, NOT the local
 * IndexedDB primary key) matches `uuid`, plus its persisted seat map — or `undefined` if none.
 *
 * This is the ONLY way back to a networked game in the v3.1 model (design §2: "games keyed by UUID"
 * are the source of truth; the room CODE maps to nothing). Two seed paths use it: a `resume`/`current`
 * proposal, which carries the game's `uuid` + `headHash` and needs the actual log to seed its engine
 * with the SAME identity it published in its hello; and a returning peer re-seeding the game its
 * `activeNetworkedGame` breadcrumb names (`src/net/activeGame.ts`).
 *
 * Resolution is DETERMINISTIC, in two steps:
 *  1. the record stored UNDER the uuid — the canonical form a live net session writes (its record id
 *     IS the game uuid), which is also the one carrying the identity-owned seat map the empty-room
 *     reclaim needs. Its stored game must actually BEAR that uuid: a record id that merely collides
 *     with another game's uuid is not that game, and serving it would be a silent mis-resolution.
 *  2. otherwise a scan of the listing by `meta.uuid` — a game archived under a DIFFERENT record id,
 *     e.g. the app's local autosave record that a `resume`/`current` proposal names.
 *
 * @throws {ArchiveError} if the matched record's log is corrupt or describes an illegal game.
 */
export async function loadNetGameByUuid(
  db: IDBDatabase,
  uuid: string,
): Promise<{ game: Game; seats: PersistedSeats | null } | undefined> {
  // Step 1 is a PROBE, so a corrupt record sitting under this key must not sink the lookup: the game
  // may well be archived intact under a DIFFERENT record id (step 2), which is what the pre-V.1
  // scan-only implementation would have found. A failure here is therefore REMEMBERED rather than
  // fatal…
  let canonicalError: unknown = null;
  const canonical = await loadNetGame(db, uuid).catch((err: unknown) => {
    canonicalError = err;
    return undefined;
  });
  if (canonical !== undefined && canonical.game.uuid === uuid) return canonical;
  const listings = await listGames(db);
  // Step 2 scans the OTHER records only: the record keyed by the uuid was just probed, and re-loading
  // it here would either re-throw the corruption we deliberately passed over, or — when its meta
  // claims a uuid its log does not bear — serve the very collider step 1 refused (a mis-resolution).
  const match = listings.find((l) => l.meta.uuid === uuid && l.id !== uuid);
  if (match === undefined) {
    // …and re-thrown when there is no intact alternative: a corrupt record is only ever passed over in
    // favour of a real answer, never silently turned into "no such game" (agent-principles: an error
    // is surfaced, not masked).
    if (canonicalError !== null) throw canonicalError;
    return undefined;
  }
  return loadNetGame(db, match.id);
}

/**
 * List every archived GAME as `{ id, meta, events }` (no logs), sorted by `startedAt` descending so
 * the most recently started game is first — the natural order for an archive browser (Stage 5).
 *
 * Every game appears, and each appears **once**. There is no marker-based exclusion any more (the v3
 * `net-room:{code}` shard + its filter died with the coupling that created them — V.1, epic #47; the
 * shards a v3 build left behind are DELETED by {@link purgeLegacyNetRoomRecords}, not hidden): a
 * networked game is an ordinary record keyed by its own UUID, and with reload → empty slate the games
 * list is the ONLY route back to it (design §10, #37), so hiding a real game would lose it.
 *
 * What IS collapsed is a **shadow** of a game already stored canonically. One game legitimately ends
 * up in two records: the app's autosave record (a local board, keyed by the app's autosave id) and —
 * once that same game is carried into a room — the canonical record the net session keeps under the
 * game's OWN uuid (design §2: "games keyed by UUID" are the source of truth). Listing both would show
 * ONE game twice, and picking the shadow would open a stale fork of it and silently drop the
 * identity-owned seat map the empty-room reclaim needs. So a record whose `meta.uuid` is the id of
 * ANOTHER record — i.e. that game is canonically archived under its uuid — is dropped in favour of
 * the canonical one.
 *
 * Two records are NEVER collapsed: a CONFLICTED record (it stores both forks — information no other
 * record holds, so it is its own artifact rather than a duplicate view of one game), and a shadow that
 * holds MORE events than the canonical record (two records for one game where the canonical one has
 * LESS history is anomalous; this listing never hides history — it shows both and lets the player
 * choose rather than silently serving the shorter one).
 */
export async function listArchivedGames(db: IDBDatabase): Promise<GameListing[]> {
  const listings = await listGames(db);
  // The canonical record of a game is the one whose primary key IS the game's uuid.
  const canonical = new Map<string, GameListing>();
  for (const listing of listings) {
    if (listing.id === listing.meta.uuid) canonical.set(listing.meta.uuid, listing);
  }
  return listings
    .filter((listing) => {
      if (listing.id === listing.meta.uuid) return true; // the canonical record itself
      // A conflicted record carries BOTH forks (see `flagConflicted`); the canonical record of the
      // same uuid carries neither, so it can never stand in for it.
      if (listing.meta.result === 'conflicted') return true;
      const owner = canonical.get(listing.meta.uuid);
      if (owner === undefined) return true; // no canonical copy → this IS the game's only record
      return listing.events > owner.events; // never hide MORE history than the canonical holds
    })
    .sort((a, b) => b.meta.startedAt - a.meta.startedAt);
}

/**
 * When each archived GAME began, keyed by its portable `uuid` (design §2.2) — the identity a
 * networked session knows a game by, NOT the local record id.
 *
 * `startedAt` is a durable property of the GAME, not of whichever session last wrote its record: the
 * listing is sorted by it and the archive browser renders it as the game's date, and since the games
 * list is the only route back to a game (design §10, #37) re-dating a game the player returns to is a
 * user-visible loss. A writer that re-persists a game it did not start reads its stamp from here
 * instead of minting one (`NetSession.primeStartedAts`).
 *
 * Read over the LISTING (metadata only, via the store's cursor — no event logs are folded), so one
 * pass answers the question for every archived game at once.
 *
 * One game legitimately occupies two records (the app's autosave shadow plus the canonical uuid-keyed
 * record — see {@link listArchivedGames}); the EARLIEST stamp wins, since the game began once and the
 * shadow is the record that existed first. That also makes the result independent of store order.
 */
export async function archivedStartedAts(db: IDBDatabase): Promise<ReadonlyMap<string, number>> {
  const stamps = new Map<string, number>();
  for (const listing of await listGames(db)) {
    const known = stamps.get(listing.meta.uuid);
    const began = listing.meta.startedAt;
    stamps.set(listing.meta.uuid, known === undefined ? began : Math.min(known, began));
  }
  return stamps;
}

/**
 * Whether a listing is an **empty shell**: a record for a game with no history at all and no outcome
 * (`events === 0`, still `in-progress`) — a board on which nothing ever happened.
 *
 * Kept in the store (a live net session's record is written the moment seats are negotiated, and the
 * empty-room reclaim re-seeds an unplayed game — a post-rematch board — from it by uuid), but it is
 * not a *game* to offer the player: there is nothing to return to that "New game" would not give
 * them, and one such record per abandoned room would accumulate into pure noise in the games list.
 * The app applies this to what it SHOWS (`main.ts`), keeping the store honest and complete while the
 * archive browser + resume list agree with the local rule that a never-played board is not a game.
 */
export function isEmptyShell(listing: GameListing): boolean {
  return listing.events === 0 && listing.meta.result === 'in-progress';
}

/**
 * MIGRATION (V.1, epic #47) — delete every v3 internal `net-room:{code}` shard
 * ({@link LEGACY_NET_ROOM_RESULT}) this origin's IndexedDB still holds, resolving with the ids
 * removed (empty when there were none, so a caller can log an observed fact).
 *
 * v3 hid these from the listing with a marker filter; v3.1 has no such filter, so without this
 * migration every shard a deployed v3 build wrote would render as a user-facing game ("? vs ? ·
 * net-room", unresumable) and be offered as a resume seed. They are not games: the same authoritative
 * game was archived under the app's autosave id too, so the history survives this delete — what goes
 * is a duplicate keyed by a room code, the exact artifact the v3.1 model exists to abolish.
 *
 * Idempotent: a second run finds nothing and deletes nothing. Errors propagate (a failed delete
 * rejects with its `DOMException` rather than resolving as a silent success).
 */
export async function purgeLegacyNetRoomRecords(db: IDBDatabase): Promise<readonly string[]> {
  const shards = (await listGames(db)).filter(
    (listing) => listing.meta.result === LEGACY_NET_ROOM_RESULT,
  );
  for (const shard of shards) {
    await deleteGame(db, shard.id);
  }
  return shards.map((shard) => shard.id);
}

/** Inputs to {@link flagConflicted}: both forked logs plus the caller's metadata. */
export interface ConflictInput {
  /** The local fork's event log. */
  readonly mineLog: EventLog;
  /** The remote fork's event log. */
  readonly theirsLog: EventLog;
  /** Metadata (its `result` is overridden to `'conflicted'`). */
  readonly meta: ArchivedMeta;
  /** Board size for reconstructing the forks (defaults to the v1 board size). */
  readonly size?: number;
}

/**
 * Archive a conflicted game under `id`, storing **both** forked logs flagged
 * `conflicted` so a future resolution feature can reopen the exact fork
 * (game-core design, Part 3). The `headHash` in the metadata is the local fork's,
 * and the record's `log` mirrors the local fork so a conflicted game still lists
 * like any other; the canonical pair lives in `forks`.
 */
export async function flagConflicted(
  db: IDBDatabase,
  id: string,
  input: ConflictInput,
): Promise<void> {
  const size = input.size ?? DEFAULT_SIZE;
  const mine = toPlainLog(input.mineLog);
  const theirs = toPlainLog(input.theirsLog);
  const record: ConflictedRecord = {
    id,
    log: mine,
    size,
    forks: { mine, theirs },
    forkUuids: { mine: input.mineLog.uuid, theirs: input.theirsLog.uuid },
    meta: {
      players: input.meta.players,
      result: 'conflicted',
      startedAt: input.meta.startedAt,
      // Metadata identity mirrors the local fork (as `headHash` does).
      uuid: input.mineLog.uuid,
      headHash: headHash(input.mineLog),
    },
  };
  await putGame(db, record);
}

/**
 * Load a conflicted game under `id`, reconstructing **both** forks into `Game`s, or
 * resolve `undefined` if no such record exists.
 *
 * @throws {ArchiveError} if the record is not a conflicted game (no stored forks),
 *   or if either forked log is corrupt/illegal.
 */
export async function loadConflicted(
  db: IDBDatabase,
  id: string,
): Promise<ConflictedGame | undefined> {
  const record = (await getGame(db, id)) as ConflictedRecord | undefined;
  if (record === undefined) return undefined;
  if (record.meta.result !== 'conflicted' || record.forks === undefined) {
    throw new ArchiveError(`archived game "${id}" is not a conflicted game`);
  }
  const size = record.size ?? DEFAULT_SIZE;
  return {
    mine: gameFromStoredLog(`${id} (mine)`, size, record.forks.mine, record.forkUuids?.mine),
    theirs: gameFromStoredLog(`${id} (theirs)`, size, record.forks.theirs, record.forkUuids?.theirs),
  };
}
