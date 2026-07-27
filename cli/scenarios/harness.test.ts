/**
 * THE VACUOUS-SCENARIO REGRESSION TEST.
 *
 * `report()` is the exit code of every CLI scenario, and `scenario:all` classifies `0` as `passed`.
 * It used to return `failed.length === 0 ? 0 : 1`, which is `0` on an EMPTY check list — so a
 * scenario that asserted nothing at all printed `0/0 checks passed`, exited 0, and joined the matrix
 * as a green line. The probe that found it was six lines:
 *
 *     import { report } from './harness';
 *     process.exit(report('PROBE — a scenario with zero checks'));   // → exit 0
 *
 * That is the same false-green `sync.realrelay.test.ts` documents one tier down (a silent early
 * return that vitest counts as a zero-assertion PASS), and `all.ts` discovers scenarios by directory
 * — so any scenario that stops asserting joins the suite reporting green. The probe is kept here,
 * permanently, as a test.
 *
 * `checks` is module state, so each case gets a FRESH module (`vi.resetModules()` + dynamic import)
 * rather than sharing a tally.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Harness = typeof import('./harness');

/** Load a pristine copy of the harness (its `checks` tally starts empty). */
async function freshHarness(): Promise<Harness> {
  vi.resetModules();
  return import('./harness');
}

/** Everything `report`/`check` printed, joined — asserted on, since the message IS the deliverable. */
let printed: string[];

