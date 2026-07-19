import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  emptyLog,
  append,
  headHash,
  isPrefix,
  firstDivergence,
  type Event,
  type EventLog,
} from './eventLog';

/** A `place` event at the given key. */
function place(key: string): Event {
  return { type: 'place', node: key };
}

const undo: Event = { type: 'undo' };
const redo: Event = { type: 'redo' };

/** Fold an array of events onto an empty log. */
function logOf(events: readonly Event[]): EventLog {
  return events.reduce((log, e) => append(log, e), emptyLog());
}

describe('emptyLog', () => {
  it('starts with no entries', () => {
    expect(emptyLog().entries).toEqual([]);
  });

  it('has a stable, deterministic head hash for the empty history', () => {
    expect(headHash(emptyLog())).toBe(headHash(emptyLog()));
  });

  it('the empty history hashes to a fixed, non-empty genesis seed', () => {
    // A non-empty seed so a single-entry log mixes a stable prefix and the empty
    // log has a well-defined headHash. Pin the exact value: if the seed were
    // blanked to "", this fails and the whole chain shifts silently.
    expect(headHash(emptyLog())).toBe('pente3d:genesis');
    expect(headHash(emptyLog()).length).toBeGreaterThan(0);
  });
});

describe('append', () => {
  it('grows the log by one entry, without mutating the input', () => {
    const a = emptyLog();
    const b = append(a, place('0,0,0'));
    expect(a.entries.length).toBe(0);
    expect(b.entries.length).toBe(1);
    expect(b.entries[0]!.event).toEqual(place('0,0,0'));
  });

  it('changes headHash on every append', () => {
    const l0 = emptyLog();
    const l1 = append(l0, place('0,0,0'));
    const l2 = append(l1, place('1,1,1'));
    expect(headHash(l1)).not.toBe(headHash(l0));
    expect(headHash(l2)).not.toBe(headHash(l1));
  });

  it('records a per-entry cumulative hash (the entry hash equals the log head)', () => {
    const l1 = append(emptyLog(), place('0,0,0'));
    expect(l1.entries[0]!.hash).toBe(headHash(l1));
  });
});

describe('headHash — deterministic hash chain', () => {
  it('two logs with identical events have identical headHash', () => {
    const events: Event[] = [place('0,0,0'), place('1,1,1'), undo, redo];
    expect(headHash(logOf(events))).toBe(headHash(logOf(events)));
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
    const empty = headHash(emptyLog());
    const undoHead = headHash(logOf([undo]));
    const redoHead = headHash(logOf([redo]));
    expect(undoHead).not.toBe(redoHead);
    expect(undoHead).not.toBe(empty);
    expect(redoHead).not.toBe(empty);
  });

  it('pins the exact headHash for each single-event serialization', () => {
    // Pin the deterministic fingerprint of each event type. The hash-chain
    // contract (hash.ts) is cross-run/machine reproducibility, so these constants
    // are stable. Pinning them means if serializeEvent's per-arm byte sequence
    // changed (e.g. an arm collapsed to "" or 'undo'/'redo'/'place:' were swapped),
    // the fingerprint would shift and this fails — each arm is individually nailed.
    expect(headHash(logOf([place('0,0,0')]))).toBe('608cf025');
    expect(headHash(logOf([undo]))).toBe('6a75070a');
    expect(headHash(logOf([redo]))).toBe('144a745c');
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
});

describe('isPrefix', () => {
  it('the empty log is a prefix of any log', () => {
    expect(isPrefix(emptyLog(), logOf([place('0,0,0')]))).toBe(true);
  });

  it('a strict prefix returns true', () => {
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

  it('replaying the same events always yields an identical headHash', () => {
    fc.assert(
      fc.property(arbEvents, (events) => {
        expect(headHash(logOf(events))).toBe(headHash(logOf(events)));
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

  it('a log is always a prefix of that log extended by more events', () => {
    fc.assert(
      fc.property(arbEvents, arbEvents, (base, more) => {
        const a = logOf(base);
        const b = more.reduce((log, e) => append(log, e), a);
        expect(isPrefix(a, b)).toBe(true);
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
