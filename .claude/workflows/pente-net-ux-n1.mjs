export const meta = {
  name: 'pente-net-ux-n1',
  description: 'Networking UX batch — N.1 the shared ask/accept handshake primitive: message tagged-union → pure pending-proposal state machine → engine wiring + two-context round-trip. Sequential TDD; HALTS on a failed task.',
  phases: [
    { title: 'Build', detail: 'message union (pure) → handshake state machine (pure) → engine wiring + two-context proof; HALT on failure' },
    { title: 'Verify', detail: 'build + lint + unit + Playwright (incl. two-context proposal round-trip) + coverage; no push' },
  ],
}

const REPO = '/home/guy/code/git/github.com/ggcdevs/pente3D.ai'
const TRAILER = 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>'
const DOCTRINE =
  'Read planning/agent-principles.md and obey it (genuine tests, proof-by-behavior-not-log, never weaken a gate, #7 prove-gates-bite, #8 no hardcoded volatile facts). PROOF, NOT INFERENCE: run the command, paste real output; if not observed, it is not done. ' +
  'Work IN-PLACE on the CURRENTLY CHECKED-OUT branch — do NOT run `git checkout`/`git switch` or otherwise change branches, and never name a branch to switch to; commit where you are. ' +
  'Plan of record: planning/2026-07-21-networking-ux-batch.md. Networking design: planning/2026-07-18-networking-poc-design.md (append-only log, Transport, sticky playerId seats, LWT presence). Architecture overview: docs/diagrams/. ' +
  'GUARDRAILS (from the net-layer map): proposals are held OUT-OF-BAND (never appended to the move-log; a rejected proposal must leave no trace); published NON-RETAINED + carry a UNIQUE id (dedup on receive) so a reconnect never replays a stale proposal; AUTO-CANCEL a pending proposal when the game advances or the proposer/peer drops. Do NOT change the Transport or the sync/log model — only add message kinds + handshake state on top.'

const TASKS = [
  {
    id: 'N.1.1', label: 'message-tagged-union',
    desc: "READ src/net/sync.ts FIRST (the SyncMessage shape ~line 60, toSyncMessage ~138, receive ~362, the transport message pump ~386). Widen the networked message format into a DISCRIMINATED UNION: `GameMessage = { kind: 'sync', ...the existing sync fields } | { kind: 'proposal', id: string, action: string, proposedBy: <player/seat> } | { kind: 'response', proposalId: string, accepted: boolean }`. Add a PURE `parseGameMessage(msg: unknown): GameMessage` that discriminates on `kind` and validates EACH shape, REJECTING malformed / unknown-kind / missing-field messages (throw the existing SyncError style — test the negatives explicitly). Existing sync traffic must round-trip unchanged: `toSyncMessage` wraps with `kind: 'sync'`; the pump calls `parseGameMessage` instead of casting. Decide + TEST backward-compat if an un-kinded legacy sync message can still arrive (treat as 'sync' or reject — pick and justify). The `proposal.action` is an OPAQUE tag (e.g. 'rematch' | 'undo' | 'redo') the consumers (#12/#18) fill — this task is action-agnostic. PURE → strict TDD (Vitest) + fast-check + Stryker mutation + 100% coverage. Do NOT touch the Transport.",
  },
  {
    id: 'N.1.2', label: 'handshake-state-machine',
    desc: "Build the PURE, action-agnostic pending-proposal state machine — the shared ask/accept primitive #12 and #18 BOTH reuse. Immutable transitions over a handshake state: `propose(action, myId)` → an OUTGOING pending proposal with a UNIQUE id; `receiveProposal(p)` → an INCOMING pending, DEDUPED by id (a repeat id is an idempotent no-op); `respond(proposalId, accepted)` + `receiveResponse(r)` → resolve to accepted/declined (no double-resolve); `cancel()` and auto-cancel signals (game-advanced, peer-gone) clear a pending proposal. At most ONE pending at a time — a new proposal supersedes per a documented, tested rule. This module holds proposals OUT-OF-BAND and NEVER appends to the move-log. Expose pure selectors (outgoingPending?, incomingPending?, resolution) and a `canPropose(...)` predicate shape that consumers specialize. Strict TDD + fast-check (id uniqueness, dedup idempotence, no-double-resolve, auto-cancel clears) + mutation + 100% coverage. No DOM/THREE/transport imports.",
  },
  {
    id: 'N.1.3', label: 'engine-wiring',
    desc: "Wire N.1.1 (message union) + N.1.2 (state machine) into the live net path (glue). READ src/net/sync.ts (receive/pump) + session.ts FIRST. In `receive`, discriminate via parseGameMessage: 'sync' → the existing path unchanged; 'proposal'/'response' → drive the state machine. Add a consumer API on the session/engine: `propose(action)` (publishes a NON-RETAINED proposal + sets outgoing pending), `respond(accepted)` (publishes a response), `onHandshakeChange(cb)` for the UI. AUTO-CANCEL a pending proposal when the authoritative game advances (hook the existing engine onChange) or a peer drops (presence). Proposals must NOT enter the retained /state snapshot (out-of-band), so a reconnect never replays one; the unique-id dedup covers at-least-once/edge cases. Expose `window.__pente.getHandshake()` (+ propose/respond drivers if needed) for e2e. Glue → Playwright: a TWO-CONTEXT test (two isolated contexts) where A `propose('test')` → B observes the incoming proposal via getHandshake → B `respond(true)` → A observes 'accepted'; assert on real state, not logs. It must FAIL if the routing is broken (prove it bites). Report whether the real-relay path was exercised (self-skips without creds). Do NOT reimplement the transport or the sync/log.",
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
    handshakeRoundTripObserved: { type: 'string' }, notes: { type: 'string' },
  },
}
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['buildPassed', 'lintPassed', 'unitTestsPassed', 'playwrightPassed'],
  properties: {
    buildPassed: { type: 'boolean' }, lintPassed: { type: 'boolean' },
    unitTestsPassed: { type: 'boolean' }, playwrightPassed: { type: 'boolean' },
    unitTestCount: { type: 'number' }, roundTripProven: { type: 'boolean' },
    pureLogicFiles: { type: 'string' }, pureLogicCoveragePct: { type: 'number' }, ioBoundaryNotes: { type: 'string' },
  },
}

