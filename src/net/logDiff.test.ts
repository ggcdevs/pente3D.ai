import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { append, emptyLog, headHash, type Event, type EventLog } from '../core/eventLog';
import { describeDivergence, formatLogDiff } from './logDiff';

/** The board every log in this file is played on (the standard 5³ game). */
const SIZE = 5;
/** One game identity shared by both sides — a diff only means anything WITHIN one game. */
const UUID = 'diff-game';

/** Build a log of `place` events (no legality check — `append` is the raw chain primitive). */
function logOf(...nodes: string[]): EventLog {
  return logOfEvents(...nodes.map((node): Event => ({ type: 'place', node })));
}

/** Build a log from raw events, for the undo/redo and illegal-entry cases. */
function logOfEvents(...events: Event[]): EventLog {
  let log = emptyLog(UUID);
  for (const event of events) log = append(log, event);
  return log;
}

describe('describeDivergence — the shared prefix, then each side in a player’s terms', () => {
  it('reports the FULL length as shared and both tails empty for identical logs', () => {
    const log = logOf('0,0,0', '1,1,1');
    const diff = describeDivergence(SIZE, log, log);
    expect(diff.sharedPly).toBe(2);
    expect(diff.mine).toEqual([]);
    expect(diff.theirs).toEqual([]);
  });

  it('names the MOVER and the coordinates of each divergent entry on both sides', () => {
    const mine = logOf('0,0,0', '1,1,1', '4,4,4');
    const theirs = logOf('0,0,0', '1,1,1', '3,3,3', '2,2,2');
    const diff = describeDivergence(SIZE, mine, theirs);

    expect(diff.sharedPly).toBe(2);
    expect(diff.mine).toEqual([
      {
        ply: 2,
        event: { type: 'place', node: '4,4,4' },
        player: 'white',
        text: 'white plays 4,4,4',
      },
    ]);
    expect(diff.theirs).toEqual([
      {
        ply: 2,
        event: { type: 'place', node: '3,3,3' },
        player: 'white',
        text: 'white plays 3,3,3',
      },
      {
        ply: 3,
        event: { type: 'place', node: '2,2,2' },
        player: 'black',
        text: 'black plays 2,2,2',
      },
    ]);
  });

  it('leaves MY side empty when their log merely extends mine (a prefix is not a fork)', () => {
    const mine = logOf('0,0,0');
    const theirs = logOf('0,0,0', '1,1,1');
    const diff = describeDivergence(SIZE, mine, theirs);
    expect(diff.sharedPly).toBe(1);
    expect(diff.mine).toEqual([]);
    expect(diff.theirs.map((m) => m.text)).toEqual(['black plays 1,1,1']);
  });

  it('describes undo / redo entries by what they DO, naming no mover', () => {
    const mine = logOf('0,0,0');
    const theirs = logOfEvents(
      { type: 'place', node: '0,0,0' },
      { type: 'place', node: '1,1,1' },
      { type: 'undo' },
      { type: 'redo' },
    );
    const diff = describeDivergence(SIZE, mine, theirs);
    expect(diff.theirs.map((m) => [m.player, m.text])).toEqual([
      ['black', 'black plays 1,1,1'],
      [null, 'undo (takes back the previous move)'],
      [null, 'redo (re-applies the last undone move)'],
    ]);
  });

  it('stops naming movers once an entry does not replay, and SAYS that it cannot', () => {
    // Ply 1 replays the SAME node as ply 0 — illegal (occupied), so nothing after it has a
    // derivable turn. The illegal entry itself still names the player who would have moved.
    const mine = logOf('4,4,4');
    const theirs = logOf('0,0,0', '0,0,0', '1,1,1');
    const diff = describeDivergence(SIZE, mine, theirs);
    expect(diff.theirs.map((m) => [m.ply, m.player, m.text])).toEqual([
      [0, 'white', 'white plays 0,0,0'],
      [1, 'black', 'black plays 0,0,0'],
      [2, null, 'plays 1,1,1 (mover unknown — an earlier entry does not replay)'],
    ]);
  });

  it('marks an off-board entry the same way (the rules engine, not a coordinate parser, judges it)', () => {
    const theirs = logOf('9,9,9', '1,1,1');
    const diff = describeDivergence(SIZE, emptyLog(UUID), theirs);
    expect(diff.theirs.map((m) => m.player)).toEqual(['white', null]);
  });

  it('diverges at ply 0 when the two logs share no entry at all', () => {
    const diff = describeDivergence(SIZE, logOf('0,0,0'), logOf('1,1,1'));
    expect(diff.sharedPly).toBe(0);
    expect(diff.mine.map((m) => m.text)).toEqual(['white plays 0,0,0']);
    expect(diff.theirs.map((m) => m.text)).toEqual(['white plays 1,1,1']);
  });
});

