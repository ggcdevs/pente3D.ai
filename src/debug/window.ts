import type {
  SceneHandle,
  CameraReadout,
  LightingReadout,
  ViewportReadout,
} from '../render/scene.ts';
import type { LineGroupReadout } from '../render/lines.ts';
import type { PieceReadout } from '../render/pieces.ts';
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
   * Place the current player's piece at `coords`, reconcile the meshes, and return the
   * new state. Throws `IllegalMove` on an illegal move (propagated so tests observe it).
   */
  place(coords: Coord): GameState | null;
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
    place: (coords: Coord) => scene.place(coords),
  };
  window.__pente = api;
  log.info('window.__pente installed', Object.keys(api));
  return api;
}
