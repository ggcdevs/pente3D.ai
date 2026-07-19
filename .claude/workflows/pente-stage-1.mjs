export const meta = {
  name: 'pente-stage-1',
  description: 'Build Stage 1 rules core (TDD, proof-gated, 100% core coverage)',
  phases: [
    { title: 'Build', detail: 'TDD each core module in dependency order; commit when green' },
    { title: 'Gate', detail: 'run full suite + coverage + lint; push only if green' },
  ],
}

const REPO = '/home/guy/code/git/github.com/ggcdevs/pente3D.ai'

const DOCTRINE =
  'PROOF, NOT INFERENCE: never claim success. Run the command and PASTE its real output. ' +
  'If it was not observed, it is not done. "should pass"/"likely works" is forbidden. ' +
  'Report failures honestly, including anything this environment cannot run.'

const TRAILER = 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>'

// Dependency-ordered. Built sequentially so later modules see earlier files and commits do not race.
const TASKS = [
  { id: '1.1', label: 'coords', desc: 'coordinate keys + in-bounds (src/core/coords.ts)' },
  { id: '1.2', label: 'axes', desc: '13 canonical line axes with categories (src/core/axes.ts)' },
  { id: '1.3', label: 'lines', desc: 'dedup-free line generation, node<->line index, generateFullLine/generatePartialLine (src/core/lines.ts)' },
  { id: '1.4', label: 'gamestate-placepiece', desc: 'GameState + placePiece placement/validation (src/core/gameState.ts, placePiece.ts)' },
  { id: '1.5', label: 'captures', desc: 'custodian exactly-two pair captures in placePiece (src/core/captures*)' },
  { id: '1.6', label: 'win', desc: 'five-in-a-row + five-pair win detection in placePiece' },
  { id: '1.7', label: 'eventlog-hash', desc: 'append-only event log + hash chain (src/core/eventLog.ts, hash.ts)' },
  { id: '1.8', label: 'game', desc: 'Game fold + undo/redo + snapshot cache (src/core/game.ts)' },
  { id: '1.9', label: 'serialize', desc: 'game export/import JSON (src/core/serialize.ts)' },
]

const BUILD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['module', 'completed', 'testCommand', 'testsPassing', 'lintPassing', 'committed'],
  properties: {
    module: { type: 'string' },
    completed: { type: 'boolean' },
    testCommand: { type: 'string' },
    testsPassing: { type: 'boolean' },
    lintPassing: { type: 'boolean' },
    committed: { type: 'boolean' },
    commitSha: { type: 'string' },
    notes: { type: 'string' },
  },
}

const GATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['passed', 'lintPassed', 'testsPassed', 'coreCoveragePct'],
  properties: {
    passed: { type: 'boolean' },
    lintPassed: { type: 'boolean' },
    testsPassed: { type: 'boolean' },
    testCount: { type: 'number' },
    coreCoveragePct: { type: 'number' },
    pushedRange: { type: 'string' },
    failureDetail: { type: 'string' },
  },
}

phase('Build')
const results = []
for (const t of TASKS) {
  const r = await agent(
    `You implement Task ${t.id} (${t.label}) of the Pente3D v1 build. Repo: ${REPO}, branch rewrite2 (work in-place, not a worktree).\n\n` +
      `${DOCTRINE}\n\n` +
      `Target: ${t.desc}\n\n` +
      `Steps:\n` +
      `1. READ planning/2026-07-18-v1-build-plan.md and find "Task ${t.id}" — implement it EXACTLY (its listed test cases and code). Also consult planning/2026-07-18-game-core-design.md and GLOSSARY.md for exact semantics. Earlier tasks' files already exist in src/core — reuse them, DRY.\n` +
      `2. Strict TDD: write the failing test FIRST, run \`npx vitest run <testfile>\` and PASTE the red output; then implement the minimal code; run again and PASTE the green output.\n` +
      `3. Add fast-check property tests where the design states invariants (e.g. placePiece never mutates input; replaying a log gives identical state+headHash; line enumeration has zero dupes for any N; captures symmetric across all 26 directions). If fast-check is missing: \`npm i -D fast-check\`.\n` +
      `4. Keep src/core PURE — no three/DOM/net/ui imports. Run \`npm run lint\` and it MUST pass (the boundary rule is enforced).\n` +
      `5. When tests are green AND lint passes, COMMIT with a conventional message ending in exactly this trailer line:\n${TRAILER}\nDo NOT push — the gate pushes. (A git wrapper may re-author/GPG-sign; that is expected.)\n\n` +
      `Return structured evidence: the module built, the exact vitest command, whether tests+lint pass, whether you committed, and the commit SHA. Evidence only — no inference.`,
    { label: `build:${t.id}-${t.label}`, phase: 'Build', schema: BUILD_SCHEMA }
  )
  results.push({ id: t.id, r })
  if (!r) log(`Task ${t.id} (${t.label}): AGENT RETURNED NULL`)
  else log(`Task ${t.id} (${t.label}): tests=${r.testsPassing} lint=${r.lintPassing} committed=${r.committed} ${r.commitSha || ''}`)
}

phase('Gate')
const gate = await agent(
  `You are the VERIFICATION GATE for Pente3D Stage 1. Repo: ${REPO}, branch rewrite2.\n\n` +
    `${DOCTRINE}\n\n` +
    `Run each and PASTE full real output:\n` +
    `1. \`npm run lint\` — must exit 0.\n` +
    `2. \`npm test\` — every test must pass; note the total count.\n` +
    `3. \`npm run coverage\` — read the coverage table for src/core/** (exclude *.test.ts). Stage 1 REQUIRES 100% on statements, branches, functions, and lines for src/core.\n\n` +
    `Decide passed = (lint exit 0) AND (all tests pass) AND (src/core coverage == 100% on all four metrics).\n` +
    `If passed: \`git push origin rewrite2\` and report the pushed range.\n` +
    `If NOT passed: DO NOT push. Report exactly which check failed, the failing output, and which module/task is responsible so it can be fixed.\n\n` +
    `Return structured evidence.`,
  { label: 'gate:stage-1', phase: 'Gate', schema: GATE_SCHEMA }
)

return { tasks: results, gate }
