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
import { dropLink, restoreLink, linkStatus } from './netlink';
import { render, type Snapshot } from './views';
import type { DivergenceView } from '../src/ui/widgets/divergenceModel';
import { generateGameCode, validateGameCode } from '../src/ui/widgets/netModel';
import { headHash } from '../src/core/eventLog';
import { deriveEndState, HIDDEN_END_STATE, REMATCH_ACTION } from '../src/net/endState';
import type { Coord } from '../src/core/coords';
import type { Proposal } from '../src/net/admission';
import type { NetSession } from '../src/net/session';

/** Runtime state dir (sockets + playerid). Overridable so two CLIs can co-exist. */
const STATE_DIR = path.resolve(process.env.PENTE_STATE_DIR ?? path.join(process.cwd(), '.pente-cli'));

/**
 * The OS limit on a Unix-socket path (`sockaddr_un.sun_path`) — 108 bytes on Linux, 104 on
 * macOS; the smaller value is used so the check is portable. Exceeding it does NOT error:
 * the kernel silently TRUNCATES the path, so `bind` creates a differently-named socket and
 * every verb then reports "no daemon socket" while the daemon looks perfectly healthy.
 * {@link socketPath} refuses that outcome loudly instead (it cost a real debugging session).
 */
const SUN_PATH_MAX = 104;

