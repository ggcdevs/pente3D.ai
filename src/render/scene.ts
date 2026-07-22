import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createLogger } from '../debug/log.ts';
import { getConfig, type ConfigSection } from '../config/config.ts';
import { resolveSceneConfig, type ResolvedSceneConfig, type Vec3 } from './sceneConfig.ts';
import { createLines, type LinesHandle, type LineGroupReadout } from './lines.ts';
import {
  LINE_CATEGORIES,
  resolveLineBlending,
  resolveLineVisibility,
  type BlendingConfig,
  type LineVisibilityConfig,
} from './linesLayout.ts';
import { createPieces, type PiecesHandle, type PieceReadout } from './pieces.ts';
import { createMarkers, type MarkersHandle, type MarkersReadout } from './markers.ts';
import { createWinLine, type WinLineHandle, type WinLineReadout } from './winLine.ts';
import { resolveCameraPreset, type ControlsConfig } from './cameraPresets.ts';
import {
  applyCameraPreset,
  installModifierSwaps,
  readCameraPreset,
  type AppliedPresetTag,
  type CameraPresetReadout,
} from './cameraControls.ts';
import { createInput, type InputHandle, type InputReadout } from '../input/setup.ts';
import type { Command } from '../input/commands.ts';
import type { KeyResolution, Scope } from '../input/scopes.ts';
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
import type { NetSessionState } from '../ui/widgets/netModel.ts';
import { initialHandshake, type HandshakeState } from '../net/handshake.ts';
import { deriveUndoRedoPrompt, type UndoRedoPrompt } from '../net/undoRedo.ts';
import type { HelpSources } from '../ui/widgets/helpModel.ts';
import { keyOf, type Coord, type NodeKey } from '../core/coords.ts';
import { generateAllLines, type LineCategory } from '../core/lines.ts';
import { headHash } from '../core/eventLog.ts';

