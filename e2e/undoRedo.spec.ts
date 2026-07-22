import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import mqtt from 'mqtt';
import relay from '../src/config/defaults/relay.json' with { type: 'json' };

/**
 * N.3.2 e2e — NETWORKED MUTUAL-CONFIRM UNDO/REDO wired through the shared N.1 handshake (issue #18).
 *
 * This proves the GLUE the unit tests cannot: the banner Undo/Redo buttons in a NETWORKED game PROPOSE
 * (they no longer apply directly), the opponent sees an Accept/Decline PROMPT surfaced IN THE BANNER
 * (not the end-state overlay — the game is not over), and on MUTUAL accept BOTH clients roll the
 * undo/redo (the SyncEngine applies + publishes on accept, held out-of-band until then). Every
 * assertion is proof-by-BEHAVIOR on real state (agent-principles #3) — the OTHER client's rendered
 * pieces + the SHARED `getHeadHash`, and the banner prompt view-model read off `getUndoRedoPrompt`,
 * never a log line:
 *
 *   A plays a move → A clicks Undo (dispatches the `undo` command → PROPOSES) → B's banner shows
 *   "<color> wants to undo" Accept/Decline → B Accepts → BOTH roll back one (the piece vanishes on
 *   BOTH and their `headHash`es MATCH). A DECLINE leaves both boards unchanged. Redo works the same.
 *   And LOCAL single-player undo/redo still applies DIRECTLY (unchanged).
 *
 * ## Why it bites if the accept→apply wiring breaks (agent-principles #7)
 *
 * The undo/redo is held OUT-OF-BAND on the handshake and applied ONLY when the resolution is
 * `accepted` (`session.applyAcceptedUndoRedo`, fired from `onHandshakeChange` in `main.ts`). If that
 * accept→apply wiring regresses, B accepts but NEITHER board rolls back — the both-rollback assertion
 * (piece gone + heads match at the decremented state) fails, not merely a log. The DECLINE test proves
 * the mirror: a declined ask must leave BOTH boards untouched (nothing applied off a non-accept).
 *
 * ## Two verification tiers (mirroring handshake.spec.ts)
 *
 *   1. HERMETIC (always runs): two pages in one context share a BroadcastChannel-backed mock transport
 *      (a faithful relay: opaque JSON, no self-echo) — REAL cross-client exchange without the broker.
 *      This is the tier that runs in CI.
 *   2. LIVE-RELAY, TWO ISOLATED CONTEXTS (self-skips without creds): two INDEPENDENT contexts over the
 *      REAL MQTT broker (`relay.json`), no test transport. The full-stack integration proof; a genuine
 *      Playwright SKIP when the broker is unreachable (offline / empty creds) — never a false green.
 */

type Handshake = {
  pending: { id: string; action: string; proposedBy: string; direction: string } | null;
  resolution: { id: string; action: string; direction: string; outcome: string } | null;
};

type Prompt = { show: boolean; action: string | null; promptText: string };

type Pente = {
  getNet(): { phase: string; seat: string | null; code: string | null; peerPresent: boolean } | null;
  getState(): { pieces: Record<string, string>; turn: string; winner: string | null } | null;
  getHeadHash(): string | null;
  getHandshake(): Handshake | null;
  getUndoRedoPrompt(): Prompt | null;
  propose(action: string): boolean | null;
  respond(accepted: boolean): boolean | null;
  setPendingJoinCode(code: string): void;
  dispatch(id: string): boolean | null;
  place(coords: [number, number, number]): unknown;
  getBannerContext?(): unknown;
};

const P = 'window.__pente';

const net = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getNet());
const head = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getHeadHash());
const state = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getState());
const prompt = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getUndoRedoPrompt());

/** Read a banner control button's live rendered state (present + disabled) off the DOM. */
const bannerBtn = (page: Page, command: 'undo' | 'redo') =>
  page.evaluate((cmd) => {
    const btn = document.querySelector(
      `[data-testid="banner-button-${cmd}"]`,
    ) as HTMLButtonElement | null;
    return btn === null ? null : { disabled: btn.disabled };
  }, command);

