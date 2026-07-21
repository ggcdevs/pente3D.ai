import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import mqtt from 'mqtt';
import relay from '../src/config/defaults/relay.json' with { type: 'json' };

/**
 * N.1.3 e2e — the OUT-OF-BAND ask/accept HANDSHAKE wired into the live net path (issues #12/#18).
 *
 * This proves the GLUE the unit tests cannot: `window.__pente.propose` / `respond` / `getHandshake`
 * driving TWO app instances that exchange a proposal + response over a real cross-client relay — and
 * that the routing (`parseGameMessage` → `engine.onMessage` → the session's handshake state machine →
 * `getHandshake`) actually carries the round-trip. Every assertion is proof-by-BEHAVIOR on the OTHER
 * client's real handshake STATE (agent-principles #3), never a log line: A proposes → B's session
 * shows an INCOMING pending proposal (it crossed the relay) → B accepts → A's session shows an
 * `accepted` RESOLUTION of its outgoing proposal.
 *
 * ## Why it bites if the wiring breaks (agent-principles #7)
 *
 * The proposal/response never touch the append-only move-log; they ride the out-of-band handshake
 * seam wired in `session.ts` (`engine.onMessage` → `receiveProposal`/`receiveResponse`) and surfaced
 * via `session.getHandshake()`. If that route regresses — the pump not delivering `'proposal'`/
 * `'response'` to `onMessage`, the session not feeding them to the state machine, or `propose`/
 * `respond` not publishing — B never sees the incoming ask and/or A never sees the resolution, so
 * the observability assertions below fail (not just a log). Each test also asserts the out-of-band
 * ask left the move-log `headHash` UNCHANGED, so the "a proposal never enters the log" guardrail is
 * genuinely enforced, not assumed.
 *
 * ## Two verification tiers (mirroring netWiring.spec.ts + networked.spec.ts)
 *
 *   1. HERMETIC (always runs): two pages in one context share a BroadcastChannel-backed mock
 *      transport (a faithful relay: opaque JSON, no self-echo) — REAL cross-client message exchange
 *      without the external broker, so the UI e2e is hermetic. This is the tier that runs in CI.
 *   2. LIVE-RELAY, TWO ISOLATED CONTEXTS (self-skips without creds): two INDEPENDENT contexts
 *      (distinct localStorage → distinct playerId → distinct seats) over the REAL MQTT broker
 *      (`relay.json`), NO test transport injected. This is the full-stack integration proof; it is a
 *      genuine Playwright SKIP when the broker is unreachable (offline / no creds) — never a false
 *      green (agent-principles #2/#3). The default committed `relay.json` has EMPTY creds, so absent
 *      a CI-provided relay this tier SKIPs while tier 1 still proves the routing.
 */

type Handshake = {
  pending: { id: string; action: string; proposedBy: string; direction: string } | null;
  resolution: { id: string; action: string; direction: string; outcome: string } | null;
};

type Pente = {
  getNet(): { phase: string; seat: string | null; code: string | null } | null;
  getHeadHash(): string | null;
  getHandshake(): Handshake | null;
  propose(action: string): boolean | null;
  respond(accepted: boolean): boolean | null;
  setPendingJoinCode(code: string): void;
  dispatch(id: string): boolean | null;
  resync(): void;
};

const hs = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getHandshake());
const net = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getNet());
const head = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getHeadHash());

/**
 * Install a BroadcastChannel-backed mock transport factory BEFORE the app boots (the SAME relay as
 * netWiring.spec.ts): two pages sharing a channel keyed by room code exchange REAL opaque-JSON
 * messages, hermetically. It never echoes to its own sender (faithful relay) and re-announces
 * presence so both sides mark each other present. Proposals/responses ride the SAME publish path as
 * sync messages, so this relay carries them unchanged.
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
      typeof p.getNet === 'function' &&
      typeof p.getHandshake === 'function' &&
      typeof p.propose === 'function' &&
      typeof p.respond === 'function'
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

/**
 * The shared round-trip assertions, parameterised over the two clients (A hosts white, B joins black,
 * already connected on both tiers). `resyncOnPoll` re-broadcasts nothing for the handshake (proposals
 * are one-shot, no re-publish loop in the app), but on the LIVE relay a proposal published in the
 * pre-subscription window can be dropped — so the caller passes a poll that nudges the proposer to
 * re-`propose` is NOT valid (a second propose supersedes). Instead the live tier simply retries the
 * initial propose until B observes it, which is safe (dedup on the receiver + supersede is idempotent
 * when nothing changed). Hermetic tier delivers synchronously, so its retry never fires.
 */
