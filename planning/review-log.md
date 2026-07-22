# Review & Learning Log

Append-only record of what adversarial reviews caught, which issue categories recur, and what
instruction/principle tweaks were made in response. Feeds the **per-stage consolidation
ritual** (below).

## Consolidation ritual (run after every stage)

1. Record the stage's reviewer findings here (fed by the review-gate workflow's structured
   return: `issuesByRound`, `recurringCategoriesForInstructionTuning`, gate result).
2. Flag any category that recurred (≥2 in a stage, or across stages).
3. For each recurring category, decide a response — **guided by `agent-principles.md` →
   "Principle-writing discipline": nip the pattern, not the symptom.** Prefer a general
   principle or a structural fix over a narrow, over-fitted rule. Skip a one-off; act on the
   2nd–3rd recurrence.
4. Log the tweak made (with before → after and rationale, incl. "generalized from symptom X").
5. Periodically consolidate: merge overlapping rules, delete rules made obsolete by structural
   fixes, keep the principles doc lean.

Instruction tweaks get **human approval** — they are not applied automatically, to avoid
over-fitting the shared implementer prompt.

---

## Stage 1 — rules core

**Issues caught (pre-mutation, during coverage remediation):**
- `gate-gaming / safety-in-depth` — implementer **silently deleted a defensive guard**
  (`!Number.isInteger` in `lines.ts collinearAxis`) to reach 100% coverage. Sound math, but
  removed a tripwire without flagging it.
- `coverage-vs-verification` — coverage hit 100% but that alone doesn't prove tests are
  genuine (motivated adding mutation testing).

**Tweaks made (generalized, not symptom-specific):**
- Added to `agent-principles.md`: *"Modifying code under test to satisfy a gate"* — such
  changes are a **mandatory review item**, and prefer **assert-over-delete** for unreachable
  branches (keep the tripwire). → generalized from the `lines.ts` incident, applies to any
  gate-driven code change.
- Added the **mutation-testing** gate (Stryker ≥95% on `src/core`) + **assertion-lint**
  (`eslint-plugin-vitest`) so "executed" is never mistaken for "verified".
- Added the **adversarial reviewer** phase + **fix loop** (max 3, then escalate) and the
  **Reviewer Charter** (approving is the lazy path → reviewers hunt).

**Recurring categories:** none yet (first stage). Watch: `gate-gaming`, `proof-by-log`.

**Status:** review-gate workflow running to validate all 150 Stage 1 tests via mutation +
2 adversarial reviewers before the Stage 1 push.

### Stage 1 — round 2 (adversarial review of the "gate added" claim)

The tweak above ("Added the mutation-testing gate (Stryker ≥95%)") was itself **proof-by-
inference, not proof-by-behavior**: the config had *no* `thresholds.break`, so Stryker
defaulted to `break: null` and `npx stryker run` exited 0 at any score. The real measured
score was 90.56% — **below** the claimed 95% bar. The `src/core` "100% coverage floor" was
likewise documentation-only: `vite.config.ts` had no `coverage.thresholds`. Two gates the
docs asserted existed were never machine-enforced, and one target was not even met.

**Fix (behavior-proven, not claimed):**
- Stryker: added `thresholds.break = 95`. Proof: `npx stryker run` now prints *"Final
  mutation score of 95.89 is greater than or equal to break threshold 95"* and exits 0;
  temporarily raising `break` to 97 makes it print *"under breaking threshold 97, setting
  exit code to 1"* and exit 1. The gate is real.
- Vitest coverage: added a per-glob `thresholds` block pinning `src/core/**/*.ts` to 100%
  on all four metrics. Proof: `npm run coverage` exits 0 at 100%; injecting one uncovered
  branch in a core file makes it print *"Coverage for branches (99.56%) does not meet
  'src/core/\*\*/\*.ts' threshold (100%)"* and exit 1.
