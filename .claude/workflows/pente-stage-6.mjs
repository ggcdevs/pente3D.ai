export const meta = {
  name: 'pente-stage-6',
  description: 'Stage 6 — networking integration + archive accumulation + game explorer; HALTS on a failed task',
  phases: [
    { title: 'Build', detail: 'wire net play end-to-end, game-lifecycle archiving, explorer, + permanent two-browser e2e; HALT on failure' },
    { title: 'Verify', detail: 'lint + unit + Playwright (incl. two-browser networked) + coverage; no push' },
  ],
}

const REPO = '/home/guy/code/git/github.com/ggcdevs/pente3D.ai'
const TRAILER = 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>'
const DOCTRINE =
  'Read planning/agent-principles.md and obey it (genuine tests, proof-by-behavior-not-log, never weaken a gate, #7 prove-gates-bite, #8 no hardcoded volatile facts). PROOF, NOT INFERENCE: run the command, paste real output; if not observed, it is not done.'

// Foundation first (6.1 wiring); each later task depends on it. Sequential; HALT on null.
const TASKS = [
  { id: '6.1', label: 'session-scene-wiring', desc: 'THE core fix (issue #4): make the scene render the SESSION game when networked — ONE authoritative game per session. Route local placements through session.place() (not the scene local game.place) when in a net game; adopt remote SyncEngine state back into the scene and re-render on every remote update. This single change also gives JOINER-INHERITS-BOARD and REFRESH-RESYNC (retained /state adoption lands in the rendered scene). Wire via NetHooks/setNetHooks (scene.ts) + main.ts; keep game logic in core/session. Verify with the window.__pente seams; a permanent two-browser test lands in 6.7.' },
  { id: '6.2', label: 'seat-turn-gate', desc: 'Block placement unless it is the local seat\'s turn in a networked game (issue #4c). PURE decision fn (e.g. canPlaceForSeat(state, seat)) -> unit+mutation. On an off-turn attempt, do NOT place and show a SUBTLE cue (e.g. a brief flash/pulse on the banner\'s "X to move"). Local (non-networked) games are unaffected. Glue verified by Playwright.' },
  { id: '6.3', label: 'game-lifecycle-archive', desc: 'Archive ACCUMULATION: today the autosave overwrites ONE stable id (main.ts) so past games are lost. Detect GAME BOUNDARIES (game-over, reset, and host/join-with-pieces) and at each: finalize the current record + mint a FRESH autosave id, so EVERY game is kept as its own archive record (local AND networked, including abandoned). PURE boundary/decision logic -> unit+mutation; the archive write is glue. Reuse src/persist/archive (saveGame). Result: the archive browser accumulates all games.' },
  { id: '6.4', label: 'host-join-playagain', desc: 'Host AND Join (same logic): if a piece has been played locally, archive+reset the current game (via 6.3) before starting; if the board is empty, just start (nothing to archive). When a NETWORKED game ENDS (winner set), prompt "play another?" and start a fresh net game on accept. Glue + Playwright; reuse 6.3 boundary logic.' },
  { id: '6.5', label: 'presence-hardening', desc: 'Fix issue #5: a bogus/dead room must NOT show a phantom "opponent connected". Do not treat a RETAINED presence message as a live peer — require a fresh presence/handshake (or heartbeat with expiry); clear presence on graceful leave; reconnect the net session on page refresh. Verify: joining a nonexistent code shows NO opponent; a real two-peer room does. PURE presence-evaluation logic where possible -> unit+mutation; transport glue via tests.' },
  { id: '6.6', label: 'explorer-review-resume', desc: 'Enhance the archive browser (src/ui/widgets/archive*) to distinguish REVIEW vs RESUME. Review = load into the scene read-only (browse via the history slider). Resume = load into the scene and continue playing (local); to continue a networked game, the user Hosts from that resumed board (reuses 6.4\'s piece-already-on-board path). Works for local AND abandoned networked games. PURE model additions -> unit+mutation; DOM glue via Playwright + screenshots.' },
  { id: '6.7', label: 'two-browser-e2e', desc: 'Add a PERMANENT Playwright spec (e2e/networked.spec.ts) driving TWO ISOLATED browser CONTEXTS (distinct playerId/seats) against the app + LIVE relay: host+join, seat assignment, a move on A appears on B (assert both getState + headHash MATCH), turn-gate rejects an off-turn move, a late joiner inherits the board. This is the cross-component integration test whose absence let #4 hide — it must FAIL if the 6.1 wiring is removed (prove it). Use per-context isolation; unique room per run; clean up.' },
]