/** Read the banner's rendered undo/redo prompt DOM (visibility + copy) — proof the prompt SURFACED. */
const bannerPrompt = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-testid="banner-undoredo-prompt"]') as HTMLElement | null;
    const txt = document.querySelector(
      '[data-testid="banner-undoredo-text"]',
    ) as HTMLElement | null;
    if (el === null) return null;
    return {
      hidden: el.hidden,
      show: el.getAttribute('data-show'),
      action: el.getAttribute('data-action'),
      text: txt?.textContent ?? '',
    };
  });

/**
 * Install a BroadcastChannel-backed mock transport factory BEFORE the app boots (the SAME faithful
 * relay as handshake.spec.ts): proposals/responses ride the same publish path as sync messages, so
 * this relay carries the whole undo/redo handshake unchanged, hermetically.
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
      typeof p.getNet === 'function' &&
      typeof p.getUndoRedoPrompt === 'function' &&
      typeof p.propose === 'function' &&
      typeof p.respond === 'function' &&
      !!document.querySelector('[data-testid="banner-undoredo-prompt"]')
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
 * Poll `predicate` on the target page until true (or a deadline), invoking `nudge` between polls to
 * defeat the live relay's non-retained pre-subscription gap (a re-published proposal/response is a
 * receiver-side dedup / no-double-resolve no-op, so the proof stays genuine). The hermetic tier
 * satisfies the predicate on the first poll, so `nudge` never fires there.
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

/**
 * Drive A→B to a connected white/black pair with ONE white move on the board (A hosts white and moves
 * first), so an undo of the last (white) move is a valid proposal for A. Returns the shared node key.
 */
async function connectedWithMove(a: Page, b: Page): Promise<string> {
  await a.evaluate(() => (window as unknown as { __pente: Pente }).__pente.dispatch('hostGame'));
  await waitConnected(a);
  const code = (await net(a))?.code;
  expect(code, 'host must claim a code').not.toBeNull();
  await b.evaluate((c: string) => {
    const pente = (window as unknown as { __pente: Pente }).__pente;
    pente.setPendingJoinCode(c);
    pente.dispatch('joinGame');
  }, code!);
  await waitConnected(b);
  expect((await net(a))?.seat).toBe('white');
  expect((await net(b))?.seat).toBe('black');

  // A (white) plays the opening move; wait until B actually receives it over the relay (proof #3).
  await a.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([2, 2, 2]));
  const seen = await waitObserved(
    b,
    () => (window as unknown as { __pente: Pente }).__pente.getState()?.pieces['2,2,2'] === 'white',
    async () => {},
  );
  expect(seen, "B must receive A's move over the relay before the undo handshake").toBe(true);
  expect((await head(a))).toBe(await head(b)); // converged before the undo
  return '2,2,2';
}

// ── Tier 1: HERMETIC (two pages, one context, BroadcastChannel) — always runs ────────────────────

