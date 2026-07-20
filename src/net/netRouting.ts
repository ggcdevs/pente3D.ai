/**
 * PURE net-routing decisions (Task 6.1) — the DOM-free, transport-free logic that answers the two
 * questions the scene↔session wiring turns on, separated from the IO glue so it earns the strict
 * unit + mutation gate (like `netModel.ts` / `seats.ts` / `sync.ts`).
 *
 * The core Stage 6 fix (issue #4) is that a networked game must have ONE authoritative game per
 * session: a local placement must be routed through the SyncEngine (so the peer receives it) rather
 * than mutating a second, disconnected scene-local `Game`. Whether a placement routes to the session
 * or stays local — and whether the scene should render the session's game or its own — is a pure
 * function of the plain {@link NetSessionState} readout. Keeping that decision here (rather than as an
 * `if` buried in `scene.ts`) makes the boundary conditions (offline / connecting / connected /
 * conflict) explicitly, negatively testable, so no phase silently falls through to the wrong game.
 *
 * This module imports only the plain `NetSessionState` type — no transport, engine, three, or DOM —
 * so it is unit+mutation-gated to the hard 100% floor the whole `src/net/**` scope carries.
 */

import type { NetSessionState } from '../ui/widgets/netModel';

/** Where a placement flows: through the networked {@link SyncEngine} session, or the scene-local game. */
export type PlacementRoute =
  /** The session is live — route the placement through the SyncEngine so the peer receives it. */
  | 'session'
  /** No live session — the placement mutates the scene-local game (single-player / stopped). */
  | 'local';

/**
 * Decide where a placement should flow for a given session `state` (pure — no side effects).
 *
 *   - `connecting` / `connected` → `session`: a session is live, so the move MUST go through the
 *     SyncEngine to publish to the peer and keep a single authoritative game (issue #4). `connecting`
 *     routes to the session too: the engine exists the instant a host/join begins, so a move made in
 *     the brief connect window is still a synced move, never a silently-dropped scene-local one.
 *   - `offline` → `local`: no session — an ordinary single-player game on the scene's own `Game`.
 *   - `conflict` → `local`: the networked game is STOPPED (the logs forked and both were archived).
 *     Routing a move to the session here would throw (`SyncEngine.assertLive`); the scene falls back
 *     to its local game so a post-conflict board is not wedged. The move is not synced (there is no
 *     live game to sync to) — an honest local-only fallback, not a disguised no-op.
 */
export function placementRoute(state: NetSessionState): PlacementRoute {
  return state.phase === 'connecting' || state.phase === 'connected' ? 'session' : 'local';
}

/**
 * Whether the scene should adopt + render the SESSION's authoritative game rather than its own
 * (pure). True exactly when a placement would route to the session — the two must agree, or the
 * scene could place through the session yet render a stale local game (or vice-versa). Defined in
 * terms of {@link placementRoute} so the single source of "is the session authoritative" cannot
 * drift between the place path and the render path.
 */
export function shouldRenderSessionGame(state: NetSessionState): boolean {
  return placementRoute(state) === 'session';
}
