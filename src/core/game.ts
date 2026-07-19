/**
 * `Game` — folds the event log into game states, with undo/redo and a snapshot
 * cache.
 *
 * The canonical source of truth is an **append-only event log** of `place` /
 * `undo` / `redo` events (game-core design, Part 3; GLOSSARY "Event log").
 * `Game` wraps an `EventLog` and derives the current `GameState` by folding that
 * log. undo/redo are *events*, never truncation — the log only ever grows; a
 * cursor over the sequence of committed placements tracks how far into that
 * sequence the current state sits.
 *
 * **Fold model.** Folding maintains two things:
 *   - `snapshots` — the `GameState` after each committed placement, indexed by
 *     ply (ply 0 is the initial state; ply k is the state after k live pieces).
 *     This is the O(1) snapshot cache backing `stateAt(k)` for the local history
 *     slider (Stage 5), and every intermediate result is cached, so nothing is
 *     ever re-derived.
 *   - `cursor` — the current ply (0..snapshots.length-1). `undo` moves it back,
 *     `redo` moves it forward; the snapshots above the cursor are the redo tail.
 *
 * A `place` after an `undo` **discards the redo tail** (the classic branch cut):
 * the still-undone snapshots above the cursor are dropped before the new piece is
 * applied, so history diverges from the cursor forward. Because undo after a win
 * simply moves the cursor to a snapshot that was computed with full win logic, the
 * winner is *recomputed* for free — the snapshot at ply k already has the correct
 * `winner`/`winningLine` for exactly k pieces.
 *
 * Illegal actions (occupied/off-board/won `place`, `undo` with nothing to undo,
 * `redo` with nothing to redo) throw `IllegalMove` and leave the log untouched, so
 * the hash chain only ever records committed events.
 *
 * This is the pure rules layer: it builds on `eventLog`, `gameState`, and
 * `placePiece` only — no rendering, network, or DOM.
 */

import {
  append,
  emptyLog,
  type Event,
  type EventLog,
} from './eventLog';
import { initialState, IllegalMove, type GameState } from './gameState';
import { placePiece } from './placePiece';
import { coordsOf, keyOf, type Coord } from './coords';

export class Game {
  /** The append-only event log — the canonical, syncable source of truth. */
  private _log: EventLog;
  /**
   * Per-ply state cache: `_snapshots[k]` is the state after `k` committed
   * placements. `_snapshots[0]` is always the initial state. Entries above
   * `_cursor` are the redo tail (undone but not yet discarded).
   */
  private _snapshots: GameState[];
  /** The current ply: `_snapshots[_cursor]` is the live state. */
  private _cursor: number;

  constructor(size: number) {
    this._log = emptyLog();
    this._snapshots = [initialState(size)];
    this._cursor = 0;
  }

  /**
   * Reconstruct a `Game` by replaying an existing event log. The result has an
   * identical state, `headHash`, and ply to the game that produced `log` — the
   * fold is deterministic, so a log fully determines the game.
   */
  static fromLog(size: number, log: EventLog): Game {
    const game = new Game(size);
    for (const entry of log.entries) {
      game.applyEvent(entry.event);
    }
    return game;
  }

  /** The current event log (append-only; syncs and persists as-is). */
  get log(): EventLog {
    return this._log;
  }

  /** The live game state (the snapshot at the current cursor). */
  state(): GameState {
    return this._snapshots[this._cursor]!;
  }

  /** The current ply — the number of committed placements now in effect. */
  ply(): number {
    return this._cursor;
  }

  /**
   * The derived state at ply `k`, in O(1) from the snapshot cache. Used by the
   * read-only local history slider (Stage 5). `k` is clamped into the valid
   * snapshot range `0..maxReachablePly`, so out-of-range indices never throw.
   */
  stateAt(k: number): GameState {
    const max = this._snapshots.length - 1;
    const clamped = k < 0 ? 0 : k > max ? max : k;
    return this._snapshots[clamped]!;
  }

  /**
   * Place the current player's piece at `coords`, appending a `place` event.
   *
   * @throws {IllegalMove} if the move is illegal (occupied/off-board/won). The
   *   log is left untouched so the hash chain only records committed events.
   */
  place(coords: Coord): void {
    this.applyEvent({ type: 'place', node: keyOf(coords) });
  }

  /**
   * Undo the most recent committed placement (a real, synced game action).
   *
   * @throws {IllegalMove} if there is nothing to undo (already at ply 0).
   */
  undo(): void {
    this.applyEvent({ type: 'undo' });
  }

  /**
   * Redo a previously undone placement.
   *
   * @throws {IllegalMove} if there is nothing to redo (no undone tail remains).
   */
  redo(): void {
    this.applyEvent({ type: 'redo' });
  }

  /**
   * Fold a single event into the game, mutating the cache and cursor and — only
   * on success — extending the log. This is the one place the fold logic lives,
   * shared by the live methods and by `fromLog` replay so both stay identical.
   */
  private applyEvent(event: Event): void {
    switch (event.type) {
      case 'place': {
        const coords = coordsOf(event.node);
        // Placing computes the next snapshot from the *current* cursor state,
        // so any redo tail above the cursor is discarded by construction.
        const next = placePiece(this.state(), coords);
        this._snapshots.length = this._cursor + 1;
        this._snapshots.push(next);
        this._cursor += 1;
        break;
      }
      case 'undo': {
        if (this._cursor === 0) {
          throw new IllegalMove('nothing to undo');
        }
        this._cursor -= 1;
        break;
      }
      case 'redo': {
        if (this._cursor >= this._snapshots.length - 1) {
          throw new IllegalMove('nothing to redo');
        }
        this._cursor += 1;
        break;
      }
    }
    // Only reached when the event was legal — record it in the log.
    this._log = append(this._log, event);
  }
}
