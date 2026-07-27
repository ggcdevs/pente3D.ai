# Pente3D — Supervisor Handoff

You are picking up as the **supervising Claude**. Your role is orchestration: design with the user,
break work into tickets, **delegate to subagents** (single agents for localized work, **Workflows**
for multi-task stages), **gate rigorously**, and **independently verify** — never trust an agent's
"it passed." Read `planning/agent-principles.md` first (the constitution) and `CONTRIBUTING.md`
(branches, commits, tickets, versioning, deploy conventions). This doc is state + hard-won lessons.

---

## 1. What this is / where it stands

A **3D Pente** game (N×N×N lattice): pure deterministic rules core, IndexedDB archive, real
networked play over an MQTT relay, instanced Three.js rendering, composable config-driven UI.

**v3 is feature-complete and frozen. v3.1 — the networked-game-model remodel — is BUILT on
`feat/net-model-v3.1` (V.0–V.7 landed, each through its review gate; V.8a is the close-out) and
is the thing that will ship to `main`. It has NOT been promoted: the closing behavioural re-review
and every promotion step are the user's calls (V.8b).**

| Where | State |
|---|---|
| `main` | `v3.0.0` (`80e9ead`) — the last release. **Frozen**; v3 never ships standalone. |
| `dev` / `test` | v3 complete (`5c73104` + CLI work). Playable, but carries the bugs v3.1 fixes. |
| `feat/net-model-v3.1` | **The remodel, built.** V.0–V.7 landed with their review gates (last of those: `dfff4ad`). **V.8a is not docs-only** — after the record (`5b96a1c`) it widened both quality gates onto `cli/` (`c543f71`, which also edited `cli/views.ts`) and then took its own review-gate round (`--view` / verb-arity refusals). The build plan's *What landed* table is the full commit list; `git log -1` is the current head. Not merged anywhere. |
| `feat/cli-analyzer` | CLI tactical analyzer (#48), 10 commits ahead of `dev`, unmerged. |

Live: root = `main`, plus `/dev/`, `/test/`, and **every branch at `/<branch>/`** — so the remodel is
playable at `/feat/net-model-v3.1/`, which is where hands-on cross-device play should happen next.

⚠️ **A pre-push hook (`59ea06d`) refuses `dev`/`test`/`main` by design** while v3.1 is in flight.
Never bypass it; removing it is part of the promotion, not a workaround.

**Why v3 is frozen:** hands-on cross-device play found #45 (reconnect never resyncs → stuck turn →
Undo diverges → *game bricked*) and #46 (New Game pushes a stale code-saved game to the peer).
Shipping v3 would hand friends the exact bugs the remodel removes.

**What remains before promotion is listed in ONE place** — the build plan's
`## V.8b — what remains before promotion`. Short version: the §10 behavioural re-review (#40, #31,
#41, #33, #34, #36), #49, the copy collaboration points, the knowingly-shipped limitations, hands-on
play, then `dev` → `test` → `main`. **#33, #34 and #36 are NOT built** — a clean seam, not a stub.

## 2. The v3.1 model (read the design doc before touching net code)

**Design of record: `planning/2026-07-24-net-model-v3.1-design.md`** (it carries the user's verbatim
rationale). **Build plan / build record: `planning/2026-07-25-net-model-v3.1-build-plan.md`.**
**Vocabulary: `GLOSSARY.md`.** Epic **#47**, milestone `v3.1`.

One root caused the whole v3 bug cluster: #35's `net-room:{code}` (a game + seatmap persisted per
room **code**) both re-coupled code↔game *and* became a stale local substitute for real state-sync.

The remodel, in four sentences — **all four are built and behaviour-verified**:
- **A room code is pure rendezvous; a game is a UUID; there is NO mapping between them anywhere.**
  `net-room:{code}` is deleted (v3 shards purged on boot). localStorage keeps only visited codes +
  an `activeNetworkedGame` **breadcrumb** — session state driving a **prompt, never an auto-load**,
  never published. Games live in the archive **keyed by UUID**, one record per game, one writer. A
  reload always lands on an **empty slate**, so the **games list** is the only route back to a game.
- **Seed selection is explicit and enforced on the wire**, at **all three** channels a game can
  cross — `New` sends/accepts only empty state; **Dealer's-choice is the only kind that adopts a
  peer's non-empty game**; a mismatch is a typed reject surfaced verbatim.
- **On (re)connect, converge to the LIVE state via resident-peer republish** (deliberately *not*
  retained MQTT — that would re-couple code↔game at the broker and kill code reuse). It fires on
  **any** fresh live presence (a graceful disconnect leaves no absence to observe) and in **both**
  directions.
- **The turn gate caps legitimate drift at exactly one move**, so the *only* automatic path is a
  one-move fast-forward; anything else gets last-common-ancestor + diff + a **resolution handshake**
  (a divergence panel both players see; the wire names a **head hash**, never "mine"/"theirs").

Integrity: a dumb relay cannot referee (one shared credential; retained messages are client-written).
Defense is the hash chain + **validating an adopted log by replaying it through the rules engine**.
An authoritative server is captured as #50 — v4-scale, not planned.

**The acceptance test:** `npm run scenario:issue45` drives two real CLI peers over the live relay.
**Exit 0 = converged; exit 2 = SKIPPED for want of a relay (not a pass, not a regression); exit 1 =
the bug is back.** `npm run scenario:all` runs the whole matrix. `npm run typecheck:cli` gates
`cli/` — `npm run build` typechecks `src/` only.

