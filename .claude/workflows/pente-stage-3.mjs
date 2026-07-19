export const meta = {
  name: 'pente-stage-3',
  description: 'Build Stage 3 networking integration (Transport, seats, full-state sync, restricted undo) with real-relay tests',
  phases: [
    { title: 'Build', detail: 'TDD each networking module in dependency order; commit when green' },
    { title: 'Verify', detail: 'lint + full suite (incl. real-relay integration) + coverage report; no push' },
  ],
}

const REPO = '/home/guy/code/git/github.com/ggcdevs/pente3D.ai'
const TRAILER = 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>'
const DOCTRINE =
  'Read planning/agent-principles.md and obey it as hard constraints (genuine tests, proof-by-behavior-not-log, never weaken a gate, #7 prove-gates-bite). PROOF, NOT INFERENCE: run the command, paste real output; if not observed, it is not done.'

const TASKS = [
  { id: '3.1', label: 'transport', desc: 'Transport interface (src/net/transport.ts) + MqttTransport (src/net/mqttTransport.ts) porting poc/transport.js, typed. connect(roomCode, opts?) with a RESERVED-but-ignored password in opts. Load relay config from the SSOT src/config/defaults/relay.json via the config store (NO hardcoded endpoint/creds). Keep MqttTransport a THIN IO adapter (no game logic). Provide an in-memory MockTransport for unit-testing logic. Unit tests use the mock; the live relay is exercised by Task 3.3.' },
  { id: '3.2', label: 'seats', desc: 'Seat manager (src/net/seats.ts) — PURE identity-owned seats: first joiner white, second black; same playerId reclaims its seat; 3rd distinct playerId rejected; freed seat is takeable. Seat map in shared state. Leave TODO seams for grace-window/tiebreaker/spectator (deferred flex points). 100% coverage + mutation achievable — it is pure logic.' },
  { id: '3.3', label: 'sync', desc: 'Full-state sync engine (src/net/sync.ts) — on remote log: ADOPT iff local is a strict prefix; IGNORE if remote is a prefix of local (stale/replay); CONFLICT if forks -> archive.flagConflicted + stop. Out-of-order converges to longest valid log. Each outbound msg carries {version, headHash, log}. Pure decision logic = 100%/95%. ALSO add a REAL-RELAY two-client integration test (src/net/sync.realrelay.test.ts) that connects two MqttTransports to the LIVE relay (from relay.json) in a unique room and asserts: bidirectional convergence, replay idempotency, out-of-order tolerance, and conflict detection. Use a unique room per run; clean up.' },
  { id: '3.4', label: 'restricted-undo', desc: 'Restricted networked undo in sync: a client may emit an undo event ONLY for its own last move; it syncs and both step back; an illegal undo attempt is refused locally. Pure logic tested deterministically.' },
]

const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['module', 'completed', 'testCommand', 'testsPassing', 'lintPassing', 'committed'],
  properties: {
    module: { type: 'string' }, completed: { type: 'boolean' }, testCommand: { type: 'string' },
    testsPassing: { type: 'boolean' }, lintPassing: { type: 'boolean' },
    committed: { type: 'boolean' }, commitSha: { type: 'string' },
    realRelayProven: { type: 'boolean' }, notes: { type: 'string' },
  },
}
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['lintPassed', 'testsPassed', 'testCount'],
  properties: {
    lintPassed: { type: 'boolean' }, testsPassed: { type: 'boolean' }, testCount: { type: 'number' },
    pureLogicCoveragePct: { type: 'number' }, transportCoveragePct: { type: 'number' },
    realRelayIntegrationPassed: { type: 'boolean' }, ioBoundaryNotes: { type: 'string' },
  },
}

phase('Build')
const results = []
for (const t of TASKS) {
  const r = await agent(
    `You implement Task ${t.id} (${t.label}) of the Pente3D v1 build. Repo: ${REPO}, branch rewrite2 (work in-place).\n\n` +
      `${DOCTRINE}\n\n` +
      `Target: ${t.desc}\n\n` +
      `1. READ planning/2026-07-18-v1-build-plan.md "Task ${t.id}", planning/2026-07-18-networking-poc-design.md, planning/2026-07-18-game-core-design.md, GLOSSARY.md. Reuse existing src/core (Game, eventLog, serialize) + src/persist (archive) + src/config (relay SSOT) — DRY.\n` +
      `2. Strict TDD: failing test first (paste red), minimal impl, green (paste). Genuine tests (assert observable behavior/state, include negative/failure cases, NEVER prove via a log line).\n` +
      `3. src/net may use the network/DOM but must NOT import three/render/ui. Run \`npm run lint\` — must pass.\n` +
      `4. IO BOUNDARY: keep MqttTransport a thin adapter; the pure logic (seats, sync decisions, undo rules) must be separable and independently unit-tested to 100%. The live relay is verified by the real-relay integration test (Task 3.3), not by mutation-testing mqtt.js glue.\n` +
      `5. When green + lint-clean, COMMIT (conventional msg + trailer \`${TRAILER}\`). Do NOT push.\n\n` +
      `Return structured evidence: module, exact test command, tests+lint status, committed + SHA, and (for 3.3) realRelayProven with the observed two-client convergence output. Evidence only.`,
    { label: `build:${t.id}-${t.label}`, phase: 'Build', schema: BUILD_SCHEMA }
  )
  results.push({ id: t.id, r })
  log(`Task ${t.id} (${t.label}): tests=${r?.testsPassing} lint=${r?.lintPassing} committed=${r?.committed} realRelay=${r?.realRelayProven ?? 'n/a'} ${r?.commitSha || ''}`)
}

phase('Verify')
const verify = await agent(
  `Build-verification for Pente3D Stage 3 (networking). Repo ${REPO}. ${DOCTRINE}\n` +
    `Run and PASTE: \`npm run lint\` (0), \`npm test\` (all pass incl. the real-relay integration test — it hits the LIVE relay from relay.json; report its result explicitly), and \`npm run coverage\`.\n` +
    `Report coverage separately for the PURE logic (seats.ts, sync.ts, undo) vs the thin MqttTransport IO adapter. Pure logic should reach 100%; note honestly which MqttTransport branches are genuinely IO-only (mqtt.js callbacks) and thus verified by the real-relay integration test rather than unit coverage — the review-gate will calibrate the strict scope from your report. Do NOT push. Return structured evidence.`,
  { label: 'verify:stage-3', phase: 'Verify', schema: VERIFY_SCHEMA }
)

return { tasks: results, verify }
