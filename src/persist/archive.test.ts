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
import { firstDivergence, headHash } from '../core/eventLog';
import * as serialize from '../core/serialize';
import * as dbModule from './db';
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
  archivedStartedAts,
  isEmptyShell,
  archivedIdentity,
  purgeEmptyShellRecords,
  SEATED_SHELL_MAX_AGE_MS,
  purgeLegacyNetRoomRecords,
  rekeyArchiveRecordsByGameUuid,
  StartedAtLedger,
  flagConflicted,
  loadConflicted,
  ArchiveError,
  playersFromSeats,
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

    it('stamps meta.updatedAt with WHEN THE RECORD WAS WRITTEN — the caller’s clock, or ours', async () => {
      const { db } = await open();
      // A fact about the record, not the game: `startedAt` is the game's birthday and does not move
      // when it is re-saved, so the shell collector cannot read "has anything touched this row lately"
      // from it. A caller that owns a clock (the net session) supplies it; otherwise we read one.
      await saveGame(db, 'g1', sampleGame(), sampleMeta, 1_700_000_009_999);
      expect((await getGame(db, 'g1'))!.meta.updatedAt).toBe(1_700_000_009_999);
      expect((await getGame(db, 'g1'))!.meta.startedAt).toBe(1_700_000_000_000);

      // Re-saving the SAME game later moves the stamp — that is the whole point of it.
      const before = Date.now();
      await saveGame(db, 'g1', sampleGame(), sampleMeta);
      const stamped = (await getGame(db, 'g1'))!.meta.updatedAt!;
      expect(stamped).toBeGreaterThanOrEqual(before);
      expect(stamped).toBeLessThanOrEqual(Date.now());
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

  describe('playersFromSeats — the ONE seat-owners → record `players` projection', () => {
    it('names both real owners', () => {
      expect(playersFromSeats({ white: 'player-a', black: 'player-b' })).toEqual({
        white: 'player-a',
        black: 'player-b',
      });
    });

    it('OMITS an unowned seat rather than recording a null/sentinel player', () => {
      expect(playersFromSeats({ white: 'player-a', black: null })).toEqual({ white: 'player-a' });
      expect(playersFromSeats({ white: null, black: 'player-b' })).toEqual({ black: 'player-b' });
    });

    it('yields an empty map when nobody owns a seat yet', () => {
      expect(playersFromSeats({ white: null, black: null })).toEqual({});
    });

    it('round-trips through a save: the listing names the seat owners', async () => {
      const { db } = await open();
      const seats = { white: 'player-a', black: null };
      await saveGame(db, 'net-game', sampleGame(), {
        ...sampleMeta,
        players: playersFromSeats(seats),
        seats,
      });

      const list = await listArchivedGames(db);
      expect(list[0]!.meta.players).toEqual({ white: 'player-a' });
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
      // The STORED record carries no `seats` KEY at all — not a key holding `undefined`. A local game
      // that never negotiated seats must not look like a networked game whose owners are blank.
      const stored = await getGame(db, 'local');
      expect('seats' in stored!.meta).toBe(false);
    });

    it('loadNetGame returns undefined for a missing id (negative case)', async () => {
      const { db } = await open();
      expect(await loadNetGame(db, 'nope')).toBeUndefined();
    });

    it('loadNetGame falls back to the default board size (9) when a record omits size', async () => {
      const { db } = await open();
      // A record with NO `size` field (a legacy record) reconstructs on the default board.
      const record: GameRecord = {
        id: 'legacy-nosize',
        log: [{ type: 'place', node: '4,4,4' }],
        meta: {
          players: {},
          result: 'in-progress',
          startedAt: 0,
          uuid: 'nosize-uuid',
          headHash: 'ignored-on-load',
          seats: { white: 'player-a', black: null },
        },
      };
      await putGame(db, record);

      const loaded = await loadNetGame(db, 'legacy-nosize');
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

    it('a networked game keyed by its UUID is an ordinary LISTED game (V.1, #47 — nothing is hidden)', async () => {
      const { db } = await open();
      // A DIFFERENT local game, so the assertion below shows the net game listed ALONGSIDE ordinary
      // records rather than in place of them (no marker filter survives: the v3 `net-room:{code}`
      // shard and the exclusion that hid it are gone).
      await saveGame(db, 'local-autosave', forkedGame(), { ...sampleMeta, startedAt: 1 });
      // A live net session persists its authoritative game under the game's OWN uuid, with the
      // identity-owned seat map. With reload → empty slate, the games list is the ONLY route back to
      // this game, so it MUST be listed.
      await saveGame(db, SAMPLE_UUID, sampleGame(), {
        ...sampleMeta,
        startedAt: 2,
        seats: { white: 'player-a', black: null },
      });

      const list = await listArchivedGames(db);
      expect(list.map((l) => l.id)).toEqual([SAMPLE_UUID, 'local-autosave']);
      // …and it still loads by its own id, seat map intact (the empty-room reclaim reads it that way).
      expect((await loadNetGame(db, SAMPLE_UUID))?.seats).toEqual({
        white: 'player-a',
        black: null,
      });
    });

    it('LISTS EVERY record, hiding nothing — one game is one record by construction (V.5, #47)', async () => {
      const { db } = await open();
      // Since V.5 every writer keys a record by the GAME's uuid, so there is no such thing as a second
      // record for one game to de-duplicate — and this listing is the ONLY route back to a game
      // (reload → empty slate), so it may not filter. A store that DOES hold two records naming one
      // uuid (a pre-V.5 store, before the boot re-key runs) therefore shows both rather than silently
      // serving one of them: `rekeyArchiveRecordsByGameUuid` is what resolves that, honestly.
      await saveGame(db, 'legacy-autosave-id', sampleGame(), { ...sampleMeta, startedAt: 1 });
      await saveGame(db, SAMPLE_UUID, sampleGame(), {
        ...sampleMeta,
        startedAt: 2,
        seats: { white: 'player-a', black: 'player-b' },
      });

      const list = await listArchivedGames(db);
      expect(list.map((l) => l.id)).toEqual([SAMPLE_UUID, 'legacy-autosave-id']);
      expect(list[0]!.meta.seats).toEqual({ white: 'player-a', black: 'player-b' });
    });

    it('a CONFLICTED record of the same game is NOT hidden (it holds both forks — nothing stands in for it)', async () => {
      const { db } = await open();
      // A live net game (canonical, keyed by its uuid) that then FORKED: `SyncEngine.onConflict`
      // archives both forks under a `conflict-…` id whose meta.uuid is the local fork's — i.e. the
      // same uuid as the canonical record. Collapsing it would delete the only route to the fork pair.
      await saveGame(db, SAMPLE_UUID, sampleGame(), { ...sampleMeta, startedAt: 2 });
      await flagConflicted(db, 'conflict-mine-theirs', {
        mineLog: sampleGame().log,
        theirsLog: forkedGame().log,
        meta: { ...sampleMeta, startedAt: 1 },
      });

      const list = await listArchivedGames(db);
      expect(list.map((l) => l.id)).toEqual([SAMPLE_UUID, 'conflict-mine-theirs']);
      // …and it is still the conflicted pair, both forks reconstructable.
      const forks = await loadConflicted(db, 'conflict-mine-theirs');
      expect(forks!.mine.uuid).toBe(SAMPLE_UUID);
      expect(forks!.theirs.uuid).toBe(FORKED_UUID);
    });

    it('loadNetGameByUuid prefers the CANONICAL record stored UNDER the uuid (the seated net game)', async () => {
      const { db } = await open();
      // The same game exists twice: the app's local autosave record (no seats) and the net session's
      // canonical uuid-keyed record (with the identity-owned seat map). The by-uuid lookup must
      // deterministically resolve the canonical one — the reclaim path needs those seats.
      await saveGame(db, 'local-autosave', sampleGame(), sampleMeta);
      await saveGame(db, SAMPLE_UUID, sampleGame(), {
        ...sampleMeta,
        seats: { white: 'player-a', black: 'player-b' },
      });

      const loaded = await loadNetGameByUuid(db, SAMPLE_UUID);
      expect(loaded).not.toBeUndefined();
      expect(loaded!.game.uuid).toBe(SAMPLE_UUID);
      expect(loaded!.seats).toEqual({ white: 'player-a', black: 'player-b' });
    });

    it('a record id that merely COLLIDES with a uuid is not served — the scan resolves the real game', async () => {
      const { db } = await open();
      // A DIFFERENT game (forked uuid) happens to be archived under the record id `SAMPLE_UUID`, and
      // the real SAMPLE_UUID game lives under another id. Serving the collider would be a silent
      // mis-resolution (a resume would open the wrong board), so the id match must be uuid-verified.
      await saveGame(db, SAMPLE_UUID, forkedGame(), sampleMeta);
      await saveGame(db, 'the-real-one', sampleGame(), {
        ...sampleMeta,
        seats: { white: 'player-a', black: null },
      });

      const loaded = await loadNetGameByUuid(db, SAMPLE_UUID);
      expect(loaded).not.toBeUndefined();
      expect(loaded!.game.uuid).toBe(SAMPLE_UUID);
      expect(loaded!.game.ply()).toBe(sampleGame().ply());
      expect(loaded!.seats).toEqual({ white: 'player-a', black: null });
    });

    it('a CORRUPT record under the uuid key does not sink the lookup — the scan still finds the game', async () => {
      const { db } = await open();
      // The canonical probe is exactly that: a probe. A corrupt record parked under the uuid key must
      // not turn "this game is archived under another id" into a thrown lookup — the pre-canonical
      // (scan-only) implementation resolved this case, and losing it would strand a resumable game.
      await putGame(db, {
        id: SAMPLE_UUID,
        log: [{ type: 'teleport', node: '4,4,4' }],
        meta: { players: {}, result: 'in-progress', startedAt: 0, uuid: SAMPLE_UUID, headHash: 'x' },
      } as GameRecord);
      await saveGame(db, 'the-intact-one', sampleGame(), {
        ...sampleMeta,
        seats: { white: 'player-a', black: 'player-b' },
      });

      const loaded = await loadNetGameByUuid(db, SAMPLE_UUID);
      expect(loaded).not.toBeUndefined();
      expect(loaded!.game.uuid).toBe(SAMPLE_UUID);
      expect(loaded!.game.ply()).toBe(sampleGame().ply());
      expect(loaded!.seats).toEqual({ white: 'player-a', black: 'player-b' });
    });

    it('…but with NO intact alternative the corruption is RE-THROWN, never masked as "no such game"', async () => {
      const { db } = await open();
      // Same corrupt canonical record, and this time it is the only record carrying that uuid. Passing
      // over a corrupt record is only ever justified by having a real answer instead; with none, the
      // honest outcome is the ArchiveError — returning `undefined` would report a DIFFERENT fact ("you
      // have no such game") and silently drop a recoverable one.
      await putGame(db, {
        id: SAMPLE_UUID,
        log: [{ type: 'teleport', node: '4,4,4' }],
        meta: { players: {}, result: 'in-progress', startedAt: 0, uuid: SAMPLE_UUID, headHash: 'x' },
      } as GameRecord);

      await expect(loadNetGameByUuid(db, SAMPLE_UUID)).rejects.toBeInstanceOf(ArchiveError);
      await expect(loadNetGameByUuid(db, SAMPLE_UUID)).rejects.toThrow(
        new RegExp(`archived game "${SAMPLE_UUID}"`),
      );
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

    it('reports each listing’s EVENT COUNT (how much history it holds, without the log)', async () => {
      const { db } = await open();
      await saveGame(db, 'played', sampleGame(), sampleMeta);
      await saveGame(db, 'untouched', new Game(9, 'empty-uuid'), { ...sampleMeta, startedAt: 1 });

      const list = await listArchivedGames(db);
      expect(list.find((l) => l.id === 'played')!.events).toBe(3);
      expect(list.find((l) => l.id === 'untouched')!.events).toBe(0);
    });
  });

  /**
   * `isEmptyShell` — the "nothing ever happened here" predicate the app applies to what it SHOWS
   * (`main.ts`: the archive browser + the Resume seed list). A record for a board with no history and
   * no outcome is not a game to offer; anything with history, or any decided/conflicted game, is.
   */
  describe('isEmptyShell', () => {
    it('is TRUE for a record with no events and no outcome, FALSE once anything happened', async () => {
      const { db } = await open();
      await saveGame(db, 'pristine', new Game(9, 'pristine-uuid'), sampleMeta);
      await saveGame(db, 'played', sampleGame(), sampleMeta);

      const list = await listArchivedGames(db);
      expect(isEmptyShell(list.find((l) => l.id === 'pristine')!)).toBe(true);
      expect(isEmptyShell(list.find((l) => l.id === 'played')!)).toBe(false);
    });

    it('is FALSE for an empty board that carries an OUTCOME (a decided or conflicted record)', async () => {
      const { db } = await open();
      await saveGame(db, 'resigned', new Game(9, 'resigned-uuid'), {
        ...sampleMeta,
        result: 'white-wins',
      });
      await flagConflicted(db, 'forked', {
        mineLog: new Game(9, 'fork-a').log,
        theirsLog: new Game(9, 'fork-b').log,
        meta: sampleMeta,
      });

      const list = await listArchivedGames(db);
      expect(list.every((l) => l.events === 0)).toBe(true); // both really are empty boards
      expect(list.map((l) => isEmptyShell(l))).toEqual([false, false]);
    });
  });

  /**
   * `purgeEmptyShellRecords` — the bound on husk growth. Every boot and every reset writes a record for
   * a board that may never be played, so without this the STORE (not the filtered games list) grows by
   * a couple of rows per page load forever, and every boot scan gets slower with it. The tests assert
   * on the store itself: what is gone, what survived, and that nothing with history is ever touched.
   */
  describe('purgeEmptyShellRecords', () => {
    it('deletes abandoned husks, keeps every game with history, and reports the ids removed', async () => {
      const { db } = await open();
      await saveGame(db, 'husk-1', new Game(9, 'husk-1'), sampleMeta);
      await saveGame(db, 'husk-2', new Game(9, 'husk-2'), sampleMeta);
      await saveGame(db, SAMPLE_UUID, sampleGame(), sampleMeta);
      await saveGame(db, 'decided', new Game(9, 'decided'), { ...sampleMeta, result: 'white-wins' });

      const purged = await purgeEmptyShellRecords(db);

      expect([...purged].sort()).toEqual(['husk-1', 'husk-2']);
      // GONE from the store, not filtered out of a view…
      expect(await getGame(db, 'husk-1')).toBeUndefined();
      expect(await getGame(db, 'husk-2')).toBeUndefined();
      // …and the real games are untouched: the played one keeps its history, the decided one its result.
      expect((await loadGame(db, SAMPLE_UUID))!.ply()).toBe(sampleGame().ply());
      expect((await listArchivedGames(db)).map((l) => l.id).sort()).toEqual([
        'decided',
        SAMPLE_UUID,
      ]);
    });

    it('KEEPS the shells the caller names — by record id or by game uuid (the live board, a live session)', async () => {
      const { db } = await open();
      // The board currently loaded is legitimately empty; a net session's unplayed record is the one
      // the empty-room reclaim re-seeds from by uuid (design §6.4). Neither is abandoned.
      await saveGame(db, 'live-board', new Game(9, 'live-board'), sampleMeta);
      await saveGame(db, 'net-record-id', new Game(9, 'net-game-uuid'), sampleMeta);
      await saveGame(db, 'abandoned', new Game(9, 'abandoned'), sampleMeta);

      const purged = await purgeEmptyShellRecords(db, new Set(['live-board', 'net-game-uuid']));

      expect(purged).toEqual(['abandoned']);
      expect((await listArchivedGames(db)).map((l) => l.id).sort()).toEqual([
        'live-board',
        'net-record-id',
      ]);
    });

    it('is idempotent, and a no-op when every record has history (negative cases)', async () => {
      const { db } = await open();
      await saveGame(db, 'husk', new Game(9, 'husk'), sampleMeta);
      await saveGame(db, SAMPLE_UUID, sampleGame(), sampleMeta);

      expect(await purgeEmptyShellRecords(db)).toEqual(['husk']);
      expect(await purgeEmptyShellRecords(db)).toEqual([]);
      expect(await purgeEmptyShellRecords(db, new Set(['whatever']))).toEqual([]);
      expect((await listArchivedGames(db)).map((l) => l.id)).toEqual([SAMPLE_UUID]);
    });

    it('never collects a board that is PLAYED while the purge runs (one transaction, no snapshot)', async () => {
      const { db } = await open();
      // The empty board a purge is about to collect… and a move landing on that very board at the same
      // moment — the app's own autosave, or another TAB of this origin (the store is per-origin). A
      // purge that decided from a scan and then deleted by id would destroy the game that arrived in
      // between; deciding inside the transaction judges the record it actually holds.
      await saveGame(db, SAMPLE_UUID, new Game(9, SAMPLE_UUID), sampleMeta);
      const purge = purgeEmptyShellRecords(db);
      const write = saveGame(db, SAMPLE_UUID, sampleGame(), sampleMeta);
      const [purged] = await Promise.all([purge, write]);

      expect(purged).toEqual([SAMPLE_UUID]); // the EMPTY board it saw really was collected…
      // …and the played game that landed a moment later is intact, with its full history.
      expect(headHash((await loadGame(db, SAMPLE_UUID))!.log)).toBe(headHash(sampleGame().log));
      expect((await listArchivedGames(db))[0]!.events).toBe(sampleGame().log.entries.length);
    });

    it('never collects a RECENTLY-WRITTEN seated record, even one the caller did not name (another tab’s live room)', async () => {
      const { db } = await open();
      // A room entered but not yet played on: no events, no outcome — a husk by shape, a seated game in
      // fact. Its record is what the empty-room reclaim (design §6.4) re-seeds from, and the store is
      // shared by every tab of the origin, so the caller's `keep` cannot name another tab's room.
      const now = 1_800_000_000_000;
      await saveGame(
        db,
        'seated-room-game',
        new Game(9, 'seated-room-game'),
        { ...sampleMeta, seats: { white: 'player-a', black: null } },
        now - 60_000, // written a minute ago: a live room
      );
      await saveGame(db, 'plain-husk', new Game(9, 'plain-husk'), sampleMeta, now);

      expect(await purgeEmptyShellRecords(db, new Set(), now)).toEqual(['plain-husk']);

      expect((await loadNetGame(db, 'seated-room-game'))?.seats).toEqual({
        white: 'player-a',
        black: null,
      });
    });

    it('DOES collect a seated husk nothing has written to since the horizon (the abandoned-room leak)', async () => {
      const { db } = await open();
      // Every room entry writes its seat map before a single move, so a room entered and abandoned
      // leaves a `{events: 0, in-progress, seats}` row — invisible in the games list and, while the
      // seat exemption was unbounded, permanent. One per abandoned room, forever.
      const now = 1_800_000_000_000;
      for (const [i, id] of ['room-1', 'room-2', 'room-3'].entries()) {
        await saveGame(
          db,
          id,
          new Game(9, id),
          { ...sampleMeta, seats: { white: 'player-a', black: null } },
          now - SEATED_SHELL_MAX_AGE_MS - (i + 1) * 60_000,
        );
      }
      // …and a seated game that was actually PLAYED, however old: history is never collected.
      await saveGame(
        db,
        SAMPLE_UUID,
        sampleGame(),
        { ...sampleMeta, seats: { white: 'player-a', black: 'player-b' } },
        now - 10 * SEATED_SHELL_MAX_AGE_MS,
      );

      expect([...(await purgeEmptyShellRecords(db, new Set(), now))].sort()).toEqual([
        'room-1',
        'room-2',
        'room-3',
      ]);
      expect((await listArchivedGames(db)).map((l) => l.id)).toEqual([SAMPLE_UUID]);
      expect((await loadNetGame(db, SAMPLE_UUID))?.seats).toEqual({
        white: 'player-a',
        black: 'player-b',
      });
    });

    it('judges a seated husk at the EXACT horizon: still recent AT it, collectable one ms past it', async () => {
      const { db } = await open();
      const now = 1_800_000_000_000;
      const seated = (id: string, writtenAt: number) =>
        saveGame(
          db,
          id,
          new Game(9, id),
          { ...sampleMeta, seats: { white: 'player-a', black: null } },
          writtenAt,
        );
      await seated('at-horizon', now - SEATED_SHELL_MAX_AGE_MS);
      await seated('past-horizon', now - SEATED_SHELL_MAX_AGE_MS - 1);

      expect(await purgeEmptyShellRecords(db, new Set(), now)).toEqual(['past-horizon']);
      expect((await listArchivedGames(db)).map((l) => l.id)).toEqual(['at-horizon']);
    });

    it('collects a seated husk with NO updatedAt stamp — it was written by an earlier page load', async () => {
      const { db } = await open();
      // Every write of this build stamps `updatedAt`, so a seated record without one predates it: it
      // cannot be a session that is still going, and it is exactly the husk pile an earlier build left.
      await putGame(db, {
        id: 'old-build-room',
        log: [],
        meta: {
          players: { white: 'player-a' },
          result: 'in-progress',
          startedAt: 1,
          uuid: 'old-build-room',
          headHash: 'whatever',
          seats: { white: 'player-a', black: null },
        },
      } as unknown as GameRecord);

      expect(await purgeEmptyShellRecords(db, new Set(), 1_800_000_000_000)).toEqual([
        'old-build-room',
      ]);
      expect(await listArchivedGames(db)).toEqual([]);
    });

    it('KEEPS a long-abandoned seated husk the caller still names (our own live session’s game)', async () => {
      const { db } = await open();
      // The age rule never overrides the caller: a session of OURS may sit in a room for days without a
      // move, and its record is what the empty-room reclaim re-seeds from (design §6.4).
      const now = 1_800_000_000_000;
      await saveGame(
        db,
        'record-id',
        new Game(9, 'ours-live-uuid'),
        { ...sampleMeta, seats: { white: 'player-a', black: null } },
        now - 10 * SEATED_SHELL_MAX_AGE_MS,
      );

      expect(await purgeEmptyShellRecords(db, new Set(['ours-live-uuid']), now)).toEqual([]);
      expect((await loadNetGame(db, 'record-id'))?.seats).toEqual({
        white: 'player-a',
        black: null,
      });
    });

    it('never touches a CONFLICTED record, even though its board is empty', async () => {
      const { db } = await open();
      // Both forks are empty boards, so only the `result` marker distinguishes it from a husk — and it
      // holds information no other record does.
      await flagConflicted(db, 'forked', {
        mineLog: new Game(9, 'fork-a').log,
        theirsLog: new Game(9, 'fork-b').log,
        meta: sampleMeta,
      });

      expect(await purgeEmptyShellRecords(db)).toEqual([]);
      expect((await loadConflicted(db, 'forked'))!.theirs.uuid).toBe('fork-b');
    });
  });

  /**
   * `archivedIdentity` — the players + identity-owned seat map a stored record already carries. The
   * app's autosave reads it so rewriting the BOARD of a game that has been in a room never un-seats its
   * owners (design §2.3/§6.4).
   */
  describe('archivedIdentity', () => {
    it('reports the stored players + seats of a networked record', async () => {
      const { db } = await open();
      await saveGame(db, SAMPLE_UUID, sampleGame(), {
        ...sampleMeta,
        players: { white: 'player-a', black: 'player-b' },
        seats: { white: 'player-a', black: 'player-b' },
      });

      expect(await archivedIdentity(db, SAMPLE_UUID)).toEqual({
        players: { white: 'player-a', black: 'player-b' },
        seats: { white: 'player-a', black: 'player-b' },
      });
    });

    it('reports `seats: null` for a LOCAL record and `undefined` for no record at all (negative cases)', async () => {
      const { db } = await open();
      await saveGame(db, 'local', sampleGame(), {
        ...sampleMeta,
        players: { white: 'You', black: 'You' },
      });

      expect(await archivedIdentity(db, 'local')).toEqual({
        players: { white: 'You', black: 'You' },
        seats: null,
      });
      expect(await archivedIdentity(db, 'no-such-record')).toBeUndefined();
    });
  });

  /**
   * `archivedStartedAts` — when each archived GAME began, keyed by its portable uuid. The durable
   * answer a re-persisting writer (`NetSession`) reads instead of minting a fresh stamp, so returning
   * to a game never re-dates it in the (startedAt-sorted) games list.
   */
  describe('archivedStartedAts', () => {
    it('maps every archived game uuid to the startedAt its record carries', async () => {
      const { db } = await open();
      await saveGame(db, SAMPLE_UUID, sampleGame(), { ...sampleMeta, startedAt: 111 });
      await saveGame(db, 'other-record-id', forkedGame(), { ...sampleMeta, startedAt: 222 });

      const stamps = await archivedStartedAts(db);

      // Keyed by the game's UUID (design §2.2) — NOT by the local record id, which for the second
      // game is a different string entirely.
      expect(stamps.get(SAMPLE_UUID)).toBe(111);
      expect(stamps.get(FORKED_UUID)).toBe(222);
      expect(stamps.size).toBe(2);
    });

    it('takes the EARLIEST stamp when one game occupies two records, in EITHER store order', async () => {
      const { db } = await open();
      // One game in two records is real: the app's autosave shadow (written when the board began) plus
      // the canonical uuid-keyed net record. The store's cursor walks records in KEY order, so the two
      // games below present the pair in OPPOSITE orders — the earlier stamp first for one, last for the
      // other — proving the result is the game's true start either way (not "whichever came last").
      await saveGame(db, 'a-early-first', sampleGame(), { ...sampleMeta, startedAt: 1_000 });
      await saveGame(db, 'z-late-second', sampleGame(), { ...sampleMeta, startedAt: 9_000 });
      await saveGame(db, 'b-late-first', forkedGame(), { ...sampleMeta, startedAt: 8_000 });
      await saveGame(db, 'y-early-second', forkedGame(), { ...sampleMeta, startedAt: 2_000 });

      const stamps = await archivedStartedAts(db);

      expect(stamps.get(SAMPLE_UUID)).toBe(1_000);
      expect(stamps.get(FORKED_UUID)).toBe(2_000);
    });

    it('is EMPTY for an empty archive (negative case)', async () => {
      const { db } = await open();
      expect((await archivedStartedAts(db)).size).toBe(0);
    });
  });

  /**
   * The v3 → v3.1 MIGRATION (V.1, epic #47): the `net-room:{code}` shards a deployed v3 build wrote
   * into this ORIGIN's IndexedDB are DELETED, not hidden. v3.1 has no marker filter, so an un-migrated
   * shard would render as a user-facing game and be offered as a resume seed.
   */
  describe('purgeLegacyNetRoomRecords', () => {
    /** A v3 shard exactly as `net-room:{code}` was written: a real log + seat map, marked `net-room`. */
    async function writeV3Shard(db: IDBDatabase, code: string): Promise<void> {
      await saveGame(db, `net-room:${code}`, sampleGame(), {
        ...sampleMeta,
        result: 'net-room',
        seats: { white: 'player-a', black: 'player-b' },
      });
    }

    it('deletes every legacy shard, leaves real games alone, and reports the ids removed', async () => {
      const { db } = await open();
      await writeV3Shard(db, 'RMBBCC');
      await writeV3Shard(db, 'DUDEEE');
      await saveGame(db, 'a-real-game', forkedGame(), sampleMeta);
      // Before the migration the shards are indistinguishable from games in the listing — this is the
      // user-facing symptom (a bogus "? vs ? · net-room" entry per room code ever used).
      expect((await listArchivedGames(db)).map((l) => l.id).sort()).toEqual([
        'a-real-game',
        'net-room:DUDEEE',
        'net-room:RMBBCC',
      ]);

      const purged = await purgeLegacyNetRoomRecords(db);

      expect([...purged].sort()).toEqual(['net-room:DUDEEE', 'net-room:RMBBCC']);
      // GONE from the store itself, not merely filtered out of a view.
      expect(await getGame(db, 'net-room:RMBBCC')).toBeUndefined();
      expect(await getGame(db, 'net-room:DUDEEE')).toBeUndefined();
      // The real game survives untouched, still loadable with its history intact.
      expect((await listArchivedGames(db)).map((l) => l.id)).toEqual(['a-real-game']);
      expect((await loadGame(db, 'a-real-game'))!.ply()).toBe(forkedGame().ply());
    });

    it('is idempotent — a second run finds nothing and removes nothing (negative case)', async () => {
      const { db } = await open();
      await writeV3Shard(db, 'RMBBCC');
      await saveGame(db, 'a-real-game', forkedGame(), sampleMeta);

      expect(await purgeLegacyNetRoomRecords(db)).toHaveLength(1);
      expect(await purgeLegacyNetRoomRecords(db)).toEqual([]);
      expect((await listArchivedGames(db)).map((l) => l.id)).toEqual(['a-real-game']);
    });

    it('never touches a v3.1 networked game (keyed by uuid, seat map and all)', async () => {
      const { db } = await open();
      await saveGame(db, SAMPLE_UUID, sampleGame(), {
        ...sampleMeta,
        seats: { white: 'player-a', black: 'player-b' },
      });

      expect(await purgeLegacyNetRoomRecords(db)).toEqual([]);
      expect((await loadNetGame(db, SAMPLE_UUID))?.seats).toEqual({
        white: 'player-a',
        black: 'player-b',
      });
    });
  });

  /**
   * The V.5 re-keying MIGRATION (epic #47): every record moves onto its game's own `uuid`, so one game
   * has exactly one record. The point of these tests is that it is a MIGRATION and not a loss — a game
   * an older build archived under its retired autosave id must still be listed, still be loadable, and
   * must not turn into a second record the first time it is played again.
   */
  describe('rekeyArchiveRecordsByGameUuid', () => {
    it('MOVES a legacy autosave-id record onto the game uuid — same game, one record', async () => {
      const { db } = await open();
      await saveGame(db, 'pente-autosave-42', sampleGame(), { ...sampleMeta, startedAt: 7 });

      expect(await rekeyArchiveRecordsByGameUuid(db)).toEqual(['pente-autosave-42']);

      // Keyed by the game now — and nothing about the game changed: same history, same date, and it
      // resolves by uuid through the CANONICAL step (step 1) rather than the listing scan.
      const list = await listArchivedGames(db);
      expect(list.map((l) => l.id)).toEqual([SAMPLE_UUID]);
      expect(list[0]!.meta.startedAt).toBe(7);
      expect(await getGame(db, 'pente-autosave-42')).toBeUndefined();
      expect(headHash((await loadGame(db, SAMPLE_UUID))!.log)).toBe(headHash(sampleGame().log));
    });

    it('keeps the seat map + result of the record it moves (a networked game stays reclaimable)', async () => {
      const { db } = await open();
      await saveGame(db, 'legacy-id', sampleGame(), {
        ...sampleMeta,
        result: 'white-wins',
        seats: { white: 'player-a', black: 'player-b' },
      });

      await rekeyArchiveRecordsByGameUuid(db);

      const loaded = await loadNetGameByUuid(db, SAMPLE_UUID);
      expect(loaded!.seats).toEqual({ white: 'player-a', black: 'player-b' });
      expect((await listArchivedGames(db))[0]!.meta.result).toBe('white-wins');
    });

    it('is idempotent — a second run has nothing left to move (negative case)', async () => {
      const { db } = await open();
      await saveGame(db, 'legacy-id', sampleGame(), sampleMeta);
      expect(await rekeyArchiveRecordsByGameUuid(db)).toEqual(['legacy-id']);
      expect(await rekeyArchiveRecordsByGameUuid(db)).toEqual([]);
      expect((await listArchivedGames(db)).map((l) => l.id)).toEqual([SAMPLE_UUID]);
    });

    it('leaves a record ALREADY keyed by its game uuid untouched', async () => {
      const { db } = await open();
      await saveGame(db, SAMPLE_UUID, sampleGame(), sampleMeta);
      expect(await rekeyArchiveRecordsByGameUuid(db)).toEqual([]);
      expect((await listArchivedGames(db)).map((l) => l.id)).toEqual([SAMPLE_UUID]);
    });

    it('leaves a pre-uuid record where it is — there is no key to move it to (still listed, still loadable)', async () => {
      const { db } = await open();
      // A record written before games carried a uuid. Nothing identifies it, so re-keying it is
      // impossible; losing it would be worse than leaving it, so it stays exactly as it was.
      // `GameMeta.uuid` is REQUIRED by the type, so a record without one can only be written by
      // bypassing it — which is exactly what an older build's records are: real bytes in the store that
      // today's type does not describe.
      const record = {
        id: 'ancient-record',
        log: [{ type: 'place', node: '4,4,4' }],
        meta: { players: {}, result: 'in-progress', startedAt: 5, headHash: 'whatever' },
      } as unknown as GameRecord;
      await putGame(db, record);

      expect(await rekeyArchiveRecordsByGameUuid(db)).toEqual([]);
      expect((await listArchivedGames(db)).map((l) => l.id)).toEqual(['ancient-record']);
      expect((await loadGame(db, 'ancient-record'))!.ply()).toBe(1);
    });

    it('leaves a CONFLICTED record where it is — its forks are not a view of one game', async () => {
      const { db } = await open();
      // A conflicted record is keyed by its own conflict id and its `meta.uuid` is the LOCAL fork's, so
      // re-keying it would overwrite that game with one of its forks and destroy the pair.
      await flagConflicted(db, 'conflict-mine-theirs', {
        mineLog: sampleGame().log,
        theirsLog: forkedGame().log,
        meta: sampleMeta,
      });

      expect(await rekeyArchiveRecordsByGameUuid(db)).toEqual([]);
      const forks = await loadConflicted(db, 'conflict-mine-theirs');
      expect(forks!.mine.uuid).toBe(SAMPLE_UUID);
      expect(forks!.theirs.uuid).toBe(FORKED_UUID);
    });

    it('never overwrites a conflicted record sitting on the uuid — BOTH records survive', async () => {
      const { db } = await open();
      // Contrived but the only honest answer: the conflicted pair happens to be stored UNDER the game's
      // uuid while an ordinary legacy record of the same game sits elsewhere. Moving the legacy record
      // on top would delete the fork pair, so neither is touched.
      await flagConflicted(db, SAMPLE_UUID, {
        mineLog: sampleGame().log,
        theirsLog: forkedGame().log,
        meta: sampleMeta,
      });
      await saveGame(db, 'legacy-id', sampleGame(), sampleMeta);

      expect(await rekeyArchiveRecordsByGameUuid(db)).toEqual([]);
      expect((await loadConflicted(db, SAMPLE_UUID))!.theirs.uuid).toBe(FORKED_UUID);
      expect(await getGame(db, 'legacy-id')).not.toBeUndefined();
    });

    it('when both keys hold the game, the record with MORE history wins (never trade history for tidiness)', async () => {
      const { db } = await open();
      // The uuid key holds a 1-move snapshot; the legacy key holds the same game 3 moves in. Keeping
      // the shorter one would silently lose two moves, so the longer record is the one that survives.
      const short = new Game(9, SAMPLE_UUID);
      short.place([4, 4, 4]);
      await saveGame(db, SAMPLE_UUID, short, { ...sampleMeta, startedAt: 2 });
      await saveGame(db, 'legacy-id', sampleGame(), { ...sampleMeta, startedAt: 1 });

      // Both ids are reported: the 1-move snapshot is DROPPED (the survivor contains it) and the
      // 3-move record is MOVED onto the uuid. The snapshot used to be overwritten in place, i.e.
      // removed without being reported — the report now names every record that left its key.
      expect([...(await rekeyArchiveRecordsByGameUuid(db))].sort()).toEqual([
        'legacy-id',
        SAMPLE_UUID,
      ]);

      const list = await listArchivedGames(db);
      expect(list.map((l) => l.id)).toEqual([SAMPLE_UUID]);
      expect(list[0]!.events).toBe(sampleGame().log.entries.length);
    });

    it('when the uuid key already holds AT LEAST as much history, the stale legacy record is dropped', async () => {
      const { db } = await open();
      // The live writer has kept the uuid-keyed record current; the legacy record is a stale snapshot of
      // the same game. Nothing is lost by dropping it, and keeping it would show one game twice.
      await saveGame(db, SAMPLE_UUID, sampleGame(), { ...sampleMeta, startedAt: 2 });
      const short = new Game(9, SAMPLE_UUID);
      short.place([4, 4, 4]);
      await saveGame(db, 'legacy-id', short, { ...sampleMeta, startedAt: 1 });

      expect(await rekeyArchiveRecordsByGameUuid(db)).toEqual(['legacy-id']);

      const list = await listArchivedGames(db);
      expect(list.map((l) => l.id)).toEqual([SAMPLE_UUID]);
      expect(list[0]!.events).toBe(sampleGame().log.entries.length);
      expect(await getGame(db, 'legacy-id')).toBeUndefined();
    });

    it('on a TIE the record ALREADY under the uuid wins — it is the one carrying the seat map', async () => {
      const { db } = await open();
      // Same game, same history length, in two records: the canonical uuid-keyed one (written by the net
      // session, WITH the identity-owned seat map) and a legacy autosave-id one (seat-less). Equal
      // history means neither holds more, so the canonical record must survive — overwriting it with the
      // seat-less copy would silently drop the value the empty-room reclaim needs.
      await saveGame(db, SAMPLE_UUID, sampleGame(), {
        ...sampleMeta,
        seats: { white: 'player-a', black: 'player-b' },
      });
      await saveGame(db, 'legacy-id', sampleGame(), sampleMeta);

      expect(await rekeyArchiveRecordsByGameUuid(db)).toEqual(['legacy-id']);

      const list = await listArchivedGames(db);
      expect(list.map((l) => l.id)).toEqual([SAMPLE_UUID]);
      expect(list[0]!.meta.seats).toEqual({ white: 'player-a', black: 'player-b' });
    });

    /**
     * TWO legacy records of ONE game and NOTHING on its uuid key — the shape a pre-V.5 build really
     * produced (review + RESUME continued an archived game under a FRESH autosave id while the
     * original record stayed put, so both carried the same `meta.uuid`). The destination key is free,
     * so BOTH records "can" move there and only one can survive: the migration must land the one with
     * MORE history, whatever order the store hands them over in.
     */
    describe('TWO records of one game with NOTHING on the uuid key (the pre-V.5 resume shape)', () => {
      /** The same game at 1 move — a stale prefix of {@link sampleGame} (3 moves), same uuid. */
      function shortSample(): Game {
        const g = new Game(9, SAMPLE_UUID);
        g.place([4, 4, 4]);
        return g;
      }

      it('keeps the LONGER history when it is stored FIRST (store order must not decide)', async () => {
        const { db } = await open();
        // Store order is key order, so 'aaa-…' is listed before 'zzz-…': the longer record comes first.
        await saveGame(db, 'aaa-original', sampleGame(), { ...sampleMeta, startedAt: 1 });
        await saveGame(db, 'zzz-continued', shortSample(), { ...sampleMeta, startedAt: 2 });

        expect([...(await rekeyArchiveRecordsByGameUuid(db))].sort()).toEqual([
          'aaa-original',
          'zzz-continued',
        ]);

        // ONE record, under the uuid, holding the FULL 3-move history — not the 1-move snapshot that
        // happened to be re-keyed last.
        const list = await listArchivedGames(db);
        expect(list.map((l) => l.id)).toEqual([SAMPLE_UUID]);
        expect(list[0]!.events).toBe(sampleGame().log.entries.length);
        expect(headHash((await loadGame(db, SAMPLE_UUID))!.log)).toBe(headHash(sampleGame().log));
        expect(await getGame(db, 'aaa-original')).toBeUndefined();
        expect(await getGame(db, 'zzz-continued')).toBeUndefined();
      });

      it('keeps the LONGER history when it is stored LAST (the mirror case)', async () => {
        const { db } = await open();
        await saveGame(db, 'aaa-snapshot', shortSample(), { ...sampleMeta, startedAt: 1 });
        await saveGame(db, 'zzz-continued', sampleGame(), { ...sampleMeta, startedAt: 2 });

        await rekeyArchiveRecordsByGameUuid(db);

        const list = await listArchivedGames(db);
        expect(list.map((l) => l.id)).toEqual([SAMPLE_UUID]);
        expect(list[0]!.events).toBe(sampleGame().log.entries.length);
        expect(headHash((await loadGame(db, SAMPLE_UUID))!.log)).toBe(headHash(sampleGame().log));
      });

      it('is idempotent and keeps the winner across a THREE-record pile-up (negative case)', async () => {
        const { db } = await open();
        const two = new Game(9, SAMPLE_UUID);
        two.place([4, 4, 4]);
        two.place([4, 4, 5]);
        await saveGame(db, 'aaa-one', shortSample(), sampleMeta);
        await saveGame(db, 'mmm-three', sampleGame(), sampleMeta);
        await saveGame(db, 'zzz-two', two, sampleMeta);

        expect(await rekeyArchiveRecordsByGameUuid(db)).toHaveLength(3);
        // A second run finds one canonical record and nothing left to move.
        expect(await rekeyArchiveRecordsByGameUuid(db)).toEqual([]);
        const list = await listArchivedGames(db);
        expect(list.map((l) => l.id)).toEqual([SAMPLE_UUID]);
        expect(list[0]!.events).toBe(sampleGame().log.entries.length);
      });

      it('keeps a DIVERGENT same-length record where it is rather than dropping a history it cannot prove stale', async () => {
        const { db } = await open();
        // Two records of one game, equal length but DIFFERENT histories (the pre-V.5 resume could
        // continue an archived game two different ways). Neither holds more, and neither contains the
        // other, so the migration keys one by the uuid and LEAVES the other alone — a duplicate row in
        // the games list is recoverable; a deleted fork is not.
        const other = new Game(9, SAMPLE_UUID);
        other.place([0, 0, 0]);
        other.place([1, 1, 1]);
        other.place([2, 2, 2]);
        expect(headHash(other.log)).not.toBe(headHash(sampleGame().log));
        await saveGame(db, 'aaa-mine', sampleGame(), sampleMeta);
        await saveGame(db, 'zzz-divergent', other, sampleMeta);

        expect(await rekeyArchiveRecordsByGameUuid(db)).toEqual(['aaa-mine']);

        const list = await listArchivedGames(db);
        expect(list.map((l) => l.id).sort()).toEqual([SAMPLE_UUID, 'zzz-divergent']);
        expect(headHash((await loadGame(db, SAMPLE_UUID))!.log)).toBe(headHash(sampleGame().log));
        expect(headHash((await loadGame(db, 'zzz-divergent'))!.log)).toBe(headHash(other.log));
      });

      it('keeps a SHORTER but DIVERGENT record — fewer events is NOT proof the survivor contains it', async () => {
        const { db } = await open();
        // The dangerous shape: one record holds FEWER events than the other, but on a completely
        // different line of play (resume + undo + a different continuation leaves exactly this). A
        // length says nothing about a hash chain, so the short record is a history no other record
        // holds — deleting it would destroy the player's only copy of it.
        const shortDivergent = new Game(9, SAMPLE_UUID);
        shortDivergent.place([0, 0, 0]);
        shortDivergent.place([1, 1, 1]);
        expect(shortDivergent.log.entries.length).toBeLessThan(sampleGame().log.entries.length);
        // They part company at the very first move: neither chain contains the other.
        expect(firstDivergence(shortDivergent.log, sampleGame().log)).toBe(0);
        await saveGame(db, 'aaa-short-divergent', shortDivergent, sampleMeta);
        await saveGame(db, 'zzz-longer', sampleGame(), sampleMeta);

        // Only the LONGER record moves; the short divergent one is not reported, because it did not
        // leave its key.
        expect(await rekeyArchiveRecordsByGameUuid(db)).toEqual(['zzz-longer']);

        const list = await listArchivedGames(db);
        expect(list.map((l) => l.id).sort()).toEqual(['aaa-short-divergent', SAMPLE_UUID]);
        expect(headHash((await loadGame(db, SAMPLE_UUID))!.log)).toBe(headHash(sampleGame().log));
        // The 2-move line is still there, move for move — not merely "a record still exists".
        const kept = (await loadGame(db, 'aaa-short-divergent'))!;
        expect(headHash(kept.log)).toBe(headHash(shortDivergent.log));
        expect(Object.keys(kept.state().pieces).sort()).toEqual(['0,0,0', '1,1,1']);
      });
    });

    it('a SHORTER DIVERGENT record ON the uuid key is neither deleted nor overwritten by the re-key', async () => {
      const { db } = await open();
      // The same divergence, with the short record sitting on the DESTINATION key. `rekeyGame`
      // overwrites its destination, so moving the longer record onto the uuid would destroy the short
      // history just as surely as deleting it. Both records stay exactly where they are.
      const shortDivergent = new Game(9, SAMPLE_UUID);
      shortDivergent.place([0, 0, 0]);
      shortDivergent.place([1, 1, 1]);
      await saveGame(db, SAMPLE_UUID, shortDivergent, sampleMeta);
      await saveGame(db, 'legacy-id', sampleGame(), sampleMeta);

      expect(await rekeyArchiveRecordsByGameUuid(db)).toEqual([]);
      // Idempotent in this shape too: a second run still refuses to trade either history away.
      expect(await rekeyArchiveRecordsByGameUuid(db)).toEqual([]);

      expect(headHash((await loadGame(db, SAMPLE_UUID))!.log)).toBe(headHash(shortDivergent.log));
      expect(headHash((await loadGame(db, 'legacy-id'))!.log)).toBe(headHash(sampleGame().log));
    });

    it('keeps a shorter record whose log will NOT REPLAY — a corrupt log proves nothing either', async () => {
      const { db } = await open();
      // A record the survivor cannot be shown to contain, because it cannot be folded at all. The
      // honest answer to "is it contained?" is no, so it survives — and the migration does not throw
      // on it (a boot-time scan must not be sunk by one bad row).
      await saveGame(db, 'zzz-longer', sampleGame(), sampleMeta);
      await putGame(db, {
        id: 'aaa-corrupt',
        log: [{ type: 'place', node: 'not-a-coord' }],
        meta: { ...sampleMeta, uuid: SAMPLE_UUID, headHash: 'stale' },
      } as unknown as GameRecord);

      expect(await rekeyArchiveRecordsByGameUuid(db)).toEqual(['zzz-longer']);

      expect((await listArchivedGames(db)).map((l) => l.id).sort()).toEqual([
        'aaa-corrupt',
        SAMPLE_UUID,
      ]);
      await expect(loadGame(db, 'aaa-corrupt')).rejects.toBeInstanceOf(ArchiveError);
    });

    it('keeps every loser when the SURVIVOR will not replay — nothing can be proven against it', async () => {
      const { db } = await open();
      // The record with the most events is the corrupt one. It still moves onto the uuid (relocating a
      // record does not judge its bytes), but it can prove nothing about anybody, so the shorter — and
      // here genuinely contained — record is kept rather than dropped on a length.
      const short = new Game(9, SAMPLE_UUID);
      short.place([4, 4, 4]);
      await saveGame(db, 'aaa-short', short, sampleMeta);
      await putGame(db, {
        id: 'zzz-corrupt',
        log: [
          { type: 'place', node: '4,4,4' },
          { type: 'place', node: 'not-a-coord' },
        ],
        meta: { ...sampleMeta, uuid: SAMPLE_UUID, headHash: 'stale' },
      } as unknown as GameRecord);

      expect(await rekeyArchiveRecordsByGameUuid(db)).toEqual(['zzz-corrupt']);

      expect((await listArchivedGames(db)).map((l) => l.id).sort()).toEqual([
        'aaa-short',
        SAMPLE_UUID,
      ]);
      expect(headHash((await loadGame(db, 'aaa-short'))!.log)).toBe(headHash(short.log));
    });

    it('keeps a record that VANISHES mid-migration — an absent log proves nothing either', async () => {
      const { db } = await open();
      // The store is shared by every tab of the origin, so a record listed a moment ago can be gone by
      // the time this reads its log (another tab's purge). Fault-injected because the race cannot be
      // timed deterministically; the behavior asserted is real: nothing is proven, so nothing is
      // deleted, and the migration still completes.
      const short = new Game(9, SAMPLE_UUID);
      short.place([4, 4, 4]);
      await saveGame(db, 'aaa-vanishes', short, sampleMeta);
      await saveGame(db, 'zzz-longer', sampleGame(), sampleMeta);
      const real = dbModule.getGame;
      const spy = vi
        .spyOn(dbModule, 'getGame')
        .mockImplementation((handle: IDBDatabase, id: string) =>
          id === 'aaa-vanishes' ? Promise.resolve(undefined) : real(handle, id),
        );
      try {
        expect(await rekeyArchiveRecordsByGameUuid(db)).toEqual(['zzz-longer']);
      } finally {
        spy.mockRestore();
      }
      // The record the migration could not read was not deleted on the strength of its length.
      expect(headHash((await loadGame(db, 'aaa-vanishes'))!.log)).toBe(headHash(short.log));
      expect(headHash((await loadGame(db, SAMPLE_UUID))!.log)).toBe(headHash(sampleGame().log));
    });

    it('propagates a STORE failure instead of mistaking it for an unreadable log (negative case)', async () => {
      const { db } = await open();
      // Fault-injection to separate the two failures the containment check can meet: a corrupt LOG is
      // this module's own verdict (above — the record is kept), while a failing IndexedDB read is a
      // different fact entirely and must reach the caller verbatim, never be read as "not contained".
      await saveGame(db, 'aaa-short', new Game(9, SAMPLE_UUID), sampleMeta);
      await saveGame(db, 'zzz-longer', sampleGame(), sampleMeta);
      const fault = new DOMException('store is on fire', 'UnknownError');
      const spy = vi.spyOn(dbModule, 'getGame').mockRejectedValue(fault);
      try {
        await expect(rekeyArchiveRecordsByGameUuid(db)).rejects.toBe(fault);
      } finally {
        spy.mockRestore();
      }
      // Nothing was deleted or moved on the way to that failure.
      expect((await listArchivedGames(db)).map((l) => l.id).sort()).toEqual([
        'aaa-short',
        'zzz-longer',
      ]);
    });

    it('…and the tie goes to the canonical record whichever way the store orders the two', async () => {
      const { db } = await open();
      // The mirror of the test above: the canonical record is listed FIRST (ids are the store's key
      // order), so the legacy copy is the one being considered against it. Equal history still means
      // the seat-carrying canonical record survives — the winner is decided by what the records ARE,
      // never by which one the cursor happened to hand over first.
      await saveGame(db, SAMPLE_UUID, sampleGame(), {
        ...sampleMeta,
        seats: { white: 'player-a', black: 'player-b' },
      });
      await saveGame(db, 'zzz-legacy-id', sampleGame(), sampleMeta);

      expect(await rekeyArchiveRecordsByGameUuid(db)).toEqual(['zzz-legacy-id']);

      const list = await listArchivedGames(db);
      expect(list.map((l) => l.id)).toEqual([SAMPLE_UUID]);
      expect(list[0]!.meta.seats).toEqual({ white: 'player-a', black: 'player-b' });
    });

    it('is a no-op on an EMPTY archive (negative case)', async () => {
      const { db } = await open();
      expect(await rekeyArchiveRecordsByGameUuid(db)).toEqual([]);
    });
  });

  /**
   * `StartedAtLedger` — the "established once per game" stamp both writers of the archive hold. Its
   * whole job is that a game the browser RETURNS to keeps the date it began: the games list is sorted
   * by that date and renders it, so re-minting it shuffles a returned-to game to the top and re-dates
   * it (a user-visible loss, since the list is the only route back to a game).
   */
  describe('StartedAtLedger', () => {
    it('MINTS a stamp on first use and reuses it forever after, whatever the clock says', async () => {
      const ledger = new StartedAtLedger();
      expect(ledger.stampFor('game-1', 1_000)).toBe(1_000);
      // The clock moved on (a later autosave of the same game) — the game still began when it began.
      expect(ledger.stampFor('game-1', 9_999)).toBe(1_000);
    });

    it('stamps each game independently', () => {
      const ledger = new StartedAtLedger();
      expect(ledger.stampFor('game-1', 100)).toBe(100);
      expect(ledger.stampFor('game-2', 200)).toBe(200);
      expect(ledger.stampFor('game-1', 300)).toBe(100);
    });

    it('ADOPTS the archive\'s dates, so a returned-to game is re-persisted with its ORIGINAL date', async () => {
      const { db } = await open();
      await saveGame(db, SAMPLE_UUID, sampleGame(), { ...sampleMeta, startedAt: 111 });

      const ledger = new StartedAtLedger();
      ledger.adopt(await archivedStartedAts(db));

      // A much later clock: the return is happening long after the game started, and the stamp must be
      // the archive's, not `now` (the concrete bug this prevents).
      expect(ledger.stampFor(SAMPLE_UUID, 9_000_000)).toBe(111);
      // A game the archive knows nothing about is still minted from the clock.
      expect(ledger.stampFor('a-brand-new-game', 9_000_000)).toBe(9_000_000);
    });

    it('does NOT let a later adopt overwrite a stamp it already established', () => {
      // Ordering guarantee: the stamp a writer already used for its live game stays the record's date
      // even if a later adopt reads a different value for it (e.g. another writer's copy).
      const ledger = new StartedAtLedger();
      expect(ledger.stampFor('game-1', 500)).toBe(500);
      ledger.adopt(new Map([['game-1', 999]]));
      expect(ledger.stampFor('game-1', 1_000)).toBe(500);
    });

    it('adopting an EMPTY map establishes nothing (negative case)', () => {
      const ledger = new StartedAtLedger();
      ledger.adopt(new Map());
      expect(ledger.stampFor('game-1', 42)).toBe(42);
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
