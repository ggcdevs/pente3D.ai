import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fc from 'fast-check';
import {
  append,
  emptyLog,
  genesisHash,
  headHash,
  type Event,
  type EventLog,
} from '../core/eventLog';
import { Game } from '../core/game';
import { coordsOf } from '../core/coords';
import {
  isFork,
  lastCommonAncestor,
  reconcile,
  reconcileEpoched,
  validateAdoptable,
} from './reconcile';

/** The board every game in this file is played on (the standard 5³ game). */
const SIZE = 5;
/** One game identity — reconciliation only means anything WITHIN one game. */
const UUID = 'reconcile-game';
/** A DIFFERENT game, for the "no common ancestor at all" case. */
const OTHER_UUID = 'another-game';

/** A real `Game` (a legal fold) holding `nodes`, played in order from an empty board. */
function gameOf(...nodes: string[]): Game {
  const game = new Game(SIZE, UUID);
  for (const node of nodes) game.place(coordsOf(node));
  return game;
}

/** A raw log of `place` events — no legality check (`append` is the raw chain primitive). */
function logOf(...nodes: string[]): EventLog {
  return logOfEvents(...nodes.map((node): Event => ({ type: 'place', node })));
}

/** A raw log from arbitrary events, for the undo/redo and tampering cases. */
function logOfEvents(...events: Event[]): EventLog {
  return eventsOnto(emptyLog(UUID), events);
}

/** Append `events` onto `base`. */
function eventsOnto(base: EventLog, events: readonly Event[]): EventLog {
  return events.reduce<EventLog>((log, event) => append(log, event), base);
}

describe('lastCommonAncestor — walk both chains back to the last matching hash', () => {
  it('is the whole log when the logs are identical', () => {
    const log = logOf('0,0,0', '1,1,1');
    expect(lastCommonAncestor(log, log)).toEqual({ ply: 2, hash: headHash(log) });
  });

  it('is the SHORTER log when one is a prefix of the other, whichever way round', () => {
    const short = logOf('0,0,0');
    const long = logOf('0,0,0', '1,1,1', '2,2,2');
    expect(lastCommonAncestor(short, long)).toEqual({ ply: 1, hash: headHash(short) });
    expect(lastCommonAncestor(long, short)).toEqual({ ply: 1, hash: headHash(short) });
  });

  it('is the GENESIS of the game when two logs of it fork at the very first entry', () => {
    expect(lastCommonAncestor(logOf('0,0,0'), logOf('1,1,1'))).toEqual({
      ply: 0,
      hash: genesisHash(UUID),
    });
  });

  it('reports NO common ancestor for logs of two different games', () => {
    const theirs = append(emptyLog(OTHER_UUID), { type: 'place', node: '0,0,0' });
    expect(lastCommonAncestor(logOf('0,0,0'), theirs)).toEqual({ ply: 0, hash: null });
  });

  it('is the last SHARED entry when the two logs fork mid-history', () => {
    const shared = logOf('0,0,0', '1,1,1');
    const mine = eventsOnto(shared, [{ type: 'place', node: '2,2,2' }]);
    const theirs = eventsOnto(shared, [{ type: 'place', node: '3,3,3' }]);
    expect(lastCommonAncestor(mine, theirs)).toEqual({ ply: 2, hash: headHash(shared) });
  });
});

