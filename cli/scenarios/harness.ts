/**
 * A tiny harness for CLI-driven **cross-"device" scenarios** over the real relay — the
 * deterministic net tests the browser cannot easily drive (design
 * `planning/2026-07-24-net-model-v3.1-design.md` §8): the issue #45 outage repro,
 * rematch + reconnect, code reuse, the fast-forward-vs-diff boundary.
 *
 * ## Shape
 *
 * Each peer is a REAL `pente play` daemon in its own process, with its own state dir,
 * playerId and (in-memory) IndexedDB — two genuinely separate clients that see each other
 * only through the relay. Commands are driven by spawning the ordinary thin verbs with
 * `--json`, so a scenario exercises the CLI exactly as a human would and asserts on the
 * daemon's own {@link Snapshot} state, never on a log line (agent-principles #3:
 * proof-by-state).
 *
 * ## Assertions
 *
 * {@link check} records a named pass/fail; {@link report} prints the tally and yields the
 * process exit code. A scenario is a plain script — no test runner — because it needs live
 * network, two child processes and multi-second waits; it is run on demand
 * (`npm run scenario:<name>`) and is honest about being an integration probe, not a unit test.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, type Snapshot } from '../views';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Repo root (…/cli/scenarios → …). */
export const REPO_ROOT = path.resolve(HERE, '..', '..');
const TSX = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const CLI = path.join(REPO_ROOT, 'cli', 'main.ts');

