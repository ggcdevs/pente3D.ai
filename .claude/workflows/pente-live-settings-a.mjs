export const meta = {
  name: 'pente-live-settings-a',
  description: 'Menu & live-settings batch — Increment A (#15 core): emitter factory → config pub/sub → scene applyConfig seams → wire+settings+integration. Sequential TDD; HALTS on a failed task.',
  phases: [
    { title: 'Build', detail: 'emitter (pure) → config onConfigChange (pure) → scene applyConfig seams (glue) → wire loop + settings autosave + cross-component e2e; HALT on failure' },
    { title: 'Verify', detail: 'lint + unit + Playwright (incl. live-apply integration spec) + coverage; no push' },
  ],
}

const REPO = '/home/guy/code/git/github.com/ggcdevs/pente3D.ai'
const TRAILER = 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>'
const DOCTRINE =
  'Read planning/agent-principles.md and obey it (genuine tests, proof-by-behavior-not-log, never weaken a gate, #7 prove-gates-bite, #8 no hardcoded volatile facts). PROOF, NOT INFERENCE: run the command, paste real output; if not observed, it is not done. ' +
  'Work IN-PLACE on the CURRENTLY CHECKED-OUT branch — do NOT run `git checkout`/`git switch` or otherwise change branches, and never name a branch to switch to; commit where you are. ' +
  'Plan of record: planning/2026-07-21-menu-live-settings-batch.md. Design: planning/2026-07-19-render-ui-design.md (Parts 4/5/6). Architecture overview: docs/diagrams/.'

// Increment A. Sequential; each depends on the prior. HALT on null so a later task never builds on a gap.
const TASKS = [
  {
    id: 'A.1', label: 'emitter-factory',
    desc: 'Create src/util/emitter.ts: a PURE, dependency-free typed event-emitter factory `createEmitter<T>()` returning `{ emit(payload: T): void, subscribe(fn: (payload: T) => void): () => void }`. subscribe returns an unsubscribe fn that removes exactly that listener (calling it twice is a no-op). emit invokes all CURRENT listeners in subscription order with the payload. Adding or removing a listener DURING an emit must not skip or double-invoke others — snapshot the listener set per emit; test this explicitly. Each createEmitter() is independent (no shared/global state). Imports NOTHING, so any layer (incl. src/core) may use it. Strict TDD (Vitest) + fast-check property tests + Stryker mutation + 100% coverage. This backs onConfigChange (A.2) and, later, the handshake/notification tickets and the #26 scene.onStateChange retrofit.',
  },
  {
    id: 'A.2', label: 'config-pubsub',
    desc: 'In src/config/config.ts add a config-change notification backed by createEmitter (A.1). Export a subscribe API — `onConfigChange(listener: (section: ConfigSection) => void): () => void` — and make `setConfig` and `resetConfig` EMIT the changed section AFTER a successful write. Emit ONLY when a write actually happened: with no store available (null) both are no-ops and MUST NOT emit. Emit the SECTION NAME ONLY (never the new value) — subscribers re-read via getConfig, the SSOT. Keep the pure helpers (getConfig/deepMerge/getDefault/readOverride) pure — the listener state must not leak into them. Test the guardrails: unsubscribe stops delivery; listeners for one section are not called for another; decide+test what happens if a listener throws (do not silently corrupt other listeners — follow agent-principles). Strict TDD + mutation + 100% coverage. This is the #15 primitive and is universal to local AND programmatic/networked writers (e.g. #9 opponent-changed-board-size arriving over the relay).',
  },
  {
    id: 'A.3', label: 'scene-applyconfig-seams',
    desc: "READ src/render/scene.ts FIRST (find the existing live `applyColors()` seam and every construction-time getConfig read). Generalize applyColors into `applyConfig(section: ConfigSection)` that RE-READS getConfig(section) and applies it to the LIVE Three.js scene with NO reload. Cover the live-able sections: colors (fold in the existing behavior), lighting (light color/intensity/position), materials (roughness/metalness/emissive on instanced markers+lines and individual pieces; set needsUpdate), blending (additive vs normal per line category + needsUpdate), interaction (hover scale/glow — re-read, applied at hover time), lineVisibility (toggle the line-category groups). Handle geometry ONLY where it can be applied cheaply and safely mid-game (e.g. marker/piece radius via instance scale); if a section would require an unsafe mesh rebuild, EXCLUDE it and document the exclusion — never a silent gap. EXCLUDE board size and camera preset (baked into instanced buffers/grid/controls at construction; they stay next-game/reload) — make applyConfig an explicit, documented no-op for them, not a silent miss. Expose applyConfig and enough real state on window.__pente (extend the inspectors — e.g. light intensity, a material roughness readout, visible line categories) for Playwright to ASSERT the live change on actual Three.js object values (never logs), plus a screenshot artifact. Glue → Playwright-verified. Do NOT force-live anything that could corrupt in-flight GameState.",
  },
  {
    id: 'A.4', label: 'wire-settings-integration',
    desc: "READ src/main.ts, src/ui/container.ts, src/ui/widgets/settings.ts (+ settingsModel.ts) FIRST. Wire the notification end-to-end: (1) src/main.ts subscribes to onConfigChange (A.2); on each change it calls scene.applyConfig(section) (A.3) AND refreshes config-reading widgets by passing the live config into container.update (container already accepts a config param it currently ignores — make config-reading widgets re-read from it, mirroring how the net widget re-reads session state each update). (2) Settings widget: confirm it autosaves via setConfig on every change (no Apply button, no reload); route its live preview through the SINGLE notification path so colors etc. apply via applyConfig, avoiding a double-apply; label board size 'takes effect next game'; remove any 'reload to apply' copy for the now-live sections. (3) Add a PERMANENT cross-component Playwright spec (the integration seam HANDOFF §5 warns about): change a live-able setting THROUGH THE SETTINGS UI (or the real setConfig path) and assert the BOARD reflects it live via window.__pente with NO reload, plus a screenshot — spanning config→emitter→scene→render→ui. Prove it BITES: it must FAIL if this A.4 wiring is removed. DRY — reuse existing widget/update plumbing; do not duplicate config reads. Glue → Playwright.",
  },
]