beforeEach(() => {
  printed = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    printed.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('report() — a scenario that proves nothing must not exit 0', () => {
  it('THE BUG: zero checks exits NON-ZERO', async () => {
    const { report } = await freshHarness();
    expect(report('PROBE — a scenario with zero checks')).toBe(1);
  });

  it('says WHY, in the run output — "proved nothing", not "0/0 checks passed" alone', async () => {
    const { report } = await freshHarness();
    report('PROBE — a scenario with zero checks');
    const out = printed.join('\n');
    expect(out).toContain('PROVED NOTHING');
    expect(out).toContain('ZERO checks');
  });

  it('still exits 0 when every recorded check passed', async () => {
    const { check, report } = await freshHarness();
    check('a real assertion', true, 'observed=42');
    expect(report('one passing check')).toBe(0);
  });

  it('still exits 1 when any check failed, and names it', async () => {
    const { check, report } = await freshHarness();
    check('a passing one', true);
    check('the failing one', false, 'observed=nope');
    expect(report('one failing check')).toBe(1);
    const out = printed.join('\n');
    expect(out).toContain('1/2 checks passed');
    expect(out).toContain('the failing one');
    expect(out).toContain('observed=nope');
  });

  it('a failing check alone is enough — it is not masked by passing siblings', async () => {
    const { check, report } = await freshHarness();
    for (let i = 0; i < 5; i++) check(`passing ${i}`, true);
    check('the one that matters', false);
    expect(report('five pass, one fails')).toBe(1);
  });
});

describe('isScenario() — what `scenario:all` will execute', () => {
  it('runs the files that NAME themselves scenarios', async () => {
    const { isScenario } = await freshHarness();
    expect(isScenario('issue45-reconnect-resync.scenario.ts')).toBe(true);
    expect(isScenario('ff-vs-diff-boundary.scenario.ts')).toBe(true);
  });

  it('never runs the runner, the harness, or a vitest suite as a scenario', async () => {
    const { isScenario } = await freshHarness();
    expect(isScenario('all.ts')).toBe(false);
    expect(isScenario('harness.ts')).toBe(false);
    // This very file lives in the scenarios directory; directory-based discovery must skip it.
    expect(isScenario('harness.test.ts')).toBe(false);
    expect(isScenario('README.md')).toBe(false);
  });

  it('THE FALSE-GREEN: a shared helper module dropped in this directory is NOT a scenario', async () => {
    // The predicate used to be allow-everything with a two-name denylist, so the natural refactor —
    // pull the setup two scenarios share into a module next to them — was SPAWNED as a scenario,
    // did nothing, exited 0, and `all.ts` counted it as a PASS. Observed with the relay pointed at a
    // dead port: "1 passed · 0 FAILED · 8 skipped … all run scenarios passed. EXIT=0", from a run in
    // which literally nothing was proven. Identification is POSITIVE now: a scenario says so.
    const { isScenario } = await freshHarness();
    expect(isScenario('shared-helper.ts')).toBe(false);
    expect(isScenario('zz-shared-helper.ts')).toBe(false);
    expect(isScenario('openings.ts')).toBe(false);
    expect(isScenario('fixtures.ts')).toBe(false);
  });

  it('the suffix is the whole rule — a near-miss name does not sneak in', async () => {
    const { isScenario } = await freshHarness();
    expect(isScenario('scenario.ts')).toBe(false); // no dot-prefixed suffix
    expect(isScenario('thing.scenario.js')).toBe(false); // not TypeScript
    expect(isScenario('thing.scenarios.ts')).toBe(false);
  });

  it('every real scenario ON DISK is discovered — the rename cannot silently empty the matrix', async () => {
    // The strongest form of "the gate is not vacuous": read the actual directory. If a rename or a
    // typo left the matrix with nothing to run, this fails here rather than in a green CI run.
    const { isScenario } = await freshHarness();
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const found = readdirSync(dir).filter(isScenario).sort();
    expect(found).toEqual([
      'both-absent-return.scenario.ts',
      'code-reuse-new-game.scenario.ts',
      'divergence-resolution.scenario.ts',
      'ff-vs-diff-boundary.scenario.ts',
      'issue45-reconnect-resync.scenario.ts',
      'last-move-truth.scenario.ts',
      'mirror-republish.scenario.ts',
      'rematch-reconnect.scenario.ts',
    ]);
  });
});

describe('classifyOutcome() — exiting 0 is not enough; a scenario must have ASSERTED something', () => {
  it('THE FALSE-GREEN, at the runner level: exit 0 with NO check tally is FAILED', async () => {
    const { classifyOutcome } = await freshHarness();
    expect(classifyOutcome(0, false)).toBe('FAILED');
  });

  it('exit 0 WITH a reported tally is the only way to pass', async () => {
    const { classifyOutcome } = await freshHarness();
    expect(classifyOutcome(0, true)).toBe('passed');
  });

  it('exit 2 is SKIPPED (relay unreachable), tally or not — a missing relay is not a regression', async () => {
    const { classifyOutcome, EXIT_UNREACHABLE } = await freshHarness();
    expect(classifyOutcome(EXIT_UNREACHABLE, false)).toBe('skipped');
    expect(classifyOutcome(EXIT_UNREACHABLE, true)).toBe('skipped');
  });

  it('any other exit — including a SIGKILLed child (code null) — is FAILED', async () => {
    const { classifyOutcome } = await freshHarness();
    expect(classifyOutcome(1, true)).toBe('FAILED');
    expect(classifyOutcome(null, true)).toBe('FAILED');
    expect(classifyOutcome(127, false)).toBe('FAILED');
  });
});

describe('the check tally report() prints — the runner reads it across a process boundary', () => {
  it('is emitted with the counts, in a form `scenario:all` matches on', async () => {
    const { check, report, CHECK_TALLY_PREFIX } = await freshHarness();
    check('one', true);
    check('two', false);
    report('tallied');
    expect(printed.some((l) => l.includes(`${CHECK_TALLY_PREFIX} passed=1 failed=1`))).toBe(true);
  });

  it('is emitted even for a zero-check run, so the FAILURE is reported rather than invisible', async () => {
    const { report, CHECK_TALLY_PREFIX } = await freshHarness();
    expect(report('nothing')).toBe(1);
    expect(printed.some((l) => l.includes(`${CHECK_TALLY_PREFIX} passed=0 failed=0`))).toBe(true);
  });
});
