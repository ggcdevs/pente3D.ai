# Pente3D v1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a configurable, networked 3D Pente game — deterministic rules core,
event-log history/sync over the proven MQTT relay, and a composable Three.js + config-driven
UI — statically hosted on GitHub Pages.

**Architecture:** Strict separation of layers. A pure, view-agnostic **rules core**
(coordinate/axis stepping, no rendering) sits under an **event-log** history that is the
single source of truth for undo/redo, persistence, and network sync. Rendering (Three.js)
and the **config-driven UI shell** (composable widgets positioned by JSON) consume the core
through narrow interfaces. All input (camera presets, keybindings, line visibility) and all
UI layout resolve from tracked JSON defaults overridden by localStorage — no magic values.

**Tech Stack:** TypeScript (strict) · Vite (dev + build → `docs/` for GH Pages) ·
Vitest (unit) · Three.js (rendering) · mqtt.js (transport, already proven) · IndexedDB
(game archive) · Playwright (e2e, later).

**Design sources:** `planning/2026-07-18-game-core-design.md`,
`planning/2026-07-18-networking-poc-design.md`, `GLOSSARY.md`, `planning/basic-wants.md`,
`planning/user-stories.md`.

## Conventions

- **TDD everywhere in Stages 0–3.** Red → green → commit. One behavior per test.
- **Frequent commits**, one per task step where noted. Conventional-commit messages.
- **Source layout:** `src/core/` (rules, no imports from render/ui), `src/net/`,
  `src/persist/`, `src/render/`, `src/ui/`, `src/input/`, `src/config/`. Tests co-located as
  `*.test.ts`.
- **Config files:** tracked defaults in `src/config/defaults/*.json`; runtime overrides in
  localStorage. Never hardcode colors, keybindings, layout, sizes.
- **The `src/core/` layer must never import Three.js, the DOM, or the network** — enforced by
  an eslint boundary rule (Task 0.5).

---

## Stage 0 — Project scaffolding

### Task 0.1: Initialize Vite + TypeScript project
**Files:** Create `package.json`, `tsconfig.json`, `vite.config.ts`, `src/main.ts`, `index.html`
- Init Vite vanilla-ts; set `vite.config.ts` `base: '/pente3D.ai/'` and
  `build.outDir: 'docs'`, `build.emptyOutDir: true`.
- `tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`.
- **Verify:** `npm run dev` serves a hello-world; `npm run build` writes to `docs/`.
- **Commit:** `chore: scaffold vite + typescript project`

### Task 0.2: Add Vitest
**Files:** Modify `vite.config.ts` (add `test` block), `package.json` (scripts `test`, `test:watch`)
- Add a trivial `src/sanity.test.ts` asserting `1+1===2`; run `npm test` → PASS.
- **Commit:** `chore: add vitest`

### Task 0.3: Preserve the POC before the build clobbers docs/
**Files:** Move `docs/index.html`, `docs/transport.js`, `docs/relay-config.json` → `poc/`
- The Vite build empties `docs/`. Move the throwaway POC to `poc/` so it's kept as reference
  (it already served its purpose). Update Pages nothing — build output will repopulate `docs/`.
- **Commit:** `chore: archive networking POC to poc/ before build takes over docs/`

### Task 0.4: Wire a real GH Pages deploy
**Decision:** keep branch-deploy from `rewrite2` `/docs`; commit built assets. (Alternative:
GitHub Actions build — deferred.)
- Confirm `npm run build` → `docs/` with correct `/pente3D.ai/` asset paths; push; verify the
  live URL serves the built app shell.
- **Commit:** `chore: build app shell to docs/ for pages`

### Task 0.5: eslint + import-boundary guard
**Files:** `eslint.config.mjs`
- Add rule forbidding `src/core/**` from importing `three`, `src/render/**`, `src/net/**`,
  `src/ui/**`, or the DOM. This mechanically enforces the rules-vs-view separation.
- **Commit:** `chore: eslint with core import-boundary rule`

---

## Stage 1 — Rules core (pure, TDD)

All under `src/core/`. No rendering, no network, no DOM.

### Task 1.1: Coordinates & NodeKey
**Files:** Create `src/core/coords.ts`, `src/core/coords.test.ts`
- **Test first:** `keyOf([1,2,3]) === '1,2,3'`; `coordsOf('1,2,3')` deep-equals `[1,2,3]`;
  round-trip; `inBounds([0,0,0], 9)` true, `inBounds([9,0,0], 9)` false, negatives false.
- **Implement:** `keyOf`, `coordsOf`, `inBounds`. Types: `type Coord = [number,number,number]`,
  `type NodeKey = string`.
- Run → PASS. **Commit:** `feat(core): coordinate keys and bounds`

