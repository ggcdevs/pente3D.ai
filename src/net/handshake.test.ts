import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { ProposalMessage, ResponseMessage } from './sync';
import {
  initialHandshake,
  propose,
  receiveProposal,
  respond,
  receiveResponse,
  cancel,
  onGameAdvanced,
  onPeerGone,
  clearResolution,
  outgoingPending,
  incomingPending,
  resolution,
  hasPending,
  canPropose,
  type HandshakeState,
} from './handshake';
import type { Player } from '../core/gameState';

/** A deterministic id source: hands out the supplied ids in order (fails if exhausted). */
function seqIds(...ids: string[]): () => string {
  let i = 0;
  return () => {
    const id = ids[i++];
    if (id === undefined) throw new Error('seqIds exhausted');
    return id;
  };
}

/** Build an inbound proposal message (the peer asked us). */
function propMsg(id: string, action: string, proposedBy: Player): ProposalMessage {
  return { kind: 'proposal', id, action, proposedBy };
}

/** Build an inbound response message. */
function respMsg(proposalId: string, accepted: boolean): ResponseMessage {
  return { kind: 'response', proposalId, accepted };
}

describe('initialHandshake', () => {
  it('starts idle: no pending, no resolution, selectors all empty', () => {
    const s = initialHandshake();
    expect(s.pending).toBeNull();
    expect(s.resolution).toBeNull();
    expect(outgoingPending(s)).toBeNull();
    expect(incomingPending(s)).toBeNull();
    expect(resolution(s)).toBeNull();
    expect(hasPending(s)).toBe(false);
  });

  it('returns a fresh value each call (no shared mutable singleton)', () => {
    expect(initialHandshake()).not.toBe(initialHandshake());
    expect(initialHandshake()).toEqual(initialHandshake());
  });
});

describe('propose — outgoing ask with a unique id, held out-of-band', () => {
  it('records an OUTGOING pending proposal carrying the minted id/action/seat', () => {
    const { state } = propose(initialHandshake(), 'rematch', 'white', seqIds('p1'));
    expect(state.pending).toEqual({
      id: 'p1',
      action: 'rematch',
      proposedBy: 'white',
      direction: 'outgoing',
    });
    expect(outgoingPending(state)).toEqual(state.pending);
    expect(incomingPending(state)).toBeNull();
    expect(hasPending(state)).toBe(true);
  });

  it('emits a NON-mutating proposal message correlated by the same id', () => {
    const { message } = propose(initialHandshake(), 'undo', 'black', seqIds('abc'));
    expect(message).toEqual({ kind: 'proposal', id: 'abc', action: 'undo', proposedBy: 'black' });
  });

  it('does not mutate its input state (immutability)', () => {
    const s0 = initialHandshake();
    propose(s0, 'rematch', 'white', seqIds('p1'));
    expect(s0).toEqual({ pending: null, resolution: null });
  });

  it('uses the default randomId source when none is injected (unique across calls)', () => {
    const a = propose(initialHandshake(), 'rematch', 'white');
    const b = propose(initialHandshake(), 'rematch', 'white');
    expect(a.message.id).toEqual(expect.any(String));
    expect(a.message.id.length).toBeGreaterThan(0);
    expect(a.message.id).not.toEqual(b.message.id);
  });

  it('a new proposal SUPERSEDES a currently-pending one (at most one pending)', () => {
    const first = propose(initialHandshake(), 'undo', 'white', seqIds('p1')).state;
    const second = propose(first, 'rematch', 'white', seqIds('p2')).state;
    expect(second.pending?.id).toBe('p2');
    expect(second.pending?.action).toBe('rematch');
    // Exactly one pending — the old p1 slot is gone.
    expect(hasPending(second)).toBe(true);
    expect(second.pending?.id).not.toBe('p1');
  });

  it('a new proposal clears a stale resolution (clean handshake)', () => {
    // Resolve an outgoing proposal, then propose again.
    const proposed = propose(initialHandshake(), 'undo', 'white', seqIds('p1')).state;
    const resolved = receiveResponse(proposed, respMsg('p1', true));
    expect(resolution(resolved)).not.toBeNull();
    const reproposed = propose(resolved, 'rematch', 'white', seqIds('p2')).state;
    expect(resolution(reproposed)).toBeNull();
  });
});

