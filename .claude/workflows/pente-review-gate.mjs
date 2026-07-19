export const meta = {
  name: 'pente-review-gate',
  description: 'Test-integrity + adversarial review gate: assertion-lint, mutation testing, 2 reviewers, fix loop (max 3, then escalate), push on green',
  phases: [
    { title: 'Harden', detail: 'install/config eslint-plugin-vitest + StrykerJS; apply required assert-over-delete fix' },
    { title: 'Review', detail: '2 adversarial reviewers scrutinize impl+tests vs agent-principles.md' },
    { title: 'Fix', detail: 'loop: fix flagged issues, re-review, max 3 rounds then escalate' },
    { title: 'Gate', detail: 'mutation >=95%, coverage 100%, full suite, assertion-lint; push if green' },
  ],
}

const REPO = '/home/guy/code/git/github.com/ggcdevs/pente3D.ai'
// args may arrive as an object OR a JSON string depending on the caller — handle both,
// and FAIL LOUD if scope is missing rather than silently gating the wrong code.
const A = typeof args === 'string' ? JSON.parse(args) : (args || {})
const SCOPE = A.scope
const STAGE = A.stage
if (!SCOPE || typeof SCOPE !== 'string') {
  throw new Error('pente-review-gate: args.scope (a whitespace-separated path string, e.g. "src/config src/persist") is REQUIRED — refusing to run with a silent default that could gate the wrong code.')
}
// Coverage is pinned to SCOPE (all of it). Mutation defaults to SCOPE too, but an IO-heavy
// layer can pass a narrower MUTATE_SCOPE (pure logic only) so mqtt.js/DOM glue — verified by
// integration tests instead — is not mutation-tested. Coverage stays 100% on everything.
const MUTATE_SCOPE = (A.mutateScope && typeof A.mutateScope === 'string') ? A.mutateScope : SCOPE
log(`review-gate resolved coverage-scope="${SCOPE}" mutate-scope="${MUTATE_SCOPE}" stage=${STAGE}`)
const PRINCIPLES = 'planning/agent-principles.md'
const MUT_MIN = 95
const TRAILER = 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>'
const DOCTRINE =
  'Read planning/agent-principles.md and obey it as hard constraints. PROOF, NOT INFERENCE: run the command, paste real output; if not observed, it is not done.'

const SETUP_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['toolingInstalled', 'lintPasses', 'strykerRuns', 'gatesBiteProven', 'committed'],
  properties: {
    toolingInstalled: { type: 'boolean' }, lintPasses: { type: 'boolean' },
    strykerRuns: { type: 'boolean' }, gatesBiteProven: { type: 'boolean' },
    committed: { type: 'boolean' }, commitSha: { type: 'string' }, notes: { type: 'string' },
  },
}
const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['approved', 'issues'],
  properties: {
    approved: { type: 'boolean' },
    issues: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['category', 'severity', 'location', 'principleViolated', 'description'],
        properties: {
          category: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          location: { type: 'string' },
          principleViolated: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
  },
}
const FIX_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['fixedCount', 'testsPass', 'lintPasses', 'committed'],
  properties: {
    fixedCount: { type: 'number' }, testsPass: { type: 'boolean' },
    lintPasses: { type: 'boolean' }, committed: { type: 'boolean' },
    commitSha: { type: 'string' }, notes: { type: 'string' },
  },
}
const GATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['passed', 'lintPassed', 'testsPassed', 'coveragePct', 'mutationScore'],
  properties: {
    passed: { type: 'boolean' }, lintPassed: { type: 'boolean' }, testsPassed: { type: 'boolean' },
    coveragePct: { type: 'number' }, mutationScore: { type: 'number' },
    survivors: { type: 'string' }, pushedRange: { type: 'string' }, failureDetail: { type: 'string' },
  },
}

phase('Harden')
const setup = await agent(
  `Ensure the test-integrity gates ENFORCE the scope "${SCOPE}" for Pente3D (repo ${REPO}, branch rewrite2). ${DOCTRINE}\n` +
    `Tooling may already exist from a prior stage — be IDEMPOTENT and never drop paths already covered:\n` +
    `1. StrykerJS (@stryker-mutator/core + @stryker-mutator/vitest-runner): ensure installed; ensure stryker.config.mjs \`mutate\` includes the MUTATION scope "${MUTATE_SCOPE}" — each entry may be a dir (expand to \`<dir>/**/*.ts\`) or an exact \`.ts\` file — excluding \`*.test.ts\`, keeping existing paths. Do NOT add IO-glue files that are outside "${MUTATE_SCOPE}". Ensure \`thresholds.break = ${MUT_MIN}\` and an npm \`mutate\` script. Run \`npx stryker run\` and paste the score.\n` +
    `2. eslint-plugin-vitest rules (expect-expect, valid-expect, no-disabled-tests, no-focused-tests) active as errors on *.test.ts; \`npm run lint\` exits 0.\n` +
    `3. vite coverage \`thresholds\` pins every path in the COVERAGE scope "${SCOPE}" (\`<path>/**/*.ts\`) to 100% on statements/branches/functions/lines, keeping existing pins.\n` +
    `PROVE each gate BITES (${PRINCIPLES} #7): show it exit non-zero on a deliberate regression (raise stryker \`break\` above the current score -> exit 1; inject an uncovered branch into an in-scope file -> \`npm run coverage\` exit 1), then RESTORE to green.\n` +
    `Commit any config changes (message + trailer \`${TRAILER}\`). Do NOT push. Return structured evidence (gatesBiteProven=true only if you actually observed the non-zero exits).`,
  { schema: SETUP_SCHEMA, phase: 'Harden', label: 'harden:gates' }
)
log(`Harden: stryker=${setup?.strykerRuns} lint=${setup?.lintPasses} gatesBite=${setup?.gatesBiteProven}`)

