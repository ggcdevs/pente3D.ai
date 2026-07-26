/**
 * PURE divergence-panel view-model (Task V.4b, epic **#47** — design §5; absorbs **#38**).
 *
 * ## The one place a player meets the protocol
 *
 * Everything else in v3.1 settles itself: the turn gate caps legitimate drift at one move, the
 * fast-forward takes that move, and a lost publish converges by republish. What is left over —
 * two histories that cannot both be right — is the one case that has to be handed to a person. This
 * module turns that case into a small card: *what you both still agree on, what each of you has that
 * the other doesn't, and the choices*.
 *
 * The deliberate design constraint, from the build plan's collaboration points: **it must not read
 * like a git merge conflict.** So there are no hashes, no "ours/theirs", no ply arithmetic in the
 * prose, and no jargon the game itself does not already use. The moves are described in the words the
 * board uses ("black plays 2,2,2" — {@link logDiff}'s renderer, shared with the CLI so both show the
 * same facts), and each choice says plainly what it keeps and what it drops. The wording is expected
 * to be tuned with the user; the STRUCTURE is what this file fixes — one headline, one sentence of
 * explanation, two lists, and at most three buttons.
 *
 * ## What it decides (and what it does not)
 *
 * It decides which choices are OFFERABLE and what each one means locally, from two facts: the
 * {@link LogDiff} (what each side did after the common point) and the {@link ResolutionCandidates}
 * (the three histories on the table, by head hash). It also folds the shared N.1 handshake state into
 * the ONE sub-state the card is in — pick a resolution, wait for the peer, answer the peer's ask, or
 * pick again after a decline.
 *
 * It decides NOTHING about the game: it adopts nothing, publishes nothing, and never converts a
 * choice into a log operation ({@link SyncEngine.applyResolution} does that, replay-validating any
 * history it takes). It is a projection — facts in, a serializable card out.
 *
 * ## Untrusted-input note
 *
 * Every string it emits is minted HERE from enumerated values, node keys, and the fixed `Player`
 * union — never opponent free text. The peer's log reaches the panel only through
 * {@link describeDivergence}, which renders coordinates and colours it derived itself by replay. The
 * widget still paints via `textContent` (belt and braces), but the model is what makes that safe.
 *
 * ## Purity & layering
 *
 * `logDiff` + `resolution` + `handshake` values only — no DOM, no THREE, no transport, no clock.
 * The DOM half is `divergencePanel.ts` (Playwright-verified); this half carries the strict
 * unit + mutation gate.
 */

import type { HandshakeState } from '../../net/handshake';
import { incomingPending, outgoingPending, resolution } from '../../net/handshake';
import type { DivergentMove, LogDiff } from '../../net/logDiff';
import {
  resolutionTarget,
  targetChoice,
  targetFor,
  type ResolutionCandidates,
  type ResolutionChoice,
} from '../../net/resolution';

/** One move of a divergent tail, ready to paint: its position and its sentence. */
export interface DivergenceLine {
  /** The move's own 0-based position in its history — the number the "back to move N" copy names. */
  readonly ply: number;
  /** The move in a player's words (`logDiff`'s renderer — the same text the CLI prints). */
  readonly text: string;
}

/** One offered resolution: what it is called, and what it will do in plain words. */
export interface DivergenceOption {
  readonly choice: ResolutionChoice;
  /** The button's label. */
  readonly label: string;
  /** One sentence naming what this choice keeps and what it drops. */
  readonly detail: string;
}

/** Which of the four things the card is doing right now. */
export type DivergenceUi =
  /** Nothing is in flight: the player picks a resolution. */
  | 'choose'
  /** WE proposed one; the peer has not answered. */
  | 'waiting'
  /** The PEER proposed one; we accept or decline. */
  | 'incoming'
  /** The peer declined ours: pick again (either side may). */
  | 'declined';

