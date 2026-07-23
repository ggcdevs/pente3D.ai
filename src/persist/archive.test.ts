/**
 * Tests for the game archive (build plan Task 2.2; GLOSSARY "Game archive").
 *
 * The archive layers save/load/list/flag-conflicted semantics over the raw
 * IndexedDB wrapper (`db.ts`, Task 2.1), building records from a core `Game` and
 * reconstructing a `Game` on load. It runs against `fake-indexeddb` (a real,
 * spec-compliant in-memory IndexedDB installed via `fake-indexeddb/auto`).
 *
 * Every assertion is on observed behavior — the reconstructed `Game`'s `headHash`
 * and derived state, the stored record read straight back out of IndexedDB, the
 * sorted listing metadata — never on a log line (agent-principles #3). The suite
 * includes negative/failure cases: loading a missing id, loading a record whose
 * stored log is corrupt, and flagging a conflict then proving BOTH forks survive a
 * close/re-open of the database.
 */

import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { Game } from '../core/game';
import { headHash } from '../core/eventLog';
import * as serialize from '../core/serialize';
import {
  openDatabase,
  getGame,
  putGame,
  type GameRecord,
} from './db';
import {
  saveGame,
  loadGame,
  loadNetGame,
  loadNetGameByUuid,
  listArchivedGames,
  flagConflicted,
  loadConflicted,
  ArchiveError,
  NET_ROOM_RESULT,
  type ArchivedMeta,
} from './archive';

/** Unique db name per test so IndexedDB state never leaks between tests. */
let dbCounter = 0;
function freshDbName(): string {
  dbCounter += 1;
  return `pente-archive-test-${dbCounter}-${Math.random().toString(36).slice(2)}`;
}

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

/**
 * Fixed uuids so a "sample"/"forked" game is DETERMINISTIC across calls: since S.1
 * folds the uuid into the genesis hash, two `new Game(9)` calls would otherwise get
 * distinct uuids and thus distinct `headHash`es, breaking any test that builds the
 * game twice and compares fingerprints. Pinning the uuid keeps the round-trip
 * assertions about identity, not about a per-call random id.
 */
const SAMPLE_UUID = 'sample-game-uuid';
const FORKED_UUID = 'forked-game-uuid';

/** A short real game (three legal placements on a 9-board): white, black, white. */
function sampleGame(): Game {
  const g = new Game(9, SAMPLE_UUID);
  g.place([4, 4, 4]);
  g.place([4, 4, 5]);
  g.place([4, 5, 4]);
  return g;
}

/** A different game so conflict forks are genuinely distinct histories. */
function forkedGame(): Game {
  const g = new Game(9, FORKED_UUID);
  g.place([4, 4, 4]);
  g.place([0, 0, 0]);
  g.place([1, 1, 1]);
  g.place([2, 2, 2]);
  return g;
}

const sampleMeta: ArchivedMeta = {
  players: { white: 'alice', black: 'bob' },
  result: 'in-progress',
  startedAt: 1_700_000_000_000,
};

