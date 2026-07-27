/**
 * FIXTURE — deliberately non-compliant. Never run; never linted by `npm run lint`.
 * See `e2e/lintFixtures/README.md`. Every line that must produce an eslint error carries a
 * `// LINT-EXPECT: <ruleId>` marker; `tools/lintGate.test.mjs` builds its expectation from those
 * markers and asserts eslint's output matches EXACTLY — so an unmarked line producing an error, or
 * a marked line producing none, fails the suite.
 *
 * Each case names the damage it does if it reaches `main` unnoticed.
 */
import { test, expect } from '@playwright/test';

const TITLE = 'templated';
/** Whether some precondition holds — stands in for a real runtime probe (relay reachable, …). */
const conditionIsTrue = String(process.env.NOPE) === 'yes';

// 1. Statically disabled spec, string-literal title. Never runs; the suite still says "passed".
test.skip('a literal skip', async () => { // LINT-EXPECT: no-restricted-syntax
  expect(1).toBe(1);
});

// 2. Same disable spelled with a template literal. `arguments.0.type` is TemplateLiteral, not
//    Literal — the form that walked straight through the first version of this gate.
test.skip(`${TITLE} skip`, async () => { // LINT-EXPECT: no-restricted-syntax
  expect(1).toBe(1);
});

// 3. `fixme` is the same silent disable under another name.
test.fixme('c literal fixme', async () => { // LINT-EXPECT: no-restricted-syntax
  expect(1).toBe(1);
});

// 4. Whole-block disable: every spec inside stops running at once.
test.describe.skip('d skipped describe', () => { // LINT-EXPECT: no-restricted-syntax
  test('inner d', async () => {
    expect(1).toBe(1);
  });
});

// 5. Whole-block FOCUS — the most damaging form. Playwright runs ONLY this block, drops every
//    other spec in the run, and exits 0. `vitest/no-focused-tests` does not see it (its callee
//    object is a member expression, not the identifier `test`).
test.describe.only('e focused describe', () => { // LINT-EXPECT: no-restricted-syntax
  test('inner e', async () => {
    expect(1).toBe(1);
  });
});

// 6. Single focused spec — caught by the vitest plugin, kept here so a regression in EITHER
//    mechanism is visible in one place.
test.only('f focused test', async () => { // LINT-EXPECT: vitest/no-focused-tests
  expect(1).toBe(1);
});

// 7. Bare `test.skip()` in the body: no title, no condition, no reason. The spec is reported as
//    skipped and nothing tells you why. Zero arguments, so the title-shaped selector cannot see it.
test('g bare skip inside', async () => {
  test.skip(); // LINT-EXPECT: no-restricted-syntax
  expect(1).toBe(1);
});

// 8. ALLOWED: Playwright's runtime conditional skip. It reports its condition and its reason, and
//    the live-relay specs depend on it. It must NOT be flagged — banning it would push those specs
//    into a silent early-return, the exact false-green this gate exists to prevent.
test('h runtime conditional skip is allowed', async () => {
  test.skip(conditionIsTrue, 'the broker is unreachable — this proves nothing without it');
  expect(1).toBe(1);
});

// 9. ALLOWED: an ordinary describe and an ordinary spec.
test.describe('i plain describe', () => {
  test('inner i', async () => {
    expect(1).toBe(1);
  });
});
