import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import mqtt from 'mqtt';
import relay from '../src/config/defaults/relay.json' with { type: 'json' };

/**
 * Task 6.7 e2e — the TWO-BROWSER, LIVE-RELAY cross-component integration test (issues #4/#5).
 *
 * This is the test whose ABSENCE let issue #4 (the net-wiring gap) hide: every unit test exercises a
 * unit in isolation (`sync.ts`, `seats.ts`, `session.ts` over a `MockTransport`), and 6.1's
 * `netWiring.spec.ts` drives two pages in ONE context over a hermetic BroadcastChannel relay. Neither
 * proves the FULL stack — two INDEPENDENT app instances, in ISOLATED browser contexts (distinct
 * localStorage → distinct `playerId` → distinct seats), talking over the *real* MQTT broker
 * (`relay.json`) with NO test transport injected. That is exactly the seam the wiring bug lived in, so
 * this spec is the one that bites if the 6.1 render-adoption / session-route wiring regresses.
 *
 * Every assertion is proof-by-BEHAVIOR, never a log line (agent-principles #3): the *other* context's
 * rendered board (`getState`/`getPieces`) actually receiving the move over the live relay, both
 * contexts converging to an IDENTICAL `headHash`, the off-turn gate leaving the board UNCHANGED while
 * `getTurnGate().offTurnBlocks` advances, and a late joiner's board inheriting the host's position.
 *
 * ## Live relay, hermetic-when-offline
 *
 * Nothing is mocked: the app boots with its default transport (real `MqttTransport` over `wss://`),
 * each context uses a UNIQUE room per run (the host generates its own code), and both contexts are
 * closed after each test — so no retained state lingers on the broker. If the broker is unreachable
 * (offline / CI without egress) the suite is a GENUINE Playwright SKIP (never a zero-assertion green
 * pass): a live-network test must not turn a network outage into a red build, but it must also never
 * report a false green (agent-principles #2/#3). The reachability probe runs once in `beforeAll`.
 *
 * ## Subscription-gap handling (not a weakened proof)
 *
 * The real broker's `/events` topic is non-retained: a move published in the window before the peer's
 * broker-side subscription is active is silently dropped. The app has no re-publish loop, so the mover
 * drives `window.__pente.resync()` (a genuine app capability — re-broadcast the authoritative log, the
 * seam a reconnect button would use) on each poll tick until the peer OBSERVES the move. Re-broadcasting
 * an already-delivered log is a proven receiver no-op (`decideSync` IGNOREs a prefix — it never moves a
 * peer backward), so the assertion stays genuine: the peer must still actually receive the move over the
 * real relay. This mirrors the `waitForWithRepublish` handshake in `sync.realrelay.test.ts`.
 */

/** The SSOT relay config — the SAME record the app's default transport connects over. */
const RELAY = relay as { wssUrl: string; username: string; password: string; topicRoot: string };

/** How long to wait for the broker to accept a probe connection before declaring it down. */
const CONNECT_PROBE_MS = 10_000;
/** How long to wait for a move to propagate across the live relay (with resync re-broadcast). */
const PROPAGATE_MS = 15_000;

/** Whether the live broker answered the `beforeAll` probe (else every test SKIPs, genuinely). */
let relayReachable = false;

/** Probe the live relay once; resolves true iff an outbound wss connection is accepted. */
function probeRelay(): Promise<boolean> {
  return new Promise<boolean>((res) => {
    const client = mqtt.connect(RELAY.wssUrl, {
      username: RELAY.username,
      password: RELAY.password,
      clientId: `e2e-probe-${Math.random().toString(36).slice(2, 10)}`,
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

/** The subset of `window.__pente` this spec drives. */
type Pente = {
  getState(): { pieces: Record<string, string>; turn: string; winner: string | null } | null;
  getPieces(): { node: string }[] | null;
  getHeadHash(): string | null;
  getNet(): { phase: string; seat: string | null; code: string | null } | null;
  getTurnGate(): { offTurnBlocks: number } | null;
  place(coords: [number, number, number]): unknown;
  dispatch(id: string): boolean | null;
  resync(): void;
};

const P = 'window.__pente';

const net = (page: Page) => page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getNet());
const headHash = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getHeadHash());
const state = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getState());
const turnGate = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getTurnGate());

/**
 * Boot a FRESH, ISOLATED context+page against the real app. Clears localStorage BEFORE boot so this
 * context mints its own `playerId` (distinct seats across contexts) and does NOT install a test
 * transport factory — the app uses its real `MqttTransport` over the live relay (Task 6.7).
 */
async function bootIsolated(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  // Mint a fresh playerId per context (isolated seats) before any app code reads localStorage.
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.getNet === 'function' &&
      typeof p.getHeadHash === 'function' &&
      typeof p.place === 'function' &&
      typeof p.resync === 'function'
    );
  });
  // The session wires up async (opens IndexedDB); wait until it reports an (offline) readout.
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: { getNet(): unknown } }).__pente;
    return !!p && p.getNet() !== null;
  });
  return { context, page };
}

