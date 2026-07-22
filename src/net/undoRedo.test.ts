import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  decideUndo,
  decideRedo,
  canProposeUndo,
  canProposeRedo,
  deriveUndoRedoPrompt,
  UNDO_ACTION,
  REDO_ACTION,
  type RedoDecision,
  type UndoRedoPrompt,
} from './undoRedo';
import {
  initialHandshake,
  propose,
  receiveProposal,
  respond,
  type HandshakeState,
} from './handshake';
import { Game } from '../core/game';
import { initialState, type GameState, type Player } from '../core/gameState';
import { REMATCH_ACTION } from './endState';

/**
 * Strict unit + fast-check + mutation gate for the PURE networked mutual-confirm undo/redo logic
 * (Task N.3.1, issue #18).
 *
 * The handshake states fed to the propose-guards and the prompt are built with the REAL N.1
 * primitives (`propose` / `receiveProposal` / `respond`) — not hand-forged objects — so the logic
 * is proven against states the actual state machine can produce, and the two never drift. The
 * game states + ply + canRedo are driven through the REAL `Game` (the append-log fold), so the
 * last-mover / redo-mover attribution is proven against the actual core model, not a mock.
 */

const anyPlayer = fc.constantFrom<Player>('white', 'black');

/** Coord keys down a straight line, far enough apart to avoid captures for a clean move sequence. */
const A = '0,0,0';
const B = '4,4,4';
const C = '8,8,8';

/**
 * Play the given sequence of node keys through a real `Game`, then apply `undos` undo events.
 * Returns the resulting live state, ply, and canRedo — all derived by the actual fold, so any
 * turn / winner attribution is the genuine core behavior, never hand-forged.
 */
function play(nodes: readonly string[], undos = 0): {
  state: GameState;
  ply: number;
  canRedo: boolean;
} {
  const game = new Game(9);
  for (const node of nodes) game.place([...coordsOf(node)]);
  for (let i = 0; i < undos; i++) game.undo();
  return { state: game.state(), ply: game.ply(), canRedo: game.canRedo() };
}

function coordsOf(key: string): [number, number, number] {
  const [x, y, z] = key.split(',').map(Number);
  return [x!, y!, z!];
}

/** An idle handshake — no pending proposal. */
function idle(): HandshakeState {
  return initialHandshake();
}

/** A handshake where WE proposed `action` (outgoing pending). */
function outgoing(action: string): HandshakeState {
  return propose(initialHandshake(), action, 'white').state;
}

/** A handshake where the OPPONENT proposed `action` with `proposedBy` (incoming pending). */
function incoming(action: string, proposedBy: Player = 'black'): HandshakeState {
  return receiveProposal(initialHandshake(), {
    kind: 'proposal',
    id: 'p1',
    action,
    proposedBy,
  });
}

describe('decideUndo — re-exported REUSED undo gate (identity, not a re-implementation)', () => {
  it('is the exact same function object as sync.ts exports (no fork of the rule)', async () => {
    const { decideUndo: fromSync } = await import('./sync');
    expect(decideUndo).toBe(fromSync);
  });

  it('permits the last mover and refuses the opponent (spot-check the reused rule)', () => {
    // white played ply 1, black played ply 2 → last mover is black.
    const { state, ply } = play([A, B]);
    expect(decideUndo(state, ply, 'black')).toEqual({ ok: true });
    expect(decideUndo(state, ply, 'white')).toEqual({ ok: false, reason: 'not-your-move' });
  });
});

