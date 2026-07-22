export const meta = {
  name: 'pente-net-ux-n45',
  description: 'Networking UX batch — N.4 (#17 history slider stays local: prove 0 network publishes on scrub + lock) and N.5 (#20 reconnect on background/return + move notifications: title-flash + browser Notification). Sequential TDD; HALTS on a failed task.',
  phases: [
    { title: 'Build', detail: 'history-local lock (glue) → notify/reconnect decision model (pure) → reconnect + notifications glue; HALT on failure' },
    { title: 'Verify', detail: 'build + lint + unit + Playwright (incl. scrub-publishes-nothing + reconnect + title-flash) + coverage; no push' },
  ],
}

const REPO = '/home/guy/code/git/github.com/ggcdevs/pente3D.ai'
const TRAILER = 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>'
const DOCTRINE =
  'Read planning/agent-principles.md and obey it (genuine tests, proof-by-behavior-not-log, never weaken a gate, #7 prove-gates-bite, #8 no hardcoded volatile facts). PROOF, NOT INFERENCE: run the command, paste real output; if not observed, it is not done. ' +
  'Work IN-PLACE on the CURRENTLY CHECKED-OUT branch — do NOT run `git checkout`/`git switch` or otherwise change branches, and never name a branch to switch to; commit where you are. ' +
  'Plan of record: planning/2026-07-21-networking-ux-batch.md. Networking design: planning/2026-07-18-networking-poc-design.md. Architecture overview: docs/diagrams/. ' +
  'DECISIONS (maintainer, locked): #20 move notifications = tab-title flash + browser Notification API (opt-in permission); the score banner KEEPS showing whose turn it is with NO pulse; reconnect automatically on background→return. All config-driven (tracked JSON defaults + localStorage override; no magic values). Everything local; no new infra. ' +
  'SECURITY: notification/reconnect data derives from local state + the enumerated Player union; render via textContent, never innerHTML; treat any networked data as untrusted.'

const TASKS = [
  {
    id: 'N.4.1', label: 'history-slider-local-lock',
    desc: "READ src/ui/widgets/historySlider.ts + sliderModel.ts, src/render/scene.ts (scrubTo ~1179, renderState, the HistoryReadout maxPly-vs-viewedPly), src/net/transport.ts + the mock transport used in e2e FIRST. The history slider is ALREADY purely local (scrubTo is a read-only render seam; no place/undo/redo dispatch). This task is VERIFY-AND-LOCK for #17: add a PERMANENT Playwright test proving that scrubbing the slider in a NETWORKED game issues **ZERO transport publishes** — e.g. in a two-context (or single-context with a message-counting mock transport) networked game, record the transport publish/message count, scrub the slider fully back and forth several times, and assert the publish count is UNCHANGED (and the peer's state/headHash is unaffected), while the local viewedPly changes and maxPly stays at the head. Add a small structural guard/comment so a future change that makes scrubTo publish would fail this test. If a publish-count seam is needed, expose it minimally on window.__pente or reuse the mock transport's message log. Glue → Playwright. Prove it BITES: temporarily make scrubTo publish something → the test fails; restore.",
  },
  {
    id: 'N.5.1', label: 'notify-reconnect-model',
    desc: "Build the PURE decision logic for #20 (no DOM/THREE/transport). READ src/net/session.ts (onChange / state-change, phase, seat/turn), src/core/gameState.ts (turn/winner) FIRST. (a) `isRemoteMoveForMe(prev, next, mySeat)` (or similar): true when the state change was an OPPONENT's move (the move-log grew and the mover was NOT me) that makes it MY turn — the trigger for a 'your turn' notification; false for my own move, non-move changes, or when it's not my turn. (b) the notification CONTENT model: given the trigger, the copy ('Your turn' / a title-flash string like '(!) Your turn — Pente') from enumerated state, never opponent free text. (c) `shouldReconnect(phase, visibility, online)`: true when the session is offline/dropped AND the tab just became visible or came back online — the reconnect trigger. Keep it all PURE + config-shaped (a `notifications` config: { titleFlash, browserNotification, sound } defaults — titleFlash on, browserNotification on-but-gated-by-permission, sound off; NO banner pulse). Strict TDD + fast-check + Stryker mutation + 100% coverage. Negatives: my own move does NOT notify; a remote move when it's still the opponent's turn (e.g. a capture chain) — define + test; no reconnect when already connected.",
  },
  {
    id: 'N.5.2', label: 'reconnect-notify-glue',
    desc: "READ src/net/session.ts + appSession.ts + presence.ts (connect/disconnect/resync, sticky playerId seat reclaim), src/main.ts (the onStateChange/onHandshakeChange wiring), src/ui/widgets/banner.ts, and N.5.1 FIRST. Wire #20 glue: (1) RECONNECT — add `visibilitychange`→visible and `window` `online` listeners (in appSession/session or main) that, when `shouldReconnect` (N.5.1) holds, re-establish the session (re-join the SAME code, reclaiming the sticky playerId seat — reuse existing connect/resync; do NOT rebuild transport). (2) MOVE NOTIFICATIONS — on a state change where `isRemoteMoveForMe` (N.5.1) holds, fire the enabled channels: **tab-title flash** (mutate `document.title` to the notify string while the tab is HIDDEN; restore the original title on focus/visibility), and **browser Notification** (request permission once on first opt-in; only fire when the tab is hidden and permission granted). Config-driven via the `notifications` config; the banner still shows whose turn it is (unchanged, NO pulse). SECURITY: notify text via textContent / the Notification title string from enumerated state only. Expose enough on window.__pente for e2e (e.g. a title readout, a notify-fired counter, and a way to simulate hidden/visible + a Notification spy). Glue → Playwright: assert (a) a remote move while the tab is 'hidden' flashes the title to the notify string and restores it on visible; (b) my own move does NOT; (c) a browser Notification is requested/fired via a spy (mock window.Notification) only when hidden+permitted; (d) reconnect: simulate offline→visible/online and assert the session resyncs (phase returns to connected, same seat). Prove the notify path bites (disable the flag → no title flash). Report if the real-relay path was exercised.",
  },
]