/** Wait until `page`'s session reports `connected` (host or join reached the room). */
async function waitConnected(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getNet()?.phase === 'connected',
    undefined,
    { timeout: PROPAGATE_MS },
  );
}

/**
 * Poll `predicate` on `observer` until true (or timeout), driving `mover`'s `resync()` on each tick
 * to fill the live relay's non-retained subscription gap. Re-broadcast is a proven receiver no-op, so
 * this only defeats a dropped-in-the-gap first publish — the observer must still genuinely receive the
 * move over the real relay (agent-principles #3). Returns whether the predicate held.
 */
async function waitObservedWithResync(
  observer: Page,
  mover: Page,
  predicate: string,
  timeoutMs = PROPAGATE_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ok = await observer.evaluate(
      (pred) => new Function('return (' + pred + ')')() as boolean,
      predicate,
    );
    if (ok) return true;
    if (Date.now() >= deadline) return false;
    await mover.evaluate(() => (window as unknown as { __pente: Pente }).__pente.resync());
    await observer.waitForTimeout(250);
  }
}

/** Host on `page`: dispatch hostGame, wait connected, return the generated room code. */
async function host(page: Page): Promise<string> {
  await page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.dispatch('hostGame'));
  await waitConnected(page);
  const code = (await net(page))?.code;
  expect(code, 'host must generate a room code').not.toBeNull();
  return code!;
}

/** Join `code` on `page` via the net widget's real DOM path (stash code, click Join). */
async function join(page: Page, code: string): Promise<void> {
  await page.evaluate((c: string) => {
    // Task C.2: Host/Join initiation moved to the drawer's Network-Game panel; join via the SAME
    // seam+command the panel uses (stash the validated code, then dispatch the argument-free joinGame).
    const pente = (window as unknown as { __pente: { setPendingJoinCode(x: string): void; dispatch(id: string): boolean } }).__pente;
    pente.setPendingJoinCode(c);
    pente.dispatch('joinGame');
  }, code);
  await waitConnected(page);
}

test.beforeAll(async () => {
  relayReachable = await probeRelay();
  if (!relayReachable) {
    console.warn(
      `[networked.spec] SKIPPING: live relay ${RELAY.wssUrl} unreachable — ` +
        `run with network egress to the broker to exercise the two-browser live path.`,
    );
  }
});

