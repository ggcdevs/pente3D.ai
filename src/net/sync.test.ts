import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { Game } from '../core/game';
import { emptyLog, append, headHash, type EventLog } from '../core/eventLog';
import { openDatabase } from '../persist/db';
import { loadConflicted } from '../persist/archive';
import { MockRelayHub, MockTransport } from './transport';
import {
  decideSync,
  decideSyncEpoched,
  normalizeEpoch,
  decideUndo,
  toSyncMessage,
  parseSyncMessage,
  parseGameMessage,
  SYNC_VERSION,
  SyncEngine,
  SyncError,
  type SyncMessage,
  type GameMessage,
  type ProposalMessage,
  type ResponseMessage,
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

describe('decideSyncEpoched — epoch-aware fresh-game (N.2 in-place rematch) decision', () => {
  it('ADOPTs a HIGHER remote epoch outright — the peer reset first (even from a fresh empty log)', () => {
    // The peer did the in-place rematch: it is on epoch 1 with a FRESH empty log, we are still on
    // epoch 0 with the finished game. We must adopt its fresh generation despite the empty log NOT
    // being an extension of ours — the whole point of the epoch (design N.2 seamless reset).
    const finished = logOf('0,0,0', '1,1,1', '2,2,2');
    expect(decideSyncEpoched(0, finished, 1, emptyLog())).toEqual({ action: 'adopt' });
  });

  it('ADOPTs a higher remote epoch even when its log would otherwise CONFLICT within an epoch', () => {
    // Across generations there is no such thing as a fork — a higher epoch is simply the newer game.
    const local = logOf('0,0,0', '1,1,1');
    const remote = logOf('9,9,9'); // forks at ply 0 within an epoch, but it is a NEWER epoch
    expect(decideSyncEpoched(0, local, 1, remote)).toEqual({ action: 'adopt' });
  });

  it('IGNOREs a LOWER remote epoch — a late in-flight message from the just-finished game', () => {
    // We reset to epoch 1 (fresh empty log); a straggler full log from the finished epoch-0 game
    // arrives. If epoch were ignored, empty-is-a-prefix-of-full would ADOPT it and RESURRECT the old
    // board. The epoch guard IGNOREs it — the exact resurrection the seamless reset must prevent.
    const fresh = emptyLog();
    const staleFinished = logOf('0,0,0', '1,1,1', '2,2,2');
    expect(decideSyncEpoched(1, fresh, 0, staleFinished)).toEqual({ action: 'ignore' });
  });

  it('defers to the same-epoch prefix/hash decision WITHIN one epoch (adopt / ignore / conflict)', () => {
    const one = logOf('0,0,0');
    const two = logOf('0,0,0', '1,1,1');
    const fork = logOf('0,0,0', '2,2,2');
    // adopt a strict extension at the same epoch
    expect(decideSyncEpoched(2, one, 2, two)).toEqual({ action: 'adopt' });
    // ignore a stale prefix at the same epoch
    expect(decideSyncEpoched(2, two, 2, one)).toEqual({ action: 'ignore' });
    // a genuine fork at the SAME epoch is still a conflict (not masked by the epoch layer)
    expect(decideSyncEpoched(2, two, 2, fork)).toEqual({ action: 'conflict', divergePly: 1 });
  });
});

describe('normalizeEpoch — the single wire epoch read (codec + receive seam)', () => {
  it('passes a whole non-negative number through unchanged', () => {
    expect(normalizeEpoch(0)).toBe(0);
    expect(normalizeEpoch(4)).toBe(4);
  });

  it('FLOORS a fractional epoch to a whole generation', () => {
    expect(normalizeEpoch(2.9)).toBe(2);
  });

  it('reads a MISSING / non-numeric / non-finite / NEGATIVE epoch as generation 0', () => {
    expect(normalizeEpoch(undefined)).toBe(0);
    expect(normalizeEpoch(null)).toBe(0);
    expect(normalizeEpoch('3')).toBe(0);
    expect(normalizeEpoch(Number.NaN)).toBe(0);
    expect(normalizeEpoch(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalizeEpoch(-1)).toBe(0);
  });
});

describe('SyncMessage — wire format {version, headHash, log}', () => {
  it('carries the sync kind tag, version, headHash, and the plain event log', () => {
    const log = logOf('0,0,0', '1,1,1');
    const msg = toSyncMessage(log);
    expect(msg.kind).toBe('sync');
    expect(msg.version).toBe(SYNC_VERSION);
    expect(msg.headHash).toBe(headHash(log));
    expect(msg.log).toEqual([
      { type: 'place', node: '0,0,0' },
      { type: 'place', node: '1,1,1' },
    ]);
  });

  it('stamps the fresh-game epoch (default 0; the passed generation otherwise)', () => {
    const log = logOf('0,0,0');
    expect(toSyncMessage(log).epoch).toBe(0);
    expect(toSyncMessage(log, 3).epoch).toBe(3);
  });

  it('parseGameMessage reads the epoch, defaulting a MISSING/garbage/negative epoch to 0', () => {
    // An explicit epoch is preserved.
    const kinded = parseGameMessage({ ...toSyncMessage(logOf('0,0,0'), 5) });
    expect(kinded.kind === 'sync' && kinded.epoch).toBe(5);
    // A legacy (pre-epoch) sync message has NO epoch field → read as generation 0 (backward-compat).
    const legacy = parseGameMessage({ version: SYNC_VERSION, headHash: headHash(logOf('0,0,0')), log: [{ type: 'place', node: '0,0,0' }] });
    expect(legacy.kind === 'sync' && legacy.epoch).toBe(0);
    // A hostile negative epoch is clamped to 0 so it can never out-rank a live generation.
    const hostile = parseGameMessage({ kind: 'sync', version: SYNC_VERSION, epoch: -7, headHash: headHash(emptyLog()), log: [] });
    expect(hostile.kind === 'sync' && hostile.epoch).toBe(0);
    // A fractional epoch is floored (a whole generation count).
    const frac = parseGameMessage({ kind: 'sync', version: SYNC_VERSION, epoch: 2.9, headHash: headHash(emptyLog()), log: [] });
    expect(frac.kind === 'sync' && frac.epoch).toBe(2);
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

describe('parseGameMessage — discriminated-union envelope validation', () => {
  // A valid, kinded sync message straight off toSyncMessage.
  const syncMsg = toSyncMessage(logOf('0,0,0', '1,1,1'));

  describe('kind: sync', () => {
    it('parses a well-formed kinded sync message, preserving all fields', () => {
      const parsed: GameMessage = parseGameMessage(syncMsg);
      expect(parsed).toEqual(syncMsg);
      // Narrowed to sync: the payload is re-verifiable by parseSyncMessage.
      if (parsed.kind !== 'sync') throw new Error('expected sync');
      expect(headHash(parseSyncMessage(parsed))).toBe(syncMsg.headHash);
    });

    it('round-trips through JSON (the real wire path) unchanged', () => {
      const wire = JSON.parse(JSON.stringify(syncMsg)) as unknown;
      expect(parseGameMessage(wire)).toEqual(syncMsg);
    });

    it('rejects a kind:sync with a non-numeric version', () => {
      const bad = { kind: 'sync', version: '1', headHash: 'x', log: [] };
      expect(() => parseGameMessage(bad)).toThrow(SyncError);
      expect(() => parseGameMessage(bad)).toThrow(/numeric version/);
    });

    it('rejects a kind:sync with a non-string headHash', () => {
      const bad = { kind: 'sync', version: 1, headHash: 42, log: [] };
      expect(() => parseGameMessage(bad)).toThrow(SyncError);
      expect(() => parseGameMessage(bad)).toThrow(/string headHash/);
    });

    it('rejects a kind:sync with a non-array log', () => {
      const bad = { kind: 'sync', version: 1, headHash: 'x', log: 'nope' };
      expect(() => parseGameMessage(bad)).toThrow(SyncError);
      expect(() => parseGameMessage(bad)).toThrow(/array log/);
    });
  });

  describe('kind: proposal', () => {
    const proposal: ProposalMessage = {
      kind: 'proposal',
      id: 'p-123',
      action: 'rematch',
      proposedBy: 'white',
    };

    it('parses a well-formed proposal, preserving every field', () => {
      expect(parseGameMessage({ ...proposal })).toEqual(proposal);
    });

    it('treats action as an OPAQUE tag (any string, e.g. undo/redo/rematch)', () => {
      for (const action of ['rematch', 'undo', 'redo', 'anything-else']) {
        const parsed = parseGameMessage({ ...proposal, action });
        expect(parsed).toEqual({ ...proposal, action });
      }
    });

    it('accepts proposedBy of either seat colour', () => {
      expect(parseGameMessage({ ...proposal, proposedBy: 'black' })).toEqual({
        ...proposal,
        proposedBy: 'black',
      });
    });

    it('rejects a proposal missing its id (non-string)', () => {
      const bad = { kind: 'proposal', action: 'undo', proposedBy: 'white' };
      expect(() => parseGameMessage(bad)).toThrow(SyncError);
      expect(() => parseGameMessage(bad)).toThrow(/string id/);
    });

    it('rejects a proposal whose id is not a string (numeric)', () => {
      const bad = { kind: 'proposal', id: 7, action: 'undo', proposedBy: 'white' };
      expect(() => parseGameMessage(bad)).toThrow(/string id/);
    });

    it('rejects a proposal missing its action (non-string)', () => {
      const bad = { kind: 'proposal', id: 'p', proposedBy: 'white' };
      expect(() => parseGameMessage(bad)).toThrow(SyncError);
      expect(() => parseGameMessage(bad)).toThrow(/string action/);
    });

    it('rejects a proposal with an invalid proposedBy (not a seat colour)', () => {
      const bad = { kind: 'proposal', id: 'p', action: 'undo', proposedBy: 'green' };
      expect(() => parseGameMessage(bad)).toThrow(SyncError);
      expect(() => parseGameMessage(bad)).toThrow(/proposedBy/);
    });

    it('rejects a proposal with a missing proposedBy', () => {
      const bad = { kind: 'proposal', id: 'p', action: 'undo' };
      expect(() => parseGameMessage(bad)).toThrow(/proposedBy/);
    });
  });

  describe('kind: response', () => {
    const response: ResponseMessage = {
      kind: 'response',
      proposalId: 'p-123',
      accepted: true,
    };

    it('parses a well-formed accepting response', () => {
      expect(parseGameMessage({ ...response })).toEqual(response);
    });

    it('parses a declining response (accepted:false, not coerced away)', () => {
      const declined = { kind: 'response', proposalId: 'p-9', accepted: false };
      expect(parseGameMessage(declined)).toEqual(declined);
    });

    it('rejects a response missing its proposalId (non-string)', () => {
      const bad = { kind: 'response', accepted: true };
      expect(() => parseGameMessage(bad)).toThrow(SyncError);
      expect(() => parseGameMessage(bad)).toThrow(/string proposalId/);
    });

    it('rejects a response whose accepted is not a boolean', () => {
      const bad = { kind: 'response', proposalId: 'p', accepted: 'yes' };
      expect(() => parseGameMessage(bad)).toThrow(SyncError);
      expect(() => parseGameMessage(bad)).toThrow(/boolean accepted/);
    });
  });

  describe('malformed / unknown', () => {
    it('rejects a non-object payload (null / number / string)', () => {
      for (const bad of [null, 42, 'str', undefined, true]) {
        expect(() => parseGameMessage(bad)).toThrow(SyncError);
        expect(() => parseGameMessage(bad)).toThrow(/must be an object/);
      }
    });

    it('rejects an unknown kind, echoing the kind in the message', () => {
      const bad = { kind: 'chat', text: 'hi' };
      expect(() => parseGameMessage(bad)).toThrow(SyncError);
      expect(() => parseGameMessage(bad)).toThrow(/unknown game message kind: chat/);
    });

    it('rejects an object with a non-string kind that is present (not the legacy path)', () => {
      // kind is present but numeric — NOT the un-kinded legacy branch (kind === undefined),
      // so it falls through to the unknown-kind rejection, not silent acceptance.
      const bad = { kind: 5, version: 1, headHash: 'x', log: [] };
      expect(() => parseGameMessage(bad)).toThrow(/unknown game message kind: 5/);
    });
  });

  describe('backward-compat: un-kinded legacy sync message', () => {
    it('accepts an un-kinded sync-shaped message and tags it kind:sync', () => {
      // A pre-tagged-union peer publishes { version, headHash, log } with NO kind.
      // Rejecting it would break sync the instant one side upgrades, so it is
      // treated as a sync message (the added tag is the only difference).
      const legacy = {
        version: SYNC_VERSION,
        headHash: syncMsg.headHash,
        log: syncMsg.log,
      };
      const parsed = parseGameMessage(legacy);
      expect(parsed).toEqual(syncMsg); // now carries kind:'sync'
      if (parsed.kind !== 'sync') throw new Error('expected sync');
      // And its payload really re-verifies through the hash-chain check.
      expect(headHash(parseSyncMessage(parsed))).toBe(syncMsg.headHash);
    });

    it('rejects an un-kinded object that is NOT sync-shaped (missing headHash)', () => {
      // No kind AND not sync-shaped → not the legacy path; must be rejected as an
      // unknown message, never silently accepted.
      const bad = { version: 1, log: [] };
      expect(() => parseGameMessage(bad)).toThrow(SyncError);
      expect(() => parseGameMessage(bad)).toThrow(/unknown game message kind: undefined/);
    });

    it('rejects an un-kinded object with a non-array log (not sync-shaped)', () => {
      const bad = { version: 1, headHash: 'x', log: 'nope' };
      expect(() => parseGameMessage(bad)).toThrow(/unknown game message kind: undefined/);
    });

    it('rejects an empty object (no kind, not sync-shaped)', () => {
      expect(() => parseGameMessage({})).toThrow(/unknown game message kind: undefined/);
    });
  });

  describe('property: every well-formed message round-trips; every response accepted flag survives', () => {
    it('any proposal with a string id/action + valid seat parses back identically', () => {
      fc.assert(
        fc.property(
          fc.string(),
          fc.string(),
          fc.constantFrom<'white' | 'black'>('white', 'black'),
          (id, action, proposedBy) => {
            const msg = { kind: 'proposal' as const, id, action, proposedBy };
            const parsed = parseGameMessage(JSON.parse(JSON.stringify(msg)));
            expect(parsed).toEqual(msg);
          },
        ),
      );
    });

    it('any response preserves its proposalId and its exact accepted boolean', () => {
      fc.assert(
        fc.property(fc.string(), fc.boolean(), (proposalId, accepted) => {
          const msg = { kind: 'response' as const, proposalId, accepted };
          const parsed = parseGameMessage(JSON.parse(JSON.stringify(msg)));
          expect(parsed).toEqual(msg);
        }),
      );
    });

    it('a non-string action is always rejected (never coerced to a tag)', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.integer(), fc.boolean(), fc.constant(null)),
          (action) => {
            const bad = { kind: 'proposal', id: 'p', action, proposedBy: 'white' };
            expect(() => parseGameMessage(bad)).toThrow(/string action/);
          },
        ),
      );
    });
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

  // ── N.2 in-place rematch reset (resetGame) — seamless fresh game over the SAME transport ────────

  it('resetGame swaps in a FRESH game over the SAME transport and the PEER adopts the empty board', async () => {
    const { a, b } = await pair();
    // Play a real move so both boards are non-empty and at epoch 0.
    a.place([0, 0, 0]);
    expect(b.game().state().pieces['0,0,0']).toBe('white');
    expect(a.epoch()).toBe(0);

    // A resets IN PLACE (no disconnect): fresh empty game, colors alternate (white → black), epoch↑.
    a.resetGame(new Game(9), 'black');

    // A's OWN board is fresh + its generation advanced.
    expect(a.game().ply()).toBe(0);
    expect(a.game().state().pieces).toEqual({});
    expect(a.epoch()).toBe(1);
    // The PEER actually received the reset over the SAME live transport and adopted the fresh game
    // (proof-by-behavior on B's state, not a log line) — AND advanced its epoch to match.
    expect(b.game().ply()).toBe(0);
    expect(b.game().state().pieces).toEqual({});
    expect(b.epoch()).toBe(1);
    expect(headHash(a.game().log)).toBe(headHash(b.game().log));
  });

  it('resetGame IGNOREs a late in-flight message from the just-finished (lower-epoch) game — the board never resurrects', async () => {
    const hub = new MockRelayHub();
    const t = new MockTransport(hub, 'reset-solo');
    const eng = new SyncEngine(new Game(9), t, db, () => meta, 'white');
    await eng.connect('reset-room');
    eng.place([0, 0, 0]);
    eng.place([1, 1, 1]);
    const finished = eng.game().log; // the epoch-0 finished-game log

    // Rematch: reset in place → epoch 1, fresh empty board.
    eng.resetGame(new Game(9), 'black');
    expect(eng.game().ply()).toBe(0);
    expect(eng.epoch()).toBe(1);

    // A STRAGGLER full log from the finished epoch-0 game arrives (a real in-flight replay). Without
    // the epoch guard, empty-is-a-prefix-of-finished would ADOPT it and bring the old board BACK.
    eng.receive(toSyncMessage(finished, 0));

    // The fresh board is untouched — the finished game did NOT resurrect (the seamless-reset guard).
    expect(eng.game().ply()).toBe(0);
    expect(eng.game().state().pieces).toEqual({});
    expect(eng.epoch()).toBe(1);
  });

  it('after BOTH peers reset independently the fresh game CONVERGES and plays/syncs normally', async () => {
    const { a, b } = await pair();
    a.place([0, 0, 0]); // epoch 0 game
    // BOTH sides reset on the same accepted rematch (proposer + accepter). Independent resets
    // legitimately INFLATE the epoch (each adopts the other's bump), but the generations CONVERGE to
    // the same max and both boards are empty — the observable outcome the design requires.
    a.resetGame(new Game(9), 'black'); // A now black
    b.resetGame(new Game(9), 'white'); // B now white
    expect(a.epoch()).toBe(b.epoch()); // converged generation (order-independent max)
    expect(a.game().state().pieces).toEqual({});
    expect(b.game().state().pieces).toEqual({});

    // The fresh game plays over the SAME connection and stays in sync at the converged epoch.
    b.place([2, 2, 2]);
    expect(a.game().state().pieces['2,2,2']).toBe('white');
    a.place([3, 3, 3]);
    expect(b.game().state().pieces['3,3,3']).toBe('black');
    expect(headHash(a.game().log)).toBe(headHash(b.game().log));
  });

  it('resetGame re-bases the restricted-undo rule onto the SWAPPED color', async () => {
    const hub = new MockRelayHub();
    const t = new MockTransport(hub, 'undo-swap');
    // Start as white; play white then black so black is the last mover.
    const eng = new SyncEngine(new Game(9), t, db, () => meta, 'white');
    await eng.connect('undo-swap-room');
    // After the rematch this client is BLACK. Fresh game, black to... white opens. Make black the
    // last mover in the fresh game, then black (us) may undo its own move; white's move it may not.
    eng.resetGame(new Game(9), 'black');
    eng.place([0, 0, 0]); // white opens (fresh game, white first)
    // We are black; the last mover is white → our restricted undo must REFUSE (not our move).
    expect(() => eng.undo()).toThrow(/not-your-move/);
    eng.place([1, 1, 1]); // black replies (our move)
    // Now the last mover is black (us) → undo is permitted and steps the fresh game back.
    eng.undo();
    expect(eng.game().ply()).toBe(1);
  });

  // ── SyncEngine.redo — the APPLY half of #18 mutual-confirm redo (Task N.3.2) ─────────────────────
  // The permission gate (decideRedo — only the player whose undone move is re-applied may propose) is
  // enforced UPSTREAM in the session before it proposes; here we prove the engine's raw redo applies +
  // publishes so BOTH peers converge one step FORWARD, and that its error paths propagate honestly.

  it('redo re-applies a previously-undone move and PUBLISHES it — the peer adopts and BOTH converge forward', async () => {
    const { a, b } = await pair();
    a.place([0, 0, 0]); // white ply1 (crosses to B)
    a.undo(); // white undoes its own last move (a real synced undo — B adopts it, back to ply0)
    expect(a.game().ply()).toBe(0);
    expect(b.game().ply()).toBe(0);
    expect(a.game().canRedo()).toBe(true);
    // A REDOes: re-applies the undone white move + publishes. The peer must adopt the strict extension.
    a.redo();
    expect(a.game().ply()).toBe(1);
    // PROOF-BY-BEHAVIOR (#3): B actually stepped forward over the relay — the piece is really back on B.
    expect(b.game().ply()).toBe(1);
    expect(b.game().state().pieces['0,0,0']).toBe('white');
    // Both converge to an identical head (the redo event rode the same prefix/hash path as any move).
    expect(headHash(a.game().log)).toBe(headHash(b.game().log));
  });

  it('redo THROWS the core IllegalMove verbatim when there is no redo tail (the error is not masked)', async () => {
    const hub = new MockRelayHub();
    const t = new MockTransport(hub, 'redo-empty');
    const eng = new SyncEngine(new Game(9), t, db, () => meta, 'white');
    await eng.connect('redo-empty-room');
    eng.place([0, 0, 0]); // a committed move, but nothing undone → no redo tail
    // The core Game.redo throws IllegalMove('nothing to redo'); the engine propagates it verbatim
    // (an honest error, never a swallowed no-op that would silently diverge the peers).
    expect(() => eng.redo()).toThrow(/nothing to redo/);
    // The log was left untouched — the failed redo appended nothing (still just the one placement).
    expect(eng.game().ply()).toBe(1);
  });

  it('redo is REFUSED once the game is stopped by a conflict (a stopped game exchanges no traffic)', async () => {
    const hub = new MockRelayHub();
    const ta = new MockTransport(hub, 'rd-a');
    const tb = new MockTransport(hub, 'rd-b');
    const ea = new SyncEngine(new Game(9), ta, db, () => meta, 'white');
    const eb = new SyncEngine(new Game(9), tb, db, () => meta, 'black');
    ea.placeLocalOnly([0, 0, 0]);
    eb.placeLocalOnly([2, 2, 2]);
    await ea.connect('rd-room');
    await eb.connect('rd-room');
    ea.publishState();
    expect(eb.status().kind).toBe('conflict');
    // A stopped (conflicted) game refuses ALL further local actions, redo included (assertLive).
    expect(() => eb.redo()).toThrow(/conflict|stopped/i);
  });

  // ── SyncEngine.applyAgreedUndo — the APPLY half of #18 mutual-confirm undo (Task N.3.2) ──────────
  // Unlike the restricted `undo()` (last-mover-only — who may PROPOSE), the AGREED apply steps the last
  // move back UNCONDITIONALLY on BOTH clients once the handshake resolved to accepted. The responder's
  // seat is NOT the last mover's, so a restricted undo there would refuse and the boards would diverge —
  // this is exactly the case the agreed apply must handle.

  it('applyAgreedUndo steps the last move back EVEN WHEN it was the OPPONENT’s (the responder side)', async () => {
    const hub = new MockRelayHub();
    const t = new MockTransport(hub, 'agreed-undo');
    // This client is BLACK (the responder). White (the opponent) made the last move.
    const eng = new SyncEngine(new Game(9), t, db, () => meta, 'black');
    await eng.connect('agreed-undo-room');
    eng.receive(toSyncMessage(logOf('2,2,2'))); // adopt white's opening move (white is last mover)
    expect(eng.game().state().pieces['2,2,2']).toBe('white');
    expect(eng.game().ply()).toBe(1);
    // The RESTRICTED undo would REFUSE (not this black client's move) — proving the two paths differ.
    expect(() => eng.undo()).toThrow(/not-your-move/);
    // But the AGREED apply steps it back regardless of seat (mutual consent was already established).
    eng.applyAgreedUndo();
    expect(eng.game().ply()).toBe(0);
    expect(eng.game().state().pieces['2,2,2']).toBeUndefined();
  });

  it('applyAgreedUndo PUBLISHES so the peer adopts and BOTH converge one step back', async () => {
    const { a, b } = await pair();
    a.place([0, 0, 0]); // white ply1 (crosses to B)
    expect(b.game().ply()).toBe(1);
    // B (black — NOT the last mover) applies the AGREED undo of white's move: it must still step back
    // AND publish, so A adopts the strict extension and both converge to the empty board.
    b.applyAgreedUndo();
    expect(b.game().ply()).toBe(0);
    // PROOF-BY-BEHAVIOR (#3): A actually stepped back over the relay — the piece is gone on A too.
    expect(a.game().ply()).toBe(0);
    expect(a.game().state().pieces['0,0,0']).toBeUndefined();
    expect(headHash(a.game().log)).toBe(headHash(b.game().log));
  });

  it('applyAgreedUndo THROWS the core IllegalMove verbatim at ply 0 (nothing to undo; not masked)', async () => {
    const hub = new MockRelayHub();
    const t = new MockTransport(hub, 'agreed-empty');
    const eng = new SyncEngine(new Game(9), t, db, () => meta, 'white');
    await eng.connect('agreed-empty-room');
    // Nothing committed → the core Game.undo throws IllegalMove; the agreed apply propagates it verbatim
    // (an honest error, never a swallowed no-op that would silently diverge the peers).
    expect(() => eng.applyAgreedUndo()).toThrow(/nothing to undo|IllegalMove/i);
    expect(eng.game().ply()).toBe(0);
  });

  it('applyAgreedUndo is REFUSED once the game is stopped by a conflict (a stopped game exchanges no traffic)', async () => {
    const hub = new MockRelayHub();
    const ta = new MockTransport(hub, 'au-a');
    const tb = new MockTransport(hub, 'au-b');
    const ea = new SyncEngine(new Game(9), ta, db, () => meta, 'white');
    const eb = new SyncEngine(new Game(9), tb, db, () => meta, 'black');
    ea.placeLocalOnly([0, 0, 0]);
    eb.placeLocalOnly([2, 2, 2]);
    await ea.connect('au-room');
    await eb.connect('au-room');
    ea.publishState();
    expect(eb.status().kind).toBe('conflict');
    expect(() => eb.applyAgreedUndo()).toThrow(/conflict|stopped/i);
  });

  it('resetGame is REFUSED once the game is stopped by a conflict (a stopped game exchanges no traffic)', async () => {
    const hub = new MockRelayHub();
    const ta = new MockTransport(hub, 'rc-a');
    const tb = new MockTransport(hub, 'rc-b');
    const ea = new SyncEngine(new Game(9), ta, db, () => meta, 'white');
    const eb = new SyncEngine(new Game(9), tb, db, () => meta, 'black');
    ea.placeLocalOnly([0, 0, 0]);
    eb.placeLocalOnly([2, 2, 2]);
    await ea.connect('rc-room');
    await eb.connect('rc-room');
    ea.publishState();
    expect(eb.status().kind).toBe('conflict');
    expect(() => eb.resetGame(new Game(9), 'white')).toThrow(/conflict|stopped/i);
    // The epoch did NOT advance — the refused reset made no change.
    expect(eb.epoch()).toBe(0);
  });

  it('receive() NORMALIZES a directly-injected message with a MISSING epoch to generation 0 (adopts at epoch 0)', async () => {
    const hub = new MockRelayHub();
    const t = new MockTransport(hub, 'no-epoch');
    const eng = new SyncEngine(new Game(9), t, db, () => meta, 'white');
    await eng.connect('no-epoch-room');
    // A legacy-shaped message with NO epoch field (a pre-epoch peer) injected straight into the
    // public receive seam. It must be read as epoch 0 and — since the engine is also at epoch 0 —
    // adopt normally by the ordinary prefix rule (proves the seam does not trust an unset epoch).
    const legacy = { version: SYNC_VERSION, headHash: headHash(logOf('0,0,0')), log: [{ type: 'place', node: '0,0,0' }] } as unknown as SyncMessage;
    eng.receive(legacy);
    expect(eng.game().state().pieces['0,0,0']).toBe('white');
    expect(eng.epoch()).toBe(0);
  });
});

describe('SyncEngine.onChange — the resync notification (Task 6.1, issue #4)', () => {
  let db: IDBDatabase;
  const meta = { players: { white: 'w', black: 'b' }, startedAt: 1000 };

  beforeEach(async () => {
    db = await openDatabase(`sync-change-${Math.random().toString(36).slice(2)}`);
  });

  /**
   * A solo engine (no peer) connected to a mock room, so place()/undo() can publish. receive() is
   * still driven directly to simulate inbound peer messages.
   */
  async function solo(size = 9): Promise<SyncEngine> {
    const hub = new MockRelayHub();
    const t = new MockTransport(hub, 'chg');
    const eng = new SyncEngine(new Game(size), t, db, () => meta, 'white');
    await eng.connect('change-room');
    return eng;
  }

  it('fires on a local move (so the local placement re-renders the scene)', async () => {
    const eng = await solo();
    let fires = 0;
    eng.onChange(() => (fires += 1));
    eng.place([0, 0, 0]);
    expect(fires).toBe(1);
  });

  it('fires when ADOPTING a peer log — the remote-move resync link', async () => {
    // This is the core issue #4 gap: the transport pump mutates the game silently. onChange must
    // fire on adopt so the app re-renders the peer's move (observable: the listener saw the change
    // AND the adopted piece is really on the board).
    const eng = await solo();
    let fires = 0;
    let seenPly = -1;
    eng.onChange(() => {
      fires += 1;
      seenPly = eng.game().ply();
    });
    eng.receive(toSyncMessage(logOf('0,0,0', '1,1,1')));
    expect(fires).toBe(1);
    expect(seenPly).toBe(2);
    expect(eng.game().state().pieces['0,0,0']).toBe('white');
  });

  it('does NOT fire when IGNORING a stale/equal replay (no change happened)', async () => {
    // A replay is a genuine no-op: firing here would falsely tell the scene state changed.
    const eng = await solo();
    eng.receive(toSyncMessage(logOf('0,0,0', '1,1,1'))); // adopt → 2
    let fires = 0;
    eng.onChange(() => (fires += 1));
    eng.receive(toSyncMessage(logOf('0,0,0'))); // stale prefix → ignore
    eng.receive(toSyncMessage(eng.game().log)); // equal → ignore
    expect(fires).toBe(0);
    expect(eng.game().ply()).toBe(2);
  });

  it('fires on a CONFLICT (so the UI reflects the stopped game)', async () => {
    const eng = await solo();
    eng.placeLocalOnly([0, 0, 0]); // my fork
    let fires = 0;
    let statusAtFire: string | null = null;
    eng.onChange(() => {
      fires += 1;
      statusAtFire = eng.status().kind;
    });
    eng.receive(toSyncMessage(logOf('1,1,1'))); // a divergent fork → conflict
    expect(fires).toBe(1);
    expect(statusAtFire).toBe('conflict');
    await eng.whenSettled();
  });

  it('fires on undo (the extended log re-renders and publishes)', async () => {
    const eng = await solo();
    eng.place([0, 0, 0]); // white's move — white may undo its own last move
    let fires = 0;
    eng.onChange(() => (fires += 1));
    eng.undo();
    expect(fires).toBe(1);
    expect(eng.game().state().pieces['0,0,0']).toBeUndefined();
  });

  it('stops notifying after unsubscribe', async () => {
    const eng = await solo();
    let fires = 0;
    const off = eng.onChange(() => (fires += 1));
    eng.place([0, 0, 0]);
    off();
    eng.place([1, 1, 1]);
    expect(fires).toBe(1);
  });

  it('a frozen (conflicted) game neither fires nor mutates on a later strict extension', async () => {
    // Once stopped, receive() returns before touching the game — so no listener fires either
    // (the guard holds for the notification too; a frozen game reports no phantom change).
    const eng = await solo();
    eng.placeLocalOnly([0, 0, 0]);
    eng.receive(toSyncMessage(logOf('1,1,1'))); // conflict → stopped
    let fires = 0;
    eng.onChange(() => (fires += 1));
    eng.receive(toSyncMessage(logOf('0,0,0', '2,2,2'))); // would adopt if not frozen
    expect(fires).toBe(0);
  });
});

describe('SyncEngine.onMessage — the pump validates + routes the tagged union', () => {
  let db: IDBDatabase;
  const meta = { players: { white: 'w', black: 'b' }, startedAt: 5000 };

  beforeEach(async () => {
    db = await openDatabase(`route-test-${Math.random().toString(36).slice(2)}`);
  });

  /** A pair on a shared mock relay so a raw publish drives the OTHER engine's pump. */
  async function pair(size = 9): Promise<{
    a: SyncEngine;
    b: SyncEngine;
    ta: MockTransport;
    tb: MockTransport;
  }> {
    const hub = new MockRelayHub();
    const ta = new MockTransport(hub, 'route-a');
    const tb = new MockTransport(hub, 'route-b');
    const a = new SyncEngine(new Game(size), ta, db, () => meta, 'white');
    const b = new SyncEngine(new Game(size), tb, db, () => meta, 'black');
    await a.connect('route-room');
    await b.connect('route-room');
    return { a, b, ta, tb };
  }

  it('routes an inbound proposal to onMessage (not the game log)', async () => {
    const { a, b, ta } = await pair();
    const seen: (ProposalMessage | ResponseMessage)[] = [];
    b.onMessage((m) => seen.push(m));
    const plyBefore = b.game().ply();
    // A publishes a raw proposal over the relay; B's pump validates + routes it.
    const proposal: ProposalMessage = {
      kind: 'proposal',
      id: 'p-1',
      action: 'rematch',
      proposedBy: 'white',
    };
    ta.publish(proposal as unknown as Parameters<typeof ta.publish>[0]);
    // Delivered to B's handshake seam, with all fields intact…
    expect(seen).toEqual([proposal]);
    // …and it NEVER touched the append-only log: B's game is unchanged.
    expect(b.game().ply()).toBe(plyBefore);
    expect(b.game().log.entries.length).toBe(0);
    expect(a).toBeDefined();
  });

  it('routes an inbound response to onMessage, preserving its accepted flag', async () => {
    const { b, ta } = await pair();
    const seen: (ProposalMessage | ResponseMessage)[] = [];
    b.onMessage((m) => seen.push(m));
    const response: ResponseMessage = { kind: 'response', proposalId: 'p-1', accepted: false };
    ta.publish(response as unknown as Parameters<typeof ta.publish>[0]);
    expect(seen).toEqual([response]);
    expect(b.game().log.entries.length).toBe(0);
  });

  it('routes a sync message to the game (adopt) and NOT to onMessage', async () => {
    const { a, b } = await pair();
    const seen: (ProposalMessage | ResponseMessage)[] = [];
    b.onMessage((m) => seen.push(m));
    // A real move → A publishes a kind:'sync' message; B adopts it via the pump.
    a.place([0, 0, 0]);
    expect(b.game().state().pieces['0,0,0']).toBe('white');
    // A sync message is applied to the log, never delivered to the handshake seam.
    expect(seen).toEqual([]);
  });

  it('un-kinded legacy sync over the wire still converges the peer (backward-compat)', async () => {
    const { b, ta } = await pair();
    const seen: (ProposalMessage | ResponseMessage)[] = [];
    b.onMessage((m) => seen.push(m));
    // Simulate a PRE-tagged-union peer: publish an un-kinded {version,headHash,log}.
    const legacy = toSyncMessage(logOf('0,0,0', '1,1,1')) as unknown as Record<string, unknown>;
    const { kind: _dropped, ...unKinded } = legacy;
    void _dropped;
    ta.publish(unKinded as unknown as Parameters<typeof ta.publish>[0]);
    // B adopted the legacy sync payload — its board reflects the two moves…
    expect(b.game().state().pieces['0,0,0']).toBe('white');
    expect(b.game().ply()).toBe(2);
    // …and it was NOT misrouted to the handshake seam.
    expect(seen).toEqual([]);
  });

  it('a malformed transport payload throws a SyncError out of the pump (never silently dropped)', async () => {
    const { ta, b } = await pair();
    const seen: (ProposalMessage | ResponseMessage)[] = [];
    b.onMessage((m) => seen.push(m));
    // A publishes an unknown-kind payload; the mock relay delivers it SYNCHRONOUSLY to
    // B's pump, which validates via parseGameMessage and throws — the error propagates
    // out of the publish call (proof-by-behavior: the pump rejects, it does not swallow).
    const bad = { kind: 'chat', text: 'hi' } as unknown;
    expect(() => ta.publish(bad as Parameters<typeof ta.publish>[0])).toThrow(SyncError);
    expect(() => ta.publish(bad as Parameters<typeof ta.publish>[0])).toThrow(
      /unknown game message kind: chat/,
    );
    // The rejected message never reached the handshake seam nor the log.
    expect(seen).toEqual([]);
    expect(b.game().log.entries.length).toBe(0);
  });

  it('publishHandshake sends a proposal the PEER receives out-of-band (never on either log)', async () => {
    const { a, b, tb } = await pair();
    // Prove the round-trip as observable behavior (agent-principles #3): B publishes a proposal via
    // publishHandshake and A's pump delivers the SAME message to A's onMessage seam.
    const seenOnA: (ProposalMessage | ResponseMessage)[] = [];
    a.onMessage((m) => seenOnA.push(m));
    const proposal: ProposalMessage = {
      kind: 'proposal',
      id: 'p-hs-1',
      action: 'rematch',
      proposedBy: 'black',
    };
    b.publishHandshake(proposal);
    // A actually received it, with every field intact — not a log line, the real inbound message.
    expect(seenOnA).toEqual([proposal]);
    // And it touched NEITHER append-only log: the handshake is out-of-band on both sides.
    expect(a.game().log.entries.length).toBe(0);
    expect(b.game().log.entries.length).toBe(0);
    // A ResponseMessage travels the same seam and preserves its accepted flag on receipt.
    void tb;
    const response: ResponseMessage = { kind: 'response', proposalId: 'p-hs-1', accepted: true };
    b.publishHandshake(response);
    expect(seenOnA).toEqual([proposal, response]);
  });

  it('publishHandshake is REFUSED once a conflict has stopped the game (no out-of-band traffic after stop)', async () => {
    const { a, b } = await pair();
    // Fork A and B onto divergent 1-move histories, then converge → B conflicts and stops.
    a.placeLocalOnly([0, 0, 0]);
    b.placeLocalOnly([3, 3, 3]);
    a.publishState();
    expect(b.status().kind).toBe('conflict');
    // A proposal from the stopped engine is refused — assertLive throws, nothing is published.
    const seenOnA: (ProposalMessage | ResponseMessage)[] = [];
    a.onMessage((m) => seenOnA.push(m));
    expect(() =>
      b.publishHandshake({ kind: 'proposal', id: 'x', action: 'undo', proposedBy: 'black' }),
    ).toThrow(/conflict|stopped/i);
    // The refused proposal never crossed the relay to A (proof the guard bit, not a log claim).
    expect(seenOnA).toEqual([]);
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
