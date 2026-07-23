import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  emptyLog,
  append,
  headHash,
  genesisHash,
  isPrefix,
  firstDivergence,
  type Event,
  type EventLog,
} from './eventLog';

/**
 * A fixed uuid for the deterministic hash pins below. The hash chain is
 * cross-run/machine reproducible, so seeding with a constant uuid yields constant
 * fingerprints — pinning them nails each `serializeEvent` arm AND the uuid-in-genesis
 * contract (S.1): change either and the pinned value shifts and the test fails.
 */
const U = 'test-uuid';

/** A `place` event at the given key. */
function place(key: string): Event {
  return { type: 'place', node: key };
}

const undo: Event = { type: 'undo' };
const redo: Event = { type: 'redo' };

/** Fold an array of events onto an empty log carrying uuid `U` (unless overridden). */
function logOf(events: readonly Event[], uuid = U): EventLog {
  return events.reduce((log, e) => append(log, e), emptyLog(uuid));
}

describe('emptyLog', () => {
  it('starts with no entries and carries the given uuid', () => {
    const log = emptyLog(U);
    expect(log.entries).toEqual([]);
    expect(log.uuid).toBe(U);
  });

  it('has a stable, deterministic head hash for the empty history', () => {
    expect(headHash(emptyLog(U))).toBe(headHash(emptyLog(U)));
  });

  it('the empty history hashes to the uuid-seeded genesis hash', () => {
    // The empty log's headHash is the genesis hash of its uuid — the uuid is folded
    // into the chain seed (S.1). Pin the exact value: if genesisHash stopped mixing
    // the uuid (e.g. reverted to a bare constant), this shifts and fails.
    expect(headHash(emptyLog(U))).toBe(genesisHash(U));
    expect(headHash(emptyLog(U))).toBe('c7d54b74');
    expect(headHash(emptyLog(U)).length).toBeGreaterThan(0);
  });

  it('two empty logs with DIFFERENT uuids have DIFFERENT head hashes', () => {
    // The core S.1 property: game identity is in the hash chain from ply 0. Two fresh
    // games (distinct uuids, both empty) are already distinguishable by headHash, so
    // headHash equality implies same-game-identity, not merely same-events.
    expect(headHash(emptyLog('A'))).not.toBe(headHash(emptyLog('B')));
    expect(genesisHash('A')).toBe('98601247');
    expect(genesisHash('B')).toBe('996013da');
  });

  it('two empty logs with the SAME uuid have identical head hashes', () => {
    expect(headHash(emptyLog('same'))).toBe(headHash(emptyLog('same')));
  });
});

describe('genesisHash', () => {
  it('mixes the uuid into the seed — distinct uuids give distinct seeds', () => {
    expect(genesisHash('A')).not.toBe(genesisHash('B'));
  });

  it('is deterministic for a given uuid', () => {
    expect(genesisHash(U)).toBe(genesisHash(U));
  });

  it('is not a bare constant — it depends on its argument', () => {
    // Guards against genesisHash collapsing to `hashStep(seed, "")` or ignoring uuid:
    // the empty-uuid case must differ from a non-empty one.
    expect(genesisHash('')).not.toBe(genesisHash(U));
  });
});

describe('append', () => {
  it('grows the log by one entry, without mutating the input, preserving uuid', () => {
    const a = emptyLog(U);
    const b = append(a, place('0,0,0'));
    expect(a.entries.length).toBe(0);
    expect(b.entries.length).toBe(1);
    expect(b.entries[0]!.event).toEqual(place('0,0,0'));
    expect(b.uuid).toBe(U);
  });

  it('the first entry chains from the uuid-seeded genesis, not a fixed seed', () => {
    // The first entry hash is H(genesisHash(uuid) + place:...). Two games with the
    // same first move but different uuids therefore have different first-entry hashes.
    const a = logOf([place('0,0,0')], 'A');
    const b = logOf([place('0,0,0')], 'B');
    expect(a.entries[0]!.hash).not.toBe(b.entries[0]!.hash);
  });

  it('changes headHash on every append', () => {
    const l0 = emptyLog(U);
    const l1 = append(l0, place('0,0,0'));
    const l2 = append(l1, place('1,1,1'));
    expect(headHash(l1)).not.toBe(headHash(l0));
    expect(headHash(l2)).not.toBe(headHash(l1));
  });

  it('records a per-entry cumulative hash (the entry hash equals the log head)', () => {
    const l1 = append(emptyLog(U), place('0,0,0'));
    expect(l1.entries[0]!.hash).toBe(headHash(l1));
  });
});