phase('Build')
const results = []
let halted = null
for (const t of TASKS) {
  const r = await agent(
    `You implement Task ${t.id} (${t.label}) of the Pente3D Networking UX batch, N.1 (the shared ask/accept handshake primitive). Repo: ${REPO}.\n\n` +
      `${DOCTRINE}\n\n` +
      `Target: ${t.desc}\n\n` +
      `Separate PURE logic (message parsing, the handshake state machine — no DOM/THREE/transport) from GLUE (SyncEngine/session wiring, two-context e2e). Pure → strict TDD (Vitest) + fast-check + Stryker mutate scope + 100% vite coverage pin. Glue → Playwright driving the real app, asserting window.__pente real values + screenshots (and for networking, the OTHER context actually receiving over the relay), NEVER log lines. Reuse existing src/net (Transport, SyncEngine, session, presence) — DRY; do not rebuild the transport or the sync/log.\n\n` +
      `Run \`npm run build\` (tsc --noEmit typecheck + vite build — exit 0; the typecheck catches TS errors in *.test.ts and glue that vitest's transpile does NOT — a green \`npm test\` does NOT imply a green build), \`npm run lint\` (exit 0), \`npm test\` (unit), and the relevant \`npm run e2e\` spec. When ALL green + lint-clean, COMMIT (conventional message referencing #12/#18 + trailer \`${TRAILER}\`). Do NOT push. Return structured evidence only (no conclusions without observed command output).`,
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
  `Build-verification for Pente3D Networking UX N.1 (handshake primitive). Repo ${REPO}. ${DOCTRINE}\n` +
    `Run and PASTE real output: \`npm run build\` (tsc typecheck + vite build — exit 0; a green unit suite does NOT imply a green build), \`npm run lint\` (0), \`npm test\` (unit — all pass, note count), \`npm run e2e\` (Playwright — all pass, INCLUDING the two-context proposal round-trip; report whether A→B proposal + B→A response was observed, or self-skipped without a broker), \`npm run coverage\`.\n` +
    `Report coverage for the PURE N.1 logic (message union parse, handshake state machine) vs the SyncEngine/session glue — the review-gate will set mutateScope to the pure files. Do NOT push. Return structured evidence.`,
  { label: 'verify:n1', phase: 'Verify', schema: VERIFY_SCHEMA }
)

return { tasks: results, verify }