test.describe('networked undo/redo mutual-confirm over a hermetic mock relay (N.3.2, always runs)', () => {
  async function hostAndJoin(browser: Browser): Promise<{ ctx: BrowserContext; a: Page; b: Page }> {
    const ctx = await browser.newContext();
    const a = await ctx.newPage();
    const b = await ctx.newPage();
    await installBroadcastMock(a, 'ur-host');
    await installBroadcastMock(b, 'ur-joiner');
    await ready(a);
    await ready(b);
    return { ctx, a, b };
  }

  test('A clicks Undo → B sees "White wants to undo" → B accepts → BOTH roll back one (heads match)', async ({
    browser,
  }) => {
    const { ctx, a, b } = await hostAndJoin(browser);
    try {
      const node = await connectedWithMove(a, b);
      const headWithMove = await head(a);

      // A's networked Undo button is ENABLED (a's last move exists + no pending): the previously-grayed
      // networked button LIT UP because a propose is valid (maintainer report — verified here).
      expect(await bannerBtn(a, 'undo'), 'A undo button must be present').not.toBeNull();
      expect((await bannerBtn(a, 'undo'))!.disabled, "A's networked Undo must be enabled").toBe(false);

      // A clicks Undo — in a NETWORKED game this PROPOSES (does NOT apply): the board is UNCHANGED and
      // an out-of-band 'undo' proposal is now outgoing on A.
      await a.evaluate(() => (window as unknown as { __pente: Pente }).__pente.dispatch('undo'));
      await a.waitForFunction(() => {
        const h = (window as unknown as { __pente: Pente }).__pente.getHandshake();
        return h?.pending?.direction === 'outgoing' && h.pending.action === 'undo';
      });
      // A's board is UNTOUCHED — the undo was held out-of-band, not applied on the proposer.
      expect((await state(a))?.pieces[node]).toBe('white');
      expect(await head(a)).toBe(headWithMove);

      // PROOF-BY-BEHAVIOR (#3): the proposal crossed the relay — B's banner PROMPT surfaces
      // "White wants to undo" (B is black; the opponent is white). Retry-propose defeats the live gap.
      const seenPrompt = await waitObserved(
        b,
        () => {
          const pr = (window as unknown as { __pente: Pente }).__pente.getUndoRedoPrompt();
          return pr?.show === true && pr.action === 'undo';
        },
        async () => {
          await a.evaluate(() => (window as unknown as { __pente: Pente }).__pente.propose('undo'));
        },
      );
      expect(seenPrompt, "B must see A's undo proposal as a banner prompt").toBe(true);
      expect((await prompt(b))!.promptText).toBe('White wants to undo');
      // The prompt is surfaced IN THE BANNER DOM (not the end-state overlay) via textContent.
      const dom = await bannerPrompt(b);
      expect(dom).not.toBeNull();
      expect(dom!.hidden).toBe(false);
      expect(dom!.show).toBe('true');
      expect(dom!.action).toBe('undo');
      expect(dom!.text).toBe('White wants to undo');

      // B accepts → MUTUAL accept: BOTH clients roll back the undo. On B the piece must vanish.
      await b.evaluate(() => (window as unknown as { __pente: Pente }).__pente.respond(true));
      const bRolled = await waitObserved(
        b,
        () =>
          (window as unknown as { __pente: Pente }).__pente.getState()?.pieces['2,2,2'] === undefined,
        async () => {
          await b.evaluate(() => (window as unknown as { __pente: Pente }).__pente.respond(true));
        },
      );
      expect(bRolled, "B must roll back the undo on mutual accept").toBe(true);

      // PROOF-BY-BEHAVIOR (#3): A ALSO rolled back — its board dropped the piece too, and BOTH heads
      // MATCH at the decremented (empty-board) state. If the accept→apply wiring broke, A never rolls
      // back and this fails (the gate bites — agent-principles #7).
      await a.waitForFunction(
        `${P}.getState()?.pieces['2,2,2'] === undefined`,
        undefined,
        { timeout: 12_000 },
      );
      expect((await state(a))?.pieces[node]).toBeUndefined();
      expect((await state(b))?.pieces[node]).toBeUndefined();
      const headA1 = await head(a);
      expect(headA1).toBe(await head(b)); // heads MATCH on both after the mutual rollback
      expect(headA1).not.toBe(headWithMove); // and the head genuinely CHANGED (a real rollback)

      const shot = resolve('e2e/artifacts/undoRedo-accept-hermetic.png');
      mkdirSync(dirname(shot), { recursive: true });
      await b.screenshot({ path: shot });
    } finally {
      await ctx.close();
    }
  });

  test('B DECLINES the undo → BOTH boards stay UNCHANGED (nothing applied off a non-accept)', async ({
    browser,
  }) => {
    const { ctx, a, b } = await hostAndJoin(browser);
    try {
      const node = await connectedWithMove(a, b);
      const headWithMove = await head(a);

      await a.evaluate(() => (window as unknown as { __pente: Pente }).__pente.propose('undo'));
      const seenPrompt = await waitObserved(
        b,
        () => (window as unknown as { __pente: Pente }).__pente.getUndoRedoPrompt()?.show === true,
        async () => {
          await a.evaluate(() => (window as unknown as { __pente: Pente }).__pente.propose('undo'));
        },
      );
      expect(seenPrompt).toBe(true);

      // B DECLINES. A's outgoing ask resolves `declined`; NEITHER board rolls back.
      await b.evaluate(() => (window as unknown as { __pente: Pente }).__pente.respond(false));
      const seenDeclined = await waitObserved(
        a,
        () => {
          const h = (window as unknown as { __pente: Pente }).__pente.getHandshake();
          return h?.resolution?.outcome === 'declined';
        },
        async () => {
          await b.evaluate(() => (window as unknown as { __pente: Pente }).__pente.respond(false));
        },
      );
      expect(seenDeclined, "A must observe B's decline").toBe(true);

      // BOTH boards untouched — the move is still there on both and the heads are unchanged.
      expect((await state(a))?.pieces[node]).toBe('white');
      expect((await state(b))?.pieces[node]).toBe('white');
      expect(await head(a)).toBe(headWithMove);
      expect(await head(b)).toBe(headWithMove);
      // B's prompt cleared after responding (no double-accept).
      expect((await prompt(b))!.show).toBe(false);
    } finally {
      await ctx.close();
    }
  });

  test('REDO works the same: A undoes+redoes (both mutual-confirm); B accepts each; the piece returns', async ({
    browser,
  }) => {
    const { ctx, a, b } = await hostAndJoin(browser);
    try {
      const node = await connectedWithMove(a, b);

      // First, mutual-confirm UNDO to create a redo tail on both sides.
      await a.evaluate(() => (window as unknown as { __pente: Pente }).__pente.propose('undo'));
      await waitObserved(
        b,
        () => (window as unknown as { __pente: Pente }).__pente.getUndoRedoPrompt()?.action === 'undo',
        async () => {
          await a.evaluate(() => (window as unknown as { __pente: Pente }).__pente.propose('undo'));
        },
      );
      await b.evaluate(() => (window as unknown as { __pente: Pente }).__pente.respond(true));
      const undone = await waitObserved(
        a,
        () =>
          (window as unknown as { __pente: Pente }).__pente.getState()?.pieces['2,2,2'] === undefined,
        async () => {
          await b.evaluate(() => (window as unknown as { __pente: Pente }).__pente.respond(true));
        },
      );
      expect(undone, 'the mutual undo must land on A before proposing a redo').toBe(true);
      const headUndone = await head(a);

      // Now A's Redo button lights up (a redo tail exists + the re-applied move is A's white move).
      expect((await bannerBtn(a, 'redo'))!.disabled, "A's networked Redo must be enabled").toBe(false);

      // A clicks Redo — PROPOSES a redo (does not apply). B sees "White wants to redo".
      await a.evaluate(() => (window as unknown as { __pente: Pente }).__pente.dispatch('redo'));
      const seenRedoPrompt = await waitObserved(
        b,
        () => {
          const pr = (window as unknown as { __pente: Pente }).__pente.getUndoRedoPrompt();
          return pr?.show === true && pr.action === 'redo';
        },
        async () => {
          await a.evaluate(() => (window as unknown as { __pente: Pente }).__pente.propose('redo'));
        },
      );
      expect(seenRedoPrompt, "B must see A's redo proposal").toBe(true);
      expect((await prompt(b))!.promptText).toBe('White wants to redo');

      // B accepts the redo → BOTH re-apply the move: the piece RETURNS on both, heads match, and the
      // head is back to the pre-undo state (a genuine forward step, distinct from the undone head).
      await b.evaluate(() => (window as unknown as { __pente: Pente }).__pente.respond(true));
      const redone = await waitObserved(
        a,
        () =>
          (window as unknown as { __pente: Pente }).__pente.getState()?.pieces['2,2,2'] === 'white',
        async () => {
          await b.evaluate(() => (window as unknown as { __pente: Pente }).__pente.respond(true));
        },
      );
      expect(redone, 'A must re-apply the redo on mutual accept').toBe(true);
      await b.waitForFunction(`${P}.getState()?.pieces['2,2,2'] === 'white'`);
      expect((await state(a))?.pieces[node]).toBe('white');
      expect((await state(b))?.pieces[node]).toBe('white');
      expect(await head(a)).toBe(await head(b)); // heads MATCH on both after the mutual redo
      expect(await head(a)).not.toBe(headUndone); // and it stepped FORWARD from the undone state
    } finally {
      await ctx.close();
    }
  });
});