describe('receiveProposal — incoming ask, deduped by id', () => {
  it('records an INCOMING pending proposal from the peer message', () => {
    const s = receiveProposal(initialHandshake(), propMsg('x1', 'rematch', 'black'));
    expect(s.pending).toEqual({
      id: 'x1',
      action: 'rematch',
      proposedBy: 'black',
      direction: 'incoming',
    });
    expect(incomingPending(s)).toEqual(s.pending);
    expect(outgoingPending(s)).toBeNull();
  });

  it('a REPEAT of the in-flight id is an idempotent no-op (returns the same state)', () => {
    const s1 = receiveProposal(initialHandshake(), propMsg('x1', 'undo', 'white'));
    const s2 = receiveProposal(s1, propMsg('x1', 'undo', 'white'));
    expect(s2).toBe(s1); // referential no-op: nothing changed
  });

  it('a DIFFERENT id supersedes the pending incoming proposal', () => {
    const s1 = receiveProposal(initialHandshake(), propMsg('x1', 'undo', 'white'));
    const s2 = receiveProposal(s1, propMsg('x2', 'rematch', 'white'));
    expect(s2.pending?.id).toBe('x2');
    expect(s2.pending?.action).toBe('rematch');
  });

  it('does not mutate its input state', () => {
    const s0 = initialHandshake();
    receiveProposal(s0, propMsg('x1', 'undo', 'white'));
    expect(s0.pending).toBeNull();
  });

  it('clears a stale resolution when a new incoming proposal arrives', () => {
    const proposed = propose(initialHandshake(), 'undo', 'white', seqIds('p1')).state;
    const resolved = receiveResponse(proposed, respMsg('p1', false));
    expect(resolution(resolved)).not.toBeNull();
    const incoming = receiveProposal(resolved, propMsg('x9', 'rematch', 'black'));
    expect(resolution(incoming)).toBeNull();
  });
});

describe('respond — resolve an incoming proposal, no double-resolve', () => {
  it('accepting records an accepted resolution, clears pending, emits a response', () => {
    const s = receiveProposal(initialHandshake(), propMsg('x1', 'rematch', 'black'));
    const { state, message } = respond(s, 'x1', true);
    expect(state.pending).toBeNull();
    expect(resolution(state)).toEqual({
      id: 'x1',
      action: 'rematch',
      direction: 'incoming',
      outcome: 'accepted',
    });
    expect(message).toEqual({ kind: 'response', proposalId: 'x1', accepted: true });
  });

  it('declining records a declined resolution and a decline response', () => {
    const s = receiveProposal(initialHandshake(), propMsg('x1', 'undo', 'white'));
    const { state, message } = respond(s, 'x1', false);
    expect(resolution(state)?.outcome).toBe('declined');
    expect(message).toEqual({ kind: 'response', proposalId: 'x1', accepted: false });
  });

  it('a second respond for the same id is a no-op with no message (no double-resolve)', () => {
    const s = receiveProposal(initialHandshake(), propMsg('x1', 'undo', 'white'));
    const once = respond(s, 'x1', true);
    const twice = respond(once.state, 'x1', false);
    expect(twice.state).toBe(once.state);
    expect(twice.message).toBeNull();
    // The outcome stays as first resolved — a late decline can't overturn the accept.
    expect(resolution(once.state)?.outcome).toBe('accepted');
  });

  it('refuses to respond to a MISMATCHED id (stale response after supersede)', () => {
    const s = receiveProposal(initialHandshake(), propMsg('x2', 'undo', 'white'));
    const { state, message } = respond(s, 'x1', true);
    expect(state).toBe(s);
    expect(message).toBeNull();
  });

  it('refuses to respond to an OUTGOING proposal (only the peer may answer ours)', () => {
    const s = propose(initialHandshake(), 'rematch', 'white', seqIds('p1')).state;
    const { state, message } = respond(s, 'p1', true);
    expect(state).toBe(s);
    expect(message).toBeNull();
  });

  it('refuses to respond when nothing is pending', () => {
    const { state, message } = respond(initialHandshake(), 'p1', true);
    expect(state.pending).toBeNull();
    expect(message).toBeNull();
  });
});

describe('receiveResponse — resolve our outgoing proposal, no double-resolve', () => {
  it('an accept resolves our outgoing proposal and clears pending', () => {
    const s = propose(initialHandshake(), 'rematch', 'white', seqIds('p1')).state;
    const resolved = receiveResponse(s, respMsg('p1', true));
    expect(resolved.pending).toBeNull();
    expect(resolution(resolved)).toEqual({
      id: 'p1',
      action: 'rematch',
      direction: 'outgoing',
      outcome: 'accepted',
    });
  });

  it('a decline resolves our outgoing proposal as declined', () => {
    const s = propose(initialHandshake(), 'undo', 'black', seqIds('p1')).state;
    const resolved = receiveResponse(s, respMsg('p1', false));
    expect(resolution(resolved)?.outcome).toBe('declined');
  });

  it('a duplicate response after resolution is an idempotent no-op', () => {
    const s = propose(initialHandshake(), 'rematch', 'white', seqIds('p1')).state;
    const once = receiveResponse(s, respMsg('p1', true));
    const twice = receiveResponse(once, respMsg('p1', false));
    expect(twice).toBe(once);
    expect(resolution(once)?.outcome).toBe('accepted'); // late decline can't overturn
  });

  it('ignores a response with a mismatched id (superseded/stale)', () => {
    const s = propose(initialHandshake(), 'rematch', 'white', seqIds('p2')).state;
    const out = receiveResponse(s, respMsg('p1', true));
    expect(out).toBe(s);
  });

  it('ignores a response when the pending proposal is INCOMING (not ours to resolve)', () => {
    const s = receiveProposal(initialHandshake(), propMsg('x1', 'undo', 'white'));
    const out = receiveResponse(s, respMsg('x1', true));
    expect(out).toBe(s);
  });

  it('ignores a response when nothing is pending', () => {
    const out = receiveResponse(initialHandshake(), respMsg('p1', true));
    expect(out.pending).toBeNull();
    expect(out.resolution).toBeNull();
  });
});

