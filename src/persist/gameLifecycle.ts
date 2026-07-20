/**
 * PURE game-lifecycle boundary detection (Task 6.3) — the DOM-free, IndexedDB-free logic that
 * decides, from plain facts alone, WHEN one game ends and a fresh one begins, so the archive
 * ACCUMULATES every game instead of overwriting a single record.
 *
 * ## The problem it solves (issue #4 / Stage 6)
 *
 * The Stage 5 autosave keyed every save under ONE stable id (see `main.ts`), so each new game
 * silently overwrote the previous game's record and the archive could only ever hold the current
 * game. This module supplies the pure decision the glue needs to keep EVERY game: at a game
 * BOUNDARY it tells the glue to FINALIZE the current record (persist it as it stands) and MINT a
 * FRESH id for the next game, so past games — local AND networked, finished AND abandoned — remain
 * in the archive as their own records.
 *
 * ## What a boundary is
 *
 * A boundary is the instant a game the archive was tracking gives way to a DIFFERENT game:
 *
 *   - **game-over**: once a game has a winner it is DONE. That won game is finalized as its own
 *     record; a later placement (only possible after a reset/load/host onto a fresh board — a won
 *     game rejects further moves) then belongs to a distinct record.
 *   - **reset**: the user abandons the current game for a pristine one. The glue stamps each fresh
 *     `Game` with a monotonic `generation`; a changed generation over a game that had been PLAYED is
 *     a boundary (the abandoned game is finalized as-is, then a fresh id tracks the pristine one).
 *   - **host/join-with-pieces**: starting a NETWORKED game while local pieces exist abandons the
 *     local game. The glue bumps the generation when a net session begins, so this rides the same
 *     "generation changed over a played game" rule — no separate branch.
 *
 * Keeping this decision here (rather than as scattered `if`s in `main.ts`) makes every boundary
 * explicitly, negatively testable — so no boundary silently keeps overwriting one record, and no
 * pristine, never-touched game wastefully mints a new record on an idle reset. It imports only the
 * plain `GameState` type — no IndexedDB, transport, three, or DOM — so it earns the strict unit +
 * mutation gate the rest of `src/persist/**` carries.
 */

import type { GameState } from '../core/gameState';

/**
 * The lifecycle facts the glue reads about the game it is currently autosaving, on each check. Plain
 * and serializable so the decision is a pure function of them (no reaching into `Game`/DOM/net):
 *
 *   - `generation` — a monotonic token the glue bumps whenever it swaps in a genuinely NEW `Game`
 *     (reset, an archive load, or the start of a networked session). A changed generation is how the
 *     pure logic learns "this is a different game" without diffing event logs.
 *   - `ply` — the number of committed placements in the observed game. `0` is a pristine board.
 *   - `hasWinner` — whether the observed game has been won (a terminal game).
 */
export interface LifecycleObservation {
  /** Monotonic token the glue bumps on every genuinely-new `Game` (reset / load / net-start). */
  readonly generation: number;
  /** Committed-placement count of the observed game (`0` = a pristine, never-played board). */
  readonly ply: number;
  /** Whether the observed game has a winner (a terminal, finished game). */
  readonly hasWinner: boolean;
}

/**
 * Project the plain lifecycle facts out of a live `GameState` + the glue's generation token and ply.
 * The glue owns the generation counter (it knows when it swapped the `Game`) and the ply (read off
 * the `Game`); the winner is read straight off the authoritative state, so a networked game (whose
 * state is the session's) and a local game are observed identically.
 */
export function observeLifecycle(
  generation: number,
  ply: number,
  state: GameState,
): LifecycleObservation {
  return { generation, ply, hasWinner: state.winner !== null };
}

/**
 * What the pure decision tracks between checks: the identity of the game currently being autosaved —
 * the `generation` token it was tracked under, its last-observed `ply`, and whether we have already
 * consumed its game-over boundary (`finalized`), so a won game's later idle autosaves do not re-fire
 * a boundary every save. The glue threads this: it holds the value {@link nextLifecycle} returns and
 * feeds it back on the next observation.
 */
