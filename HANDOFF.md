# Pente3D — Supervisor Handoff

You are picking up as the **supervising Claude**. Your job is orchestration: design with the user,
delegate, gate rigorously, and **independently verify** — never trust an agent's "it passed."

Read `planning/agent-principles.md` first (the constitution) and `CONTRIBUTING.md` (branches,
commits, tickets, versions, deploys). This doc is state, delegation guidance, and hard-won lessons.

---

## 1. Where it stands

A **3D Pente** game (N×N×N lattice): pure deterministic rules core, IndexedDB archive, real
networked play over an MQTT relay, instanced Three.js rendering, composable config-driven UI.

| Where | State |
|---|---|
| `main` | `80e9ead` = `v3.0.0`. The last release. **148 commits behind `dev`.** |
| `test` | `5c73104` — still v3. Untouched by the remodel. |
| `dev` | `0f3b714` — **the v4.0 line.** Feature-complete, playable, hands-on verified. |
| tags | `v1.0.0` `v2.0.0` `v3.0.0`. **No v4 tag yet** — that is the promotion's first act. |

Live at `ggcdevs.github.io/pente3D.ai/` — root is `main`, plus `/dev/`, `/test/`, and **every branch
at `/<branch>/`**. Confirm what is deployed with `curl -s .../dev/version.json`.

⚠️ **A pre-push hook refuses `dev`/`test`/`main`.** Override deliberately, per push:
`PENTE_ALLOW_PROTECTED_PUSH=1 git push origin HEAD`. Do not remove it; retiring it is part of the
promotion.

**The v3 → v4 story in one paragraph.** v3 was feature-complete but hands-on cross-device play found
#45 (reconnect never resyncs → stuck turn → Undo diverges → *game bricked*) and #46 (New Game pushes
a stale code-saved game to the peer). Root-causing both showed one cause: #35's `net-room:{code}` — a
game persisted per room **code** — re-coupled code↔game *and* became a stale local substitute for
real state sync. The remodel deletes it. All of that is built, gated, and **confirmed by playing on
two devices** (see `planning/2026-07-27-v3.1-validation-playthrough.md`).

## 2. The v4 model (read the design doc before touching net code)

**Design of record:** `planning/2026-07-24-net-model-v3.1-design.md` (carries the user's verbatim
rationale). **Build record:** `planning/2026-07-25-net-model-v3.1-build-plan.md`. **Vocabulary:**
`GLOSSARY.md`. Epic **#47**, milestone `v4.0`. *(The filenames still say v3.1 — they are dated
records of what happened, not descriptions of what is. See §3.)*

Four sentences, all built and behaviour-verified:

- **A room code is pure rendezvous; a game is a UUID; there is NO mapping between them anywhere.**
  `net-room:{code}` is deleted (v3 shards purged on boot). localStorage keeps only visited codes and
  an `activeNetworkedGame` **breadcrumb** driving a **prompt, never an auto-load**. Games live in the
  archive **keyed by UUID**, one record per game, one writer. A reload lands on an **empty slate**,
  so the **games list is the only route back to a game** — it is navigation now, not a convenience.
- **Seed selection is enforced on the wire**, at **all three** channels a game can cross. `New` sends
  and accepts only empty state; **Dealer's-choice is the only kind that adopts a peer's non-empty
  game**; a mismatch is a typed reject surfaced verbatim.
- **On (re)connect, converge via resident-peer republish** — deliberately *not* retained MQTT, which
  would re-couple code↔game at the broker and kill code reuse. It fires on **any fresh live
  presence** (a blip the broker never turns into an absence produces no edge) and in both directions.
- **The turn gate caps legitimate drift at exactly one move**, so the only automatic path is a
  one-move fast-forward; anything else gets last-common-ancestor + diff + a **resolution handshake**
  offering `take-mine` / `take-theirs` / `rewind`, replay-validated through the rules engine.

Integrity: a dumb relay cannot referee (one shared credential, client-written retained messages).
The defence is the hash chain + **replaying an adopted log through the pure rules engine**. An
authoritative server is #50 — captured, parked, v4-scale.

**Acceptance tests:** `npm run scenario:all` — 8 scenarios driving two real CLI peers over the live
broker. **Exit 0 = converged; 2 = SKIPPED for want of a relay (not a pass); 1 = the bug is back.**
These run from a bare checkout: `NODE_RELAY_FALLBACK` in `src/config/relayEnv.ts` names the live
broker, so no setup is needed.

## 3. Two conventions changed on 2026-07-27 — know these before you touch a ticket

