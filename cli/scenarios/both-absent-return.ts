/**
 * # Scenario: BOTH players leave, then come back one at a time — and the game is still there
 *
 * Task **V.7** (epic #47), driven end-to-end over the REAL relay by two CLI peers.
 *
 * ## Why this case needs its own proof
 *
 * Every other convergence path has a RESIDENT: someone is in the room holding the authoritative log,
 * and the returner catches up from them (design §4). When both are away nobody holds anything, and
 * the relay is deliberately dumb — the sync channel is non-retained, so there is no copy of the game
 * at the broker, and there is no `net-room:{code}` record any more either (design §2). The first
 * peer back therefore has exactly one honest source: **its own archive, by the game's UUID**, named
 * by its `activeNetworkedGame` breadcrumb (§4 "the returning peer loads its own game from the archive
 * by UUID and waits").
 *
 * That makes this the scenario where "a room code owns nothing" is most likely to bite: get it wrong
 * and the first peer back establishes a BRAND-NEW empty game over the top of a real one, and the
 * second peer arrives to find its game gone.
 *
 * ## What it does
 *
 * 1. Two peers play a real game at code X (two moves).
 * 2. **Both leave** — the room is genuinely empty.
 * 3. One returns on the `defer` seed and waits, alone.
 * 4. The other returns.
 *
 * ## What it asserts (the gate)
 *
 * The first peer back is on the SAME game uuid at the SAME `headHash` it left with (its history, not
 * a fresh board); once the second returns BOTH hold that same head, the identity-owned seat map is
 * intact and unchanged on both, and the game plays on from where it stopped.
 *
 * Run: `npm run scenario:both-absent` (needs egress to the relay; exit 2 = relay unreachable,
 * `SCENARIO_VERBOSE=1` tees the daemons' live boards).
 */