async function proveAcceptRoundTrip(a: Page, b: Page, artifact: string) {
  // Idle before any ask: neither side has a pending proposal or a resolution.
  expect(await hs(a)).toEqual({ pending: null, resolution: null });
  expect(await hs(b)).toEqual({ pending: null, resolution: null });

  const headA0 = await head(a);

  // A raises an OUT-OF-BAND proposal (opaque action — the N.1.3 primitive is action-agnostic).
  expect(
    await a.evaluate(() => (window as unknown as { __pente: Pente }).__pente.propose('test')),
    'propose must succeed while connected',
  ).toBe(true);

  // A's own side shows an OUTGOING pending proposal for the action it raised.
  await a.waitForFunction(() => {
    const h = (window as unknown as { __pente: Pente }).__pente.getHandshake();
    return h?.pending?.direction === 'outgoing' && h.pending.action === 'test';
  });
  const outA = (await hs(a))!.pending!;
  expect(outA.proposedBy).toBe('white');

  // PROOF-BY-BEHAVIOR (#3): the proposal actually crossed the relay — B's session now shows an
  // INCOMING pending proposal. If the routing (pump → onMessage → receiveProposal) were broken this
  // never appears. On the LIVE relay, retry the propose until observed (defeats the non-retained
  // pre-subscription gap); a re-propose that changes nothing is a receiver-side dedup no-op.
  const seenIncoming = await waitObserved(
    b,
    () => {
      const h = (window as unknown as { __pente: Pente }).__pente.getHandshake();
      return h?.pending?.direction === 'incoming';
    },
    async () => {
      await a.evaluate(() => (window as unknown as { __pente: Pente }).__pente.propose('test'));
    },
  );
  expect(seenIncoming, "B must receive A's proposal over the relay").toBe(true);
  const inB = (await hs(b))!.pending!;
  expect(inB.action).toBe('test');
  expect(inB.proposedBy).toBe('white');
  expect(inB.direction).toBe('incoming');

  // The out-of-band ask NEVER entered the append-only move-log: A's authoritative head is unchanged.
  expect(await head(a)).toBe(headA0);

  // B accepts. Its own pending resolves to an `accepted` INCOMING resolution and clears the slot.
  expect(
    await b.evaluate(() => (window as unknown as { __pente: Pente }).__pente.respond(true)),
    'respond must succeed with an incoming proposal',
  ).toBe(true);
  await b.waitForFunction(() => {
    const h = (window as unknown as { __pente: Pente }).__pente.getHandshake();
    return h?.pending === null && h.resolution?.outcome === 'accepted';
  });

  // PROOF-BY-BEHAVIOR (#3): the response crossed back — A's OUTGOING proposal resolves to `accepted`.
  const seenResolved = await waitObserved(
    a,
    () => {
      const h = (window as unknown as { __pente: Pente }).__pente.getHandshake();
      return h?.pending === null && h.resolution?.outcome === 'accepted';
    },
    async () => {
      await b.evaluate(() => (window as unknown as { __pente: Pente }).__pente.respond(true));
    },
  );
  expect(seenResolved, "A must observe B's acceptance over the relay").toBe(true);
  const resA = (await hs(a))!.resolution!;
  expect(resA.direction).toBe('outgoing');
  expect(resA.action).toBe('test');

  const shot = resolve(artifact);
  mkdirSync(dirname(shot), { recursive: true });
  await b.screenshot({ path: shot });
}

/**
 * Poll `predicate` on the target page until true (or a deadline), invoking `nudge` between polls to
 * defeat the live relay's non-retained pre-subscription gap (a re-`propose`/`respond` that changes
 * nothing is a dedup / no-double-resolve no-op, so the proof stays genuine — the peer must still
 * actually receive it). The hermetic tier satisfies the predicate on the first poll, so `nudge`
 * never fires there.
 */
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

