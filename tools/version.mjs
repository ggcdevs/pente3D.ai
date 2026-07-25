/**
 * version.mjs — resolve this build's version FROM GIT (issue #22).
 *
 * NO SHEBANG ON PURPOSE: `vite.config.ts` imports this module, and esbuild inlines the
 * config's imports into one file — a `#!` line landing mid-file is a syntax error there.
 * Invoke it as `node tools/version.mjs`, never as `./tools/version.mjs`.
 *
 * GIT TAGS ARE THE SINGLE SOURCE OF TRUTH. `package.json`'s `"version": "0.0.0"` is a
 * placeholder npm requires and is NOT the app version — nothing reads it. Everything the
 * app and the deploy report comes from `git describe` / the tag list, resolved here.
 *
 * This module is the IO half: it shells out to `git` and (optionally) `gh`. All of the
 * DECISION logic lives in the IO-free `./versionBump.mjs`, which is unit-tested and
 * mutation-gated without a repo or a network. The pure API is re-exported below so
 * callers have one import.
 *
 * NEVER THROWS THE BUILD. Every git call can fail (no git binary, a tarball export with
 * no history, a shallow CI checkout with no tags). Each failure degrades to an HONEST
 * value — `0.0.0-unknown`, `null` fields — and logs the observed fact to stderr. It never
 * invents a plausible-looking version.
 *
 * Usage:
 *   node tools/version.mjs                        # build info as JSON
 *   node tools/version.mjs --plan                 # release plan for main   (vX.Y.Z)
 *   node tools/version.mjs --plan --channel prerelease   # for test (vX.Y.Z-rc.N)
 *
 * Exit codes: 0 always for `--info`; `--plan` also exits 0 when the answer is
 * "no release" (`tag: null`) — "nothing to tag" is a normal outcome, not a failure.
 */

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeBump, nextRcTag, nextVersion, parseSubject, parseVersion } from './versionBump.mjs';

export {
  computeBump,
  labelBump,
  nextRcTag,
  nextVersion,
  parseSubject,
  parseVersion,
  COMMIT_TYPE_SIGNALS,
  LABEL_SIGNALS,
} from './versionBump.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The value used when git cannot tell us what this build is. Deliberately not a lie. */
export const UNKNOWN_VERSION = '0.0.0-unknown';

/**
 * Run a command, returning its trimmed stdout — or `null` if it failed for ANY reason.
 * Callers decide what a failure means and log the specific fact; a silent `null` here
 * would be masking, so nothing in this file returns `null` without saying why.
 *
 * @param {string} cmd
 * @param {readonly string[]} args
 * @param {string} cwd
 * @returns {string | null}
 */
function run(cmd, args, cwd) {
  try {
    return execFileSync(cmd, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    }).trim();
  } catch {
    return null;
  }
}

/** @param {string} message */
function warn(message) {
  process.stderr.write(`[version] ${message}\n`);
}

/**
 * @param {string} [cwd]
 * @returns {string} the repo root, or this script's parent directory when git is
 *   unavailable (an exported tarball) — the caller still gets a usable path.
 */
export function repoRoot(cwd = HERE) {
  return run('git', ['rev-parse', '--show-toplevel'], cwd) ?? resolve(HERE, '..');
}

/**
 * @typedef {object} VersionInfo
 * @property {string} version `X.Y.Z` when HEAD is exactly on a tag, otherwise the full
 *   `git describe` form (`v3.0.0-84-gb0cf3cb`), otherwise {@link UNKNOWN_VERSION}.
 * @property {string | null} describe raw `git describe --tags --always` output.
 * @property {string | null} branch branch name (`GITHUB_REF_NAME` wins, because a CI
 *   checkout is detached and would otherwise report `HEAD`).
 * @property {string | null} sha short commit sha.
 * @property {string} builtAt ISO-8601 build timestamp.
 */

/**
 * Resolve the version facts for a build.
 *
 * @param {object} [options]
 * @param {string} [options.cwd] directory to run git in.
 * @param {Date} [options.now] build clock (injectable for deterministic callers).
 * @param {Record<string, string | undefined>} [options.env] environment to read
 *   `GITHUB_REF_NAME` from.
 * @returns {VersionInfo}
 */