describe('decideRedo — redo re-applies the just-undone move (mirror of decideUndo)', () => {
  it('refuses nothing-to-redo when no redo tail exists (canRedo === false)', () => {
    const white = decideRedo(initialState(9), false, 'white');
    const black = decideRedo(initialState(9), false, 'black');
    expect(white).toEqual({ ok: false, reason: 'nothing-to-redo' });
    expect(black).toEqual({ ok: false, reason: 'nothing-to-redo' });
  });

  it('permits the player whose undone move would be re-applied (== state.turn), refuses the other', () => {
    // white ply1, black ply2, then ONE undo: the undone move is black's (ply 2).
    // Post-undo the live turn is black (they are on the clock to place ply 2 again),
    // so ONLY black may propose the redo.
    const { state, canRedo } = play([A, B], 1);
    expect(state.turn).toBe('black');
    expect(canRedo).toBe(true);
    expect(decideRedo(state, canRedo, 'black')).toEqual({ ok: true });
    expect(decideRedo(state, canRedo, 'white')).toEqual({ ok: false, reason: 'not-your-move' });
  });

  it('attributes a re-applied WHITE move to white (undo of white ply1)', () => {
    // white ply1, then ONE undo: undone move is white's; post-undo turn is white.
    const { state, canRedo } = play([A], 1);
    expect(state.turn).toBe('white');
    expect(canRedo).toBe(true);
    expect(decideRedo(state, canRedo, 'white')).toEqual({ ok: true });
    expect(decideRedo(state, canRedo, 'black')).toEqual({ ok: false, reason: 'not-your-move' });
  });

  it('with a redo tail deeper than one, gates on the NEXT re-applied move only', () => {
    // white ply1, black ply2, white ply3, then TWO undos → cursor at ply1.
    // The next redo re-applies black's ply2, so state.turn is black → black may redo.
    const { state, canRedo } = play([A, B, C], 2);
    expect(state.turn).toBe('black');
    expect(canRedo).toBe(true);
    expect(decideRedo(state, canRedo, 'black').ok).toBe(true);
    expect(decideRedo(state, canRedo, 'white')).toEqual({ ok: false, reason: 'not-your-move' });
  });

  it('nothing-to-redo takes precedence over the mover check (no tail → refused for the turn player too)', () => {
    // Fresh game: white to move, but no redo tail. Even white (== turn) is refused,
    // proving the canRedo guard is checked FIRST (order matters — a mutant swapping the
    // guards would wrongly return not-your-move for black here).
    const s = initialState(9);
    expect(s.turn).toBe('white');
    expect(decideRedo(s, false, 'white')).toEqual({ ok: false, reason: 'nothing-to-redo' });
    expect(decideRedo(s, false, 'black')).toEqual({ ok: false, reason: 'nothing-to-redo' });
  });

  it('property: with a tail, exactly the state.turn player is permitted; without a tail, neither', () => {
    fc.assert(
      fc.property(anyPlayer, anyPlayer, fc.boolean(), (turn, mySeat, canRedo) => {
        const state: GameState = { ...initialState(9), turn };
        const decision: RedoDecision = decideRedo(state, canRedo, mySeat);
        if (!canRedo) {
          expect(decision).toEqual({ ok: false, reason: 'nothing-to-redo' });
        } else if (mySeat === turn) {
          expect(decision).toEqual({ ok: true });
        } else {
          expect(decision).toEqual({ ok: false, reason: 'not-your-move' });
        }
      }),
    );
  });

  it('undo of a WINNING move: the winner (and only the winner) may propose re-applying it', () => {
    // Build a real five-in-a-row for white along a line, then undo the winning move.
    const line = ['0,0,0', '0,1,0', '0,2,0', '0,3,0', '0,4,0'];
    const black = ['5,0,0', '5,1,0', '5,2,0', '5,3,0'];
    const game = new Game(9);
    // Interleave white line moves with black filler so turns alternate to a white win.
    game.place(coordsOf(line[0]!)); // w
    game.place(coordsOf(black[0]!)); // b
    game.place(coordsOf(line[1]!)); // w
    game.place(coordsOf(black[1]!)); // b
    game.place(coordsOf(line[2]!)); // w
    game.place(coordsOf(black[2]!)); // b
    game.place(coordsOf(line[3]!)); // w
    game.place(coordsOf(black[3]!)); // b
    game.place(coordsOf(line[4]!)); // w — winning move
    expect(game.state().winner).toBe('white');
    game.undo(); // undo the winning white move
    const state = game.state();
    expect(state.winner).toBeNull();
    expect(state.turn).toBe('white');
    expect(decideRedo(state, game.canRedo(), 'white')).toEqual({ ok: true });
    expect(decideRedo(state, game.canRedo(), 'black')).toEqual({
      ok: false,
      reason: 'not-your-move',
    });
  });
});