describe('cancel & auto-cancel — clear a pending proposal without resolving', () => {
  it('cancel drops an outgoing pending proposal, leaving no resolution', () => {
    const s = propose(initialHandshake(), 'rematch', 'white', seqIds('p1')).state;
    const c = cancel(s);
    expect(c.pending).toBeNull();
    expect(c.resolution).toBeNull(); // dropped, NOT resolved — no trace
    expect(hasPending(c)).toBe(false);
  });

  it('cancel drops an incoming pending proposal too', () => {
    const s = receiveProposal(initialHandshake(), propMsg('x1', 'undo', 'white'));
    expect(cancel(s).pending).toBeNull();
  });

  it('cancel with nothing pending is a referential no-op', () => {
    const s = initialHandshake();
    expect(cancel(s)).toBe(s);
  });

  it('cancel preserves an existing resolution (only clears pending)', () => {
    // Resolve one, then start+cancel a second.
    const r = receiveResponse(
      propose(initialHandshake(), 'undo', 'white', seqIds('p1')).state,
      respMsg('p1', true),
    );
    const second = propose(r, 'rematch', 'white', seqIds('p2')).state; // clears resolution
    const canceled = cancel(second);
    expect(canceled.pending).toBeNull();
    // proposing cleared the resolution, so cancel keeps it null (nothing to preserve here)
    expect(canceled.resolution).toBeNull();
  });

  it('cancel keeps a resolution that a later cancel must not erase', () => {
    // Craft a state that has BOTH a resolution and a fresh pending (via manual transition
    // ordering): resolve, then receiveProposal? that clears resolution. So instead assert
    // via a directly-constructed value the invariant: cancel preserves state.resolution.
    const withBoth: HandshakeState = {
      pending: { id: 'p2', action: 'rematch', proposedBy: 'white', direction: 'outgoing' },
      resolution: { id: 'p1', action: 'undo', direction: 'outgoing', outcome: 'accepted' },
    };
    const c = cancel(withBoth);
    expect(c.pending).toBeNull();
    expect(c.resolution).toEqual(withBoth.resolution);
  });

  it('onGameAdvanced clears a pending proposal (game moved on → stale)', () => {
    const s = propose(initialHandshake(), 'rematch', 'white', seqIds('p1')).state;
    expect(onGameAdvanced(s).pending).toBeNull();
  });

  it('onGameAdvanced with nothing pending is a referential no-op', () => {
    const s = initialHandshake();
    expect(onGameAdvanced(s)).toBe(s);
  });

  it('onPeerGone clears a pending proposal (peer dropped → cannot complete)', () => {
    const s = receiveProposal(initialHandshake(), propMsg('x1', 'undo', 'white'));
    expect(onPeerGone(s).pending).toBeNull();
  });

  it('onPeerGone with nothing pending is a referential no-op', () => {
    const s = initialHandshake();
    expect(onPeerGone(s)).toBe(s);
  });
});

describe('clearResolution', () => {
  it('clears a recorded resolution, leaving pending untouched', () => {
    const resolved = receiveResponse(
      propose(initialHandshake(), 'rematch', 'white', seqIds('p1')).state,
      respMsg('p1', true),
    );
    expect(resolution(resolved)).not.toBeNull();
    const cleared = clearResolution(resolved);
    expect(resolution(cleared)).toBeNull();
    expect(cleared.pending).toBeNull();
  });

  it('preserves a pending proposal while clearing the resolution', () => {
    const withBoth: HandshakeState = {
      pending: { id: 'p2', action: 'rematch', proposedBy: 'white', direction: 'incoming' },
      resolution: { id: 'p1', action: 'undo', direction: 'outgoing', outcome: 'declined' },
    };
    const cleared = clearResolution(withBoth);
    expect(cleared.resolution).toBeNull();
    expect(cleared.pending).toEqual(withBoth.pending);
  });

  it('with no resolution is a referential no-op', () => {
    const s = initialHandshake();
    expect(clearResolution(s)).toBe(s);
  });
});

