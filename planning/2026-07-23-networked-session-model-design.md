# Networked Session Model — Design (2026-07-23)

**Epic:** #35 · **Fixes:** #31 · **Spin-offs:** #34 (randomized board), #36 (spectator),
#37 (games list / review-resume), #38 (resume conflict resolution).
**Status:** Designed & agreed with the user 2026-07-23; ready to plan implementation.

This document is the source of truth for the redesign. It reuses existing machinery wherever
possible: the stable `playerId`, the event-log **hash-chain** (`headHash`) + conflict/fork
detection (`SyncEngine.conflictForks`), the ask/accept **handshake** primitive, `PresenceTracker`,
and the IndexedDB archive.

---

## 1. Problem

`#31`: two players who both press **Join** both get **Black**. Root cause
(`src/net/session.ts:246`): seats are derived **locally, by button role** — `host()` claims
white against an empty map; `join()` seeds `{ white: 'host', black: null }` using a **static
`'host'` sentinel** and claims the only free seat (black). The sentinel is a dummy, not a real
peer, so when *both* peers join, both build the same map and both claim black. There is **no
coordination over the relay** — each peer decides its seat independently.

This is a symptom of a deeper conflation: the code treats the **room code as the game's
identity** and the **button as the seat source**. The fix is a proper model.

## 2. Core model

### 2.1 Code ≠ Game

- A **room code** is only a **rendezvous channel** on the relay: the mechanism by which two
  peers find each other. It is reusable and identifies *no* game. `TESTTT` can host game G1
  today and an unrelated game G2 tomorrow (this already works — the code was never the game).
- A **Game** is a **UUID-identified** entity: its own event-log/state, persisted locally,
  **portable** across rooms and partners. You can resume a game anywhere, with anyone who holds
  it.

### 2.2 Game identity (shared UUID at genesis)

- A **game UUID** is minted once at game creation and carried **in the event-log genesis** (so
  it is part of the hashed history), NOT merely as a local archive key. Both peers therefore
  reference the *same* game identity.
- This enables the reconciliation check "same game UUID but divergent `headHash`?" → a genuine
  conflict, distinct from "two different games."
- `randomId.ts` already provides an insecure-context-safe id generator; use it (guard
  `crypto.randomUUID`). Persisted games without a UUID (legacy/local) get one lazily on load,
  minted deterministically is unnecessary — a fresh id is fine since they were never networked.

### 2.3 Identity-owned seats

- Seat ownership is `{ white: playerId | null, black: playerId | null }`, bound **in the game**
  and **persisted** with it. The game *remembers* who is white.
- **Reclaim-by-identity:** a returning peer reclaims the seat its persisted game says it owns
  (existing `claimSeat` identity rule).
- **Validate-by-headHash:** a resident peer admits a returner only if its `headHash` is
  consistent with the resident's game (match, or a resolvable prefix — see §6/#38).
- **Reserve vacated seats:** a seat stays owned by its playerId while that owner is absent.
  "Room full" means **both seats owned**, even if an owner is temporarily gone (scenarios 2–5).
- **First-available + tiebreak applies ONLY at genuine game creation** (empty game, no owners
  yet). After that first instant, nobody is assigned by arrival — they reclaim.

### 2.4 Model A — decentralized resident-peer arbitration

- **No authoritative store** (no retained seat-map on the relay; the relay stays dumb).
- Seat ownership lives in each peer's **persisted game**. Whoever is **currently in the room**
  validates newcomers.
- **Empty room** → the first returning owner re-seeds room state from its own persisted game and
  waits to be validated by the next arrival.
- We defend against **accidents** (both-join, stale/forked resume, network glitch), not
  attackers — the room code is a bearer secret for a friendly game.

## 3. Entry UX (unified join + seed selection)

- **Host vs Join is removed.** You **join a code** and separately choose what **game to seed**:
  - **New** — mint a fresh game (new UUID).
  - **Resume** — pick from your **games list** (finished + unfinished) → seed that UUID (#37).
  - **Current local board** — seed whatever game you currently have loaded (even a hand-set
    board no one else has).
  - **Dealer's choice** (defer) — bring nothing; load whatever the opponent brings.
  - **Randomized** — a deterministic, shared randomized starting board (#34).
- On joining, a peer publishes its **seed-proposal** along with its identity.

## 4. Entry / admission protocol

A peer **P** enters room `R` with a proposal ∈ {`new`, `resume(uuid,headHash)`,
`current(uuid,headHash)`, `defer`, `random`}:

1. Subscribe to `R`, announce `hello{ playerId, proposal }`, wait a short **settle window** for
   presence + responses to stabilize.

**Case 1 — a resident is established** (owns a seat + holds a game). The resident is the
**arbiter**:
- P owns a seat in the resident's game **and** (proposes that same game with matching `headHash`
  **or** `defer`s) → **admit**; return the authoritative game + P's seat. *(reclaim/resume —
  scenarios 2, 3, 5-good)*
