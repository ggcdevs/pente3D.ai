# Testing & Observability Strategy

- **Date:** 2026-07-18
- **Status:** Approved
- **Companions:** `planning/2026-07-18-v1-build-plan.md` (stages),
  `planning/2026-07-18-game-core-design.md`, `planning/2026-07-18-networking-poc-design.md`.

## Doctrine: proof, not inference

The governing rule for every task, human or subagent:

> **Never claim success. Show the command and its output. If it wasn't observed, it isn't
> done. Inference is rejected; only pasted evidence counts.**

Operationally: TDD (show the test go red, then green), and for anything visual, attach a
`window.__pente` state readout **and** a screenshot. "Should pass" / "likely renders" are not
acceptable — run it and paste what happened, including failures.

## Test pyramid (per layer)

| Layer | Tool | What proves it |
|---|---|---|
| Rules core (`src/core`) | **Vitest unit + `fast-check` property tests** | Exhaustive: `placePiece` never mutates input; replaying any log → identical state + `headHash`; line enumeration has zero dupes for any N; captures symmetric across all 26 directions. **100% coverage gate.** |
| Persistence (`src/persist`) | Vitest + `fake-indexeddb` | Round-trips, conflicted-game storage/reload |
| Networking (`src/net`) | Vitest (mock transport) **+ real-relay two-client integration** | Sync adopt/ignore/conflict decisions; convergence under out-of-order + replay; conflict-stop. **Integration tests hit the real relay** (`wss://api.shitchell.com/...`), like `poc/`'s `appsim.mjs`. |
| Render/interaction (`src/render`, `src/input`) | **Playwright** driving a real browser | Drive canvas (orbit/pan/zoom, clicks), assert on `window.__pente` state, screenshots as artifacts |

**Coverage:** Vitest coverage; **hard 100% threshold on `src/core`**, pragmatic elsewhere.
Coverage is a floor, never the proof.

## Observability (config-gated, dev/test builds)

1. **Structured debug logger** (`src/debug/log.ts`) — leveled (`trace/debug/info/warn/error`),
   **namespaced** per subsystem (`core:capture`, `net:sync`, `render:hover`, `input:scope`).
   Toggle exact streams via config/localStorage/URL (`?debug=net:*,core:capture`). Log full
   state snapshots at key transitions (every `placePiece` result, each capture, each sync
   decision + `headHash`, seat changes, conflicts).
2. **`window.__pente` inspection API** — `getState()`, `getEventLog()`, `headHash()`,
   `getCamera()`, `getVisibleLines()`, `getSeatMap()`, `getHoverTarget()`, `pickAt(x,y)`. The
   linchpin that lets browser agents assert on **real internal state**, not pixels.
3. **Debug HUD overlay** — a config-driven UI widget showing live turn/captures/`headHash`/
   connection/hover, for manual eyeballing and agent screenshots.

## Agent-driven 3D testing

- Playwright dispatches real input on the canvas: `mouse.down/move/up` → orbit/pan,
  `mouse.wheel` → zoom, clicks → placement.
- After each interaction the agent reads `window.__pente.getCamera()`/`getState()` to **prove**
  the grid moved / the piece placed, plus a screenshot for the record.
- Visual approach: **state-assertion-primary, screenshots-as-artifacts**; pixel-diffs only on a
  few key views, in a deterministic render mode (pinned camera, animations off, seeded state,
  `--use-gl=swiftshader` headless).
- Also available in-session: `cdp` CLI + the `run`/`verify` skills for live driving.

## Execution via per-stage Workflows (gates)

Each build stage runs as one **Claude Workflow** (the workflow is the deterministic manager;
the human/main-loop reviews and gates between stages). Uniform shape:

1. **Build phase** — fan out tasks to worker subagents doing strict TDD; parallel only where
   modules are independent (respect the dependency DAG); workers **write but do not commit**.
2. **Gate phase** — a verification subagent **runs** the suite + coverage (and, for Stage 3,
   the real-relay integration) and returns structured evidence
   `{command, exitCode, output, passed, coveragePct}`. The workflow **fails unless
   `passed===true`** and core coverage is 100%. On green, the gate commits once.
3. **Proof doctrine embedded** in every prompt. UI tasks must attach a `window.__pente`
   readout + screenshot.

**Foundation first:** no gate can run before the tooling exists, so Stage 0 scaffolding + a
**test-harness walking skeleton** (minimal Three.js canvas + `window.__pente` + logger + a
Playwright test that orbits the canvas and asserts the camera moved) is built and proven green
*before* any stage workflow — the same de-risking move as the MQTT POC.
