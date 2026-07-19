// @ts-check
/**
 * StrykerJS mutation-testing config.
 *
 * Scope: mutate the pure rules core (`src/core`) PLUS the in-scope
 * config/persist layers (`src/config`, `src/persist`), excluding test files.
 * Each whitespace-separated path in the requested scope "src/config src/persist"
 * is expanded to a recursive `.ts` glob with its `.test.ts` files excluded; the
 * pre-existing `src/core` scope is preserved.
 * Coverage is a floor; mutation score is the real bar for these layers
 * (see planning/agent-principles.md — "Mutation score is the real bar").
 *
 * MACHINE-ENFORCED GATE: `thresholds.break = 95` makes `npx stryker run` exit
 * NON-ZERO when the overall mutation score (core + config + persist) drops below
 * 95%. Without a `break` value Stryker's default is `null` and the run always
 * exits 0 — an unenforced gate. Do NOT lower this to make a run pass; kill the
 * surviving mutant with a genuine test instead (agent-principles.md #6 — "Never
 * weaken a gate to pass it"). When the config/persist scope was first added the
 * overall score fell to 94.33% (config 88.46%, persist 87.06%) and the gate
 * correctly failed; the drop was fixed by ADDING mutation-killing tests, never by
 * lowering the bar — archive.ts reached 100%, db.ts 97.44%, config.ts 96.15%.
 *
 * DETERMINISTIC score (after generous timeout hardening): the earlier core-only
 * build jittered because infinite-loop mutants flickered between Killed and Timeout
 * under machine load, letting the gate flip red by luck. Raising `timeoutMS`/
 * `timeoutFactor` (below) makes classification stable — genuine hangs still time out
 * (a legitimate kill), slow-but-terminating mutants finish and reveal their true
 * status. With the config/persist scope added, the overall score is 96.10% (core
 * 95.74%, config 96.15%, persist 98.82%) — a ~1.1 margin over break=95.
 *
 * The residual SURVIVING mutants are equivalent mutants that cannot be killed
 * without changing observable behavior — e.g. in core: the capture bounds pre-guard
 * at placePiece.ts (off-board lookups already return `undefined`); in persist:
 * db.ts's `if (!contains(GAMES_STORE))` in onupgradeneeded (creating an already-
 * present store is a no-op under a fresh v1 db); in config: the two `readOverride`
 * early-returns whose fall-through path yields the same `undefined`. Raise the
 * floor only alongside real tests that kill genuine survivors.
 *
 * Gate-rejection VERIFIED (agent-principles.md #7): with break temporarily set
 * to 97 and score 96.10%, `stryker run` printed "Final mutation score 96.10
 * under breaking threshold 97, setting exit code to 1 (failure)" and exited 1.
 * Restored to 95.
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  packageManager: 'npm',
  testRunner: 'vitest',
  reporters: ['html', 'clear-text', 'progress', 'json'],
  // Mutate the rules core AND the in-scope config/persist layers; never mutate
  // the tests themselves. Scope "src/config src/persist" — each path expands to
  // `<path>/**/*.ts` with its `*.test.ts` excluded. Existing `src/core` scope
  // preserved (idempotent — do not drop already-covered paths).
  mutate: [
    'src/core/**/*.ts',
    '!src/core/**/*.test.ts',
    'src/config/**/*.ts',
    '!src/config/**/*.test.ts',
    'src/persist/**/*.ts',
    '!src/persist/**/*.test.ts',
  ],
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
