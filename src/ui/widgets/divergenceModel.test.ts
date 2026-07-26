import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { deriveDivergence, type DivergenceFacts } from './divergenceModel';
import {
  initialHandshake,
  propose,
  receiveProposal,
  receiveResponse,
  respond,
  type HandshakeState,
} from '../../net/handshake';
import { resolutionAction, type ResolutionCandidates } from '../../net/resolution';
import type { LogDiff } from '../../net/logDiff';

/**
 * Task V.4b (epic #47, absorbs #38) — the PURE divergence-panel view-model.
 *
 * This is the ONE screen where a player meets the sync protocol, and the build plan's collaboration
 * point is explicit that it must not read like a merge tool. So the assertions here are about the
 * two things that make it usable rather than merely correct:
 *
 *  1. **Which choices are offered, and when.** Always the two sides; the rewind only when it is a
 *     genuinely THIRD answer (a real fork with a shared ancestor) — offering a third button that does
 *     the same thing as one already on screen is exactly how a simple choice starts reading like a
 *     merge tool.
 *  2. **That the copy describes THIS divergence.** The counts in the sentences come from the diff, so
 *     a one-sided divergence never says "your 0 moves stay" and a fork never mislabels whose moves
 *     are dropped. An incoming ask is said back IN OUR OWN TERMS, because the responder is answering
 *     a question about its own game.
 *
 * Plus the honest arm: a suggestion naming a history this client does not hold cannot be accepted —
 * the card says so and offers only Decline.
 */

/** A stand-in diff: `mine`/`theirs` tails of the given lengths past ply `sharedPly`. */
function diffOf(sharedPly: number, mine: number, theirs: number): LogDiff {
  const tail = (count: number, label: string) =>
    Array.from({ length: count }, (_, i) => ({
      ply: sharedPly + i,
      event: { type: 'place' as const, node: `${label}${i}` },
      player: 'white' as const,
      text: `white plays ${label}${i}`,
    }));
  return { sharedPly, mine: tail(mine, 'm'), theirs: tail(theirs, 't') };
}

const CANDIDATES: ResolutionCandidates = { mine: 'H-mine', theirs: 'H-theirs', lca: 'H-lca' };

/** A fork: both sides played on past a shared ancestor. */
const FORK: DivergenceFacts = { diff: diffOf(2, 1, 2), candidates: CANDIDATES };
/** One-sided: my log is a strict prefix of theirs (I am behind by two). */
const BEHIND: DivergenceFacts = {
  diff: diffOf(1, 0, 2),
  candidates: { mine: 'H-lca', theirs: 'H-theirs', lca: 'H-lca' },
};

const IDLE = initialHandshake();

/** The handshake state after WE proposed the resolution naming `target`. */
function weProposed(target: string): HandshakeState {
  return propose(IDLE, resolutionAction(target), 'white', () => 'ask-1').state;
}

/** The handshake state after the PEER proposed the resolution naming `target`. */
function theyProposed(target: string): HandshakeState {
  return receiveProposal(IDLE, {
    kind: 'proposal',
    id: 'ask-2',
    action: resolutionAction(target),
    proposedBy: 'black',
  });
}

describe('deriveDivergence — nothing open', () => {
  it('is a hidden, empty card when there is no divergence', () => {
    const view = deriveDivergence(null, IDLE);
    expect(view.show).toBe(false);
    expect(view.options).toEqual([]);
    expect(view.mine).toEqual([]);
    expect(view.theirs).toEqual([]);
    expect(view.headline).toBe('');
    expect(view.explanation).toBe('');
    expect(view.note).toBeNull();
    expect(view.incomingText).toBeNull();
    expect(view.canAccept).toBe(false);
    expect(view.ui).toBe('choose');
    expect(view.sharedPly).toBe(0);
  });

  it('stays hidden even with a resolution ask in flight — the card is about the divergence', () => {
    expect(deriveDivergence(null, weProposed('H-mine')).show).toBe(false);
  });
});

