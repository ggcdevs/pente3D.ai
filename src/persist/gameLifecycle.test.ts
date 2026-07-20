import { describe, expect, it } from 'vitest';
import {
  initialLifecycle,
  nextLifecycle,
  observeLifecycle,
  type LifecycleObservation,
  type LifecycleState,
} from './gameLifecycle';
import { initialState, type GameState, type Player } from '../core/gameState';

/**
 * Strict unit + mutation gate for the PURE game-lifecycle boundary detection (Task 6.3). This is the
 * decision that turns the Stage-5 single-record autosave (which overwrote every past game) into an
 * ACCUMULATING archive: at a game boundary the glue MINTS a fresh id (a new game began) or FINALIZES
 * the current record (the game was won), so every game — finished, abandoned, local, or networked —
 * is kept as its own record and none is duplicated.
 *
 * Both actions are asserted POSITIVELY and NEGATIVELY so no boundary silently keeps overwriting one
 * record (the exact Stage-5 bug) and no idle/pristine transition wastefully litters or duplicates:
 *   - finalize fires ONCE, only on a fresh winner in the SAME tracked game (not re-fired on idle saves);
 *   - mint fires ONLY when the generation changes over a game that had been PLAYED (a ply) or was a
 *     finished game being left — a pristine→pristine swap does NOT mint (no empty records);
 *   - a win does NOT mint (nothing new started yet — that would duplicate the still-live won game);
 *   - an ordinary mid-game autosave (growing ply, same generation) neither mints nor finalizes.
 * `next` is threaded and re-fed to prove the decision is stateful-but-pure (no hidden mutation).
 */

/** A `GameState` with an explicit winner (the only field the lifecycle observation reads off state). */
function stateWithWinner(winner: Player | null): GameState {
  const base = initialState(5);
  return winner === null ? base : { ...base, winner };
}

/** A plain observation, so a test states only the facts it varies. */
function obs(generation: number, ply: number, hasWinner: boolean): LifecycleObservation {
  return { generation, ply, hasWinner };
}

describe('observeLifecycle', () => {
  it('projects generation + ply verbatim and derives hasWinner from a NON-null winner', () => {
    const o = observeLifecycle(3, 7, stateWithWinner('white'));
    expect(o).toEqual({ generation: 3, ply: 7, hasWinner: true });
  });

  it('derives hasWinner=false from a null winner (in-progress game)', () => {
    const o = observeLifecycle(0, 0, stateWithWinner(null));
    expect(o).toEqual({ generation: 0, ply: 0, hasWinner: false });
  });

  it('reads the winner off the given state (black wins → hasWinner true)', () => {
    expect(observeLifecycle(1, 2, stateWithWinner('black')).hasWinner).toBe(true);
  });
});

describe('initialLifecycle', () => {
  it('starts at generation 0, ply 0, not finalized', () => {
    expect(initialLifecycle()).toEqual({ generation: 0, ply: 0, finalized: false });
  });
});

describe('nextLifecycle — finalizeCurrent (game-over)', () => {
  it('finalizes when the tracked game reaches a winner (and does NOT mint — nothing new began)', () => {
    const t = nextLifecycle(initialLifecycle(), obs(0, 4, true));
    expect(t.finalizeCurrent).toBe(true);
    expect(t.mintFresh).toBe(false);
    // The just-won game is now finalized so its game-over is consumed exactly once.
    expect(t.next).toEqual({ generation: 0, ply: 4, finalized: true });
  });

  it('does NOT re-finalize on a later idle autosave of the SAME finished game', () => {
    const afterWin: LifecycleState = { generation: 0, ply: 4, finalized: true };
    const t = nextLifecycle(afterWin, obs(0, 4, true));
    expect(t.finalizeCurrent).toBe(false);
    expect(t.mintFresh).toBe(false);
    expect(t.next).toEqual({ generation: 0, ply: 4, finalized: true });
  });

  it('does NOT finalize while the game is still in progress (no winner)', () => {
    const t = nextLifecycle(initialLifecycle(), obs(0, 2, false));
    expect(t.finalizeCurrent).toBe(false);
    expect(t.next).toEqual({ generation: 0, ply: 2, finalized: false });
  });

  it('keys game-over on the winner flag, not the ply', () => {
    // Guards a mutant that keys finalize on ply instead of hasWinner.
    expect(nextLifecycle(initialLifecycle(), obs(0, 9, false)).finalizeCurrent).toBe(false);
    expect(nextLifecycle(initialLifecycle(), obs(0, 0, true)).finalizeCurrent).toBe(true);
  });

  it('does NOT finalize a winner observed under a DIFFERENT generation (that is a swap, not a win)', () => {
    // A won state carried into a new generation is the glue leaving a game, not a fresh win here.
    const played: LifecycleState = { generation: 0, ply: 3, finalized: false };
    const t = nextLifecycle(played, obs(1, 3, true));
    expect(t.finalizeCurrent).toBe(false);
  });
});

