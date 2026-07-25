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
 *   pente status <CODE>                         connection/seat/turn readout
 *   pente drop  <CODE>                          simulate a network outage (kill the socket)
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
    // session that stays `connected`; `restore` lets mqtt.js reconnect.
    case 'drop':
    case 'restore': {
      const r = await request(requireCode(args), { cmd: args.verb }, 10_000);
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
  pente status <CODE>                              one-line readout
  pente drop  <CODE>                               simulate a network outage (kill the socket)
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
