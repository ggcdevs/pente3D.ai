/**
 * versionBump.mjs — the PURE version-bump logic (issue #22).
 *
 * Git tags are the single source of truth for this project's version (see README
 * "Versioning"). This module answers one question, with NO IO of any kind:
 *
 *   given the commit subjects in a range, and the labels of the tickets those commits
 *   cite, how far should the version move?
 *
 * TWO REDUNDANT SIGNALS, HIGHEST WINS. The bump is derived from BOTH the
 * conventional-commit prefix (`feat:` → minor, `fix:` → patch) AND the GitHub label of
 * each `#N` a commit references (`enhancement` → minor, `bug` → patch); the higher of
 * the two is taken. The redundancy is deliberate: commit messages travel with the repo,
 * so versioning keeps working if the project ever leaves GitHub and the ticket half goes
 * away. A caller that cannot reach `gh` passes an empty `ticketLabels` map and the
 * commit half still decides — the degradation is a supported input, not an error path.
 *
 * DISAGREEMENT WARNS, NEVER FAILS — AND IT IS ASYMMETRIC (#52). The commit prefix
 * describes the COMMIT; the label describes the TICKET. They legitimately differ, so only
 * ONE direction is suspicious: a commit claiming MORE than the ticket it cites. A `feat:`
 * on a `bug` means either the ticket is mislabelled or the work outgrew it — reported. A
 * `fix:` (or a `docs:`) on an `enhancement` is ordinary work mid-feature — silent.
 *
 * The symmetric version of this check fired 143 times over `v3.0.0..HEAD`, nearly all of
 * them the harmless direction, and a warning nobody can read is the same as no warning at
 * all. The BUMP is unaffected either way: it always takes the higher of the two signals.
 * Blocking a release on a label typo would be worse than a slightly generous bump.
 *
 * MAJOR IS UNREACHABLE FROM HERE, BY CONSTRUCTION. `bump` is `'minor' | 'patch' | null`;
 * no code path yields `'major'`. Nothing in a commit message or a label can PROVE a
 * change is backwards-incompatible — only a human can. `feat!:` / `BREAKING CHANGE`
 * therefore do not escalate the bump; they set the `manualMajor` flag, which the release
 * workflow surfaces as "a human must cut this major tag by hand".
 *
 * IO-free on purpose: `tools/version.mjs` owns the git/`gh` shelling out and hands the
 * strings in here, so every rule below is unit-testable without a repo or a network.
 */

/**
 * A version bump as exposed to callers. `null` means "no release-worthy change".
 * `'major'` is deliberately absent — see the module header.
 *
 * @typedef {'minor' | 'patch' | null} Bump
 */

/**
 * A named signal. Distinct from the public {@link Bump} in one important way: `'none'`
 * is a POSITIVE claim ("this commit type / this ticket says: no release"), whereas
 * `null` is "no opinion" (an unrecognised prefix, or a ticket we have no bump label
 * for). Only two POSITIVE claims can disagree, which is what keeps the mismatch report
 * free of false alarms.
 *
 * @typedef {'minor' | 'patch' | 'none' | null} Signal
 */

/** Rank of each named signal. Ranks are compared numerically; the highest wins. */
const RANK = Object.freeze({ none: 0, patch: 1, minor: 2 });

/** The rank of "no opinion" — below every positive claim, so `Math.max` ignores it. */
const NO_OPINION = -1;

/**
 * Conventional-commit types that carry a version signal, and what they claim. A type
 * absent from this table yields no opinion, NOT `'none'`.
 */
export const COMMIT_TYPE_SIGNALS = Object.freeze(
  /** @type {Record<string, Exclude<Signal, null>>} */ ({
    feat: 'minor',
    fix: 'patch',
    docs: 'none',
    test: 'none',
    chore: 'none',
    style: 'none',
    ci: 'none',
    refactor: 'none',
    workflow: 'none',
    plan: 'none',
  }),
);

/**
 * GitHub issue labels that carry a version signal. Any other label (`on-dev`,
 * `question`, …) is not a claim about releasability and yields no opinion.
 */
