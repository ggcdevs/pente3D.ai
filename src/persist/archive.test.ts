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
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Game } from '../core/game';
import { headHash } from '../core/eventLog';
import {
  openDatabase,
  getGame,
  putGame,
  type GameRecord,
} from './db';
import {
  saveGame,
  loadGame,
  listArchivedGames,
  flagConflicted,
  loadConflicted,
  ArchiveError,
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

/** A short real game (three legal placements on a 9-board): white, black, white. */
function sampleGame(): Game {
  const g = new Game(9);
  g.place([4, 4, 4]);
  g.place([4, 4, 5]);
  g.place([4, 5, 4]);
  return g;
}

/** A different game so conflict forks are genuinely distinct histories. */
function forkedGame(): Game {
  const g = new Game(9);
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
          headHash: 'x',
        },
      };
      await putGame(db, corrupt);

      await expect(loadGame(db, 'bad')).rejects.toBeInstanceOf(ArchiveError);
      // The error names the id so a caller can report which game failed.
      await expect(loadGame(db, 'bad')).rejects.toThrow(/bad/);
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
          headHash: 'x',
        },
      };
      await putGame(db, illegal);

      await expect(loadGame(db, 'dbl')).rejects.toBeInstanceOf(ArchiveError);
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
