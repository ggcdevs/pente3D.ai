import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  RESOLVE_ACTION_PREFIX,
  effectOf,
  resolutionAction,
  resolutionTarget,
  targetChoice,
  targetFor,
  type ResolutionCandidates,
  type ResolutionChoice,
} from './resolution';

/**
 * Task V.4b (epic #47, absorbs #38) — the PURE resolution vocabulary.
 *
 * The property that matters is not "the strings round-trip" but the one the whole encoding exists
 * for: **two peers who agree land on ONE history**. A proposer picks a choice against ITS OWN
 * candidates and puts the resulting head hash on the wire; the responder reads that hash against ITS
 * OWN candidates. The pair converges iff the history the proposer keeps and the history the responder
 * ends on are the same one — which is asserted here over the MIRRORED case (each peer's `theirs` is
 * the other's `mine`, the ordinary two-peer divergence) and over the case the proposer-relative
 * encoding gets WRONG (both peers recording the same third-party log as `theirs`).
 */

/** A head fingerprint stand-in; distinct strings are distinct histories. */
const MINE = 'head-mine';
const THEIRS = 'head-theirs';
const LCA = 'head-lca';

const forked: ResolutionCandidates = { mine: MINE, theirs: THEIRS, lca: LCA };

describe('resolutionAction / resolutionTarget — the wire tag', () => {
  it('names the target head hash, and reads it back', () => {
    expect(resolutionAction(THEIRS)).toBe(`${RESOLVE_ACTION_PREFIX}${THEIRS}`);
    expect(resolutionTarget(resolutionAction(THEIRS))).toBe(THEIRS);
  });

  it('reads a NON-resolution action as null — the #12/#18 tags stay this consumer-blind', () => {
    expect(resolutionTarget('rematch')).toBeNull();
    expect(resolutionTarget('undo')).toBeNull();
    expect(resolutionTarget('redo')).toBeNull();
    // A tag that merely CONTAINS the prefix is not one either — the prefix must lead.
    expect(resolutionTarget(`undo-${RESOLVE_ACTION_PREFIX}${MINE}`)).toBeNull();
  });

  it('an EMPTY target names no history and is refused rather than read as one', () => {
    expect(resolutionTarget(RESOLVE_ACTION_PREFIX)).toBeNull();
  });

  it('round-trips any non-empty target', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (target) => {
        expect(resolutionTarget(resolutionAction(target))).toBe(target);
      }),
    );
  });
});

describe('targetFor — what a proposer puts on the wire', () => {
  it('names my head, their head, or the shared ancestor', () => {
    expect(targetFor('take-mine', forked)).toBe(MINE);
    expect(targetFor('take-theirs', forked)).toBe(THEIRS);
    expect(targetFor('rewind', forked)).toBe(LCA);
  });

  it('cannot name a rewind when the two logs share NO ancestor (different games)', () => {
    const strangers: ResolutionCandidates = { mine: MINE, theirs: THEIRS, lca: null };
    expect(targetFor('rewind', strangers)).toBeNull();
    // The other two are still nameable — only the ancestor is missing.
    expect(targetFor('take-mine', strangers)).toBe(MINE);
    expect(targetFor('take-theirs', strangers)).toBe(THEIRS);
  });
});

describe('targetChoice — reading an absolute target in LOCAL terms', () => {
  it('recognises each of the three candidates', () => {
    expect(targetChoice(MINE, forked)).toBe('take-mine');
    expect(targetChoice(THEIRS, forked)).toBe('take-theirs');
    expect(targetChoice(LCA, forked)).toBe('rewind');
  });

  it('refuses a head this client holds NO history for — honestly, never a guess', () => {
    expect(targetChoice('head-from-nowhere', forked)).toBeNull();
  });

  it('never reads a rewind when there is no ancestor, even for a matching-looking value', () => {
    const strangers: ResolutionCandidates = { mine: MINE, theirs: THEIRS, lca: null };
    expect(targetChoice(LCA, strangers)).toBeNull();
  });

  it('reads my own log as take-mine when I am strictly BEHIND (mine IS the ancestor)', () => {
    // Both arms name the identical history here, so the answer is the plainer of the two.
    const behind: ResolutionCandidates = { mine: LCA, theirs: THEIRS, lca: LCA };
    expect(targetChoice(LCA, behind)).toBe('take-mine');
    expect(effectOf(targetChoice(LCA, behind)!)).toBe('keep-mine');
  });

  it('reads their log as take-theirs when THEY are strictly behind (theirs IS the ancestor)', () => {
    const ahead: ResolutionCandidates = { mine: MINE, theirs: LCA, lca: LCA };
    expect(targetChoice(LCA, ahead)).toBe('take-theirs');
  });
});

