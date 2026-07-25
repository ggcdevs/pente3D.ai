import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  reconcile,
  acceptsGame,
  decideAdmission,
  acceptsCrossing,
  electInitiator,
  deferProposal,
  newProposal,
  resumeProposal,
  currentProposal,
  isConcrete,
  type Proposal,
  type AgreedGame,
  type GameGate,
  type OfferedGame,
  type Reject,
  type ReconcileResult,
  type SeedAcceptance,
  type Peer,
} from './admission';
import { claimSeat, emptySeatMap, seatOf, type SeatMap } from './seats';

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

function expectReject(r: ReconcileResult | SeedAcceptance): Reject {
  if (r.ok !== false) {
    throw new Error('expected a reject, got an accepted/agreed game');
  }
  return r;
}

/** An offered EMPTY game (a genesis-only log) with the given uuid — what a `new` seed may adopt. */
function emptyGame(uuid: string): OfferedGame {
  return { uuid, empty: true };
}

/** An offered game that CARRIES HISTORY — the thing only dealer's choice may adopt (design §3). */
function playedGame(uuid: string): OfferedGame {
  return { uuid, empty: false };
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

describe('reconcile — only DEALER\'S CHOICE adopts a peer\'s game; the deferrer adopts', () => {
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

describe('reconcile — two EMPTY seeds are interchangeable (ONE game, settled at genesis)', () => {
  it('two news agree on a single fresh new game', () => {
    const game = expectAgreed(reconcile(newProposal(), newProposal()));
    expect(game).toEqual({ kind: 'new' });
  });
});

/**
 * The design §3 seed rule, and the reason V.2 exists (issues #46 / #43). v3 reconciled a `new` beside
 * a real game by PLAYING THE REAL GAME — so the peer that explicitly asked to start over was handed
 * the other device's board (#46), and re-using a room code kept the old game alive (#43). The user's
 * rule, verbatim: *"when selecting 'New Game', i would expect the laptop to never send non-empty
 * gamestate data and i would expect my phone to reject any non-empty gamestate data. only 'Dealer's
 * Choice' should allow a device to accept non-empty gamestate data from the other device."*
 */
describe('reconcile — a `new` seed beside a REAL game is REFUSED, never silently adopted (#46/#43)', () => {
  it('new vs resume is a typed seed-refused, NOT the resume being played', () => {
    const r = reconcile(newProposal(), resumeProposal('g1', 'h1'));
    expect(expectReject(r).reason).toBe('seed-refused');
    // The v3 behaviour, pinned as forbidden: the agreed game must NOT be the peer's game.
    expect(r.ok).toBe(false);
  });

  it('resume vs new is the SAME reject (order-insensitive — either side may be the New one)', () => {
    expect(expectReject(reconcile(resumeProposal('g1', 'h1'), newProposal())).reason).toBe(
      'seed-refused',
    );
  });

  it('new vs current is refused too — provenance does not matter, only that a real game was brought', () => {
    expect(expectReject(reconcile(newProposal(), currentProposal('g9', 'hh'))).reason).toBe(
      'seed-refused',
    );
    expect(expectReject(reconcile(currentProposal('g9', 'hh'), newProposal())).reason).toBe(
      'seed-refused',
    );
  });

  it('the refusal is about the SEED, not the identity: a different uuid/head refuses identically', () => {
    // No uuid/headHash pairing makes a `new` accept a real game, so the reason can never degrade
    // into the identity-level `game-mismatch`/`game-divergent` reasons.
    for (const [uuid, head] of [
      ['a', 'a'],
      ['zzzz', 'q1'],
      ['g1', 'h1'],
    ] as const) {
      expect(expectReject(reconcile(newProposal(), resumeProposal(uuid, head))).reason).toBe(
        'seed-refused',
      );
    }
  });

  it('CONTRAST: the same real game beside a DEFER is adopted — dealer\'s choice is the adopting kind', () => {
    // Proves the reject above is specific to `new` and not "any non-defer pairing blocks".
    const game = expectAgreed(reconcile(deferProposal(), resumeProposal('g1', 'h1')));
    expect(game).toEqual({ kind: 'existing', uuid: 'g1', headHash: 'h1' });
  });
});

// ---------------------------------------------------------------------------
// acceptsGame — the seed matrix at the BYTE level (design §3), the half `reconcile`
// cannot enforce: what a peer may ADOPT off the wire, judged on the game it is actually
// offered rather than on what the pair PROPOSED.
// ---------------------------------------------------------------------------

describe("acceptsGame — dealer's choice is the ONLY kind that adopts a peer's real game", () => {
  it('a defer accepts a game WITH history (the whole point of dealer\'s choice)', () => {
    expect(acceptsGame(deferProposal(), playedGame('g1'))).toEqual({ ok: true });
  });

  it('a defer accepts an EMPTY game too (it brought nothing to protect)', () => {
    expect(acceptsGame(deferProposal(), emptyGame('g1'))).toEqual({ ok: true });
  });
});

describe('acceptsGame — a `new` seed accepts EMPTY only (the user\'s rule in #46)', () => {
  it('accepts an empty game (a fresh board is exactly what New asked for)', () => {
    expect(acceptsGame(newProposal(), emptyGame('fresh-uuid'))).toEqual({ ok: true });
  });

  it('REFUSES a game carrying history, with the typed seed-refused reason', () => {
    expect(expectReject(acceptsGame(newProposal(), playedGame('g1'))).reason).toBe('seed-refused');
  });

  it('refuses history REGARDLESS of the uuid — even a game we would otherwise hold', () => {
    // Emptiness alone decides for `new`: no uuid makes a played game adoptable. This is what stops an
    // arbiter (whose own proposal was `new` but whose board has since moved on) pushing its game.
    expect(expectReject(acceptsGame(newProposal(), playedGame('same-as-mine'))).reason).toBe(
      'seed-refused',
    );
  });
});

describe('acceptsGame — a `resume`/`current` seed accepts its OWN uuid only', () => {
  it('accepts the game it named', () => {
    expect(acceptsGame(resumeProposal('g1', 'h1'), playedGame('g1'))).toEqual({ ok: true });
  });

  it('accepts its own uuid even when the offered log is EMPTY (identity decides, not length)', () => {
    // Being behind on the SAME game is convergence (the V.4 fast-forward/resolution decision), not a
    // seed violation — so the seed gate must not turn a short log into a refusal.
    expect(acceptsGame(resumeProposal('g1', 'h1'), emptyGame('g1'))).toEqual({ ok: true });
  });

  it('REFUSES a DIFFERENT game that carries history — game-mismatch (different games, both real)', () => {
    expect(expectReject(acceptsGame(resumeProposal('g1', 'h1'), playedGame('g2'))).reason).toBe(
      'game-mismatch',
    );
  });

  it('REFUSES a different EMPTY game — seed-refused (the peer chose New / brought nothing)', () => {
    // The mirror of `new` refusing a real game, reported with the SAME reason from either side.
    expect(expectReject(acceptsGame(resumeProposal('g1', 'h1'), emptyGame('g2'))).reason).toBe(
      'seed-refused',
    );
  });

  it('a `current` seed behaves IDENTICALLY to a `resume` (provenance is immaterial)', () => {
    expect(acceptsGame(currentProposal('g1', 'h1'), playedGame('g1'))).toEqual({ ok: true });
    expect(expectReject(acceptsGame(currentProposal('g1', 'h1'), playedGame('g2'))).reason).toBe(
      'game-mismatch',
    );
    expect(expectReject(acceptsGame(currentProposal('g1', 'h1'), emptyGame('g2'))).reason).toBe(
      'seed-refused',
    );
  });

  it('the headHash is NOT part of the seed gate — a divergent head on the SAME uuid is accepted', () => {
    // Deliberate: head divergence is the sync policy's decision (design §5 / V.4), not the seed's, so
    // the two rules cannot fork. `acceptsGame` sees only uuid + emptiness by construction.
    expect(acceptsGame(resumeProposal('g1', 'my-head'), playedGame('g1'))).toEqual({ ok: true });
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
          expect(['game-mismatch', 'game-divergent', 'seed-refused']).toContain(r.reason);
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

  it('a reject fires ONLY when at least one side brought a REAL game — a defer NEVER rejects', () => {
    // Dealer's choice is the universal adopter: whatever it is paired with, an entry is possible. So
    // every reject requires a real game on at least one side, and the OTHER side to be either another
    // real game (identity reasons) or a `new` (the seed reason).
    fc.assert(
      fc.property(proposalArb, proposalArb, (a, b) => {
        const r = reconcile(a, b);
        if (!r.ok) {
          const hist = (p: Proposal): boolean => p.kind === 'resume' || p.kind === 'current';
          expect(hist(a) || hist(b)).toBe(true);
          expect(a.kind !== 'defer' && b.kind !== 'defer').toBe(true);
        }
      }),
    );
  });

  it('a `new` seed NEVER yields a non-empty agreed game — it agrees on a fresh game or refuses', () => {
    // The design §3 half `reconcile` owns: no pairing lets "New game" come back holding a peer's game.
    fc.assert(
      fc.property(proposalArb, proposalArb, (a, b) => {
        if (a.kind !== 'new' && b.kind !== 'new') return;
        const r = reconcile(a, b);
        if (r.ok) expect(r.game).toEqual({ kind: 'new' });
        else expect(r.reason).toBe('seed-refused');
      }),
    );
  });

  it('an agreed EXISTING game is named by EVERY non-deferring peer — nobody is handed a game it did not ask for', () => {
    fc.assert(
      fc.property(proposalArb, proposalArb, (a, b) => {
        const r = reconcile(a, b);
        if (!r.ok || r.game.kind !== 'existing') return;
        const agreedUuid = r.game.uuid;
        for (const p of [a, b]) {
          if (p.kind === 'defer') continue; // the deferrer asked for nothing — it adopts by definition
          expect(p.kind === 'resume' || p.kind === 'current').toBe(true);
          expect((p as { uuid: string }).uuid).toBe(agreedUuid);
        }
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// decideAdmission — the WHOLE arbiter verdict, the rule the wire actually applies.
//
// `session.ts` used to compose this inline (reconcile → "can I serve the agreed game?" →
// acceptsGame), and the composition contradicted the matrix: an arbiter can only ever serve
// its OWN engine, so a DEFERRING arbiter — the one seed that is supposed to adopt a peer's
// real game — refused the newcomer's game as `game-mismatch` before the seed gate ran. These
// tests are stated against the arbiter's real serving behaviour: the game its ENGINE HOLDS,
// which is not always the game its proposal named.
// ---------------------------------------------------------------------------

describe('decideAdmission — the deferring ARBITER adopts the newcomer’s game (design §3)', () => {
  it('defer arbiter (holding a fresh empty game) + resume newcomer → serve THEIRS, by that uuid', () => {
    // The row V.2 exists to preserve, in the direction where the DEFERRER is the arbiter: it brought
    // nothing, so the pair plays the newcomer's real game and the arbiter is the one that adopts.
    const d = decideAdmission(deferProposal(), emptyGame('fresh-mine'), resumeProposal('g1', 'h1'));
    expect(d).toEqual({ ok: true, serve: 'theirs', uuid: 'g1' });
  });

  it('a `current` newcomer is adopted identically — provenance never changes the verdict', () => {
    expect(
      decideAdmission(deferProposal(), emptyGame('fresh-mine'), currentProposal('g7', 'h7')),
    ).toEqual({ ok: true, serve: 'theirs', uuid: 'g7' });
  });

  it('a defer arbiter that is MID-GAME keeps its game — `defer` never discards a history we hold', () => {
    // `join()` sends `defer`, so without this a peer that joined and then played a whole game would
    // abandon it, mid-play, for any later arrival that named another game. The seed answered "which
    // game do we start on"; once we have a history the answer is in.
    expect(
      decideAdmission(deferProposal(), playedGame('g-live'), resumeProposal('g-other', 'h1')),
    ).toEqual({ ok: false, reason: 'game-mismatch' });
    // The same arbiter still adopts while its own game is EMPTY (the row above) — the difference is
    // what WE hold, not which seed we typed.
    expect(
      decideAdmission(deferProposal(), emptyGame('g-fresh'), resumeProposal('g-other', 'h1')),
    ).toEqual({ ok: true, serve: 'theirs', uuid: 'g-other' });
  });

  it('…but a defer arbiter that ALREADY HOLDS the agreed game serves it itself (it has the bytes)', () => {
    // A returning deferrer re-seeded from its breadcrumb onto the very game the newcomer is resuming:
    // nothing to adopt, and it can serve the history it holds.
    const d = decideAdmission(deferProposal(), playedGame('g1'), resumeProposal('g1', 'h1'));
    expect(d).toEqual({ ok: true, serve: 'mine' });
  });

  it('two defers agree on a fresh game, which the arbiter serves (no adoption either way)', () => {
    expect(decideAdmission(deferProposal(), emptyGame('fresh-mine'), deferProposal())).toEqual({
      ok: true,
      serve: 'mine',
    });
  });

  it('a defer arbiter is NOT a licence to adopt: a `new` newcomer still gets the arbiter’s game', () => {
    // `reconcile(defer, new)` agrees on a FRESH game, not an existing one, so there is nothing of the
    // newcomer's to adopt — the arbiter serves its own empty game and the newcomer's seed accepts it.
    expect(decideAdmission(deferProposal(), emptyGame('fresh-mine'), newProposal())).toEqual({
      ok: true,
      serve: 'mine',
    });
  });
});

describe('decideAdmission — refusals are judged on what we HOLD, never on what we proposed', () => {
  it('a `new` arbiter refuses a resume newcomer (seed-refused) — the #46/#43 rule, serving side', () => {
    expect(decideAdmission(newProposal(), emptyGame('fresh'), resumeProposal('g1', 'h1'))).toEqual({
      ok: false,
      reason: 'seed-refused',
    });
  });

  it('a `new` arbiter whose board has MOVED ON refuses a `new` newcomer (the bytes, not the proposals)', () => {
    // `reconcile(new, new)` agrees on "a fresh game" — but a resident can play while alone, so the game
    // it would actually serve has history, and "New Game" must never be handed a game in progress.
    expect(decideAdmission(newProposal(), playedGame('g-played'), newProposal())).toEqual({
      ok: false,
      reason: 'seed-refused',
    });
  });

  it('an arbiter on a DIFFERENT real game than its proposal named → game-mismatch (accurately)', () => {
    // Proposals agree on `g1`; our engine actually holds `g2`. The newcomer really would be handed a
    // different game than it asked for, so `game-mismatch` ("different games") is the honest word.
    expect(decideAdmission(resumeProposal('g1', 'h1'), playedGame('g2'), resumeProposal('g1', 'h1'))).toEqual({
      ok: false,
      reason: 'game-mismatch',
    });
  });

  it('an arbiter that RE-MATCHED into a fresh empty game → seed-refused, not a mislabelled mismatch', () => {
    // Reachable without any tampering: the arbiter resumed `g1`, then a rematch reset it onto a fresh
    // EMPTY game while its proposal still says `resume(g1)`. What it now offers is an empty game — which
    // is exactly the "one of you brought New Game" situation `seed-refused` describes.
    expect(
      decideAdmission(resumeProposal('g1', 'h1'), emptyGame('fresh-rematch'), resumeProposal('g1', 'h1')),
    ).toEqual({ ok: false, reason: 'seed-refused' });
  });

  it('a reconcile-level reject passes through VERBATIM (divergent heads, different games)', () => {
    expect(
      decideAdmission(resumeProposal('g1', 'h1'), playedGame('g1'), resumeProposal('g1', 'OTHER')),
    ).toEqual({ ok: false, reason: 'game-divergent' });
    expect(
      decideAdmission(resumeProposal('g1', 'h1'), playedGame('g1'), resumeProposal('g2', 'h2')),
    ).toEqual({ ok: false, reason: 'game-mismatch' });
  });

  it('a resume arbiter holding its game serves a deferring newcomer', () => {
    expect(decideAdmission(resumeProposal('g1', 'h1'), playedGame('g1'), deferProposal())).toEqual({
      ok: true,
      serve: 'mine',
    });
  });
});

// ---------------------------------------------------------------------------
// The gates must AGREE with the wire: nobody is ever put on a game their OWN seed refuses.
// Stated over EVERY (arbiter seed, game the arbiter HOLDS, newcomer seed) triple — including
// the `defer` arbiter and including an arbiter whose held game is not the one it proposed,
// which is precisely what the earlier `reconcile ↔ acceptsGame` property excluded and is
// where the matrix was broken.
// ---------------------------------------------------------------------------

describe('decideAdmission — no peer is ever put on a game its own seed refuses (fast-check)', () => {
  const uuidArb = fc.stringMatching(/^g[0-9]{1,4}$/);
  const hashArb = fc.stringMatching(/^[a-z0-9]{1,8}$/);
  /** Every seed a player can pick (netPanelModel `SEED_ORDER`) — the `defer` row included. */
  const seedArb: fc.Arbitrary<Proposal> = fc.oneof(
    fc.constant(deferProposal()),
    fc.constant(newProposal()),
    fc.tuple(uuidArb, hashArb).map(([u, h]) => resumeProposal(u, h)),
    fc.tuple(uuidArb, hashArb).map(([u, h]) => currentProposal(u, h)),
  );
  /**
   * Any game the arbiter's ENGINE might actually hold when a hello arrives — deliberately NOT derived
   * from its proposal: it may hold the game it named, a fresh empty one (a `new` entry, or a rematch
   * reset), or some other real game. The `g\d+` uuids can collide with a proposal's uuid (that is a
   * case worth generating), and `fresh-*` never can.
   */
  const heldArb: fc.Arbitrary<OfferedGame> = fc.oneof(
    uuidArb.map((u) => playedGame(u)),
    uuidArb.map((u) => emptyGame(u)),
    fc.constant(emptyGame('fresh-held')),
    fc.constant(playedGame('other-real-game')),
  );

  it('serve MINE ⇒ the newcomer’s seed accepts the game we hold; serve THEIRS ⇒ ours accepts theirs', () => {
    fc.assert(
      fc.property(seedArb, heldArb, seedArb, (mine, held, theirs) => {
        const d = decideAdmission(mine, held, theirs);
        if (!d.ok) return; // a typed reject puts nobody on anything.
        if (d.serve === 'mine') {
          // The newcomer will be handed the bytes we hold — its own seed must permit them.
          expect(acceptsGame(theirs, held)).toEqual({ ok: true });
          return;
        }
        // We will adopt the newcomer's game off the sync channel — OUR seed must permit that, and the
        // uuid must be one the newcomer actually named (never invented).
        expect(acceptsGame(mine, playedGame(d.uuid))).toEqual({ ok: true });
        expect(acceptsGame(mine, emptyGame(d.uuid))).toEqual({ ok: true });
        expect((theirs as { uuid?: string }).uuid).toBe(d.uuid);
      }),
    );
  });

  it('total: every triple yields `serve: mine`, `serve: theirs` + uuid, or a TYPED reject', () => {
    fc.assert(
      fc.property(seedArb, heldArb, seedArb, (mine, held, theirs) => {
        const d = decideAdmission(mine, held, theirs);
        if (d.ok) {
          expect(['mine', 'theirs']).toContain(d.serve);
          if (d.serve === 'theirs') expect(typeof d.uuid).toBe('string');
          return;
        }
        expect(['game-mismatch', 'game-divergent', 'seed-refused']).toContain(d.reason);
      }),
    );
  });

  it('`serve: theirs` happens for the DEFER arbiter and NO other seed (the matrix’s single row)', () => {
    // A guard against the property above passing vacuously: prove the adopting branch is reached at all,
    // and that it is reached ONLY by dealer's choice.
    let adoptions = 0;
    fc.assert(
      fc.property(seedArb, heldArb, seedArb, (mine, held, theirs) => {
        const d = decideAdmission(mine, held, theirs);
        if (d.ok && d.serve === 'theirs') {
          adoptions++;
          expect(mine.kind).toBe('defer');
        }
      }),
      { numRuns: 500 },
    );
    expect(adoptions).toBeGreaterThan(0);
  });
});

/**
 * The real #42 fix: BOTH peers picking New Game are interchangeable, so they must converge on ONE
 * shared game uuid AT GENESIS — decided by the deterministic initiator election, not by "whoever moves
 * first". This composes the pure pieces exactly as `NetSession` does (elect → reconcile → claimSeat) so
 * the invariant is pinned in the pure gate, not only in the session wiring.
 */
describe('both peers pick `new` → ONE game at genesis + two DISTINCT seat owners (#42, fast-check)', () => {
  const peerArb: fc.Arbitrary<Peer> = fc.record({
    playerId: fc.stringMatching(/^[a-z]{1,6}$/),
    arrivalOrder: fc.integer({ min: 0, max: 20 }),
  });

  it('the elected initiator’s fresh game is the ONE agreed game, and each peer gets its own seat', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(peerArb, { minLength: 2, maxLength: 2, selector: (p) => p.playerId }),
        (peers) => {
          const [x, y] = peers as [Peer, Peer];
          // 1. BOTH peers, seeing the same two arrival tags, elect the SAME initiator — in either
          //    listing order (each peer builds the list starting with itself).
          const initiator = electInitiator([x, y]);
          expect(electInitiator([y, x])).toBe(initiator);

          // 2. The initiator reconciles both `new` proposals: a fresh game, never the peer's.
          const agreed = expectAgreed(reconcile(newProposal(), newProposal()));
          expect(agreed).toEqual({ kind: 'new' });

          // 3. The initiator mints/keeps ONE uuid; the other peer adopts THAT uuid (it does not mint a
          //    second one). Modelled here as the session does: the game the initiator holds is served.
          const genesisUuid = `game-of-${initiator}`;
          const other = initiator === x.playerId ? y : x;
          expect(acceptsGame(newProposal(), emptyGame(genesisUuid))).toEqual({ ok: true });

          // 4. Seats: the initiator claims first on the empty map, the adopter claims on the result →
          //    two DISTINCT owners, both real playerIds, no double-white.
          const present = new Set([x.playerId, y.playerId]);
          const first = claimSeat(emptySeatMap(), initiator, present);
          if (!first.ok) throw new Error('a claim on an empty map must succeed');
          const second = claimSeat(first.seatMap, other.playerId, present);
          if (!second.ok) throw new Error('a claim on a one-seat map must succeed');
          const finalMap: SeatMap = second.seatMap;
          expect(first.color).not.toBe(second.color);
          expect(seatOf(finalMap, initiator)).toBe(first.color);
          expect(seatOf(finalMap, other.playerId)).toBe(second.color);
          expect([finalMap.white, finalMap.black].sort()).toEqual(
            [x.playerId, y.playerId].sort(),
          );
        },
      ),
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


// ---------------------------------------------------------------------------
// acceptsCrossing — the rule a LIVE session runs under (design §3 applied by the
// move-sync channel). The seed answers "which game do I want to ENTER on"; that
// question is answered once. Carrying it for the session's lifetime was wrong in
// both directions: `defer` (Join, and every auto-reconnect) accepted anything
// forever, and `resume`/`current` refused the pair's own next generation.
// ---------------------------------------------------------------------------

describe('acceptsCrossing — an AGREED session admits its agreed game and nothing else', () => {
  const agreed: GameGate = { kind: 'agreed', uuid: 'g-agreed' };

  it('accepts the agreed game, whatever seed the player entered with and whatever we hold', () => {
    for (const holdingHistory of [false, true]) {
      expect(acceptsCrossing(agreed, playedGame('g-agreed'), holdingHistory)).toEqual({ ok: true });
      expect(acceptsCrossing(agreed, emptyGame('g-agreed'), holdingHistory)).toEqual({ ok: true });
    }
  });

  it('refuses a DIFFERENT game with history as `game-mismatch` — we are on different games', () => {
    expect(expectReject(acceptsCrossing(agreed, playedGame('g-stranger'), true)).reason).toBe(
      'game-mismatch',
    );
  });

  it('refuses a DIFFERENT EMPTY game as `seed-refused` — the mirror of the resume/current row', () => {
    expect(expectReject(acceptsCrossing(agreed, emptyGame('g-stranger'), false)).reason).toBe(
      'seed-refused',
    );
  });

  it('a `defer` gate that has AGREED no longer accepts everything (the join/reconnect hole)', () => {
    const entering: GameGate = { kind: 'entry', seed: deferProposal() };
    // Same seed, same offer — the ONLY difference is whether entry has resolved.
    expect(acceptsCrossing(entering, playedGame('g-stranger'), false)).toEqual({ ok: true });
    expect(expectReject(acceptsCrossing(agreed, playedGame('g-stranger'), false)).reason).toBe(
      'game-mismatch',
    );
  });
});

describe('acceptsCrossing — while ENTRY is open the seed decides, but never discards our history', () => {
  const seeds: readonly Proposal[] = [
    deferProposal(),
    newProposal(),
    resumeProposal('g-mine', 'h'),
    currentProposal('g-mine', 'h'),
  ];

  it('with no history of our own, it is exactly the seed matrix (acceptsGame)', () => {
    for (const seed of seeds) {
      for (const offered of [emptyGame('g-other'), playedGame('g-other'), playedGame('g-mine')]) {
        expect(acceptsCrossing({ kind: 'entry', seed }, offered, false)).toEqual(
          acceptsGame(seed, offered),
        );
      }
    }
  });

  it('holding a history, every seed refuses a DIFFERENT game — a seed is not a licence to discard it', () => {
    for (const seed of seeds) {
      const verdict = acceptsCrossing({ kind: 'entry', seed }, playedGame('g-other'), true);
      expect(verdict.ok).toBe(false);
      // `new` still reports its own seed refusal (empty only); the others report that we are simply on
      // different games. Either way the game we are playing survives.
      expect(expectReject(verdict).reason).toBe(seed.kind === 'new' ? 'seed-refused' : 'game-mismatch');
    }
  });

  it('holding a history, an EMPTY different game is refused too (a high epoch is not a free wipe)', () => {
    expect(expectReject(acceptsCrossing({ kind: 'entry', seed: deferProposal() }, emptyGame('g-x'), true)).reason).toBe(
      'game-mismatch',
    );
  });

  it('is TOTAL: every (gate, offer, holding) combination yields ok or a TYPED reject, never a throw', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom<Proposal>(deferProposal(), newProposal()),
          fc
            .record({ uuid: fc.string({ minLength: 1 }), headHash: fc.string({ minLength: 1 }) })
            .map(({ uuid, headHash }): Proposal => resumeProposal(uuid, headHash)),
        ),
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (seed, agreedUuid, offeredUuid, useAgreed, offeredEmpty, holdingHistory) => {
          const gate: GameGate = useAgreed
            ? { kind: 'agreed', uuid: agreedUuid }
            : { kind: 'entry', seed };
          const verdict = acceptsCrossing(gate, { uuid: offeredUuid, empty: offeredEmpty }, holdingHistory);
          if (verdict.ok) return true;
          expect(['game-mismatch', 'game-divergent', 'seed-refused']).toContain(verdict.reason);
          return true;
        },
      ),
    );
  });
});
