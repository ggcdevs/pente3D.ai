/**
 * # Scenario: re-using a room CODE with New Game starts a genuinely NEW game (#46, #43)
 *
 * Task **V.7** (epic #47), driven end-to-end over the REAL relay by two CLI peers.
 *
 * ## The behaviour this protects
 *
 * A room code is **pure rendezvous**; a game is a **UUID**; there is no mapping between them
 * anywhere (design §2). That is what makes the user's ask work:
 *
 * > i would love to be able to just tell my buddy 'hey, jump on DUDEEE and let's play', and we just
 * > keep re-using that for all of our games.
 *
 * The deleted `net-room:{code}` record broke exactly this: the code owned a game, so walking back
 * into a re-used code handed both players the game they had just finished (#43), and asking for a
 * New Game got you the other device's board (#46).
 *
 * ## What it does
 *
 * 1. Two peers play a real game at code X (two moves, so the history is real, not a formality).
 * 2. **Both leave** — a real departure, seat and engine dropped, not a dropped socket.
 * 3. Both walk back into the SAME code X on the **`new`** seed, one after the other.
 *
 * Both peers still hold the finished-with game in their archive AND a breadcrumb naming it for this
 * very room, so nothing but the seed rule stops it coming back. `new` is a request to START OVER, so
 * the breadcrumb must not be adopted (#43) and the peer's non-empty game must not be accepted (#46).
 *
 * ## What it asserts (the gate)
 *
 * After the re-entry: the board is **EMPTY on both**, the game **UUID CHANGED** on both, both peers
 * are on the **SAME** new uuid with distinct seats, and the fresh game is playable end to end. The
 * uuid is the load-bearing half — an empty board alone would also be satisfied by a rewound copy of
 * the old game, which is not what "New Game" means.
 *
 * Run: `npm run scenario:code-reuse` (needs egress to the relay; exit 2 = relay unreachable,
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

/** The first game's moves — distinct nodes, so a capture never muddies the ply arithmetic. */
const WHITE_OPENING = '2,2,2';
const BLACK_REPLY = '1,1,1';
/** The move played in the SECOND game, to prove the re-used code still carries a live game. */
const SECOND_GAME_MOVE = '4,4,4';

/** Time for a departure/arrival to propagate over the real relay (presence has no blocking verb). */
const SETTLE_MS = 3000;

