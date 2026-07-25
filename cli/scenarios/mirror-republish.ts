/**
 * # Scenario: issue #45's MIRROR — the RETURNER republishes, over the real relay
 *
 * `issue45-reconnect-resync.ts` drives the resident→returner direction: the peer that stayed serves
 * the peer that came back. Design §5 requires the other half too — *"the returner republishes so a
 * resident can fast-forward to a move that never got out"* — and a review of Stage v31-republish
 * found that half unreachable on the real adapter: the resident's live-presence ack was latched
 * one-per-peer and reset only by an OBSERVED ABSENCE, so a returner whose outage the broker never
 * noticed heard nothing on its return and never republished. Every existing test either used a
 * Last-Will outage (absence observed) or a `MockRelayHub` that answered unconditionally, which is
 * exactly the over-mock that hid it. This scenario closes that gap end-to-end.
 *
 * ## The outage it drives (and why it is not the other scenario's)
 *
 * The laptop leaves with `drop --silent --lossy`:
 *
 *  - **`--silent`** — a graceful DISCONNECT, so the broker DISCARDS the Last-Will. The phone's
 *    presence never changes: it never learns the laptop was gone. There is no absence to trigger
 *    on, which is the whole point (`republish.ts`: "an absence may never be observed").
 *  - **`--lossy`** — the move the laptop plays while down is DROPPED rather than queued by mqtt.js.
 *    Without it the client's own offline queue would flush that publish on reconnect and the run
 *    would prove the queue works, not that the returner republished. "A move that never got out"
 *    has to actually not get out.
 *
 * ## What it asserts (the gate)
 *
 * The phone must fast-forward onto the laptop's move purely because the laptop republished when it
 * came back — with `peerPresent` true on the phone the whole way through (proof no absence was ever
 * observed, so nothing edge-triggered could have fired). Then the game must still be playable in
 * both directions.
 *
 * Run: `npm run scenario:mirror` (needs egress to the relay; `SCENARIO_VERBOSE=1` tees the boards).
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

/** Where each peer plays. Distinct nodes so a capture never muddies the ply arithmetic. */
const PHONE_MOVE_1 = '2,2,2';
const LAPTOP_MOVE = '1,1,1';
const PHONE_MOVE_2 = '3,3,3';

/** Time given to a state that has no blocking verb to propagate over the real relay. */
const SETTLE_MS = 4000;

async function main(): Promise<number> {
  await requireRelay();
  const code = generateGameCode(Math.random);
  log(`room ${code} — starting the host (phone)`);
  const phone = await startPeer({ name: 'phone', code, host: true });

  log('starting the joiner (laptop)');
  const laptop = await startPeer({ name: 'laptop', code, host: false });

  const phone0 = await statusOf(phone);
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

  // ── 2. The SILENT, LOSSY outage: an absence the phone never observes ──────────────────
  log('laptop drops its link SILENTLY (no Last-Will) and LOSSILY (publishes are discarded)');
  await verb(laptop, ['drop', '--silent', '--lossy']);
  const laptopDown = await waitFor(laptop, (s) => s.link === 'down', 'the laptop link to go down', 15_000);
  check(
    'laptop link is down while its session still says connected',
    laptopDown.link === 'down' && laptopDown.phase === 'connected',
    `link=${laptopDown.link} phase=${laptopDown.phase}`,
  );

  await sleep(SETTLE_MS); // long enough for a Last-Will to have landed, had one been sent
  const phoneUnaware = await statusOf(phone);
  check(
    'phone NEVER saw an absence (no Last-Will fired) — nothing edge-triggered can fire on this return',
    phoneUnaware.peerPresent,
    `peerPresent=${phoneUnaware.peerPresent}`,
  );

  // ── 3. The move that never got out ────────────────────────────────────────────────────
  log(`laptop plays ${LAPTOP_MOVE} while its link is down (the publish is discarded)`);
  const afterLaptopMove = await verb(laptop, ['move', LAPTOP_MOVE]);
  check('laptop move landed locally (ply 2)', afterLaptopMove.ply === 2, `ply=${afterLaptopMove.ply}`);

  await sleep(SETTLE_MS);
  const phoneStale = await statusOf(phone);
  check(
    'phone is (correctly) still at ply 1 — the move genuinely never reached the relay',
    phoneStale.ply === 1,
    `ply=${phoneStale.ply}`,
  );

  // ── 4. The return — everything below is the MIRROR gate ───────────────────────────────
  log('laptop RESTORES its link (it re-announces; the phone never knew it left)');
  await verb(laptop, ['restore']);
  await waitFor(laptop, (s) => s.link === 'up', 'the laptop link to come back up', 20_000);
  log(`link up; giving the peers ${SETTLE_MS}ms to converge`);
  await sleep(SETTLE_MS);

  const phoneNow = await statusOf(phone);
  const laptopNow = await statusOf(laptop);
  check(
    'phone FAST-FORWARDED onto the move made during the outage (ply 2)',
    phoneNow.ply === 2,
    `phone.ply=${phoneNow.ply} (laptop=${laptopNow.ply})`,
  );
  check(
    "phone's board holds the laptop's move",
    phoneNow.game?.pieces[LAPTOP_MOVE] !== undefined,
    `pieces[${LAPTOP_MOVE}]=${String(phoneNow.game?.pieces[LAPTOP_MOVE])}`,
  );
  check(
    'phone knows it is ITS turn again',
    phoneNow.canPlace,
    `canPlace=${phoneNow.canPlace} turn=${phoneNow.game?.turn}`,
  );
  check(
    'the laptop did not roll back to the shorter log the phone republished',
    laptopNow.ply === 2,
    `laptop.ply=${laptopNow.ply}`,
  );
  check(
    'still no absence was ever observed on the phone',
    phoneNow.peerPresent,
    `peerPresent=${phoneNow.peerPresent}`,
  );

  // ── 5. Still playable in both directions ──────────────────────────────────────────────
  log(`phone plays ${PHONE_MOVE_2} after the outage`);
  const replayed = await tryVerb(phone, ['move', PHONE_MOVE_2]);
  check(
    'phone can play on the converged game',
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
  return report('issue #45 mirror — the returner republishes');
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
