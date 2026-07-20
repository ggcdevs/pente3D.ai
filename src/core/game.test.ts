import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Game } from './game';
import { initialState, IllegalMove, type GameState } from './gameState';
import { placePiece } from './placePiece';
import { headHash } from './eventLog';
import { keyOf, type Coord } from './coords';

/** Derive a state by folding a sequence of `placePiece` moves directly. */
function playDirect(size: number, moves: readonly Coord[]): GameState {
  let s = initialState(size);
  for (const m of moves) s = placePiece(s, m);
  return s;
}

describe('Game — fold equals direct placePiece', () => {
  it('feeding place events derives the same GameState as placePiece', () => {
    const moves: Coord[] = [
      [4, 4, 4],
      [0, 0, 0],
      [4, 4, 5],
      [1, 1, 1],
      [4, 4, 6],
    ];
    const g = new Game(9);
    for (const m of moves) g.place(m);
    expect(g.state()).toEqual(playDirect(9, moves));
  });

  it('an empty game is the initial state', () => {
    const g = new Game(9);
    expect(g.state()).toEqual(initialState(9));
  });
});

describe('Game — place', () => {
  it('rejects an illegal placement without appending an event', () => {
    const g = new Game(9);
    g.place([4, 4, 4]);
    const head = headHash(g.log);
    expect(() => g.place([4, 4, 4])).toThrow(IllegalMove);
    // The rejected move left the log untouched.
    expect(headHash(g.log)).toBe(head);
    expect(g.state().pieces[keyOf([4, 4, 4])]).toBe('white');
  });

  it('appends a place event and advances the head hash', () => {
    const g = new Game(9);
    const head0 = headHash(g.log);
    g.place([4, 4, 4]);
    expect(headHash(g.log)).not.toBe(head0);
    expect(g.log.entries.length).toBe(1);
  });
});

describe('Game — undo / redo', () => {
  it('undo steps state back: piece removed and turn restored', () => {
    const g = new Game(9);
    g.place([4, 4, 4]); // white
    g.place([0, 0, 0]); // black
    expect(g.state().turn).toBe('white');
    g.undo();
    expect(g.state().pieces[keyOf([0, 0, 0])]).toBeUndefined();
    expect(g.state().pieces[keyOf([4, 4, 4])]).toBe('white');
    expect(g.state().turn).toBe('black');
  });

  it('redo restores an undone move', () => {
    const g = new Game(9);
    g.place([4, 4, 4]);
    g.place([0, 0, 0]);
    g.undo();
    g.redo();
    expect(g.state().pieces[keyOf([0, 0, 0])]).toBe('black');
    expect(g.state().turn).toBe('white');
  });

  it('restores captures/turn/winner correctly through undo then redo', () => {
    // Build a capture: white brackets two black pieces.
    // white 0,0,0 ; black 1,0,0 ; white 8,8,8 ; black 2,0,0 ; white 3,0,0 -> capture
    const g = new Game(9);
    g.place([0, 0, 0]); // white
    g.place([1, 0, 0]); // black
    g.place([8, 8, 8]); // white
    g.place([2, 0, 0]); // black
    g.place([3, 0, 0]); // white closes bracket, captures 1,0,0 and 2,0,0
    expect(g.state().captures.white).toBe(1);
    expect(g.state().pieces[keyOf([1, 0, 0])]).toBeUndefined();
    expect(g.state().pieces[keyOf([2, 0, 0])]).toBeUndefined();

    g.undo(); // undo the capturing move
    expect(g.state().captures.white).toBe(0);
    expect(g.state().pieces[keyOf([1, 0, 0])]).toBe('black');
    expect(g.state().pieces[keyOf([2, 0, 0])]).toBe('black');
    expect(g.state().pieces[keyOf([3, 0, 0])]).toBeUndefined();

    g.redo(); // redo restores the capture exactly
    expect(g.state().captures.white).toBe(1);
    expect(g.state().pieces[keyOf([1, 0, 0])]).toBeUndefined();
    expect(g.state().pieces[keyOf([2, 0, 0])]).toBeUndefined();
    expect(g.state().pieces[keyOf([3, 0, 0])]).toBe('white');
  });

  it('a new place after undo discards the redo tail', () => {
    const g = new Game(9);
    g.place([4, 4, 4]); // white
    g.place([0, 0, 0]); // black
    g.undo(); // black move undone; redo would restore 0,0,0
    g.place([1, 1, 1]); // black plays elsewhere -> redo tail discarded
    expect(g.state().pieces[keyOf([1, 1, 1])]).toBe('black');
    expect(g.state().pieces[keyOf([0, 0, 0])]).toBeUndefined();
    // The redo tail was discarded, so there is nothing left to redo.
    expect(() => g.redo()).toThrow(IllegalMove);
    expect(g.state().pieces[keyOf([0, 0, 0])]).toBeUndefined();
    expect(g.state().pieces[keyOf([1, 1, 1])]).toBe('black');
  });

  it('undo with nothing to undo throws IllegalMove and leaves the log untouched', () => {
    const g = new Game(9);
    const head = headHash(g.log);
    expect(() => g.undo()).toThrow(IllegalMove);
    expect(() => g.undo()).toThrow(/nothing to undo/);
    expect(headHash(g.log)).toBe(head);
  });

  it('redo with nothing to redo throws IllegalMove and leaves the log untouched', () => {
    const g = new Game(9);
    g.place([4, 4, 4]);
    const head = headHash(g.log);
    expect(() => g.redo()).toThrow(IllegalMove);
    expect(() => g.redo()).toThrow(/nothing to redo/);
    expect(headHash(g.log)).toBe(head);
  });
});

