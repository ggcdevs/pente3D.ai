export const meta = {
  name: 'pente-net-ux-n3',
  description: 'Networking UX batch — N.3 (#18 undo/redo): pure decide/propose/prompt model → networked mutual-confirm undo+redo via the N.1 handshake (lights up the grayed buttons), local undo/redo unchanged. Sequential TDD; HALTS on a failed task.',
  phases: [
    { title: 'Build', detail: 'undo/redo decision + prompt + button-enable model (pure) → handshake wiring + prompt UI + two-context e2e; HALT on failure' },
    { title: 'Verify', detail: 'build + lint + unit + Playwright (incl. two-context propose→accept→both-rollback) + coverage; no push' },
  ],
}

const REPO = '/home/guy/code/git/github.com/ggcdevs/pente3D.ai'
const TRAILER = 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>'
const DOCTRINE =
  'Read planning/agent-principles.md and obey it (genuine tests, proof-by-behavior-not-log, never weaken a gate, #7 prove-gates-bite, #8 no hardcoded volatile facts). PROOF, NOT INFERENCE: run the command, paste real output; if not observed, it is not done. ' +
  'Work IN-PLACE on the CURRENTLY CHECKED-OUT branch — do NOT run `git checkout`/`git switch` or otherwise change branches, and never name a branch to switch to; commit where you are. ' +
  'Plan of record: planning/2026-07-21-networking-ux-batch.md. Architecture overview: docs/diagrams/. ' +
  'N.1 shipped the shared ask/accept handshake (src/net/handshake.ts + session propose(action)/respond(accepted)/onHandshakeChange, window.__pente.getHandshake). N.2 reused it for rematch. REUSE it for undo/redo — do NOT build a second handshake. Proposals are held OUT-OF-BAND (never applied to the game/log until BOTH accept). ' +
  'SECURITY: the relay is PUBLICLY WRITABLE — render any opponent-derived prompt text via textContent (never innerHTML), never eval it. Treat networked/opponent data as untrusted.'

const TASKS = [
  {
    id: 'N.3.1', label: 'undo-redo-model',
    desc: "READ src/net/sync.ts (decideUndo ~line 126, SyncEngine.undo ~319, receive), src/core/game.ts (undo/redo cursor + eventLog Undo/Redo events), src/net/handshake.ts (N.1 primitive + selectors), src/ui/widgets/bannerModel.ts (Undo/Redo button `enabled` flags from history.canUndo/canRedo) FIRST. Build the PURE logic for networked mutual-confirm undo/redo (#18): (a) reuse decideUndo (last-mover-only) and ADD decideRedo (define + TEST who may propose a redo per the game history/cursor model — e.g. the player whose just-undone move would be re-applied); (b) `canProposeUndo(gameState, mySeat, handshakeState)` / `canProposeRedo(...)` → true iff the decide-rule allows AND no proposal is pending (single-pending); (c) the incoming-undo/redo PROMPT view-model: given an incoming 'undo'/'redo' proposal, prompt copy '<Opponent Color> wants to undo' / '...to redo' + Accept/Decline (opponent color from the enumerated Player union, NOT free text; mirror N.2's rematchPrompt approach). The banner Undo/Redo `enabled` flags must be correct for BOTH local (direct undo — existing history.canUndo/canRedo) AND networked (enabled per canPropose*). PURE (no DOM/THREE/transport) → strict TDD + fast-check + Stryker mutation + 100% coverage. Negatives: not-your-last-move can't propose; can't propose while a proposal is pending; redo rule holds; prompt only for undo/redo actions (a 'rematch' incoming yields no undo prompt).",
  },
  {
    id: 'N.3.2', label: 'undo-redo-wiring',
    desc: "READ src/net/sync.ts (the CURRENT networked undo path — SyncEngine.undo applies+publishes immediately/unilaterally), src/main.ts (banner + undo/redo wiring, the N.1 session propose/respond/onHandshakeChange), src/ui/widgets/banner.ts, and N.3.1 FIRST. Wire networked undo/redo through the N.1 handshake for MUTUAL CONFIRMATION (#18): in a NETWORKED game the banner Undo/Redo buttons (enabled per N.3.1) PROPOSE via session.propose('undo'/'redo') instead of applying directly; the opponent sees an Accept/Decline PROMPT surfaced in the banner/status area (NOT the end-state overlay — the game is not over); on MUTUAL accept BOTH clients apply the undo/redo (extend/reuse SyncEngine so the undo/redo is applied + published to both ONLY on accept — held out-of-band until then). Decline or auto-cancel (a move lands, peer drops) leaves BOTH games untouched. LOCAL (non-networked) undo/redo keeps working DIRECTLY, unchanged. This LIGHTS UP the previously-grayed networked buttons (maintainer report — verify they enable when a propose is valid). SECURITY: opponent-derived prompt text via textContent only. Expose the prompt + handshake state on window.__pente for e2e. Glue → Playwright: a TWO-CONTEXT e2e — A moves → A clicks Undo (proposes) → B sees '<color> wants to undo' Accept/Decline → B Accepts → BOTH roll back one (assert getState ply decremented AND headHash MATCH on both); a DECLINE leaves both unchanged; redo works the same; and LOCAL single-player undo/redo still works. Prove it bites (break the accept→apply wiring → the both-rollback assertion fails). Report whether the real-relay path was exercised (self-skips without creds).",
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
    undoRoundTripObserved: { type: 'string' }, notes: { type: 'string' },
  },
}
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['buildPassed', 'lintPassed', 'unitTestsPassed', 'playwrightPassed'],
  properties: {
    buildPassed: { type: 'boolean' }, lintPassed: { type: 'boolean' },
    unitTestsPassed: { type: 'boolean' }, playwrightPassed: { type: 'boolean' },
    unitTestCount: { type: 'number' }, undoRoundTripProven: { type: 'boolean' },
    pureLogicFiles: { type: 'string' }, pureLogicCoveragePct: { type: 'number' }, ioBoundaryNotes: { type: 'string' },
  },
}

