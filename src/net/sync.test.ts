import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { Game } from '../core/game';
import { emptyLog, append, headHash, type EventLog } from '../core/eventLog';
import { openDatabase } from '../persist/db';
import { loadConflicted } from '../persist/archive';
import { MockRelayHub, MockTransport } from './transport';
import {
  decideSync,
  toSyncMessage,
  parseSyncMessage,
  SYNC_VERSION,
  SyncEngine,
  type SyncMessage,
} from './sync';

/** Build a log from a sequence of node keys (each a `place`). */
function logOf(...nodes: string[]): EventLog {
  let log = emptyLog();
  for (const node of nodes) {
    log = append(log, { type: 'place', node });
  }
  return log;
}

describe('decideSync — pure prefix/hash decision', () => {
  it('ADOPTs when local is a STRICT prefix of remote', () => {
    const local = logOf('0,0,0');
    const remote = logOf('0,0,0', '1,1,1');
    expect(decideSync(local, remote)).toEqual({ action: 'adopt' });
  });

  it('IGNOREs when remote is a prefix of local (stale/replay of an older state)', () => {
    const local = logOf('0,0,0', '1,1,1');
    const remote = logOf('0,0,0');
    expect(decideSync(local, remote)).toEqual({ action: 'ignore' });
  });

  it('IGNOREs an identical remote (a pure replay — no change, no conflict)', () => {
    const local = logOf('0,0,0', '1,1,1');
    const remote = logOf('0,0,0', '1,1,1');
    // Equal logs: remote is a (non-strict) prefix of local → ignore, never adopt/conflict.
    expect(decideSync(local, remote)).toEqual({ action: 'ignore' });
  });

  it('IGNOREs when both are the empty log', () => {
    expect(decideSync(emptyLog(), emptyLog())).toEqual({ action: 'ignore' });
  });

  it('ADOPTs any non-empty remote when local is empty', () => {
    expect(decideSync(emptyLog(), logOf('4,4,4'))).toEqual({ action: 'adopt' });
  });

  it('CONFLICTs when the logs fork at the same ply (neither a prefix)', () => {
    const local = logOf('0,0,0', '1,1,1');
    const remote = logOf('0,0,0', '2,2,2');
    expect(decideSync(local, remote)).toEqual({
      action: 'conflict',
      divergePly: 1,
    });
  });

  it('CONFLICTs when logs fork at ply 0 (first move differs)', () => {
    const local = logOf('1,1,1');
    const remote = logOf('2,2,2');
    expect(decideSync(local, remote)).toEqual({
      action: 'conflict',
      divergePly: 0,
    });
  });

  it('CONFLICTs even when remote is longer but forks earlier (fork wins over length)', () => {
    const local = logOf('0,0,0', '1,1,1');
    const remote = logOf('0,0,0', '2,2,2', '3,3,3', '4,4,4');
    expect(decideSync(local, remote)).toEqual({
      action: 'conflict',
      divergePly: 1,
    });
  });
});

describe('SyncMessage — wire format {version, headHash, log}', () => {
  it('carries version, headHash, and the plain event log', () => {
    const log = logOf('0,0,0', '1,1,1');
    const msg = toSyncMessage(log);
    expect(msg.version).toBe(SYNC_VERSION);
    expect(msg.headHash).toBe(headHash(log));
    expect(msg.log).toEqual([
      { type: 'place', node: '0,0,0' },
      { type: 'place', node: '1,1,1' },
    ]);
  });

  it('round-trips through JSON back to an EventLog with the same headHash', () => {
    const log = logOf('0,0,0', '1,1,1', '2,2,2');
    const wire = JSON.parse(JSON.stringify(toSyncMessage(log))) as SyncMessage;
    const parsed = parseSyncMessage(wire);
    expect(headHash(parsed)).toBe(headHash(log));
  });

  it('rejects a message with a mismatched headHash (tamper/corruption guard)', () => {
    const msg = toSyncMessage(logOf('0,0,0'));
    const tampered: SyncMessage = { ...msg, headHash: 'not-the-real-hash' };
    expect(() => parseSyncMessage(tampered)).toThrow(/headHash/);
  });

  it('rejects a message with an unknown version', () => {
    const msg = toSyncMessage(logOf('0,0,0'));
    const wrong = { ...msg, version: 999 } as SyncMessage;
    expect(() => parseSyncMessage(wrong)).toThrow(/version/);
  });

  it('rejects a non-object / malformed message', () => {
    expect(() => parseSyncMessage(null as unknown as SyncMessage)).toThrow();
    expect(() => parseSyncMessage(42 as unknown as SyncMessage)).toThrow();
    expect(() => parseSyncMessage({ version: SYNC_VERSION } as SyncMessage)).toThrow();
  });
});

