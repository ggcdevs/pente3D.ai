import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createLogger } from '../debug/log.ts';
import { getConfig } from '../config/config.ts';
import { resolveSceneConfig, type ResolvedSceneConfig, type Vec3 } from './sceneConfig.ts';
import { createLines, type LinesHandle, type LineGroupReadout } from './lines.ts';
import { createPieces, type PiecesHandle, type PieceReadout } from './pieces.ts';
import { createMarkers, type MarkersHandle, type MarkersReadout } from './markers.ts';
import { createWinLine, type WinLineHandle, type WinLineReadout } from './winLine.ts';
import { resolveCameraPreset, type ControlsConfig } from './cameraPresets.ts';
import { applyCameraPreset, type CameraPresetReadout } from './cameraControls.ts';
import { createInput, type InputHandle, type InputReadout } from '../input/setup.ts';
import type { Command } from '../input/commands.ts';
import type { KeyResolution } from '../input/scopes.ts';
import {
  placementFromHit,
  enterTemp,
  setTempPreview,
  confirmTemp,
  exitTemp,
  initialTemp,
  tempPlacementScope,
  TEMP_SCOPE_ID,
  type TempPlacement,
} from '../input/placement.ts';
import {
  shouldPlaceFromPointer,
  type PointerPos,
  type DragGuardConfig,
} from '../input/pointerGesture.ts';
import { createPicking, type PickingHandle, type PickGeometryConfig } from './picking.ts';
import {
  buildHoverLookup,
  computeHoverTarget,
  type HoverLookup,
  type HoverTarget,
  type RaycastHit,
} from './hover.ts';
import { Game } from '../core/game.ts';
import type { GameState } from '../core/gameState.ts';
import type { BannerContext } from '../ui/widgets/banner.ts';
import { keyOf, type Coord } from '../core/coords.ts';
import { generateAllLines, type LineCategory } from '../core/lines.ts';

const log = createLogger('render:scene');

/** The board edge length the scene renders. Configurable board size lands with 4.x. */
const BOARD_SIZE = 5;

