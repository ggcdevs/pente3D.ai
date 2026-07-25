/**
 * PURE reconciliation policy (Task V.4a, epic **#47** — design §5; absorbs **#38**).
 *
 * ## What changed, and why
 *
 * v3's rule was "adopt ANY strict extension": whatever a peer sent, if my history was a prefix of
 * it, I took it — one move ahead or twenty. That is generous in exactly the wrong direction. The
 * **turn gate caps LEGITIMATE drift at exactly one move**: if it is my turn the peer cannot move at
 * all, and if it is theirs they move once and are then blocked on me. Undo and redo require a mutual
 * confirm. So a peer that arrives two moves ahead did not get there by playing the game we agreed
 * on — something is wrong (a fork, a lost reset, a doctored log), and silently overwriting my
 * history with it is the worst available answer.
 *
 * Design §5 therefore allows **one** automatic path and sends everything else to the players:
 *
 *  1. **identical** (`headHash` equal) → play on;
 *  2. **auto fast-forward — the ONLY automatic case:** their log is EXACTLY one entry longer, mine
 *     is its prefix, and my own log says that entry was THEIRS to add ({@link theirsToAdd}) → adopt.
 *     This is the common, expected case:
 *     *"they should be able to at least reasonably play their turn while you step away, turn your
 *     phone off, whatever... in fact, that's probably common."*
 *  3. **I am exactly one ahead** (my move never got out) → republish; they fast-forward. The mirror
 *     of case 2, and the reason a lost publish converges instead of bricking the pair (#45).
 *  4. **everything else** — a longer prefix in either direction, or a genuine fork → **no adopt**:
 *     report the **last common ancestor** and a readable {@link LogDiff}, and let the players choose
 *     a resolution by handshake (V.4b). *"if i know imma want LCA + diff + handshake on the agreed
 *     resolution, then let's build it upfront so that we don't have to redesign again."*
 *
 * The entitlement condition in case 2 is what makes it narrow rather than merely short. Who may add
 * entry *n* is fixed by the position, so the entry a legitimately-behind peer lacks is ALWAYS the
 * opponent's. A single entry that my own log says was MINE to add is not drift — it is a history I
 * never played, so it goes to resolution like any other anomaly.
 *
 * ## Replay-validation (design §5, "Integrity")
 *
 * A dumb relay cannot referee, so **the opponent's client is the validator**: an adopted log is
 * folded through the pure rules engine ({@link validateAdoptable}) and rejected at the first entry
 * that does not replay — a sender's derived state (`turn`, `captures`, `winner`) is never trusted,
 * and the hash chain is re-derived rather than believed. It lives here, next to the decision, so
 * both are pure and mutation-gated together.
 *
 * ## Purity & layering
 *
 * `src/core` (the log, the hash chain, the rules) plus {@link ./logDiff} only — no transport, DOM,
 * clock or randomness. {@link SyncEngine} consumes the decision; it contributes no policy of its
 * own. The resolution PROTOCOL (proposing take-mine / take-theirs / rewind-to-LCA over the N.1
 * handshake, and the panel that shows the diff) is Task V.4b and lives outside this module.
 */

import {
  firstDivergence,
  genesisHash,
  headHash,
  isPrefix,
  type Event,
  type EventLog,
} from '../core/eventLog';
import { Game } from '../core/game';
import { IllegalMove, lastMover, type GameState, type Player } from '../core/gameState';
import { describeDivergence, type LogDiff } from './logDiff';

/**
 * The deepest point two logs still agree on: how many leading entries match, and the chain hash at
 * that point. Found by walking the two hash chains — no search, free by construction, because an
 * entry-hash match already implies agreement on the entire history behind it.
 */
export interface LastCommonAncestor {
  /** The number of shared leading entries (0 = they part company at the very first entry). */
  readonly ply: number;
  /**
   * The chain hash at the shared point: the last shared entry's hash, or — when nothing is shared —
   * the game's {@link genesisHash}. `null` when the logs belong to DIFFERENT games and therefore
   * share no ancestor at all, not even a genesis.
   */
  readonly hash: string | null;
}

/** Why a log is being adopted automatically. */
export type FastForwardReason =
  /** They are exactly one entry ahead on my own history, and that entry was theirs to make. */
  | 'one-move'
  /** They already reset to a newer GENERATION (an N.2 in-place rematch); it supersedes ours. */
  | 'newer-generation';

