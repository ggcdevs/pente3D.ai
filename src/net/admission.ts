/**
 * Admission + reconciliation — the PURE heart of the networked-session entry protocol
 * (build plan Task S.3, epic #35, closes #31; design doc §4 "Entry / admission protocol",
 * §5 "Reconciliation matrix", §11 "Initiator election").
 *
 * ## What this is
 *
 * When two peers enter the same room (rendezvous channel) they each bring a **seed
 * proposal** — what game, if any, they want to play. This module decides, PURELY, what a
 * pair of proposals agrees on ({@link reconcile}) AND whether a peer may adopt the concrete
 * game it is actually offered on the wire ({@link acceptsGame}).
 *
 * ## The SEED MATRIX (v3.1 design §3) — enforced on the wire
 *
 * | Seed | Sends | Accepts |
 * |---|---|---|
 * | **new** | empty only (a fresh uuid) | empty only — REJECTS a non-empty peer game |
 * | **resume** / **current** | its own concrete game | the SAME uuid only — rejects a different concrete game |
 * | **defer** (dealer's choice) | nothing | **the ONLY kind that adopts a peer's non-empty game** |
 *
 * The user's rule, verbatim (issue #46): *"when selecting 'New Game', i would expect the laptop
 * to never send non-empty gamestate data and i would expect my phone to reject any non-empty
 * gamestate data. only 'Dealer's Choice' should allow a device to accept non-empty gamestate
 * data from the other device."* So a `new` beside a real resume/current is NOT "the real game
 * wins" (that was the v3 behaviour, and it is exactly how a stale game got pushed onto a peer
 * that asked to start over — #46/#43): it is an honest TYPED reject, `seed-refused`.
 *
 * Concretely, {@link reconcile}:
 *
 *   - both bring nothing (defer) → a fresh **new** game;
 *   - a `new` beside a defer, or two `new`s → a fresh **new** game (empty and interchangeable;
 *     which uuid the pair ends up on is settled at GENESIS by {@link electInitiator} — the #42
 *     fix: a genuinely shared uuid from the start, not "converges on the first move");
 *   - a concrete game beside a **defer** → play that game (the deferrer adopts it);
 *   - a `new` beside a concrete resume/current → **reject** `seed-refused`;
 *   - both bring the SAME game with a matching `headHash` → **resume** it together;
 *   - both bring the same game UUID but DIVERGENT `headHash`es → **reject** `game-divergent`
 *     (a genuine conflict — the #38 merge/diff seam, NOT a silent pick);
 *   - both bring DIFFERENT game UUIDs → **reject** `game-mismatch`.
 *
 * A `new` proposal is **concrete-but-empty**: it means "I want a fresh game" and carries no
 * history — so it agrees with anything else that has no history, and refuses anything that has.
 *
 * {@link reconcile} judges PROPOSALS; {@link acceptsGame} judges the BYTES a peer is about to be
 * served (its uuid + whether it carries any history at all). Both sides of the wire apply the
 * same {@link acceptsGame} rule — the arbiter before it publishes an `admit`, the newcomer again
 * on receipt — so a peer that does not enforce it cannot silently push a game onto one that does
 * (design §5: "the opponent's client is the validator").
 *
 * It also decides **initiator election** (design §4 Case 2): when two peers arrive together,
 * a deterministic order — **earlier live-presence `arrivalOrder`, then lower `playerId`** —
 * picks which one computes the reconciliation, killing the initial double-white race (#31).
 *
 * ## Design invariants this module guarantees
 *
 * - **Order-insensitive.** `reconcile(a, b)` and `reconcile(b, a)` agree on the same game or
 *   the same typed reject — a peer must not care who published first. (Proven by fast-check.)
 * - **A `new` seed never yields a non-empty agreed game**, and only a `defer` ever adopts one:
 *   the two halves of the design §3 enforcement, property-tested against both entry points.
 * - **`reconcile` and `acceptsGame` agree.** Whenever `reconcile` refuses a pair, the same peer
 *   refuses the other's concrete game with the SAME typed reason — the proposal-level and
 *   byte-level gates can never disagree about who may play what (proven by fast-check).
 * - **Total + honest.** Every proposal pair yields a valid {@link AgreedGame} or a TYPED
 *   {@link Reject} — never a throw, never `undefined`, never a masked/mislabeled failure
 *   (agent-principles: reject honestly with a machine reason surfaced to the UI).
 * - **Never invents a game.** An agreed `existing` game is exactly one of the concrete input
 *   proposals' `uuid` + `headHash` — reconciliation only ever CHOOSES, never fabricates.
 * - **Deterministic election.** Any permutation of the same peers elects the same playerId.
 *
 * ## Purity & the shared-state seam
 *
 * This is **pure logic**: `(proposals) → agreed | reject` and `(peers) → playerId`, with no
 * transport, DOM, clock, or randomness — which is exactly what makes it unit-testable to
 * 100% coverage + mutation-gated in isolation (agent-principles: keep the IO adapter thin,
 * the decision separable). It imports nothing from three/render/ui/net-io. A `new` agreed
 * result deliberately carries NO uuid: minting a fresh id is randomness/IO, done by the
 * caller (`NetSession.enter`, S.5) with `randomId.ts` — this module only DECIDES that a
 * fresh game is what the pair agreed on.
 *
 * ## Out of scope (leave the seam, do NOT build here)
 *
 * - **Seat assignment / reclaim / room-full** — the identity-owned {@link SeatMap} decision
 *   lives in `net/seats.ts` (Task S.2). This module decides the GAME; that one decides the
 *   SEATS. `enter()` (S.5) composes the two.
 * - **The `#38` resolution flow** — `game-divergent` / `game-mismatch` are the seams #38
 *   later turns into merge / diff / rewind-to-last-shared-move. Here they are honest rejects.
 * - **Randomized shared seed** (`random`) is #34 — NOT a proposal kind here.
 */

