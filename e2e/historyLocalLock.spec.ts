import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Task N.4 e2e — the #17 "history slider stays local" VERIFY-AND-LOCK.
 *
 * The history slider is ALREADY purely local: `scene.scrubTo(k)` is a read-only render seam that
 * re-renders `game.stateAt(k)` for the LOCAL viewer without touching the canonical `Game` or the
 * networked session. `history.spec.ts` already proves the local render behavior (piece count drops,
 * `maxPly` intact) in an OFFLINE game. This spec adds the missing PERMANENT lock: it proves that
 * scrubbing the slider during a NETWORKED game issues ZERO transport publishes, and that a change
 * which made `scrubTo` publish would FAIL here (the guard bites).
 *
 * ## Architectural note (why the networked slider is structurally read-only)
 *
 * In a networked game the scene renders the SESSION's authoritative state (`renderNetState` /
 * `adoptNetState`, issue #4 "one game per session"); the scene-LOCAL `game` the scrub seam reads
 * (`game.ply()` / `game.stateAt(k)`) is never advanced. So during a networked game `getHistory()`
 * reports `maxPly: 0` and the range is DISABLED — the slider is not merely read-only, it is inert
 * (it has no wire to the networked history at all, so it structurally cannot publish). This spec
 * asserts BOTH facts: (a) the disabled/inert state, and (b) — the load-bearing lock — that driving
 * the `scrubTo` seam and the real range control across their full span while networked publishes
 * NOTHING and leaves the peer untouched. Test (2) below covers the ACTIVE-scrub semantics
 * (viewedPly moves while maxPly holds at the head) in the offline game where the slider is live.
 *
 * ## Proof-by-behavior, not a log line (agent-principles #3)
 *
 * The mock transport factory (installed BEFORE boot, the `__penteNetTransportFactory` seam
 * `netWiring.spec.ts` uses) keeps a real, observable `publishCount` on `window.__pentePublishLog`.
 * We host a networked game, drive real placements so `publishCount` is provably > 0 (the counter is
 * wired and DOES advance on a genuine sync publish — so a later "unchanged" assertion means "nothing
 * published", not "the counter is dead"; the same body also proves `resync()` — the publish the bite
 * would inject — bumps it), snapshot the count, then drive the `scrubTo` seam AND a real range DRAG
 * across the full span and assert publishCount is UNCHANGED and the peer's headHash + rendered board
 * are UNAFFECTED.
 *
 * ## The lock bites (agent-principles #7)
 *
 * A guard comment at `scene.scrubTo` (src/render/scene.ts) records that a publish there must break
 * this spec. Proof it bites, run manually and RESTORE: add `netHooks.resync();` inside `scrubTo`
 * (resync re-broadcasts the log — a publish) → the "publishCount unchanged" assertions below turn red
 * because each scrub now fires a publish. Restoring the read-only seam makes them green again.
 * (Observed while writing this spec: over a networked game a `resync()` bumps `publishCount` by one,
 * while five `scrubTo` calls bumped it by zero — the exact contrast this lock enforces.)
 */

/** The subset of `window.__pente` this spec drives. */
type Pente = {
  getState(): { pieces: Record<string, string>; turn: string; winner: string | null } | null;
  getHistory(): { maxPly: number; viewedPly: number; scrubbing: boolean } | null;
  getHeadHash(): string | null;
  getNet(): { phase: string; seat: string | null; code: string | null } | null;
  scrubTo(k: number): void;
  place(coords: [number, number, number]): unknown;
  dispatch(id: string): boolean | null;
  setPendingJoinCode(code: string): void;
};

const HISTORY_ID = 'historySlider';

/**
 * Install a BroadcastChannel-backed mock transport BEFORE the app boots that ALSO exposes a live,
 * observable publish counter on `window.__pentePublishLog` (`{ count }`). It is a faithful relay
 * (opaque JSON, never echoes to its own sender), the same hermetic cross-page relay
 * `netWiring.spec.ts` uses — extended only with the counter this lock asserts on. The counter is real
 * transport state (every `publish` bumps it), so an "unchanged" assertion proves the scrub emitted
 * nothing at the TRANSPORT boundary, not merely that some higher-level flag stayed put.
 */