// ── LOCAL single-player undo/redo still applies DIRECTLY (unchanged) — no networking ─────────────

test.describe('local single-player undo/redo still applies directly (N.3.2 regression guard)', () => {
  test('offline: Undo/Redo mutate the local board immediately (no handshake, no prompt)', async ({
    page,
  }) => {
    await ready(page);
    // Two local placements (offline — no net game): white then black.
    await page.evaluate(() => {
      const p = (window as unknown as { __pente: Pente }).__pente;
      p.place([0, 0, 0]);
      p.place([4, 4, 4]);
    });
    expect((await state(page))?.pieces['4,4,4']).toBe('black');
    const headWithBlack = await head(page);

    // LOCAL Undo applies DIRECTLY (no proposal, no prompt) — the last piece vanishes at once.
    await page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.dispatch('undo'));
    await page.waitForFunction(`${P}.getState()?.pieces['4,4,4'] === undefined`);
    expect((await state(page))?.pieces['4,4,4']).toBeUndefined();
    // The head genuinely moved (a real applied undo), and no handshake / prompt was ever raised (offline
    // undo is a DIRECT local action, never a proposal — the networked mutual-confirm path is bypassed).
    const headUndone = await head(page);
    expect(headUndone).not.toBe(headWithBlack);
    expect((await page.evaluate(() =>
      (window as unknown as { __pente: Pente }).__pente.getHandshake(),
    ))!.pending).toBeNull();
    expect((await prompt(page))!.show).toBe(false);

    // LOCAL Redo re-applies it DIRECTLY — the piece returns to the board (undo/redo are appended EVENTS
    // in the log, so the head advances rather than reverting to the pre-undo hash; the rendered board is
    // the behavior that matters). Still no handshake / prompt (a direct local action).
    await page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.dispatch('redo'));
    await page.waitForFunction(`${P}.getState()?.pieces['4,4,4'] === 'black'`);
    expect((await state(page))?.pieces['4,4,4']).toBe('black');
    expect(await head(page)).not.toBe(headUndone); // a real applied redo advanced the head
    expect((await prompt(page))!.show).toBe(false);
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
      clientId: `ur-probe-${Math.random().toString(36).slice(2, 10)}`,
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

test.describe('networked undo over the LIVE relay, two isolated contexts (integration; self-skips w/o creds)', () => {
  test.beforeAll(async () => {
    relayReachable = await probeRelay();
    if (!relayReachable) {
      console.warn(
        `[undoRedo.spec] SKIPPING live tier: relay ${RELAY.wssUrl || '(empty relay.json — no creds)'} ` +
          `unreachable — the hermetic tier still proves the N.3.2 accept→apply wiring.`,
      );
    }
  });

  test('A proposes undo → B accepts → BOTH roll back one across two isolated contexts on the real broker', async ({
    browser,
  }) => {
    test.skip(!relayReachable, 'live relay unreachable (no creds / offline)');
    const a = await bootIsolated(browser);
    const b = await bootIsolated(browser);
    try {
      const node = await connectedWithMove(a.page, b.page);
      const headWithMove = await head(a.page);

      await a.page.evaluate(() =>
        (window as unknown as { __pente: Pente }).__pente.propose('undo'),
      );
      const seenPrompt = await waitObserved(
        b.page,
        () => (window as unknown as { __pente: Pente }).__pente.getUndoRedoPrompt()?.show === true,
        async () => {
          await a.page.evaluate(() =>
            (window as unknown as { __pente: Pente }).__pente.propose('undo'),
          );
        },
      );
      expect(seenPrompt, "B must see A's undo proposal over the live relay").toBe(true);
      expect((await prompt(b.page))!.promptText).toBe('White wants to undo');

      await b.page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.respond(true));
      const rolled = await waitObserved(
        a.page,
        () =>
          (window as unknown as { __pente: Pente }).__pente.getState()?.pieces['2,2,2'] ===
          undefined,
        async () => {
          await b.page.evaluate(() =>
            (window as unknown as { __pente: Pente }).__pente.respond(true),
          );
        },
      );
      expect(rolled, 'BOTH must roll back on mutual accept over the live relay').toBe(true);
      expect((await state(a.page))?.pieces[node]).toBeUndefined();
      expect((await state(b.page))?.pieces[node]).toBeUndefined();
      expect(await head(a.page)).toBe(await head(b.page));
      expect(await head(a.page)).not.toBe(headWithMove);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });
});
