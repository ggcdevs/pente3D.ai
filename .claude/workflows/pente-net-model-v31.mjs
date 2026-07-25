export const meta = {
  name: 'pente-net-model-v31',
  description: 'Epic #47 v3.1 networked game-model remodel: delete the code↔game coupling → wire-enforced seeds → resident-peer republish (fixes #45) → narrow fast-forward + LCA/diff/handshake → empty-slate reload + rejoin probe → games list (#37) → scenario matrix → docs. Each task is built, then GATED by pente-review-gate (2 adversarial reviewers + mutation) which pushes only on approval. Sequential TDD; HALTS on a failed task or a failed gate.',
  phases: [
    { title: 'V.1 decouple', detail: 'delete net-room:{code}; activeNetworkedGame breadcrumb (pure)' },
    { title: 'V.2 seeds', detail: 'wire-enforced seed matrix + shared uuid at genesis (#46 #43 #42)' },
    { title: 'V.3 republish', detail: 'resident-peer republish on presence — flips scenario:issue45 GREEN (#45)' },
    { title: 'V.4a reconcile', detail: 'narrow one-move fast-forward + LCA + pretty diff (pure)' },
    { title: 'V.4b resolution', detail: 'resolution handshake + divergence panel (#38)' },
    { title: 'V.5 reload', detail: 'empty-slate reload + rejoin probe/prompts' },
    { title: 'V.6 games-list', detail: 'games list / resume UI (#37)' },
    { title: 'V.7 scenarios', detail: 'CLI scenario matrix + two-context e2e' },
    { title: 'V.8a docs', detail: 'GLOSSARY + diagrams + plan status (no promotion — that is the human call)' },
  ],
}

// ── Wiring ────────────────────────────────────────────────────────────────────────────────────
// The WORKTREE this build runs in. NOT the main checkout: that one is on `dev`, and combined with
// "work in-place, never checkout" a hardcoded path would commit the whole remodel onto dev and push
// it. Overridable via args.repoPath so this file carries no volatile fact (agent-principles #8).
const A = typeof args === 'string' ? JSON.parse(args) : (args || {})
const REPO = A.repoPath || '/home/guy/.config/superpowers/worktrees/pente3D.ai/net-model-v3.1'
/** The review gate to run — the copy in THIS worktree (see the scriptPath note at the call site). */
const GATE_SCRIPT = A.gateScript || `${REPO}/.claude/workflows/pente-review-gate.mjs`
const BRANCH_NOTE =
  'The worktree is already on the correct branch (feat/net-model-v3.1). Work IN-PLACE: do NOT run ' +
  '`git checkout`/`git switch`, do NOT name a branch to switch to, and never push dev/test/main ' +
  '(a pre-push hook refuses them by design while v3.1 is in flight — never bypass it).'
const TRAILER = 'Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>'
// Stages from V.3 on must keep the #45 acceptance test green; before that it legitimately fails.
const SCENARIO_GREEN_FROM = 'V.3'

