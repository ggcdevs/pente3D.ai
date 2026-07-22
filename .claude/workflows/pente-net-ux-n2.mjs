export const meta = {
  name: 'pente-net-ux-n2',
  description: 'Networking UX batch — N.2 (#12 win/rematch): pure end-state + rematch + color-alternation model → non-blocking end-state overlay replacing window.confirm + mutual rematch via the N.1 handshake. Sequential TDD; HALTS on a failed task.',
  phases: [
    { title: 'Build', detail: 'end-state/rematch/alternate model (pure) → overlay widget + mutual-rematch wiring + two-context e2e; HALT on failure' },
    { title: 'Verify', detail: 'build + lint + unit + Playwright (incl. two-context win→rematch→swapped-colors) + coverage; no push' },
  ],
}

const REPO = '/home/guy/code/git/github.com/ggcdevs/pente3D.ai'
const TRAILER = 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>'
const DOCTRINE =
  'Read planning/agent-principles.md and obey it (genuine tests, proof-by-behavior-not-log, never weaken a gate, #7 prove-gates-bite, #8 no hardcoded volatile facts). PROOF, NOT INFERENCE: run the command, paste real output; if not observed, it is not done. ' +
  'Work IN-PLACE on the CURRENTLY CHECKED-OUT branch — do NOT run `git checkout`/`git switch` or otherwise change branches, and never name a branch to switch to; commit where you are. ' +
  'Plan of record: planning/2026-07-21-networking-ux-batch.md. Architecture overview: docs/diagrams/. ' +
  'N.1 already shipped the shared ask/accept handshake: src/net/handshake.ts (pure state machine) wired into the session (propose(action)/respond(accepted)/onHandshakeChange, window.__pente.getHandshake). REUSE it — do NOT build a second handshake. ' +
  'SECURITY (non-negotiable): the relay is PUBLICLY WRITABLE (shared creds), so proposal/message data is ATTACKER-CONTROLLABLE. Render any opponent-derived text via textContent (never innerHTML), never eval it, never feed it anywhere privileged. Treat all networked/opponent data as untrusted input.'

const TASKS = [
  {
    id: 'N.2.1', label: 'endstate-rematch-model',
    desc: "READ src/net/rematch.ts (shouldPromptRematch / shouldArchiveBeforeNetStart), src/net/seats.ts (claimSeat + white/black assignment), src/net/handshake.ts (the N.1 primitive + selectors), src/core/gameState.ts (winner + win reason) FIRST. Build the PURE view-model + logic for the networked end-state and mutual rematch (#12): (a) `deriveEndState(gameState, handshakeState, mySeat)` → { show (true only when a networked game is over — winner !== null), resultText (who won + HOW: 5-in-a-row line vs 5 capture-pairs — read the real win reason, no magic strings), rematchUi } where rematchUi is derived from the handshake: 'idle' | 'proposed-waiting' (I proposed) | 'incoming' (opponent proposed → Accept/Decline) | 'accepted' | 'declined'; (b) `alternateSeats(seatMap)` → swap white<->black for the next game (deterministic, identity-owned) — ALTERNATE REGARDLESS of who won (maintainer decision). REUSE the handshake selectors; do NOT duplicate the state machine or the win logic. PURE (no DOM/THREE/transport) → strict TDD + fast-check + Stryker mutation + 100% coverage. Negative/edge cases: no overlay before game-over; no overlay in a LOCAL game (scope is networked); alternateSeats is an involution (applied twice === original); rematchUi maps each handshake state correctly incl. no-double-accept.",
  },
  {
    id: 'N.2.2', label: 'endstate-overlay-and-wiring',
    desc: "READ src/main.ts (the blocking `window.confirm` rematch prompt ~line 45, startFreshNetGame ~440-478, maybePromptRematch ~485), the N.1 session handshake API (propose/respond/onHandshakeChange), src/ui (widget/overlay patterns), and N.2.1 FIRST. Build a NON-BLOCKING, view-only END-STATE overlay widget driven by N.2.1's deriveEndState: when a networked game ends it shows the result OVER the read-only board (the board STAYS VISIBLE — no blocking backdrop that hides it), with a REMATCH button and the handshake states (waiting-for-opponent; opponent-wants-a-rematch → Accept / Decline). REMOVE the blocking `window.confirm` at main.ts:45. Wire: Rematch → session.propose('rematch'); an incoming rematch proposal → surface Accept/Decline; on MUTUAL accept → reset BOTH clients to a FRESH game in the SAME room/connection with **alternated colors** (N.2.1's alternateSeats; reuse the existing fresh-game reset but KEEP the connection and SWAP seats — do not disconnect/re-host if avoidable). SECURITY: render opponent-derived text via textContent only. Expose overlay + rematch state on window.__pente for e2e. Glue → Playwright: a TWO-CONTEXT e2e — play A to a win → BOTH contexts show the view-only end-state with the board still visible → A clicks Rematch (proposes) → B Accepts → BOTH get a fresh EMPTY game, still connected, with seats SWAPPED (assert via window.__pente getState + getNet/seat). Prove it bites (break the accept→reset wiring → the swapped-fresh-game assertion fails). Report whether the real-relay path was exercised (self-skips without creds).",
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
    rematchSwapObserved: { type: 'string' }, notes: { type: 'string' },
  },
}
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['buildPassed', 'lintPassed', 'unitTestsPassed', 'playwrightPassed'],
  properties: {
    buildPassed: { type: 'boolean' }, lintPassed: { type: 'boolean' },
    unitTestsPassed: { type: 'boolean' }, playwrightPassed: { type: 'boolean' },
    unitTestCount: { type: 'number' }, rematchRoundTripProven: { type: 'boolean' },
    pureLogicFiles: { type: 'string' }, pureLogicCoveragePct: { type: 'number' }, ioBoundaryNotes: { type: 'string' },
  },
}

