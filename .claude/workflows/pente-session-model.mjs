export const meta = {
  name: 'pente-session-model',
  description: 'Epic #35 networked session model (closes #31): shared game-UUID at genesis → identity-owned durable seats → pure admission/reconciliation → proposal messages → NetSession.enter() protocol → unified seed-selector UI → two-context scenario e2e. Sequential TDD; HALTS on a failed task.',
  phases: [
    { title: 'Build', detail: 'S.1 game-uuid → S.2 seats → S.3 admission → S.4 messages → S.5 enter() → S.6 UI → S.7 scenarios e2e; HALT on failure' },
    { title: 'Verify', detail: 'build + lint + unit + Playwright (two-context scenarios incl. both-Join regression) + coverage; no push' },
  ],
}

const REPO = '/home/guy/code/git/github.com/ggcdevs/pente3D.ai'
const TRAILER = 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>'
const DOCTRINE =
  'Read planning/agent-principles.md and obey it (genuine tests, proof-by-behavior-not-log, never weaken a gate, #7 prove-gates-bite, #8 no hardcoded volatile facts, commit hygiene: reference the issue). PROOF, NOT INFERENCE: run the command, paste real output; if not observed, it is not done. ' +
  'Work IN-PLACE on the CURRENTLY CHECKED-OUT branch — do NOT run `git checkout`/`git switch` or otherwise change branches, and never name a branch to switch to; commit where you are. ' +
  'Plan of record: planning/2026-07-23-networked-session-model-build-plan.md. Design: planning/2026-07-23-networked-session-model-design.md. Networking design: planning/2026-07-18-networking-poc-design.md. Architecture overview: docs/diagrams/. ' +
  'MODEL (locked): a room CODE is only a rendezvous channel (identifies no game); a GAME is a UUID-identified entity, portable across rooms/partners. Seats are IDENTITY-OWNED and durable IN the persisted game (reclaim-by-playerId, validate-by-headHash, reserve vacated seats: "room full" = both seats OWNED even if an owner is absent). Decentralized "Model A": NO retained seat-map on the relay; empty room → first returning owner re-seeds from its own game; simultaneous arrival → initiator election (earlier live-presence arrival, then lower playerId). First-available + tiebreak fire ONLY at genuine game creation. ' +
  'GUARDRAILS: keep src/core PURE (no three/DOM/net/ui). DELETE the HOST_PLACEHOLDER sentinel — every seat owner is a real playerId or null. Admission messages NON-RETAINED + id-deduped (a reconnect must not replay a stale proposal). Reject honestly with TYPED reasons (room-full/seat-reserved/game-mismatch/game-divergent) surfaced to the UI — never mask/mislabel. Do NOT change the Transport. Reconnect (stable playerId reclaim) must keep working. Spectator (#36), randomized seed (#34), games-list (#37) and merge/diff (#38) are OUT OF SCOPE for this build — leave clean seams, no scaffolding presented as done.'

