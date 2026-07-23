/**
 * A thin promise wrapper over an IndexedDB `games` object store (build plan
 * Task 2.1; GLOSSARY "Game archive").
 *
 * Every game is persisted for later review as its **event log + metadata**, keyed
 * by a stable game id. IndexedDB is used rather than localStorage because a game
 * archive outgrows localStorage's ~5 MB cap (game-core design, Part 3). This module
 * is deliberately mechanism-only: it stores and retrieves opaque `GameRecord`s and
 * knows nothing about `Game`/rules — the archive layer (Task 2.2) builds the records
 * from the core and layers save/load/list-conflicted semantics on top.
 *
 * The IndexedDB API is event/callback based; every operation here is wrapped so it
 * resolves or rejects a promise, and errors propagate honestly (a failed request
 * rejects with its underlying `DOMException`) — never swallowed or masked
 * (agent-principles: logging discipline). `list` reads only the id + metadata via a
 * cursor so the (potentially large) event logs are not loaded when browsing the
 * archive.
 *
 * This layer is *not* `src/core`: it may use IndexedDB (a DOM API). It must not
 * import three/render/ui.
 */

/** The current schema version for the games database. */
export const DB_VERSION = 1;

/** The single object store this wrapper manages. */
export const GAMES_STORE = 'games';

/** The default database name (overridable, chiefly so tests can isolate state). */
export const DEFAULT_DB_NAME = 'pente3d';

/**
 * The window seam a Playwright test sets (via `addInitScript`, BEFORE boot) to give each test its
 * OWN archive database, mirroring the `__penteNetTransportFactory` seam. Playwright partitions
 * IndexedDB per browser context, so tests are already isolated from each other; this seam is the
 * belt-and-braces guarantee that no two app boots on the same origin (e.g. across parallel workers)
 * can ever contend on the single `pente3d` store, keeping the archive e2e gate scheduling-independent.
 */
declare global {
  interface Window {
    /** Test-only: overrides the archive DB name so each e2e test opens an isolated store. */
    __penteDbName?: string;
  }
}

/**
 * Resolve the archive database name the app should open: the test-injected {@link Window.__penteDbName}
 * if present (isolated per-test store), else {@link DEFAULT_DB_NAME}. App boot paths ({@link openDatabase}
 * callers in `main.ts` / `appSession.ts`) route through this so a single override isolates BOTH the
 * autosave/archive DB and the net-session DB for one page — they legitimately share one store in prod.
 */
export function resolveDbName(): string {
  const injected = typeof window !== 'undefined' ? window.__penteDbName : undefined;
  return injected !== undefined && injected.length > 0 ? injected : DEFAULT_DB_NAME;
}

/**
 * Metadata stored alongside a game's log — everything the archive browser needs to
 * list a game *without* loading its full event log. The shape is intentionally
 * open (`players`/`result` are opaque strings the persist layer round-trips) so it
 * stays forward-compatible with what the archive (Task 2.2) attaches.
 */
export interface GameMeta {
  /** Seat → display name / id (opaque to this layer). */
  readonly players: Readonly<Record<string, string>>;
  /** Outcome marker, e.g. `'in-progress' | 'white-wins' | 'conflicted'`. */
  readonly result: string;
  /** Epoch millis when the game began. */
  readonly startedAt: number;
  /**
   * The game's UUID — its stable identity, minted at genesis and part of the
   * hashed history (S.1). Stored in the metadata so the archive browser and the
   * networked-resume flow can identify a game (and match it against a peer's
   * proposal) without loading its full log. Distinct from {@link GameRecord.id},
   * which is only the local IndexedDB primary key; for games saved under S.1 the
   * two coincide, but the uuid is the *portable, shared* identity.
   */
  readonly uuid: string;
  /** The event log's `headHash` — fingerprints the whole history (O(1) identity). */
  readonly headHash: string;
  /**
   * The identity-owned seat map bound to this game (design §2.3 "Identity-owned
   * seats", build-plan S.2 "Seat map becomes part of the *game* (persisted)"):
   * `{ white, black }` = the real `playerId` that owns each seat, or `null`. This
   * is what makes reclaim-by-identity survive an EMPTY room — a returning owner
   * reloads its persisted game and reclaims the exact color it owned, rather than
   * grabbing first-available white (design §6.4). Optional: a game persisted before
   * this field (or a local, never-networked game) has no seat map; the net-session
   * glue treats an absent value as "no owner recorded yet".
   */
  readonly seats?: {
    readonly white: string | null;
    readonly black: string | null;
  };
}

