import type {
  SceneHandle,
  CameraReadout,
  LightingReadout,
  ViewportReadout,
  TempReadout,
  ColorsReadout,
  HistoryReadout,
  TurnGateReadout,
} from '../render/scene.ts';
import { setConfig, type ConfigSection, type ConfigOf } from '../config/config.ts';
import type { DragGuardConfig } from '../input/pointerGesture.ts';
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
import type { NetSessionState } from '../ui/widgets/netModel.ts';
import type { HandshakeState } from '../net/handshake.ts';
import type { EndState } from '../net/endState.ts';
import type { NotifyReadout } from '../net/notifyGlue.ts';
import type { UndoRedoPrompt } from '../net/undoRedo.ts';
import type { HelpSources } from '../ui/widgets/helpModel.ts';
import type { ArchiveListing } from '../ui/widgets/archiveModel.ts';
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
  /**
   * Position the camera + orbit target directly (test-driver seam): lets Playwright construct a
   * deterministic view — e.g. one node behind another along the ray — to assert picking/occlusion
   * from a known geometry (GitHub issue #3 regression). Updates the projection so `pickAt` is correct.
   */
  setCamera(
    position: { x: number; y: number; z: number },
    target: { x: number; y: number; z: number },
  ): void;
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
  /**
   * Live-apply a whole config SECTION to the running Three.js scene with NO reload (Task A.3, issue
   * #15): re-reads `getConfig(section)` and reflects it onto the live objects — the generalization of
   * `applyColors`. Live sections: `colors`/`lighting`/`materials`/`rendering`/`blending`/`interaction`/
   * `lineVisibility`. `board`/`controls`/`geometry` are documented no-ops (baked at construction).
   * Lets Playwright drive a config change and assert the scene reflected it live via getLighting /
   * getMarkers / getPieces / getVisibleLines / getInteraction — observable behavior, not a log line (#3).
   */
  applyConfig(section: ConfigSection): void;
  /**
   * Persist a real config-section override (Task A.3 driver seam), exactly as the settings UI does —
   * `setConfig` writes the partial to localStorage AND emits the section, so the app's `onConfigChange`
   * loop re-applies it live. Lets a Playwright test drive the FULL integration path
   * (write → emitter → onConfigChange → scene.applyConfig) and assert the scene reflected it with NO
   * reload — the cross-component seam that per-module gates would miss (plan §"integration seam").
   */
  setConfig(section: ConfigSection, partial: Record<string, unknown>): void;
  /**
   * The drag-vs-click guard currently in force (Task A.3 `interaction` live-apply readout). Lets
   * Playwright prove an `interaction` edit was applied live (the guard the next pointer release uses
   * changed) — observable behavior, not a log line (agent-principles #3).
   */
  getInteraction(): DragGuardConfig | null;
  /** The live game state (pieces/turn/captures/winner) as plain values. */
  getState(): GameState | null;
  /**
   * The status-banner history context (Task 5.2): `{ history: { canUndo, canRedo, canReset } }`,
   * computed from the scene's `Game`. Lets Playwright assert the Undo/Redo/Reset button
   * availability against real reachability (observable behavior, not a log line — principle #3).
   */
  getBannerContext(): BannerContext | null;
  /**
   * The read-only local history readout (Task 5.6): `{ maxPly, viewedPly, scrubbing }`. `maxPly`
   * reports the UNTOUCHED canonical `Game` head, so a Playwright test can prove a scrub is
   * viewer-local — the rendered state (`getState`) drops later pieces WHILE `maxPly` (and thus the
   * real history) is intact (observable behavior, not a log line — agent-principles #3).
   */
  getHistory(): HistoryReadout | null;
  /**
   * The seat-turn gate readout (Task 6.2, issue #4c): `{ offTurnBlocks }` — how many placement attempts
   * the scene rejected because it was not the local seat's turn in the networked game. Lets Playwright
   * prove an off-turn `place`/`clickAt` was BLOCKED (the board is unchanged AND this counter advanced),
   * distinguishing a genuine rejection from a placement (observable behavior, not a log line — #3).
   */
  getTurnGate(): TurnGateReadout | null;
  /**
   * Scrub the LOCAL view to ply `k` (Task 5.6, read-only): re-render `game.stateAt(k)` for the
   * local viewer without mutating the canonical `Game`; `k >= maxPly` snaps back to live. Lets
   * Playwright drive the scrub programmatically and assert the rendered piece count changed.
   */
  scrubTo(k: number): void;
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
   * The live pick-sphere radius (world units) for a node, or null off-board — lets Playwright
   * prove an empty node's hitbox is marker-sized and an occupied node's piece-sized (GitHub
   * issue #3: "what you see is what you can hit"), observable behavior not a log line (#3).
   */
  radiusOf(node: Coord): number | null;
  /**
   * Per-node perpendicular distance (world units) from the camera ray at an NDC position, plus
   * each node's depth along the ray — a test-driver seam so Playwright can pick, analytically, a
   * far node A and a nearer empty node B whose ray-distance is inside the OLD piece radius but
   * outside a marker radius (the issue #3 occlusion fingerprint) and assert `pickAt` returns A.
   */
  rayNodeDistances(
    ndcX: number,
    ndcY: number,
  ): { node: string; distance: number; depth: number }[];
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
  /**
   * The live networking-session readout (Task 5.5): `phase` / game `code` / `seat` / `peerPresent` /
   * `joinError`, produced off the app's net session (SyncEngine + seat manager). Lets Playwright
   * prove that hosting actually CONNECTS and CLAIMS a seat, and that a join over the shared mock
   * relay reaches `connected` with the other seat — observable behavior, not a log line (#3).
   */
  getNet(): NetSessionState | null;
  /**
   * Stash a validated join code (Task C.2) on the session's pending-code seam — the SAME seam the
   * drawer's Network-Game panel uses before dispatching the argument-free `joinGame` command. Lets a
   * Playwright networking test drive the join path without opening the panel UI (the panel's own
   * DOM-driven join is proven in `netPanel.spec.ts`).
   */
  setPendingJoinCode(code: string): void;
  /**
   * The LIVE sources the help overlay (Task 5.7) generates its shortcut list from: the registered
   * command ids + the current `key→commandId` bindings. Lets Playwright prove the overlay is
   * GENERATED from the real registry + config — every rendered shortcut corresponds to a
   * registered+bound command, and stale/unbound entries are absent (observable behavior, not a log
   * line — agent-principles #3 / #8).
   */
  getHelpSources(): HelpSources | null;
  /**
   * The archived games (Task 5.8): `{ id, meta }` listings read live from the IndexedDB archive
   * (no event logs). Lets Playwright prove the current game was actually AUTOSAVED (a record with
   * the live headHash exists) and that the archive browser's data source is the real archive —
   * observable behavior, not a log line (agent-principles #3). Async because reading IndexedDB is.
   */
  getArchive(): Promise<readonly ArchiveListing[]>;
  /**
   * The live canonical game's `headHash` — the whole-history fingerprint of the event log the app
   * autosaves (GLOSSARY "Hash chain"). Lets Playwright wait DETERMINISTICALLY for an autosave to
   * become durable: an archive record whose `meta.headHash` equals this value IS the current game
   * persisted at the current ply. Without this, a test can only wait on the record COUNT, which is
   * satisfied by an earlier-ply autosave still overwriting toward the head — the concrete race that
   * made the archive load flaky under parallel load (observable behavior, not a log line — #3).
   */
  getHeadHash(): string | null;
  /**
   * Re-broadcast the networked session's current authoritative log to the room (Task 6.7). A no-op
   * offline. Idempotent by design — adopting an already-received log is a receiver no-op
   * (`decideSync` IGNOREs a prefix) — so it never moves a peer backward; it only fills the LIVE
   * relay's non-retained subscription gap. Lets the two-context live-relay e2e converge
   * DETERMINISTICALLY (the mover re-broadcasts until the peer actually receives the move over the
   * real relay — proof-by-behavior, agent-principles #3), without a re-publish loop in the app.
   */
  resync(): void;
  /**
   * Leave the networked room and return to offline (the "Leave room" capability): disconnects the
   * session's transport, which drops this client's presence so the PEER observes a present→absent
   * edge. A no-op offline; idempotent. Lets a two-context e2e drive a GRACEFUL peer drop
   * deterministically and prove the surviving client's session auto-cancels a pending out-of-band
   * proposal (the `onPeerGone` guardrail) — observable behavior on the OTHER client, not a log line.
   */
  leaveNet(): void;
  /**
   * The OUT-OF-BAND ask/accept handshake state (N.1, issues #12/#18): the session's at-most-one
   * pending proposal (its `direction` — `outgoing` = we asked, `incoming` = the peer asked — `action`,
   * and `id`) plus the last `resolution` (`accepted`/`declined`). Held in session memory, NEVER on the
   * append-only move-log. Lets a TWO-CONTEXT e2e prove a proposal actually crossed the relay: after A
   * `propose`s, B's `getHandshake().pending.direction === 'incoming'`; after B `respond(true)`s, A's
   * `getHandshake().resolution.outcome === 'accepted'` — the round-trip observed as real state on the
   * OTHER client, not a log line (agent-principles #3). Idle (`{ pending: null, resolution: null }`)
   * offline.
   */
  getHandshake(): HandshakeState;
  /**
   * Raise an OUTGOING handshake proposal for the opaque `action` (#12 `'rematch'` / #18 `'undo'`),
   * publishing it NON-RETAINED to the peer (out-of-band — never onto the move-log). Returns `true` if
   * raised, `false` offline. The e2e driver for the proposer side of the round-trip.
   */
  propose(action: string): boolean;
  /**
   * Accept (`true`) / decline (`false`) the INCOMING pending proposal, publishing the response so the
   * proposer's outgoing ask resolves. Returns `true` if a response was sent, `false` if there is
   * nothing to answer. The e2e driver for the responder side of the round-trip.
   */
  respond(accepted: boolean): boolean;
  /**
   * The INCOMING networked undo/redo accept/decline PROMPT view-model (Task N.3.2, issue #18): the pure
   * `deriveUndoRedoPrompt` folded from the N.1 handshake + this client's seat. `show` is `true` ONLY
   * when the PEER has an `'undo'`/`'redo'` proposal awaiting our response; `action` is the narrowed
   * `'undo'`/`'redo'`, and `promptText` names the opponent color (fixed `Player` union, never opponent
   * free text). Lets the TWO-CONTEXT e2e prove that after A proposes an undo, B's session surfaces
   * `{ show: true, action: 'undo', promptText: '<color> wants to undo' }` — observable state on the
   * OTHER client, not a log line (#3). Hidden (`{ show: false, action: null, promptText: '' }`) offline.
   */
  getUndoRedoPrompt(): UndoRedoPrompt;
  /**
   * The live networked END-STATE view-model (Task N.2.2, issue #12): the pure `deriveEndState` folded
   * from the AUTHORITATIVE net game + the N.1 handshake + this client's seat — `show` (true only on a
   * finished NET game), `winner`/`winReason`/`iWon`, the enumerated `resultText`, and the `rematchUi`
   * sub-state (`idle`/`proposed-waiting`/`incoming`/`accepted`/`declined`). Lets a two-context e2e prove
   * that BOTH clients surface the view-only overlay when the net game ends, and that after A proposes /
   * B accepts the rematch resolves — observable behavior on the OTHER client, not a log line (#3). The
   * hidden shape (`show: false, rematchUi: 'idle'`) offline / for a local game.
   */
  getEndState(): EndState;
  /**
   * The live move-notification readout (Task N.5.2, issue #20): the current `document.title`, the
   * `baseTitle` the flash restores to, and the fire COUNTERS (`titleFlashCount`, `notificationCount`,
   * `permissionRequests`) plus the last flash/notification copy. Lets a Playwright spec prove — by
   * observable behaviour, never a log line (#3) — that a REMOTE move while the tab is HIDDEN flashed the
   * title to the enumerated your-turn string and that becoming visible RESTORED it, that MY OWN move did
   * NOT, and (with a `Notification` spy) that a browser notification fired only when hidden + permitted.
   * The gate bites: flipping the `notifications` config off must leave `titleFlashCount` unchanged.
   */
  getNotify(): NotifyReadout;
}

