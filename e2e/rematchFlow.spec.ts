import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import mqtt from 'mqtt';
import relay from '../src/config/defaults/relay.json' with { type: 'json' };

/**
 * Task N.2.2 e2e (issue #12 win/rematch flow) — the GLUE the unit tests cannot prove: the NON-BLOCKING,
 * view-only END-STATE overlay driven by the pure `deriveEndState` (Task N.2.1), the mutual rematch via
 * the N.1 handshake, and the MUTUAL-ACCEPT reset to a FRESH game in the SAME room with ALTERNATED
 * colors. Every assertion is proof-by-BEHAVIOR on real `window.__pente` state (agent-principles #3),
 * never a log line:
 *
 *   1. Two contexts play a REAL networked five-in-a-row → BOTH clients' `getEndState().show` is true
 *      with the winner/win-reason, AND the board is STILL VISIBLE (getState still reports the won
 *      pieces — the overlay does not hide/reset the board; the DOM overlay has no display:none board
 *      backdrop). The overlay card is actually in the DOM (`data-testid="endstate-overlay"` visible).
 *   2. A clicks Rematch (`propose('rematch')`) → B's `getEndState().rematchUi === 'incoming'` (the ask
 *      crossed the relay) → B Accepts → BOTH clients reset SEAMLESSLY IN PLACE to a FRESH EMPTY game
 *      over the SAME live connection (NO disconnect/re-host — design N.2 decision 2), with their SEATS
 *      SWAPPED (host was white → now black; joiner was black → now white). The reset never drops the
 *      connection: `getNet().phase` stays `connected` throughout — never `offline`/`connecting` — so
 *      there is NO present→absent presence flicker to the peer (the exact regression the earlier
 *      disconnect→re-host shortcut caused, and what the epoch-tagged in-place reset removes).
 *
 * ## Why it bites if the accept→reset wiring breaks (agent-principles #7)
 *
 * The in-place reset is wired in `main.ts` (`session.onHandshakeChange` → `maybeRematchReset` →
 * `session.resetForRematch()`), keyed on an `accepted` rematch resolution. `resetForRematch` swaps a
 * fresh empty game into the live `SyncEngine` (`resetGame`, epoch↑) over the SAME transport and
 * alternates the seat. If that route regresses — the resolution not firing the reset, or the reset not
 * swapping seats, or a stale finished-game message resurrecting the old board — the fresh-empty-board /
 * swapped-seats assertions in step (3) FAIL. Proven to bite: making `resetForRematch` a no-op makes
 * step (3) time out (the fresh empty board never appears), then restored.
 *
 * ## Two verification tiers (mirroring handshake.spec.ts)
 *
 *   1. HERMETIC (always runs): two pages in one context share a BroadcastChannel-backed mock relay —
 *      REAL cross-client message exchange without the external broker. This tier runs in CI.
 *   2. LIVE-RELAY, TWO ISOLATED CONTEXTS (self-skips without creds): two INDEPENDENT contexts over the
 *      real MQTT broker (`relay.json`). A genuine Playwright SKIP when the broker is unreachable — never
 *      a false green. The committed `relay.json` has EMPTY creds, so absent a CI-provided relay this
 *      tier SKIPs while tier 1 still proves the flow.
 */

type EndState = {
  show: boolean;
  winner: string | null;
  winReason: string | null;
  iWon: boolean;
  resultText: string;
  rematchUi: string;
  rematchPrompt: string | null;
};

type Pente = {
  getState(): { pieces: Record<string, string>; turn: string; winner: string | null } | null;
  getNet(): { phase: string; seat: string | null; code: string | null } | null;
  getEndState(): EndState | null;
  getHandshake(): { pending: { direction: string } | null; resolution: { outcome: string } | null } | null;
  place(coords: [number, number, number]): unknown;
  propose(action: string): boolean | null;
  respond(accepted: boolean): boolean | null;
  setPendingJoinCode(code: string): void;
  dispatch(id: string): boolean | null;
};

