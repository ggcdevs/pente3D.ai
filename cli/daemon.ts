/**
 * The `play` daemon: a long-running process that holds the ONE MQTT connection for
 * a room, drives host/join, and serves board state + move commands over a local
 * Unix socket to the thin `show`/`move`/`wait` verbs. Keeping a single persistent
 * connection (rather than connect-per-command) avoids flapping presence at the
 * browser peer and re-running the admission handshake on every action.
 *
 * It renders the board to its own stdout on every change too, so when launched in
 * the background the task log is a live view of the game.
 */
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { createSession } from './session';
import { render, type Snapshot } from './views';
import { generateGameCode, validateGameCode } from '../src/ui/widgets/netModel';
import type { Coord } from '../src/core/coords';
import type { NetSession } from '../src/net/session';

/** Runtime state dir (sockets + playerid). Overridable so two CLIs can co-exist. */
const STATE_DIR = path.resolve(process.env.PENTE_STATE_DIR ?? path.join(process.cwd(), '.pente-cli'));

export function socketPath(code: string): string {
  return path.join(STATE_DIR, `${code}.sock`);
}

/** Stable per-machine playerId (mirrors the browser's localStorage playerId). */
function loadPlayerId(): string {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  if (process.env.PENTE_PLAYER_ID) return process.env.PENTE_PLAYER_ID;
  const f = path.join(STATE_DIR, 'playerid');
  try {
    const existing = fs.readFileSync(f, 'utf8').trim();
    if (existing) return existing;
  } catch {
    /* first run */
  }
  const id = 'cli-' + Math.random().toString(36).slice(2, 10);
  fs.writeFileSync(f, id);
  return id;
}

interface Waiter {
  respond: (snap: Snapshot, timedOut: boolean) => void;
  timer: NodeJS.Timeout;
}

export interface PlayOptions {
  code?: string;
  host: boolean;
  view: string;
}

/** Normalize the room code (host may auto-generate one); exit if a join has no valid code. */
function resolveCode(opts: PlayOptions): string {
  const norm = opts.code ? validateGameCode(opts.code) : { ok: false as const };
  if (norm.ok) return norm.code;
  if (opts.host) return generateGameCode(Math.random);
  console.error('play: a valid room code is required to join. Usage: pente play <CODE>');
  return process.exit(2);
}

