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

**v3 is feature-complete and frozen. v3.1 — a networked-game-model remodel — is designed and is the
thing that will ship to `main`.**

| Where | State |
|---|---|
| `main` | `v3.0.0` (`80e9ead`) — the last release. **Frozen**; v3 never ships standalone. |
| `dev` / `test` | v3 complete (`5c73104` + CLI work). Playable, but carries the bugs v3.1 fixes. |
| `feat/net-model-v3.1` | The remodel. Design committed; **implementation not started**. |
| `feat/cli-analyzer` | CLI tactical analyzer (#48), 10 commits ahead of `dev`, unmerged. |

Live: root = `main`, plus `/dev/`, `/test/`, and **every branch at `/<branch>/`**.

**Why v3 is frozen:** hands-on cross-device play found #45 (reconnect never resyncs → stuck turn →
Undo diverges → *game bricked*) and #46 (New Game pushes a stale code-saved game to the peer).
Shipping v3 would hand friends the exact bugs the remodel removes.

## 2. The v3.1 model (read the design doc before touching net code)

**Plan of record: `planning/2026-07-24-net-model-v3.1-design.md`.** Epic **#47**, milestone `v3.1`.

One root caused the whole v3 bug cluster: #35's `net-room:{code}` (a game + seatmap persisted per
room **code**) both re-coupled code↔game *and* became a stale local substitute for real state-sync.

The remodel, in four sentences:
- **A room code is pure rendezvous; a game is a UUID; there is NO mapping between them anywhere.**
  localStorage keeps only visited codes + a session breadcrumb; games live in the archive by UUID.
- **Seed selection is explicit and enforced on the wire** — `New` sends/accepts only empty state;
  **Dealer's-choice is the only kind that adopts a peer's non-empty game**.
- **On (re)connect, converge to the LIVE state via resident-peer republish** (deliberately *not*
  retained MQTT — that would re-couple code↔game at the broker and kill code reuse).
- **The turn gate caps legitimate drift at exactly one move**, so the *only* automatic path is a
  one-move fast-forward; anything else gets last-common-ancestor + diff + a resolution handshake.

Integrity: a dumb relay cannot referee (one shared credential; retained messages are client-written).
Defense is the hash chain + **validating an adopted log by replaying it through the rules engine**.
An authoritative server is captured as #50 — v4-scale, not planned.

**Next step:** write the implementation plan, and **build the CLI-driven #45 repro first** so the
bug that started this has a failing test before the model changes.

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
  CI**, so exercise them on a real deploy.

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