/**
 * One stored game: its id, full event log (as plain events), and metadata. The
 * `log` is typed loosely as an array of unknown-shaped records because this layer
 * round-trips it faithfully without interpreting it — the core owns the `Event`
 * shape; the archive owns building records from a `Game`.
 */
export interface GameRecord {
  /** The primary key: a stable, unique game id. */
  readonly id: string;
  /** The append-only event log, in order (opaque to this layer). */
  readonly log: readonly Readonly<Record<string, unknown>>[];
  /** Listing/summary metadata. */
  readonly meta: GameMeta;
}

/** The listing form of a record: id + metadata, deliberately **without** the log. */
export type GameListing = Omit<GameRecord, 'log'>;

/**
 * Wrap an `IDBRequest` as a promise resolving with its `result` (or rejecting with
 * its `error`). This is the single adapter from IndexedDB's event model to promises.
 */
function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Wrap a write transaction as a promise that resolves when it *commits* (not merely
 * when the request succeeds), so a caller awaiting a `put`/`delete` knows the change
 * is durable. Rejects on transaction error/abort with the underlying error.
 */
function transactionToPromise(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Open (creating/upgrading if needed) the games database and resolve with the live
 * `IDBDatabase` handle. On first open (or a version bump) the `games` object store
 * is created keyed by `id`. Callers pass the handle back into the operations below;
 * they own closing it.
 *
 * The `games` store is created idempotently: `onupgradeneeded` fires on first open
 * AND on every version bump, but the store is only ever created once. The
 * `if (!contains(GAMES_STORE))` guard makes a bump that carries no new store a safe
 * no-op — WITHOUT it, `createObjectStore('games')` on an already-present store throws
 * `ConstraintError`, aborts the upgrade transaction, and rejects the open (losing the
 * live handle and leaving prior data unreachable). The `version` parameter exists so
 * this guard is reachable and testable: a test can re-open an existing db at a higher
 * version and assert the open still succeeds with the store — and its data — intact.
 *
 * @param name Database name (defaults to {@link DEFAULT_DB_NAME}). Tests pass a
 *   unique name per case for isolation.
 * @param version Schema version to open at (defaults to {@link DB_VERSION}). Opening
 *   at a version higher than the stored one triggers `onupgradeneeded`; opening below
 *   it rejects with a `VersionError`. Callers should normally use the default; the
 *   parameter chiefly lets tests drive a real upgrade through this same code path.
 */
export function openDatabase(
  name: string = DEFAULT_DB_NAME,
  version: number = DB_VERSION,
): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(GAMES_STORE)) {
        db.createObjectStore(GAMES_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Store (insert or overwrite) a game record, keyed by its `id`. Resolves once the
 * write transaction commits.
 */
export async function putGame(db: IDBDatabase, record: GameRecord): Promise<void> {
  const tx = db.transaction(GAMES_STORE, 'readwrite');
  tx.objectStore(GAMES_STORE).put(record);
  await transactionToPromise(tx);
}

/**
 * Load a game record by id, or resolve with `undefined` when no such record exists.
 * (IndexedDB's `get` yields `undefined` for a missing key; we surface that as-is.)
 */
export async function getGame(
  db: IDBDatabase,
  id: string,
): Promise<GameRecord | undefined> {
  const tx = db.transaction(GAMES_STORE, 'readonly');
  const result = await requestToPromise<GameRecord | undefined>(
    tx.objectStore(GAMES_STORE).get(id),
  );
  return result;
}

/**
 * List every stored game as `{ id, meta }`, **omitting the full log**. Uses a cursor
 * and projects each record to its listing form, so browsing the archive never loads
 * the (potentially large) event logs into memory.
 */
export function listGames(db: IDBDatabase): Promise<GameListing[]> {
  return new Promise<GameListing[]>((resolve, reject) => {
    const tx = db.transaction(GAMES_STORE, 'readonly');
    const request = tx.objectStore(GAMES_STORE).openCursor();
    const listings: GameListing[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const record = cursor.value as GameRecord;
        listings.push({ id: record.id, meta: record.meta });
        cursor.continue();
      } else {
        resolve(listings);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete a game record by id. Deleting a missing key is a no-op that still resolves
 * (IndexedDB's `delete` does not error on an absent key).
 */
export async function deleteGame(db: IDBDatabase, id: string): Promise<void> {
  const tx = db.transaction(GAMES_STORE, 'readwrite');
  tx.objectStore(GAMES_STORE).delete(id);
  await transactionToPromise(tx);
}
