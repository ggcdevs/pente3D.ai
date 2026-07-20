export const meta = {
  name: 'pente-stage-5',
  description: 'Build Stage 5 composable UI shell (widgets on a zone-based layout) — pure resolver TDD + Playwright verification; HALTS on a failed task',
  phases: [
    { title: 'Build', detail: 'build each UI module in dependency order; HALT if a task fails (null) rather than build dependents on a gap' },
    { title: 'Verify', detail: 'lint + unit suite + Playwright + coverage report; no push' },
  ],
}

const REPO = '/home/guy/code/git/github.com/ggcdevs/pente3D.ai'
const TRAILER = 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>'
const DOCTRINE =
  'Read planning/agent-principles.md and obey it (genuine tests, proof-by-behavior-not-log, never weaken a gate, #7 prove-gates-bite, #8 no hardcoded volatile facts). PROOF, NOT INFERENCE: run the command, paste real output; if not observed, it is not done.'

// 5.1 is the foundation; the rest are widgets that plug into it. Sequential; HALT on failure.
const TASKS = [
  { id: '5.1', label: 'widget-layout-framework', desc: 'widget registry (id->factory) + PURE zone-based layout resolver (src/ui/registry.ts, src/ui/layout.ts): config -> ordered visible widgets per zone; hidden dropped; unknown id ignored gracefully. Resolver PURE -> strict unit+mutation. Container mount is glue -> Playwright (window.__pente.getLayout reflects config; reordering config reorders the DOM). Foundation for all other widgets.' },
  { id: '5.2', label: 'score-banner', desc: 'score/status banner widget (src/ui/widgets/banner.ts): current player, capture counts, Undo/Redo/Reset buttons dispatching command IDs. Playwright + getState assertions.' },
  { id: '5.3', label: 'menu-modal', desc: 'menu button + modal (src/ui/widgets/menu.ts): opens a modal with Settings/Host/Join/Load/Export; Escape or outside-click closes; pushes a BLOCKING input scope while open.' },
  { id: '5.4', label: 'settings-modal', desc: 'settings modal (src/ui/widgets/settings.ts): board size, colors/opacity with live preview, keybindings, and the control-preset dropdown (fusion360/trackpad/web), reset-to-defaults — all read/write via the config store (getConfig/setConfig/resetConfig).' },
  { id: '5.5', label: 'net-ui', desc: 'networking UI (src/ui/widgets/net.ts): Host (game code + copy), Join (code input + error messages), connection/seat status, conflict banner. Wires the Stage 3 SyncEngine + seat manager.' },
  { id: '5.6', label: 'history-slider', desc: 'history slider widget (src/ui/widgets/historySlider.ts): READ-ONLY local scrubber over game.stateAt(k); sliding back removes later pieces for the local viewer only; end snaps to live. Emits/syncs nothing. Playwright: dragging changes rendered piece count via getState.' },
  { id: '5.7', label: 'help-overlay', desc: 'help overlay (src/ui/widgets/help.ts): the `?` command opens a modal listing shortcuts, GENERATED from the command registry + current bindings (no hardcoded list).' },
  { id: '5.8', label: 'persistence-ux', desc: 'persistence UX: autosave the current game to the Stage 2 archive; restore on load; an archive browser to review past + conflicted games. Wires src/persist/archive.' },
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
    pureLogicFiles: { type: 'string' }, pureLogicCoveragePct: { type: 'number' },
    ioBoundaryNotes: { type: 'string' },
  },
}

phase('Build')
const results = []
let halted = null
for (const t of TASKS) {
  const r = await agent(
    `You implement Task ${t.id} (${t.label}) of the Pente3D v1 build (Stage 5, composable UI shell). Repo: ${REPO}, branch render-instanced (work in-place).\n\n` +
      `${DOCTRINE}\n\n` +
      `Target: ${t.desc}\n\n` +
      `1. READ planning/2026-07-19-stage-4-5-build-plan.md "Task ${t.id}", planning/2026-07-19-render-ui-design.md (Parts 5-6), GLOSSARY.md. Reuse existing src/core, src/config (layered config), src/input (command registry + scope-stack), src/render (window.__pente), src/persist, src/net — DRY.\n` +
      `2. Non-3D UI is HTML/DOM overlays. Each widget is self-contained: stable string id, mount()->DOM element + update(state,config); READS state/config (subscribes); DISPATCHES command IDs (same registry as keybindings); knows NOTHING about its placement (zone-based layout config drives that).\n` +
      `3. Separate PURE logic (the layout resolver, any id/ordering/derivation) from DOM glue. Pure -> strict TDD (Vitest) with genuine assertions + negative cases (no proof-by-log); add pure files to stryker mutate scope + a 100% vite coverage pin. DOM widgets are the IO boundary -> Playwright driving the app, asserting on window.__pente (getLayout/getState/...) + interactions.\n` +
      `4. src/ui may import DOM + core/config/input/render/persist/net, but must NOT be imported BY src/core.\n` +
      `5. Run \`npm run lint\` (0), \`npm test\` (unit), the relevant \`npm run e2e\` Playwright spec. When green + lint-clean, COMMIT (conventional msg + trailer \`${TRAILER}\`). Do NOT push.\n\n` +
      `Return structured evidence: module, unit + Playwright pass status, lint, committed + SHA, what you added to window.__pente. Evidence only.`,
    { label: `build:${t.id}-${t.label}`, phase: 'Build', schema: BUILD_SCHEMA }
  )
  results.push({ id: t.id, r })
  if (!r) {
    halted = t.id
    log(`HALT: Task ${t.id} (${t.label}) returned null (failed) — stopping the build so dependents are NOT built on a gap. Re-run this task, then resume.`)
    break
  }
  log(`Task ${t.id} (${t.label}): unit=${r.unitTestsPassing} pw=${r.playwrightPassing} lint=${r.lintPassing} committed=${r.committed} ${r.commitSha || ''}`)
}

if (halted) {
  return { halted, completed: results.filter((x) => x.r).map((x) => x.id), note: `Build halted at ${halted}; verify skipped. Fix the failed task and resume.` }
}

phase('Verify')
const verify = await agent(
  `Build-verification for Pente3D Stage 5 (UI shell). Repo ${REPO}. ${DOCTRINE}\n` +
    `Run and PASTE: \`npm run lint\` (0), \`npm test\` (unit — all pass, note count), \`npm run e2e\` (Playwright — all pass), \`npm run coverage\`.\n` +
    `Report coverage for the PURE UI logic (layout resolver etc.) vs the DOM widget glue. Pure logic should reach 100%; list which files are DOM-only glue verified by Playwright — the review-gate sets mutateScope to the pure files. Do NOT push. Return structured evidence.`,
  { label: 'verify:stage-5', phase: 'Verify', schema: VERIFY_SCHEMA }
)

return { tasks: results, verify }
