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
- **Turn gate** — the rule that a player may only append when the log says it is their turn (undo /
  redo additionally need mutual confirm). Its *consequence* is the premise the whole v3.1
  reconciliation policy rests on: **legitimate drift between two peers is capped at exactly one
  move** — if it is your turn they cannot move at all, and if it is theirs they move once and are
  then blocked. So a gap of more than one entry is **already anomalous** and is never adopted
  automatically (design §5).
- **Log reconciliation** (`src/net/reconcile.ts` `reconcile`) — the pure decision taken on **every**
  log that arrives for the game we are on, and the only thing allowed to change our history: one of
  `in-sync` (identical heads — say nothing), `fast-forward` (adopt theirs), `republish` (keep ours
  and answer), or `needs-resolution` (a **divergence**, carrying the **LCA** and a **diff**). Not to
  be confused with **seed reconciliation** (`admission.ts` `reconcile`), which decides what *game*
  two peers bring into a room, not which *history* of it is right.
- **Fast-forward** — the **one** automatic convergence in v3.1 (`fast-forward`, reason `one-move`):
  their log is **exactly one entry longer**, our log is its **prefix**, and our log says that entry
  was **theirs** to make. The mirror case — we are one ahead because our move never got out — is a
  **republish**, not an adoption. Everything else (a longer prefix, or a fork) is a **divergence**.
  This replaced v3's blanket "adopt any strict extension", which is what let a stale peer be
  silently overwritten by an arbitrary history.
- **Replay-validation** (`validateAdoptable`) — before an adopted log is taken it is **replayed
  through the pure rules engine** (`placePiece` fold) and rejected on the first illegal entry. A
  sender's *derived* state (board, scores, winner) is never trusted. On a dumb relay the opponent's
  client is the validator, so this is the integrity mechanism, not a sanity check (design §5).
- **Divergence** — the two peers hold histories of the SAME game that cannot both be right:
  more than the **turn gate**'s one-move cap apart, or a genuine **fork**. Nothing is adopted
  automatically; both sides record the **last common ancestor** + a readable diff and show the
  **divergence panel** (v3.1, design §5).
- **Last common ancestor (LCA)** — the deepest point two logs still agree on, as a ply count
  plus the chain hash there. Found by walking both hash chains — free by construction, since an
  entry-hash match already implies agreement on everything behind it.
- **Conflict** — a **fork**: two players' logs diverge with real moves on BOTH sides (neither is
  a prefix of the other). The game STOPS and both forks are archived, so playing on cannot deepen
  a split the players have not settled. Since v3.1 it is **not a terminus**: an agreed
  **resolution** lifts the stop and the archived record is kept (agreeing to the other history
  never destroys your own).
- **Resolution** — the agreed way out of a **divergence**, exchanged over the same out-of-band
  ask/accept handshake as rematch/undo: **keep mine**, **use theirs**, or **rewind to the LCA**.
  Nothing lands until BOTH sides agree; a decline or a peer-gone auto-cancel leaves both games
  untouched. On the wire it names the target history by its **headHash** (`resolve:<headHash>`),
  absolutely rather than relative to whoever asked, and an adopted history is **replay-validated**
  before it is taken.
- **Game archive** — persistent store (IndexedDB) of every game (event log + metadata),
  including conflicted ones, for later review/resume. Since v3.1 every record is **keyed by its
  game's UUID**, so one game has exactly one record by construction (the retired `autosaveId` key
  is migrated forward at boot by `rekeyArchiveRecordsByGameUuid`).
