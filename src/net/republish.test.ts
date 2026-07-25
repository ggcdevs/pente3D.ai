import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { RepublishLimiter, DEFAULT_REPUBLISH_INTERVAL_MS } from './republish';

/**
 * Task V.3 (epic #47, fixes #45) — the PURE resident-peer-republish decision.
 *
 * The bug: a peer whose socket dies under a live session comes back, mqtt.js re-subscribes and
 * re-announces presence, and NOTHING replays the move made while it was away (sync is incremental
 * and non-retained). Design §4's fix is that whoever is in the room REPUBLISHES its full
 * authoritative log when it sees a peer live — in BOTH directions, so a resident that missed the
 * returner's last move fast-forwards too.
 *
 * {@link RepublishLimiter} is the decision half: given "peer P showed fresh live presence at time
 * T while we hold the log fingerprinted H", does anything go on the wire? The rules under test:
 *
 *  1. **Nothing to serve → never publish.** Holding no game (offline, or entry still open) can
 *     never put a log on the wire, and it must not poison the record either.
 *  2. **Idempotent under repeats.** A burst of live-presence signals for the same peer while our
 *     log is unchanged republishes ONCE — the handshake ack ping-pong must not become a publish
 *     storm.
 *  3. **A new head always serves.** If our log advanced since we last served that peer, the next
 *     signal republishes regardless of how recent the last one was — that IS the #45 case.
 *  4. **The limiter cannot starve a genuine second return.** The suppression is a short window,
 *     not a latch: a repeat outside the window republishes, and an OBSERVED absence forgets the
 *     peer outright so an immediate return is served at once.
 *
 * Purity: no clock, no transport, no randomness — the observation time is an argument.
 */

/** A head fingerprint stand-in; any two distinct strings are two distinct histories. */
const HEAD_A = 'head-a';
const HEAD_B = 'head-b';

describe('RepublishLimiter — nothing to serve is never published', () => {
  it('a live peer while we hold NO game decides not to publish, with the honest reason', () => {
    const limiter = new RepublishLimiter();
    expect(limiter.onPeerLive({ peerId: 'P', serving: null, at: 0 })).toEqual({
      publish: false,
      reason: 'nothing-to-serve',
    });
  });

  it('a no-game signal does NOT count as having served the peer (the next real one publishes)', () => {
    const limiter = new RepublishLimiter(1000);
    // Entry still open (nothing to serve), then the very same instant we are settled on a game.
    expect(limiter.onPeerLive({ peerId: 'P', serving: null, at: 0 })).toEqual({
      publish: false,
      reason: 'nothing-to-serve',
    });
    expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_A, at: 0 })).toEqual({ publish: true });
  });

  it('a no-game signal does NOT erase what we already served (a burst is still suppressed)', () => {
    const limiter = new RepublishLimiter(1000);
    expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_A, at: 0 })).toEqual({ publish: true });
    expect(limiter.onPeerLive({ peerId: 'P', serving: null, at: 1 })).toEqual({
      publish: false,
      reason: 'nothing-to-serve',
    });
    expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_A, at: 2 })).toEqual({
      publish: false,
      reason: 'rate-limited',
    });
  });
});

describe('RepublishLimiter — the first sight of a peer serves it', () => {
  it('publishes on a peer we have never served', () => {
    const limiter = new RepublishLimiter();
    expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_A, at: 12_345 })).toEqual({ publish: true });
  });

  it('tracks peers INDEPENDENTLY — serving one does not suppress the other', () => {
    const limiter = new RepublishLimiter(1000);
    expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_A, at: 0 })).toEqual({ publish: true });
    // A second peer at the same instant is a peer we have never served: it gets its own publish.
    expect(limiter.onPeerLive({ peerId: 'Q', serving: HEAD_A, at: 0 })).toEqual({ publish: true });
    // …and P is still suppressed, so Q's publish did not reset P's record.
    expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_A, at: 1 })).toEqual({
      publish: false,
      reason: 'rate-limited',
    });
  });
});

describe('RepublishLimiter — idempotent under a burst of repeats', () => {
  it('a repeat inside the window with an UNCHANGED head is refused as rate-limited', () => {
    const limiter = new RepublishLimiter(1000);
    expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_A, at: 0 })).toEqual({ publish: true });
    expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_A, at: 1 })).toEqual({
      publish: false,
      reason: 'rate-limited',
    });
    expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_A, at: 999 })).toEqual({
      publish: false,
      reason: 'rate-limited',
    });
  });

  it('the DEFAULT window suppresses a burst (the constructor default is a real value)', () => {
    const limiter = new RepublishLimiter();
    expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_A, at: 0 })).toEqual({ publish: true });
    expect(
      limiter.onPeerLive({ peerId: 'P', serving: HEAD_A, at: DEFAULT_REPUBLISH_INTERVAL_MS - 1 }),
    ).toEqual({ publish: false, reason: 'rate-limited' });
    // …and it is a WINDOW, not a latch: exactly one interval later the same signal serves again.
    expect(
      limiter.onPeerLive({ peerId: 'P', serving: HEAD_A, at: DEFAULT_REPUBLISH_INTERVAL_MS }),
    ).toEqual({ publish: true });
  });

  it('a refused repeat does NOT extend the window (the clock runs from the last SERVE)', () => {
    const limiter = new RepublishLimiter(1000);
    expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_A, at: 0 })).toEqual({ publish: true });
    expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_A, at: 900 })).toEqual({
      publish: false,
      reason: 'rate-limited',
    });
    // 1000ms after the SERVE (not after the refusal) the window is open again.
    expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_A, at: 1000 })).toEqual({ publish: true });
  });

  it('a zero window never rate-limits (the limiter is configurable, not hardcoded)', () => {
    const limiter = new RepublishLimiter(0);
    expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_A, at: 0 })).toEqual({ publish: true });
    expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_A, at: 0 })).toEqual({ publish: true });
  });
});