describe('deriveDivergence — what it shows', () => {
  it('shows both tails with their plies and the shared point', () => {
    const view = deriveDivergence(FORK, IDLE);
    expect(view.show).toBe(true);
    expect(view.sharedPly).toBe(2);
    expect(view.mine).toEqual([{ ply: 2, text: 'white plays m0' }]);
    expect(view.theirs).toEqual([
      { ply: 2, text: 'white plays t0' },
      { ply: 3, text: 'white plays t1' },
    ]);
  });

  it('renders NO hashes anywhere — the machine reconciles on them, a player does not', () => {
    const view = deriveDivergence(FORK, theyProposed('H-mine'));
    const painted = [
      view.headline,
      view.explanation,
      view.note ?? '',
      view.incomingText ?? '',
      ...view.options.map((o) => `${o.label} ${o.detail}`),
      ...view.mine.map((m) => m.text),
      ...view.theirs.map((m) => m.text),
    ].join(' | ');
    for (const hash of [CANDIDATES.mine, CANDIDATES.theirs, CANDIDATES.lca!]) {
      expect(painted).not.toContain(hash);
    }
  });

  it('says what you still agree on, in moves', () => {
    expect(deriveDivergence(FORK, IDLE).explanation).toContain('agree on the first 2 moves');
    expect(deriveDivergence({ ...FORK, diff: diffOf(1, 1, 1) }, IDLE).explanation).toContain(
      'agree on the first 1 move',
    );
  });

  it('does not claim you agree on anything when you share NO moves', () => {
    const scratch: DivergenceFacts = { diff: diffOf(0, 1, 1), candidates: CANDIDATES };
    const explanation = deriveDivergence(scratch, IDLE).explanation;
    expect(explanation).toContain('no moves in common');
    expect(explanation).not.toContain('first 0');
  });
});

describe('deriveDivergence — which resolutions are offered', () => {
  it('a FORK offers all three, including going back to where you agreed', () => {
    const view = deriveDivergence(FORK, IDLE);
    expect(view.options.map((o) => o.choice)).toEqual(['take-mine', 'take-theirs', 'rewind']);
    expect(view.options[2]!.detail).toContain('move 2');
  });

  it('a ONE-SIDED divergence offers only the two sides — the rewind would be a duplicate button', () => {
    // My log IS the ancestor here, so "go back to where you agreed" and "keep my game" are the same
    // act. A third button doing what one already on screen does is how a choice starts reading like
    // a merge tool.
    expect(deriveDivergence(BEHIND, IDLE).options.map((o) => o.choice)).toEqual([
      'take-mine',
      'take-theirs',
    ]);
  });

  it('never offers a rewind when the two share NO ancestor at all', () => {
    const strangers: DivergenceFacts = {
      diff: diffOf(0, 1, 1),
      candidates: { mine: 'H-mine', theirs: 'H-theirs', lca: null },
    };
    expect(deriveDivergence(strangers, IDLE).options.map((o) => o.choice)).toEqual([
      'take-mine',
      'take-theirs',
    ]);
  });

  it('the detail lines describe THIS divergence — a fork names both sides’ counts', () => {
    const view = deriveDivergence(FORK, IDLE);
    const keep = view.options.find((o) => o.choice === 'take-mine')!;
    const take = view.options.find((o) => o.choice === 'take-theirs')!;
    expect(keep.detail).toBe("Your 1 move stays; your opponent's 2 moves are dropped.");
    expect(take.detail).toBe("Your opponent's 2 moves are taken; your 1 move is dropped.");
  });

  it('a divergence where I am BEHIND never says "my moves stay" or invents a loss', () => {
    const view = deriveDivergence(BEHIND, IDLE);
    const keep = view.options.find((o) => o.choice === 'take-mine')!;
    const take = view.options.find((o) => o.choice === 'take-theirs')!;
    expect(keep.detail).toBe('Stay where you are; the 2 moves only your opponent has are dropped.');
    expect(take.detail).toBe("Take your opponent's 2 moves; nothing of yours is dropped.");
  });

  it('a divergence where I am AHEAD says so from the other side', () => {
    const ahead: DivergenceFacts = {
      diff: diffOf(1, 2, 0),
      candidates: { mine: 'H-mine', theirs: 'H-lca', lca: 'H-lca' },
    };
    const view = deriveDivergence(ahead, IDLE);
    const keep = view.options.find((o) => o.choice === 'take-mine')!;
    const take = view.options.find((o) => o.choice === 'take-theirs')!;
    expect(keep.detail).toBe('Nothing of yours changes; your opponent catches up to your 2 moves.');
    expect(take.detail).toBe('Go back to where your opponent is; your 2 moves since then are dropped.');
    // Still two buttons: their log IS the ancestor, so a rewind would repeat "use their game".
    expect(view.options).toHaveLength(2);
  });

  it('singular/plural is never wrong (no "1 moves", no "2 move")', () => {
    fc.assert(
      fc.property(fc.nat({ max: 4 }), fc.nat({ max: 4 }), fc.nat({ max: 4 }), (shared, m, t) => {
        const view = deriveDivergence({ diff: diffOf(shared, m, t), candidates: CANDIDATES }, IDLE);
        const prose = [view.explanation, ...view.options.map((o) => o.detail)].join(' ');
        expect(prose).not.toMatch(/\b1 moves\b/);
        expect(prose).not.toMatch(/\b(?!1\b)\d+ move\b/);
      }),
    );
  });
});

