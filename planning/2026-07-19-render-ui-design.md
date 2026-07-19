# Render & UI Design — Three.js rendering + composable config-driven UI

- **Date:** 2026-07-19
- **Status:** Approved (design), ready for build-plan
- **Branch:** `render-instanced` (forked from `rewrite2` @ the completed backbone; `rewrite2`
  is the retreat point if the instanced approach proves a hard road).
- **Companions:** `planning/2026-07-18-game-core-design.md` (rules/state/input),
  `GLOSSARY.md`, `planning/2026-07-18-v1-build-plan.md` (Stages 4–5 outline).

## Principles

1. **Render layer is a subscriber, not an owner.** It reads `GameState` + view config and
   reflects them into a Three.js scene; zero game logic (eslint boundary keeps `core` clean).
   Every visual is derived from state/config, which is what lets us test rendering via
   `window.__pente` state assertions.
2. **Everything configurable, sensible defaults.** All visual params (colors, opacity,
   materials, lighting, sizes, blending, camera) resolve from tracked JSON defaults overridden
   by localStorage — the layered `config` store from Stage 2. A rich (~hundreds-of-lines)
   config is a feature; defaults ship a good-looking board out of the box.
3. **One action layer.** UI widgets and keybindings both dispatch **command IDs** — a button
   and a hotkey fire the identical command.

## Part 1 — Object strategy (hybrid: instanced + individual)

The board is N³ (default 9 → 729 nodes; up to 11³). Naive one-mesh-per-object = thousands of
draw calls → jank (esp. mobile). So: **instance the static-numerous-uniform sets; individual
meshes for the dynamic-few.**

**Instanced-mesh groups (4)** — each exposes per-instance color + opacity + visibility, plus
`nodeKey↔instanceId` / `lineId↔instance-range` index maps for individual + subset targeting:
1. **Empty spheres** (node markers) — ~N³; hidden per node when a piece occupies it.
2. **Orthogonal gridlines** — toggles as a unit.
3. **Face-diagonal gridlines** — independent checkbox.
4. **Space-diagonal gridlines** — independent checkbox.
(3 line groups because the categories toggle independently — game-core Part 4; the outer cube
frame is just member lines of the orthogonal group, not a separate object.)

**Individual meshes (dynamic, small count):**
- **Pieces** (black/white) — deliberately individual, NOT instanced. Pente games end at
  5-in-a-row / 5 capture-pairs, so realistic piece counts are ~20–100 (never near N³), well
  within individual-mesh territory. Individual meshes make **history-replay/undo add-remove**
  trivial, and per-piece animation + highlight (material swap) easy — instancing would add
  index churn and an animation seam to buy a perf benefit we don't need.
- **Temporary translucent piece** (0–1 live).
- **Winning line** (0–1, a *partial* segment via `generatePartialLine`, likely animated).

**Highlights are not meshes** — node-hover, line-hover, placed-sphere-hover, captured-removal
are per-instance color/opacity/visibility overrides on the instanced groups (and direct
material swaps on individual pieces), driven by the index maps + `linesThroughNode`. Hover
rules (game-core Part 4): empty node → node + its *visible* lines + pieces on them; placed
sphere → the connected visible line(s) + their pieces, **not the sphere**; line → whole line +
pieces. Highlight reads as an **emissive boost** (glow), restored by setting emissive → 0.

## Part 2 — Visual style & depth legibility

The core challenge is seeing *into* a dense cube without clutter.
- **Lit materials** (`MeshStandardMaterial`) + **low-contrast lighting** (ambient + one soft
  directional) — shading gives depth cues a flat cube lacks, while low contrast keeps config
  colors reading close to true. Pieces slightly glossy; markers matte and small.
- **Depth legibility:** small translucent markers, **additive-blended lines** (order-
  independent, gives a glow), opaque pieces (the focus), and the category toggles (default =
  orthogonal only is already calm). Fallback if transparency sorts badly: depth-write off on
  markers + additive lines = order-independent.
- **Scene update model:** incremental — on a state change, diff pieces (add/remove individual
  meshes), toggle marker visibility; hover is a transient override. Full rebuild only on board
  resize / game load.

## Part 3 — Camera presets

