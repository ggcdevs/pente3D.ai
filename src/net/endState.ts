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
  /**
   * The PRIMARY headline shown ONLY in the `incoming` rematch state (the opponent asked and we must
   * respond): `"<Opponent Color> wants a rematch"` — so the responder knows WHAT they are accepting /
   * declining, instead of the stale result sentence. `null` in every other state (the overlay keeps
   * `resultText` then). The opponent color is the enumerated `Player` that is NOT `mySeat`; with no
   * seat (`mySeat === null`) it falls back to the neutral "Your opponent wants a rematch". Nothing
   * here is attacker-supplied free text — the color word comes from the fixed `Player` union.
   */
  readonly rematchPrompt: string | null;
}

/** The `rematch` action tag this consumer files its handshake proposals under (N.1's opaque tag). */
export const REMATCH_ACTION = 'rematch';

/**
 * A human name for a color, for the fixed result sentence and the rematch prompt. Enumerated over the
 * `Player` union with an explicit assertion on each arm (not a lax "else = Black" fallthrough): an
 * input outside `{'white','black'}` is an invariant violation and throws, so no caller can smuggle an
 * off-union value into the rendered copy. The assertion also keeps the branch honestly two-sided.
 */
function colorName(player: Player): string {
  if (player === 'white') {
    return 'White';
  }
  if (player === 'black') {
    return 'Black';
  }
  throw new Error(`colorName: not a Player color: ${String(player)}`);
}

/**
 * The `incoming`-only primary headline: who (by COLOR) is asking for a rematch. In a 2-player game the
 * proposer is the opponent — the color that is NOT `mySeat`. With a known seat this is the enumerated
 * `Player` opposite `mySeat` (`'white'`→"Black wants a rematch", `'black'`→"White wants a rematch");
 * with no seat (unseated/spectating) it falls back to a neutral "Your opponent wants a rematch". The
 * color word is minted from the fixed `Player` union via {@link colorName}, never opponent free text.
 */
function rematchPromptOf(mySeat: SeatColor | null): string {
  if (mySeat === null) {
    return 'Your opponent wants a rematch';
  }
  const opponent: Player = mySeat === 'white' ? 'black' : 'white';
  return `${colorName(opponent)} wants a rematch`;
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
  // The opponent-color prompt is the primary headline ONLY while an incoming ask awaits our response;
  // every other state keeps the result sentence, so `rematchPrompt` is null there.
  const rematchPrompt =
    rematchUi === 'incoming' ? rematchPromptOf(mySeat) : null;
  if (winner === null) {
    return {
      show: false,
      winner: null,
      winReason: null,
      iWon: false,
      resultText: '',
      rematchUi,
      rematchPrompt,
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
    rematchPrompt,
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
