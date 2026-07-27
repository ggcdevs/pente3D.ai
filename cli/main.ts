/**
 * `pente` CLI entry — a scriptable client for a networked 3D Pente game that talks
 * to the same MQTT relay the browser client uses (same room code ⇒ same game).
 *
 * Verbs:
 *   pente play  <CODE> [--host] [--view NAME]   start the connected daemon (run in bg)
 *   pente show  <CODE> [--view NAME]            print the board once
 *   pente wait  <CODE> [--view NAME] [--timeout S]  block until it's your move / game over
 *   pente move  <CODE> <x,y,z>  [--view NAME]   place a stone (must be your turn)
 *   pente undo  <CODE>                          request an undo of your last move
 *   pente redo  <CODE>
 *   pente resolve <CODE> <take-mine|take-theirs|rewind>  suggest a resolution for a divergence
 *   pente agree <CODE> | pente refuse <CODE>    answer the opponent's suggested resolution
 *   pente rematch <CODE>                        ask for a rematch (colours alternate)
 *   pente accept <CODE> | pente decline <CODE>  answer the opponent's rematch ask
 *   pente leave <CODE>                          leave the room (daemon stays up)
 *   pente enter <CODE> [--seed new|defer]       walk back in on an explicit seed
 *   pente status <CODE>                         connection/seat/turn readout
 *   pente drop  <CODE> [--silent] [--lossy]      simulate a network outage (kill the socket)
 *   pente restore <CODE>                        end the outage (let mqtt.js reconnect)
 *   pente quit  <CODE>                          stop the daemon
 *   pente views                                 list available board views
 *
 * `--json` makes any state-returning verb print the raw {@link Snapshot} JSON instead of a
 * rendered board — the machine-readable form scenario scripts assert on.
 */
import { runDaemon } from './daemon';
import { request } from './client';
import { render, VIEWS, DEFAULT_VIEW, type Snapshot } from './views';

interface Args {
  verb: string;
  code: string | null;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const [verb = 'help', ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else positional.push(a);
  }
  return { verb, code: positional[0] ?? null, positional, flags };
}

function view(flags: Args['flags']): string {
  const v = typeof flags.view === 'string' ? flags.view : DEFAULT_VIEW;
  return VIEWS[v] ? v : DEFAULT_VIEW;
}

function requireCode(args: Args): string {
  if (!args.code) {
    console.error(`${args.verb}: a room code is required. e.g. 'pente ${args.verb} ABCDE'`);
    process.exit(2);
  }
  return args.code.toUpperCase();
}

function printSnapshot(data: unknown, viewName: string): void {
  console.log(render(data as Snapshot, viewName));
}

/** True when `--json` was passed: emit machine-readable state, no rendered board. */
function jsonMode(flags: Args['flags']): boolean {
  return flags.json === true;
}