const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['module', 'completed', 'unitTestsPassing', 'playwrightPassing', 'lintPassing', 'committed'],
  properties: {
    module: { type: 'string' }, completed: { type: 'boolean' },
    unitTestsPassing: { type: 'boolean' }, playwrightPassing: { type: 'boolean' },
    lintPassing: { type: 'boolean' }, committed: { type: 'boolean' },
    commitSha: { type: 'string' }, windowPenteAdded: { type: 'string' },
    liveApplyObserved: { type: 'string' }, notes: { type: 'string' },
  },
}
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['lintPassed', 'unitTestsPassed', 'playwrightPassed'],
  properties: {
    lintPassed: { type: 'boolean' }, unitTestsPassed: { type: 'boolean' },
    playwrightPassed: { type: 'boolean' }, unitTestCount: { type: 'number' },
    liveApplyIntegrationProven: { type: 'boolean' }, pureLogicFiles: { type: 'string' },
    pureLogicCoveragePct: { type: 'number' }, ioBoundaryNotes: { type: 'string' },
  },
}

phase('Build')
const results = []
let halted = null
for (const t of TASKS) {
  const r = await agent(
    `You implement Task ${t.id} (${t.label}) of the Pente3D Menu & live-settings batch, Increment A (issue #15 core). Repo: ${REPO}.\n\n` +
      `${DOCTRINE}\n\n` +
      `Target: ${t.desc}\n\n` +
      `Separate PURE logic (emitter, config pub/sub — decisions with no THREE/DOM) from GLUE (scene/Three.js, DOM widgets, main wiring). Pure → strict TDD (Vitest) + fast-check where apt + Stryker mutate scope + 100% vite coverage pin. Glue → Playwright driving the real app, asserting window.__pente real values + screenshots, NEVER log lines. Reuse existing src/util, src/config, src/render, src/ui, src/main — DRY; do not rebuild working code.\n\n` +
      `Run \`npm run lint\` (exit 0), \`npm test\` (unit), and the relevant \`npm run e2e\` spec. When all green + lint-clean, COMMIT (conventional message referencing #15 + trailer \`${TRAILER}\`). Do NOT push. Return structured evidence only (no conclusions without observed command output).`,
    { label: `build:${t.id}-${t.label}`, phase: 'Build', schema: BUILD_SCHEMA }
  )
  results.push({ id: t.id, r })
  if (!r) {
    halted = t.id
    log(`HALT: Task ${t.id} (${t.label}) returned null (failed) — stopping so dependents aren't built on a gap. Re-run this task, then resume.`)
    break
  }
  log(`Task ${t.id} (${t.label}): unit=${r.unitTestsPassing} pw=${r.playwrightPassing} lint=${r.lintPassing} committed=${r.committed} ${r.commitSha || ''}`)
}

if (halted) {
  return { halted, completed: results.filter((x) => x.r).map((x) => x.id), note: `Build halted at ${halted}; verify skipped. Fix the failed task and resume.` }
}

phase('Verify')
const verify = await agent(
  `Build-verification for Pente3D Menu & live-settings Increment A (#15 core). Repo ${REPO}. ${DOCTRINE}\n` +
    `Run and PASTE real output: \`npm run lint\` (0), \`npm test\` (unit — all pass, note count), \`npm run e2e\` (Playwright — all pass, INCLUDING the new live-apply integration spec; report whether a setting changed through the UI reflected on the board with NO reload, via window.__pente), \`npm run coverage\`.\n` +
    `Report coverage for the PURE Increment-A logic (src/util/emitter.ts, src/config/config.ts + any pure model changes) vs the Three.js/DOM/main glue — the review-gate will set mutateScope to the pure files. Do NOT push. Return structured evidence.`,
  { label: 'verify:increment-A', phase: 'Verify', schema: VERIFY_SCHEMA }
)

return { tasks: results, verify }
