import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  deriveEndState,
  alternateSeats,
  REMATCH_ACTION,
  type RematchUi,
} from './endState';
import {
  initialHandshake,
  propose,
  receiveProposal,
  respond,
  receiveResponse,
  type HandshakeState,
} from './handshake';
import { initialState, type GameState, type Player } from '../core/gameState';
import type { SeatColor, SeatMap } from './seats';
import type { NodeKey } from '../core/coords';

/**
 * Strict unit + fast-check + mutation gate for the PURE networked end-state view-model + seat
 * alternation (Task N.2.1, issue #12).
 *
 * The handshake states fed to `deriveEndState` are built with the REAL N.1 primitives
 * (`propose` / `receiveProposal` / `respond` / `receiveResponse`) — not hand-forged objects — so the
 * projection is proven against states the actual state machine can produce, and the two never drift.
 */

const PLAYERS: readonly Player[] = ['white', 'black'];
const anyPlayer = fc.constantFrom<Player>('white', 'black');

/** A won GameState with an explicit LINE win (a non-empty winningLine). */
function wonByLine(winner: Player): GameState {
  const line: readonly NodeKey[] = ['0,0,0', '1,0,0', '2,0,0', '3,0,0', '4,0,0'];
  return { ...initialState(9), winner, winningLine: line };
}

/** A won GameState with a CAPTURE win (five pairs, no winningLine key). */
function wonByCaptures(winner: Player): GameState {
  return {
    ...initialState(9),
    winner,
    captures: { white: winner === 'white' ? 5 : 0, black: winner === 'black' ? 5 : 0 },
  };
}

/** The handshake state where WE proposed a rematch (outgoing pending). */
function outgoingRematch(): HandshakeState {
  return propose(initialHandshake(), REMATCH_ACTION, 'white').state;
}

/** The handshake state where the OPPONENT proposed a rematch (incoming pending). */
function incomingRematch(): HandshakeState {
  return receiveProposal(initialHandshake(), {
    kind: 'proposal',
    id: 'p1',
    action: REMATCH_ACTION,
    proposedBy: 'black',
  });
}

/** Incoming rematch that WE then accepted/declined (resolved, from the responder side). */
function respondedRematch(accepted: boolean): HandshakeState {
  return respond(incomingRematch(), 'p1', accepted).state;
}

/** Our outgoing rematch that the PEER accepted/declined (resolved, from the proposer side). */
function peerRespondedRematch(accepted: boolean): HandshakeState {
  const out = outgoingRematch();
  const outId = out.pending!.id;
  return receiveResponse(out, { kind: 'response', proposalId: outId, accepted });
}

describe('REMATCH_ACTION — the opaque N.1 action tag for the rematch handshake', () => {
  it('is exactly the string "rematch" (the wire/session contract — pins the literal)', () => {
    // The session raises the proposal via `session.propose(REMATCH_ACTION)` and both clients
    // correlate on this tag; a mutant blanking it to "" would silently divorce the overlay from a
    // real rematch proposal. Pin the concrete value so that mutant is killed.
    expect(REMATCH_ACTION).toBe('rematch');
  });
});

describe('deriveEndState — the show gate', () => {
  it('does NOT show for an in-progress LOCAL game (no winner, idle handshake)', () => {
    const es = deriveEndState(initialState(9), initialHandshake(), 'white');
    expect(es.show).toBe(false);
    expect(es.winner).toBeNull();
    expect(es.winReason).toBeNull();
    expect(es.iWon).toBe(false);
    expect(es.resultText).toBe('');
  });

  it('does NOT show for an in-progress NETWORKED game even with a pending rematch-less handshake', () => {
    // winner === null gates the overlay off regardless of the handshake.
    const es = deriveEndState(initialState(9), incomingRematch(), 'black');
    expect(es.show).toBe(false);
    // rematchUi is still projected (the widget just won't render it while hidden).
    expect(es.rematchUi).toBe('incoming');
  });

  it('SHOWS once the networked game is won (winner set)', () => {
    for (const winner of PLAYERS) {
      const es = deriveEndState(wonByLine(winner), initialHandshake(), 'white');
      expect(es.show).toBe(true);
      expect(es.winner).toBe(winner);
    }
  });

  it('show is exactly "winner !== null" over arbitrary states (kills an inverted/hardcoded gate)', () => {
    fc.assert(
      fc.property(fc.option(anyPlayer, { nil: null }), (winner) => {
        const state: GameState = { ...initialState(9), winner };
        expect(deriveEndState(state, initialHandshake(), 'white').show).toBe(
          winner !== null,
        );
      }),
    );
  });
});

