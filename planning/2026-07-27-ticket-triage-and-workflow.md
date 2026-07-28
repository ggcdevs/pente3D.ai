# Ticket triage record, and the lifecycle workflow

**Date:** 2026-07-27 · **Outcome: 42 open issues → 25, every one categorised, labelled and milestoned.**

This started as a triage plan; it is now the **record of what was decided**. The reasoning for each
individual disposition lives in the ticket's own closing or triage comment — that is deliberate, so
the issue timeline stays the source of truth. This file holds the shape of it, and the decisions that
span tickets.

Companion: `planning/2026-07-27-v3.1-validation-playthrough.md` — the hands-on session that settled
the "is it actually fixed?" half. Superseded: `planning/2026-07-27-ticket-walkthrough-plan.md`.

---

## 1. What happened

**Closed: 21.**

| Closed | Why |
|---|---|
| #12 #13 #14 #15 #16 #17 #18 #20 #24 #28 #44 | Built and gated on the v4 line; closed on the evidence in the tree, confirmed in passing during the playthrough |
| #31 #37 #38 #40 #42 #43 #45 #46 | Fixed by the remodel and **confirmed by hands-on cross-device play** |
| #35 | Closed as **superseded, not delivered** — its central mechanism (`net-room:{code}`) was the cause of #45/#46 and was deleted |
| #41 | The scenario matrix it asked for is complete; verified test-by-test. Residual split to #57 |
| #30 | The filed bug (the `TEST12` rejection) is fixed. Its buried residual split to #53 |

**Filed: 5** — #53 (code length bound), #54 (background notifications), #55 (release automation),
#56 (board size not in game identity), #57 (CLI-vs-browser gaps).

**Two conventions changed**, both recorded below: issues now close when work reaches `dev`, and the
major version is now the wire-protocol version.

## 2. The decisions that span tickets

### The major version IS the wire-protocol version

Adopted 2026-07-27. The major bumps **iff the protocol breaks**, and compatibility is one integer
comparison: **if the majors differ, no game.** A separate `WIRE_VERSION` was considered and rejected
as a second number to maintain.

**The trade, accepted knowingly:** the old convention — *"major = generation, the v1/v2/v3 rewrites"*
— is retired. A future full rewrite that leaves the wire alone stays `v4.x`. In exchange the
compatibility rule stays correct forever without a second concept.

**So this release ships as `v4.0.0`, not `v3.1`.** Milestone renamed, #47 retitled. The design and
build-plan filenames keep their dates and their `v3.1` names — they are records of what happened, not
descriptions of what is.

Consequences captured in #47, #51, #55, #56:
- `feat!` / `BREAKING CHANGE` markers should now mean a **wire** break specifically.
- A v3.0 peer sends **no version field at all**, so absent must count as incompatible.
- **#51's wire half has to ship in v4.0.0.** If v4 does not *send* a version, v5 cannot detect v4
  either, and the whole scheme stays inert until v6.
- **#56 is now-or-v5.** Folding board size into the hashed genesis is itself a wire break, so it is
  free today and costs a major after.

### Issues close at `dev`, not at `main`

`CONTRIBUTING.md` says *"Issues stay open until the work reaches `main`"*, and the `on-dev` label
marked the gap. That convention is retired: a ticket closes when its work lands on `dev`, because the
goal is a backlog where **everything open is still relevant to the current codebase**. `on-dev` is now
vestigial — no open issue carries it. **`CONTRIBUTING.md` needs updating to match.**

### Labels and milestones now mean something

- **`parked`** — a recorded idea, deliberately not scheduled, excluded from milestones. #25 #27 #34
  #36 #50.
- **`tracker`** — a running checklist, never "done", never in a milestone, and deliberately with **no
  type label** so it contributes nothing to the version bump. #32 only.
- **No milestone, not parked** — real work, not yet scheduled.
- Eleven tickets had **no type label at all**, so they were invisible to the version bump, which reads
  `enhancement`/`bug` off every cited `#N`. All fixed.
- The **`v3` milestone is closed** at 0 open / 17 closed.

## 3. Order of work

### v4.0 — ships with the promotion (5)

| # | Why it is in this milestone |
|---|---|
| **#56** | Board size not in game identity — silent cross-board play. The structural fix is a **wire break: now or v5** |
| **#51** | The version field must be on the wire in v4.0 or the compatibility scheme never activates |
| **#55** | Release automation — the promotion depends on it, or a hand-tagged `v4.0.0` reaches `main` and **no Release is ever created** |
| **#52** | The promotion *runs* this workflow; 143 false mismatch warnings would bury anything genuine |
| **#47** | The epic; closes at promotion |

### v4.1 — the batch after (6)

**#33** slider (spec decided: stay put, offer "back to live") · **#53** code length bound · **#10**
mobile diagonal toggle (no way to show diagonals on a phone at all, and the phone is the main play
surface) · **#26** emitter refactor (~20 lines, precondition met) · **#48** CLI analyzer port ·
**#49** colour preference.

### Unscheduled real work (8)

**#9** arbitrary board size *(blocked on #56)* · **#19** last-piece animation *(spec decided: newest
stone only)* · **#21** PWA · **#23** relay infra-as-code *(bus-factor)* · **#29** backgrounds *(fog
first — it is a depth cue, not decoration)* · **#39** AI opponent *(future epic)* · **#54** background
notifications *(needs #21)* · **#57** CLI-vs-browser gaps.

### Parked (5) · Tracker (1)

#25 #27 #34 #36 #50 · #32.

## 4. Still to build: the ticket lifecycle workflow

Unchanged from the original proposal and **not yet implemented**. What already works and should not be
rebuilt: `tools/versionBump.mjs` already parses `#N` from commits and reads ticket labels (pure,
mutation-gated — reuse that parser); commits cross-reference into issue timelines automatically;
`deploy.yml` maps branch → environment; `release-tag.yml` maps branch → version.

**Missing:** nothing marks a ticket *in progress*; there is no *in review* state for `test`; and
nothing links a ticket to the **version it shipped in**.

**Proposal:** a `ticket-status.yml` on `push: ['**']` deriving status from *which branch contains the
commit* — `status:in-progress` (feature branch) → `status:on-dev` → `status:in-review` (test) →
closed (main). Advance-only, so a later feature-branch push cannot demote. Comment only on an actual
transition. Close explicitly via `gh issue close` rather than relying on `Fixes #N`, which GitHub
honours only from the default branch. Degrade gracefully when `gh` is unreachable, as the bump tooling
already does.

**Ticket → version** then falls out of extending `release-tag.yml`, which already computes the tag and
the range: comment *"Shipped in v4.0.0"* on every ticket in it. That is the link nothing produces today.

*(Note: the promotion ritual that `tools/promote.sh` was proposed for mostly evaporates once #55
lands — promotion becomes tag, push `test`, push `main`.)*

*(Nit: `deploy.yml:12` says subpath cleanup lives in a separate `cleanup-branch-pages.yml`. That file
does not exist — the prune is at `deploy.yml:110`, in the same file.)*

## 5. Docs that still need updating

- **`CONTRIBUTING.md`** — the versioning table (major = wire), the close-at-`dev` convention, `feat!`
  reserved for wire breaks, and the new label meanings.
- **`HANDOFF.md`** — §1 still says `dev` is v3 and the branch table predates the fast-forward; the
  whole thing wants rewriting at promotion anyway.
- Header notes on the two `net-model-v3.1-*` planning docs pointing at the v4 rename.