async function installCountingMock(page: Page, senderId: string): Promise<void> {
  await page.addInitScript((sid: string) => {
    window.localStorage.clear();
    const pubLog = { count: 0 };
    (window as unknown as { __pentePublishLog: typeof pubLog }).__pentePublishLog = pubLog;
    (window as unknown as { __penteNetTransportFactory: () => unknown }).__penteNetTransportFactory =
      () => {
        let channel: BroadcastChannel | null = null;
        let msgCb: (msg: unknown) => void = () => {};
        let presenceCb: (peers: readonly string[]) => void = () => {};
        const present = new Set<string>([sid]);
        let lastBody: unknown = null;
        return {
          connect: (roomCode: string) => {
            channel = new BroadcastChannel(`pente-mock-${roomCode}`);
            channel.onmessage = (ev: MessageEvent) => {
              const data = ev.data as { from: string; kind: string; body?: unknown };
              if (data.from === sid) return; // faithful relay: never echo to the sender
              if (data.kind === 'msg') {
                msgCb(data.body);
              } else if (data.kind === 'hello') {
                present.add(data.from);
                presenceCb([...present]);
                channel!.postMessage({ from: sid, kind: 'hello-ack' });
                if (lastBody !== null) {
                  channel!.postMessage({ from: sid, kind: 'msg', body: lastBody });
                }
              } else if (data.kind === 'hello-ack') {
                present.add(data.from);
                presenceCb([...present]);
              }
            };
            channel.postMessage({ from: sid, kind: 'hello' });
            presenceCb([...present]);
            return Promise.resolve();
          },
          publish: (body: unknown) => {
            // The one and only transport publish path — count EVERY publish so the lock can assert a
            // scrub adds nothing here (observable transport state, not a log line — agent-principles #3).
            lastBody = JSON.parse(JSON.stringify(body));
            pubLog.count += 1;
            channel?.postMessage({ from: sid, kind: 'msg', body: lastBody });
          },
          onMessage: (cb: (msg: unknown) => void) => {
            msgCb = cb;
          },
          onPresence: (cb: (peers: readonly string[]) => void) => {
            presenceCb = cb;
          },
          disconnect: () => {
            channel?.close();
            channel = null;
          },
        };
      };
  }, senderId);
}

async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.getNet === 'function' &&
      typeof p.getHeadHash === 'function' &&
      typeof p.getHistory === 'function' &&
      typeof p.scrubTo === 'function' &&
      typeof p.place === 'function' &&
      !!document.querySelector('[data-widget-id="historySlider"]')
    );
  });
  // The session wires up async (opens IndexedDB); wait until it reports an (offline) readout.
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: { getNet(): unknown } }).__pente;
    return !!p && p.getNet() !== null;
  });
}

const evalPente = <T,>(page: Page, fn: (p: Pente) => T): Promise<T> =>
  page.evaluate(
    (body: string) =>
      (new Function('return (' + body + ')')() as (p: Pente) => unknown)(
        (window as unknown as { __pente: Pente }).__pente,
      ),
    fn.toString(),
  ) as Promise<T>;

const publishCount = (page: Page): Promise<number> =>
  page.evaluate(
    () => (window as unknown as { __pentePublishLog: { count: number } }).__pentePublishLog.count,
  );

const net = (page: Page) => evalPente(page, (p) => p.getNet());
const headHash = (page: Page) => evalPente(page, (p) => p.getHeadHash());
const history = (page: Page) => evalPente(page, (p) => p.getHistory()!);

async function waitConnected(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getNet()?.phase === 'connected',
  );
}

const range = (page: Page) =>
  page.locator(`[data-widget-id="${HISTORY_ID}"] [data-testid="history-range"]`);