import { generateGameCode } from '../../src/ui/widgets/netModel';
import {
  check,
  log,
  pieceKeys,
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

/** The history the pair must still be holding when they come back. */
const WHITE_OPENING = '2,2,2';
const BLACK_REPLY = '0,4,0';
/** Played after both are back, to prove the game resumed rather than merely being displayed. */
const AFTER_RETURN = '4,0,4';

/** Time for two departures to clear at the broker before the first return looks for a resident. */
const SETTLE_MS = 3000;

async function main(): Promise<number> {
  await requireRelay();
  const code = generateGameCode(Math.random);
  log(`room ${code} — starting the host (phone)`);
  const phone = await startPeer({ name: 'phone', code, host: true });
  log('starting the joiner (laptop)');
  const laptop = await startPeer({ name: 'laptop', code, host: false });

  // ── 1. A real game, so there is something to lose ─────────────────────────────────────
  log(`phone plays ${WHITE_OPENING}; laptop replies ${BLACK_REPLY}`);
  await verb(phone, ['move', WHITE_OPENING]);
  await verb(laptop, ['wait', '--timeout', '30']);
  await verb(laptop, ['move', BLACK_REPLY]);
  const phoneMid = await waitFor(phone, (s) => s.ply === 2, 'the phone to see both moves', 30_000);
  const laptopMid = await statusOf(laptop);

  const uuid = phoneMid.gameUuid;
  const head = phoneMid.headHash;
  const seats = phoneMid.seatOwners;
  check(
    'the pair is on ONE game with two moves on it',
    uuid !== null &&
      head !== null &&
      uuid === laptopMid.gameUuid &&
      head === laptopMid.headHash &&
      pieceKeys(phoneMid).length === 2,
    `uuid=${String(uuid)} head=${String(head)} pieces=${JSON.stringify(pieceKeys(phoneMid))}`,
  );

  // ── 2. Everybody leaves ───────────────────────────────────────────────────────────────
  log('BOTH peers leave — the room is empty and the relay holds nothing');
  await verb(phone, ['leave']);
  await verb(laptop, ['leave']);
  await sleep(SETTLE_MS);

  // ── 3. The first one back is ALONE ────────────────────────────────────────────────────
  log(`laptop returns first (dealer's choice) and waits in an empty room`);
  const laptopBack = await verb(laptop, ['enter', '--seed', 'defer']);
  check(
    'the first peer back is alone, and knows it',
    laptopBack.phase === 'connected' && !laptopBack.peerPresent,
    `phase=${laptopBack.phase} peerPresent=${laptopBack.peerPresent}`,
  );
  check(
    'it brought its OWN game back — same uuid, same history, not a fresh board',
    laptopBack.gameUuid === uuid &&
      laptopBack.headHash === head &&
      JSON.stringify(pieceKeys(laptopBack)) === JSON.stringify(pieceKeys(laptopMid)),
    `uuid=${String(laptopBack.gameUuid)} head=${String(laptopBack.headHash)} pieces=${JSON.stringify(pieceKeys(laptopBack))}`,
  );
  check(
    'it reclaimed its OWN seat by identity (a rejoin displays a colour, it does not negotiate one)',
    laptopBack.seat === laptopMid.seat &&
      JSON.stringify(laptopBack.seatOwners) === JSON.stringify(seats),
    `seat=${String(laptopBack.seat)} (was ${String(laptopMid.seat)}) owners=${JSON.stringify(laptopBack.seatOwners)}`,
  );

  // ── 4. …and then the other one ────────────────────────────────────────────────────────
  log('phone returns (dealer’s choice)');
  const phoneBack = await verb(phone, ['enter', '--seed', 'defer']);
  const laptopPaired = await waitFor(
    laptop,
    (s) => s.peerPresent,
    'the laptop to see the phone return',
    20_000,
  );

  check(
    'BOTH peers converged on the SAME headHash — the game they left',
    phoneBack.headHash === head &&
      laptopPaired.headHash === head &&
      phoneBack.gameUuid === uuid &&
      laptopPaired.gameUuid === uuid,
    `phone=${String(phoneBack.headHash)} laptop=${String(laptopPaired.headHash)} (left at ${String(head)})`,
  );
  check(
    'the seats are INTACT on both — same owners, same colours as before the outage',
    JSON.stringify(phoneBack.seatOwners) === JSON.stringify(seats) &&
      JSON.stringify(laptopPaired.seatOwners) === JSON.stringify(seats) &&
      phoneBack.seat === phoneMid.seat &&
      laptopPaired.seat === laptopMid.seat,
    `owners ${JSON.stringify(phoneBack.seatOwners)}/${JSON.stringify(laptopPaired.seatOwners)} seats ${String(phoneBack.seat)}/${String(laptopPaired.seat)}`,
  );
  check(
    'nothing was refused and no divergence was manufactured by the round trip',
    phoneBack.joinError === null &&
      laptopPaired.joinError === null &&
      phoneBack.divergence === null &&
      laptopPaired.divergence === null,
    `joinErrors ${String(phoneBack.joinError)}/${String(laptopPaired.joinError)} divergence ${String(phoneBack.divergence?.ui)}/${String(laptopPaired.divergence?.ui)}`,
  );

  // ── 5. It is a GAME again, not a photograph of one ────────────────────────────────────
  const mover = phoneBack.canPlace ? phone : laptop;
  const other = mover === phone ? laptop : phone;
  log(`${mover.name} plays ${AFTER_RETURN} — the game resumes where it stopped`);
  const played = await tryVerb(mover, ['move', AFTER_RETURN]);
  const seen = played === null ? null : await tryVerb(other, ['wait', '--timeout', '30']);
  check(
    'the game resumed: the move lands at ply 3 and crosses to the other peer',
    played !== null && played.ply === 3 && seen !== null && seen.ply === 3,
    played === null ? 'move REFUSED' : `mover ply=${played.ply} other ply=${String(seen?.ply)}`,
  );

  showBoard(phone, await statusOf(phone));
  showBoard(laptop, await statusOf(laptop));
  return report('V.7 — both absent, then a staggered return');
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
