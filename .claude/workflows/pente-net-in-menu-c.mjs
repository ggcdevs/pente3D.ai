export const meta = {
  name: 'pente-net-in-menu-c',
  description: 'Menu & live-settings batch — Increment C (#13): game-code utils → Network Game panel in the drawer + retire inline Host/Join → rework two-browser e2e via the new UI. Sequential TDD; HALTS on a failed task.',
  phases: [
    { title: 'Build', detail: 'pure game-code utils → Network Game drawer panel (picker + host/join, keep on-board status) → two-browser e2e via the new UI; HALT on failure' },
    { title: 'Verify', detail: 'build + lint + unit + Playwright (incl. two-browser networked via the drawer) + coverage; no push' },
  ],
}

const REPO = '/home/guy/code/git/github.com/ggcdevs/pente3D.ai'
const TRAILER = 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>'
const DOCTRINE =
  'Read planning/agent-principles.md and obey it (genuine tests, proof-by-behavior-not-log, never weaken a gate, #7 prove-gates-bite, #8 no hardcoded volatile facts). PROOF, NOT INFERENCE: run the command, paste real output; if not observed, it is not done. ' +
  'Work IN-PLACE on the CURRENTLY CHECKED-OUT branch — do NOT run `git checkout`/`git switch` or otherwise change branches, and never name a branch to switch to; commit where you are. ' +
  'Plan of record: planning/2026-07-21-menu-live-settings-batch.md (step 7). Resolved picker design: GitHub issue #13 (its maintainer comment). Design docs: planning/2026-07-18-networking-poc-design.md + planning/2026-07-19-render-ui-design.md (Part 6). Architecture overview: docs/diagrams/. ' +
  'Increments A+B already shipped: the non-blocking drawer (src/ui/widgets/menu.ts) and settings-in-drawer panel (src/ui/widgets/settings.ts) — REUSE that drawer/panel + non-blocking-scope pattern for the Network Game panel; do NOT invent a new one.'

const TASKS = [
  {
    id: 'C.1', label: 'game-code-utils',
    desc: "READ src/ui/widgets/netModel.ts (existing validateGameCode, HOST_GAME_COMMAND/JOIN_GAME_COMMAND) and src/config/config.ts (injected-storage pattern) FIRST. Build the PURE game-code utilities for the picker (#13): (a) a RANDOM code generator producing a SHORT 5-char code from an UNAMBIGUOUS alphabet that EXCLUDES 0/O/1/I/L (so a code is dictatable over voice — no 0-vs-O, 1-vs-l confusion); (b) validateGameCode aligned to that format — accept the generated shape, REJECT malformed/empty/too-long/illegal-char (test the negatives explicitly); (c) a RECENT-CODES store — record a code used to host/join, list the most-recent N (cap, dedupe, most-recent-first), backed by localStorage via an INJECTED Storage (exactly like config.ts) so it is node-testable and NEVER throws on a missing/corrupt record (degrade to empty). Keep all of this PURE (no DOM/THREE). Place it where it belongs following existing structure (extend netModel or a small new src/net/src/util module) — DRY. Strict TDD (Vitest) + fast-check on the generator (EVERY output validates AND uses only the allowed alphabet) + Stryker mutation + 100% coverage. Backs the picker UI in C.2.",
  },
  {
    id: 'C.2', label: 'network-game-drawer-panel',
    desc: "READ src/ui/widgets/net.ts + netModel.ts (current Host/Join controls, the connection/seat/turn/conflict status display, and the hostGame/joinGame/setPendingJoinCode wiring), src/ui/widgets/menu.ts + settings.ts (the drawer + non-blocking panel-in-drawer pattern from Increment B), and C.1's utilities FIRST. Add a 'Network Game' entry in the menu drawer that opens a NON-BLOCKING panel (same pattern/scope as settings-in-drawer) containing: a SINGLE game-code field fed by a picker with three sources — CUSTOM (type it), SAVED (pick from recent codes via C.1's store), RANDOM (generate via C.1) — then a HOST button (host this code's room) and a JOIN button (join this code's room). Wire Host/Join to the EXISTING commands/seams (hostGame, joinGame, setPendingJoinCode) — do NOT reimplement the net session/transport. Record the code into the recent-codes store on host/join. REMOVE the Host/Join initiation controls from the inline connectionStatus widget, but KEEP its live connection/seat/turn/conflict STATUS display on the board (persistent status must NOT be buried in the transient drawer). Pure view-model additions (picker source state, derived code, button enablement) → netModel unit + mutation + 100% coverage; the DOM/panel is glue → Playwright (assert via window.__pente + screenshots: opening Network Game shows the picker; random yields an unambiguous-alphabet code in the field; saved lists recent; custom validates; Host/Join dispatch the right commands with the chosen code). Do NOT break the non-blocking/board-dismiss behavior.",
  },
  {
    id: 'C.3', label: 'two-browser-e2e-via-drawer',
    desc: "READ e2e/networked.spec.ts and e2e/net.spec.ts (current two-context + net-widget specs) and the C.2 drawer Network Game panel FIRST. Update the networked/networking e2e so Host and Join are driven through the NEW drawer 'Network Game' panel (not the retired inline controls). The PERMANENT two-browser spec (two ISOLATED browser CONTEXTS, distinct playerId/seats, live relay) must still PROVE end-to-end sync via the new UI: host on A + join on B through the drawer, seat assignment, a move on A appears on B with getState AND headHash MATCHING, turn-gate rejects an off-turn move. It must FAIL if the C.2 wiring is broken (prove it bites). Fix any net.spec.ts assertions that referenced the removed inline Host/Join controls — genuinely (assert the new observable behavior), never by weakening/deleting. These real-relay tests self-skip if the broker is unreachable (by design) — note if skipped. Glue → Playwright; report whether two-context move-sync + headHash-match was observed live.",
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
    twoBrowserSyncObserved: { type: 'string' }, notes: { type: 'string' },
  },
}
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['buildPassed', 'lintPassed', 'unitTestsPassed', 'playwrightPassed'],
  properties: {
    buildPassed: { type: 'boolean' }, lintPassed: { type: 'boolean' },
    unitTestsPassed: { type: 'boolean' }, playwrightPassed: { type: 'boolean' },
    unitTestCount: { type: 'number' }, twoBrowserSyncProven: { type: 'boolean' },
    pureLogicFiles: { type: 'string' }, pureLogicCoveragePct: { type: 'number' }, ioBoundaryNotes: { type: 'string' },
  },
}

