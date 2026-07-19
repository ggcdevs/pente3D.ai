export const meta = {
  name: 'pente-stage-2',
  description: 'Build Stage 2 persistence (IndexedDB archive + layered config incl. SSOT relay), TDD',
  phases: [
    { title: 'Build', detail: 'TDD each persistence module in dependency order; commit when green' },
    { title: 'Verify', detail: 'lint + full suite + coverage report (no push; review-gate pushes after mutation+reviewers)' },
  ],
}

const REPO = '/home/guy/code/git/github.com/ggcdevs/pente3D.ai'
const TRAILER = 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>'
const DOCTRINE =
  'Read planning/agent-principles.md and obey it as hard constraints (esp. genuine tests, proof-by-behavior-not-log, never weaken a gate, #7 prove-gates-bite). PROOF, NOT INFERENCE: run the command, paste real output; if not observed, it is not done.'

const TASKS = [
  { id: '2.1', label: 'idb-wrapper', desc: 'IndexedDB promise wrapper over a games object store (src/persist/db.ts); tests use fake-indexeddb (npm i -D fake-indexeddb if missing)' },
  { id: '2.2', label: 'archive', desc: 'game archive: saveGame/listGames/loadGame/flagConflicted incl. conflicted-game (both forks) support (src/persist/archive.ts); depends on db + core Game/serialize' },
  { id: '2.3', label: 'config', desc: 'layered config (src/config/config.ts) + defaults/*.json; sections keybindings/controls/colors/layout/lineVisibility/relay. relay.json is SSOT (wssUrl,username,password,topicRoot) — later consumed by client AND net tests. Deep-merge localStorage overrides; invalid override falls back to default, never throws' },
]

const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['module', 'completed', 'testCommand', 'testsPassing', 'lintPassing', 'committed'],
  properties: {
    module: { type: 'string' }, completed: { type: 'boolean' }, testCommand: { type: 'string' },
    testsPassing: { type: 'boolean' }, lintPassing: { type: 'boolean' },
    committed: { type: 'boolean' }, commitSha: { type: 'string' }, notes: { type: 'string' },
  },
}
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['lintPassed', 'testsPassed', 'testCount'],
  properties: {
    lintPassed: { type: 'boolean' }, testsPassed: { type: 'boolean' }, testCount: { type: 'number' },
    configCoveragePct: { type: 'number' }, persistCoveragePct: { type: 'number' },
    hardToCover: { type: 'string' }, notes: { type: 'string' },
  },
}

phase('Build')
const results = []
for (const t of TASKS) {
  const r = await agent(
    `You implement Task ${t.id} (${t.label}) of the Pente3D v1 build. Repo: ${REPO}, branch rewrite2 (work in-place).\n\n` +
      `${DOCTRINE}\n\n` +
      `Target: ${t.desc}\n\n` +
      `1. READ planning/2026-07-18-v1-build-plan.md "Task ${t.id}" and implement it EXACTLY (its test cases). Consult planning/2026-07-18-game-core-design.md + GLOSSARY.md. Reuse existing src/core (Game, serialize) — DRY.\n` +
      `2. Strict TDD: failing test first (paste red), minimal impl, green (paste). Add fast-check property tests for invariants where meaningful.\n` +
      `3. Genuine tests only (agent-principles): assert observable behavior/return values, include negative/failure cases (missing key, invalid override, corrupt record), never prove via a log line.\n` +
      `4. src/persist and src/config may use the DOM/IndexedDB/localStorage (they are NOT src/core) but must NOT import three/render/ui. Run \`npm run lint\` — must pass.\n` +
      `5. When green + lint-clean, COMMIT (conventional msg + trailer \`${TRAILER}\`). Do NOT push.\n\n` +
      `Return structured evidence: module, exact test command, tests+lint status, committed + SHA. Evidence only.`,
    { label: `build:${t.id}-${t.label}`, phase: 'Build', schema: BUILD_SCHEMA }
  )
  results.push({ id: t.id, r })
  log(`Task ${t.id} (${t.label}): tests=${r?.testsPassing} lint=${r?.lintPassing} committed=${r?.committed} ${r?.commitSha || ''}`)
}

phase('Verify')
const verify = await agent(
  `Build-verification for Pente3D Stage 2 (persistence). Repo ${REPO}. ${DOCTRINE}\n` +
    `Run and PASTE: \`npm run lint\` (exit 0), \`npm test\` (all pass, note count), \`npm run coverage\`.\n` +
    `Report coverage for src/config/** and src/persist/** separately. Per testing-strategy, src/config (pure) should reach 100%; the thin IndexedDB IO wrapper in src/persist may have genuinely-hard-to-cover IO-error branches — LIST any such branch honestly rather than faking a test for it (the review-gate will calibrate the mutation/coverage bar from your report). Do NOT push. Return structured evidence.`,
  { label: 'verify:stage-2', phase: 'Verify', schema: VERIFY_SCHEMA }
)

return { tasks: results, verify }