- **Games list** (`ui/widgets/archiveModel.ts` + `archive.ts`) — the archive browser: one row per
  **record**, grouped by **status** (`unfinished` / `finished` / `conflicted`), resumed by the
  game's **UUID** rather than by the store key. With **empty-slate boot** and no code→game map it is
  the **only** route back into a game (design §10), which is why the Unfinished section is rendered
  even when it is empty — an empty answer is stated, not implied by a missing heading. A refused
  resume is typed and shown (`not-found` / `not-resumable` / `session-live` / `session-active`),
  never a silent no-op.
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
- **Seed reconciliation** (`admission.ts` `reconcile`) — the pure decision that turns a **pair of
  seed proposals** into a single agreed game or a **typed reject** (`seed-refused` /
  `game-mismatch` / `game-divergent`) surfaced to the UI: both empty (defer/new, any mix) → one
  fresh game; a concrete game beside a **defer** →
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
- **Resident-peer republish** (design §4, fixes **#45**; pure rule in `src/net/republish.ts`) — how
  v3.1 converges on the **live** state after an outage: on a peer's **fresh live presence**, whoever
  is in the room puts its **full authoritative log** back on the wire (`SyncEngine.publishState`),
  and the peer reconciles onto it. Idempotent — there is no new message kind, only the log. Chosen
  **deliberately over a retained MQTT message**, which would make the *topic* own a game and so
  re-couple code↔game at the broker, destroying code reuse.
  - It triggers on **any** fresh live presence, **not** on an `absent → present` **edge**: a
    graceful DISCONNECT discards the broker's Last-Will, so a **silent outage** produces no absence
    to observe and an edge-gated trigger would never fire.
  - It runs in **both directions** — the resident serves a returner that missed moves, and the
    returner serves a resident that missed the move it made while away.
  - `RepublishLimiter` is the pure decision: `rate-limited` suppresses the presence handshake's own
    ack echo (a sub-second window), `nothing-to-serve` refuses when we hold no authoritative log.
- **Answer** (`tag: 'answering'`) — a log published *in reply* to a peer's announce, because
  reconciliation said we are **ahead** or that the pair has **diverged**. **Every** announce is
  answered, never once per head-pair: nothing acks a QoS-0 publish, so the peer's own next announce
  (presence republish, resync, reconnect) is the **retry** for a lost answer. The **tag**, not a
  latch, terminates the exchange — no arm answers a tagged answer. An applied **resolution**
  publishes with `tag: 'settled'` instead, which closes a divergence record rather than re-opening
  one. (The live broker **echoes** a client's own publishes back to it, so "a log identical to mine"
  is usually our own message and may never be read as the peer agreeing.)
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
- **Empty-slate boot** (design §6) — a tab reload **always** lands on a fresh empty board. There is
  no auto-restore of "the current game": the loaded game is a **JS var**, never a persisted pointer.
  Nothing is lost — every game is durable in the **archive** by UUID and reachable from the **games
  list** — and the only thing a reload may do with the **breadcrumb** is *offer* a rejoin.
- **Rejoin probe** (`NetSession.probeRoom`, pure reading in `src/net/roomProbe.ts`) — the look into
  the room the **breadcrumb** names, taken on a fresh boot. It is **presence-only**: it publishes no
  admission message, because its presence announce is what a resident answers with a **resident-peer
  republish**, and that log carries the game's UUID. So a probe cannot claim a seat, start a game,
  be mistaken for an entry, or leave a retained trace. Four honest outcomes: `same-game`,
  `other-game`, `empty-room`, and `peer-silent` (a peer really is present and really said nothing
  inside the window). The window is a **deadline**, not a fixed cost — the probe stops listening the
  moment it holds both facts.
- **Rejoin prompt** (`ui/widgets/rejoinPromptModel.ts`) — what a probe outcome is offered to the
  player as (design §6's table). It **displays** the colour **derived** from the game's seat map; it
  never negotiates one — that is what keeps #31 and #40 shut. Declining clears the breadcrumb; a
  `different game in the room` outcome warns rather than hijacking. The **copy** is a deliberate
  collaboration point with the user and lives in the pure model so it can be tuned against tests.
- **Empty shell** (`isEmptyShell`) — an archive record for a board with **no history and no
  outcome** (`events === 0`, result `in-progress`). Every boot and every reset starts a game with a
  new UUID, so unplayed boards would otherwise accumulate forever. They are therefore **collected,
  not merely hidden** (`purgeEmptyShellRecords`, at boot and at each local game boundary): one
  cursor transaction, keeping the loaded board, any game a live session owns, and the game the
  breadcrumb names. A **seated** husk is exempt only while it is younger than
  `SEATED_SHELL_MAX_AGE_MS` (24h — the breadcrumb's own horizon), because the live room the caller
  cannot see may be another **tab's**; the exemption is bounded in time rather than granted forever,
  since a permanent exemption re-creates the same leak for networked boards.
- **Visited room codes** (`pente:recentCodes`, localStorage) — the codes this browser has used,
  newest-first: the code picker's memory. **Codes only** — it holds no game state, so a code in the
  list says nothing about which game (if any) was ever played there.

## CLI client (`cli/`)

- **Phase** vs **link** — two different facts, reported side by side, and the split **#45** lives
  in. **Phase** (`offline` / `connecting` / `connected` / `conflict`) is the **session**: whether we
  hold a seat in a room, with an engine and a game. **Link** (`up` / `down` / `none`,
  `cli/netlink.ts`) is the **transport socket**. `pente drop` — and a real outage — takes the link
  `down` while the session stays `connected`, engine, seat and game intact; `pente restore`
  reconnects it. Nothing re-runs **admission** on a reconnect (the transport re-subscribes and
  re-announces; the session never re-`enter`s), so the moves missed while the link was down come
  back only via **resident-peer republish**. A `connected` phase therefore never means "in sync" —
  `headHash` does.
- **`drop` vs `leave`** — `drop` kills the socket under a live session (an outage). `leave` is a
  real **departure**: seat and engine released, so returning re-runs admission. Only `leave` →
  `enter` exercises the re-admission path #40 broke; a socket drop would have missed it.
- **Silent outage** (`drop --silent`) — a **graceful** MQTT DISCONNECT, which makes the broker
  **discard our Last-Will**. The peer therefore never observes an absence, which is exactly the case
  an `absent → present` edge trigger cannot serve — see **Resident-peer republish**.
- **Scenario exit codes** — `0` converged / passed, `1` the bug is present, **`2` skipped because
  the relay was unreachable**. `2` is not a regression and must never be read as a pass.