describe('deriveDivergence — the handshake sub-states', () => {
  it('WE asked → waiting, with no buttons of our own', () => {
    const view = deriveDivergence(FORK, weProposed('H-mine'));
    expect(view.ui).toBe('waiting');
    expect(view.options).toEqual([]);
    expect(view.note).toBe('Waiting for your opponent to agree…');
    expect(view.incomingText).toBeNull();
    // The facts stay on screen while we wait — you can still see what you are waiting on.
    expect(view.mine).toHaveLength(1);
    expect(view.theirs).toHaveLength(2);
  });

  it('THEY asked → the ask said back in OUR terms, with no counter-proposal buttons', () => {
    // They named THEIR history, which is our `theirs`: from here, "keep their game".
    const view = deriveDivergence(FORK, theyProposed('H-theirs'));
    expect(view.ui).toBe('incoming');
    expect(view.options).toEqual([]);
    expect(view.canAccept).toBe(true);
    expect(view.incomingText).toBe(
      'Your opponent suggests: keep THEIR game (your 1 move would be dropped).',
    );
    expect(view.note).toBeNull();
  });

  it('THEY asked to keep OUR game → said as keeping ours, not theirs', () => {
    const view = deriveDivergence(FORK, theyProposed('H-mine'));
    expect(view.incomingText).toBe(
      'Your opponent suggests: keep YOUR game (their 2 moves would be dropped).',
    );
    expect(view.canAccept).toBe(true);
  });

  it('THEY asked to go back → said as a mutual rewind, naming the move', () => {
    const view = deriveDivergence(FORK, theyProposed('H-lca'));
    expect(view.incomingText).toBe(
      'Your opponent suggests: both go back to move 2 (everything after it dropped on both sides).',
    );
    expect(view.canAccept).toBe(true);
  });

  it('an ask naming a history we do NOT hold cannot be accepted — only declined, and it says why', () => {
    const view = deriveDivergence(FORK, theyProposed('H-from-nowhere'));
    expect(view.ui).toBe('incoming');
    expect(view.canAccept).toBe(false);
    expect(view.incomingText).toBe(
      'Your opponent suggested continuing from a version of the game this one does not have.',
    );
    expect(view.note).toBe('You can only decline — nothing here matches either of your games.');
  });

  it('a DECLINE brings the buttons back with one line saying so', () => {
    // We asked, they said no: the handshake records the declined resolution and clears the pending.
    const asked = weProposed('H-mine');
    const declined = receiveResponse(asked, {
      kind: 'response',
      proposalId: 'ask-1',
      accepted: false,
    });
    const view = deriveDivergence(FORK, declined);
    expect(view.ui).toBe('declined');
    expect(view.options.map((o) => o.choice)).toEqual(['take-mine', 'take-theirs', 'rewind']);
    expect(view.note).toBe('Your opponent did not agree to that. You can suggest something else.');
  });

  it('OUR decline of THEIR ask also returns to picking (either side may suggest next)', () => {
    const asked = theyProposed('H-theirs');
    const answered = respond(asked, 'ask-2', false).state;
    const view = deriveDivergence(FORK, answered);
    expect(view.ui).toBe('declined');
    expect(view.options).toHaveLength(3);
  });

  it('a declined REMATCH/UNDO is not this card’s business — it stays plainly in choose', () => {
    const asked = propose(IDLE, 'rematch', 'white', () => 'r1').state;
    const declined = receiveResponse(asked, { kind: 'response', proposalId: 'r1', accepted: false });
    const view = deriveDivergence(FORK, declined);
    expect(view.ui).toBe('choose');
    expect(view.note).toBeNull();
  });

  it('an ACCEPTED resolution still on the handshake does not look like a decline', () => {
    const asked = weProposed('H-mine');
    const accepted = receiveResponse(asked, {
      kind: 'response',
      proposalId: 'ask-1',
      accepted: true,
    });
    const view = deriveDivergence(FORK, accepted);
    expect(view.ui).toBe('choose');
    expect(view.note).toBeNull();
  });

  it('a pending REMATCH/UNDO ask leaves the card in choose — it belongs to another consumer', () => {
    const rematchPending = propose(IDLE, 'rematch', 'white', () => 'r2').state;
    expect(deriveDivergence(FORK, rematchPending).ui).toBe('choose');
    const undoIncoming = receiveProposal(IDLE, {
      kind: 'proposal',
      id: 'u1',
      action: 'undo',
      proposedBy: 'black',
    });
    const view = deriveDivergence(FORK, undoIncoming);
    expect(view.ui).toBe('choose');
    expect(view.options).toHaveLength(3);
  });
});