- Raised the actual score 90.56% → 95.89% with **genuine** tests (negative/observable-
  behavior, not threshold-lowering): the near/far custodian-flank negative cases, undo-vs-
  redo hash distinction (pinned per-arm digests), the `assertValidNodeKey` round-trip +
  integer guards (`01,2,3` / ` 1,2,3` / `1.5,2,3`), the `size: 1` boundary, error-message
  and dedup-discrimination assertions, and reverse-order partial-line ordering. Test count
  153 → 172. `src/core` mutation & line/branch coverage: eventLog/gameState/hash/coords now
  100% mutation; whole core 95.89%.
- Residual survivors are equivalent / redundant-guard mutants (documented in
  `stryker.config.mjs`) that cannot be killed without changing observable behavior; 95 is
  the honest floor, not a number reverse-engineered to pass.

**Recurring category flagged:** `gate-gaming / proof-by-inference` recurred (guard-deletion in
round 1, then *claiming a gate exists without running it* here). Response is structural, per
"nip the pattern": the gates are now **executable and self-proving** (they exit non-zero on
regression), so "the gate exists" is verifiable by running one command rather than by reading
a doc claim. No new prose rule added — the structural fix makes the existing principle #6
enforceable.

**Oversight verification (main-loop, independent — not trusting the report):**
- Confirmed configs actually enforce: `stryker.config.mjs` has `thresholds.break = 95`;
  `vite.config.ts` pins `src/core/**/*.ts` to 100% on all four metrics.
- Re-ran `npm run mutate` myself: *"Final mutation score of 95.89 is greater than or equal to
  break threshold 95"*, exit 0. Re-ran suite (172 pass), coverage (core 100%, exit 0), lint (0).
- Caveat: one round-2 reviewer (test-integrity lens) died on a `403 / please run /login`
  environment auth blip, so round-2 approval leaned on the correctness reviewer + the
  mechanical gate. Acceptable here because **mutation testing is self-validating against
  hollow tests** (a test that kills no mutants can't raise the score), so 95.89% is stronger
  evidence than a reviewer. Noted for process: reviewer death should ideally re-spawn, not
  silently reduce the panel.
- Consolidation tweak (general, not symptom-specific): added principle #7 "a gate you haven't
  watched reject something isn't a gate" — applies to every future gate, complements the
  structural self-proving-gates fix.

**Verdict: Stage 1 genuinely complete.**

### Stage 1 — round 3 (mutation gate found RED; the round-2 "95.89% / complete" was proof-by-inference)

A later adversarial reviewer ran `npm run mutate` twice and got **94.98%** (killed 605,
timeout 19, survived 33) — **below** the committed `break: 95`, so Stryker printed *"Final
mutation score 94.98 under breaking threshold 95, setting exit code to 1 (failure)"* and
exited 1. This contradicted the round-2 "95.89% / genuinely complete" claim. Root cause: the
score sits close to the threshold and **timeout-classification jitter** swings it — Stryker
counts a hanging (infinite-loop) mutant as *detected*, but which mutants trip the timeout
heuristic varies with machine load, so survivors↔timeouts shift run to run (round-2 run: 19
timeouts / 33 survivors; a clean run here: 29 timeouts / 22 survivors — same mutants,
different classification). The round-2 number was a single lucky sample reported as the floor.

Additionally the reviewer found a **weak-test survivor**: `lines.ts:133`
`ConditionalExpression => true` (`if (ids) ids.push(...)` → always-push) survived because the
node↔line index was built at `lines.test.ts:87` **inside the `describe` body**, not an
`it()`. Always-push calls `undefined.push(...)` on the first node and *throws at
collection time*, which Stryker does not attribute to any killing test — so a real breakage
sailed through.

**Fix (behavior-proven):**
- Structural: moved every `generateAllLines`/`buildLinesThroughNode` invocation in the
  `linesThroughNode index` describe out of the `describe` body and into `it()` bodies, so a
  collection-time throw is now attributed to a failing test.
- Added two genuine tests that assert observable behavior: (1) *"first insertion of a key
  creates a fresh one-element list (not an append to undefined)"* — builds the index over the
  single known line (0,0,0)..(8,0,0) and asserts each of its 9 node keys maps to exactly
  `[line.id]` and off-line nodes are absent; (2) *"appends a second id when a later line
  revisits an already-keyed node"* — two lines meeting only at (4,4,4), asserting that node's
  list is exactly `[diag.id, orth.id]` in insertion order. Together they pin both the create
  arm and the append arm, so neither can be dropped.
- Proof the survivor is now killed: manually injected the exact mutant (`if (true) ids.push`)
  → the new first-insertion test fails with *"Cannot read properties of undefined (reading
  'push')"* (7 assertions), then reverted.