/** The whole card, as a plain serializable value. */
export interface DivergenceView {
  /** `false` (and everything else empty/hidden) when no divergence is open. */
  readonly show: boolean;
  /** The headline. */
  readonly headline: string;
  /** One sentence: what you still agree on, and that nothing changes without agreement. */
  readonly explanation: string;
  /** How many leading moves the two histories share — the point both lists start from. */
  readonly sharedPly: number;
  /** What only I have, after the shared point. */
  readonly mine: readonly DivergenceLine[];
  /** What only my opponent has, after the shared point. */
  readonly theirs: readonly DivergenceLine[];
  /** The offerable resolutions (empty while an ask is in flight, or when answering one). */
  readonly options: readonly DivergenceOption[];
  /** Which sub-state the card is in. */
  readonly ui: DivergenceUi;
  /** The peer's ask, in our terms, when `ui === 'incoming'`; else `null`. */
  readonly incomingText: string | null;
  /** Whether the incoming ask is one we can honour — `false` disables Accept, leaving Decline. */
  readonly canAccept: boolean;
  /** A single line of status (waiting / declined / cannot-honour), or `null`. */
  readonly note: string | null;
}

/** The facts a card is built from: what differs, and the three histories it could settle on. */
export interface DivergenceFacts {
  readonly diff: LogDiff;
  readonly candidates: ResolutionCandidates;
}

/** The card shown when there is nothing to resolve (offline, in sync, or already settled). */
const HIDDEN: DivergenceView = {
  show: false,
  headline: '',
  explanation: '',
  sharedPly: 0,
  mine: [],
  theirs: [],
  options: [],
  ui: 'choose',
  incomingText: null,
  canAccept: false,
  note: null,
};

/** The headline. Plain, non-alarming, and it names the situation rather than blaming a side. */
const HEADLINE = 'Your game and your opponent’s have gone out of step';

/**
 * Build the divergence card from the live facts and the shared N.1 handshake.
 *
 * @param facts The open divergence, or `null` when there is none (→ a hidden card).
 * @param handshake The session's out-of-band handshake — the SAME one #12/#18 use. Only a `resolve:`
 *   proposal is read here; a pending rematch/undo ask belongs to another consumer and leaves this
 *   card in `choose` (raising a resolution supersedes it, which is the at-most-one rule, not this
 *   module's decision).
 */
export function deriveDivergence(
  facts: DivergenceFacts | null,
  handshake: HandshakeState,
): DivergenceView {
  if (facts === null) return HIDDEN;
  const { diff, candidates } = facts;
  const mine = lines(diff.mine);
  const theirs = lines(diff.theirs);
  const options = offerable(diff, candidates);

  const incoming = resolutionPending(incomingPending(handshake));
  if (incoming !== null) {
    const choice = targetChoice(incoming, candidates);
    return {
      show: true,
      headline: HEADLINE,
      explanation: explain(diff.sharedPly),
      sharedPly: diff.sharedPly,
      mine,
      theirs,
      // No buttons of our own while we are answering one: a counter-proposal would supersede the ask
      // we have not answered, and the peer would be left waiting on a proposal that no longer exists.
      options: [],
      ui: 'incoming',
      incomingText:
        choice === null
          ? 'Your opponent suggested continuing from a version of the game this one does not have.'
          : `Your opponent suggests: ${describeIncoming(choice, diff)}`,
      canAccept: choice !== null,
      note:
        choice === null
          ? 'You can only decline — nothing here matches either of your games.'
          : null,
    };
  }

  if (resolutionPending(outgoingPending(handshake)) !== null) {
    return {
      show: true,
      headline: HEADLINE,
      explanation: explain(diff.sharedPly),
      sharedPly: diff.sharedPly,
      mine,
      theirs,
      options: [],
      ui: 'waiting',
      incomingText: null,
      canAccept: false,
      note: 'Waiting for your opponent to agree…',
    };
  }

  // A DECLINED resolution is not a failure state: either side may simply pick again, so the buttons
  // come straight back with one line saying why they did. (An ACCEPTED one is applied and clears the
  // divergence, so it never reaches here with the card still open.)
  const last = resolution(handshake);
  const declined =
    last !== null && last.outcome === 'declined' && resolutionTarget(last.action) !== null;
  return {
    show: true,
    headline: HEADLINE,
    explanation: explain(diff.sharedPly),
    sharedPly: diff.sharedPly,
    mine,
    theirs,
    options,
    ui: declined ? 'declined' : 'choose',
    incomingText: null,
    canAccept: false,
    note: declined ? 'Your opponent did not agree to that. You can suggest something else.' : null,
  };
}

/** The pending proposal's resolution target, or `null` if there is none / it is another consumer's. */
function resolutionPending(pending: { readonly action: string } | null): string | null {
  return pending === null ? null : resolutionTarget(pending.action);
}

