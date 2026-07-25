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

## History & sync

- **Event log** — the append-only canonical history of a game: `place` / `undo` / `redo`
  events. State is derived by folding it. Same object the network syncs and the archive
  stores.
- **Hash chain** — each log entry stores `hash = H(prevHash + entryData)`; the latest
  **headHash** fingerprints the whole history. Enables O(1) "identical history?" checks and
  pinpoints divergence.
- **Conflict** — two players' logs fork (neither is a prefix of the other). v1 response:
  stop the game, error, save the conflicted game (both forks) for possible future
  resolution.
- **Game archive** — persistent store (IndexedDB) of every game (event log + metadata),
  including conflicted ones, for later review/resume.
- **History slider** — a **read-only, local** cursor over derived states for reviewing past
  plies. Removes pieces after the cursor *for the local viewer only*; emits/syncs/mutates
  nothing. Distinct from **undo** (a real, restricted, synced game action).

## Networking (see `planning/2026-07-18-networking-poc-design.md`)

- **Transport** — the swappable networking interface the game codes against
  (`connect`/`publish`/`onMessage`/`onPresence`/`disconnect`). MQTT is one implementation.
- **Relay** — the dumb MQTT broker (Mosquitto on shitchell.com) that forwards messages;
  knows nothing about Pente.
- **Room / code** — a **rendezvous channel** on the relay (one topic namespace), named by a
  short **game code**. It is only where two peers find each other; it **identifies no game**
  and is **reusable** (code `TESTTT` can host game G1 today and an unrelated G2 tomorrow).
  ⚠️ Deprecated framing: earlier docs called the room "a game session keyed by a code" — the
  code was never the game's identity. The **game UUID** (below) is the game's identity.
- **Game UUID** — a game's stable identity, **minted once at genesis** and carried **in the
  event-log** (part of the hashed history, not merely a local archive key), so two peers
  referencing "the same game" is verifiable and "same UUID but divergent **headHash**" is a
  detectable conflict. A game is **portable** across rooms and partners by its UUID.
- **Seat** — one of two player slots (**white** / **black**), **owned by a persistent
  playerId** and **bound in the persisted game** (the game remembers who is white). Seats are
  assigned by **first-available + tiebreak ONLY at genuine game creation**; after that a
  returning owner **reclaims by identity** (validated by **headHash**), never by which button
  was pressed. Every owner is a real `playerId` or `null` — there is **no `'host'` sentinel**.
