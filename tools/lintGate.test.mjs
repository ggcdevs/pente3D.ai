/**
 * THE GATE ON THE GATE — proof that the e2e test-integrity lint rules reject what they claim to.
 *
 * `eslint.config.mjs` carries two blocks whose whole job is to stop a Playwright spec from being
 * silently disabled or focused (`vitestTestIntegrity`, `playwrightTestIntegrity`). A lint rule that
 * has never been watched rejecting something is not a gate, it is a comment — agent-principles #7 —
 * and that is not hypothetical here: the first version of the block asserted in prose that focused
 * specs were covered while `test.describe.only` walked straight through it, and Playwright then ran
 * ONE block out of a whole suite and exited 0.
 *
 * So the claim is machine-checked instead of written down. `e2e/lintFixtures/` holds one instance of
 * every banned form AND of the forms that must stay legal; this suite runs the REAL eslint binary
 * over that directory with the REAL project config and asserts the exact `{line, ruleId}` set.
 *
 * The expectation is not a hand-copied list of line numbers (which would rot on the first edit, and
 * would be asserting eslint's output against itself): it is parsed from the `// LINT-EXPECT: <rule>`
 * markers in the fixture. A marker is the fixture author's DECLARED intent, so the assertion is
 * "eslint agrees with what this line says it is", in both directions:
 *   - a marked line that produces no error  → the selector has a hole (the bug this suite exists for)
 *   - an unmarked line that produces an error → the selector is over-broad (it would ban a legal spec)
 *
 * The fixtures are in eslint's `ignores` (they are non-compliant on purpose, so `npm run lint` must
 * not see them); `--no-ignore` is what lets this suite lint them anyway.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = path.join(REPO_ROOT, 'e2e', 'lintFixtures');
const ESLINT_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'eslint');

/** `{file, line, ruleId}` for every finding, sorted — the comparable shape for both sides. */
function sortFindings(findings) {
  return [...findings].sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.ruleId.localeCompare(b.ruleId),
  );
}

/**
 * Run the project's eslint over the fixture directory and return every finding.
 * `--no-ignore` defeats the `e2e/lintFixtures/**` entry in the config's `ignores`; the config
 * itself is untouched, so the rules that fire here are exactly the rules that guard real specs.
 */
