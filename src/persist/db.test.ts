/**
 * Tests for the IndexedDB promise wrapper over the `games` object store.
 *
 * Runs against `fake-indexeddb`, which installs a real, spec-compliant in-memory
 * IndexedDB into the (node) test environment via the `fake-indexeddb/auto` import.
 * The wrapper is exercised through its public promise API only — every assertion is
 * on an observed return value (the round-tripped record, the listed metadata, the
 * `undefined` for a missing key), never on a log line (agent-principles #3).
 */

// Installs a real in-memory IndexedDB as the global `indexedDB`. Must precede the
// wrapper import so the wrapper's `openDatabase` sees the fake global. Each test
// gets a fresh database name, so no cross-test state leaks.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  openDatabase,
  putGame,
  getGame,
  listGames,
  deleteGame,
  GAMES_STORE,
  DEFAULT_DB_NAME,
  resolveDbName,
  type GameRecord,
} from './db';

/** Unique db name per test so IndexedDB state never leaks between tests. */
let dbCounter = 0;
function freshDbName(): string {
  dbCounter += 1;
  return `pente-test-db-${dbCounter}-${Math.random().toString(36).slice(2)}`;
}

/** Track opened DBs so each test can close + delete them for isolation. */
const opened: IDBDatabase[] = [];
async function open(): Promise<{ db: IDBDatabase; name: string }> {
  const name = freshDbName();
  const db = await openDatabase(name);
  opened.push(db);
  return { db, name };
}

afterEach(() => {
  for (const db of opened.splice(0)) {
    db.close();
  }
});

/** A representative stored record: id, full event log, and metadata. */
function sampleRecord(id: string): GameRecord {
  return {
    id,
    log: [
      { type: 'place', node: '4,4,4' },
      { type: 'place', node: '4,4,5' },
      { type: 'place', node: '4,5,4' },
    ],
    meta: {
      players: { white: 'alice', black: 'bob' },
      result: 'in-progress',
      startedAt: 1_700_000_000_000,
      headHash: 'deadbeef',
    },
  };
}

describe('resolveDbName — the per-page archive DB name (test-isolation seam)', () => {
  // The app resolves its DB name through this so a Playwright test can inject an isolated store via
  // window.__penteDbName. The unit env is `node` (no window); we stub globalThis.window to drive the
  // injected branches and assert the EXACT resolved name (agent-principles #3: observable return).
  const stubWindow = (value: unknown): void => {
    (globalThis as unknown as { window?: unknown }).window = { __penteDbName: value };
  };
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it('returns DEFAULT_DB_NAME when no window exists (node/SSR: the typeof-window guard)', () => {
    expect((globalThis as { window?: unknown }).window).toBeUndefined();
    expect(resolveDbName()).toBe(DEFAULT_DB_NAME);
    expect(resolveDbName()).toBe('pente3d');
  });

  it('returns the injected __penteDbName verbatim when a non-empty override is present', () => {
    stubWindow('pente3d-e2e-abc123');
    expect(resolveDbName()).toBe('pente3d-e2e-abc123');
  });

  it('falls back to DEFAULT_DB_NAME when the override is undefined on the window', () => {
    stubWindow(undefined);
    expect(resolveDbName()).toBe(DEFAULT_DB_NAME);
  });

  it('falls back to DEFAULT_DB_NAME when the override is the empty string (length guard)', () => {
    // The empty-string branch is distinct from undefined: a `!== undefined` check alone would return
    // '' here. Assert the length guard rejects it so the app never opens a nameless DB.
    stubWindow('');
    expect(resolveDbName()).toBe(DEFAULT_DB_NAME);
  });
});