const DOCTRINE =
  'Read planning/agent-principles.md and obey it (genuine tests, proof-by-behaviour-not-log, never weaken a gate, #7 prove-gates-bite, #8 no hardcoded volatile facts, commit hygiene: reference the issue). PROOF, NOT INFERENCE: run the command, paste real output; if you did not observe it, it is not done. ' +
  BRANCH_NOTE + ' ' +
  'Plan of record: planning/2026-07-25-net-model-v3.1-build-plan.md. Design of record: planning/2026-07-24-net-model-v3.1-design.md (READ IT — it carries the user\'s verbatim rationale). Conventions: CONTRIBUTING.md. Vocabulary: GLOSSARY.md. Architecture: docs/diagrams/. ' +
  'THE v3.1 MODEL (agreed, supersedes the #35 model wherever they differ): a room CODE is PURE RENDEZVOUS; a GAME is a UUID; there is NO mapping between them ANYWHERE. `net-room:{code}` is DELETED. localStorage holds only visited room codes + an `activeNetworkedGame {code,gameUuid,updatedAt}` BREADCRUMB — session state that drives a PROMPT, never an auto-load, cleared on completion, NEVER published. Games live in the IndexedDB archive keyed by UUID (the source of truth); the loaded game is a JS var, not persisted. A tab reload always lands on an EMPTY SLATE. ' +
  'GUARDRAILS (each one is a bug already paid for): (1) NEVER re-introduce a code→game mapping — not in localStorage, not in the archive, and NOT as a retained MQTT message (retained state would re-couple code↔game at the broker and kill room-code reuse, which is the point of the whole design). (2) Seed selection is ENFORCED ON THE WIRE: `new` sends/accepts EMPTY only; `resume`/`current` accept the SAME uuid only; DEALER\'S CHOICE (`defer`) is the ONLY kind that adopts a peer\'s non-empty game; a mismatch is an honest TYPED reject surfaced verbatim, never a silent adoption. (3) The turn gate caps LEGITIMATE drift at EXACTLY ONE MOVE, so the ONLY automatic convergence is a one-move fast-forward; ANY longer prefix or fork goes to last-common-ancestor + diff + an explicit resolution handshake. Never auto-adopt beyond one move. (4) VALIDATE an adopted log by REPLAYING it through the pure rules engine — never trust a sender\'s derived state; reject on the first illegal entry. (5) Seats stay IDENTITY-OWNED on the game; a rejoin DISPLAYS the derived colour and never negotiates one (that is what keeps #31 and #40 closed). (6) Keep src/core PURE (no three/DOM/net/ui). (7) Use src/util/randomId.ts, never crypto.randomUUID (undefined over plain-LAN http; Playwright runs on localhost so it will NOT catch it). (8) Admission stays NON-RETAINED + id-deduped. (9) Leave clean seams for out-of-scope work (#50 authoritative server, #34 random seed, #36 spectator) — never scaffolding presented as done. ' +
  'THE ACCEPTANCE TEST: `npm run scenario:issue45` drives two real CLI peers over the live relay (a peer drops its socket, the other moves, the peer returns). Exit 0 = converged; exit 2 = SKIPPED because the relay is unreachable (not a regression); exit 1 = the bug is present. It fails today on purpose. From task ' + SCENARIO_GREEN_FROM + ' onward it must be 0 (or 2 when there is no egress) and must STAY that way. ' +
  'Also gate cli/: `npm run typecheck:cli` (npm run build typechecks src/ ONLY).'

