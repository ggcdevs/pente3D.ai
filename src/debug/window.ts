import type {
  SceneHandle,
  CameraReadout,
  LightingReadout,
  ViewportReadout,
  TempReadout,
  ColorsReadout,
} from '../render/scene.ts';
import type { LineGroupReadout } from '../render/lines.ts';
import type { PieceReadout } from '../render/pieces.ts';
import type { MarkersReadout } from '../render/markers.ts';
import type { WinLineReadout } from '../render/winLine.ts';
import type { CameraPresetReadout } from '../render/cameraControls.ts';
import type { InputReadout } from '../input/setup.ts';
import type { KeyResolution } from '../input/scopes.ts';
import type { RaycastHit, HoverTarget } from '../render/hover.ts';
import type { GameState } from '../core/gameState.ts';
import type { Coord } from '../core/coords.ts';
import type { UiHandle } from '../ui/setup.ts';
import type { LayoutReadout } from '../ui/container.ts';
import type { BannerContext } from '../ui/widgets/banner.ts';
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
  /**
   * The live-previewable colours actually applied to the scene (Task 5.4): background, gridline
   * opacity, and each line category's base colour, read back off the real Three.js objects. Lets
   * Playwright prove a settings-modal colour/opacity edit CHANGED the rendered scene (observable
   * behavior, not a log line — agent-principles #3).
   */
  getColors(): ColorsReadout | null;
  /** The live game state (pieces/turn/captures/winner) as plain values. */
  getState(): GameState | null;
  /**
   * The status-banner history context (Task 5.2): `{ history: { canUndo, canRedo, canReset } }`,
   * computed from the scene's `Game`. Lets Playwright assert the Undo/Redo/Reset button
   * availability against real reachability (observable behavior, not a log line — principle #3).
   */
  getBannerContext(): BannerContext | null;
  /** Plain-number readout of every live piece mesh (node/owner/position/opacity). */
  getPieces(): PieceReadout[] | null;
  /**
   * Node-marker readout (Task 4.3): total/visible/highlighted counts + per-node detail for
   * the queried keys. Lets Playwright prove a marker HIDES when a piece lands on its node and
   * GLOWS on hover (observable behavior, not a log line — agent-principles #3).
   */
  getMarkers(query?: readonly string[]): MarkersReadout | null;
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
  /**
   * The mounted composable-UI layout (Task 5.1), read back off the live DOM: `zone → ordered
   * widget ids`. Lets Playwright prove the DOM reflects the `layout` config and that reordering
   * the config reorders the DOM (observable behavior, not a log line — agent-principles #3).
   */
  getLayout(): LayoutReadout | null;
}

declare global {
  interface Window {
    __pente?: PenteInspect;
  }
}

/** Install `window.__pente`, wired to the live scene + UI handles. Dev/test builds only. */
export function installInspectApi(scene: SceneHandle, ui: UiHandle): PenteInspect {
  const api: PenteInspect = {
    getCamera: () => scene.getCamera(),
    getLighting: () => scene.getLighting(),
    getViewportSize: () => scene.getViewportSize(),
    getVisibleLines: () => scene.getVisibleLines(),
    getColors: () => scene.getColors(),
    getState: () => scene.getState(),
    getBannerContext: () => scene.getBannerContext(),
    getPieces: () => scene.getPieces(),
    getMarkers: (query?: readonly string[]) => scene.getMarkers(query),
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
    getLayout: () => ui.getLayout(),
  };
  window.__pente = api;
  log.info('window.__pente installed', Object.keys(api));
  return api;
}