/**
 * A seed proposal: what game a peer brings when entering a room (design §3, §5).
 *
 *   - `defer` — "dealer's choice": bring nothing, adopt whatever the opponent brings. The ONLY
 *     kind that adopts a peer's NON-EMPTY game (design §3).
 *   - `new` — mint a fresh game. Concrete-but-EMPTY: it wants a game and has no history, so two
 *     of them are interchangeable — but it accepts EMPTY only and refuses a peer's real game.
 *   - `resume` — seed a specific persisted game (from the games list, #37) by `uuid` + its
 *     current `headHash`.
 *   - `current` — seed whatever game is currently loaded locally, by its `uuid` + `headHash`.
 *
 * `resume` and `current` differ only in provenance (picked-from-a-list vs currently-loaded);
 * reconciliation treats them identically — it compares `uuid` + `headHash`, not the kind.
 * (`random` — a shared randomized board — is #34, deliberately absent.)
 */
export type Proposal =
  | { readonly kind: 'defer' }
  | { readonly kind: 'new' }
  | { readonly kind: 'resume'; readonly uuid: string; readonly headHash: string }
  | { readonly kind: 'current'; readonly uuid: string; readonly headHash: string };

/** A proposal carrying a real game identity to preserve (`resume` / `current`). */
type HistoryProposal = Extract<Proposal, { uuid: string; headHash: string }>;

/** Construct a `defer` ("dealer's choice") proposal. */
export function deferProposal(): Proposal {
  return { kind: 'defer' };
}

/** Construct a `new` (mint-a-fresh-game) proposal. */
export function newProposal(): Proposal {
  return { kind: 'new' };
}

/** Construct a `resume` proposal for a specific persisted game (`uuid` + `headHash`). */
export function resumeProposal(uuid: string, headHash: string): Proposal {
  return { kind: 'resume', uuid, headHash };
}

/** Construct a `current` proposal for the currently-loaded game (`uuid` + `headHash`). */
export function currentProposal(uuid: string, headHash: string): Proposal {
  return { kind: 'current', uuid, headHash };
}

/**
 * True iff `p` is a **concrete** proposal — anything other than `defer`. `new` is concrete (it
 * wants a specific outcome: a fresh game) even though it carries no history; only `defer` ("I'll
 * take yours") is non-concrete. The GLOSSARY vocabulary term, and the predicate the reconciliation
 * INVARIANTS are stated against ("an agreed existing game is always one of the concrete proposals
 * brought"). {@link reconcile} itself branches on {@link hasHistory}, not on this — the v3.1 matrix
 * distinguishes "brought a real game" from "wants a fresh one", not concrete-vs-deferred.
 */
export function isConcrete(p: Proposal): boolean {
  return p.kind !== 'defer';
}

/** True iff `p` carries a real game identity to preserve (`resume` / `current`). */
function hasHistory(p: Proposal): p is HistoryProposal {
  return p.kind === 'resume' || p.kind === 'current';
}

/**
 * The game a pair of proposals agreed on:
 *
 *   - `new` — mint a fresh game. Carries NO uuid on purpose: minting is randomness/IO, done
 *     by the caller (`randomId.ts`, S.5); this module only decides a fresh game is agreed.
 *   - `existing` — resume/play a concrete game, identified by the `uuid` + `headHash` of one
 *     of the input proposals (never invented — always one of the two brought).
 */
export type AgreedGame =
  | { readonly kind: 'new' }
  | { readonly kind: 'existing'; readonly uuid: string; readonly headHash: string };