const log = createLogger('render:scene');

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
 * A live-applicable subset of the `colors` config (Task 5.4 settings-modal live preview; issue #15
 * extended it to EVERY colour). Every field is optional so the settings modal can preview ONE changed
 * colour at a time. `applyColors` reflects each onto the running scene immediately, re-colouring the
 * EXISTING rendered objects with NO reload: `background` → the scene background, `lineOpacity` → the
 * shared gridline opacity, the three `line*` colours → each line category's base instance colour,
 * `hoverHighlight` → the next hover glow, `emptySphere` → the empty-node marker instances, `whitePiece`/
 * `blackPiece` → every existing + future piece mesh of that owner, `tempPiece` → the translucent
 * placement-preview mesh, and `winningLine` → the win-line mesh (recoloured if currently shown, and any
 * future win). ALL ten `colors` keys now apply live (issue #15 closed the marker/piece/temp/win gap).
 */
export interface ColorsPreview {
  background?: string;
  lineOpacity?: number;
  lineOrthogonal?: string;
  lineFaceDiagonal?: string;
  lineSpaceDiagonal?: string;
  hoverHighlight?: string;
  emptySphere?: string;
  whitePiece?: string;
  blackPiece?: string;
  tempPiece?: string;
  winningLine?: string;
}

/**
 * A plain readout of the live-previewable colours actually applied to the scene (Task 5.4). Read
 * back off the real Three.js objects (the background `Color`, the gridline material opacity, each
 * category's base instance colour) so Playwright proves a settings-modal colour edit CHANGED the
 * rendered scene — observable behavior, not a log line (agent-principles #3).
 */
export interface ColorsReadout {
  /** The scene background as `#rrggbb`. */
  background: string;
  /** The shared gridline material opacity in 0..1. */
  lineOpacity: number;
  /** Each category's base instance colour as `#rrggbb`. */
  lineOrthogonal: string;
  lineFaceDiagonal: string;
  lineSpaceDiagonal: string;
  /** The hover-glow colour the next highlight paints, as `#rrggbb` (issue #15 live-apply readout). */
  hoverHighlight: string;
  /** The empty-node marker base colour, read back off the live marker instances, as `#rrggbb` (#15). */
  emptySphere: string;
  /** The per-owner piece colours every existing + future piece draws, as `#rrggbb` (#15). */
  whitePiece: string;
  blackPiece: string;
  /** The translucent temp/preview-piece colour, read off the live preview material, as `#rrggbb` (#15). */
  tempPiece: string;
  /** The winning-line mesh colour (recoloured live if shown, else the colour a future win draws), `#rrggbb` (#15). */
  winningLine: string;
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

/**
 * A plain, serializable readout of the read-only local history scrub (Task 5.6) — for the history
 * slider widget + Playwright. `maxPly` is the live head ply (the canonical `Game`'s highest
 * reachable ply, UNAFFECTED by scrubbing); `viewedPly` is the ply currently RENDERED for the local
 * viewer (`maxPly` when live, an earlier ply while scrubbing back); `scrubbing` is true iff the
 * viewer is looking at an earlier ply than the live head. Because `maxPly` reports the untouched
 * `Game`, a test can prove scrubbing rendered an earlier state (fewer pieces via `getState`) WHILE
 * the canonical history is intact (agent-principles #3: observable behavior, never a log line).
 */
export interface HistoryReadout {
  /** The live head ply — the canonical `Game`'s highest reachable ply (unaffected by scrubbing). */
  maxPly: number;
  /** The ply currently rendered for the local viewer (`maxPly` when live, earlier while scrubbing). */
  viewedPly: number;
  /** Whether the viewer is scrubbed back (`viewedPly < maxPly`). */
  scrubbing: boolean;
}

/**
 * A plain, serializable readout of the seat-turn gate (Task 6.2, issue #4c) — for the banner cue +
 * Playwright. `offTurnBlocks` counts how many placement attempts the scene has REJECTED because it was
 * not the local seat's turn in the networked game; it increments once per blocked attempt and never on
 * a legal (or local, non-networked) placement. A test proves an off-turn click was rejected — the
 * board is unchanged AND this counter advanced — observable behavior, never a log line (principle #3).
 */
export interface TurnGateReadout {
  /** The number of placement attempts rejected as off-turn since the scene was created. */
  offTurnBlocks: number;
}

/** The live scene handle exposed to the app and (via window.__pente) to tests. */
/**
 * The networking hooks (Task 5.5) the app wires to its net session after constructing it. The scene
 * does not own the session (it needs a DB + transport — an app-level concern), so `hostGame` /
 * `joinGame` invoke `host` / `join` here, the net widget reads `getNet`, and the widget stashes a
 * validated join code via `setPendingJoinCode` before dispatching the argument-free `joinGame`.
 */
export interface NetHooks {
  /** Host a new game (generate a code, claim white, connect). */
  host(): void;
  /** Join the game whose code was last stashed via {@link setPendingJoinCode}. */
  join(): void;
  /** Stash a validated join code for the next {@link join}. */
  setPendingJoinCode(code: string): void;
  /** The live session readout the net widget renders. */
  getNet(): NetSessionState;
  /**
   * Route a local placement through the networked session (Task 6.1, issue #4): the SyncEngine
   * applies + publishes the move so the peer receives it, and the returned {@link GameState} is the
   * session's authoritative state the scene renders. Throws `IllegalMove` (propagated) on an illegal
   * move. Only called when {@link getNetGameState} is non-null (a live session owns the game).
   */
  place(coords: Coord): GameState;
  /**
   * Whether the local client may place right now in the networked game (Task 6.2, issue #4c): the
   * session consults the pure {@link canPlaceForSeat} gate — `true` on the local seat's turn, `false`
   * on the opponent's. Only meaningful (and only consulted by the scene) when {@link getNetGameState}
   * is non-null. The scene blocks an off-turn placement and shows a subtle cue instead of pushing an
   * out-of-seat-order move onto the shared log.
   */
  canPlace(): boolean;
  /**
   * The session's authoritative game state to RENDER when a networked game is live (issue #4: ONE
   * game per session), or `null` when the scene should render its own local game (offline / stopped).
   * The scene adopts this on every session change so a REMOTE move re-renders the board.
   */
  getNetGameState(): GameState | null;
  /**
   * The `headHash` of the session's authoritative game log when networked (issue #4), or `null` when
   * the scene's local game is authoritative. Lets `window.__pente.getHeadHash` report the SHARED
   * game's fingerprint so a two-client test can prove both peers converged to an identical head.
   */
  getNetHeadHash(): string | null;
  /**
   * Re-broadcast the session's current authoritative log to the room (Task 6.7). Idempotent and safe
   * anytime: adopting an already-delivered log is a proven no-op on the receiver (`decideSync` IGNOREs
   * a prefix), so this never moves a peer backward — it only fills the LIVE relay's non-retained
   * subscription gap (a move published before the peer's subscription was active is otherwise dropped).
   * A no-op with no live engine. This is the real "resync" capability a reconnect button would use; the
   * two-context live-relay e2e drives it to defeat that gap deterministically without weakening the proof.
   */
  resync(): void;
  /**
   * Leave the networked room and return to offline (the "Leave room" capability): disconnects the
   * transport (which drops this client's presence, so the PEER sees a present→absent edge) and drops
   * the session's engine/seat. A no-op offline. Idempotent. Surfaced so a two-context e2e can drive a
   * GRACEFUL peer drop deterministically and prove the surviving client's session auto-cancels a
   * pending out-of-band proposal (the `onPeerGone` guardrail) — observable behavior, not a log line.
   */
  leaveNet(): void;
  /**
   * The OUT-OF-BAND ask/accept handshake readout (N.1, issues #12/#18): the session's current
   * {@link HandshakeState} (its at-most-one pending proposal + last resolution). Held in session
   * memory, never on the move-log. Lets `window.__pente.getHandshake` prove a proposal actually
   * crossed the relay (the peer's session shows an INCOMING pending) and resolved (the proposer's
   * shows an `accepted` resolution) — observable behavior, not a log line (agent-principles #3).
   */
  getHandshake(): HandshakeState;
  /**
   * Raise an OUTGOING handshake proposal for the opaque `action` (#12 `'rematch'` / #18 `'undo'`),
   * publishing it NON-RETAINED to the peer. Returns `true` if raised, `false` when offline. Drives
   * the consumer-agnostic primitive; #12/#18 layer their meaning on top.
   */
  propose(action: string): boolean;
  /**
   * Accept (`true`) or decline (`false`) the INCOMING pending proposal, publishing the response back
   * so the proposer's outgoing ask resolves. Returns `true` if a response was sent, `false` when
   * there is nothing to answer. Out-of-band throughout — no move-log write.
   */
  respond(accepted: boolean): boolean;
  /**
   * Whether this client may PROPOSE an undo / a redo in the LIVE networked game (Task N.3.2, issue
   * #18): the session folds the authoritative state + ply + redo-tail + seat + handshake through the
   * pure `canProposeUndo`/`canProposeRedo`. The scene reads these to enable the networked banner
   * Undo/Redo buttons — a networked undo/redo is a PROPOSAL, gated by the restricted last-mover-only
   * rule + the single-pending invariant, not the local ply/redo-tail history. `false`/`false` offline.
   */
  getNetUndoRedoAvail(): { readonly canUndo: boolean; readonly canRedo: boolean };
  /**
   * The INCOMING undo/redo accept/decline PROMPT (Task N.3.2, issue #18): the session's pure
   * `deriveUndoRedoPrompt` over the handshake + seat. `show` is `true` only when the PEER has an
   * undo/redo proposal awaiting our response; the copy names the opponent color (fixed `Player` union,
   * never opponent free text). The banner surfaces it (not the end-state overlay — the game is not
   * over) and calls {@link respond} on Accept/Decline. Hidden offline / with no incoming ask.
   */
  getUndoRedoPrompt(): UndoRedoPrompt;
}

export interface SceneHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  /** Camera position + orbit target as plain numbers. */
  getCamera(): CameraReadout;
  /**
   * Position the camera + orbit target directly (test-driver seam): construct a deterministic
   * view so picking/occlusion can be asserted from a known geometry. Updates the projection.
   */
  setCamera(
    position: { x: number; y: number; z: number },
    target: { x: number; y: number; z: number },
  ): void;
  /** The ambient+directional lights + background actually installed, as plain numbers. */
  getLighting(): LightingReadout;
  /** The renderer's current size + camera aspect, as plain numbers. */
  getViewportSize(): ViewportReadout;
  /** Per-category gridline readouts (visibility/blending/instance counts) as plain numbers. */
  getVisibleLines(): LineGroupReadout[];
  /**
   * Live-apply a subset of the `colors` config to the scene (Task 5.4 settings-modal preview; issue #15
   * extended it to EVERY colour): background, gridline opacity, the three line colours, the hover glow,
   * the empty-node markers, the per-owner piece meshes, the temp-preview piece, and the win line all
   * re-colour on the next frame WITHOUT a reload — existing rendered objects included. Returns the
   * {@link ColorsReadout} of what is now actually applied (render truth, read off the Three.js objects).
   */
  applyColors(preview: ColorsPreview): ColorsReadout;
  /**
   * Live-apply a whole config SECTION to the running Three.js scene with NO reload (Task A.3, issue
   * #15): RE-READ `getConfig(section)` (the SSOT — no value is passed in) and reflect it onto the live
   * objects. Generalizes {@link applyColors} to every live-able section:
   *   - `colors`      → background, gridline opacity, the three line colours, the hover-glow colour, the
   *                     empty-node markers, both piece colours (every existing + future mesh), the temp-
   *                     preview piece, and the win line — ALL ten colours apply live (issue #15);
   *   - `lighting`    → ambient/directional light colour + intensity + directional position;
   *   - `materials` / `rendering` → marker/piece surface roughness·metalness·opacity + hover emissive
   *                     boost (each material flags its own `needsUpdate`);
   *   - `blending`    → each line category's additive-vs-normal composite;
   *   - `interaction` → the drag-vs-click guard, applied to the next pointer release;
   *   - `lineVisibility` → toggle the three line-category groups.
   * EXCLUDED as an explicit, documented no-op (NOT a silent gap): `board` (size is baked into the
   * instanced marker/pick/line buffers + grid at construction), `controls` (the camera preset is bound
   * onto OrbitControls at construction), and `geometry` (spacing/thickness/radii are baked into every
   * instance matrix + the shared sphere/box geometries — a live change needs a full mesh rebuild that
   * would be unsafe mid-game). These stay next-game / reload, matching the persisted-override contract.
   * `keybindings`/`layout`/`relay` are not scene concerns (no-op here). Idempotent; re-applying the
   * current config is a proven no-op. Observable via getLighting/getColors/getMarkers/getPieces/
   * getVisibleLines/getInteraction — never a log line (agent-principles #3).
   */
  applyConfig(section: ConfigSection): void;
  /** The live-previewable colours actually applied to the scene, read back off the Three.js objects. */
  getColors(): ColorsReadout;
  /**
   * The drag-vs-click guard currently in force (Task A.3 `interaction` live-apply readout): `enabled`
   * and the `thresholdPx`. Lets Playwright prove an `interaction` edit was applied LIVE (the guard the
   * scene will use on the next pointer release changed) — observable behavior, not a log line (#3).
   */
  getInteraction(): DragGuardConfig;
  /**
   * The game state CURRENTLY RENDERED for the local viewer (pieces/turn/captures/winner) — the live
   * head normally, or the scrubbed-to `game.stateAt(k)` while the history slider is scrubbed back
   * (Task 5.6). Playwright asserts on this to prove scrubbing changed the rendered piece count.
   */
  getState(): GameState;
  /**
   * The status-banner history context (Task 5.2): `{ history: { canUndo, canRedo, canReset } }`.
   * Passed as the banner widget's `update` config so its Undo/Redo/Reset buttons reflect
   * availability from the `Game` the scene owns (a history fact `GameState` cannot carry).
   */
  getBannerContext(): BannerContext;
  /**
   * The read-only local history scrub readout (Task 5.6): `{ maxPly, viewedPly, scrubbing }`. The
   * history slider reads this to derive its range/label; `maxPly` reports the untouched canonical
   * `Game` head, so a test can prove the scrub is viewer-local (history intact while rendered).
   */
  getHistory(): HistoryReadout;
  /**
   * The seat-turn gate readout (Task 6.2, issue #4c): `{ offTurnBlocks }` — how many placement
   * attempts the scene rejected as off-turn in the networked game. Lets Playwright prove an off-turn
   * click was blocked (board unchanged AND this counter advanced), and that the subtle banner cue
   * fired (the banner's flash counter mirrors this) — observable behavior, not a log line (#3).
   */
  getTurnGate(): TurnGateReadout;
  /**
   * Scrub the LOCAL view to ply `k` (Task 5.6, read-only): re-render `game.stateAt(k)` for the
   * local viewer WITHOUT mutating the canonical `Game` (log / cursor / headHash untouched). A
   * `k >= maxPly` snaps back to live. Emits/syncs nothing — distinct from `undo` (GLOSSARY).
   */
  scrubTo(k: number): void;
  /**
   * Subscribe to board state changes (Task 5.2): `listener` fires after EVERY state change
   * (place / undo / redo / reset / temp-confirm), so the UI shell can repaint its widgets no
   * matter what triggered the change (button / hotkey / canvas click). Returns an unsubscribe fn.
   */
  onStateChange(listener: () => void): () => void;
  /**
   * Subscribe to genuinely-new-LOCAL-GAME events (issue #7): `listener` fires exactly when the scene
   * installs a fresh local `Game` OBJECT — a `reset` (new local game) or a `loadGame` (restore /
   * archive load). It does NOT fire for an ordinary move, undo/redo, a scrub, or a networked-move
   * adoption (`adoptNetState` renders the session's game without swapping the scene-local one). This
   * is the LOCAL game-boundary signal the app's autosave uses to bump its lifecycle `generation`
   * explicitly, so a new archive record is minted only at a real boundary — NOT on every remote-move
   * `Game`-object swap the networked session performs (the issue #7 per-move-record bug). Returns an
   * unsubscribe fn. Fires from within `reset` / `loadGame` (after the swap), no matter the trigger
   * source (button, hotkey, or a programmatic `dispatch('reset')`), so no boundary is missed.
   */
  onNewGame(listener: () => void): () => void;
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
  /**
   * Push an input scope onto the stack (Task 5.3): a UI modal/mode enters by pushing its scope
   * (e.g. the menu modal pushes a `blocking` scope so stray keys are swallowed). The scene owns
   * the stack; the UI shell drives it through here so the widget never imports the input module.
   */
  pushScope(scope: Scope): void;
  /** Pop the topmost input scope (Task 5.3): a UI modal/mode leaves by popping its scope. */
  popScope(): void;
  /** Dispatch a command by id — the same registry keys use (button path). */
  dispatch(id: string): boolean;
  /**
   * Wire the `openSettings` command (Task 5.4) to the mounted settings-modal widget's open().
   * The scene does not own the modal (a UI widget), so the app registers the opener here after
   * mounting the UI. Dispatching `openSettings` (menu entry or keybinding) then opens the modal.
   */
  setOpenSettings(open: () => void): void;
  /**
   * Wire the `showHelp` command (Task 5.7) to the mounted help-overlay widget's open(). The scene
   * does not own the overlay (a UI widget), so the app registers the opener here after mounting the
   * UI. Dispatching `showHelp` (the `?` keybinding or any UI trigger) then opens the overlay.
   */
  setOpenHelp(open: () => void): void;
  /**
   * Wire the `loadGame` command (Task 5.8) to the mounted archive-browser widget's open(). The
   * scene does not own the browser (a UI widget reading the IndexedDB archive), so the app registers
   * the opener here after mounting the UI. Dispatching `loadGame` (menu "Load" entry or keybinding)
   * then opens the browser.
   */
  setOpenArchive(open: () => void): void;
  /**
   * Wire the `openNetwork` command (Task C.2, issue #13) to the mounted Network-Game-panel widget's
   * open(). The scene does not own the panel (a UI widget wrapping the Host/Join controls + code
   * picker in the drawer), so the app registers the opener here after mounting the UI. Dispatching
   * `openNetwork` (the menu's "Network Game" entry or a keybinding) then opens the panel.
   */
  setOpenNetwork(open: () => void): void;
  /**
   * Swap a reconstructed `Game` into the scene (Task 5.8): replace the live game, clear any scrub,
   * and reconcile every state-derived mesh to the loaded head. Used to restore an autosaved game on
   * boot and to load an archived game chosen in the browser — observable via `getState`/`getHistory`.
   */
  loadGame(loaded: Game): void;
  /**
   * The live canonical `Game` the scene owns (Task 5.8): the autosave source — the app reads its
   * event log to persist the current game to the archive. Returned live (not a copy); the app treats
   * it read-only.
   */
  getGame(): Game;
  /**
   * The `headHash` of the AUTHORITATIVE game (Task 6.1, issue #4): the networked session's game log
   * hash when a net game is live, else the local game's head. The inspect API surfaces this so a
   * two-client test can prove both peers converged to an identical head (observable behavior, #3).
   */
  getHeadHash(): string;
  /**
   * Re-broadcast the networked session's current authoritative log to the room (Task 6.7). A no-op
   * offline (no live session). Idempotent by design (adopting an already-received log is a receiver
   * no-op via `decideSync`), so it never moves a peer backward — it only fills the LIVE relay's
   * non-retained subscription gap, letting a two-context live-relay e2e converge deterministically.
   */
  resync(): void;
  /**
   * Leave the networked room (the "Leave room" capability): the app disconnects the session's
   * transport (dropping this client's presence so the peer observes it depart) and returns offline.
   * A no-op offline. Wired to `session.disconnect()`; surfaced so a two-context e2e can drive a
   * graceful peer drop and prove the surviving client auto-cancels a pending proposal (`onPeerGone`).
   */
  leaveNet(): void;
  /**
   * The LIVE sources the help overlay generates its shortcut list from (Task 5.7): the registered
   * command ids + the current `key→commandId` bindings. The overlay derives its rows from these so
   * it can never drift from what the keys actually do (design Part 6; agent-principles #8).
   */
  getHelpSources(): HelpSources;
  /**
   * Wire the networking hooks (Task 5.5) to the app's net session (constructed after the scene, as
   * it needs a DB + transport). Dispatching `hostGame` / `joinGame` (menu entry, button, or key)
   * then drives the session; the net widget reads the live readout via {@link getNet}.
   */
  setNetHooks(hooks: NetHooks): void;
  /**
   * Adopt + render the session's authoritative game state (Task 6.1, issue #4). The app calls this on
   * every session change so a REMOTE move (adopted by the transport pump) re-renders the board — the
   * render half of "ONE authoritative game per session". A no-op when no session is live (offline /
   * stopped): the scene keeps rendering its own local game. Observable via `getState`/`getPieces`.
   */
  adoptNetState(): void;
  /** The live networking-session readout the net widget renders (offline until a session is wired). */
  getNet(): NetSessionState;
  /**
   * The OUT-OF-BAND handshake readout (N.1, issues #12/#18): the session's current
   * {@link HandshakeState}. Surfaced on `window.__pente.getHandshake` so a two-context e2e proves an
   * ask crossed the relay (the peer shows an INCOMING pending) and resolved (the proposer shows an
   * `accepted` resolution) — observable behavior, not a log line. Idle/offline until a session wires.
   */
  getHandshake(): HandshakeState;
  /** Raise an out-of-band proposal (N.1); returns `true` if raised, `false` offline. Drives #12/#18. */
  propose(action: string): boolean;
  /** Respond accept/decline to the incoming proposal (N.1); `true` if a response was sent, else `false`. */
  respond(accepted: boolean): boolean;
  /**
   * The INCOMING networked undo/redo accept/decline PROMPT (Task N.3.2, issue #18): `show` is `true`
   * only when the peer's undo/redo proposal awaits our response; the copy names the opponent color
   * (fixed `Player` union, rendered via `textContent`). Surfaced on `window.__pente.getUndoRedoPrompt`
   * so a two-context e2e proves B sees "<color> wants to undo" when A proposes. Hidden offline.
   */
  getUndoRedoPrompt(): UndoRedoPrompt;
  /** Stash a validated join code for the next `joinGame` dispatch (Task 5.5 argument seam). */
  setPendingJoinCode(code: string): void;
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
   * The live pick-sphere radius (world units) for a node, or null off-board — lets a test prove
   * an empty node's hitbox is marker-sized and an occupied node's piece-sized (issue #3).
   */
  pickRadiusOf(node: Coord): number | null;
  /**
   * Per-node perpendicular distance (world units) from the camera ray at an NDC position, plus
   * each node's depth along the ray — a test-driver seam for the issue #3 occlusion regression.
   */
  rayNodeDistances(
    ndcX: number,
    ndcY: number,
  ): { node: NodeKey; distance: number; depth: number }[];
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

  // Board edge length, resolved from the layered `board` config (Task 5.4: the settings modal
  // writes `board.size`; it takes effect on reload, like every other config section — the whole
  // board is rebuilt from N, so there is no in-place resize). No magic value: the default lives
  // in `config/defaults/board.json` (the SSOT), not here.
  const BOARD_SIZE = (getConfig('board') as unknown as { size: number }).size;

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

  // Genuinely-new-LOCAL-GAME subscribers (issue #7): fired only when the scene swaps in a fresh local
  // `Game` object — a `reset` or a `loadGame`. This is the LOCAL game-boundary signal the app's
  // autosave lifecycle bumps its `generation` off, INSTEAD of inferring "new game" from `Game` object
  // identity (which a networked session changes every remote move, minting a spurious record per ply).
  const newGameListeners = new Set<() => void>();
  function notifyNewGame(): void {
    for (const listener of newGameListeners) listener();
  }

  // Seat-turn gate (Task 6.2, issue #4c): the running count of placement attempts rejected because it
  // was not the local seat's turn in the networked game. Incremented once per blocked attempt (never on
  // a legal or local placement); the banner mirrors it to fire the subtle off-turn cue and Playwright
  // asserts on it to prove the board was left unchanged (observable behavior, not a log line — #3).
  let offTurnBlocks = 0;
  function getTurnGate(): TurnGateReadout {
    return { offTurnBlocks };
  }

  /** Reconcile every state-derived mesh set (markers + pieces + win line + pick hitboxes) to one `GameState`. */
  function syncBoard(state: GameState): void {
    markers.sync(state);
    pieces.sync(state);
    winLine.sync(state);
    // Resize each node's invisible pick sphere to its current occupancy (issue #3): an
    // occupied node's hitbox grows to its piece, an emptied one shrinks back to its marker, so
    // picking stays truthful ("what you see is what you can hit") across every board change.
    picking.sync(state);
    notifyStateChanged();
  }

  // Read-only local history scrub (Task 5.6). `scrubIndex` is the ply the LOCAL viewer is looking
  // at, or `null` when live (the head). It is a pure view overlay: the canonical `game` (its log /
  // cursor / headHash) is NEVER touched by scrubbing — only which snapshot we reflect into the
  // meshes changes. `renderState()` is the single source of "what is on screen": the scrubbed
  // snapshot while scrubbing, else the live head. Every live mutation (place/undo/redo/reset)
  // routes through `commitLive`, which clears the scrub so a real move always snaps back to live.
  let scrubIndex: number | null = null;

  /** The state currently reflected into the meshes: the scrubbed snapshot, or the live head. */
  function renderState(): GameState {
    return scrubIndex === null ? game.state() : game.stateAt(scrubIndex);
  }

  /** Clear any scrub and reconcile the meshes to the live head — every real state change flows here. */
  function commitLive(): void {
    scrubIndex = null;
    syncBoard(game.state());
  }

  syncBoard(renderState());

  // Hover (Task 4.7): the PURE `computeHoverTarget` turns a raycast hit + live state + the
  // node↔line index into a highlight set (empty-node vs placed-sphere vs line, visible-only,
  // the placed-sphere asymmetry — game-core Part 4); the glue applies the emissive boost.
  const hoverLookup: HoverLookup = buildHoverLookup(generateAllLines(BOARD_SIZE));
  // Hover glow colour + emissive boost (design Part 4 "interaction: hover glow intensity"). Kept as
  // live-mutable state (NOT read once at construction) so an `interaction`/`colors`/`rendering` edit
  // applies to the NEXT hover with no reload — `applyConfig` re-reads config and updates these, and
  // `applyHoverHighlight` uses them (re-hovering repaints the glow with the new colour/intensity).
  let hoverHighlight = (getConfig('colors') as unknown as { hoverHighlight: string }).hoverHighlight;
  let emissiveBoost = (getConfig('rendering') as unknown as { emissiveBoost: number }).emissiveBoost;
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
  // Live-mutable so an `interaction` edit (drag-vs-click threshold / enable) applies to the NEXT
  // pointer release with no reload — `applyConfig('interaction')` re-reads and reassigns this.
  let dragGuard = (getConfig('interaction') as unknown as { dragGuard: DragGuardConfig })
    .dragGuard;

  // Camera presets (Task 4.6): resolve the active `controls` preset (PURE) and BIND it to
  // the OrbitControls (IO glue) — mouse-button mapping, speeds, invert, zoom limits. Only the preset
  // IDENTITY (name + orbit/pan button choice) is retained; speeds/limits/mouseButtons are read LIVE
  // off the controls in getCameraPreset, so the readout never diverges from the actual controller.
  const resolvedControls = resolveCameraPreset(getConfig('controls') as unknown as ControlsConfig);
  const applied = applyCameraPreset(controls, resolvedControls);
  const appliedPresetTag: AppliedPresetTag = {
    name: applied.name,
    orbitButton: applied.orbitButton,
    panButton: applied.panButton,
  };
  // FUNCTIONAL modifier gate (camera-controls fix): a gesture like web's `pan: "shift+left"` means
  // "LEFT pans WHILE Shift is held". The base map above binds LEFT to the un-modified orbit action;
  // OrbitControls' OWN native ctrl/meta/shift→rotate↔pan inversion then makes Shift+left PAN at press
  // time — we must NOT also rewrite mouseButtons (that would double-invert). This handle only OBSERVES
  // the held modifier (real DOM keydown/keyup on the SAME `window` target the input system uses) so
  // getCameraPreset can report the EFFECTIVE action (LEFT→PAN while Shift held). Disposed on teardown.
  const modifierSwaps = installModifierSwaps(controls, resolvedControls, window);

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
  // The settings-modal open hook (Task 5.4): the `openSettings` command invokes this. The scene
  // does not own the modal (it is a UI widget), so the app sets this to the widget's open() via
  // `setOpenSettings`. Default is a no-op so an unwired/absent modal never crashes on dispatch.
  let openSettingsHook: () => void = () => {};

  // The help-overlay open hook (Task 5.7): the `showHelp` command invokes this. Like the settings
  // modal, the scene does not own the overlay (it is a UI widget), so the app sets this to the
  // widget's open() via `setOpenHelp`. Default is a no-op so an unwired/absent overlay never
  // crashes on dispatch (the `?` keybinding is bound in the tracked defaults from ply 0).
  let openHelpHook: () => void = () => {};

  // The archive-browser open hook (Task 5.8): the `loadGame` command invokes this. Like the
  // settings/help modals, the scene does not own the browser (it is a UI widget that reads the
  // IndexedDB archive), so the app sets this to the widget's open() via `setOpenArchive`. Default is
  // a no-op so an unwired/absent browser never crashes on dispatch (the menu's "Load" entry and any
  // keybinding dispatch this identical id — design Principle 3).
  let openArchiveHook: () => void = () => {};

  // The Network-Game-panel open hook (Task C.2, issue #13): the `openNetwork` command invokes this.
  // Like the settings/help/archive modals, the scene does not own the panel (it is a UI widget that
  // wraps the Host/Join controls in the drawer), so the app sets this to the widget's open() via
  // `setOpenNetwork`. Default is a no-op so an unwired/absent panel never crashes on dispatch (the
  // menu's "Network Game" entry dispatches this identical id — design Principle 3).
  let openNetworkHook: () => void = () => {};

  // Networking seams (Task 5.5). The scene does not own the net SESSION (it needs an IndexedDB
  // handle + a transport — an app-level concern), exactly as it does not own the settings modal.
  // The app wires these hooks after constructing the session (`setNetHooks`), and the net widget
  // reads the live readout through `getNet`. Until wired, `hostGame`/`joinGame` are honest no-ops
  // and `getNet` reports an offline session — never a crash (design Principle 3: the same ids the
  // menu's Host/Join entries and any keybinding dispatch).
  let netHooks: NetHooks = {
    host: () => {},
    join: () => {},
    setPendingJoinCode: () => {},
    getNet: () => ({ phase: 'offline', code: null, seat: null, peerPresent: false, joinError: null }),
    // Until a session is wired, there is no networked game: placements stay local and the scene
    // renders its own game (getNetGameState → null). `place` is never invoked in this state (the
    // scene only routes to it when getNetGameState is non-null), but is a defined no-op returning the
    // local head so the shape is honest — never an undefined method that could crash on dispatch.
    place: (coords: Coord) => place(coords),
    // No live session → no seat turn to enforce; placement is never gated (the local game is
    // unaffected, Task 6.2). Only consulted when getNetGameState is non-null, but honest by default.
    canPlace: () => true,
    getNetGameState: () => null,
    getNetHeadHash: () => null,
    // No live session → nothing to re-broadcast. Honest no-op until wired (never a crash on dispatch).
    resync: () => {},
    // No live session → no room to leave. Honest no-op until wired (never a crash on dispatch).
    leaveNet: () => {},
    // No live session → no handshake: an idle state, and propose/respond are honest no-ops that
    // report `false` (nothing raised/answered), never a crash on dispatch before the session wires.
    getHandshake: () => initialHandshake(),
    propose: () => false,
    respond: () => false,
    // No live session → nothing is proposable and no incoming ask exists. Honest defaults so the banner
    // never shows a networked prompt or enables a networked-only button before the session wires (#18).
    getNetUndoRedoAvail: () => ({ canUndo: false, canRedo: false }),
    getUndoRedoPrompt: () => deriveUndoRedoPrompt(initialHandshake(), null),
  };

  const undoRedoSafe = (fn: () => void): void => {
    try {
      fn();
    } catch {
      // Nothing to undo/redo — a no-op for the hotkey (the button UI reflects availability).
      return;
    }
    // A real undo/redo is a live state change: snap the local view back to live (clears any scrub).
    commitLive();
  };
  // Networked undo/redo is MUTUAL-CONFIRM (issue #18, Task N.3.2): in a live networked game an
  // undo/redo does NOT apply directly — it PROPOSES via the shared N.1 handshake and only both-sides-
  // apply on mutual accept (the app wires the accepted resolution to `session.applyAcceptedUndoRedo`).
  // So when a net game is live the `undo`/`redo` commands publish an out-of-band proposal instead of
  // mutating the local game; offline they apply DIRECTLY (unchanged local single-player behavior). The
  // SAME command id fires from the banner button and any keybinding (design Principle 3), so both route
  // identically — INCLUDING the permission gate. The restricted last-mover-only rule + single-pending
  // invariant (`decideUndo`/`decideRedo` via `canProposeUndo`/`canProposeRedo`, plan N.3 decision 3)
  // is the SAME `getNetUndoRedoAvail()` the button reads to enable/disable itself; the command MUST
  // consult it before minting a proposal, or a wrong-seat player pressing `u`/`r` (or any programmatic
  // dispatch) would BYPASS the gate — publishing an invalid undo of the OPPONENT's move, or superseding
  // an already-pending proposal — since `session.propose` is a generic, action-agnostic mint. Reading
  // the exact flag the button reads is what makes button and keybinding genuinely route identically:
  // the gate lives at the single dispatch site both paths funnel through, not merely on the DOM
  // `disabled` attribute a keybinding never consults. A blocked dispatch is a silent no-op (same as a
  // disabled button); `netHooks.propose` is only reached when the pure gate says this action is
  // proposable right now.
  const undoRedoNet = (action: 'undo' | 'redo', localApply: () => void): void => {
    if (netHooks.getNetGameState() !== null) {
      const avail = netHooks.getNetUndoRedoAvail();
      const proposable = action === 'undo' ? avail.canUndo : avail.canRedo;
      if (proposable) netHooks.propose(action);
      return;
    }
    undoRedoSafe(localApply);
  };
  const commands: Command[] = [
    { id: 'undo', run: () => undoRedoNet('undo', () => game.undo()) },
    { id: 'redo', run: () => undoRedoNet('redo', () => game.redo()) },
    // Reset (Task 5.2): start a brand-new game. Replaces the `Game` instance (undo/redo of a
    // reset is out of scope for v1) and reconciles every state-derived mesh to the pristine
    // state. A no-op reflected in the UI is fine — a pristine game's Reset is disabled anyway.
    {
      id: 'reset',
      run: () => {
        game = new Game(BOARD_SIZE);
        // A reset is a genuine LOCAL game boundary (issue #7): notify FIRST so the app bumps its autosave
        // generation BEFORE the `commitLive` below fires the state-change autosave tick — the tick must
        // observe the bumped generation to detect the boundary and mint a fresh record for the new game.
        notifyNewGame();
        // A fresh game is a live state change: clear any scrub and reflect the pristine head.
        commitLive();
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
    // Open the settings modal (Task 5.4). The modal is a UI widget the scene does not own, so the
    // command invokes a settable hook the app wires to the mounted widget's open(). Until wired
    // (or if the widget is absent) it is an honest no-op — never a crash (design Principle 3: the
    // menu's "Settings" entry and any keybinding dispatch this identical id).
    { id: 'openSettings', run: () => openSettingsHook() },
    // Open the help overlay (Task 5.7). The overlay is a UI widget the scene does not own, so the
    // command invokes a settable hook the app wires to the mounted widget's open(). The `?`
    // keybinding (tracked default) dispatches this identical id (design Principle 3). Until wired
    // (or if the widget is absent) it is an honest no-op — never a crash.
    { id: 'showHelp', run: () => openHelpHook() },
    // Open the archive browser (Task 5.8). The browser is a UI widget the scene does not own (it
    // reads the IndexedDB archive), so the command invokes a settable hook the app wires to the
    // mounted widget's open(). The menu's "Load" entry (commandId `loadGame`) and any keybinding
    // dispatch this identical id (design Principle 3). Until wired (or if the widget is absent) it
    // is an honest no-op — never a crash.
    { id: 'loadGame', run: () => openArchiveHook() },
    // Open the Network-Game panel (Task C.2, issue #13). The panel is a UI widget the scene does not
    // own (it wraps the Host/Join controls + code picker in the non-blocking drawer), so the command
    // invokes a settable hook the app wires to the mounted widget's open(). The menu's "Network Game"
    // entry (commandId `openNetwork`) and any keybinding dispatch this identical id (design Principle
    // 3). Until wired (or if the widget is absent) it is an honest no-op — never a crash.
    { id: 'openNetwork', run: () => openNetworkHook() },
    // Networking (Task 5.5): Host a game / Join by code. The session is an app-level object (needs a
    // DB + transport), so these commands invoke settable hooks the app wires to the net session.
    // Both are argument-free like every command; the join code rides via `setPendingJoinCode` (the
    // widget stashes a validated code before dispatching `joinGame`). Until wired they are no-ops.
    { id: 'hostGame', run: () => netHooks.host() },
    { id: 'joinGame', run: () => netHooks.join() },
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

  /**
   * Position the camera + orbit target directly (test-driver seam, like `scrubTo`). Lets a
   * Playwright test construct a DETERMINISTIC view — e.g. one board node directly behind
   * another along the view ray — so picking/occlusion can be asserted from a known geometry
   * rather than the load-time framing. Updates the projection so `pickAt` rays are correct.
   */
  function setCamera(
    position: { x: number; y: number; z: number },
    target: { x: number; y: number; z: number },
  ): void {
    camera.position.set(position.x, position.y, position.z);
    controls.target.set(target.x, target.y, target.z);
    camera.lookAt(controls.target);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    controls.update();
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

  // Live-previewable colour state (Task 5.4; issue #15 extended it to every colour). The line/background
  // fields are seeded from the `colors` config the objects were built from and mutated in place by
  // `applyColors` (the instanced lines + scene background hold no single readable "base" the way a mesh
  // material does, so we cache what we applied). The marker/piece/temp/win colours are NOT cached here —
  // `getColors` reads them LIVE off the actual Three.js objects (marker base buffer, piece material,
  // temp-preview material, win-line material), so the readout is render truth even for those.
  const previewColors = getConfig('colors') as unknown as {
    background: string;
    lineOpacity: number;
    lineOrthogonal: string;
    lineFaceDiagonal: string;
    lineSpaceDiagonal: string;
    hoverHighlight: string;
  };
  const liveLineColors = {
    background: `#${new THREE.Color(previewColors.background).getHexString()}`,
    lineOpacity: previewColors.lineOpacity,
    lineOrthogonal: `#${new THREE.Color(previewColors.lineOrthogonal).getHexString()}`,
    lineFaceDiagonal: `#${new THREE.Color(previewColors.lineFaceDiagonal).getHexString()}`,
    lineSpaceDiagonal: `#${new THREE.Color(previewColors.lineSpaceDiagonal).getHexString()}`,
  };

  function applyColors(preview: ColorsPreview): ColorsReadout {
    if (preview.background !== undefined) {
      (scene.background as THREE.Color).set(preview.background);
      liveLineColors.background = `#${(scene.background as THREE.Color).getHexString()}`;
    }
    if (preview.lineOpacity !== undefined) {
      liveLineColors.lineOpacity = lines.setOpacity(preview.lineOpacity);
    }
    if (preview.lineOrthogonal !== undefined) {
      liveLineColors.lineOrthogonal = lines.setBaseColor('orthogonal', preview.lineOrthogonal);
    }
    if (preview.lineFaceDiagonal !== undefined) {
      liveLineColors.lineFaceDiagonal = lines.setBaseColor('face', preview.lineFaceDiagonal);
    }
    if (preview.lineSpaceDiagonal !== undefined) {
      liveLineColors.lineSpaceDiagonal = lines.setBaseColor('space', preview.lineSpaceDiagonal);
    }
    // Hover glow (issue #15): re-point the next-hover colour AND repaint any active highlight now.
    if (preview.hoverHighlight !== undefined) {
      hoverHighlight = preview.hoverHighlight;
      applyHoverHighlight();
    }
    // Empty-node markers (issue #15): recolour every non-hovered marker instance live.
    if (preview.emptySphere !== undefined) markers.setColor(preview.emptySphere);
    // Pieces (issue #15): recolour EVERY existing piece mesh of that owner + retarget the template.
    if (preview.whitePiece !== undefined || preview.blackPiece !== undefined) {
      pieces.setColors({ whitePiece: preview.whitePiece, blackPiece: preview.blackPiece });
    }
    // Temp/preview piece (issue #15): recolour the translucent placement-preview mesh live.
    if (preview.tempPiece !== undefined) tempMaterial.color.set(preview.tempPiece);
    // Winning line (issue #15): recolour the win-line material (a shown line recolours; a future win too).
    if (preview.winningLine !== undefined) winLine.setColor(preview.winningLine);
    return getColors();
  }

  /**
   * The colours actually applied to the scene, read back off the real Three.js objects (issue #15). The
   * line/background fields come from the cached applied values (the instanced lines carry no readable
   * single base); the marker/piece/temp/win/hover fields are read LIVE off the marker instance buffer,
   * the piece material template, the temp-preview material, the win-line material, and the current hover
   * colour — so every colour is render truth, never an inferred value (agent-principles #3).
   */
  function getColors(): ColorsReadout {
    const pieceColors = pieces.getColors();
    return {
      ...liveLineColors,
      hoverHighlight: `#${new THREE.Color(hoverHighlight).getHexString()}`,
      emptySphere: markers.getMarkers().baseColorHex,
      whitePiece: pieceColors.whitePiece,
      blackPiece: pieceColors.blackPiece,
      tempPiece: `#${tempMaterial.color.getHexString()}`,
      winningLine: `#${new THREE.Color(winLine.getWinLine().color).getHexString()}`,
    };
  }

  /**
   * Re-read + live-apply the WHOLE `colors` section (Task A.3; issue #15 extended it to every colour):
   * background, gridline opacity, the three line colours, the hover glow, the empty-node markers, both
   * piece colours (existing + future meshes), the temp-preview piece, and the win line — all through
   * {@link applyColors}. Reads the whole section from `getConfig` (the SSOT), not a passed-in value.
   */
  function applyColorsSection(): void {
    const c = getConfig('colors') as unknown as {
      background: string;
      lineOpacity: number;
      lineOrthogonal: string;
      lineFaceDiagonal: string;
      lineSpaceDiagonal: string;
      hoverHighlight: string;
      emptySphere: string;
      whitePiece: string;
      blackPiece: string;
      tempPiece: string;
      winningLine: string;
    };
    applyColors({
      background: c.background,
      lineOpacity: c.lineOpacity,
      lineOrthogonal: c.lineOrthogonal,
      lineFaceDiagonal: c.lineFaceDiagonal,
      lineSpaceDiagonal: c.lineSpaceDiagonal,
      hoverHighlight: c.hoverHighlight,
      emptySphere: c.emptySphere,
      whitePiece: c.whitePiece,
      blackPiece: c.blackPiece,
      tempPiece: c.tempPiece,
      winningLine: c.winningLine,
    });
  }

  /**
   * Re-read + live-apply the `lighting` section (Task A.3): ambient + directional colour/intensity and
   * the directional light's position. Resolved through the SAME pure `resolveSceneConfig` the scene was
   * built from (no magic values), so a live edit matches a reload. Background stays a `colors` concern.
   */
  function applyLighting(): void {
    const r: ResolvedSceneConfig = resolveSceneConfig(getConfig('lighting'), getConfig('colors'));
    ambient.color.set(r.ambient.color);
    ambient.intensity = r.ambient.intensity;
    dir.color.set(r.directional.color);
    dir.intensity = r.directional.intensity;
    dir.position.set(r.directional.position.x, r.directional.position.y, r.directional.position.z);
  }

  /**
   * Re-read + live-apply the surface `materials`/`rendering` (Task A.3): marker + piece roughness /
   * metalness / opacity onto the shared/per-piece `MeshStandardMaterial`s (each flags its own
   * `needsUpdate`), and the hover emissive boost for the next hover. Both sections feed one apply
   * because they jointly define surface appearance (opacity ← `materials`, gloss ← `rendering`).
   */
  function applyMaterials(): void {
    const m = getConfig('materials') as unknown as { markerOpacity: number; pieceOpacity: number };
    const rn = getConfig('rendering') as unknown as {
      marker: { roughness: number; metalness: number };
      piece: { roughness: number; metalness: number };
      emissiveBoost: number;
    };
    markers.setMaterial({
      roughness: rn.marker.roughness,
      metalness: rn.marker.metalness,
      opacity: m.markerOpacity,
    });
    pieces.setMaterial({
      roughness: rn.piece.roughness,
      metalness: rn.piece.metalness,
      opacity: m.pieceOpacity,
    });
    emissiveBoost = rn.emissiveBoost;
    // Re-apply the current hover with the new glow intensity so an active highlight updates at once.
    applyHoverHighlight();
  }

  /**
   * Re-read + live-apply the `blending` section (Task A.3): each line category's additive-vs-normal
   * composite, resolved through the pure `resolveLineBlending` (which validates every mode honestly).
   */
  function applyBlending(): void {
    const resolved = resolveLineBlending(getConfig('blending') as unknown as BlendingConfig);
    for (const category of LINE_CATEGORIES) lines.setBlending(category, resolved[category]);
  }

  /**
   * Re-read + live-apply the `lineVisibility` section (Task A.3): toggle each of the three line-category
   * groups to the config's default-on flags, resolved through the pure `resolveLineVisibility`. Mirrors
   * the flag into `lineVisible` so hover's visible-only filter stays truthful.
   */
  function applyLineVisibility(): void {
    const resolved = resolveLineVisibility(
      getConfig('lineVisibility') as unknown as LineVisibilityConfig,
    );
    for (const category of LINE_CATEGORIES) {
      lineVisible[category] = resolved[category];
      lines.setVisible(category, resolved[category]);
    }
  }

  /** Re-read + live-apply the `interaction` section (Task A.3): the drag-vs-click guard for the next release. */
  function applyInteraction(): void {
    dragGuard = (getConfig('interaction') as unknown as { dragGuard: DragGuardConfig }).dragGuard;
  }

  /**
   * Live-apply a config SECTION to the running scene (Task A.3, issue #15) — see the {@link SceneHandle}
   * doc for the full live-vs-excluded contract. Dispatches to the section's applier; the excluded
   * sections (`board`/`controls`/`geometry`) and the non-scene sections are EXPLICIT no-ops (documented,
   * never a silent gap). The single seam the app's `onConfigChange` loop calls on every config change.
   */
  function applyConfig(section: ConfigSection): void {
    switch (section) {
      case 'colors':
        applyColorsSection();
        return;
      case 'lighting':
        applyLighting();
        return;
      // Both feed the surface apply (opacity ← materials, gloss/emissive ← rendering).
      case 'materials':
      case 'rendering':
        applyMaterials();
        return;
      case 'blending':
        applyBlending();
        return;
      case 'lineVisibility':
        applyLineVisibility();
        return;
      case 'interaction':
        applyInteraction();
        return;
      // Excluded, on purpose (baked into instanced buffers / grid / OrbitControls at construction — a
      // live change would need an unsafe mid-game mesh/controls rebuild): they take effect next game /
      // on reload, matching the persisted-override contract. Not scene concerns: keybindings/layout/relay.
      case 'board':
      case 'controls':
      case 'geometry':
      case 'keybindings':
      case 'layout':
      case 'relay':
      // #20 move-notifications config (title-flash / browser-notification / sound): a networking-UX
      // section the SESSION glue consumes, NOT the scene — an explicit no-op here, never a silent gap.
      case 'notifications':
        return;
    }
  }

  function getInteraction(): DragGuardConfig {
    return { enabled: dragGuard.enabled, thresholdPx: dragGuard.thresholdPx };
  }

  function getState(): GameState {
    // In a networked game the SESSION owns the authoritative game (Task 6.1, issue #4): report its
    // state so getState matches the rendered board (and the peer's) — the single source of truth,
    // never the disconnected scene-local game. History scrubbing is a local-game feature; a net game
    // is always live, so getNetGameState (when non-null) supersedes the scrub view here.
    const netState = netHooks.getNetGameState();
    if (netState !== null) return netState;
    // Otherwise report the RENDERED local state (the scrubbed snapshot while reviewing, else the live
    // head) so a history scrub is observable via getState — the piece count matches on screen (5.6).
    return renderState();
  }

  /**
   * The banner's history-reachability context (Task 5.2). The status banner's Undo/Redo/Reset
   * buttons reflect availability without probing (which would throw); these flags come from the
   * `Game` the scene owns — `GameState` alone cannot know its ply or redo tail. `canReset` is
   * true whenever the game is not pristine (a move was made or an undone tail remains).
   */
  function getBannerContext(): BannerContext {
    // In a LIVE networked game (Task N.3.2, issue #18) Undo/Redo are mutual-confirm PROPOSALS, so the
    // buttons enable on whether a PROPOSAL is currently valid (restricted last-mover-only rule + no
    // pending ask — the session's `canProposeUndo`/`canProposeRedo`), NOT on the local ply/redo-tail.
    // This is what LIGHTS UP the previously-grayed networked buttons. Offline the buttons use the
    // scene's own local history facts (unchanged single-player behavior). `canReset` stays local — a
    // reset is not part of the #18 handshake. Only branch when a net game is authoritative.
    const netLive = netHooks.getNetGameState() !== null;
    const netAvail = netHooks.getNetUndoRedoAvail();
    return {
      history: {
        canUndo: netLive ? netAvail.canUndo : game.canUndo(),
        canRedo: netLive ? netAvail.canRedo : game.canRedo(),
        canReset: game.canUndo() || game.canRedo(),
      },
      // The seat-turn gate's running block count (Task 6.2). The banner compares it to the count it
      // last saw and, when it advanced, briefly pulses the "X to move" line — the subtle off-turn cue.
      offTurnBlocks,
      // The INCOMING networked undo/redo accept/decline prompt (Task N.3.2, issue #18): the session's
      // pure `deriveUndoRedoPrompt` over the handshake + seat. The banner surfaces it (not the end-state
      // overlay — the game is not over) and renders the opponent-derived copy via `textContent`.
      undoRedoPrompt: netHooks.getUndoRedoPrompt(),
    };
  }

  /**
   * The read-only local history scrub readout (Task 5.6). `maxPly` is the untouched canonical
   * `Game` head; `viewedPly` is the ply currently rendered (`maxPly` when live, `scrubIndex` while
   * scrubbing). `scrubbing` is true iff the viewer is back off the head.
   */
  function getHistory(): HistoryReadout {
    const maxPly = game.ply();
    const viewedPly = scrubIndex === null ? maxPly : scrubIndex;
    return { maxPly, viewedPly, scrubbing: scrubIndex !== null };
  }

  /**
   * Scrub the LOCAL view to ply `k` (Task 5.6, read-only). Reflects `game.stateAt(k)` into the
   * meshes WITHOUT touching the canonical `Game`. A `k` at/after the live head snaps back to live
   * (`scrubIndex = null`); otherwise the earlier snapshot is shown. Emits/syncs nothing.
   *
   * READ-ONLY LOCK (#17, agent-principles #7): this seam MUST NOT reach the networked session — no
   * `netHooks.place` / `netHooks.resync` / `netHooks.propose` / any publish. It only mutates the
   * local `scrubIndex` and repaints. `e2e/historyLocalLock.spec.ts` counts transport publishes and
   * asserts a networked scrub adds ZERO; adding ANY `netHooks.*` publish here (e.g. `netHooks.resync()`)
   * makes that spec go red. Keep it local.
   */
  function scrubTo(k: number): void {
    scrubIndex = k >= game.ply() ? null : k;
    syncBoard(renderState());
  }

  /** Subscribe to board state changes; returns an unsubscribe fn (Task 5.2). */
  function onStateChange(listener: () => void): () => void {
    stateChangeListeners.add(listener);
    return () => stateChangeListeners.delete(listener);
  }

  /** Subscribe to genuinely-new-local-game events (reset / load, issue #7); returns an unsubscribe fn. */
  function onNewGame(listener: () => void): () => void {
    newGameListeners.add(listener);
    return () => newGameListeners.delete(listener);
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
    // Read the speeds/limits LIVE off the controls (tagged with the applied preset identity) and the
    // EFFECTIVE mouseButtons via the modifier handle, so the readout reflects the controller's current
    // state AND any held modifier gate (web: LEFT reads PAN while Shift is down) — the observables a
    // wrongly-live `controls` re-apply or a broken modifier gate would move (agent-principles #3).
    return readCameraPreset(controls, appliedPresetTag, modifierSwaps);
  }

  function getInput(): InputReadout {
    return input.readout();
  }

  function dispatch(id: string): boolean {
    return input.dispatch(id);
  }

  function setOpenSettings(open: () => void): void {
    openSettingsHook = open;
  }

  /** Wire the `showHelp` command (Task 5.7) to the mounted help-overlay widget's open(). */
  function setOpenHelp(open: () => void): void {
    openHelpHook = open;
  }

  /** Wire the `loadGame` command (Task 5.8) to the mounted archive-browser widget's open(). */
  function setOpenArchive(open: () => void): void {
    openArchiveHook = open;
  }

  /** Wire the `openNetwork` command (Task C.2) to the mounted Network-Game-panel widget's open(). */
  function setOpenNetwork(open: () => void): void {
    openNetworkHook = open;
  }

  /**
   * Swap a reconstructed game into the scene (Task 5.8 restore/load). Replaces the live `Game` with
   * `loaded` (e.g. an autosaved game restored on boot, or an archived game chosen in the browser),
   * clears any history scrub, and reconciles every state-derived mesh set to the loaded head — so
   * the board immediately reflects the restored game (observable via `getState`/`getHistory`). The
   * loaded game keeps its full event log, so undo/redo and the history slider work on it unchanged.
   */
  function loadGame(loaded: Game): void {
    game = loaded;
    // A load is a genuine LOCAL game boundary (issue #7): notify FIRST so the app bumps its autosave
    // generation BEFORE the `commitLive` tick observes it. (The boot-restore path re-seeds its
    // lifecycle from the post-bump generation, so a restore resumes its record — see main.ts.)
    notifyNewGame();
    // A load is a live state change: clear any scrub and reflect the loaded head.
    commitLive();
  }

  /** The live canonical `Game` the scene owns (Task 5.8 autosave source — the app persists its log). */
  function getGame(): Game {
    return game;
  }

  /**
   * The `headHash` of the AUTHORITATIVE game (Task 6.1, issue #4): the session's game log hash when a
   * networked game is live, else the local game's head. Lets `window.__pente.getHeadHash` report the
   * SHARED fingerprint so a two-client test can prove convergence to an identical head — and so a net
   * move (which does not touch the local game) is observable as a changed head.
   */
  function getHeadHash(): string {
    return netHooks.getNetHeadHash() ?? headHash(game.log);
  }

  /**
   * Re-broadcast the networked session's current authoritative log (Task 6.7). Delegates to the net
   * hook (which calls the SyncEngine's `publishState`); a no-op offline. Used by the two-context
   * live-relay e2e to fill the relay's subscription gap — never changes local state (idempotent).
   */
  function resync(): void {
    netHooks.resync();
  }

  /** Leave the networked room via the session (drops presence so the peer sees us depart); no-op offline. */
  function leaveNet(): void {
    netHooks.leaveNet();
  }

  /** The session's OUT-OF-BAND handshake readout (N.1, #12/#18); idle until a session wires. */
  function getHandshake(): HandshakeState {
    return netHooks.getHandshake();
  }

  /** Raise an out-of-band proposal via the session (N.1); `false` offline. Drives #12/#18. */
  function propose(action: string): boolean {
    return netHooks.propose(action);
  }

  /** Respond accept/decline to the incoming proposal via the session (N.1); `false` if none. */
  function respond(accepted: boolean): boolean {
    return netHooks.respond(accepted);
  }

  /**
   * The INCOMING undo/redo accept/decline prompt (Task N.3.2, issue #18): the session's pure
   * `deriveUndoRedoPrompt` over the handshake + seat. The banner surfaces it (not the end-state
   * overlay — the game is not over); Playwright reads it via `window.__pente.getUndoRedoPrompt`.
   * Hidden offline / with no incoming ask.
   */
  function getUndoRedoPrompt(): UndoRedoPrompt {
    return netHooks.getUndoRedoPrompt();
  }

  /**
   * The LIVE sources the help overlay generates its shortcut list from (Task 5.7): the registered
   * command ids (from the same registry keybindings dispatch through) + the current `key→commandId`
   * bindings (the tracked `keybindings` config). The overlay derives its rows from these, so it can
   * never drift from what the keys actually do (design Part 6 "generated from the command registry";
   * agent-principles #8: no duplicated volatile facts).
   */
  function getHelpSources(): HelpSources {
    return { commandIds: input.registry.ids(), bindings: keybindings };
  }

  /** Wire the networking hooks (Task 5.5) to the app's net session, after it is constructed. */
  function setNetHooks(hooks: NetHooks): void {
    netHooks = hooks;
  }

  /** The live networking-session readout the net widget renders (offline until a session is wired). */
  function getNet(): NetSessionState {
    return netHooks.getNet();
  }

  /** Stash a validated join code for the next `joinGame` dispatch (the argument seam, Task 5.5). */
  function setPendingJoinCode(code: string): void {
    netHooks.setPendingJoinCode(code);
  }

  // Scope-stack drivers for UI modals/modes (Task 5.3). The scene owns the `input` stack; the UI
  // shell pushes/pops through these so a widget (e.g. the menu modal) never imports the input
  // module. A blocking modal scope swallows stray keys while it is on top (GLOSSARY "Blocking
  // scope"); popping restores the underlying game/camera scopes.
  function pushScope(scope: Scope): void {
    input.push(scope);
  }

  function popScope(): void {
    input.pop();
  }

  function pressKey(chord: string): KeyResolution {
    return input.handleChord(chord);
  }

  function place(coords: Coord): GameState {
    // Route through the SESSION when a networked game is live (Task 6.1, issue #4): ONE authoritative
    // game per session. If the session owns the game (getNetGameState non-null), the move goes to the
    // SyncEngine (which applies + publishes it to the peer) and the returned state is the session's
    // authoritative state we render — never a second, disconnected scene-local game. Otherwise it is
    // an ordinary local placement on the scene's own game.
    const netState = netHooks.getNetGameState();
    if (netState !== null) {
      // Seat-turn gate (Task 6.2, issue #4c): in a networked game a client may only place on its own
      // seat's turn. On an OFF-TURN attempt do NOT push a move onto the shared authoritative log —
      // instead record the block (the banner mirrors this into a subtle cue) and return the CURRENT
      // authoritative state UNCHANGED. Local (non-networked) games never reach here, so they are
      // unaffected. The decision is the pure `canPlaceForSeat` gate the session evaluates via canPlace().
      if (!netHooks.canPlace()) {
        offTurnBlocks += 1;
        // Re-render the (unchanged) authoritative state so the banner repaints and the cue fires;
        // notifyStateChanged (inside syncBoard) drives the banner flash. No move is published.
        renderNetState(netState);
        return netState;
      }
      // The engine applies + publishes; IllegalMove / stopped-game errors propagate honestly.
      const placed = netHooks.place(coords);
      renderNetState(placed);
      return placed;
    }
    // `game.place` throws IllegalMove on an illegal move; let it propagate honestly.
    game.place(coords);
    // A placement is a live state change: snap the local view back to live (clears any scrub) and
    // reflect the new head — a piece placed while reviewing history returns the viewer to live.
    commitLive();
    return game.state();
  }

  /**
   * Reflect the SESSION's authoritative game state into the meshes (Task 6.1, issue #4). Used both
   * when a local move routes through the session (above) and when the app adopts a REMOTE move via
   * {@link adoptNetState}. Clears any local scrub (a networked move is always live) and reconciles
   * every state-derived mesh set to the session state — the single render path for a networked game,
   * so a local and a remote move render identically from the one authoritative source.
   */
  function renderNetState(netState: GameState): void {
    scrubIndex = null;
    syncBoard(netState);
  }

  /**
   * Adopt + render the session's current authoritative state (Task 6.1, issue #4). The app calls this
   * on every session change (`session.onChange`), so a peer's move — adopted by the transport pump —
   * re-renders the local board. A no-op when there is no live session (offline / stopped): the scene
   * keeps rendering its own local game. This is the render half of "ONE game per session"; the place
   * half is {@link place}'s session route above.
   */
  function adoptNetState(): void {
    const netState = netHooks.getNetGameState();
    if (netState === null) return;
    renderNetState(netState);
  }

  /** The line categories currently drawn — the visible-only filter for hover. */
  function visibleCategories(): LineCategory[] {
    return (['orthogonal', 'face', 'space'] as const).filter((c) => lineVisible[c]);
  }

  function pickAt(ndcX: number, ndcY: number): RaycastHit | null {
    return picking.pickAt(ndcX, ndcY, camera, game.state(), lines.pickables());
  }

  /**
   * The live pick-sphere radius (world units) for a node — read back off the pick layer so a
   * test can prove an empty node is marker-sized and an occupied node piece-sized (GitHub issue
   * #3 "what you see is what you can hit"). Returns null for an off-board node.
   */
  function pickRadiusOf(node: Coord): number | null {
    return picking.radiusOf(node);
  }

  /**
   * For an NDC pointer position, the perpendicular distance (world units) from the camera ray
   * to each node's centre, paired with each node's depth along the ray — a test-driver seam for
   * the issue #3 occlusion regression. Lets a Playwright test pick, analytically and
   * deterministically, a FAR node A the ray passes within a marker radius of and a NEARER empty
   * node B the ray passes within the OLD piece radius of (but OUTSIDE a marker radius) — exactly
   * the fingerprint of the bug — then assert `pickAt` returns A, not B. THREE-side glue (the ray
   * math needs the live camera), verified via Playwright like the rest of picking.
   */
  function rayNodeDistances(
    ndcX: number,
    ndcY: number,
  ): { node: NodeKey; distance: number; depth: number }[] {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const origin = ray.ray.origin;
    const dir = ray.ray.direction; // unit length
    const out: { node: NodeKey; distance: number; depth: number }[] = [];
    const p = new THREE.Vector3();
    const rel = new THREE.Vector3();
    for (let x = 0; x < BOARD_SIZE; x++) {
      for (let y = 0; y < BOARD_SIZE; y++) {
        for (let z = 0; z < BOARD_SIZE; z++) {
          const node: Coord = [x, y, z];
          const w = picking.worldOf(node);
          p.set(w.x, w.y, w.z);
          rel.subVectors(p, origin);
          const depth = rel.dot(dir); // projection onto the ray
          const distance = Math.sqrt(Math.max(0, rel.lengthSq() - depth * depth));
          out.push({ node: keyOf(node), distance, depth });
        }
      }
    }
    return out;
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
      hoverHighlight,
      emissiveBoost,
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
    modifierSwaps.dispose();
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
    setCamera,
    getLighting,
    getViewportSize,
    getVisibleLines,
    applyColors,
    applyConfig,
    getColors,
    getInteraction,
    getState,
    getBannerContext,
    getHistory,
    getTurnGate,
    scrubTo,
    onStateChange,
    onNewGame,
    getPieces,
    getMarkers,
    getWinLine,
    getCameraPreset,
    getInput,
    pushScope,
    popScope,
    dispatch,
    setOpenSettings,
    setOpenHelp,
    setOpenArchive,
    setOpenNetwork,
    loadGame,
    getGame,
    getHeadHash,
    resync,
    leaveNet,
    getHandshake,
    propose,
    respond,
    getUndoRedoPrompt,
    getHelpSources,
    setNetHooks,
    adoptNetState,
    getNet,
    setPendingJoinCode,
    pressKey,
    place,
    pickAt,
    pickRadiusOf,
    rayNodeDistances,
    hoverAt,
    getHoverTarget,
    clickAt,
    getTemp,
    dispose,
  };
}
