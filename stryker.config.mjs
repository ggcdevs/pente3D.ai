// @ts-check
/**
 * StrykerJS mutation-testing config.
 *
 * Scope: mutate the pure rules core (`src/core`) PLUS the in-scope
 * config/persist layers (`src/config`, `src/persist`) PLUS the pure seat logic
 * (`src/net/seats.ts`), excluding test files. Each whitespace-separated path in
 * the requested scope "src/config src/persist" is expanded to a recursive `.ts`
 * glob with its `.test.ts` files excluded; the pre-existing `src/core` scope is
 * preserved. The rest of `src/net` (the IO transport adapter) is intentionally
 * NOT mutated — it is proven by the real-relay integration test (Task 3.3).
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
 * lowering the bar — archive.ts reached 100%, db.ts 100% (see below), config.ts 96.15%.
 *
 * DETERMINISTIC score (after generous timeout hardening): the earlier core-only
 * build jittered because infinite-loop mutants flickered between Killed and Timeout
 * under machine load, letting the gate flip red by luck. Raising `timeoutMS`/
 * `timeoutFactor` (below) makes classification stable — genuine hangs still time out
 * (a legitimate kill), slow-but-terminating mutants finish and reveal their true
 * status. (For the current observed overall/per-file scores — after the net scope
 * was added — see the OBSERVED block near the end of this comment; that is the
 * single source of truth for the numbers, kept from drifting into stale claims.)
 *
 * The residual SURVIVING mutants are equivalent mutants that cannot be killed
 * without changing observable behavior — e.g. in core: the capture bounds pre-guard
 * at placePiece.ts (off-board lookups already return `undefined`); in config: the two
 * `readOverride` early-returns whose fall-through path yields the same `undefined`.
 * Raise the floor only alongside real tests that kill genuine survivors.
 *
 * NOTE: db.ts's `if (!contains(GAMES_STORE))` guard in onupgradeneeded was PREVIOUSLY
 * listed here as an equivalent mutant, on the (incorrect) premise that the guard was
 * unreachable because openDatabase only ever opened at a fixed version 1. That was a
 * proof-by-inference: no test drove the production onupgradeneeded with the store
 * already present. openDatabase now accepts a `version` param, and a test re-opens an
 * existing db at a higher version through the production wrapper — genuinely firing the
 * guard. With the guard mutated to `if (true)`, createObjectStore on the existing store
 * throws ConstraintError, aborts the upgrade, and the open rejects; the test's resolving
 * open + surviving data KILLS the mutant. db.ts is now 100% (39/39), no survivors.
 *
 * Gate-rejection VERIFIED (agent-principles.md #7): with break temporarily set
 * to 97 and score 96.10%, `stryker run` printed "Final mutation score 96.10
 * under breaking threshold 97, setting exit code to 1 (failure)" and exited 1.
 * Restored to 95. Re-VERIFIED after adding src/net/sync.ts to the mutate scope:
 * with break temporarily set to 98 and score 96.53%, `stryker run` printed
 * "Final mutation score 96.53 under breaking threshold 98, setting exit code to 1
 * (failure)" and exited 1. Restored to 95.
 *
 * OBSERVED (full configured `npx stryker run`, 2026-07-19, after hardening the
 * parseSyncMessage malformed-log tests): overall 96.95% (exit 0, >= break 95),
 * net src/net 98.08% = seats.ts 100% (44/44), sync.ts 97.32% (109 killed, 3
 * survivors) — a 1.95 margin over break=95. Gate-rejection re-VERIFIED same run:
 * with break temporarily set to 98, `stryker run` printed "Final mutation score
 * 97.05 under breaking threshold 98, setting exit code to 1 (failure)" and exited
 * 1 (the 96.95↔97.05 delta is the documented timeout-classification jitter, well
 * inside the 95 bar); restored to 95. These are the observed current numbers — do
 * NOT re-document stale/unrun figures as fact (agent-principles.md #2/#3/#7).
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
    // src/net/seats.ts is PURE logic (identity-owned seat assignment) with no IO,
    // so it is fully mutation-coverable and held to the gate (Task 3.2). src/net/sync.ts
    // is the PURE full-state sync decision engine (decideSync + SyncMessage codec: no
    // transport, DOM, or clock — see its header "Layering & purity"), likewise fully
    // mutation-coverable and held to the gate (Task 3.3). Both are exact-file scope
    // "src/net/seats.ts src/net/sync.ts". The rest of src/net is deliberately NOT
    // mutated: transport.ts / mqttTransport.ts are the thin IO adapter + its
    // MockTransport double, and the LIVE relay is proven by the Task 3.3 real-relay
    // integration test — NOT by mutation-testing mqtt glue (build plan /
    // agent-principles: keep the pure logic separable and mutation-tested; verify the
    // adapter by behavior over the real broker). Do NOT add IO-glue files outside
    // seats.ts / sync.ts to this list.
    'src/net/seats.ts',
    'src/net/sync.ts',
    '!src/net/**/*.test.ts',
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
