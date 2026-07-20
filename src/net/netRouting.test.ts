import { describe, expect, it } from 'vitest';
import { placementRoute, shouldRenderSessionGame } from './netRouting';
import type { NetSessionState, NetPhase } from '../ui/widgets/netModel';

/**
 * Strict unit + mutation gate for the PURE net-routing decisions (Task 6.1). These functions decide
 * — from the plain session readout alone — whether a placement flows through the networked SyncEngine
 * (the issue #4 fix: ONE authoritative game per session) or stays on the scene-local game, and
 * whether the scene should render the session's game. Every phase is asserted (positive AND negative)
 * so no phase silently routes to the wrong game; a base state is varied per-field to prove the
 * decision depends ONLY on `phase` (killing "read some other field" mutants).
 */

/** A plain session readout in `phase`, with the other fields set so tests prove only phase matters. */
function stateIn(phase: NetPhase): NetSessionState {
  return {
    phase,
    code: phase === 'offline' ? null : 'ABC234',
    seat: phase === 'offline' ? null : 'white',
    peerPresent: false,
    joinError: null,
  };
}

const ALL_PHASES: readonly NetPhase[] = ['offline', 'connecting', 'connected', 'conflict'];

describe('placementRoute', () => {
  it('routes a placement to the SESSION while connecting (the engine exists mid-connect)', () => {
    expect(placementRoute(stateIn('connecting'))).toBe('session');
  });

  it('routes a placement to the SESSION once connected (synced move to the peer)', () => {
    expect(placementRoute(stateIn('connected'))).toBe('session');
  });

  it('routes a placement to the LOCAL game while offline (single-player)', () => {
    expect(placementRoute(stateIn('offline'))).toBe('local');
  });

  it('routes a placement to the LOCAL game in conflict (the session is stopped)', () => {
    // Negative case for the session route: a stopped, forked game must NOT attempt a synced move
    // (the engine would throw); the scene falls back to its local game instead of wedging.
    expect(placementRoute(stateIn('conflict'))).toBe('local');
  });

  it('depends ONLY on phase — the other readout fields do not change the route', () => {
    // Vary peerPresent / seat / code / joinError under a fixed phase and prove the route is stable,
    // so a mutant that reads (say) peerPresent instead of phase is killed.
    const connected: NetSessionState = {
      phase: 'connected',
      code: 'ZZZZ99',
      seat: 'black',
      peerPresent: true,
      joinError: 'room-full',
    };
    expect(placementRoute(connected)).toBe('session');
    const offline: NetSessionState = {
      phase: 'offline',
      code: 'ZZZZ99',
      seat: 'white',
      peerPresent: true,
      joinError: 'connect-failed',
    };
    expect(placementRoute(offline)).toBe('local');
  });

  it('classifies every phase into exactly session-or-local (exhaustive)', () => {
    const session = ALL_PHASES.filter((p) => placementRoute(stateIn(p)) === 'session');
    const local = ALL_PHASES.filter((p) => placementRoute(stateIn(p)) === 'local');
    expect(session).toEqual(['connecting', 'connected']);
    expect(local).toEqual(['offline', 'conflict']);
  });
});

describe('shouldRenderSessionGame', () => {
  it('renders the session game exactly when a placement routes to the session', () => {
    for (const phase of ALL_PHASES) {
      const state = stateIn(phase);
      expect(shouldRenderSessionGame(state)).toBe(placementRoute(state) === 'session');
    }
  });

  it('is true while connecting and connected', () => {
    expect(shouldRenderSessionGame(stateIn('connecting'))).toBe(true);
    expect(shouldRenderSessionGame(stateIn('connected'))).toBe(true);
  });

  it('is false while offline and in conflict', () => {
    expect(shouldRenderSessionGame(stateIn('offline'))).toBe(false);
    expect(shouldRenderSessionGame(stateIn('conflict'))).toBe(false);
  });
});