describe('deriveEndState — win reason (read from state, not a magic string)', () => {
  it('reports a LINE win when winningLine is present + non-empty', () => {
    const es = deriveEndState(wonByLine('white'), initialHandshake(), 'white');
    expect(es.winReason).toBe('line');
    expect(es.resultText).toBe('You won with five in a row.');
  });

  it('reports a CAPTURES win when winningLine is absent', () => {
    const es = deriveEndState(wonByCaptures('black'), initialHandshake(), 'black');
    expect(es.winReason).toBe('captures');
    expect(es.resultText).toBe('You won by five capture pairs.');
  });

  it('treats an EMPTY winningLine as a captures win (length guard, not mere presence)', () => {
    // A winner with an empty winningLine array must NOT be read as a line win — the guard is
    // length > 0, so a mutant dropping the `.length > 0` check (presence-only) is killed.
    const state: GameState = { ...initialState(9), winner: 'white', winningLine: [] };
    expect(deriveEndState(state, initialHandshake(), 'black').winReason).toBe(
      'captures',
    );
  });

  it('winReason is null while in progress', () => {
    expect(
      deriveEndState(initialState(9), initialHandshake(), 'white').winReason,
    ).toBeNull();
  });
});

describe('deriveEndState — iWon + resultText phrasing', () => {
  it('says "You won" when this client is the winner', () => {
    const es = deriveEndState(wonByLine('white'), initialHandshake(), 'white');
    expect(es.iWon).toBe(true);
    expect(es.resultText).toBe('You won with five in a row.');
  });

  it('names the winning COLOR (not "You") when the opponent won', () => {
    const es = deriveEndState(wonByLine('white'), initialHandshake(), 'black');
    expect(es.iWon).toBe(false);
    expect(es.resultText).toBe('White won with five in a row.');
  });

  it('names Black correctly for a black opponent win by captures', () => {
    const es = deriveEndState(wonByCaptures('black'), initialHandshake(), 'white');
    expect(es.iWon).toBe(false);
    expect(es.resultText).toBe('Black won by five capture pairs.');
  });

  it('iWon is false for an UNSEATED client (mySeat null) even when someone won', () => {
    const es = deriveEndState(wonByLine('white'), initialHandshake(), null);
    expect(es.iWon).toBe(false);
    expect(es.resultText).toBe('White won with five in a row.');
  });

  it('iWon is exactly (mySeat === winner) across all seat/winner combos', () => {
    const seats: readonly (SeatColor | null)[] = ['white', 'black', null];
    for (const winner of PLAYERS) {
      for (const seat of seats) {
        const es = deriveEndState(wonByLine(winner), initialHandshake(), seat);
        expect(es.iWon).toBe(seat === winner);
      }
    }
  });
});

