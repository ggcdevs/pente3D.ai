import { describe, it, expect } from 'vitest';
import { PresenceTracker, type PresenceSignal } from './presence';

/**
 * Task 6.5 — the PURE presence-liveness evaluator (issue #5: a bogus/dead room must NOT show a
 * phantom "opponent connected"). {@link PresenceTracker} folds a stream of presence signals — each
 * tagged as a RETAINED snapshot, a LIVE announcement, or an ABSENT clear — into the set of peers
 * that are actually live RIGHT NOW. The transport (`mqttTransport.ts`) feeds it real MQTT presence
 * events (the mqtt.js `packet.retain` flag distinguishes a retained snapshot from a live publish);
 * this file exercises the decision logic exhaustively without a network.
 *
 * The one rule that fixes issue #5: a RETAINED-only presence never counts a peer live. A dead peer
 * that crashed leaving a retained `{id}` on the broker is delivered to a fresh joiner as a retained
 * snapshot — it must land in the candidate set (so we can ping it) but NOT the live set. Only a
 * fresh LIVE announcement (our hello handshake reply, or a genuinely-online peer's own live publish)
 * promotes a peer to live. An ABSENT signal (empty payload — a graceful leave or the broker firing
 * a Last-Will) removes a peer from BOTH sets.
 */

/** Fold a sequence of signals into a fresh tracker and return the live-peer snapshot after each. */
function replay(signals: readonly PresenceSignal[]): { tracker: PresenceTracker; live: string[] } {
  const tracker = new PresenceTracker();
  for (const s of signals) tracker.apply(s);
  return { tracker, live: tracker.livePeers() };
}

describe('PresenceTracker — retained never counts as live (issue #5 core)', () => {
  it('a RETAINED presence does NOT make a peer live (phantom-presence guard)', () => {
    const { live, tracker } = replay([{ peerId: 'A', kind: 'retained' }]);
    expect(live).toEqual([]);
    // …but it IS recorded as a candidate we could ping for a live handshake.
    expect(tracker.candidatePeers()).toEqual(['A']);
  });

  it('a LIVE presence DOES make a peer live', () => {
    const { live } = replay([{ peerId: 'A', kind: 'live' }]);
    expect(live).toEqual(['A']);
  });

  it('a retained THEN a live announcement for the same peer promotes it to live', () => {
    const { live } = replay([
      { peerId: 'A', kind: 'retained' },
      { peerId: 'A', kind: 'live' },
    ]);
    expect(live).toEqual(['A']);
  });

  it('a dead room: only a stale retained presence -> NO live peer (the exact issue #5 scenario)', () => {
    // Joiner subscribes to a dead room; the broker replays peer A's stale retained presence. That is
    // the ONLY signal ever received (A is gone and never announces live). The room must show empty.
    const { live, tracker } = replay([{ peerId: 'A', kind: 'retained' }]);
    expect(live).toEqual([]);
    expect(tracker.hasLivePeer()).toBe(false);
  });
});

describe('PresenceTracker — absence clears a peer', () => {
  it('an ABSENT signal removes a live peer', () => {
    const { live } = replay([
      { peerId: 'A', kind: 'live' },
      { peerId: 'A', kind: 'absent' },
    ]);
    expect(live).toEqual([]);
  });

  it('an ABSENT signal removes a retained candidate too', () => {
    const { tracker } = replay([
      { peerId: 'A', kind: 'retained' },
      { peerId: 'A', kind: 'absent' },
    ]);
    expect(tracker.candidatePeers()).toEqual([]);
    expect(tracker.livePeers()).toEqual([]);
  });

  it('absent for an unknown peer is a harmless no-op (never throws, stays empty)', () => {
    const { live, tracker } = replay([{ peerId: 'ghost', kind: 'absent' }]);
    expect(live).toEqual([]);
    expect(tracker.candidatePeers()).toEqual([]);
  });

  it('a peer that leaves then re-announces LIVE is live again', () => {
    const { live } = replay([
      { peerId: 'A', kind: 'live' },
      { peerId: 'A', kind: 'absent' },
      { peerId: 'A', kind: 'live' },
    ]);
    expect(live).toEqual(['A']);
  });

  it('a peer that leaves then only RE-appears retained is NOT live again', () => {
    const { live } = replay([
      { peerId: 'A', kind: 'live' },
      { peerId: 'A', kind: 'absent' },
      { peerId: 'A', kind: 'retained' },
    ]);
    expect(live).toEqual([]);
  });
});

describe('PresenceTracker — multiple peers', () => {
  it('tracks two distinct live peers independently', () => {
    const { live } = replay([
      { peerId: 'A', kind: 'live' },
      { peerId: 'B', kind: 'live' },
    ]);
    expect(live.sort()).toEqual(['A', 'B']);
  });

  it('one live + one retained -> only the live one counts', () => {
    const { live } = replay([
      { peerId: 'A', kind: 'live' },
      { peerId: 'B', kind: 'retained' },
    ]);
    expect(live).toEqual(['A']);
  });

  it('removing one live peer leaves the other', () => {
    const { live } = replay([
      { peerId: 'A', kind: 'live' },
      { peerId: 'B', kind: 'live' },
      { peerId: 'A', kind: 'absent' },
    ]);
    expect(live).toEqual(['B']);
  });

  it('a repeated LIVE for the same peer does not duplicate it', () => {
    const { live } = replay([
      { peerId: 'A', kind: 'live' },
      { peerId: 'A', kind: 'live' },
    ]);
    expect(live).toEqual(['A']);
  });
});

describe('PresenceTracker — hasLivePeer / changed detection', () => {
  it('hasLivePeer reflects whether ANY peer is live', () => {
    const tracker = new PresenceTracker();
    expect(tracker.hasLivePeer()).toBe(false);
    tracker.apply({ peerId: 'A', kind: 'retained' });
    expect(tracker.hasLivePeer()).toBe(false); // retained-only: still nobody live
    tracker.apply({ peerId: 'A', kind: 'live' });
    expect(tracker.hasLivePeer()).toBe(true);
    tracker.apply({ peerId: 'A', kind: 'absent' });
    expect(tracker.hasLivePeer()).toBe(false);
  });

  it('apply() returns true only when the LIVE-peer set actually changed', () => {
    const tracker = new PresenceTracker();
    // retained does not change the live set -> false
    expect(tracker.apply({ peerId: 'A', kind: 'retained' })).toBe(false);
    // live promotes A -> the live set changed -> true
    expect(tracker.apply({ peerId: 'A', kind: 'live' })).toBe(true);
    // a duplicate live for A does not change the live set -> false
    expect(tracker.apply({ peerId: 'A', kind: 'live' })).toBe(false);
    // absent removes A -> changed -> true
    expect(tracker.apply({ peerId: 'A', kind: 'absent' })).toBe(true);
    // absent again for the now-unknown A -> no change -> false
    expect(tracker.apply({ peerId: 'A', kind: 'absent' })).toBe(false);
  });

  it('a retained arriving for an ALREADY-live peer does not perturb its live status (no false change)', () => {
    const tracker = new PresenceTracker();
    tracker.apply({ peerId: 'A', kind: 'live' });
    // A retained snapshot for a peer already known live must not downgrade or re-report it.
    expect(tracker.apply({ peerId: 'A', kind: 'retained' })).toBe(false);
    expect(tracker.livePeers()).toEqual(['A']);
    // …and it must NOT re-file the already-live peer as a mere candidate (the `!wasLive` guard):
    // a live peer stays out of the candidate set entirely.
    expect(tracker.candidatePeers()).toEqual([]);
  });
});