describe('canProposeUndo — decide-rule AND no proposal pending (single-pending)', () => {
  it('true iff the last mover proposes AND the handshake is idle', () => {
    const { state, ply } = play([A, B]); // last mover black
    expect(canProposeUndo(state, ply, 'black', idle())).toBe(true);
    // Not the last mover → false even when idle.
    expect(canProposeUndo(state, ply, 'white', idle())).toBe(false);
  });

  it('false while ANY proposal is pending — even our own outgoing undo (single-pending)', () => {
    const { state, ply } = play([A, B]); // black is last mover (rule allows)
    expect(canProposeUndo(state, ply, 'black', outgoing(UNDO_ACTION))).toBe(false);
    expect(canProposeUndo(state, ply, 'black', incoming(REMATCH_ACTION))).toBe(false);
    expect(canProposeUndo(state, ply, 'black', incoming(UNDO_ACTION))).toBe(false);
  });

  it('false at ply 0 (nothing to undo) regardless of pending state', () => {
    const s = initialState(9);
    expect(canProposeUndo(s, 0, 'white', idle())).toBe(false);
    expect(canProposeUndo(s, 0, 'black', idle())).toBe(false);
  });

  it('property: canProposeUndo === (decideUndo.ok AND handshake idle)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(0, 1, 2),
        anyPlayer,
        fc.constantFrom<HandshakeState>(idle(), outgoing(UNDO_ACTION), incoming(REMATCH_ACTION)),
        (moves, mySeat, hs) => {
          const nodes = [A, B, C].slice(0, moves);
          const { state, ply } = play(nodes);
          const expected = decideUndo(state, ply, mySeat).ok && hs.pending === null;
          expect(canProposeUndo(state, ply, mySeat, hs)).toBe(expected);
        },
      ),
    );
  });
});

describe('canProposeRedo — decide-rule AND no proposal pending (single-pending)', () => {
  it('true iff the redo-mover proposes AND the handshake is idle', () => {
    const { state, canRedo } = play([A, B], 1); // redo re-applies black's move
    expect(canProposeRedo(state, canRedo, 'black', idle())).toBe(true);
    expect(canProposeRedo(state, canRedo, 'white', idle())).toBe(false);
  });

  it('false while ANY proposal is pending (single-pending)', () => {
    const { state, canRedo } = play([A, B], 1); // black may redo when idle
    expect(canProposeRedo(state, canRedo, 'black', outgoing(REDO_ACTION))).toBe(false);
    expect(canProposeRedo(state, canRedo, 'black', incoming(UNDO_ACTION))).toBe(false);
  });

  it('false with no redo tail regardless of pending/seat', () => {
    const { state, canRedo } = play([A, B]); // no undo → no tail
    expect(canRedo).toBe(false);
    expect(canProposeRedo(state, canRedo, 'white', idle())).toBe(false);
    expect(canProposeRedo(state, canRedo, 'black', idle())).toBe(false);
  });

  it('property: canProposeRedo === (decideRedo.ok AND handshake idle)', () => {
    fc.assert(
      fc.property(
        anyPlayer,
        anyPlayer,
        fc.boolean(),
        fc.constantFrom<HandshakeState>(idle(), outgoing(REDO_ACTION), incoming(REMATCH_ACTION)),
        (turn, mySeat, canRedo, hs) => {
          const state: GameState = { ...initialState(9), turn };
          const expected = decideRedo(state, canRedo, mySeat).ok && hs.pending === null;
          expect(canProposeRedo(state, canRedo, mySeat, hs)).toBe(expected);
        },
      ),
    );
  });
});