describe('deriveEndState — rematchUi mapping (derived from the N.1 handshake)', () => {
  it('idle when the handshake is fresh (no pending, no resolution)', () => {
    expect(
      deriveEndState(wonByLine('white'), initialHandshake(), 'white').rematchUi,
    ).toBe('idle');
  });

  it('proposed-waiting when WE proposed (outgoing pending)', () => {
    expect(
      deriveEndState(wonByLine('white'), outgoingRematch(), 'white').rematchUi,
    ).toBe('proposed-waiting');
  });

  it('incoming when the OPPONENT proposed (incoming pending)', () => {
    expect(
      deriveEndState(wonByLine('white'), incomingRematch(), 'white').rematchUi,
    ).toBe('incoming');
  });

  it('accepted after WE accepted an incoming proposal (responder side)', () => {
    expect(
      deriveEndState(wonByLine('white'), respondedRematch(true), 'white')
        .rematchUi,
    ).toBe('accepted');
  });

  it('declined after WE declined an incoming proposal (responder side)', () => {
    expect(
      deriveEndState(wonByLine('white'), respondedRematch(false), 'white')
        .rematchUi,
    ).toBe('declined');
  });

  it('accepted after the PEER accepted OUR proposal (proposer side)', () => {
    expect(
      deriveEndState(wonByLine('white'), peerRespondedRematch(true), 'white')
        .rematchUi,
    ).toBe('accepted');
  });

  it('declined after the PEER declined OUR proposal (proposer side)', () => {
    expect(
      deriveEndState(wonByLine('white'), peerRespondedRematch(false), 'white')
        .rematchUi,
    ).toBe('declined');
  });

  it('no-double-accept: a second respond on an already-answered proposal stays "accepted"', () => {
    // After accepting, the pending slot is cleared, so a repeat respond is a no-op — the
    // projection must NOT flip back to an "incoming" Accept/Decline prompt.
    const answered = respondedRematch(true);
    const again = respond(answered, 'p1', false); // no-op: nothing pending to answer
    expect(again.state).toBe(answered); // referentially unchanged (no re-resolve)
    expect(
      deriveEndState(wonByLine('white'), again.state, 'white').rematchUi,
    ).toBe('accepted');
  });

  it('pending takes precedence over a stale resolution (outgoing after a prior resolution)', () => {
    // Resolve one handshake, then raise a fresh outgoing proposal over it: `propose` clears the
    // stale resolution, so the projection reflects the LIVE pending ask, not the old outcome.
    const resolved = respondedRematch(true);
    const reproposed = propose(resolved, REMATCH_ACTION, 'white').state;
    expect(
      deriveEndState(wonByLine('white'), reproposed, 'white').rematchUi,
    ).toBe('proposed-waiting');
  });

  it('an OUTGOING proposal for a DIFFERENT action leaves rematchUi idle (no cross-wiring)', () => {
    // #18 undo shares the handshake; an OUTGOING undo must NOT read as "proposed-waiting" on the
    // rematch overlay. Kills a mutant dropping the outgoing `action === REMATCH_ACTION` guard.
    const undoOutgoing = propose(initialHandshake(), 'undo', 'white').state;
    expect(
      deriveEndState(wonByLine('white'), undoOutgoing, 'white').rematchUi,
    ).toBe('idle');
  });

  it('an INCOMING / RESOLVED proposal for a DIFFERENT action leaves rematchUi idle (no cross-wiring)', () => {
    // A pending or resolved undo must NOT drive the rematch overlay's incoming/accepted arms.
    const undoPending = receiveProposal(initialHandshake(), {
      kind: 'proposal',
      id: 'u1',
      action: 'undo',
      proposedBy: 'black',
    });
    expect(
      deriveEndState(wonByLine('white'), undoPending, 'white').rematchUi,
    ).toBe('idle');
    const undoResolved = respond(undoPending, 'u1', true).state;
    expect(
      deriveEndState(wonByLine('white'), undoResolved, 'white').rematchUi,
    ).toBe('idle');
  });

  it('maps every reachable rematch handshake phase exactly (exhaustive table)', () => {
    const cases: readonly (readonly [HandshakeState, RematchUi])[] = [
      [initialHandshake(), 'idle'],
      [outgoingRematch(), 'proposed-waiting'],
      [incomingRematch(), 'incoming'],
      [respondedRematch(true), 'accepted'],
      [respondedRematch(false), 'declined'],
      [peerRespondedRematch(true), 'accepted'],
      [peerRespondedRematch(false), 'declined'],
    ];
    for (const [hs, expected] of cases) {
      expect(
        deriveEndState(wonByLine('white'), hs, 'white').rematchUi,
      ).toBe(expected);
    }
  });
});

describe('alternateSeats — deterministic seat swap (colors alternate every game)', () => {
  it('swaps white <-> black owners', () => {
    const before: SeatMap = { white: 'alice', black: 'bob' };
    expect(alternateSeats(before)).toEqual({ white: 'bob', black: 'alice' });
  });

  it('carries a vacant seat through the swap (null owners move too)', () => {
    expect(alternateSeats({ white: 'alice', black: null })).toEqual({
      white: null,
      black: 'alice',
    });
    expect(alternateSeats({ white: null, black: null })).toEqual({
      white: null,
      black: null,
    });
  });

  it('does NOT mutate its input (returns a fresh map)', () => {
    const before: SeatMap = { white: 'alice', black: 'bob' };
    const after = alternateSeats(before);
    expect(after).not.toBe(before);
    expect(before).toEqual({ white: 'alice', black: 'bob' });
  });

  it('is an INVOLUTION: applying it twice returns the original (kills a non-swap mutant)', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string(), { nil: null }),
        fc.option(fc.string(), { nil: null }),
        (white, black) => {
          const original: SeatMap = { white, black };
          expect(alternateSeats(alternateSeats(original))).toEqual(original);
        },
      ),
    );
  });

  it('actually EXCHANGES the two owners (not identity) whenever they differ', () => {
    // Kills a mutant that returns the map unchanged: with distinct owners the single swap must
    // differ from the input.
    fc.assert(
      fc.property(fc.string(), fc.string(), (white, black) => {
        fc.pre(white !== black);
        const swapped = alternateSeats({ white, black });
        expect(swapped.white).toBe(black);
        expect(swapped.black).toBe(white);
      }),
    );
  });
});
