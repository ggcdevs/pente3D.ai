/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/pente3D.ai/',
  build: {
    outDir: 'docs',
    emptyOutDir: true,
  },
  test: {
    globals: true,
    environment: 'node',
    // Vitest owns src/**/*.test.ts; Playwright owns e2e/. Keep them from colliding.
    include: ['src/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'docs/**', 'poc/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Core is the pure rules engine held to a 100% floor (see testing-strategy).
      // The rest is pragmatic; boundaries added per-stage.
      include: ['src/**/*.ts'],
      // `src/render/**` is the Three.js IO glue (verified by Playwright, not unit
      // coverage) EXCEPT the pure, THREE-free resolvers (`sceneConfig.ts`, …), which
      // are held to the strict pure-logic gate below. Excluding the glue file-by-file
      // (not the whole dir) keeps the pure files measured.
      exclude: [
        'src/**/*.test.ts',
        'src/main.ts',
        'src/render/scene.ts',
        'src/debug/window.ts',
        // `src/ui` DOM glue (Task 5.1+): the container that mounts widgets into zones, the shell
        // wiring, and the DOM widgets all touch the DOM — verified by Playwright, not unit
        // coverage. The PURE `layout.ts` + `registry.ts` + `widgets/bannerModel.ts` are pinned to
        // the 100% floor below. The DOM widgets are excluded file-by-file (NOT the whole
        // `widgets/**` dir) so the pure `bannerModel.ts` stays measured.
        'src/ui/container.ts',
        'src/ui/setup.ts',
        'src/ui/widgets/placeholder.ts',
        'src/ui/widgets/banner.ts',
        'src/ui/widgets/menu.ts',
        'src/ui/widgets/settings.ts',
      ],
      // MACHINE-ENFORCED GATE (not documentation): the pure rules engine AND the
      // in-scope config/persist layers are held to a hard 100% floor
      // (testing-strategy.md — "hard 100% threshold on src/core"; scope
      // "src/config src/persist" pinned per Stage gate request). `npm run coverage`
      // FAILS (non-zero exit) if any pinned file regresses below 100% on any
      // metric. Each whitespace-separated scope path becomes `<path>/**/*.ts`.
      // Existing `src/core` pin preserved (idempotent). Do not weaken these
      // numbers to pass; add tests instead (agent-principles.md #6).
      thresholds: {
        'src/core/**/*.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'src/config/**/*.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'src/persist/**/*.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        // The networking seam (Transport + MqttTransport) is fully unit-coverable:
        // the pure routing/topic/presence logic and the MockTransport are exercised
        // directly, and the mqtt adapter's client is injected so its glue is driven
        // by a fake client (the LIVE broker is proven separately by Task 3.3, not by
        // padding this gate). Held to the same hard 100% floor. Do not weaken.
        'src/net/**/*.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        // Pure render resolvers (THREE-free scene-config parsing/validation, Task 4.1+).
        // The Three.js scene GLUE (`scene.ts`) is Playwright-verified and excluded above;
        // these pure files carry the strict pure-logic gate. Held to the hard 100% floor.
        'src/render/sceneConfig.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        // Pure node-marker layout (Task 4.3): the `nodeKey↔instanceId` index + occupancy /
        // hover-instance logic. THREE-free / DOM-free — the InstancedMesh glue lives in
        // `markers.ts` (Playwright-verified, excluded via the `src/render/**` glue exclusion).
        // Held to the hard 100% floor. Do not weaken (agent-principles #6).
        'src/render/markersLayout.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        // COVERAGE-MUST-STAY-ALIGNED-WITH-MUTATION-SCOPE: every mutation-gated pure file
        // (stryker.config.mjs `mutate`) is ALSO pinned to the hard 100% floor here, so a
        // mutation-scoped file can never silently drop below full unit coverage. The seven
        // pins below complete that alignment for the remaining THREE-free / DOM-free render
        // + input resolvers; their Three.js/DOM glue siblings (lines.ts, markers.ts,
        // pieces.ts, winLine.ts, scene.ts, cameraControls.ts, picking.ts, input/setup.ts)
        // are the Playwright-verified IO boundary and are deliberately NOT pinned. Do not
        // weaken these numbers to pass; add tests instead (agent-principles.md #6).
        'src/render/linesLayout.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'src/render/piecesDiff.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'src/render/winLineLayout.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'src/render/cameraPresets.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'src/render/hover.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'src/input/commands.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'src/input/scopes.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'src/input/keybindings.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        // Pure placement + temp-mode wiring (Task 4.8): the "click empty node → place"
        // resolver and the immutable temp-placement state machine + its scope. THREE-free /
        // DOM-free — the Three.js click/preview glue lives in `scene.ts` (Playwright-verified,
        // excluded above). Held to the hard 100% floor. Do not weaken (agent-principles #6).
        'src/input/placement.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        // Pure drag-vs-click disambiguation (GitHub issue #1): the pointerdown/pointerup →
        // place-vs-suppress decision, config-driven via `interaction.dragGuard`. THREE-free /
        // DOM-free — the canvas pointer plumbing lives in `scene.ts` (Playwright-verified,
        // excluded above). Held to the hard 100% floor. Do not weaken (agent-principles #6).
        'src/input/pointerGesture.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        // Pure composable-UI logic (Task 5.1): the zone-based layout resolver and the widget
        // registry (id→factory, dup detection, known-id set). THREE-free / DOM-free — the DOM
        // container/shell/widget glue (`container.ts`, `setup.ts`, `widgets/**`) is the
        // Playwright-verified IO boundary, excluded above. Held to the hard 100% floor and in
        // the mutation scope. Do not weaken (agent-principles #6).
        'src/ui/layout.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'src/ui/registry.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        // Pure score/status banner view-model (Task 5.2): state + history → the serializable
        // banner model (status/captures/ordered Undo-Redo-Reset buttons + enabled). THREE-free /
        // DOM-free — the DOM/dispatch widget glue (`widgets/banner.ts`) is Playwright-verified and
        // excluded above. In the mutation scope and held to the hard 100% floor. Do not weaken.
        'src/ui/widgets/bannerModel.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        // Pure menu view-model (Task 5.3): the entry roster → the ordered, visible-filtered menu
        // items (id/label/commandId) the modal renders. THREE-free / DOM-free — the DOM/dispatch +
        // scope-push widget glue (`widgets/menu.ts`) is Playwright-verified and excluded above. In
        // the mutation scope and held to the hard 100% floor. Do not weaken.
        'src/ui/widgets/menuModel.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        // Pure settings view-model (Task 5.4): the config sections → the ordered form model
        // (board-size / preset options, colour + opacity fields, keybinding rows) + the input→patch
        // normalizers (each rejecting a malformed value). THREE-free / DOM-free — the DOM/config-
        // write + scope-push widget glue (`widgets/settings.ts`) is Playwright-verified and excluded
        // above. In the mutation scope and held to the hard 100% floor. Do not weaken.
        'src/ui/widgets/settingsModel.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