describe('reconcile — the v3.1 policy: ONE automatic case, everything else explicit', () => {
  it('plays on when the two histories are identical', () => {
    const mine = gameOf('0,0,0', '1,1,1');
    expect(reconcile(mine, mine.log, 'white')).toEqual({ action: 'in-sync' });
  });

  it('plays on when both sides are still empty', () => {
    const mine = gameOf();
    expect(reconcile(mine, emptyLog(UUID), 'white')).toEqual({ action: 'in-sync' });
  });

  it('FAST-FORWARDS onto a peer exactly ONE move ahead when my log says it is THEIR turn', () => {
    // I am black at ply 1: white (them) moved once and it is my turn — the move I am missing is
    // theirs. This is the #45 case: the move made while I was away.
    const mine = gameOf('0,0,0');
    const theirs = eventsOnto(mine.log, [{ type: 'place', node: '1,1,1' }]);
    expect(reconcile(mine, theirs, 'white')).toEqual({ action: 'fast-forward', reason: 'one-move' });
  });

  it('fast-forwards from an EMPTY log too, when the one move it lacks is the opponent’s', () => {
    const mine = gameOf();
    expect(reconcile(mine, logOf('0,0,0'), 'black')).toEqual({
      action: 'fast-forward',
      reason: 'one-move',
    });
  });

  it('REFUSES to fast-forward one move that my log says was MINE to make', () => {
    // Same shape as the accepted case, one fact different: at ply 0 it is white's turn and I am
    // white, so the entry they hold was made in my seat. That is not drift, it is an anomaly.
    const mine = gameOf();
    const theirs = logOf('0,0,0');
    const decision = reconcile(mine, theirs, 'white');
    expect(decision.action).toBe('needs-resolution');
    if (decision.action !== 'needs-resolution') throw new Error('expected needs-resolution');
    expect(decision.lca).toEqual({ ply: 0, hash: genesisHash(UUID) });
    expect(decision.diff.mine).toEqual([]);
    expect(decision.diff.theirs.map((m) => m.text)).toEqual(['white plays 0,0,0']);
  });

  it('REFUSES to fast-forward TWO moves, even as a clean prefix on their turn', () => {
    // The turn gate caps legitimate drift at exactly one move, so a two-move lead is already
    // anomalous — no matter how well-formed it looks.
    const mine = gameOf('0,0,0');
    const theirs = eventsOnto(mine.log, [
      { type: 'place', node: '1,1,1' },
      { type: 'place', node: '2,2,2' },
    ]);
    const decision = reconcile(mine, theirs, 'white');
    expect(decision.action).toBe('needs-resolution');
    if (decision.action !== 'needs-resolution') throw new Error('expected needs-resolution');
    expect(decision.lca).toEqual({ ply: 1, hash: headHash(mine.log) });
    expect(decision.diff.theirs.map((m) => m.text)).toEqual([
      'black plays 1,1,1',
      'white plays 2,2,2',
    ]);
  });

  it('REPUBLISHES rather than adopting when I am exactly one move ahead', () => {
    const mine = gameOf('0,0,0', '1,1,1');
    expect(reconcile(mine, logOf('0,0,0'), 'white')).toEqual({
      action: 'republish',
      reason: 'one-ahead',
    });
  });

  it('does not silently answer a peer that is TWO behind — that is a resolution too', () => {
    const mine = gameOf('0,0,0', '1,1,1', '2,2,2');
    const decision = reconcile(mine, logOf('0,0,0'), 'white');
    expect(decision.action).toBe('needs-resolution');
    if (decision.action !== 'needs-resolution') throw new Error('expected needs-resolution');
    expect(decision.lca.ply).toBe(1);
    expect(decision.diff.theirs).toEqual([]);
    expect(decision.diff.mine.map((m) => m.text)).toEqual(['black plays 1,1,1', 'white plays 2,2,2']);
  });

  it('sends a genuine FORK to resolution, carrying the ancestor and a readable diff', () => {
    const shared = gameOf('0,0,0', '1,1,1');
    const mine = gameOf('0,0,0', '1,1,1', '2,2,2');
    const theirs = eventsOnto(shared.log, [{ type: 'place', node: '3,3,3' }]);
    const decision = reconcile(mine, theirs, 'white');
    expect(decision.action).toBe('needs-resolution');
    if (decision.action !== 'needs-resolution') throw new Error('expected needs-resolution');
    expect(decision.lca).toEqual({ ply: 2, hash: headHash(shared.log) });
    expect(decision.diff.mine.map((m) => m.text)).toEqual(['white plays 2,2,2']);
    expect(decision.diff.theirs.map((m) => m.text)).toEqual(['white plays 3,3,3']);
    expect(isFork(decision.diff)).toBe(true);
  });

  it('does not call a one-sided divergence a fork', () => {
    const mine = gameOf('0,0,0');
    const theirs = eventsOnto(mine.log, [
      { type: 'place', node: '1,1,1' },
      { type: 'place', node: '2,2,2' },
    ]);
    const decision = reconcile(mine, theirs, 'white');
    if (decision.action !== 'needs-resolution') throw new Error('expected needs-resolution');
    expect(isFork(decision.diff)).toBe(false);
  });

  it('sends a fork to resolution even when their log is LONGER (a fork is not a lead)', () => {
    const mine = gameOf('0,0,0', '1,1,1');
    const theirs = logOf('0,0,0', '2,2,2', '3,3,3', '4,4,4');
    const decision = reconcile(mine, theirs, 'white');
    expect(decision.action).toBe('needs-resolution');
    if (decision.action !== 'needs-resolution') throw new Error('expected needs-resolution');
    expect(decision.lca.ply).toBe(1);
    expect(isFork(decision.diff)).toBe(true);
  });

  it('treats a log of a DIFFERENT game as a resolution with no common ancestor', () => {
    const mine = gameOf('0,0,0');
    const theirs = append(emptyLog(OTHER_UUID), { type: 'place', node: '1,1,1' });
    const decision = reconcile(mine, theirs, 'white');
    expect(decision.action).toBe('needs-resolution');
    if (decision.action !== 'needs-resolution') throw new Error('expected needs-resolution');
    expect(decision.lca).toEqual({ ply: 0, hash: null });
  });

  it('REFUSES a different game from an EMPTY log — where every prefix rule says "adopt"', () => {
    // The uuid check earns its keep on exactly this input and nowhere else: `isPrefix` is uuid-BLIND
    // (an empty log is a prefix of ANY log), so from an empty board a stranger's one-entry log meets
    // every other fast-forward condition — one entry, my log its prefix, and my own state says the
    // mover is not me. Proof that it is the SHAPE that would adopt, and identity alone that refuses:
    // the same shape in MY game does fast-forward.
    expect(reconcile(gameOf(), logOf('0,0,0'), 'black')).toEqual({
      action: 'fast-forward',
      reason: 'one-move',
    });
    const decision = reconcile(gameOf(), append(emptyLog(OTHER_UUID), {
      type: 'place',
      node: '0,0,0',
    }), 'black');
    expect(decision.action).toBe('needs-resolution');
    if (decision.action !== 'needs-resolution') throw new Error('expected needs-resolution');
    expect(decision.lca).toEqual({ ply: 0, hash: null });
    expect(decision.diff.mine).toEqual([]);
    expect(decision.diff.theirs.map((m) => m.text)).toEqual(['white plays 0,0,0']);
  });

  it('does not answer a different game with OUR log either, when theirs is the empty one', () => {
    // The republish mirror of the same uuid-blindness: an EMPTY stranger log is a "prefix" of mine
    // and exactly one shorter — the accepted republish shape — which would put my whole board on the
    // wire for anyone who publishes an empty game. Same shape in MY game does republish.
    expect(reconcile(gameOf('0,0,0'), emptyLog(UUID), 'black')).toEqual({
      action: 'republish',
      reason: 'one-ahead',
    });
    const decision = reconcile(gameOf('0,0,0'), emptyLog(OTHER_UUID), 'black');
    expect(decision.action).toBe('needs-resolution');
    if (decision.action !== 'needs-resolution') throw new Error('expected needs-resolution');
    expect(decision.lca).toEqual({ ply: 0, hash: null });
    expect(decision.diff.mine.map((m) => m.text)).toEqual(['white plays 0,0,0']);
    expect(decision.diff.theirs).toEqual([]);
  });

  it('fast-forwards an UNDO the opponent took of its OWN move — on my turn, not theirs', () => {
    // The one-move rule is about ENTRIES, not placements: an undo is an appended event and reaches a
    // peer exactly like a move does. Note the turn: white moved, so it is MY (black's) turn — and
    // white's undo of its own move still arrives now. A turn-only rule would refuse it.
    const mine = gameOf('0,0,0');
    const theirs = eventsOnto(mine.log, [{ type: 'undo' }]);
    expect(reconcile(mine, theirs, 'black')).toEqual({ action: 'fast-forward', reason: 'one-move' });
  });

  it('REFUSES an undo of MY OWN last move — that entry was mine to add', () => {
    const mine = gameOf('0,0,0');
    const theirs = eventsOnto(mine.log, [{ type: 'undo' }]);
    expect(reconcile(mine, theirs, 'white').action).toBe('needs-resolution');
  });

  it('fast-forwards a REDO of the opponent’s undone move, and refuses a redo of mine', () => {
    // After white's move is undone the live turn is white's again, so the move a redo re-applies is
    // white's: theirs when I am black, mine when I am white.
    const mine = gameOf('0,0,0');
    mine.undo();
    const theirs = eventsOnto(mine.log, [{ type: 'redo' }]);
    expect(reconcile(mine, theirs, 'black')).toEqual({ action: 'fast-forward', reason: 'one-move' });
    expect(reconcile(mine, theirs, 'white').action).toBe('needs-resolution');
  });
});

