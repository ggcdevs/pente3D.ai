/**
 * # Scenario: after a REMATCH swaps the colours, a returning peer comes back on the NEW one (#40)
 *
 * Task **V.7** (epic #47), driven end-to-end over the REAL relay by two CLI peers.
 *
 * ## The bug this protects against (#40)
 *
 * A rematch alternates the colours (`resetForRematch`). Issue #40 was what happened next: the
 * durable, identity-owned seat map was left at the PRE-swap arrangement, so when a peer came back
 * the resident arbiter re-admitted it onto its OLD colour — two peers on the same colour, and a turn
 * gate neither could ever pass. The rejoin must **display a derived colour, never negotiate one**
 * (design §7), which is only true if the swap is what got persisted.
 *
 * ## What it does
 *
 * 1. Two peers play a REAL game to a real win (white makes five in a row).
 * 2. One asks for a rematch, the other accepts — the same out-of-band N.1 handshake the browser
 *    overlay drives, read back through the same pure `deriveEndState` card a player sees.
 * 3. The peer that is now BLACK **drops its socket** (a locked screen), the new WHITE opens the
 *    rematch, and the dropped peer returns.
 * 4. The same peer then **leaves and re-enters** the room — a full re-admission, where the resident
 *    is the arbiter that hands out a seat. This is the path #40 actually broke; the socket drop above
 *    never re-runs admission at all.
 *
 * ## What it asserts (the gate)
 *
 * The colours ALTERNATE on both peers at the rematch, the returning peer is on its **POST-swap**
 * colour after both kinds of return, both peers hold the SAME seat map and the SAME head, and the
 * rematch is playable by the peer whose turn it now is.
 *
 * Run: `npm run scenario:rematch` (needs egress to the relay; exit 2 = relay unreachable,
 * `SCENARIO_VERBOSE=1` tees the daemons' live boards).
 */
import { generateGameCode } from '../../src/ui/widgets/netModel';
import {
  check,
  log,
  report,
  requireRelay,
  showBoard,
  startPeer,
  statusOf,
  stopAll,
  tryVerb,
  verb,
  waitFor,
} from './harness';

/**
 * A scripted decided game: white takes the whole `y=0,z=0` edge (five in a row → a line win), black
 * answers on the far corner diagonal. Every black stone is non-adjacent to every other, so no black
 * pair is ever capturable and the win is the line, plainly.
 */