const TASKS = [
  {
    id: 'V.1', label: 'decouple-code-from-game', refs: '#47 #43',
    stage: 'v31-decouple',
    scope: 'src/net src/persist src/ui/widgets src/debug',
    mutate: 'src/net/activeGame.ts src/net/seats.ts src/ui/widgets/recentCodes.ts',
    desc:
      "READ src/net/session.ts (roomStateId / loadRoomState / persistRoomState / buildProvisionalSeat), src/persist/archive.ts (NET_ROOM_RESULT + the listArchivedGames filter + loadNetGame/loadNetGameByUuid) and src/ui/widgets/recentCodes.ts FIRST. " +
      "DELETE the code→game coupling end to end: roomStateId/loadRoomState/persistRoomState and every caller, the NET_ROOM_RESULT internal marker and the listing filter that existed only to hide it, and buildProvisionalSeat's `defer`-adopts-the-room's-persisted-game branch. This is the ROOT CAUSE of the whole v3 bug cluster — a game+seatmap persisted per room CODE. " +
      "CREATE src/net/activeGame.ts (PURE, shaped exactly like recentCodes.ts — injected `Storage`, defaulting to globalThis.localStorage, `null` forces no-op): read/write/clear the `activeNetworkedGame {code, gameUuid, updatedAt}` breadcrumb plus a staleness predicate over `updatedAt`. It is SESSION state, not a mapping: document that invariant in the module header so nobody 'generalizes' it into a lookup later. " +
      "KEEP src/ui/widgets/recentCodes.ts as the design's `visitedRoomCodes` (same key, do NOT add a second store). " +
      "A `defer`/`new` entry now brings a FRESH empty game; a returning peer re-seeds from the BREADCRUMB'S UUID (archive by uuid), never from the code. Where session.ts used to reload the room game, either seed from the breadcrumb uuid or start empty — no third path. " +
      "PURE → strict TDD + fast-check (breadcrumb round-trips; a cleared breadcrumb reads null; staleness is monotone in updatedAt; no key derivable from a room code) + mutation + 100% coverage. GLUE (session.ts) → keep the existing mock-transport unit tests green and update them honestly; do not delete a test to make a change pass.",
  },
  {
    id: 'V.2', label: 'wire-enforced-seeds', refs: '#47 #46 #43 #42',
    stage: 'v31-seeds',
    scope: 'src/net src/ui/widgets src/debug',
    mutate: 'src/net/admission.ts src/net/sync.ts src/ui/widgets/netPanelModel.ts src/net/activeGame.ts',
    desc:
      "READ src/net/admission.ts (reconcile + electInitiator), src/net/sync.ts (the admission codec + AdmissionReject union) and design §3 FIRST. " +
      "Make `reconcile` the design's SEED MATRIX, enforced on the wire: `new` SENDS and ACCEPTS empty state only and REJECTS a non-empty peer game; `resume`/`current` send their own concrete game and accept only the SAME uuid (reject a different concrete game); `defer` (dealer's choice) is the ONLY kind that adopts a peer's non-empty game. Mismatched seeds (e.g. New vs Current) produce an honest TYPED reject — add the reason(s) to the AdmissionReject union, the codec, and the human-facing copy; surface it VERBATIM (never masked or relabelled). The user's words: \"when selecting 'New Game', i would expect the laptop to never send non-empty gamestate data and i would expect my phone to reject any non-empty gamestate data. only 'Dealer's Choice' should allow a device to accept non-empty gamestate data.\" " +
      "BOTH peers picking `new` are interchangeable → they must converge on ONE shared game uuid at GENESIS via the deterministic initiator election (earlier arrival, then lower playerId). That is the real #42 fix: a genuinely shared UUID from the start, NOT 'converges on the first move'. " +
      "This is also what structurally fixes #46 (New Game pushing a stale code-saved game) and #43 (New Game at a reused code keeping the old board) now that V.1 removed the store they read from. " +
      "PURE → strict TDD + fast-check (reconcile is ORDER-INSENSITIVE: reconcile(a,b) and reconcile(b,a) agree on the same game or the same typed reject; `new` never yields a non-empty agreed game; both-new yields ONE uuid and two DISTINCT seat owners; the election is deterministic under permutation) + negative cases for every reject + mutation + 100% coverage.",
  },
  {
    id: 'V.3', label: 'resident-peer-republish', refs: '#47 #45',
    stage: 'v31-republish',
    scope: 'src/net src/debug cli',
    mutate: 'src/net/republish.ts src/net/presence.ts src/net/admission.ts',
    desc:
      "THIS IS THE #45 FIX AND THE FIRST OBJECTIVE MILESTONE: `npm run scenario:issue45` MUST go from exit 1 to exit 0. Run it BEFORE you start (observe the failure) and AFTER (observe the pass) and paste both. " +
      "READ src/net/session.ts (onPresence, the arbiter handoff, beginEngine), src/net/mqttTransport.ts (the presence handshake: the retained+live announce pair, the `acked` dedup set, PresenceTracker), src/net/presence.ts, src/net/sync.ts (publishState, line ~981) and design §4 FIRST. " +
      "Implement RESIDENT-PEER REPUBLISH ON PRESENCE: when a peer appears, the resident republishes its FULL authoritative log (SyncEngine.publishState() already exists — no new message kind). Idempotent; the returning peer converges. BOTH DIRECTIONS: the returner also publishes its own state, so a resident that missed the returner's last move can fast-forward (design §5 mirror case). Empty room → load our own game by uuid from the breadcrumb and wait. " +
      "CRITICAL, measured on the real relay while building the repro — do NOT trigger only on the `absent→present` presence EDGE: MqttTransport's `acked` set dedupes the live-presence ack per peer and PresenceTracker only notifies when the live SET changes, and an observed ABSENCE is what resets both. If the broker never turned the outage into an absence, there is NO edge and the republish never fires. Trigger on ANY FRESH LIVE PRESENCE from a peer (surface that signal from the transport if it is not already observable), and make the republish idempotent + rate/id-limited so repeats are harmless. " +
      "Do NOT use retained MQTT state as the convergence mechanism — that was considered and REJECTED because a retained per-room message re-couples code↔game at the broker. " +
      "PURE → new src/net/republish.ts holding the decision (who republishes, on what signal, with what limiter): strict TDD + fast-check (idempotence under repeated signals; never republishes when we hold no game; the limiter cannot starve a genuine second return) + mutation + 100% coverage. GLUE → session.ts/mqttTransport.ts wiring, proven by the CLI scenario + the mock-transport unit tests. " +
      "Verify with `npm run scenario:issue45` (exit 0 required; exit 2 means the relay was unreachable — say so plainly and do NOT claim the fix is proven) and `npm run typecheck:cli`.",
  },
  {
    id: 'V.4a', label: 'reconcile-decision-lca-diff', refs: '#47 #38',
    stage: 'v31-reconcile-pure',
    scope: 'src/net src/core',
    mutate: 'src/net/reconcile.ts src/net/logDiff.ts src/net/sync.ts',
    desc:
      "PURE ONLY (the handshake + UI are V.4b — do not start them). READ src/net/sync.ts (decideSync ~527 and decideSyncEpoched), src/core/eventLog.ts (the hash chain, isPrefix, firstDivergence), src/core/hash.ts and design §5 FIRST. " +
      "Replace `decideSync`'s blanket 'adopt ANY strict extension' with the v3.1 policy, in a new PURE module src/net/reconcile.ts: (a) identical headHash → play on; (b) AUTO FAST-FORWARD — and this is the ONLY automatic case — my log says it is THEIR turn AND their log is EXACTLY ONE move longer AND my log is its prefix → adopt; (c) I am exactly one ahead (my move never published) → republish, do not adopt; (d) EVERYTHING ELSE (a longer prefix, or a genuine fork) → `needs-resolution` carrying the LAST COMMON ANCESTOR and a diff. Rationale (design): the turn gate caps LEGITIMATE drift at exactly one move, so anything beyond it is already anomalous and must never be auto-adopted. " +
      "LCA: walk both hash chains back to the last matching hash — free by construction, no search. Diff: a PURE pretty-printer (src/net/logDiff.ts) rendering 'shared history up to ply N, then mine: … / theirs: …' in terms a player can read (coordinates and colours, not hashes). Keep the epoch layer (decideSyncEpoched) working — a rematch generation still wins outright. " +
      "REPLAY-VALIDATE: adopting a log must fold it through the pure rules engine (placePiece) and reject on the first illegal entry; a sender's derived state is never trusted. Put that validation here as a pure function so it is mutation-gated. " +
      "Strict TDD + fast-check (the ONLY inputs yielding fast-forward are exactly-one-longer-and-prefix-and-their-turn — property-test the complement to prove nothing else auto-adopts; LCA is symmetric and equals the shorter log when one is a prefix; diff round-trips the two logs it describes; replay rejects any tampered entry) + mutation + 100% coverage. Wire it into the SyncEngine only as far as the decision seam; the resolution PROTOCOL is V.4b.",
  },
  {
    id: 'V.4b', label: 'resolution-handshake-and-panel', refs: '#47 #38',
    stage: 'v31-resolution',
    scope: 'src/net src/ui/widgets src/debug e2e',
    mutate: 'src/net/handshake.ts src/net/reconcile.ts src/ui/widgets/divergenceModel.ts',
    desc:
      "GLUE + a pure view-model. READ src/net/handshake.ts (the N.1 out-of-band ask/accept primitive used by rematch/undo), src/net/session.ts (setHandshake / applyAcceptedUndoRedo / the conflict phase), src/ui/widgets/endStateOverlay.ts + netPanel.ts for the existing overlay/panel idiom, and V.4a's reconcile.ts FIRST. " +
      "Turn `needs-resolution` into an explicit, mutual RESOLUTION HANDSHAKE reusing the N.1 primitive (do NOT invent a second handshake): actions for take-mine / take-theirs / rewind-to-LCA. Nothing lands until BOTH sides agree; a decline or a peer-gone auto-cancel leaves both games untouched (the same guarantee #18 has). The adopted log is REPLAY-VALIDATED (V.4a) before it is applied. " +
      "UI: a divergence panel showing the pretty diff + the choices. PURE view-model (src/ui/widgets/divergenceModel.ts) → mutation-gated; DOM half → Playwright. This is a COLLABORATION POINT: the user will want to tune the copy and layout, so keep the wording plain and the structure simple rather than clever — it must not read like a git merge conflict. Do NOT block on perfect copy. " +
      "The old `phase: 'conflict'` dead-end (a fork simply stopped the game) is REPLACED by this flow: a divergence is now recoverable. Make sure the honest failure path still exists for a log that fails replay-validation (that is a reject, not a resolution). " +
      "Playwright two-context spec: force a 2-move divergence, assert BOTH contexts show the panel with the same LCA ply, accept one resolution, assert both logs converge to the SAME headHash via window.__pente (proof-by-state). Prove the gate bites. Re-run networked specs with --workers=1 before believing any failure.",
  },
  {
    id: 'V.5', label: 'empty-slate-reload-and-rejoin-probe', refs: '#47',
    stage: 'v31-reload',
    scope: 'src/net src/ui/widgets src/persist src/debug e2e',
    mutate: 'src/ui/widgets/rejoinPromptModel.ts src/net/activeGame.ts',
    desc:
      "READ src/main.ts (AUTOSAVE_ID_KEY and the boot restore), src/net/session.ts (enter/reconnect), src/net/activeGame.ts (V.1) and design §6 FIRST. " +
      "(1) A tab reload ALWAYS lands on an EMPTY SLATE — stop auto-restoring the autosave game on boot. Games are not lost: they are durable in the archive by UUID and reachable from the games list (V.6). The user's words: \"if you restart (i.e.: reload the tab), you should always get dropped back to the main page with an empty slate/board\". " +
      "(2) If the breadcrumb exists, PROBE the room on load (connect, check presence, compare the waiting peer's game uuid from its `hello`) and OFFER — never auto-load: peer present with the SAME uuid → 'Rejoin DUDEEE as Black?' where the colour is DERIVED from the game's seat map (displayed, never negotiated — that is what keeps #31/#40 closed); peer present with a DIFFERENT uuid → warn, do not hijack ('Do you want to restart your last DUDEEE game with a new code?'); room empty → 'You were playing DUDEEE, but no one is there anymore. Rejoin as Black anyway?' (rejoin and wait). Declining CLEARS the breadcrumb; a stale updatedAt expires quietly. If the game ended while we were away we rejoin, adopt, see the result, and the breadcrumb clears — the flow self-heals. " +
      "PURE src/ui/widgets/rejoinPromptModel.ts: `deriveRejoinPrompt(probe) → view-model` (strict TDD + fast-check over the probe cases + mutation + 100%). GLUE: the probe itself, the DOM prompt, main.ts boot. Playwright: reload lands empty; each of the three probe outcomes renders its prompt; declining clears the breadcrumb (assert via window.__pente / storage, not a log). COLLABORATION POINT: the copy — keep it plain, the user will tune it.",
  },
  {
    id: 'V.6', label: 'games-list-resume-ui', refs: '#47 #37',
    stage: 'v31-games-list',
    scope: 'src/ui/widgets src/persist src/net src/debug e2e',
    mutate: 'src/ui/widgets/archiveModel.ts src/ui/widgets/netPanelModel.ts',
    desc:
      "READ src/ui/widgets/archive.ts + archiveModel.ts (the existing widget — EXTEND it, do not start fresh; the user: \"we do already have some of that, but whatever extension you think it needs for 3.1 let's build\"), src/persist/archive.ts (listArchivedGames, loadNetGameByUuid) and design §10 FIRST. " +
      "With reload → empty slate (V.5) and no code→game mapping (V.1), the games list is now the ONLY route back to a game — a behaviour gap this design CREATES, which is why #37 is in scope. Scope the extension to exactly what the model requires: browse FINISHED and UNFINISHED games, resume by UUID, and seed the Resume selector in the net panel from the same list. Note that V.1 deleted the internal room-state records, so the listing no longer needs to filter them out — confirm no user-facing game is now hidden or duplicated. " +
      "PURE model (sorting, grouping finished/unfinished, the resume selection, empty states) → strict TDD + fast-check + mutation + 100%. DOM + Playwright for the widget: create two games, finish one, assert both are listed with the right state, resume the unfinished one by uuid and assert the board matches via window.__pente (+ a screenshot artifact). Do NOT ship a control that does nothing.",
  },
  {
    id: 'V.7', label: 'scenario-matrix', refs: '#47 #45 #46 #40',
    stage: 'v31-scenarios',
    scope: 'cli e2e src/net src/debug',
    mutate: 'src/net/reconcile.ts src/net/republish.ts src/net/admission.ts',
    desc:
      "GLUE — the cross-component proof. Component gates have missed wiring before (#35 passed at 98% mutation while the durable seat map was silently not wired); this task exists so v3.1 does not repeat it. " +
      "READ cli/scenarios/harness.ts + issue45-reconnect-resync.ts (the established pattern: real daemons, own state dirs/identities/DBs, assertions on the daemon's own snapshot, `requireRelay()` preflight so a missing relay exits 2 not 1) and design §8 FIRST. " +
      "ADD CLI scenarios, one file each, each with an npm script: (a) CODE REUSE with New Game — play a game at code X, both peers start a NEW game at the SAME code X, assert the board is EMPTY on both and the game uuid CHANGED (#46/#43, the behaviour the deleted net-room record used to break); (b) REMATCH then RECONNECT — rematch (colours alternate), a peer drops and returns, assert it comes back on its POST-swap colour and both agree (#40's behaviour under the new model); (c) BOTH ABSENT then return — both peers drop, one returns and waits, then the other; assert they converge on the same headHash with seats intact; (d) THE FF-vs-DIFF BOUNDARY — exactly ONE missed move converges AUTOMATICALLY, TWO missed moves produce `needs-resolution` with the correct LCA ply and NO silent adoption. (d) is the sharpest test in the suite: it proves the narrow auto-path is actually narrow. " +
      "Also add a `scenario:all` script that runs every scenario and reports pass/fail/skipped per scenario with a non-zero exit if any FAILED (skipped-for-no-relay must not fail the run). " +
      "Two-context Playwright: seed-mismatch reject copy, the empty-slate reload, the rejoin prompts, the divergence panel — assert on window.__pente state, never logs; re-run with --workers=1 before believing a failure. PROVE THE GATES BITE: for at least the republish and the FF-boundary, temporarily break the implementation and show the scenario FAILS, then restore (paste both outputs).",
  },
  {
    id: 'V.8a', label: 'docs-glossary-diagrams', refs: '#47',
    stage: 'v31-docs',
    scope: 'planning docs src cli',
    mutate: '',
    desc:
      "DOCS ONLY — no behaviour changes. (1) GLOSSARY.md: fold in the v3.1 vocabulary (rendezvous code vs game uuid, the activeNetworkedGame BREADCRUMB and why it is not a mapping, seed kinds and their wire semantics, resident-peer republish, last common ancestor, resolution handshake, the link-vs-phase distinction the CLI exposes). (2) `npm run diagrams` then `npm run diagrams:check` — CI staleness-checks diagrams on test/main only, so they must be regenerated HERE or the eventual promotion goes red. (3) Update planning/2026-07-25-net-model-v3.1-build-plan.md marking V.1–V.7 done with their commit SHAs, and note anything that turned out differently from the plan (honestly — a plan that lies about what was built is worse than no plan). (4) Update HANDOFF.md §1/§2 to describe the state v3.1 actually reached. " +
      "Do NOT promote anything: the behavioural re-review of #40/#31/#41/#33/#34/#36, #49, and the dev→test→main promotion are the USER'S calls (the pre-push hook blocks those branches anyway). List for the user, in one place, what remains before promotion.",
  },
]

