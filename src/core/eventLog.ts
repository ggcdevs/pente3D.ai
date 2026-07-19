/**
 * The append-only event log and its hash chain.
 *
 * The canonical state of a game is an **append-only event log** of `place` /
 * `undo` / `redo` events; the `GameState` is derived by folding it (game-core
 * design, Part 3; GLOSSARY "Event log"). undo/redo are *events*, never
 * truncation — the log only ever grows. This same object is what the network
 * syncs and the archive stores.
 *
 * Each entry carries a cumulative `hash = H(prevHash + JSON(event))`; the last
 * entry's hash is the `headHash` that fingerprints the whole history. Because the
 * chain is deterministic, three sync questions become trivial:
 *   - "identical history?"     → compare `headHash` (O(1)).
 *   - "is mine a prefix of theirs?" → `isPrefix` (adopt strict extensions).
 *   - "where do we fork?"      → `firstDivergence`.
 *
 * This is the pure rules layer: no rendering, network, or DOM. It builds only on
 * `hash.ts`.
 */

import { hashStep } from './hash';
import type { NodeKey } from './coords';

/** Place the current player's piece at a node. */
export interface PlaceEvent {
  readonly type: 'place';
  readonly node: NodeKey;
}

/** Undo the most recent effective move (a real, synced game action — not the slider). */
export interface UndoEvent {
  readonly type: 'undo';
}

/** Redo a previously undone move. */
export interface RedoEvent {
  readonly type: 'redo';
}

/** A log event: the discriminated union folded into game state. */
export type Event = PlaceEvent | UndoEvent | RedoEvent;

/** One entry in the log: its event plus the cumulative chain hash up to and including it. */
export interface LogEntry {
  readonly event: Event;
  /** `H(prevHash + JSON(event))` — cumulative fingerprint through this entry. */
  readonly hash: string;
}

/** An append-only log of entries. Never mutated in place; `append` returns a new log. */
export interface EventLog {
  readonly entries: readonly LogEntry[];
}

/**
 * The seed of the hash chain: the fingerprint of the empty history.
 *
 * A fixed non-empty seed so that even a single-entry log's hash mixes a stable
 * prefix, and the empty log has a well-defined, deterministic `headHash`.
 */
const EMPTY_HASH = 'pente3d:genesis';

/** A fresh, empty log. */
export function emptyLog(): EventLog {
  return { entries: [] };
}

/**
 * The cumulative hash at the head of the log — the fingerprint of its entire
 * history. The empty log hashes to the fixed genesis seed.
 */
export function headHash(log: EventLog): string {
  const last = log.entries[log.entries.length - 1];
  return last === undefined ? EMPTY_HASH : last.hash;
}

/**
 * Append `event`, returning a **new** log (the input is never mutated).
 *
 * The new entry's hash extends the chain: `H(headHash(log) + JSON(event))`. Event
 * fields are serialized in a fixed order via `serializeEvent`, so the fingerprint
 * is stable regardless of object-key insertion order.
 */
export function append(log: EventLog, event: Event): EventLog {
  const hash = hashStep(headHash(log), serializeEvent(event));
  return { entries: [...log.entries, { event, hash }] };
}

/**
 * Canonical serialization of an event for hashing.
 *
 * Written explicitly (rather than `JSON.stringify(event)`) so the byte sequence
 * is fixed by this function and cannot silently change if the event object gains
 * incidental fields or a different key order.
 */
function serializeEvent(event: Event): string {
  switch (event.type) {
    case 'place':
      return `place:${event.node}`;
    case 'undo':
      return 'undo';
    case 'redo':
      return 'redo';
  }
}

/**
 * True iff log `a` is a prefix of log `b` — every entry of `a` matches the
 * entry at the same ply in `b`, and `a` is no longer than `b`.
 *
 * The hash chain makes this O(min length) and, critically, an entry-hash match
 * implies the *entire history up to that ply* matches (any earlier divergence
 * would have changed the cumulative hash). This is the core sync rule: adopt an
 * incoming log iff mine is a prefix of it (game-core design, Part 3).
 */
export function isPrefix(a: EventLog, b: EventLog): boolean {
  if (a.entries.length > b.entries.length) return false;
  for (let i = 0; i < a.entries.length; i++) {
    if (a.entries[i]!.hash !== b.entries[i]!.hash) return false;
  }
  return true;
}

/**
 * The ply index at which logs `a` and `b` first differ.
 *
 * Returns the length of their common prefix: if one log is a prefix of the other
 * (including identical logs), this is the shorter log's length. Uses the
 * cumulative entry hashes, so a match at ply `k` guarantees agreement on all of
 * `0..k`.
 */
export function firstDivergence(a: EventLog, b: EventLog): number {
  const max = Math.min(a.entries.length, b.entries.length);
  let i = 0;
  while (i < max && a.entries[i]!.hash === b.entries[i]!.hash) {
    i++;
  }
  return i;
}