const endState = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getEndState());
const net = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getNet());
const state = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getState());

/**
 * Install a BroadcastChannel-backed mock transport BEFORE the app boots (the SAME faithful relay as
 * handshake.spec.ts): two pages sharing a channel keyed by room code exchange REAL opaque-JSON
 * messages, hermetically, and signal presence departure (`bye`) so the seat-swap re-host/re-join can
 * re-meet in the same room. Proposals/responses ride the SAME publish path as sync messages.
 */
async function installBroadcastMock(page: Page, senderId: string) {
  await page.addInitScript((sid: string) => {
    window.localStorage.clear();
    (
      window as unknown as { __penteNetTransportFactory: () => unknown }
    ).__penteNetTransportFactory = () => {
      let channel: BroadcastChannel | null = null;
      let msgCb: (msg: unknown) => void = () => {};
      let presenceCb: (peers: readonly string[]) => void = () => {};
      let lastBody: unknown = null;
      const myPid = (): string => window.localStorage.getItem('pente:playerId') ?? sid;
      const present = new Set<string>();
      return {
        connect: (roomCode: string) => {
          const pid = myPid();
          present.add(pid);
          channel = new BroadcastChannel(`pente-mock-${roomCode}`);
          channel.onmessage = (ev: MessageEvent) => {
            const data = ev.data as { from: string; pid?: string; kind: string; body?: unknown };
            if (data.from === sid) return; // faithful relay: never echo to the sender
            if (data.kind === 'msg') {
              msgCb(data.body);
            } else if (data.kind === 'hello') {
              if (data.pid !== undefined) present.add(data.pid);
              presenceCb([...present]);
              channel!.postMessage({ from: sid, pid, kind: 'hello-ack' });
              if (lastBody !== null) {
                channel!.postMessage({ from: sid, kind: 'msg', body: lastBody });
              }
            } else if (data.kind === 'hello-ack') {
              if (data.pid !== undefined) present.add(data.pid);
              presenceCb([...present]);
            } else if (data.kind === 'bye') {
              if (data.pid !== undefined) present.delete(data.pid);
              presenceCb([...present]);
            }
          };
          channel.postMessage({ from: sid, pid, kind: 'hello' });
          presenceCb([...present]);
          return Promise.resolve();
        },
        publish: (body: unknown) => {
          lastBody = JSON.parse(JSON.stringify(body));
          channel?.postMessage({ from: sid, kind: 'msg', body: lastBody });
        },
        onMessage: (cb: (msg: unknown) => void) => {
          msgCb = cb;
        },
        onPresence: (cb: (peers: readonly string[]) => void) => {
          presenceCb = cb;
        },
        disconnect: () => {
          channel?.postMessage({ from: sid, pid: myPid(), kind: 'bye' });
          channel?.close();
          channel = null;
        },
      };
    };
  }, senderId);
}

async function ready(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.getEndState === 'function' &&
      typeof p.propose === 'function' &&
      typeof p.respond === 'function' &&
      typeof p.getNet === 'function'
    );
  });
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: { getNet(): unknown } }).__pente;
    return !!p && p.getNet() !== null;
  });
}

async function waitConnected(page: Page, timeout = 15_000) {
  await page.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getNet()?.phase === 'connected',
    undefined,
    { timeout },
  );
}

