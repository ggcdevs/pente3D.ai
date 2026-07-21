export const meta = {
  name: 'pente-menu-drawer-b',
  description: 'Menu & live-settings batch — Increment B (#24 drawer): non-blocking side-drawer menu → settings-in-drawer live preview → #14 banner fix. Sequential TDD; HALTS on a failed task.',
  phases: [
    { title: 'Build', detail: 'non-blocking right-edge drawer (menu) → settings-in-drawer live preview → banner spacing fix; HALT on failure' },
    { title: 'Verify', detail: 'build + lint + unit + Playwright (incl. board-stays-live-while-drawer-open) + coverage; no push' },
  ],
}

const REPO = '/home/guy/code/git/github.com/ggcdevs/pente3D.ai'
const TRAILER = 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>'
const DOCTRINE =
  'Read planning/agent-principles.md and obey it (genuine tests, proof-by-behavior-not-log, never weaken a gate, #7 prove-gates-bite, #8 no hardcoded volatile facts). PROOF, NOT INFERENCE: run the command, paste real output; if not observed, it is not done. ' +
  'Work IN-PLACE on the CURRENTLY CHECKED-OUT branch — do NOT run `git checkout`/`git switch` or otherwise change branches, and never name a branch to switch to; commit where you are. ' +
  'Plan of record: planning/2026-07-21-menu-live-settings-batch.md (step 6). Design: planning/2026-07-19-render-ui-design.md (Parts 5 scope-stack, 6 composable UI). Architecture overview: docs/diagrams/. ' +
  'Increment A already shipped: config.onConfigChange (src/config/config.ts) → scene.applyConfig(section) (src/render/scene.ts) live-apply, wired in src/main.ts. REUSE that path — do NOT add a second apply mechanism.'

const TASKS = [
  {
    id: 'B.1', label: 'drawer-shell',
    desc: "READ src/ui/widgets/menu.ts + menuModel.ts, src/ui/container.ts (UI_STYLESHEET + zone system), src/input/scopes.ts FIRST. Convert the menu from a CENTERED BLOCKING modal into a RIGHT-EDGE, NON-BLOCKING slide-in drawer. The menu button toggles it; Escape and outside-click close it. Critically: it pushes a NON-blocking scope (scopes.ts already supports blocking:false) so the board stays fully interactive — camera orbit/pan/zoom and piece placement keep working WHILE the drawer is open (this is the #24 goal; the old modal blocked them). The drawer OVERLAYS the right edge of the full-viewport canvas (does not reflow it); the board remains visible to the left. Keep the existing menu entries (Settings/Host/Join/Load/Export) listed in the drawer — do NOT relocate Host/Join (that is Increment C/#13). Style the drawer in the single UI_STYLESHEET (container.ts) — a clean, modern slide-in; broader CSS polish is a later collaborative pass, so keep it tasteful but simple. PURE: menuModel view-model (entries, open/closed state) → unit + mutation + 100% coverage. GLUE: menu.ts DOM + CSS + scope wiring → Playwright. Playwright MUST assert (window.__pente, not logs): (a) opening the drawer shows it with the entries; (b) with the drawer OPEN, a camera-orbit input still moves the camera (getCamera delta) AND/OR a placement still works — proving non-blocking, the exact regression the old modal had; (c) Escape/outside-click closes and pops the scope (no leak). Screenshot the open drawer over the live board.",
  },
  {
    id: 'B.2', label: 'settings-in-drawer',
    desc: "READ src/ui/widgets/settings.ts + settingsModel.ts and the B.1 drawer FIRST. Make Settings open WITHIN the drawer context (inline panel in the drawer, or a second non-blocking panel) so the BOARD STAYS VISIBLE AND LIVE while editing — the point of #24. The settings scope must ALSO be non-blocking. Changing a live-able setting (color/lighting/material/etc.) applies to the board IMMEDIATELY by reusing Increment A's setConfig → onConfigChange → scene.applyConfig path (do NOT add a new apply mechanism; if settings still calls a direct applyColors, route it through the notification instead to avoid double-apply). Board size keeps its 'takes effect next game' label. PURE: settingsModel changes → unit + mutation + 100% coverage. GLUE: settings.ts + CSS → Playwright. Playwright MUST (window.__pente + screenshot): open Settings in the drawer, change a color or light-intensity value, and assert the BOARD reflects it LIVE while the drawer is open and the board is visible (no reload) — the money-shot proving 'edit while watching the board'. Prove it bites: reverting the wiring makes the assertion fail.",
  },
  {
    id: 'B.3', label: 'banner-spacing-fix',
    desc: "Fix issue #14: the score banner renders 'White: 0Black: 0' with no separation. READ src/ui/widgets/bannerModel.ts + banner.ts FIRST. Fix the formatting in the PURE view-model (bannerModel) — the two scores must be visually separated (e.g. 'White: 0 · Black: 0' or separate elements with spacing; pick what reads cleanly and matches the design). PURE fix → unit test asserting the formatted output has the correct separation (assert the specific expected string/structure, not just 'contains a space') + mutation + 100% coverage. Trivial and independent of B.1/B.2. Glue (DOM) via the existing banner Playwright spec if the structure changes.",
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
    boardStaysLiveObserved: { type: 'string' }, notes: { type: 'string' },
  },
}
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['buildPassed', 'lintPassed', 'unitTestsPassed', 'playwrightPassed'],
  properties: {
    buildPassed: { type: 'boolean' }, lintPassed: { type: 'boolean' },
    unitTestsPassed: { type: 'boolean' }, playwrightPassed: { type: 'boolean' },
    unitTestCount: { type: 'number' }, nonBlockingProven: { type: 'boolean' },
    pureLogicFiles: { type: 'string' }, pureLogicCoveragePct: { type: 'number' }, ioBoundaryNotes: { type: 'string' },
  },
}

