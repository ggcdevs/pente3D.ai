/**
 * Admission + reconciliation — the PURE heart of the networked-session entry protocol
 * (build plan Task S.3, epic #35, closes #31; design doc §4 "Entry / admission protocol",
 * §5 "Reconciliation matrix", §11 "Initiator election").
 *
 * ## What this is
 *
 * When two peers enter the same room (rendezvous channel) they each bring a **seed
 * proposal** — what game, if any, they want to play. This module decides, PURELY, what a
 * pair of proposals agrees on:
 *
 *   - both bring nothing (defer) → a fresh **new** game;
 *   - one brings a concrete game, the other defers → play that game (the deferrer adopts);
 *   - both bring the SAME game with a matching `headHash` → **resume** it together;
 *   - both bring the same game UUID but DIVERGENT `headHash`es → **reject** `game-divergent`
 *     (a genuine conflict — the #38 merge/diff seam, NOT a silent pick);
 *   - both bring DIFFERENT game UUIDs → **reject** `game-mismatch`.
 *
 * A `new` proposal is **concrete-but-empty**: it means "I want a fresh game" but carries no
 * history to preserve, so two `new`s (or a `new` beside a defer) collapse to one fresh game,
 * and a `new` beside a real resume/current yields the real game (the empty side has nothing
 * to conflict with). Empty games are interchangeable, so this branch **never blocks**.
 *
 * It also decides **initiator election** (design §4 Case 2): when two peers arrive together,
 * a deterministic order — **earlier live-presence `arrivalOrder`, then lower `playerId`** —
 * picks which one computes the reconciliation, killing the initial double-white race (#31).
 *
 * ## Design invariants this module guarantees
 *
 * - **Order-insensitive.** `reconcile(a, b)` and `reconcile(b, a)` agree on the same game or
 *   the same typed reject — a peer must not care who published first. (Proven by fast-check.)
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
 *   - `defer` — "dealer's choice": bring nothing, adopt whatever the opponent brings.
 *   - `new` — mint a fresh game. Concrete-but-EMPTY: it wants a game but has no history, so
 *     it never conflicts and two of them are interchangeable.
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
 * True iff `p` is a **concrete** proposal — anything other than `defer`. `new` is concrete
 * (it wants a specific outcome: a fresh game) even though it carries no history. Only `defer`
 * ("I'll take yours") is non-concrete. This is the "count the concrete proposals" primitive
 * the reconciliation matrix (design §5) branches on.
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
 *
 * Both are the seams #38 later turns into a resolution flow (merge / diff / rewind).
 */
export type ReconcileReject = 'game-mismatch' | 'game-divergent';

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
 * Reconcile two seed proposals into a single agreed game, or a typed reject (design §5). The
 * decision is by the COUNT of concrete proposals and, when both are concrete with history,
 * by `uuid` + `headHash`:
 *
 *   - **0 concrete** (both defer) → a fresh **new** game.
 *   - **1 concrete** → play it; the deferrer adopts it. (A lone `new` → a fresh new game;
 *     a lone `resume`/`current` → that existing game.)
 *   - **2 concrete, but at least one is `new`** → the `new` side carries no history, so the
 *     real game (if any) wins; two `new`s collapse to one fresh new game. Never blocks —
 *     empty games are interchangeable.
 *   - **2 concrete with history, same `uuid` + matching `headHash`** → **resume** together.
 *   - **2 concrete with history, same `uuid` + divergent `headHash`** → reject `game-divergent`.
 *   - **2 concrete with history, different `uuid`s** → reject `game-mismatch`.
 *
 * Order-insensitive: `reconcile(a, b)` and `reconcile(b, a)` agree on the same game or the
 * same reject (the only asymmetry — which side is "a" — never affects the outcome). Total:
 * always returns; never throws, never `undefined`.
 */
export function reconcile(a: Proposal, b: Proposal): ReconcileResult {
  const aHist = hasHistory(a);
  const bHist = hasHistory(b);

  // Both carry a real game to preserve → compare identities (the only reject paths).
  if (aHist && bHist) {
    if (a.uuid !== b.uuid) return reject('game-mismatch');
    if (a.headHash !== b.headHash) return reject('game-divergent');
    // Same uuid + matching headHash → resume the shared game.
    return playHistory(a);
  }

  // At most one side has history. If exactly one does, play it (the other defers or is an
  // empty `new`, both of which have nothing to preserve → they adopt the real game).
  if (aHist) return playHistory(a);
  if (bHist) return playHistory(b);

  // Neither carries history: any mix of defer/new. No history to preserve on either side, so
  // the pair agrees on a single fresh new game — interchangeable, never blocks.
  return agree({ kind: 'new' });
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