export const LABEL_SIGNALS = Object.freeze(
  /** @type {Record<string, 'minor' | 'patch'>} */ ({
    enhancement: 'minor',
    bug: 'patch',
  }),
);

/** Conventional-commit header: `type(optional scope)!: subject`. */
const HEADER_RE = /^([a-zA-Z]+)(?:\(([^)]*)\))?(!)?:\s/;

/** A `BREAKING CHANGE` / `BREAKING-CHANGE` marker anywhere in the text. */
const BREAKING_RE = /\bBREAKING[ -]CHANGE\b/;

/** Every `#123` reference in a subject. */
const TICKET_RE = /#(\d+)/g;

/**
 * @param {Signal} signal
 * @returns {number} its rank, or {@link NO_OPINION}.
 */
function rankOf(signal) {
  return signal === null ? NO_OPINION : RANK[signal];
}

/**
 * Collapse a rank to the public bump. Both "no opinion" and the positive "no release"
 * mean the same thing to a caller: do not tag.
 *
 * @param {number} rank
 * @returns {Bump}
 */
function publicBump(rank) {
  if (rank === RANK.minor) return 'minor';
  if (rank === RANK.patch) return 'patch';
  return null;
}

/**
 * Parse one commit subject into the facts the bump rules need.
 *
 * @param {string} subject a single commit subject line.
 * @returns {{ type: string | null, breaking: boolean, tickets: string[], signal: Signal }}
 *   `type` is the lower-cased conventional-commit type (`null` when the subject has no
 *   conventional header); `signal` is `null` for a type this project does not classify;
 *   `tickets` is DE-DUPLICATED in first-seen order — a commit that names `#45` in its
 *   subject and again in its body cites ONE ticket, not two. Without this, every downstream
 *   per-ticket effect fires twice for it, which is invisible in a hundred warnings and
 *   glaring in two (found while measuring #52's real-range output).
 */
export function parseSubject(subject) {
  const header = HEADER_RE.exec(subject);
  const type = header === null ? null : header[1].toLowerCase();
  const signal = COMMIT_TYPE_SIGNALS[String(type)] ?? null;
  const breaking = (header !== null && header[3] === '!') || BREAKING_RE.test(subject);
  const tickets = [...new Set([...subject.matchAll(TICKET_RE)].map((m) => m[1]))];
  return { type, breaking, tickets, signal };
}

/**
 * The rank a ticket's labels carry.
 *
 * @param {readonly string[]} labels
 * @returns {number} {@link NO_OPINION} when none of the labels is a bump label — an open
 *   label taxonomy means "no bump label" is an absence of evidence, not evidence of
 *   absence.
 */
function labelRank(labels) {
  let rank = NO_OPINION;
  for (const label of labels) {
    rank = Math.max(rank, rankOf(LABEL_SIGNALS[label.toLowerCase()] ?? null));
  }
  return rank;
}

/**
 * The bump a ticket's labels alone would call for.
 *
 * @param {readonly string[]} labels
 * @returns {Bump}
 */
export function labelBump(labels) {
  return publicBump(labelRank(labels));
}

/**
 * A commit that claimed MORE than the ticket it cited. Both signals are constants rather
 * than free values: the asymmetric rule (see the module header) collapses a reportable
 * mismatch to exactly ONE shape — a `feat:` commit on a `bug`-labelled ticket — because
 * `minor` is the top signal and `patch` the only positive one below it that a label can
 * carry. Typed literally so that stays true by construction rather than by convention.
 *
 * @typedef {object} Mismatch
 * @property {string} subject the commit whose prefix claimed more than its ticket.
 * @property {string} ticket the issue number, as a bare string.
 * @property {'minor'} commitSignal what the prefix claimed — always `feat:`.
 * @property {'patch'} ticketSignal what the ticket's labels claimed — always `bug`.
 */