describe('headHash — deterministic hash chain', () => {
  it('two logs with identical uuid and events have identical headHash', () => {
    const events: Event[] = [place('0,0,0'), place('1,1,1'), undo, redo];
    expect(headHash(logOf(events))).toBe(headHash(logOf(events)));
  });

  it('same events but different uuid → different headHash', () => {
    const events: Event[] = [place('0,0,0'), place('1,1,1')];
    expect(headHash(logOf(events, 'A'))).not.toBe(headHash(logOf(events, 'B')));
  });

  it('diverging at ply k gives a different headHash', () => {
    const a = logOf([place('0,0,0'), place('1,1,1'), place('2,2,2')]);
    const b = logOf([place('0,0,0'), place('1,1,1'), place('3,3,3')]);
    expect(headHash(a)).not.toBe(headHash(b));
  });

  it('order matters: same events in a different order differ', () => {
    const a = logOf([place('0,0,0'), place('1,1,1')]);
    const b = logOf([place('1,1,1'), place('0,0,0')]);
    expect(headHash(a)).not.toBe(headHash(b));
  });

  it('undo and redo events hash differently (and differ from empty/genesis)', () => {
    // serializeEvent must map 'undo' and 'redo' to distinct byte sequences, or a
    // [undo]-log and a [redo]-log would share a headHash — silently collapsing
    // firstDivergence / isPrefix / conflict detection, which Part-3 sync rests on.
    const empty = headHash(emptyLog(U));
    const undoHead = headHash(logOf([undo]));
    const redoHead = headHash(logOf([redo]));
    expect(undoHead).not.toBe(redoHead);
    expect(undoHead).not.toBe(empty);
    expect(redoHead).not.toBe(empty);
  });

  it('pins the exact headHash for each single-event serialization (uuid U)', () => {
    // Pin the deterministic fingerprint of each event type, seeded by uuid U. If
    // serializeEvent's per-arm byte sequence changed OR the uuid stopped seeding the
    // genesis, the fingerprint would shift and this fails — each arm is nailed.
    expect(headHash(logOf([place('0,0,0')]))).toBe('ff34b7fc');
    expect(headHash(logOf([undo]))).toBe('f27aa631');
    expect(headHash(logOf([redo]))).toBe('99573013');
  });

  it('a place event hashes differently from undo and redo', () => {
    // Guards serializeEvent's 'place' arm against collapsing into the undo/redo
    // strings (or into a bare node with no discriminant prefix).
    const placeHead = headHash(logOf([place('0,0,0')]));
    expect(placeHead).not.toBe(headHash(logOf([undo])));
    expect(placeHead).not.toBe(headHash(logOf([redo])));
  });
});

describe('firstDivergence', () => {
  it('is the ply index where two logs first differ', () => {
    const a = logOf([place('0,0,0'), place('1,1,1'), place('2,2,2')]);
    const b = logOf([place('0,0,0'), place('1,1,1'), place('3,3,3')]);
    expect(firstDivergence(a, b)).toBe(2);
  });

  it('diverging at the very first ply reports 0', () => {
    const a = logOf([place('0,0,0')]);
    const b = logOf([place('9,9,9')]);
    expect(firstDivergence(a, b)).toBe(0);
  });

  it('when one is a prefix of the other, divergence is the shorter length', () => {
    const a = logOf([place('0,0,0'), place('1,1,1')]);
    const b = logOf([place('0,0,0'), place('1,1,1'), place('2,2,2')]);
    expect(firstDivergence(a, b)).toBe(2);
  });

  it('identical logs never diverge (returns their common length)', () => {
    const a = logOf([place('0,0,0'), place('1,1,1')]);
    const b = logOf([place('0,0,0'), place('1,1,1')]);
    expect(firstDivergence(a, b)).toBe(2);
  });

  it('same events but different uuid diverge at ply 0 (genesis differs)', () => {
    // The uuid seeds the chain, so even a shared first move has a different entry
    // hash under a different uuid — the histories share no common prefix.
    const a = logOf([place('0,0,0'), place('1,1,1')], 'A');
    const b = logOf([place('0,0,0'), place('1,1,1')], 'B');
    expect(firstDivergence(a, b)).toBe(0);
  });
});

