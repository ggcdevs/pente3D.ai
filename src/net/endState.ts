/**
 * PURE networked end-state view-model + seat alternation (Task N.2.1, issue #12 win/rematch flow).
 *
 * This is the DOM-free, transport-free, three-free logic behind the networked end-state overlay
 * (the view-only "you won / they won + how" panel that replaces the blocking `window.confirm` at
 * `main.ts`) and the MUTUAL rematch it offers. It sits beside the other pure `src/net` logic
 * (`handshake.ts`, `rematch.ts`, `seats.ts`, `turnGate.ts`, `netRouting.ts`) so it earns the same
 * strict unit + fast-check + mutation gate and the hard 100% coverage floor — the boundary
 * conditions (game-over-vs-not, line-vs-capture win, each handshake phase) are explicitly and
 * negatively testable, so no case silently paints the wrong overlay.
 *
 * ## What it derives, and what it REUSES (DRY — no duplicated state)
 *
 * - **`deriveEndState`** folds three inputs the session already holds — the authoritative
 *   {@link GameState}, the N.1 {@link HandshakeState}, and this client's seat — into the overlay
 *   view-model. It does NOT re-implement win detection (it reads the authoritative `winner` /
 *   `winningLine` that `src/core/placePiece` already computed) and it does NOT re-implement the
 *   handshake state machine: `rematchUi` is derived purely from the N.1 selectors
 *   ({@link outgoingPending} / {@link incomingPending} / {@link resolution}). The overlay only shows
 *   for a NETWORKED, game-OVER state — a local game or an in-progress game shows nothing (the caller
 *   passes `handshakeState` only for a session; `deriveEndState`'s `show` still gates on the winner
 *   so an in-progress networked state never surfaces the overlay).
 *
 * - **`alternateSeats`** swaps white ↔ black for the next game — the "colors ALTERNATE every game,
 *   regardless of who won" maintainer decision (plan of record, N.2 design decision 2). It is a pure
 *   involution over the identity-owned {@link SeatMap}: applying it twice returns the original map,
 *   so the seat owners are simply exchanged, never lost or duplicated.
 *
 * ## Untrusted-input note (the relay is publicly writable)
 *
 * `resultText` names WHO won purely from the authoritative `winner` (a `Player` union — `'white'` /
 * `'black'`), NOT from any opponent-supplied free text, so nothing attacker-controllable is placed
 * in it. The consuming widget still renders it via `textContent`; this module produces only the
 * fixed, enumerated strings below.
 */

import type { GameState, Player } from '../core/gameState';
import {
  incomingPending,
  outgoingPending,
  resolution,
  type HandshakeState,
} from './handshake';
import type { SeatColor, SeatMap } from './seats';

/**
 * How the just-finished game was WON — read from the authoritative state, never a magic string.
 * A five-in-a-row records a {@link GameState.winningLine}; a five-capture-pairs win records none.
 */
export type WinReason = 'line' | 'captures';

/**
 * The rematch sub-state of the end-state overlay, derived ENTIRELY from the N.1 handshake — this
 * module owns none of the transition logic, only the projection the widget renders:
 *
 * - `idle` — no rematch proposal in flight and none resolved: show a "Rematch" button.
 * - `proposed-waiting` — WE proposed (an outgoing pending proposal): show "waiting for opponent…".
 * - `incoming` — the OPPONENT proposed (an incoming pending proposal): show Accept / Decline.
 * - `accepted` — the most recent resolution accepted: both sides reset to a fresh game.
 * - `declined` — the most recent resolution declined: back to `idle`-with-a-note (the consumer
 *   may re-enable proposing).
 */
export type RematchUi =
  | 'idle'
  | 'proposed-waiting'
  | 'incoming'
  | 'accepted'
  | 'declined';

/** The serialisable end-state overlay view-model `deriveEndState` produces. */
export interface EndState {
  /** `true` ONLY when a networked game is OVER (`winner !== null`) — the overlay's visibility gate. */
  readonly show: boolean;
  /** The winner, or `null` while the game is still in progress (then `show` is `false`). */
  readonly winner: Player | null;
  /** How the game was won (`line` / `captures`), or `null` when there is no winner. */
  readonly winReason: WinReason | null;
  /** `true` iff THIS client (its seat) is the winner — lets the overlay say "You won" vs "…won". */
  readonly iWon: boolean;
  /** A fixed, enumerated result sentence (who won + how) — empty while in progress. */
  readonly resultText: string;
  /** The rematch sub-state, derived from the N.1 handshake selectors. */
  readonly rematchUi: RematchUi;
}