/**
 * Why reconciliation refused to agree on a single game (design §5, §7). A machine-readable
 * reason the UI surfaces verbatim — never a silent failure or a mislabeled log:
 *
 *   - `game-mismatch` — the two peers proposed DIFFERENT games (different `uuid`s).
 *   - `game-divergent` — the SAME game (`uuid`) but forked histories (divergent `headHash`).
 *   - `seed-refused` — the two SEEDS are incompatible: one side chose **New Game** (empty only)
 *     while the other brought a real game. Neither may silently give way — adopting the peer's
 *     game would override an explicit "start over" (#46/#43), and serving our empty game would
 *     discard theirs — so the pair is refused (design §3, the user's rule quoted at the top).
 *
 * `game-mismatch`/`game-divergent` are the seams #38 later turns into a resolution flow (merge /
 * diff / rewind). `seed-refused` is NOT such a seam: the two players chose incompatible things,
 * and the honest answer is to tell them so.
 */
export type ReconcileReject = 'game-mismatch' | 'game-divergent' | 'seed-refused';

/** A typed reconciliation refusal — a machine reason surfaced to the UI (design §7). */
export interface Reject {
  readonly ok: false;
  readonly reason: ReconcileReject;
}

/** The result of {@link reconcile}: an agreed game, or a typed reject. */
export type ReconcileResult = { readonly ok: true; readonly game: AgreedGame } | Reject;

/** Agreed-game success wrapper. */
function agree(game: AgreedGame): ReconcileResult {
  return { ok: true, game };
}

/** Typed reject wrapper. */
function reject(reason: ReconcileReject): Reject {
  return { ok: false, reason };
}

/** The agreed game for a single history proposal: play exactly that game. */
function playHistory(p: HistoryProposal): ReconcileResult {
  return agree({ kind: 'existing', uuid: p.uuid, headHash: p.headHash });
}

/**
 * Reconcile two seed proposals into a single agreed game, or a typed reject — the design §3 SEED
 * MATRIX at the PROPOSAL level:
 *
 *   - **both defer** → a fresh **new** game (neither brought anything).
 *   - **`new` + `defer`, or `new` + `new`** → a fresh **new** game. Two `new`s are interchangeable;
 *     WHICH uuid the pair lands on is decided at genesis by {@link electInitiator} (#42).
 *   - **a concrete `resume`/`current` + `defer`** → play that game; the deferrer adopts it. This is
 *     the ONLY way a peer's non-empty game is adopted (design §3).
 *   - **`new` + a concrete `resume`/`current`** → reject **`seed-refused`**: "New Game" sends and
 *     accepts empty only, so there is no honest outcome (this is the #46/#43 fix — the v3 matrix
 *     handed the real game to the peer that had asked to start over).
 *   - **two concrete, same `uuid` + matching `headHash`** → **resume** together.
 *   - **two concrete, same `uuid` + divergent `headHash`** → reject `game-divergent`.
 *   - **two concrete, different `uuid`s** → reject `game-mismatch` (a `resume`/`current` accepts
 *     the same uuid only).
 *
 * Order-insensitive: `reconcile(a, b)` and `reconcile(b, a)` agree on the same game or the
 * same reject (the only asymmetry — which side is "a" — never affects the outcome). Total:
 * always returns; never throws, never `undefined`.
 */
export function reconcile(a: Proposal, b: Proposal): ReconcileResult {
  const aHist = hasHistory(a);
  const bHist = hasHistory(b);

  // Both carry a real game to preserve → compare identities (a resume/current accepts its OWN
  // uuid only; a matching uuid with a forked head is the #38 divergence seam).
  if (aHist && bHist) {
    if (a.uuid !== b.uuid) return reject('game-mismatch');
    if (a.headHash !== b.headHash) return reject('game-divergent');
    // Same uuid + matching headHash → resume the shared game.
    return playHistory(a);
  }

  // A `new` beside the peer's REAL game: "New Game" sends and accepts EMPTY ONLY (design §3), and
  // only dealer's choice adopts a peer's non-empty game — so this pair cannot play. Refuse it with
  // a typed reason instead of silently overriding one player's explicit choice (#46/#43).
  if ((a.kind === 'new' && bHist) || (b.kind === 'new' && aHist)) return reject('seed-refused');

  // Exactly one side has history and the other DEFERS (a `new` opposite it was refused above), so
  // the deferrer adopts the real game — dealer's choice, the only adopting kind.
  if (aHist) return playHistory(a);
  if (bHist) return playHistory(b);

  // Neither carries history: any mix of defer/new. Nothing to preserve on either side, so the pair
  // agrees on a single fresh new game — interchangeable, never blocks.
  return agree({ kind: 'new' });
}

