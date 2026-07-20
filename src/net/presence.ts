/**
 * PURE presence-liveness evaluator (Task 6.5, issue #5: a bogus/dead room must NOT show a phantom
 * "opponent connected"). This is the decision layer the MQTT transport (`mqttTransport.ts`) stands
 * on: given a stream of presence signals, it computes WHICH peers are actually live right now, so a
 * peer that merely left a stale **retained** presence on the broker is never mistaken for a live
 * opponent.
 *
 * ## Why this exists — the phantom-presence bug
 *
 * MQTT presence is announced with a RETAINED message so a late joiner discovers who is already in
 * the room. But retention cuts both ways: if a peer crashes without a clean disconnect AND its
 * Last-Will does not fire (killed tab, lost network before the broker times it out), the broker
 * keeps that peer's non-empty retained presence indefinitely. A fresh joiner subscribing to that
 * dead room is immediately handed the stale retained presence — and the old transport counted it as
 * a live opponent (the bug). The fix, per the issue, is to **require a fresh presence/handshake**: a
 * retained snapshot only makes a peer a *candidate* to be pinged; only a LIVE announcement (the
 * peer's own live publish, or its reply to our hello handshake) promotes it to a live peer.
 *
 * ## The three signal kinds
 *
 *   - `retained` — a retained presence snapshot the broker replayed on subscribe. Recorded as a
 *     candidate (so the transport can ping it for a live handshake) but NEVER counted live.
 *   - `live`     — a fresh, non-retained presence publish observed while we are subscribed (a peer
 *     announcing itself, or ack-ing our hello). Promotes the peer to live.
 *   - `absent`   — an empty presence payload: a graceful leave (retained-clear) or the broker firing
 *     the peer's Last-Will. Removes the peer from BOTH the live and candidate sets.
 *
 * ## Purity
 *
 * No transport, DOM, clock, or randomness — a plain fold from `(state, signal) → state`. That is
 * exactly what makes issue #5's decision unit-testable to 100% + mutation-gated in isolation
 * (agent-principles: keep the IO adapter thin, the decision separable). This module carries no game
 * logic and imports nothing from three/render/ui.
 */

/** How a single presence observation was delivered — the basis of the liveness decision. */
export type PresenceKind =
  /** A retained snapshot replayed by the broker on subscribe. Candidate only — never live. */
  | 'retained'
  /** A fresh, non-retained presence publish seen while subscribed. Promotes the peer to live. */
  | 'live'
  /** An empty payload: a graceful leave or a fired Last-Will. Removes the peer entirely. */
  | 'absent';

/** One presence observation about a specific peer. */
export interface PresenceSignal {
  /** The peer this signal is about. */
  readonly peerId: string;
  /** How it was delivered (retained snapshot / live publish / absence). */
  readonly kind: PresenceKind;
}

/**
 * Folds presence signals into the set of peers that are LIVE right now. A retained snapshot only
 * makes a peer a candidate; a live announcement makes it live; an absence clears it. See the file
 * header for why retained-only never counts as live (issue #5).
 */
export class PresenceTracker {
  /** Peers confirmed live via a fresh (non-retained) announcement. */
  private readonly live = new Set<string>();
  /** Peers seen only via a retained snapshot — pingable, but not yet confirmed live. */
  private readonly candidates = new Set<string>();

  /**
   * Apply one presence signal, updating the live/candidate sets.
   *
   * @returns `true` iff the set of LIVE peers changed as a result (so the transport can suppress a
   *   redundant presence callback — a retained snapshot that changes nothing, or a duplicate live).
   */
  apply(signal: PresenceSignal): boolean {
    const { peerId, kind } = signal;
    const wasLive = this.live.has(peerId);
    switch (kind) {
      case 'retained':
        // A retained snapshot NEVER promotes to live: it only makes the peer a candidate. If the peer
        // is already live, do not touch the candidate set (a live peer is not "downgraded" to a mere
        // candidate by a late retained snapshot). Either way the LIVE set is unchanged.
        if (!wasLive) this.candidates.add(peerId);
        break;
      case 'live':
        // A fresh announcement confirms liveness: promote out of the candidate set into live.
        this.candidates.delete(peerId);
        this.live.add(peerId);
        break;
      case 'absent':
        // The peer is gone (graceful clear or Last-Will): drop it from both sets entirely.
        this.candidates.delete(peerId);
        this.live.delete(peerId);
        break;
    }
    return this.live.has(peerId) !== wasLive;
  }

  /** The peers confirmed live right now (a snapshot; safe to hand to a callback). */
  livePeers(): string[] {
    return [...this.live];
  }

  /** The peers seen only via a retained snapshot — candidates to ping for a live handshake. */
  candidatePeers(): string[] {
    return [...this.candidates];
  }

  /** Whether ANY peer is confirmed live right now (drives "opponent connected"). */
  hasLivePeer(): boolean {
    return this.live.size > 0;
  }
}
