/**
 * PURE divergence pretty-printer (Task V.4a, epic **#47** — absorbs **#38**).
 *
 * ## Why a diff exists at all
 *
 * The v3.1 reconciliation policy (design §5, implemented in {@link reconcile}) auto-adopts exactly
 * one case — a peer that is ONE move ahead of us. Everything else is, by the turn gate's arithmetic,
 * already anomalous, so it goes to the players: *"if i know imma want LCA + diff + handshake on the
 * agreed resolution, then let's build it upfront"*. A resolution can only be CHOSEN if the choice is
 * legible, and `headHash` — the fingerprint the machine reconciles on — tells a human nothing. This
 * module turns "two hash chains that part company at entry 3" into the sentence a player can act on:
 * **shared history up to ply 3, then mine: …, theirs: …**, in colours and coordinates.
 *
 * ## What it does NOT do
 *
 * It renders no hashes (that is what {@link LastCommonAncestor} carries, for the machine), decides
 * nothing (that is {@link reconcile}), and adopts nothing. It is a projection: two logs in, a
 * serializable description out — so the V.4b divergence panel and the `cli/` client can render the
 * SAME facts without either re-deriving them.
 *
 * ## Movers, and why an entry may name none
 *
 * A `place` event carries only a node, never a colour — whose stone it is follows from the position,
 * so each side is replayed through the pure rules engine ({@link Game.apply}) and the mover is the
 * pre-move `turn`. Two entries deliberately name no mover:
 *
 *  - **undo / redo** — they act on the move *before* them (already named on its own line), so
 *    attributing a colour to them would invent a mover the log does not have.
 *  - **anything after an entry that does not replay** — a diff is shown for logs that are, by
 *    definition, suspect (one of them may be a fork, corruption, or a tampered log the replay
 *    validator is about to reject). Once an entry is illegal the following turn order is unknowable,
 *    so the description SAYS the mover is unknown rather than guessing one. Describing a bad log is
 *    never allowed to throw: this is the code that explains the problem.
 *
 * ## Purity
 *
 * `src/core` (log + rules) only — no transport, DOM, clock or randomness. Mutation-gated and pinned
 * to the 100% coverage floor like the rest of the pure net logic.
 */

import { firstDivergence, type Event, type EventLog } from '../core/eventLog';
import { Game } from '../core/game';
import type { Player } from '../core/gameState';

/** One entry of a log, past the point where the two logs stopped agreeing. */
export interface DivergentMove {
  /**
   * The entry's 0-based position in its own log — the same "ply" convention as
   * {@link firstDivergence} / `SyncStatus.divergePly`, so `log.entries[ply]` is this entry.
   */
  readonly ply: number;
  /** The raw event, so a consumer can rebuild the log (or re-render it differently) from the diff. */
  readonly event: Event;
  /** The colour that moved, or `null` when the log does not determine one (see the file header). */
  readonly player: Player | null;
  /** The human-readable rendering of this one entry, without its ply prefix. */
  readonly text: string;
}

/** Two logs described against their common history. */
export interface LogDiff {
  /**
   * How many leading entries the two logs agree on — equivalently the 0-based position of the
   * first entry they differ at. Both tails below start at exactly this ply.
   */
  readonly sharedPly: number;
  /** My log past the shared point (empty when my log is a prefix of theirs). */
  readonly mine: readonly DivergentMove[];
  /** Their log past the shared point (empty when their log is a prefix of mine). */
  readonly theirs: readonly DivergentMove[];
}

/**
 * Describe how `mine` and `theirs` relate: the shared prefix length, then each side's remaining
 * entries with their movers resolved by replay. Pure and total — an illegal or tampered log is
 * described, never thrown on (see the file header).
 *
 * @param size Board edge length, needed to replay the entries through the rules engine.
 */
export function describeDivergence(size: number, mine: EventLog, theirs: EventLog): LogDiff {
  const sharedPly = firstDivergence(mine, theirs);
  return {
    sharedPly,
    mine: describeTail(size, mine, sharedPly),
    theirs: describeTail(size, theirs, sharedPly),
  };
}

/**
 * Describe `log`'s entries from ply `from` onward. The replay starts at ply 0 (not at `from`) —
 * the mover of an entry depends on the whole history before it, so the shared prefix has to be
 * folded even though it is not described.
 */
function describeTail(size: number, log: EventLog, from: number): DivergentMove[] {
  // The fold, or `null` once it has been lost. Turns are only knowable while it is valid, and the
  // first entry the rules engine refuses ends that — for it and for everything after it. Holding
  // "no fold" as `null` (rather than a flag beside a stale game) makes that unrepresentable: there
  // is no object left to read a turn from.
  let replay: Game | null = new Game(size, log.uuid);
  const tail: DivergentMove[] = [];
  for (let ply = 0; ply < log.entries.length; ply++) {
    const event = log.entries[ply]!.event;
    // No fold left ⇒ no mover: an entry after a broken one is described without one.
    let player: Player | null = null;
    if (replay !== null) {
      // Read the mover BEFORE applying (a placement is made by the player to move) and outside the
      // try, so only the rules engine's verdict on `apply` is caught here — never a bug in this
      // renderer, which must surface rather than be mistaken for an illegal entry.
      if (event.type === 'place') player = replay.state().turn;
      try {
        replay.apply(event);
      } catch {
        // The offending entry is DESCRIBED (its own mover was still derivable); what is lost is
        // every turn after it. Swallowed deliberately and visibly: the caller's verdict on an
        // illegal log is `validateAdoptable`'s, not this renderer's.
        replay = null;
      }
    }
    if (ply >= from) tail.push({ ply, event, player, text: describeMove(event, player) });
  }
  return tail;
}

/** One entry in a player's words: who moved where, or what an undo/redo does. */
function describeMove(event: Event, player: Player | null): string {
  switch (event.type) {
    case 'place':
      return player === null
        ? `plays ${event.node} (mover unknown — an earlier entry does not replay)`
        : `${player} plays ${event.node}`;
    case 'undo':
      return 'undo (takes back the previous move)';
    case 'redo':
      return 'redo (re-applies the last undone move)';
  }
}

/**
 * Render a {@link LogDiff} as the block of text a player reads:
 *
 * ```text
 * shared history up to ply 2, then
 *   mine:   ply 2 — white plays 4,4,4
 *   theirs: ply 2 — white plays 3,3,3
 *           ply 3 — black plays 2,2,2
 * ```
 *
 * Deliberately hash-free: the machine reconciles on hashes, a player resolves on moves.
 */
export function formatLogDiff(diff: LogDiff): string {
  return [
    `shared history up to ply ${diff.sharedPly}, then`,
    ...sideLines('mine', diff.mine),
    ...sideLines('theirs', diff.theirs),
  ].join('\n');
}

/** The label width that aligns `mine:` under `theirs:` (the longer of the two labels). */
const LABEL_WIDTH = 'theirs:'.length;

/** One side of the rendered diff: a labelled first line, then continuation lines aligned under it. */
function sideLines(label: string, moves: readonly DivergentMove[]): string[] {
  const gutter = `  ${`${label}:`.padEnd(LABEL_WIDTH)} `;
  if (moves.length === 0) return [`${gutter}(nothing)`];
  return moves.map(
    (move, i) => `${i === 0 ? gutter : ' '.repeat(gutter.length)}ply ${move.ply} — ${move.text}`,
  );
}
