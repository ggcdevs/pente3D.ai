/**
 * # Scenario: a divergence beyond the turn gate is SEEN BY BOTH and resolved by agreement
 *
 * Task **V.4b** (epic #47, absorbs **#38**), driven end-to-end over the REAL relay by two CLI peers.
 *
 * ## The gap this closes
 *
 * V.4a made the engine refuse to auto-adopt anything beyond the turn gate's one-move cap, and record
 * the last common ancestor + a diff. But only the peer that is AHEAD detects that; the peer that is
 * BEHIND published its short log, got nothing back, and went on rendering an ordinary board while it
 * was missing moves. And once detected there was no way out: the next local move turned it into a
 * fork that stopped the game for good.
 *
 * ## How the divergence is produced — without forging anything
 *
 * A two-move gap cannot be PLAYED between two honest peers: the turn gate blocks the second
 * consecutive move, which is exactly why anything longer is anomalous. But an **undo is an appended
 * event**, and the restricted networked undo lets a player take back their OWN last move. So with its
 * socket dead (`pente drop --lossy` — a locked screen whose publishes are simply lost):
 *
 *   1. `phone` undoes its own move   → its log grows by one entry the peer never sees;
 *   2. `phone` plays a different move → and by another.
 *
 * `phone` comes back TWO entries ahead on a history `laptop` is a prefix of. Nothing is fabricated:
 * every entry is one the real rules engine produced from a real verb.
 *
 * ## What it asserts (the gate)
 *
 *  - **BOTH** peers report the divergence, at the SAME shared move — the asymmetry V.4a left open.
 *  - Neither adopts on its own (the narrow-fast-forward rule still holds).
 *  - `resolve` + `agree` converges them onto ONE history, with the agreed moves really on the board
 *    of the peer that took them — proof-by-state from each daemon's own snapshot, never a log line.
 *  - A resolved game is PLAYABLE again (the fork is a state, not a terminus).
 *
 * Run: `npm run scenario:divergence` (needs egress to the relay; exit 2 = relay unreachable,
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

/** Distinct nodes so a capture never muddies the ply arithmetic. */
const OPENING = '2,2,2';
/** The move the phone plays INSTEAD, after taking its opening back while offline. */
const REPLACEMENT = '3,3,3';
/** A move played after the resolution, to prove the game survived it. */
const AFTER = '1,1,1';

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
    'both peers are seated in distinct seats',
    phone0.seat !== null && laptop0.seat !== null && phone0.seat !== laptop0.seat,
    `phone=${phone0.seat} laptop=${laptop0.seat}`,
  );

  // ── 1. One shared move, so there is a real common history to diverge FROM ─────────────
  log(`phone plays ${OPENING} (white opens)`);
  await verb(phone, ['move', OPENING]);
  const laptopSaw = await verb(laptop, ['wait', '--timeout', '30']);
  check(
    'laptop received the opening LIVE (ply 1)',
    laptopSaw.ply === 1 && laptopSaw.game?.pieces[OPENING] === 'white',
    `ply=${laptopSaw.ply} pieces[${OPENING}]=${String(laptopSaw.game?.pieces[OPENING])}`,
  );

  // ── 2. The phone goes offline and rewrites its own recent history ─────────────────────
  log('phone DROPS its link (--lossy: what it publishes while down is simply gone)');
  await verb(phone, ['drop', '--lossy']);
  await waitFor(phone, (s) => s.link === 'down', 'the phone link to go down', 15_000);

  log('phone undoes its own opening while offline (an undo is an appended EVENT — the log grows)');
  const afterUndo = await verb(phone, ['local-undo']);
  // `ply` counts EFFECTIVE moves, not log entries — an undo appends an entry and takes the move
  // back, so the board is what shows it happened.
  check(
    'the undo took the opening back on the phone',
    afterUndo.game?.pieces[OPENING] === undefined,
    `pieces[${OPENING}]=${String(afterUndo.game?.pieces[OPENING])} ply=${afterUndo.ply}`,
  );
  log(`phone plays ${REPLACEMENT} instead`);
  const afterReplace = await verb(phone, ['move', REPLACEMENT]);
  check(
    'the phone now holds a DIFFERENT history (its replacement, not its opening)',
    afterReplace.game?.pieces[REPLACEMENT] === 'white' &&
      afterReplace.game?.pieces[OPENING] === undefined,
    `pieces[${REPLACEMENT}]=${String(afterReplace.game?.pieces[REPLACEMENT])} pieces[${OPENING}]=${String(afterReplace.game?.pieces[OPENING])}`,
  );
  const laptopStale = await statusOf(laptop);
  check(
    'the laptop heard NONE of it (still on the opening, no divergence yet)',
    laptopStale.game?.pieces[OPENING] === 'white' && laptopStale.divergence === null,
    `pieces[${OPENING}]=${String(laptopStale.game?.pieces[OPENING])} divergence=${String(laptopStale.divergence?.ui)}`,
  );

  // ── 3. The return: two entries apart — beyond anything the turn gate can explain ──────
  log('phone RESTORES its link');
  await verb(phone, ['restore']);
  await waitFor(phone, (s) => s.link === 'up', 'the phone link to come back up', 20_000);
  log(`link up; giving the peers ${SETTLE_MS}ms to exchange logs`);
  await sleep(SETTLE_MS);

  const phoneDiverged = await waitFor(
    phone,
    (s) => s.divergence !== null,
    'the phone to report the divergence',
    20_000,
  );
  // THE gate this scenario exists for: the peer that is BEHIND is told too.
  const laptopDiverged = await waitFor(
    laptop,
    (s) => s.divergence !== null,
    'the laptop (the peer that is BEHIND) to be told about the divergence',
    20_000,
  );
  check(
    'BOTH peers report the divergence at the SAME shared move',
    phoneDiverged.divergence?.sharedPly === 1 && laptopDiverged.divergence?.sharedPly === 1,
    `phone=${String(phoneDiverged.divergence?.sharedPly)} laptop=${String(laptopDiverged.divergence?.sharedPly)}`,
  );
  check(
    'the two descriptions are MIRRORS (what only one has is what the other is missing)',
    JSON.stringify(phoneDiverged.divergence?.mine.map((m) => m.text)) ===
      JSON.stringify(laptopDiverged.divergence?.theirs.map((m) => m.text)),
    `phone.mine=${JSON.stringify(phoneDiverged.divergence?.mine.map((m) => m.text))} laptop.theirs=${JSON.stringify(laptopDiverged.divergence?.theirs.map((m) => m.text))}`,
  );
  check(
    'NEITHER side adopted on its own (the narrow one-move rule still holds)',
    phoneDiverged.game?.pieces[REPLACEMENT] === 'white' &&
      phoneDiverged.game?.pieces[OPENING] === undefined &&
      laptopDiverged.game?.pieces[OPENING] === 'white' &&
      laptopDiverged.game?.pieces[REPLACEMENT] === undefined,
    `phone=${JSON.stringify(phoneDiverged.game?.pieces)} laptop=${JSON.stringify(laptopDiverged.game?.pieces)}`,
  );
  check(
    'the divergence names the two entries the laptop never heard',
    JSON.stringify(laptopDiverged.divergence?.theirs.map((m) => m.text)) ===
      JSON.stringify([
        'undo (takes back the previous move)',
        `white plays ${REPLACEMENT}`,
      ]),
    JSON.stringify(laptopDiverged.divergence?.theirs.map((m) => m.text)),
  );

  // ── 4. The way out: suggest, agree, converge ──────────────────────────────────────────
  log('laptop suggests taking the phone’s history (pente resolve take-theirs)');
  const suggested = await tryVerb(laptop, ['resolve', 'take-theirs']);
  check('the suggestion was raised', suggested !== null, suggested === null ? 'REFUSED' : 'ok');
  await sleep(SETTLE_MS);

  const phoneAsked = await statusOf(phone);
  check(
    'the phone sees the suggestion, in its own terms',
    phoneAsked.divergence?.ui === 'incoming' && phoneAsked.divergence.canAccept,
    `ui=${String(phoneAsked.divergence?.ui)} canAccept=${String(phoneAsked.divergence?.canAccept)} text=${String(phoneAsked.divergence?.incomingText)}`,
  );
  check(
    'nothing landed while the suggestion was in flight',
    (await statusOf(laptop)).game?.pieces[OPENING] === 'white',
    `laptop still on its own history: ${JSON.stringify((await statusOf(laptop)).game?.pieces)}`,
  );

  log('phone agrees (pente agree)');
  const agreed = await tryVerb(phone, ['agree']);
  check('the agreement was published', agreed !== null, agreed === null ? 'REFUSED' : 'ok');
  await sleep(SETTLE_MS);

  const phoneFinal = await statusOf(phone);
  const laptopFinal = await statusOf(laptop);
  check(
    'BOTH peers converged onto ONE history',
    JSON.stringify(phoneFinal.game?.pieces) === JSON.stringify(laptopFinal.game?.pieces) &&
      phoneFinal.ply === laptopFinal.ply,
    `phone=${JSON.stringify(phoneFinal.game?.pieces)} laptop=${JSON.stringify(laptopFinal.game?.pieces)}`,
  );
  check(
    'the laptop really REPLAYED it: the agreed move is on its board, and the taken-back one is not',
    laptopFinal.game?.pieces[REPLACEMENT] === 'white' &&
      laptopFinal.game?.pieces[OPENING] === undefined,
    `pieces[${REPLACEMENT}]=${String(laptopFinal.game?.pieces[REPLACEMENT])} pieces[${OPENING}]=${String(laptopFinal.game?.pieces[OPENING])}`,
  );
  check(
    'both divergence cards are closed',
    phoneFinal.divergence === null && laptopFinal.divergence === null,
    `phone=${JSON.stringify(phoneFinal.divergence?.ui)} laptop=${JSON.stringify(laptopFinal.divergence?.ui)}`,
  );

  // ── 5. Still playable? A divergence is a state, not a terminus ────────────────────────
  const mover = laptopFinal.canPlace ? laptop : phone;
  log(`${mover.name} plays ${AFTER} after the resolution`);
  const played = await tryVerb(mover, ['move', AFTER]);
  check(
    'the game is playable again after the resolution',
    played !== null && played.game?.pieces[AFTER] !== undefined,
    played === null ? 'move REFUSED' : `pieces[${AFTER}]=${String(played.game?.pieces[AFTER])}`,
  );

  showBoard(phone, await statusOf(phone));
  showBoard(laptop, await statusOf(laptop));
  return report('V.4b — divergence seen by both, resolved by agreement');
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
