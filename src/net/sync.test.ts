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
  toHelloMessage,
  toAdmitMessage,
  toAdoptAdmitMessage,
  toRejectMessage,
  parseSyncMessage,
  parseGameMessage,
  AdmissionDeduper,
  ADMISSION_REJECT_REASONS,
  SYNC_VERSION,
  SyncEngine,
  SyncError,
  type SyncMessage,
  type GameMessage,
  type ProposalMessage,
  type ResponseMessage,
  type HelloMessage,
  type AdmitMessage,
  type RejectMessage,
  type AdmissionMessage,
  type AdmissionReject,
} from './sync';
import { emptySeatMap, type SeatMap } from './seats';
import { rematchGameUuid } from './rematch';
import type { Proposal } from './admission';

/**
 * The shared game uuid for logs built by {@link logOf}. Sync decisions (prefix /
 * adopt / conflict) only make sense *within one game*, so every log a test compares
 * must carry the same uuid — otherwise the uuid-seeded genesis (S.1) makes them
 * diverge at ply 0. A single fixed uuid models "the same game across peers".
 */
const GAME_UUID = 'game-under-test';

/**
 * The seed for engines whose test is about CONVERGENCE, not about the design §3 seed gate: dealer's
 * choice is the one seed that imposes no game-identity constraint ("adopt whatever you bring"), so an
 * engine holding it behaves exactly as the pre-gate engine did. The gate itself is exercised with real
 * `new`/`resume`/`current` seeds in its own describe block below — deliberately NOT smuggled into every
 * other test, where it would only obscure what is being asserted.
 */
const ANY_SEED: Proposal = { kind: 'defer' };

/** Build a log (carrying {@link GAME_UUID}) from a sequence of node keys (each a `place`). */
function logOf(...nodes: string[]): EventLog {
  let log = emptyLog(GAME_UUID);
  for (const node of nodes) {
    log = append(log, { type: 'place', node });
  }
  return log;
}

/** A fresh empty log carrying {@link GAME_UUID}, for the empty-log edge cases. */
function emptyGameLog(): EventLog {
  return emptyLog(GAME_UUID);
}

/**
 * The shared game uuid for a peer pair / solo engine in the SyncEngine tests. Two
 * peers who play the same game carry the same genesis uuid (S.1) — established by the
 * entry/admission protocol in the app, injected directly here. A `resetGame` to a new
 * game likewise passes an explicit shared uuid so both peers' fresh games converge.
 */
const PAIR_UUID = GAME_UUID;
/**
 * The uuid of the pair's NEXT generation (the game a rematch from {@link PAIR_UUID} resets into at
 * epoch 1) — DERIVED exactly as `NetSession.resetForRematch` derives it, not invented here, because
 * that derivation is what identifies the fresh game as the pair's own rather than a stranger's: the
 * engine adopts its own next generation off the wire and refuses an unrelated game (see the cross-game
 * suite at the bottom of this file).
 */
