/**
 * PURE seat-turn gate (Task 6.2, issue #4c) — the DOM-free, transport-free decision that answers
 * "may THIS client place right now?" in a networked game, separated from the scene/session IO glue so
 * it earns the strict unit + mutation gate exactly as the other pure net logic (`netRouting.ts`,
 * `seats.ts`, `sync.ts`, `netModel.ts`).
 *
 * ## The bug this closes (issue #4c)
 *
 * With the issue #4 fix a networked placement routes through the ONE authoritative session game. But
 * nothing yet stopped a client from placing on the OPPONENT's turn: a click would push a move onto the
 * shared log out of seat order (white playing black's move, or vice-versa). This module is the
 * turn-eligibility decision the scene consults before a networked placement — block unless it is the
 * local seat's move — so the shared game only ever advances in legal seat order.
 *
 * ## Scope — networked games only
 *
 * A local (non-networked) game has no seats: BOTH colours are played by the one local player, so the
 * gate must NEVER block there (a single-player game is unaffected — the task's hard requirement). The
 * gate is therefore expressed purely over the networked seat: it blocks ONLY when a seat is held and it
 * is not that seat's turn. The scene calls it exclusively when the session is authoritative (a live
 * networked game); the `seat === null` arm is the honest defensive fall-through — no seat claimed yet
 * means no turn to enforce, so it does not block — and is negatively tested here so the guard can't
 * silently invert.
 *
 * This module imports only the plain `NetSeat` type + the core `Player` type — no transport, engine,
 * three, or DOM — so it is unit+mutation-gated to the hard 100% floor the whole `src/net/**` scope
 * carries.
 */

import type { Player } from '../core/gameState';
import type { NetSeat } from '../ui/widgets/netModel';

/**
 * Whether the local client — holding `seat` — may place while it is `turn`'s move in the authoritative
 * networked game (pure — no side effects).
 *
 *   - `seat === turn`  → `true`: it IS this seat's move; the placement is allowed and routes through
 *     the SyncEngine to the peer.
 *   - `seat` is the OTHER colour → `false`: it is the opponent's move; block the placement (the scene
 *     shows the subtle off-turn cue instead of pushing an out-of-order move onto the shared log).
 *   - `seat === null` → `true`: no seat is held (not yet claimed), so there is no turn to enforce — an
 *     honest, non-blocking fall-through, never a disguised block. The scene only calls this once a
 *     session is authoritative (a seat is claimed the instant host/join begins), so in practice `seat`
 *     is a colour here; the `null` arm keeps the function total and is asserted negatively below.
 *
 * @param seat The local client's claimed seat (`white` / `black`), or `null` before a seat is held.
 * @param turn The player to move in the authoritative game state.
 * @returns `true` if this client may place now, `false` if it is the opponent's turn.
 */
export function canPlaceForSeat(seat: NetSeat, turn: Player): boolean {
  if (seat === null) return true;
  return seat === turn;
}