phase('Build')
const results = []
let halted = null
for (const t of TASKS) {
  const r = await agent(
    `You implement Task ${t.id} (${t.label}) of the Pente3D Menu & live-settings batch, Increment B (#24 non-blocking drawer). Repo: ${REPO}.\n\n` +
      `${DOCTRINE}\n\n` +
      `Target: ${t.desc}\n\n` +
      `Separate PURE view-model logic (menuModel/settingsModel/bannerModel — no DOM/THREE) from GLUE (widget DOM, CSS, scope wiring). Pure → strict TDD (Vitest) + Stryker mutate scope + 100% vite coverage pin. Glue → Playwright driving the real app, asserting window.__pente real values + screenshots, NEVER log lines. Reuse existing src/ui, src/input/scopes, src/config, src/render — DRY; do not rebuild working code or add a second config-apply path.\n\n` +
      `Run \`npm run build\` (tsc --noEmit typecheck + vite build — exit 0; the typecheck catches TS errors in *.test.ts and glue that vitest's transpile does NOT — a green \`npm test\` does NOT imply a green build), \`npm run lint\` (exit 0), \`npm test\` (unit), and the relevant \`npm run e2e\` spec. When ALL green + lint-clean, COMMIT (conventional message referencing the issue #24/#14 + trailer \`${TRAILER}\`). Do NOT push. Return structured evidence only (no conclusions without observed command output).`,
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
  `Build-verification for Pente3D Menu & live-settings Increment B (#24 drawer). Repo ${REPO}. ${DOCTRINE}\n` +
    `Run and PASTE real output: \`npm run build\` (tsc typecheck + vite build — exit 0; a green unit suite does NOT imply a green build), \`npm run lint\` (0), \`npm test\` (unit — all pass, note count), \`npm run e2e\` (Playwright — all pass, INCLUDING the drawer specs; report whether the board stays interactive with the drawer OPEN, via window.__pente), \`npm run coverage\`.\n` +
    `Report coverage for the PURE Increment-B logic (menuModel/settingsModel/bannerModel) vs the DOM/scope glue — the review-gate will set mutateScope to the pure model files. Do NOT push. Return structured evidence.`,
  { label: 'verify:increment-B', phase: 'Verify', schema: VERIFY_SCHEMA }
)

return { tasks: results, verify }
