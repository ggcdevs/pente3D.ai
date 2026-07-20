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
    // Pure net-routing decisions (Task 6.1): where a placement flows (session vs local) and whether
    // the scene renders the session game — the issue #4 "one authoritative game per session" logic,
    // separated from the scene/session IO glue so it is mutation-gated like the other pure net logic.
    'src/net/netRouting.ts',
    // Pure seat-turn gate (Task 6.2, issue #4c): whether the local seat may place given whose turn it
    // is in the authoritative networked game — blocks an out-of-seat-order move. Separated from the
    // scene/session IO glue so it is mutation-gated like the other pure net logic.
    'src/net/turnGate.ts',
    // Pure host/join/play-again decisions (Task 6.4, issue #4a): whether to archive+reset the local
    // board before starting a networked game (played → yes, pristine → no), and whether a finished
    // networked game should prompt for another (winner → yes). Separated from the scene/session IO
    // glue so it is mutation-gated like the other pure net logic.
    'src/net/rematch.ts',
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
    // Pure node-pick-radius resolver (GitHub issue #3): maps a node's occupancy + the
    // marker/piece radii + padding + spacing to its invisible pick-sphere radius (empty →
    // marker-sized, occupied → piece-sized, clamped to half-spacing). THREE-free / DOM-free —
    // the InstancedMesh scaling + occupancy sync in `picking.ts` is the Playwright-verified IO
    // boundary, NOT mutated, exactly as the other scene glue above.
    'src/render/pickRadius.ts',
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
    // Pure score/status banner view-model (Task 5.2): state + history flags → the serializable
    // model (status, captures, ordered Undo/Redo/Reset buttons + enabled). THREE-free / DOM-free
    // — the DOM/dispatch widget glue (`widgets/banner.ts`) is the Playwright-verified IO boundary,
    // excluded exactly as the container/shell glue is above.
    'src/ui/widgets/bannerModel.ts',
    // Pure menu view-model (Task 5.3): the entry roster → ordered, visible-filtered menu items
    // (id/label/commandId). THREE-free / DOM-free — the DOM/dispatch + scope-push widget glue
    // (`widgets/menu.ts`) is the Playwright-verified IO boundary, excluded exactly as the
    // container/shell/banner glue is above.
    'src/ui/widgets/menuModel.ts',
    // Pure settings view-model (Task 5.4): the config-sections → form-model derivation (board-size /
    // preset options, ordered colour+opacity fields, ordered keybinding rows) plus the input→patch
    // normalizers that REJECT a malformed board size / preset / colour / opacity. THREE-free /
    // DOM-free — the DOM/config-write + scope-push widget glue (`widgets/settings.ts`) is the
    // Playwright-verified IO boundary, excluded exactly as the menu/banner glue is above.
    'src/ui/widgets/settingsModel.ts',
    // Pure networking view-model (Task 5.5): the session-state → panel/label/conflict-banner
    // derivation, and the game-code validation / normalization / generation (each rejecting a
    // malformed typed code). THREE-free / DOM-free — the DOM/dispatch widget glue (`widgets/net.ts`)
    // and the SyncEngine+seat session wiring (`net/session.ts`, `net/appSession.ts`) are the
    // Playwright-verified IO boundary, excluded exactly as the menu/settings glue is above.
    'src/ui/widgets/netModel.ts',
    // Pure history-slider view-model (Task 5.6): the raw-value → clamped-viewed-ply resolution
    // (`resolveScrub`) and the ply/max/viewed facts → serializable model derivation
    // (`deriveSlider`). THREE-free / DOM-free — the `<input type=range>` widget glue
    // (`widgets/historySlider.ts`) and the scene's read-only scrub seam (`scene.ts`) are the
    // Playwright-verified IO boundary, excluded exactly as the net/settings glue is above.
    'src/ui/widgets/sliderModel.ts',
    // Pure help-overlay view-model (Task 5.7): the registered command ids + current bindings →
    // ordered shortcut rows (invert bindings, keep only registered+bound commands, sort). THREE-free
    // / DOM-free — the DOM/scope-push widget glue (`widgets/help.ts`) is the Playwright-verified IO
    // boundary, excluded exactly as the menu/settings/slider glue is above.
    'src/ui/widgets/helpModel.ts',
    // Pure archive-browser view-model (Task 5.8): the archive's `GameListing[]` → newest-first
    // rows (id / players label / result / conflicted flag / headHash / startedAt) + the
    // deterministic players-label projection. THREE-free / DOM-free — the DOM/dispatch + IndexedDB
    // widget glue (`widgets/archive.ts`), the scene's `loadGame` seam, and the app-level
    // autosave/restore wiring (`main.ts`) are the Playwright-verified IO boundary, excluded exactly
    // as the menu/net/slider glue is above.
    'src/ui/widgets/archiveModel.ts',
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
