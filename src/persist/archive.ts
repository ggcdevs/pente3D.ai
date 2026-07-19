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
  type GameListing,
  type GameRecord,
} from './db';

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
  /** The two forked event logs, as plain events (game-core design "both forks"). */
  readonly forks: {
    readonly mine: StoredLog;
    readonly theirs: StoredLog;
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
 */
function gameFromStoredLog(id: string, size: number, log: readonly unknown[]): Game {
  const dump: GameExport = { size, settings: {}, log: log as readonly Event[] };
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
 * metadata. The `headHash` is derived from the game and stored in the metadata for
 * O(1) identity in the listing. Overwriting the same id is how autosave keeps the
 * archive current as a game grows.
 */
export async function saveGame(
  db: IDBDatabase,
  id: string,
  game: Game,
  meta: ArchivedMeta,
): Promise<void> {
  const record: GameRecord = {
    id,
    log: toPlainLog(game.log),
    meta: {
      players: meta.players,
      result: meta.result,
      startedAt: meta.startedAt,
      headHash: headHash(game.log),
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
  return gameFromStoredLog(id, size, record.log);
}

/**
 * List every archived game as `{ id, meta }` (no logs), sorted by `startedAt`
 * descending so the most recently started game is first — the natural order for an
 * archive browser (Stage 5).
 */
export async function listArchivedGames(db: IDBDatabase): Promise<GameListing[]> {
  const listings = await listGames(db);
  return listings.sort((a, b) => b.meta.startedAt - a.meta.startedAt);
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
    meta: {
      players: input.meta.players,
      result: 'conflicted',
      startedAt: input.meta.startedAt,
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
    mine: gameFromStoredLog(`${id} (mine)`, size, record.forks.mine),
    theirs: gameFromStoredLog(`${id} (theirs)`, size, record.forks.theirs),
  };
}