const RESET_UUID = rematchGameUuid(PAIR_UUID, 1);

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

  it('IGNOREs when both are the empty log (same game)', () => {
    expect(decideSync(emptyGameLog(), emptyGameLog())).toEqual({ action: 'ignore' });
  });

  it('ADOPTs any non-empty remote when local is the same game empty', () => {
    expect(decideSync(emptyGameLog(), logOf('4,4,4'))).toEqual({ action: 'adopt' });
  });

  it('CONFLICTs when the logs fork at the same ply (neither a prefix)', () => {
    const local = logOf('0,0,0', '1,1,1');
    const remote = logOf('0,0,0', '2,2,2');
    expect(decideSync(local, remote)).toEqual({
      action: 'conflict',
      divergePly: 1,
    });
  });

  it('CONFLICTs at ply 0 when the same moves belong to DIFFERENT games (S.1 uuid)', () => {
    // A remote log that would be an extension under the same uuid must NOT be adopted
    // when it is a *different game* — the uuid-seeded genesis makes it diverge at ply
    // 0. This is what stops one game's history bleeding into another that merely
    // shares an opening. Without the uuid guard in isPrefix, this would spuriously
    // ADOPT (empty-local case) or agree on the shared prefix.
    let local = emptyLog('game-A');
    let remote = emptyLog('game-B');
    local = append(local, { type: 'place', node: '0,0,0' });
    remote = append(remote, { type: 'place', node: '0,0,0' });
    remote = append(remote, { type: 'place', node: '1,1,1' });
    expect(decideSync(local, remote)).toEqual({ action: 'conflict', divergePly: 0 });
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
    // The next generation is a fresh game with its own uuid; the epoch (not the uuid)
    // drives the adopt, so the distinct uuid is irrelevant to the outcome here.
    expect(decideSyncEpoched(0, finished, 1, emptyLog('gen-1'))).toEqual({ action: 'adopt' });
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
    const fresh = emptyLog('gen-1');
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
    const legacy = parseGameMessage({ version: SYNC_VERSION, uuid: GAME_UUID, headHash: headHash(logOf('0,0,0')), log: [{ type: 'place', node: '0,0,0' }] });
    expect(legacy.kind === 'sync' && legacy.epoch).toBe(0);
    // A hostile negative epoch is clamped to 0 so it can never out-rank a live generation.
    const hostile = parseGameMessage({ kind: 'sync', version: SYNC_VERSION, epoch: -7, uuid: GAME_UUID, headHash: headHash(emptyGameLog()), log: [] });
    expect(hostile.kind === 'sync' && hostile.epoch).toBe(0);
    // A fractional epoch is floored (a whole generation count).
    const frac = parseGameMessage({ kind: 'sync', version: SYNC_VERSION, epoch: 2.9, uuid: GAME_UUID, headHash: headHash(emptyGameLog()), log: [] });
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

  it('rejects a message with a MISSING uuid — the S.1 uuid is required to seed the chain', () => {
    // Reaches parseSyncMessage's OWN uuid guard directly (the pump's looksLikeSync
    // rejects earlier, so this is the only path that exercises it): a valid version +
    // array log but no uuid. Without the guard the reconstruction would seed with
    // `undefined`, silently changing the genesis hash — the guard rejects it honestly.
    const noUuid = { version: SYNC_VERSION, headHash: 'x', log: [] } as unknown as SyncMessage;
    expect(() => parseSyncMessage(noUuid)).toThrow(SyncError);
    expect(() => parseSyncMessage(noUuid)).toThrow(/non-empty string uuid/);
  });

  it('rejects a message with an EMPTY-string uuid (corrupt, not merely absent)', () => {
    // Pins the `msg.uuid.length === 0` half of the guard: an empty uuid is a broken
    // payload, not a legacy one, so it must be rejected — not seeded as "".
    const emptyUuid = { version: SYNC_VERSION, uuid: '', headHash: 'x', log: [] } as unknown as SyncMessage;
    expect(() => parseSyncMessage(emptyUuid)).toThrow(SyncError);
    expect(() => parseSyncMessage(emptyUuid)).toThrow(/non-empty string uuid/);
  });

  it('rejects a message with a NON-string uuid', () => {
    // Pins the `typeof msg.uuid !== 'string'` half of the guard.
    const numUuid = { version: SYNC_VERSION, uuid: 42, headHash: 'x', log: [] } as unknown as SyncMessage;
    expect(() => parseSyncMessage(numUuid)).toThrow(SyncError);
    expect(() => parseSyncMessage(numUuid)).toThrow(/non-empty string uuid/);
  });

  it('reconstructs a log seeded by the message uuid — a matching headHash verifies same-identity', () => {
    // The success path through the uuid guard: a well-formed message reconstructs a
    // log whose uuid equals the message uuid and whose headHash matches. This kills a
    // guard mutant that would let a valid uuid through as invalid (or vice versa),
    // and proves the seed is the MESSAGE'S uuid, not a fresh one.
    const msg = toSyncMessage(logOf('0,0,0', '1,1,1'));
    const log = parseSyncMessage(msg);
    expect(log.uuid).toBe(GAME_UUID);
    expect(headHash(log)).toBe(msg.headHash);
  });

  it('rejects a well-formed log whose uuid does NOT match its claimed headHash (tamper)', () => {
    // A message that swaps in a DIFFERENT uuid but keeps the original headHash must
    // fail the hash-chain re-verification: the reconstructed genesis (new uuid) yields
    // a different headHash than claimed. This proves the uuid genuinely participates
    // in the fingerprint check, closing the "same headHash across games" ambiguity.
    const good = toSyncMessage(logOf('0,0,0'));
    const tampered = { ...good, uuid: 'a-different-game' } as SyncMessage;
    expect(() => parseSyncMessage(tampered)).toThrow(SyncError);
    expect(() => parseSyncMessage(tampered)).toThrow(/headHash/);
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

    it('rejects a kind:sync MISSING the game uuid (S.1 — uuid is intrinsic to the chain)', () => {
      // A sync payload with no uuid cannot be reconstructed with the right genesis
      // seed, so it is a malformed envelope. Pin the uuid requirement in looksLikeSync
      // so it cannot be silently dropped, reopening the "same headHash across games"
      // ambiguity S.1 closes.
      const bad = { kind: 'sync', version: 1, headHash: 'x', log: [] };
      expect(() => parseGameMessage(bad)).toThrow(SyncError);
      expect(() => parseGameMessage(bad)).toThrow(/string uuid/);
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
        uuid: syncMsg.uuid,
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

describe('parseGameMessage — admission messages (Task S.4: hello / admit / reject)', () => {
  // A valid authoritative game payload the admit message carries.
  const gamePayload = toSyncMessage(logOf('0,0,0', '1,1,1'));
  const seats: SeatMap = { white: 'player-w', black: 'player-b' };

  describe('kind: hello', () => {
    const hello: HelloMessage = {
      kind: 'hello',
      id: 'h-1',
      playerId: 'player-a',
      proposal: { kind: 'defer' },
      seats: { white: 'player-a', black: null },
      arrivalTag: 0,
    };

    it('parses a well-formed hello, preserving every field', () => {
      const parsed: GameMessage = parseGameMessage({ ...hello });
      expect(parsed).toEqual(hello);
    });

    it('round-trips through JSON (the real wire path) unchanged', () => {
      const wire = JSON.parse(JSON.stringify(hello)) as unknown;
      expect(parseGameMessage(wire)).toEqual(hello);
    });

    it('accepts each of the four proposal kinds, preserving its payload', () => {
      const proposals: Proposal[] = [
        { kind: 'defer' },
        { kind: 'new' },
        { kind: 'resume', uuid: 'g-1', headHash: 'hh-1' },
        { kind: 'current', uuid: 'g-2', headHash: 'hh-2' },
      ];
      for (const proposal of proposals) {
        const msg = { ...hello, proposal };
        expect(parseGameMessage(JSON.parse(JSON.stringify(msg)))).toEqual(msg);
      }
    });

    it('rejects a hello missing its id (non-string)', () => {
      const bad = { kind: 'hello', playerId: 'p', proposal: { kind: 'defer' }, arrivalTag: 0 };
      expect(() => parseGameMessage(bad)).toThrow(SyncError);
      expect(() => parseGameMessage(bad)).toThrow(/hello message requires a string id/);
    });

    it('rejects a hello with a non-string id (numeric)', () => {
      const bad = { kind: 'hello', id: 7, playerId: 'p', proposal: { kind: 'defer' }, arrivalTag: 0 };
      expect(() => parseGameMessage(bad)).toThrow(/hello message requires a string id/);
    });

    it('rejects a hello missing its playerId (non-string)', () => {
      const bad = { kind: 'hello', id: 'h', proposal: { kind: 'defer' }, arrivalTag: 0 };
      expect(() => parseGameMessage(bad)).toThrow(/string playerId/);
    });

    it('rejects a hello whose arrivalTag is not a finite number', () => {
      for (const arrivalTag of ['0', null, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
        const bad = { kind: 'hello', id: 'h', playerId: 'p', proposal: { kind: 'defer' }, arrivalTag };
        expect(() => parseGameMessage(bad)).toThrow(/finite numeric arrivalTag/);
      }
    });

    it('accepts arrivalTag 0 (the earliest rank — not falsy-rejected)', () => {
      // 0 is a valid arrival rank; a falsy `!arrivalTag` guard would wrongly reject it.
      const parsed = parseGameMessage({ ...hello, arrivalTag: 0 });
      expect(parsed.kind === 'hello' && parsed.arrivalTag).toBe(0);
    });

    it('rejects a hello whose proposal is not an object (string or null)', () => {
      // A non-object AND a null both fail the proposal-object guard (null is typeof 'object' but
      // must be rejected explicitly — pins the `raw === null` half of the guard).
      for (const proposal of ['defer', null]) {
        const bad = { kind: 'hello', id: 'h', playerId: 'p', proposal, arrivalTag: 0 };
        expect(() => parseGameMessage(bad)).toThrow(/requires a proposal object/);
      }
    });

    it('rejects a hello whose proposal has an unknown kind', () => {
      const bad = { kind: 'hello', id: 'h', playerId: 'p', proposal: { kind: 'random' }, arrivalTag: 0 };
      expect(() => parseGameMessage(bad)).toThrow(/unknown proposal kind: random/);
    });

    it('rejects a resume/current proposal missing its uuid', () => {
      for (const kind of ['resume', 'current'] as const) {
        const bad = { kind: 'hello', id: 'h', playerId: 'p', proposal: { kind, headHash: 'hh' }, arrivalTag: 0 };
        expect(() => parseGameMessage(bad)).toThrow(new RegExp(`${kind} proposal requires a non-empty string uuid`));
      }
    });

    it('rejects a resume/current proposal with an EMPTY-string uuid', () => {
      const bad = { kind: 'hello', id: 'h', playerId: 'p', proposal: { kind: 'resume', uuid: '', headHash: 'hh' }, arrivalTag: 0 };
      expect(() => parseGameMessage(bad)).toThrow(/non-empty string uuid/);
    });

    it('rejects a resume/current proposal missing its headHash', () => {
      const bad = { kind: 'hello', id: 'h', playerId: 'p', proposal: { kind: 'current', uuid: 'g' }, arrivalTag: 0 };
      expect(() => parseGameMessage(bad)).toThrow(/current proposal requires a non-empty string headHash/);
    });

    it('rejects a resume/current proposal with an EMPTY-string headHash', () => {
      const bad = { kind: 'hello', id: 'h', playerId: 'p', proposal: { kind: 'resume', uuid: 'g', headHash: '' }, arrivalTag: 0 };
      expect(() => parseGameMessage(bad)).toThrow(/non-empty string headHash/);
    });
  });

  describe('kind: admit', () => {
    const served = { source: 'arbiter', game: gamePayload } as const;
    const admit: AdmitMessage = { kind: 'admit', id: 'a-1', to: 'player-newcomer', agreed: served, seats };

    it('parses a well-formed ARBITER-served admit, preserving the game payload and seats', () => {
      const parsed: GameMessage = parseGameMessage(JSON.parse(JSON.stringify(admit)));
      expect(parsed).toEqual(admit);
      // The carried game is a real, hash-chain-verifiable sync payload.
      if (parsed.kind !== 'admit') throw new Error('expected admit');
      if (parsed.agreed.source !== 'arbiter') throw new Error('expected an arbiter-served game');
      expect(headHash(parseSyncMessage(parsed.agreed.game))).toBe(gamePayload.headHash);
    });

    it('parses a NEWCOMER-sourced admit (a deferring arbiter naming the newcomer’s own game)', () => {
      // The dealer's-choice arbiter has no payload to give: the grant names the game by uuid and the
      // newcomer keeps what it brought (design §3 — the only row that adopts a peer's non-empty game).
      const adopt: AdmitMessage = {
        kind: 'admit',
        id: 'a-2',
        to: 'player-newcomer',
        agreed: { source: 'newcomer', uuid: 'their-game-uuid' },
        seats,
      };
      const parsed = parseGameMessage(JSON.parse(JSON.stringify(adopt)));
      expect(parsed).toEqual(adopt);
      if (parsed.kind !== 'admit') throw new Error('expected admit');
      expect(parsed.agreed).toEqual({ source: 'newcomer', uuid: 'their-game-uuid' });
    });

    it('accepts a seat map with a null (unowned) seat', () => {
      const oneOwned: AdmitMessage = { ...admit, seats: { white: 'player-w', black: null } };
      const parsed = parseGameMessage(JSON.parse(JSON.stringify(oneOwned)));
      expect(parsed).toEqual(oneOwned);
    });

    it('accepts an empty (both-null) seat map', () => {
      const empty: AdmitMessage = { ...admit, seats: emptySeatMap() };
      expect(parseGameMessage(JSON.parse(JSON.stringify(empty)))).toEqual(empty);
    });

    it('rejects an admit missing its id (non-string)', () => {
      const bad = { kind: 'admit', agreed: served, seats };
      expect(() => parseGameMessage(bad)).toThrow(/admit message requires a string id/);
    });

    it('rejects an admit whose agreed field is not an object (string or null)', () => {
      // A string AND an explicit null both fail the guard (null is typeof 'object' but must be
      // rejected — pins the `raw === null` half).
      for (const agreed of ['nope', null]) {
        const bad = { kind: 'admit', id: 'a', to: 'player-newcomer', agreed, seats };
        expect(() => parseGameMessage(bad)).toThrow(/requires an agreed object/);
      }
    });

    it('rejects an admit whose agreed source is unknown (never defaulted to a shape that parses)', () => {
      // A malformed grant must NOT be read as whichever of the two shapes happens to fit — that is how
      // a peer ends up on a game nobody agreed on.
      const bad = { kind: 'admit', id: 'a', to: 'player-newcomer', agreed: { source: 'somebody-else', game: gamePayload }, seats };
      expect(() => parseGameMessage(bad)).toThrow(/unknown admit agreed source: somebody-else/);
      const missing = { kind: 'admit', id: 'a', to: 'player-newcomer', agreed: { game: gamePayload }, seats };
      expect(() => parseGameMessage(missing)).toThrow(/unknown admit agreed source: undefined/);
    });

    it('rejects a NEWCOMER-sourced admit with no (or an empty) uuid — it names nothing', () => {
      for (const uuid of [undefined, '', 42]) {
        const bad = { kind: 'admit', id: 'a', to: 'player-newcomer', agreed: { source: 'newcomer', uuid }, seats };
        expect(() => parseGameMessage(bad)).toThrow(/newcomer-sourced game requires a non-empty string uuid/);
      }
    });

    it('rejects an ARBITER-served admit whose game is not a sync payload (a proposal masquerading)', () => {
      const bad = { kind: 'admit', id: 'a', to: 'player-newcomer', agreed: { source: 'arbiter', game: { kind: 'proposal', id: 'x', action: 'undo', proposedBy: 'white' } }, seats };
      expect(() => parseGameMessage(bad)).toThrow(/admit message game must be a sync payload/);
    });

    it('rejects an ARBITER-served admit whose game is malformed (propagates the inner sync error)', () => {
      const bad = { kind: 'admit', id: 'a', to: 'player-newcomer', agreed: { source: 'arbiter', game: { kind: 'sync', version: 1, headHash: 'x', log: 'nope' } }, seats };
      expect(() => parseGameMessage(bad)).toThrow(SyncError);
      expect(() => parseGameMessage(bad)).toThrow(/array log/);
    });

    it('rejects an admit whose seats is not an object (string or null)', () => {
      for (const seatsVal of ['nope', null]) {
        const bad = { kind: 'admit', id: 'a', to: 'player-newcomer', agreed: served, seats: seatsVal };
        expect(() => parseGameMessage(bad)).toThrow(/requires a seats object/);
      }
    });

    it('rejects an admit whose seats is missing entirely', () => {
      const bad = { kind: 'admit', id: 'a', to: 'player-newcomer', agreed: served };
      expect(() => parseGameMessage(bad)).toThrow(/requires a seats object/);
    });

    it('rejects a seat that is neither a string nor null (numeric owner)', () => {
      const badWhite = { kind: 'admit', id: 'a', to: 'player-newcomer', agreed: served, seats: { white: 42, black: null } };
      expect(() => parseGameMessage(badWhite)).toThrow(/white seat must be a string playerId or null/);
      const badBlack = { kind: 'admit', id: 'a', to: 'player-newcomer', agreed: served, seats: { white: null, black: {} } };
      expect(() => parseGameMessage(badBlack)).toThrow(/black seat must be a string playerId or null/);
    });

    it('reads a missing seat field as an invalid (undefined) seat, not null', () => {
      // An absent seat is NOT the same as an explicit null owner; it is a malformed map.
      const bad = { kind: 'admit', id: 'a', to: 'player-newcomer', agreed: served, seats: { white: 'w' } };
      expect(() => parseGameMessage(bad)).toThrow(/black seat must be a string playerId or null/);
    });
  });

  describe('kind: reject', () => {
    // Enumerated from the codec's OWN exported reason set, so a reason added to the union is covered
    // here the moment it exists instead of quietly falling outside a hand-copied list.
    const reasons: readonly AdmissionReject[] = ADMISSION_REJECT_REASONS;

    it('parses EVERY typed reject reason, preserving it verbatim', () => {
      expect(reasons.length).toBeGreaterThan(0);
      for (const reason of reasons) {
        const msg: RejectMessage = { kind: 'reject', id: `r-${reason}`, to: 'player-newcomer', reason };
        expect(parseGameMessage(JSON.parse(JSON.stringify(msg)))).toEqual(msg);
      }
    });

    it('the exported reason SET is EXACTLY the design §7 reasons (the SSOT the codec validates against)', () => {
      // Pins the CONTENTS, not just the shape: the enumerated round-trip above validates each reason
      // against this very list, so without this assertion a corrupted entry would round-trip happily.
      expect([...ADMISSION_REJECT_REASONS].sort()).toEqual([
        'game-divergent',
        'game-mismatch',
        'room-full',
        'seat-reserved',
        'seed-refused',
      ]);
    });

    it('carries the V.2 SEED refusal (`seed-refused`) — the design §3 reason, named explicitly', () => {
      // Spelled out rather than only enumerated: the seed rule is only enforceable if its reason can
      // actually cross the wire and arrive unchanged (#46 — surfaced verbatim, never relabelled).
      const msg: RejectMessage = { kind: 'reject', id: 'r-seed', to: 'player-newcomer', reason: 'seed-refused' };
      expect(parseGameMessage(JSON.parse(JSON.stringify(msg)))).toEqual(msg);
      expect(ADMISSION_REJECT_REASONS).toContain('seed-refused');
    });

    it('rejects a reject missing its id (non-string)', () => {
      const bad = { kind: 'reject', reason: 'room-full' };
      expect(() => parseGameMessage(bad)).toThrow(/reject message requires a string id/);
    });

    it('rejects a reject with an UNKNOWN reason (outside the typed set), echoing it', () => {
      const bad = { kind: 'reject', id: 'r', to: 'player-newcomer', reason: 'because-i-said-so' };
      expect(() => parseGameMessage(bad)).toThrow(SyncError);
      expect(() => parseGameMessage(bad)).toThrow(/known reason/);
      expect(() => parseGameMessage(bad)).toThrow(/because-i-said-so/);
    });

    it('rejects an ADMIT with no addressee — an unaddressed grant would be read by every peer', () => {
      // One topic per room means every peer sees every admission message. A grant with no `to` is
      // read by peers it was not meant for, and a peer that finds itself unseated in the enclosed map
      // tears itself down as `room-full`. The codec refuses to carry one.
      const agreed = { source: 'arbiter', game: gamePayload } as const;
      const noTo = { kind: 'admit', id: 'a', agreed, seats };
      expect(() => parseGameMessage(noTo)).toThrow(/admit message requires a non-empty `to`/);
      const emptyTo = { kind: 'admit', id: 'a', to: '', agreed, seats };
      expect(() => parseGameMessage(emptyTo)).toThrow(/admit message requires a non-empty `to`/);
      const numericTo = { kind: 'admit', id: 'a', to: 7, agreed, seats };
      expect(() => parseGameMessage(numericTo)).toThrow(/admit message requires a non-empty `to`/);
    });

    it('rejects a REJECT with no addressee — an unaddressed refusal settles the wrong peer offline', () => {
      const noTo = { kind: 'reject', id: 'r', reason: 'room-full' };
      expect(() => parseGameMessage(noTo)).toThrow(/reject message requires a non-empty `to`/);
      const emptyTo = { kind: 'reject', id: 'r', to: '', reason: 'room-full' };
      expect(() => parseGameMessage(emptyTo)).toThrow(/reject message requires a non-empty `to`/);
      const numericTo = { kind: 'reject', id: 'r', to: 7, reason: 'room-full' };
      expect(() => parseGameMessage(numericTo)).toThrow(/reject message requires a non-empty `to`/);
    });

    it('rejects a reject with a missing reason', () => {
      const bad = { kind: 'reject', id: 'r', to: 'player-newcomer' };
      expect(() => parseGameMessage(bad)).toThrow(/known reason/);
    });

    it('rejects a reject with a non-string reason', () => {
      const bad = { kind: 'reject', id: 'r', to: 'player-newcomer', reason: 7 };
      expect(() => parseGameMessage(bad)).toThrow(/known reason/);
    });
  });

  describe('message builders (toHelloMessage / toAdmitMessage / toRejectMessage)', () => {
    it('toHelloMessage builds a hello that round-trips through parseGameMessage', () => {
      const proposal: Proposal = { kind: 'resume', uuid: 'g-9', headHash: 'hh-9' };
      const helloSeats: SeatMap = { white: 'player-x', black: null };
      const msg = toHelloMessage('h-42', 'player-x', proposal, helloSeats, 3);
      expect(msg).toEqual({ kind: 'hello', id: 'h-42', playerId: 'player-x', proposal, seats: helloSeats, arrivalTag: 3 });
      expect(parseGameMessage(JSON.parse(JSON.stringify(msg)))).toEqual(msg);
    });

    it('toAdmitMessage builds an admit that round-trips (game re-verifies through the hash chain)', () => {
      const msg = toAdmitMessage('a-42', 'player-newcomer', gamePayload, seats);
      expect(msg).toEqual({
        kind: 'admit',
        id: 'a-42',
        to: 'player-newcomer',
        agreed: { source: 'arbiter', game: gamePayload },
        seats,
      });
      const parsed = parseGameMessage(JSON.parse(JSON.stringify(msg)));
      expect(parsed).toEqual(msg);
      if (parsed.kind !== 'admit') throw new Error('expected admit');
      if (parsed.agreed.source !== 'arbiter') throw new Error('expected an arbiter-served game');
      expect(headHash(parseSyncMessage(parsed.agreed.game))).toBe(gamePayload.headHash);
    });

    it('toAdoptAdmitMessage builds a NEWCOMER-sourced admit that round-trips, carrying no payload', () => {
      const msg = toAdoptAdmitMessage('a-43', 'player-newcomer', 'g-theirs', seats);
      expect(msg).toEqual({
        kind: 'admit',
        id: 'a-43',
        to: 'player-newcomer',
        agreed: { source: 'newcomer', uuid: 'g-theirs' },
        seats,
      });
      expect(parseGameMessage(JSON.parse(JSON.stringify(msg)))).toEqual(msg);
    });

    it('toRejectMessage builds a reject that round-trips, carrying the typed reason', () => {
      const msg = toRejectMessage('r-42', 'player-newcomer', 'seat-reserved');
      expect(msg).toEqual({ kind: 'reject', id: 'r-42', to: 'player-newcomer', reason: 'seat-reserved' });
      expect(parseGameMessage(JSON.parse(JSON.stringify(msg)))).toEqual(msg);
    });
  });

  describe('property: every well-formed admission message round-trips', () => {
    const arbProposal: fc.Arbitrary<Proposal> = fc.oneof(
      fc.constant<Proposal>({ kind: 'defer' }),
      fc.constant<Proposal>({ kind: 'new' }),
      fc.record({ uuid: fc.string({ minLength: 1 }), headHash: fc.string({ minLength: 1 }) }).map(
        ({ uuid, headHash: hh }): Proposal => ({ kind: 'resume', uuid, headHash: hh }),
      ),
      fc.record({ uuid: fc.string({ minLength: 1 }), headHash: fc.string({ minLength: 1 }) }).map(
        ({ uuid, headHash: hh }): Proposal => ({ kind: 'current', uuid, headHash: hh }),
      ),
    );

    it('any hello with a string id/playerId + valid proposal + finite arrivalTag round-trips', () => {
      fc.assert(
        fc.property(fc.string(), fc.string(), arbProposal, fc.integer(), (id, playerId, proposal, arrivalTag) => {
          const msg = toHelloMessage(id, playerId, proposal, { white: playerId, black: null }, arrivalTag);
          expect(parseGameMessage(JSON.parse(JSON.stringify(msg)))).toEqual(msg);
        }),
      );
    });

    it('any reject with one of the typed reasons round-trips, preserving the reason', () => {
      fc.assert(
        fc.property(
          fc.string(),
          fc.constantFrom<AdmissionReject>(...ADMISSION_REJECT_REASONS),
          (id, reason) => {
            const msg = toRejectMessage(id, 'player-newcomer', reason);
            const parsed = parseGameMessage(JSON.parse(JSON.stringify(msg)));
            expect(parsed).toEqual(msg);
          },
        ),
      );
    });
  });
});

describe('AdmissionDeduper — id-based dedup (a stale proposal must never replay)', () => {
  it('reports FRESH the first time an id is seen, DUPLICATE every time after', () => {
    const d = new AdmissionDeduper();
    expect(d.fresh('id-1')).toBe(true);
    expect(d.fresh('id-1')).toBe(false);
    expect(d.fresh('id-1')).toBe(false);
  });

  it('tracks distinct ids independently', () => {
    const d = new AdmissionDeduper();
    expect(d.fresh('a')).toBe(true);
    expect(d.fresh('b')).toBe(true);
    expect(d.fresh('a')).toBe(false);
    expect(d.fresh('b')).toBe(false);
    expect(d.fresh('c')).toBe(true);
  });

  it('hasSeen queries without recording (a pure predicate)', () => {
    const d = new AdmissionDeduper();
    expect(d.hasSeen('x')).toBe(false);
    // Querying does NOT mark it seen, so a later fresh() is still the FIRST sighting.
    expect(d.hasSeen('x')).toBe(false);
    expect(d.fresh('x')).toBe(true);
    expect(d.hasSeen('x')).toBe(true);
  });

  it('property: fresh(id) is true EXACTLY once per id, regardless of order or repeats', () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { minLength: 1 }), (ids) => {
        const d = new AdmissionDeduper();
        const firstSeen = new Set<string>();
        for (const id of ids) {
          const isFresh = d.fresh(id);
          // fresh() is true iff this is the id's FIRST occurrence in the stream.
          expect(isFresh).toBe(!firstSeen.has(id));
          firstSeen.add(id);
        }
        // After the whole stream, every distinct id is marked seen exactly once.
        for (const id of firstSeen) expect(d.hasSeen(id)).toBe(true);
      }),
    );
  });

  it('property: re-delivering the SAME id any number of times yields one fresh + all-false rest', () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 1, max: 20 }), (id, repeats) => {
        const d = new AdmissionDeduper();
        const results = Array.from({ length: repeats }, () => d.fresh(id));
        expect(results[0]).toBe(true);
        expect(results.slice(1).every((r) => r === false)).toBe(true);
      }),
    );
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
    // Both peers play the SAME game, so both games carry the SAME genesis uuid (S.1).
    // In the app the entry/admission protocol (S.5) agrees this shared identity; here
    // it is injected directly. Without a shared uuid the uuid-seeded genesis makes the
    // two logs diverge at ply 0 and they could never converge — which is the whole
    // point: sync only unifies histories OF THE SAME GAME.
    const a = new SyncEngine(new Game(size, PAIR_UUID), ta, db, () => meta, 'white', ANY_SEED);
    const b = new SyncEngine(new Game(size, PAIR_UUID), tb, db, () => meta, 'black', ANY_SEED);
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

  it('attach() re-routes the transport pump onto a NEW engine over a LIVE transport (S.5 adopt)', async () => {
    // B connects a provisional game, then ADOPTS a different authoritative game by swapping in a fresh
    // engine over B's SAME live transport and calling attach() (the S.5 admission adopt path). The
    // proof: a subsequent move from A is delivered to the NEW engine and renders — NOT to the discarded
    // provisional one. Without attach() the transport's onMessage still points at the old engine, so
    // the move would never reach the new one (the concrete two-context regression this defends).
    const hub = new MockRelayHub();
    const ta = new MockTransport(hub, 'peer-a');
    const tb = new MockTransport(hub, 'peer-b');
    const a = new SyncEngine(new Game(9, PAIR_UUID), ta, db, () => meta, 'white', ANY_SEED);
    // B's PROVISIONAL engine carries a DIFFERENT genesis uuid (its own fresh game before admission).
    const bProvisional = new SyncEngine(new Game(9, 'b-provisional-uuid'), tb, db, () => meta, 'black', ANY_SEED);
    await a.connect('adopt-room');
    await bProvisional.connect('adopt-room');

    // B ADOPTS A's authoritative game: a fresh engine on the SAME game identity as A, over tb.
    const bAdopted = new SyncEngine(new Game(9, PAIR_UUID), tb, db, () => meta, 'black', ANY_SEED);
    bAdopted.attach();

    // A plays a move; it must reach the ADOPTED engine (the new one), not the provisional.
    a.place([2, 2, 2]);
    expect(bAdopted.game().state().pieces['2,2,2']).toBe('white');
    expect(headHash(bAdopted.game().log)).toBe(headHash(a.game().log));
    // The discarded provisional engine (different uuid) did NOT receive the move — attach superseded it.
    expect(bProvisional.game().state().pieces['2,2,2']).toBeUndefined();
  });

  it('attach() publishes the adopting engine current log so the peer converges', async () => {
    // After B adopts + attaches, its publishState (inside attach) reaches A. Here B's adopted game
    // already holds a move (a resumed game); attach must PUBLISH it so A adopts the strict extension.
    const hub = new MockRelayHub();
    const ta = new MockTransport(hub, 'peer-a-x');
    const tb = new MockTransport(hub, 'peer-b-x');
    const a = new SyncEngine(new Game(9, PAIR_UUID), ta, db, () => meta, 'white', ANY_SEED);
    const bProvisional = new SyncEngine(new Game(9, 'b-prov-x'), tb, db, () => meta, 'black', ANY_SEED);
    await a.connect('adopt-room-x');
    await bProvisional.connect('adopt-room-x');

    // B adopts a game that ALREADY has one white move (the resumed board), then attaches.
    const resumed = Game.fromLog(9, logOf('4,4,4'));
    const bAdopted = new SyncEngine(resumed, tb, db, () => meta, 'black', ANY_SEED);
    bAdopted.attach();

    // attach()'s publish carried B's one-move log to A, which adopts the strict extension → renders.
    expect(a.game().state().pieces['4,4,4']).toBe('white');
    expect(headHash(a.game().log)).toBe(headHash(bAdopted.game().log));
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
    const eng = new SyncEngine(new Game(9, PAIR_UUID),t, db, () => meta, 'white', ANY_SEED);
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
    const ea = new SyncEngine(new Game(9, PAIR_UUID),ta, db, () => meta, 'white', ANY_SEED);
    const eb = new SyncEngine(new Game(9, PAIR_UUID),tb, db, () => meta, 'black', ANY_SEED);
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
    const ea = new SyncEngine(new Game(9, PAIR_UUID),ta, db, () => meta, 'white', ANY_SEED);
    const eb = new SyncEngine(new Game(9, PAIR_UUID),tb, db, () => meta, 'black', ANY_SEED);
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
    const ea = new SyncEngine(new Game(9, PAIR_UUID),ta, db, () => meta, 'white', ANY_SEED);
    const eb = new SyncEngine(new Game(9, PAIR_UUID),tb, db, () => meta, 'black', ANY_SEED);
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
    a.resetGame(new Game(9, RESET_UUID), 'black');

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
    const eng = new SyncEngine(new Game(9, PAIR_UUID),t, db, () => meta, 'white', ANY_SEED);
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
    // Both peers reset to the SAME next-generation game, so both fresh games carry the
    // SAME uuid (the coordinated rematch agrees it) — required for the post-reset game
    // to converge under S.1's uuid-in-genesis.
    a.resetGame(new Game(9, RESET_UUID), 'black'); // A now black
    b.resetGame(new Game(9, RESET_UUID), 'white'); // B now white
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
    const eng = new SyncEngine(new Game(9, PAIR_UUID),t, db, () => meta, 'white', ANY_SEED);
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
    const eng = new SyncEngine(new Game(9, PAIR_UUID),t, db, () => meta, 'white', ANY_SEED);
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
    const ea = new SyncEngine(new Game(9, PAIR_UUID),ta, db, () => meta, 'white', ANY_SEED);
    const eb = new SyncEngine(new Game(9, PAIR_UUID),tb, db, () => meta, 'black', ANY_SEED);
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
    const eng = new SyncEngine(new Game(9, PAIR_UUID),t, db, () => meta, 'black', ANY_SEED);
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
    const eng = new SyncEngine(new Game(9, PAIR_UUID),t, db, () => meta, 'white', ANY_SEED);
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
    const ea = new SyncEngine(new Game(9, PAIR_UUID),ta, db, () => meta, 'white', ANY_SEED);
    const eb = new SyncEngine(new Game(9, PAIR_UUID),tb, db, () => meta, 'black', ANY_SEED);
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
    const ea = new SyncEngine(new Game(9, PAIR_UUID),ta, db, () => meta, 'white', ANY_SEED);
    const eb = new SyncEngine(new Game(9, PAIR_UUID),tb, db, () => meta, 'black', ANY_SEED);
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
    const eng = new SyncEngine(new Game(9, PAIR_UUID),t, db, () => meta, 'white', ANY_SEED);
    await eng.connect('no-epoch-room');
    // A legacy-shaped message with NO epoch field (a pre-epoch peer) injected straight into the
    // public receive seam. It must be read as epoch 0 and — since the engine is also at epoch 0 —
    // adopt normally by the ordinary prefix rule (proves the seam does not trust an unset epoch).
    const legacy = { version: SYNC_VERSION, uuid: GAME_UUID, headHash: headHash(logOf('0,0,0')), log: [{ type: 'place', node: '0,0,0' }] } as unknown as SyncMessage;
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
    const eng = new SyncEngine(new Game(size, PAIR_UUID),t, db, () => meta, 'white', ANY_SEED);
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
    const a = new SyncEngine(new Game(size, PAIR_UUID),ta, db, () => meta, 'white', ANY_SEED);
    const b = new SyncEngine(new Game(size, PAIR_UUID),tb, db, () => meta, 'black', ANY_SEED);
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

  // ── Task S.4: admission messages route to onAdmission, dedup on id, never touch the log ─────────

  it('routes an inbound ADMISSION message (hello) to onAdmission — NOT onMessage, NOT the log', async () => {
    const { a, b, ta } = await pair();
    const onAdm: AdmissionMessage[] = [];
    const onHs: (ProposalMessage | ResponseMessage)[] = [];
    b.onAdmission((m) => onAdm.push(m));
    b.onMessage((m) => onHs.push(m));
    const hello = toHelloMessage('h-1', 'player-a', { kind: 'new' }, { white: 'player-a', black: null }, 0);
    // A publishes a raw hello over the relay; B's pump validates + routes it by kind.
    ta.publish(hello as unknown as Parameters<typeof ta.publish>[0]);
    // Delivered to B's ADMISSION seam, fields intact…
    expect(onAdm).toEqual([hello]);
    // …NOT to the in-game handshake seam, and NEVER to the append-only log.
    expect(onHs).toEqual([]);
    expect(b.game().log.entries.length).toBe(0);
    expect(a).toBeDefined();
  });

  it('routes admit and reject to onAdmission too (all three admission kinds share the seam)', async () => {
    const { b, ta } = await pair();
    const onAdm: AdmissionMessage[] = [];
    b.onAdmission((m) => onAdm.push(m));
    const admit = toAdmitMessage('a-1', 'player-b', toSyncMessage(logOf('0,0,0')), { white: 'w', black: null });
    const reject = toRejectMessage('r-1', 'player-b', 'room-full');
    ta.publish(admit as unknown as Parameters<typeof ta.publish>[0]);
    ta.publish(reject as unknown as Parameters<typeof ta.publish>[0]);
    expect(onAdm).toEqual([admit, reject]);
    // Neither touched the move-log.
    expect(b.game().log.entries.length).toBe(0);
  });

  it('DEDUPES a replayed admission id — a re-delivered hello fires onAdmission only ONCE', async () => {
    const { b, ta } = await pair();
    const onAdm: AdmissionMessage[] = [];
    b.onAdmission((m) => onAdm.push(m));
    const hello = toHelloMessage('dup-1', 'player-a', { kind: 'defer' }, { white: null, black: null }, 0);
    ta.publish(hello as unknown as Parameters<typeof ta.publish>[0]); // first: fresh → fires
    ta.publish(hello as unknown as Parameters<typeof ta.publish>[0]); // replay: same id → dropped
    ta.publish({ ...hello } as unknown as Parameters<typeof ta.publish>[0]); // another replay → dropped
    // Fired exactly once despite three deliveries — the stale replay never re-fired.
    expect(onAdm).toEqual([hello]);
  });

  it('does NOT dedup DISTINCT admission ids (a genuinely new message still fires)', async () => {
    const { b, ta } = await pair();
    const onAdm: AdmissionMessage[] = [];
    b.onAdmission((m) => onAdm.push(m));
    const first = toHelloMessage('id-1', 'player-a', { kind: 'new' }, { white: 'player-a', black: null }, 0);
    const second = toHelloMessage('id-2', 'player-a', { kind: 'new' }, { white: 'player-a', black: null }, 1);
    ta.publish(first as unknown as Parameters<typeof ta.publish>[0]);
    ta.publish(second as unknown as Parameters<typeof ta.publish>[0]);
    ta.publish(first as unknown as Parameters<typeof ta.publish>[0]); // replay of the first → dropped
    expect(onAdm).toEqual([first, second]);
  });

  it('a malformed admission-shaped payload throws a SyncError out of the pump (never silently dropped)', async () => {
    const { ta, b } = await pair();
    const onAdm: AdmissionMessage[] = [];
    b.onAdmission((m) => onAdm.push(m));
    // A reject with an unknown reason: the pump validates via parseGameMessage and throws.
    const bad = { kind: 'reject', id: 'r', to: 'player-newcomer', reason: 'nonsense' } as unknown;
    expect(() => ta.publish(bad as Parameters<typeof ta.publish>[0])).toThrow(SyncError);
    expect(() => ta.publish(bad as Parameters<typeof ta.publish>[0])).toThrow(/known reason/);
    // Nothing reached the admission seam (the invalid message was rejected up front).
    expect(onAdm).toEqual([]);
  });

  it('sync traffic is UNCHANGED by the admission additions — a move still adopts, not misrouted', async () => {
    const { a, b } = await pair();
    const onAdm: AdmissionMessage[] = [];
    const onHs: (ProposalMessage | ResponseMessage)[] = [];
    b.onAdmission((m) => onAdm.push(m));
    b.onMessage((m) => onHs.push(m));
    a.place([0, 0, 0]);
    // The sync message adopted onto B's board and went to NEITHER the admission nor handshake seam.
    expect(b.game().state().pieces['0,0,0']).toBe('white');
    expect(onAdm).toEqual([]);
    expect(onHs).toEqual([]);
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
    const a = new SyncEngine(new Game(size, PAIR_UUID),ta, db, () => meta, 'white', ANY_SEED);
    const b = new SyncEngine(new Game(size, PAIR_UUID),tb, db, () => meta, 'black', ANY_SEED);
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
    const ea = new SyncEngine(new Game(9, PAIR_UUID),ta, db, () => meta, 'white', ANY_SEED);
    const eb = new SyncEngine(new Game(9, PAIR_UUID),tb, db, () => meta, 'black', ANY_SEED);
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

/**
 * WHICH GAME may cross the move-sync channel (design §3, #46). `isPrefix` deliberately treats an empty
 * log as a prefix of ANY log — the rule that makes ordinary catch-up work — so on its own it lets any
 * peer whose log is momentarily empty adopt a stranger's game wholesale, whatever its player chose.
 * That is the user's rule broken on the one channel the admission protocol never sees:
 *
 *   *"when selecting 'New Game' … i would expect my phone to reject any non-empty gamestate data. only
 *   'Dealer's Choice' should allow a device to accept non-empty gamestate data from the other device."*
 *
 * A log belonging to a DIFFERENT game is therefore decided on IDENTITY terms before it may change
 * anything: the game admission AGREED us onto, or our own next generation, or — while entry is still
 * open — what the player's seed allows while we hold no history. Same-game traffic is untouched (being
 * ahead of or behind the game you are on is convergence, not an identity question) — asserted below,
 * because a gate that also blocked ordinary catch-up would "pass" these tests while breaking every game.
 */
describe('SyncEngine.receive — the seed gate on a FOREIGN game (design §3, #46)', () => {
  let db: IDBDatabase;
  const meta = { players: { white: 'w', black: 'b' }, startedAt: 1000 };
  const MINE = 'my-game';
  const THEIRS = 'their-game';

  beforeEach(async () => {
    db = await openDatabase(`seedgate-${Math.random().toString(36).slice(2)}`);
  });

  /** A log for an arbitrary game uuid, with `nodes.length` placements. */
  function logFor(uuid: string, ...nodes: string[]): EventLog {
    let log = emptyLog(uuid);
    for (const node of nodes) log = append(log, { type: 'place', node });
    return log;
  }

  /** An engine on an EMPTY game `MINE`, holding `seed` — the state the hole was reachable from. */
  function engineWith(seed: Proposal, mine: EventLog = emptyLog(MINE)): SyncEngine {
    const hub = new MockRelayHub();
    const t = new MockTransport(hub, 'peer-self');
    return new SyncEngine(Game.fromLog(9, mine), t, db, () => meta, 'white', seed);
  }

  it('a `new` seed REFUSES a foreign non-empty log — the game is untouched and the refusal is typed', () => {
    const eng = engineWith({ kind: 'new' });
    const foreign = logFor(THEIRS, '0,0,0', '1,1,1');
    let changes = 0;
    eng.onChange(() => changes++);

    eng.receive(toSyncMessage(foreign, 0));

    expect(eng.game().uuid).toBe(MINE);
    expect(eng.game().ply()).toBe(0);
    expect(eng.status().kind).toBe('ok');
    expect(eng.refusedGame()).toEqual({ uuid: THEIRS, reason: 'seed-refused' });
    // No listener fired: nothing changed, so claiming a change would be a lie about state.
    expect(changes).toBe(0);
  });

  it('a `resume`/`current` seed REFUSES a DIFFERENT non-empty game as `game-mismatch`', () => {
    for (const kind of ['resume', 'current'] as const) {
      const eng = engineWith({ kind, uuid: MINE, headHash: 'hh' }, logFor(MINE, '4,4,4'));
      eng.receive(toSyncMessage(logFor(THEIRS, '0,0,0', '1,1,1'), 0));
      expect(eng.game().uuid).toBe(MINE);
      expect(eng.game().ply()).toBe(1);
      expect(eng.refusedGame()).toEqual({ uuid: THEIRS, reason: 'game-mismatch' });
    }
  });

  it('a `defer` seed ADOPTS a foreign non-empty game — the ONE seed the matrix allows it for', () => {
    // The contrast that proves the two tests above are the SEED biting, not "foreign traffic is always
    // dropped": dealer's choice is exactly the row that adopts a peer's real game.
    const eng = engineWith({ kind: 'defer' });
    const foreign = logFor(THEIRS, '0,0,0', '1,1,1');
    let changes = 0;
    eng.onChange(() => changes++);

    eng.receive(toSyncMessage(foreign, 0));

    expect(eng.game().uuid).toBe(THEIRS);
    expect(eng.game().ply()).toBe(2);
    expect(eng.refusedGame()).toBeNull();
    expect(changes).toBe(1);
  });

  it('a `new` seed still adopts a foreign EMPTY game — what it refuses is HISTORY, not identity', () => {
    // "New Game" is about never being handed a game in progress; two empty games are interchangeable
    // (the #42 both-`new` convergence, and a rematch's fresh generation, both depend on this).
    const eng = engineWith({ kind: 'new' });
    eng.receive(toSyncMessage(logFor(THEIRS), 1));
    expect(eng.game().uuid).toBe(THEIRS);
    expect(eng.game().ply()).toBe(0);
    expect(eng.refusedGame()).toBeNull();
  });

  it('a foreign game NEVER stops our game as a "conflict" — for EVERY seed, agreed or still entering', () => {
    // Without this a foreign non-empty log lands as a CONFLICT against our own non-empty log, archiving
    // both and stopping the game: any publisher would hold a kill switch over any peer. The claim is
    // universal, so every seed is exercised — including `defer`, which ACCEPTS foreign games and so
    // used to fall straight into the conflict arm — and a session that has already agreed on its game.
    const seeds: Proposal[] = [
      { kind: 'new' },
      { kind: 'defer' },
      { kind: 'resume', uuid: MINE, headHash: 'hh' },
      { kind: 'current', uuid: MINE, headHash: 'hh' },
    ];
    for (const seed of seeds) {
      for (const agreed of [false, true]) {
        const eng = engineWith(seed, logFor(MINE, '4,4,4', '5,5,5'));
        if (agreed) eng.agreeOn(MINE);
        eng.receive(toSyncMessage(logFor(THEIRS, '0,0,0', '1,1,1'), 0));
        expect(eng.status().kind).toBe('ok');
        expect(eng.conflictForks()).toBeNull();
        expect(eng.game().uuid).toBe(MINE);
        expect(eng.game().ply()).toBe(2);
        // `new` refuses on its seed (empty only); everything else refuses because we are simply on a
        // different game from that publisher — either way a TYPED refusal, never a stopped game.
        expect(eng.refusedGame()).toEqual({
          uuid: THEIRS,
          reason: seed.kind === 'new' && !agreed ? 'seed-refused' : 'game-mismatch',
        });
      }
    }
  });

  it('SAME-game traffic is untouched by the gate: a strict extension is adopted under ANY seed', () => {
    // The gate must not touch convergence. A `new` seed whose own board has moved on still adopts the
    // peer's longer log for the SAME game — otherwise the gate would break every game it "protected".
    const eng = engineWith({ kind: 'new' }, logFor(MINE, '0,0,0'));
    eng.receive(toSyncMessage(logFor(MINE, '0,0,0', '1,1,1'), 0));
    expect(eng.game().ply()).toBe(2);
    expect(eng.refusedGame()).toBeNull();
  });

  it('SAME-game divergence still CONFLICTS (the gate never swallows a real fork)', () => {
    const eng = engineWith({ kind: 'new' }, logFor(MINE, '0,0,0'));
    eng.receive(toSyncMessage(logFor(MINE, '8,8,8'), 0));
    expect(eng.status().kind).toBe('conflict');
    expect(eng.refusedGame()).toBeNull();
  });

  it('a foreign log that would be IGNORED anyway needs no gate — no spurious refusal is recorded', () => {
    // A newcomer's provisional EMPTY log reaching a resident is an ordinary `ignore` (nothing to adopt).
    // Recording that as a "refusal" would turn normal entry traffic into noise on the diagnostic.
    const eng = engineWith({ kind: 'resume', uuid: MINE, headHash: 'hh' }, logFor(MINE, '4,4,4'));
    eng.receive(toSyncMessage(emptyLog(THEIRS), 0));
    expect(eng.refusedGame()).toBeNull();
    expect(eng.game().uuid).toBe(MINE);
    expect(eng.game().ply()).toBe(1);
  });

  it('the gate applies ACROSS generations too — a higher epoch is not a licence to push a game', () => {
    // `decideSyncEpoched` adopts a higher-epoch log outright, so without the gate stamping any epoch on
    // a payload would bypass every rule. Both shapes are covered, because an EMPTY foreign log at a
    // high epoch is the one that slips past a seed check (`new` and `defer` both accept empty games):
    // it silently replaced a live board until the rule stopped asking only about the seed.
    for (const seed of [{ kind: 'new' } as Proposal, { kind: 'defer' } as Proposal]) {
      const withHistory = engineWith(seed, logFor(MINE, '4,4,4', '5,5,5'));
      withHistory.receive(toSyncMessage(logFor(THEIRS), 99)); // an EMPTY stranger game at generation 99
      expect(withHistory.game().uuid).toBe(MINE);
      expect(withHistory.game().ply()).toBe(2);
      expect(withHistory.refusedGame()).toEqual({ uuid: THEIRS, reason: 'game-mismatch' });

      const nonEmpty = engineWith(seed);
      nonEmpty.receive(toSyncMessage(logFor(THEIRS, '0,0,0', '1,1,1'), 99));
      expect(nonEmpty.game().uuid).toBe(seed.kind === 'new' ? MINE : THEIRS);
    }
    // …and an AGREED session refuses the high-epoch empty game whatever its board holds.
    const agreed = engineWith({ kind: 'defer' });
    agreed.agreeOn(MINE);
    agreed.receive(toSyncMessage(logFor(THEIRS), 99));
    expect(agreed.game().uuid).toBe(MINE);
    expect(agreed.refusedGame()).toEqual({ uuid: THEIRS, reason: 'seed-refused' });
  });

  it('refusedGame reports the LATEST refusal and starts as null', () => {
    const eng = engineWith({ kind: 'new' });
    expect(eng.refusedGame()).toBeNull();
    eng.receive(toSyncMessage(logFor('game-x', '0,0,0'), 0));
    expect(eng.refusedGame()).toEqual({ uuid: 'game-x', reason: 'seed-refused' });
    eng.receive(toSyncMessage(logFor('game-y', '1,1,1'), 0));
    expect(eng.refusedGame()).toEqual({ uuid: 'game-y', reason: 'seed-refused' });
  });
});

/**
 * The gate a LIVE session actually runs under: the game the pair AGREED on, and the pair's own next
 * generation — the two things the entry seed alone could not express, and the two holes that made it
 * wrong in both directions.
 *
 *  - A seed that accepts everything (`defer` — what Join and every auto-reconnect send) went on
 *    accepting everything for the whole session, so any publisher could move an agreed pair off its
 *    game at any time.
 *  - A seed that accepts one uuid (`resume`/`current`) refused the pair's OWN rematch — whose uuid is
 *    derived, so it is a different one — and the two peers deadlocked on two games, each ignoring the
 *    other's moves. That is the bricked-game class this epic exists to remove.
 */
describe('SyncEngine.receive — the AGREED game and our own next generation (design §3, N.2)', () => {
  let db: IDBDatabase;
  const meta = { players: { white: 'w', black: 'b' }, startedAt: 1000 };
  const MINE = 'settled-game';
  const THEIRS = 'stranger-game';

  beforeEach(async () => {
    db = await openDatabase(`agreed-${Math.random().toString(36).slice(2)}`);
  });

  function logFor(uuid: string, ...nodes: string[]): EventLog {
    let log = emptyLog(uuid);
    for (const node of nodes) log = append(log, { type: 'place', node });
    return log;
  }

  function engineWith(seed: Proposal, mine: EventLog = emptyLog(MINE)): SyncEngine {
    const hub = new MockRelayHub();
    const t = new MockTransport(hub, 'peer-self');
    return new SyncEngine(Game.fromLog(9, mine), t, db, () => meta, 'white', seed);
  }

  /** The same engine with its transport CONNECTED — needed by anything that publishes (reset/undo). */
  async function connectedEngineWith(seed: Proposal, mine: EventLog = emptyLog(MINE)): Promise<SyncEngine> {
    const eng = engineWith(seed, mine);
    await eng.connect(`agreed-room-${Math.random().toString(36).slice(2)}`);
    return eng;
  }

  it('a `resume`/`current` seed ADOPTS the pair’s own next generation (the rematch it used to refuse)', () => {
    for (const kind of ['resume', 'current'] as const) {
      const eng = engineWith({ kind, uuid: MINE, headHash: 'hh' }, logFor(MINE, '4,4,4'));
      eng.agreeOn(MINE);
      const next = rematchGameUuid(MINE, 1); // exactly what `resetForRematch` derives at generation 1
      let changes = 0;
      eng.onChange(() => changes++);

      eng.receive(toSyncMessage(emptyLog(next), 1));

      expect(eng.game().uuid).toBe(next);
      expect(eng.game().ply()).toBe(0);
      expect(eng.epoch()).toBe(1);
      expect(eng.refusedGame()).toBeNull();
      expect(changes).toBe(1);
    }
  });

  it('a next generation that ALREADY HAS a move is adopted too (we may hear about it late)', () => {
    // The peer that reset first can move before we have caught up; refusing a non-empty next
    // generation would strand us on the finished game with no way back.
    const eng = engineWith({ kind: 'resume', uuid: MINE, headHash: 'hh' }, logFor(MINE, '4,4,4'));
    eng.agreeOn(MINE);
    const next = rematchGameUuid(MINE, 1);
    eng.receive(toSyncMessage(logFor(next, '0,0,0'), 1));
    expect(eng.game().uuid).toBe(next);
    expect(eng.game().ply()).toBe(1);
    expect(eng.refusedGame()).toBeNull();
  });

  it('…and the NEXT rematch derives from the game we adopted, so a staggered pair keeps converging', () => {
    const eng = engineWith({ kind: 'resume', uuid: MINE, headHash: 'hh' }, logFor(MINE, '4,4,4'));
    eng.agreeOn(MINE);
    const gen1 = rematchGameUuid(MINE, 1);
    eng.receive(toSyncMessage(emptyLog(gen1), 1));
    const gen2 = rematchGameUuid(gen1, 2); // derived from the game we are on NOW, not from MINE
    eng.receive(toSyncMessage(emptyLog(gen2), 2));
    expect(eng.game().uuid).toBe(gen2);
    expect(eng.epoch()).toBe(2);
    expect(eng.refusedGame()).toBeNull();
  });

  it('a game claiming our derivation at our CURRENT generation is NOT a next generation — refused', () => {
    // A reset only ever INCREMENTS the generation, so "derived, at the epoch we are already in" is not
    // our next game. Without the higher-generation requirement it would be a free board wipe.
    const eng = engineWith({ kind: 'resume', uuid: MINE, headHash: 'hh' }, logFor(MINE, '4,4,4'));
    eng.agreeOn(MINE);
    const forged = rematchGameUuid(MINE, 0);
    eng.receive(toSyncMessage(logFor(forged, '0,0,0'), 0));
    expect(eng.game().uuid).toBe(MINE);
    expect(eng.game().ply()).toBe(1);
    expect(eng.refusedGame()).toEqual({ uuid: forged, reason: 'game-mismatch' });
  });

  it('an UNRELATED empty game at a higher generation is refused — only OUR derivation may use that road', () => {
    const eng = engineWith({ kind: 'defer' }, logFor(MINE, '4,4,4'));
    eng.agreeOn(MINE);
    eng.receive(toSyncMessage(emptyLog(THEIRS), 7));
    expect(eng.game().uuid).toBe(MINE);
    expect(eng.game().ply()).toBe(1);
    expect(eng.refusedGame()).toEqual({ uuid: THEIRS, reason: 'seed-refused' });
  });

  it('the AGREED game is adopted WHOLESALE — the deferring arbiter lands on the newcomer’s game', () => {
    // The arbiter agreed onto a game it does NOT hold (design §3, the dealer's-choice row with the
    // deferrer arbitrating), so the prefix policy has nothing to say: the two logs belong to different
    // games. Agreeing is the decision; the bytes just arrive.
    const eng = engineWith({ kind: 'defer' });
    eng.agreeOn(THEIRS);
    eng.receive(toSyncMessage(logFor(THEIRS, '0,0,0', '1,1,1'), 0));
    expect(eng.game().uuid).toBe(THEIRS);
    expect(eng.game().ply()).toBe(2);
    expect(eng.refusedGame()).toBeNull();
    // …and having landed on it, a THIRD game is still refused: agreeing is not "adopt anything once".
    eng.receive(toSyncMessage(logFor('third-game', '2,2,2'), 0));
    expect(eng.game().uuid).toBe(THEIRS);
    expect(eng.refusedGame()).toEqual({ uuid: 'third-game', reason: 'game-mismatch' });
  });

  it('the AGREED game is adopted even EMPTY at our own generation — convergence never waits for a move', () => {
    // The pair agreed on a game with no moves in it yet (a `resume` of a game whose log is still
    // empty). Nothing about the LOGS can tell the two apart — an empty log teaches nothing — so only
    // the agreement can put us on it. Waiting for somebody to move instead is the #42 class of bug the
    // derived/agreed identity exists to kill: until then the two peers sit on two different games.
    const eng = engineWith({ kind: 'defer' }); // our own fresh empty game, generation 0
    eng.agreeOn(THEIRS);
    eng.receive(toSyncMessage(emptyLog(THEIRS), 0));
    expect(eng.game().uuid).toBe(THEIRS);
    expect(eng.refusedGame()).toBeNull();
  });

  it('an ENTRY seed still adopts a foreign game only while we hold NO history of our own', () => {
    // `defer` says "I'll take whichever game we start on" — never "throw away the moves I have". The
    // empty-board case is the dealer's-choice row and still adopts; the mid-game case is refused.
    const empty = engineWith({ kind: 'defer' });
    empty.receive(toSyncMessage(logFor(THEIRS, '0,0,0'), 0));
    expect(empty.game().uuid).toBe(THEIRS);
    expect(empty.refusedGame()).toBeNull();

    const played = engineWith({ kind: 'defer' }, logFor(MINE, '4,4,4'));
    played.receive(toSyncMessage(logFor(THEIRS, '0,0,0'), 5));
    expect(played.game().uuid).toBe(MINE);
    expect(played.game().ply()).toBe(1);
    expect(played.refusedGame()).toEqual({ uuid: THEIRS, reason: 'game-mismatch' });
  });

  it('a foreign log from a SUPERSEDED generation is ignored outright — not adopted, not a refusal', () => {
    // Stale traffic changes nothing either way, so recording it as a refusal would be noise on the
    // diagnostic; adopting it would let a lagging publisher drag us backwards onto its game.
    const eng = engineWith({ kind: 'defer' });
    eng.agreeOn(MINE);
    eng.receive(toSyncMessage(emptyLog(rematchGameUuid(MINE, 1)), 1)); // → generation 1
    expect(eng.epoch()).toBe(1);
    eng.receive(toSyncMessage(logFor(THEIRS, '0,0,0', '1,1,1'), 0)); // an older generation
    expect(eng.game().uuid).toBe(rematchGameUuid(MINE, 1));
    expect(eng.refusedGame()).toBeNull();
  });

  it('resetGame re-points the agreement at the fresh generation (a stranger cannot follow us there)', async () => {
    const eng = await connectedEngineWith({ kind: 'defer' }, logFor(MINE, '4,4,4'));
    eng.agreeOn(MINE);
    const next = rematchGameUuid(MINE, 1);
    eng.resetGame(new Game(9, next), 'black');
    expect(eng.game().uuid).toBe(next);
    // The stranger's game is refused against the game we are on NOW…
    eng.receive(toSyncMessage(logFor(THEIRS, '0,0,0'), 1));
    expect(eng.game().uuid).toBe(next);
    expect(eng.refusedGame()).toEqual({ uuid: THEIRS, reason: 'game-mismatch' });
    // …while the fresh generation's own traffic flows normally (same game → ordinary convergence).
    eng.receive(toSyncMessage(logFor(next, '0,0,0'), 1));
    expect(eng.game().ply()).toBe(1);
  });

  it('reseat re-bases the restricted undo on the seat we own in the game we moved onto', async () => {
    // An admission that moves us onto a peer's game gives us THAT game's colour. Left on the abandoned
    // game's colour, the undo rule would let this client undo the OPPONENT's move.
    const eng = await connectedEngineWith({ kind: 'defer' });
    eng.agreeOn(THEIRS);
    eng.receive(toSyncMessage(logFor(THEIRS, '0,0,0'), 0)); // one WHITE move on the adopted game
    // Constructed as 'white', so before re-seating this engine believes the last move was its own.
    expect(() => eng.undo()).not.toThrow();
    expect(eng.game().ply()).toBe(0);

    const black = await connectedEngineWith({ kind: 'defer' });
    black.agreeOn(THEIRS);
    black.receive(toSyncMessage(logFor(THEIRS, '0,0,0'), 0));
    black.reseat('black');
    expect(() => black.undo()).toThrow(/not-your-move/);
  });
});
