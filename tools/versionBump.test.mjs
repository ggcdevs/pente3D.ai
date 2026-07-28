/**
 * Unit tests for the PURE version-bump logic (issue #22).
 *
 * No git, no `gh`, no network — every rule is exercised through plain strings, which is
 * the whole point of keeping `versionBump.mjs` IO-free. `tools/version.mjs` (the git/`gh`
 * half) is deliberately NOT under test here; it is verified by running it against this
 * real repository (see the README "Versioning" section).
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  COMMIT_TYPE_SIGNALS,
  LABEL_SIGNALS,
  computeBump,
  labelBump,
  nextRcTag,
  nextVersion,
  parseSubject,
  parseVersion,
} from './versionBump.mjs';

describe('parseSubject', () => {
  it('extracts the type, scope-independence, ticket refs and non-breaking-ness', () => {
    const parsed = parseSubject('feat(cli): slice board views along any axis (#22)');
    expect(parsed.type).toBe('feat');
    expect(parsed.signal).toBe('minor');
    expect(parsed.tickets).toEqual(['22']);
    expect(parsed.breaking).toBe(false);
  });

  it('lower-cases the type so an upper-case prefix still classifies', () => {
    expect(parseSubject('FEAT: shout').signal).toBe('minor');
    expect(parseSubject('Fix: shout').signal).toBe('patch');
  });

  it('reports no type and no signal for a subject with no conventional header', () => {
    const parsed = parseSubject('just some words about #9');
    expect(parsed.type).toBeNull();
    expect(parsed.signal).toBeNull();
    expect(parsed.tickets).toEqual(['9']);
  });

  it('reports the type but NO signal for a type this project does not classify', () => {
    const parsed = parseSubject('wip: half a thing');
    expect(parsed.type).toBe('wip');
    expect(parsed.signal).toBeNull();
  });

  it('finds every ticket ref, including a trailing Refs line in the body', () => {
    const parsed = parseSubject('fix(net): a thing (#40)\n\nSome body.\n\nRefs #12, #7\n');
    expect(parsed.tickets).toEqual(['40', '12', '7']);
  });

  it('DE-DUPLICATES a ticket named more than once, keeping first-seen order', () => {
    // Real case from `v3.0.0..HEAD`: the subject names #45 and the body explains it again,
    // so every per-ticket effect downstream (mismatch warnings especially) fired twice.
    const parsed = parseSubject(
      'feat(cli): controllable network link (#45)\n\nIssue #45 is a TRANSPORT-level outage.\n',
    );
    expect(parsed.tickets).toEqual(['45']);
  });

  it('de-duplication does not collapse DISTINCT tickets that share digits', () => {
    const parsed = parseSubject('fix: a (#4) and (#45) and (#4)');
    expect(parsed.tickets).toEqual(['4', '45']);
  });

  it('requires the colon-space header form (a bare word is not a type)', () => {
    expect(parseSubject('feat is a nice word').type).toBeNull();
    expect(parseSubject('feat:no-space').type).toBeNull();
  });

  it('reads the header only at the START, so a quoted header deeper in the text is not one', () => {
    // A revert QUOTES the reverted subject. If the header were matched anywhere, reverting a
    // feature would itself count as a feature and bump the minor.
    const revert = parseSubject('Revert "feat(core): drop the v1 save format"');
    expect(revert.type).toBeNull();
    expect(revert.signal).toBeNull();
    expect(computeBump({ subjects: ['Revert "feat(core): drop the v1 save format"'] }).bump).toBeNull();
  });

  it('flags `!` before the colon as breaking', () => {
    expect(parseSubject('feat!: drop the old save format').breaking).toBe(true);
    expect(parseSubject('feat(core)!: drop the old save format').breaking).toBe(true);
  });

  it('flags a BREAKING CHANGE / BREAKING-CHANGE footer as breaking', () => {
    expect(parseSubject('feat: x\n\nBREAKING CHANGE: save files move').breaking).toBe(true);
    expect(parseSubject('feat: x\n\nBREAKING-CHANGE: save files move').breaking).toBe(true);
  });

  it('does not flag a merely alarming word as breaking', () => {
    expect(parseSubject('fix: stop breaking changes to the board').breaking).toBe(false);
    expect(parseSubject('unbreaking changes are fine').breaking).toBe(false);
  });
});

describe('the classification tables', () => {
  it('maps feat to minor and fix to patch, and everything else to an explicit no-release', () => {
    expect(COMMIT_TYPE_SIGNALS.feat).toBe('minor');
    expect(COMMIT_TYPE_SIGNALS.fix).toBe('patch');
    for (const type of ['docs', 'test', 'chore', 'style', 'ci', 'refactor', 'workflow', 'plan']) {
      expect(COMMIT_TYPE_SIGNALS[type]).toBe('none');
    }
  });

  it('maps only the enhancement and bug labels', () => {
    expect(LABEL_SIGNALS).toEqual({ enhancement: 'minor', bug: 'patch' });
  });
});

describe('labelBump', () => {
  it('reads enhancement as minor and bug as patch, case-insensitively', () => {
    expect(labelBump(['enhancement'])).toBe('minor');
    expect(labelBump(['bug'])).toBe('patch');
    expect(labelBump(['Enhancement'])).toBe('minor');
  });

  it('takes the higher when a ticket carries both', () => {
    expect(labelBump(['bug', 'enhancement'])).toBe('minor');
    expect(labelBump(['enhancement', 'bug'])).toBe('minor');
  });

  it('has no opinion about labels outside the bump taxonomy', () => {
    expect(labelBump(['on-dev', 'epic', 'question'])).toBeNull();
    expect(labelBump([])).toBeNull();
  });
});

describe('computeBump — the commit-prefix signal', () => {
  it('bumps minor for a feat', () => {
    const r = computeBump({ subjects: ['feat(ui): compact presence HUD banner'] });
    expect(r.bump).toBe('minor');
    expect(r.commitBump).toBe('minor');
    expect(r.ticketBump).toBeNull();
  });

  it('bumps patch for a fix', () => {
    const r = computeBump({ subjects: ['fix(net): re-using a room code mints a fresh game'] });
    expect(r.bump).toBe('patch');
    expect(r.commitBump).toBe('patch');
  });

  it('does not bump for a docs/test/chore-only range', () => {
    const r = computeBump({
      subjects: ['docs(design): record a decision', 'test(e2e): add a matrix', 'chore: tidy'],
    });
    expect(r.bump).toBeNull();
    expect(r.commitBump).toBeNull();
    expect(r.mismatches).toEqual([]);
    expect(r.manualMajor).toBe(false);
  });

  it('takes the HIGHEST across a mixed range regardless of order', () => {
    const subjects = ['docs: a', 'fix: b', 'feat: c'];
    expect(computeBump({ subjects }).bump).toBe('minor');
    expect(computeBump({ subjects: [...subjects].reverse() }).bump).toBe('minor');
  });

  it('stays at patch when the range has fixes and docs but no feat', () => {
    expect(computeBump({ subjects: ['docs: a', 'fix: b', 'chore: c'] }).bump).toBe('patch');
  });

  it('has no opinion on an unrecognised prefix, so it alone does not bump', () => {
    const r = computeBump({ subjects: ['wip: something', 'random words'] });
    expect(r.bump).toBeNull();
    expect(r.commitBump).toBeNull();
  });

  it('returns the no-release answer for an empty range', () => {
    const r = computeBump({ subjects: [] });
    expect(r).toEqual({
      bump: null,
      commitBump: null,
      ticketBump: null,
      manualMajor: false,
      manualMajorSubjects: [],
      mismatches: [],
      unlabelledTickets: [],
    });
  });

  it('returns the no-release answer when called with no arguments at all', () => {
    expect(computeBump().bump).toBeNull();
  });
});

describe('computeBump — the ticket-label signal', () => {
  it('bumps from labels alone when the commit prefix has no opinion', () => {
    const r = computeBump({
      subjects: ['wip: unclassified work (#34)'],
      ticketLabels: { 34: ['enhancement'] },
    });
    expect(r.bump).toBe('minor');
    expect(r.commitBump).toBeNull();
    expect(r.ticketBump).toBe('minor');
    expect(r.mismatches).toEqual([]);
  });

  it('bumps patch from a bug-labelled ticket alone', () => {
    const r = computeBump({
      subjects: ['some prose citing #43'],
      ticketLabels: { 43: ['bug', 'on-dev'] },
    });
    expect(r.bump).toBe('patch');
    expect(r.ticketBump).toBe('patch');
  });

  it('takes the highest across several tickets', () => {
    const r = computeBump({
      subjects: ['chore: sweep (#43)', 'chore: sweep (#34)'],
      ticketLabels: { 43: ['bug'], 34: ['enhancement'] },
    });
    expect(r.ticketBump).toBe('minor');
    expect(r.bump).toBe('minor');
  });

  it('records a cited ticket that carries no bump label, without bumping', () => {
    const r = computeBump({
      subjects: ['docs: notes (#31)'],
      ticketLabels: { 31: ['on-dev', 'epic'] },
    });
    expect(r.ticketBump).toBeNull();
    expect(r.bump).toBeNull();
    expect(r.unlabelledTickets).toEqual(['31']);
  });
});

describe('computeBump — graceful degradation when ticket lookup is unavailable', () => {
  it('still bumps from the commit half with an EMPTY label map', () => {
    const subjects = ['feat(cli): scriptable Node CLI client (#41)'];
    const withTickets = computeBump({ subjects, ticketLabels: { 41: ['enhancement'] } });
    const degraded = computeBump({ subjects, ticketLabels: {} });
    expect(withTickets.bump).toBe('minor');
    expect(degraded.bump).toBe('minor');
    expect(degraded.ticketBump).toBeNull();
    expect(degraded.unlabelledTickets).toEqual(['41']);
  });

  it('reports each unresolved ticket exactly once, in first-seen order', () => {
    const r = computeBump({
      subjects: ['docs: a (#9)', 'docs: b (#9, #7)', 'docs: c (#9)'],
      ticketLabels: {},
    });
    expect(r.unlabelledTickets).toEqual(['9', '7']);
  });

  it('degrades without throwing when a cited ticket is simply missing from the map', () => {
    const r = computeBump({ subjects: ['fix: a (#99)'], ticketLabels: { 1: ['bug'] } });
    expect(r.bump).toBe('patch');
    expect(r.unlabelledTickets).toEqual(['99']);
  });
});

describe('computeBump — disagreement between the two signals (#52: ASYMMETRIC)', () => {
  // THE RULE (CONTRIBUTING "Tickets"): the commit prefix describes the COMMIT; the label
  // describes the TICKET. They legitimately differ, so only ONE direction is suspicious —
  // a commit claiming MORE than the ticket it cites (`feat:` on a `bug`), which means either
  // the ticket is mislabelled or the work outgrew it.
  //
  // The other direction is ordinary work and must stay SILENT. Warning on it fired 143 times
  // over v3.0.0..HEAD — a signal nobody could read, which is the same as no signal at all.
  //
  // The BUMP is unaffected either way: it always takes the higher of the two.

  it('flags the one suspicious direction: a feat commit citing a bug ticket', () => {
    const subject = 'feat(net): new seat model (#31)';
    const r = computeBump({ subjects: [subject], ticketLabels: { 31: ['bug'] } });
    expect(r.bump).toBe('minor');
    expect(r.commitBump).toBe('minor');
    expect(r.ticketBump).toBe('patch');
    expect(r.mismatches).toEqual([
      { subject, ticket: '31', commitSignal: 'minor', ticketSignal: 'patch' },
    ]);
  });

  it('does NOT flag a fix commit on an enhancement ticket — fixing mid-feature is normal', () => {
    const subject = 'fix(net): reconnect reclaims the current color (#40)';
    const r = computeBump({ subjects: [subject], ticketLabels: { 40: ['enhancement'] } });
    expect(r.mismatches).toEqual([]);
    // …and the bump is still the HIGHER of the two, unchanged by the silence.
    expect(r.bump).toBe('minor');
    expect(r.commitBump).toBe('patch');
    expect(r.ticketBump).toBe('minor');
  });

  it('does NOT flag a no-release commit type on an enhancement ticket', () => {
    // `docs:`/`test:`/`chore:` citing a feature ticket is the single most common shape in
    // this repo's history and is entirely ordinary.
    const subject = 'docs(diagrams): regenerate after netModel trim (#44)';
    const r = computeBump({ subjects: [subject], ticketLabels: { 44: ['enhancement'] } });
    expect(r.mismatches).toEqual([]);
    expect(r.bump).toBe('minor');
  });

  it('does NOT flag a no-release commit type on a bug ticket', () => {
    const r = computeBump({
      subjects: ['test(net): pin the reconnect path (#45)'],
      ticketLabels: { 45: ['bug'] },
    });
    expect(r.mismatches).toEqual([]);
    expect(r.bump).toBe('patch');
  });

  it('does NOT flag a mismatch when the commit prefix has no opinion', () => {
    const r = computeBump({
      subjects: ['unclassified work (#34)'],
      ticketLabels: { 34: ['enhancement'] },
    });
    expect(r.mismatches).toEqual([]);
    expect(r.bump).toBe('minor');
  });

  it('does NOT flag a mismatch when the ticket carries no bump label', () => {
    const r = computeBump({ subjects: ['feat: a (#31)'], ticketLabels: { 31: ['on-dev'] } });
    expect(r.mismatches).toEqual([]);
    expect(r.bump).toBe('minor');
  });

  it('does NOT flag a mismatch when the two signals agree', () => {
    const r = computeBump({ subjects: ['fix: a (#43)'], ticketLabels: { 43: ['bug'] } });
    expect(r.mismatches).toEqual([]);
  });

  it('flags one mismatch per suspicious (commit, ticket) pair', () => {
    const subject = 'feat: a (#43) and (#45)';
    const r = computeBump({
      subjects: [subject],
      ticketLabels: { 43: ['bug'], 45: ['bug'] },
    });
    expect(r.mismatches).toEqual([
      { subject, ticket: '43', commitSignal: 'minor', ticketSignal: 'patch' },
      { subject, ticket: '45', commitSignal: 'minor', ticketSignal: 'patch' },
    ]);
  });

  it('flags ONLY the suspicious half when one commit cites tickets of both kinds', () => {
    const subject = 'feat: a (#43) and (#34)';
    const r = computeBump({
      subjects: [subject],
      ticketLabels: { 43: ['bug'], 34: ['enhancement'] },
    });
    expect(r.mismatches).toEqual([
      { subject, ticket: '43', commitSignal: 'minor', ticketSignal: 'patch' },
    ]);
  });

  it('reports ONLY the feat-on-bug shape, for any input (property)', () => {
    // The asymmetry collapses the mismatch to exactly one shape. Asserted as an invariant
    // rather than case-by-case, so a future signal level cannot quietly reintroduce the
    // noisy direction.
    const type = fc.constantFrom('feat', 'fix', 'docs', 'test', 'chore', 'ci', 'wibble');
    const label = fc.constantFrom('enhancement', 'bug', 'on-dev', 'epic');
    fc.assert(
      fc.property(
        fc.array(
          fc
            .tuple(type, fc.stringMatching(/^[0-9]{1,3}$/))
            .map(([t, n]) => `${t}: subject (#${n})`),
          { maxLength: 6 },
        ),
        fc.dictionary(fc.stringMatching(/^[0-9]{1,3}$/), fc.array(label, { maxLength: 3 })),
        (subjects, ticketLabels) => {
          for (const m of computeBump({ subjects, ticketLabels }).mismatches) {
            expect(m.commitSignal).toBe('minor');
            expect(m.ticketSignal).toBe('patch');
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('computeBump — major is never automatic', () => {
  it('treats `feat!:` as a MINOR bump and raises the manual-major flag instead', () => {
    const subject = 'feat(core)!: drop the v1 save format';
    const r = computeBump({ subjects: [subject] });
    expect(r.bump).toBe('minor');
    expect(r.manualMajor).toBe(true);
    expect(r.manualMajorSubjects).toEqual([subject]);
  });

  it('treats `fix!:` as a PATCH bump and raises the manual-major flag', () => {
    const r = computeBump({ subjects: ['fix!: reject the old wire format'] });
    expect(r.bump).toBe('patch');
    expect(r.manualMajor).toBe(true);
  });

  it('raises the flag for a BREAKING CHANGE footer without changing the bump', () => {
    const r = computeBump({
      subjects: ['feat: new relay handshake\n\nBREAKING CHANGE: old clients cannot join.'],
    });
    expect(r.bump).toBe('minor');
    expect(r.manualMajor).toBe(true);
  });

  it('raises the flag even when the range is otherwise non-releasable', () => {
    const r = computeBump({ subjects: ['docs!: rewrite the protocol doc'] });
    expect(r.bump).toBeNull();
    expect(r.manualMajor).toBe(true);
  });

  it('leaves the flag down for an ordinary range', () => {
    const r = computeBump({ subjects: ['feat: a', 'fix: b', 'docs: c'] });
    expect(r.manualMajor).toBe(false);
    expect(r.manualMajorSubjects).toEqual([]);
  });

  it('NEVER returns "major" for any input (property)', () => {
    const word = fc.stringMatching(/^[a-zA-Z!():#0-9 -]{0,40}$/);
    const label = fc.constantFrom('enhancement', 'bug', 'on-dev', 'epic', 'major', 'breaking');
    fc.assert(
      fc.property(
        fc.array(word, { maxLength: 8 }),
        fc.dictionary(fc.stringMatching(/^[0-9]{1,3}$/), fc.array(label, { maxLength: 3 })),
        (subjects, ticketLabels) => {
          const r = computeBump({ subjects, ticketLabels });
          expect(['minor', 'patch', null]).toContain(r.bump);
          expect(['minor', 'patch', null]).toContain(r.commitBump);
          expect(['minor', 'patch', null]).toContain(r.ticketBump);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('parseVersion', () => {
  it('parses a release tag with and without the leading v', () => {
    expect(parseVersion('v3.0.0')).toEqual({ major: 3, minor: 0, patch: 0, prerelease: null });
    expect(parseVersion('3.10.4')).toEqual({ major: 3, minor: 10, patch: 4, prerelease: null });
  });

  it('parses multi-digit components in EVERY position, not just the minor', () => {
    expect(parseVersion('v12.0.0')).toEqual({ major: 12, minor: 0, patch: 0, prerelease: null });
    expect(parseVersion('v1.0.234')).toEqual({ major: 1, minor: 0, patch: 234, prerelease: null });
  });

  it('parses a prerelease tag and keeps its suffix', () => {
    expect(parseVersion('v3.1.0-rc.2')).toEqual({
      major: 3,
      minor: 1,
      patch: 0,
      prerelease: 'rc.2',
    });
  });

  it('rejects anything that is not a semantic version', () => {
    expect(parseVersion('stage4-complete')).toBeNull();
    expect(parseVersion('v1.2')).toBeNull();
    expect(parseVersion('v1.2.3.4')).toBeNull();
    expect(parseVersion('')).toBeNull();
    expect(parseVersion('version-3.0.0')).toBeNull();
  });
});

describe('nextVersion', () => {
  it('raises the minor and zeroes the patch for a minor bump', () => {
    expect(nextVersion('v3.0.4', 'minor')).toBe('3.1.0');
  });

  it('raises only the patch for a patch bump', () => {
    expect(nextVersion('v3.0.4', 'patch')).toBe('3.0.5');
  });

  it('grows from 0.0.0 when the repo has never been tagged', () => {
    expect(nextVersion(null, 'minor')).toBe('0.1.0');
    expect(nextVersion(null, 'patch')).toBe('0.0.1');
  });

  it('returns null — no release — when there is no bump', () => {
    expect(nextVersion('v3.0.4', null)).toBeNull();
    expect(nextVersion(null, null)).toBeNull();
  });

  it('never raises the major, even from a bump on a major-zero base', () => {
    expect(nextVersion('v0.9.9', 'minor')).toBe('0.10.0');
    expect(nextVersion('v0.9.9', 'patch')).toBe('0.9.10');
  });

  it('throws rather than guess a base from an unparseable tag', () => {
    expect(() => nextVersion('stage4-complete', 'minor')).toThrow(TypeError);
    expect(() => nextVersion('stage4-complete', 'minor')).toThrow(/not a semantic version tag/);
  });
});

describe('nextRcTag', () => {
  it('starts at rc.1 when no candidate exists for the base', () => {
    expect(nextRcTag('3.1.0', [])).toBe('v3.1.0-rc.1');
    expect(nextRcTag('v3.1.0', ['v1.0.0', 'v3.0.0'])).toBe('v3.1.0-rc.1');
  });

  it('continues past the highest existing candidate for that base', () => {
    expect(nextRcTag('3.1.0', ['v3.1.0-rc.1', 'v3.1.0-rc.2'])).toBe('v3.1.0-rc.3');
  });

  it('is order-insensitive and uses the numeric maximum, not the last listed', () => {
    expect(nextRcTag('3.1.0', ['v3.1.0-rc.10', 'v3.1.0-rc.2'])).toBe('v3.1.0-rc.11');
    expect(nextRcTag('3.1.0', ['v3.1.0-rc.2', 'v3.1.0-rc.10'])).toBe('v3.1.0-rc.11');
  });

  it('ignores candidates belonging to a different base version', () => {
    expect(nextRcTag('3.1.0', ['v3.2.0-rc.7', 'v2.1.0-rc.9'])).toBe('v3.1.0-rc.1');
  });

  it('ignores the plain release tag and other non-rc prereleases for the same base', () => {
    expect(nextRcTag('3.1.0', ['v3.1.0', 'v3.1.0-beta.4'])).toBe('v3.1.0-rc.1');
  });

  it('does not let a dot in the base match any character', () => {
    expect(nextRcTag('3.1.0', ['v3x1x0-rc.9'])).toBe('v3.1.0-rc.1');
  });

  it('throws rather than invent a base from a non-version string', () => {
    expect(() => nextRcTag('nope', [])).toThrow(TypeError);
    expect(() => nextRcTag('nope', [])).toThrow(/not a semantic version/);
  });
});
