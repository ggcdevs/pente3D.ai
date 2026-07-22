/**
 * PURE networked mutual-confirm undo/redo logic (Task N.3.1, issue #18 networked undo/redo).
 *
 * This is the DOM-free, transport-free, three-free decision layer behind the networked
 * undo/redo handshake: WHO may propose an undo / a redo, WHETHER a new proposal may be
 * raised right now (the single-pending guard), and the incoming-proposal PROMPT view-model
 * the accept/decline UI renders. It sits beside the other pure `src/net` logic
 * (`handshake.ts`, `endState.ts`, `seats.ts`, `turnGate.ts`, `sync.ts`) so it earns the same
 * strict unit + fast-check + mutation gate and the hard 100% coverage floor — the boundary
 * conditions (last-mover-only, redo re-applies-your-move, single-pending, undo-vs-redo-vs-
 * other-action) are explicitly and negatively testable, so no case silently mis-gates a button
 * or paints the wrong prompt.
 *
 * ## What it decides, and what it REUSES (DRY — no duplicated state)
 *
 * - **`decideUndo`** is REUSED verbatim from `sync.ts` (the restricted last-mover-only rule) —
 *   re-exported here so the #18 consumer imports its two gates from one place. It is NOT
 *   re-implemented.
 * - **`decideRedo`** is the mirror gate for a REDO (re-applying an undone move). In the
 *   append-log undo/redo model (`src/core/game.ts`), a `redo` steps the cursor FORWARD, re-
 *   applying the move that was undone — the move whose original mover is exactly the player to
 *   move at the current (post-undo) live state, i.e. `state.turn`. So the player who may propose
 *   a redo is the one seated as `state.turn` (the mover of the move that would be re-applied),
 *   and only when a redo tail actually exists (`canRedo`). Whether a redo tail exists is a
 *   HISTORY fact the `Game` owns (a lone `GameState` snapshot cannot know its own redo tail), so
 *   it is passed in — mirroring how `decideUndo` takes `ply` for its nothing-to-undo case.
 * - **`canProposeUndo` / `canProposeRedo`** combine the decide-rule with the N.1 single-pending
 *   invariant via the shared `canPropose(handshakeState, consumerAllows)` guard — REUSING the
 *   handshake's one universal precondition (no new ask while one is pending) rather than
 *   re-deriving it. True iff the decide-rule says `ok` AND no proposal is pending.
 * - **`deriveUndoRedoPrompt`** projects an INCOMING undo/redo proposal into the accept/decline
 *   prompt view-model, derived ENTIRELY from the N.1 `incomingPending` selector — it owns no
 *   transition logic. It surfaces a prompt ONLY for an incoming `'undo'` / `'redo'` proposal; an
 *   incoming proposal for a DIFFERENT action (e.g. #12 `'rematch'`) yields no prompt, so the two
 *   handshake consumers never cross-wire.
 *
 * ## Untrusted-input note (the relay is publicly writable)
 *
 * The prompt copy names WHO is asking purely from the enumerated `Player` union (the color that
 * is NOT `mySeat`), NOT from any opponent-supplied free text. Nothing attacker-controllable is
 * placed in it — the consuming widget still renders it via `textContent`; this module produces
 * only the fixed, enumerated strings below.
 */

import type { GameState, Player } from '../core/gameState';
import {
  canPropose,
  incomingPending,
  type HandshakeState,
} from './handshake';
import { decideUndo } from './sync';

// Re-export the REUSED undo gate + its types so the #18 consumer takes both undo and redo from
// one module (DRY: `decideUndo` is defined once, in `sync.ts`, and never re-implemented).
export { decideUndo } from './sync';
export type { UndoDecision, UndoRejection } from './sync';

/** The `undo` / `redo` action tags this consumer files its handshake proposals under (N.1's opaque tags). */
export const UNDO_ACTION = 'undo';
export const REDO_ACTION = 'redo';

/**
 * The result of asking whether a player may emit a `redo`: permitted, or refused with a
 * machine-readable reason (mirrors {@link UndoDecision}).
 */
export type RedoDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: RedoRejection };

/** Why a networked redo was refused (mirrors {@link UndoRejection}). */
export type RedoRejection = 'nothing-to-redo' | 'not-your-move';

/**
 * Decide whether the player seated as `myColor` may `redo` from the given live `state`, where
 * `canRedo` is the `Game`'s redo-reachability fact (whether an undone move remains above the
 * cursor). This is the REDO mirror of {@link decideUndo}:
 *
 *   - `nothing-to-redo` — `canRedo === false`: no undone move remains to re-apply.
 *   - `not-your-move`   — the move that WOULD be re-applied is not `myColor`'s. A `redo` re-
 *                         applies the just-undone move; the player to move at the current
 *                         (post-undo) live state — `state.turn` — is exactly that move's original
 *                         mover, so a redo is this client's iff `state.turn === myColor`.
 *   - `ok`              — a redo tail exists AND the re-applied move is `myColor`'s.
 *
 * Why `state.turn` is the re-applied move's mover: in the append-log model, to have placed the
 * move now sitting in the redo tail it had to be that player's turn; undoing it steps the cursor
 * back to the state whose `turn` is that same player (they are "on the clock" to make it again).
 * This holds even for a just-undone WINNING move: after the undo the live state is not won
 * (`winner === null`) and its `turn` is the winner — the mover of the winning move — so that
 * player (and only that player) may propose re-applying it.
 */
export function decideRedo(
  state: GameState,
  canRedo: boolean,
  myColor: Player,
): RedoDecision {
  if (!canRedo) return { ok: false, reason: 'nothing-to-redo' };
  if (state.turn !== myColor) return { ok: false, reason: 'not-your-move' };
  return { ok: true };
}