describe('action-tag constants — the opaque N.1 tags this consumer files under', () => {
  it('are the literal wire tags "undo" / "redo" (a rename would silently break the handshake pairing)', () => {
    // Pin the exact string values: the SAME tag must be produced by the proposer and matched by the
    // responder + prompt, so if either drifted the two ends would stop pairing. A mutant blanking a
    // constant to "" is caught here.
    expect(UNDO_ACTION).toBe('undo');
    expect(REDO_ACTION).toBe('redo');
  });
});

describe('deriveUndoRedoPrompt — incoming undo/redo accept/decline view-model', () => {
  it('no prompt when idle (no incoming pending)', () => {
    expect(deriveUndoRedoPrompt(idle(), 'white')).toEqual({
      show: false,
      action: null,
      promptText: '',
    });
  });

  it('no prompt for our OWN outgoing undo (only INCOMING asks prompt us)', () => {
    expect(deriveUndoRedoPrompt(outgoing(UNDO_ACTION), 'white')).toEqual({
      show: false,
      action: null,
      promptText: '',
    });
  });

  it('no prompt for an incoming REMATCH (a different consumer’s action)', () => {
    // A #12 rematch ask must NOT surface an undo/redo prompt — the two consumers stay decoupled.
    expect(deriveUndoRedoPrompt(incoming(REMATCH_ACTION), 'white')).toEqual({
      show: false,
      action: null,
      promptText: '',
    });
  });

  it('incoming UNDO → prompt names the opponent color + "wants to undo"', () => {
    // We are white; the opponent (black) asked to undo.
    const prompt = deriveUndoRedoPrompt(incoming(UNDO_ACTION, 'black'), 'white');
    expect(prompt).toEqual({ show: true, action: 'undo', promptText: 'Black wants to undo' });
  });

  it('incoming REDO → prompt names the opponent color + "wants to redo"', () => {
    // We are black; the opponent (white) asked to redo.
    const prompt = deriveUndoRedoPrompt(incoming(REDO_ACTION, 'white'), 'black');
    expect(prompt).toEqual({ show: true, action: 'redo', promptText: 'White wants to redo' });
  });

  it('names the OPPONENT color (opposite mySeat), not the proposedBy field — 2-player invariant', () => {
    // Even if proposedBy were our own color on the wire, the prompt shows the seat opposite US.
    const prompt = deriveUndoRedoPrompt(incoming(UNDO_ACTION, 'white'), 'black');
    expect(prompt.promptText).toBe('White wants to undo');
  });

  it('unseated client (mySeat === null) falls back to neutral "Your opponent" copy', () => {
    expect(deriveUndoRedoPrompt(incoming(UNDO_ACTION, 'black'), null).promptText).toBe(
      'Your opponent wants to undo',
    );
    expect(deriveUndoRedoPrompt(incoming(REDO_ACTION, 'white'), null).promptText).toBe(
      'Your opponent wants to redo',
    );
  });

  it('after we RESPOND to the incoming ask, the pending clears → no prompt (no double-accept)', () => {
    const asked = incoming(UNDO_ACTION, 'black');
    const answered = respond(asked, 'p1', true).state;
    expect(deriveUndoRedoPrompt(answered, 'white')).toEqual({
      show: false,
      action: null,
      promptText: '',
    });
  });

  it('property: prompt shows iff an incoming pending proposal is undo/redo; color = opposite mySeat', () => {
    const actions = fc.constantFrom(UNDO_ACTION, REDO_ACTION, REMATCH_ACTION, 'other');
    fc.assert(
      fc.property(actions, anyPlayer, anyPlayer, (action, proposedBy, mySeat) => {
        const prompt: UndoRedoPrompt = deriveUndoRedoPrompt(incoming(action, proposedBy), mySeat);
        if (action === UNDO_ACTION || action === REDO_ACTION) {
          const oppColor = mySeat === 'white' ? 'Black' : 'White';
          const verb = action === UNDO_ACTION ? 'undo' : 'redo';
          expect(prompt).toEqual({
            show: true,
            action: verb,
            promptText: `${oppColor} wants to ${verb}`,
          });
        } else {
          expect(prompt).toEqual({ show: false, action: null, promptText: '' });
        }
      }),
    );
  });
});