/** A plain-number camera readout, safe to serialize and assert on from Playwright. */
export interface CameraReadout {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

/**
 * A plain-number readout of the lights actually installed in the scene. Lets Playwright
 * prove the ambient+directional lights were built FROM config (observable behavior),
 * not merely that a "lights configured" log line was emitted (agent-principles #3).
 */
export interface LightingReadout {
  background: number;
  ambient: { color: number; intensity: number };
  directional: { color: number; intensity: number; position: Vec3 };
}

/** A plain-number readout of the renderer's current drawing-buffer size (for resize proof). */
export interface ViewportReadout {
  width: number;
  height: number;
  aspect: number;
}

/**
 * A plain, serializable readout of the temp-placement mode (Task 4.8) — for Playwright
 * assertions. Mirrors the pure `TempPlacement` model plus the live preview mesh's opacity,
 * so a test can prove the translucent preview is actually drawn (observable behavior, not a
 * log line — agent-principles #3).
 */
export interface TempReadout {
  /** Whether temp-placement mode is active. */
  active: boolean;
  /** The previewed node key (the translucent piece), or null if none. */
  preview: string | null;
  /** The preview mesh's current material opacity (0 when no preview is drawn). */
  previewOpacity: number;
}

/** The live scene handle exposed to the app and (via window.__pente) to tests. */
export interface SceneHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  /** Camera position + orbit target as plain numbers. */
  getCamera(): CameraReadout;
  /** The ambient+directional lights + background actually installed, as plain numbers. */
  getLighting(): LightingReadout;
  /** The renderer's current size + camera aspect, as plain numbers. */
  getViewportSize(): ViewportReadout;
  /** Per-category gridline readouts (visibility/blending/instance counts) as plain numbers. */
  getVisibleLines(): LineGroupReadout[];
  /** The live game state (pieces/turn/captures/winner) — for Playwright assertions. */
  getState(): GameState;
  /**
   * The status-banner history context (Task 5.2): `{ history: { canUndo, canRedo, canReset } }`.
   * Passed as the banner widget's `update` config so its Undo/Redo/Reset buttons reflect
   * availability from the `Game` the scene owns (a history fact `GameState` cannot carry).
   */
  getBannerContext(): BannerContext;
  /**
   * Subscribe to board state changes (Task 5.2): `listener` fires after EVERY state change
   * (place / undo / redo / reset / temp-confirm), so the UI shell can repaint its widgets no
   * matter what triggered the change (button / hotkey / canvas click). Returns an unsubscribe fn.
   */
  onStateChange(listener: () => void): () => void;
  /** Plain-number readout of every live piece mesh (node/owner/position/opacity). */
  getPieces(): PieceReadout[];
  /**
   * Plain-number readout of the node-marker layer (Task 4.3): total/visible/highlighted
   * counts plus per-node detail for the queried keys. Lets Playwright prove a marker hides
   * when a piece lands on its node and glows on hover (observable behavior, not a log line).
   */
  getMarkers(query?: readonly string[]): MarkersReadout;
  /** The winning-line mesh readout (visible/nodes/segmentCount/color) — for Task 4.9. */
  getWinLine(): WinLineReadout;
  /** The camera preset actually applied to the controls (name/buttons/limits/speeds). */
  getCameraPreset(): CameraPresetReadout;
  /** The active scope stack + registered command ids (for input assertions). */
  getInput(): InputReadout;
  /** Dispatch a command by id — the same registry keys use (button path). */
  dispatch(id: string): boolean;
  /** Resolve a chord through the scope stack and dispatch it — drives the key path in tests. */
  pressKey(chord: string): KeyResolution;
  /**
   * Place the current player's piece at `coords` and reconcile the piece meshes. Throws
   * `IllegalMove` on an illegal move (propagated honestly). Drives Task 4.5's e2e:
   * place → a mesh appears at the node; a capturing move → the flanked meshes vanish.
   */
  place(coords: Coord): GameState;
  /**
   * Raycast an NDC pointer position (−1..1) and return the resolved {@link RaycastHit}
   * (empty-node / placed-sphere / line) or null — the IO half of picking (Task 4.7). Only
   * *visible* line meshes are intersected, so a hover never resolves to an undrawn line.
   */
  pickAt(ndcX: number, ndcY: number): RaycastHit | null;
  /**
   * Drive a hover at an NDC pointer position: pick, compute the highlight target (pure), and
   * apply the emissive glow. Returns the computed {@link HoverTarget} (or null). This is the
   * end-to-end hover path Playwright drives + asserts on (`getHoverTarget`).
   */
  hoverAt(ndcX: number, ndcY: number): HoverTarget | null;
  /** The current hover highlight target (nodes/lines/pieces), or null if nothing hovered. */
  getHoverTarget(): HoverTarget | null;
  /**
   * Click (place) at an NDC pointer position (−1..1): raycast → if the hit is an empty node,
   * place the current player's piece there and return the new state; otherwise (occupied
   * node / line / miss, or while temp mode is active) return null without placing. The IO
   * half of Task 4.8's "click empty node → place" — Playwright drives it on the real canvas.
   */
  clickAt(ndcX: number, ndcY: number): GameState | null;
  /** The live temp-placement mode readout (active/preview/preview-opacity) — for assertions. */
  getTemp(): TempReadout;
  dispose(): void;
}

/**
 * Build the orbitable scene: a Three.js renderer, a perspective camera with orbit
 * controls, ambient + directional lights resolved FROM config (`lighting` + `colors`
 * sections via `resolveSceneConfig`), a placeholder lattice, a resize handler, and the
 * render loop. This is the Stage 4 scene bootstrap (Task 4.1) — the IO boundary the
 * board renderer (markers/lines/pieces) later attaches to. Verified by Playwright
 * against `window.__pente` readouts (getCamera/getLighting/getViewportSize).
 */