describe('reconcileEpoched — the epoch REFUSES a stale generation; it never authorizes an adopt', () => {
  it('REFUSES to wipe a live board for a higher epoch — the number on the wire is not a generation', () => {
    // The escape hatch this pins shut: `epoch` is a sender-supplied integer, so "higher epoch =>
    // adopt outright" let any peer stamp a big number on an EMPTY log and silently overwrite three
    // plies of real history. A generation change is an identity change (a reset re-derives the uuid),
    // so it can never arrive as a bigger number on the game we are already on.
    const mine = gameOf('0,0,0', '1,1,1', '2,2,2');
    const decision = reconcileEpoched(0, mine, 999, emptyLog(UUID), 'white');
    expect(decision.action).toBe('needs-resolution');
    if (decision.action !== 'needs-resolution') throw new Error('expected needs-resolution');
    expect(decision.lca).toEqual({ ply: 0, hash: genesisHash(UUID) });
    expect(decision.diff.mine.map((m) => m.text)).toEqual([
      'white plays 0,0,0',
      'black plays 1,1,1',
      'white plays 2,2,2',
    ]);
    expect(decision.diff.theirs).toEqual([]);
  });

  it('REFUSES a higher-epoch FORK too — it goes to the players like any other fork', () => {
    const mine = gameOf('0,0,0', '1,1,1');
    const decision = reconcileEpoched(0, mine, 1, logOf('4,4,4'), 'white');
    expect(decision.action).toBe('needs-resolution');
    if (decision.action !== 'needs-resolution') throw new Error('expected needs-resolution');
    expect(decision.lca).toEqual({ ply: 0, hash: genesisHash(UUID) });
    expect(isFork(decision.diff)).toBe(true);
  });

  it('and REFUSES a higher-epoch log that is two moves ahead on my own history', () => {
    const mine = gameOf('0,0,0');
    const theirs = eventsOnto(mine.log, [
      { type: 'place', node: '1,1,1' },
      { type: 'place', node: '2,2,2' },
    ]);
    expect(reconcileEpoched(0, mine, 4, theirs, 'white').action).toBe('needs-resolution');
  });

  it('still fast-forwards the ONE legitimate move under a higher epoch — the epoch neither grants nor blocks', () => {
    const mine = gameOf('0,0,0');
    const theirs = eventsOnto(mine.log, [{ type: 'place', node: '1,1,1' }]);
    expect(reconcileEpoched(0, mine, 5, theirs, 'white')).toEqual({
      action: 'fast-forward',
      reason: 'one-move',
    });
  });

  it('never adopts a SUPERSEDED generation, however legitimately its log would fast-forward', () => {
    // The mirror the epoch DOES decide: the same one-move log that adopts within a generation is
    // refused when it is stamped with an older one — that is what stops a finished game resurrecting.
    const mine = gameOf('0,0,0');
    const theirs = eventsOnto(mine.log, [{ type: 'place', node: '1,1,1' }]);
    expect(reconcile(mine, theirs, 'white')).toEqual({ action: 'fast-forward', reason: 'one-move' });
    expect(reconcileEpoched(2, mine, 1, theirs, 'white')).toEqual({
      action: 'republish',
      reason: 'superseded-generation',
    });
  });

  it('answers a SUPERSEDED generation with our own state instead of adopting it', () => {
    const mine = gameOf();
    const stale = logOf('0,0,0', '1,1,1');
    expect(reconcileEpoched(1, mine, 0, stale, 'white')).toEqual({
      action: 'republish',
      reason: 'superseded-generation',
    });
  });

  it('defers to the same-generation policy when the epochs match', () => {
    const mine = gameOf('0,0,0');
    const theirs = eventsOnto(mine.log, [{ type: 'place', node: '1,1,1' }]);
    expect(reconcileEpoched(2, mine, 2, theirs, 'white')).toEqual(
      reconcile(mine, theirs, 'white'),
    );
    expect(reconcileEpoched(2, mine, 2, theirs, 'white')).toEqual({
      action: 'fast-forward',
      reason: 'one-move',
    });
    expect(reconcileEpoched(2, mine, 2, logOf('4,4,4'), 'white').action).toBe('needs-resolution');
  });
});

