/**
 * # Scenario: issue #45 — a reconnect must converge to the LIVE game
 *
 * The bug that froze v3, reproduced end-to-end over the real relay with two CLI peers.
 * The user's words:
 *
 * > i played a game between my phone/laptop… after many moves, i played from my phone, then
 * > locked the screen. it disconnected. i played a move on the laptop. after turning my phone
 * > back on, it reconnected, but it never got an update. so it was never able to play because
 * > it thought it was still the laptop's turn.
 *
 * ## What it does
 *
 * 1. `phone` hosts, `laptop` joins — a real two-client game over the relay.
 * 2. `phone` (white) plays a move; `laptop` receives it live. (Proves the happy path works,
 *    so a later failure is about the OUTAGE and not about sync being broken generally.)
 * 3. `phone` **drops its link** — the socket dies under a session that stays `connected`,
 *    exactly like a locked screen (`cli/netlink.ts`). The broker's Last-Will makes `laptop`
 *    see it go absent.
 * 4. `laptop` plays its move into the room while `phone` is away. Sync is incremental and
 *    NON-retained, so that publish is gone by the time `phone` returns.
 * 5. `phone` **restores its link**. mqtt.js reconnects, re-subscribes and re-announces
 *    presence — but nothing replays the missed move.
 *
 * ## What it asserts (the gate)
 *
 * After the return, `phone` must hold the LIVE game: `ply` 2, `laptop`'s stone on its board,
 * and its own turn to play — and the game must still be playable. That is the behaviour the
 * v3.1 remodel's **resident-peer republish on presence** (design §4) has to deliver.
 *
 * ## Expected result TODAY: FAILURE — this is the repro, not a passing test
 *
 * On v3 `phone` comes back one move behind and believes it is still the opponent's turn, so
 * it can never move: the deadlock the issue calls "bricked" (the reported Undo-then-diverge is
 * the downstream symptom of acting on that stale state). A non-zero exit here is the bug being
 * present. It must exit 0 once the remodel lands.
 *
 * Run: `npm run scenario:issue45` (needs egress to the relay; `SCENARIO_VERBOSE=1` tees the
 * daemons' live boards).
 */
import { generateGameCode } from '../../src/ui/widgets/netModel';
import {
  check,
  log,
  report,
  showBoard,
  sleep,
  startPeer,
  statusOf,
  stopAll,
  tryVerb,
  verb,
  waitFor,
} from './harness';

/** Where each peer plays. Distinct nodes so a capture never muddies the ply arithmetic. */
const PHONE_MOVE_1 = '2,2,2';
const LAPTOP_MOVE = '1,1,1';
const PHONE_MOVE_2 = '3,3,3';

/** Time given to a state that has no blocking verb to propagate over the real relay. */
const SETTLE_MS = 4000;

async function main(): Promise<number> {
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
  check('phone sees the laptop present', phone0.peerPresent, `peerPresent=${phone0.peerPresent}`);

  // ── 1. A normal move, received live: the baseline the outage is measured against ──────
  log(`phone plays ${PHONE_MOVE_1} (white opens)`);
  const afterPhoneMove = await verb(phone, ['move', PHONE_MOVE_1]);
  check('phone move landed (ply 1)', afterPhoneMove.ply === 1, `ply=${afterPhoneMove.ply}`);

  const laptopSaw = await verb(laptop, ['wait', '--timeout', '30']);
  check(
    'laptop received the move LIVE (ply 1, its turn)',
    laptopSaw.ply === 1 && laptopSaw.canPlace,
    `ply=${laptopSaw.ply} canPlace=${laptopSaw.canPlace}`,
  );

  // ── 2. The outage: the phone's screen locks ───────────────────────────────────────────
  log('phone DROPS its link (locked screen — socket killed, session untouched)');
  await verb(phone, ['drop']);
  const phoneDown = await waitFor(phone, (s) => s.link === 'down', 'the phone link to go down', 15_000);
  check('phone link is down while its session still says connected', phoneDown.link === 'down' && phoneDown.phase === 'connected', `link=${phoneDown.link} phase=${phoneDown.phase}`);

  const laptopAlone = await waitFor(
    laptop,
    (s) => !s.peerPresent,
    "the laptop to see the phone go absent (broker Last-Will)",
    20_000,
  );
  check('laptop sees the phone absent', !laptopAlone.peerPresent, `peerPresent=${laptopAlone.peerPresent}`);

  // ── 3. The move made while the phone was away ─────────────────────────────────────────
  log(`laptop plays ${LAPTOP_MOVE} while the phone is offline`);
  const afterLaptopMove = await verb(laptop, ['move', LAPTOP_MOVE]);
  check('laptop move landed (ply 2)', afterLaptopMove.ply === 2, `ply=${afterLaptopMove.ply}`);

  const phoneStale = await statusOf(phone);
  check(
    'phone is (correctly) still at ply 1 while offline',
    phoneStale.ply === 1,
    `ply=${phoneStale.ply}`,
  );

  // ── 4. The return — everything below is the #45 gate ──────────────────────────────────
  log('phone RESTORES its link (screen unlocked)');
  await verb(phone, ['restore']);
  await waitFor(phone, (s) => s.link === 'up', 'the phone link to come back up', 20_000);
  log(`link up; giving the peers ${SETTLE_MS}ms to converge`);
  await sleep(SETTLE_MS);

  const phoneBack = await statusOf(phone);
  const laptopNow = await statusOf(laptop);
  check('phone is online again', phoneBack.link === 'up', `link=${phoneBack.link}`);
  check('laptop sees the phone present again', laptopNow.peerPresent, `peerPresent=${laptopNow.peerPresent}`);

  check(
    'phone CAUGHT UP to the live game (ply 2)',
    phoneBack.ply === 2,
    `ply=${phoneBack.ply} (laptop=${laptopNow.ply})`,
  );
  check(
    "phone's board holds the move made while it was away",
    phoneBack.game?.pieces[LAPTOP_MOVE] !== undefined,
    `pieces[${LAPTOP_MOVE}]=${String(phoneBack.game?.pieces[LAPTOP_MOVE])}`,
  );
  check(
    'phone knows it is ITS turn again (not stuck on "their move")',
    phoneBack.canPlace,
    `canPlace=${phoneBack.canPlace} turn=${phoneBack.game?.turn}`,
  );
  check(
    'the game is not deadlocked (someone can move)',
    phoneBack.canPlace || laptopNow.canPlace,
    `phone.canPlace=${phoneBack.canPlace} laptop.canPlace=${laptopNow.canPlace}`,
  );

  // ── 5. Still playable? The proof that the game survived the outage ────────────────────
  log(`phone tries to play ${PHONE_MOVE_2} after the outage`);
  const replayed = await tryVerb(phone, ['move', PHONE_MOVE_2]);
  check(
    'phone can still play after reconnecting',
    replayed !== null && replayed.ply === 3,
    replayed === null ? 'move REFUSED' : `ply=${replayed.ply}`,
  );
  if (replayed !== null) {
    const laptopFinal = await tryVerb(laptop, ['wait', '--timeout', '20']);
    check(
      "laptop received the phone's post-outage move",
      laptopFinal !== null && laptopFinal.ply === 3,
      laptopFinal === null ? 'no reply' : `ply=${laptopFinal.ply} canPlace=${laptopFinal.canPlace}`,
    );
  }

  showBoard(phone, await statusOf(phone));
  showBoard(laptop, await statusOf(laptop));
  return report('issue #45 — reconnect resync');
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