export function resolveVersionInfo({ cwd = HERE, now = new Date(), env = process.env } = {}) {
  const builtAt = now.toISOString();
  const sha = run('git', ['rev-parse', '--short', 'HEAD'], cwd);
  if (sha === null) {
    warn(`git rev-parse failed in ${cwd}; version falls back to ${UNKNOWN_VERSION}`);
    return { version: UNKNOWN_VERSION, describe: null, branch: null, sha: null, builtAt };
  }

  const branch = env.GITHUB_REF_NAME ?? run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  const describe = run('git', ['describe', '--tags', '--always'], cwd);
  const exact = run('git', ['describe', '--tags', '--exact-match'], cwd);
  if (exact !== null) {
    return { version: exact.replace(/^v/, ''), describe, branch, sha, builtAt };
  }

  // `--always` succeeds with a bare sha even when NO tag is reachable, so it cannot tell
  // us whether `describe` is tag-derived. Ask again without `--always`: that fails iff
  // there is no reachable tag (the shallow-checkout / fresh-repo case).
  const fromTag = run('git', ['describe', '--tags'], cwd);
  if (fromTag === null) {
    warn(
      `no reachable git tag from ${sha} (shallow checkout or untagged repo); ` +
        `version falls back to ${UNKNOWN_VERSION}`,
    );
    return { version: UNKNOWN_VERSION, describe, branch, sha, builtAt };
  }
  return { version: fromTag, describe, branch, sha, builtAt };
}

/**
 * Every tag in the repo.
 *
 * @param {string} [cwd]
 * @returns {string[]}
 */
export function listTags(cwd = HERE) {
  const out = run('git', ['tag', '--list'], cwd);
  if (out === null) {
    warn('git tag --list failed; treating the repo as untagged');
    return [];
  }
  return out.split('\n').filter((line) => line !== '');
}

/**
 * The most recent RELEASE tag reachable from HEAD — `vX.Y.Z` with no prerelease part.
 * Release candidates are skipped on purpose: an rc is a preview of the NEXT release, so
 * the bump for both channels is always measured from the last real release.
 *
 * @param {string} [cwd]
 * @returns {string | null} `null` when the repo has no release tag yet.
 */
export function lastReleaseTag(cwd = HERE) {
  const out = run('git', ['tag', '--list', '--merged', 'HEAD', '--sort=-v:refname'], cwd);
  if (out === null) {
    warn('git tag --list --merged HEAD failed; treating HEAD as having no release tag');
    return null;
  }
  for (const tag of out.split('\n')) {
    const parsed = parseVersion(tag);
    if (parsed !== null && parsed.prerelease === null) return tag;
  }
  return null;
}

/**
 * Full commit messages in a range, newest first.
 *
 * @param {string} range e.g. `v3.0.0..HEAD`, or `HEAD` for "everything".
 * @param {string} [cwd]
 * @returns {string[]}
 */
export function commitMessages(range, cwd = HERE) {
  // %B is the raw body (subject + message). NUL-separate so a multi-line message stays
  // one entry — splitting on newlines would turn every paragraph into a fake commit.
  const out = run('git', ['log', '--format=%B%x00', range], cwd);
  if (out === null) {
    warn(`git log ${range} failed; treating the range as empty`);
    return [];
  }
  return out
    .split('\0')
    .map((message) => message.trim())
    .filter((message) => message !== '');
}

/**
 * @typedef {object} TicketLookup
 * @property {Record<string, string[]>} labels ticket number → label names.
 * @property {string[]} requested every ticket we tried to resolve.
 * @property {boolean} degraded true when at least one lookup could not be performed.
 * @property {string | null} reason the observed failure, when degraded.
 */

/**
 * Look up each ticket's GitHub labels via `gh`.
 *
 * GRACEFUL DEGRADATION IS A REQUIREMENT, NOT A FALLBACK. `gh` may be absent,
 * unauthenticated, or offline (and the project may one day not live on GitHub at all).
 * Any of those returns an EMPTY label map with `degraded: true` and the observed reason —
 * the caller then bumps on the commit-prefix half alone, which is why the two signals are
 * redundant in the first place.
 *
 * @param {readonly string[]} tickets bare issue numbers.
 * @param {string} [cwd]
 * @returns {TicketLookup}
 */