/**
 * Whether the player seated as `mySeat` may PROPOSE an undo right now (pure). True iff the
 * restricted last-mover-only rule ({@link decideUndo}) permits it AND no proposal is currently
 * pending — the N.1 single-pending invariant, applied via the shared {@link canPropose} guard so
 * every handshake consumer enforces "no concurrent pending" identically. This is exactly the flag
 * a UI reads to enable/disable the networked Undo button.
 *
 * @param state The authoritative networked game state.
 * @param ply The committed-placement count (for {@link decideUndo}'s nothing-to-undo case).
 * @param mySeat This client's seat color.
 * @param handshakeState The N.1 handshake (its pending slot is the single-pending guard).
 */
export function canProposeUndo(
  state: GameState,
  ply: number,
  mySeat: Player,
  handshakeState: HandshakeState,
): boolean {
  return canPropose(handshakeState, decideUndo(state, ply, mySeat).ok);
}

/**
 * Whether the player seated as `mySeat` may PROPOSE a redo right now (pure). True iff the redo
 * rule ({@link decideRedo}) permits it AND no proposal is currently pending (the N.1 single-
 * pending invariant via {@link canPropose}). This is the flag a UI reads to enable/disable the
 * networked Redo button.
 *
 * @param state The authoritative networked game state.
 * @param canRedo The `Game`'s redo-reachability fact (for {@link decideRedo}).
 * @param mySeat This client's seat color.
 * @param handshakeState The N.1 handshake (its pending slot is the single-pending guard).
 */
export function canProposeRedo(
  state: GameState,
  canRedo: boolean,
  mySeat: Player,
  handshakeState: HandshakeState,
): boolean {
  return canPropose(handshakeState, decideRedo(state, canRedo, mySeat).ok);
}

/** Which action an incoming undo/redo prompt is for — the enumerated tag the widget routes on. */
export type UndoRedoAction = 'undo' | 'redo';

/** The serialisable incoming-undo/redo prompt view-model {@link deriveUndoRedoPrompt} produces. */
export interface UndoRedoPrompt {
  /**
   * `true` ONLY when there is an INCOMING `'undo'` / `'redo'` proposal awaiting our response —
   * the prompt's visibility gate. `false` (with empty/`null` fields) when idle, when WE proposed
   * (outgoing), or when the incoming proposal is for a different action (e.g. `'rematch'`).
   */
  readonly show: boolean;
  /** Which action is being proposed (`'undo'` / `'redo'`), or `null` when `show` is `false`. */
  readonly action: UndoRedoAction | null;
  /**
   * The prompt headline: `"<Opponent Color> wants to undo"` / `"…to redo"`. The color word comes
   * from the fixed `Player` union (the seat opposite `mySeat`), never opponent free text; with no
   * seat (`mySeat === null`) it falls back to the neutral "Your opponent wants to undo/redo".
   * Empty string when `show` is `false`.
   */
  readonly promptText: string;
}

/**
 * The capitalised display NAME of the seat OPPOSITE `mySeat`, minted from the fixed `Player` union
 * (never opponent free text). A direct two-arm map from THIS client's seat to the opponent's name —
 * `'white'`→"Black", `'black'`→"White" — computed in one step (no intermediate off-union-able color
 * literal), so it is a total function over the `Player` union with no unreachable default to guard.
 * The two arms yield DISTINCT strings, so each is independently pinned by a test (the seat-flips-
 * the-name behavior is genuinely asserted, not collapsed into a catch-all).
 */
function opponentName(mySeat: Player): string {
  return mySeat === 'white' ? 'Black' : 'White';
}

/**
 * The prompt headline: who (by COLOR) is asking, and for what. In a 2-player game the proposer is
 * the opponent — the color that is NOT `mySeat`. With a known seat this is the enumerated `Player`
 * opposite `mySeat` via {@link opponentName}; with no seat (unseated/spectating, `mySeat === null`)
 * it falls back to a neutral "Your opponent wants to …". The verb is the already-narrowed
 * `UndoRedoAction` (`'undo'` / `'redo'`) used verbatim — nothing here is opponent-supplied free text.
 */
function promptTextOf(mySeat: Player | null, action: UndoRedoAction): string {
  if (mySeat === null) {
    return `Your opponent wants to ${action}`;
  }
  return `${opponentName(mySeat)} wants to ${action}`;
}

/**
 * Project the N.1 handshake into the incoming-undo/redo prompt view-model (pure — reads only the
 * N.1 `incomingPending` selector; owns no transition logic). A prompt shows ONLY for an INCOMING
 * proposal whose action is `'undo'` or `'redo'`:
 *
 *   - No incoming pending proposal (idle, or WE proposed) → `{ show: false, … }`.
 *   - An incoming proposal for a DIFFERENT action (e.g. #12 `'rematch'`) → `{ show: false, … }`,
 *     so this consumer never claims a rematch ask (the two handshake consumers stay decoupled).
 *   - An incoming `'undo'` / `'redo'` proposal → `{ show: true, action, promptText }`.
 *
 * @param handshakeState The N.1 handshake.
 * @param mySeat This client's seat color, or `null` for an unseated/spectating client.
 */
export function deriveUndoRedoPrompt(
  handshakeState: HandshakeState,
  mySeat: Player | null,
): UndoRedoPrompt {
  const incoming = incomingPending(handshakeState);
  if (incoming === null) {
    return { show: false, action: null, promptText: '' };
  }
  if (incoming.action !== UNDO_ACTION && incoming.action !== REDO_ACTION) {
    return { show: false, action: null, promptText: '' };
  }
  const action: UndoRedoAction = incoming.action === UNDO_ACTION ? 'undo' : 'redo';
  return { show: true, action, promptText: promptTextOf(mySeat, action) };
}
