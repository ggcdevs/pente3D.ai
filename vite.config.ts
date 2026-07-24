/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // Per-env base (issue #22): the GitHub Actions deploy sets DEPLOY_BASE per branch
  //   main → '/pente3D.ai/'      (Pages root)
  //   dev  → '/pente3D.ai/dev/'  (Pages /dev subpath)
  //   test → '/pente3D.ai/test/' (Pages /test subpath)
  // so the same repo builds every environment. Defaults to the prod base for a plain
  // `npm run build`.
  base: process.env.DEPLOY_BASE || '/pente3D.ai/',
  build: {
    // Build into a gitignored dir (issue #22). The committed `docs/` still serves prod
    // via Pages until the Pages source is switched to the `gh-pages` branch.
    outDir: 'dist',
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
        // The app-level net-session IO wiring (SyncEngine + seat orchestration over a transport +
        // IndexedDB) touches the DOM / network / browser globals — verified by Playwright, not unit
        // coverage. The PURE `netModel.ts` is pinned to the 100% floor below (and in the mutation
        // scope). Excluded file-by-file so netModel stays measured. (Issue #44: the former standalone
        // `net.ts` net widget was folded into the banner — the merged net-status DOM now lives in
        // `banner.ts`, already excluded above, and `netModel.ts` stays the pure data source.)
        // Task C.2 Network-Game drawer panel: the DOM/dispatch + scope-push glue for the code picker.
        // Touches the DOM — verified by the Task C.2 Playwright spec, not unit coverage. The PURE
        // `netPanelModel.ts` is pinned to the 100% floor below (and in the mutation scope). Excluded
        // file-by-file so netPanelModel stays measured.
        'src/ui/widgets/netPanel.ts',
        'src/net/session.ts',
        'src/net/appSession.ts',
        // Task N.5.2 move-notification + auto-reconnect GLUE: the DOM (`document.title` flash) +
        // browser-API (`Notification`, `requestPermission`) + `visibilitychange`/`online` listener
        // side effects the PURE `notify.ts` decisions gate. Touches document / browser globals —
        // verified by the Task N.5.2 Playwright spec (real title + fire counters + a Notification spy
        // covering the granted/denied fire gate AND the 'default' one-time opt-in request + once-guard),
        // not unit coverage. The PURE `net/notify.ts` it stands on is pinned to the 100% floor (via
        // `src/net/**`) and in the mutation scope. Excluded file-by-file so `notify.ts` stays measured.
        'src/net/notifyGlue.ts',
        // Task 5.6 history-slider widget: the `<input type=range>` DOM glue that reads the scene's
        // history readout and drives its read-only scrub seam. Touches the DOM — verified by the
        // Task 5.6 Playwright spec, not unit coverage. The PURE `sliderModel.ts` is pinned to the
        // 100% floor below (and in the mutation scope). Excluded file-by-file so sliderModel stays measured.
        'src/ui/widgets/historySlider.ts',
        // Task 5.7 help-overlay widget: the modal DOM glue that reads the scene's live registry +
        // bindings and paints the generated shortcut rows. Touches the DOM — verified by the Task
        // 5.7 Playwright spec, not unit coverage. The PURE `helpModel.ts` is pinned to the 100%
        // floor below (and in the mutation scope). Excluded file-by-file so helpModel stays measured.
        'src/ui/widgets/help.ts',
        // Task 5.8 archive-browser widget: the modal DOM glue that reads the archive over IndexedDB
        // (`persist/archive.ts`) and dispatches a review/load. Touches the DOM + IndexedDB — verified
        // by the Task 5.8 Playwright spec, not unit coverage. The PURE `archiveModel.ts` is pinned to
        // the 100% floor below (and in the mutation scope). Excluded file-by-file so archiveModel
        // stays measured.
        'src/ui/widgets/archive.ts',
        // Task N.2.2 networked end-state overlay widget: the non-blocking, view-only card DOM glue
        // that paints the PURE `deriveEndState` view-model and drives a rematch through the session's
        // handshake API. Touches the DOM — verified by the Task N.2.2 Playwright spec (two-context
        // rematch + seat-swap), not unit coverage. The PURE `net/endState.ts` it renders is pinned to
        // the 100% floor (via `src/net/**`) and in the mutation scope. Excluded file-by-file.
        'src/ui/widgets/endStateOverlay.ts',
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
        // Pure random-id helper (GitHub issue #6): returns a UUID v4 that works in an INSECURE
        // context (plain http on the LAN), where `crypto.randomUUID` is undefined and crashed boot.
        // It reads the `crypto` browser global (so it is NOT in `src/core`), but is otherwise pure,
        // deterministic-given-its-source logic — the insecure-context + Math.random fallback branches
        // are fault-injected in its test. In the mutation scope and held to the hard 100% floor. Do
        // not weaken (agent-principles #6).
        'src/util/**/*.ts': {
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
        // Pure node-pick-radius resolver (GitHub issue #3): empty → marker-sized, occupied →
        // piece-sized, clamped to half-spacing. Mutation-scoped, so pinned to the hard 100%
        // floor here too (the mutation-scope↔coverage alignment above). Its InstancedMesh
        // glue (`picking.ts`) is the Playwright-verified IO boundary and is NOT pinned.
        'src/render/pickRadius.ts': {
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
        // Pure networking view-model (Task 5.5): the session-state → panel/label/banner derivation
        // plus the code validation/normalization/generation. THREE-free / DOM-free — the DOM/dispatch
        // widget glue (`widgets/net.ts`) and the SyncEngine+seat session wiring (`net/session.ts`,
        // `net/appSession.ts`) are the Playwright-verified IO boundary, excluded above. In the
        // mutation scope and held to the hard 100% floor. Do not weaken (agent-principles #6).
        'src/ui/widgets/netModel.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        // Pure recent-game-codes store (Task C.1, issue #13 picker "saved" list): record/list/clear the
        // codes the user used to host/join, backed by an INJECTED Storage (like config.ts) so it is
        // node-testable and degrades a corrupt record to empty. THREE-free / DOM-free — the DOM/dispatch
        // widget glue (`widgets/net.ts`) is the Playwright-verified IO boundary, excluded above. In the
        // mutation scope and held to the hard 100% floor. Do not weaken (agent-principles #6).
        'src/ui/widgets/recentCodes.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        // Pure Network-Game-panel view-model (issue #13 / #16 combobox): the combobox state (typed
        // text + random placeholder + recent list) → the effective code (typed || placeholder), its
        // validation/canonicalization, Host/Join button enablement, and the recent-row helpers.
        // THREE-free / DOM-free — the DOM/dispatch + scope-push widget glue (`widgets/netPanel.ts`) is
        // the Playwright-verified IO boundary, excluded above. In the mutation scope and held to the
        // hard 100% floor. Do not weaken (agent-principles #6).
        'src/ui/widgets/netPanelModel.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        // Pure history-slider view-model (Task 5.6): the raw-value → clamped-viewed-ply resolution
        // and the ply/max/viewed facts → serializable model derivation. THREE-free / DOM-free — the
        // DOM `<input type=range>` widget glue (`widgets/historySlider.ts`) and the scene's read-only
        // scrub seam (`scene.ts` scrubTo/getHistory) are the Playwright-verified IO boundary,
        // excluded above. In the mutation scope and held to the hard 100% floor. Do not weaken.
        'src/ui/widgets/sliderModel.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        // Pure help-overlay view-model (Task 5.7): the registered command ids + current bindings →
        // ordered shortcut rows (invert bindings; keep only registered+bound; sort). THREE-free /
        // DOM-free — the modal DOM/scope-push widget glue (`widgets/help.ts`) is the Playwright-
        // verified IO boundary, excluded above. In the mutation scope and held to the hard 100%
        // floor. Do not weaken (agent-principles #6).
        'src/ui/widgets/helpModel.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        // Pure archive-browser view-model (Task 5.8): the archive's listings → newest-first rows
        // (id / players label / result / conflicted flag / headHash / startedAt) + the deterministic
        // players-label projection. THREE-free / DOM-free — the modal DOM/dispatch + IndexedDB widget
        // glue (`widgets/archive.ts`), the scene's `loadGame` seam, and the app autosave/restore
        // wiring (`main.ts`) are the Playwright-verified IO boundary, excluded above. In the mutation
        // scope and held to the hard 100% floor. Do not weaken (agent-principles #6).
        'src/ui/widgets/archiveModel.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