export function fetchTicketLabels(tickets, cwd = HERE) {
  const requested = [...tickets];
  if (requested.length === 0) return { labels: {}, requested, degraded: false, reason: null };

  if (run('gh', ['--version'], cwd) === null) {
    warn('`gh` is unavailable; skipping the ticket-label signal (commit prefixes still apply)');
    return { labels: {}, requested, degraded: true, reason: 'gh-unavailable' };
  }

  /** @type {Record<string, string[]>} */
  const labels = {};
  /** @type {string[]} */
  const failed = [];
  for (const ticket of requested) {
    const raw = run('gh', ['issue', 'view', ticket, '--json', 'labels'], cwd);
    if (raw === null) {
      failed.push(ticket);
      continue;
    }
    try {
      const parsed = JSON.parse(raw);
      labels[ticket] = parsed.labels.map(/** @param {{name: string}} l */ (l) => l.name);
    } catch (err) {
      failed.push(ticket);
      warn(`gh returned unparseable JSON for #${ticket}: ${String(err)}`);
    }
  }
  if (failed.length > 0) {
    warn(`ticket labels unresolved for: ${failed.map((t) => `#${t}`).join(', ')}`);
    return { labels, requested, degraded: true, reason: `unresolved: ${failed.join(',')}` };
  }
  return { labels, requested, degraded: false, reason: null };
}

/**
 * @typedef {import('./versionBump.mjs').BumpResult & {
 *   channel: 'release' | 'prerelease',
 *   lastTag: string | null,
 *   range: string,
 *   commitCount: number,
 *   ticketLookup: TicketLookup,
 *   version: string | null,
 *   tag: string | null,
 * }} ReleasePlan
 */

/**
 * Decide what tag (if any) the current HEAD should get.
 *
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @param {'release' | 'prerelease'} [options.channel] `release` cuts `vX.Y.Z` (main);
 *   `prerelease` cuts `vX.Y.Z-rc.N` (test).
 * @returns {ReleasePlan}
 */
export function planRelease({ cwd = HERE, channel = 'release' } = {}) {
  const lastTag = lastReleaseTag(cwd);
  const range = lastTag === null ? 'HEAD' : `${lastTag}..HEAD`;
  const subjects = commitMessages(range, cwd);

  /** @type {string[]} */
  const tickets = [];
  for (const subject of subjects) {
    for (const ticket of parseSubject(subject).tickets) {
      if (!tickets.includes(ticket)) tickets.push(ticket);
    }
  }
  const ticketLookup = fetchTicketLabels(tickets, cwd);
  const result = computeBump({ subjects, ticketLabels: ticketLookup.labels });

  const version = nextVersion(lastTag, result.bump);
  let tag = null;
  if (version !== null) {
    tag = channel === 'prerelease' ? nextRcTag(version, listTags(cwd)) : `v${version}`;
  }

  for (const mismatch of result.mismatches) {
    warn(
      `MISMATCH: commit says "${mismatch.commitSignal}" but #${mismatch.ticket} is labelled ` +
        `"${mismatch.ticketSignal}" — taking the higher. Subject: ${mismatch.subject.split('\n')[0]}`,
    );
  }
  if (result.manualMajor) {
    warn(
      `${result.manualMajorSubjects.length} commit(s) carry a breaking marker. This tool NEVER ` +
        'emits a major bump — cut the major tag by hand if the break is real.',
    );
  }

  return { channel, lastTag, range, commitCount: subjects.length, ticketLookup, ...result, version, tag };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * @param {readonly string[]} argv
 * @returns {string} the JSON a CLI invocation prints.
 */
function cli(argv) {
  const cwd = repoRoot();
  if (argv.includes('--plan')) {
    const i = argv.indexOf('--channel');
    const channel = i === -1 ? 'release' : argv[i + 1];
    if (channel !== 'release' && channel !== 'prerelease') {
      throw new Error(`--channel must be release|prerelease, got: ${String(channel)}`);
    }
    return JSON.stringify(planRelease({ cwd, channel }), null, 2);
  }
  return JSON.stringify(resolveVersionInfo({ cwd }), null, 2);
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${cli(process.argv.slice(2))}\n`);
}
