# Stage 4–5 Build Plan — rendering, interaction, composable UI

> Expands the Stage 4–5 outlines of `planning/2026-07-18-v1-build-plan.md`, per
> `planning/2026-07-19-render-ui-design.md`. Branch: `render-instanced`.

**Gating model:** pure logic (index maps, layout resolver, hover-target computation from a
raycast hit, camera-preset resolution, command dispatch, config) → Vitest unit + strict
mutation (100% coverage / ≥95 mutation, in `mutateScope`). Three.js scene glue + DOM widgets
are an **IO boundary** verified by **Playwright** against `window.__pente` state + screenshots
(NOT mutation-tested). Every task: proof-not-inference; genuine tests; agent-principles apply.

Extend `window.__pente` as modules land: `getState, getCamera, getVisibleLines, getHoverTarget,
pickAt, getLayout, getSeatMap, headHash`.

## Stage 4 — rendering & interaction

- **4.1 Scene bootstrap** (`src/render/scene.ts`, extend the walking skeleton): renderer,
  camera, ambient+directional lights, resize, render loop. Playwright: canvas renders, orbit
  moves camera (already proven).
- **4.2 Render config** (`src/config/defaults/*.json` + types): add `rendering`, `materials`,
  `lighting`, `geometry`, `blending`, expand `colors`. Pure — unit-tested via the config store
  (deep-merge, fallback). *mutateScope.*
- **4.3 Instanced node markers** (`src/render/markers.ts`): InstancedMesh of N³ spheres from
  `GameState`; `nodeKey↔instanceId` map; per-instance color/opacity/visibility; hide marker
  when occupied. Pure index-map + occupancy logic → unit + mutation. Rendering → Playwright
  (`pickAt` returns the right node; screenshot).
- **4.4 Instanced gridlines by category** (`src/render/lines.ts`): 3 instanced groups from
  `generateAllLines`; `lineId↔instance-range` map; visibility from `lineVisibility` config;
  additive blending. Pure grouping/index logic → unit + mutation; visuals → Playwright.
- **4.5 Individual pieces** (`src/render/pieces.ts`): diff `GameState.pieces` → add/remove
  individual meshes; material by color; placement/capture fade seam. Diff logic (pure) → unit +
  mutation; render/animation → Playwright (place → piece appears at node; capture → removed).
- **4.6 Input system + camera presets** (`src/input/commands.ts`, `keybindings.ts`,
  `scopes.ts`, `src/render/cameraPresets.ts`): command registry, keybindings (config), scope-
  stack (top-down + blocking), Fusion + trackpad presets bound to the controller. Registry +
  scope resolution + preset config = pure → unit + mutation (strict — this is core interaction
  logic). Actual drag/zoom → Playwright.
- **4.7 Picking + hover** (`src/render/picking.ts`, `src/render/hover.ts`): raycast →
  hover target; **hover-target computation** (empty-node vs placed-sphere vs line, visible-only,
  the placed-sphere asymmetry) is PURE given a hit + state + `linesThroughNode` → unit +
  mutation (strict). Highlight application (emissive) → Playwright + `getHoverTarget`.
- **4.8 Placement + temp mode** (`src/input/placement.ts`): click empty node → `place`
  command; `t` pushes `tempPlacement` scope (translucent preview, `Enter` confirm, `t` exit).
  Pure command/scope wiring → unit + mutation; interaction → Playwright.
- **4.9 Win visualization** (`src/render/winLine.ts`): individual mesh for `winningLine`
  (partial segment). Playwright: on a forced win, the line appears.

## Stage 5 — composable UI shell

- **5.1 Widget/layout framework** (`src/ui/registry.ts`, `src/ui/layout.ts`): widget registry
  (id→factory), **zone-based layout resolver** (config → ordered widgets per zone). Resolver is
  PURE → unit + mutation (strict — reordering config reorders output; hidden widget dropped;
  unknown id ignored). Container mount → Playwright (`getLayout` reflects config; reordering
  config reorders DOM).
- **5.2 Score/status banner** (`src/ui/widgets/banner.ts`): current player, captures, Undo/
  Redo/Reset → command dispatch. Playwright + state assertions.
- **5.3 Menu + modal** (`src/ui/widgets/menu.ts`): button → modal (Settings/Host/Join/Load/
  Export); Escape/outside closes; pushes a `blocking` scope.
- **5.4 Settings modal** (`src/ui/widgets/settings.ts`): board size, colors/opacity live
  preview, keybindings, control preset, reset-to-defaults — all via the config store.
- **5.5 Networking UI** (`src/ui/widgets/net.ts`): host (code + copy), join (code + errors),
  connection/seat status, conflict banner. Wires the Stage 3 `SyncEngine`/seats.
- **5.6 History slider** (`src/ui/widgets/historySlider.ts`): read-only scrubber over
  `game.stateAt(k)`; slide back removes later pieces locally; end → live. Emits/syncs nothing.
  Playwright: dragging changes the rendered piece count via `getState`.
- **5.7 Help overlay** (`src/ui/widgets/help.ts`): `?` opens a modal generated from the command
  registry + current bindings.
- **5.8 Persistence UX**: autosave current game to the archive (Stage 2); restore on load;
  archive browser (review past + conflicted games).

## Sequencing
Stage 4 first (rendering/interaction is the foundation the UI sits on), then Stage 5. Each
task builds+commits, then the stage runs the review-gate with `scope` = the stage's src dirs
(coverage 100%) and `mutateScope` = the PURE-logic files only (IO glue verified by Playwright).
Camera-preset defaults (Fusion + trackpad) per the design doc.