phase('Build')
const results = []
let halted = null
for (const t of TASKS) {
  const r = await agent(
    `You implement Task ${t.id} (${t.label}) of the Pente3D Networking UX batch, N.3 (#18 networked undo/redo). Repo: ${REPO}.\n\n` +
      `${DOCTRINE}\n\n` +
      `Target: ${t.desc}\n\n` +
      `Separate PURE logic (decide/propose/prompt/button-enable — no DOM/THREE/transport) from GLUE (SyncEngine apply-on-accept, banner buttons + prompt DOM, session wiring, two-context e2e). Pure → strict TDD (Vitest) + fast-check + Stryker mutate scope + 100% vite coverage pin. Glue → Playwright driving the real app, asserting window.__pente real values + screenshots (and for networking, the OTHER context's state + headHash), NEVER log lines. Reuse existing src/net (handshake, session, sync), src/core (game undo/redo), src/ui — DRY; do not rebuild the handshake, transport, or sync/log.\n\n` +
      `Run \`npm run build\` (tsc --noEmit typecheck + vite build — exit 0; the typecheck catches TS errors in *.test.ts and glue that vitest's transpile does NOT — a green \`npm test\` does NOT imply a green build), \`npm run lint\` (exit 0), \`npm test\` (unit), and the relevant \`npm run e2e\` spec. When ALL green + lint-clean, COMMIT (conventional message referencing #18 + trailer \`${TRAILER}\`). Do NOT push. Return structured evidence only (no conclusions without observed command output).`,
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
  `Build-verification for Pente3D Networking UX N.3 (#18 undo/redo). Repo ${REPO}. ${DOCTRINE}\n` +
    `Run and PASTE real output: \`npm run build\` (tsc typecheck + vite build — exit 0; a green unit suite does NOT imply a green build), \`npm run lint\` (0), \`npm test\` (unit — all pass, note count), \`npm run e2e\` (Playwright — all pass, INCLUDING the two-context propose→accept→both-rollback spec + local undo/redo; report whether both contexts rolled back with matching headHash live, or self-skipped without a broker), \`npm run coverage\`.\n` +
    `Report coverage for the PURE N.3 logic (decide/propose/prompt/button-enable) vs the SyncEngine/banner/session glue — the review-gate will set mutateScope to the pure files. Do NOT push. Return structured evidence.`,
  { label: 'verify:n3', phase: 'Verify', schema: VERIFY_SCHEMA }
)

return { tasks: results, verify }