### Task 1.2: The 13 canonical axes
**Files:** Create `src/core/axes.ts`, `src/core/axes.test.ts`
- **Test first:** `AXES.length === 13`; counts by category are `{orthogonal:3, face:6, space:4}`;
  every axis's first non-zero component is `> 0` (sign convention); no two axes are parallel
  (no axis equals another negated).
- **Implement:** generate all `(dx,dy,dz)` in `{-1,0,1}³` minus `(0,0,0)`, canonicalize sign
  (flip so first non-zero > 0), dedupe → 13. Tag category by count of non-zero components
  (1→orthogonal, 2→face, 3→space). Export `AXES: {vec:Coord, category:LineCategory}[]`.
- **Commit:** `feat(core): 13 canonical line axes`

### Task 1.3: Line generation (dedup-free) + indices
**Files:** Create `src/core/lines.ts`, `src/core/lines.test.ts`
- **Test first:**
  - `generateAllLines(9)` produces the expected count per category and **no duplicates**
    (assert set of canonical ids has same size as array).
  - Each line's `nodes` are collinear, in-bounds, ordered, and its `entryNode` has
    `entryNode - axis` off-board.
  - `linesThroughNode` for a corner/edge/center node lists exactly the lines that contain it,
    and every such line actually contains the node.
  - `generateFullLine(a,b)`: valid when a,b on faces + collinear along an axis + not already
    registered; **warns/rejects** otherwise (both-on-face, connected, not-already-drawn).
  - `generatePartialLine(a,b)`: valid subsegment when collinear + not already drawn.
- **Implement:** `entryNode = walk from a node backward along −axis until off-board`. Enumerate
  `for axis in AXES: for each node n where (n-axis) off-board: walk +axis → Line{id:`${keyOf(entry)}|${axisIndex}`, axis, category, nodes, entryNode}`.
  Build `linesThroughNode: Map<NodeKey, LineId[]>`. Implement the two `generate*` validators
  returning `{ok, line?, warning?}`.
- **Commit:** `feat(core): dedup-free line generation and node↔line index`

### Task 1.4: GameState + placement/validation
**Files:** Create `src/core/gameState.ts`, `src/core/placePiece.ts`, `*.test.ts`
- **Test first:** `initialState(9)` has empty pieces, `turn:'white'`, zero captures,
  `winner:null`. `placePiece` on empty node returns a **new** state (original unmutated) with
  the piece set and `turn` flipped. Placing on an occupied node **throws** `IllegalMove`;
  placing out of bounds throws; placing when `winner!==null` throws.
- **Implement:** immutable `GameState` (as in the design doc), `placePiece(state, coords)` doing
  validate → place → (captures Task 1.5) → (win Task 1.6) → flip turn → return new state. Start
  with placement + validation only; captures/win stubbed.
- **Commit:** `feat(core): GameState and placePiece placement/validation`

### Task 1.5: Custodian captures
**Files:** Modify `src/core/placePiece.ts`; `src/core/captures.test.ts`
- **Test first:** classic bracket `self, opp, opp, self` (place the closing self) → the two
  opps removed, `captures[current] += 1`. **Exactly two only:** `self,opp,opp,opp,self` → no
  capture. **Safe to move in:** placing self *between* two opps → NOT captured. Captures work
  along orthogonal, face, and space directions. Multiple simultaneous captures from one placement
  all count.
- **Implement:** after placing, for each of the **26 directions**, test `[opp,opp,self]` from the
  placed node; collect and remove; increment pair count.
- **Commit:** `feat(core): custodian pair captures`

### Task 1.6: Win detection
**Files:** Modify `src/core/placePiece.ts`; `src/core/win.test.ts`
- **Test first:** 5 in a row through the placed node (each axis category) → `winner` set,
  `winningLine` populated. 4 in a row → no win. Reaching **5 capture pairs** → `winner` set. No
  further moves allowed after win (placePiece throws).
- **Implement:** for the placed node, per axis walk both directions counting same-color; `≥5` →
  win + record line. Also `captures[current] >= 5` → win.
- **Commit:** `feat(core): five-in-a-row and five-pair win detection`

### Task 1.7: Event log + hash chain
**Files:** Create `src/core/eventLog.ts`, `src/core/hash.ts`, `*.test.ts`
- **Test first:** appending events yields a growing log; `headHash` changes per append and is
  deterministic (same events → same chain). Two logs with identical events have identical
  `headHash`; diverging at ply k gives different `headHash` and `firstDivergence(a,b)===k`.
  `isPrefix(a,b)` true/false correctly.
