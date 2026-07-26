/**
 * PURE rejoin-prompt view-model (Task V.5, epic **#47** — the v3.1 net model, design §6).
 *
 * ## Why this exists
 *
 * In v3.1 a tab reload always lands on an EMPTY SLATE — nothing is auto-restored, because a boot that
 * silently resurrects a game is what made a room code own one (*"if you restart (i.e.: reload the
 * tab), you should always get dropped back to the main page with an empty slate/board"*). The game is
 * not lost: it is durable in the archive under its own UUID. What this model produces is the ONE
 * thing that offers a way straight back into it — an OFFER, never an action.
 *
 * The input is a {@link RejoinProbe}: the `activeNetworkedGame` breadcrumb (`src/net/activeGame.ts`)
 * plus what a real, non-committal look at the room found — is anyone there, and which game are they
 * on. The output is the card the player answers. Declining is what the glue turns into "forget the
 * breadcrumb"; nothing here mutates anything.
 *
 * ## The two rules this file is responsible for
 *
 *  - **It never hijacks.** A peer present on a DIFFERENT game is the one outcome design §6 forbids
 *    rejoining, so that arm offers a new code instead and no rejoin is reachable from it.
 *  - **A colour is DISPLAYED, never negotiated** (design §7 — what keeps #31 "both players Black" and
 *    #40 "wrong colour after a rematch" shut). {@link RejoinProbe.myColour} is DERIVED by the caller
 *    from the game's own identity-owned seat map; when it is `null` (the game owns no seat for this
 *    browser) the prompt still offers the rejoin — admission decides the seat, as it always does —
 *    but says nothing at all about colour rather than guessing one.
 *
 * THREE-free / DOM-free / transport-free: the probe is plain data and the view is plain strings, so
 * this is unit + fast-check + mutation gated. The DOM half is `rejoinPrompt.ts` and the probe itself
 * is `NetSession.probeRoom` — both Playwright-verified glue.
 *
 * The copy is deliberately plain and is a build-plan COLLABORATION POINT (the user tunes the
 * wording); it lives here, in one place, so tuning it is a text edit against a test rather than a
 * hunt through DOM code.
 */

/** The colour a seat map owns for this browser, as displayed (never negotiated). */
export type RejoinColour = 'white' | 'black';

/**
 * What a boot-time room PROBE established (design §6). Every field is a fact the glue OBSERVED —
 * nothing here is a decision, which is what leaves the whole §6 table decidable in one pure place.
 */
export interface RejoinProbe {
  /**
   * The `activeNetworkedGame` breadcrumb — the room we were mid-game in and the UUID of that game —
   * or `null` when there is none (an ordinary boot). NOT a code→game mapping: it is the single
   * session-state record, read without any lookup (see `net/activeGame.ts`).
   */
  readonly crumb: { readonly code: string; readonly gameUuid: string } | null;
  /** Whether that breadcrumb is past its credibility horizon (`isActiveGameStale`). */
  readonly stale: boolean;
  /** Whether the game the breadcrumb NAMES is actually in this browser's archive (by uuid). */
  readonly haveGame: boolean;
  /**
   * The colour that game's identity-owned seat map owns for THIS browser's playerId, or `null` if it
   * owns none. Derived by the caller (`seatOf`) off the archived game — never asked of the peer.
   */
  readonly myColour: RejoinColour | null;
  /** Whether the probe saw any OTHER peer present in the room. */
  readonly peerPresent: boolean;
  /**
   * The game UUID a present peer announced (its hello's seed, or the state it published in answer to
   * our presence), or `null` when nobody said. `null` is a real, reachable answer — the announcement
   * is a non-retained QoS-0 publish, and a peer mid-entry has no game yet — so it gets its own arm
   * rather than being guessed at.
   */
  readonly peerGameUuid: string | null;
}

/**
 * Which of design §6's rows the probe landed on:
 *
 *  - `same-game` — the peer is there, on our game: rejoin and carry on;
 *  - `other-game` — the peer is there on ANOTHER game: warn, offer a new code, never rejoin;
 *  - `empty-room` — nobody is there: rejoin and wait;
 *  - `peer-silent` — someone is there but did not say which game: rejoin, claiming nothing.
 */
export type RejoinOutcome = 'same-game' | 'other-game' | 'empty-room' | 'peer-silent';

/** What answering the prompt's confirm button MEANS (the glue's two distinct paths). */
export type RejoinAction =
  /** Re-enter the breadcrumb's room to pick the game back up (dealer's choice on the wire). */
  | 'rejoin'
  /** Restart the breadcrumb's game in a FRESH room, leaving the occupied one alone. */
  | 'new-code';

