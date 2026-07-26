import { test, expect, type Page } from '@playwright/test';
import { GAMES_STORE } from '../src/persist/db.ts';
import { LEGACY_NET_ROOM_RESULT } from '../src/persist/archive.ts';

/**
 * V.1 MIGRATION WIRING e2e (epic #47) — the stage's one DESTRUCTIVE migration, proven where it
 * actually runs: `main.ts` boot calling `purgeLegacyNetRoomRecords` against a REAL per-origin
 * IndexedDB.
 *
 * The migration function itself is unit- and mutation-gated in `src/persist/archive.test.ts`. What no
 * other gate can reach is the BOOT CALL: `src/main.ts` is excluded from coverage and from the mutation
 * scope, so the whole suite would stay green with the call deleted — the exact shape of the #35 failure
 * the build plan wrote its wiring-test guardrail after (a component gate at high mutation score while
 * the durable value was silently not wired). So this spec drives the real app:
 *
 *   1. boot, play, and let the app autosave a REAL game (a record we can clone from);
 *   2. write a faithful v3 `net-room:{code}` shard — a copy of that game's record marked
 *      {@link LEGACY_NET_ROOM_RESULT}, exactly as the deleted v3 `persistRoomState` wrote it —
 *      STRAIGHT INTO the store the app is using, then observe it rendering as a user-facing game
 *      (`getArchive()` lists it): the harm the migration exists to prevent, observed rather than
 *      asserted;
 *   3. RELOAD, and observe the shard GONE from both the app's listing AND the raw object store — while
 *      the real game survives with its history intact (the migration deletes shards, not games).
 *
 * Every assertion is on observable state — the app's `getArchive()` readout and the raw IndexedDB
 * record — never a log line (agent-principles #3). The record ids/markers come from the modules under
 * test, so nothing is hardcoded (#8).
 */

/** The room code the simulated v3 build had used — the shard's key is derived from it, as v3 did. */
const LEGACY_CODE = 'DUDEEE';
const LEGACY_SHARD_ID = `net-room:${LEGACY_CODE}`;

interface ArchiveListing {
  id: string;
  meta: { players: Record<string, string>; result: string; startedAt: number; headHash: string };
}
type Pente = {
  getState(): { pieces: Record<string, 'white' | 'black'> } | null;
  getHistory(): { maxPly: number } | null;
  getArchive(): Promise<ArchiveListing[]>;
  getHeadHash(): string | null;
  place(coords: [number, number, number]): unknown;
};

/** A raw `games` record as stored — enough shape for this spec to clone and re-key one. */
interface RawRecord {
  id: string;
  log: unknown[];
  meta: Record<string, unknown>;
}

/**
 * Give this test its OWN archive DB (stable across the reload, so the reload re-opens the SAME store)
 * and a localStorage cleared only on the first navigation — the archive spec's isolation, for the same
 * reason: the purge must be observed against a store nothing else is writing.
 */
async function isolate(page: Page): Promise<string> {
  const dbName = `pente3d-e2e-${crypto.randomUUID()}`;
  await page.addInitScript((name: string) => {
    (window as unknown as { __penteDbName: string }).__penteDbName = name;
    if (window.localStorage.getItem('__e2e_booted') === null) {
      window.localStorage.clear();
      window.localStorage.setItem('__e2e_booted', '1');
    }
  }, dbName);
  return dbName;
}

/**
 * Boot and wait until the archive is wired: `getArchive()` returning a record means `main.ts`'s boot
 * chain has run PAST the migration (the purge is awaited before the initial autosave write), so a read
 * after this point observes a post-migration store — no arbitrary sleep, no racy poll.
 */
async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.getArchive === 'function' &&
      typeof p.getHeadHash === 'function' &&
      typeof p.place === 'function'
    );
  });
  await page.waitForFunction(async () => {
    const p = (window as unknown as { __pente?: { getArchive(): Promise<unknown[]> } }).__pente;
    if (!p) return false;
    return (await p.getArchive()).length >= 1;
  });
}