async function main(): Promise<number> {
  await requireRelay();
  const code = generateGameCode(Math.random);
  log(`room ${code} — starting the host (phone)`);
  const phone = await startPeer({ name: 'phone', code, host: true });
  log('starting the joiner (laptop)');
  const laptop = await startPeer({ name: 'laptop', code, host: false });

  // ── 1. A real game at code X ──────────────────────────────────────────────────────────
  log(`phone plays ${WHITE_OPENING}; laptop replies ${BLACK_REPLY}`);
  await verb(phone, ['move', WHITE_OPENING]);
  await verb(laptop, ['wait', '--timeout', '30']);
  await verb(laptop, ['move', BLACK_REPLY]);
  const phoneMid = await waitFor(phone, (s) => s.ply === 2, 'the phone to see both moves', 30_000);
  const laptopMid = await statusOf(laptop);

  const firstUuid = phoneMid.gameUuid;
  check(
    'both peers are on ONE game with real history',
    firstUuid !== null &&
      firstUuid === laptopMid.gameUuid &&
      phoneMid.headHash === laptopMid.headHash &&
      pieceKeys(phoneMid).length === 2,
    `uuid=${String(firstUuid)} head=${String(phoneMid.headHash)} pieces=${JSON.stringify(pieceKeys(phoneMid))}`,
  );

  // ── 2. Both leave the room ────────────────────────────────────────────────────────────
  log('both peers LEAVE the room (a real departure — seat and engine dropped)');
  const phoneGone = await verb(phone, ['leave']);
  const laptopGone = await verb(laptop, ['leave']);
  check(
    'both peers are offline and holding no game',
    phoneGone.phase === 'offline' &&
      laptopGone.phase === 'offline' &&
      phoneGone.gameUuid === null &&
      laptopGone.gameUuid === null,
    `phone=${phoneGone.phase}/${String(phoneGone.gameUuid)} laptop=${laptopGone.phase}/${String(laptopGone.gameUuid)}`,
  );
  await sleep(SETTLE_MS);

  // ── 3. Both walk back into the SAME code asking for a NEW game ────────────────────────
  // Each peer still holds the finished game in its archive and a BREADCRUMB naming it for this very
  // room, so if a `new` seed adopted either of them the old board would be back. That is #43.
  log(`phone re-enters ${code} on the 'new' seed`);
  const phoneNew = await verb(phone, ['enter', '--seed', 'new']);
  check(
    'the phone is back in the room, seated, on an EMPTY board',
    phoneNew.phase === 'connected' && phoneNew.seat !== null && pieceKeys(phoneNew).length === 0,
    `phase=${phoneNew.phase} seat=${String(phoneNew.seat)} pieces=${JSON.stringify(pieceKeys(phoneNew))}`,
  );

  log(`laptop re-enters ${code} on the 'new' seed`);
  const laptopNew = await verb(laptop, ['enter', '--seed', 'new']);
  const phoneAfter = await waitFor(
    phone,
    (s) => s.peerPresent,
    'the phone to see the laptop back in the room',
    20_000,
  );

  // ── 4. The gate ───────────────────────────────────────────────────────────────────────
  check(
    'the board is EMPTY on BOTH peers (the finished game did not come back — #43)',
    pieceKeys(phoneAfter).length === 0 && pieceKeys(laptopNew).length === 0,
    `phone=${JSON.stringify(pieceKeys(phoneAfter))} laptop=${JSON.stringify(pieceKeys(laptopNew))}`,
  );
  check(
    'the game UUID CHANGED on BOTH peers (a re-used code owns no game — design §2)',
    phoneAfter.gameUuid !== null &&
      laptopNew.gameUuid !== null &&
      phoneAfter.gameUuid !== firstUuid &&
      laptopNew.gameUuid !== firstUuid,
    `was=${String(firstUuid)} phone=${String(phoneAfter.gameUuid)} laptop=${String(laptopNew.gameUuid)}`,
  );
  check(
    'both peers are on the SAME new game (both chose New → one uuid at genesis, #42)',
    phoneAfter.gameUuid === laptopNew.gameUuid && phoneAfter.headHash === laptopNew.headHash,
    `phone=${String(phoneAfter.gameUuid)} laptop=${String(laptopNew.gameUuid)} heads ${String(phoneAfter.headHash)}/${String(laptopNew.headHash)}`,
  );
  check(
    'neither entry was refused, and the seats are distinct',
    phoneAfter.joinError === null &&
      laptopNew.joinError === null &&
      phoneAfter.seat !== null &&
      laptopNew.seat !== null &&
      phoneAfter.seat !== laptopNew.seat,
    `phone=${String(phoneAfter.seat)}/${String(phoneAfter.joinError)} laptop=${String(laptopNew.seat)}/${String(laptopNew.joinError)}`,
  );

  // ── 5. The fresh game is a GAME, not just an empty board ──────────────────────────────
  const opener = phoneAfter.seat === 'white' ? phone : laptop;
  const receiver = opener === phone ? laptop : phone;
  log(`${opener.name} (white) opens the second game at ${SECOND_GAME_MOVE}`);
  const played = await tryVerb(opener, ['move', SECOND_GAME_MOVE]);
  const received = played === null ? null : await tryVerb(receiver, ['wait', '--timeout', '30']);
  check(
    'the re-used code carries a LIVE second game (the move crosses the relay)',
    played !== null &&
      received !== null &&
      received.game?.pieces[SECOND_GAME_MOVE] === 'white' &&
      received.ply === 1,
    played === null
      ? 'move REFUSED'
      : `receiver ply=${String(received?.ply)} pieces[${SECOND_GAME_MOVE}]=${String(received?.game?.pieces[SECOND_GAME_MOVE])}`,
  );

  showBoard(phone, await statusOf(phone));
  showBoard(laptop, await statusOf(laptop));
  return report('V.7 — code reuse with New Game (#46, #43)');
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