const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['task', 'completed', 'unitTestsPassing', 'lintPassing', 'buildPassing', 'cliTypecheckPassing', 'committed'],
  properties: {
    task: { type: 'string' }, completed: { type: 'boolean' },
    unitTestsPassing: { type: 'boolean' }, playwrightPassing: { type: 'boolean' },
    lintPassing: { type: 'boolean' }, buildPassing: { type: 'boolean' },
    cliTypecheckPassing: { type: 'boolean' },
    // 'n/a' only for tasks before V.3, where the repro legitimately still fails.
    scenarioIssue45: { type: 'string', enum: ['pass', 'fail', 'skipped-unreachable', 'n/a'] },
    committed: { type: 'boolean' }, commitSha: { type: 'string' },
    windowPenteAdded: { type: 'string' }, gateBitesProof: { type: 'string' },
    deviationsFromPlan: { type: 'string' }, notes: { type: 'string' },
  },
}

const results = []
let halted = null

for (const t of TASKS) {
  const phaseTitle = meta.phases.find((p) => p.title.startsWith(t.id))?.title ?? t.id
  phase(phaseTitle)

  const scenarioRule = t.id === 'V.1' || t.id === 'V.2'
    ? `\`npm run scenario:issue45\` still fails at this task (V.3 is the fix) — report it as 'fail' honestly; do NOT "fix" it early or weaken it.`
    : `\`npm run scenario:issue45\` MUST exit 0 (or 2 if the relay is unreachable — then say so plainly and do not claim it proven). If it fails, your task is NOT done.`

  const build = await agent(
    `You implement Task ${t.id} (${t.label}) of the Pente3D v3.1 networked game-model remodel (epic #47). Worktree: ${REPO} — work there, in-place.\n\n` +
      `${DOCTRINE}\n\n` +
      `TARGET: ${t.desc}\n\n` +
      `Separate PURE logic (decisions, matrices, LCA/diff, view-models — no DOM/THREE/transport) from GLUE (session wiring, transport, DOM, e2e). Pure → strict TDD (Vitest) + fast-check + Stryker + a 100% coverage pin. Glue → Playwright driving the real app asserting window.__pente REAL VALUES (+ screenshot artifacts), or the CLI scenarios asserting real daemon state — NEVER log lines. Reuse what exists (src/core, src/net, src/persist, src/ui, cli/) — DRY; do not rebuild the transport, the sync engine, or the rules core.\n\n` +
      `VERIFY before committing, pasting real output: \`npm run build\` (tsc --noEmit + vite; a green \`npm test\` does NOT imply a green build), \`npm run lint\` (0 warnings), \`npm test\`, \`npm run typecheck:cli\`, the relevant \`npm run e2e\` spec, and ${scenarioRule}\n` +
      `Then COMMIT (conventional message describing the change + referencing ${t.refs}, trailer \`${TRAILER}\`). Do NOT push — the review gate pushes after approval. Return structured evidence only; no conclusion without observed output. If you had to deviate from the plan, say so in deviationsFromPlan rather than quietly diverging.`,
    { label: `build:${t.id}-${t.label}`, phase: phaseTitle, schema: BUILD_SCHEMA }
  )

  if (!build) {
    halted = { at: t.id, why: 'build agent returned null (failed or died)' }
    log(`HALT at ${t.id}: build failed. Dependents are NOT built on a gap. Fix, then resume with resumeFromRunId.`)
    break
  }
  log(`${t.id} build: build=${build.buildPassing} unit=${build.unitTestsPassing} lint=${build.lintPassing} cli-tsc=${build.cliTypecheckPassing} scenario45=${build.scenarioIssue45 ?? 'n/a'} sha=${build.commitSha || '—'}`)

  // Objective milestone: from V.3 on, the #45 acceptance test must be green (or honestly skipped).
  if (t.id === SCENARIO_GREEN_FROM && build.scenarioIssue45 === 'fail') {
    halted = { at: t.id, why: 'scenario:issue45 still FAILS after the republish task — the #45 fix is not proven, so nothing may be built on top of it' }
    log(`HALT at ${t.id}: the acceptance test did not go green.`)
    break
  }

  // ── Gate this task before the next one starts (2 adversarial reviewers + mutation; pushes on
  // approval, plus a per-stage marker ref so the stage is separately playable at /<branch>/).
  //
  // Invoked by scriptPath, NOT by name: a name resolves through the registry rooted at the
  // SESSION's cwd — the main checkout, which is on `dev` and still carries the pre-repoPath gate.
  // That copy hardcodes its own repo path, so it would cheerfully gate and push dev. Pin the gate
  // that lives in THIS worktree, next to the code it is gating.
  const gate = await workflow({ scriptPath: GATE_SCRIPT }, {
    repoPath: REPO,
    stage: t.stage,
    scope: t.scope,
    mutateScope: t.mutate || t.scope,
    marker: `wip/v31-${t.id.toLowerCase().replace('.', '')}`,
  })

  results.push({ id: t.id, label: t.label, build, gate })
  const gatePassed = gate && gate.gate && gate.gate.passed && gate.approvedByReviewers
  log(`${t.id} gate: passed=${gate?.gate?.passed} approved=${gate?.approvedByReviewers} rounds=${gate?.reviewRounds} pushed=${gate?.gate?.pushedRange || 'no'}`)
  if (!gatePassed) {
    halted = { at: t.id, why: `review gate did not pass+approve (passed=${gate?.gate?.passed} approved=${gate?.approvedByReviewers}); unfixed findings are in the gate result` }
    log(`HALT at ${t.id}: gate blocked. Later tasks would be built on unreviewed/failing work.`)
    break
  }
}

return {
  epic: '#47',
  repo: REPO,
  completed: results.map((r) => ({ id: r.id, sha: r.build?.commitSha, pushed: r.gate?.gate?.pushedRange, marker: r.gate?.gate?.markerPushed })),
  halted,
  scenarioIssue45AtEnd: results.length ? results[results.length - 1].build?.scenarioIssue45 : null,
  deviations: results.map((r) => r.build?.deviationsFromPlan).filter(Boolean),
  remainingForHuman: 'Behavioural re-review of #40/#31/#41/#33/#34/#36, #49 colour preference, UI copy for the divergence panel + rejoin prompts, and the dev→test→main promotion (pre-push hook blocks those branches by design).',
}