/** The diff's tails, reduced to what the card paints. */
function lines(moves: readonly DivergentMove[]): DivergenceLine[] {
  return moves.map((move) => ({ ply: move.ply, text: move.text }));
}

/** The one explanatory sentence: what you still share, and that nothing moves without agreement. */
function explain(sharedPly: number): string {
  const shared =
    sharedPly === 0
      ? 'You and your opponent have no moves in common'
      : `You and your opponent agree on the first ${moveCount(sharedPly)}`;
  return `${shared}. After that you are holding different games. Nothing changes until you both pick the same one.`;
}

/**
 * Which resolutions are worth offering. Always the two sides; the rewind ONLY when it is a third
 * answer — if one history is a prefix of the other, "go back to where you both agreed" IS one of the
 * two buttons already there, and a third button doing the same thing is how a simple choice starts
 * reading like a merge tool. A candidate with no head hash (no shared ancestor at all) is likewise
 * not offered, because there is nothing to go back to.
 */
function offerable(diff: LogDiff, candidates: ResolutionCandidates): DivergenceOption[] {
  const options: DivergenceOption[] = [
    { choice: 'take-mine', label: 'Keep my game', detail: keepDetail(diff) },
    { choice: 'take-theirs', label: 'Use my opponent’s game', detail: takeDetail(diff) },
  ];
  const isFork = diff.mine.length > 0 && diff.theirs.length > 0;
  if (isFork && targetFor('rewind', candidates) !== null) {
    options.push({
      choice: 'rewind',
      label: 'Go back to where you agreed',
      detail: `Both games return to move ${diff.sharedPly}; everything after it is dropped on both sides.`,
    });
  }
  return options;
}

/**
 * "Keep my game", in this divergence's terms. Each arm exists because a player is owed a sentence
 * about their OWN position: when I have nothing past the shared point, keeping my game is standing
 * still (not "my moves stay"); when THEY have nothing, keeping mine costs them nothing at all and
 * saying "your opponent's 0 moves are dropped" would invent a loss that is not happening.
 */
function keepDetail(diff: LogDiff): string {
  if (diff.mine.length === 0) {
    return `Stay where you are; the ${moveCount(diff.theirs.length)} only your opponent has ${plural(diff.theirs.length, 'is', 'are')} dropped.`;
  }
  if (diff.theirs.length === 0) {
    return `Nothing of yours changes; your opponent catches up to your ${moveCount(diff.mine.length)}.`;
  }
  return `Your ${moveCount(diff.mine.length)} ${plural(diff.mine.length, 'stays', 'stay')}; your opponent's ${moveCount(diff.theirs.length)} ${plural(diff.theirs.length, 'is', 'are')} dropped.`;
}

/** "Use my opponent's game", by the same rule, from the other side. */
function takeDetail(diff: LogDiff): string {
  if (diff.theirs.length === 0) {
    return `Go back to where your opponent is; your ${moveCount(diff.mine.length)} since then ${plural(diff.mine.length, 'is', 'are')} dropped.`;
  }
  if (diff.mine.length === 0) {
    return `Take your opponent's ${moveCount(diff.theirs.length)}; nothing of yours is dropped.`;
  }
  return `Your opponent's ${moveCount(diff.theirs.length)} ${plural(diff.theirs.length, 'is', 'are')} taken; your ${moveCount(diff.mine.length)} ${plural(diff.mine.length, 'is', 'are')} dropped.`;
}

/** The peer's ask, said back in our own terms so the answer is never ambiguous. */
function describeIncoming(choice: ResolutionChoice, diff: LogDiff): string {
  switch (choice) {
    case 'take-mine':
      return `keep YOUR game (their ${moveCount(diff.theirs.length)} would be dropped).`;
    case 'take-theirs':
      return `keep THEIR game (your ${moveCount(diff.mine.length)} would be dropped).`;
    case 'rewind':
      return `both go back to move ${diff.sharedPly} (everything after it dropped on both sides).`;
  }
}

/** `1 move` / `N moves` — the count in the prose, never a bare number. */
function moveCount(n: number): string {
  return `${n} ${plural(n, 'move', 'moves')}`;
}

/** Pick the singular or plural form for `n`. */
function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}
