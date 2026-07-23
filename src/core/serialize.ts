/**
 * Game export / import — the human-readable, replayable JSON form of a game.
 *
 * Per the game-core design (Part 3, "Export/import"): the canonical, portable form
 * of a game is its **append-only event log** plus `{ size, settings }`. State is
 * never serialized — it is *derived* by folding the log — so the export carries the
 * full undo/redo history and reconstructs a byte-for-byte identical `Game` (same
 * `headHash`). The node keys are the readable `"x,y,z"` strings, so a dump is
 * legible and hand-inspectable.
 *
 * Import is defensive by construction: any malformed payload (bad JSON, wrong
 * shape, unknown event, illegal move sequence) throws an {@link ExportError} with a
 * clear message and **never** yields a half-built or corrupt `Game`. The whole
 * validation runs before any game is returned.
 *
 * This is the pure rules layer: it builds only on `game`, `eventLog`, and
 * `coords` — no rendering, network, or DOM.
 */

import { Game } from './game';
import { emptyLog, append, type Event, type EventLog } from './eventLog';
import { coordsOf, inBounds, keyOf, type NodeKey } from './coords';
import { IllegalMove } from './gameState';
import { randomId } from '../util/randomId';

/**
 * Opaque, JSON-serializable game settings (board options, house rules, cosmetic
 * config) carried alongside the log. The core does not interpret these — it only
 * round-trips them faithfully — so the shape stays forward-compatible with
 * whatever the config/UI layers attach.
 */
export type GameSettings = Readonly<Record<string, unknown>>;

/**
 * The exported form of a game: its board size, opaque settings, and the event log
 * as a plain array of events (the hashes are recomputed on import from the events,
 * so they are not stored — the chain is derivable and self-verifying).
 */
export interface GameExport {
  /**
   * The game's stable identity (UUID), minted at genesis and part of the hashed
   * history. Threaded through export/import so a round-trip preserves identity —
   * and thus `headHash`. Optional in the *input* shape only for backward
   * compatibility: a legacy/local dump written before S.1 has no uuid, and
   * {@link importGame} mints a fresh one on load (those games were never
   * networked, so a fresh id is correct — design §2.2). {@link exportGame} always
   * writes it.
   */
  readonly uuid?: string;
  /** Board edge length `N` (the board is `N×N×N`). */
  readonly size: number;
  /** Opaque, round-tripped settings. */
  readonly settings: GameSettings;
  /** The append-only event log as plain events, in order. */
  readonly log: readonly Event[];
}

/** Thrown when an import payload is malformed, corrupt, or describes an illegal game. */
export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportError';
  }
}

/**
 * Export a game to its plain `{ size, settings, log }` object.
 *
 * @param game The game to export.
 * @param settings Optional opaque settings to carry alongside the log.
 */
export function exportGame(game: Game, settings: GameSettings = {}): GameExport {
  return {
    uuid: game.uuid,
    size: game.state().size,
    settings,
    log: game.log.entries.map((entry) => entry.event),
  };
}

/** Export a game to a human-readable (pretty-printed) JSON string. */
export function serializeGame(game: Game, settings: GameSettings = {}): string {
  return JSON.stringify(exportGame(game, settings), null, 2);
}

/**
 * Reconstruct a `Game` from an exported object. The result is identical to the
 * game that produced it — same `headHash`, state, and ply — because a log fully
 * determines the game (the fold is deterministic).
 *
 * @throws {ExportError} if the payload is not a valid export or its log describes
 *   an illegal game. On any failure nothing is returned — never a broken `Game`.
 */
export function importGame(dump: GameExport): Game {
  const size = validateSize(dump);
  const uuid = validateUuid(dump);
  const events = validateLog(dump);
  // Rebuild the log entry-by-entry so the hash chain is recomputed from the
  // canonical events, seeded by the game's uuid, then fold it — the fold
  // re-validates every move. Seeding with the *exported* uuid is what preserves
  // headHash across a round-trip (the uuid is part of the genesis hash).
  let log: EventLog = emptyLog(uuid);
  for (const event of events) {
    log = append(log, event);
  }
  try {
    return Game.fromLog(size, log);
  } catch (e) {
    if (e instanceof IllegalMove) {
      throw new ExportError(`log describes an illegal game: ${e.message}`);
    }
    throw e;
  }
}

/**
 * Parse a JSON string and reconstruct a `Game`.
 *
 * @throws {ExportError} on malformed JSON or an invalid/illegal payload.
 */
export function deserializeGame(json: string): Game {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new ExportError(
      `invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return importGame(parsed as GameExport);
}

/**
 * Extract the game uuid, lazily minting one when the dump has none.
 *
 * A present uuid must be a **non-empty string** (an empty or non-string uuid is a
 * corrupt payload, not a legacy one — reject it rather than silently mint over it,
 * which would mask corruption). An *absent* uuid is the legacy/local case: those
 * games predate S.1 and were never networked, so a fresh id is correct
 * (design §2.2). The whole payload must be an object first — {@link validateSize}
 * already guarantees that when this runs.
 */
function validateUuid(dump: GameExport): string {
  const uuid = (dump as { uuid?: unknown }).uuid;
  if (uuid === undefined) {
    return randomId();
  }
  if (typeof uuid !== 'string' || uuid.length === 0) {
    throw new ExportError(
      `invalid uuid: expected a non-empty string, got ${String(uuid)}`,
    );
  }
  return uuid;
}

/** Validate and extract the board size; the whole payload must be an object first. */
function validateSize(dump: GameExport): number {
  if (typeof dump !== 'object' || dump === null) {
    throw new ExportError('export must be an object');
  }
  const size = (dump as { size?: unknown }).size;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1) {
    throw new ExportError(`invalid size: expected a positive integer, got ${String(size)}`);
  }
  return size;
}

/** Validate the log array and every event within it, returning the typed events. */
function validateLog(dump: GameExport): Event[] {
  const rawLog = (dump as { log?: unknown }).log;
  if (!Array.isArray(rawLog)) {
    throw new ExportError('invalid log: expected an array of events');
  }
  return rawLog.map((raw, i) => validateEvent(raw, i, (dump as { size: number }).size));
}

/** Validate one event; a `place` event's node key must parse to an in-bounds coord. */
function validateEvent(raw: unknown, index: number, size: number): Event {
  if (typeof raw !== 'object' || raw === null) {
    throw new ExportError(`invalid event at index ${index}: not an object`);
  }
  const type = (raw as { type?: unknown }).type;
  switch (type) {
    case 'place': {
      const node = (raw as { node?: unknown }).node;
      if (typeof node !== 'string') {
        throw new ExportError(`invalid place event at index ${index}: node must be a string`);
      }
      assertValidNodeKey(node, index, size);
      return { type: 'place', node };
    }
    case 'undo':
      return { type: 'undo' };
    case 'redo':
      return { type: 'redo' };
    default:
      throw new ExportError(`unknown event type at index ${index}: ${String(type)}`);
  }
}

/** A node key must be exactly three integers, in bounds, and re-serialize to itself. */
function assertValidNodeKey(node: NodeKey, index: number, size: number): void {
  const parts = node.split(',');
  if (parts.length !== 3) {
    throw new ExportError(`invalid node key at index ${index}: "${node}"`);
  }
  const coord = coordsOf(node);
  const allInts = coord.every((c) => Number.isInteger(c));
  // Round-trip guard: rejects "01", "1.0", " 1", NaN, etc. — anything non-canonical.
  if (!allInts || keyOf(coord) !== node || !inBounds(coord, size)) {
    throw new ExportError(`invalid node key at index ${index}: "${node}"`);
  }
}