test.describe('handshake over a hermetic mock relay (N.1.3 routing, always runs)', () => {
  async function hostAndJoin(browser: Browser): Promise<{ ctx: BrowserContext; a: Page; b: Page }> {
    const ctx = await browser.newContext();
    const a = await ctx.newPage();
    const b = await ctx.newPage();
    await installBroadcastMock(a, 'hs-host');
    await installBroadcastMock(b, 'hs-joiner');

    await ready(a);
    await a.evaluate(() => (window as unknown as { __pente: Pente }).__pente.dispatch('hostGame'));
    await waitConnected(a);
    const code = (await net(a))?.code;
    expect(code, 'host must claim a code').not.toBeNull();

    await ready(b);
    await b.evaluate((c: string) => {
      const pente = (window as unknown as { __pente: Pente }).__pente;
      pente.setPendingJoinCode(c);
      pente.dispatch('joinGame');
    }, code!);
    await waitConnected(b);
    expect((await net(a))?.seat).toBe('white');
    expect((await net(b))?.seat).toBe('black');
    return { ctx, a, b };
  }

  test('A proposes → B sees INCOMING → B accepts → A sees ACCEPTED (round-trip, off the move-log)', async ({
    browser,
  }) => {
    const { ctx, a, b } = await hostAndJoin(browser);
    try {
      await proveAcceptRoundTrip(a, b, 'e2e/artifacts/handshake-hermetic.png');
    } finally {
      await ctx.close();
    }
  });

  test('B declines → A sees a DECLINED resolution; the ask left NO trace on the move-log', async ({
    browser,
  }) => {
    const { ctx, a, b } = await hostAndJoin(browser);
    try {
      const headB0 = await head(b);
      await a.evaluate(() => (window as unknown as { __pente: Pente }).__pente.propose('test'));
      await b.waitForFunction(() => {
        const h = (window as unknown as { __pente: Pente }).__pente.getHandshake();
        return h?.pending?.direction === 'incoming';
      });
      // B DECLINES. A must observe an outgoing `declined` resolution (the flag is not coerced).
      expect(
        await b.evaluate(() => (window as unknown as { __pente: Pente }).__pente.respond(false)),
      ).toBe(true);
      await a.waitForFunction(() => {
        const h = (window as unknown as { __pente: Pente }).__pente.getHandshake();
        return h?.pending === null && h.resolution?.outcome === 'declined';
      });
      expect((await hs(a))!.resolution!.direction).toBe('outgoing');
      // The whole exchange was OUT-OF-BAND: B's move-log head never moved (a declined ask leaves no
      // trace — the append-only-log guardrail, proven as observable state not an assumption).
      expect(await head(b)).toBe(headB0);
    } finally {
      await ctx.close();
    }
  });
});

// ── Tier 2: LIVE RELAY, two ISOLATED contexts — self-skips without broker creds ──────────────────

const RELAY = relay as { wssUrl: string; username: string; password: string; topicRoot: string };
const CONNECT_PROBE_MS = 10_000;
let relayReachable = false;

/** Probe the live relay once; resolves true iff an outbound wss connection is accepted. */
function probeRelay(): Promise<boolean> {
  return new Promise<boolean>((res) => {
    if (RELAY.wssUrl.length === 0) {
      res(false); // no creds committed (default relay.json is empty) → genuine skip
      return;
    }
    const client = mqtt.connect(RELAY.wssUrl, {
      username: RELAY.username,
      password: RELAY.password,
      clientId: `hs-probe-${Math.random().toString(36).slice(2, 10)}`,
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

/** Boot a FRESH, ISOLATED context+page against the real app — no test transport (real MqttTransport). */
async function bootIsolated(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => window.localStorage.clear());
  await ready(page);
  return { context, page };
}

test.describe('handshake over the LIVE relay, two isolated contexts (integration; self-skips w/o creds)', () => {
  test.beforeAll(async () => {
    relayReachable = await probeRelay();
    if (!relayReachable) {
      console.warn(
        `[handshake.spec] SKIPPING live tier: relay ${RELAY.wssUrl || '(empty relay.json — no creds)'} ` +
          `unreachable — the hermetic tier still proves the N.1.3 routing.`,
      );
    }
  });

  test('A proposes → B accepts across two isolated contexts on the real broker', async ({
    browser,
  }) => {
    test.skip(!relayReachable, 'live relay unreachable (no creds / offline)');
    const a = await bootIsolated(browser);
    const b = await bootIsolated(browser);
    try {
      await a.page.evaluate(() =>
        (window as unknown as { __pente: Pente }).__pente.dispatch('hostGame'),
      );
      await waitConnected(a.page);
      const code = (await net(a.page))?.code;
      expect(code).not.toBeNull();

      await b.page.evaluate((c: string) => {
        const pente = (window as unknown as { __pente: Pente }).__pente;
        pente.setPendingJoinCode(c);
        pente.dispatch('joinGame');
      }, code!);
      await waitConnected(b.page);
      expect((await net(a.page))?.seat).toBe('white');
      expect((await net(b.page))?.seat).toBe('black');

      await proveAcceptRoundTrip(a.page, b.page, 'e2e/artifacts/handshake-liverelay.png');
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });
});