describe('validateAdoptable — replay through the rules engine, never trust derived state', () => {
  it('accepts a log that folds legally, including undo and redo', () => {
    const played = gameOf('0,0,0', '1,1,1');
    played.undo();
    played.redo();
    expect(validateAdoptable(SIZE, played.log)).toEqual({ ok: true });
    expect(validateAdoptable(SIZE, emptyLog(UUID))).toEqual({ ok: true });
  });

  it('rejects an OCCUPIED placement at the exact entry that is illegal', () => {
    const log = logOf('0,0,0', '1,1,1', '0,0,0');
    expect(validateAdoptable(SIZE, log)).toEqual({
      ok: false,
      ply: 2,
      reason: 'illegal-move',
      detail: 'node already occupied: 0,0,0',
    });
  });

  it('rejects an OFF-BOARD placement', () => {
    const rejection = validateAdoptable(SIZE, logOf('9,9,9'));
    expect(rejection.ok).toBe(false);
    if (rejection.ok) throw new Error('expected a rejection');
    expect(rejection.ply).toBe(0);
    expect(rejection.reason).toBe('illegal-move');
    expect(rejection.detail).toContain('9,9,9');
  });

  it('rejects an undo with nothing to undo, and a redo with no tail', () => {
    expect(validateAdoptable(SIZE, logOfEvents({ type: 'undo' }))).toEqual({
      ok: false,
      ply: 0,
      reason: 'illegal-move',
      detail: 'nothing to undo',
    });
    expect(
      validateAdoptable(SIZE, logOfEvents({ type: 'place', node: '0,0,0' }, { type: 'redo' })),
    ).toEqual({ ok: false, ply: 1, reason: 'illegal-move', detail: 'nothing to redo' });
  });

  it('rejects a log whose hash CHAIN was tampered with, even though every move is legal', () => {
    const legal = logOf('0,0,0', '1,1,1');
    const tampered: EventLog = {
      uuid: legal.uuid,
      entries: [legal.entries[0]!, { ...legal.entries[1]!, hash: 'deadbeef' }],
    };
    const rejection = validateAdoptable(SIZE, tampered);
    expect(rejection.ok).toBe(false);
    if (rejection.ok) throw new Error('expected a rejection');
    expect(rejection.ply).toBe(1);
    expect(rejection.reason).toBe('broken-chain');
    expect(rejection.detail).toContain('deadbeef');
    expect(rejection.detail).toContain(headHash(legal));
  });

  it('rejects a log whose EVENT was swapped under an unchanged hash', () => {
    const legal = logOf('0,0,0', '1,1,1');
    const swapped: EventLog = {
      uuid: legal.uuid,
      entries: [
        legal.entries[0]!,
        { ...legal.entries[1]!, event: { type: 'place', node: '2,2,2' } },
      ],
    };
    expect(validateAdoptable(SIZE, swapped)).toMatchObject({ ok: false, ply: 1, reason: 'broken-chain' });
  });

  it('propagates a NON-rules error verbatim instead of mislabelling it a rejected log', () => {
    const boom = new TypeError('replay exploded');
    const spy = vi.spyOn(Game.prototype, 'apply').mockImplementation(() => {
      throw boom;
    });
    expect(() => validateAdoptable(SIZE, logOf('0,0,0'))).toThrow(boom);
    spy.mockRestore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});

describe('property: nothing but the one narrow case ever auto-adopts', () => {
  /** Scattered nodes that can neither line up five in a row nor form a capture pattern. */
  const POOL = ['0,0,0', '1,1,1', '2,2,2', '3,3,3', '4,4,4', '0,4,2', '4,0,3', '2,0,4'];

  /**
   * A random reconciliation input: my own (legal) game, a peer log built from a prefix of mine plus
   * an arbitrary tail, and my seat. The tail is raw-appended, so it may be illegal — which is
   * exactly what a divergent peer may send.
   */
  const scenario = fc
    .tuple(
      fc.integer({ min: 0, max: 5 }),
      fc.integer({ min: 0, max: 5 }),
      fc.array(fc.constantFrom(...POOL), { minLength: 0, maxLength: 3 }),
      fc.constantFrom<'white' | 'black'>('white', 'black'),
    )
    .map(([mineLen, sharedRaw, tail, myColor]) => {
      const mine = gameOf(...POOL.slice(0, mineLen));
      const shared = Math.min(sharedRaw, mineLen);
      const base: EventLog = { uuid: UUID, entries: mine.log.entries.slice(0, shared) };
      const theirs = eventsOnto(
        base,
        tail.map((node): Event => ({ type: 'place', node })),
      );
      return { mine, theirs, myColor };
    });

  it('fast-forwards EXACTLY when they are one entry longer, mine is their prefix, and it is their turn', () => {
    fc.assert(
      fc.property(scenario, ({ mine, theirs, myColor }) => {
        // The rule re-derived from primitives, independently of the implementation: entry-hash
        // equality across my whole log, a lead of exactly one, and a local turn that is not mine.
        const oneLonger = theirs.entries.length === mine.log.entries.length + 1;
        const minePrefix = mine.log.entries.every((e, i) => theirs.entries[i]?.hash === e.hash);
        const theirTurn = mine.state().turn !== myColor;
        const expected = oneLonger && minePrefix && theirTurn;
        expect(reconcile(mine, theirs, myColor).action === 'fast-forward').toBe(expected);
      }),
      { numRuns: 500 },
    );
  });

  it('only ever answers in-sync / fast-forward / republish / needs-resolution, and only republishes when exactly one ahead', () => {
    fc.assert(
      fc.property(scenario, ({ mine, theirs, myColor }) => {
        const decision = reconcile(mine, theirs, myColor);
        expect(['in-sync', 'fast-forward', 'republish', 'needs-resolution']).toContain(
          decision.action,
        );
        if (decision.action === 'republish') {
          expect(theirs.entries.length).toBe(mine.log.entries.length - 1);
          expect(theirs.entries.every((e, i) => mine.log.entries[i]!.hash === e.hash)).toBe(true);
        }
        if (decision.action === 'in-sync') {
          expect(headHash(theirs)).toBe(headHash(mine.log));
        }
      }),
      { numRuns: 500 },
    );
  });

  it('carries an ancestor that is symmetric and never past either log', () => {
    fc.assert(
      fc.property(scenario, ({ mine, theirs }) => {
        const lca = lastCommonAncestor(mine.log, theirs);
        expect(lastCommonAncestor(theirs, mine.log)).toEqual(lca);
        expect(lca.ply).toBeLessThanOrEqual(Math.min(mine.log.entries.length, theirs.entries.length));
        const expectedHash =
          lca.ply === 0 ? genesisHash(UUID) : mine.log.entries[lca.ply - 1]!.hash;
        expect(lca.hash).toBe(expectedHash);
      }),
      { numRuns: 500 },
    );
  });

  it('rejects a log at the FIRST entry tampered with, whatever the tampering', () => {
    const tampering = fc
      .tuple(
        fc.integer({ min: 1, max: 5 }),
        fc.nat(),
        fc.constantFrom<'hash' | 'event'>('hash', 'event'),
      )
      .map(([len, targetRaw, how]) => {
        const legal = gameOf(...POOL.slice(0, len)).log;
        const target = targetRaw % len;
        const entries = legal.entries.map((entry, i) =>
          i !== target
            ? entry
            : how === 'hash'
              ? { ...entry, hash: `${entry.hash}-tampered` }
              : { ...entry, event: { type: 'place' as const, node: POOL[POOL.length - 1]! } },
        );
        return { log: { uuid: legal.uuid, entries }, target, legal };
      });

    fc.assert(
      fc.property(tampering, ({ log, target, legal }) => {
        expect(validateAdoptable(SIZE, legal)).toEqual({ ok: true });
        const rejection = validateAdoptable(SIZE, log);
        expect(rejection.ok).toBe(false);
        if (rejection.ok) throw new Error('expected a rejection');
        expect(rejection.ply).toBe(target);
      }),
      { numRuns: 300 },
    );
  });
});