/** Host on `host`, join on `joiner` at `host`'s code, then drive a REAL white five-in-a-row. */
async function hostJoinAndWin(host: Page, joiner: Page): Promise<string> {
  await host.evaluate(() => (window as unknown as { __pente: Pente }).__pente.dispatch('hostGame'));
  await waitConnected(host);
  const code = (await net(host))?.code;
  expect(code, 'host must claim a code').not.toBeNull();

  await joiner.evaluate((c: string) => {
    const pente = (window as unknown as { __pente: Pente }).__pente;
    pente.setPendingJoinCode(c);
    pente.dispatch('joinGame');
  }, code!);
  await waitConnected(joiner);
  expect((await net(host))?.seat).toBe('white');
  expect((await net(joiner))?.seat).toBe('black');

  const whiteLine: [number, number, number][] = [
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [3, 0, 0],
    [4, 0, 0],
  ];
  const blackSpacers: [number, number, number][] = [
    [0, 0, 4],
    [1, 0, 4],
    [2, 0, 4],
    [3, 0, 4],
  ];
  for (let i = 0; i < whiteLine.length; i += 1) {
    await host.evaluate((c) => (window as unknown as { __pente: Pente }).__pente.place(c), whiteLine[i]!);
    const wk = `${whiteLine[i]![0]},${whiteLine[i]![1]},${whiteLine[i]![2]}`;
    await joiner.waitForFunction(
      (k) => (window as unknown as { __pente: Pente }).__pente.getState()?.pieces[k] === 'white',
      wk,
    );
    if (i < blackSpacers.length) {
      await joiner.evaluate(
        (c) => (window as unknown as { __pente: Pente }).__pente.place(c),
        blackSpacers[i]!,
      );
      const bk = `${blackSpacers[i]![0]},${blackSpacers[i]![1]},${blackSpacers[i]![2]}`;
      await host.waitForFunction(
        (k) => (window as unknown as { __pente: Pente }).__pente.getState()?.pieces[k] === 'black',
        bk,
      );
    }
  }
  // Both clients converge on the won state (white five-in-a-row) — the win crossed the relay.
  await host.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getState()?.winner === 'white',
  );
  await joiner.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getState()?.winner === 'white',
  );
  return code!;
}

/**
 * The shared full-flow proof over the two connected clients (host = white, joiner = black, already
 * won). On the LIVE relay the incoming proposal may land in the non-retained pre-subscription window,
 * so B's `incoming` is polled with a re-propose nudge (a receiver-side dedup no-op).
 */