phase('Build')
const results = []
let halted = null
for (const t of TASKS) {
  const r = await agent(
    `You implement Task ${t.id} (${t.label}) of the Pente3D Menu & live-settings batch, Increment C (#13 network game in the drawer). Repo: ${REPO}.\n\n` +
      `${DOCTRINE}\n\n` +
      `Target: ${t.desc}\n\n` +
      `Separate PURE logic (code generation/validation, recent-codes store, netModel view-model — no DOM/THREE) from GLUE (drawer panel DOM, net session wiring, two-context e2e). Pure → strict TDD (Vitest) + fast-check where apt + Stryker mutate scope + 100% vite coverage pin. Glue → Playwright driving the real app, asserting window.__pente real values + screenshots (and for networking, the OTHER client actually receiving the move over the real relay), NEVER log lines. Reuse existing src/net, src/ui, src/config — DRY; do not rebuild the net session/transport.\n\n` +
      `Run \`npm run build\` (tsc --noEmit typecheck + vite build — exit 0; the typecheck catches TS errors in *.test.ts and glue that vitest's transpile does NOT — a green \`npm test\` does NOT imply a green build), \`npm run lint\` (exit 0), \`npm test\` (unit), and the relevant \`npm run e2e\` spec. When ALL green + lint-clean, COMMIT (conventional message referencing #13 + trailer \`${TRAILER}\`). Do NOT push. Return structured evidence only (no conclusions without observed command output).`,
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
  `Build-verification for Pente3D Menu & live-settings Increment C (#13 network game in the drawer). Repo ${REPO}. ${DOCTRINE}\n` +
    `Run and PASTE real output: \`npm run build\` (tsc typecheck + vite build — exit 0; a green unit suite does NOT imply a green build), \`npm run lint\` (0), \`npm test\` (unit — all pass, note count), \`npm run e2e\` (Playwright — all pass, INCLUDING the two-browser networked spec driven via the new drawer Network Game panel; report whether A/B move-sync + headHash-match was observed live, or self-skipped without a broker), \`npm run coverage\`.\n` +
    `Report coverage for the PURE Increment-C logic (code utils, recent-codes store, netModel additions) vs the DOM/net glue — the review-gate will set mutateScope to the pure files. Do NOT push. Return structured evidence.`,
  { label: 'verify:increment-C', phase: 'Verify', schema: VERIFY_SCHEMA }
)

return { tasks: results, verify }
