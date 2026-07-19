import tseslint from 'typescript-eslint';
import vitest from 'eslint-plugin-vitest';

/**
 * Test-integrity rules for the Vitest suites.
 *
 * These enforce that tests actually assert (no coverage-padding shells) and that
 * no test is silently disabled or focused — matching planning/agent-principles.md
 * ("Never weaken a gate", "Tests must be genuine"). Applied only to *.test.ts.
 */
const vitestTestIntegrity = {
  files: ['src/**/*.test.ts'],
  plugins: { vitest },
  rules: {
    'vitest/expect-expect': 'error',
    'vitest/valid-expect': 'error',
    'vitest/no-disabled-tests': 'error',
    'vitest/no-focused-tests': 'error',
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
    ignores: ['docs/**', 'poc/**', 'node_modules/**', 'coverage/**', 'playwright-report/**', 'test-results/**'],
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
);
