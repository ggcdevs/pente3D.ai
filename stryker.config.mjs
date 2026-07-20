// @ts-check
/**
 * StrykerJS mutation-testing config.
 *
 * SCOPE: mutate the pure, deterministic logic only — `src/core`, `src/config`,
 * `src/persist`, and the pure `src/net` logic (`seats.ts`, `sync.ts`). The IO
 * transport adapter (`src/net/transport.ts`, `mqttTransport.ts`) is deliberately NOT
 * mutated; it is verified by the real-relay integration test (Task 3.3), not by
 * mutation-testing mqtt/DOM glue. Coverage is a floor; mutation is the real bar
 * (planning/agent-principles.md — "Mutation score is the real bar").
 *
 * ENFORCED GATE: `thresholds.break = 95` → `npm run mutate` exits non-zero below 95%
 * overall. Without a `break` value Stryker defaults to no gate. Do NOT lower it to make
 * a run pass; kill the surviving mutant with a genuine test (agent-principles #6).
 *
 * NO SCORES ARE DOCUMENTED HERE, ON PURPOSE. Mutation numbers are volatile — per-file
 * scores are scope-dependent (perTest attribution), and the overall score shifts as
 * code/tests change — so any figure written into this comment goes stale and becomes
 * proof-by-inference, the exact trap agent-principles #2/#3/#7 forbid (and the trap
 * that repeatedly tripped the review gate). The COMMAND is the single source of truth:
 * run `npm run mutate` for the current score, and see `reports/mutation` for per-mutant
 * detail. Report the scope you actually ran.
 *
 * DETERMINISM: the generous `timeoutMS`/`timeoutFactor` below make Killed-vs-Timeout
 * classification stable — genuine infinite-loop mutants still time out (a legitimate
 * kill), while slow-but-terminating mutants finish and reveal their true killed/survived
 * status — so the score no longer jitters red under machine load.
 *
 * RESIDUAL SURVIVORS are equivalent mutants (killing them would require asserting on
 * non-behavior). Described structurally, without counts, so this note can't go stale:
 *   - core: the capture bounds pre-guard in placePiece (off-board lookups already
 *     return `undefined`);
 *   - config: the two `readOverride` early-returns whose fall-through yields the same
 *     `undefined`;
 *   - sync.ts: error-MESSAGE string literals (the `SyncError` TYPE and its occurrence
 *     ARE asserted; only the human-readable message text is not) and the `case 'ignore'`
 *     no-op arm;
 *   - winLineLayout.ts: the empty `drawn` array passed to `generatePartialLine` (`[]` →
 *     `["Stryker was here"]`). The win line is never pre-registered, so any `drawn` list
 *     lacking the segment's canonical id yields identical behavior — an equivalent mutant
 *     (killing it would require asserting on a contrived id-collision, not real behavior).
 *   - markersLayout.ts: the `if (id !== undefined)` guard on the occupancy write for an
 *     off-board `pieces` key. Mutated to `if (true)` it runs `visible[undefined] = false`,
 *     which only adds a non-index `"undefined"` property to the array — length, values, and
 *     the visibleCount the readout reports are all unchanged. Equivalent (killing it would
 *     require asserting on the presence of a junk property, not real behavior).
 *     Kill genuine (non-equivalent) survivors with real tests; never suppress.
 *
 * Gate-rejection is re-proven on every review-gate run (agent-principles #7): temporarily
 * raising `break` above the current score makes `npm run mutate` exit non-zero.
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  packageManager: 'npm',
  testRunner: 'vitest',
  reporters: ['html', 'clear-text', 'progress', 'json'],
  // Mutate the pure logic only; never mutate the tests themselves. IO-glue files
  // (src/net/transport.ts, mqttTransport.ts) are intentionally absent — verified by the
  // real-relay integration test, not by mutating mqtt glue. Do NOT add them here.
  mutate: [
    'src/core/**/*.ts',
    '!src/core/**/*.test.ts',
    'src/config/**/*.ts',
    '!src/config/**/*.test.ts',
    'src/persist/**/*.ts',
    '!src/persist/**/*.test.ts',
    'src/net/seats.ts',
    'src/net/sync.ts',
    '!src/net/**/*.test.ts',
    // Pure render resolvers only (THREE-free). The Three.js scene GLUE (`scene.ts`,
    // `lines.ts`) is NOT mutated — it is an IO boundary verified by Playwright (build
    // plan Tasks 4.1/4.4).
    'src/render/sceneConfig.ts',
    'src/render/markersLayout.ts',
    'src/render/linesLayout.ts',
    'src/render/piecesDiff.ts',
    'src/render/winLineLayout.ts',
    'src/render/cameraPresets.ts',
    // Pure hover-target computation (Task 4.7): the game-core Part 4 hover rules resolved
    // from a raycast hit + state + line index. THREE-free / DOM-free. The Three.js
    // raycaster (`picking.ts`) and emissive-application glue are NOT mutated — verified by
    // Playwright, exactly as the other scene glue above.
    'src/render/hover.ts',
    '!src/render/**/*.test.ts',
    // Pure input system (Task 4.6): command registry, keybinding-chord normalization,
    // and the scope-stack resolver. THREE-free / DOM-free — this is core interaction
    // logic, strictly mutation-gated. NOT `src/input/setup.ts`: that installs a DOM
    // `keydown` listener (an IO boundary verified by Playwright), so it is deliberately
    // excluded, exactly as `scene.ts`/`lines.ts` glue is excluded above.
    'src/input/commands.ts',
    'src/input/scopes.ts',
    'src/input/keybindings.ts',
    // Pure placement + temp-mode wiring (Task 4.8): the empty-node → place resolver and the
    // immutable temp-placement state machine + scope builder. THREE-free / DOM-free; the
    // Three.js click/preview glue in `scene.ts` is excluded (Playwright-verified) exactly as
    // the other scene glue above.
    'src/input/placement.ts',
    // Pure drag-vs-click disambiguation (GitHub issue #1): decides place-vs-suppress from the
    // pointerdown/pointerup positions + the `interaction.dragGuard` config. THREE-free /
    // DOM-free — the canvas pointer plumbing in `scene.ts` is the Playwright-verified IO
    // boundary, excluded exactly as the other scene glue above.
    'src/input/pointerGesture.ts',
    '!src/input/**/*.test.ts',
    // Pure composable-UI logic (Task 5.1): the zone-based layout resolver and the widget
    // registry. THREE-free / DOM-free — the DOM container/shell/widget glue (`container.ts`,
    // `setup.ts`, `widgets/**`) is NOT mutated; it is the Playwright-verified IO boundary,
    // excluded exactly as `scene.ts` / `input/setup.ts` glue is excluded above.
    'src/ui/layout.ts',
    'src/ui/registry.ts',
    '!src/ui/**/*.test.ts',
  ],
  coverageAnalysis: 'perTest',
  // Generous timeout to make Killed-vs-Timeout classification DETERMINISTIC (see header):
  // removes the run-to-run jitter that let this gate flip red under machine load.
  timeoutMS: 20000,
  timeoutFactor: 4,
  // The enforced bar: exit non-zero below `break`. `high`/`low` only colour the report.
  thresholds: { high: 99, low: 96, break: 95 },
  vitest: {
    configFile: 'vite.config.ts',
  },
};