export interface LifecycleState {
  /** The generation token of the game currently tracked / autosaved. */
  readonly generation: number;
  /** The last-observed committed-placement count of the tracked game. */
  readonly ply: number;
  /** Whether the tracked game's game-over boundary has already been consumed (won + finalized). */
  readonly finalized: boolean;
}

/** The first lifecycle state for the initial game (generation 0, pristine, not yet finalized). */
export function initialLifecycle(): LifecycleState {
  return { generation: 0, ply: 0, finalized: false };
}

/**
 * The two INDEPENDENT actions the glue may take after observing the live game, plus the `next`
 * {@link LifecycleState} to thread into the following observation. They are separate because they map
 * to distinct archive writes, and getting them right is what keeps the archive both COMPLETE (no game
 * lost) and CLEAN (no game duplicated):
 *
 *   - `mintFresh` — a genuinely NEW game has begun (the glue swapped in a new `Game`: reset, archive-
 *     load, or the start of a networked session) over a game that had been PLAYED. The just-ended game
 *     is ALREADY durable under the current id (every in-game autosave kept it current), so the glue
 *     mints a FRESH id and starts saving the new game under it — the old record stays untouched. This
 *     is the accumulation point: one new archive id per real new game.
 *   - `finalizeCurrent` — the game reached a terminal WINNER. There is no new id yet (nothing new has
 *     started — the fresh id is minted only when the next game actually begins), so the glue just
 *     saves the won game's terminal state under the CURRENT id and marks it finalized. Minting here
 *     would prematurely stamp the still-live won game under a new id and DUPLICATE it, so we don't.
 *
 * At most one fires per observation (a generation change and a fresh winner cannot both be new in the
 * same tick — a win keeps the same `Game` object, hence the same generation).
 */
export interface LifecycleTransition {
  /**
   * True iff a NEW game just began over a played one: the glue mints a FRESH autosave id and tracks
   * the new game under it (the previous record is already durable and left intact). False for an
   * ordinary autosave and for a pristine→pristine swap — so the archive is never littered with empty
   * records, and never overwrites a finished game with the empty board that replaced it.
   */
  readonly mintFresh: boolean;
  /**
   * True iff the observed game just reached a terminal winner (and was not already finalized): the
   * glue saves its terminal state under the CURRENT id and marks it done. Fires exactly once per game
   * (subsequent idle re-saves of the same finished game do not re-fire it).
   */
  readonly finalizeCurrent: boolean;
  /** The lifecycle state to thread into the next observation (tracks the possibly-new game). */
  readonly next: LifecycleState;
}

/**
 * Decide the glue's action for the observed game relative to the tracked `prev` state (pure).
 *
 *   - MINT-FRESH when the generation changed (a new `Game` was swapped in via reset / archive-load /
 *     net-start) AND the game we were tracking had actually been PLAYED — it had committed placements
 *     (`prev.ply > 0`) OR had been finalized (a won game we are now leaving). A pristine→pristine swap
 *     is NOT a mint (nothing worth keeping), so an idle reset never litters the archive.
 *   - FINALIZE-CURRENT when the observed game HAS a winner, in the SAME game we are tracking
 *     (`obs.generation === prev.generation`), not already finalized — the terminal state of a won game
 *     is written under its current id exactly once.
 *
 * `next` always adopts the observed generation + ply. `finalized` becomes true on a finalize, is
 * carried while the SAME game stays tracked (a won game may idle before it is left), and resets to
 * false whenever a new generation is adopted (the fresh game starts clean).
 *
 * The glue must have ALREADY bumped `obs.generation` when it swapped a `Game`; `prev.generation` is
 * the generation of the game autosaved BEFORE this observation, so the mint rule can compare them.
 */
export function nextLifecycle(
  prev: LifecycleState,
  obs: LifecycleObservation,
): LifecycleTransition {
  const sameGame = obs.generation === prev.generation;
  const mintFresh = !sameGame && (prev.ply > 0 || prev.finalized);
  const finalizeCurrent = obs.hasWinner && sameGame && !prev.finalized;
  return {
    mintFresh,
    finalizeCurrent,
    next: {
      generation: obs.generation,
      ply: obs.ply,
      // Finalized once won; carried only while the SAME game is tracked; cleared on a new generation.
      finalized: sameGame && (prev.finalized || finalizeCurrent),
    },
  };
}