describe('game archive', () => {
  describe('saveGame + loadGame', () => {
    it('reconstructs an identical Game (same headHash, state, ply) after a round-trip', async () => {
      const { db } = await open();
      const game = sampleGame();

      await saveGame(db, 'g1', game, sampleMeta);
      const loaded = await loadGame(db, 'g1');

      expect(loaded).toBeInstanceOf(Game);
      // The uuid round-trips through the archive (stored in meta, seeded on load), so
      // the reconstructed headHash matches — same identity, not just same moves (S.1).
      expect(loaded!.uuid).toBe(game.uuid);
      // The log fully determines the game: the reconstructed headHash matches.
      expect(headHash(loaded!.log)).toBe(headHash(game.log));
      expect(loaded!.ply()).toBe(game.ply());
      expect(loaded!.state()).toEqual(game.state());
      // The actual placed pieces survived, not just the hash.
      expect(loaded!.state().pieces['4,4,4']).toBe('white');
      expect(loaded!.state().pieces['4,4,5']).toBe('black');
      expect(loaded!.state().pieces['4,5,4']).toBe('white');
      expect(loaded!.state().turn).toBe('black');
    });

    it('stores {id, log, meta:{players,result,startedAt,headHash}} verbatim', async () => {
      const { db } = await open();
      const game = sampleGame();

      await saveGame(db, 'g1', game, sampleMeta);

      // Read the raw stored record straight out of the underlying store.
      const record = await getGame(db, 'g1');
      expect(record).toBeDefined();
      expect(record!.id).toBe('g1');
      // The stored log is the plain event array (three place events).
      expect(record!.log).toEqual([
        { type: 'place', node: '4,4,4' },
        { type: 'place', node: '4,4,5' },
        { type: 'place', node: '4,5,4' },
      ]);
      expect(record!.meta.players).toEqual({ white: 'alice', black: 'bob' });
      expect(record!.meta.result).toBe('in-progress');
      expect(record!.meta.startedAt).toBe(1_700_000_000_000);
      // headHash is derived from the game and stored in the metadata.
      expect(record!.meta.headHash).toBe(headHash(game.log));
      // The game uuid (minted at genesis, S.1) is stored in the metadata so the
      // archive can identify a game without loading its log.
      expect(record!.meta.uuid).toBe(game.uuid);
      expect(typeof record!.meta.uuid).toBe('string');
      expect(record!.meta.uuid.length).toBeGreaterThan(0);
    });

    it('loadGame lazily mints a uuid for a LEGACY record with no meta.uuid (pre-S.1)', async () => {
      const { db } = await open();
      // Write a raw record shaped like a pre-S.1 archive entry: valid log, size, and
      // metadata but NO uuid field (cast through unknown to bypass the current type).
      const legacy = {
        id: 'legacy',
        log: [
          { type: 'place', node: '4,4,4' },
          { type: 'place', node: '0,0,0' },
        ],
        size: 9,
        meta: {
          players: { white: 'a', black: 'b' },
          result: 'in-progress',
          startedAt: 1,
          headHash: 'ignored-on-load',
        },
      };
      await putGame(db, legacy as unknown as GameRecord);

      const loaded = await loadGame(db, 'legacy');
      expect(loaded).toBeInstanceOf(Game);
      // A fresh uuid was minted (correct — a legacy game was never networked, §2.2).
      expect(typeof loaded!.uuid).toBe('string');
      expect(loaded!.uuid.length).toBeGreaterThan(0);
      // The moves still reconstruct faithfully despite the minted identity.
      expect(loaded!.state().pieces['4,4,4']).toBe('white');
      expect(loaded!.state().pieces['0,0,0']).toBe('black');
      expect(loaded!.ply()).toBe(2);
    });

    it('overwrites (autosaves) the same id as the game grows', async () => {
      const { db } = await open();
      const game = new Game(9);
      game.place([4, 4, 4]);
      await saveGame(db, 'g1', game, sampleMeta);

      game.place([4, 4, 5]);
      await saveGame(db, 'g1', game, sampleMeta);

      const loaded = await loadGame(db, 'g1');
      expect(loaded!.ply()).toBe(2);
      expect(headHash(loaded!.log)).toBe(headHash(game.log));
    });

    it('round-trips a game that carries undo/redo events', async () => {
      const { db } = await open();
      const game = sampleGame();
      game.undo();
      game.redo();
      game.undo();
      await saveGame(db, 'g1', game, sampleMeta);

      const loaded = await loadGame(db, 'g1');
      // undo/redo are events in the log — the full history (and cursor) survives.
      expect(headHash(loaded!.log)).toBe(headHash(game.log));
      expect(loaded!.ply()).toBe(game.ply());
      expect(loaded!.state()).toEqual(game.state());
    });

    it('round-trips a non-default board size (reconstructs on the SAME board, not size-9)', async () => {
      const { db } = await open();
      // A size-5 game. `Game`'s constructor takes an arbitrary size with no default,
      // so a saved game on any board must reconstruct on that same board. Use a coord
      // (4,4,4) that is in-bounds on a 5-board (indices 0..4) but occupies its far
      // corner — if the loader defaulted to 9 the size would silently be wrong.
      const game = new Game(5);
      game.place([0, 0, 0]);
      game.place([4, 4, 4]);

      await saveGame(db, 's5', game, sampleMeta);
      const loaded = await loadGame(db, 's5');

      // The board size survived the round-trip (the bug: it was always 9).
      expect(loaded!.state().size).toBe(5);
      expect(game.state().size).toBe(5);
      // …and the full game is identical, not merely the size.
      expect(headHash(loaded!.log)).toBe(headHash(game.log));
      expect(loaded!.state()).toEqual(game.state());
      expect(loaded!.ply()).toBe(game.ply());
      expect(loaded!.state().pieces['4,4,4']).toBe('black');
    });

    it('stores the board size on the record so load reconstructs on the same board', async () => {
      const { db } = await open();
      await saveGame(db, 's7', new Game(7), sampleMeta);

      // Read the raw stored record: `size` is present and is the game's board size.
      const record = (await getGame(db, 's7')) as unknown as { size: number };
      expect(record.size).toBe(7);
    });

    it('loadGame falls back to the default board size (9) when a record omits size', async () => {
      const { db } = await open();
      // A legacy/hand-written record with NO `size` field: the loader must fall back
      // to DEFAULT_SIZE (9), not reconstruct with `undefined`. Place at (8,8,8),
      // in-bounds ONLY on a 9-board — proving the fallback size is genuinely 9.
      const legacy = {
        id: 'legacy',
        log: [{ type: 'place', node: '8,8,8' }],
        // NOTE: intentionally no `size` key.
        meta: { players: {}, result: 'in-progress', startedAt: 0, headHash: 'x' },
      };
      await putGame(db, legacy as unknown as GameRecord);

      const loaded = await loadGame(db, 'legacy');
      expect(loaded!.state().size).toBe(9);
      // (8,8,8) placed legally proves the board is 9; on a smaller board this coord
      // would be off-board and reconstruction would throw.
      expect(loaded!.state().pieces['8,8,8']).toBe('white');
      expect(loaded!.ply()).toBe(1);
    });

    it('loadGame returns undefined for a missing id (negative case)', async () => {
      const { db } = await open();

      const loaded = await loadGame(db, 'does-not-exist');

      expect(loaded).toBeUndefined();
    });

    it('loadGame throws ArchiveError when the stored log is corrupt (negative case)', async () => {
      const { db } = await open();
      // Write a record whose log is not a valid game (an unknown event type).
      const corrupt: GameRecord = {
        id: 'bad',
        log: [{ type: 'teleport', node: '4,4,4' }],
        meta: {
          players: {},
          result: 'in-progress',
          startedAt: 0,
          uuid: 'corrupt-uuid',
          headHash: 'x',
        },
      };
      await putGame(db, corrupt);

      await expect(loadGame(db, 'bad')).rejects.toBeInstanceOf(ArchiveError);
      // The error names the id so a caller can report which game failed, and its
      // `.name` is exactly 'ArchiveError' (pins the constructor's name assignment).
      await expect(loadGame(db, 'bad')).rejects.toThrow(/archived game "bad"/);
      const err = await loadGame(db, 'bad').catch((e) => e);
      expect(err).toBeInstanceOf(ArchiveError);
      expect((err as Error).name).toBe('ArchiveError');
    });

    it('loadGame throws ArchiveError when the stored log describes an illegal game', async () => {
      const { db } = await open();
      // Two placements on the SAME node — the second is an illegal move.
      const illegal: GameRecord = {
        id: 'dbl',
        log: [
          { type: 'place', node: '4,4,4' },
          { type: 'place', node: '4,4,4' },
        ],
        meta: {
          players: {},
          result: 'in-progress',
          startedAt: 0,
          uuid: 'illegal-uuid',
          headHash: 'x',
        },
      };
      await putGame(db, illegal);

      await expect(loadGame(db, 'dbl')).rejects.toBeInstanceOf(ArchiveError);
    });
  });

  describe('durable identity-owned seat map (design §2.3, empty-room reclaim §6.4)', () => {
    it('round-trips the persisted seat map via loadNetGame', async () => {
      const { db } = await open();
      const seats = { white: 'player-a', black: 'player-b' };
      await saveGame(db, 'room', sampleGame(), { ...sampleMeta, seats });

      const loaded = await loadNetGame(db, 'room');
      expect(loaded).not.toBeUndefined();
      // The game reconstructs with its identity intact AND the durable seat map comes back verbatim.
      expect(loaded!.game.uuid).toBe(SAMPLE_UUID);
      expect(loaded!.game.state().winner).toBeNull();
      expect(loaded!.seats).toEqual(seats);
    });

    it('reserves an absent owner: a seat map with a null side round-trips exactly', async () => {
      const { db } = await open();
      // A lone establisher owns white; black is unowned (null) — the reserve-vacated shape.
      const seats = { white: 'player-a', black: null };
      await saveGame(db, 'lone', sampleGame(), { ...sampleMeta, seats });

      const loaded = await loadNetGame(db, 'lone');
      expect(loaded!.seats).toEqual({ white: 'player-a', black: null });
    });

    it('loadNetGame yields seats:null for a record saved WITHOUT a seat map (a local game)', async () => {
      const { db } = await open();
      // sampleMeta has no `seats` → the record stores none → the loader reports null, not an empty map.
      await saveGame(db, 'local', sampleGame(), sampleMeta);

      const loaded = await loadNetGame(db, 'local');
      expect(loaded!.game.uuid).toBe(SAMPLE_UUID);
      expect(loaded!.seats).toBeNull();
    });

    it('loadNetGame returns undefined for a missing id (negative case)', async () => {
      const { db } = await open();
      expect(await loadNetGame(db, 'nope')).toBeUndefined();
    });

    it('loadNetGame falls back to the default board size (9) when a record omits size', async () => {
      const { db } = await open();
      // A record with NO `size` field (a legacy net-room shard) reconstructs on the default board.
      const record: GameRecord = {
        id: 'net-room:NOSIZE',
        log: [{ type: 'place', node: '4,4,4' }],
        meta: {
          players: {},
          result: NET_ROOM_RESULT,
          startedAt: 0,
          uuid: 'nosize-uuid',
          headHash: 'ignored-on-load',
          seats: { white: 'player-a', black: null },
        },
      };
      await putGame(db, record);

      const loaded = await loadNetGame(db, 'net-room:NOSIZE');
      expect(loaded).not.toBeUndefined();
      // Reconstructed on the default 9-board (the single placement is legal there).
      expect(loaded!.game.state().size).toBe(9);
      expect(loaded!.seats).toEqual({ white: 'player-a', black: null });
    });

    it('loadNetGameByUuid finds a game by its portable uuid (not its local record id)', async () => {
      const { db } = await open();
      const seats = { white: 'player-a', black: 'player-b' };
      // Store under a local id that is DISTINCT from the game's uuid — the lookup must key on uuid.
      await saveGame(db, 'local-record-id', sampleGame(), { ...sampleMeta, seats });

      const loaded = await loadNetGameByUuid(db, SAMPLE_UUID);
      expect(loaded).not.toBeUndefined();
      expect(loaded!.game.uuid).toBe(SAMPLE_UUID);
      expect(loaded!.seats).toEqual(seats);
    });

    it('loadNetGameByUuid returns undefined when no archived game carries that uuid (negative case)', async () => {
      const { db } = await open();
      await saveGame(db, 'g', sampleGame(), sampleMeta);
      expect(await loadNetGameByUuid(db, 'a-uuid-nobody-has')).toBeUndefined();
    });

    it('an internal net-room record is EXCLUDED from the archive listing (not a spurious game)', async () => {
      const { db } = await open();
      await saveGame(db, 'real', sampleGame(), sampleMeta);
      // The net session persists its durable room shard under the internal 'net-room' result marker.
      await saveGame(db, 'net-room:ABCDEF', sampleGame(), {
        ...sampleMeta,
        result: NET_ROOM_RESULT,
        seats: { white: 'player-a', black: null },
      });

      const list = await listArchivedGames(db);
      // Only the REAL game is listed; the room shard is filtered out of the user-facing browser.
      expect(list.map((l) => l.id)).toEqual(['real']);
      // …but the shard is still directly loadable by its own id (the session reads it that way).
      expect((await loadNetGame(db, 'net-room:ABCDEF'))?.seats).toEqual({
        white: 'player-a',
        black: null,
      });
    });

    it('loadNetGameByUuid SKIPS a net-room shard and resolves the real game sharing that uuid', async () => {
      const { db } = await open();
      // A real archived game and a net-room shard of the SAME game (same uuid) coexist.
      await saveGame(db, 'real', sampleGame(), sampleMeta);
      await saveGame(db, 'net-room:ABCDEF', sampleGame(), {
        ...sampleMeta,
        result: NET_ROOM_RESULT,
        seats: { white: 'player-a', black: 'player-b' },
      });

      const loaded = await loadNetGameByUuid(db, SAMPLE_UUID);
      expect(loaded).not.toBeUndefined();
      // Resolves the REAL game (no seats), NOT the room shard — the resume path wants the real game.
      expect(loaded!.game.uuid).toBe(SAMPLE_UUID);
      expect(loaded!.seats).toBeNull();
    });
  });

  describe('listArchivedGames', () => {
    it('returns metadata sorted by startedAt descending (most recent first)', async () => {
      const { db } = await open();
      await saveGame(db, 'old', sampleGame(), { ...sampleMeta, startedAt: 100 });
      await saveGame(db, 'new', sampleGame(), { ...sampleMeta, startedAt: 300 });
      await saveGame(db, 'mid', sampleGame(), { ...sampleMeta, startedAt: 200 });

      const list = await listArchivedGames(db);

      expect(list.map((m) => m.id)).toEqual(['new', 'mid', 'old']);
      expect(list.map((m) => m.meta.startedAt)).toEqual([300, 200, 100]);
    });

    it('omits the full log from each listing (only id + meta)', async () => {
      const { db } = await open();
      await saveGame(db, 'g1', sampleGame(), sampleMeta);

      const list = await listArchivedGames(db);

      expect(list).toHaveLength(1);
      expect(list[0]).not.toHaveProperty('log');
      expect(list[0]!.meta.headHash).toBe(headHash(sampleGame().log));
    });

    it('returns an empty array when nothing is archived', async () => {
      const { db } = await open();
      expect(await listArchivedGames(db)).toEqual([]);
    });
  });

  describe('flagConflicted (both forks)', () => {
    it('stores both forked logs with status "conflicted" and survives reload', async () => {
      const name = freshDbName();
      const db1 = await openDatabase(name);
      const mine = sampleGame();
      const theirs = forkedGame();

      await flagConflicted(db1, 'conflict-1', {
        mineLog: mine.log,
        theirsLog: theirs.log,
        meta: sampleMeta,
      });
      db1.close();

      // Re-open the SAME database — the conflicted record must persist.
      const db2 = await openDatabase(name);
      opened.push(db2);
      const record = await getGame(db2, 'conflict-1');

      expect(record).toBeDefined();
      expect(record!.meta.result).toBe('conflicted');
      // Both forks are stored, each as a plain event log.
      const forks = (record as unknown as { forks: { mine: unknown; theirs: unknown } })
        .forks;
      expect(forks.mine).toEqual([
        { type: 'place', node: '4,4,4' },
        { type: 'place', node: '4,4,5' },
        { type: 'place', node: '4,5,4' },
      ]);
      expect(forks.theirs).toEqual([
        { type: 'place', node: '4,4,4' },
        { type: 'place', node: '0,0,0' },
        { type: 'place', node: '1,1,1' },
        { type: 'place', node: '2,2,2' },
      ]);
    });

    it('flagConflicted stores the caller-provided size verbatim (not the default)', async () => {
      const { db } = await open();
      // Provide an explicit size of 5 (≠ the default 9). It must be stored as-is;
      // with `input.size && DEFAULT_SIZE` the truthy 5 would be discarded for 9.
      await flagConflicted(db, 'sized', {
        mineLog: new Game(5).log,
        theirsLog: new Game(5).log,
        meta: sampleMeta,
        size: 5,
      });
      const record = (await getGame(db, 'sized')) as unknown as { size: number };
      expect(record.size).toBe(5);
    });

    it('flagConflicted falls back to the default size (9) when none is provided', async () => {
      const { db } = await open();
      // No size given → the `?? DEFAULT_SIZE` fallback must store 9.
      await flagConflicted(db, 'unsized', {
        mineLog: sampleGame().log,
        theirsLog: forkedGame().log,
        meta: sampleMeta,
      });
      const record = (await getGame(db, 'unsized')) as unknown as { size: number };
      expect(record.size).toBe(9);
    });

    it('a conflicted game reconstructs BOTH forks as identical Games on load', async () => {
      const { db } = await open();
      const mine = sampleGame();
      const theirs = forkedGame();

      await flagConflicted(db, 'c1', {
        mineLog: mine.log,
        theirsLog: theirs.log,
        meta: sampleMeta,
        size: 9,
      });

      const loaded = await loadConflicted(db, 'c1');
      expect(loaded).toBeDefined();
      // Each fork reconstructs with ITS OWN game uuid (S.1), so the headHashes match
      // — without per-fork uuids the seed would be wrong and neither would verify.
      expect(loaded!.mine.uuid).toBe(mine.uuid);
      expect(loaded!.theirs.uuid).toBe(theirs.uuid);
      expect(headHash(loaded!.mine.log)).toBe(headHash(mine.log));
      expect(headHash(loaded!.theirs.log)).toBe(headHash(theirs.log));
      // The forks are genuinely different histories (that is the whole point).
      expect(headHash(loaded!.mine.log)).not.toBe(headHash(loaded!.theirs.log));
      expect(loaded!.mine.ply()).toBe(3);
      expect(loaded!.theirs.ply()).toBe(4);
    });

    it('a conflicted game appears in the listing flagged "conflicted"', async () => {
      const { db } = await open();
      await flagConflicted(db, 'c1', {
        mineLog: sampleGame().log,
        theirsLog: forkedGame().log,
        meta: sampleMeta,
      });

      const list = await listArchivedGames(db);
      const entry = list.find((m) => m.id === 'c1');
      expect(entry).toBeDefined();
      expect(entry!.meta.result).toBe('conflicted');
    });

    it('loadConflicted returns undefined for a missing id (negative case)', async () => {
      const { db } = await open();
      expect(await loadConflicted(db, 'nope')).toBeUndefined();
    });

    it('loadConflicted throws ArchiveError on a non-conflicted (ordinary) record', async () => {
      const { db } = await open();
      await saveGame(db, 'ordinary', sampleGame(), sampleMeta);

      await expect(loadConflicted(db, 'ordinary')).rejects.toBeInstanceOf(ArchiveError);
      // The message names the id and the reason — proves it is the "not conflicted"
      // path (not some other failure) and that the id is interpolated, not empty.
      await expect(loadConflicted(db, 'ordinary')).rejects.toThrow(
        /archived game "ordinary" is not a conflicted game/,
      );
    });

    it('loadConflicted throws when result IS "conflicted" but the forks are missing', async () => {
      const { db } = await open();
      // A record flagged conflicted but with NO `forks` field (corrupt/partial write).
      // This isolates the `record.forks === undefined` half of the guard: the result
      // check alone passes, so only the forks check can reject here.
      const noForks = {
        id: 'flagged-no-forks',
        log: [{ type: 'place', node: '4,4,4' }],
        meta: {
          players: {},
          result: 'conflicted',
          startedAt: 0,
          headHash: 'x',
        },
      };
      await putGame(db, noForks as unknown as GameRecord);

      await expect(loadConflicted(db, 'flagged-no-forks')).rejects.toBeInstanceOf(
        ArchiveError,
      );
      await expect(loadConflicted(db, 'flagged-no-forks')).rejects.toThrow(
        /archived game "flagged-no-forks" is not a conflicted game/,
      );
    });

    it('loadConflicted throws when forks ARE present but result is not "conflicted"', async () => {
      const { db } = await open();
      // The mirror case: forks exist, but result is some other status. This isolates
      // the `result !== 'conflicted'` half of the guard (so the `||` cannot collapse
      // to `&&` and still pass): forks-present alone must not admit the record.
      const forkLog = [{ type: 'place', node: '4,4,4' }];
      const wrongResult = {
        id: 'forks-wrong-result',
        log: forkLog,
        size: 9,
        forks: { mine: forkLog, theirs: forkLog },
        meta: {
          players: {},
          result: 'in-progress',
          startedAt: 0,
          headHash: 'x',
        },
      };
      await putGame(db, wrongResult as unknown as GameRecord);

      await expect(loadConflicted(db, 'forks-wrong-result')).rejects.toBeInstanceOf(
        ArchiveError,
      );
    });

    it('loadConflicted names the offending fork ("(mine)" / "(theirs)") when a fork log is corrupt', async () => {
      const { db } = await open();
      const goodLog = [{ type: 'place', node: '4,4,4' }];
      const badLog = [{ type: 'teleport', node: '4,4,4' }]; // unknown event → illegal

      // Corrupt MINE fork: the error must name "(mine)".
      await putGame(db, {
        id: 'bad-mine',
        log: badLog,
        size: 9,
        forks: { mine: badLog, theirs: goodLog },
        meta: { players: {}, result: 'conflicted', startedAt: 0, headHash: 'x' },
      } as unknown as GameRecord);
      await expect(loadConflicted(db, 'bad-mine')).rejects.toThrow(/bad-mine \(mine\)/);

      // Corrupt THEIRS fork (mine good): the error must name "(theirs)".
      await putGame(db, {
        id: 'bad-theirs',
        log: goodLog,
        size: 9,
        forks: { mine: goodLog, theirs: badLog },
        meta: { players: {}, result: 'conflicted', startedAt: 0, headHash: 'x' },
      } as unknown as GameRecord);
      await expect(loadConflicted(db, 'bad-theirs')).rejects.toThrow(
        /bad-theirs \(theirs\)/,
      );
    });

    it('loadConflicted falls back to the default board size when the record omits size', async () => {
      const { db } = await open();
      // A legacy/hand-written conflicted record with NO `size` field: the loader
      // must fall back to DEFAULT_SIZE (9) rather than reconstruct with `undefined`.
      // Use a coord (8,8,8) that is only in-bounds on a 9-board — proving the
      // fallback size is genuinely 9, not some smaller/other value.
      const forkLog = [
        { type: 'place', node: '8,8,8' },
        { type: 'place', node: '0,0,0' },
      ];
      const record = {
        id: 'legacy-conflict',
        log: forkLog,
        // NOTE: intentionally no `size` key on this record.
        forks: { mine: forkLog, theirs: forkLog },
        meta: {
          players: { white: 'a', black: 'b' },
          result: 'conflicted',
          startedAt: 42,
          headHash: 'h',
        },
      };
      await putGame(db, record as unknown as GameRecord);

      const loaded = await loadConflicted(db, 'legacy-conflict');
      expect(loaded).toBeDefined();
      // (8,8,8) placed legally proves the board was sized 9 (the default); on a
      // smaller board this coord would be off-board and reconstruction would throw.
      expect(loaded!.mine.state().pieces['8,8,8']).toBe('white');
      expect(loaded!.theirs.state().pieces['8,8,8']).toBe('white');
      expect(loaded!.mine.ply()).toBe(2);
    });
  });

  describe('error translation (defensive)', () => {
    it('wraps a non-Error thrown by importGame via String(e), never masking it', async () => {
      const { db } = await open();
      await saveGame(db, 'g1', sampleGame(), sampleMeta);
      // Fault-injection to reach the genuinely-defensive `String(e)` branch:
      // importGame's own contract only throws ExportError (an Error), so a
      // non-Error escapee is otherwise unreachable. Make it throw a bare string
      // and assert the ArchiveError carries that exact string verbatim (the error
      // is propagated honestly, not swallowed or mislabeled — agent-principles #3).
      const spy = vi
        .spyOn(serialize, 'importGame')
        .mockImplementation(() => {
          throw 'raw-string-fault';
        });
      try {
        await expect(loadGame(db, 'g1')).rejects.toBeInstanceOf(ArchiveError);
        await expect(loadGame(db, 'g1')).rejects.toThrow(/raw-string-fault/);
        // The id is still named, and the stringified fault is the message tail.
        await expect(loadGame(db, 'g1')).rejects.toThrow(/archived game "g1"/);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('property: any legal game round-trips to an identical game', () => {
    it('save then load preserves headHash and derived state', async () => {
      await fc.assert(
        fc.asyncProperty(
          // A sequence of distinct in-bounds coords → a legal game of placements.
          fc.uniqueArray(
            fc.tuple(
              fc.integer({ min: 0, max: 8 }),
              fc.integer({ min: 0, max: 8 }),
              fc.integer({ min: 0, max: 8 }),
            ),
            { minLength: 0, maxLength: 8, selector: (c) => c.join(',') },
          ),
          async (coords) => {
            const { db } = await open();
            const game = new Game(9);
            // Stop before any win so every placement stays legal.
            for (const c of coords) {
              if (game.state().winner !== null) break;
              game.place(c);
            }

            await saveGame(db, 'p', game, sampleMeta);
            const loaded = await loadGame(db, 'p');

            expect(headHash(loaded!.log)).toBe(headHash(game.log));
            expect(loaded!.state()).toEqual(game.state());
            expect(loaded!.ply()).toBe(game.ply());
          },
        ),
        { numRuns: 25 },
      );
    });
  });
});