describe('effectOf — what the local engine does', () => {
  it('maps each choice to its one effect', () => {
    expect(effectOf('take-mine')).toBe('keep-mine');
    expect(effectOf('take-theirs')).toBe('adopt-theirs');
    expect(effectOf('rewind')).toBe('rewind-to-lca');
  });
});

// ── The convergence property: an agreement lands BOTH peers on ONE history ──────────────────────

/** Which history a peer ends on, given the effect it applies and the heads it holds. */
function landsOn(effect: ReturnType<typeof effectOf>, candidates: ResolutionCandidates): string {
  switch (effect) {
    case 'keep-mine':
      return candidates.mine;
    case 'adopt-theirs':
      return candidates.theirs;
    case 'rewind-to-lca':
      // Only reachable when `lca` is non-null — `targetFor`/`targetChoice` never yield a rewind
      // without one, which is itself asserted above.
      return candidates.lca!;
  }
}

/** Apply a proposer's target on the responder side, or `null` if it cannot be honoured. */
function respond(target: string, candidates: ResolutionCandidates): string | null {
  const choice = targetChoice(target, candidates);
  return choice === null ? null : landsOn(effectOf(choice), candidates);
}

describe('agreement convergence — both peers end on the SAME history', () => {
  const CHOICES: readonly ResolutionChoice[] = ['take-mine', 'take-theirs', 'rewind'];

  it('MIRRORED divergence: every choice the proposer can raise converges the pair', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1 }), { minLength: 3, maxLength: 3 }),
        fc.constantFrom(...CHOICES),
        ([a, b, ancestor], choice) => {
          // The ordinary two-peer case: each peer's `theirs` is the OTHER peer's `mine`, and both
          // walked back to the same ancestor.
          const proposer: ResolutionCandidates = { mine: a!, theirs: b!, lca: ancestor! };
          const responder: ResolutionCandidates = { mine: b!, theirs: a!, lca: ancestor! };
          const target = targetFor(choice, proposer);
          expect(target).not.toBeNull();
          expect(respond(target!, responder)).toBe(landsOn(effectOf(choice), proposer));
        },
      ),
    );
  });

  it('THIRD-PUBLISHER divergence: two peers holding the SAME `theirs` still converge', () => {
    // The case a proposer-relative `take-mine`/`take-theirs` encoding gets WRONG. Both peers are in
    // sync with each other and each recorded the SAME foreign log as the divergent one, so the
    // responder's "their mine is my theirs" inversion would land it on the foreign history while the
    // proposer kept its own. Naming the head hash absolutely, it cannot.
    const shared = 'head-both-peers';
    const foreign = 'head-third-party';
    const ancestor = 'head-ancestor';
    const proposer: ResolutionCandidates = { mine: shared, theirs: foreign, lca: ancestor };
    const responder: ResolutionCandidates = { mine: shared, theirs: foreign, lca: ancestor };
    for (const choice of CHOICES) {
      const target = targetFor(choice, proposer)!;
      expect(respond(target, responder)).toBe(landsOn(effectOf(choice), proposer));
    }
  });

  it('a target NEITHER peer holds is refused rather than half-applied', () => {
    const responder: ResolutionCandidates = { mine: MINE, theirs: THEIRS, lca: LCA };
    expect(respond('head-nobody-has', responder)).toBeNull();
  });
});