/** The `rematch` action tag this consumer files its handshake proposals under (N.1's opaque tag). */
export const REMATCH_ACTION = 'rematch';

/** A human name for a color, for the fixed result sentence. */
function colorName(player: Player): string {
  return player === 'white' ? 'White' : 'Black';
}

/**
 * The win reason read from the authoritative state (NOT inferred from a string): a non-empty
 * {@link GameState.winningLine} means the game was won by a five-in-a-row LINE; its absence (with a
 * winner set) means it was won by five CAPTURE pairs. Mirrors `placePiece`'s own discriminator
 * (a capture win records no `winningLine`; a line win records the run of node keys).
 */
function winReasonOf(state: GameState): WinReason {
  const line = state.winningLine;
  return line !== undefined && line.length > 0 ? 'line' : 'captures';
}

/**
 * The fixed result sentence: who won + HOW. Enumerated strings only — the winner comes from the
 * authoritative `Player` union and the reason from {@link winReasonOf}, so nothing here is
 * attacker-controllable free text.
 */
function resultTextOf(winner: Player, reason: WinReason, iWon: boolean): string {
  const who = iWon ? 'You won' : `${colorName(winner)} won`;
  const how =
    reason === 'line' ? 'with five in a row' : 'by five capture pairs';
  return `${who} ${how}.`;
}

/**
 * Project the N.1 handshake into the rematch sub-state (pure — reads only the N.1 selectors, owns no
 * transition logic). Precedence: a live PENDING proposal (either direction) reflects the in-flight
 * ask first; only when nothing is pending do we surface the most-recent RESOLUTION (accepted /
 * declined); with neither we are `idle`.
 *
 * The pending-before-resolution precedence is deliberate and matters for no-double-accept: once an
 * incoming proposal is answered, the N.1 machine CLEARS the pending slot and records the resolution,
 * so a second accept finds nothing pending and the projection settles on `accepted` (not a second
 * `incoming` Accept/Decline prompt). Only the `rematch` action drives this overlay; a pending/
 * resolved proposal for a DIFFERENT action (e.g. #18 undo) leaves the rematch UI `idle`, so the two
 * handshake consumers never cross-wire.
 */
function rematchUiOf(handshakeState: HandshakeState): RematchUi {
  const outgoing = outgoingPending(handshakeState);
  if (outgoing !== null && outgoing.action === REMATCH_ACTION) {
    return 'proposed-waiting';
  }
  const incoming = incomingPending(handshakeState);
  if (incoming !== null && incoming.action === REMATCH_ACTION) {
    return 'incoming';
  }
  const res = resolution(handshakeState);
  if (res !== null && res.action === REMATCH_ACTION) {
    return res.outcome === 'accepted' ? 'accepted' : 'declined';
  }
  return 'idle';
}

/**
 * Derive the networked end-state overlay view-model from the authoritative game state, the N.1
 * handshake, and this client's seat (`mySeat` is `null` for an unseated/spectating client — then
 * `iWon` is always `false`).
 *
 * `show` is `true` ONLY when the game is OVER (`winner !== null`): an in-progress game — local OR
 * networked — yields `{ show: false, … }` and no overlay. `rematchUi` is derived from the handshake
 * regardless, but the widget only renders it under `show`.
 */
export function deriveEndState(
  gameState: GameState,
  handshakeState: HandshakeState,
  mySeat: SeatColor | null,
): EndState {
  const winner = gameState.winner;
  const rematchUi = rematchUiOf(handshakeState);
  if (winner === null) {
    return {
      show: false,
      winner: null,
      winReason: null,
      iWon: false,
      resultText: '',
      rematchUi,
    };
  }
  const winReason = winReasonOf(gameState);
  const iWon = mySeat === winner;
  return {
    show: true,
    winner,
    winReason,
    iWon,
    resultText: resultTextOf(winner, winReason, iWon),
    rematchUi,
  };
}

/**
 * Swap white ↔ black for the next game (Task N.2.1 / plan N.2 decision 2: "colors ALTERNATE every
 * game, regardless of who won"). A pure INVOLUTION over the identity-owned {@link SeatMap}: the two
 * seat owners are exchanged, so applying it twice returns the original map. Returns a NEW map; the
 * input is never mutated.
 */
export function alternateSeats(seatMap: SeatMap): SeatMap {
  return { white: seatMap.black, black: seatMap.white };
}