- P owns no seat but one is free (only one owner present) → admit if P `defer`s or matches.
- Proposal conflicts (different game / divergent `headHash`) → **reject with reason**
  *(scenario 5-bad → future #38 merge)*.
- Both seats owned, P owns neither → **reject** *(or spectate — #36 config)*.

**Case 2 — no resident** (P alone after the settle window):
- **Truly alone** → P **establishes** the room from its proposal (new→mint game+UUID, claim
  white as first owner; resume/current→re-seed persisted game, reclaim its seat) and waits.
- **Two peers arrived together** (each sees the other within the window) → **initiator
  election**: deterministic order (**earlier live-presence arrival, then lower `playerId`**)
  picks the initiator; it runs the reconciliation matrix (§5) over both proposals, publishes the
  agreed game (UUID + genesis/log) + seat map; the other **validates & adopts** (or rejects if it
  can't). This kills the initial double-white race.

Messages reuse the tagged-union game-message + ask/accept handshake shape already in `net/sync`
and `net/handshake`.

## 5. Reconciliation matrix

Treat **`defer` = "I'll take yours"**; **`new`/`resume`/`current`/`random` = a concrete
proposal**.

| Concrete proposals | Result |
|---|---|
| 0 (both defer) | **new game** |
| 1 | play it; the deferrer adopts it |
| 2 — same UUID + matching `headHash` | **resume together** |
| 2 — same UUID + divergent `headHash` | **reject** → future merge/diff/rewind (#38) |
| 2 — different UUIDs | **reject** ("you proposed different games") → #38 |

Two `new`/`random` proposals are concrete-but-empty; pick the initiator's deterministically and
both adopt its UUID (empty games are interchangeable, so this never blocks).

## 6. Scenario walkthrough

Using A (first), B (second):

1. **A, B, C join** → C owns no seat, both owned → reject (or spectate if #36 config).
2. **A,B; B drops; B rejoins** → B owns black + `headHash` matches → resume black.
3. **A,B; A drops; A rejoins** → A owns white + matches → resume white.
4. **A,B; both drop; B rejoins then A rejoins** → seat ownership is in each peer's persisted
   game, so B re-seeds as black into an empty room; A rejoins as white, validates, resumes.
5. **A,B; A drops; C joins** → C presents no matching seat/history for A's white (which is
   **reserved**) → reject. If C *claims* a resume but `headHash` mismatches → reject (future #38
   offers diff / rewind-to-last-shared-move for the "A glitched, missing one move" case).

Additional decided cases:
- **Cold return** (both come back with G1) → resume G1 (proposals match).
- **Code reuse for a new game** → one peer proposes `new`; if the other proposes stale G1 →
  reconciliation flags different/ divergent → reject/ask (→ #38).
- **True simultaneous first-join** → initiator election (arrival, then playerId).

## 7. Error handling / reject UX

- Every reject carries a **machine reason** (`room-full`, `seat-reserved`, `game-mismatch`,
  `game-divergent`) and a human message surfaced in the net panel — never a silent failure or a
  misleading log (per `agent-principles.md` logging discipline).
- `game-divergent` / `game-mismatch` are the seams #38 later turns into a resolution flow.
- Reconnect must not regress: a returning owner with a matching `headHash` always reclaims.

## 8. Data-model / code changes (implementation seams)

- **Game UUID** in the event-log genesis + `GameExport`/serialize + archive `GameMeta`.
- **Seat map** becomes part of the *game* (persisted), not derived per-session; `SeatMap`
  already `{ white, black }` — populate with real playerIds, drop the `'host'` sentinel.
- **`NetSession.host()/join()`** collapse into a single **`enter(code, proposal)`**; role-based
  `preferredColor` seeding is deleted.
- **Proposal + admission messages** added to the `net/sync` tagged union; validation logic in a
  new pure module (e.g. `net/admission.ts`) so it is unit + mutation testable.
- **netPanel** UI: unified join + seed selector (New/Resume/Current/Dealer's/Random).

## 9. Testing strategy

- **Pure logic** (unit + fast-check + Stryker ≥95): reconciliation matrix, initiator election,
  seat reclaim/reserve, admission validation (`admission.ts`, `seats.ts`). Property tests: any
  ordering of two proposals yields a single agreed game + distinct seats or a typed reject.
- **Two-context e2e** (Playwright, injected `MockTransport` via `__penteNetTransportFactory`):
  one spec per scenario 1–5, asserting on `window.__pente` seat + game UUID + `headHash` on
  *both* contexts (proof-by-state, never logs). Add a **both-Join** spec (the #31 regression) and
  a **both-drop-both-rejoin** spec (scenario 4).
- **Real-relay** integration test (self-skips if unreachable) for a happy resume.
- Prove each new gate bites (inject the old role-based seeding → both-Join spec fails).

## 10. Staging / scope

- **Closes #31 (epic core):** game UUID at genesis · identity-owned durable seats · `enter()` +
  seed selection (New/Resume/Current/Dealer's) · entry/admission protocol · reconciliation
  (reject on conflict) · two-context tests for scenarios 1–5.
- **Follow-ups (separate tickets):** #34 randomized seed · #36 spectator (config) · #37 games
  list/review-resume UI · #38 merge/diff/rewind resolution.

## 11. Glossary additions (fold into `GLOSSARY.md`)

- **Room / code** — a rendezvous channel on the relay; identifies no game; reusable.
- **Game UUID** — a game's stable identity, minted at genesis, carried in the event-log.
- **Seed proposal** — what game a peer brings when entering a room (new/resume/current/defer/random).
- **Initiator election** — deterministic pick (arrival, then playerId) of which simultaneously-
  arriving peer computes reconciliation.
- **Reserved seat** — a seat owned by an absent playerId; keeps "room full" true until the game
  ends/abandoned.