async function proveRematchFlow(host: Page, joiner: Page, artifact: string) {
  // (1) BOTH clients surface the view-only end-state overlay, and the board STAYS VISIBLE.
  for (const page of [host, joiner]) {
    await page.waitForFunction(
      () => (window as unknown as { __pente: Pente }).__pente.getEndState()?.show === true,
    );
    const es = await endState(page);
    expect(es?.show).toBe(true);
    expect(es?.winner).toBe('white');
    expect(es?.winReason).toBe('line');
    expect(es?.rematchUi).toBe('idle');
    // The overlay card is actually rendered (not display:none) — the win overlay is on screen.
    await expect(page.locator('[data-testid="endstate-overlay"]')).toBeVisible();
    await expect(page.locator('[data-testid="endstate-result"]')).toBeVisible();
    // Board STILL VISIBLE: the won pieces are still in the authoritative state (no reset/hide).
    const st = await state(page);
    expect(st?.pieces['0,0,0']).toBe('white');
    expect(st?.pieces['4,0,0']).toBe('white');
    // NON-BLOCKING: the full-viewport overlay ROOT is click-THROUGH (pointer-events:none) so the
    // board behind stays interactive (orbit/scrub); ONLY the card re-enables pointer-events. Proven
    // on the real computed style, not inferred — this is the "board stays visible AND interactive,
    // no blocking backdrop" requirement.
    const pe = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="endstate-overlay"]');
      const card = document.querySelector('.pente-endstate-card');
      return {
        root: root ? getComputedStyle(root).pointerEvents : null,
        card: card ? getComputedStyle(card).pointerEvents : null,
      };
    });
    expect(pe.root).toBe('none');
    expect(pe.card).toBe('auto');
  }
  // The host says "You won", the joiner names the winning colour (not "You") — the seat-relative copy.
  expect((await endState(host))?.iWon).toBe(true);
  expect((await endState(host))?.resultText).toBe('You won with five in a row.');
  expect((await endState(joiner))?.iWon).toBe(false);
  expect((await endState(joiner))?.resultText).toBe('White won with five in a row.');

  const shot = resolve(artifact);
  mkdirSync(dirname(shot), { recursive: true });
  await host.screenshot({ path: shot });

  // (2) The host clicks Rematch (the overlay's button → session.propose('rematch')).
  await host.locator('[data-testid="endstate-rematch"]').click();
  await host.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getEndState()?.rematchUi === 'proposed-waiting',
  );

  // The joiner sees the INCOMING rematch ask cross the relay (its overlay shows Accept/Decline).
  const seenIncoming = await waitObserved(
    joiner,
    () => (window as unknown as { __pente: Pente }).__pente.getEndState()?.rematchUi === 'incoming',
    async () => {
      await host.evaluate(() => (window as unknown as { __pente: Pente }).__pente.propose('rematch'));
    },
  );
  expect(seenIncoming, "joiner must receive the host's rematch ask over the relay").toBe(true);
  await expect(joiner.locator('[data-testid="endstate-accept"]')).toBeVisible();

  // The joiner is the RESPONDER: its overlay's PRIMARY headline must now tell it WHAT it's answering —
  // the opponent-color rematch prompt ("<Color> wants a rematch"), NOT the stale result sentence. The
  // joiner was black, so the opponent (proposer) is white → "White wants a rematch". This is the exact
  // bug fix (issue #12): before, the incoming responder saw the old "won" line with no idea of the ask.
  const joinerEs = await endState(joiner);
  expect(joinerEs?.rematchPrompt).toBe('White wants a rematch');
  await expect(joiner.locator('[data-testid="endstate-result"]')).toHaveText(
    'White wants a rematch',
  );
  // Proof the headline actually CHANGED: it no longer shows the "won" result sentence it did before.
  expect(joinerEs?.resultText).toBe('White won with five in a row.');
  await expect(joiner.locator('[data-testid="endstate-result"]')).not.toHaveText(
    joinerEs!.resultText,
  );

  // Install a CONNECTION WATCHER on both pages BEFORE the accept fires the reset: it polls
  // `getNet().phase` frequently and records whether it EVER leaves `connected`. The in-place reset
  // must NOT disconnect — if `phase` ever became `offline`/`connecting` (the old disconnect→re-host
  // shortcut), the peer would see a present→absent presence flicker. This is the behavioral proof that
  // the reset is seamless, not a teardown/reconnect.
  for (const page of [host, joiner]) {
    await page.evaluate(() => {
      const w = window as unknown as { __pente: Pente; __phaseDropped?: boolean };
      w.__phaseDropped = false;
      const timer = window.setInterval(() => {
        const phase = w.__pente.getNet()?.phase;
        if (phase !== undefined && phase !== 'connected') w.__phaseDropped = true;
      }, 10);
      // Stop sampling after the reset window so the flag reflects only the reset transition.
      window.setTimeout(() => window.clearInterval(timer), 8_000);
    });
  }

  // The joiner ACCEPTS via the overlay button (→ session.respond(true)).
  await joiner.locator('[data-testid="endstate-accept"]').click();

  // (3) MUTUAL accept → BOTH clients reset to a FRESH EMPTY game, STILL connected, seats SWAPPED.
  for (const page of [host, joiner]) {
    await page.waitForFunction(
      () => {
        const p = (window as unknown as { __pente: Pente }).__pente;
        const s = p.getState();
        return (
          p.getNet()?.phase === 'connected' &&
          s !== null &&
          s.winner === null &&
          Object.keys(s.pieces).length === 0
        );
      },
      undefined,
      { timeout: 20_000 },
    );
    const fresh = await state(page);
    expect(fresh?.winner).toBeNull();
    expect(fresh?.pieces).toEqual({});
    // The end-state overlay is hidden again on the fresh, in-progress game.
    expect((await endState(page))?.show).toBe(false);
  }
  // SEATS SWAPPED: the ex-white host is now black, the ex-black joiner is now white (colors alternated).
  expect((await net(host))?.seat, 'host (was white) must now be black — colors alternate').toBe('black');
  expect((await net(joiner))?.seat, 'joiner (was black) must now be white — colors alternate').toBe('white');

  // SEAMLESS: neither client's connection EVER dropped during the reset — `phase` stayed `connected`
  // the whole time (no offline/connecting blip). This is the design's "same room/connection, no
  // disconnect/re-host" made observable: the old disconnect→re-host shortcut would trip this flag.
  for (const page of [host, joiner]) {
    const dropped = await page.evaluate(
      () => (window as unknown as { __phaseDropped?: boolean }).__phaseDropped === true,
    );
    expect(dropped, 'in-place rematch reset must NOT disconnect (phase stayed connected)').toBe(false);
  }
}