export function createScene(container: HTMLElement): SceneHandle {
  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;

  // Resolve lights + background from the layered config store (no magic values).
  const resolved: ResolvedSceneConfig = resolveSceneConfig(
    getConfig('lighting'),
    getConfig('colors'),
  );

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(resolved.background);

  const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
  camera.position.set(6, 5, 8);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.target.set(0, 0, 0);

  // Ambient + directional lights, both from config (render-ui design Part 2:
  // low-contrast lighting for depth legibility).
  const ambient = new THREE.AmbientLight(resolved.ambient.color, resolved.ambient.intensity);
  scene.add(ambient);
  const dir = new THREE.DirectionalLight(
    resolved.directional.color,
    resolved.directional.intensity,
  );
  dir.position.set(
    resolved.directional.position.x,
    resolved.directional.position.y,
    resolved.directional.position.z,
  );
  scene.add(dir);

  // Instanced gridlines by category (Task 4.4): three InstancedMesh groups built from
  // the pure `resolveLineLayout` plan, board-centered, additively blended per config.
  // (Node markers / pieces attach in Tasks 4.3/4.5.)
  const lines: LinesHandle = createLines(BOARD_SIZE);
  scene.add(lines.object);

  // Individual piece meshes (Task 4.5): a `Game` drives the canonical state; the pieces
  // handle reconciles its mesh set to `game.state().pieces` via the pure `diffPieces`
  // plan on every placement, fading pieces in (placement) and out (capture). This is the
  // scene's live game — Playwright drives it via `place()` and asserts on `getState()` /
  // `getPieces()` (build plan Task 4.5).
  let game = new Game(BOARD_SIZE);
  const pieces: PiecesHandle = createPieces(BOARD_SIZE);
  scene.add(pieces.object);

  // Winning-line mesh (Task 4.9): an individual, partial line drawn on a five-in-a-row
  // win (render-ui design Part 1). The endpoint/segment layout is the PURE `resolveWinLine`
  // (`winLineLayout.ts`, strict unit+mutation); this handle is the IO glue that reflects
  // `state.winningLine` into a single InstancedMesh. Kept in lockstep with the pieces via
  // `syncBoard`, so every state change (place/undo/redo) updates both.
  const winLine: WinLineHandle = createWinLine(BOARD_SIZE);
  scene.add(winLine.object);

  // Picking (Task 4.7): the invisible node pick-sphere layer (IO) that resolves a pointer
  // ray to a RaycastHit. Created before the markers so the markers can REUSE its
  // board-centered `worldOf` node-position helper (DRY) — the marker you see and the node
  // you pick then share an exact world position.
  const picking: PickingHandle = createPicking(
    BOARD_SIZE,
    getConfig('geometry') as unknown as PickGeometryConfig,
  );
  scene.add(picking.object);

  // Instanced node markers (Task 4.3): one InstancedMesh of N³ translucent spheres, one per
  // board node (render-ui design Part 1). The `nodeKey↔instanceId` index + occupancy /
  // hover-instance logic is the PURE `markersLayout.ts` (strict unit+mutation); this handle
  // is the IO glue that reflects it onto the GPU. A marker HIDES when a piece occupies its
  // node (kept in lockstep via `syncBoard`), and hovering an empty node glows its marker
  // (applied alongside the piece glow in `applyHoverHighlight`). Placement reuses picking's
  // `worldOf` so markers and pick spheres coincide exactly.
  const markers: MarkersHandle = createMarkers(BOARD_SIZE, (node) => picking.worldOf(node));
  scene.add(markers.object);

  // State-change subscribers (Task 5.2): the UI shell subscribes so its widgets (the status
  // banner) repaint on EVERY board change — place/undo/redo/reset/temp-confirm — no matter
  // whether the change came from a button, a hotkey, or a canvas click. `syncBoard` is the
  // single choke point through which every state change flows, so notifying here covers them all.
  const stateChangeListeners = new Set<() => void>();
  function notifyStateChanged(): void {
    for (const listener of stateChangeListeners) listener();
  }

  /** Reconcile every state-derived mesh set (markers + pieces + win line) to one `GameState`. */
  function syncBoard(state: GameState): void {
    markers.sync(state);
    pieces.sync(state);
    winLine.sync(state);
    notifyStateChanged();
  }
  syncBoard(game.state());

  // Hover (Task 4.7): the PURE `computeHoverTarget` turns a raycast hit + live state + the
  // node↔line index into a highlight set (empty-node vs placed-sphere vs line, visible-only,
  // the placed-sphere asymmetry — game-core Part 4); the glue applies the emissive boost.
  const hoverLookup: HoverLookup = buildHoverLookup(generateAllLines(BOARD_SIZE));
  const hoverColors = getConfig('colors') as unknown as { hoverHighlight: string };
  const hoverRendering = getConfig('rendering') as unknown as { emissiveBoost: number };
  let hoverTarget: HoverTarget | null = null;

  // Temp-placement mode (Task 4.8): a translucent preview piece the player can examine
  // before committing. The mode state machine is PURE (`src/input/placement.ts`, strict
  // unit+mutation); this is the IO glue that pushes/pops the `tempPlacement` scope and draws
  // the single translucent preview mesh, positioned at the previewed node. `t` enters (and
  // exits); `Enter` confirms → a real placement; a pointer move sets the preview node.
  const tempGeometry = getConfig('geometry') as unknown as {
    spacing: number;
    pieceRadius: number;
    sphereSegments: { width: number; height: number };
  };
  const tempColors = getConfig('colors') as unknown as { tempPiece: string };
  const tempMaterials = getConfig('materials') as unknown as { tempPieceOpacity: number };
  const tempMesh = new THREE.Mesh(
    new THREE.SphereGeometry(
      tempGeometry.pieceRadius,
      tempGeometry.sphereSegments.width,
      tempGeometry.sphereSegments.height,
    ),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(tempColors.tempPiece),
      transparent: true,
      opacity: 0,
    }),
  );
  tempMesh.name = 'temp-preview';
  tempMesh.visible = false;
  scene.add(tempMesh);
  const tempMaterial = tempMesh.material as THREE.MeshStandardMaterial;
  let temp: TempPlacement = initialTemp();

  /** Board-centered world position of a node key (mirrors pieces/picking convention). */
  function worldOfNode(node: string): THREE.Vector3 {
    const [x, y, z] = node.split(',').map(Number) as [number, number, number];
    const c = (BOARD_SIZE - 1) / 2;
    const s = tempGeometry.spacing;
    return new THREE.Vector3((x - c) * s, (y - c) * s, (z - c) * s);
  }

  /** Reflect the pure temp model onto the preview mesh (draw at preview node, or hide). */
  function syncTempPreview(): void {
    if (temp.active && temp.preview !== null) {
      tempMesh.position.copy(worldOfNode(temp.preview));
      tempMesh.visible = true;
      tempMaterial.opacity = tempMaterials.tempPieceOpacity;
    } else {
      tempMesh.visible = false;
      tempMaterial.opacity = 0;
    }
  }

  // Drag-vs-click guard (GitHub issue #1): on a trackpad an orbit/pan gesture ends in a
  // pointer release that would otherwise be treated as click-to-place, dropping pieces
  // accidentally. The DECISION is the PURE `shouldPlaceFromPointer` (strict unit+mutation);
  // this glue only supplies the down/up pixel positions off the real canvas. Config-driven
  // (`interaction.dragGuard`, DEFAULT ENABLED) — resolved once at build; a live override
  // takes effect on reload like every other config section (agent-principles #8, no magic).
  const dragGuard = (getConfig('interaction') as unknown as { dragGuard: DragGuardConfig })
    .dragGuard;

  // Camera presets (Task 4.6): resolve the active `controls` preset (PURE) and BIND it to
  // the OrbitControls (IO glue) — mouse-button mapping, speeds, invert, zoom limits.
  const presetReadout: CameraPresetReadout = applyCameraPreset(
    controls,
    resolveCameraPreset(getConfig('controls') as unknown as ControlsConfig),
  );

  // Line-visibility toggle shared by the category commands: flips the config-derived
  // visible flag on the group mesh and mirrors it into the state we report.
  const lineVisible: Record<LineCategory, boolean> = {
    orthogonal: true,
    face: true,
    space: true,
  };
  for (const readout of lines.getVisibleLines()) {
    lineVisible[readout.category] = readout.visible;
  }
  function toggleCategory(category: LineCategory): void {
    lineVisible[category] = !lineVisible[category];
    lines.setVisible(category, lineVisible[category]);
  }

  // Input system (Task 4.6): the command registry + scope stack + keydown listener. Each
  // command is a stable id dispatched identically by a keybinding or a UI button (the "one
  // action layer"). Handlers bind to the live `game`/`lines`; illegal actions (e.g. undo at
  // ply 0) are swallowed here so a stray hotkey never throws mid-render — the *scene* place
  // path still propagates IllegalMove honestly.
  const undoRedoSafe = (fn: () => void): void => {
    try {
      fn();
    } catch {
      // Nothing to undo/redo — a no-op for the hotkey (the button UI reflects availability).
      return;
    }
    syncBoard(game.state());
  };
  const commands: Command[] = [
    { id: 'undo', run: () => undoRedoSafe(() => game.undo()) },
    { id: 'redo', run: () => undoRedoSafe(() => game.redo()) },
    // Reset (Task 5.2): start a brand-new game. Replaces the `Game` instance (undo/redo of a
    // reset is out of scope for v1) and reconciles every state-derived mesh to the pristine
    // state. A no-op reflected in the UI is fine — a pristine game's Reset is disabled anyway.
    {
      id: 'reset',
      run: () => {
        game = new Game(BOARD_SIZE);
        syncBoard(game.state());
      },
    },
    { id: 'toggleOrthogonal', run: () => toggleCategory('orthogonal') },
    { id: 'toggleFaceDiagonals', run: () => toggleCategory('face') },
    { id: 'toggleSpaceDiagonals', run: () => toggleCategory('space') },
    {
      id: 'showAllDiagonals',
      run: () => {
        for (const category of ['face', 'space'] as const) {
          lineVisible[category] = true;
          lines.setVisible(category, true);
        }
      },
    },
    // Temp-placement mode (Task 4.8). The transitions are the pure model; these handlers are
    // the IO glue that also push/pop the `tempPlacement` scope and redraw the preview. Idempotent.
    { id: 'enterTempMode', run: () => doEnterTemp() },
    { id: 'exitTempMode', run: () => doExitTemp() },
    { id: 'confirmTempPiece', run: () => doConfirmTemp() },
  ];
  const input: InputHandle = createInput(
    commands,
    getConfig('keybindings'),
    null,
    window,
  );

  const keybindings = getConfig('keybindings');

  /** Enter temp mode: advance the pure model + push the (config-bound) tempPlacement scope. */
  function doEnterTemp(): void {
    if (temp.active) return; // already active — `t` is inert until exited (idempotent enter)
    temp = enterTemp();
    input.push(tempPlacementScope(keybindings));
    syncTempPreview();
  }

  /** Exit temp mode: clear the pure model, pop the tempPlacement scope, hide the preview. */
  function doExitTemp(): void {
    if (!temp.active) return; // not in temp mode — nothing to exit
    temp = exitTemp(temp);
    if (input.stack().scopes[input.stack().scopes.length - 1]?.id === TEMP_SCOPE_ID) {
      input.pop();
    }
    syncTempPreview();
  }

  /**
   * Confirm the previewed piece: the pure `confirmTemp` yields the coord to commit (or null).
   * On a commit we place it (a real move — IllegalMove propagates via `place`), then pop the
   * scope and hide the preview. With no preview, `Enter` is inert (no commit, stays active).
   */
  function doConfirmTemp(): void {
    const result = confirmTemp(temp);
    temp = result.next;
    if (result.commit !== null) {
      place(result.commit);
      if (input.stack().scopes[input.stack().scopes.length - 1]?.id === TEMP_SCOPE_ID) {
        input.pop();
      }
    }
    syncTempPreview();
  }

  function getCamera(): CameraReadout {
    return {
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
    };
  }

  function getLighting(): LightingReadout {
    const bg = scene.background as THREE.Color;
    return {
      background: bg.getHex(),
      ambient: { color: ambient.color.getHex(), intensity: ambient.intensity },
      directional: {
        color: dir.color.getHex(),
        intensity: dir.intensity,
        position: { x: dir.position.x, y: dir.position.y, z: dir.position.z },
      },
    };
  }

  function getViewportSize(): ViewportReadout {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    return { width: size.x, height: size.y, aspect: camera.aspect };
  }

  function getVisibleLines(): LineGroupReadout[] {
    return lines.getVisibleLines();
  }

  function getState(): GameState {
    return game.state();
  }

  /**
   * The banner's history-reachability context (Task 5.2). The status banner's Undo/Redo/Reset
   * buttons reflect availability without probing (which would throw); these flags come from the
   * `Game` the scene owns — `GameState` alone cannot know its ply or redo tail. `canReset` is
   * true whenever the game is not pristine (a move was made or an undone tail remains).
   */
  function getBannerContext(): BannerContext {
    return {
      history: {
        canUndo: game.canUndo(),
        canRedo: game.canRedo(),
        canReset: game.canUndo() || game.canRedo(),
      },
    };
  }

  /** Subscribe to board state changes; returns an unsubscribe fn (Task 5.2). */
  function onStateChange(listener: () => void): () => void {
    stateChangeListeners.add(listener);
    return () => stateChangeListeners.delete(listener);
  }

  function getPieces(): PieceReadout[] {
    return pieces.getPieces();
  }

  function getMarkers(query?: readonly string[]): MarkersReadout {
    return markers.getMarkers(query);
  }

  function getWinLine(): WinLineReadout {
    return winLine.getWinLine();
  }

  function getCameraPreset(): CameraPresetReadout {
    return presetReadout;
  }

  function getInput(): InputReadout {
    return input.readout();
  }

  function dispatch(id: string): boolean {
    return input.dispatch(id);
  }

  function pressKey(chord: string): KeyResolution {
    return input.handleChord(chord);
  }

  function place(coords: Coord): GameState {
    // `game.place` throws IllegalMove on an illegal move; let it propagate honestly.
    game.place(coords);
    syncBoard(game.state());
    return game.state();
  }

  /** The line categories currently drawn — the visible-only filter for hover. */
  function visibleCategories(): LineCategory[] {
    return (['orthogonal', 'face', 'space'] as const).filter((c) => lineVisible[c]);
  }

  function pickAt(ndcX: number, ndcY: number): RaycastHit | null {
    return picking.pickAt(ndcX, ndcY, camera, game.state(), lines.pickables());
  }

  /**
   * Apply the current `hoverTarget`'s glow: the highlighted pieces glow (piece meshes), the
   * empty-node markers in `hoverTarget.nodes` glow (marker instances), and the gridline
   * segments of every line in `hoverTarget.lines` glow (line instances). All three are
   * restored to base on the next hover with an empty set (idempotent) — the empty-node marker
   * highlight and the whole-line highlight the hover resolver yields (`HoverTarget.nodes` /
   * `HoverTarget.lines`) are *applied* here (Task 4.3 / 4.7 wiring).
   */
  function applyHoverHighlight(): void {
    pieces.highlight(
      hoverTarget?.pieces ?? [],
      hoverColors.hoverHighlight,
      hoverRendering.emissiveBoost,
    );
    markers.highlight(hoverTarget?.nodes ?? []);
    lines.highlight(hoverTarget?.lines ?? []);
  }

  function hoverAt(ndcX: number, ndcY: number): HoverTarget | null {
    const hit = pickAt(ndcX, ndcY);
    hoverTarget = computeHoverTarget(hit, game.state(), hoverLookup, visibleCategories());
    applyHoverHighlight();
    return hoverTarget;
  }

  function getHoverTarget(): HoverTarget | null {
    return hoverTarget;
  }

  /**
   * Click-to-place (Task 4.8, IO half): raycast the NDC position; the PURE `placementFromHit`
   * decides whether the hit is a placeable empty node. While temp mode is active a click
   * instead moves the preview (the commit is `Enter`), so a live click never bypasses the
   * preview. Returns the new state on a placement, else null (occupied/line/miss/temp-active).
   */
  function clickAt(ndcX: number, ndcY: number): GameState | null {
    const hit = pickAt(ndcX, ndcY);
    if (temp.active) {
      // In temp mode a click retargets the translucent preview onto the clicked empty node
      // (if any) rather than committing — commit is `Enter` (game-core Part 4 examine-first).
      const coord = placementFromHit(hit);
      if (coord !== null) {
        temp = setTempPreview(temp, keyOf(coord));
        syncTempPreview();
      }
      return null;
    }
    const coord = placementFromHit(hit);
    if (coord === null) return null;
    return place(coord);
  }

  function getTemp(): TempReadout {
    return {
      active: temp.active,
      preview: temp.preview,
      previewOpacity: tempMaterial.opacity,
    };
  }

  // Pointer-driven hover: translate a pointermove on the canvas to NDC and run the hover
  // path. Verified by Playwright moving the real mouse and asserting on getHoverTarget().
  // In temp mode the same move also retargets the translucent preview onto the hovered node.
  function onPointerMove(event: PointerEvent): void {
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    hoverAt(ndcX, ndcY);
    if (temp.active) {
      const coord = placementFromHit(pickAt(ndcX, ndcY));
      if (coord !== null) {
        temp = setTempPreview(temp, keyOf(coord));
        syncTempPreview();
      }
    }
  }
  renderer.domElement.addEventListener('pointermove', onPointerMove);

  // Pointer-driven placement (Task 4.8 + GitHub issue #1): placement fires on pointer RELEASE,
  // but only when the release was a genuine CLICK — the pointer moved <= the guard threshold
  // since pointerdown. A larger move is a camera-manipulation drag (orbit/pan) and is
  // suppressed, so rotating no longer drops pieces. The DRAG-vs-CLICK decision is the PURE
  // `shouldPlaceFromPointer`; this glue only records the down position and measures travel.
  // We track the pointer id so an interleaved second pointer can't spoof a fake short drag.
  let pointerDownPos: PointerPos | null = null;
  let pointerDownId: number | null = null;

  function onPointerDown(event: PointerEvent): void {
    pointerDownPos = { x: event.clientX, y: event.clientY };
    pointerDownId = event.pointerId;
  }

  function onPointerUp(event: PointerEvent): void {
    const down = pointerDownPos;
    const downId = pointerDownId;
    pointerDownPos = null;
    pointerDownId = null;
    // No matching pointerdown captured (release without a tracked press) → nothing to place.
    if (down === null || event.pointerId !== downId) return;
    // The PURE guard decides: place only on a genuine click, suppress a drag (unless the
    // guard is disabled via config, which reverts to place-on-release).
    if (!shouldPlaceFromPointer(down, { x: event.clientX, y: event.clientY }, dragGuard)) return;
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    clickAt(ndcX, ndcY);
  }
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);

  let running = true;
  let lastFrame = performance.now();
  function renderLoop(): void {
    if (!running) return;
    const now = performance.now();
    pieces.tick(now - lastFrame);
    lastFrame = now;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(renderLoop);
  }
  renderLoop();

  function onResize(): void {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);

  function dispose(): void {
    running = false;
    window.removeEventListener('resize', onResize);
    renderer.domElement.removeEventListener('pointermove', onPointerMove);
    renderer.domElement.removeEventListener('pointerdown', onPointerDown);
    renderer.domElement.removeEventListener('pointerup', onPointerUp);
    input.dispose();
    controls.dispose();
    renderer.dispose();
    lines.dispose();
    pieces.dispose();
    markers.dispose();
    winLine.dispose();
    picking.dispose();
    tempMesh.geometry.dispose();
    tempMaterial.dispose();
    renderer.domElement.remove();
  }

  log.info('scene initialized', {
    boardSize: BOARD_SIZE,
    lines: getVisibleLines(),
    camera: getCamera(),
    lighting: getLighting(),
    size: getViewportSize(),
  });

  return {
    scene,
    camera,
    renderer,
    controls,
    getCamera,
    getLighting,
    getViewportSize,
    getVisibleLines,
    getState,
    getBannerContext,
    onStateChange,
    getPieces,
    getMarkers,
    getWinLine,
    getCameraPreset,
    getInput,
    dispatch,
    pressKey,
    place,
    pickAt,
    hoverAt,
    getHoverTarget,
    clickAt,
    getTemp,
    dispose,
  };
}
