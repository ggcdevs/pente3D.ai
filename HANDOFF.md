# Pente3D — Supervisor Handoff

You are picking up as the **supervising Claude** on this project. Your role is orchestration:
design with the user, break work into tickets, **delegate to subagents** (single agents for
localized work, **Workflows** for multi-task stages), **gate rigorously**, and **independently
verify** — never trust an agent's "it passed." This doc is everything hard-won so you don't
re-learn it. Read `planning/agent-principles.md` first — it's the constitution.

---

## 1. What this is / current state

A **3D Pente** game (N×N×N cubic lattice): deterministic rules core, IndexedDB game archive,
**real networked play** over an MQTT relay, instanced Three.js rendering, composable
config-driven UI. **v1 is complete, gated, and deployed live.**

- **Live:** prod `https://ggcdevs.github.io/pente3D.ai/`, staging `…/dev/` and `…/test/`.
- **Branches:** `main`/`dev`/`test` are the app; `archive/*` holds all pre-v1 history. Deploy
  is CI (Actions → `gh-pages` subpaths); **source branches hold pure source** (build → gitignored
  `dist/`, no committed builds).
- **Backlog:** 14 open GitHub issues (`gh issue list`), all groomed with design guidance and
  cross-links. Nothing in flight.

## 2. Orientation — key references

| File | What |
|---|---|
| **`planning/agent-principles.md`** | The constitution for every agent (proof-not-inference, genuine tests, no volatile hardcoded facts, assert-over-delete, reviewer charter, nip-the-pattern). **Give it to every subagent.** |
| `GLOSSARY.md` | Vocabulary (node/sphere/piece, 13 line-axes, seat, headHash, etc.). Keep it consistent. |
| `planning/2026-07-18-game-core-design.md` | Rules, immutable `GameState`, `placePiece`, event-log + hash-chain, sync/conflict, undo/redo, input scope-stack. |
| `planning/2026-07-18-networking-poc-design.md` | Relay/transport/seats + the **shitchell.com server setup** (see #23 to codify it). |
| `planning/2026-07-19-render-ui-design.md` | Hybrid instanced/individual rendering, visuals, camera presets, composable zone-based UI. |
| `planning/2026-07-18-testing-strategy.md` | The testing doctrine (below). |
| `planning/review-log.md` | Learning log — what adversarial reviews caught + instruction tweaks. Append after each gate. |
| `README.md` | Local dev, incl. supplying your own relay via a localStorage override. |

**Source layout:** `src/core` (pure rules — imports nothing from render/net/ui, eslint-enforced),
`src/config` (layered config: JSON defaults + localStorage override), `src/persist` (IndexedDB +
archive + game-lifecycle), `src/net` (transport/seats/sync/routing/turn-gate/presence),
`src/render` (Three.js glue + pure resolvers), `src/input` (command registry, keybindings,
scope-stack, placement), `src/ui` (DOM widgets + pure view-models on a zone layout), `src/util`
(`randomId`), `src/debug/window.ts` (**`window.__pente`** inspection API — the linchpin for
Playwright assertions).

## 3. The build/review pipeline (Workflows)

Everything ships through a two-part gated flow:

1. **Build** (`.claude/workflows/pente-stage-N.mjs`): sequential TDD, one subagent per task,
   **HALTS on a `null` task** (a failed agent) so dependents aren't built on a gap. Splits **pure
   logic** (unit + mutation) from **IO glue** (Playwright). Commits per task; does **not** push.
2. **Review-gate** (`.claude/workflows/pente-review-gate.mjs`, args `{stage, scope, mutateScope}`):
   Harden (ensure gates enforce the scope) → **2 adversarial reviewers** (test-integrity +
   correctness-vs-design, they **view screenshots**) → **fix loop (max 3, then escalate to you)** →
   Gate (lint + coverage 100% + **mutation ≥95** + push **only if reviewers approved**).

`scope` = coverage/reviewer dirs; `mutateScope` = the **pure** files only (glue is Playwright-
verified, never mutation-tested). To iterate a workflow: edit the `.mjs`, re-invoke with
`{scriptPath}`. **Never call `Workflow` unless the user has opted into multi-agent orchestration.**

## 4. Testing

- **Commands:** `npm run lint | test | coverage | mutate | e2e` (+ `dev`, `build`).
- **Pyramid:** Vitest unit + **fast-check** property tests on pure logic; **Stryker mutation**
  (break=95, generous `timeoutMS/timeoutFactor` for determinism) as the real bar; **coverage 100%
  pinned on pure files** (vite thresholds; glue excluded). `eslint-plugin-vitest` bans
  assertion-free/skipped/focused tests.
- **Rendering/UI:** **Playwright** drives the real app headless via **SwiftShader** software WebGL
  (no display needed) and asserts on **`window.__pente`** real state + screenshots — never on log
  lines.
- **Networked:** two **isolated browser contexts** (distinct playerId/seats) for genuine two-player
  tests; **real-relay** integration tests hit the live broker (they self-skip if unreachable).
- **Proof doctrine:** every gate proves it *bites* (raise the threshold / inject a regression →
  non-zero exit, then restore). Coverage means "executed," mutation means "verified."

## 5. Supervisor gotchas (learned the hard way)

- **NEVER hardcode a branch name in an agent/workflow prompt.** An agent reading "branch X" will
  `git checkout X` and switch the shared working tree (this happened — a gate ran on the wrong
  branch, local dev showed the old build). Say *"work in-place on the current branch; never
  checkout/switch."* Push with `git push origin HEAD`. (See `memory` note.)
- **Independently verify every agent claim.** The gates caught a *fake* mutation gate (config with
  no `break`), a *flaky* gate (timeout jitter around 95), a *per-move* archive bug, a hover-render
  bug — several reported as "passed." Re-run the metric yourself; **re-run flaky metrics ≥2×**.
- **Screenshots:** the **review agents** view them; **you (main loop) do NOT** — they're expensive
  in context. Only look if the user says something's wrong.
- **The git wrapper** GPG-signs and re-authors commits to "Claude Code" (expected). Its
  `commit_trailing_whitespace` hook **rejects minified bundles** — strip trailing whitespace or
  don't commit build output (we deploy via CI now, so you shouldn't need to).
