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

/**
 * An append-only log of entries. Never mutated in place; `append` returns a new log.
 *
 * The log carries the **game UUID** minted at genesis (S.1). The uuid is folded
 * into the chain seed ({@link genesisHash}) so it participates in the hash chain:
 * two logs with different uuids have different `headHash`es even when both are
 * empty, and `headHash` equality therefore implies *same game identity AND same
 * history* — the property the networked resume model relies on ("same UUID but
 * divergent headHash" = a genuine conflict, distinct from "two different games").
 */
export interface EventLog {
  /** The game's stable identity, minted at genesis and folded into the chain seed. */
  readonly uuid: string;
  readonly entries: readonly LogEntry[];
}

/**
 * The seed of the hash chain for a game: the fingerprint of its empty history.
 *
 * A fixed prefix mixed with the game `uuid`, so (a) even a single-entry log's hash
 * mixes a stable, uuid-bearing prefix, (b) the empty log has a well-defined,
 * deterministic `headHash`, and (c) two distinct games — even both empty — have
 * distinct `headHash`es. The `hashStep` delimiter guarantees the prefix/uuid
 * boundary cannot shift to collide with a different split.
 */
export function genesisHash(uuid: string): string {
  return hashStep('pente3d:genesis', uuid);
}

/**
 * A fresh, empty log carrying the game `uuid`. The uuid is required — it is minted
 * once at genesis (by the {@link Game} constructor) and threaded through here so it
 * is part of the hashed history from the very first entry.
 */
export function emptyLog(uuid: string): EventLog {
  return { uuid, entries: [] };
}

/**
 * The cumulative hash at the head of the log — the fingerprint of its entire
 * history. The empty log hashes to the uuid-seeded genesis hash.
 */
export function headHash(log: EventLog): string {
  const last = log.entries[log.entries.length - 1];
  return last === undefined ? genesisHash(log.uuid) : last.hash;
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
  return { uuid: log.uuid, entries: [...log.entries, { event, hash }] };
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
  // NB: this compares HISTORIES (entry hashes), not game IDENTITY. It deliberately
  // does NOT gate on `a.uuid === b.uuid`: an empty log (no entries) is a prefix of
  // any log, which is what lets a peer that brought no game ADOPT an incoming one
  // (the move-sync "empty adopts anything" rule the join flow relies on). Two
  // NON-empty logs of different games still fail here anyway, because the
  // uuid-seeded genesis (S.1) makes their very first entry hashes differ — so a
  // genuine fork is caught at ply 0 regardless. Same-uuid/divergent-history
  // detection (the S.1 identity check) lives at the ADMISSION layer (compare
  // uuid + headHash), NOT in this low-level move-sync primitive.
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