/**
 * @typedef {object} BumpResult
 * @property {Bump} bump the overall bump — the higher of the two halves. Never `'major'`.
 * @property {Bump} commitBump what the commit prefixes alone would have decided.
 * @property {Bump} ticketBump what the ticket labels alone would have decided.
 * @property {boolean} manualMajor a breaking marker was seen; a human must cut the major tag.
 * @property {string[]} manualMajorSubjects the subjects that carried the breaking marker.
 * @property {Mismatch[]} mismatches commit/ticket disagreements — a warning, never an error.
 * @property {string[]} unlabelledTickets tickets a commit cited for which no bump label was
 *   supplied (ticket lookup unavailable, or the issue genuinely carries no bump label),
 *   de-duplicated, in first-seen order.
 */

/**
 * Compute the version bump for a commit range. Pure: same inputs → same output.
 *
 * @param {object} [input]
 * @param {readonly string[]} [input.subjects] one entry per commit in the range. A bare
 *   subject line or a FULL commit message may be passed: only the first line is parsed
 *   as a conventional header, while `#N` refs and breaking markers are scanned across
 *   the whole text (this repo allows a trailing `Refs #N` in the body — see
 *   planning/agent-principles.md "Commit hygiene & ticket traceability").
 * @param {Readonly<Record<string, readonly string[]>>} [input.ticketLabels] issue number
 *   (a bare string, e.g. `'22'`) → its label names. Pass `{}` when ticket lookup is
 *   unavailable; the commit half still decides.
 * @returns {BumpResult}
 */
export function computeBump({ subjects = [], ticketLabels = {} } = {}) {
  let commitRank = NO_OPINION;
  let ticketRank = NO_OPINION;
  /** @type {string[]} */
  const manualMajorSubjects = [];
  /** @type {Mismatch[]} */
  const mismatches = [];
  /** @type {string[]} */
  const unlabelledTickets = [];

  for (const subject of subjects) {
    const parsed = parseSubject(subject);
    const subjectRank = rankOf(parsed.signal);
    commitRank = Math.max(commitRank, subjectRank);
    if (parsed.breaking) manualMajorSubjects.push(subject);

    for (const ticket of parsed.tickets) {
      const thisTicketRank = labelRank(ticketLabels[ticket] ?? []);
      if (thisTicketRank === NO_OPINION) {
        if (!unlabelledTickets.includes(ticket)) unlabelledTickets.push(ticket);
        continue;
      }
      ticketRank = Math.max(ticketRank, thisTicketRank);
      // ASYMMETRIC (#52): report ONLY a commit claiming MORE than its ticket. `>` also
      // excludes NO_OPINION, which is below every positive claim, so an unrecognised prefix
      // stays silent without a second clause.
      if (subjectRank > thisTicketRank) {
        mismatches.push({ subject, ticket, commitSignal: 'minor', ticketSignal: 'patch' });
      }
    }
  }

  return {
    bump: publicBump(Math.max(commitRank, ticketRank)),
    commitBump: publicBump(commitRank),
    ticketBump: publicBump(ticketRank),
    manualMajor: manualMajorSubjects.length > 0,
    manualMajorSubjects,
    mismatches,
    unlabelledTickets,
  };
}

/**
 * @typedef {object} ParsedVersion
 * @property {number} major
 * @property {number} minor
 * @property {number} patch
 * @property {string | null} prerelease e.g. `'rc.2'` for `v3.1.0-rc.2`.
 */

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/**
 * @param {string} tag a tag or version string, with or without the leading `v`.
 * @returns {ParsedVersion | null} `null` when the string is not a semantic version.
 */
export function parseVersion(tag) {
  const m = VERSION_RE.exec(tag);
  if (m === null) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null,
  };
}

/**
 * Apply a bump to the last tag.
 *
 * @param {string | null} lastTag the most recent release tag, or `null` when the repo has
 *   never been tagged (the version then grows from `0.0.0`).
 * @param {Bump} bump
 * @returns {string | null} the next `X.Y.Z` (no leading `v`), or `null` when `bump` is
 *   `null` — nothing in the range warrants a release.
 * @throws {TypeError} when `lastTag` is a string that is not a semantic version.
 *   Guessing a base from a garbage tag would silently mint a wrong version.
 */