**Three v3.1 lessons worth carrying** (the fuller list is in the build plan's "Where the build
differed from the plan"):
- **A test that self-skips is not a test.** Every live-relay Playwright spec resolved its broker from
  the committed-blank `relay.json` and so skipped in *every* checkout — the browser-side proofs of
  #31 and #40 were claimed, never observed. `e2e/relayFixture.ts` is now the only way to resolve one,
  guarded by `tools/e2eRelayFixture.test.mjs`. Lighting that tier found three real defects at once.
- **A latch cannot retry.** Twice (the presence ack, then the divergence answer) a "send it once"
  optimisation meant one dropped QoS-0 packet bricked the pair forever. The shape that works is a
  **tag on the message** — answer everything, never answer a tagged answer — so the peer's own next
  announce is the retry.
- **The live broker ECHOES your own publishes back to you.** No mock showed this; `MockRelayHub`
  deliberately does not echo, so the unit suite was green while the real relay ping-ponged.

**Next step:** hands-on cross-device play at `/feat/net-model-v3.1/`, then the §10 behavioural
re-review — see §1 and the build plan's V.8b list.

## 3. The apparatus

- **Build workflows** (`.claude/workflows/pente-*.mjs`): sequential TDD, one subagent per task,
  **HALT on a `null` task**. Commits per task; never pushes.
- **Review gate** (`pente-review-gate.mjs`, args `{stage, scope, mutateScope}`): harden → 2 adversarial
  reviewers (they **view screenshots**; you do not — too expensive in context) → fix loop → gate
  (lint + coverage 100% + mutation ≥95) → **pushes only if reviewers approved**.
  `scope` = what reviewers read; `mutateScope` = **pure files only**.
- **The `cli/` client is the testing lever** — a scriptable Node net client (play daemon, wait/move
  verbs, board slicing, tactical analyzer). It drives deterministic cross-"device" scenarios the
  browser can't: the #45 repro, rematch+reconnect, code reuse. Use it. It is also *yours to change
  freely* — one rule: work in a worktree.
- **Never call `Workflow` unless the user has opted into multi-agent orchestration.**

## 4. Gotchas — learned the hard way, do not re-learn

**Trust & verification**
- **Independently verify every agent claim.** Gates have caught a *fake* mutation gate, a flaky one,
  a per-move archive bug — several reported as "passed". Re-run the metric yourself; re-run flaky
  ones ≥2×.
- **A subagent can fire a premature "done" notification.** One reported completion mid-edit; the
  half-written tree produced phantom test failures. **Always confirm `git log`/`git status` before
  trusting a completion**, and re-run gates on the committed SHA.
- **The review gate's fix-loop cap counts REVIEW rounds** — it can exhaust the budget and escalate
  with its *own* final-round fixes never reviewed. Verify those separately (or raise the cap).
- **A gate agent once invented a precondition** ("no review-log entry exists") and withheld an
  already-approved push. The contract is `passed AND approved` — nothing else.

**Environment**
- **NEVER hardcode a branch name in an agent prompt.** Agents `git checkout` it and switch the shared
  working tree. Say *"work in-place on the current branch; never checkout/switch."*
- **Use worktrees** for parallel work — the user often has a dev server running on the main tree.
- **Don't do git ops while a workflow/subagent is committing** to the same branch.
- Subagents can leave orphaned `while … sleep` polling shells. Don't write polling into agent tasks.
- `gh` auth can expire mid-session — git-over-SSH keeps working while the API 401s. Ask the user to
  re-auth (`gh auth login`); you cannot do it for them.

**CI / build**
- **`diagrams-check` runs only on `test`/`main`.** Regenerate diagrams before pushing there or CI
  goes red (this happened after a `netModel` trim).
- **`actions/checkout@v4` defaults to depth 1 with NO tags** — `git describe` then yields
  `0.0.0-unknown`. `fetch-depth: 0` is required wherever the version matters.
- **Two-context networked e2e are flaky under parallel workers.** Re-run with `--workers=1` before
  concluding a failure is real; several "failures" were load, not logic.
- The git wrapper GPG-signs and re-authors commits to "Claude Code" (expected). Its trailing-
  whitespace hook rejects minified bundles — never commit build output.
- **Secure-context APIs** (`crypto.randomUUID`) are `undefined` over plain LAN http — use
  `src/util/randomId.ts`. Playwright runs on localhost (always secure) so it won't catch these.
- Relay creds live in the `RELAY_CONFIG` repo variable, injected at build; the tracked
  `relay.json` ships blank. Real-relay tests self-skip without egress — **they were never green in
  CI**, so exercise them on a real deploy. **A self-skipping test is indistinguishable from a passing
  one in a summary line**: every live-relay Playwright spec skipped in *every* checkout for weeks
  because it read the blank `relay.json` directly. Brokers are now resolved only through
  `e2e/relayFixture.ts` (guarded by `tools/e2eRelayFixture.test.mjs`); count the skips, don't read
  the exit code.

**Design**
- **Integration gaps slip past component gates.** The scene↔SyncEngine wiring was never tasked and
  silently didn't sync; #35 passed every mechanical gate (98% mutation!) while not actually wiring
  the durable seat map. Add cross-component tests for anything spanning stages.
- **The user's hands-on findings are first-class signal** — #40, #45 and #46 all came from real
  cross-device play, not tests. When they report a quirk, look for the *shared root* before patching.

## 5. Working with this user

Sharp collaborator who catches subtle bugs by actually playing, and who thinks structurally — several
times they proposed a *simpler* model than the one on the table (deleting the code↔game pointer
entirely; keeping the auto-fast-forward narrow) and were right. **Push back once with reasoning if
you disagree; if they reaffirm, it's their call — proceed and say so.** They prefer structural fixes
over rule-patching, want rationale captured verbatim, and dislike time estimates (use token/complexity
instead). Ticket disposition style: leave tickets where they are and re-review *behaviourally* at the
end rather than pre-sorting.

---

*The apparatus works — trust it, but verify it. Have fun.*
