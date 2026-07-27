import tseslint from 'typescript-eslint';
import vitest from 'eslint-plugin-vitest';

/**
 * Test-integrity rules for the Vitest suites.
 *
 * These enforce that tests actually assert (no coverage-padding shells) and that
 * no test is silently disabled or focused — matching planning/agent-principles.md
 * ("Never weaken a gate", "Tests must be genuine"). Applied to every Vitest suite — the
 * `.test.ts` suites under src/ (which is where src/net + src/debug live), the pure
 * build-tooling `.test.mjs` suites under tools/ (issue #22), and any future `.test.ts`
 * suite under cli/. See the `files` globs below for the exact patterns; they are not
 * repeated in this comment because a `**` glob would close the block comment early.
 *
 * The Playwright specs under e2e/ are ALSO listed, but only `vitest/no-focused-tests`
 * actually fires there and that is deliberate, not an oversight: this plugin's
 * expect-expect / valid-expect / no-disabled-tests resolve a call as a test only when
 * the test fn comes from vitest (import or global), and e2e/ imports `test`/`expect`
 * from `@playwright/test`, so those three are inert on a Playwright spec.
 *
 * EXACTLY what this block covers on a Playwright spec, and nothing more: `vitest/no-focused-tests`
 * fires on `test.only(…)` — a member call whose OBJECT is the identifier `test`. It does NOT fire on
 * `test.describe.only(…)`, whose callee object is itself a member expression; that form focuses a
 * whole file's worth of specs and is closed by `playwrightTestIntegrity` below, not here. Every claim
 * in this paragraph is asserted, not asserted-by-reading: `e2e/lintFixtures/*.spec.ts` holds one
 * instance of each form and `tools/lintGate.test.mjs` runs eslint over it and demands the exact
 * rule/line set (both directions — a violating line must error, a legitimate line must not).
 */
const vitestTestIntegrity = {
  files: ['src/**/*.test.ts', 'tools/**/*.test.mjs', 'cli/**/*.test.ts', 'e2e/**/*.spec.ts'],
  plugins: { vitest },
  rules: {
    'vitest/expect-expect': 'error',
    'vitest/valid-expect': 'error',
    'vitest/no-disabled-tests': 'error',
    'vitest/no-focused-tests': 'error',
  },
};

/**
 * Statically-disabled and FOCUSED Playwright specs are banned (the e2e half of "no test is
 * silently disabled"). e2e/ is the boundary that JUSTIFIES excluding the THREE.js/DOM IO glue
 * from unit coverage and from the mutation scope — so a spec that quietly stops running, or a
 * `test.describe.only` that makes Playwright run ONE block and exit 0, turns that exclusion into
 * an unverified claim while the suite reports green.
 *
 * WHAT EACH SELECTOR MATCHES — and, as importantly, what it does not:
 *
 *  1. `test.skip(<title>, fn)` / `test.fixme(<title>, fn)` where the title is a string literal
 *     OR a template literal. Both spellings statically disable the spec; matching only
 *     `Literal` let `` test.skip(`${TITLE} skip`, fn) `` walk straight through.
 *  2. `test.skip()` with NO arguments — the body form, the most common way a spec is silently
 *     turned off from the inside. It has no `arguments.0` at all, so selector 1 cannot see it.
 *  3. `test.describe.skip` / `.fixme` — the whole-block disable.
 *  4. `test.describe.only` — the whole-block FOCUS. `vitest/no-focused-tests` only sees
 *     `test.only` (callee object = the identifier `test`), never this member-of-member form.
 *
 * Playwright's RUNTIME conditional skip — `test.skip(cond, 'reason')`, used across the live-relay
 * specs to opt out when the broker is unreachable — passes an EXPRESSION first and is deliberately
 * NOT matched by selector 1 (nor by 2, which requires zero arguments): it is an honest,
 * condition-reported skip, not a silent disable.
 *
 * Established by probe, never by reading: `e2e/lintFixtures/*.spec.ts` holds one instance of every
 * form above (violating AND allowed) and `tools/lintGate.test.mjs` asserts the exact rule/line set
 * eslint reports on it. Re-break a selector there and that test goes red.
 */
