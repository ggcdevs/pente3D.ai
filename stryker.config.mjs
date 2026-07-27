// @ts-check
/**
 * StrykerJS mutation-testing config.
 *
 * SCOPE: mutate the pure, deterministic logic only, across the whole reviewed tree
 * ("planning docs src cli" — `planning/` and `docs/` are prose and contribute no mutable file, so
 * the executable half is `src` + `cli`, plus the pre-existing `tools/versionBump.mjs` pin). The
 * `mutate` list below is the single
 * source of truth for WHICH files those are — it is not re-enumerated here, because a second
 * copy of the list in prose goes stale the moment a file is added (agent-principles #8). The
 * RULE it encodes: a file is mutated iff it is THREE-free / DOM-free pure logic (a file may
 * read an injected `Storage`/browser global and still qualify — `net/activeGame.ts`,
 * `net/seats.ts`, `ui/widgets/recentCodes.ts`, `util/randomId.ts`); the IO glue around it is
 * deliberately excluded (`net/transport.ts`, `net/mqttTransport.ts`, `net/session.ts`,
 * `net/appSession.ts`, `net/notifyGlue.ts`, the Three.js scene, the DOM widgets), because
 * that boundary is verified by the real-relay integration tests and Playwright — not by
 * mutating mqtt/DOM glue. Coverage is a floor; mutation is the real bar
 * (planning/agent-principles.md — "Mutation score is the real bar").
 *
 * COVERAGE ALIGNMENT: every file in `mutate` is ALSO pinned to a hard 100% coverage floor in
 * `vite.config.ts` (`test.coverage.thresholds`), so a mutation-gated file can never silently
 * drop below full unit coverage. Adding a file here means adding its coverage pin there.
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
 *     ARE asserted; only the human-readable message text is not). The `case 'in-sync':` LABEL is a
 *     structurally equivalent survivor since V.4b: that arm's whole body is a `return`, so a mutated
 *     label simply falls out of the switch to the same place. (It is deliberately empty — the arm used
 *     to clear the divergence record, which the relay's self-echo made wrong; see the arm's comment.)
 *     Other survivors in this file live in the wire codec and the conflict-archival path; they are NOT characterised here
 *     (nobody has analysed them), and the current set is whatever `npm run mutate` reports —
 *     never a frozen list in this comment;
 *   - winLineLayout.ts: the empty `drawn` array passed to `generatePartialLine` (`[]` →
 *     `["Stryker was here"]`). The win line is never pre-registered, so any `drawn` list
 *     lacking the segment's canonical id yields identical behavior — an equivalent mutant
 *     (killing it would require asserting on a contrived id-collision, not real behavior).
 *   - markersLayout.ts: the `if (id !== undefined)` guard on the occupancy write for an
 *     off-board `pieces` key. Mutated to `if (true)` it runs `visible[undefined] = false`,
 *     which only adds a non-index `"undefined"` property to the array — length, values, and
 *     the visibleCount the readout reports are all unchanged. Equivalent (killing it would
 *     require asserting on the presence of a junk property, not real behavior).
 *   - recentCodes.ts: the two `[]` returns in the private `parseStoredArray` helper (`[]` →
 *     `["Stryker was here"]`, on the non-array and the JSON-parse-error arms). `listRecentCodes`
 *     re-validates EVERY parsed entry through `validateGameCode` and drops anything invalid, so a
 *     junk sentinel the parser hands back is filtered right back out to `[]` at the public boundary.
 *     Equivalent through the public seam — killing them would require asserting on the private
 *     helper's internal return, i.e. on non-behavior. (The corrupt-record-degrades-to-empty behavior
 *     the helper enables IS asserted, via the public list/record paths.)
 *   - seats.ts: the `owner !== null &&` short-circuit in the private `blockingOwnersAllPresent`
 *     helper (mutated to `true &&`). The helper's documented precondition is that it is called
 *     ONLY when the claimant owns neither seat and BOTH seats are owned — so `owner` is never
 *     null on any reachable call, and the mutant takes the identical path. The guard is a kept
 *     defensive tripwire against a future caller violating that precondition; killing it would
 *     require constructing a call that the public `claimSeat` boundary cannot produce, i.e.
 *     asserting on non-behavior. The genuine room-full-vs-seat-reserved rejection behavior IS
 *     asserted (all blocking owners present → `room-full`; an absent blocking owner →
 *     `seat-reserved`).
 *   - admission.ts: BOTH `<` → `<=` comparisons in the `beats` tie-break are equivalent, each
 *     for a structural reason:
 *       · the arrival compare `return p.arrivalOrder < best.arrivalOrder` is GUARDED by
 *         `if (p.arrivalOrder !== best.arrivalOrder)`, so it only ever runs when the two
 *         arrivals are UNEQUAL — where `<` and `<=` are identical. The equal case never
 *         reaches this return (it falls through to the playerId compare). Equivalent.
 *       · the playerId compare `return p.playerId < best.playerId` differs from `<=` ONLY when
 *         `p.playerId === best.playerId` — two peers with an identical (playerId, arrivalOrder).
 *         There `<=` swaps the winner to the duplicate, but it carries the SAME playerId and
 *         `electInitiator` returns `winner.playerId` — so the elected id is identical either way.
 *         Equivalent (killing it would require asserting WHICH duplicate object won, not the
 *         elected playerId, i.e. non-behavior).
 *     The genuine tie-break behavior IS asserted (earlier-arrival wins; equal-arrival breaks to
 *     the lower playerId; a same-arrival higher id listed after the leader does not displace it).
 *     Kill genuine (non-equivalent) survivors with real tests; never suppress.
 *   - netPanelModel.ts: the `state.resumeId !== null` guard in `isSeedActionable`'s `resume` arm
 *     (`&&` short-circuit). Mutated to `true &&`, it is equivalent because the following
 *     `state.games.some((g) => g.id === state.resumeId)` is ALREADY false when `resumeId` is null —
 *     no game `id` (typed `string`) can equal `null`. The guard is a kept intent tripwire (a resume
 *     with no pick is not actionable) that the some-check happens to also cover; killing it would
 *     require a game with a `null` id, which the type forbids — i.e. asserting on non-behavior. The
 *     resume actionability behavior IS asserted (no-pick → not actionable; member pick → actionable;
 *     stale/non-member pick → not actionable).
 *   - resolution.ts: the `candidates.lca !== null &&` short-circuit in `targetChoice`'s rewind arm
 *     (mutated to `true &&`). Equivalent by TYPE: `target` is a `string`, so the following
 *     `target === candidates.lca` is already false whenever `lca` is `null` — no string equals null.
 *     The guard is a kept intent tripwire (there is nothing to rewind TO when the two logs share no
 *     ancestor); killing it would require a `null` target, which the signature forbids, i.e. asserting
 *     on non-behavior. The genuine behavior IS asserted (a rewind is neither offered nor readable
 *     when there is no shared ancestor).
 *   - versionBump.mjs: BOTH surviving mutants replace an empty ARRAY LITERAL with Stryker's
 *     `["Stryker was here"]` sentinel, and both are equivalent because that sentinel is not a
 *     bump-carrying value anywhere it lands:
 *       · the `subjects = []` parameter default. The sentinel string has no conventional-commit
 *         header, no `#N` ref and no breaking marker, so it contributes nothing to any field of
 *         the result — `computeBump()` with no arguments returns the identical object either way.
 *       · the `ticketLabels[ticket] ?? []` fallback for a ticket with no supplied labels. The
 *         sentinel is not `enhancement` or `bug`, so `labelRank` ranks it exactly as it ranks an
 *         empty label list: no opinion. Killing either would require asserting that a specific
 *         junk string is absent from an internal array, i.e. on non-behavior.
 *     The behavior these literals enable IS asserted (an empty range yields the no-release
 *     answer; a cited-but-unlabelled ticket degrades to the commit-prefix half and is reported
 *     in `unlabelledTickets`).
 *   - cli/args.ts: the `if (arity === undefined) return null` early return in
 *     `unexpectedPositional` (mutated to `if (false)`). Equivalent by ARITHMETIC: fall through and
 *     the very next line indexes `args.positional[1 + arity]` with `arity` undefined, i.e.
 *     `positional[NaN]`, which no array can hold — so `extra` is `undefined` and the following
 *     `if (extra === undefined) return null` returns the same `null` by the same path. The guard is
 *     kept because it states the rule (a verb absent from `VERB_ARITY` is simply not checked)
 *     rather than leaving it to an `NaN` index accident. The behavior IS asserted (an unknown verb
 *     is not policed; every known verb is).
 *   - cli/views.ts: the `{ x: 0, y: 0, z: 0 }` initializer in the private `keyFor` (mutated to
 *     `{}`). Equivalent by TOTALITY: `FRAME` maps every slice axis to the OTHER TWO as its row and
 *     column, so the three assignments that follow write all three axes on every call and no zero
 *     ever survives to be read. Killing it would require a frame whose three axes are not distinct,
 *     which `FRAME` does not contain. The axis wiring itself IS asserted — the three cuts of one
 *     asymmetric board are rendered in full and are required to differ.
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
    // Pure random-id helper (GitHub issue #6): the UUID-v4 derivation that works in an INSECURE
    // context (plain http on the LAN) where `crypto.randomUUID` is undefined and crashed boot. It
    // reads the `crypto` browser global (so it is NOT in `src/core`) but is otherwise pure logic —
    // the version/variant bit-forcing and the getRandomValues / Math.random fallback selection are
    // mutation-gated. Its insecure-context + fallback branches are fault-injected in its test.
    'src/util/**/*.ts',
    '!src/util/**/*.test.ts',
    'src/net/seats.ts',
    'src/net/sync.ts',
    // Pure admission + reconciliation (Task S.3, epic #35, closes #31): the reconciliation matrix
    // (0/1/2 concrete proposals; defer/new empties; same-uuid match vs divergent-headHash vs
    // different-uuid → typed reject) and the deterministic initiator election (earlier arrival, then
    // lower playerId). Order-insensitive, total, never-invents-a-game. Separated from the
    // NetSession.enter IO glue (S.5) so it is mutation-gated like the other pure net logic.
    'src/net/admission.ts',
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
    // Pure presence-liveness evaluator (Task 6.5, issue #5): folds retained/live/absent presence
    // signals into the set of peers that are actually live — a RETAINED-only presence never counts,
    // so a dead room shows no phantom opponent. Separated from the mqtt transport glue so it is
    // mutation-gated like the other pure net logic.
    'src/net/presence.ts',
    // Pure ask/accept handshake state machine (N.1, issues #12/#18): the action-agnostic
    // out-of-band pending-proposal machine — propose/receiveProposal(dedup)/respond/receiveResponse
    // (no double-resolve), cancel + auto-cancel (game-advanced / peer-gone), the at-most-one
    // supersede rule, and the pure selectors + `canPropose` guard. Held out-of-band, never touches
    // the move-log. Separated from the SyncEngine/session IO glue so it is mutation-gated like the
    // other pure net logic.
    'src/net/handshake.ts',
    // Pure networked end-state view-model + seat alternation (Task N.2.1, issue #12): folds the
    // authoritative GameState + the N.1 handshake + this client's seat into the end-state overlay
    // model (show/winner/winReason/iWon/resultText/rematchUi), and swaps white<->black for the next
    // game (a deterministic involution). REUSES the win detection (reads winner/winningLine) and the
    // N.1 handshake selectors — no duplicated state machine or win logic. Separated from the overlay
    // widget/session IO glue so it is mutation-gated like the other pure net logic.
    'src/net/endState.ts',
    // Pure networked mutual-confirm undo/redo logic (Task N.3.1, issue #18): the redo gate
    // (`decideRedo` — a redo re-applies the just-undone move, whose mover is the post-undo
    // `state.turn`), the single-pending propose guards (`canProposeUndo`/`canProposeRedo`,
    // combining the decide-rule with the N.1 no-concurrent-pending invariant), and the incoming
    // undo/redo accept/decline prompt view-model (`deriveUndoRedoPrompt`). REUSES `decideUndo`
    // (re-exported from sync.ts, not re-implemented), the N.1 `canPropose`/`incomingPending`
    // selectors, and the enumerated `Player` union for the prompt copy — no duplicated state
    // machine or rule. Separated from the SyncEngine/banner/session IO glue so it is mutation-
    // gated like the other pure net logic.
    'src/net/undoRedo.ts',
    // Pure #20 notify/reconnect decisions (Task N.5.1, issue #20): whether an adopted state change was
    // the OPPONENT's move that made it MY turn (`isRemoteMoveForMe` — the your-turn trigger), which
    // notification channels fire with what ENUMERATED copy (`deriveMoveNotification` — title-flash +
    // permission-gated browser notif + config sound, never opponent free text), and whether a
    // visibility/online edge on a dropped session should auto-reconnect (`shouldReconnect`). REUSES the
    // core `Player`/`GameState` + `NetPhase`/`NetSeat` types and the config-layer default (no magic
    // values). Separated from the session/document.title/Notification IO glue so it is mutation-gated
    // like the other pure net logic.
    'src/net/notify.ts',
    // Pure `activeNetworkedGame` BREADCRUMB store (Task V.1, epic #47 — the v3.1 net model): the
    // single-valued "I am currently mid-game in room X as game Y" session record over an INJECTED
    // `Storage` — read/write/clear with a shared validating canonicalizer (so the round-trip holds by
    // construction and a corrupt record degrades to null) plus the `updatedAt` staleness predicate.
    // It reads a DOM API (`localStorage`) so it is NOT `src/core`, but is otherwise pure logic, exactly
    // like `recentCodes.ts`. Separated from the `NetSession` IO glue that writes it, so it is
    // mutation-gated like the other pure net logic.
    'src/net/activeGame.ts',
    // Pure RESIDENT-PEER REPUBLISH decision (Task V.3, epic #47 — fixes #45): whether a peer's fresh
    // live presence should put our full authoritative log back on the wire, and the limiter that
    // makes repeats free without ever starving a genuine second return (a new head, the window
    // elapsing, or an observed absence each re-open a peer). No clock, no transport — the
    // observation time is an argument. Separated from the `MqttTransport`/`NetSession` glue that
    // supplies the signal and performs the publish, so it is mutation-gated like the other pure net
    // logic; that glue is proven by the mock-transport tests + `npm run scenario:issue45`.
    'src/net/republish.ts',
    // Pure v3.1 RECONCILIATION policy + its divergence renderer (Task V.4a, epic #47 — absorbs #38):
    // the narrow one-move fast-forward and its entitlement rule, the republish mirror, the
    // last-common-ancestor walk, the replay+hash-chain validation of any log offered for adoption,
    // and the player-readable diff the resolution handshake (V.4b) will show. No transport, DOM or
    // clock — the SyncEngine glue that consumes the decision is excluded exactly like the rest of
    // the IO boundary, and is covered by the mock-transport tests + `npm run scenario:issue45`.
    'src/net/reconcile.ts',
    'src/net/logDiff.ts',
    // Pure boot-ROOM-PROBE reading (Task V.5, epic #47, design §6): which game (if any) an overheard
    // room message names — a `sync`'s own uuid, a `hello`'s resume/current seed, and the honest `null`
    // for a seed that names none / protocol traffic / junk on the publicly-writable relay. A total
    // function from a wire record to a uuid, so it lives outside the `NetSession.probeRoom` IO glue
    // (transport + listening window) and is mutation-gated like the other pure net logic.
    'src/net/roomProbe.ts',
    // Pure v3.1 RESOLUTION vocabulary (Task V.4b, epic #47 — absorbs #38): how the two players NAME
    // the history they agree to continue from (`resolve:<headHash>` — absolute, so a responder can
    // neither invert it wrongly nor be pushed onto a history it does not hold), and what each side
    // must do locally to land on it. Strings and comparisons only; the SyncEngine apply half and the
    // session handshake glue are the excluded IO boundary, proven by the mock-transport tests and
    // `e2e/divergence.spec.ts`.
    'src/net/resolution.ts',
    '!src/net/**/*.test.ts',
    // Pure render resolvers only (THREE-free). (the net test-exclusion above covers notify.test.ts) The Three.js scene GLUE (`scene.ts`,
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
    // Pure recent-game-codes store (Task C.1, issue #13 picker "saved" list): record/list/clear the
    // codes used to host/join, backed by an INJECTED Storage (like config.ts) — dedupe, cap, newest-
    // first, and degrade-a-corrupt-record-to-empty. THREE-free / DOM-free — the DOM widget glue
    // (`widgets/net.ts`) is the Playwright-verified IO boundary, NOT mutated, exactly as above.
    'src/ui/widgets/recentCodes.ts',
    // Pure Network-Game-panel view-model (issue #13 / #16 combobox): the combobox state (typed text +
    // random placeholder + recent list) → the effective code (typed || placeholder), its
    // validation/canonicalization, Host/Join button enablement, and the recent-row helpers
    // (`deriveNetPanel` + the immutable mutations). THREE-free / DOM-free — the DOM/dispatch +
    // scope-push widget glue (`widgets/netPanel.ts`) is the Playwright-verified IO boundary, NOT
    // mutated, exactly as the net/recentCodes glue is above.
    'src/ui/widgets/netPanelModel.ts',
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
    // Pure DIVERGENCE-panel view-model (Task V.4b, epic #47): the open divergence + the N.1 handshake
    // → the one card a player meets the sync protocol through (offerable resolutions, what each keeps
    // and drops, and the choose/waiting/incoming/declined sub-state). THREE-free / DOM-free — the DOM
    // glue (`widgets/divergencePanel.ts`) is the Playwright-verified IO boundary, NOT mutated.
    'src/ui/widgets/divergenceModel.ts',
    // Pure REJOIN-PROMPT view-model (Task V.5, epic #47, design §6): the breadcrumb + a room PROBE →
    // the offer a player answers after an empty-slate reload (which of the three §6 outcomes, what YES
    // does, and whether a colour may be named at all). THREE-free / DOM-free — the DOM glue
    // (`widgets/rejoinPrompt.ts`) and the probe itself (`net/session.ts`) are the Playwright-verified
    // IO boundary, NOT mutated.
    'src/ui/widgets/rejoinPromptModel.ts',
    '!src/ui/**/*.test.ts',
    // Pure version-bump logic (issue #22): the commit-prefix + ticket-label signals → the
    // minor/patch/no-release decision, the disagreement report, and the semver arithmetic.
    // IO-free — the git/`gh` half (`tools/version.mjs`) and the filesystem-walking
    // `tools/generate-diagrams.mjs` are IO boundaries verified by RUNNING them against this
    // repo, NOT mutated, exactly as the scene/DOM glue is excluded above. Do NOT add them here.
    'tools/versionBump.mjs',
    '!tools/**/*.test.mjs',
    // The PURE units of the `cli/` net client (scope "planning docs src cli"). `planning/` and
    // `docs/` carry no `.ts`/`.mjs` at all — they are prose — so the executable half of that scope
    // is `src` + `cli`, and these four files are its THREE-free / DOM-free logic:
    //   · `args.ts`     — the `pente` command-line parse: verb/code/positionals/flags, the per-verb
    //                     arity refusal, and the `--seed` decision. Pure by construction (it takes
    //                     an argv array), which is why the silently-ignored-`enter <CODE> new`
    //                     regression is a unit test instead of a live-daemon probe.
    //   · `lastMove.ts` — the derived "which node did the last committed placement put down": the
    //                     single key present in one state and absent from the previous one. Reads
    //                     `Game`/`GameState` as types only.
    //   · `views.ts`    — the board VIEWS (`layers` / `layers-x` / `layers-y` / `list`) and the
    //                     status header: pure `(Snapshot) => string`. It renders the same pure
    //                     view-models the browser paints (`divergenceModel`, `endState`), so a
    //                     scenario script and a player read identical facts — which makes a wrong
    //                     glyph or a stale "last move" a test-integrity defect in the measuring
    //                     instrument, not cosmetics.
    //   · `relay.ts`    — which broker a node run talks to: `resolveRelay(relay.json, hostEnv())`
    //                     plus the board edge length. It reads the host ENVIRONMENT through the
    //                     `src/config/relayEnv.ts` seam (env as a value, never `process` directly),
    //                     so it qualifies exactly as `util/randomId.ts` and `net/activeGame.ts` do.
    // The CLI's IO GLUE is deliberately absent and must NOT be added: `main.ts` (argv + `console` +
    // `process.exit`), `daemon.ts`/`client.ts` (a unix socket over `node:net` + `node:fs`),
    // `netlink.ts` (the real mqtt.js socket), `session.ts` (NetSession + fake-indexeddb),
    // `scenarios/harness.ts` + `scenarios/all.ts` + `scenarios/*.scenario.ts` (they SPAWN daemons and
    // talk to the live relay — the CLI's e2e tier, the counterpart of `e2e/*.spec.ts`, proven by
    // `npm run scenario:all`).
    'cli/args.ts',
    'cli/lastMove.ts',
    'cli/views.ts',
    'cli/relay.ts',
    '!cli/**/*.test.ts',
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