function lintFixtures() {
  const res = spawnSync(
    ESLINT_BIN,
    ['--no-ignore', '--no-warn-ignored', '--format', 'json', FIXTURE_DIR],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  // eslint exits 1 when it reports errors — expected here. Anything else (2 = crash/bad config) is
  // a broken harness and must not be read as "no findings".
  if (res.status !== 0 && res.status !== 1) {
    throw new Error(
      `eslint exited ${res.status} (expected 0 or 1) — the lint gate could not be measured.\n` +
        `${res.stderr || res.stdout}`,
    );
  }
  const results = JSON.parse(res.stdout);
  return results.flatMap((r) =>
    r.messages.map((m) => ({
      file: path.basename(r.filePath),
      line: m.line,
      ruleId: m.ruleId,
      message: m.message,
    })),
  );
}

/** Every `// LINT-EXPECT: <ruleId>` marker in the fixtures — the declared intent, line by line. */
function expectedFromMarkers() {
  const expected = [];
  for (const file of readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.spec.ts'))) {
    const lines = readFileSync(path.join(FIXTURE_DIR, file), 'utf8').split('\n');
    lines.forEach((text, i) => {
      // Anchored at end-of-line so the prose that MENTIONS the marker (in this file's and the
      // fixture's doc comments) is not itself read as one.
      const m = /\/\/ LINT-EXPECT: ([\w-]+(?:\/[\w-]+)?)\s*$/.exec(text);
      if (m) expected.push({ file, line: i + 1, ruleId: m[1] });
    });
  }
  return expected;
}

/** The main fixture's source lines — findings are anchored back to the code they were reported on. */
const FIXTURE_LINES = readFileSync(
  path.join(FIXTURE_DIR, 'disabledAndFocused.spec.ts'),
  'utf8',
).split('\n');

/** 1-indexed line of the first fixture line containing `needle`, or 0 when it is absent. */
const lineOf = (needle) => FIXTURE_LINES.findIndex((l) => l.includes(needle)) + 1;

describe('the e2e test-integrity lint gate rejects what it claims to (agent-principles #7)', () => {
  const findings = lintFixtures();
  const expected = expectedFromMarkers();

  it('reports EXACTLY the marked violations — no hole, no over-reach', () => {
    // Sanity: the fixture must actually contain cases, or this suite would assert nothing.
    expect(expected.length).toBeGreaterThanOrEqual(7);
    expect(sortFindings(findings.map(({ file, line, ruleId }) => ({ file, line, ruleId })))).toEqual(
      sortFindings(expected),
    );
  });

  it('catches EVERY focus spelling — plain `describe.only` AND the `.serial` chain', () => {
    const focusedFindings = findings.filter((f) => /focused playwright describe/i.test(f.message));
    // Asserted as a list so a failure prints every message eslint DID produce.
    expect(focusedFindings.map((f) => f.ruleId)).toEqual([
      'no-restricted-syntax',
      'no-restricted-syntax',
    ]);
    // Each must be reported on its own `test.describe….only(` line of the fixture, not somewhere
    // else — and BOTH spellings must appear, which is what `describe.serial.only` walked past.
    const sources = focusedFindings.map((f) => FIXTURE_LINES[f.line - 1].trim());
    expect(sources.some((s) => s.startsWith('test.describe.only('))).toBe(true);
    expect(sources.some((s) => s.startsWith('test.describe.serial.only('))).toBe(true);
  });

  it('catches EVERY static-disable spelling that used to escape', () => {
    const flagged = new Set(
      findings.filter((f) => f.file === 'disabledAndFocused.spec.ts').map((f) => f.line),
    );
    // Each of these was, at some point, a live hole: the template title and the bare `skip()` walked
    // through the first version; `fixme()` and the `.serial`/`.parallel` chains walked through the
    // second. Asserted as a NAMED map rather than a count, so a regression's diff says WHICH spelling
    // reopened instead of "expected 5 to be 4".
    const needles = [
      'test.skip(`${TITLE} skip`',
      'test.skip(); //',
      'test.fixme(); //',
      'test.describe.serial.skip(',
      'test.describe.parallel.skip(',
    ];
    expect(Object.fromEntries(needles.map((n) => [n, flagged.has(lineOf(n))]))).toEqual(
      Object.fromEntries(needles.map((n) => [n, true])),
    );
  });

  it("leaves Playwright's RUNTIME conditional forms alone (banning them forces silent early-returns)", () => {
    // Both spellings: widening the bare-body selector to `skip|fixme` must not have swept up the
    // conditional `fixme(cond, reason)`, which is an honest, reported opt-out. The fixture lines are
    // located first and asserted present, so a renamed fixture case cannot make this vacuous.
    const needles = ['test.skip(conditionIsTrue,', 'test.fixme(conditionIsTrue,'];
    const lines = needles.map(lineOf);
    expect(lines.filter((l) => l > 0)).toHaveLength(needles.length);
    expect(
      findings.filter((f) => f.file === 'disabledAndFocused.spec.ts' && lines.includes(f.line)),
    ).toEqual([]);
  });

  it('leaves the plain `.serial` MODIFIER alone (only the skip/fixme/only tips are banned)', () => {
    const line = lineOf("test.describe.serial('o plain serial describe'");
    expect(line).toBeGreaterThan(0);
    expect(
      findings.filter((f) => f.file === 'disabledAndFocused.spec.ts' && f.line === line),
    ).toEqual([]);
  });

  it('reports NOTHING on a compliant spec (the rules are not simply erroring on everything)', () => {
    expect(findings.filter((f) => f.file === 'clean.spec.ts')).toEqual([]);
  });
});