export function socketPath(code: string): string {
  const p = path.join(STATE_DIR, `${code}.sock`);
  if (Buffer.byteLength(p) >= SUN_PATH_MAX) {
    console.error(
      `[pente] socket path is too long for this OS (${Buffer.byteLength(p)} ≥ ${SUN_PATH_MAX} bytes):\n` +
        `  ${p}\n` +
        `Set PENTE_STATE_DIR to somewhere shorter, e.g. PENTE_STATE_DIR=/tmp/pente-${code.toLowerCase()}`,
    );
    process.exit(2);
  }
  return p;
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
      // Game IDENTITY + history fingerprint, read off the live engine exactly as the browser's
      // `window.__pente.getGameUuid`/`getHeadHash` do (`main.ts` `getNetHeadHash`) — the same two
      // facts, so a CLI scenario and a Playwright spec assert on one truth rather than two.
      gameUuid: session.gameUuid(),
      headHash: headHashOrNull(),
      link: linkStatus(),
      // The open divergence (V.4b, #38) — the same pure card the browser panel paints, so a
      // scenario asserts on the players' own facts rather than a CLI-only projection.
      divergence: divergenceOrNull(),
      // The end-state / rematch card (N.2, #12), from the same pure `deriveEndState` the browser
      // overlay paints — over the live net game, the N.1 handshake and this client's seat.
      endState: game === null ? HIDDEN_END_STATE : deriveEndState(game, session.getHandshake(), st.seat),
    };
  }

  /** The open divergence card, or `null` when there is nothing to resolve (V.4b). */
  function divergenceOrNull(): DivergenceView | null {
    const view = session.divergenceView();
    return view.show ? view : null;
  }

  /** The authoritative log's head hash, or `null` with no live engine (offline). */
  function headHashOrNull(): string | null {
    const engine = session.syncEngine();
    return engine === null ? null : headHash(engine.game().log);
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

  /**
   * Apply a MUTUALLY-ACCEPTED rematch, exactly as the browser app does (`src/main.ts`): when the
   * out-of-band handshake resolves `accepted` for the `rematch` action — whether WE asked and the
   * peer agreed or the reverse — both clients seamlessly reset to a fresh game over the SAME
   * connection with their seats ALTERNATED (`resetForRematch`). Fired once per resolution id, so a
   * repeat notification cannot reset a game that is already under way.
   *
   * The CLI runs the real protocol rather than a simplified one; a client that asked for a rematch
   * and then never swapped would be a second client the browser could not actually play against, and
   * the post-swap colour a returning peer must come back on (#40) would be a fiction of this file.
   */
  let handledRematchId: string | null = null;
  function maybeRematchReset(): void {
    const res = session.getHandshake().resolution;
    if (res === null || res.action !== REMATCH_ACTION || res.outcome !== 'accepted') return;
    if (res.id === handledRematchId) return;
    handledRematchId = res.id;
    session.resetForRematch();
  }

  session.onChange(onChange);
  // The OUT-OF-BAND handshake (N.1) also changes what a player can do without the game changing:
  // an incoming resolution ask, a decline, a peer-gone auto-cancel. Repaint on it, and APPLY an
  // accepted resolution/rematch on BOTH sides exactly as the browser app does (`main.ts`) — the CLI
  // must run the same protocol, not a simplified one, or it would stop being a faithful second client.
  session.onHandshakeChange(() => {
    session.applyAcceptedResolution();
    maybeRematchReset();
    console.log('\n' + render(snapshot(), opts.view) + '\n' + '─'.repeat(48));
  });

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
      // ── Outage control (issue #45 scenarios) ────────────────────────────────
      // `drop` kills the SOCKET while the session keeps its engine/seat/game and stays
      // `connected` — a screen-lock, not a leave. `restore` lets mqtt.js reconnect. What
      // the session does (or fails to do) about the moves it missed in between is the
      // behaviour under test.
      case 'drop': {
        // `arg` is a comma list of outage modifiers (`silent`, `lossy`) — see `DropOptions`.
        const modes = (req.arg ?? '').split(',');
        const opts = { silent: modes.includes('silent'), lossy: modes.includes('lossy') };
        if (!dropLink(opts)) return reply(conn, false, 'no live link to drop');
        console.log(
          `[pente] link DROPPED (silent=${opts.silent} lossy=${opts.lossy}; session still thinks it is connected)`,
        );
        return reply(conn, true, snapshot());
      }
      case 'restore':
        if (!restoreLink()) return reply(conn, false, 'no link to restore');
        console.log('[pente] link RESTORING…');
        return reply(conn, true, snapshot());
      // ── Room lifecycle (V.7 scenarios) ────────────────────────────────────────
      // `leave` is a real DEPARTURE (transport down, engine + seat dropped) — not the `drop` outage,
      // which keeps the session. `enter <seed>` walks back in with an explicit seed, so a scenario can
      // drive the §3 matrix from the CLI: `new` (start over — accepts EMPTY only) or `defer` (dealer's
      // choice — the only kind that adopts a peer's game, and the one a returning peer re-seeds from
      // its breadcrumb on). Together they are how a player re-uses a room code for another game.
      case 'leave':
        if (session.state().phase === 'offline') return reply(conn, false, 'not in a room');
        session.disconnect();
        console.log('[pente] LEFT the room (session offline; the daemon stays up)');
        return reply(conn, true, snapshot());
      case 'enter': {
        if (session.state().phase !== 'offline') {
          return reply(conn, false, "already in a room — 'pente leave' first");
        }
        const seed = req.arg ?? 'defer';
        if (seed !== 'new' && seed !== 'defer') {
          return reply(conn, false, `enter: want a seed of new | defer (got "${seed}")`);
        }
        const proposal: Proposal = { kind: seed };
        console.log(`[pente] ENTERING room ${code} on the '${seed}' seed…`);
        // The entry is a negotiation (connect → hello → settle window → admit/establish), so the
        // reply waits for it and carries the OUTCOME — including a refusal, which lands as a
        // `joinError` on an offline snapshot rather than as a thrown error.
        session
          .enter(code, proposal)
          .then(() => reply(conn, true, snapshot()))
          .catch((e: unknown) => reply(conn, false, e instanceof Error ? e.message : String(e)));
        return;
      }
      // ── Rematch (N.2/#12): the out-of-band ask, and the answer to one ──────────
      // Distinct from `resolve`/`agree`, which answer a DIVERGENCE. A mutually-accepted rematch resets
      // both peers to a fresh game with their colours ALTERNATED (see `maybeRematchReset`).
      case 'rematch':
        if (!session.propose(REMATCH_ACTION)) {
          return reply(conn, false, 'rematch: not connected/seated, so there is nothing to ask about');
        }
        return reply(conn, true, snapshot());
      case 'accept':
      case 'decline':
        if (!session.respond(req.cmd === 'accept')) {
          return reply(conn, false, `${req.cmd}: there is no pending proposal to answer`);
        }
        return reply(conn, true, snapshot());
      // ── Divergence resolution (V.4b, #38) ─────────────────────────────────────
      // `resolve <choice>` suggests one; `agree`/`refuse` answers the peer's. Nothing lands until
      // BOTH sides agree — the apply runs off the handshake resolution, above.
      case 'resolve': {
        const choice = req.arg ?? '';
        if (choice !== 'take-mine' && choice !== 'take-theirs' && choice !== 'rewind') {
          return reply(conn, false, `resolve: want take-mine | take-theirs | rewind (got "${choice}")`);
        }
        if (!session.proposeResolution(choice)) {
          return reply(conn, false, 'resolve: nothing to resolve (or that choice names no history here)');
        }
        return reply(conn, true, snapshot());
      }
      case 'agree':
      case 'refuse': {
        if (!session.respondResolution(req.cmd === 'agree')) {
          return reply(conn, false, `${req.cmd}: no resolution to answer (or it names a history this game does not have)`);
        }
        // The APPLY is not done here: `respondResolution` resolves the handshake, and the
        // `onHandshakeChange` subscription above applies it — the same single path the proposer's
        // side takes when the peer's answer arrives, so both sides run identical code.
        return reply(conn, true, snapshot());
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