describe('nextLifecycle — mintFresh (a new game over a played one)', () => {
  it('mints when the generation changes over a game that had committed placements', () => {
    const played: LifecycleState = { generation: 0, ply: 3, finalized: false };
    const t = nextLifecycle(played, obs(1, 0, false));
    expect(t.mintFresh).toBe(true);
    expect(t.finalizeCurrent).toBe(false);
    expect(t.next).toEqual({ generation: 1, ply: 0, finalized: false });
  });

  it('mints when the generation changes while LEAVING a finished (finalized) game', () => {
    const finished: LifecycleState = { generation: 2, ply: 0, finalized: true };
    const t = nextLifecycle(finished, obs(3, 0, false));
    expect(t.mintFresh).toBe(true);
    expect(t.next).toEqual({ generation: 3, ply: 0, finalized: false });
  });

  it('does NOT mint when a PRISTINE game is swapped for another pristine game (idle reset)', () => {
    const pristine: LifecycleState = { generation: 0, ply: 0, finalized: false };
    const t = nextLifecycle(pristine, obs(1, 0, false));
    expect(t.mintFresh).toBe(false);
    // `next` still adopts the NEW generation so the fresh pristine game is tracked going forward.
    expect(t.next).toEqual({ generation: 1, ply: 0, finalized: false });
  });

  it('a mint requires an ACTUAL generation difference — same generation is not a swap', () => {
    // Guards a mutant that flips the generation inequality to a constant/true.
    const played: LifecycleState = { generation: 5, ply: 3, finalized: false };
    expect(nextLifecycle(played, obs(5, 4, false)).mintFresh).toBe(false);
  });
});

describe('nextLifecycle — ordinary in-game autosave (neither mints nor finalizes)', () => {
  it('a growing ply on the same generation is neither a mint nor a finalize, and adopts the new ply', () => {
    const prev: LifecycleState = { generation: 0, ply: 1, finalized: false };
    const t = nextLifecycle(prev, obs(0, 2, false));
    expect(t.mintFresh).toBe(false);
    expect(t.finalizeCurrent).toBe(false);
    expect(t.next).toEqual({ generation: 0, ply: 2, finalized: false });
  });

  it('carries finalized forward while the SAME finished game idles', () => {
    const finished: LifecycleState = { generation: 1, ply: 6, finalized: true };
    const idle = nextLifecycle(finished, obs(1, 6, true));
    expect(idle.mintFresh).toBe(false);
    expect(idle.finalizeCurrent).toBe(false);
    expect(idle.next.finalized).toBe(true);
  });

  it('clears finalized whenever a new generation is adopted (fresh game starts clean)', () => {
    // Even the non-minting pristine→pristine swap resets finalized under the new generation.
    const pristine: LifecycleState = { generation: 0, ply: 0, finalized: false };
    expect(nextLifecycle(pristine, obs(7, 0, false)).next.finalized).toBe(false);
    // And a finalized game left for a new generation (which DOES mint) also clears it.
    const finished: LifecycleState = { generation: 0, ply: 5, finalized: true };
    expect(nextLifecycle(finished, obs(1, 0, false)).next.finalized).toBe(false);
  });
});

describe('nextLifecycle — a full local lifecycle threaded end-to-end', () => {
  it('mints/finalizes correctly across play → win → reset → play → reset', () => {
    // Thread `next` exactly as the glue does; collect where a fresh record is minted vs finalized.
    let s = initialLifecycle();
    const events: string[] = [];
    const step = (o: LifecycleObservation): void => {
      const t = nextLifecycle(s, o);
      if (t.mintFresh) events.push(`mint@${o.generation}`);
      if (t.finalizeCurrent) events.push(`final@${o.generation}`);
      s = t.next;
    };

    step(obs(0, 1, false)); // move 1 — in progress
    step(obs(0, 2, false)); // move 2 — in progress
    step(obs(0, 3, true)); //  move 3 WINS → finalize game A under its id (no mint)
    step(obs(0, 3, true)); //  idle re-save of finished A → nothing
    step(obs(1, 0, false)); // RESET after the win → new gen over a finalized game → MINT for B
    step(obs(1, 1, false)); // new game B move 1
    step(obs(2, 0, false)); // RESET mid-game B (played, ply 1) → MINT for C
    step(obs(2, 0, false)); // pristine game C idles — nothing

    // Finalize A once; mint at the two real new-game starts (B then C).
    expect(events).toEqual(['final@0', 'mint@1', 'mint@2']);
    expect(s).toEqual({ generation: 2, ply: 0, finalized: false });
  });

  it('an idle reset of a never-played game mints NOTHING (archive not littered)', () => {
    let s = initialLifecycle();
    const mints: boolean[] = [];
    for (let gen = 1; gen <= 3; gen++) {
      const t = nextLifecycle(s, obs(gen, 0, false));
      mints.push(t.mintFresh);
      s = t.next;
    }
    expect(mints).toEqual([false, false, false]);
    expect(s.generation).toBe(3);
  });
});