describe('Game — canUndo / canRedo reachability (mirrors the undo/redo guards)', () => {
  it('a pristine game can neither undo nor redo', () => {
    const g = new Game(9);
    expect(g.canUndo()).toBe(false);
    expect(g.canRedo()).toBe(false);
  });

  it('after a placement, undo is available and redo is not', () => {
    const g = new Game(9);
    g.place([4, 4, 4]);
    expect(g.canUndo()).toBe(true);
    expect(g.canRedo()).toBe(false);
  });

  it('after an undo, redo is available and (at ply 0) undo is not', () => {
    const g = new Game(9);
    g.place([4, 4, 4]);
    g.undo();
    expect(g.canUndo()).toBe(false); // back at ply 0
    expect(g.canRedo()).toBe(true); // one undone snapshot remains
  });

  it('with two plies then one undo, BOTH undo and redo are available', () => {
    const g = new Game(9);
    g.place([4, 4, 4]);
    g.place([0, 0, 0]);
    g.undo(); // cursor at ply 1: a committed piece below, an undone one above
    expect(g.canUndo()).toBe(true);
    expect(g.canRedo()).toBe(true);
  });

  it('placing after an undo discards the redo tail, so canRedo goes false', () => {
    const g = new Game(9);
    g.place([4, 4, 4]);
    g.undo();
    expect(g.canRedo()).toBe(true);
    g.place([1, 1, 1]); // branch cut — drops the undone tail
    expect(g.canRedo()).toBe(false);
    expect(g.canUndo()).toBe(true);
  });

  it('canUndo/canRedo agree with the undo/redo guards: no throw iff the flag is true', () => {
    const g = new Game(9);
    g.place([4, 4, 4]);
    g.place([0, 0, 0]);
    // canUndo true → undo does not throw; drive to ply 0 then it must be false and undo throws.
    while (g.canUndo()) g.undo();
    expect(g.canUndo()).toBe(false);
    expect(() => g.undo()).toThrow(IllegalMove);
    // canRedo true → redo does not throw; drive to the top then it must be false and redo throws.
    while (g.canRedo()) g.redo();
    expect(g.canRedo()).toBe(false);
    expect(() => g.redo()).toThrow(IllegalMove);
  });
});