describe('formatLogDiff — what a player reads', () => {
  it('renders the shared point, then each side, with no hashes anywhere', () => {
    const mine = logOf('0,0,0', '1,1,1', '4,4,4');
    const theirs = logOf('0,0,0', '1,1,1', '3,3,3', '2,2,2');
    const text = formatLogDiff(describeDivergence(SIZE, mine, theirs));

    expect(text).toBe(
      [
        'shared history up to ply 2, then',
        '  mine:   ply 2 — white plays 4,4,4',
        '  theirs: ply 2 — white plays 3,3,3',
        '          ply 3 — black plays 2,2,2',
      ].join('\n'),
    );
    expect(text).not.toContain(headHash(mine));
    expect(text).not.toContain(headHash(theirs));
  });

  it('says so explicitly when a side has nothing past the shared point', () => {
    const mine = logOf('0,0,0');
    const theirs = logOf('0,0,0', '1,1,1');
    expect(formatLogDiff(describeDivergence(SIZE, mine, theirs))).toBe(
      [
        'shared history up to ply 1, then',
        '  mine:   (nothing)',
        '  theirs: ply 1 — black plays 1,1,1',
      ].join('\n'),
    );
  });

  it('renders identical logs as fully shared with nothing on either side', () => {
    const log = logOf('0,0,0');
    expect(formatLogDiff(describeDivergence(SIZE, log, log))).toBe(
      ['shared history up to ply 1, then', '  mine:   (nothing)', '  theirs: (nothing)'].join('\n'),
    );
  });
});

describe('property: a diff ROUND-TRIPS the two logs it describes', () => {
  /** A pair of same-game logs sharing a random prefix, then diverging into random tails. */
  const logPair = fc
    .tuple(
      fc.array(fc.integer({ min: 0, max: 60 }), { minLength: 0, maxLength: 6 }),
      fc.array(fc.integer({ min: 0, max: 60 }), { minLength: 0, maxLength: 4 }),
      fc.array(fc.integer({ min: 0, max: 60 }), { minLength: 0, maxLength: 4 }),
    )
    .map(([shared, mineTail, theirsTail]) => {
      const node = (n: number): string => `${n % 5},${Math.floor(n / 5) % 5},${Math.floor(n / 25) % 5}`;
      let base = emptyLog(UUID);
      for (const n of shared) base = append(base, { type: 'place', node: node(n) });
      let mine = base;
      // Prefix each tail with a distinct marker node so the two tails cannot accidentally
      // coincide — the shared prefix must be exactly `shared`.
      for (const n of ['0,0,4', ...mineTail.map(node)]) mine = append(mine, { type: 'place', node: n });
      let theirs = base;
      for (const n of ['4,0,0', ...theirsTail.map(node)]) {
        theirs = append(theirs, { type: 'place', node: n });
      }
      return { base, mine, theirs };
    });

  it('rebuilds BOTH logs from the shared prefix plus the described tails', () => {
    fc.assert(
      fc.property(logPair, ({ mine, theirs }) => {
        const diff = describeDivergence(SIZE, mine, theirs);
        const shared = { uuid: UUID, entries: mine.entries.slice(0, diff.sharedPly) };
        const rebuild = (tail: readonly { readonly event: Event }[]): EventLog =>
          tail.reduce<EventLog>((log, move) => append(log, move.event), shared);
        expect(headHash(rebuild(diff.mine))).toBe(headHash(mine));
        expect(headHash(rebuild(diff.theirs))).toBe(headHash(theirs));
      }),
      { numRuns: 300 },
    );
  });

  it('numbers every described entry with its own position in its log', () => {
    fc.assert(
      fc.property(logPair, ({ mine, theirs }) => {
        const diff = describeDivergence(SIZE, mine, theirs);
        for (const side of [
          { moves: diff.mine, log: mine },
          { moves: diff.theirs, log: theirs },
        ]) {
          for (const move of side.moves) {
            expect(move.ply).toBeGreaterThanOrEqual(diff.sharedPly);
            expect(side.log.entries[move.ply]!.event).toEqual(move.event);
          }
        }
      }),
      { numRuns: 300 },
    );
  });
});