/**
 * A concrete game a peer is about to be SERVED over the wire, reduced to the two facts the seed
 * rules judge: WHICH game it is, and whether it carries ANY history. Projected from the sync
 * payload / engine log by the caller (`session.ts`) — this module never reads a log.
 */
export interface OfferedGame {
  /** The offered game's stable UUID (minted at genesis, intrinsic to its hash chain). */
  readonly uuid: string;
  /**
   * True iff the offered log holds NO events at all — a genesis-only, interchangeable EMPTY game.
   * "Empty" is about the LOG, not the board: a `place` followed by an `undo` leaves the board bare
   * but the history real, and adopting it is not starting a fresh game.
   */
  readonly empty: boolean;
}

/** Whether a peer's own seed permits adopting an offered game, or the typed reason it does not. */
export type SeedAcceptance = { readonly ok: true } | Reject;

/** The accepted verdict — one literal, so the two acceptance paths cannot drift apart. */
const ACCEPTED: SeedAcceptance = { ok: true };

/**
 * Decide whether a peer holding the seed `mine` may ADOPT the concrete game it is `offered` — the
 * design §3 matrix at the BYTE level, and the enforcement the wire actually needs:
 *
 *   - **`defer`** (dealer's choice) → accepts ANYTHING. The only kind that adopts a peer's
 *     non-empty game.
 *   - **`new`** → accepts an EMPTY game only; a non-empty one is `seed-refused`. This is the user's
 *     rule in #46 ("i would expect my phone to reject any non-empty gamestate data"), and it is
 *     what {@link reconcile} alone cannot enforce: a peer whose PROPOSAL was `new` may by now hold
 *     a game with moves in it, so the proposal pair can agree while the bytes still violate the
 *     seed. Both #46 (a stale game pushed to a peer) and #43 (a reused code keeping the old board)
 *     die here structurally, whichever side is asked.
 *   - **`resume`/`current`** → accepts its OWN uuid only. A DIFFERENT non-empty game is
 *     `game-mismatch` (the peers are on different games); a different EMPTY game is `seed-refused`
 *     (the peer chose New / brought nothing while we asked for a specific game — the mirror of the
 *     `new`-vs-real-game refusal, reported with the same reason from either side).
 *
 * Deliberately does NOT compare `headHash` when the uuid matches: being AHEAD of, or behind, the
 * same game is convergence, not a seed violation — that decision belongs to the sync policy
 * (design §5 / V.4 fast-forward-vs-resolution), and duplicating it here would fork the rule.
 *
 * Total and pure: every (seed, offer) pair yields an acceptance or a TYPED reject; never throws.
 */
export function acceptsGame(mine: Proposal, offered: OfferedGame): SeedAcceptance {
  switch (mine.kind) {
    case 'defer':
      return ACCEPTED;
    case 'new':
      return offered.empty ? ACCEPTED : reject('seed-refused');
    case 'resume':
    case 'current':
      if (offered.uuid === mine.uuid) return ACCEPTED;
      return offered.empty ? reject('seed-refused') : reject('game-mismatch');
  }
}

/**
 * A peer that has arrived in the room, for initiator election. `arrivalOrder` is the peer's
 * live-presence arrival rank (earlier = smaller), from the `PresenceTracker` ordering the
 * session assigns (S.5); `playerId` is its stable identity.
 */
export interface Peer {
  /** The peer's stable playerId (owns a seat across reconnects; GLOSSARY "playerId"). */
  readonly playerId: string;
  /** Live-presence arrival rank — earlier arrivals have a smaller value. */
  readonly arrivalOrder: number;
}

/**
 * Elect the initiator of a simultaneous arrival (design §4 Case 2, §11): the peer that runs
 * the reconciliation matrix and publishes the agreed game. The order is deterministic —
 * **earlier `arrivalOrder` wins; ties break by the lexicographically-lower `playerId`** — so
 * every peer, seeing the same set, independently elects the SAME initiator and no double-
 * white race can occur (#31). Order-insensitive over the input list.
 *
 * @throws if `peers` is empty — there is no one to elect. Surfaced, not masked: an empty
 *   election set is a caller bug (the electing peer is always itself in the set).
 */
export function electInitiator(peers: readonly Peer[]): string {
  const [first, ...rest] = peers;
  if (first === undefined) {
    throw new Error('electInitiator: no peers to elect from');
  }
  let winner: Peer = first;
  for (const p of rest) {
    if (beats(p, winner)) winner = p;
  }
  return winner.playerId;
}

/** True iff `p` should be elected over the current `best` (earlier arrival, then lower id). */
function beats(p: Peer, best: Peer): boolean {
  if (p.arrivalOrder !== best.arrivalOrder) return p.arrivalOrder < best.arrivalOrder;
  return p.playerId < best.playerId;
}