/** Why our own log goes back on the wire instead. */
export type RepublishReason =
  /** I hold exactly one entry they lack — my move never reached them. */
  | 'one-ahead'
  /** Their message is from a superseded generation; our answer carries the live one. */
  | 'superseded-generation';

/** What to do with a peer's log. */
export type ReconcileDecision =
  /** Identical histories — nothing to do, nothing to say. */
  | { readonly action: 'in-sync' }
  /** Adopt their log (after {@link validateAdoptable}). */
  | { readonly action: 'fast-forward'; readonly reason: FastForwardReason }
  /** Keep mine and put it back on the wire so they converge onto it. */
  | { readonly action: 'republish'; readonly reason: RepublishReason }
  /**
   * Neither side may move automatically: the players choose, informed by `lca` (where the two
   * histories last agreed) and `diff` (what each side did after that, in a player's terms).
   */
  | {
      readonly action: 'needs-resolution';
      readonly lca: LastCommonAncestor;
      readonly diff: LogDiff;
    };

/**
 * The last point at which `a` and `b` still agree (see {@link LastCommonAncestor}).
 *
 * Symmetric, and equal to the shorter log when one is a prefix of the other (an identical pair
 * therefore yields the whole log).
 */
export function lastCommonAncestor(a: EventLog, b: EventLog): LastCommonAncestor {
  const ply = firstDivergence(a, b);
  if (ply > 0) return { ply, hash: a.entries[ply - 1]!.hash };
  // Nothing shared: the ancestor is the game's own genesis — but only if it IS one game. Two games
  // have different uuid-seeded genesis hashes (S.1), so they share no ancestor to rewind to.
  return { ply: 0, hash: a.uuid === b.uuid ? genesisHash(a.uuid) : null };
}

/**
 * Whether a divergence is a genuine FORK — both sides played on past the common ancestor — as
 * opposed to one side simply being further along the same history. A fork is the case where two
 * real histories exist and one of them has to be given up; the one-sided case has only one history
 * in it, just more of it than the turn gate can explain.
 */
export function isFork(diff: LogDiff): boolean {
  return diff.mine.length > 0 && diff.theirs.length > 0;
}

/**
 * Decide what to do with a peer's log within ONE generation of ONE game (pure — no side effects).
 * See the file header for the policy and its rationale.
 *
 * @param mine My own live game — the log AND its folded state, so the turn is derived from my
 *   history rather than taken on trust from anywhere.
 * @param theirs The peer's log, exactly as it arrived (it may be illegal or forked; nothing here
 *   trusts it).
 * @param myColor The seat I hold, which is what makes "their turn" answerable.
 */
export function reconcile(mine: Game, theirs: EventLog, myColor: Player): ReconcileDecision {
  const local = mine.log;
  // O(1), and it settles identity AND history at once: the uuid is folded into the chain seed, so
  // equal heads mean the same game with the same history.
  if (headHash(local) === headHash(theirs)) return { action: 'in-sync' };

  const theirLead = theirs.entries.length - local.entries.length;
  // THE one automatic path. All three conditions are load-bearing: one entry (the turn gate's cap),
  // on my own history (a prefix, so nothing of mine is discarded), and an entry that was THEIRS to
  // add (measured against my own folded state — see `theirsToAdd`).
  if (
    theirLead === 1 &&
    isPrefix(local, theirs) &&
    theirsToAdd(mine.state(), theirs.entries[theirs.entries.length - 1]!.event, myColor)
  ) {
    return { action: 'fast-forward', reason: 'one-move' };
  }
  // The mirror: my move never got out. Answering (rather than staying silent) is what turns a lost
  // QoS-0 publish into a converging exchange instead of a bricked pair (#45).
  if (theirLead === -1 && isPrefix(theirs, local)) {
    return { action: 'republish', reason: 'one-ahead' };
  }
  return {
    action: 'needs-resolution',
    lca: lastCommonAncestor(local, theirs),
    diff: describeDivergence(mine.state().size, local, theirs),
  };
}