phase('Build')
const results = []
let halted = null
for (const t of TASKS) {
  const r = await agent(
    `You implement Task ${t.id} (${t.label}) of the Pente3D Networking UX batch, N.2 (#12 win/rematch flow). Repo: ${REPO}.\n\n` +
      `${DOCTRINE}\n\n` +
      `Target: ${t.desc}\n\n` +
      `Separate PURE logic (end-state/rematch view-model, seat alternation — no DOM/THREE/transport) from GLUE (overlay widget DOM, session wiring, two-context e2e). Pure → strict TDD (Vitest) + fast-check + Stryker mutate scope + 100% vite coverage pin. Glue → Playwright driving the real app, asserting window.__pente real values + screenshots (and for networking, the OTHER context's state), NEVER log lines. Reuse existing src/net (handshake, session, seats, rematch), src/core, src/ui — DRY; do not rebuild the handshake, transport, or sync/log.\n\n` +
      `Run \`npm run build\` (tsc --noEmit typecheck + vite build — exit 0; the typecheck catches TS errors in *.test.ts and glue that vitest's transpile does NOT — a green \`npm test\` does NOT imply a green build), \`npm run lint\` (exit 0), \`npm test\` (unit), and the relevant \`npm run e2e\` spec. When ALL green + lint-clean, COMMIT (conventional message referencing #12 + trailer \`${TRAILER}\`). Do NOT push. Return structured evidence only (no conclusions without observed command output).`,
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
  `Build-verification for Pente3D Networking UX N.2 (#12 win/rematch). Repo ${REPO}. ${DOCTRINE}\n` +
    `Run and PASTE real output: \`npm run build\` (tsc typecheck + vite build — exit 0; a green unit suite does NOT imply a green build), \`npm run lint\` (0), \`npm test\` (unit — all pass, note count), \`npm run e2e\` (Playwright — all pass, INCLUDING the two-context win→rematch→swapped-colors spec; report whether both contexts reached a fresh swapped game live, or self-skipped without a broker), \`npm run coverage\`.\n` +
    `Report coverage for the PURE N.2 logic (end-state/rematch view-model, seat alternation) vs the overlay/session glue — the review-gate will set mutateScope to the pure files. Do NOT push. Return structured evidence.`,
  { label: 'verify:n2', phase: 'Verify', schema: VERIFY_SCHEMA }
)

return { tasks: results, verify }
