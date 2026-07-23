import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  reconcile,
  electInitiator,
  deferProposal,
  newProposal,
  resumeProposal,
  currentProposal,
  isConcrete,
  type Proposal,
  type AgreedGame,
  type Reject,
  type ReconcileResult,
  type Peer,
} from './admission';

// ---------------------------------------------------------------------------
// Helpers — a Reject/AgreedResult narrower so a failing assertion throws a clear
// message rather than reading `undefined` off the wrong variant.
// ---------------------------------------------------------------------------

function expectAgreed(r: ReconcileResult): AgreedGame {
  if (r.ok !== true) {
    throw new Error(`expected an agreed game, got reject '${(r as Reject).reason}'`);
  }
  return r.game;
}

function expectReject(r: ReconcileResult): Reject {
  if (r.ok !== false) {
    throw new Error('expected a reject, got an agreed game');
  }
  return r;
}

describe('proposal constructors + isConcrete', () => {
  it('deferProposal is the defer kind and is NOT concrete', () => {
    expect(deferProposal()).toEqual({ kind: 'defer' });
    expect(isConcrete(deferProposal())).toBe(false);
  });

  it('newProposal is the new kind and IS concrete (concrete-but-empty)', () => {
    expect(newProposal()).toEqual({ kind: 'new' });
    expect(isConcrete(newProposal())).toBe(true);
  });

  it('resumeProposal carries uuid + headHash and IS concrete', () => {
    expect(resumeProposal('g1', 'h1')).toEqual({ kind: 'resume', uuid: 'g1', headHash: 'h1' });
    expect(isConcrete(resumeProposal('g1', 'h1'))).toBe(true);
  });

  it('currentProposal carries uuid + headHash and IS concrete', () => {
    expect(currentProposal('g1', 'h1')).toEqual({ kind: 'current', uuid: 'g1', headHash: 'h1' });
    expect(isConcrete(currentProposal('g1', 'h1'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Reconciliation matrix (design §5)
// ---------------------------------------------------------------------------

describe('reconcile — 0 concrete (both defer) → new game', () => {
  it('two defers agree on a fresh new game', () => {
    const game = expectAgreed(reconcile(deferProposal(), deferProposal()));
    expect(game).toEqual({ kind: 'new' });
  });
});

describe('reconcile — 1 concrete → play it, the deferrer adopts', () => {
  it('a resume vs a defer plays the resume (existing uuid+headHash)', () => {
    const game = expectAgreed(reconcile(resumeProposal('g1', 'h1'), deferProposal()));
    expect(game).toEqual({ kind: 'existing', uuid: 'g1', headHash: 'h1' });
  });

  it('a defer vs a resume plays the resume (order does not matter)', () => {
    const game = expectAgreed(reconcile(deferProposal(), resumeProposal('g1', 'h1')));
    expect(game).toEqual({ kind: 'existing', uuid: 'g1', headHash: 'h1' });
  });

  it('a current vs a defer plays the current board', () => {
    const game = expectAgreed(reconcile(currentProposal('g7', 'hh'), deferProposal()));
    expect(game).toEqual({ kind: 'existing', uuid: 'g7', headHash: 'hh' });
  });

  it('a new vs a defer mints a fresh new game (the sole concrete is empty)', () => {
    const game = expectAgreed(reconcile(newProposal(), deferProposal()));
    expect(game).toEqual({ kind: 'new' });
  });

  it('a defer vs a new mints a fresh new game (order does not matter)', () => {
    const game = expectAgreed(reconcile(deferProposal(), newProposal()));
    expect(game).toEqual({ kind: 'new' });
  });
});

describe('reconcile — 2 concrete, same uuid + matching headHash → resume together', () => {
  it('two resumes of the same game resume it', () => {
    const game = expectAgreed(reconcile(resumeProposal('g1', 'h1'), resumeProposal('g1', 'h1')));
    expect(game).toEqual({ kind: 'existing', uuid: 'g1', headHash: 'h1' });
  });

  it('a resume vs a current of the same game+hash resume it (kind does not matter, only uuid+hash)', () => {
    const game = expectAgreed(reconcile(resumeProposal('g1', 'h1'), currentProposal('g1', 'h1')));
    expect(game).toEqual({ kind: 'existing', uuid: 'g1', headHash: 'h1' });
  });
});

describe('reconcile — 2 concrete, same uuid + divergent headHash → reject game-divergent', () => {
  it('same game, different heads is a genuine conflict (#38 seam), not a silent pick', () => {
    const reject = expectReject(reconcile(resumeProposal('g1', 'h1'), resumeProposal('g1', 'h2')));
    expect(reject.reason).toBe('game-divergent');
  });

  it('divergence is symmetric — swapping the two proposals gives the same reject', () => {
    const reject = expectReject(reconcile(resumeProposal('g1', 'h2'), resumeProposal('g1', 'h1')));
    expect(reject.reason).toBe('game-divergent');
  });
});

describe('reconcile — 2 concrete, different uuids → reject game-mismatch', () => {
  it('two different games is a mismatch, never a silent pick of one', () => {
    const reject = expectReject(reconcile(resumeProposal('g1', 'h1'), resumeProposal('g2', 'h2')));
    expect(reject.reason).toBe('game-mismatch');
  });

  it('different games with COINCIDENTALLY equal headHashes are still a mismatch (uuid decides identity)', () => {
    // headHash equality must never be read as same-game when the uuids differ.
    const reject = expectReject(reconcile(resumeProposal('g1', 'h1'), currentProposal('g2', 'h1')));
    expect(reject.reason).toBe('game-mismatch');
  });
});

describe('reconcile — two new/empty proposals are interchangeable, never block', () => {
  it('two news agree on a single fresh new game', () => {
    const game = expectAgreed(reconcile(newProposal(), newProposal()));
    expect(game).toEqual({ kind: 'new' });
  });

  it('a new vs a resume plays the resume (new is empty; the concrete history wins)', () => {
    // The `new` side has no history to preserve, so the sole real game is the resume.
    const game = expectAgreed(reconcile(newProposal(), resumeProposal('g1', 'h1')));
    expect(game).toEqual({ kind: 'existing', uuid: 'g1', headHash: 'h1' });
  });

  it('a resume vs a new plays the resume (order does not matter)', () => {
    const game = expectAgreed(reconcile(resumeProposal('g1', 'h1'), newProposal()));
    expect(game).toEqual({ kind: 'existing', uuid: 'g1', headHash: 'h1' });
  });
});

// ---------------------------------------------------------------------------
// Initiator election (design §4 Case 2, §11): earlier arrivalOrder, then lower playerId
// ---------------------------------------------------------------------------

describe('electInitiator — earlier arrival wins', () => {
  it('picks the peer with the smaller arrivalOrder regardless of playerId ordering', () => {
    const peers: Peer[] = [
      { playerId: 'zzz', arrivalOrder: 0 },
      { playerId: 'aaa', arrivalOrder: 1 },
    ];
    expect(electInitiator(peers)).toBe('zzz');
  });

  it('is order-insensitive over the input list — later-listed earlier-arriver still wins', () => {
    const peers: Peer[] = [
      { playerId: 'aaa', arrivalOrder: 5 },
      { playerId: 'zzz', arrivalOrder: 2 },
    ];
    expect(electInitiator(peers)).toBe('zzz');
  });
});

describe('electInitiator — tie on arrival breaks by lower playerId', () => {
  it('when arrivalOrder ties, the lexicographically-smaller playerId wins', () => {
    const peers: Peer[] = [
      { playerId: 'bob', arrivalOrder: 3 },
      { playerId: 'ann', arrivalOrder: 3 },
    ];
    expect(electInitiator(peers)).toBe('ann');
  });

  it('breaks a three-way arrival tie by the single lowest playerId', () => {
    const peers: Peer[] = [
      { playerId: 'carol', arrivalOrder: 1 },
      { playerId: 'alice', arrivalOrder: 1 },
      { playerId: 'bob', arrivalOrder: 1 },
    ];
    expect(electInitiator(peers)).toBe('alice');
  });

  it('an equal-arrival, HIGHER-playerId peer listed AFTER the leader does NOT displace it', () => {
    // The lower-playerId leader ('aaa') is listed FIRST; a same-arrival 'bbb' follows. A
    // `<` → `<=` weakening of the arrival compare would (wrongly) let the later 'bbb'
    // overwrite the leader on the tie. The strict `<` must keep 'aaa'. (mutation kill)
    const peers: Peer[] = [
      { playerId: 'aaa', arrivalOrder: 4 },
      { playerId: 'bbb', arrivalOrder: 4 },
    ];
    expect(electInitiator(peers)).toBe('aaa');
  });
});

describe('electInitiator — single peer and validation', () => {
  it('a lone peer elects itself', () => {
    expect(electInitiator([{ playerId: 'solo', arrivalOrder: 0 }])).toBe('solo');
  });

  it('throws on an empty peer list (no one to elect — a caller bug, surfaced not masked)', () => {
    expect(() => electInitiator([])).toThrow(/no peers/i);
  });
});

// ---------------------------------------------------------------------------
// Properties (fast-check)
// ---------------------------------------------------------------------------

describe('reconcile — properties (fast-check)', () => {
  const hashArb = fc.stringMatching(/^[a-z0-9]{1,8}$/);
  const uuidArb = fc.stringMatching(/^g[0-9]{1,4}$/);

  // An arbitrary Proposal across all kinds.
  const proposalArb: fc.Arbitrary<Proposal> = fc.oneof(
    fc.constant(deferProposal()),
    fc.constant(newProposal()),
    fc.tuple(uuidArb, hashArb).map(([u, h]) => resumeProposal(u, h)),
    fc.tuple(uuidArb, hashArb).map(([u, h]) => currentProposal(u, h)),
  );

  it('order-insensitive: reconcile(a,b) and reconcile(b,a) agree on the same game OR the same typed reject', () => {
    fc.assert(
      fc.property(proposalArb, proposalArb, (a, b) => {
        const ab = reconcile(a, b);
        const ba = reconcile(b, a);
        expect(ab.ok).toBe(ba.ok);
        if (ab.ok && ba.ok) {
          expect(ab.game).toEqual(ba.game);
        } else if (!ab.ok && !ba.ok) {
          expect(ab.reason).toBe(ba.reason);
        }
      }),
    );
  });

  it('total: every pair of proposals yields EITHER a valid agreed game OR a typed reject (never throws, never undefined)', () => {
    fc.assert(
      fc.property(proposalArb, proposalArb, (a, b) => {
        const r = reconcile(a, b);
        if (r.ok) {
          if (r.game.kind === 'new') {
            expect(r.game).toEqual({ kind: 'new' });
          } else {
            expect(r.game.kind).toBe('existing');
            expect(typeof r.game.uuid).toBe('string');
            expect(typeof r.game.headHash).toBe('string');
          }
        } else {
          expect(['game-mismatch', 'game-divergent']).toContain(r.reason);
        }
      }),
    );
  });

  it('an agreed EXISTING game always carries the uuid+headHash of a concrete input proposal', () => {
    // The agreed game is never invented — it is exactly one of the concrete proposals brought.
    fc.assert(
      fc.property(proposalArb, proposalArb, (a, b) => {
        const r = reconcile(a, b);
        if (r.ok && r.game.kind === 'existing') {
          const concretes = [a, b].filter(isConcrete);
          const matches = concretes.some(
            (p) =>
              (p.kind === 'resume' || p.kind === 'current') &&
              p.uuid === (r.game as { uuid: string }).uuid &&
              p.headHash === (r.game as { headHash: string }).headHash,
          );
          expect(matches).toBe(true);
        }
      }),
    );
  });

  it('a reject fires ONLY when both proposals are concrete non-empty (resume/current) — a defer or a new never rejects', () => {
    fc.assert(
      fc.property(proposalArb, proposalArb, (a, b) => {
        const r = reconcile(a, b);
        if (!r.ok) {
          const bothConcreteWithHistory =
            (a.kind === 'resume' || a.kind === 'current') &&
            (b.kind === 'resume' || b.kind === 'current');
          expect(bothConcreteWithHistory).toBe(true);
        }
      }),
    );
  });
});

describe('electInitiator — properties (fast-check)', () => {
  const idArb = fc.stringMatching(/^[a-z]{1,8}$/);
  const peerArb: fc.Arbitrary<Peer> = fc.record({
    playerId: idArb,
    arrivalOrder: fc.integer({ min: 0, max: 20 }),
  });

  it('is deterministic + order-insensitive: any permutation of the same peers elects the same playerId', () => {
    fc.assert(
      fc.property(
        fc
          .uniqueArray(peerArb, { minLength: 1, maxLength: 6, selector: (p) => p.playerId })
          .filter((ps) =>
            // no (arrivalOrder, playerId) is fully ambiguous — playerIds are already unique,
            // so (arrivalOrder, playerId) pairs are unique and the winner is well-defined.
            ps.length > 0,
          ),
        (peers) => {
          const shuffled = [...peers].reverse();
          expect(electInitiator(shuffled)).toBe(electInitiator(peers));
        },
      ),
    );
  });

  it('elects the true minimum by (arrivalOrder, playerId): no peer beats the winner', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(peerArb, { minLength: 1, maxLength: 6, selector: (p) => p.playerId }),
        (peers) => {
          const winner = electInitiator(peers);
          const win = peers.find((p) => p.playerId === winner)!;
          for (const p of peers) {
            const beatsWinner =
              p.arrivalOrder < win.arrivalOrder ||
              (p.arrivalOrder === win.arrivalOrder && p.playerId < win.playerId);
            expect(beatsWinner).toBe(false);
          }
        },
      ),
    );
  });
});
