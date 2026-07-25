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
 * served (its uuid + whether it carries any history at all). {@link decideAdmission} composes the two
 * into the single verdict an arbiter acts on, so the matrix has ONE implementation rather than a pure
 * rule plus a hand-rolled copy in the glue.
 *
 * A game can cross into a peer at exactly three points, and each one asks this module before it may:
 * the arbiter before it publishes an `admit` ({@link decideAdmission}), the newcomer again on receipt
 * ({@link acceptsGame}), and the move-sync channel before it runs a log belonging to a DIFFERENT game
 * ({@link acceptsCrossing} in `SyncEngine.receive`). So a peer that does not enforce the rule cannot
 * silently push a game onto one that does, by any channel (design §5: "the opponent's client is the
 * validator"). Same-game convergence (an extension of the log we are already on) is NOT a seed question
 * and is left to the sync policy; these rules only ever govern moving onto a game you are not on.
 *
 * The seed is the ENTRY question, and the wire says so: the two admission gates run at entry, while the
 * long-lived sync channel gates on {@link GameGate} — the seed only until the pair agrees on a game,
 * and that AGREED game from then on. Carrying the entry seed for the whole session instead was a hole
 * in both directions (a `defer` peer could be moved off its agreed game by anyone, forever; a
 * `resume` peer refused its own pair's next generation) — see {@link GameGate}.
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
 * - **{@link decideAdmission} never puts a peer on a game its own seed refuses.** Whatever the
 *   arbiter's seed and held game, the newcomer either ends up on a game {@link acceptsGame} accepts for
 *   its seed, or gets a typed reject — property-tested over EVERY (seed, held game, seed) triple,
 *   including the `defer`-arbiter row, against the arbiter's real serving behaviour (it serves the game
 *   its ENGINE holds, not the one its proposal named).
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
      return acceptsOnlyGame(mine.uuid, offered);
  }
}

/**
 * The "**this game only**" rule, in ONE place: `uuid` is accepted, anything else is refused with the
 * reason that honestly names WHY — a different game with history is `game-mismatch` (the two peers are
 * on different games), a different EMPTY game is `seed-refused` (the other side brought nothing / asked
 * to start over while we are on a specific game).
 *
 * Shared by the `resume`/`current` row of {@link acceptsGame} and by the AGREED row of
 * {@link acceptsCrossing}, because they are the same rule stated about two different reference points
 * (the game my seed named vs the game the pair actually agreed on) — one implementation, so the two can
 * never drift into disagreeing about the same refusal.
 */
function acceptsOnlyGame(uuid: string, offered: OfferedGame): SeedAcceptance {
  if (offered.uuid === uuid) return ACCEPTED;
  return offered.empty ? reject('seed-refused') : reject('game-mismatch');
}

/**
 * WHICH game a live session may be on — the question the move-sync channel actually has to answer, and
 * the thing a raw {@link Proposal} cannot express on its own.
 *
 * A seed answers *"what game do I want to enter on"*. That question is answered ONCE, at entry: after
 * the admission protocol resolves, the pair is on a concrete AGREED game and the seed has no further
 * say. Keeping the entry seed as the lifetime rule was a real hole in both directions:
 *
 *   - a `defer` seed (what {@link import('./session').NetSession.join} and every reconnect send) accepts
 *     ANY game FOREVER, so a stranger — or a stale third device — could move an already-agreed pair off
 *     its game through the plain sync channel;
 *   - a `resume`/`current` seed accepts its OWN uuid only, forever — so the pair's own next generation
 *     (a rematch, whose uuid is DERIVED, {@link import('./rematch').rematchGameUuid}) was refused and
 *     the two peers deadlocked on two different games.
 *
 * So the gate is stated as the session's actual situation:
 *
 *   - `entry` — entry has not resolved yet (we are `connecting`, running on a provisional game): the
 *     player's own SEED decides, exactly as design §3 says.
 *   - `agreed` — the admission protocol put this session on game `uuid`: that game, and nothing else,
 *     may cross onto this connection. (A deferring ARBITER agrees onto a game it does not hold yet —
 *     the newcomer's own — so this deliberately names a uuid rather than "the game I am on".)
 */
export type GameGate =
  | { readonly kind: 'entry'; readonly seed: Proposal }
  | { readonly kind: 'agreed'; readonly uuid: string };

/**
 * Decide whether a session may CROSS ONTO a DIFFERENT game than the one it is running — the design §3
 * matrix as a live session (rather than a bare seed) applies it. Total and pure.
 *
 *   - **`agreed`** → the agreed game only ({@link acceptsOnlyGame}). This is what closes the
 *     "`defer` accepts anything forever" hole: once the pair has agreed, dealer's choice has already
 *     been made, and a foreign game is refused whatever seed was typed at entry.
 *   - **`entry`** → the player's own seed ({@link acceptsGame}) — AND, additionally, only while we hold
 *     no history of our own (`holdingHistory === false`). A seed says which game we are willing to
 *     START on; it never says "throw away the moves I already have". A peer that is mid-game and hears
 *     about a different game is simply on a different game from that publisher (`game-mismatch`) — the
 *     admission protocol, not the move-sync channel, is where a peer changes which game it is playing.
 *
 * Refusals are TYPED and the caller leaves the game untouched, so no publisher can push OR stop another
 * peer's game (the kill-switch this gate exists to deny).
 *
 * @param gate What game this session may be on (agreed, or the not-yet-resolved entry seed).
 * @param offered The DIFFERENT game we are being offered (uuid + whether it carries any history).
 * @param holdingHistory Whether the game we are running has any entries of its own to lose.
 */
