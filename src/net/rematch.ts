/**
 * PURE host/join/play-again decisions (Task 6.4, issue #4a) — the DOM-free, transport-free logic
 * that answers the two questions the "start / restart a networked game" wiring turns on, separated
 * from the scene/session IO glue so it earns the strict unit + mutation gate exactly as the other
 * pure net logic (`netRouting.ts`, `turnGate.ts`, `seats.ts`, `sync.ts`, `netModel.ts`).
 *
 * ## The bugs this closes (issue #4a + the play-again gap)
 *
 * - **Host/join onto a played board** — hosting or joining while local pieces exist left the played
 *   local board sitting under the session: it was never reset, so when the session later ended or
 *   fell back to local the STALE played board reappeared (issue #4a: "hosting neither resets nor
 *   archives the local board"). Before starting a networked game we must ARCHIVE + RESET the current
 *   local game iff it has actually been PLAYED — an empty board has nothing to archive and is just
 *   started. Whether to do so is a pure function of the local game's ply.
 * - **A finished networked game is a dead end** — once a networked game is WON there was no way to
 *   start another without a full reload. When a networked game ENDS (a winner is set) we PROMPT
 *   "play another?" and, on accept, start a fresh networked game. Whether the game has ended is a
 *   pure function of the authoritative game state.
 *
 * Keeping these decisions here (rather than as `if`s buried in `scene.ts` / `main.ts`) makes the
 * boundary conditions — pristine-vs-played, in-progress-vs-won — explicitly, negatively testable, so
 * no case silently falls through to the wrong behavior (an empty board wastefully archived, or a
 * played board silently kept under the session).
 *
 * This module imports only the plain `GameState` type — no transport, engine, three, or DOM — so it
 * is unit+mutation-gated to the hard 100% floor the whole `src/net/**` scope carries.
 */

import type { GameState } from '../core/gameState';

/**
 * Whether the current LOCAL game must be archived + reset before starting a networked game (pure —
 * no side effects). The rule is identical for HOST and JOIN (the task's hard requirement): a board
 * that has been PLAYED (`ply > 0`) is abandoned for the networked game, so it is archived + reset
 * (the reset swaps in a fresh `Game`, which the Task 6.3 lifecycle then finalizes under its own
 * archive id — one record per real game). A PRISTINE board (`ply === 0`) has nothing worth keeping,
 * so we just start — archiving an empty board would litter the archive with empty records.
 *
 * @param localPly The committed-placement count of the scene's current local game (`0` = pristine).
 * @returns `true` to archive + reset before starting, `false` to start straight onto the empty board.
 */
export function shouldArchiveBeforeNetStart(localPly: number): boolean {
  return localPly > 0;
}

/**
 * Whether a finished networked game should PROMPT the player to start another (pure — no side
 * effects). A networked game has ENDED exactly when the authoritative state has a `winner`; at that
 * point the wiring surfaces a "play another?" prompt and, on accept, starts a fresh networked game.
 * An in-progress game (`winner === null`) is NOT a prompt — the game is still being played.
 *
 * @param state The authoritative networked game state (the session's game).
 * @returns `true` iff the game has a winner (it has ended — prompt for a rematch).
 */
export function shouldPromptRematch(state: GameState): boolean {
  return state.winner !== null;
}