- **Don't do git ops while a workflow/subagent is committing** to the same branch (push races,
  interleaved commits). Wait for it, or work non-overlapping files.
- **Subagents can leave orphaned `while … sleep` polling shells** running after they finish
  (burns CPU, holds RAM, re-notifies). Don't write polling loops into agent tasks; prefer the
  harness's completion notifications.
- **Integration gaps slip past component gates.** Each stage tested its parts in isolation; the
  scene↔SyncEngine *wiring* was never tasked → networked moves silently didn't sync until a
  **two-browser e2e** exposed it. Add cross-component tests for anything spanning stages.
- **GitHub Pages:** one site per repo (multi-env = **subpaths**, not subdomains); changing the
  Pages **source branch does NOT auto-trigger a build** — `POST /pages/builds`.
- **Secure-context APIs** (`crypto.randomUUID`, `crypto.subtle`) are `undefined` over plain LAN
  http — guard them (we use `src/util/randomId.ts`). Test insecure-context paths (Playwright runs
  on localhost = always secure, so it won't catch these).
- **Relay config is portable:** blank in-repo, injected at build from the `RELAY_CONFIG` repo
  variable; local dev via a `pente:config:relay` localStorage override. The relay itself runs on
  shitchell.com (`guy@shitchell`, passwordless sudo) — see the networking design doc + #23.

## 6. Approaching the tickets — sequencing & delegation

The backlog is **already grouped into coherent, shared-surface batches** — do a batch as one
piece, not N scattered passes:

- **Menu & live settings** (#24 side-drawer · #15 live-apply · #13 network-in-menu · #16 CSS
  modernization) — same surface (menu/settings UI + config subscription + scope-stack).
- **Networking UX** (#12 rematch · #18 undo/redo · #17 slider-local-only · #20 reconnect+notify) —
  **build ONE ask/accept handshake primitive** and reuse it for #12 + #18.
- **Board size** (#9) — single source of truth through render+picking+authoritative game;
  arbitrary N; "takes effect next game"; networked size agreement. Depends on #15's mechanism.
- **Rendering** (#19 last-piece animation — config-driven, fires on remote moves too).
- **Mobile** (#10 touch line-visibility control — dispatches the same command IDs as `d/s/f`).
- **Platform** (#21 PWA/offline), **Infra** (#23 relay-as-code, pairs with the `RELAY_CONFIG` var).

**Per batch:** brainstorm/design with the user if non-trivial → write a mini-plan → **delegate**.
Use a **single Agent** for a localized fix (like the #1/#3/#6/#7 fixes); use a **build Workflow**
(sequential, null-halt) for a multi-module batch; **always run the review-gate afterward**, then
**independently verify** and close the ticket with the commit SHA.

**Scope heuristic (in-session vs ticket):** fix now if it breaks the *core designed experience*;
ticket it if it's a new feature beyond the design, an off-path edge case, or polish.

**Suggested order:** Menu & live-settings batch first (biggest UX lift, and #15 unblocks #9/#19/#24)
→ Networking UX → board size → rendering/mobile polish → PWA/infra.

## 7. Deploy & infra quick-ref

- **Deploy:** push to `main`/`dev`/`test` → `.github/workflows/deploy.yml` builds (relay injected
  from `RELAY_CONFIG`) and publishes to `gh-pages` at `/`, `/dev/`, `/test/`. Pages source =
  `gh-pages`. A new branch needs the workflow present on it (fast-forward from main) to deploy.
- **Verify a deploy:** wait for the Actions run (`gh run list`), then `curl` the URL for a 200 +
  the right `/pente3D.ai[/env]/assets/…` base.
- **Relay:** Mosquitto behind nginx (wss on 443) on shitchell.com. To repoint, update the
  `RELAY_CONFIG` repo variable. #23 will bring the server setup into `infra/`.

---

*Have fun. The apparatus works — trust it, but verify it. The user is a sharp collaborator who
catches subtle bugs by actually playing; treat their hands-on findings as first-class signal.*
