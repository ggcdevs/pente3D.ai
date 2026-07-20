import type {
  SceneHandle,
  CameraReadout,
  LightingReadout,
  ViewportReadout,
  TempReadout,
} from '../render/scene.ts';
import type { LineGroupReadout } from '../render/lines.ts';
import type { PieceReadout } from '../render/pieces.ts';
import type { WinLineReadout } from '../render/winLine.ts';
import type { CameraPresetReadout } from '../render/cameraControls.ts';
import type { InputReadout } from '../input/setup.ts';
import type { KeyResolution } from '../input/scopes.ts';
import type { RaycastHit, HoverTarget } from '../render/hover.ts';
import type { GameState } from '../core/gameState.ts';
import type { Coord } from '../core/coords.ts';
import { createLogger } from './log.ts';

const log = createLogger('debug:window');

/**
 * The `window.__pente` inspection API — the linchpin that lets browser agents
 * (Playwright, cdp) assert on real internal state instead of pixels.
 *
 * Grows over the project (getState, getEventLog, headHash, getVisibleLines, pickAt…).
 * For the walking skeleton it exposes the live camera and a getState stub.
 */
export interface PenteInspect {
  /** Camera position + orbit target as plain numbers. */
  getCamera(): CameraReadout | null;
  /** The ambient+directional lights + background actually installed, as plain numbers. */
  getLighting(): LightingReadout | null;
  /** The renderer's current drawing-buffer size + camera aspect, as plain numbers. */
  getViewportSize(): ViewportReadout | null;
  /** Per-category gridline readouts (visibility/blending/instance counts) as plain numbers. */
  getVisibleLines(): LineGroupReadout[] | null;
  /** The live game state (pieces/turn/captures/winner) as plain values. */
  getState(): GameState | null;
  /** Plain-number readout of every live piece mesh (node/owner/position/opacity). */
  getPieces(): PieceReadout[] | null;
  /**
   * The winning-line mesh readout (Task 4.9): `visible`, the drawn run's `nodes`, the
   * `segmentCount`, and the config-derived `color`. Lets Playwright prove that on a forced
   * five-in-a-row win the partial line mesh is actually drawn along the winning run
   * (observable behavior, not a log line — agent-principles #3).
   */
  getWinLine(): WinLineReadout | null;
  /**
   * Place the current player's piece at `coords`, reconcile the meshes, and return the
   * new state. Throws `IllegalMove` on an illegal move (propagated so tests observe it).
   */
  place(coords: Coord): GameState | null;
  /** The camera preset applied to the controls (name/buttons/zoom-limits/speeds). */
  getCameraPreset(): CameraPresetReadout | null;
  /** The active input scope stack + registered command ids. */
  getInput(): InputReadout | null;
  /** Dispatch a command id directly (the UI-button path — same registry as keys). */
  dispatch(id: string): boolean | null;
  /**
   * Resolve a key chord (e.g. `'u'`, `'ctrl+s'`) through the scope stack and dispatch it —
   * drives the keybinding path from a test without synthesizing a raw KeyboardEvent.
   */
  pressKey(chord: string): KeyResolution | null;
  /**
   * Raycast an NDC pointer position (−1..1) → the resolved hit (empty-node / placed-sphere
   * / line) or null. The IO half of picking (Task 4.7), asserted on by Playwright.
   */
  pickAt(ndcX: number, ndcY: number): RaycastHit | null;
  /**
   * Drive a hover at an NDC pointer position: pick + compute the highlight target (pure) +
   * apply the emissive glow. Returns the {@link HoverTarget} (nodes/lines/pieces) or null.
   */
  hoverAt(ndcX: number, ndcY: number): HoverTarget | null;
  /** The current hover highlight target (nodes/lines/pieces), or null if nothing hovered. */
  getHoverTarget(): HoverTarget | null;
  /**
   * Click (place) at an NDC pointer position (−1..1): an empty-node hit places the current
   * player's piece (returns the new state); an occupied node / line / miss — or a click while
   * temp mode is active (which retargets the preview instead) — returns null. The IO half of
   * Task 4.8's "click empty node → place", asserted on by Playwright.
   */
  clickAt(ndcX: number, ndcY: number): GameState | null;
  /**
   * The live temp-placement readout (Task 4.8): `active` flag, the previewed node key, and the
   * translucent preview mesh's opacity — so Playwright proves the preview is actually drawn.
   */
  getTemp(): TempReadout | null;
}

declare global {
  interface Window {
    __pente?: PenteInspect;
  }
}

/** Install `window.__pente`, wired to the live scene handle. Dev/test builds only. */
export function installInspectApi(scene: SceneHandle): PenteInspect {
  const api: PenteInspect = {
    getCamera: () => scene.getCamera(),
    getLighting: () => scene.getLighting(),
    getViewportSize: () => scene.getViewportSize(),
    getVisibleLines: () => scene.getVisibleLines(),
    getState: () => scene.getState(),
    getPieces: () => scene.getPieces(),
    getWinLine: () => scene.getWinLine(),
    place: (coords: Coord) => scene.place(coords),
    getCameraPreset: () => scene.getCameraPreset(),
    getInput: () => scene.getInput(),
    dispatch: (id: string) => scene.dispatch(id),
    pressKey: (chord: string) => scene.pressKey(chord),
    pickAt: (ndcX: number, ndcY: number) => scene.pickAt(ndcX, ndcY),
    hoverAt: (ndcX: number, ndcY: number) => scene.hoverAt(ndcX, ndcY),
    getHoverTarget: () => scene.getHoverTarget(),
    clickAt: (ndcX: number, ndcY: number) => scene.clickAt(ndcX, ndcY),
    getTemp: () => scene.getTemp(),
  };
  window.__pente = api;
  log.info('window.__pente installed', Object.keys(api));
  return api;
}
