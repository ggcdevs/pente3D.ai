# Networked Session Model — build plan (epic #35, closes #31)

- **Date:** 2026-07-23
- **Status:** Design locked with user (`planning/2026-07-23-networked-session-model-design.md`);
  ready to build via the gated Workflow. User opted into multi-agent orchestration.
- **Issues:** epic **#35**; **closes #31** (both-Join→Black). Deferred spin-offs (NOT this build):
  #34 randomized seed · #36 spectator · #37 games list/review · #38 merge/diff/rewind.
- **References:** `planning/agent-principles.md`, the design doc above,
  `planning/2026-07-18-networking-poc-design.md`, `GLOSSARY.md`, `docs/diagrams/`.

## Execution
> **For the workflow:** sequential TDD, one subagent per task, **HALT on a `null` task**. Each
> task is pure-logic-first. `src/core` stays pure. Commit per task; **do NOT push**. Every commit
> references **#35** (and `#31` on the task that lands the fix). Then run
> `.claude/workflows/pente-review-gate.mjs` with the scope/mutateScope in §Review-gate.

## Net-layer map (current, from investigation)

- **Seats derived locally by role** (`src/net/session.ts` `start()`, ~:246): `host()`→white
  against empty map; `join()`→seeds `{white:'host', black:null}` (static `HOST_PLACEHOLDER`
  sentinel) then claims black. Two Joiners → both black. `claimSeat` (`src/net/seats.ts`) is
  sound (first-available, identity-reclaim, room-full) but runs on a **never-negotiated** map.
- **Message layer already a tagged union** (`src/net/sync.ts`, `kind: 'sync'|'proposal'|'response'`
  from the N.1 handshake) — extend it, no transport change.
- **`PresenceTracker`** (`src/net/presence.ts`) gives **live** peers (fresh announce, not retained).
- **Transport** injected via `window.__penteNetTransportFactory` (`MockTransport` + `MockRelayHub`).
- **Game id** exists only as a **local archive key** (`GameRecord.id`, `persist/db.ts`) — NOT in
  the event-log/hash-chain. Must be promoted to a genesis-minted **shared** UUID.
- Reconnect reclaims via stable `playerId` + `lastColor` (`session.ts` `reconnect()`); must keep working.

## Guardrails (landmines)

- **UUID in the hash-chain:** mint at genesis and include in the hashed genesis entry, so two
  peers referencing "the same game" is verifiable and "same-UUID/divergent-headHash" is detectable.