/** Wait until the LIVE game is durably autosaved (a record whose headHash is the live head). */
async function waitForAutosaved(page: Page): Promise<void> {
  await page.waitForFunction(async () => {
    const p = (window as unknown as { __pente?: Pente }).__pente;
    if (!p) return false;
    const head = p.getHeadHash();
    if (head === null) return false;
    return (await p.getArchive()).some((g) => g.meta.headHash === head);
  });
}

const archive = (page: Page): Promise<ArchiveListing[]> =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getArchive());

/** Read a record straight out of the app's object store (bypassing every app-level filter). */
const rawGet = (page: Page, dbName: string, id: string): Promise<RawRecord | null> =>
  page.evaluate(
    ([name, store, key]) =>
      new Promise<RawRecord | null>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction(store, 'readonly').objectStore(store).get(key);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            db.close();
            resolve((req.result as RawRecord | undefined) ?? null);
          };
        };
      }),
    [dbName, GAMES_STORE, id] as const,
  );

/** Write a record straight into the app's object store (simulating what a v3 build left behind). */
const rawPut = (page: Page, dbName: string, record: RawRecord): Promise<void> =>
  page.evaluate(
    ([name, store, rec]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(store, 'readwrite');
          tx.objectStore(store).put(rec);
          tx.onerror = () => reject(tx.error);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    [dbName, GAMES_STORE, record] as const,
  );

test('a v3 net-room shard present at boot is PURGED from the real store (the boot call is wired)', async ({
  page,
}) => {
  const dbName = await isolate(page);
  await ready(page);

  // A real game, durably autosaved: the record we clone the shard from, and the record that must
  // SURVIVE the migration (v3's shards duplicated a game the autosave had already archived).
  await page.evaluate(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    p.place([0, 0, 0]);
    p.place([4, 4, 4]);
    p.place([0, 4, 0]);
  });
  await waitForAutosaved(page);
  const realGame = (await archive(page))[0]!;
  const realRecord = await rawGet(page, dbName, realGame.id);
  expect(realRecord, 'the autosaved game must be readable straight from the store').not.toBeNull();

  // The v3 artifact, faithful to the deleted `persistRoomState`: the SAME game + its identity-owned
  // seat map, keyed by the ROOM CODE and marked with the internal `net-room` result.
  await rawPut(page, dbName, {
    ...realRecord!,
    id: LEGACY_SHARD_ID,
    meta: {
      ...realRecord!.meta,
      players: {},
      result: LEGACY_NET_ROOM_RESULT,
      seats: { white: 'player-a', black: 'player-b' },
    },
  });

  // THE HARM, OBSERVED (not inferred): v3.1 has no marker filter, so before the migration runs the
  // shard is a user-facing "game" in the app's own listing — an unresumable "? vs ?" entry per room
  // code ever used, offered as a resume seed.
  const beforeIds = (await archive(page)).map((g) => g.id);
  expect(beforeIds).toContain(LEGACY_SHARD_ID);
  expect(beforeIds).toContain(realGame.id);

  // BOOT AGAIN — this is the only thing that runs the migration.
  await page.reload();
  await ready(page);

  // GONE from the app's listing…
  const afterIds = (await archive(page)).map((g) => g.id);
  expect(afterIds).not.toContain(LEGACY_SHARD_ID);
  // …and gone from the STORE itself: permanently deleted, not merely hidden from a view.
  expect(await rawGet(page, dbName, LEGACY_SHARD_ID)).toBeNull();

  // The real game is untouched — same record, same history, still listed: the migration deletes
  // room-keyed shards, never a game.
  expect(afterIds).toContain(realGame.id);
  const survived = await rawGet(page, dbName, realGame.id);
  expect(survived?.log).toEqual(realRecord!.log);
  expect(survived?.meta.headHash).toBe(realGame.meta.headHash);
  // …and the boot it survived landed on an EMPTY SLATE, as every boot now does (Task V.5, epic #47,
  // design §6). The game living on as a RECORD — not on the board — is the whole point: the archive is
  // where a game survives, the games list is the route back to it.
  const boardAfterBoot = await page.evaluate(
    () => (window as unknown as { __pente: Pente }).__pente.getHistory()!.maxPly,
  );
  expect(boardAfterBoot).toBe(0);
});
