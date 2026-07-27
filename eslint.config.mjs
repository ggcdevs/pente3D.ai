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
 * from `@playwright/test`, so those three are inert on a Playwright spec. Establish this
 * by probe, never by reading — drop a spec containing each violation under e2e/ and run
 * `npm run lint`. The two holes that actually matter for e2e — a focused spec (Playwright
 * then runs ONLY it and reports the whole suite green) and a statically disabled spec —
 * are covered by `vitest/no-focused-tests` plus the `playwrightTestIntegrity` block below.
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
 * Statically-disabled Playwright specs are banned (the e2e half of "no test is silently
 * disabled"). e2e/ is the boundary that JUSTIFIES excluding the THREE.js/DOM IO glue from
 * unit coverage and from the mutation scope — so a spec that quietly stops running turns
 * that exclusion into an unverified claim.
 *
 * The selectors below match the MODIFIER forms only, whose first argument is a string
 * literal title: `test.skip('title', fn)`, `test.fixme('title', fn)`, and the
 * `test.describe.skip('title', fn)` / `.fixme` variants. Playwright's RUNTIME conditional
 * skip — `test.skip(cond, 'reason')`, used across the live-relay specs to opt out when the
 * broker is unreachable — passes an expression first and is deliberately NOT matched: it is
 * an honest, condition-reported skip, not a silent disable. `.only` is already covered by
 * `vitest/no-focused-tests` above.
 */
const playwrightTestIntegrity = {
  files: ['e2e/**/*.spec.ts'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector:
          "CallExpression[callee.object.name='test'][callee.property.name=/^(skip|fixme)$/][arguments.0.type='Literal']",
        message:
          'Statically disabled Playwright spec. Delete it or fix it — a silently skipped e2e spec voids the Playwright-verified IO boundary (planning/agent-principles.md #6). Runtime `test.skip(condition, reason)` is allowed.',
      },
      {
        selector:
          "CallExpression[callee.object.property.name='describe'][callee.property.name=/^(skip|fixme)$/]",
        message:
          'Statically disabled Playwright describe block. Delete it or fix it — a silently skipped e2e spec voids the Playwright-verified IO boundary (planning/agent-principles.md #6).',
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
    ignores: ['dist/**', 'docs/**', 'poc/**', 'node_modules/**', 'coverage/**', 'playwright-report/**', 'test-results/**', '.stryker-tmp/**'],
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