Config-driven (`controls` section), two shipped presets, selectable + rebindable:
- **Fusion 360:** pan = middle-drag, zoom = scroll, orbit = Shift + middle-drag.
- **Trackpad:** two-finger drag = orbit (or pan w/ modifier), pinch = zoom — trackpad/laptop
  friendly, and the basis for the later touch/two-finger mobile pass.
Both expose speed, invert, and zoom-limit config. (Web-friendly mouse fallback also available.)

## Part 4 — Config surface (illustrative, all layered defaults + localStorage)

`colors` (bg, marker, black/white/temp piece, each line category, hover-highlight, winning-
line) · `rendering`/`materials` (roughness/metalness/gloss per element, emissive-boost) ·
`lighting` (ambient + directional color/intensity/position) · `geometry` (marker/piece radius,
line thickness, sphere segments = perf/LOD) · `blending` (additive vs normal per line
category) · `interaction` (hover scale, glow intensity) · `controls` (presets/speeds/zoom) ·
`lineVisibility` (default-on categories) · `layout` (widget placement, Part 6).

## Part 5 — Input system (from game-core Part 4)

Command **registry** (string-id actions) · **keybindings** (key→commandID, config, rebindable)
· **context scope-stack** (stack of scopes, each a keymap; top-down resolution with fall-
through; per-scope `blocking` flag). Camera presets are part of this. `t` temp-mode pushes a
`tempPlacement` scope; modals push `blocking` scopes; `?` opens the shortcut help overlay.

## Part 6 — Composable config-driven UI

Non-3D UI is **HTML/DOM overlays** over the fullscreen WebGL canvas (best for text/buttons/
a11y). Each element is a **self-contained widget**:
- Stable **string id**; `mount() → DOM element` + `update(state, config)`.
- Reads GameState / connection / config (subscribes); **dispatches command IDs** (same
  registry as keybindings). **Knows nothing about its placement.**

**Layout is pure config** — a `layout` section maps `widgetId → { zone, order, visible,
offset }`. **Zone-based positioning**: anchor zones (`top-left/center/right`, `left`, `right`,
`bottom-*`, `center`); widgets flow within a zone by order. Rearrange/hide/reorder = edit the
config value (or localStorage). Unknown widget id → ignored gracefully. **Future seam:**
runtime drag-to-reposition writing back to the `layout` config — drops onto this model.

**Widget roster:** menu button + menu modal (Settings, Host, Join, Load, Export); settings
modal (board size, colors/opacity live preview, keybindings, control preset, reset-to-
defaults); score/status banner (current player, capture counts, Undo/Redo/Reset); host/join +
connection/seat status + conflict banner; **history slider** (read-only local scrubber over
`game.stateAt(k)`); help overlay (`?`, generated from the command registry); debug HUD.

## Part 7 — Verification

Pure logic (instance index maps, layout resolver, camera-preset config, command dispatch,
hover-target computation from a raycast hit) → Vitest unit + mutation (strict). The Three.js
scene glue + DOM widgets are an **IO boundary** verified by **Playwright** driving the app:
assert on `window.__pente` real values (getCamera/getState/getVisibleLines/getHoverTarget/
pickAt) + screenshots as artifacts. State-assertion-primary; pixel-diffs on a few key views.

## Decision log (rationale; quotes are the user's)

- **Hybrid instanced/individual; pieces individual.** User: "individual pieces should remain
  small in count (relative to what Three.js can handle), and it adds more flexibility." The
  N³ markers + gridlines need instancing; pieces (small, dynamic, replayed) do not, and
  individual meshes make replay/undo add-remove and animation trivial.
- **Branch `render-instanced` as a retreat point.** User: "if we get down a hard road, the
  branch gives a sane place to step back." Retreat signposts: janky per-instance highlight,
  rat's-nest index bookkeeping, unreliable instanced-mesh picking.
- **Everything configurable.** User: "i'd be happy if the game loads from a config file that
  is 500 lines long ... sensible defaults, but lots of config."
- **Zone-based layout** (over free/absolute or runtime-drag now). User: "i'm good with
  zone-based." Drag-to-reposition left as a seam.
- **Camera presets: Fusion + trackpad.** User: "fusion + trackpad presets."

## Deferred flex points
Runtime drag-to-reposition widgets; touch/two-finger mobile controls; per-piece capture
animations beyond a basic fade; visual-regression pixel-diff expansion.
