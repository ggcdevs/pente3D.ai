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
 * It also owns the rematch game's IDENTITY ({@link rematchGameUuid}): both peers reset into the SAME
 * fresh game, derived from state they already share rather than independently randomized.
 *
 * This module imports only the plain `GameState` type and the pure `hashStep` primitive — no transport,
 * engine, three, or DOM — so it is unit+mutation-gated to the hard 100% floor the whole `src/net/**`
 * scope carries.
 */

import { hashStep } from '../core/hash';
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

/**
 * The UUID of the fresh game a rematch resets into, DERIVED from the game being left behind and the
 * generation being entered (pure — no randomness, no clock).
 *
 * A rematch is *one* new game, and both peers reset into it independently over the same live
 * connection (N.2 decision 2 — no disconnect/re-host, no coordination round-trip). If each minted a
 * RANDOM uuid they would each be sitting on a *different* game with the same (bumped) epoch: two
 * archive records for one rematch, and convergence left to the accident that an empty log is a prefix
 * of anything — so whichever peer moved first would have its game adopted, and that accident is exactly
 * what the design §3 seed gate on the sync channel (`SyncEngine`) must be free to refuse. Deriving the
 * id from state BOTH peers already share — the prior game's uuid and the generation number, both equal
 * on both sides at the moment they reset — makes the rematch a genuinely shared game at genesis, the
 * same property initiator election gives a first game (#42).
 *
 * A staggered rematch (one peer resets, the other adopts that generation before resetting) still
 * converges, and the derivation is what makes that work rather than a coincidence: the second reset
 * derives from the game it has by then adopted, at a HIGHER generation, and the first peer RE-DERIVES
 * the same id from the game it is holding and recognises the fresh game as its own next generation
 * (`SyncEngine.receiveOtherGame`). That recognition is why a rematch crosses the move-sync channel at
 * all — the fresh game has a different uuid, so without it the pair's own next game is indistinguishable
 * from a stranger's and every seed that names a concrete game refuses it, leaving the two peers stuck on
 * two games. Asserted end-to-end in `session.test.ts` ("a rematch converges under EVERY seed").
 *
 * @param priorUuid The uuid of the game the rematch is leaving (both peers are on it).
 * @param epoch The fresh-game generation being entered (the incremented epoch).
 * @returns The derived uuid — identical on both peers for identical inputs, and distinct for a
 *   different prior game or a different generation.
 */
export function rematchGameUuid(priorUuid: string, epoch: number): string {
  // The generation rides in the DATA half, tagged: `hashStep` joins its two halves with a fixed
  // delimiter, so no shift of the boundary between the prior uuid and the generation can collide
  // (`("g1", 11)` and `("g11", 1)` are distinct), and the `rematch:` tag separates this derivation from
  // the log's own chain steps (whose data half is only ever `place:…`/`undo`/`redo`). Every part of the
  // input is load-bearing — there is no decorative constant here whose loss would go unnoticed.
  return hashStep(priorUuid, `rematch:${epoch}`);
}
