// @ts-check
/**
 * StrykerJS mutation-testing config.
 *
 * Scope: mutate ONLY the pure rules core (`src/core/**`), excluding test files.
 * Coverage is a floor; mutation score is the real bar for the rules engine
 * (see planning/agent-principles.md — "Mutation score is the real bar").
 *
 * MACHINE-ENFORCED GATE: `thresholds.break = 95` makes `npx stryker run` exit
 * NON-ZERO when the core mutation score drops below 95%. Without a `break` value
 * Stryker's default is `null` and the run always exits 0 — an unenforced gate.
 * Do NOT lower this to make a run pass; kill the surviving mutant with a genuine
 * test instead (agent-principles.md #6 — "Never weaken a gate to pass it").
 *
 * Current measured score is ~96.7% (reproducible across runs; `npm run mutate`
 * exits 0). The residual surviving mutants are equivalent / redundant-guard
 * mutants (e.g. the capture bounds pre-guard at placePiece.ts:54, whose off-board
 * lookups already return `undefined`; the `stateAt` clamp boundary in game.ts:99;
 * the arity guard redundant with the round-trip guard in serialize.ts:166) that
 * cannot be killed without changing observable behavior. 95 is the honest,
 * sustainable floor for the current suite — kept below the measured score so
 * timeout-classification jitter cannot flip the gate red; raise it only alongside
 * real tests that widen the margin.
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  packageManager: 'npm',
  testRunner: 'vitest',
  reporters: ['html', 'clear-text', 'progress', 'json'],
  // Mutate only the rules core; never mutate the tests themselves.
  mutate: ['src/core/**/*.ts', '!src/core/**/*.test.ts'],
  coverageAnalysis: 'perTest',
  // The enforced bar: exit non-zero below `break`. `high`/`low` only colour the
  // report; `break` is what fails CI.
  thresholds: { high: 99, low: 96, break: 95 },
  vitest: {
    configFile: 'vite.config.ts',
  },
};