describe('canPropose — shared no-concurrent-pending guard + consumer predicate', () => {
  it('true only when idle AND the consumer allows', () => {
    const idle = initialHandshake();
    expect(canPropose(idle, true)).toBe(true);
    expect(canPropose(idle, false)).toBe(false);
  });

  it('false while a proposal is pending, regardless of the consumer predicate', () => {
    const busyOut = propose(initialHandshake(), 'rematch', 'white', seqIds('p1')).state;
    expect(canPropose(busyOut, true)).toBe(false);
    const busyIn = receiveProposal(initialHandshake(), propMsg('x1', 'undo', 'white'));
    expect(canPropose(busyIn, true)).toBe(false);
  });

  it('true again after the pending proposal is cancelled', () => {
    const busy = propose(initialHandshake(), 'rematch', 'white', seqIds('p1')).state;
    expect(canPropose(cancel(busy), true)).toBe(true);
  });
});

// ── Property-based invariants (fast-check) ──────────────────────────────────────

const anyPlayer = fc.constantFrom<Player>('white', 'black');

describe('property: unique-id round-trips and correlation', () => {
  it('propose emits a message whose id/action/seat equal the recorded pending', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string(), anyPlayer, (id, action, by) => {
        const { state, message } = propose(initialHandshake(), action, by, seqIds(id));
        expect(message.id).toBe(id);
        expect(message.action).toBe(action);
        expect(message.proposedBy).toBe(by);
        expect(state.pending).toEqual({ id, action, proposedBy: by, direction: 'outgoing' });
      }),
    );
  });

  it('the default id source yields a distinct id on every propose (uniqueness)', () => {
    const ids = new Set<string>();
    fc.assert(
      fc.property(fc.string(), anyPlayer, (action, by) => {
        const { message } = propose(initialHandshake(), action, by);
        expect(ids.has(message.id)).toBe(false);
        ids.add(message.id);
      }),
      { numRuns: 200 },
    );
  });
});

describe('property: receiveProposal dedup is idempotent for the in-flight id', () => {
  it('receiving the same in-flight proposal N times equals receiving it once', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string(),
        anyPlayer,
        fc.integer({ min: 1, max: 6 }),
        (id, action, by, n) => {
          const once = receiveProposal(initialHandshake(), propMsg(id, action, by));
          let many = once;
          for (let i = 0; i < n; i++) {
            many = receiveProposal(many, propMsg(id, action, by));
          }
          expect(many).toBe(once); // every repeat is a referential no-op
        },
      ),
    );
  });
});

describe('property: no double-resolve on either side', () => {
  it('any second receiveResponse for a resolved outgoing proposal never changes state', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string(),
        anyPlayer,
        fc.boolean(),
        fc.boolean(),
        (id, action, by, first, second) => {
          const s = propose(initialHandshake(), action, by, seqIds(id)).state;
          const once = receiveResponse(s, respMsg(id, first));
          const twice = receiveResponse(once, respMsg(id, second));
          expect(twice).toBe(once);
          expect(resolution(once)?.outcome).toBe(first ? 'accepted' : 'declined');
        },
      ),
    );
  });

  it('any second respond for a resolved incoming proposal yields no state change and no message', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string(),
        anyPlayer,
        fc.boolean(),
        fc.boolean(),
        (id, action, by, first, second) => {
          const s = receiveProposal(initialHandshake(), propMsg(id, action, by));
          const once = respond(s, id, first);
          const twice = respond(once.state, id, second);
          expect(twice.state).toBe(once.state);
          expect(twice.message).toBeNull();
        },
      ),
    );
  });
});

describe('property: auto-cancel always clears any pending, both directions', () => {
  const anyPending = fc.oneof(
    fc
      .tuple(fc.string({ minLength: 1 }), fc.string(), anyPlayer)
      .map(([id, action, by]) => propose(initialHandshake(), action, by, seqIds(id)).state),
    fc
      .tuple(fc.string({ minLength: 1 }), fc.string(), anyPlayer)
      .map(([id, action, by]) => receiveProposal(initialHandshake(), propMsg(id, action, by))),
  );

  it('onGameAdvanced and onPeerGone both leave no pending and no resolution', () => {
    fc.assert(
      fc.property(anyPending, (s) => {
        expect(hasPending(s)).toBe(true); // precondition
        expect(onGameAdvanced(s).pending).toBeNull();
        expect(onGameAdvanced(s).resolution).toBeNull();
        expect(onPeerGone(s).pending).toBeNull();
        expect(cancel(s).pending).toBeNull();
      }),
    );
  });
});