const WHITE_MOVES = ['0,0,0', '1,0,0', '2,0,0', '3,0,0', '4,0,0'];
const BLACK_MOVES = ['0,4,4', '2,4,4', '4,4,4', '2,2,2'];
/** The rematch's opening move, played by whoever is white AFTER the swap. */
const REMATCH_OPENING = '3,3,3';
/** A move played after the full re-admission, to prove the returner really holds a playable seat. */
const AFTER_REJOIN = '1,3,3';

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
  const seatsBefore = phone0.seatOwners;

  // ── 1. Play the game out to a real win ────────────────────────────────────────────────
  log('playing a full game (white takes the y=0,z=0 edge)');
  for (let i = 0; i < WHITE_MOVES.length; i++) {
    await verb(phone, ['move', WHITE_MOVES[i]!]);
    await verb(laptop, ['wait', '--timeout', '30']);
    const black = BLACK_MOVES[i];
    if (black === undefined) break; // white's fifth move ends it
    await verb(laptop, ['move', black]);
    await verb(phone, ['wait', '--timeout', '30']);
  }
  const phoneWon = await waitFor(phone, (s) => s.game?.winner !== null, 'the phone to see the win', 30_000);
  const laptopLost = await waitFor(laptop, (s) => s.game?.winner !== null, 'the laptop to see the win', 30_000);
  check(
    'BOTH peers see the same finished game — white won by line',
    phoneWon.game?.winner === 'white' &&
      laptopLost.game?.winner === 'white' &&
      phoneWon.headHash === laptopLost.headHash &&
      phoneWon.endState.winReason === 'line',
    `winner=${String(phoneWon.game?.winner)}/${String(laptopLost.game?.winner)} reason=${String(phoneWon.endState.winReason)} heads ${String(phoneWon.headHash)}/${String(laptopLost.headHash)}`,
  );
  check(
    'each peer is told the result in its OWN terms',
    phoneWon.endState.iWon && !laptopLost.endState.iWon && phoneWon.endState.show,
    `phone.iWon=${phoneWon.endState.iWon} ("${phoneWon.endState.resultText}") laptop.iWon=${laptopLost.endState.iWon} ("${laptopLost.endState.resultText}")`,
  );
  const firstUuid = phoneWon.gameUuid;

  // ── 2. The rematch: an ask, an acceptance, and a swap ─────────────────────────────────
  log('phone asks for a rematch (pente rematch)');
  await verb(phone, ['rematch']);
  const laptopAsked = await waitFor(
    laptop,
    (s) => s.endState.rematchUi === 'incoming',
    'the laptop to receive the rematch ask',
    20_000,
  );
  check(
    'the ask really reached the OTHER client, in its own words',
    laptopAsked.endState.rematchPrompt === 'White wants a rematch',
    `rematchUi=${laptopAsked.endState.rematchUi} prompt=${String(laptopAsked.endState.rematchPrompt)}`,
  );

  log('laptop accepts (pente accept)');
  await verb(laptop, ['accept']);
  const phoneSwapped = await waitFor(
    phone,
    (s) => s.ply === 0 && s.game?.winner === null,
    'the phone to reset into the rematch',
    20_000,
  );
  const laptopSwapped = await waitFor(
    laptop,
    (s) => s.ply === 0 && s.game?.winner === null,
    'the laptop to reset into the rematch',
    20_000,
  );
  check(
    'the COLOURS ALTERNATED on both peers',
    phoneSwapped.seat === 'black' && laptopSwapped.seat === 'white',
    `phone ${String(phone0.seat)}→${String(phoneSwapped.seat)} laptop ${String(laptop0.seat)}→${String(laptopSwapped.seat)}`,
  );
  check(
    'the durable seat map SWAPPED too, identically on both peers (the #40 fix)',
    JSON.stringify(phoneSwapped.seatOwners) === JSON.stringify(laptopSwapped.seatOwners) &&
      phoneSwapped.seatOwners?.white === seatsBefore?.black &&
      phoneSwapped.seatOwners?.black === seatsBefore?.white,
    `before=${JSON.stringify(seatsBefore)} after=${JSON.stringify(phoneSwapped.seatOwners)}/${JSON.stringify(laptopSwapped.seatOwners)}`,
  );
  check(
    'the rematch is ONE fresh game, not two, and not the old one',
    phoneSwapped.gameUuid !== null &&
      phoneSwapped.gameUuid !== firstUuid &&
      phoneSwapped.gameUuid === laptopSwapped.gameUuid &&
      phoneSwapped.headHash === laptopSwapped.headHash,
    `was=${String(firstUuid)} now=${String(phoneSwapped.gameUuid)}/${String(laptopSwapped.gameUuid)}`,
  );

  // ── 3. The returning peer, first by a dropped SOCKET ──────────────────────────────────
  log('phone (now BLACK) drops its link; the laptop (now WHITE) opens the rematch');
  await verb(phone, ['drop']);
  await waitFor(phone, (s) => s.link === 'down', 'the phone link to go down', 15_000);
  await waitFor(laptop, (s) => !s.peerPresent, 'the laptop to see the phone go absent', 20_000);
  await verb(laptop, ['move', REMATCH_OPENING]);

  log('phone restores its link');
  await verb(phone, ['restore']);
  const phoneBack = await waitFor(phone, (s) => s.ply === 1, 'the phone to catch up to the opening', 30_000);
  const laptopNow = await statusOf(laptop);
  check(
    'the returning peer came back on its POST-swap colour and caught up',
    phoneBack.seat === 'black' &&
      phoneBack.game?.pieces[REMATCH_OPENING] === 'white' &&
      phoneBack.headHash === laptopNow.headHash,
    `seat=${String(phoneBack.seat)} pieces[${REMATCH_OPENING}]=${String(phoneBack.game?.pieces[REMATCH_OPENING])} heads ${String(phoneBack.headHash)}/${String(laptopNow.headHash)}`,
  );
  check(
    'it is the returning peer’s turn — the two seats are not the same colour',
    phoneBack.canPlace && !laptopNow.canPlace,
    `phone.canPlace=${phoneBack.canPlace} laptop.canPlace=${laptopNow.canPlace}`,
  );

  // ── 4. …and then by a FULL re-admission, which is the path #40 broke ──────────────────
  log('phone LEAVES the room entirely, then walks back in (dealer’s choice — a real rejoin)');
  await verb(phone, ['leave']);
  await waitFor(laptop, (s) => !s.peerPresent, 'the laptop to see the phone leave', 20_000);
  const rejoined = await verb(phone, ['enter', '--seed', 'defer']);
  const laptopAfter = await waitFor(
    laptop,
    (s) => s.peerPresent,
    'the laptop to see the phone rejoin',
    20_000,
  );
  check(
    'the re-ADMITTED peer is seated on its POST-swap colour (the resident did not hand back the old one)',
    rejoined.seat === 'black' && rejoined.joinError === null,
    `seat=${String(rejoined.seat)} joinError=${String(rejoined.joinError)}`,
  );
  check(
    'both peers still hold ONE seat map and ONE history',
    JSON.stringify(rejoined.seatOwners) === JSON.stringify(laptopAfter.seatOwners) &&
      rejoined.gameUuid === laptopAfter.gameUuid &&
      rejoined.headHash === laptopAfter.headHash,
    `seats ${JSON.stringify(rejoined.seatOwners)}/${JSON.stringify(laptopAfter.seatOwners)} uuid ${String(rejoined.gameUuid)}/${String(laptopAfter.gameUuid)} head ${String(rejoined.headHash)}/${String(laptopAfter.headHash)}`,
  );

  const playable = await tryVerb(phone, ['move', AFTER_REJOIN]);
  const seen = playable === null ? null : await tryVerb(laptop, ['wait', '--timeout', '30']);
  check(
    'the rejoined peer can actually PLAY its colour (no same-colour deadlock)',
    playable !== null && seen !== null && seen.game?.pieces[AFTER_REJOIN] === 'black',
    playable === null
      ? 'move REFUSED'
      : `laptop sees pieces[${AFTER_REJOIN}]=${String(seen?.game?.pieces[AFTER_REJOIN])} ply=${String(seen?.ply)}`,
  );

  showBoard(phone, await statusOf(phone));
  showBoard(laptop, await statusOf(laptop));
  return report('V.7 — rematch, then reconnect on the SWAPPED colour (#40)');
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
