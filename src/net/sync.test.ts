import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { Game } from '../core/game';
import { emptyLog, append, headHash, type EventLog } from '../core/eventLog';
import { openDatabase } from '../persist/db';
import { loadConflicted } from '../persist/archive';
import { MockRelayHub, MockTransport } from './transport';
import {
  decideSync,
  decideUndo,
  toSyncMessage,
  parseSyncMessage,
  SYNC_VERSION,
  SyncEngine,
  SyncError,
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

  it('rejects a non-object / malformed message with a typed SyncError', () => {
    expect(() => parseSyncMessage(null as unknown as SyncMessage)).toThrow(SyncError);
    expect(() => parseSyncMessage(null as unknown as SyncMessage)).toThrow(
      /must be an object/,
    );
    expect(() => parseSyncMessage(42 as unknown as SyncMessage)).toThrow(SyncError);
    expect(() => parseSyncMessage(42 as unknown as SyncMessage)).toThrow(
      /must be an object/,
    );
  });

  it('rejects a message whose `log` is missing (undefined) — not iterable, must be an array', () => {
    // A SyncError with the array-of-events message, NOT a generic TypeError from
    // the downstream `for (const event of msg.log)` iteration. This pins the
    // defensive `!Array.isArray(msg.log)` guard so it cannot be silently deleted.
    const badMsg = { version: SYNC_VERSION, headHash: 'x' } as unknown as SyncMessage;
    expect(() => parseSyncMessage(badMsg)).toThrow(SyncError);
    expect(() => parseSyncMessage(badMsg)).toThrow(/array of events/);
  });

  it('rejects a message whose `log` is a non-array truthy value (string / object)', () => {
    // A STRING log is truthy and iterable, so WITHOUT the guard it would silently
    // iterate characters into append() and fail later with a misleading headHash
    // mismatch. The guard must reject it up front as a malformed shape.
    const stringLog = {
      version: SYNC_VERSION,
      headHash: 'x',
      log: 'not-an-array',
    } as unknown as SyncMessage;
    expect(() => parseSyncMessage(stringLog)).toThrow(SyncError);
    expect(() => parseSyncMessage(stringLog)).toThrow(/array of events/);

    // A plain object is truthy but NOT an array — likewise rejected up front.
    const objLog = {
      version: SYNC_VERSION,
      headHash: 'x',
      log: { 0: { type: 'place', node: '0,0,0' } },
    } as unknown as SyncMessage;
    expect(() => parseSyncMessage(objLog)).toThrow(SyncError);
    expect(() => parseSyncMessage(objLog)).toThrow(/array of events/);
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
    const a = new SyncEngine(new Game(size), ta, db, () => meta, 'white');
    const b = new SyncEngine(new Game(size), tb, db, () => meta, 'black');
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
    const eng = new SyncEngine(new Game(9), t, db, () => meta, 'white');
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
    const ea = new SyncEngine(new Game(9), ta, db, () => meta, 'white');
    const eb = new SyncEngine(new Game(9), tb, db, () => meta, 'black');
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
    const ea = new SyncEngine(new Game(9), ta, db, () => meta, 'white');
    const eb = new SyncEngine(new Game(9), tb, db, () => meta, 'black');
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

  it('freezes the state-mutating receive() once stopped: a strict-extension (adopt-shaped) message is dropped, not adopted', async () => {
    const hub = new MockRelayHub();
    const ta = new MockTransport(hub, 'pa3');
    const tb = new MockTransport(hub, 'pb3');
    const ea = new SyncEngine(new Game(9), ta, db, () => meta, 'white');
    const eb = new SyncEngine(new Game(9), tb, db, () => meta, 'black');
    // Fork B onto history [3,3,3]; A forks onto [0,0,0] → conflict stops B.
    ea.placeLocalOnly([0, 0, 0]);
    eb.placeLocalOnly([3, 3, 3]);
    await ea.connect('freeze-room');
    await eb.connect('freeze-room');
    ea.publishState();
    expect(eb.status().kind).toBe('conflict');

    const frozenHead = headHash(eb.game().log);
    const frozenPly = eb.game().ply();
    expect(frozenPly).toBe(1); // B is stopped on its own 1-move fork.

    // Craft a STRICT EXTENSION of B's frozen log ([3,3,3] followed by another move).
    // If receive() were NOT guarded, decideSync would return `adopt` and REPLACE B's
    // game with this longer log — mutating the supposedly-frozen game. Deliver it
    // straight through the PUBLIC receive() seam (the transport pump routes here too).
    const strictExtension = logOf('3,3,3', '4,4,4');
    // Sanity: this really is an adopt-shaped message for B's current log (proves the
    // negative test would fail the guard — not a message decideSync would ignore).
    expect(decideSync(eb.game().log, strictExtension)).toEqual({ action: 'adopt' });
    eb.receive(toSyncMessage(strictExtension));

    // The stopped game did NOT move forward: head and ply are unchanged.
    expect(eb.status().kind).toBe('conflict');
    expect(headHash(eb.game().log)).toBe(frozenHead);
    expect(eb.game().ply()).toBe(frozenPly);
    expect(eb.game().state().pieces['4,4,4']).toBeUndefined();
  });
});

describe('decideUndo — pure restricted-undo permission', () => {
  /** A fresh game whose last committed move was played by `lastMover`. */
  function gameAfter(...moves: [number, number, number][]): Game {
    const g = new Game(9);
    for (const m of moves) g.place(m);
    return g;
  }

  it('PERMITS undo when the last move was the caller’s own (white after one move)', () => {
    // One place: white moved, turn is now black, so the last mover was white.
    const g = gameAfter([0, 0, 0]);
    expect(decideUndo(g.state(), g.ply(), 'white')).toEqual({ ok: true });
  });

  it('PERMITS undo when the last move was the caller’s own (black after two moves)', () => {
    // Two places: white then black; turn is white; last mover was black.
    const g = gameAfter([0, 0, 0], [1, 1, 1]);
    expect(decideUndo(g.state(), g.ply(), 'black')).toEqual({ ok: true });
  });

  it('REFUSES undo of the opponent’s move (black cannot undo white’s move)', () => {
    // Last mover was white; black is NOT allowed to undo it.
    const g = gameAfter([0, 0, 0]);
    expect(decideUndo(g.state(), g.ply(), 'black')).toEqual({
      ok: false,
      reason: 'not-your-move',
    });
  });

  it('REFUSES undo of the opponent’s move (white cannot undo black’s move)', () => {
    const g = gameAfter([0, 0, 0], [1, 1, 1]);
    expect(decideUndo(g.state(), g.ply(), 'white')).toEqual({
      ok: false,
      reason: 'not-your-move',
    });
  });

  it('REFUSES undo when there is nothing to undo (ply 0)', () => {
    const g = gameAfter();
    expect(decideUndo(g.state(), g.ply(), 'white')).toEqual({
      ok: false,
      reason: 'nothing-to-undo',
    });
    expect(decideUndo(g.state(), g.ply(), 'black')).toEqual({
      ok: false,
      reason: 'nothing-to-undo',
    });
  });

  it('PERMITS the mover to undo even a winning move (last mover owns it)', () => {
    // Build a white 5-in-a-row along x; white's 5th place wins. Turn does NOT
    // flip on a win, so state.turn stays 'white' AND the last mover was white.
    const g = new Game(9);
    g.place([0, 0, 0]); // white
    g.place([0, 1, 0]); // black
    g.place([1, 0, 0]); // white
    g.place([1, 1, 0]); // black
    g.place([2, 0, 0]); // white
    g.place([2, 1, 0]); // black
    g.place([3, 0, 0]); // white
    g.place([3, 1, 0]); // black
    g.place([4, 0, 0]); // white — 5 in a row, WIN
    expect(g.state().winner).toBe('white');
    // The winner (white) placed the last move, so white may undo it.
    expect(decideUndo(g.state(), g.ply(), 'white')).toEqual({ ok: true });
    // Black may NOT undo white's winning move.
    expect(decideUndo(g.state(), g.ply(), 'black')).toEqual({
      ok: false,
      reason: 'not-your-move',
    });
  });
});

describe('SyncEngine — restricted networked undo (Task 3.4)', () => {
  let db: IDBDatabase;
  const meta = { players: { white: 'w', black: 'b' }, startedAt: 3000 };

  beforeEach(async () => {
    db = await openDatabase(`undo-test-${Math.random().toString(36).slice(2)}`);
  });

  async function pair(size = 9): Promise<{ a: SyncEngine; b: SyncEngine }> {
    const hub = new MockRelayHub();
    const ta = new MockTransport(hub, 'undo-a');
    const tb = new MockTransport(hub, 'undo-b');
    const a = new SyncEngine(new Game(size), ta, db, () => meta, 'white');
    const b = new SyncEngine(new Game(size), tb, db, () => meta, 'black');
    await a.connect('undo-room');
    await b.connect('undo-room');
    return { a, b };
  }

  it('lets a player undo its OWN last move and syncs the step-back to the peer', async () => {
    const { a, b } = await pair();
    a.place([0, 0, 0]); // white's move, mirrored to B
    expect(b.game().state().pieces['0,0,0']).toBe('white');

    // White undoes its own last move; the undo event syncs to B.
    a.undo();

    // A stepped back locally: the piece is gone.
    expect(a.game().state().pieces['0,0,0']).toBeUndefined();
    expect(a.game().ply()).toBe(0);
    // B ADOPTED the longer log (which now carries the undo event) and folded it,
    // so B stepped back too — proof by the peer's derived STATE, not a log line.
    expect(b.game().state().pieces['0,0,0']).toBeUndefined();
    expect(b.game().ply()).toBe(0);
    expect(headHash(a.game().log)).toBe(headHash(b.game().log));
    // The undo really is an appended event (log grew), not a truncation.
    expect(a.game().log.entries.length).toBe(2);
    expect(a.game().log.entries[1]!.event).toEqual({ type: 'undo' });
  });

  it('REFUSES an illegal undo of the opponent’s move locally (no event, no publish)', async () => {
    const { a, b } = await pair();
    a.place([0, 0, 0]); // white moved; last mover is white
    // B (black) tries to undo white's move — refused locally.
    expect(() => b.undo()).toThrow(SyncError);
    expect(() => b.undo()).toThrow(/not-your-move|own last move/i);
    // Nothing changed: B did not append an undo, the piece is still there on both.
    expect(b.game().state().pieces['0,0,0']).toBe('white');
    expect(a.game().state().pieces['0,0,0']).toBe('white');
    expect(b.game().log.entries.length).toBe(1); // just the place, no undo
    expect(a.game().log.entries.length).toBe(1);
    expect(headHash(a.game().log)).toBe(headHash(b.game().log));
  });

  it('REFUSES undo when there is nothing to undo (empty game)', async () => {
    const { a } = await pair();
    expect(() => a.undo()).toThrow(SyncError);
    expect(() => a.undo()).toThrow(/nothing-to-undo|nothing to undo/i);
    expect(a.game().ply()).toBe(0);
    expect(a.game().log.entries.length).toBe(0);
  });

  it('after white undoes, black can then undo its now-last move (turn ownership follows the log)', async () => {
    const { a, b } = await pair();
    a.place([0, 0, 0]); // white
    b.place([1, 1, 1]); // black
    // Last mover is black. White may NOT undo black's move.
    expect(() => a.undo()).toThrow(/not-your-move/i);
    // Black undoes its own move (syncs to A).
    b.undo();
    expect(a.game().state().pieces['1,1,1']).toBeUndefined();
    expect(b.game().state().pieces['1,1,1']).toBeUndefined();
    // Now the last mover is white again; white may undo, black may not.
    expect(() => b.undo()).toThrow(/not-your-move/i);
    a.undo();
    expect(a.game().ply()).toBe(0);
    expect(b.game().ply()).toBe(0);
    expect(headHash(a.game().log)).toBe(headHash(b.game().log));
  });

  it('refuses undo once the game is stopped by a conflict', async () => {
    const hub = new MockRelayHub();
    const ta = new MockTransport(hub, 'uc-a');
    const tb = new MockTransport(hub, 'uc-b');
    const ea = new SyncEngine(new Game(9), ta, db, () => meta, 'white');
    const eb = new SyncEngine(new Game(9), tb, db, () => meta, 'black');
    ea.placeLocalOnly([0, 0, 0]);
    eb.placeLocalOnly([2, 2, 2]);
    await ea.connect('undo-conflict');
    await eb.connect('undo-conflict');
    ea.publishState();
    expect(eb.status().kind).toBe('conflict');
    // Even though eb's own last move (black? no — its fork's last mover) might
    // otherwise be undoable, a stopped game refuses undo outright.
    expect(() => eb.undo()).toThrow(/conflict|stopped/i);
  });
});