let round = 0
let approved = false
const allIssues = []
while (round < 3) {
  phase('Review')
  const LENSES = [
    { key: 'test-integrity', focus: 'hollow/tautological tests, coverage-padding, proof-by-log, missing negative cases, over-mocking, weakened thresholds/disabled tests' },
    { key: 'correctness-vs-design', focus: 'deviations from the design docs, silent scaffolding/stubs/TODOs presented as done, errors masked/swallowed/mislabeled, unjustified changes to code under test' },
  ]
  const reviews = (await parallel(LENSES.map((L) => () =>
    agent(
      `You are an ADVERSARIAL REVIEWER for Pente3D Stage ${STAGE}, lens: ${L.key}. ${DOCTRINE}\n` +
        `Read ${PRINCIPLES} (esp. the Reviewer Charter) and enforce it rigidly. Your goal is to FIND PROBLEMS, not approve — approving is the lazy path and is forbidden unless the code genuinely holds up.\n` +
        `Read the real implementation AND tests under ${SCOPE}. Focus especially on: ${L.focus}.\n` +
        `Assume the implementer took the minimal-effort path; verify the opposite. Cite exact file:line. If uncertain, FLAG it (do not approve to be safe).\n` +
        `Return {approved, issues[]}. Only set approved=true if you found no blocker/major issues.`,
      { schema: REVIEW_SCHEMA, phase: 'Review', label: `review:${L.key}:r${round + 1}` }
    )
  ))).filter(Boolean)

  const open = reviews.flatMap((r) => r.issues || []).filter((i) => i.severity === 'blocker' || i.severity === 'major')
  allIssues.push(...open.map((i) => ({ ...i, round: round + 1 })))
  if (open.length === 0) { approved = true; log(`Review round ${round + 1}: clean`); break }

  round++
  log(`Review round ${round}: ${open.length} blocking/major issues -> fixing`)
  phase('Fix')
  await agent(
    `Fix these reviewer-flagged issues in Pente3D Stage ${STAGE}. ${DOCTRINE}\n` +
      `Issues (JSON): ${JSON.stringify(open)}\n` +
      `Fix each GENUINELY per ${PRINCIPLES} — no suppression, no weakening gates, tests stay real (assert observable behavior). Re-run \`npm test\` and \`npm run lint\` (both green). Commit (+ trailer \`${TRAILER}\`). Do NOT push. Return evidence.`,
    { schema: FIX_SCHEMA, phase: 'Fix', label: `fix:r${round}` }
  )
}

phase('Gate')
const gate = await agent(
  `VERIFICATION GATE for Pente3D Stage ${STAGE}. ${DOCTRINE}\n` +
    `Run and PASTE full output:\n` +
    `1. \`npm run lint\` -> exit 0 (incl. assertion-lint rules).\n` +
    `2. \`npm test\` -> all pass (note count).\n` +
    `3. \`npm run coverage\` -> ${SCOPE} must be 100% on all four metrics.\n` +
    `4. \`npm run mutate\` (Stryker, mutates "${MUTATE_SCOPE}") -> overall mutation score must be >= ${MUT_MIN}%. List EVERY surviving mutant with a justification; a survivor is only acceptable if genuinely equivalent/unreachable and explained.\n` +
    `passed = lint(0) AND all tests pass AND coverage 100% AND mutation >= ${MUT_MIN}% (survivors justified).\n` +
    `REVIEWERS APPROVED = ${approved}. Push ONLY if passed AND reviewers approved. If reviewers did NOT approve (this run escalates to a human), DO NOT push regardless of the mechanical result — a human must resolve the outstanding review findings first.\n` +
    `If (passed AND reviewers approved): \`git push origin rewrite2\` and report the range. Else: DO NOT push; report exactly what blocks it.\n` +
    `Return structured evidence.`,
  { schema: GATE_SCHEMA, phase: 'Gate', label: 'gate:mutation' }
)

// Recurring-category signal for manual instruction-tuning (human decides tweaks).
const categoryCounts = {}
for (const i of allIssues) categoryCounts[i.category] = (categoryCounts[i.category] || 0) + 1
const recurring = Object.entries(categoryCounts).filter(([, n]) => n >= 2).map(([c, n]) => ({ category: c, count: n }))

return {
  setup, gate,
  reviewRounds: round,
  approvedByReviewers: approved,
  escalate: !approved || !(gate && gate.passed),
  issuesByRound: allIssues,
  recurringCategoriesForInstructionTuning: recurring,
}