/** The app-level archive readouts wired into the inspect API (Task 5.8; the DB lives in `main.ts`). */
export interface ArchiveInspect {
  /** List every archived game as `{ id, meta }` (no logs) — the browser's live data source. */
  listArchive(): Promise<readonly ArchiveListing[]>;
  /**
   * The live networked END-STATE view-model (Task N.2.2) — the app's `getNetEndState` (`main.ts`),
   * exposed here because the end-state is derived in the app (over the net session + seat), not in the
   * scene. Wired onto `window.__pente.getEndState` for the two-context rematch e2e.
   */
  getEndState(): EndState;
  /**
   * The live move-notification readout (Task N.5.2, issue #20) — the app's `getNotifyReadout`
   * (`main.ts`), exposed here because the notify glue is an app-level object (owns `document.title` +
   * the `Notification` API), not scene state. Wired onto `window.__pente.getNotify` for the #20 e2e.
   */
  getNotify(): NotifyReadout;
}

declare global {
  interface Window {
    __pente?: PenteInspect;
  }
}

/** Install `window.__pente`, wired to the live scene + UI handles. Dev/test builds only. */
export function installInspectApi(
  scene: SceneHandle,
  ui: UiHandle,
  archive: ArchiveInspect,
): PenteInspect {
  const api: PenteInspect = {
    getCamera: () => scene.getCamera(),
    setCamera: (position, target) => scene.setCamera(position, target),
    getLighting: () => scene.getLighting(),
    getViewportSize: () => scene.getViewportSize(),
    getVisibleLines: () => scene.getVisibleLines(),
    getColors: () => scene.getColors(),
    // Live-apply a config section to the scene (Task A.3): the same seam the app's onConfigChange loop
    // drives; exposed so Playwright can trigger it directly and assert render truth on the readouts.
    applyConfig: (section: ConfigSection) => scene.applyConfig(section),
    // Real config write (Task A.3 driver seam) — drives the FULL live path: setConfig persists +
    // emits, and main.ts's onConfigChange loop calls scene.applyConfig(section). Cast is the same
    // Partial<ConfigOf<S>> setConfig accepts; the test supplies a well-formed partial for the section.
    setConfig: (section: ConfigSection, partial: Record<string, unknown>) =>
      setConfig(section, partial as Partial<ConfigOf<typeof section>>),
    getInteraction: () => scene.getInteraction(),
    getState: () => scene.getState(),
    getBannerContext: () => scene.getBannerContext(),
    getHistory: () => scene.getHistory(),
    getTurnGate: () => scene.getTurnGate(),
    scrubTo: (k: number) => scene.scrubTo(k),
    getPieces: () => scene.getPieces(),
    getMarkers: (query?: readonly string[]) => scene.getMarkers(query),
    getWinLine: () => scene.getWinLine(),
    place: (coords: Coord) => scene.place(coords),
    getCameraPreset: () => scene.getCameraPreset(),
    getInput: () => scene.getInput(),
    dispatch: (id: string) => scene.dispatch(id),
    pressKey: (chord: string) => scene.pressKey(chord),
    pickAt: (ndcX: number, ndcY: number) => scene.pickAt(ndcX, ndcY),
    radiusOf: (node: Coord) => scene.pickRadiusOf(node),
    rayNodeDistances: (ndcX: number, ndcY: number) => scene.rayNodeDistances(ndcX, ndcY),
    hoverAt: (ndcX: number, ndcY: number) => scene.hoverAt(ndcX, ndcY),
    getHoverTarget: () => scene.getHoverTarget(),
    clickAt: (ndcX: number, ndcY: number) => scene.clickAt(ndcX, ndcY),
    getTemp: () => scene.getTemp(),
    getLayout: () => ui.getLayout(),
    getNet: () => scene.getNet(),
    // Stash a validated join code on the session's pending-code seam (Task C.2): the SAME seam the
    // drawer's Network-Game panel stashes on before dispatching the argument-free `joinGame`. Exposed
    // so a Playwright networking test can drive the join path (stash code → dispatch joinGame) without
    // opening the panel UI — the panel's own DOM-driven join is proven in `netPanel.spec.ts`.
    setPendingJoinCode: (code: string) => scene.setPendingJoinCode(code),
    getHelpSources: () => scene.getHelpSources(),
    getArchive: () => archive.listArchive(),
    // The AUTHORITATIVE game's head hash (Task 6.1, issue #4): the networked session's game when a
    // net game is live, else the local game — so a two-client test proves convergence to one head.
    getHeadHash: () => scene.getHeadHash(),
    // Re-broadcast the authoritative networked log (Task 6.7) — a no-op offline. The two-context
    // live-relay e2e drives this to defeat the relay's subscription gap without weakening the proof.
    resync: () => scene.resync(),
    // Leave the networked room (drops presence so the peer sees us depart) — a no-op offline. The
    // two-context e2e drives this to prove the surviving client auto-cancels a pending proposal.
    leaveNet: () => scene.leaveNet(),
    // Out-of-band ask/accept handshake (N.1, #12/#18): read the pending proposal + last resolution,
    // and drive a proposal/response. Delegates to the scene's net hooks (the live session). A
    // two-context e2e proves the round-trip as real state on the OTHER client (agent-principles #3).
    getHandshake: () => scene.getHandshake(),
    propose: (action: string) => scene.propose(action),
    respond: (accepted: boolean) => scene.respond(accepted),
    // Networked undo/redo accept/decline PROMPT (Task N.3.2, issue #18): the session's pure
    // `deriveUndoRedoPrompt` over the handshake + seat. A two-context e2e reads this to prove B surfaces
    // "<color> wants to undo" after A proposes — observable state on the OTHER client, not a log line.
    getUndoRedoPrompt: () => scene.getUndoRedoPrompt(),
    // Networked end-state view-model (Task N.2.2, issue #12) — the app's `getNetEndState`, exposed so
    // a two-context e2e proves BOTH clients surface the view-only overlay on a net game-over and drive
    // the rematch. Derived in the app (net session + seat), not the scene, so it rides `archive`.
    getEndState: () => archive.getEndState(),
    // Move-notification readout (Task N.5.2, issue #20) — the app's notify glue (`getNotifyReadout`),
    // exposed so the #20 e2e asserts the tab-title flash / browser-notification fired (real title +
    // counters), not a log line. Rides `archive` because the glue is app-level (owns document.title).
    getNotify: () => archive.getNotify(),
  };
  window.__pente = api;
  log.info('window.__pente installed', Object.keys(api));
  return api;
}