export function acceptsCrossing(
  gate: GameGate,
  offered: OfferedGame,
  holdingHistory: boolean,
): SeedAcceptance {
  switch (gate.kind) {
    case 'agreed':
      return acceptsOnlyGame(gate.uuid, offered);
    case 'entry': {
      const acceptance = acceptsGame(gate.seed, offered);
      if (!acceptance.ok) return acceptance;
      return holdingHistory ? reject('game-mismatch') : ACCEPTED;
    }
  }
}

/**
 * What an arbiter does with ONE newcomer's seed proposal — the WHOLE game-level admission verdict
 * ({@link decideAdmission}), so the wire has exactly one rule and no second copy to drift:
 *
 *   - `serve: 'mine'` — publish an `admit` carrying the game OUR engine holds; the newcomer adopts it.
 *   - `serve: 'theirs'` — WE hold nothing worth keeping and the agreed game is the NEWCOMER's: admit it
 *     naming that `uuid` and let it keep its own game, which we then adopt off the sync channel. This
 *     is design §3's *"dealer's choice is the ONLY kind that adopts a peer's non-empty game"* row in the
 *     direction where the DEFERRER is the arbiter — the row that is unreachable if an arbiter may only
 *     ever serve its own engine.
 *   - a {@link Reject} — a typed refusal, from either gate.
 */
export type AdmissionDecision =
  | { readonly ok: true; readonly serve: 'mine' }
  | { readonly ok: true; readonly serve: 'theirs'; readonly uuid: string }
  | Reject;

/**
 * Decide, PURELY, what an arbiter holding the seed `mine` and the concrete game `myGame` does with a
 * newcomer's seed `theirs` — the design §3 seed matrix as the wire actually applies it, in ONE place.
 *
 * `session.ts` used to compose this inline from {@link reconcile} + an "we can only serve our own
 * engine" guard + {@link acceptsGame}, which is how the matrix's `defer`-adopts row came to be
 * unreachable whenever the deferrer was the arbiter: the guard refused the agreed game (a
 * `game-mismatch` the deferrer never proposed) before the seed gate was ever consulted. The rule lives
 * here now so it is unit + mutation + property gated against the SAME entry points the wire uses.
 *
 * The three steps, in order:
 *
 *  1. **Reconcile the proposals** ({@link reconcile}). A typed reject settles it.
 *  2. **Do WE hold the agreed game?** If reconciliation agreed on a concrete game that is not
 *     `myGame`, we cannot serve it — but if OUR seed is `defer` AND our own game is still empty we do
 *     not want to: dealer's choice brings nothing, so the agreed game is the newcomer's own and we
 *     ADOPT it (`serve: 'theirs'`). A deferrer whose engine has since acquired a history is on a real
 *     game and keeps it: `game-mismatch`.
 *  3. **Otherwise serve our own engine**, judged by the NEWCOMER's seed against the bytes it would
 *     actually receive ({@link acceptsGame}) — the byte-level half. This is where a `new` newcomer is
 *     refused a game in progress (#46/#43), and where an arbiter whose proposal named a game its
 *     engine no longer holds (it rematched into a fresh one) is refused for what it *actually* offers
 *     — `game-mismatch` when we hold a different real game, `seed-refused` when we hold an empty one —
 *     rather than mislabelled by a guard that only looked at proposals.
 *
 * Total and pure: every (seed, game, seed) triple yields a decision or a TYPED reject; never throws.
 */
export function decideAdmission(
  mine: Proposal,
  myGame: OfferedGame,
  theirs: Proposal,
): AdmissionDecision {
  const agreed = reconcile(mine, theirs);
  if (!agreed.ok) return agreed;
  // Dealer's choice adopts (design §3). We brought nothing, and reconciliation put the pair on a
  // concrete game our engine does not hold — which, with a `defer` on our side, is by construction the
  // NEWCOMER's own game (reconcile only ever chooses one of the two proposals, and ours named none).
  if (mine.kind === 'defer' && agreed.game.kind === 'existing' && agreed.game.uuid !== myGame.uuid) {
    // …but only while we hold NO history of our own. `defer` says "I'll take whichever game we start
    // on"; it never says "discard the game I am playing". Our seed was answered the moment our engine
    // acquired a history — by then we ARE on a game, and a newcomer naming a different one is simply on
    // a different game from us (`game-mismatch`), which is what that reason says. Without this, a peer
    // that JOINED (join sends `defer`) and then played a whole game would abandon it, mid-play, for any
    // later arrival that named another game.
    if (!myGame.empty) return reject('game-mismatch');
    return { ok: true, serve: 'theirs', uuid: agreed.game.uuid };
  }
  // We can only ever serve the game our engine actually holds, so that is what the newcomer's seed is
  // judged against — never the agreed proposal, which may name a game neither of us is on any more.
  const acceptance = acceptsGame(theirs, myGame);
  if (!acceptance.ok) return acceptance;
  return { ok: true, serve: 'mine' };
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