const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['module', 'completed', 'unitTestsPassing', 'playwrightPassing', 'lintPassing', 'committed'],
  properties: {
    module: { type: 'string' }, completed: { type: 'boolean' },
    unitTestsPassing: { type: 'boolean' }, playwrightPassing: { type: 'boolean' },
    lintPassing: { type: 'boolean' }, committed: { type: 'boolean' },
    commitSha: { type: 'string' }, windowPenteAdded: { type: 'string' }, notes: { type: 'string' },
  },
}
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['lintPassed', 'unitTestsPassed', 'playwrightPassed'],
  properties: {
    lintPassed: { type: 'boolean' }, unitTestsPassed: { type: 'boolean' },
    playwrightPassed: { type: 'boolean' }, unitTestCount: { type: 'number' },
    twoBrowserSyncProven: { type: 'boolean' }, pureLogicFiles: { type: 'string' },
    pureLogicCoveragePct: { type: 'number' }, ioBoundaryNotes: { type: 'string' },
  },
}

phase('Build')
const results = []
let halted = null
for (const t of TASKS) {
  const r = await agent(
    `You implement Task ${t.id} (${t.label}) of the Pente3D build (Stage 6 — networking integration + archive). Repo: ${REPO}, branch render-instanced (work in-place).\n\n` +
      `${DOCTRINE}\n\n` +
      `Target: ${t.desc}\n\n` +
      `Context: GitHub issues #4 (net wiring gap) and #5 (phantom presence) describe the bugs; the two-browser test in this session's history documents current behavior. Reuse existing src/core, src/net (SyncEngine/seats/transport — they WORK in isolation, see sync.realrelay.test.ts), src/persist/archive, src/config, src/render (window.__pente + scene NetHooks), src/ui — DRY. Do NOT rebuild the engine; this is the WIRING/integration.\n\n` +
      `1. READ the relevant existing code first (src/render/scene.ts setNetHooks + syncBoard + place path, src/main.ts net + autosave wiring, src/net/session.ts, src/ui/widgets/net.ts + archive*). Separate PURE logic (decisions: turn-eligibility, game-boundary detection, presence-liveness, review-vs-resume) from glue; pure -> strict TDD (Vitest) + stryker mutate scope + 100% vite coverage pin; glue -> Playwright against window.__pente (extend inspectors as needed).\n` +
      `2. Run \`npm run lint\` (0), \`npm test\` (unit), the relevant \`npm run e2e\` spec. When green + lint-clean, COMMIT (conventional msg referencing the issue + trailer \`${TRAILER}\`). Do NOT push.\n\n` +
      `Return structured evidence: module, unit + Playwright pass, lint, committed + SHA, window.__pente additions, and (6.1/6.7) whether two-context move-sync + headHash-match was observed. Evidence only.`,
    { label: `build:${t.id}-${t.label}`, phase: 'Build', schema: BUILD_SCHEMA }
  )
  results.push({ id: t.id, r })
  if (!r) {
    halted = t.id
    log(`HALT: Task ${t.id} (${t.label}) returned null (failed) — stopping so dependents aren't built on a gap. Re-run this task, then resume.`)
    break
  }
  log(`Task ${t.id} (${t.label}): unit=${r.unitTestsPassing} pw=${r.playwrightPassing} lint=${r.lintPassing} committed=${r.committed} ${r.commitSha || ''}`)
}

if (halted) {
  return { halted, completed: results.filter((x) => x.r).map((x) => x.id), note: `Build halted at ${halted}; verify skipped. Fix the failed task and resume.` }
}

phase('Verify')
const verify = await agent(
  `Build-verification for Pente3D Stage 6 (networking integration + archive). Repo ${REPO}. ${DOCTRINE}\n` +
    `Run and PASTE: \`npm run lint\` (0), \`npm test\` (unit — all pass, note count), \`npm run e2e\` (Playwright — all pass, INCLUDING the new two-browser networked spec; report whether A/B move-sync + headHash-match was observed live), \`npm run coverage\`.\n` +
    `Report coverage for the PURE Stage-6 logic (turn-gate, game-boundary, presence, review/resume) vs glue. Pure logic 100%; list DOM/net glue verified by Playwright — the review-gate sets mutateScope to the pure files. Do NOT push. Return structured evidence.`,
  { label: 'verify:stage-6', phase: 'Verify', schema: VERIFY_SCHEMA }
)

return { tasks: results, verify }