describe('RepublishLimiter — a head we have not served that peer is always served', () => {
  it('publishes immediately when our log ADVANCED, however recent the last serve (the #45 case)', () => {
    const limiter = new RepublishLimiter(1000);
    expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_A, at: 0 })).toEqual({ publish: true });
    // The peer went away, we moved, it came back within the window: it MUST get the new head.
    expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_B, at: 1 })).toEqual({ publish: true });
  });

  it('the new head becomes the suppressed one (a burst on the NEW head is refused)', () => {
    const limiter = new RepublishLimiter(1000);
    expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_A, at: 0 })).toEqual({ publish: true });
    expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_B, at: 1 })).toEqual({ publish: true });
    expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_B, at: 2 })).toEqual({
      publish: false,
      reason: 'rate-limited',
    });
    // Reverting to the previously-served head is ALSO a head that peer does not have now.
    expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_A, at: 3 })).toEqual({ publish: true });
  });
});

describe('RepublishLimiter — an observed absence forgets the peer (no starvation)', () => {
  it('a peer dropped from the present set is served again IMMEDIATELY on its return', () => {
    const limiter = new RepublishLimiter(1000);
    expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_A, at: 0 })).toEqual({ publish: true });
    // The broker's Last-Will fires: presence now reports an empty room.
    limiter.observePresent([]);
    // It returns inside the window with our log unchanged — it may have dropped BEFORE our
    // republish reached it, so it must be served again rather than left stale.
    expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_A, at: 1 })).toEqual({ publish: true });
  });

  it('a peer STILL present keeps its record (presence ticks do not defeat the limiter)', () => {
    const limiter = new RepublishLimiter(1000);
    expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_A, at: 0 })).toEqual({ publish: true });
    limiter.observePresent(['P']);
    expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_A, at: 1 })).toEqual({
      publish: false,
      reason: 'rate-limited',
    });
  });

  it('forgets ONLY the peers that left (a room of two, one of which drops)', () => {
    const limiter = new RepublishLimiter(1000);
    expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_A, at: 0 })).toEqual({ publish: true });
    expect(limiter.onPeerLive({ peerId: 'Q', serving: HEAD_A, at: 0 })).toEqual({ publish: true });
    limiter.observePresent(['Q']);
    // P left → served again on return; Q never left → still suppressed.
    expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_A, at: 1 })).toEqual({ publish: true });
    expect(limiter.onPeerLive({ peerId: 'Q', serving: HEAD_A, at: 1 })).toEqual({
      publish: false,
      reason: 'rate-limited',
    });
  });
});

describe('RepublishLimiter — properties (fast-check)', () => {
  it('IDEMPOTENCE: a burst of identical signals inside the window publishes exactly once', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.array(fc.integer({ min: 0, max: 9_999 }), { minLength: 1, maxLength: 30 }),
        (peerId, serving, windowMs, start, offsets) => {
          const limiter = new RepublishLimiter(windowMs);
          const published: boolean[] = [];
          // Every observation lands strictly inside [start, start + windowMs).
          for (const off of offsets) {
            const at = start + (off % windowMs);
            published.push(limiter.onPeerLive({ peerId, serving, at }).publish);
          }
          // Exactly one publish, and it is the first observation — later repeats are harmless.
          expect(published.filter((p) => p)).toHaveLength(1);
          expect(published[0]).toBe(true);
        },
      ),
    );
  });

  it('NEVER SERVES NOTHING: no interleaving of signals can publish while we hold no game', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            peerId: fc.constantFrom('P', 'Q'),
            serving: fc.option(fc.constantFrom(HEAD_A, HEAD_B), { nil: null }),
            at: fc.integer({ min: 0, max: 50_000 }),
          }),
          { maxLength: 40 },
        ),
        (signals) => {
          const limiter = new RepublishLimiter(1000);
          for (const s of signals) {
            const decision = limiter.onPeerLive(s);
            if (s.serving === null) {
              expect(decision).toEqual({ publish: false, reason: 'nothing-to-serve' });
            }
          }
        },
      ),
    );
  });

  it('NO STARVATION: signals spaced at least one window apart ALWAYS publish', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5_000 }),
        fc.array(fc.integer({ min: 0, max: 5_000 }), { minLength: 1, maxLength: 20 }),
        (windowMs, extraGaps) => {
          const limiter = new RepublishLimiter(windowMs);
          let at = 0;
          // The head never changes and the peer is never seen absent: suppression, if it latched,
          // would silence every one of these. The window must re-open instead.
          for (const gap of extraGaps) {
            expect(limiter.onPeerLive({ peerId: 'P', serving: HEAD_A, at }).publish).toBe(true);
            at += windowMs + gap;
          }
        },
      ),
    );
  });

  it('NO STARVATION: an observed absence always re-opens the peer, whatever the history', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            serving: fc.constantFrom(HEAD_A, HEAD_B),
            at: fc.integer({ min: 0, max: 10_000 }),
          }),
          { maxLength: 20 },
        ),
        fc.constantFrom(HEAD_A, HEAD_B),
        fc.integer({ min: 0, max: 10_000 }),
        (history, serving, at) => {
          const limiter = new RepublishLimiter(1_000_000); // a window that would otherwise latch
          for (const h of history) limiter.onPeerLive({ peerId: 'P', ...h });
          limiter.observePresent([]);
          expect(limiter.onPeerLive({ peerId: 'P', serving, at }).publish).toBe(true);
        },
      ),
    );
  });
});