describe('isPrefix', () => {
  it('the empty log is a prefix of a longer log with the SAME uuid', () => {
    expect(isPrefix(emptyLog(U), logOf([place('0,0,0')]))).toBe(true);
  });

  it('an empty log IS a prefix of a log with a DIFFERENT uuid (empty adopts anything)', () => {
    // isPrefix compares HISTORIES, not identity: an empty log (no entries) is a prefix
    // of any log. This is deliberate — it is what lets a peer that brought no game
    // adopt an incoming one. Same-uuid/divergent detection is an ADMISSION concern, not
    // this primitive's. (Two NON-empty different-uuid logs still fail, see below.)
    expect(isPrefix(emptyLog('A'), logOf([place('0,0,0')], 'B'))).toBe(true);
  });

  it('a NON-empty log is NOT a prefix of a same-events log with a different uuid', () => {
    // Once there IS history, the uuid-seeded genesis makes the first entry hashes
    // differ, so a genuine fork between two different games is caught at ply 0 — the
    // property S.1 gives the move-sync layer for free, without a uuid special-case.
    const a = logOf([place('0,0,0')], 'A');
    const b = logOf([place('0,0,0'), place('1,1,1')], 'B');
    expect(isPrefix(a, b)).toBe(false);
  });

  it('a strict prefix (same uuid) returns true', () => {
    const a = logOf([place('0,0,0'), place('1,1,1')]);
    const b = logOf([place('0,0,0'), place('1,1,1'), place('2,2,2')]);
    expect(isPrefix(a, b)).toBe(true);
  });

  it('a log is a prefix of itself', () => {
    const a = logOf([place('0,0,0'), place('1,1,1')]);
    expect(isPrefix(a, a)).toBe(true);
  });

  it('a longer log is not a prefix of a shorter one', () => {
    const a = logOf([place('0,0,0'), place('1,1,1'), place('2,2,2')]);
    const b = logOf([place('0,0,0'), place('1,1,1')]);
    expect(isPrefix(a, b)).toBe(false);
  });

  it('a forked log is not a prefix', () => {
    const a = logOf([place('0,0,0'), place('1,1,1')]);
    const b = logOf([place('0,0,0'), place('9,9,9')]);
    expect(isPrefix(a, b)).toBe(false);
  });
});

describe('property invariants', () => {
  // An arbitrary event: place at a small key, or undo/redo.
  const arbEvent: fc.Arbitrary<Event> = fc.oneof(
    fc
      .tuple(
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 0, max: 8 }),
      )
      .map(([x, y, z]): Event => ({ type: 'place', node: `${x},${y},${z}` })),
    fc.constant<Event>({ type: 'undo' }),
    fc.constant<Event>({ type: 'redo' }),
  );
  const arbEvents = fc.array(arbEvent, { maxLength: 30 });
  const arbUuid = fc.string({ minLength: 1, maxLength: 12 });

  it('replaying the same events (same uuid) always yields an identical headHash', () => {
    fc.assert(
      fc.property(arbUuid, arbEvents, (uuid, events) => {
        expect(headHash(logOf(events, uuid))).toBe(headHash(logOf(events, uuid)));
      }),
    );
  });

  it('two DISTINCT uuids over the same events give distinct headHashes', () => {
    fc.assert(
      fc.property(arbUuid, arbUuid, arbEvents, (u1, u2, events) => {
        fc.pre(u1 !== u2);
        expect(headHash(logOf(events, u1))).not.toBe(headHash(logOf(events, u2)));
      }),
    );
  });

  it('append never mutates its input log', () => {
    fc.assert(
      fc.property(arbEvents, arbEvent, (events, extra) => {
        const before = logOf(events);
        const snapshot = JSON.stringify(before);
        append(before, extra);
        expect(JSON.stringify(before)).toBe(snapshot);
      }),
    );
  });

  it('a log is always a prefix of that same-uuid log extended by more events', () => {
    fc.assert(
      fc.property(arbUuid, arbEvents, arbEvents, (uuid, base, more) => {
        const a = logOf(base, uuid);
        const b = more.reduce((log, e) => append(log, e), a);
        expect(isPrefix(a, b)).toBe(true);
      }),
    );
  });

  it('a NON-empty log is never a prefix of the same events under a different uuid', () => {
    // The uuid-seeded genesis makes the first entry hashes differ, so any real history
    // fails the prefix check across games. (Empty logs are excluded: an empty log is a
    // prefix of anything — the "brought nothing, adopt yours" move-sync rule.)
    fc.assert(
      fc.property(arbUuid, arbUuid, arbEvents, (u1, u2, events) => {
        fc.pre(u1 !== u2);
        fc.pre(events.length > 0);
        const a = logOf(events, u1);
        const b = logOf(events, u2);
        expect(isPrefix(a, b)).toBe(false);
      }),
    );
  });

  it('firstDivergence(a, b) equals the length of the common prefix', () => {
    fc.assert(
      fc.property(arbEvents, arbEvents, (ea, eb) => {
        const a = logOf(ea);
        const b = logOf(eb);
        let common = 0;
        const max = Math.min(a.entries.length, b.entries.length);
        while (
          common < max &&
          a.entries[common]!.hash === b.entries[common]!.hash
        ) {
          common++;
        }
        expect(firstDivergence(a, b)).toBe(common);
      }),
    );
  });
});