/** Print scenario progress with a marker that stands out in a wall of daemon output. */
export function log(msg: string): void {
  console.log(`\n▸ ${msg}`);
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** One CLI peer: a `pente play` daemon process with its own identity + state dir. */
export interface Peer {
  readonly name: string;
  readonly code: string;
  readonly playerId: string;
  readonly stateDir: string;
  readonly proc: ChildProcess;
}

const peers: Peer[] = [];
/** Set `SCENARIO_VERBOSE=1` to tee each daemon's live board rendering into the output. */
const VERBOSE = process.env.SCENARIO_VERBOSE === '1';

/**
 * Start a peer's daemon and wait until it has settled into a room (phase `connected`,
 * seat assigned). `host: true` establishes the room; a joiner should be started only AFTER
 * the host has settled, so the run exercises the resident/newcomer path deterministically
 * instead of racing the simultaneous-arrival election.
 */
export async function startPeer(opts: {
  name: string;
  code: string;
  host: boolean;
  timeoutMs?: number;
}): Promise<Peer> {
  // Under the OS temp dir, NOT the repo: a peer's state dir holds its Unix socket, and a
  // socket path is capped at ~104 bytes — a repo-relative path in a deep checkout (e.g. a
  // worktree under ~/.config/…) silently truncates and every verb then fails to find the
  // daemon. Short by construction here.
  const stateDir = path.join(os.tmpdir(), 'pente-scn', opts.code, opts.name);
  fs.mkdirSync(stateDir, { recursive: true });
  const playerId = `cli-${opts.name}-${opts.code}`.toLowerCase();
  const env = { ...process.env, PENTE_STATE_DIR: stateDir, PENTE_PLAYER_ID: playerId };
  const args = [CLI, 'play', opts.code, ...(opts.host ? ['--host'] : [])];
  const proc = spawn(TSX, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `[${opts.name}]`;
  proc.stdout?.on('data', (b: Buffer) => {
    if (VERBOSE) process.stdout.write(String(b).replace(/^/gm, `${tag} `));
  });
  proc.stderr?.on('data', (b: Buffer) => process.stderr.write(String(b).replace(/^/gm, `${tag}! `)));

  const peer: Peer = { name: opts.name, code: opts.code, playerId, stateDir, proc };
  peers.push(peer);
  await waitFor(
    peer,
    (s) => s.phase === 'connected' && s.seat !== null,
    `${opts.name} to reach a seat`,
    opts.timeoutMs ?? 30_000,
  );
  return peer;
}

/**
 * Run one thin verb for `peer` and return the parsed {@link Snapshot} (`--json`). Throws with
 * the CLI's own stderr on a non-zero exit, so a refused move / missing daemon surfaces
 * honestly rather than as a silently-empty state.
 */
export async function verb(
  peer: Peer,
  argv: readonly string[],
  timeoutMs = 70_000,
): Promise<Snapshot & { timedOut?: boolean }> {
  const out = await run(peer, argv, timeoutMs);
  return JSON.parse(out) as Snapshot;
}

/** Like {@link verb} but returns `null` instead of throwing when the CLI refuses (exit ≠ 0). */
export async function tryVerb(
  peer: Peer,
  argv: readonly string[],
  timeoutMs = 70_000,
): Promise<(Snapshot & { timedOut?: boolean }) | null> {
  try {
    return await verb(peer, argv, timeoutMs);
  } catch {
    return null;
  }
}

function run(peer: Peer, argv: readonly string[], timeoutMs: number): Promise<string> {
  const env = { ...process.env, PENTE_STATE_DIR: peer.stateDir, PENTE_PLAYER_ID: peer.playerId };
  // The room code is the FIRST positional of every verb (`move CODE x,y,z`), so it is spliced
  // in after the verb rather than appended — appending would make a `move`'s coordinate the code.
  const [verbName = 'status', ...rest] = argv;
  const cmd = [CLI, verbName, peer.code, ...rest, '--json'];
  return new Promise((resolve, reject) => {
    const p = spawn(TSX, cmd, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      p.kill('SIGKILL');
      reject(new Error(`${peer.name}: '${argv.join(' ')}' timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    p.stdout?.on('data', (b: Buffer) => (out += String(b)));
    p.stderr?.on('data', (b: Buffer) => (err += String(b)));
    p.on('close', (codeExit) => {
      clearTimeout(timer);
      if (codeExit === 0) return resolve(out.trim());
      reject(new Error(`${peer.name}: '${argv.join(' ')}' exited ${codeExit}: ${err.trim() || out.trim()}`));
    });
  });
}

/** The peer's current snapshot (`status`), the cheapest state read. */
export const statusOf = (peer: Peer): Promise<Snapshot> => verb(peer, ['status'], 20_000);

/**
 * Poll `status` until `pred` holds. Used for the transitions that have no blocking verb —
 * a link coming back up, the peer's presence clearing after a Last-Will. Throws on timeout
 * with the last snapshot, so a stall names what it was waiting for.
 */
export async function waitFor(
  peer: Peer,
  pred: (s: Snapshot) => boolean,
  what: string,
  timeoutMs = 30_000,
): Promise<Snapshot> {
  const deadline = Date.now() + timeoutMs;
  let last: Snapshot | null = null;
  for (;;) {
    last = await statusOf(peer).catch(() => last);
    if (last !== null && pred(last)) return last;
    if (Date.now() > deadline) {
      throw new Error(
        `${peer.name}: timed out (${timeoutMs}ms) waiting for ${what}; last state = ${JSON.stringify(last)}`,
      );
    }
    await sleep(500);
  }
}

// ── Assertions ────────────────────────────────────────────────────────────────────────

interface Check {
  readonly label: string;
  readonly ok: boolean;
  readonly detail: string;
}
const checks: Check[] = [];

/** Record a named assertion. `detail` is printed either way — the observed value. */
export function check(label: string, ok: boolean, detail = ''): void {
  checks.push({ label, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
}

/** Print a peer's board (any registered view) for eyeballing a failure. */
export function showBoard(peer: Peer, snap: Snapshot, viewName = 'list'): void {
  console.log(`\n── ${peer.name} ──\n${render(snap, viewName)}`);
}

/** Print the tally and return the process exit code (0 all-pass, 1 any failure). */
export function report(title: string): number {
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${'═'.repeat(70)}\n${title}: ${checks.length - failed.length}/${checks.length} checks passed`);
  for (const f of failed) console.log(`  ✗ ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
  console.log('═'.repeat(70));
  return failed.length === 0 ? 0 : 1;
}

/**
 * Stop every daemon this run started (SIGTERM so each clears its retained presence, then
 * SIGKILL as a backstop) and remove the scenario's state dirs. Always called from the
 * scenario's `finally`, so a thrown assertion never leaves a daemon holding the room.
 */
export async function stopAll(): Promise<void> {
  for (const p of peers) {
    if (p.proc.exitCode === null) p.proc.kill('SIGTERM');
  }
  await sleep(700);
  for (const p of peers) {
    if (p.proc.exitCode === null) p.proc.kill('SIGKILL');
    fs.rmSync(p.stateDir, { recursive: true, force: true });
  }
}
