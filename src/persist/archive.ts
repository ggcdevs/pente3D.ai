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
import { headHash, isPrefix, type Event, type EventLog } from '../core/eventLog';
import { importGame, type GameExport } from '../core/serialize';
import {
  getGame,
  putGame,
  listGames,
  deleteGame,
  rekeyGame,
  purgeGames,
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
 * Written by `NetSession.persistGame` (the same session code in the browser AND the CLI), which is the
 * only writer that ever ESTABLISHES it. The app's autosave writes the local board it is playing on, and
 * a game that has been in a room can end up being that board (it is resumed from the games list, or the
 * room was entered on the "Current local board" seed) — so the app never writes this projection itself
 * and never replaces a stored one: it carries an existing seat map + players forward untouched
 * ({@link archivedIdentity}). The identity belongs to the game; only the board is the app's to update.
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
 *
 * `now` stamps `meta.updatedAt` — WHEN THIS RECORD WAS WRITTEN, which is a different fact from the
 * game's `startedAt` and the one {@link purgeEmptyShellRecords} needs to tell an abandoned seated husk
 * from another tab's live room. It defaults to the clock, and a caller that owns one (the net session
 * injects its own) passes it so its writes are deterministic.
 */
export async function saveGame(
  db: IDBDatabase,
  id: string,
  game: Game,
  meta: ArchivedMeta,
  now: number = Date.now(),
): Promise<void> {
  const record: GameRecord & { readonly size: number } = {
    id,
    log: toPlainLog(game.log),
    size: game.state().size,
    meta: {
      players: meta.players,
      result: meta.result,
      startedAt: meta.startedAt,
      updatedAt: now,
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
 *  2. otherwise a scan of the listing by `meta.uuid` — a game archived under a DIFFERENT record id.
 *     Since V.5 every writer keys a record by the game's uuid, so this finds the records that key
 *     cannot reach: a conflicted record (keyed by its conflict id), and any record an older build wrote
 *     under its retired autosave id that the boot re-key
 *     ({@link rekeyArchiveRecordsByGameUuid}) has not run over yet.
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
 * The IDENTITY a stored record already carries — its `players` map and its identity-owned `seats`
 * (design §2.3) — or `undefined` when no record is stored under `id`, and `null` seats when the record
 * has none (an ordinary local game).
 *
 * Read by the app's autosave before it rewrites the board it is playing on, so a game that HAS been in
 * a room keeps who owned its seats even when the local board becomes the thing being written (a game
 * resumed from the games list, or a room entered on the "Current local board" seed). Establishing the
 * seat map is `NetSession`'s alone; preserving it is everybody's (design §6.4 — the empty-room reclaim
 * and the rejoin prompt's colour are derived from it, so dropping it silently un-seats a returning
 * owner). Metadata only: no log is folded.
 */
export async function archivedIdentity(
  db: IDBDatabase,
  id: string,
): Promise<{ players: Readonly<Record<string, string>>; seats: PersistedSeats | null } | undefined> {
  const record = await getGame(db, id);
  if (record === undefined) return undefined;
  return { players: record.meta.players, seats: record.meta.seats ?? null };
}

/**
 * List every archived GAME as `{ id, meta, events }` (no logs), sorted by `startedAt` descending so
 * the most recently started game is first — the natural order for an archive browser (Stage 5).
 *
 * **Every record appears, unfiltered.** There is no marker-based exclusion (the v3 `net-room:{code}`
 * shard + its filter died with the coupling that created them — V.1, epic #47; the shards a v3 build
 * left behind are DELETED by {@link purgeLegacyNetRoomRecords}, not hidden) and no de-duplication
 * either: since V.5 every writer keys a record by the GAME's own uuid — the app's autosave for a local
 * board and {@link loadNetGameByUuid}'s counterpart `NetSession.persistGame` for a networked one — so
 * one game IS one record by construction, and a records-to-games heuristic here would have nothing
 * left to collapse. With reload → empty slate this listing is the ONLY route back to a game
 * (design §6/§10, #37), so it hides nothing.
 *
 * (Records an older build keyed by its retired autosave id are re-keyed once, at boot, by
 * {@link rekeyArchiveRecordsByGameUuid} — a migration, so a game archived before V.5 stays listed and
 * resumable rather than being hidden by a listing rule.)
 */
export async function listArchivedGames(db: IDBDatabase): Promise<GameListing[]> {
  const listings = await listGames(db);
  return listings.sort((a, b) => b.meta.startedAt - a.meta.startedAt);
}

/**
 * When each archived GAME began, keyed by its portable `uuid` (design §2.2) — the identity a
 * networked session knows a game by, NOT the local record id.
 *
 * `startedAt` is a durable property of the GAME, not of whichever session last wrote its record: the
 * listing is sorted by it and the archive browser renders it as the game's date, and since the games
 * list is the only route back to a game (design §10, #37) re-dating a game the player returns to is a
 * user-visible loss. A writer that re-persists a game it did not start ADOPTS its stamp from here
 * instead of minting one — see {@link StartedAtLedger}, which both writers hold one of.
 *
 * Read over the LISTING (metadata only, via the store's cursor — no event logs are folded), so one
 * pass answers the question for every archived game at once.
 *
 * The EARLIEST stamp wins if two records still claim one uuid (a conflicted record archives the same
 * game's local fork under its own key, and a pre-V.5 store holds an un-migrated duplicate until the
 * boot re-key runs): the game began once, so the oldest claim about when is the right one — and taking
 * the minimum also makes the result independent of store order.
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
 * The `startedAt` a writer stamps each game's archive record with — established ONCE per game uuid and
 * then reused (Task V.5, epic #47). Held by BOTH writers of the archive (the app's autosave in
 * `main.ts` for a local board, `NetSession` for a networked game), because both face the same question
 * about a game they did not start: a returned-to game must keep the date it BEGAN.
 *
 * Two sources, in this order:
 *
 *  - **ADOPTED** from the archive via {@link adopt} ({@link archivedStartedAts}) — a game this browser
 *    already holds began when it began, so re-persisting it (a breadcrumb return, a `resume` seed, an
 *    adopted peer log we happen to hold, a resumed local board) must write that same date back;
 *  - **MINTED** from the clock in {@link stampFor}, for a game being persisted for the first time.
 *
 * Reuse is what keeps a per-change autosave from re-stamping the record on every move and shuffling the
 * game to the top of the (startedAt-sorted) listing.
 *
 * A plain in-memory map, so a lookup is SYNCHRONOUS: a writer decides a record's id and its whole
 * metadata in one synchronous step, and an async read per write would let two consecutive writes of
 * one record disagree about its date.
 */
export class StartedAtLedger {
  private readonly stamps = new Map<string, number>();

  /**
   * Adopt the dates the archive already holds ({@link archivedStartedAts}), overwriting nothing this
   * ledger has established itself — a stamp we minted for a game IS its start, and the archive's copy
   * of it is the same value written back.
   */
  adopt(known: ReadonlyMap<string, number>): void {
    for (const [uuid, startedAt] of known) {
      if (!this.stamps.has(uuid)) this.stamps.set(uuid, startedAt);
    }
  }

  /**
   * The stamp for `uuid` — the established one, or `now` minted and remembered on genuinely first use.
   * Idempotent: called again for the same game it returns the same value, whatever the clock says.
   */
  stampFor(uuid: string, now: number): number {
    const known = this.stamps.get(uuid);
    if (known !== undefined) return known;
    this.stamps.set(uuid, now);
    return now;
  }
}

/**
 * MIGRATION (Task V.5, epic #47) — re-key every record an older build stored under something other
 * than its game's `uuid`, resolving with the ids that are no longer under the key they were stored at:
 * every record MOVED, plus every duplicate DROPPED because the surviving record provably contains it
 * (empty when there was nothing to do, so a caller logs an observed fact).
 *
 * Before V.5 the app autosaved the current game under a localStorage-persisted "autosave id" of its
 * own; V.5 keys every record by `game.uuid` so one game has exactly one record (design §2 "games keyed
 * by UUID"). Without this migration a game archived by an older build would keep its old key, and
 * playing it again (resume) would write a SECOND record under the game's uuid — one game, two records,
 * the exact duplication the re-keying exists to abolish. Re-keying is the honest fix: the record moves
 * whole ({@link rekeyGame}, one transaction), so nobody loses a game to the change.
 *
 * Two records are deliberately left where they are:
 *
 *  - a record with no `meta.uuid` (written before games carried one): there is no key to move it to.
 *    It stays listed and resumable under its own id, exactly as it was.
 *  - a CONFLICTED record: it is keyed by its own conflict id and stores BOTH forks — information no
 *    other record holds — so moving it onto the game's uuid would overwrite the game with one of its
 *    forks. It stays its own artifact (as it was before V.5, when the listing exempted it too).
 *
 * WHEN SEVERAL RECORDS CLAIM ONE UUID, the destination holds exactly one of them, so the survivor is
 * decided ONCE — over ALL of that game's records together — before anything is written: the record with
 * MORE events wins, and a tie is broken in favour of the record already under the uuid (it is the
 * canonical one, carrying the seat map). A LOSER is deleted only when the survivor provably CONTAINS
 * it — its log is a hash-chain PREFIX of the survivor's ({@link survivorContains}), which is the only
 * proof there is. Any other record — a divergent line of play, whatever its length, and any record
 * whose log will not replay — is left exactly where it is: a duplicate row in the games list is
 * recoverable, a deleted history is not (this migration must never trade history for tidiness).
 *
 * A kept record sitting ON the destination key also CANCELS the re-key, because {@link rekeyGame}
 * overwrites its destination: moving the survivor onto a divergent record we just refused to delete
 * would destroy it by the back door. Both records then stay where they are, exactly as two divergent
 * records elsewhere do.
 *
 * Deciding per-uuid rather than per-record is what makes the outcome independent of STORE ORDER. Moving
 * records one at a time against a snapshot of the listing let a second claimant overwrite the first at
 * the destination ({@link rekeyGame} overwrites), so whichever record came last in key order won — and a
 * pre-V.5 store really did hold two records per game (a resume continued an archived game under a fresh
 * autosave id, both carrying its uuid), which is exactly how history got destroyed.
 *
 * Idempotent — a second run finds nothing left to move. Errors propagate.
 */
export async function rekeyArchiveRecordsByGameUuid(
  db: IDBDatabase,
): Promise<readonly string[]> {
  const listings = await listGames(db);
  const byId = new Map(listings.map((listing) => [listing.id, listing]));
  // Every record that COULD move onto a given uuid, grouped by that uuid. A record with no `meta.uuid`
  // (pre-uuid) has no destination, and a CONFLICTED record stores both forks — information no other
  // record holds — so neither is a claimant; both stay where they are.
  const claimants = new Map<string, GameListing[]>();
  for (const listing of listings) {
    const uuid = listing.meta.uuid;
    if (uuid === undefined) continue;
    if (listing.meta.result === 'conflicted') continue;
    const group = claimants.get(uuid);
    if (group === undefined) claimants.set(uuid, [listing]);
    else group.push(listing);
  }
  const moved: string[] = [];
  for (const [uuid, group] of claimants) {
    // Never overwrite a CONFLICTED record sitting on the game's uuid — it holds both forks, so no
    // ordinary record can stand in for it. Every claimant stays where it is.
    if (byId.get(uuid)?.meta.result === 'conflicted') continue;
    const survivor = group.reduce((best, l) => (beatsForUuid(l, best, uuid) ? l : best));
    // Set once a record we could NOT prove stale is holding the destination key itself (see the
    // re-key below).
    let destinationKept = false;
    for (const loser of group) {
      if (loser.id === survivor.id) continue;
      // Only a record whose history the survivor provably CONTAINS is dropped — proven against the
      // hash chain, never inferred from a length.
      if (await survivorContains(db, survivor.id, loser.id)) {
        await deleteGame(db, loser.id);
        moved.push(loser.id);
      } else if (loser.id === uuid) {
        destinationKept = true;
      }
    }
    if (survivor.id !== uuid && !destinationKept) {
      await rekeyGame(db, survivor.id, uuid);
      moved.push(survivor.id);
    }
  }
  return moved;
}

/**
 * Whether the record stored under `survivorId` provably CONTAINS the history stored under `loserId` —
 * the only licence {@link rekeyArchiveRecordsByGameUuid} has to delete a record.
 *
 * The proof is the HASH CHAIN and nothing else: both logs are folded and the loser's must be a
 * {@link isPrefix} of the survivor's, i.e. every entry hash matches at the same ply — and a cumulative
 * entry hash matching means the ENTIRE history up to that ply matches, so containment is established
 * for the whole log, not sampled. An identical pair passes it too (a log is a prefix of itself).
 *
 * A LENGTH proves nothing and is deliberately not consulted: a shorter log can be a completely
 * different line of play (resume + undo + a different continuation leaves exactly that beside the
 * original in a pre-V.5 store), and dropping it would destroy the only copy of that history — the
 * failure this migration exists to prevent.
 *
 * A record that cannot be FOLDED — absent, or a corrupt/illegal log ({@link ArchiveError}) — is
 * reported as NOT contained, so it survives. That is not an error being swallowed: the question asked
 * here is "is this provably contained?", and a log that will not replay answers it with a definite no.
 * Any other failure (a store error) propagates untouched.
 */
async function survivorContains(
  db: IDBDatabase,
  survivorId: string,
  loserId: string,
): Promise<boolean> {
  const survivor = await foldStoredLog(db, survivorId);
  const loser = await foldStoredLog(db, loserId);
  return survivor !== null && loser !== null && isPrefix(loser, survivor);
}

/**
 * The stored record's event log WITH its hash chain (folded through the rules engine by
 * {@link loadGame}), or `null` when no such record is stored or its log does not replay. See
 * {@link survivorContains} for why an unreadable log is a `null` rather than a throw — and note that
 * only {@link ArchiveError} (this module's own "that log is corrupt or illegal" verdict) is turned
 * into one: an IndexedDB failure is a different fact and propagates.
 */
async function foldStoredLog(db: IDBDatabase, id: string): Promise<EventLog | null> {
  try {
    return (await loadGame(db, id))?.log ?? null;
  } catch (e) {
    if (e instanceof ArchiveError) return null;
    throw e;
  }
}

/**
 * Whether `candidate` should displace `best` as the record that ends up under `uuid`: MORE history
 * wins, and on a tie the record already keyed by the uuid does (it is the canonical one — the live net
 * writer's record, carrying the identity-owned seat map — so an equal-length copy must not replace it).
 * A tie between two non-canonical records leaves the incumbent, which the caller's fold seeds from the
 * listing in key order, so the choice is deterministic rather than store-order-dependent luck.
 */
function beatsForUuid(candidate: GameListing, best: GameListing, uuid: string): boolean {
  if (candidate.events > best.events) return true;
  if (candidate.events < best.events) return false;
  // Equal histories: only the canonical record displaces the incumbent. A record id is unique, so
  // `candidate.id === uuid` already says the incumbent is not the canonical one.
  return candidate.id === uuid;
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
export function isEmptyShell(listing: Pick<GameListing, 'events' | 'meta'>): boolean {
  return listing.events === 0 && listing.meta.result === 'in-progress';
}

/**
 * Delete every {@link isEmptyShell} record the caller does not ask to KEEP, resolving with the ids
 * removed (empty when there were none, so a caller logs an observed fact).
 *
 * A husk is written by construction, not by accident: since V.5 a record is keyed by its game's uuid
 * and the app persists the board the moment it exists, so every boot and every reset leaves behind a
 * board on which nothing ever happened. They are invisible (the app's games list drops shells) but they
 * are REAL rows — the store grew by a couple of records per page load forever, and every boot scan
 * (purge, re-key, `archivedStartedAts`) got slower with them. Nothing is lost by dropping one: an
 * `events === 0`, still-`in-progress` record holds no history and no outcome, and "New game" gives the
 * player an identical board.
 *
 * `keep` is the caller's list of shells that are NOT abandoned and must survive: the board currently
 * loaded, and any game a live session owns — a net session writes its record the moment seats are
 * negotiated, and the empty-room reclaim (design §6.4) re-seeds an unplayed game (a post-rematch board)
 * from it by uuid, so deleting that one would un-seat a returning owner.
 *
 * A record carrying a SEAT MAP is kept BEYOND that list while it is still RECENT — younger than
 * {@link SEATED_SHELL_MAX_AGE_MS} by its `meta.updatedAt` — because the store is shared by every tab of
 * the origin and the one live room the caller's `keep` cannot see is another TAB's. That exemption is
 * bounded in TIME rather than granted forever, because forever leaks: `NetSession.persistGame` writes
 * seats from the moment seats are negotiated, so every room entered and left without a single move
 * would otherwise leave one permanent, invisible `{events: 0, in-progress, seats}` row — the very
 * accumulation this collector exists to stop, re-created for networked boards. Past the horizon the
 * seated husk is collected like any other: it holds no history and no outcome, and a room nothing has
 * written to for that long is not live. A seated record with NO `updatedAt` is likewise collectable —
 * every write of this build stamps one, so its absence means the record was written by an earlier page
 * load, not by a session that is still going.
 *
 * (An unplayed LOCAL board of another tab can still be collected at any age; it holds no history, and
 * that tab rewrites its record on its next change. This is the one deliberate cross-tab effect, stated
 * rather than discovered.)
 *
 * `now` is the clock the age is measured against (injected, so the rule is testable at its exact
 * boundary); it defaults to `Date.now()`.
 *
 * Idempotent: a second run finds nothing new. Errors propagate.
 */
export function purgeEmptyShellRecords(
  db: IDBDatabase,
  keep: ReadonlySet<string> = new Set(),
  now: number = Date.now(),
): Promise<readonly string[]> {
  // ONE transaction, judging each record as the cursor finds it ({@link purgeGames}): the store is
  // shared by every tab of the origin, so a husk can become a played game between a scan and a
  // delete-by-id — and deleting it then would destroy exactly the history this rule exists to spare.
  return purgeGames(
    db,
    (record) =>
      isEmptyShell({ events: record.log.length, meta: record.meta }) &&
      !isRecentlyWrittenSeat(record.meta, now) &&
      !keep.has(record.id) &&
      !keep.has(record.meta.uuid),
  );
}

/**
 * How long a SEATED empty shell is presumed to belong to a live room this caller cannot see (another
 * tab's): 24h, the same horizon the `activeNetworkedGame` breadcrumb is believed for
 * (`net/activeGame.ts` — design §6, "a stale `updatedAt` expires quietly"). The two agree on purpose:
 * past a day the app itself stops offering the room back, so a seated husk nothing has written to since
 * then is protecting nothing.
 */
export const SEATED_SHELL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Whether `meta` describes a SEATED record written recently enough to still be somebody's live room
 * (see {@link purgeEmptyShellRecords}). Seat-less records are never exempt; a seated record with no
 * `updatedAt` stamp is not either (it predates this build's writes). The boundary is INCLUSIVE —
 * exactly {@link SEATED_SHELL_MAX_AGE_MS} old still counts as recent — mirroring `isActiveGameStale`.
 */
function isRecentlyWrittenSeat(meta: GameRecord['meta'], now: number): boolean {
  if (meta.seats === undefined) return false;
  // An absent stamp is read as the EPOCH — "written before this build ever stamped a record", which is
  // older than any horizon. That is the answer its absence deserves, and reading it this way rather
  // than as its own `if` keeps the rule to one comparison (a branch whose outcome no input could
  // distinguish from this one would be untestable padding).
  const writtenAt = meta.updatedAt ?? 0;
  return now - writtenAt <= SEATED_SHELL_MAX_AGE_MS;
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