**The major version IS the wire-protocol version.** It bumps iff the protocol breaks, so
compatibility is one integer comparison: *if the majors differ, no game*. "Major = generation" is
retired — a rewrite that leaves the wire alone stays `v4.x`. Reserve `feat!` / `BREAKING CHANGE` for
**wire** breaks. This is why the remodel ships as **v4.0.0, not v3.1**.

**Issues close when work lands on `dev`**, not at `main`. The backlog's job is to describe what is
still true of the codebase. `on-dev` is vestigial (kept, not deleted — deleting a label strips it
from closed issues too, losing the record).

**A milestone is a RELEASE.** The bump is computed **once per push to `main`** over the whole range,
taking the higher signal — six tickets is *one* minor bump. So the version tracks how often you
promote. Agreed cadence: batch 3–6, give anything large its own release.

## 4. What to do next

The backlog is 24 open, every one triaged, labelled and milestoned — the record is
`planning/2026-07-27-ticket-triage-and-workflow.md`. **`parked` = a recorded idea, do not schedule
it. `tracker` (#32) never closes.**

### v4.0 — before the promotion

| # | What | Notes |
|---|---|---|
| **#56** | Board size is not part of game identity | **Has a live design decision, and it is time-boxed** — see below |
| **#51** | Version on the wire + display + refuse on major mismatch | **Must** ship in v4.0.0 or the scheme stays inert until v6 |
| **#55** | Release automation | Built. Held open by `verify-in-ci` until a real release proves it |
| **#47** | The epic | Closes at promotion |

**#56 is the one to raise first.** Two peers with different board sizes silently play different
games: an adopted log is replayed into `Game.fromLog(this.deps.size, …)` — the *local* size — and
size travels nowhere (not in `SyncMessage`, not in the hash chain, which is
`H(prevHash + serializeEvent(event))` seeded by the uuid). Bigger local board ⇒ the replay succeeds,
hashes match, and both play on with identical head hashes and different geometry. Reachable today
from the settings dropdown. The choice: a checked field on the wire (cheap, honest reject) **or**
folding size into the hashed genesis (impossible by construction). **The second is itself a wire
break — free while v4.0.0 is uncut, costs a v5 after.** That is the last free wire decision.

### Then the promotion

1. `git tag -a v4.0.0 -m '...'` on the promotion commit and push the tag — **before** pushing the
   branch, or the bump is computed from `v3.0.0` and cuts `v3.1.0` instead.
2. Push `test`, then `main` (with `PENTE_ALLOW_PROTECTED_PUSH=1`). CI cuts the Release from the tag.
3. Regenerate diagrams first — `diagrams-check` runs on `test`/`main` **only**.
4. Retire the pre-push guard.

### After that

**v4.1** (#33 slider, #53 code length, #10 mobile diagonals, #26 emitter DRY) · **v4.2** (#48 CLI
port, alone) · then the unscheduled nine.

## 5. Delegating the work — the user's explicit ask

Decide per ticket. The heuristic: **self only for ≤3–4 line edits; a single subagent for a localized
ticket; a full workflow for anything multi-module or spanning several tickets.** Preserve your own
context — that is the point of delegating.

| Ticket | Shape | Why |
|---|---|---|
| **#53**, **#26** | **Self or one subagent** | ~2–20 lines each. Note the v3.1 build plan claims #53's permissive behaviour is "pinned by a characterization test" — **it is not**; verified 2026-07-28, no such test exists in `netModel.test.ts` or `activeGame.test.ts`. So the bound needs *new* tests, not inverted ones |
| **#10**, **#33** | **One subagent each** | Localized. #33 has a decided spec (scrub the session game locally; stay put on an incoming move, offer "back to live"); its constraint is **zero publishes**, locked by `e2e/historyLocalLock.spec.ts` |
| **#51** | **Small workflow, or two sequenced subagents** | Two seams — a UI display and a wire field in the hello — plus a policy (absent version counts as incompatible) |
| **#56** | **Workflow** *(after the user decides the approach)* | If structural it touches genesis, hashing, sync, admission and archive migration at once |
| **#48** | **Workflow** | A ~1900-line port **plus** bringing it under the 100% coverage + mutation ≥95 that `c543f71` widened onto `cli/`. Its `analyze.selfcheck.ts` is standalone `tsx` and counts for nothing under those gates |

**The apparatus:**

- **Build workflows** (`.claude/workflows/pente-*.mjs`): sequential TDD, one subagent per task,
  **HALT on a `null` task**. They commit per task and never push.
- **Review gate** (`pente-review-gate.mjs`, args `{repoPath, stage, scope, mutateScope, marker}`):
  harden → 2 adversarial reviewers (they **view screenshots**; you do not — too expensive) → fix loop
  → gate (lint + coverage 100% + mutation ≥95) → **pushes only if reviewers approved**. Invoke it by
  **`scriptPath`, never by name** — the name resolves from the session cwd and the copy there
  hardcodes its own repo path.
- **The `cli/` client is the testing lever** — a scriptable Node net client that drives deterministic
  cross-"device" scenarios the browser cannot. It is also **yours to change freely**; one rule: work
  in a worktree.
- **Never call `Workflow` unless the user has opted into multi-agent orchestration.**

## 6. Gotchas — do not re-learn these

**Trust & verification**
- **Independently verify every agent claim.** Gates have caught a *fake* mutation gate, a flaky one,
  and a per-move archive bug — several reported as "passed". Re-run the metric yourself.
- **A subagent can fire a premature "done".** Confirm `git log` / `git status` before believing it.
- **A test that self-skips is not a test.** Every live-relay Playwright spec resolved its broker from
  the committed-blank `relay.json` and skipped in *every* checkout for weeks — the #31 and #40 proofs
  were claimed, never observed, until `2da3f42`. Brokers now resolve only through `e2e/relayFixture.ts`
  (guarded by `tools/e2eRelayFixture.test.mjs`). **Count the skips; do not read the exit code.**
- **Read a mutation report's actual span before believing it.** A survivor I assumed was prose turned
  out to be the `', '` separator inside a `.join()`. Check `location.start.column`, do not infer from
  the line.

**Environment**
- **`git fetch` before building on `dev`.** It can be behind origin; three commits were rebased this
  session because it was.
- **NEVER hardcode a branch name in an agent prompt.** Agents `git checkout` it and switch the shared
  working tree. Say *"work in-place on the current branch; never checkout/switch."*
- **Use worktrees** for parallel work — the user often has a dev server on the main tree.
- **`gh issue list --milestone X` returned a stale listing** this session. Verify with
  `--json milestone` and `jq`.
- `.mjs` files come in two unrelated families: `tools/*.mjs` is ordinary Node build tooling;
  `.claude/workflows/*.mjs` is agent orchestration. The user has been confused by this once already.
- `gh` auth can expire mid-session — git-over-SSH keeps working while the API 401s. Ask the user to
  re-auth; you cannot do it for them.

**CI / build**
- **`diagrams-check` runs only on `test`/`main`.** Regenerate before pushing there.
- **`actions/checkout@v4` defaults to depth 1 with NO tags** — `git describe` then yields
  `0.0.0-unknown`. `fetch-depth: 0` is required wherever the version matters.
- **Two-context networked e2e are flaky under parallel workers.** Re-run with `--workers=1` before
  concluding a failure is real.
- **Do not edit `src/**` while `npm run e2e` runs.** Playwright drives the Vite dev server; a save
  sends an HMR full-reload that wipes `window.__pente` mid-test, and the failure looks like anything
  but its cause. It cost two separate investigations.
- **Secure-context APIs** (`crypto.randomUUID`) are `undefined` over plain LAN http — use
  `src/util/randomId.ts`. Playwright runs on localhost, so it will not catch these.
- The git wrapper GPG-signs and re-authors commits to "Claude Code" (expected). Its
  trailing-whitespace hook rejects minified bundles — never commit build output.

**Design**
- **Integration gaps slip past component gates.** The scene↔SyncEngine wiring was never tasked and
  silently did not sync; #35 passed every mechanical gate (98% mutation!) while not wiring the durable
  seat map. Add cross-component tests for anything spanning stages.
- **The live broker ECHOES your own publishes back to you.** No mock showed this — `MockRelayHub`
  deliberately does not echo, so the unit suite was green while the real relay ping-ponged.
- **A latch cannot retry.** Twice a "send it once" optimisation meant one dropped QoS-0 packet
  bricked the pair forever. The shape that works is a **tag on the message** — answer everything,
  never answer a tagged answer — so the peer's next announce is the retry.
- **The user's hands-on findings are first-class signal.** #40, #45 and #46 all came from real play,
  not tests. When they report a quirk, look for the *shared root* before patching.

## 7. Working with this user

Sharp collaborator who finds real bugs by playing, and who thinks structurally — several times they
proposed a *simpler* model than the one on the table (deleting the code↔game pointer entirely;
keeping auto-fast-forward narrow; making the major the wire version) and were right. **Push back once
with reasoning if you disagree; if they reaffirm, it is their call — proceed and say so.**

They want rationale captured verbatim, prefer structural fixes to rule-patching, and dislike time
estimates (use token/complexity instead). They will ask *why* something is the way it is — answer with
the mechanism, not a summary. When a premise behind their decision turns out to be wrong, say so
plainly and let them re-decide; that happened twice this session and both answers changed.

---

*The apparatus works — trust it, but verify it. Have fun.*
