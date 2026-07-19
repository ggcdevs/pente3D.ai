# Pente3D — Glossary

Shared vocabulary for the project. Keep terms here consistent across code, docs, and
UI. When a term would otherwise be ambiguous (e.g. "active" vs "visible"), this file is
the tie-breaker.

## Board & geometry

- **Board** — the 3D cubic lattice of nodes. Size `N` is configurable (default 9), giving
  an `N×N×N` grid.
- **Node** — a lattice intersection where a piece can be placed. Identified by integer
  coordinates `(x, y, z)`, each in `0..N-1`.
- **Sphere** — the rendered marker at a node. An **empty sphere** marks an open node; a
  **placed sphere** is a piece (see below).
- **Piece** (aka stone) — a played marker owned by a player (white or black) occupying a
  node.
- **Moore neighborhood** — the up-to-26 immediate neighbors of a node (all `(±1,±1,±1)`
  offsets excluding `(0,0,0)`). Basis for adjacency and the 13 line-axes.

## Lines

- **Line** — a maximal straight run of collinear nodes along one of the 13 axes.
- **Axis / direction** — one of **13 line-axes** through any node (26 directions = 13
  opposite pairs):
  - **Orthogonal** — 3 axes; the cube-edge gridlines. Shown by default.
  - **Face-diagonal** — 6 axes; diagonals across a cube face.
  - **Space-diagonal** — 4 axes; corner-to-corner through the cube.
- **Full line** — a line spanning face-to-face across the board. Produced by
  `generateFullLine(startNode, endNode)`.
- **Partial line** — a sub-segment of a line; used only when necessary (e.g. drawing a
  winning line). Produced by `generatePartialLine(startNode, endNode)`.
- **Visible line** — a line currently drawn on screen, per the per-category visibility
  toggles. **This is a view concept only.**
  - ⚠️ Deprecated term: earlier docs said **"active"** for lines. We now use **"visible"**
    exclusively for the view state. Line *visibility never affects the rules* — see below.

## Gameplay & rules

- **Ruleset invariant** — win and capture detection **always** evaluate **all 13 axes**,
  regardless of which lines are visible. The rules engine is independent of view state.
- **Five-in-a-row** — a win: 5 of one player's pieces consecutive along any axis.
- **Capture** — flanking exactly **two** adjacent opponent pieces between two of your own
  along an axis removes those two pieces.
- **Capture pair** — one such capture (the two removed pieces). **5 capture pairs = a win.**
- **placePiece(coords)** — the core move function: returns an updated `GameState` or throws
  on an illegal move.
- **GameState** — an immutable snapshot of the game (pieces, turn, scores, …).
- **Game** — tracks the full history of states/moves; drives undo/redo.
- **Temporary placement mode** — a preview mode (`t`) where a translucent piece can be
  placed to examine a move before committing (`Enter`) or discarding (`t`).

## Input

- **Command** — an action with a stable **string ID** (e.g. `showAllDiagonals`, `undo`,
  `toggleVisibility`). All actions are commands.
- **Keybinding** — a mapping from a key (chord) to a command ID. Reassignable; loaded from
  tracked JSON defaults and overridden by localStorage.
- **Control preset** — a named set of camera controls (e.g. Fusion 360, web-friendly).
  Selectable and customizable via the same config system.
- **Context / scope** — an input layer that determines which command a key triggers *right
  now*. The app maintains a **stack** of active scopes (e.g. `global` → `game` →
  `tempPlacement`); opening a modal or mode pushes a scope, closing pops it. Each scope is
  its own `key → commandID` map. A keypress **resolves top-down**: the topmost scope that
  binds the key wins, else it falls through to the scope below.
- **Blocking scope** — a scope that *swallows* unhandled keys instead of letting them fall
  through (`blocking: true`). Modals (settings, menu) block; modes (temp placement)
  usually don't, so e.g. camera controls still work during a preview.

## Networking (see `planning/2026-07-18-networking-poc-design.md`)

- **Transport** — the swappable networking interface the game codes against
  (`connect`/`publish`/`onMessage`/`onPresence`/`disconnect`). MQTT is one implementation.
- **Relay** — the dumb MQTT broker (Mosquitto on shitchell.com) that forwards messages;
  knows nothing about Pente.
- **Room** — a game session, keyed by a **game code**; one topic namespace on the relay.
- **Seat** — one of two player slots (**white** / **black**), owned by a persistent
  **playerId**. First joiner → white, second → black.
- **playerId** — a per-browser stable id (localStorage) that owns a seat and enables
  reconnect/reclaim.