const TASKS = [
  {
    id: 'S.1', label: 'game-uuid-at-genesis',
    refs: '#35',
    desc: "READ src/core/game.ts, src/core/eventLog.ts (the genesis entry + hash-chain), src/core/serialize.ts (GameExport), src/persist/db.ts (GameRecord.id — currently only a LOCAL archive key), src/persist/archive.ts (GameMeta), src/util/randomId.ts FIRST. Mint a GAME UUID at game creation and carry it IN the event-log genesis so it participates in the hash-chain (two peers referencing 'the same game' becomes verifiable; headHash equality then implies same-game-and-history). Thread the uuid through serialize/GameExport and archive GameMeta. Games loaded WITHOUT a uuid (legacy/local) get a freshly-minted one lazily on load (they were never networked, so a fresh id is correct). Reuse randomId.ts (insecure-context-safe; guard crypto.randomUUID). PURE → strict TDD (Vitest) + fast-check (uuid stable across serialize round-trip; two fresh games have distinct uuids AND distinct headHashes; a resumed game keeps its uuid) + Stryker mutation + 100% coverage. No net/DOM imports.",
  },
  {
    id: 'S.2', label: 'identity-owned-seats',
    refs: '#35 #31',
    desc: "READ src/net/seats.ts (claimSeat, SeatMap) and src/net/session.ts (start() and the HOST_PLACEHOLDER sentinel ~line 246) FIRST. Make the seat map an identity-owned property of the GAME: `{ white: playerId|null, black: playerId|null }` populated with REAL playerIds. DELETE HOST_PLACEHOLDER. Pure seat logic in seats.ts: identity-reclaim (a playerId that already owns a seat gets it back), first-available white-preferred ONLY when a seat is null, RESERVE vacated seats (an owner's seat is not reassignable to a different playerId), room-full = both seats owned by OTHER playerIds. This is the change that makes two Joiners NOT collide on black (they get distinct seats). PURE → strict TDD + fast-check (both-join yields distinct seats; reclaim is idempotent; a reserved seat rejects a foreign claimant; room-full rejects a 3rd distinct player) + mutation + 100% coverage. Persistence WIRING of the seat map onto the game is S.5 — keep this task pure.",
  },
  {
    id: 'S.3', label: 'admission-reconciliation',
    refs: '#35',
    desc: "CREATE src/net/admission.ts — the PURE heart of the protocol. A seed PROPOSAL is one of: {kind:'new'} | {kind:'resume'|'current', uuid, headHash} | {kind:'defer'} (Random #34 is out of scope). Implement `reconcile(a: Proposal, b: Proposal): AgreedGame | Reject` per the matrix (design §5): 0 concrete (both defer) → new game; 1 concrete → play it (deferrer adopts); 2 concrete same uuid+matching headHash → resume; 2 concrete same uuid + divergent headHash → Reject 'game-divergent'; 2 concrete different uuid → Reject 'game-mismatch'. Two 'new'/empty proposals are interchangeable — pick deterministically, never block. Implement `electInitiator(peers): playerId` (earlier live-presence arrivalOrder, then lower playerId). Typed reject reasons. PURE → strict TDD + fast-check (reconcile is order-insensitive: reconcile(a,b) and reconcile(b,a) agree on the same game or the same typed reject; a resolved AgreedGame always has two DISTINCT seat owners; election is deterministic) + mutation + 100% coverage. No net/DOM imports beyond types.",
  },
  {
    id: 'S.4', label: 'admission-messages',
    refs: '#35',
    desc: "READ src/net/sync.ts (the existing GameMessage tagged union `kind: 'sync'|'proposal'|'response'` and parseGameMessage) FIRST. Add DISTINCT admission message kinds (do NOT overload the in-game 'proposal'/'response' handshake used by rematch/undo): e.g. `{kind:'hello', playerId, proposal, arrivalTag}`, `{kind:'admit', game, seats}`, `{kind:'reject', reason}`. Extend parseGameMessage to discriminate + VALIDATE each new shape, rejecting malformed/unknown/missing-field (test the negatives). Each admission message carries a UNIQUE id and is deduped on receive; existing 'sync'/'proposal'/'response' traffic round-trips UNCHANGED. PURE → strict TDD + negatives + fast-check (dedup idempotence) + mutation + 100% coverage. Do NOT touch the Transport.",
  },
  {
    id: 'S.5', label: 'net-session-enter',
    refs: '#35 #31',
    desc: "GLUE. READ src/net/session.ts (host/join/start/reconnect, ~line 246), src/net/appSession.ts, src/net/presence.ts (PresenceTracker) FIRST. Replace host()/join()/role-based preferredColor seeding with ONE `enter(code, proposal)` that drives the protocol: subscribe, announce a 'hello' (S.4), wait a short PRESENCE SETTLE WINDOW, then branch — (a) resident established → send proposal, resident validates via admission.ts (reclaim-by-identity + headHash) → admit/reject; (b) truly alone → establish the room from own proposal (new→mint game+uuid+claim white as first owner; resume/current→re-seed persisted game, reclaim owned seat); (c) two arrived together → electInitiator; initiator runs reconcile() and publishes the agreed game(uuid+log)+seat map; the other validates & adopts or rejects. Persist the game uuid (S.1) + seat map (S.2) onto the session game. Reclaim-by-identity + reserve seats. KEEP reconnect() working (stable playerId reclaims its seat). Expose on window.__pente: seat owners, game uuid, and last admission reject reason (for e2e). GLUE → mock-transport unit tests for the state transitions + it is proven end-to-end in S.7. Run build/lint/test. Do NOT reimplement the Transport or the sync/log.",
  },
  {
    id: 'S.6', label: 'unified-seed-selector-ui',
    refs: '#35',
    desc: "READ src/ui/widgets/netPanel.ts + src/ui/widgets/netPanelModel.ts FIRST. Replace the Host-vs-Join UX with ONE 'join game code' input + a SEED SELECTOR: New / Resume (from persisted games — a simple list is fine; the rich games-list is #37) / Current local board / Dealer's choice (defer). Randomized (#34) is out of scope — omit it (do NOT stub a dead control). Put selection/canonicalization logic in the PURE netPanelModel (TDD + fast-check + mutation + 100%); DOM wiring is glue → Playwright. Wire the chosen proposal into NetSession.enter() (S.5). Fold the new vocabulary (room/code, game UUID, seed proposal, initiator election, reserved seat) into GLOSSARY.md. If S.5 didn't already, expose the needed window.__pente readouts. GLUE + pure model. Run build/lint/test + the netPanel e2e.",
  },
  {
    id: 'S.7', label: 'two-context-scenarios-e2e',
    refs: '#35 #31',
    desc: "GLUE — the cross-component integration proof (component gates previously missed wiring; this must not repeat). CREATE e2e/sessionModel.spec.ts driving TWO isolated browser contexts (distinct playerIds) via the injected MockTransport (window.__penteNetTransportFactory). One test per scenario (design §6): (1) A,B enter then C enters → C rejected room-full; (2) A,B; B drops+rejoins → resumes black; (3) A drops+rejoins → resumes white; (4) both drop, B rejoins then A rejoins → seats preserved; (5) A drops, C enters claiming A's spot → rejected. PLUS the #31 REGRESSION: both peers choose the SAME code and 'defer'/'new' (the old both-Join) → they get DISTINCT seats (one white, one black), asserting on BOTH contexts' window.__pente seat + game uuid + headHash (proof-by-state, NEVER logs). PROVE THE GATE BITES: temporarily restore the old role-based seeding and show the both-Join test FAILS, then restore. Report whether the real relay was exercised (self-skips without creds). Run the full npm run e2e.",
  },
]

