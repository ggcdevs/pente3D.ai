# Game Core Design — board, rules, history, sync, input

- **Date:** 2026-07-18
- **Status:** Approved (design), ready for build-plan
- **Companion docs:** `planning/2026-07-18-networking-poc-design.md` (transport/relay/seats),
  `GLOSSARY.md` (vocabulary), `planning/basic-wants.md` + `planning/user-stories.md`
  (requirements).

## Guiding principles

1. **Rules are independent of view.** Win/capture detection *always* uses all 13 line-axes
   and never consults what is drawn on screen. This is the primary structural defense
   against the V1 "diagonals" pain — the visual line layer and the rules engine cannot
   drift apart because they share nothing.
2. **Everything is config, no magic values.** Input (camera presets, keybindings, line
   visibility) all resolve from tracked JSON defaults overridden by localStorage.
3. **One canonical, syncable source of truth** — an append-only event log — serves history,
   undo/redo, networking, persistence, and review.

---

## Part 1 — Board & line model (two layers)

**Layer A — Rules (procedural, no line objects).** Win and capture are pure
coordinate/axis stepping from the just-placed node. Never builds a Line object; always uses
all 13 axes. Isolated and trivially unit-testable.

**Layer B — Lines (objects, for rendering + hover + `generateFullLine`).** A **Line** is a
drawn gridline with canonical identity **`(entryNode, axis)`**:

- **Axis table** — a fixed constant of the **13 canonical axes** (sign convention: first
  non-zero component positive), tagged `orthogonal` (3) / `face` (6) / `space` (4). Single
  source for both rules-stepping and line generation.
- **entryNode** — the unique node where a line enters the board along its axis
  (`entryNode − axis` is off-board).
- **Dedup-free enumeration** — "for each axis, for each entry node, walk `+axis` to the far
  face" yields every full line *exactly once*. The diagonal-duplication problem is gone by
  construction — there is no dedup step to get wrong.
- Each Line caches ordered `nodes[]`, `category`, `drawn` state.
- **Indices:** `linesThroughNode[node] → lineIds` (≤13) powers hover; `line.nodes` powers
  rendering.
- `generateFullLine(a, b)` validates (both on faces, collinear along an axis, not already
  registered) and returns the canonical line. `generatePartialLine(a, b)` for sub-segments
  (e.g. a winning line), used only when necessary.

---

## Part 2 — Rules & `placePiece`

**NodeKey:** `"x,y,z"` strings (human-readable in JSON export; fine at this scale), with
`[x,y,z]` ↔ key helpers.

**GameState (immutable snapshot):**
```
GameState {
  size:     N                                  // default 9
  pieces:   { [nodeKey]: "white" | "black" }   // occupied nodes only
  turn:     "white" | "black"
  captures: { white: 0, black: 0 }             // PAIRS captured
  winner:   null | "white" | "black"
  winningLine?: nodeKey[]                       // for highlight
}
```

**`placePiece(state, coords) → GameState` (or throws `IllegalMove`):**
1. **Validate** — in-bounds, node empty, `winner === null`. (Turn/seat ownership enforced by
   the networked layer; the core trusts `state.turn`.)
2. **Place** current color.
3. **Captures** — for each of the **26 directions** from the placed node, if the pattern is
   `[opponent, opponent, self]`, remove those two and `captures[current] += 1`.
4. **Win** — `captures[current] >= 5` **pairs**, OR a run of **≥5** same-color through the
   placed node along any of the 13 axes. Record `winningLine`.
5. Flip `turn` (unless won). Return a **new** state (no mutation).

**Capture semantics (standard Pente, confirmed):**
- **Custodian, exactly two** — flanking *exactly* two adjacent opponent pieces captures
  them; three-in-a-bracket is not captured.
- **Moving into a bracket is safe** — you are only captured when the opponent plays the
  bracketing piece, never by placing yourself between two enemies.
- **Win:** first to **5 capture pairs** (10 pieces) or **5-in-a-row**. ("5 or more" only as a
  defensive guard against an over-count bug.)

---

## Part 3 — History, sync & persistence

**Canonical state = an append-only event log.** Events: `place`, `undo`, `redo` (undo/redo
are events, never truncation). State is derived by folding the log. **Export/import** = this
log + `{ size, settings }` — human-readable and replayable, carrying full undo/redo history.

**Hash chain.** Each entry stores `hash = H(prevHash + entryData)`; the latest `headHash`
fingerprints the entire history. This is the mechanism that makes every sync concern
trivial.

**Sync — full log each message**, carrying `{ version, headHash }`:
- **Identical-history check** — compare `headHash`. O(1).
- **Out-of-order** — adopt whole states, not deltas. Rule: adopt an incoming log iff *mine
  is a prefix of it* (strict extension); if it is a prefix of mine, it's stale → ignore.
  Order stops mattering — the longest valid history wins.
- **Replays / duplicates** — a replayed message is a prefix of what I hold → ignored.
  Idempotent by construction.
- **Conflict / mis-sync** — neither log is a prefix of the other (hash chains fork). Detected
  instantly → **stop the game, show an error, save the conflicted game.** No resolution now;
  a future pass can reopen the saved fork.
