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
 * Measured detected score varies run-to-run: two full local runs observed
 * 95.74% (killed 610 / survived 28 / timeout 19) and 96.65% (killed 607 /
 * survived 22 / timeout 28) over the same 657 valid mutants. The jitter is
 * classification churn between Killed and Timeout for infinite-loop mutants
 * (concentrated in axes.ts / lines.ts / placePiece.ts, exercised by fast-check
 * property tests): a mutated loop/boundary that hangs is DETECTED via Stryker's
 * timeout, which is legitimate mutation semantics — a hang the tests would never
 * survive. Both runs exit 0 against break=95.
 *
 * Honest margin, stated adversarially: Stryker counts timeouts as detected, so
 * the reported score sits ~0.7–1.7 pts above break. If every timeout were
 * instead pessimistically treated as SURVIVED, killed/(killed+survived+timeout)
 * falls to ~92.4–92.9% — below break. So the comfortable margin depends on
 * timeouts staying classified as detected; it is NOT robust to a scenario where
 * fast hardware lets those infinite-loop mutants terminate and survive. Widen
 * the true margin by killing the residual survivors with real tests rather than
 * relying on timeout classification.
 *
 * The residual SURVIVING mutants are equivalent / redundant-guard mutants (e.g.
 * the capture bounds pre-guard at placePiece.ts:54, whose off-board lookups
 * already return `undefined`; the `stateAt` clamp boundary in game.ts:99; the
 * arity guard redundant with the round-trip guard in serialize.ts:166) that
 * cannot be killed without changing observable behavior. 95 is the honest floor
 * the current suite clears on every observed run; raise it only alongside real
 * tests that kill survivors and widen the timeout-independent margin.
 *
 * Gate-rejection VERIFIED (agent-principles.md #7): with break temporarily set
 * to 98 and score 96.65%, `stryker run` printed "Final mutation score 96.65
 * under breaking threshold 98, setting exit code to 1 (failure)" and exited 1.
 * Restored to 95.
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