const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['module', 'completed', 'unitTestsPassing', 'playwrightPassing', 'lintPassing', 'buildPassing', 'committed'],
  properties: {
    module: { type: 'string' }, completed: { type: 'boolean' },
    unitTestsPassing: { type: 'boolean' }, playwrightPassing: { type: 'boolean' },
    lintPassing: { type: 'boolean' }, buildPassing: { type: 'boolean' }, committed: { type: 'boolean' },
    commitSha: { type: 'string' }, windowPenteAdded: { type: 'string' },
    gateBitesProof: { type: 'string' }, notes: { type: 'string' },
  },
}
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['buildPassed', 'lintPassed', 'unitTestsPassed', 'playwrightPassed'],
  properties: {
    buildPassed: { type: 'boolean' }, lintPassed: { type: 'boolean' },
    unitTestsPassed: { type: 'boolean' }, playwrightPassed: { type: 'boolean' },
    unitTestCount: { type: 'number' }, bothJoinRegressionProven: { type: 'boolean' },
    pureLogicFiles: { type: 'string' }, pureLogicCoveragePct: { type: 'number' }, ioBoundaryNotes: { type: 'string' },
  },
}

phase('Build')
const results = []
let halted = null
for (const t of TASKS) {
  const r = await agent(
    `You implement Task ${t.id} (${t.label}) of the Pente3D networked session-model build (epic #35, closes #31). Repo: ${REPO}.\n\n` +
      `${DOCTRINE}\n\n` +
      `Target: ${t.desc}\n\n` +
      `Separate PURE logic (game-uuid, seat ownership, admission/reconciliation, message parsing — no DOM/THREE/transport) from GLUE (NetSession.enter wiring, netPanel DOM, two-context e2e). Pure → strict TDD (Vitest) + fast-check + Stryker mutate scope + 100% vite coverage pin. Glue → Playwright driving the real app, asserting window.__pente real values + screenshots (and for networking, the OTHER context actually receiving over the relay), NEVER log lines. Reuse existing src/net (Transport, SyncEngine, session, presence, seats) and src/core — DRY; do not rebuild the transport or the sync/log.\n\n` +
      `Run \`npm run build\` (tsc --noEmit typecheck + vite build — exit 0; the typecheck catches TS errors in *.test.ts and glue that vitest's transpile does NOT — a green \`npm test\` does NOT imply a green build), \`npm run lint\` (exit 0), \`npm test\` (unit), and the relevant \`npm run e2e\` spec. When ALL green + lint-clean, COMMIT (conventional message referencing ${t.refs} + trailer \`${TRAILER}\`). Do NOT push. Return structured evidence only (no conclusions without observed command output).`,
    { label: `build:${t.id}-${t.label}`, phase: 'Build', schema: BUILD_SCHEMA }
  )
  results.push({ id: t.id, r })
  if (!r) {
    halted = t.id
    log(`HALT: Task ${t.id} (${t.label}) returned null (failed) — stopping so dependents aren't built on a gap. Re-run this task, then resume.`)
    break
  }
  log(`Task ${t.id} (${t.label}): build=${r.buildPassing} unit=${r.unitTestsPassing} pw=${r.playwrightPassing} lint=${r.lintPassing} committed=${r.committed} ${r.commitSha || ''}`)
}

if (halted) {
  return { halted, completed: results.filter((x) => x.r).map((x) => x.id), note: `Build halted at ${halted}; verify skipped. Fix the failed task and resume.` }
}

phase('Verify')
const verify = await agent(
  `Build-verification for the Pente3D networked session model (epic #35). Repo ${REPO}. ${DOCTRINE}\n` +
    `Run and PASTE real output: \`npm run build\` (tsc typecheck + vite build — exit 0; a green unit suite does NOT imply a green build), \`npm run lint\` (0), \`npm test\` (unit — all pass, note count), \`npm run e2e\` (Playwright — all pass, INCLUDING the two-context scenario specs and the both-Join regression; report whether a two-context round-trip was observed or self-skipped without a broker), \`npm run coverage\`.\n` +
    `Report coverage for the PURE logic (game-uuid, seats, admission/reconciliation, message parse) vs the NetSession/netPanel glue — the review-gate will set mutateScope to the pure files. Confirm the both-Join regression (#31) asserts distinct seats on BOTH contexts. Do NOT push. Return structured evidence.`,
  { label: 'verify:session-model', phase: 'Verify', schema: VERIFY_SCHEMA }
)

return { tasks: results, verify }