describe('store schema constants and creation', () => {
  it('exposes the exact store name "games" and default db name "pente3d"', () => {
    // Pin the literal SSOT values — an emptied constant would still let the
    // self-consistent round-trip tests pass, so assert the concrete strings.
    expect(GAMES_STORE).toBe('games');
    expect(DEFAULT_DB_NAME).toBe('pente3d');
  });

  it('creates the "games" object store on first open (named exactly GAMES_STORE)', async () => {
    const { db } = await open();
    // The created store must be reachable under the exact name — proves the
    // createObjectStore name is not empty and matches the constant used by ops.
    expect(db.objectStoreNames.contains('games')).toBe(true);
    expect(db.objectStoreNames.contains(GAMES_STORE)).toBe(true);
    expect(Array.from(db.objectStoreNames)).toContain('games');
  });

  it('openDatabase() with no name uses DEFAULT_DB_NAME and round-trips a record', async () => {
    // Exercise the DEFAULT_DB_NAME default parameter end-to-end (not just its value):
    // open with no arg, store+read a record, then clean up the shared default db.
    const db = await openDatabase();
    opened.push(db);
    await putGame(db, sampleRecord('default-db-game'));
    const loaded = await getGame(db, 'default-db-game');
    expect(loaded?.id).toBe('default-db-game');
    db.close();
    opened.splice(opened.indexOf(db), 1);
    await new Promise<void>((resolve, reject) => {
      const del = indexedDB.deleteDatabase(DEFAULT_DB_NAME);
      del.onsuccess = () => resolve();
      del.onerror = () => reject(del.error);
    });
  });

  it('re-opening at a higher version replays the PRODUCTION onupgradeneeded and its guard skips re-creating the store', async () => {
    // Drives the real `if (!contains(GAMES_STORE))` guard in the PRODUCTION
    // openDatabase (db.ts) — no hand-inlined copy. openDatabase now takes a version
    // param, so we open at v1 (store created + data written), close, then re-open at
    // v2 THROUGH openDatabase itself. That fires the production onupgradeneeded again
    // WITH the store already present. The guard must skip createObjectStore; without
    // it (mutant `if (true)`), createObjectStore('games') throws ConstraintError,
    // aborts the upgrade transaction, and openDatabase REJECTS — so this resolving
    // open + surviving data kills that mutant. We assert the open succeeds AND the v1
    // data survives the upgrade.
    const name = freshDbName();
    const db1 = await openDatabase(name);
    await putGame(db1, sampleRecord('survives-upgrade'));
    db1.close();

    // Real version bump through the production wrapper — replays its own guard.
    const upgraded = await openDatabase(name, 2);
    opened.push(upgraded);

    // The db opened at the new version (proving onupgradeneeded ran, not a plain open).
    expect(upgraded.version).toBe(2);
    // The store still exists and the record written at v1 is intact after the upgrade.
    expect(upgraded.objectStoreNames.contains('games')).toBe(true);
    const loaded = await getGame(upgraded, 'survives-upgrade');
    expect(loaded?.id).toBe('survives-upgrade');
    expect(loaded?.log).toHaveLength(3);
  });
});