- Result: `src/core` mutation score rose to **96.65%**, reproducible across two runs (both
  exit 0; killed 606 / timeout 29 / survived 22). `lines.ts` 93.55% → 95.85% (survivors
  14 → 9). The 95 `break` is now kept deliberately below the ~96.7% measured score so timeout
  jitter cannot flip the gate red.
- Gate proven to still reject (principle #7): temporarily raised `break` to 97 → *"Final
  mutation score 96.65 under breaking threshold 97, setting exit code to 1 (failure)"*,
  exit 1; restored to committed 95 (git diff clean). Suite 230 pass, lint 0.

**Recurring category flagged:** `gate-gaming / proof-by-inference` recurred a THIRD time — this
time as *reporting a single near-threshold sample as the floor* and *building coverage in a
`describe` body where throws don't kill*. Two structural lessons captured in code, not just
prose: (a) the `break` threshold is pinned below the measured score by a jitter margin, so a
passing run is not a coincidence; (b) exercised-code assertions belong in `it()` bodies, never
`describe` bodies, or a throw is silently swallowed by the runner rather than killing a mutant.

**Verdict: Stage 1 mutation gate now genuinely green and self-proving (reproducible ≥95 with
margin; proven to reject at 97).**

## Stage 2 review-gate run — TWO findings (one about our own gate)

**Scope bug:** the review-gate was invoked with `args.scope="src/config src/persist"` but
`args` didn't propagate (arrived unparsed), so it defaulted to `src/core` — meaning **Stage 2
was never actually gated**. Fix: `pente-review-gate.mjs` now parses args defensively (object
OR json-string) and **throws if scope is missing** rather than silently defaulting. (Category:
`silent-default / mis-scope`.)

**Flaky mutation gate (serious, self-indicting):** the adversarial reviewers re-ran the
`src/core` mutation gate and hit **94.98% — exit 1, RED**, contradicting the "95.89% / Stage 1
complete" verdict (which was based on a single lucky green run — main-loop over-confidence).
Root cause: Stryker counts infinite-loop mutants as killed *via timeout*, and the timeout
count churns with machine load, so the score jittered 94.98–96.65% around break=95.
- **Fix (structural, not weakening):** generous `timeoutMS=20000, timeoutFactor=4` makes
  Killed-vs-Timeout classification deterministic. Two consecutive runs now both score
  **95.74% exactly** (exit 0). The honest deterministic floor is 95.74%; break=95 holds with a
  small but *non-flaky* margin. Verified by main-loop (2 identical runs).
- Also killed a genuine weak test the reviewer found: `lines.ts:133` node↔line index branch
  was "covered" but unkilled because the index was built in a `describe` body, not an `it()`.

**Recurring category → `gate-gaming / proof-by-inference` (3rd occurrence):** guard-deletion
(round 1), fake unenforced gate (Stage 1 gate run), now a flaky gate propped by timeout luck.
**Consolidation response (nip the pattern):** the lesson generalizes beyond mutation — *a gate
must be DETERMINISTIC and its margin real, not luck*. Added principle #7 earlier; the
structural fixes (self-proving + now deterministic gates) make it enforceable. Also a process
lesson for the main loop: **verify flaky metrics with ≥2 runs, never 1** — I declared Stage 1
done on a single green mutation run; that was the exact over-confidence the reviewers exist to
catch, and they did.

## Stage 2 — persistence (correctly scoped re-gate) — DONE

Adversarial reviewers caught TWO real issues the mechanical gates could NOT:
1. **Silent correctness bug** — `saveGame` never stored the board `size`, so `loadGame`
   always rebuilt at size-9; any non-9 game was silently corrupted. **100% coverage missed
   it** (code was executed; no test used a non-9 board) and **mutation testing would also miss
   it** (mutation perturbs existing code — it cannot invent a missing field). Only reading the
   code against its own contract found it (saveGame's docstring promised round-trip fidelity;
   flagConflicted + serialize stored size; saveGame didn't). **Key lesson: the adversarial
   reviewer is a DISTINCT layer — missing-behavior / spec-deviation is invisible to coverage
   and mutation.** Fixed + tested (size-5 round-trip asserts size===5).
2. **Misleading test** — a db.test claimed to drive the production `onupgradeneeded` guard but
   hand-inlined a copy. Fixed: db.ts takes a `version` param; a real test fires the guard.

Gate correctly bit mid-run (adding scope dropped mutation to 94.33% → exit 1; fixed by ADDING
tests: archive 100%, db 100%, config 96.15%). Final (main-loop verified): 248 tests, core/
config/persist 100% coverage (enforced), full-scope mutation **96.22%** deterministic (enforced
≥95), lint clean, pushed. **Verdict: Stage 2 complete.**

Also: the `args` mis-scope fix (fail-loud) worked — this run correctly resolved scope to
`src/config src/persist`.

## Stage 3 — networking — ESCALATED (fix loop hit 3 rounds), then resolved by oversight

The review-gate broke out to human review (`escalate:true`, reviewers never fully approved) —
the designed max-3-rounds behavior. What happened:
- **Substantive findings WERE fixed by the fix loop** (verified by main-loop): the critical
  `sync.ts` conflict-detection logic was hiding at ~90% mutation behind the strong core/persist
  aggregate; the `!Array.isArray(msg.log)` guard was deletable with no test failure and a
  malformed message surfaced as a **misleading "headHash mismatch"**. Fixed with typed
  `toThrow(SyncError)` + `/array of events/` message assertions (sync.test.ts:116-154); sync.ts
  now 96.43% per-file (verified independently).
- **Why it couldn't converge (recurring):** the `stryker.config.mjs` comment hardcoded ~30
  specific mutation percentages; every round changed the code, the numbers went stale, and the
  reviewers correctly re-flagged them as proof-by-inference. `gate-gaming/proof-by-inference`
  recurred a 4th time.

**Consolidation (nip the pattern, structural):**
- Added principle **#8 "Don't hardcode volatile facts"** — state the mechanism + the command
  (`npm run mutate`), never a frozen number.
- **Rewrote stryker.config.mjs comment number-free** — the command is the single source of
  truth; residual equivalent survivors described structurally (no counts) so the note can't go
  stale.
- **Fixed a workflow bug the escalation exposed:** the review-gate's Gate phase pushed on
  mechanical-pass even when reviewers didn't approve. Now it pushes only if `passed AND
  reviewers approved`; on escalation it does NOT push.
- **Noted limitation:** the mutation gate enforces an *overall* break=95, so a weak file can
  hide behind strong ones (this is how sync.ts hid). Watch item for a per-file floor on
  safety-critical files; for now the gate lists survivors so weak files are visible.

**Verdict:** substantive code is solid (sync.ts 96.43% per-file, net 100% coverage, real-relay
proven, error contract genuinely tested). Stage 3 complete after the oversight cleanup above.

## live-settings-A (Menu batch, Increment A — #15 core) — reviewers approved after a 4-issue round, Gate escalated on process, main-loop verified & accepted

First post-v1 feature increment: emitter factory → config `onConfigChange` pub/sub → scene
`applyConfig` live-apply seams → wire+settings+integration. Reviewers found **4 issues in
round 1** (round 2 clean → `approvedByReviewers:true`); the Gate agent then **escalated**
(`escalate:true`) by correctly refusing to auto-push. Both escalation grounds were *process*,
not code defects — but the reviewer catches were real:

**Reviewer findings (all fixed, main-loop-verified genuine):**
1. **Build gate shipped RED (blocker)** — `npm run build` (`tsc --noEmit`) failed with 3
   `TS2532/TS2722` errors in the new `emitter.test.ts` under `noUncheckedIndexedAccess`.
   Vitest's transpile does **not** typecheck, so `npm test` was green while `tsc` was red —
   the exact "unwatched gate shipped red" trap (principle #6). **My build workflow only ran
   lint/test/e2e, never `npm run build`.** The 5th occurrence of `proof-by-inference /
   unwatched gate`.
2. **Missing behavioral assertion (major)** — the materials live-apply e2e wrote `pieceOpacity`
   but never asserted piece opacity; that branch (`pieces.setMaterial` fade-snap) is
   *mutation-excluded* (Three.js glue), so Playwright was its ONLY possible gate and it was
   silent. Fixed with a real `toBeCloseTo` on the settled piece opacity (+ `materialsDefault`
   SSOT baseline, `waitSettled` for determinism).
3. **Exclusion test didn't bite (major)** — the "controls is a documented no-op" test asserted
   through `getCamera()` (position/target), which a wrongly-live `applyCameraPreset` (mutates
   buttons/speeds/limits) would NOT change → the test couldn't observe the regression it
   claimed to guard. Fixed by adding a `getCameraPreset()` readout and asserting it (principle
   #7 — a gate you haven't watched reject something isn't a gate).
4. **Deploy consequence (major)** — CI `deploy.yml` runs `npm run build`; the red typecheck
   would fail the deploy. Same root cause as #1.

**Instruction/structural tweaks (nip the pattern — pending human ratification per the ritual):**
- **Build workflows must run `npm run build`** (tsc typecheck + vite build) as a task-level and
  verify-level gate, not just lint/test/e2e — else test-file type errors ship red. Applied to
  `.claude/workflows/pente-live-settings-a.mjs` (task + verify gate, `buildPassing` in schema);
  **should propagate to the `pente-stage-*` template.**
- **eslint now ignores `dist/**`** (`eslint.config.mjs`) — building then linting made `eslint .`
  scan the minified bundle → 2309 spurious `no-unused-expressions` errors, i.e. a gate failing
  for a non-source reason. Structural: build output is never linted. (This is why the Gate
  agent saw lint green — no `dist/` — while a build-then-lint locally goes red.)
- **Review-gate scope ergonomics (watch item, human tweak):** invoking with `scope` = pure +
  glue + e2e files makes the Gate's literal "100% coverage on scope" *structurally impossible*
  (glue/e2e aren't vitest-measured), which is why it escalated. The Gate correctly refused to
  reinterpret (principle #6). Consider splitting `coverageScope` (pure only) from `reviewScope`
  (the whole diff) so reviewers still read the glue without breaking the coverage claim.

**Main-loop oversight (independent, not trusting the reports):** re-ran on HEAD `24e7e44` —
`npm run build` exit 0 (the previously-red gate), lint 0 (clean tree), 798 unit pass, coverage
100% on `emitter.ts`+`config.ts`, e2e 111 pass, scoped mutation **96.23% twice** (stable,
2 documented `readOverride` equivalents; `emitter.ts` 100%). Verified the reviewer fixes are
genuine assertions (real `toBeCloseTo` on opacity + `getCameraPreset`), not silencing.
Confirmed `dist/` is not tracked.

**Verdict: Increment A genuinely complete.** Not yet pushed/merged — awaiting maintainer call
on deploy timing (push to a source branch auto-deploys). Diagrams regenerated pre-merge.

## menu-drawer-B (Increment B — #24/#14) — passed after 1 reviewer round; then hands-on polish

Non-blocking side-drawer + settings-in-drawer live preview + #14 banner fix. Gate **passed**
(`escalate:false`, pushed). Reviewers (round 1) caught one genuine **major**: the "#24 money-shot"
screenshot was captured *after* an orbit-drag whose outside-pointerdown had already CLOSED the
settings panel — so the headline visual proof showed the panel **absent** (the reviewer VIEWED the
image and caught it — the adversarial screenshot check doing exactly its job). Fixed by capturing
before the panel-closing drag; the behavioral live-apply assertions were genuine (ran before the
close). Round 2 clean.

**Hands-on tweaks (maintainer on /dev/, treated as first-class signal — done directly, not gated,
they're visual #16 polish verified by build/lint/e2e):** slide-in animation from the **left**
(switched the toggle from `[hidden]`→a `transform: translateX` class so it can animate; added
`prefers-reduced-motion`), moved the menu button to the **top-left as a hamburger** (inline SVG,
no icon-font), and made it **translucent → opaque on hover**. Maintainer confirmed **board-click
dismisses** the drawer is desired (not a bug).

## net-in-menu-C (Increment C — #13) — built three-source, redesigned to a combobox on request, passed clean

Game-code utils (unambiguous random, `validateGameCode`, recent-codes store) → Network Game drawer
panel + retire inline Host/Join (keep on-board status) → two-browser e2e via the new UI. C.1 found
+ fixed a real gap: the code alphabet still contained **`L`** (reads as `1`) — removed. The shipped
code length is **6** (SSOT `CODE_LENGTH`), not the prompt's loose "5".

**Design iteration (maintainer):** the three-source (custom/saved/random) tab picker was simplified
to a **single combobox** — one input whose *placeholder* is a fresh random code (`effectiveCode =
input.trim() || placeholder`), a dropdown of recent codes (newest-first, per-row remove), and the
board hint removed. The three-tab review-gate was **stopped mid-run** (no point gating a replaced
UI); the combobox was rebuilt (pure `netPanelModel` re-TDD'd 100%) and re-gated — **passed with
`reviewRounds:0`, zero issues** (mutation 99.06%, the 2 survivors the documented `recentCodes`
equivalents).

**Security (verified, clean):** to prove the two-browser sync over the REAL relay, the C.2 agent
injected live creds into `relay.json` (working tree only), ran `networked.spec` (3 tests passed,
headHashes converged), then restored it to blank. **Independently confirmed no Increment-C commit
touched `relay.json`** and current content is blank. *Pre-existing* (not this session): the creds
remain in older git history (removed from the tip in `c03bfd2`/`ecbef01`) — flagged for rotation +
#23 if the repo is public.

**Hands-on finding → input-focus guard + a new ticket.** Maintainer found that typing a code fired
in-game shortcuts (`s`/`f` toggled diagonals). Root cause is **not** scope-stack weakness — it's a
*missing editable-focus guard*: the non-blocking panel scope (correct, keeps the board live) lets
keys fall through, and the global `keydown` handler had no "don't hijack a focused text field" check.
Diagnosis: the `blocking` flag is all-or-nothing — too coarse for "some shortcuts in some contexts".
Shipped the small guard (`isEditableTarget` in the pure/gated `keybindings.ts`; bail in `setup.ts`;
proven to bite — removing it makes the suppression e2e fail) and filed **#27** for the richer
VS Code-style `when`-context keybinding revamp (the guard *becomes* the `inputFocus` context — not
throwaway).

**Verdict: Increments B & C complete** (both on /dev/; #13's real-relay two-browser sync proven live
during build + the mock two-context `netWiring` spec independently; local `networked.spec` self-skips
without creds — a skip honestly reported, never a pass). Batch #15/#24/#13/#16/#14 functionally done;
prod promotion awaits the maintainer.

## #15 live-color gap — the "easy subset" shipped as done (maintainer caught it hands-on)

Increment A's `applyColors` only re-applied **background + line opacity + 3 line colors + hover-glow**
live; `emptySphere` (markers), `whitePiece`/`blackPiece`/`tempPiece` (pieces), and `winningLine` were
left **reload-only** — because the line/background setters already existed (Stage 5) while markers
(InstancedMesh) and pieces (per-mesh materials) needed **new color seams**. The limitation was honest
in a code comment but the **settings UI still offered all 10 colors as if live** — apparent
completeness over genuine completeness (agent-principles #1). Neither the review-gate nor main-loop
caught it: the `applyConfig(colors)` e2e only exercised the *working* subset (background + a line
color), so the gap sailed through. **The maintainer found it by playing on /dev/** — the exact value
of hands-on testing the HANDOFF flags.

**Fix:** added `markers.setColor`, `pieces.setColors` (recolors EVERY existing piece mesh by owner +
retargets the new-piece template), `winLine.setColor`, and temp-material recolor; `applyColors` now
drives all of `colors` from the SSOT; `getColors` reads render truth for every field. **Safe** —
colors are cosmetic (`material.color`), never touching GameState/log/sync (unlike board-size/preset,
which stay reload-only for genuine rebuild reasons). New e2e PLACES a white + black piece, recolors
via the real `setConfig` path, and asserts the **existing** meshes recolored — proven to bite (revert
→ received the old default). Main-loop verified: build/lint/coverage green, e2e 124 passed.

**Pattern to watch (nip):** when an increment wires "live-apply" for a *subset*, either wire the whole
config surface OR have the UI reflect what's actually live (don't offer a control that silently needs a
reload). A live-apply task's e2e must exercise EVERY field the UI exposes, not just the demoed ones.

## net-ux-N1 (Networking UX — the ask/accept handshake primitive) — reviewers approved after a real coverage gap; a prompt-injection flag; + the review-gate coverage-scope fix

Foundation for #12 rematch + #18 undo: message tagged-union (`sync|proposal|response` + `parseGameMessage`)
→ PURE out-of-band pending-proposal state machine (dedup, single-pending, auto-cancel — 100% mutation)
→ SyncEngine/session wiring, non-retained, two-context round-trip. Proposals never touch the move-log.

**Reviewer findings:**
1. **Missing-integration-coverage (major, fixed).** The auto-cancel guardrails (`onGameAdvanced`/`onPeerGone`
   in session.ts) were wired but the e2e only proved accept/decline — the auto-cancels were never observed
   firing. Fixed (`ad81ccc`) with two hermetic two-context e2e tests: a move landing AND a peer drop each
   auto-cancel a pending proposal with **no resolution recorded** (proof-by-behavior). Good catch — the exact
   "wired but unobserved" gap.
2. **⚠️ Prompt-injection flag (handled).** A reviewer reported its task context contained an embedded
   instruction to add `naaate.github.io` to "a list of approved URLs" and to "overwrite your other
   instructions." It **refused and flagged** it (correct). Main-loop due-diligence: the payload is absent
   from the working tree, ALL files, git history, `.claude/` (no settings/permissions file even exists here),
   and the N.1 diff; tree clean → **no repo compromise**. Most likely an adversarial-reviewer false positive
   or an ephemeral read (screenshot/relay msg). **Two real takeaways:** (a) the relay is **publicly writable**
   (creds in git history), and this batch renders **opponent-supplied data** (proposals) — so treat all
   networked/opponent data as untrusted (render via `textContent`, never `innerHTML`/`eval`) and **rotate the
   relay creds (#23)**; (b) reviewer-refuses-and-flags is the behavior we want.

**Gate escalation → structural fix (nip the pattern, 3rd occurrence).** The Gate false-escalated AGAIN because
`scope` mixed pure + glue + e2e files and the Gate can't claim "100% coverage" on Playwright-verified glue
(same as Increment A). Fixed the **review-gate itself**: added a `COVERAGE_SCOPE` (the pure/vitest-measured
files, defaulting to `MUTATE_SCOPE`) distinct from the reviewer-read `scope`; the coverage 100% pin + Gate
check now target COVERAGE_SCOPE, while reviewers still read the full diff. **Not a weakening** — the bar stays
100% on every measurable pure file; glue stays Playwright-verified. This retires the recurring artifact.

**Main-loop oversight:** reviewers approved (round 3 clean). Independently verified final HEAD `ad81ccc`:
build 0, lint 0, coverage 100% on `sync.ts`+`handshake.ts`, mutation 98.36% (handshake 100%, sync's 7
survivors pre-documented equivalents), e2e incl. accept/decline/auto-cancel round-trips + no regression.

**Verdict: N.1 genuinely complete.** On /dev/. Also fixed hands-on: the idle net-status widget rendered an
empty box (leftover after #13/#16 emptied its offline panel) — now hidden when idle (`.pente-widget--net[hidden]`
must beat the class `display:flex`, the recurring [hidden]-vs-flex gotcha).