test('scrubbing the history slider in a NETWORKED game issues ZERO transport publishes (#17 lock)', async ({
  browser,
}) => {
  // Two pages in ONE context share the counting BroadcastChannel relay — a real cross-client relay,
  // hermetically. The joiner is a genuine second peer so we can prove its authoritative state is
  // UNAFFECTED by the host's local scrub (not merely that a counter did not move).
  const context = await browser.newContext();
  const host = await context.newPage();
  const joiner = await context.newPage();
  await installCountingMock(host, 'host-tab');
  await installCountingMock(joiner, 'joiner-tab');

  try {
    // Host a networked game (white seat), then join the same room from the isolated joiner page.
    await ready(host);
    await evalPente(host, (p) => p.dispatch('hostGame'));
    await waitConnected(host);
    expect((await net(host))?.seat).toBe('white');
    const code = (await net(host))?.code;
    expect(code, 'host must claim a room code').not.toBeNull();

    await ready(joiner);
    await joiner.evaluate((c: string) => {
      const p = (window as unknown as { __pente: Pente }).__pente;
      p.setPendingJoinCode(c);
      p.dispatch('joinGame');
    }, code!);
    await waitConnected(joiner);
    expect((await net(joiner))?.seat).toBe('black');

    // Drive a real networked game: alternate white/black placements. Every placement crosses the relay,
    // so the host's publishCount is provably > 0 afterwards — proving the counter is wired and DOES
    // advance on a genuine sync publish (so a later "unchanged" assertion means "nothing published").
    await evalPente(host, (p) => p.place([0, 0, 0])); // white
    await joiner.waitForFunction(
      () => (window as unknown as { __pente: Pente }).__pente.getState()?.pieces['0,0,0'] === 'white',
    );
    await evalPente(joiner, (p) => p.place([4, 4, 4])); // black
    await host.waitForFunction(
      () => (window as unknown as { __pente: Pente }).__pente.getState()?.pieces['4,4,4'] === 'black',
    );
    await evalPente(host, (p) => p.place([0, 4, 0])); // white
    await joiner.waitForFunction(
      () => (window as unknown as { __pente: Pente }).__pente.getState()?.pieces['0,4,0'] === 'white',
    );
    await evalPente(joiner, (p) => p.place([4, 0, 4])); // black
    await host.waitForFunction(
      () => (window as unknown as { __pente: Pente }).__pente.getState()?.pieces['4,0,4'] === 'black',
    );

    // Both peers converged; the host's rendered board holds all four networked pieces.
    const headBefore = await headHash(host);
    expect(headBefore).not.toBeNull();
    expect(await headHash(joiner)).toBe(headBefore);
    expect(Object.keys((await evalPente(host, (p) => p.getState()!)).pieces).length).toBe(4);
    const countArmed = await publishCount(host);
    expect(countArmed, 'real networked moves MUST publish — the counter is live').toBeGreaterThan(0);

    // The scene renders the SESSION game while networked; the scene-local history the slider scrubs is
    // never advanced, so the slider is DISABLED (inert) during networked play — an even stronger form of
    // "stays local": it has no wire to the networked history at all (see the file header note).
    await expect(range(host)).toBeDisabled();
    expect((await history(host))).toEqual({ maxPly: 0, viewedPly: 0, scrubbing: false });

    // Snapshot the joiner's publish count + rendered pieces to prove the host's scrub never reaches the
    // peer (a publish would relay to the joiner and could bump its count / adopt state).
    const joinerCountBefore = await publishCount(joiner);
    const joinerPiecesBefore = Object.keys((await evalPente(joiner, (p) => p.getState()!)).pieces)
      .sort()
      .join('|');

    // === THE LOCK ===
    // Drive the `scrubTo` SEAM across its full nominal span several times (back and forth). Even though
    // the networked slider is inert, the seam still RUNS — and it MUST publish nothing. After EACH call
    // assert the transport publishCount is UNCHANGED. This is exactly the assertion that a publish added
    // to `scrubTo` (e.g. `netHooks.resync()`) would break (agent-principles #7).
    for (const k of [0, 2, 4, 1, 3, 0, 4]) {
      await host.evaluate((kk: number) => (window as unknown as { __pente: Pente }).__pente.scrubTo(kk), k);
      expect(
        await publishCount(host),
        `scrubTo(${k}) must not publish — the slider is read-only (#17)`,
      ).toBe(countArmed);
    }

    // Dispatch a REAL `input` event on the range element itself (the exact event a mouse drag fires,
    // and the one the widget's scrub handler listens for), across the full span. Firing it directly —
    // rather than via Playwright `fill`, which refuses the disabled control — proves that even the
    // widget's own DOM scrub path, driven by a genuine input event, publishes NOTHING.
    for (const v of ['0', '3', '1', '4']) {
      await host.evaluate((val: string) => {
        const r = document.querySelector<HTMLInputElement>(
          '[data-widget-id="historySlider"] [data-testid="history-range"]',
        );
        if (r === null) throw new Error('history range not mounted');
        r.value = val;
        r.dispatchEvent(new Event('input', { bubbles: true }));
      }, v);
      expect(
        await publishCount(host),
        `a real range input event to ${v} must not publish — the slider is read-only (#17)`,
      ).toBe(countArmed);
    }

    // The peer is UNAFFECTED: both heads unchanged, the joiner published nothing new, board intact.
    expect(await headHash(host), 'the host head must be unchanged by scrubbing').toBe(headBefore);
    expect(await headHash(joiner), 'the peer head must be unaffected by the host scrub').toBe(
      headBefore,
    );
    expect(await publishCount(joiner)).toBe(joinerCountBefore);
    const joinerPiecesAfter = Object.keys((await evalPente(joiner, (p) => p.getState()!)).pieces)
      .sort()
      .join('|');
    expect(joinerPiecesAfter, "the peer's rendered board must be intact after the host scrub").toBe(
      joinerPiecesBefore,
    );
    // And the host's own publish count never moved across the whole scrub campaign.
    expect(await publishCount(host)).toBe(countArmed);

    const shot = resolve('e2e/artifacts/history-local-lock.png');
    mkdirSync(dirname(shot), { recursive: true });
    await host.screenshot({ path: shot });
  } finally {
    await context.close();
  }
});