- **Reserved seat** — a seat that stays **owned by its absent playerId**. "Room full" means
  **both seats owned**, even while an owner is temporarily gone — so a non-owner entering a
  full room is rejected (spectating is a future feature, #36).
- **Seed proposal** — what **game** a peer brings when entering a room (design §3):
  **new** (mint a fresh game), **resume** (a specific persisted game by UUID + headHash),
  **current** (the currently-loaded local game), or **defer** ("dealer's choice" — bring
  nothing, adopt the opponent's). (**random** — a shared randomized board — is future #34.)
- **Seed matrix** (design §3, enforced on the wire) — what each seed **sends** and **accepts**:
  **new** sends/accepts an **empty** game only; **resume**/**current** send their own concrete game
  and accept the **same UUID** only; **dealer's choice** sends nothing and is the **only** kind that
  **adopts a peer's non-empty game** — in **either** direction, whether the deferrer is the newcomer
  (it adopts the arbiter's game) or the **arbiter** (its `admit` names the newcomer's game and it adopts
  that off the move-sync channel). A mismatch is an honest typed reject, never a silent adoption.
  Enforced at **all three** points a game can cross into a peer — see **Seed refusal**.
- **Reconciliation** — the pure decision that turns a **pair of seed proposals** into a single
  agreed game or a **typed reject** (`seed-refused` / `game-mismatch` / `game-divergent`) surfaced
  to the UI: both empty (defer/new, any mix) → one fresh game; a concrete game beside a **defer** →
  play it; a concrete game beside a **new** → `seed-refused`; two concrete same-UUID+matching-headHash
  → resume together; two concrete same-UUID divergent → `game-divergent`; two concrete different-UUID
  → `game-mismatch`.
- **Seed refusal** (`seed-refused`) — the reject for **incompatible seeds**: one peer chose New game
  (empty only) while the other brought a real game, so neither may give way. Raised at **every**
  enforcement point — on the **proposal** pair (`reconcile`), on the **concrete game** about to cross
  the wire (`acceptsGame`, applied by the arbiter before it serves and by the newcomer on receipt), and
  on the **move-sync channel** before a peer adopts a log belonging to a *different* game
  (`SyncEngine`'s seed gate — without it the log-prefix rule, under which an empty log is a prefix of
  anything, let any peer whose board was momentarily empty adopt a stranger's game wholesale). It is
  what stops a stale game being pushed to a peer that asked to start over (#46) and a reused code from
  keeping the old board (#43).
- **Seed unavailable** (`seed-unavailable`) — a **local** refusal, not a peer's: the seed named a game
  this browser does not hold, so there is nothing to resume. Refused before the transport is touched.
  Its own reason because the alternative — entering on a fresh game while announcing the named one —
  made every downstream refusal a lie (a peer proposing the *same* game was told the two of you
  "brought different games").
- **Initiator election** — the deterministic pick (earlier live-presence **arrival**, then
  lower **playerId**) of which of two **simultaneously-arriving** peers computes reconciliation
  and publishes the agreed game — killing the initial double-white race.
- **Rematch game identity** (`rematchGameUuid`) — a rematch is **one** new game, so its UUID is
  **derived** from state both peers already share (the prior game's UUID + the generation being
  entered), not independently randomized. Both sides reset over the same live connection with no
  coordination round-trip and land on the same game at genesis — the same property initiator election
  gives a *first* game. Randomly-minted ids left each peer on its own game (two archive records for one
  rematch) converging only by the log-prefix accident the seed matrix must be free to refuse.
- **playerId** — a per-browser stable id (localStorage) that **owns a seat** and enables
  reconnect / reclaim-by-identity.
- **Active-game breadcrumb** (`activeNetworkedGame`) — the single record *"I am **currently
  mid-game** in room X as game Y"* (`{code, gameUuid, updatedAt}`). It is **session state, not a
  mapping**: single-valued (entering another room replaces it, there is no per-code entry), it drives
  a **prompt, never an auto-load**, it **expires quietly** once `updatedAt` is stale, and it is
  **never published**. It is how a returning peer finds its game — by that game's **UUID** in the
  archive, never by the code. **Dual-tracked** (design §2): the **localStorage** half is the reload
  path and is **cleared when the game is decided** (a finished game is never offered to a fresh boot);
  a **JS-var** half on the live session **survives a win**, so that session's own return / rematch
  still finds the game it just finished instead of establishing an empty one over it.
  ⚠️ The v3 `net-room:{code}` record (a game + seat map persisted **per code**) was the opposite of
  this and is **deleted**: it made a rendezvous channel own a game (#43/#46). Shards a v3 build left
  in a real user's IndexedDB are **purged on boot** (`purgeLegacyNetRoomRecords`), not hidden.
- **Empty shell** (`isEmptyShell`) — an archive record for a board with **no history and no
  outcome**. Kept in the store (a live session writes its game's record as soon as seats are
  negotiated, and the empty-room reclaim re-seeds an unplayed post-rematch game from it by UUID) but
  **not shown as a game**: entering a room and leaving before a single move must not litter the games
  list, exactly as an idle reset of a never-played local board mints nothing.
- **Visited room codes** (`pente:recentCodes`, localStorage) — the codes this browser has used,
  newest-first: the code picker's memory. **Codes only** — it holds no game state, so a code in the
  list says nothing about which game (if any) was ever played there.
