/**
 * # Scenario: the FAST-FORWARD boundary — one entry behind converges itself, two do NOT
 *
 * Task **V.7** (epic #47, absorbs **#38**), driven end-to-end over the REAL relay by two CLI peers.
 *
 * ## What is on trial
 *
 * v3.1's whole reconciliation policy rests on one claim: the automatic path is **narrow**. The turn
 * gate caps *legitimate* drift at exactly one move — if it is your turn they cannot move; if it is
 * theirs they move once and are then blocked — so a single missed move is the ordinary case and gets
 * adopted silently (design §5.2, the user's *"they should be able to at least reasonably play their
 * turn while you step away"*). Anything longer is already anomalous and must go to last-common-
 * ancestor + diff + an explicit handshake (§5.3).
 *
 * A test that only proves the FIRST half would be satisfied by v3's blanket "adopt any strict
 * extension", which is the behaviour v3.1 exists to remove. So this scenario runs BOTH sides of the
 * boundary against the same pair, in one continuous game:
 *
 *   **Part 1 — one entry behind.** The peer drops, misses ONE move, returns → it must catch up with
 *   NO divergence card, NO handshake, and end up on the same head as the resident.
 *
 *   **Part 2 — two entries behind.** The same peer drops again; while it is away the resident plays a
 *   move and then TAKES IT BACK. Two entries appended (an undo is an appended event), the returner's
 *   log still a strict PREFIX of the resident's — one entry more than the automatic rule allows. It
 *   must NOT be adopted: both peers must open a divergence at the correct last common ancestor, and
 *   the returner's head must be *byte-identical* to what it was before it returned.
 *
 * Two *moves* cannot be missed between two honest peers — the turn gate blocks the second — which is
 * exactly why anything past one is anomalous. Nothing here is forged: every entry is one the real
 * rules engine produced from a real verb.
 *
 * ## What part 2 does and does not isolate (observed, not assumed)
 *
 * `reconcile`'s automatic arm has TWO load-bearing conditions — the one-entry cap AND the
 * entitlement rule ("my own log says that entry was theirs to add"). Widening the cap alone was
 * watched NOT to change this scenario's outcome: the tail here ends in an `undo` of a move the
 * behind peer itself made last, which entitlement refuses on its own. Restoring v3's actual rule —
 * blanket "adopt any strict extension", both conditions gone — WAS watched flipping it, silently
 * adopting and moving the returner's head. So this asserts the narrow arm AS A WHOLE, which is what
 * the design's guarantee is; no honest pair of verbs can produce a two-entry extension that ends on
 * an entitled entry, because who may append entry *n* alternates with the position.
 *
 * ## What it asserts (the gate)
 *
 * Part 1: `ply` advanced, the missed stone is on the board, `divergence` is `null` on both, heads
 * equal, and the returner may play. Part 2: `divergence` on BOTH at `sharedPly` = the LCA, the
 * returner's `mine` side EMPTY and `theirs` naming exactly the two entries it never heard, and its
 * `headHash` UNCHANGED across the return — the observable form of "no silent adoption".
 *
 * Run: `npm run scenario:ff-boundary` (needs egress to the relay; exit 2 = relay unreachable,
 * `SCENARIO_VERBOSE=1` tees the daemons' live boards).
 */
import { generateGameCode } from '../../src/ui/widgets/netModel';
import {
  check,
  log,
  report,
  requireRelay,
  showBoard,
  sleep,
  startPeer,
  statusOf,
  stopAll,
  tryVerb,
  verb,
  waitFor,
} from './harness';

/** The shared opening — distinct nodes, so a capture never muddies the ply arithmetic. */
const WHITE_1 = '2,2,2';
const BLACK_1 = '0,4,0';
/** The ONE move missed in part 1 (white's, played while black is away). */
const MISSED_MOVE = '4,0,4';
/** Black's reply after it has caught up, which hands the turn back to white for part 2. */
const BLACK_2 = '0,0,4';
/** The move white plays and then TAKES BACK in part 2 — two log entries, one board change. */
const TAKEN_BACK = '4,4,4';

/** Time for a state with no blocking verb to propagate over the real relay. */
const SETTLE_MS = 5000;