test.describe('two isolated browser contexts over the LIVE relay (Task 6.7, issues #4/#5)', () => {
  test('host+join assign distinct seats; a host move re-renders on the joiner and headHashes MATCH', async ({
    browser,
  }) => {
    test.skip(!relayReachable, 'live relay unreachable');
    const a = await bootIsolated(browser);
    const b = await bootIsolated(browser);
    try {
      // Host in context A (white); join the SAME room in the ISOLATED context B (black).
      const code = await host(a.page);
      await join(b.page, code);

      // SEAT ASSIGNMENT: distinct contexts (distinct playerId) claim distinct seats (issue #5:
      // presence is a real handshake, so B is a genuine second player, not a phantom of A).
      expect((await net(a.page))?.seat).toBe('white');
      expect((await net(b.page))?.seat).toBe('black');

      // A MOVE ON A APPEARS ON B: host plays white; it must cross the live relay and RE-RENDER on B.
      // Assert on getPieces() (the actual reconciled MESH set the user sees), not only getState():
      // getState short-circuits to the session's authoritative state, so it would report the move even
      // if the render-adoption wiring (scene.adoptNetState on session.onChange) were removed. getPieces
      // is driven ONLY by that adoption, so asserting a PIECE MESH appears bites if the wiring regresses
      // (agent-principles #7 — this is the render half of the issue #4 "one game per session" fix).
      await a.page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([2, 2, 2]));
      const onB = await waitObservedWithResync(
        b.page,
        a.page,
        `${P}.getPieces()?.some((m) => m.node === '2,2,2') === true`,
      );
      expect(onB, "host's white move must render (mesh) on the joiner's board").toBe(true);
      expect((await state(b.page))?.pieces['2,2,2']).toBe('white');
      const bMeshes = await b.page.evaluate(
        () => (window as unknown as { __pente: Pente }).__pente.getPieces(),
      );
      expect(bMeshes?.some((m) => m.node === '2,2,2')).toBe(true);

      // headHash MATCH: both authoritative logs converged to an IDENTICAL fingerprint (#3).
      const converged = await waitObservedWithResync(
        b.page,
        a.page,
        `${P}.getHeadHash() === ${JSON.stringify(await headHash(a.page))}`,
      );
      expect(converged, 'both contexts must converge to one headHash').toBe(true);
      expect(await headHash(b.page)).toBe(await headHash(a.page));

      // BIDIRECTIONAL: joiner replies with black; it must re-render on the host and stay converged.
      await b.page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([3, 3, 3]));
      const onA = await waitObservedWithResync(
        a.page,
        b.page,
        `${P}.getPieces()?.some((m) => m.node === '3,3,3') === true`,
      );
      expect(onA, "joiner's black move must render (mesh) on the host's board").toBe(true);
      expect((await state(a.page))?.pieces['3,3,3']).toBe('black');
      expect(await headHash(a.page)).toBe(await headHash(b.page));

      const shot = resolve('e2e/artifacts/networked-two-context.png');
      mkdirSync(dirname(shot), { recursive: true });
      await b.page.screenshot({ path: shot });
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test('the turn-gate REJECTS an off-turn move (board unchanged; offTurnBlocks advances)', async ({
    browser,
  }) => {
    test.skip(!relayReachable, 'live relay unreachable');
    const a = await bootIsolated(browser);
    const b = await bootIsolated(browser);
    try {
      const code = await host(a.page);
      await join(b.page, code);

      // It is WHITE's turn (host A). The JOINER (black, B) is OFF-TURN: its placement must be REJECTED —
      // no move pushed onto the shared log, the board left UNCHANGED, and offTurnBlocks advanced (#4c).
      const blocksBefore = (await turnGate(b.page))?.offTurnBlocks ?? 0;
      const headBefore = await headHash(b.page);

      await b.page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([4, 4, 4]));

      // The off-turn attempt changed NOTHING on the authoritative board (proof the gate bit).
      expect((await state(b.page))?.pieces['4,4,4']).toBeUndefined();
      expect(await headHash(b.page)).toBe(headBefore);
      expect((await turnGate(b.page))?.offTurnBlocks).toBe(blocksBefore + 1);

      // And the block never leaked to the host: A's board is untouched by B's rejected off-turn click.
      // (Give any stray publish real propagation time before asserting the negative.)
      await a.page.waitForTimeout(1_000);
      expect((await state(a.page))?.pieces['4,4,4']).toBeUndefined();

      // Sanity: it IS white's turn, and white CAN place — the gate blocked only the off-turn side.
      await a.page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([4, 4, 4]));
      expect((await state(a.page))?.pieces['4,4,4']).toBe('white');
      const propagated = await waitObservedWithResync(
        b.page,
        a.page,
        `${P}.getState()?.pieces['4,4,4'] === 'white'`,
      );
      expect(propagated, "white's legal move must reach the joiner").toBe(true);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test('a LATE joiner inherits the board the host already played', async ({ browser }) => {
    test.skip(!relayReachable, 'live relay unreachable');
    const a = await bootIsolated(browser);
    try {
      const code = await host(a.page);

      // Host plays BEFORE the joiner exists — the board is non-empty at join time.
      await a.page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([1, 1, 1]));
      expect((await state(a.page))?.pieces['1,1,1']).toBe('white');

      // A LATE joiner in a fresh ISOLATED context connects; on connect the engines exchange logs and
      // the joiner ADOPTS the host's existing board (JOINER-INHERITS-BOARD).
      const b = await bootIsolated(browser);
      try {
        await join(b.page, code);
        const inherited = await waitObservedWithResync(
          b.page,
          a.page,
          `${P}.getPieces()?.some((m) => m.node === '1,1,1') === true`,
        );
        expect(inherited, "the late joiner must inherit (render) the host's played board").toBe(true);
        expect((await state(b.page))?.pieces['1,1,1']).toBe('white');
        const bMeshes = await b.page.evaluate(
          () => (window as unknown as { __pente: Pente }).__pente.getPieces(),
        );
        expect(bMeshes?.some((m) => m.node === '1,1,1')).toBe(true);
        expect(await headHash(b.page)).toBe(await headHash(a.page));
      } finally {
        await b.context.close();
      }
    } finally {
      await a.context.close();
    }
  });
});
