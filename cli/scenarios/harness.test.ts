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
  it('runs the scenarios', async () => {
    const { isScenario } = await freshHarness();
    expect(isScenario('issue45-reconnect-resync.ts')).toBe(true);
    expect(isScenario('ff-vs-diff-boundary.ts')).toBe(true);
  });

  it('never runs the runner, the harness, or a vitest suite as a scenario', async () => {
    const { isScenario } = await freshHarness();
    expect(isScenario('all.ts')).toBe(false);
    expect(isScenario('harness.ts')).toBe(false);
    // This very file lives in the scenarios directory; directory-based discovery must skip it.
    expect(isScenario('harness.test.ts')).toBe(false);
    expect(isScenario('README.md')).toBe(false);
  });
});