/**
 * Whether the ONE entry a peer holds beyond my history was THEIRS to add, judged against `state` —
 * the fold of MY OWN log, immediately before that entry. This is what makes the fast-forward narrow
 * rather than merely short: the entry a legitimately-behind peer lacks is always the opponent's,
 * because who may add an entry is fixed by the position.
 *
 *  - **place** — a placement is the player to move's: theirs iff it is not my turn.
 *  - **undo** — an undo takes back the LAST move, so it belongs to whoever made it ({@link lastMover},
 *    the same rule that gates {@link decideUndo}): theirs iff the last move was not mine. Note this
 *    is the OPPOSITE turn from a placement — after their move it is my turn, and their undo of it
 *    still arrives on my turn.
 *  - **redo** — a redo re-applies the just-undone move, whose mover is the post-undo player to move
 *    (the rule `decideRedo` gates on): theirs iff it is not my turn.
 *
 * A verdict of "theirs" is a claim about ENTITLEMENT, never about legality: an entry that could not
 * be applied at all is caught by {@link validateAdoptable} before anything is adopted.
 */
function theirsToAdd(state: GameState, event: Event, myColor: Player): boolean {
  return event.type === 'undo' ? lastMover(state) !== myColor : state.turn !== myColor;
}

/**
 * Generation-aware {@link reconcile}: a peer's GENERATION is settled before its history is, because
 * an in-place rematch (N.2) deliberately produces a log that is NOT a continuation of the game it
 * replaces.
 *
 *  - their epoch **higher** → they already reset to a newer game: adopt it outright, whatever the
 *    logs say (the prefix policy has no meaning across generations);
 *  - their epoch **lower** → a late message from a superseded generation: never adopt it, and
 *    answer with our own state so they come forward onto the live one;
 *  - **same** epoch → the ordinary same-generation policy.
 *
 * Because a reset only ever increments and both peers reset on the same accepted rematch, epochs
 * converge and delivery order still does not matter.
 */
export function reconcileEpoched(
  myEpoch: number,
  mine: Game,
  theirEpoch: number,
  theirs: EventLog,
  myColor: Player,
): ReconcileDecision {
  if (theirEpoch > myEpoch) return { action: 'fast-forward', reason: 'newer-generation' };
  if (theirEpoch < myEpoch) return { action: 'republish', reason: 'superseded-generation' };
  return reconcile(mine, theirs, myColor);
}

/** Why a log may not be adopted. */
export type LogRejection =
  /** An entry the rules engine refuses (occupied / off-board / already-won place, bad undo/redo). */
  | 'illegal-move'
  /** An entry whose stored hash is not the one its own event produces — corruption or tampering. */
  | 'broken-chain';

/** The verdict on a log offered for adoption. */
export type LogValidation =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** The 0-based position of the FIRST entry that failed; everything before it replayed. */
      readonly ply: number;
      readonly reason: LogRejection;
      /** The rules engine's own message, or the two hashes that disagree — never a summary. */
      readonly detail: string;
    };

/**
 * Validate a log by REPLAYING it: fold every entry through the pure rules engine and re-derive the
 * hash chain as it goes, rejecting at the first entry that fails either check (design §5,
 * "Integrity" — *"validate an adopted log by replaying it through the pure rules engine rather than
 * trusting the sender's derived state; reject on any illegal entry"*).
 *
 * The two checks are complementary and both are needed: the rules catch a history that could not
 * have been played, and the chain catches an edit that happens to still be legal (swapping one empty
 * node for another). Rules first, so an illegal entry is reported as what it is.
 *
 * This is deliberately more than `parseSyncMessage`'s codec check, which recomputes the chain from
 * the raw events (so it can only catch a wrong `headHash`, never an illegal move) — the two are
 * layered, not duplicated: the codec proves the message is internally consistent, this proves the
 * history is playable.
 */
export function validateAdoptable(size: number, log: EventLog): LogValidation {
  const replay = new Game(size, log.uuid);
  for (let ply = 0; ply < log.entries.length; ply++) {
    const entry = log.entries[ply]!;
    try {
      replay.apply(entry.event);
    } catch (error) {
      // Only the rules engine's own verdict means "this log is not adoptable". Anything else is a
      // bug in us, and propagates verbatim rather than being mislabelled as a rejected peer log.
      if (!(error instanceof IllegalMove)) throw error;
      return { ok: false, ply, reason: 'illegal-move', detail: error.message };
    }
    // `apply` extended the replay's own chain from its own state, so its head is what this entry's
    // hash MUST be. Comparing here (rather than only at the end) names the first bad entry.
    const computed = headHash(replay.log);
    if (computed !== entry.hash) {
      return {
        ok: false,
        ply,
        reason: 'broken-chain',
        detail: `entry hash ${entry.hash}, recomputed ${computed}`,
      };
    }
  }
  return { ok: true };
}