async function main(): Promise<number> {
  await requireRelay();
  const code = generateGameCode(Math.random);
  log(`room ${code} — starting the host (phone)`);
  const phone = await startPeer({ name: 'phone', code, host: true });
  log('starting the joiner (laptop)');
  const laptop = await startPeer({ name: 'laptop', code, host: false });

  const phone0 = await statusOf(phone);
  const laptop0 = await statusOf(laptop);
  check(
    'the phone is white and the laptop is black',
    phone0.seat === 'white' && laptop0.seat === 'black',
    `phone=${String(phone0.seat)} laptop=${String(laptop0.seat)}`,
  );

  // ── A shared history to diverge from ──────────────────────────────────────────────────
  log(`phone plays ${WHITE_1}; laptop replies ${BLACK_1}`);
  await verb(phone, ['move', WHITE_1]);
  await verb(laptop, ['wait', '--timeout', '30']);
  await verb(laptop, ['move', BLACK_1]);
  await waitFor(phone, (s) => s.ply === 2, 'the phone to receive black’s reply', 30_000);

  // ══ PART 1 — exactly ONE entry behind: the automatic path ═════════════════════════════
  log('PART 1 — laptop drops its link and misses exactly ONE move');
  await verb(laptop, ['drop']);
  await waitFor(laptop, (s) => s.link === 'down', 'the laptop link to go down', 15_000);
  await waitFor(phone, (s) => !s.peerPresent, 'the phone to see the laptop go absent', 20_000);

  await verb(phone, ['move', MISSED_MOVE]);
  const laptopStale = await statusOf(laptop);
  check(
    'the laptop is (correctly) one entry behind while it is away',
    laptopStale.ply === 2 && laptopStale.game?.pieces[MISSED_MOVE] === undefined,
    `ply=${laptopStale.ply} pieces[${MISSED_MOVE}]=${String(laptopStale.game?.pieces[MISSED_MOVE])}`,
  );

  log('laptop restores its link — ONE behind is the one case that converges by itself');
  await verb(laptop, ['restore']);
  const laptopCaught = await waitFor(
    laptop,
    (s) => s.ply === 3,
    'the laptop to fast-forward to the missed move',
    30_000,
  );
  const phoneAhead = await statusOf(phone);
  check(
    'ONE entry behind FAST-FORWARDED automatically — same head, missed stone on the board',
    laptopCaught.game?.pieces[MISSED_MOVE] === 'white' && laptopCaught.headHash === phoneAhead.headHash,
    `pieces[${MISSED_MOVE}]=${String(laptopCaught.game?.pieces[MISSED_MOVE])} heads ${String(laptopCaught.headHash)}/${String(phoneAhead.headHash)}`,
  );
  check(
    '…and NOTHING was asked of either player: no divergence, no handshake',
    laptopCaught.divergence === null && phoneAhead.divergence === null,
    `laptop=${String(laptopCaught.divergence?.ui)} phone=${String(phoneAhead.divergence?.ui)}`,
  );
  check(
    'the caught-up peer may play again (the turn came back with the move)',
    laptopCaught.canPlace && !phoneAhead.canPlace,
    `laptop.canPlace=${laptopCaught.canPlace} phone.canPlace=${phoneAhead.canPlace}`,
  );

  // ══ PART 2 — TWO entries behind: the explicit path ════════════════════════════════════
  log(`PART 2 — laptop plays ${BLACK_2} to hand the turn back, then drops again`);
  await verb(laptop, ['move', BLACK_2]);
  await waitFor(phone, (s) => s.ply === 4, 'the phone to receive black’s move', 30_000);
  await verb(laptop, ['drop']);
  await waitFor(laptop, (s) => s.link === 'down', 'the laptop link to go down again', 15_000);
  await waitFor(phone, (s) => !s.peerPresent, 'the phone to see the laptop go absent again', 20_000);

  const laptopBefore = await statusOf(laptop);
  const headBefore = laptopBefore.headHash;

  log(`phone plays ${TAKEN_BACK} and then TAKES IT BACK — two entries the laptop never hears`);
  await verb(phone, ['move', TAKEN_BACK]);
  const phoneUndone = await verb(phone, ['undo']);
  check(
    'the resident appended TWO entries while the peer was away (a move and its undo)',
    phoneUndone.ply === 4 && phoneUndone.game?.pieces[TAKEN_BACK] === undefined,
    `ply=${phoneUndone.ply} pieces[${TAKEN_BACK}]=${String(phoneUndone.game?.pieces[TAKEN_BACK])} head=${String(phoneUndone.headHash)}`,
  );
  check(
    'the two peers now hold DIFFERENT histories behind identical-looking boards',
    phoneUndone.headHash !== headBefore,
    `phone=${String(phoneUndone.headHash)} laptop=${String(headBefore)}`,
  );

  log('laptop restores its link — TWO behind must NOT be adopted');
  await verb(laptop, ['restore']);
  await waitFor(laptop, (s) => s.link === 'up', 'the laptop link to come back up', 20_000);
  const laptopDiverged = await waitFor(
    laptop,
    (s) => s.divergence !== null,
    'the laptop to be told it is out of step',
    25_000,
  );
  const phoneDiverged = await waitFor(
    phone,
    (s) => s.divergence !== null,
    'the phone to be told it is out of step',
    25_000,
  );
  // Give the pair longer than any convergence would need, so "it did not adopt" is a settled fact
  // rather than a snapshot taken too early.
  await sleep(SETTLE_MS);
  const laptopSettled = await statusOf(laptop);

  check(
    'TWO entries behind produced a RESOLUTION request on BOTH peers — not a silent catch-up',
    laptopDiverged.divergence !== null && phoneDiverged.divergence !== null,
    `laptop=${String(laptopDiverged.divergence?.ui)} phone=${String(phoneDiverged.divergence?.ui)}`,
  );
  check(
    'the divergence names the correct LAST COMMON ANCESTOR on both peers',
    laptopDiverged.divergence?.sharedPly === 4 && phoneDiverged.divergence?.sharedPly === 4,
    `laptop=${String(laptopDiverged.divergence?.sharedPly)} phone=${String(phoneDiverged.divergence?.sharedPly)} (the pair agreed up to ply 4)`,
  );
  check(
    'the behind peer is told exactly WHAT it missed, and that it is missing (not holding) it',
    JSON.stringify(laptopDiverged.divergence?.theirs.map((m) => m.text)) ===
      JSON.stringify([`white plays ${TAKEN_BACK}`, 'undo (takes back the previous move)']) &&
      laptopDiverged.divergence?.mine.length === 0,
    `theirs=${JSON.stringify(laptopDiverged.divergence?.theirs.map((m) => m.text))} mine=${JSON.stringify(laptopDiverged.divergence?.mine.map((m) => m.text))}`,
  );
  check(
    'NO SILENT ADOPTION: the returner’s head is byte-for-byte what it was before it came back',
    laptopSettled.headHash === headBefore && laptopSettled.ply === 4,
    `head=${String(laptopSettled.headHash)} (was ${String(headBefore)}) ply=${laptopSettled.ply}`,
  );
  check(
    'and it is still refusing to adopt after a full settle window',
    laptopSettled.divergence !== null,
    `divergence=${String(laptopSettled.divergence?.ui)}`,
  );

  // ── The way out is the handshake, exactly as V.4b built it ────────────────────────────
  log('laptop suggests taking the phone’s history; the phone agrees');
  const suggested = await tryVerb(laptop, ['resolve', 'take-theirs']);
  check('the suggestion was raised', suggested !== null, suggested === null ? 'REFUSED' : 'ok');
  await waitFor(
    phone,
    (s) => s.divergence?.ui === 'incoming',
    'the phone to receive the suggestion',
    20_000,
  );
  await tryVerb(phone, ['agree']);
  const laptopResolved = await waitFor(
    laptop,
    (s) => s.divergence === null,
    'the laptop to converge on the agreed history',
    25_000,
  );
  const phoneResolved = await statusOf(phone);
  check(
    'the pair converged only ONCE THE PLAYERS AGREED — same head, both cards closed',
    laptopResolved.headHash === phoneResolved.headHash &&
      laptopResolved.headHash === phoneUndone.headHash &&
      phoneResolved.divergence === null,
    `laptop=${String(laptopResolved.headHash)} phone=${String(phoneResolved.headHash)} (agreed on ${String(phoneUndone.headHash)})`,
  );

  showBoard(phone, await statusOf(phone));
  showBoard(laptop, await statusOf(laptop));
  return report('V.7 — the fast-forward-vs-diff boundary (1 = automatic, 2 = resolution)');
}

main()
  .then(async (exitCode) => {
    await stopAll();
    process.exit(exitCode);
  })
  .catch(async (e: unknown) => {
    console.error('\nscenario error: ' + (e instanceof Error ? e.message : String(e)));
    await stopAll();
    process.exit(1);
  });