- **Implement:** `Event = Place|Undo|Redo` (discriminated union). `append`, `headHash`
  (`H(prevHash + JSON(entry))` — pick a small stable hash, e.g. FNV-1a or SHA-256 via SubtleCrypto
  wrapper), `isPrefix`, `firstDivergence`.
- **Commit:** `feat(core): append-only event log with hash chain`

### Task 1.8: Game (fold + undo/redo)
**Files:** Create `src/core/game.ts`, `src/core/game.test.ts`
- **Test first:** feeding `place` events derives the same `GameState` as calling `placePiece`
  directly. `undo` event steps state back (piece removed, captures/turn restored); `redo`
  restores it; a new `place` after `undo` discards the redo tail. Undo works **after a win**
  (winner recomputed). Snapshot cache returns O(1) state at any ply.
- **Implement:** `Game` wrapping an `EventLog`, folding events → cached `GameState[]` per ply +
  a cursor. `place/undo/redo` methods append events (undo/redo restricted to legality). Expose
  `stateAt(k)` for the local slider (Stage 5).
- **Commit:** `feat(core): Game fold with undo/redo and snapshot cache`

### Task 1.9: Export / import JSON
**Files:** Create `src/core/serialize.ts`, `*.test.ts`
- **Test first:** `exportGame(game)` → human-readable `{size, settings, log}`;
  `importGame(json)` reconstructs an identical `Game` (same `headHash`). Corrupt/invalid JSON
  → throws a clear error, never a broken game.
- **Commit:** `feat(core): game export/import`

---

## Stage 2 — Persistence (game archive)

### Task 2.1: IndexedDB wrapper
**Files:** Create `src/persist/db.ts`, `src/persist/db.test.ts` (fake-indexeddb in tests)
- **Test first:** put/get/list/delete a record round-trips; listing returns metadata without
  full logs; missing key returns undefined.
- **Implement:** thin promise wrapper over a `games` object store keyed by game id.
- **Commit:** `feat(persist): indexeddb wrapper`

### Task 2.2: Game archive
**Files:** Create `src/persist/archive.ts`, `*.test.ts`
- **Test first:** `saveGame` stores `{id, log, meta:{players,result,startedAt,headHash}}`;
  `listGames` returns sorted metadata; `loadGame` reconstructs a `Game`; `flagConflicted(id, {mineLog, theirsLog})` stores both forks with `status:'conflicted'` and it survives reload.
- **Commit:** `feat(persist): game archive with conflicted-game support`

### Task 2.3: Config store (defaults + localStorage overrides)
**Files:** Create `src/config/config.ts`, `src/config/defaults/*.json`, `*.test.ts`
- **Test first:** `getConfig('keybindings')` returns the tracked default; a localStorage
  override deep-merges over it; `resetConfig(section)` restores default; invalid override is
  ignored (falls back to default), never throws.
- **Implement:** generic layered config with sections (`keybindings`, `controls`, `colors`,
  `layout`, `lineVisibility`, `relay`). This backs every configurable subsystem.
- **Relay config is SSOT:** `src/config/defaults/relay.json` (`wssUrl`, `username`, `password`,
  `topicRoot`) is the single source consumed by **both** the client's `MqttTransport`
  (Task 3.1) **and** the real-relay networking integration tests (Task 3.3). No hardcoded
  endpoints/creds anywhere — switch servers by editing one file. (Not a secret: creds are
  necessarily public on a static client; this is about SSOT + portability, not hiding.)
- **Commit:** `feat(config): layered config (json defaults + localstorage overrides)`

---

## Stage 3 — Networking integration

Reuse the proven `MqttTransport` (from `poc/transport.js`, ported to `src/net/mqttTransport.ts`).

### Task 3.1: Port + type the Transport
**Files:** Create `src/net/transport.ts` (interface), `src/net/mqttTransport.ts`, `*.test.ts`
- Interface: `connect(roomCode, opts?)`, `publish`, `onMessage`, `onPresence`, `disconnect`
  (opts carries a future `password` — reserved, ignored in v1). Port the POC implementation,
  add types. Test with a mock/in-memory transport.
- **Commit:** `feat(net): typed Transport + MqttTransport port`

### Task 3.2: Seat manager
**Files:** Create `src/net/seats.ts`, `*.test.ts`
- **Test first:** first joiner→white, second→black; same `playerId` reclaims its seat; a 3rd
  distinct `playerId` is rejected; a freed seat is takeable. Seat map lives in shared state.
  (Grace window / tiebreaker are deferred flex points — leave TODO seams.)
- **Commit:** `feat(net): identity-owned seat manager`