/** Emit a state reply either as raw JSON (`--json`, for scripts) or as a rendered board. */
function output(data: unknown, args: Args): void {
  if (jsonMode(args.flags)) return console.log(JSON.stringify(data));
  printSnapshot(data, view(args.flags));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  switch (args.verb) {
    case 'play':
      await runDaemon({
        code: args.code ?? undefined,
        host: args.flags.host === true,
        view: view(args.flags),
      });
      return; // daemon blocks

    case 'show': {
      const r = await request(requireCode(args), { cmd: 'show' }, 10_000);
      if (!r.ok) return fail(r.data);
      return output(r.data, args);
    }

    case 'status': {
      const r = await request(requireCode(args), { cmd: 'status' }, 10_000);
      if (!r.ok) return fail(r.data);
      if (jsonMode(args.flags)) return console.log(JSON.stringify(r.data));
      const s = r.data as Snapshot;
      console.log(
        `room ${s.code} · phase ${s.phase} · link ${s.link} · seat ${s.seat ?? '—'} · opponent ${s.peerPresent ? 'present' : 'waiting'} · ply ${s.ply} · ${s.canPlace ? 'YOUR MOVE' : 'their move'}${s.game?.winner ? ` · winner ${s.game.winner}` : ''}`,
      );
      return;
    }

    // Outage control for scenario scripts (issue #45): `drop` kills the socket under a
    // session that stays `connected`; `restore` lets mqtt.js reconnect. `drop --silent` leaves via
    // a graceful DISCONNECT so no Last-Will fires (the peer never sees an absence — the #45 mirror
    // case); `drop --lossy` throws away anything published while down instead of queueing it.
    case 'drop':
    case 'restore': {
      const modes = [
        ...(args.flags.silent === true ? ['silent'] : []),
        ...(args.flags.lossy === true ? ['lossy'] : []),
      ].join(',');
      const r = await request(
        requireCode(args),
        { cmd: args.verb, ...(modes === '' ? {} : { arg: modes }) },
        10_000,
      );
      if (!r.ok) return fail(r.data);
      if (jsonMode(args.flags)) return console.log(JSON.stringify(r.data));
      console.log(args.verb === 'drop' ? 'link dropped (offline).' : 'link restoring…');
      return;
    }

    case 'move': {
      const code = requireCode(args);
      const coord = args.positional[1];
      if (!coord) {
        console.error("move: need a coordinate, e.g. 'pente move ABCDE 2,2,2'");
        process.exit(2);
      }
      const r = await request(code, { cmd: 'move', arg: coord }, 15_000);
      if (!r.ok) return fail(r.data);
      if (!jsonMode(args.flags)) console.log(`placed ${coord}.`);
      return output(r.data, args);
    }

    case 'undo':
    case 'redo': {
      const r = await request(requireCode(args), { cmd: args.verb }, 10_000);
      if (!r.ok) return fail(r.data || `${args.verb} refused`);
      return output(r.data, args);
    }

    // Divergence resolution (V.4b, #38): suggest a way out, or answer the peer's suggestion.
    case 'resolve': {
      const choice = args.positional[1];
      if (!choice) {
        console.error("resolve: need a choice, e.g. 'pente resolve ABCDE take-theirs'");
        process.exit(2);
      }
      const r = await request(requireCode(args), { cmd: 'resolve', arg: choice }, 10_000);
      if (!r.ok) return fail(r.data);
      return output(r.data, args);
    }
    case 'agree':
    case 'refuse': {
      const r = await request(requireCode(args), { cmd: args.verb }, 10_000);
      if (!r.ok) return fail(r.data);
      return output(r.data, args);
    }

    // Rematch (N.2, #12): the out-of-band ask and its answer. Distinct from `resolve`/`agree`, which
    // answer a DIVERGENCE — a rematch that both sides accept resets to a fresh game with the colours
    // ALTERNATED, so the two asks must not share a verb.
    case 'rematch':
    case 'accept':
    case 'decline': {
      const r = await request(requireCode(args), { cmd: args.verb }, 15_000);
      if (!r.ok) return fail(r.data);
      return output(r.data, args);
    }

    // Room lifecycle: a real departure, and a re-entry on an explicit seed (design §3). `leave` is
    // NOT `drop` — it takes the session offline (seat and engine dropped) rather than killing the
    // socket under a session that stays connected.
    case 'leave': {
      const r = await request(requireCode(args), { cmd: 'leave' }, 15_000);
      if (!r.ok) return fail(r.data);
      return output(r.data, args);
    }
    case 'enter': {
      const seed = typeof args.flags.seed === 'string' ? args.flags.seed : 'defer';
      // The entry negotiates over the relay (hello → settle window → admit/establish), so it is given
      // room to complete; a refusal comes back as a `joinError` on the snapshot, not as a timeout.
      const r = await request(requireCode(args), { cmd: 'enter', arg: seed }, 60_000);
      if (!r.ok) return fail(r.data);
      return output(r.data, args);
    }

    case 'wait': {
      const code = requireCode(args);
      const timeoutS = Number(args.flags.timeout ?? 55);
      const r = await request(code, { cmd: 'wait', timeoutMs: timeoutS * 1000 }, timeoutS * 1000 + 10_000);
      if (!r.ok) return fail(r.data);
      const s = r.data as Snapshot & { timedOut: boolean };
      if (jsonMode(args.flags)) return console.log(JSON.stringify(s));
      if (s.timedOut) console.log(`(still ${s.canPlace ? 'your' : "opponent's"} turn after ${timeoutS}s — run wait again)`);
      return printSnapshot(s, view(args.flags));
    }

    case 'quit': {
      const r = await request(requireCode(args), { cmd: 'quit' }, 5_000).catch(() => null);
      console.log(r?.ok ? 'daemon stopped.' : 'no running daemon (or it already exited).');
      return;
    }

    case 'views':
      console.log('available views: ' + Object.keys(VIEWS).join(', ') + ` (default: ${DEFAULT_VIEW})`);
      return;

    default:
      console.log(`pente — scriptable 3D Pente CLI client

  pente play  <CODE> [--host] [--view NAME]        start the connected daemon (run in background)
  pente show  <CODE> [--view NAME]                 print the board
  pente wait  <CODE> [--view NAME] [--timeout S]   block until your move / game over
  pente move  <CODE> <x,y,z> [--view NAME]         place a stone (must be your turn)
  pente undo  <CODE> | pente redo <CODE>
  pente resolve <CODE> <take-mine|take-theirs|rewind>   suggest a way out of a divergence
  pente agree <CODE> | pente refuse <CODE>         answer your opponent's suggestion
  pente rematch <CODE>                             ask for a rematch (colours alternate)
  pente accept <CODE> | pente decline <CODE>       answer your opponent's rematch ask
  pente leave <CODE>                               leave the room (the daemon stays up)
  pente enter <CODE> [--seed new|defer]            walk back in: new = start over (empty only),
                                                   defer = dealer's choice (adopts theirs)
  pente status <CODE>                              one-line readout
  pente drop  <CODE> [--silent] [--lossy]          simulate an outage (--silent: no Last-Will,
                                                   so the peer never sees an absence; --lossy:
                                                   publishes made while down are LOST, not queued)
  pente restore <CODE>                             end the outage (reconnect)
  pente quit  <CODE>                               stop the daemon
  pente views                                      list board views

any state-returning verb accepts --json (raw snapshot, for scripts)
views: ${Object.keys(VIEWS).join(', ')}`);
      return;
  }
}

function fail(msg: unknown): void {
  console.error('error: ' + (typeof msg === 'string' ? msg : JSON.stringify(msg)));
  process.exitCode = 1;
}

main().catch((e) => {
  console.error('fatal: ' + (e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
