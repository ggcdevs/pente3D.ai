/**
 * # Scenario: the CLI's "last move" always names a stone that is ON the board
 *
 * Task **V.7** (epic #47). The CLI is the glue tier's measuring instrument — the scenarios assert on
 * the daemon's own {@link Snapshot}, so a field the daemon reports falsely is a test-integrity
 * defect, not cosmetics.
 *
 * ## The bug this protects against
 *
 * `Snapshot.lastMove` was tracked by diffing placements and updated only when exactly one stone was
 * ADDED. Nothing ever invalidated it, so an undo, a resolution rewind or a rematch reset left the
 * daemon advertising a move that is not on the board and does not exist in the current game. It was
 * live in a shipped `scenario:ff-boundary` run: two peers holding the SAME `headHash` — genuinely
 * converged — rendered DIFFERENT last moves, one of them a stone that had been taken back, printed
 * as `? @ (4,4,4)` because the renderer could not find its colour. No check noticed, because no
 * scenario asserted on `lastMove`.
 *
 * ## What it does
 *
 * One hosting peer, no opponent needed: play a move, take it back, play again, take everything back.
 * The relay is still real (the daemon holds a live session and a live engine); what is under test is
 * whether the readout follows the authoritative game.
 *
 * ## What it asserts (the gate)
 *
 * After every single step: `lastMove` is either `null` or a key that is present in `game.pieces`.
 * That is the whole invariant, and it is the one the old implementation broke.
 *
 * Run: `npm run scenario:last-move` (needs egress to the relay; exit 2 = relay unreachable,
 * `SCENARIO_VERBOSE=1` tees the daemon's live board).
 */
import { generateGameCode } from '../../src/ui/widgets/netModel';
import { check, log, report, requireRelay, startPeer, statusOf, stopAll, verb } from './harness';
import type { Peer } from './harness';
import type { Snapshot } from '../views';

/**
 * The invariant, checked against whatever the daemon currently reports: a named last move must be a
 * stone the game actually holds. `detail` prints the observed triple either way, so a failure says
 * what the daemon believed rather than only that it was wrong.
 */
function checkLastMoveIsReal(label: string, snap: Snapshot): void {
  const key = snap.lastMove;
  const onBoard = key === null || snap.game?.pieces[key] !== undefined;
  check(
    label,
    onBoard,
    `lastMove=${key ?? 'null'} ply=${snap.ply} pieces=[${Object.keys(snap.game?.pieces ?? {}).join(' ')}]`,
  );
}

async function main(): Promise<number> {
  await requireRelay();
  const code = generateGameCode(Math.random);
  log(`room ${code} — starting the host (phone)`);
  const phone: Peer = await startPeer({ name: 'phone', code, host: true });

  checkLastMoveIsReal('a fresh game names no last move', await statusOf(phone));

  // ── The move ────────────────────────────────────────────────────────────────────────
  log('playing 2,2,2');
  const played = await verb(phone, ['move', '2,2,2']);
  check('lastMove names the move just played', played.lastMove === '2,2,2', `lastMove=${String(played.lastMove)}`);
  checkLastMoveIsReal('after the move, lastMove is a stone that is ON the board', played);

  // ── The undo: the exact step that used to leave a phantom ───────────────────────────
  log('taking it back (undo)');
  const undone = await verb(phone, ['local-undo']);
  check(
    'the undo really removed the stone (ply back to 0, board empty)',
    undone.ply === 0 && Object.keys(undone.game?.pieces ?? {}).length === 0,
    `ply=${undone.ply} pieces=[${Object.keys(undone.game?.pieces ?? {}).join(' ')}]`,
  );
  // Previously: lastMove=2,2,2 on an EMPTY board.
  checkLastMoveIsReal('after the undo, lastMove is null or a stone that is ON the board', undone);

  check('an undone board names NO last move', undone.lastMove === null, `lastMove=${String(undone.lastMove)}`);

  // ── A DIFFERENT move now: the readout must follow the new history, not the discarded one ─
  // (Only white is seated here, so every move is white's; after the undo it is white's turn again
  // and this placement cuts the redo tail — the branch a stale tracked value would keep pointing at.)
  log('playing a different move, 0,0,0');
  const replayed = await verb(phone, ['move', '0,0,0']);
  check(
    'lastMove is the NEW move, not the discarded one',
    replayed.lastMove === '0,0,0',
    `lastMove=${String(replayed.lastMove)} pieces=[${Object.keys(replayed.game?.pieces ?? {}).join(' ')}]`,
  );
  checkLastMoveIsReal('and it is a stone that is ON the board', replayed);

  // ── Undo, then redo: the readout follows the cursor both ways ────────────────────────
  log('undoing, then redoing');
  const backAgain = await verb(phone, ['local-undo']);
  checkLastMoveIsReal('after the second undo, the invariant still holds', backAgain);
  check('an empty board names NO last move', backAgain.lastMove === null, `lastMove=${String(backAgain.lastMove)}`);
  const redone = await verb(phone, ['local-redo']);
  check('after the redo, lastMove is the redone move', redone.lastMove === '0,0,0', `lastMove=${String(redone.lastMove)}`);
  checkLastMoveIsReal('and it is a stone that is ON the board', redone);

  return report('CLI last-move truth (lastMove always names a stone on the board)');
}

main()
  .then(async (code) => {
    await stopAll();
    process.exit(code);
  })
  .catch(async (e: unknown) => {
    console.error('\nscenario error: ' + (e instanceof Error ? e.stack : String(e)));
    await stopAll();
    process.exit(1);
  });