describe('deriveDivergence — the exact copy (this is the one screen a player reads)', () => {
  const HEADLINE = 'Your game and your opponent’s have gone out of step';

  it('every visible state carries the same headline', () => {
    for (const handshake of [
      IDLE,
      weProposed('H-mine'),
      theyProposed('H-theirs'),
      theyProposed('H-nope'),
    ]) {
      const view = deriveDivergence(FORK, handshake);
      expect(view.show).toBe(true);
      expect(view.headline).toBe(HEADLINE);
    }
  });

  it('the explanation is exact for none / one / several shared moves', () => {
    const of = (shared: number) =>
      deriveDivergence({ diff: diffOf(shared, 1, 1), candidates: CANDIDATES }, IDLE).explanation;
    expect(of(0)).toBe(
      'You and your opponent have no moves in common. After that you are holding different games. Nothing changes until you both pick the same one.',
    );
    expect(of(1)).toBe(
      'You and your opponent agree on the first 1 move. After that you are holding different games. Nothing changes until you both pick the same one.',
    );
    expect(of(3)).toBe(
      'You and your opponent agree on the first 3 moves. After that you are holding different games. Nothing changes until you both pick the same one.',
    );
  });

  it('the three buttons are labelled exactly', () => {
    const options = deriveDivergence(FORK, IDLE).options;
    expect(options.map((o) => o.label)).toEqual([
      'Keep my game',
      'Use my opponent’s game',
      'Go back to where you agreed',
    ]);
    expect(options[2]!.detail).toBe(
      'Both games return to move 2; everything after it is dropped on both sides.',
    );
  });

  /** Every shape a divergence can take, with the exact sentence each button must show. */
  const DETAILS: readonly {
    readonly name: string;
    readonly mine: number;
    readonly theirs: number;
    readonly keep: string;
    readonly take: string;
  }[] = [
    {
      name: 'a fork, one move each',
      mine: 1,
      theirs: 1,
      keep: "Your 1 move stays; your opponent's 1 move is dropped.",
      take: "Your opponent's 1 move is taken; your 1 move is dropped.",
    },
    {
      name: 'a fork, several moves each',
      mine: 2,
      theirs: 3,
      keep: "Your 2 moves stay; your opponent's 3 moves are dropped.",
      take: "Your opponent's 3 moves are taken; your 2 moves are dropped.",
    },
    {
      name: 'behind by one',
      mine: 0,
      theirs: 1,
      keep: 'Stay where you are; the 1 move only your opponent has is dropped.',
      take: "Take your opponent's 1 move; nothing of yours is dropped.",
    },
    {
      name: 'behind by several',
      mine: 0,
      theirs: 2,
      keep: 'Stay where you are; the 2 moves only your opponent has are dropped.',
      take: "Take your opponent's 2 moves; nothing of yours is dropped.",
    },
    {
      name: 'ahead by one',
      mine: 1,
      theirs: 0,
      keep: 'Nothing of yours changes; your opponent catches up to your 1 move.',
      take: 'Go back to where your opponent is; your 1 move since then is dropped.',
    },
    {
      name: 'ahead by several',
      mine: 3,
      theirs: 0,
      keep: 'Nothing of yours changes; your opponent catches up to your 3 moves.',
      take: 'Go back to where your opponent is; your 3 moves since then are dropped.',
    },
  ];

  it.each(DETAILS)('$name — both buttons say exactly what they do', ({ mine, theirs, keep, take }) => {
    const view = deriveDivergence({ diff: diffOf(2, mine, theirs), candidates: CANDIDATES }, IDLE);
    expect(view.options.find((o) => o.choice === 'take-mine')!.detail).toBe(keep);
    expect(view.options.find((o) => o.choice === 'take-theirs')!.detail).toBe(take);
  });

  it('an incoming ask is described exactly, in each of the three shapes', () => {
    const of = (target: string) => deriveDivergence(FORK, theyProposed(target)).incomingText;
    expect(of('H-mine')).toBe(
      'Your opponent suggests: keep YOUR game (their 2 moves would be dropped).',
    );
    expect(of('H-theirs')).toBe(
      'Your opponent suggests: keep THEIR game (your 1 move would be dropped).',
    );
    expect(of('H-lca')).toBe(
      'Your opponent suggests: both go back to move 2 (everything after it dropped on both sides).',
    );
  });

  it('Accept is offered ONLY while answering an ask we can honour', () => {
    expect(deriveDivergence(FORK, IDLE).canAccept).toBe(false);
    expect(deriveDivergence(FORK, weProposed('H-mine')).canAccept).toBe(false);
    expect(deriveDivergence(FORK, theyProposed('H-theirs')).canAccept).toBe(true);
    expect(deriveDivergence(FORK, theyProposed('H-nope')).canAccept).toBe(false);
  });
});