const playwrightTestIntegrity = {
  files: ['e2e/**/*.spec.ts'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector:
          "CallExpression[callee.object.name='test'][callee.property.name=/^(skip|fixme)$/][arguments.0.type=/^(Literal|TemplateLiteral)$/]",
        message:
          'Statically disabled Playwright spec. Delete it or fix it — a silently skipped e2e spec voids the Playwright-verified IO boundary (planning/agent-principles.md #6). Runtime `test.skip(condition, reason)` is allowed.',
      },
      {
        selector:
          "CallExpression[callee.object.name='test'][callee.property.name='skip'][arguments.length=0]",
        message:
          'Bare `test.skip()` disables this spec from the inside with no condition and no reason — the silent disable this gate exists to stop (planning/agent-principles.md #6). Delete the spec or give the skip a real runtime condition: `test.skip(cond, reason)`.',
      },
      {
        selector:
          "CallExpression[callee.object.property.name='describe'][callee.property.name=/^(skip|fixme)$/]",
        message:
          'Statically disabled Playwright describe block. Delete it or fix it — a silently skipped e2e spec voids the Playwright-verified IO boundary (planning/agent-principles.md #6).',
      },
      {
        selector:
          "CallExpression[callee.object.property.name='describe'][callee.property.name='only']",
        message:
          'Focused Playwright describe block. Playwright then runs ONLY this block and exits 0 — a green suite that tested almost nothing (planning/agent-principles.md #6/#7). Remove `.only`; run one file with `npx playwright test <file>` instead.',
      },
    ],
  },
};

/**
 * The core import-boundary guard.
 *
 * The pure rules core (`src/core/**`) must never depend on rendering, networking,
 * the UI shell, Three.js, or DOM globals — this mechanically enforces the
 * rules-vs-view separation from the build plan (Task 0.5). Violations fail `npm run lint`.
 */
const coreForbiddenImports = {
  files: ['src/core/**/*.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [
          { name: 'three', message: 'src/core must not import three.' },
        ],
        patterns: [
          {
            group: [
              'three',
              'three/*',
              '**/render/**',
              '**/net/**',
              '**/ui/**',
              '../render/*',
              '../net/*',
              '../ui/*',
            ],
            message:
              'src/core is the pure rules layer: no imports from render/, net/, ui/, or three.',
          },
        ],
      },
    ],
    // Forbid DOM/browser globals in the rules core.
    'no-restricted-globals': [
      'error',
      { name: 'window', message: 'src/core must not touch the DOM (window).' },
      { name: 'document', message: 'src/core must not touch the DOM (document).' },
      { name: 'navigator', message: 'src/core must not touch browser globals (navigator).' },
      { name: 'localStorage', message: 'src/core must not touch browser globals (localStorage).' },
    ],
  },
};

export default tseslint.config(
  {
    // Build artifacts / generated output — never source. `.stryker-tmp` is Stryker's
    // transient sandbox (a copy of src/ with `@ts-nocheck` prepended for mutation
    // runs); it is gitignored and machine-generated, and Stryker occasionally leaves
    // it behind on an interrupted run. Linting that copy floods `npm run lint` with
    // hundreds of spurious errors on code we didn't write, so it is ignored like the
    // other build-output dirs — this is not a relaxation of any rule on real source.
    // `e2e/lintFixtures/**` holds the DELIBERATE violations that prove the two test-integrity
    // blocks above actually bite (a focused describe, a bare `test.skip()`, a template-literal
    // skip, …). They are real `.spec.ts` files under `e2e/` ON PURPOSE, so the production globs
    // apply to them unchanged — nothing about the gate is special-cased for the fixture. They are
    // excluded from the ordinary `eslint .` sweep only because their whole point is to be
    // non-compliant; `tools/lintGate.test.mjs` lints them explicitly with `--no-ignore` and FAILS
    // unless eslint reports the exact expected rule/line set. That is the opposite of a
    // relaxation: it is the only reason we know the rules fire at all (agent-principles #7).
    // Playwright skips the directory too (`testIgnore` in playwright.config.ts).
    ignores: ['e2e/lintFixtures/**', 'dist/**', 'docs/**', 'poc/**', 'node_modules/**', 'coverage/**', 'playwright-report/**', 'test-results/**', '.stryker-tmp/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'e2e/**/*.ts', 'vite.config.ts', 'playwright.config.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // Allow a leading-underscore to mark an intentionally-unused binding —
      // e.g. a reserved-but-ignored interface param (`connect(room, _opts?)`,
      // the v1 room-password seam). This is the idiomatic ESLint signal for
      // "deliberately unused", not a relaxation of unused-var detection: any
      // non-underscore unused binding still errors.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  coreForbiddenImports,
  vitestTestIntegrity,
  playwrightTestIntegrity,
);