export async function runDaemon(opts: PlayOptions): Promise<void> {
  const code = resolveCode(opts);
  const playerId = loadPlayerId();
  const { session } = await createSession(`pente-cli-${code}`, playerId);

  // Track lastMove by diffing placements across changes (a place adds exactly one
  // stone — the mover's — even when it also captures).
  let prevKeys = new Set<string>();
  let lastMove: string | null = null;
  const waiters = new Set<Waiter>();

  function snapshot(): Snapshot {
    const st = session.state();
    const game = session.gameState();
    return {
      code,
      seat: st.seat,
      phase: st.phase,
      peerPresent: st.peerPresent,
      joinError: st.joinError,
      canPlace: session.canPlace(),
      ply: session.ply(),
      lastMove,
      seatOwners: session.seatOwners(),
      game,
    };
  }

  function onChange(): void {
    const game = session.gameState();
    if (game) {
      const keys = new Set(Object.keys(game.pieces));
      const added = [...keys].filter((k) => !prevKeys.has(k));
      if (added.length === 1) lastMove = added[0]!;
      prevKeys = keys;
    }
    const snap = snapshot();
    // Live log to the daemon's stdout.
    console.log('\n' + render(snap, opts.view) + '\n' + '─'.repeat(48));
    // Wake any `wait` clients whose condition is now met (my turn, or game over).
    if (snap.canPlace || snap.game?.winner) {
      for (const w of waiters) {
        clearTimeout(w.timer);
        w.respond(snap, false);
      }
      waiters.clear();
    }
  }

  session.onChange(onChange);

  // ── Connect ──────────────────────────────────────────────────────────────
  console.log(`[pente] ${opts.host ? 'hosting' : 'joining'} room ${code} as ${playerId}…`);
  if (opts.host) await session.host(code);
  else await session.join(code);
  console.log(`[pente] ${session.state().phase}; seat=${session.state().seat ?? '—'}`);
  onChange();

  // ── Socket server ────────────────────────────────────────────────────────
  const sockPath = socketPath(code);
  await ensureFreeSocket(sockPath, code);

  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.trim()) handleRequest(line, conn);
      }
    });
    conn.on('error', () => {}); // client vanished mid-request — ignore.
  });

  function reply(conn: net.Socket, ok: boolean, data: unknown): void {
    conn.write(JSON.stringify({ ok, data }) + '\n');
  }

  function handleRequest(line: string, conn: net.Socket): void {
    let req: { cmd: string; arg?: string; timeoutMs?: number };
    try {
      req = JSON.parse(line);
    } catch {
      return reply(conn, false, 'bad request json');
    }
    switch (req.cmd) {
      case 'show':
      case 'status':
        return reply(conn, true, snapshot());
      case 'move': {
        const coord = parseCoord(req.arg ?? '');
        if (!coord) return reply(conn, false, `bad coordinate: "${req.arg}" (want x,y,z)`);
        const err = tryMove(session, coord);
        return reply(conn, !err, err ?? snapshot());
      }
      case 'undo':
        return reply(conn, doSafe(() => session.undo()), snapshot());
      case 'redo':
        return reply(conn, doSafe(() => session.redo()), snapshot());
      case 'wait': {
        const snap = snapshot();
        if (snap.canPlace || snap.game?.winner) return reply(conn, true, { ...snap, timedOut: false });
        const timeoutMs = Math.max(1000, Math.min(req.timeoutMs ?? 55_000, 590_000));
        const waiter: Waiter = {
          respond: (s, timedOut) => reply(conn, true, { ...s, timedOut }),
          timer: setTimeout(() => {
            waiters.delete(waiter);
            waiter.respond(snapshot(), true);
          }, timeoutMs),
        };
        waiters.add(waiter);
        conn.on('close', () => {
          clearTimeout(waiter.timer);
          waiters.delete(waiter);
        });
        return;
      }
      case 'quit':
        reply(conn, true, 'bye');
        return shutdown(0);
      default:
        return reply(conn, false, `unknown command: ${req.cmd}`);
    }
  }

  server.listen(sockPath, () => console.log(`[pente] listening at ${sockPath}`));

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  function shutdown(codeExit: number): void {
    try {
      session.disconnect();
    } catch {
      /* best effort */
    }
    try {
      server.close();
    } catch {
      /* best effort */
    }
    try {
      fs.unlinkSync(sockPath);
    } catch {
      /* already gone */
    }
    setTimeout(() => process.exit(codeExit), 200);
  }
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
}

function parseCoord(s: string): Coord | null {
  const parts = s.trim().split(/[,\s]+/).map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) return null;
  return parts as [number, number, number];
}

/** Guard a move behind the turn gate + honest core errors; returns an error string or null. */
function tryMove(session: NetSession, coord: Coord): string | null {
  if (!session.canPlace()) return 'not your turn';
  try {
    session.place(coord);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function doSafe(fn: () => void): boolean {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
}

/** Remove a stale socket, or refuse if a live daemon already owns this code. */
async function ensureFreeSocket(sockPath: string, code: string): Promise<void> {
  if (!fs.existsSync(sockPath)) return;
  const alive = await new Promise<boolean>((resolve) => {
    const probe = net.connect(sockPath);
    probe.on('connect', () => {
      probe.destroy();
      resolve(true);
    });
    probe.on('error', () => resolve(false));
  });
  if (alive) {
    console.error(`[pente] a daemon is already running for room ${code}. Use its verbs, or 'pente quit ${code}'.`);
    process.exit(3);
  }
  fs.unlinkSync(sockPath); // stale
}