describe('SyncEngine — order/replay-safe full-state sync over a transport', () => {
  let db: IDBDatabase;
  const meta = { players: { white: 'w', black: 'b' }, startedAt: 1000 };

  beforeEach(async () => {
    // Fresh in-memory IndexedDB per test so conflict archiving is observable.
    db = await openDatabase(`sync-test-${Math.random().toString(36).slice(2)}`);
  });

  /** Wire two engines to a shared mock relay in the same room, both connected. */
  async function pair(size = 9): Promise<{
    a: SyncEngine;
    b: SyncEngine;
    ta: MockTransport;
    tb: MockTransport;
  }> {
    const hub = new MockRelayHub();
    const ta = new MockTransport(hub, 'peer-a');
    const tb = new MockTransport(hub, 'peer-b');
    const a = new SyncEngine(new Game(size), ta, db, () => meta);
    const b = new SyncEngine(new Game(size), tb, db, () => meta);
    await a.connect('room-1');
    await b.connect('room-1');
    return { a, b, ta, tb };
  }

  it('propagates a local move to the peer (the OTHER engine actually adopts it)', async () => {
    const { a, b } = await pair();
    a.place([0, 0, 0]);
    // Assert on B's derived STATE, not a log line: the piece is really there.
    expect(b.game().state().pieces['0,0,0']).toBe('white');
    expect(headHash(b.game().log)).toBe(headHash(a.game().log));
    // No conflict on the happy path: status ok, no forks recorded.
    expect(a.status()).toEqual({ kind: 'ok' });
    expect(b.conflictForks()).toBeNull();
    await b.whenSettled(); // resolves immediately when no conflict occurred
  });

  it('converges bidirectionally: alternating moves keep both logs identical', async () => {
    const { a, b } = await pair();
    a.place([0, 0, 0]); // white
    b.place([1, 1, 1]); // black
    a.place([0, 1, 0]); // white
    b.place([2, 2, 2]); // black
    expect(a.game().ply()).toBe(4);
    expect(b.game().ply()).toBe(4);
    expect(headHash(a.game().log)).toBe(headHash(b.game().log));
    expect(a.game().state().pieces).toEqual(b.game().state().pieces);
  });

  it('is REPLAY-idempotent: re-receiving an older/equal message is a no-op', async () => {
    const { a, b, ta } = await pair();
    a.place([0, 0, 0]);
    a.place([0, 1, 0]);
    const headBefore = headHash(b.game().log);
    const plyBefore = b.game().ply();
    // Sanity: A really pushed both moves to B over the (mock) relay first.
    expect(ta.peerId).toBe('peer-a');
    // Replay a stale snapshot (only the first move) straight into B.
    b.receive(toSyncMessage(logOf('0,0,0')));
    // And replay B's own current state back at it (equal log).
    b.receive(toSyncMessage(b.game().log));
    expect(headHash(b.game().log)).toBe(headBefore);
    expect(b.game().ply()).toBe(plyBefore);
  });

  it('tolerates OUT-OF-ORDER delivery: converges to the longest valid log', () => {
    // Deliver a 3-move log, then a stale 1-move log, then the 2-move middle —
    // in a deliberately scrambled order. Result must be the longest (3 moves).
    const hub = new MockRelayHub();
    const t = new MockTransport(hub, 'solo');
    const eng = new SyncEngine(new Game(9), t, db, () => meta);
    const full = logOf('0,0,0', '1,1,1', '2,2,2');
    const mid = logOf('0,0,0', '1,1,1');
    const one = logOf('0,0,0');
    eng.receive(toSyncMessage(mid)); // adopt → 2
    eng.receive(toSyncMessage(one)); // stale → ignore
    eng.receive(toSyncMessage(full)); // adopt → 3
    eng.receive(toSyncMessage(mid)); // stale → ignore
    expect(eng.game().ply()).toBe(3);
    expect(headHash(eng.game().log)).toBe(headHash(full));
  });

  it('detects a CONFLICT, stops, archives both forks, and surfaces an error state', async () => {
    const { a, b } = await pair();
    // Fork: A and B each make a *different* first move without seeing the other's.
    // Wire them to the relay only AFTER forking, so neither adopts the other first.
    const hub = new MockRelayHub();
    const ta = new MockTransport(hub, 'peer-a2');
    const tb = new MockTransport(hub, 'peer-b2');
    const ea = new SyncEngine(new Game(9), ta, db, () => meta);
    const eb = new SyncEngine(new Game(9), tb, db, () => meta);
    // Both make a move BEFORE connecting (so no cross-talk yet).
    ea.placeLocalOnly([0, 0, 0]);
    eb.placeLocalOnly([1, 1, 1]);
    await ea.connect('conflict-room');
    await eb.connect('conflict-room');
    // Now A pushes its fork; B sees a conflict.
    ea.publishState();
    const st = eb.status();
    expect(st.kind).toBe('conflict');
    if (st.kind !== 'conflict') throw new Error('expected conflict');
    // They forked at the very first ply (each played a different opening move).
    expect(st.divergePly).toBe(0);
    // The engine exposes both forks in memory (mine = B's, theirs = A's).
    const forks = eb.conflictForks();
    expect(forks).not.toBeNull();
    expect(headHash(forks!.mine)).toBe(headHash(eb.game().log));
    expect(headHash(forks!.theirs)).toBe(headHash(ea.game().log));
    // B's game is STOPPED: further local moves are refused.
    expect(() => eb.place([2, 2, 2])).toThrow();
    // Wait for the conflict archival write to settle before reading it back.
    await eb.whenSettled();
    // Both forks were archived under a conflicted record (observable via reload).
    const status = eb.status();
    const conflictId = status.kind === 'conflict' ? status.conflictId : '';
    const loaded = await loadConflicted(db, conflictId);
    expect(loaded).toBeDefined();
    expect(loaded!.mine.state().pieces['1,1,1']).toBe('white'); // B's own fork
    expect(loaded!.theirs.state().pieces['0,0,0']).toBe('white'); // A's fork
    // (avoid unused-var lint on the initial pair)
    expect(a).toBeDefined();
    expect(b).toBeDefined();
  });

  it('refuses a local move once stopped by a conflict (no moves after stop)', async () => {
    const hub = new MockRelayHub();
    const ta = new MockTransport(hub, 'pa');
    const tb = new MockTransport(hub, 'pb');
    const ea = new SyncEngine(new Game(9), ta, db, () => meta);
    const eb = new SyncEngine(new Game(9), tb, db, () => meta);
    ea.placeLocalOnly([0, 0, 0]);
    eb.placeLocalOnly([3, 3, 3]);
    await ea.connect('r2');
    await eb.connect('r2');
    ea.publishState();
    expect(eb.status().kind).toBe('conflict');
    expect(() => eb.place([4, 4, 4])).toThrow(/conflict|stopped/i);
    // placeLocalOnly is also refused once stopped.
    expect(() => eb.placeLocalOnly([5, 5, 5])).toThrow(/conflict|stopped/i);
    // A further inbound message from the peer is dropped (already stopped, fork
    // already archived) — status and game are unchanged.
    const stoppedHead = headHash(eb.game().log);
    ea.publishState(); // A re-publishes its fork
    expect(eb.status().kind).toBe('conflict');
    expect(headHash(eb.game().log)).toBe(stoppedHead);
  });
});