test('an ACTIVE offline scrub moves viewedPly while maxPly holds at the head (local, no session)', async ({
  page,
}) => {
  // Offline, the slider is LIVE and scrubs the scene-local game. This complements the networked lock
  // above by proving the ACTIVE-scrub semantics the #17 contract names: the viewed ply moves back
  // while the canonical head (maxPly) never rewinds — a viewer-local cursor, not an undo. No transport
  // exists offline, so "publishes nothing" is structural here; the render behavior is the proof.
  await ready(page);

  // Four placements on the offline board → head at ply 4, slider live.
  await evalPente(page, (p) => p.place([0, 0, 0]));
  await evalPente(page, (p) => p.place([4, 4, 4]));
  await evalPente(page, (p) => p.place([0, 4, 0]));
  await evalPente(page, (p) => p.place([4, 0, 4]));
  expect(await history(page)).toEqual({ maxPly: 4, viewedPly: 4, scrubbing: false });
  await expect(range(page)).toBeEnabled();

  // Scrub the local view back and forth; maxPly (the head) NEVER moves, viewedPly tracks the target,
  // and the rendered piece count follows the viewed ply — the head stays intact (this is not an undo).
  for (const k of [2, 0, 3, 1, 4]) {
    await page.evaluate((kk: number) => (window as unknown as { __pente: Pente }).__pente.scrubTo(kk), k);
    const h = await history(page);
    expect(h.maxPly, 'the canonical head must never rewind while scrubbing').toBe(4);
    expect(h.viewedPly).toBe(k);
    expect(h.scrubbing).toBe(k < 4);
    const rendered = Object.keys((await evalPente(page, (p) => p.getState()!)).pieces).length;
    expect(rendered, `ply ${k} must render exactly ${k} pieces`).toBe(k);
  }

  // A REAL range DRAG (Playwright `fill` fires a genuine `input` event on the live control) drives the
  // widget's own scrub handler → `scrubTo`, dropping the rendered board to the dragged ply — proving
  // the DOM control path (not just the programmatic seam) is viewer-local.
  await range(page).fill('1');
  expect((await history(page)).viewedPly).toBe(1);
  expect(Object.keys((await evalPente(page, (p) => p.getState()!)).pieces).length).toBe(1);

  // Back at the head: live again, full board restored.
  await evalPente(page, (p) => p.scrubTo(4));
  expect(await history(page)).toEqual({ maxPly: 4, viewedPly: 4, scrubbing: false });
  expect(Object.keys((await evalPente(page, (p) => p.getState()!)).pieces).length).toBe(4);
});