- (Sending the whole log every turn is negligible for a turn-based game. Optimization —
  normally send only `headHash`+`version`, send the full log on mismatch — is a deferred
  flex point; v1 sends full state each time as requested.)

**Networked undo = restricted (option 2).** A client only emits an `undo` event for its own
last move; it appends + broadcasts like any event, and the prefix/hash logic keeps both
sides consistent. (Shared cooperative undo is the deferred, looser alternative.)

**Persistence — a game archive.**
- **Every game is saved** for later review — stored in **IndexedDB** (localStorage's ~5MB
  cap is too small for many games; localStorage keeps only config + a current-game pointer).
- A saved game = its **event log + metadata** (players, result, timestamps, `headHash`).
- **Conflicted games are saved too**, flagged `conflicted`, storing *both* forked logs, so a
  future resolution feature can resume exactly that conflict.

**Local history slider (read-only, separate from undo).**
- A cursor `k` over derived states. Rendering at `k` replays the log to ply `k` and shows
  that board — removing, *for the local viewer only*, pieces played after `k`.
- Step back drops the last piece; back again the one before; slide to the end snaps to the
  live current state.
- Emits **no events, syncs nothing, mutates nothing** — opponent and real game untouched.
  Distinct from undo, which is a real (restricted, synced) game action.

---

## Part 4 — Input & view systems

**Command registry.** Every action is a function with a stable **string ID**
(`showAllDiagonals`, `showSpaceDiagonals`, `undo`, `toggleVisibility`, …).

**Keybindings.** Keys → command IDs, reassignable, from tracked JSON defaults + localStorage
overrides. Generalizes the camera **control presets** (Fusion 360, web-friendly) into one
"commands + bindings config" system.

**Context scope-stack.** The app keeps a **stack** of input scopes (e.g. `global` → `game` →
`tempPlacement`); modals/modes push a scope and pop on exit. Each scope is its own
`key → commandID` map. A keypress **resolves top-down** — topmost scope that binds the key
wins, else falls through. Each scope has a **`blocking`** flag: modals swallow unhandled keys
(`blocking: true`); modes like temp-placement fall through so camera controls still work.
Commands stay context-agnostic; all context awareness lives in the binding layer.
- Example: `game` binds `t → enterTempMode`; pushing `tempPlacement` binds `t → exitTempMode`
  and `Enter → confirmTempPiece`, overriding while active.

**Line visibility.** Three independent categories — **orthogonal / face-diagonal /
space-diagonal** — each toggleable via a **checkbox UI** (any combination). Orthogonal shown
by default. `d` is retained as a convenience command that shows all diagonals (face+space),
and can be rebound (e.g. to `showSpaceDiagonals`) like any binding. **Visibility is view-only
and never affects rules.**

**Hover highlighting** (uses the `linesThroughNode` index; only ever highlights **visible**
lines):
- **Empty node** → highlight the node + its visible lines + all pieces on those lines (so you
  see where you'd play).
- **Placed sphere** → highlight the connected visible line(s) + their pieces, but **not the
  sphere itself** (deliberate asymmetry).
- **Line** → highlight the whole gridline + its pieces.

---

## Decision log (rationale; quotes are the user's words)

- **Rules vs view split — all 13 axes always live; `d`/categories are pure view.**
  Rationale: "having all 3 showing becomes quite noisy ... 3 boxes for those categories ...
  a checkbox sort of UI that lets you select any combination ... still retain `d` as showing
  all face + space diagonals." Keeping rules independent avoids view/rules drift (V1 pain).
- **Command registry + rebindable keybindings.** "would love a system like that where
  shortcuts can be assigned to functions with string IDs."
- **Context scope-stack.** "sometimes a shortcut might need to behave differently in
  different contexts / based on whether settings are up or the game is active."
- **Hover.** "visible is what is intended"; "highlight the gridline when you hover over a
  placed sphere -- not the sphere itself."
- **Capture semantics.** Standard Pente (custodian exactly-two, safe to move into a bracket)
  — confirmed. Win = 5 pairs: "we want 5 pairs ... 5 or more [was] a soft catch."
- **Full-state sync + conflict handling.** "send the entire gamestate each time so that if
  somehow some mis-sync occurs ... validate 'does the opponents history look identical to
  mine' ... except to stop the game with an error message. all game states should be saved
  ... if a game is in conflict ... it also gets saved. if at some point we add some conflict
  resolution, we should then be able to resume our previously conflicted game."
- **Handle out-of-order + replays.** "messages getting sent out of order or replays. we
  should handle those." (Solved by full-log adoption + hash chain.)
- **Networked undo = restricted (option 2).** "2 for networked."
- **Local history slider (read-only).** "a separate game history slider ... move the slider
  back a step, it removes (for me only) that last played piece ... move the slider back to
  the end, and it resets the board to its current state."

## Deferred flex points

- Sync optimization: send `headHash`+`version` normally, full log only on mismatch.
- Conflict *resolution* (reopen a saved conflicted game and reconcile the forks).
- Shared cooperative undo (looser alternative to restricted undo).
- Story 17/22 dedupe; formalize the `generateFullLine`/`placePiece`/`Game` items into
  user stories.
