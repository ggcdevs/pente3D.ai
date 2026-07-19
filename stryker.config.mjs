// @ts-check
/**
 * StrykerJS mutation-testing config.
 *
 * Scope: mutate ONLY the pure rules core (`src/core/**`), excluding test files.
 * Coverage is a floor; mutation score is the real bar for the rules engine
 * (see planning/agent-principles.md — "Mutation score is the real bar").
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  packageManager: 'npm',
  testRunner: 'vitest',
  reporters: ['html', 'clear-text', 'progress'],
  // Mutate only the rules core; never mutate the tests themselves.
  mutate: ['src/core/**/*.ts', '!src/core/**/*.test.ts'],
  coverageAnalysis: 'perTest',
  vitest: {
    configFile: 'vite.config.ts',
  },
};
