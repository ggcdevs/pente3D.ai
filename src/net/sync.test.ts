import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { Game } from '../core/game';
import { emptyLog, append, headHash, type EventLog } from '../core/eventLog';
import { openDatabase } from '../persist/db';
import { loadConflicted } from '../persist/archive';
import { MockRelayHub, MockTransport, type Transport, type TransportMessage } from './transport';
import {
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
import { reconcile } from './reconcile';
import type { Proposal } from './admission';
import type { Player } from '../core/gameState';

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

    it('carries the two known publish TAGS through the wire, and strips anything else', () => {
      // The tag is what terminates the divergence-answer exchange and what closes a settled
      // divergence on the peer, so it has to survive JSON — and an unknown/hostile value must read
      // as a plain ANNOUNCE rather than as either of them.
      for (const tag of ['answering', 'settled'] as const) {
        const tagged = toSyncMessage(logOf('0,0,0'), 0, tag);
        expect(tagged.tag).toBe(tag);
        const wire = JSON.parse(JSON.stringify(tagged)) as unknown;
        expect(parseGameMessage(wire)).toEqual(tagged);
      }
      // An ordinary announce carries NO tag key at all (not `tag: undefined`).
      expect(Object.hasOwn(toSyncMessage(logOf('0,0,0')), 'tag')).toBe(false);
      // Unknown / wrong-typed / truthy-but-not-a-tag values are all dropped.
      for (const hostile of ['ANSWERING', 'ack', true, 1, {}, null]) {
        const parsed = parseGameMessage({ ...toSyncMessage(logOf('0,0,0')), tag: hostile });
        if (parsed.kind !== 'sync') throw new Error('expected sync');
        expect(parsed.tag).toBeUndefined();
      }
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
    // A is BLACK here: the resumed board's single move is WHITE's, so it is a move A could not have
    // made — which is exactly what the v3.1 fast-forward requires (design §5). Were A white, the
    // entry would be one A itself was entitled to add, and refusing it is the point of the rule.
    const a = new SyncEngine(new Game(9, PAIR_UUID), ta, db, () => meta, 'black', ANY_SEED);
    const bProvisional = new SyncEngine(new Game(9, 'b-prov-x'), tb, db, () => meta, 'white', ANY_SEED);
    await a.connect('adopt-room-x');
    await bProvisional.connect('adopt-room-x');

    // B adopts a game that ALREADY has one white move (the resumed board), then attaches.
    const resumed = Game.fromLog(9, logOf('4,4,4'));
    const bAdopted = new SyncEngine(resumed, tb, db, () => meta, 'white', ANY_SEED);
    bAdopted.attach();

    // attach()'s publish carried B's one-move log to A, which fast-forwards onto it → renders.
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

  it('ANSWERS a peer that is ONE behind with our log, and stays silent on an equal one', async () => {
    // Design §5: "I am ahead → republish, do not adopt". Convergence must not rest on the single
    // unacknowledged QoS-0 publish a returning peer makes: if that one message is lost, nothing
    // retries and both peers sit waiting on each other — issue #45 with the roles swapped (it was
    // measured failing ~10% of real-relay runs). A peer that is one behind publishes its shorter
    // log; we answer with ours, and it fast-forwards on the reply.
    const hub = new MockRelayHub();
    const mine = new MockTransport(hub, 'ahead');
    const theirs = new MockTransport(hub, 'behind');
    await mine.connect('ROOM01');
    await theirs.connect('ROOM01');
    const heard: TransportMessage[] = [];
    theirs.onMessage((m) => heard.push(m));

    const eng = new SyncEngine(new Game(9, PAIR_UUID), mine, db, () => meta, 'white', ANY_SEED);
    eng.place([0, 0, 0]);
    eng.receive(toSyncMessage(logOf('0,0,0', '1,1,1')));
    expect(eng.game().ply()).toBe(2);
    heard.length = 0;

    // A log one entry short of ours (our reply is the move they are missing) → we answer with OUR log.
    eng.receive(toSyncMessage(logOf('0,0,0')));
    expect(heard).toHaveLength(1);
    expect(parseSyncMessage(heard[0] as SyncMessage)).toEqual(eng.game().log);

    // An EQUAL log is a plain replay: answering it would ping-pong between two peers forever.
    heard.length = 0;
    eng.receive(toSyncMessage(eng.game().log));
    expect(heard).toHaveLength(0);

    // A SUPERSEDED generation is behind however much history it carries: this stale log is LONGER
    // than ours, and it still gets our (newer-generation) answer — otherwise a peer left on the old
    // game after an in-place reset would sit there forever, which is the same brick in a new costume.
    eng.resetGame(new Game(9, PAIR_UUID), 'white');
    expect(eng.epoch()).toBe(1);
    heard.length = 0;
    eng.receive(toSyncMessage(logOf('0,0,0', '1,1,1', '2,2,2'), 0));
    expect(heard).toHaveLength(1);
    expect(parseSyncMessage(heard[0] as SyncMessage)).toEqual(eng.game().log);
  });

  it('does NOT adopt from a peer TWO behind — it records the divergence and ANSWERS so the peer sees it too', async () => {
    // The turn gate cannot produce a two-move gap between peers playing the same game, so this is
    // already anomalous: v3 would have quietly served it (or, the other way round, quietly adopted).
    // v3.1 keeps the game exactly as it is and files the ancestor + diff for the players (V.4b).
    //
    // It DOES put our log back on the wire, on EVERY announce from the peer. Staying silent here
    // (V.4a's behaviour) left the divergence visible only to the side that is AHEAD: the behind peer
    // saw an ordinary board while it was missing moves. Answering makes it run the same policy on the
    // same two logs, so both players are told.
    const hub = new MockRelayHub();
    const mine = new MockTransport(hub, 'ahead2');
    const theirs = new MockTransport(hub, 'behind2');
    await mine.connect('ROOM02');
    await theirs.connect('ROOM02');
    const heard: TransportMessage[] = [];
    theirs.onMessage((m) => heard.push(m));

    const eng = new SyncEngine(new Game(9, PAIR_UUID), mine, db, () => meta, 'white', ANY_SEED);
    eng.place([0, 0, 0]);
    eng.receive(toSyncMessage(logOf('0,0,0', '1,1,1')));
    eng.place([2, 2, 2]);
    const headBefore = headHash(eng.game().log);
    heard.length = 0;

    eng.receive(toSyncMessage(logOf('0,0,0')));
    // Answered with our own (unchanged) log — nothing of theirs was taken — and TAGGED as an answer,
    // which is what stops the far side answering it back.
    expect(heard).toHaveLength(1);
    expect(parseSyncMessage(heard[0] as SyncMessage)).toEqual(eng.game().log);
    expect((heard[0] as SyncMessage).tag).toBe('answering');

    // The SAME announce again IS answered again. That repeat is the ONLY retry this system has:
    // the answer is one unacknowledged QoS-0 publish, nothing acks it and nothing re-sends it on a
    // timer, so an answer-once latch meant a single dropped packet left the peer that is MISSING
    // MOVES rendering an ordinary board forever. The peer's own re-announce is the retry.
    heard.length = 0;
    eng.receive(toSyncMessage(logOf('0,0,0')));
    expect(heard).toHaveLength(1);
    expect(parseSyncMessage(heard[0] as SyncMessage)).toEqual(eng.game().log);

    // …but an ANSWER is never answered back — that, not a latch, is what terminates the exchange.
    heard.length = 0;
    eng.receive(toSyncMessage(logOf('0,0,0'), 0, 'answering'));
    expect(heard).toEqual([]);
    // An unknown tag from some future peer reads as a plain announce, so it is answered.
    eng.receive({ ...toSyncMessage(logOf('0,0,0')), tag: 'from-the-future' } as unknown as SyncMessage);
    expect(heard).toHaveLength(1);

    heard.length = 0;
    expect(headHash(eng.game().log)).toBe(headBefore);
    expect(eng.status().kind).toBe('ok'); // one-sided: a real history, not a fork — nothing stops
    const pending = eng.needsResolution();
    expect(pending?.lca).toEqual({ ply: 1, hash: headHash(logOf('0,0,0')) });
    expect(pending?.diff.mine.map((m) => m.text)).toEqual([
      'black plays 1,1,1',
      'white plays 2,2,2',
    ]);
    expect(pending?.diff.theirs).toEqual([]);

    // …and once they catch up to WITHIN the turn gate's one move, the divergence is over: the record
    // does not linger as a false alarm. (An EXACTLY-equal log no longer clears it, deliberately: the
    // live relay delivers our own publishes back to us, so "a log identical to mine" is nearly always
    // our own echo — see the `in-sync` arm. A peer that has genuinely come back onto our history says
    // so with a log we can answer, which is this one.)
    eng.receive(toSyncMessage(logOf('0,0,0', '1,1,1')));
    expect(eng.needsResolution()).toBeNull();
  });

  it('a RESET drops the divergence with the game it was about — never a prompt for a game we left', async () => {
    // The head-equality clear can never see this one: the heads of two different games never meet,
    // so a record kept only until "the histories agree" would outlive the game forever. The V.4b
    // panel renders exactly this record, and it must not offer take-mine / take-theirs / rewind for
    // a game this client is no longer on.
    const hub = new MockRelayHub();
    const t = new MockTransport(hub, 'reset-clears');
    await t.connect('ROOM-RESET-CLEARS');
    const eng = new SyncEngine(new Game(9, PAIR_UUID), t, db, () => meta, 'white', ANY_SEED);
    eng.place([0, 0, 0]);
    eng.receive(toSyncMessage(logOf('0,0,0', '1,1,1', '2,2,2'))); // two ahead → a divergence
    expect(eng.needsResolution()?.theirs.uuid).toBe(PAIR_UUID);

    eng.resetGame(new Game(9, RESET_UUID), 'black');

    expect(eng.game().uuid).toBe(RESET_UUID);
    expect(eng.needsResolution()).toBeNull();
  });

  it('CROSSING onto another game drops the divergence too (adopt, not just reset)', async () => {
    // The same staleness by the other route: the pair's next generation arrives on the wire and we
    // adopt it. `adopt` replaces the game wholesale, so a record keyed to the old one would survive
    // every subsequent mutation of the new one.
    const hub = new MockRelayHub();
    const t = new MockTransport(hub, 'cross-clears');
    await t.connect('ROOM-CROSS-CLEARS');
    const eng = new SyncEngine(new Game(9, PAIR_UUID), t, db, () => meta, 'white', ANY_SEED);
    eng.place([0, 0, 0]);
    eng.receive(toSyncMessage(logOf('0,0,0', '1,1,1', '2,2,2')));
    expect(eng.needsResolution()?.theirs.uuid).toBe(PAIR_UUID);

    eng.receive(toSyncMessage(emptyLog(RESET_UUID), 1)); // our own next generation, off the wire

    expect(eng.game().uuid).toBe(RESET_UUID);
    expect(eng.needsResolution()).toBeNull();
  });

  it('a local move during an OPEN divergence is still legal — it escalates to a fork, which is RECOVERABLE', async () => {
    // The V.4b decision, pinned: a ONE-SIDED divergence does not gate local play. Playing on is
    // accepted and converts it into a genuine fork, which DOES stop the game and archive both
    // histories — playing on an unsettled split is exactly what deepens it. What V.4b changed is
    // that the stop is no longer a TERMINUS: an agreed resolution lifts it (asserted at the end),
    // and the player is told rather than left guessing, because the detecting side answers the peer.
    // Under v3 this log was auto-adopted and neither outcome existed.
    const hub = new MockRelayHub();
    const t = new MockTransport(hub, 'open-divergence');
    await t.connect('ROOM-OPEN-DIVERGENCE');
    const eng = new SyncEngine(new Game(9, PAIR_UUID), t, db, () => meta, 'black', ANY_SEED);
    eng.receive(toSyncMessage(logOf('0,0,0'))); // white's move: the one fast-forward that IS allowed
    const twoAhead = logOf('0,0,0', '1,1,1', '2,2,2');
    eng.receive(toSyncMessage(twoAhead)); // two ahead → recorded, nothing adopted, nothing stopped
    expect(eng.needsResolution()?.diff.theirs.map((m) => m.text)).toEqual([
      'black plays 1,1,1',
      'white plays 2,2,2',
    ]);
    expect(eng.status().kind).toBe('ok');

    // The window: the move is ACCEPTED while the divergence is open (no gate, no throw).
    eng.place([5, 5, 5]);
    expect(eng.game().ply()).toBe(2);
    expect(eng.status().kind).toBe('ok');

    // …and now the peer's very same log is a FORK — both sides played on past the ancestor.
    eng.receive(toSyncMessage(twoAhead));
    expect(eng.status().kind).toBe('conflict');
    await eng.whenSettled();
    expect(eng.conflictForks()?.theirs).toEqual(twoAhead);

    // …and it is recoverable: an agreed resolution lifts the stop and the game plays on.
    expect(eng.applyResolution('rewind-to-lca')).toBe(true);
    expect(eng.status()).toEqual({ kind: 'ok' });
    expect(eng.needsResolution()).toBeNull();
    expect(headHash(eng.game().log)).toBe(headHash(logOf('0,0,0')));
    eng.place([5, 5, 5]);
    expect(eng.game().state().pieces['5,5,5']).toBe('black');
  });

  it('REFUSES to adopt a peer TWO ahead, however clean its prefix looks', async () => {
    const hub = new MockRelayHub();
    const t = new MockTransport(hub, 'behind3');
    await t.connect('ROOM03');
    const eng = new SyncEngine(new Game(9, PAIR_UUID), t, db, () => meta, 'black', ANY_SEED);
    eng.receive(toSyncMessage(logOf('0,0,0')));
    expect(eng.game().ply()).toBe(1); // one move: the fast-forward that IS allowed

    eng.receive(toSyncMessage(logOf('0,0,0', '1,1,1', '2,2,2')));
    expect(eng.game().ply()).toBe(1); // two more: refused, the board does not move
    expect(eng.game().state().pieces['2,2,2']).toBeUndefined();
    expect(eng.needsResolution()?.diff.theirs.map((m) => m.text)).toEqual([
      'black plays 1,1,1',
      'white plays 2,2,2',
    ]);
  });

  it('REFUSES a fabricated HIGHER epoch on our own game — a live board is not wiped by an integer', async () => {
    // Through the PUBLIC seam, with a message that is well-formed on the wire (`toSyncMessage`
    // recomputes `headHash`), so any peer on the publicly-writable relay can produce it. `epoch` is
    // sender-supplied and survives `normalizeEpoch` intact; adopting on it alone was an unbounded
    // bypass of the whole one-move policy — no prefix, no entitlement, no length cap.
    const hub = new MockRelayHub();
    const t = new MockTransport(hub, 'epoch-wipe');
    await t.connect('ROOM-EPOCH');
    const eng = new SyncEngine(new Game(9, PAIR_UUID), t, db, () => meta, 'black', ANY_SEED);
    eng.receive(toSyncMessage(logOf('0,0,0')));
    eng.place([1, 1, 1]);
    eng.receive(toSyncMessage(logOf('0,0,0', '1,1,1', '2,2,2')));
    expect(eng.game().ply()).toBe(3);
    const headBefore = headHash(eng.game().log);

    // (a) an EMPTY log at generation 999: the board survives, and the anomaly is RECORDED.
    eng.receive({ ...toSyncMessage(emptyGameLog()), epoch: 999 });
    expect(eng.game().ply()).toBe(3);
    expect(headHash(eng.game().log)).toBe(headBefore);
    expect(eng.needsResolution()?.lca.ply).toBe(0);
    expect(eng.needsResolution()?.diff.theirs).toEqual([]);

    // (b) an unrelated 3-ply FORK at a high generation: still refused, and now flagged as the fork
    // it is (the epoch used to make forks unrecognizable — "across generations there are none").
    eng.receive({ ...toSyncMessage(logOf('4,4,4', '3,3,3', '2,2,2')), epoch: 1000 });
    expect(headHash(eng.game().log)).toBe(headBefore);
    expect(eng.game().state().pieces['4,4,4']).toBeUndefined();
    expect(eng.status().kind).toBe('conflict');
  });

  it('CONVERGES the generation counter on the game we are on, without giving up our history for it', async () => {
    // The counter must still meet, or the lower peer's every publish comes back `superseded` and its
    // moves are never adopted. Converging the NUMBER is safe precisely because the number no longer
    // authorizes an adopt: we take their generation AND keep our board.
    const hub = new MockRelayHub();
    const t = new MockTransport(hub, 'epoch-converge');
    await t.connect('ROOM-CONVERGE');
    const eng = new SyncEngine(new Game(9, PAIR_UUID), t, db, () => meta, 'black', ANY_SEED);
    eng.receive(toSyncMessage(logOf('0,0,0'))); // white's move: adopted, now black to play
    eng.place([1, 1, 1]);
    expect(eng.epoch()).toBe(0);

    // (a) an EQUAL log stamped with a higher generation: there is nothing to adopt, so the COUNTER is
    // the only thing that can move — and it must. This is the both-peers-rematched case: one game,
    // one history, two counters that ran apart through an adoption.
    eng.receive({ ...toSyncMessage(eng.game().log), epoch: 4 });
    expect(eng.epoch()).toBe(4);
    expect(eng.game().ply()).toBe(2); // history untouched: the number bought them nothing

    // (b) the ordinary one-move fast-forward still adopts under a higher generation…
    eng.receive({ ...toSyncMessage(logOf('0,0,0', '1,1,1', '2,2,2')), epoch: 5 });
    expect(eng.game().ply()).toBe(3); // adopted on its own merits (the one-move rule)
    expect(eng.epoch()).toBe(5);

    // (c) …and a message from BELOW the converged generation is the stale one: never adopted.
    eng.receive({ ...toSyncMessage(logOf('0,0,0', '1,1,1', '2,2,2', '3,3,3')), epoch: 4 });
    expect(eng.game().ply()).toBe(3);
    expect(eng.epoch()).toBe(5);
  });

  it('a SUPERSEDED-generation message settles NOTHING — a stale log cannot close a live divergence', async () => {
    // `republish` is reached for TWO different reasons and only one of them is a statement about the
    // two histories. `one-ahead` means their log is our own history minus its last entry, so the
    // disagreement really is over. `superseded-generation` is decided on `theirEpoch < myEpoch`
    // ALONE — the logs are never compared — and the counter it is measured against is a
    // sender-supplied number any publisher on this relay can pin (the tests above). So a forked log
    // stamped with a low epoch must leave the record exactly where it was: dropping it would close
    // both players' panels on a question neither of them answered.
    const hub = new MockRelayHub();
    const mine = new MockTransport(hub, 'superseded-mine');
    const peer = new MockTransport(hub, 'superseded-peer');
    await mine.connect('ROOM-SUPERSEDED');
    await peer.connect('ROOM-SUPERSEDED');
    const heard: TransportMessage[] = [];
    peer.onMessage((m) => heard.push(m));

    const eng = new SyncEngine(new Game(9, PAIR_UUID), mine, db, () => meta, 'black', ANY_SEED);
    eng.receive(toSyncMessage(logOf('0,0,0'))); // white's move: the one fast-forward that IS allowed
    // Two ahead at a HIGH generation: nothing adopted, the divergence recorded, the counter converged.
    eng.receive(toSyncMessage(logOf('0,0,0', '1,1,1', '2,2,2'), 9));
    const open = eng.needsResolution();
    expect(open?.diff.theirs.map((m) => m.text)).toEqual(['black plays 1,1,1', 'white plays 2,2,2']);
    expect(eng.epoch()).toBe(9);
    let fires = 0;
    eng.onChange(() => (fires += 1));
    heard.length = 0;

    // A log that is not our history at all, from below the converged generation → superseded.
    eng.receive(toSyncMessage(logOf('4,4,4', '3,3,3'), 0));

    // The record is still there, unchanged — including the diff the panel renders.
    expect(eng.needsResolution()).toEqual(open);
    expect(eng.needsResolution()?.diff.theirs.map((m) => m.text)).toEqual([
      'black plays 1,1,1',
      'white plays 2,2,2',
    ]);
    // Nothing changed, so nothing was announced, and the stale log took nothing from our board.
    expect(fires).toBe(0);
    expect(eng.game().ply()).toBe(1);
    expect(eng.status().kind).toBe('ok');
    // …and the arm still did its job: our live log went back to the stale peer.
    expect(heard).toHaveLength(1);
    expect(parseSyncMessage(heard[0] as SyncMessage)).toEqual(eng.game().log);
  });

  it('a FORGED epoch pins the counter — and the pair’s own next generation still crosses it', async () => {
    // The cost of converging on a sender-supplied number, stated honestly: ONE well-formed message
    // that adopts nothing (`{...ourOwnLog, epoch: 999}`, exactly what any peer on the publicly
    // writable relay can send) permanently raises our counter. What must NOT follow is deafness —
    // the pair's genuine rematch arrives at a LOW generation, and a crossing gated on out-ranking
    // our counter would drop it as stale, leaving the two peers on two games forever.
    const hub = new MockRelayHub();
    const t = new MockTransport(hub, 'epoch-pin');
    await t.connect('ROOM-EPOCH-PIN');
    const eng = new SyncEngine(new Game(9, PAIR_UUID), t, db, () => meta, 'black', ANY_SEED);
    eng.receive(toSyncMessage(logOf('0,0,0')));

    eng.receive({ ...toSyncMessage(eng.game().log), epoch: 999 });
    expect(eng.epoch()).toBe(999); // the number is taken…
    expect(eng.game().ply()).toBe(1); // …and buys no history

    eng.receive(toSyncMessage(emptyLog(RESET_UUID), 1)); // the pair's real rematch, generation 1
    expect(eng.game().uuid).toBe(RESET_UUID);
    expect(eng.game().ply()).toBe(0);
    expect(eng.refusedGame()).toBeNull();
  });

  it('…and a pinned peer RE-CONVERGES with its pair over the relay: same board, same generation', async () => {
    // The end-to-end half, on two real engines over the mock relay: A is pinned at 999, B rematches
    // at generation 1, and the pair must end up on ONE board at ONE generation — not split by the
    // integer. Proof is B's move appearing on A's board, not a log line.
    const { a, b } = await pair();
    a.place([0, 0, 0]);
    a.receive({ ...toSyncMessage(a.game().log), epoch: 999 });
    expect(a.epoch()).toBe(999);
    expect(b.epoch()).toBe(0);

    // B rematches (colours alternate: B was black, so it takes white in the fresh generation).
    b.resetGame(new Game(9, RESET_UUID), 'white');
    expect(a.game().uuid).toBe(RESET_UUID); // A crossed onto it off the wire
    a.reseat('black'); // the seat swap the session performs on a rematch

    b.place([2, 2, 2]);
    expect(a.game().state().pieces['2,2,2']).toBe('white');
    expect(headHash(a.game().log)).toBe(headHash(b.game().log));
    expect(a.epoch()).toBe(b.epoch());
  });

  it('REJECTS a log that does not replay through the rules engine, leaving the game untouched', async () => {
    // The relay is publicly writable and a peer's derived state is never trusted (design §5,
    // Integrity): a one-entry log is fast-forward-SHAPED, but it must still be playable.
    const hub = new MockRelayHub();
    const t = new MockTransport(hub, 'bad-log');
    await t.connect('ROOM04');
    const eng = new SyncEngine(new Game(9, PAIR_UUID), t, db, () => meta, 'black', ANY_SEED);
    // Off the 9³ board: legal-looking, unplayable.
    eng.receive(toSyncMessage(logOf('99,99,99')));
    expect(eng.game().ply()).toBe(0);
    expect(eng.game().log.entries).toEqual([]);
    expect(eng.rejectedLog()).toEqual({
      uuid: PAIR_UUID,
      ply: 0,
      reason: 'illegal-move',
      detail: 'coordinates out of bounds: 99,99,99',
    });
  });

  it('replay-validates a CROSS-GAME adopt too — an unplayable foreign game is refused', async () => {
    const hub = new MockRelayHub();
    const t = new MockTransport(hub, 'bad-foreign');
    await t.connect('ROOM05');
    const eng = new SyncEngine(new Game(9, PAIR_UUID), t, db, () => meta, 'black', {
      kind: 'defer',
    });
    // Dealer's choice adopts a peer's game wholesale — but only one that actually replays.
    let foreign = emptyLog('foreign-game');
    foreign = append(foreign, { type: 'place', node: '0,0,0' });
    foreign = append(foreign, { type: 'place', node: '0,0,0' });
    eng.receive(toSyncMessage(foreign));
    expect(eng.game().log.uuid).toBe(PAIR_UUID);
    expect(eng.rejectedLog()).toEqual({
      uuid: 'foreign-game',
      ply: 1,
      reason: 'illegal-move',
      detail: 'node already occupied: 0,0,0',
    });
  });

  it('a REPLAY never moves us backward, whatever order messages arrive in', async () => {
    // Full-state sync is idempotent by construction: re-delivering a log we have already folded in
    // changes nothing, and a log we are ahead of only draws our own state back out.
    const hub = new MockRelayHub();
    const t = new MockTransport(hub, 'solo');
    await t.connect('ROOM01');
    const eng = new SyncEngine(new Game(9, PAIR_UUID),t, db, () => meta, 'black', ANY_SEED);
    const one = logOf('0,0,0');
    const two = logOf('0,0,0', '1,1,1');
    eng.receive(toSyncMessage(one)); // fast-forward → 1
    eng.receive(toSyncMessage(one)); // exact replay → no change
    expect(eng.game().ply()).toBe(1);
    eng.place([1, 1, 1]); // our own move → 2
    eng.receive(toSyncMessage(one)); // one behind → answered, never adopted
    eng.receive(toSyncMessage(two)); // the same log we already hold → no change
    expect(eng.game().ply()).toBe(2);
    expect(headHash(eng.game().log)).toBe(headHash(two));
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
    // Fork B onto history [3,3,3, 2,2,2]; A forks onto [0,0,0] → conflict stops B.
    ea.placeLocalOnly([0, 0, 0]);
    eb.placeLocalOnly([3, 3, 3]);
    eb.placeLocalOnly([2, 2, 2]);
    await ea.connect('freeze-room');
    await eb.connect('freeze-room');
    ea.publishState();
    expect(eb.status().kind).toBe('conflict');

    const frozenHead = headHash(eb.game().log);
    const frozenPly = eb.game().ply();
    expect(frozenPly).toBe(2); // B is stopped on its own 2-move fork.

    // Craft a message shaped EXACTLY like the one case that auto-adopts: one entry longer
    // than B's frozen log, with that log as its prefix, and (B being black at an even ply)
    // white's move to make. If receive() were NOT guarded, this would REPLACE B's game —
    // mutating the supposedly-frozen game. Deliver it straight through the PUBLIC receive()
    // seam (the transport pump routes here too).
    const strictExtension = logOf('3,3,3', '2,2,2', '4,4,4');
    // Sanity: this really is a fast-forward-shaped message for B's current log (proves the
    // negative test would fail the guard — not a message the policy would ignore anyway).
    expect(reconcile(eb.game(), strictExtension, 'black')).toEqual({
      action: 'fast-forward',
      reason: 'one-move',
    });
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
    // BOTH clients apply the agreed action — that is the #18 flow (`NetSession.applyAcceptedUndoRedo`
    // runs on each side), and it is what makes the two logs converge: the same event appended to the
    // same history yields the same hash. B (black — NOT the last mover) steps back unconditionally
    // and publishes; A does the same.
    b.applyAgreedUndo();
    expect(b.game().ply()).toBe(0);
    a.applyAgreedUndo();
    // PROOF-BY-BEHAVIOR (#3): both boards really stepped back, onto the SAME history.
    expect(a.game().ply()).toBe(0);
    expect(a.game().state().pieces['0,0,0']).toBeUndefined();
    expect(headHash(a.game().log)).toBe(headHash(b.game().log));
    // A did not auto-adopt the undo B published: an undo belongs to the player whose move it takes
    // back (white, here A), so B's copy of it is not an entry A may fast-forward onto. Converging on
    // the identical result clears the record, so no false divergence is left behind.
    expect(a.needsResolution()).toBeNull();
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
    const eng = new SyncEngine(new Game(9, PAIR_UUID),t, db, () => meta, 'black', ANY_SEED);
    await eng.connect('no-epoch-room');
    // A legacy-shaped message with NO epoch field (a pre-epoch peer) injected straight into the
    // public receive seam. It must be read as epoch 0 and — since the engine is also at epoch 0 —
    // fast-forward by the ordinary same-generation rule (proves the seam does not trust an unset
    // epoch). The engine is BLACK, so white's single move is the opponent's to make.
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
  async function solo(size = 9, myColor: Player = 'white'): Promise<SyncEngine> {
    const hub = new MockRelayHub();
    const t = new MockTransport(hub, 'chg');
    const eng = new SyncEngine(new Game(size, PAIR_UUID),t, db, () => meta, myColor, ANY_SEED);
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
    const eng = await solo(9, 'black');
    let fires = 0;
    let seenPly = -1;
    eng.onChange(() => {
      fires += 1;
      seenPly = eng.game().ply();
    });
    eng.receive(toSyncMessage(logOf('0,0,0')));
    expect(fires).toBe(1);
    expect(seenPly).toBe(1);
    expect(eng.game().state().pieces['0,0,0']).toBe('white');
  });

  it('does NOT fire when IGNORING a stale/equal replay (no change happened)', async () => {
    // A replay is a genuine no-op: firing here would falsely tell the scene state changed.
    const eng = await solo(9, 'black');
    eng.receive(toSyncMessage(logOf('0,0,0'))); // fast-forward → 1
    let fires = 0;
    eng.onChange(() => (fires += 1));
    eng.receive(toSyncMessage(emptyGameLog())); // one behind → we answer, our game is untouched
    eng.receive(toSyncMessage(eng.game().log)); // equal → in-sync
    expect(fires).toBe(0);
    expect(eng.game().ply()).toBe(1);
  });

  it('a `settled` log fires ONLY when it really closes a divergence we were holding', async () => {
    // The `settled` tag closes an open divergence record on an otherwise-identical log. When there
    // is NO record it must change nothing AND say nothing: an equal log is the most common message
    // on the wire (the live relay echoes our own publishes back to us), and firing on it would be a
    // re-render claiming a state change that did not happen.
    const eng = await solo(9, 'black');
    eng.receive(toSyncMessage(logOf('0,0,0'))); // fast-forward → 1, nothing to resolve
    expect(eng.needsResolution()).toBeNull();
    let fires = 0;
    eng.onChange(() => (fires += 1));
    eng.receive(toSyncMessage(eng.game().log, 0, 'settled'));
    expect(fires).toBe(0);
    expect(eng.game().ply()).toBe(1);

    // Now hold a real divergence and let the peer say it has settled ONTO our history: the record
    // closes and the panel is told, because this time something did change.
    eng.receive(toSyncMessage(logOf('0,0,0', '1,1,1', '2,2,2', '3,3,3')));
    expect(eng.needsResolution()).not.toBeNull();
    fires = 0;
    eng.receive(toSyncMessage(eng.game().log, 0, 'settled'));
    expect(eng.needsResolution()).toBeNull();
    expect(fires).toBe(1);
    // …and it took nothing from the peer to do it: our own history is exactly where it was.
    expect(eng.game().ply()).toBe(1);
  });

  it('a peer CATCHING UP to within one move closes the divergence AND says so', async () => {
    // The `republish`/`one-ahead` arm drops the record when the peer comes back onto our history to
    // within the turn gate's one move. That is a real state change, and it must notify like every
    // other arm that touches the record: `main.ts` re-renders only from `onChange`, so a silent drop
    // left the divergence panel painted over a divergence that no longer exists — offering
    // take-mine / take-theirs buttons that resolve nothing (`proposeResolution` returns `false` once
    // there are no candidates).
    const eng = await solo(9, 'black');
    eng.receive(toSyncMessage(logOf('0,0,0'))); // fast-forward → 1
    eng.receive(toSyncMessage(logOf('0,0,0', '1,1,1', '2,2,2', '3,3,3'))); // three ahead → recorded
    expect(eng.needsResolution()).not.toBeNull();
    let fires = 0;
    let recordAtFire: unknown = 'listener never ran';
    eng.onChange(() => {
      fires += 1;
      recordAtFire = eng.needsResolution();
    });

    eng.receive(toSyncMessage(emptyGameLog())); // one behind us → republish/one-ahead

    expect(eng.needsResolution()).toBeNull();
    expect(fires).toBe(1);
    // The listener saw the CLOSED state — a notification that arrived before the drop would repaint
    // the panel with the record still in it and change nothing on screen.
    expect(recordAtFire).toBeNull();
    // …and nothing was taken from the peer to close it: our own history is where it was.
    expect(eng.game().ply()).toBe(1);
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
    const legacy = toSyncMessage(logOf('0,0,0')) as unknown as Record<string, unknown>;
    const { kind: _dropped, ...unKinded } = legacy;
    void _dropped;
    ta.publish(unKinded as unknown as Parameters<typeof ta.publish>[0]);
    // B (black) fast-forwarded onto the legacy sync payload — its board reflects white's move…
    expect(b.game().state().pieces['0,0,0']).toBe('white');
    expect(b.game().ply()).toBe(1);
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

  it('SAME-game divergence still CONFLICTS (the gate never swallows a real fork)', async () => {
    // Connected because a detected divergence now ANSWERS the peer with our own log (V.4b), so the
    // engine publishes on this path — the divergence has to be mutual or only the peer that is
    // AHEAD ever learns of it.
    const eng = engineWith({ kind: 'new' }, logFor(MINE, '0,0,0'));
    await eng.connect('same-game-fork-room');
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
    // A generation is the only thing an epoch may order, and this gate is where that is enforced for
    // a message naming another game: no number on the wire crosses a game onto us. Both shapes are
    // covered, because an EMPTY foreign log at a high epoch is the one that slips past a seed check
    // (`new` and `defer` both accept empty games):
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

  it('a game claiming our derivation at generation ZERO is not a generation at all — refused', () => {
    // A generation IS a reset, and a reset only ever increments from 0, so nothing is ever derived at
    // generation 0. Without that floor, `rematchGameUuid(ours, 0)` — which any peer can compute from
    // the uuid we publish — would be a free board wipe on a session that has never rematched.
    const eng = engineWith({ kind: 'resume', uuid: MINE, headHash: 'hh' }, logFor(MINE, '4,4,4'));
    eng.agreeOn(MINE);
    const forged = rematchGameUuid(MINE, 0);
    eng.receive(toSyncMessage(logFor(forged, '0,0,0'), 0));
    expect(eng.game().uuid).toBe(MINE);
    expect(eng.game().ply()).toBe(1);
    expect(eng.refusedGame()).toEqual({ uuid: forged, reason: 'game-mismatch' });
  });

  it('our own next generation crosses at ANY generation above 0 — identity decides, not a race of counters', async () => {
    // The counter is sender-supplied (see the forged-epoch tests above), so making the crossing wait
    // for a peer to OUT-RANK it made one forged message enough to strand us: the pair's real rematch
    // arrives at a low generation and would be dropped as stale. The derivation is the gate — it is
    // computed from the game WE are on — so a generation at or below our counter still crosses…
    // Connected, because a message from below the (forged) generation draws a republish.
    const eng = await connectedEngineWith({ kind: 'resume', uuid: MINE, headHash: 'hh' }, logFor(MINE, '4,4,4'));
    eng.agreeOn(MINE);
    eng.receive(toSyncMessage(eng.game().log, 500)); // our own log back at a forged generation
    expect(eng.epoch()).toBe(500);
    eng.receive(toSyncMessage(emptyLog(rematchGameUuid(MINE, 1)), 1));
    expect(eng.game().uuid).toBe(rematchGameUuid(MINE, 1));
    expect(eng.refusedGame()).toBeNull();

    // …while a SIBLING of the game we left does not follow us: now that we are on generation 1, the
    // derivation is taken from ITS uuid, so `rematchGameUuid(MINE, 2)` — derived from the game we
    // left — is just another stranger, however high the generation it wears.
    const sibling = rematchGameUuid(MINE, 2);
    eng.receive(toSyncMessage(logFor(sibling, '0,0,0'), 501));
    expect(eng.game().uuid).toBe(rematchGameUuid(MINE, 1));
    expect(eng.game().ply()).toBe(0);
    expect(eng.refusedGame()).toEqual({ uuid: sibling, reason: 'game-mismatch' });
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

describe('SyncEngine — resolving a divergence (Task V.4b, epic #47, absorbs #38)', () => {
  let db: IDBDatabase;
  const meta = { players: { white: 'w', black: 'b' }, startedAt: 1000 };

  beforeEach(async () => {
    db = await openDatabase(`resolve-test-${Math.random().toString(36).slice(2)}`);
  });

  /** Two engines on one game over a shared relay, both connected. */
  async function pair(room: string): Promise<{ a: SyncEngine; b: SyncEngine }> {
    const hub = new MockRelayHub();
    const a = new SyncEngine(
      new Game(9, PAIR_UUID), new MockTransport(hub, 'res-a'), db, () => meta, 'white', ANY_SEED,
    );
    const b = new SyncEngine(
      new Game(9, PAIR_UUID), new MockTransport(hub, 'res-b'), db, () => meta, 'black', ANY_SEED,
    );
    await a.connect(room);
    await b.connect(room);
    return { a, b };
  }

  /**
   * Drive the pair into a ONE-SIDED divergence: B runs two moves ahead WITHOUT publishing (the turn
   * gate cannot produce this between honest peers, which is exactly why it needs resolving), then
   * puts its log on the wire.
   */
  async function diverged(room: string): Promise<{ a: SyncEngine; b: SyncEngine }> {
    const { a, b } = await pair(room);
    a.place([0, 0, 0]);
    expect(headHash(b.game().log)).toBe(headHash(a.game().log));
    b.placeLocalOnly([1, 1, 1]);
    b.placeLocalOnly([2, 2, 2]);
    b.publishState();
    return { a, b };
  }

  it('BOTH peers see the divergence — the detecting side answers so the behind peer is told too', async () => {
    const { a, b } = await diverged('resolve-mutual');
    // A is two behind and knows it…
    expect(a.needsResolution()?.lca.ply).toBe(1);
    // …and B, which never received anything about it, now knows too — because A answered.
    expect(b.needsResolution()?.lca.ply).toBe(1);
    // Neither adopted anything: A is still on its own move, B on its three.
    expect(a.game().ply()).toBe(1);
    expect(b.game().ply()).toBe(3);
  });

  it('the two peers see MIRRORED candidates (each one’s `mine` is the other’s `theirs`)', async () => {
    const { a, b } = await diverged('resolve-mirror');
    const ca = a.resolutionCandidates()!;
    const cb = b.resolutionCandidates()!;
    expect(ca.mine).toBe(cb.theirs);
    expect(ca.theirs).toBe(cb.mine);
    expect(ca.lca).toBe(cb.lca);
    expect(ca.mine).toBe(headHash(a.game().log));
    expect(ca.theirs).toBe(headHash(b.game().log));
  });

  it('there are no candidates — and nothing to resolve — while the pair agrees', async () => {
    const { a } = await pair('resolve-agreed');
    expect(a.resolutionCandidates()).toBeNull();
    expect(a.applyResolution('keep-mine')).toBe(false);
    expect(a.applyResolution('adopt-theirs')).toBe(false);
  });

  it('AGREEING converges the pair onto ONE history (adopt-theirs + keep-mine)', async () => {
    const { a, b } = await diverged('resolve-converge');
    const theirs = headHash(b.game().log);

    // Each side applies the effect ITS OWN candidates read the agreed head hash as.
    expect(b.applyResolution('keep-mine')).toBe(true);
    expect(a.applyResolution('adopt-theirs')).toBe(true);

    expect(headHash(a.game().log)).toBe(theirs);
    expect(headHash(b.game().log)).toBe(theirs);
    // A really replayed it: the moves are on A's board, not just in its log.
    expect(a.game().state().pieces['1,1,1']).toBe('black');
    expect(a.game().state().pieces['2,2,2']).toBe('white');
    // The divergence is closed on both sides — no lingering card.
    expect(a.needsResolution()).toBeNull();
    expect(b.needsResolution()).toBeNull();
    expect(a.resolutionCandidates()).toBeNull();
  });

  it('keeping MINE puts my log back on the wire so the peer converges onto it', async () => {
    const { a, b } = await diverged('resolve-keep-mine');
    const mine = headHash(a.game().log);
    // A is the one that is BEHIND here; keeping its history is a real choice, not a no-op.
    expect(a.applyResolution('keep-mine')).toBe(true);
    expect(headHash(a.game().log)).toBe(mine);
    // B receives it. It is still diverged, so it does not adopt automatically — but once B applies
    // the agreed effect on ITS side, the two are one history.
    expect(b.applyResolution('adopt-theirs')).toBe(true);
    expect(headHash(b.game().log)).toBe(mine);
    expect(b.game().ply()).toBe(1);
  });

  it('a FORK is no longer a DEAD END: resolving it lifts the stop and play resumes', async () => {
    const { a, b } = await pair('resolve-fork');
    a.place([0, 0, 0]);
    // Both play on from the shared point without hearing each other — two real histories.
    a.placeLocalOnly([1, 1, 1]);
    b.placeLocalOnly([2, 2, 2]);
    b.publishState();

    expect(a.status().kind).toBe('conflict');
    expect(() => a.place([3, 3, 3])).toThrow(/conflict|stopped/i);
    const open = a.needsResolution()!;
    expect(open.lca.ply).toBe(1);

    // Go back to where they agreed: both cut to the last shared move.
    expect(a.applyResolution('rewind-to-lca')).toBe(true);
    expect(b.applyResolution('rewind-to-lca')).toBe(true);
    expect(a.status()).toEqual({ kind: 'ok' });
    expect(a.conflictForks()).toBeNull();
    expect(headHash(a.game().log)).toBe(open.lca.hash);
    expect(headHash(b.game().log)).toBe(open.lca.hash);
    expect(a.game().ply()).toBe(1);
    // …and the game is live again: a move that was refused a moment ago now lands.
    a.placeLocalOnly([4, 4, 4]);
    expect(a.game().state().pieces['4,4,4']).toBe('black');
  });

  it('the conflicted ARCHIVE record survives a resolution — agreeing never destroys a history', async () => {
    const { a, b } = await pair('resolve-archive');
    a.place([0, 0, 0]);
    const mine = a.game().log;
    a.placeLocalOnly([1, 1, 1]);
    b.placeLocalOnly([2, 2, 2]);
    b.publishState();
    const status = a.status();
    expect(status.kind).toBe('conflict');
    const conflictId = status.kind === 'conflict' ? status.conflictId : '';
    await a.whenSettled();

    expect(a.applyResolution('adopt-theirs')).toBe(true);
    // The history A gave up is still on disk under the conflicted record.
    const loaded = await loadConflicted(db, conflictId);
    expect(loaded?.mine.ply()).toBe(mine.entries.length + 1);
    expect(loaded?.theirs.ply()).toBe(2);
  });

  it('a history that does NOT replay is REFUSED — the honest failure path, not a resolution', async () => {
    const hub = new MockRelayHub();
    const a = new SyncEngine(
      new Game(9, PAIR_UUID), new MockTransport(hub, 'bad-a'), db, () => meta, 'white', ANY_SEED,
    );
    await a.connect('resolve-illegal');
    a.place([0, 0, 0]);
    const before = headHash(a.game().log);
    // Chain-valid but UNPLAYABLE: the third entry re-places an occupied node. Two entries beyond our
    // history, so it lands as a divergence rather than a fast-forward.
    let illegal: EventLog = emptyLog(PAIR_UUID);
    for (const node of ['0,0,0', '1,1,1', '1,1,1']) {
      illegal = append(illegal, { type: 'place', node });
    }
    a.receive(toSyncMessage(illegal, 0));
    expect(a.needsResolution()).not.toBeNull();

    expect(a.applyResolution('adopt-theirs')).toBe(false);
    expect(headHash(a.game().log)).toBe(before);
    expect(a.rejectedLog()).toEqual({
      uuid: PAIR_UUID,
      ply: 2,
      reason: 'illegal-move',
      detail: expect.any(String),
    });
    // The divergence is STILL open — a log we cannot play does not settle anything.
    expect(a.needsResolution()).not.toBeNull();
    expect(a.status()).toEqual({ kind: 'ok' });
  });

  it('publishResolution carries a resolution ask out of a STOPPED game — publishHandshake still will not', async () => {
    const hub = new MockRelayHub();
    const heard: TransportMessage[] = [];
    const listener = new MockTransport(hub, 'listener');
    await listener.connect('resolve-stopped');
    listener.onMessage((m) => heard.push(m));
    const a = new SyncEngine(
      new Game(9, PAIR_UUID), new MockTransport(hub, 'stopped-a'), db, () => meta, 'white', ANY_SEED,
    );
    await a.connect('resolve-stopped');
    a.place([0, 0, 0]);
    a.placeLocalOnly([1, 1, 1]);
    let fork: EventLog = emptyLog(PAIR_UUID);
    for (const node of ['0,0,0', '2,2,2']) fork = append(fork, { type: 'place', node });
    a.receive(toSyncMessage(fork, 0));
    expect(a.status().kind).toBe('conflict');

    const ask: ProposalMessage = {
      kind: 'proposal',
      id: 'res-1',
      action: 'resolve:whatever',
      proposedBy: 'white',
    };
    // The old gate is UNCHANGED for everything else: a stopped game exchanges no rematch/undo traffic.
    expect(() =>
      a.publishHandshake({ kind: 'proposal', id: 'r', action: 'rematch', proposedBy: 'white' }),
    ).toThrow(/conflict|stopped/i);
    heard.length = 0;
    a.publishResolution(ask);
    expect(heard).toContainEqual(ask);
    // …and the exception is NARROW, not a hole: this seam refuses to carry anything but a resolution,
    // so it can never be used to smuggle a rematch/undo ask past the stop.
    expect(() =>
      a.publishResolution({ kind: 'proposal', id: 'r2', action: 'rematch', proposedBy: 'white' }),
    ).toThrow(/not a resolution/i);
    expect(heard).toHaveLength(1);
  });
});

describe('SyncEngine — the divergence answer TERMINATES on a relay that echoes our own publishes', () => {
  let db: IDBDatabase;
  const meta = { players: { white: 'w', black: 'b' }, startedAt: 1000 };

  beforeEach(async () => {
    db = await openDatabase(`echo-test-${Math.random().toString(36).slice(2)}`);
  });

  /**
   * A relay that behaves like the REAL one: it delivers every publish to the peer AND BACK TO THE
   * SENDER. MQTT 3.1.1 has no `noLocal`, and the live broker was probed to confirm it does exactly
   * this. `MockRelayHub` deliberately does not echo, which is why the ping-pong this test pins was
   * invisible to every mock-transport test and only showed up over the real relay.
   */
  class EchoingRelay {
    readonly peers: EchoingTransport[] = [];
    /** Every message published in this room, in order — the wire, for counting. */
    readonly traffic: TransportMessage[] = [];
    /**
     * QoS-0 LOSS: when this returns true the message is published (it is on `traffic`) and delivered
     * to NOBODY — not even back to its sender. That is the failure the whole answer path has to
     * survive: there is no ack, no retry timer and nothing periodic anywhere in this system, so a
     * dropped answer is simply gone.
     */
    drop: (msg: TransportMessage) => boolean = () => false;
    deliver(msg: TransportMessage): void {
      this.traffic.push(msg);
      if (this.drop(msg)) return;
      // Snapshot first: a handler may publish, and that publish appends to `peers`' inboxes, not here.
      for (const peer of [...this.peers]) peer.receiveFromRelay(msg);
    }
  }

  class EchoingTransport implements Transport {
    private cb: (msg: TransportMessage) => void = () => {};
    constructor(private readonly relay: EchoingRelay) {
      relay.peers.push(this);
    }
    connect(): Promise<void> {
      return Promise.resolve();
    }
    publish(msg: TransportMessage): void {
      this.relay.deliver(JSON.parse(JSON.stringify(msg)) as TransportMessage);
    }
    onMessage(cb: (msg: TransportMessage) => void): void {
      this.cb = cb;
    }
    onPresence(): void {}
    onPeerLive(): void {}
    disconnect(): void {}
    receiveFromRelay(msg: TransportMessage): void {
      this.cb(JSON.parse(JSON.stringify(msg)) as TransportMessage);
    }
  }

  it('two peers exchange a BOUNDED number of logs and BOTH keep the divergence record', async () => {
    const relay = new EchoingRelay();
    const ta = new EchoingTransport(relay);
    const tb = new EchoingTransport(relay);
    const a = new SyncEngine(new Game(9, PAIR_UUID), ta, db, () => meta, 'white', ANY_SEED);
    const b = new SyncEngine(new Game(9, PAIR_UUID), tb, db, () => meta, 'black', ANY_SEED);
    a.attach();
    b.attach();

    // A gets TWO entries ahead of B without B hearing either — beyond the turn gate's one-move cap
    // in BOTH directions, so each side reaches `needs-resolution` rather than the republish mirror.
    a.placeLocalOnly([0, 0, 0]);
    a.placeLocalOnly([1, 1, 1]);
    a.placeLocalOnly([2, 2, 2]);
    b.placeLocalOnly([0, 0, 0]);
    // Everything published up to here is setup; count only the exchange the divergence provokes.
    relay.traffic.length = 0;

    a.publishState();

    // BOUNDED, and exactly so: A's announce and B's ONE answer. The answer is tagged, and no arm
    // answers a tagged answer, so nothing bounces — including A's own publish coming straight back
    // off the echoing relay, which is `in-sync` and silent.
    expect(relay.traffic.length).toBe(2);
    expect(relay.traffic.map((m) => (m as SyncMessage).tag)).toEqual([undefined, 'answering']);
    // BOTH sides are holding the divergence, at the same shared point — the asymmetry V.4a left.
    expect(a.needsResolution()?.lca.ply).toBe(1);
    expect(b.needsResolution()?.lca.ply).toBe(1);
    expect(a.resolutionCandidates()).not.toBeNull();
    expect(b.resolutionCandidates()).not.toBeNull();
    // Neither adopted anything.
    expect(a.game().ply()).toBe(3);
    expect(b.game().ply()).toBe(1);

    // Re-announcing the same log IS answered again, every time, and still terminates: two more
    // messages per announce, never a runaway. This is the retry the pair depends on — the answer is
    // one unacknowledged publish, so the ONLY thing that can re-send it is the peer announcing
    // again. (The earlier one-shot-per-head-pair latch made every one of these silent, which is how
    // a single dropped packet bricked the pair.)
    const settled = relay.traffic.length;
    a.publishState();
    expect(relay.traffic.length).toBe(settled + 2);
    expect((relay.traffic[settled + 1] as SyncMessage).tag).toBe('answering');
    b.publishState();
    expect(relay.traffic.length).toBe(settled + 4);
    expect((relay.traffic[settled + 3] as SyncMessage).tag).toBe('answering');
    expect(a.needsResolution()).not.toBeNull();
    expect(b.needsResolution()).not.toBeNull();

    // A move on one side re-arms nothing and un-arms nothing: still one answer per announce.
    a.placeLocalOnly([3, 3, 3]);
    const beforeMove = relay.traffic.length;
    b.publishState();
    expect(relay.traffic.length).toBe(beforeMove + 2);
    // …and the answer carries A's NEW log, so B is told about the history it has not seen.
    expect(parseSyncMessage(relay.traffic[beforeMove + 1] as SyncMessage)).toEqual(a.game().log);
    expect(b.needsResolution()?.diff.theirs.map((m) => m.text)).toEqual([
      'black plays 1,1,1',
      'white plays 2,2,2',
      'black plays 3,3,3',
    ]);
  });

  it('a LOST answer heals on the peer’s next announce — the behind peer is still told', async () => {
    // The failure the answer-once latch could not survive, driven end to end: the peer that is
    // BEHIND publishes its short log, the answer that would tell it so is DROPPED by the relay, and
    // nothing in this system retries — no ack, no timer, no periodic republish. Under a
    // one-answer-per-head-pair latch the peer stayed uninformed FOREVER, rendered an ordinary board,
    // and played on, turning a recoverable one-sided divergence into a genuine fork.
    const relay = new EchoingRelay();
    const a = new SyncEngine(
      new Game(9, PAIR_UUID), new EchoingTransport(relay), db, () => meta, 'white', ANY_SEED,
    );
    const b = new SyncEngine(
      new Game(9, PAIR_UUID), new EchoingTransport(relay), db, () => meta, 'black', ANY_SEED,
    );
    a.attach();
    b.attach();
    a.placeLocalOnly([0, 0, 0]);
    a.placeLocalOnly([1, 1, 1]);
    a.placeLocalOnly([2, 2, 2]);
    b.placeLocalOnly([0, 0, 0]);
    relay.traffic.length = 0;

    // Every ANSWER is lost; ordinary announces still get through.
    relay.drop = (msg) => (msg as SyncMessage).tag === 'answering';

    b.publishState();
    // A heard B and answered — the answer was published and then vanished on the wire.
    expect(relay.traffic.map((m) => (m as SyncMessage).tag)).toEqual([undefined, 'answering']);
    expect(a.needsResolution()).not.toBeNull();
    // B is none the wiser: it is missing two moves and its board says everything is fine.
    expect(b.needsResolution()).toBeNull();
    expect(b.game().ply()).toBe(1);

    // The link recovers and B announces again (a presence republish / resync — B has no idea it is
    // retrying anything). THIS time the answer lands, and B is finally told.
    relay.drop = () => false;
    b.publishState();
    expect(b.needsResolution()?.lca.ply).toBe(1);
    expect(b.needsResolution()?.diff.theirs.map((m) => m.text)).toEqual([
      'black plays 1,1,1',
      'white plays 2,2,2',
    ]);
    expect(b.resolutionCandidates()).not.toBeNull();
    // Still no adoption anywhere — being told is not being overwritten.
    expect(a.game().ply()).toBe(3);
    expect(b.game().ply()).toBe(1);
  });

  it('the peer that resolves FIRST does not strand the other on a stale divergence card', async () => {
    // Answering every announce has a consequence the latch used to hide: the side that has not yet
    // applied the agreed resolution answers the settled side's publish with its PRE-resolution log,
    // which legitimately re-opens a record on a peer that had just closed one. The `settled` tag is
    // what closes it again — without it the pair converges onto one history with one player still
    // staring at a divergence panel that nothing will ever clear.
    const relay = new EchoingRelay();
    const a = new SyncEngine(
      new Game(9, PAIR_UUID), new EchoingTransport(relay), db, () => meta, 'white', ANY_SEED,
    );
    const b = new SyncEngine(
      new Game(9, PAIR_UUID), new EchoingTransport(relay), db, () => meta, 'black', ANY_SEED,
    );
    a.attach();
    b.attach();
    a.placeLocalOnly([0, 0, 0]);
    a.placeLocalOnly([1, 1, 1]);
    a.placeLocalOnly([2, 2, 2]);
    b.placeLocalOnly([0, 0, 0]);
    a.publishState();
    expect(a.needsResolution()).not.toBeNull();
    expect(b.needsResolution()).not.toBeNull();

    // They agree on A's history. A applies its side FIRST and publishes; B, which has not applied
    // yet, answers that publish with its own PRE-resolution log — which re-opens a record on A, the
    // side that had just closed one…
    expect(a.applyResolution('keep-mine')).toBe(true);
    expect(a.needsResolution()).not.toBeNull(); // re-opened by B's answer, and truthfully so
    // …and then B applies its side. Its publish is tagged `settled`, which is the only thing that
    // tells A the disagreement is over: A's head never moves again, so nothing else would.
    expect(b.applyResolution('adopt-theirs')).toBe(true);

    expect(headHash(a.game().log)).toBe(headHash(b.game().log));
    expect(a.needsResolution()).toBeNull();
    expect(b.needsResolution()).toBeNull();
    expect(a.resolutionCandidates()).toBeNull();
    expect(b.resolutionCandidates()).toBeNull();
  });

  it('agreeing over an ECHOING relay converges both peers onto one history', async () => {
    const relay = new EchoingRelay();
    const a = new SyncEngine(
      new Game(9, PAIR_UUID), new EchoingTransport(relay), db, () => meta, 'white', ANY_SEED,
    );
    const b = new SyncEngine(
      new Game(9, PAIR_UUID), new EchoingTransport(relay), db, () => meta, 'black', ANY_SEED,
    );
    a.attach();
    b.attach();
    a.placeLocalOnly([0, 0, 0]);
    a.placeLocalOnly([1, 1, 1]);
    a.placeLocalOnly([2, 2, 2]);
    b.placeLocalOnly([0, 0, 0]);
    a.publishState();

    const agreed = headHash(a.game().log);
    expect(a.applyResolution('keep-mine')).toBe(true);
    expect(b.applyResolution('adopt-theirs')).toBe(true);
    expect(headHash(a.game().log)).toBe(agreed);
    expect(headHash(b.game().log)).toBe(agreed);
    expect(a.needsResolution()).toBeNull();
    expect(b.needsResolution()).toBeNull();
  });
});