- **Drop the `'host'` sentinel entirely** — every seat owner is a real `playerId` or `null`.
- **Reserve vacated seats:** "room full" = both seats *owned*, even if an owner is absent. A
  non-owner entering a full room is rejected (spectate is #36, out of scope).
- **First-available + tiebreak fire ONLY at genuine game creation.** Everywhere else = reclaim.
- **Decentralized (Model A):** no retained seat-map on the relay; empty room → first returning
  owner re-seeds from its own persisted game; simultaneous arrival → **initiator election**
  (earlier live-presence arrival, then lower `playerId`).
- **Non-retained + id-deduped** admission messages (reconnect must not replay a stale proposal).
- **Reject honestly** with typed reasons (`room-full`/`seat-reserved`/`game-mismatch`/
  `game-divergent`) surfaced in the net panel — no masked/mislabeled errors (agent-principles).
- Pure logic in dedicated modules (`seats.ts`, new `admission.ts`, sync parse); `session.ts`
  wiring is glue (Playwright/mock-unit verified, never mutation-tested).

## Build steps

Test tier: *pure* = Vitest unit + fast-check + Stryker mutation (100% coverage pin); *glue* =
Playwright on the real app (`window.__pente` state + two-context relay round-trips), never logs.

| # | Step | Key files | Tier |
|---|---|---|---|
| S.1 | **Shared game UUID at genesis.** Mint a UUID at game creation, carry it in the **event-log genesis** (hashed); thread through `serialize`/`GameExport` and archive `GameMeta`; lazily assign to legacy/local games on load. Reuse `randomId.ts` (insecure-context-safe). | `src/core/game.ts`, `src/core/eventLog.ts`, `src/core/serialize.ts`, `src/persist/archive.ts`, `src/persist/db.ts`, `src/util/randomId.ts` | pure |
| S.2 | **Identity-owned durable seat map.** Seat map becomes a persisted property of the *game* (`{white,black}` = real playerIds); delete `HOST_PLACEHOLDER`. `claimSeat`: identity-reclaim, first-available **only when both null**, reserve-vacated, room-full = both owned. | `src/net/seats.ts`, `src/core/game.ts` (or game-meta seat field), `src/persist/*` | pure |
| S.3 | **Admission + reconciliation (`net/admission.ts`, new pure module).** Reconciliation matrix (0/1/2 proposals; `defer`; same-UUID match/divergent; different UUID) + **initiator election** (arrival, then playerId) + typed reject reasons. | create `src/net/admission.ts` | pure |
| S.4 | **Proposal/admission messages.** Extend the `sync.ts` tagged union with `hello`/`proposal`/`admit`/`reject` (+ parse + id-dedup). No transport change. | `src/net/sync.ts` | pure |
| S.5 | **`NetSession.enter(code, proposal)`.** Replace `host()`/`join()`/role-seeding with one `enter()` driving the protocol: presence **settle window** → resident-admit vs empty-establish vs simultaneous-election (via `admission.ts`), reclaim-by-identity, reserve seats. Keep `reconnect()` working. | `src/net/session.ts`, `src/net/appSession.ts` | glue (+ mock-unit) |
| S.6 | **Unified entry UI + readouts.** netPanel: one "join code" + seed selector (**New / Resume / Current local / Dealer's choice**; Random deferred to #34). Pure `netPanelModel`; DOM glue. Expose game UUID, seat owners, last admission reason on `window.__pente`. Fold new terms into `GLOSSARY.md`. | `src/ui/widgets/netPanel.ts`, `src/ui/widgets/netPanelModel.ts`, `src/debug/window.ts`, `GLOSSARY.md` | model pure + glue |
| S.7 | **Two-context e2e — the scenarios.** One spec per scenario 1–5 + the **both-Join** regression (#31) + **both-drop→both-rejoin** (scenario 4), asserting on **both** contexts' seat + game UUID + `headHash` (proof-by-state). Prove the gate bites (restore role-seeding → both-Join fails). | `e2e/sessionModel.spec.ts` (+ existing `networked`/`net` specs), `src/debug/window.ts` | glue |

## Sequencing

S.1 → S.2 → S.3 → S.4 → **S.5** (consumes S.2–S.4) → S.6 → S.7. Null-halt between tasks. S.7 is
the cross-component integration proof (component gates missed the scene↔SyncEngine wiring before —
this build must not repeat that).

## Review-gate (`pente-review-gate.mjs` args)

- `stage`: `"session-model"`
- `scope` (reviewers + coverage): `"src/core src/net src/ui/widgets src/persist src/debug"`
- `mutateScope` (**pure only**): `"src/net/seats.ts src/net/admission.ts src/net/sync.ts src/core/eventLog.ts src/core/serialize.ts src/core/game.ts src/ui/widgets/netPanelModel.ts"`
  — glue (`session.ts`, `appSession.ts`, `netPanel.ts`, e2e) is Playwright-verified, never mutation-tested.

## Collaboration points (hands-on, tweak live)

- Seed-selector UX (New/Resume/Current/Dealer's) copy + layout in the net panel.
- Reject-reason wording surfaced to the user.
- Whether "Current local board" should warn before overwriting an in-progress local game.

## Verification (per gate)

Build (tsc+vite) 0 · lint 0 · coverage 100% on pure files · mutation ≥ threshold on the pure
seat/admission/reconciliation/parse logic · Playwright green incl. the two-context scenario proofs ·
every gate proven to **bite** · independently re-run; flaky metrics ≥2×. Push **only** on reviewer approval.