### Task 3.3: Full-state sync engine
**Files:** Create `src/net/sync.ts`, `*.test.ts`
- **Test first:** on receiving a remote log, **adopt** iff local is a strict prefix; **ignore**
  if remote is a prefix of local (stale/replay); **conflict** if they fork → emit a conflict
  with both logs and stop. Out-of-order delivery converges to the longest valid log. Each
  outbound message carries `{version, headHash, log}`.
- **Implement:** wrap `Game` + `Transport`; on local move, publish full log; on receipt, run the
  prefix/hash decision. On conflict → `archive.flagConflicted` + surface an error state.
- **Commit:** `feat(net): order/replay-safe full-state sync with conflict stop`

### Task 3.4: Restricted networked undo
**Files:** Modify `src/net/sync.ts`; `*.test.ts`
- **Test first:** a client may emit `undo` only for its own last move; the event syncs and both
  sides step back; an illegal undo attempt is refused locally.
- **Commit:** `feat(net): restricted networked undo`

---

## Stage 4 — Rendering & interaction (Three.js + input)

> Structured outline — expanded into bite-sized TDD/commit tasks once we design the render/scene
> details (camera specifics, materials, highlight visuals). Rendering logic is validated by
> Playwright/interaction tests + manual `run`, not pure unit tests.

- **4.1 Scene bootstrap** — `src/render/scene.ts`: renderer, camera, resize handling, render loop.
- **4.2 Board rendering** — spheres at every node (empty vs placed materials), from `GameState`.
- **4.3 Line rendering by category** — draw orthogonal/face/space gridlines; visibility driven
  by the `lineVisibility` config section; all colors/opacity from `colors` config.
- **4.4 Input system** — `src/input/`: command **registry** (string-id actions), **keybindings**
  (config), **context scope-stack** with `blocking` flag and top-down resolution. Camera
  **control presets** (Fusion 360, web-friendly) as config.
- **4.5 Picking & hover** — raycast to nodes/lines; hover highlighting per the design rules
  (empty node vs placed sphere asymmetry; only **visible** lines; uses `linesThroughNode`).
- **4.6 Placement interaction** — click empty node → `place`; temp-placement mode (`t`) pushing a
  `tempPlacement` scope (`t`→exit, `Enter`→confirm) with a translucent preview piece.
- **4.7 Win visualization** — highlight `winningLine`.
- Each sub-task ends with a commit; visuals confirmed via the `run` skill on real devices.

---

## Stage 5 — UI shell (composable, config-driven)

> Structured outline — expanded once we design the widget/layout system's specifics. **Hard
> requirement:** every non-Three.js UI element is a **self-contained widget** positioned by a
> `layout` config section (JSON default + localStorage override), so panels can be moved,
> hidden, or rearranged without code changes.

- **5.1 Widget/layout framework** — `src/ui/layout.ts`: a registry of widgets (id → component)
  and a `layout` config mapping widget-id → slot/position/visibility. A container renders
  widgets per config. Test: reordering the config reorders the DOM; hiding a widget removes it;
  unknown widget id is ignored gracefully.
- **5.2 Score/status banner** widget — current player, capture counts, Undo/Redo/Reset buttons
  (wired to commands).
- **5.3 Menu** widget — Menu button → modal (Settings, Host, Join, Load, Export); Escape/outside
  closes; pushes a `blocking` menu scope.
- **5.4 Settings modal** — board size, colors/opacity (live preview), keybindings, control
  preset; all read/write the config store; reset-to-defaults.
- **5.5 Networking UI** — Host (game code + copy), Join (code input + errors), presence/seat +
  connection status, conflict error banner.
- **5.6 History slider** widget — read-only local scrubber over `game.stateAt(k)`; slide back
  removes later pieces for the local viewer only; end snaps to live. No events, no sync.
- **5.7 Help overlay** — `?` command opens a keyboard-shortcut modal generated from the command
  registry + current bindings.
- **5.8 Persistence UX** — autosave current game to the archive; restore on load; game archive
  browser (review past + conflicted games).

---

## Deferred (post-v1) — tracked in the design docs
Sync optimization (hash-only normal path), conflict *resolution* UI, shared cooperative undo,
seat grace-window/tiebreaker/spectator, room 2-player cap + room password, touch/mobile controls.

**Relay-config portability (low priority, NOT security):** deploy to GitHub Pages via a CI
pipeline that injects the relay config from a pipeline/secret variable at build time, shipping
`relay.json` as an empty/placeholder so cloners configure their own server. This is purely a
portability/cleanliness nicety — the creds are inherently public on a static client, so it
hides nothing. No rush (no one cloning this soon); the SSOT `relay.json` (tracked) is fine.

## Sequencing note
Stages 0→3 are strictly ordered and fully specified — build them first, they're the tested
foundation. Stages 4–5 depend on render/UI design passes; expand each into bite-sized tasks
just before building it.
