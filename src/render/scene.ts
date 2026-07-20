import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createLogger } from '../debug/log.ts';
import { getConfig } from '../config/config.ts';
import { resolveSceneConfig, type ResolvedSceneConfig, type Vec3 } from './sceneConfig.ts';
import { createLines, type LinesHandle, type LineGroupReadout } from './lines.ts';
import { createPieces, type PiecesHandle, type PieceReadout } from './pieces.ts';
import { Game } from '../core/game.ts';
import type { GameState } from '../core/gameState.ts';
import type { Coord } from '../core/coords.ts';

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
  /** Plain-number readout of every live piece mesh (node/owner/position/opacity). */
  getPieces(): PieceReadout[];
  /**
   * Place the current player's piece at `coords` and reconcile the piece meshes. Throws
   * `IllegalMove` on an illegal move (propagated honestly). Drives Task 4.5's e2e:
   * place → a mesh appears at the node; a capturing move → the flanked meshes vanish.
   */
  place(coords: Coord): GameState;
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
  const game = new Game(BOARD_SIZE);
  const pieces: PiecesHandle = createPieces(BOARD_SIZE);
  scene.add(pieces.object);
  pieces.sync(game.state());

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

  function getPieces(): PieceReadout[] {
    return pieces.getPieces();
  }

  function place(coords: Coord): GameState {
    // `game.place` throws IllegalMove on an illegal move; let it propagate honestly.
    game.place(coords);
    pieces.sync(game.state());
    return game.state();
  }

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
    controls.dispose();
    renderer.dispose();
    lines.dispose();
    pieces.dispose();
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
    getPieces,
    place,
    dispose,
  };
}