/** The card a player answers. Plain strings — the widget paints them via `textContent`, never HTML. */
export interface RejoinPromptView {
  /** Whether there is anything to ask at all. When `false` every other field is inert. */
  readonly show: boolean;
  /** Which §6 row this is, or `null` when hidden. */
  readonly outcome: RejoinOutcome | null;
  /** What confirming does, or `null` when hidden. */
  readonly action: RejoinAction | null;
  /** The room the prompt is about (the breadcrumb's OWN code), or `''` when hidden. */
  readonly code: string;
  /** The colour named in the copy, or `null` when the copy names none (see the module header). */
  readonly colour: RejoinColour | null;
  /** The question, naming the room. */
  readonly headline: string;
  /** One sentence of context under it. */
  readonly detail: string;
  /** The confirm button's label. */
  readonly confirmLabel: string;
  /** The decline button's label. Declining CLEARS the breadcrumb (design §6) — the glue's job. */
  readonly declineLabel: string;
}

/**
 * The inert card: no breadcrumb, or one that expired quietly, or one naming a game this browser does
 * not hold. Exported so the glue can render "nothing to ask" without inventing a shape.
 */
export const HIDDEN_REJOIN_PROMPT: RejoinPromptView = {
  show: false,
  outcome: null,
  action: null,
  code: '',
  colour: null,
  headline: '',
  detail: '',
  confirmLabel: '',
  declineLabel: '',
};

/** The decline label, identical on every arm: answering "no" is always the same answer. */
const DECLINE = 'Not now';

/** `black` → `Black` — the colour as the copy names it (a fixed two-value union, never free text). */
function named(colour: RejoinColour): string {
  return colour === 'white' ? 'White' : 'Black';
}

/**
 * Derive the rejoin card from a room probe (design §6's table, in one place).
 *
 * Hidden unless the breadcrumb is BELIEVABLE — present, fresh, and backed by a game this browser
 * actually holds. Those three are not error cases: they are the ordinary way a boot has nothing to
 * offer, and the games list (#37) is the route back to any game they exclude.
 */
export function deriveRejoinPrompt(probe: RejoinProbe): RejoinPromptView {
  const crumb = probe.crumb;
  if (crumb === null || probe.stale || !probe.haveGame) return HIDDEN_REJOIN_PROMPT;

  const code = crumb.code;
  const colour = probe.myColour;
  // "as Black" only when a colour was derived for us; otherwise the question is simply the room's.
  const asColour = colour === null ? '' : ` as ${named(colour)}`;

  // Row 2 FIRST: a present peer on another game is the one outcome that must never reach a rejoin,
  // so it is decided before any arm that offers one. It is also the only arm that says nothing about
  // colour — there is no shared game to be seated in yet.
  if (probe.peerPresent && probe.peerGameUuid !== null && probe.peerGameUuid !== crumb.gameUuid) {
    return {
      show: true,
      outcome: 'other-game',
      action: 'new-code',
      code,
      colour: null,
      headline: `There is a different game going in ${code}.`,
      detail:
        'Rejoining would interrupt it. Do you want to restart your last game under a new code?',
      confirmLabel: 'Use a new code',
      declineLabel: DECLINE,
    };
  }

  // Row 3: nobody is there NOW. Whatever a peer may have announced a moment before dropping, the
  // offer describes the room as the probe left it — rejoin and wait.
  if (!probe.peerPresent) {
    return {
      show: true,
      outcome: 'empty-room',
      action: 'rejoin',
      code,
      colour,
      headline: `You were playing in ${code}, but no one is there anymore.`,
      detail: `Rejoin${asColour} anyway? You will be waiting there when they come back.`,
      confirmLabel: 'Rejoin',
      declineLabel: DECLINE,
    };
  }

  // Row 1, and its honest sibling: someone is there. Either they named OUR game, or they named
  // nothing — the offer is the same rejoin, but only the first may claim the games match.
  const sameGame = probe.peerGameUuid === crumb.gameUuid;
  return {
    show: true,
    outcome: sameGame ? 'same-game' : 'peer-silent',
    action: 'rejoin',
    code,
    colour,
    headline: `Rejoin ${code}${asColour}?`,
    detail: sameGame
      ? 'Your opponent is there, on the same game.'
      : 'Someone is in that room, but has not said which game they are playing.',
    confirmLabel: 'Rejoin',
    declineLabel: DECLINE,
  };
}