async function waitObserved(
  page: Page,
  predicate: () => boolean,
  nudge: () => Promise<void>,
  timeoutMs = 12_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await page.evaluate(predicate)) return true;
    if (Date.now() >= deadline) return false;
    await nudge();
    await page.waitForTimeout(250);
  }
}

// ── Tier 1: HERMETIC (two pages, one context, BroadcastChannel) — always runs ────────────────────

test.describe('rematch flow over a hermetic mock relay (N.2.2 overlay + seat-swap, always runs)', () => {
  test('win → BOTH show the view-only overlay (board visible) → Rematch → Accept → fresh game, seats swapped', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const host = await context.newPage();
    const joiner = await context.newPage();
    await installBroadcastMock(host, 'rm-host');
    await installBroadcastMock(joiner, 'rm-joiner');
    await ready(host);
    await ready(joiner);
    try {
      await hostJoinAndWin(host, joiner);
      await proveRematchFlow(host, joiner, 'e2e/artifacts/rematch-hermetic.png');
    } finally {
      await context.close();
    }
  });
});

// ── Tier 2: LIVE RELAY, two ISOLATED contexts — self-skips without broker creds ──────────────────

const RELAY = relay as { wssUrl: string; username: string; password: string; topicRoot: string };
const CONNECT_PROBE_MS = 10_000;
let relayReachable = false;

function probeRelay(): Promise<boolean> {
  return new Promise<boolean>((res) => {
    if (RELAY.wssUrl.length === 0) {
      res(false);
      return;
    }
    const client = mqtt.connect(RELAY.wssUrl, {
      username: RELAY.username,
      password: RELAY.password,
      clientId: `rm-probe-${Math.random().toString(36).slice(2, 10)}`,
      connectTimeout: CONNECT_PROBE_MS,
      reconnectPeriod: 0,
    });
    const done = (ok: boolean): void => {
      client.end(true);
      res(ok);
    };
    client.on('connect', () => done(true));
    client.on('error', () => done(false));
    setTimeout(() => done(false), CONNECT_PROBE_MS);
  });
}

async function bootIsolated(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => window.localStorage.clear());
  await ready(page);
  return { context, page };
}

test.describe('rematch flow over the LIVE relay, two isolated contexts (integration; self-skips w/o creds)', () => {
  test.beforeAll(async () => {
    relayReachable = await probeRelay();
    if (!relayReachable) {
      console.warn(
        `[rematchFlow.spec] SKIPPING live tier: relay ${RELAY.wssUrl || '(empty relay.json — no creds)'} ` +
          `unreachable — the hermetic tier still proves the N.2.2 overlay + seat-swap flow.`,
      );
    }
  });

  test('win → overlay → Rematch → Accept → fresh game with swapped seats, two isolated contexts', async ({
    browser,
  }) => {
    test.skip(!relayReachable, 'live relay unreachable (no creds / offline)');
    const a = await bootIsolated(browser);
    const b = await bootIsolated(browser);
    try {
      await hostJoinAndWin(a.page, b.page);
      await proveRematchFlow(a.page, b.page, 'e2e/artifacts/rematch-liverelay.png');
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });
});