export function nextVersion(lastTag, bump) {
  if (bump === null) return null;
  const base = lastTag === null ? { major: 0, minor: 0, patch: 0 } : parseVersion(lastTag);
  if (base === null) throw new TypeError(`not a semantic version tag: ${lastTag}`);
  if (bump === 'minor') return `${base.major}.${base.minor + 1}.0`;
  return `${base.major}.${base.minor}.${base.patch + 1}`;
}

/**
 * The next release-candidate tag for a base version — `v<base>-rc.<N>` with `N` one past
 * the highest rc already cut for that base, so re-running on `test` never collides with
 * an existing tag.
 *
 * @param {string} baseVersion an `X.Y.Z` string (a leading `v` is tolerated).
 * @param {readonly string[]} existingTags every tag in the repo.
 * @returns {string} e.g. `v3.1.0-rc.1`.
 * @throws {TypeError} when `baseVersion` is not a semantic version.
 */
export function nextRcTag(baseVersion, existingTags) {
  const base = parseVersion(baseVersion);
  if (base === null) throw new TypeError(`not a semantic version: ${baseVersion}`);
  const core = `${base.major}.${base.minor}.${base.patch}`;
  const rcRe = new RegExp(`^v?${core.replace(/\./g, '\\.')}-rc\\.(\\d+)$`);
  let highest = 0;
  for (const tag of existingTags) {
    const m = rcRe.exec(tag);
    if (m !== null) highest = Math.max(highest, Number(m[1]));
  }
  return `v${core}-rc.${highest + 1}`;
}

/**
 * The tag a commit is released under, and where that tag came from.
 *
 * @typedef {object} ReleaseTarget
 * @property {string} tag the release tag, e.g. `v4.0.0`.
 * @property {'computed' | 'existing'} source `computed` — this run derived it from the
 *   range and is about to create it. `existing` — a human had already tagged this commit
 *   (the hand-tagged major), and this run only has to publish it.
 */

/**
 * Decide which tag a commit is released under — the rule "**any version that reaches
 * `main` gets a Release**" (issue #55).
 *
 * The release workflow used to create a GitHub Release ONLY for a tag it had cut itself.
 * That made the one manual step in the whole release process a dead end: the major version
 * is the wire-protocol version and is never derived automatically, so a human tags `dev`
 * by hand — and when that commit reached `main` the computed range was empty, the workflow
 * logged "nothing in this range warrants a release", skipped, and **no Release was ever
 * created**. Right version, missing Release, no error. This closes that.
 *
 * Precedence is deliberate: a freshly computed tag WINS over one already at HEAD, because
 * the computed tag is about to be created on this very commit and is therefore the release;
 * an older tag that happens to point here does not displace it.
 *
 * Two release tags on one commit is a human error, so it THROWS rather than picking one.
 * Guessing would publish the wrong version under a green check — the failure mode this
 * whole function exists to prevent.
 *
 * @param {string | null} computedTag the tag this run derived, or `null` when the range
 *   warranted no release.
 * @param {readonly string[]} tagsAtHead every tag pointing at the commit being released —
 *   release tags, prereleases and non-version tags alike; this sorts them out.
 * @returns {ReleaseTarget | null} `null` when there is genuinely nothing to release.
 * @throws {Error} when more than one RELEASE tag points at the commit.
 */
export function resolveReleaseTarget(computedTag, tagsAtHead) {
  if (computedTag !== null) return { tag: computedTag, source: 'computed' };

  // A prerelease is a staging marker for the NEXT release, not a release — and a `wip/*`
  // stage marker is not a version at all. `parseVersion` already draws both lines, so the
  // shape of a release tag is not restated here as a second, driftable regex.
  const releaseTags = tagsAtHead.filter((tag) => {
    const parsed = parseVersion(tag);
    return parsed !== null && parsed.prerelease === null;
  });

  if (releaseTags.length === 0) return null;
  if (releaseTags.length > 1) {
    throw new Error(
      `ambiguous release: ${releaseTags.length} release tags point at this commit ` +
        `(${releaseTags.join(', ')}). Delete the wrong one before releasing — this tool ` +
        'will not guess which version is meant.',
    );
  }
  return { tag: releaseTags[0], source: 'existing' };
}