describe('Game — undo after a win recomputes the winner', () => {
  it('undoing the winning move clears winner and re-enables play', () => {
    // White makes 5-in-a-row along x through 0..4 at y=0,z=0.
    // Interleave black moves off to the side.
    const g = new Game(9);
    g.place([0, 0, 0]); // W
    g.place([0, 5, 0]); // B
    g.place([1, 0, 0]); // W
    g.place([1, 5, 0]); // B
    g.place([2, 0, 0]); // W
    g.place([2, 5, 0]); // B
    g.place([3, 0, 0]); // W
    g.place([3, 5, 0]); // B
    g.place([4, 0, 0]); // W -> five in a row, white wins
    expect(g.state().winner).toBe('white');
    expect(g.state().winningLine).toBeDefined();

    g.undo(); // undo the winning move
    expect(g.state().winner).toBeNull();
    expect(g.state().winningLine).toBeUndefined();
    expect(g.state().pieces[keyOf([4, 0, 0])]).toBeUndefined();
    // Play is possible again from the recomputed non-won state.
    expect(() => g.place([8, 8, 8])).not.toThrow();
  });
});

describe('Game — stateAt snapshot cache', () => {
  it('returns O(1) state at any ply', () => {
    const moves: Coord[] = [
      [4, 4, 4],
      [0, 0, 0],
      [4, 4, 5],
      [1, 1, 1],
    ];
    const g = new Game(9);
    for (const m of moves) g.place(m);
    expect(g.stateAt(0)).toEqual(initialState(9));
    expect(g.stateAt(1)).toEqual(playDirect(9, moves.slice(0, 1)));
    expect(g.stateAt(2)).toEqual(playDirect(9, moves.slice(0, 2)));
    expect(g.stateAt(3)).toEqual(playDirect(9, moves.slice(0, 3)));
    expect(g.stateAt(4)).toEqual(playDirect(9, moves.slice(0, 4)));
    expect(g.ply()).toBe(4);
    expect(g.state()).toEqual(g.stateAt(4));
  });

  it('reflects undo in the current ply while keeping snapshots reachable', () => {
    const g = new Game(9);
    g.place([4, 4, 4]);
    g.place([0, 0, 0]);
    g.undo();
    expect(g.ply()).toBe(1);
    expect(g.state()).toEqual(g.stateAt(1));
  });

  it('clamps out-of-range indices to the valid snapshot range', () => {
    const g = new Game(9);
    g.place([4, 4, 4]);
    expect(g.stateAt(-1)).toEqual(g.stateAt(0));
    expect(g.stateAt(999)).toEqual(g.stateAt(g.ply()));
  });
});

describe('Game — property: replaying the log reproduces state + headHash', () => {
  it('a fresh Game fed the same event log matches state and headHash', () => {
    const arbMove = fc.tuple(
      fc.integer({ min: 0, max: 8 }),
      fc.integer({ min: 0, max: 8 }),
      fc.integer({ min: 0, max: 8 }),
    );
    // A stream of actions: place a (possibly-illegal) move, undo, or redo.
    const arbAction = fc.oneof(
      arbMove.map((m) => ({ kind: 'place' as const, m: m as Coord })),
      fc.constant({ kind: 'undo' as const }),
      fc.constant({ kind: 'redo' as const }),
    );

    fc.assert(
      fc.property(fc.array(arbAction, { maxLength: 40 }), (actions) => {
        const g = new Game(9);
        for (const a of actions) {
          try {
            if (a.kind === 'place') g.place(a.m);
            else if (a.kind === 'undo') g.undo();
            else g.redo();
          } catch (e) {
            if (!(e instanceof IllegalMove)) throw e;
            // Illegal actions are ignored; the log is unchanged.
          }
        }
        // Replaying the resulting log into a fresh Game reproduces everything.
        const replay = Game.fromLog(9, g.log);
        expect(replay.state()).toEqual(g.state());
        expect(headHash(replay.log)).toBe(headHash(g.log));
        expect(replay.ply()).toBe(g.ply());
      }),
    );
  });
});