describe('IndexedDB games store wrapper', () => {
  it('round-trips a record through put then get', async () => {
    const { db } = await open();
    const record = sampleRecord('game-1');

    await putGame(db, record);
    const loaded = await getGame(db, 'game-1');

    expect(loaded).toEqual(record);
    // The full log survives the round-trip — not just the id.
    expect(loaded?.log).toHaveLength(3);
    expect(loaded?.log[1]).toEqual({ type: 'place', node: '4,4,5' });
    expect(loaded?.meta.headHash).toBe('deadbeef');
  });

  it('returns undefined for a missing key', async () => {
    const { db } = await open();

    const missing = await getGame(db, 'does-not-exist');

    expect(missing).toBeUndefined();
  });

  it('overwrites an existing record on put with the same id', async () => {
    const { db } = await open();
    await putGame(db, sampleRecord('game-1'));

    const updated: GameRecord = {
      id: 'game-1',
      log: [{ type: 'place', node: '0,0,0' }],
      meta: {
        players: { white: 'carol', black: 'dave' },
        result: 'white-wins',
        startedAt: 42,
        headHash: 'cafef00d',
      },
    };
    await putGame(db, updated);

    const loaded = await getGame(db, 'game-1');
    expect(loaded).toEqual(updated);
    expect(loaded?.log).toHaveLength(1);
    expect(loaded?.meta.result).toBe('white-wins');
  });

  it('lists metadata for every stored game WITHOUT the full logs', async () => {
    const { db } = await open();
    await putGame(db, sampleRecord('game-a'));
    await putGame(db, sampleRecord('game-b'));

    const list = await listGames(db);

    expect(list).toHaveLength(2);
    const ids = list.map((m) => m.id).sort();
    expect(ids).toEqual(['game-a', 'game-b']);
    // Listing returns id + meta but deliberately omits the (potentially huge) log.
    for (const entry of list) {
      expect(entry).not.toHaveProperty('log');
      expect(entry.meta.headHash).toBe('deadbeef');
      expect(entry.meta.players).toEqual({ white: 'alice', black: 'bob' });
    }
  });

  it('returns an empty list when the store is empty', async () => {
    const { db } = await open();

    const list = await listGames(db);

    expect(list).toEqual([]);
  });

  it('deletes a record so a subsequent get returns undefined', async () => {
    const { db } = await open();
    await putGame(db, sampleRecord('game-1'));
    await putGame(db, sampleRecord('game-2'));

    await deleteGame(db, 'game-1');

    expect(await getGame(db, 'game-1')).toBeUndefined();
    // The unrelated record is untouched.
    expect((await getGame(db, 'game-2'))?.id).toBe('game-2');
    const remaining = await listGames(db);
    expect(remaining.map((m) => m.id)).toEqual(['game-2']);
  });

  it('deleting a missing key is a no-op (resolves, changes nothing)', async () => {
    const { db } = await open();
    await putGame(db, sampleRecord('game-1'));

    await expect(deleteGame(db, 'ghost')).resolves.toBeUndefined();

    expect((await getGame(db, 'game-1'))?.id).toBe('game-1');
    expect(await listGames(db)).toHaveLength(1);
  });

  it('persists records across a close and re-open of the same database', async () => {
    const name = freshDbName();
    const db1 = await openDatabase(name);
    await putGame(db1, sampleRecord('persisted'));
    db1.close();

    const db2 = await openDatabase(name);
    opened.push(db2);
    const loaded = await getGame(db2, 'persisted');
    expect(loaded?.id).toBe('persisted');
    expect(loaded?.log).toHaveLength(3);
  });

  it('property: every put id is retrievable and appears exactly once in the listing', async () => {
    await fc.assert(
      fc.asyncProperty(
        // A set of distinct, non-empty ids (the store is keyed by id, so
        // distinctness is the meaningful invariant for round-trip + listing).
        fc.uniqueArray(fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0), {
          minLength: 1,
          maxLength: 8,
        }),
        async (ids) => {
          const { db } = await open();
          for (const id of ids) {
            await putGame(db, sampleRecord(id));
          }

          // Each stored id round-trips to an identical record.
          for (const id of ids) {
            const loaded = await getGame(db, id);
            expect(loaded).toEqual(sampleRecord(id));
          }

          // The listing has exactly the stored ids — no more, no fewer, no dupes.
          const listed = (await listGames(db)).map((m) => m.id).sort();
          expect(listed).toEqual([...ids].sort());
        },
      ),
      { numRuns: 25 },
    );
  });

  describe('error paths propagate honestly (never swallowed)', () => {
    it('rejects a put/get/delete/list against a closed database with the real error', async () => {
      const name = freshDbName();
      const db = await openDatabase(name);
      db.close();

      // Operating on a closed connection is an InvalidStateError. It must surface
      // as a rejection, not be masked into a false success (agent-principles:
      // errors propagate honestly). Every op is checked so none silently swallows.
      await expect(putGame(db, sampleRecord('x'))).rejects.toBeInstanceOf(Error);
      await expect(getGame(db, 'x')).rejects.toBeInstanceOf(Error);
      await expect(deleteGame(db, 'x')).rejects.toBeInstanceOf(Error);
      await expect(listGames(db)).rejects.toBeInstanceOf(Error);
    });

    it('putGame rejects (does not silently succeed) when the record is not storable', async () => {
      const { db } = await open();

      // A function value cannot be structured-cloned; IndexedDB raises a
      // DataCloneError. putGame must reject rather than resolve as a false success
      // (which would report a save that never happened). We deliberately construct
      // an unstorable record.
      const bad = {
        id: 'unstorable',
        log: [],
        meta: { players: {}, result: 'x', startedAt: 0, headHash: 'x' },
        rogue: () => 'not cloneable',
      } as unknown as GameRecord;

      await expect(putGame(db, bad)).rejects.toBeInstanceOf(Error);
      // The failed write left no trace — the archive is not corrupted.
      expect(await getGame(db, 'unstorable')).toBeUndefined();
    });

    it('openDatabase rejects when the stored version is newer than requested', async () => {
      const name = freshDbName();
      // Create the db at a higher version than openDatabase asks for, then close.
      const bump = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(name, 99);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      bump.close();

      // openDatabase opens at version 1 < 99 → the open request fires onerror with
      // a VersionError, which the wrapper surfaces as a rejection (not a bad handle).
      await expect(openDatabase(name)).rejects.toBeInstanceOf(Error);
    });

    it('read/write requests reject verbatim when the underlying request errors', async () => {
      // Fault injection (agent-principles: allowed to reach genuinely-unreachable
      // defensive branches, and must assert real behavior). We stub the object
      // store so its get/put/delete/openCursor requests fire onerror with a
      // specific DOMException, and assert every wrapper op rejects with THAT error
      // verbatim — proving the error is propagated, never masked or relabeled.
      const failure = new DOMException('injected read/write failure', 'DataError');

      /** A stub request whose onerror is fired asynchronously with `failure`. */
      function failingRequest(): IDBRequest {
        const handlers: { onerror?: () => void; onsuccess?: () => void } = {};
        const req = {
          error: failure,
          set onerror(fn: () => void) {
            handlers.onerror = fn;
            // Fire on the next microtask so the wrapper has attached its handler.
            queueMicrotask(() => fn());
          },
          set onsuccess(fn: () => void) {
            handlers.onsuccess = fn;
          },
        };
        return req as unknown as IDBRequest;
      }

      const stubStore = {
        get: () => failingRequest(),
        put: () => failingRequest(),
        delete: () => failingRequest(),
        openCursor: () => failingRequest(),
      };
      const stubTx = {
        objectStore: () => stubStore,
        // For put/delete the wrapper awaits transaction completion; make the tx
        // reject via onerror so those paths surface the failure too.
        set oncomplete(_fn: () => void) {
          /* never completes — the request errors instead */
        },
        set onerror(fn: () => void) {
          queueMicrotask(() => fn());
        },
        set onabort(_fn: () => void) {
          /* not used in this injection */
        },
        error: failure,
      };
      const fakeDb = {
        transaction: () => stubTx,
      } as unknown as IDBDatabase;

      await expect(getGame(fakeDb, 'x')).rejects.toBe(failure);
      await expect(listGames(fakeDb)).rejects.toBe(failure);
      await expect(putGame(fakeDb, sampleRecord('x'))).rejects.toBe(failure);
      await expect(deleteGame(fakeDb, 'x')).rejects.toBe(failure);
    });

    it('write ops reject via the transaction ABORT path with its error verbatim', async () => {
      // Fault injection for the abort branch specifically: a write transaction can
      // abort (quota exceeded, forced abort) without an individual request error.
      // The wrapper must reject putGame/deleteGame with the transaction's error, not
      // resolve as a spurious success (which would report a durable write that was
      // rolled back).
      const abortError = new DOMException('injected transaction abort', 'AbortError');
      const okRequest = { set onerror(_f: () => void) {}, set onsuccess(_f: () => void) {} };
      const stubTx = {
        objectStore: () => ({ put: () => okRequest, delete: () => okRequest }),
        set oncomplete(_fn: () => void) {
          /* never completes — it aborts instead */
        },
        set onerror(_fn: () => void) {
          /* the abort, not a request error, is what fires here */
        },
        set onabort(fn: () => void) {
          queueMicrotask(() => fn());
        },
        error: abortError,
      };
      const fakeDb = {
        transaction: () => stubTx,
      } as unknown as IDBDatabase;

      await expect(putGame(fakeDb, sampleRecord('x'))).rejects.toBe(abortError);
      await expect(deleteGame(fakeDb, 'x')).rejects.toBe(abortError);
    });
  });
});
