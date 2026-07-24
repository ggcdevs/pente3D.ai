/**
 * Thin IPC client: connect to a room's daemon socket, send one request line,
 * read one response line, return it. Used by the short-lived `show`/`move`/`wait`/
 * `status`/`quit`/`undo`/`redo` verbs.
 */
import net from 'node:net';
import fs from 'node:fs';
import { socketPath } from './daemon';

export interface Reply {
  ok: boolean;
  data: unknown;
}

/**
 * Send `req` to the daemon for `code`. Retries the connect briefly so a verb fired
 * right after `play` waits for the socket to appear. `readTimeoutMs` bounds the wait
 * for the response (a `wait` command sets it generously).
 */
export async function request(
  code: string,
  req: Record<string, unknown>,
  readTimeoutMs = 600_000,
): Promise<Reply> {
  const sockPath = socketPath(code);
  const conn = await connectWithRetry(sockPath, 3000);
  return await new Promise<Reply>((resolve, reject) => {
    let buf = '';
    const to = setTimeout(() => {
      conn.destroy();
      reject(new Error('timed out waiting for daemon response'));
    }, readTimeoutMs);
    conn.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl !== -1) {
        clearTimeout(to);
        conn.end();
        try {
          resolve(JSON.parse(buf.slice(0, nl)) as Reply);
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      }
    });
    conn.on('error', (e) => {
      clearTimeout(to);
      reject(e);
    });
    conn.write(JSON.stringify(req) + '\n');
  });
}

function connectWithRetry(sockPath: string, totalMs: number): Promise<net.Socket> {
  const deadline = Date.now() + totalMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (!fs.existsSync(sockPath)) {
        if (Date.now() > deadline) return reject(new Error(`no daemon socket at ${sockPath} — is 'pente play' running?`));
        return setTimeout(attempt, 150);
      }
      const conn = net.connect(sockPath);
      conn.once('connect', () => resolve(conn));
      conn.once('error', (e) => {
        if (Date.now() > deadline) return reject(e);
        setTimeout(attempt, 150);
      });
    };
    attempt();
  });
}
