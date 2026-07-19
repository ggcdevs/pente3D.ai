export const meta = {
  name: 'pente-stage-4',
  description: 'Build Stage 4 rendering & interaction (Three.js) — pure logic TDD + Playwright/window.__pente visual verification',
  phases: [
    { title: 'Build', detail: 'build each render/interaction module in dependency order; commit when green' },
    { title: 'Verify', detail: 'lint + unit suite + Playwright visual suite + coverage report; no push' },
  ],
}

const REPO = '/home/guy/code/git/github.com/ggcdevs/pente3D.ai'
const TRAILER = 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>'
const DOCTRINE =
  'Read planning/agent-principles.md and obey it as hard constraints (genuine tests, proof-by-behavior-not-log, never weaken a gate, #7 prove-gates-bite, #8 no hardcoded volatile facts). PROOF, NOT INFERENCE: run the command, paste real output; if not observed, it is not done.'

const TASKS = [
  { id: '4.2', label: 'render-config', desc: 'add rendering/materials/lighting/geometry/blending config sections + expand colors (src/config/defaults + types), via the layered config store. PURE — unit-tested (deep-merge, fallback).' },
  { id: '4.1', label: 'scene', desc: 'extend the walking-skeleton scene (src/render/scene.ts): renderer, camera, ambient+directional lights from config, resize, render loop. window.__pente.getCamera already exists.' },
  { id: '4.3', label: 'markers', desc: 'instanced node markers (src/render/markers.ts): InstancedMesh of N^3 spheres from GameState; nodeKey<->instanceId map; per-instance color/opacity/visibility; hide marker when occupied. PURE index/occupancy logic unit+mutation; rendering via Playwright (pickAt returns the right node + screenshot).' },
  { id: '4.4', label: 'lines', desc: 'instanced gridlines by category (src/render/lines.ts): 3 groups from core generateAllLines; lineId<->instance-range map; visibility from lineVisibility config; additive blending. PURE grouping/index unit+mutation; visuals via Playwright.' },
  { id: '4.5', label: 'pieces', desc: 'individual piece meshes (src/render/pieces.ts): diff GameState.pieces -> add/remove meshes; material by color; placement/capture fade seam. PURE diff logic unit+mutation; render/animation via Playwright (place->appears, capture->removed).' },
  { id: '4.6', label: 'input-presets', desc: 'input system (src/input/commands.ts, keybindings.ts, scopes.ts) + camera presets (src/render/cameraPresets.ts): command registry, config keybindings, scope-stack (top-down + blocking), Fusion + trackpad presets. Registry+scope+preset resolution PURE unit+mutation (strict); drag/zoom via Playwright.' },
  { id: '4.7', label: 'picking-hover', desc: 'picking + hover (src/render/picking.ts, hover.ts): raycast->hover target; hover-target COMPUTATION is PURE given a hit + state + linesThroughNode (empty-node vs placed-sphere vs line; visible-only; placed-sphere asymmetry per game-core Part 4) -> unit+mutation (strict). Highlight application (emissive) via Playwright + getHoverTarget.' },
  { id: '4.8', label: 'placement-temp', desc: 'placement + temp mode (src/input/placement.ts): click empty node -> place command; t pushes tempPlacement scope (translucent preview, Enter confirm, t exit). PURE command/scope wiring unit+mutation; interaction via Playwright.' },
  { id: '4.9', label: 'win-viz', desc: 'win visualization (src/render/winLine.ts): individual mesh for winningLine (partial segment). Playwright: on a forced win the line appears.' },
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
    pureLogicCoveragePct: { type: 'number' }, pureLogicFiles: { type: 'string' },
    ioBoundaryNotes: { type: 'string' }, screenshotArtifacts: { type: 'string' },
  },
}

phase('Build')
const results = []
for (const t of TASKS) {
  const r = await agent(
    `You implement Task ${t.id} (${t.label}) of the Pente3D v1 build (Stage 4, rendering). Repo: ${REPO}, branch render-instanced (work in-place).\n\n` +
      `${DOCTRINE}\n\n` +
      `Target: ${t.desc}\n\n` +
      `1. READ planning/2026-07-19-stage-4-5-build-plan.md "Task ${t.id}", planning/2026-07-19-render-ui-design.md, planning/2026-07-18-game-core-design.md, GLOSSARY.md. Reuse existing src/core (Game, generateAllLines, linesThroughNode, placePiece) + src/config — DRY.\n` +
      `2. Separate PURE logic from Three.js/DOM glue. Pure logic (index maps, diffs, resolvers, hover-target computation, config, command/scope resolution) → strict TDD with Vitest: failing test first (paste red), minimal impl, green (paste); genuine assertions on observable values, negative cases, no proof-by-log.\n` +
      `3. Three.js scene glue / interaction is an IO BOUNDARY → verify with PLAYWRIGHT driving the app: extend window.__pente with the needed inspectors and ASSERT ON THEM (getState/getCamera/getVisibleLines/getHoverTarget/pickAt/getLayout), plus a screenshot artifact. Paste the Playwright run output. src/render/src/input may import three/DOM but NOT src/ui; must not violate the src/core boundary.\n` +
      `4. Run \`npm run lint\` (must pass), \`npm test\` (unit), and the relevant \`npm run e2e\` Playwright test (must pass — paste output).\n` +
      `5. When green + lint-clean, COMMIT (conventional msg + trailer \`${TRAILER}\`). Do NOT push.\n\n` +
      `Return structured evidence: module, unit + Playwright pass status, lint, committed + SHA, and what you added to window.__pente. Evidence only — no inference.`,
    { label: `build:${t.id}-${t.label}`, phase: 'Build', schema: BUILD_SCHEMA }
  )
  results.push({ id: t.id, r })
  log(`Task ${t.id} (${t.label}): unit=${r?.unitTestsPassing} pw=${r?.playwrightPassing} lint=${r?.lintPassing} committed=${r?.committed} ${r?.commitSha || ''}`)
}

phase('Verify')
const verify = await agent(
  `Build-verification for Pente3D Stage 4 (rendering). Repo ${REPO}. ${DOCTRINE}\n` +
    `Run and PASTE: \`npm run lint\` (0), \`npm test\` (unit — all pass, note count), \`npm run e2e\` (Playwright visual suite — all pass; note screenshot artifacts), \`npm run coverage\`.\n` +
    `Report coverage for the PURE-logic render/input files (index maps, resolvers, hover-target, config, command/scope) vs the Three.js/DOM glue. Pure logic should reach 100%; list honestly which files are IO-only glue verified by Playwright rather than unit coverage — the review-gate sets mutateScope to the pure files. Do NOT push. Return structured evidence.`,
  { label: 'verify:stage-4', phase: 'Verify', schema: VERIFY_SCHEMA }
)

return { tasks: results, verify }
