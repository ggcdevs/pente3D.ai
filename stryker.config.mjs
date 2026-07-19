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
 * DETERMINISTIC score (after generous timeout hardening): the earlier build jittered
 * 94.98–96.65% because infinite-loop mutants flickered between Killed and Timeout under
 * machine load, letting the gate flip red by luck. Raising `timeoutMS`/`timeoutFactor`
 * (below) makes classification stable — genuine hangs still time out (a legitimate kill),
 * slow-but-terminating mutants finish and reveal their true status. With that, two
 * consecutive full runs BOTH score 95.74% exactly (exit 0), i.e. the score is now
 * reproducible, not luck. 95.74% is the honest deterministic floor.
 *
 * The residual SURVIVING mutants are equivalent / redundant-guard mutants (e.g.
 * the capture bounds pre-guard at placePiece.ts:54, whose off-board lookups
 * already return `undefined`; the `stateAt` clamp boundary in game.ts:99; the
 * arity guard redundant with the round-trip guard in serialize.ts:166) that
 * cannot be killed without changing observable behavior. break=95 sits just below
 * the deterministic 95.74% floor — thin but no longer flaky (a deterministic 0.74
 * margin only moves when code/tests change, which is the gate working). Raise the
 * floor only alongside real tests that kill genuine survivors.
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
  // Generous timeout to make Killed-vs-Timeout classification DETERMINISTIC: genuine
  // infinite-loop mutants still time out (a legitimate kill), while slow-but-terminating
  // mutants get to finish and reveal their true killed/survived status — removing the
  // run-to-run score jitter that let this gate flip red under machine load.
  timeoutMS: 20000,
  timeoutFactor: 4,
  // The enforced bar: exit non-zero below `break`. `high`/`low` only colour the
  // report; `break` is what fails CI.
  thresholds: { high: 99, low: 96, break: 95 },
  vitest: {
    configFile: 'vite.config.ts',
  },
};