const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['module', 'completed', 'unitTestsPassing', 'playwrightPassing', 'lintPassing', 'buildPassing', 'committed'],
  properties: {
    module: { type: 'string' }, completed: { type: 'boolean' },
    unitTestsPassing: { type: 'boolean' }, playwrightPassing: { type: 'boolean' },
    lintPassing: { type: 'boolean' }, buildPassing: { type: 'boolean' }, committed: { type: 'boolean' },
    commitSha: { type: 'string' }, windowPenteAdded: { type: 'string' },
    observed: { type: 'string' }, notes: { type: 'string' },
  },
}
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['buildPassed', 'lintPassed', 'unitTestsPassed', 'playwrightPassed'],
  properties: {
    buildPassed: { type: 'boolean' }, lintPassed: { type: 'boolean' },
    unitTestsPassed: { type: 'boolean' }, playwrightPassed: { type: 'boolean' },
    unitTestCount: { type: 'number' }, scrubPublishesNothingProven: { type: 'boolean' }, reconnectNotifyProven: { type: 'boolean' },
    pureLogicFiles: { type: 'string' }, pureLogicCoveragePct: { type: 'number' }, ioBoundaryNotes: { type: 'string' },
  },
}

phase('Build')
const results = []
let halted = null
for (const t of TASKS) {
  const r = await agent(
    `You implement Task ${t.id} (${t.label}) of the Pente3D Networking UX batch, N.4/N.5 (#17 history-local + #20 reconnect/notifications). Repo: ${REPO}.\n\n` +
      `${DOCTRINE}\n\n` +
      `Target: ${t.desc}\n\n` +
      `Separate PURE logic (notify/reconnect decisions — no DOM/THREE/transport) from GLUE (listeners, document.title, Notification API, session resync, e2e). Pure → strict TDD (Vitest) + fast-check + Stryker mutate scope + 100% vite coverage pin. Glue → Playwright driving the real app, asserting window.__pente real values + screenshots, NEVER log lines. Reuse existing src/net (session, appSession, presence, transport), src/ui, src/config — DRY; do not rebuild the transport/session.\n\n` +
      `Run \`npm run build\` (tsc --noEmit typecheck + vite build — exit 0; the typecheck catches TS errors in *.test.ts and glue that vitest's transpile does NOT — a green \`npm test\` does NOT imply a green build), \`npm run lint\` (exit 0), \`npm test\` (unit), and the relevant \`npm run e2e\` spec. When ALL green + lint-clean, COMMIT (conventional message referencing #17/#20 + trailer \`${TRAILER}\`). Do NOT push. Return structured evidence only (no conclusions without observed command output).`,
    { label: `build:${t.id}-${t.label}`, phase: 'Build', schema: BUILD_SCHEMA }
  )
  results.push({ id: t.id, r })
  if (!r) {
    halted = t.id
    log(`HALT: Task ${t.id} (${t.label}) returned null (failed) — stopping so dependents aren't built on a gap. Re-run this task, then resume.`)
    break
  }
  log(`Task ${t.id} (${t.label}): build=${r.buildPassing} unit=${r.unitTestsPassing} pw=${r.playwrightPassing} lint=${r.lintPassing} committed=${r.committed} ${r.commitSha || ''}`)
}

if (halted) {
  return { halted, completed: results.filter((x) => x.r).map((x) => x.id), note: `Build halted at ${halted}; verify skipped. Fix the failed task and resume.` }
}

phase('Verify')
const verify = await agent(
  `Build-verification for Pente3D Networking UX N.4/N.5 (#17 history-local + #20 reconnect/notifications). Repo ${REPO}. ${DOCTRINE}\n` +
    `Run and PASTE real output: \`npm run build\` (tsc typecheck + vite build — exit 0; a green unit suite does NOT imply a green build), \`npm run lint\` (0), \`npm test\` (unit — all pass, note count), \`npm run e2e\` (Playwright — all pass, INCLUDING scrub-publishes-nothing (#17) + the reconnect + title-flash/notification specs (#20)), \`npm run coverage\`.\n` +
    `Report coverage for the PURE N.5 logic (notify/reconnect decisions) vs the listener/DOM/Notification glue — the review-gate will set mutateScope to the pure files. Do NOT push. Return structured evidence.`,
  { label: 'verify:n45', phase: 'Verify', schema: VERIFY_SCHEMA }
)

return { tasks: results, verify }
