import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import mqtt from 'mqtt';
import relay from '../src/config/defaults/relay.json' with { type: 'json' };

/**
 * Issue #41 — the REAL-RELAY, TWO-CONTEXT session-model scenario matrix (Relates #35, fixes-proof for
 * the #31 double-seat and #40 rematch-reconnect-color regressions OVER THE ACTUAL MQTT BROKER).
 *
 * ## Why this exists (the gap #41 names)
 *
 * `sessionModel.spec.ts` proves the full admission/reclaim/reserve matrix over an INJECTED, in-Node
 * `MockTransport` hub (hermetic, always-green in CI). That mock is faithful, but it is NOT the real
 * broker: it cannot exhibit MQTT's non-retained-topic subscription gap, real presence LWT timing, or
 * the reconnect-over-a-live-connection interactions. The #40 rematch-reconnect color deadlock is
 * exactly a bug that ONLY manifests across the actual relay + rematch + reconnect interaction — the
 * hermetic mock could not surface it. This suite closes that gap: it runs the SAME scenario matrix with
 * NO transport injected, so both isolated contexts drive the app's DEFAULT `MqttTransport` over
 * `relay.json`, end-to-end on the wire.
 *
 * ## Reused pattern (NOT a new transport / skip mechanism)
 *
 * This deliberately reuses the EXISTING real-relay Playwright pattern already proven in
 * `networked.spec.ts` / `sessionModel.spec.ts` / `rematchFlow.spec.ts`:
 *   - `relay.json` is the SSOT relay config — the SAME record the app's default transport connects
 *     over. No new transport, no `pente:config:relay` override injected: a human runs this against the
 *     shitchell.com broker or the deployed `/dev/` build (where the deploy workflow has written creds
 *     into `relay.json`), and it exercises the real wire.
 *   - `probeRelay()` opens ONE outbound wss connection in `beforeAll`; if the broker does not accept it
 *     (blank creds / no egress / offline), every test SELF-SKIPS via `test.skip(!relayReachable, …)` —
 *     a GENUINE Playwright skip, never a zero-assertion green (agent-principles #2/#3). The committed
 *     `relay.json` ships blank, so with no CI-provided/dev relay this whole suite skips cleanly and CI
 *     stays green with no hang (the probe has a hard 10s cap and `reconnectPeriod: 0`).
 *   - The non-retained subscription gap is handled with the same `waitObservedWithResync` /
 *     re-propose-nudge idea the sibling specs use: re-broadcasting an already-delivered log/ask is a
 *     proven receiver no-op (a prefix is IGNOREd; a duplicate ask dedups), so the observer must still
 *     GENUINELY receive the traffic over the real relay — the proof is unchanged, only a dropped-in-the-
 *     gap first publish is defeated.
 *
 * ## Proof-by-state, never a log line (agent-principles #3)
 *
 * Every assertion reads OBSERVABLE `window.__pente` state on BOTH contexts — the identity-owned seat
 * (`getNet().seat`), the seat OWNERS map (`getNetSeatOwners`), the shared game UUID (`getNetGameUuid`),
 * the whole-history `headHash` (`getHeadHash`), whose-turn (`getState().turn`), the typed admission
 * reject (`getNetLastReject`) — plus the USER-FACING net panel (the `net-join-error` line). No test
 * asserts on a console log.
 *
 * ## Honest scope of what a green run here proves
 *
 * This suite can only report GREEN on the real relay when it is run with broker egress (the human runs
 * it against the shitchell.com relay or the `/dev/` deploy). In a no-egress environment it self-SKIPs —
 * that skip is the correct, honest outcome, not a pass. The hermetic `sessionModel.spec.ts` remains the
 * always-green CI proof of the same matrix.
 */

/** The SSOT relay config — the SAME record the app's default transport connects over. */
const RELAY = relay as { wssUrl: string; username: string; password: string; topicRoot: string };
/** Hard cap on the one-shot reachability probe before declaring the broker down (no hang). */
const CONNECT_PROBE_MS = 10_000;
/**
 * The per-wait ceiling for an admission/adopt/reconnect ROUND-TRIP to land an observable state change.
 * Each round-trip is a page→broker→page hop across 2–3 ISOLATED contexts (each a full WebGL app), so
 * under the suite's parallel workers a single hop can be legitimately slow. It is a DEADLINE, not a
 * gate: the awaited condition must still become true — a broken flow never satisfies it, it just fails
 * slower, so the proof is unchanged (agent-principles #7). Kept under `test.slow()`'s 180s budget.
 */
const ROUND_TRIP_MS = 45_000;
/** Whether the live broker answered the `beforeAll` probe (else EVERY test SKIPs, genuinely). */
let relayReachable = false;

/** Probe the live relay once; resolves true iff an outbound wss connection is accepted. */
function probeRelay(): Promise<boolean> {
  return new Promise<boolean>((res) => {
    if (RELAY.wssUrl.length === 0) {
      res(false);
      return;
    }
    const client = mqtt.connect(RELAY.wssUrl, {
      username: RELAY.username,
      password: RELAY.password,
      clientId: `smr-probe-${Math.random().toString(36).slice(2, 10)}`,
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

/** The subset of `window.__pente` these scenarios read/drive (proof-by-state, never a log line). */
type Pente = {
  getNet(): { phase: string; seat: 'white' | 'black' | null; code: string | null } | null;
  getNetSeatOwners(): { white: string | null; black: string | null } | null;
  getNetGameUuid(): string | null;
  getNetLastReject(): 'room-full' | 'seat-reserved' | 'game-mismatch' | 'game-divergent' | null;
  getHeadHash(): string | null;
  getState(): { pieces: Record<string, string>; turn: string; winner: string | null } | null;
  getEndState(): { show: boolean; winner: string | null; rematchUi: string } | null;
  place(coords: [number, number, number]): unknown;
  propose(action: string): boolean | null;
  respond(accepted: boolean): boolean | null;
  setPendingJoinCode(code: string): void;
  dispatch(id: string): boolean | null;
  leaveNet(): void;
};

const P = 'window.__pente';

const seatOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getNet()?.seat ?? null);
const owners = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getNetSeatOwners());
const gameUuid = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getNetGameUuid());
const headHash = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getHeadHash());
const lastReject = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getNetLastReject());
const turnOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getState()?.turn ?? null);

/**
 * Boot a FRESH, ISOLATED context+page against the real app with NO transport injected — the app uses
 * its default `MqttTransport` over `relay.json` (the real-relay pattern of `sessionModel.spec.ts`).
 * Clears localStorage BEFORE boot so this context mints its OWN `playerId` (distinct seats), then pins
 * it to a FIXED value so reclaim-by-identity across a drop/reconnect is deterministic and assertable.
 */
async function bootReal(browser: Browser, playerId: string): Promise<{
  context: BrowserContext;
  page: Page;
  playerId: string;
}> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript((pid: string) => {
    window.localStorage.clear();
    // Pin the stable playerId BEFORE the app reads it, so a returning peer reclaims by the SAME
    // identity across a drop/reconnect (design §2.3 reclaim-by-identity) — distinct across contexts.
    window.localStorage.setItem('pente:playerId', pid);
  }, playerId);
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.getNet === 'function' &&
      typeof p.getNetSeatOwners === 'function' &&
      typeof p.getNetGameUuid === 'function' &&
      typeof p.getNetLastReject === 'function' &&
      typeof p.getHeadHash === 'function' &&
      typeof p.getEndState === 'function' &&
      typeof p.propose === 'function' &&
      typeof p.respond === 'function' &&
      typeof p.leaveNet === 'function'
    );
  });
  // The session wires up async (opens IndexedDB); wait until it reports an (offline) readout.
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: { getNet(): unknown } }).__pente;
    return !!p && p.getNet() !== null;
  });
  return { context, page, playerId };
}

/** Wait until `page`'s session reports `connected`. */
async function waitConnected(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getNet()?.phase === 'connected',
    undefined,
    { timeout: ROUND_TRIP_MS },
  );
}

/** Wait until `page`'s session returns to `offline` (a graceful leave settled it). */
async function waitOffline(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getNet()?.phase === 'offline',
    undefined,
    { timeout: ROUND_TRIP_MS },
  );
}

/** Wait until `page`'s session reports it holds `expected` seat (an admit round-trip landed). */
async function waitSeat(page: Page, expected: 'white' | 'black'): Promise<void> {
  await page.waitForFunction(
    (want: string) => (window as unknown as { __pente: Pente }).__pente.getNet()?.seat === want,
    expected,
    { timeout: ROUND_TRIP_MS },
  );
}

/** Establish as the room's first owner (proposal `new` → white). Returns the claimed room code. */
async function enterNew(page: Page): Promise<string> {
  await page.evaluate(() =>
    (window as unknown as { __pente: Pente }).__pente.dispatch('hostGame'),
  );
  await waitConnected(page);
  const code = await page.evaluate(
    () => (window as unknown as { __pente: Pente }).__pente.getNet()?.code ?? null,
  );
  expect(code, 'establishing entry must claim a room code').not.toBeNull();
  return code!;
}

/** Enter `code` with proposal `defer` (join) — admission (design §5) seats this peer by identity. */
async function enterDefer(page: Page, code: string): Promise<void> {
  await page.evaluate((c: string) => {
    const pente = (window as unknown as { __pente: Pente }).__pente;
    pente.setPendingJoinCode(c);
    pente.dispatch('joinGame');
  }, code);
  await waitConnected(page);
}

/** Gracefully leave the room (drops presence so the resident observes us depart). */
async function leave(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.leaveNet());
  await waitOffline(page);
}

/**
 * Poll `predicate` on `observer` until true (or the deadline), driving `nudge` on each tick to fill the
 * real relay's non-retained subscription gap. The nudge (a `resync` re-broadcast or a re-`propose`) is a
 * proven receiver no-op — a prefix log is IGNOREd and a duplicate ask dedups — so this only defeats a
 * first publish dropped in the pre-subscription window; the observer must still GENUINELY receive the
 * traffic over the real relay (agent-principles #3). Returns whether the predicate held.
 */
async function waitObservedWithNudge(
  observer: Page,
  predicate: string,
  nudge: () => Promise<void>,
  timeoutMs = ROUND_TRIP_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ok = await observer.evaluate(
      (pred) => new Function('return (' + pred + ')')() as boolean,
      predicate,
    );
    if (ok) return true;
    if (Date.now() >= deadline) return false;
    await nudge();
    await observer.waitForTimeout(250);
  }
}

/**
 * Establish a two-peer game over the REAL relay: A enters `new` (→ white, arbiter), B enters `defer`
 * (→ admitted black). Returns the room code + a proof both peers converged on ONE game (distinct real
 * seat owners, same uuid) — the baseline every scenario builds on. Asserting the convergence here means
 * a broken admission over MQTT fails the SETUP, not just a downstream scenario line.
 */
async function establishPair(a: Page, b: Page): Promise<string> {
  const code = await enterNew(a);
  await enterDefer(b, code);
  await waitSeat(b, 'black');
  expect(await seatOf(a)).toBe('white');
  expect(await seatOf(b)).toBe('black');
  const oa = await owners(a);
  const ob = await owners(b);
  // BOTH contexts see the SAME identity-owned seat map: distinct REAL playerIds, no `'host'` sentinel.
  expect(oa?.white).not.toBeNull();
  expect(oa?.black).not.toBeNull();
  expect(oa?.white).not.toBe(oa?.black);
  expect(ob).toEqual(oa);
  // Both reference the SAME game identity after admission (design §2.2).
  expect(await gameUuid(b)).toBe(await gameUuid(a));
  // Whose-turn: a fresh game opens on white (design/glossary), agreed on BOTH contexts.
  expect(await turnOf(a)).toBe('white');
  expect(await turnOf(b)).toBe('white');
  return code;
}

test.beforeAll(async () => {
  relayReachable = await probeRelay();
  if (!relayReachable) {
    console.warn(
      `[sessionModelRelay.spec] SKIPPING: live relay ${RELAY.wssUrl || '(empty relay.json — no creds)'} ` +
        `unreachable — run with network egress to the broker (shitchell.com relay or the /dev/ deploy) ` +
        `to exercise the full session-model matrix over the real MQTT wire. The hermetic ` +
        `sessionModel.spec.ts still proves the same matrix in CI.`,
    );
  }
});

test.describe('session-model matrix over the REAL relay, two isolated contexts (issue #41, Relates #35)', () => {
  // Each scenario boots 2–3 ISOLATED contexts (each a full WebGL app) and negotiates admission over the
  // REAL MQTT broker — genuinely 2–3× the work of a single-context spec, and each hop is a real network
  // round-trip. `test.slow()` triples the budget (the sanctioned Playwright knob for legitimately-heavy
  // tests); it does NOT pin workers or serialize — the isolation/proof is unchanged, only the deadline.
  test.slow();

  test('A enters, B enters → DISTINCT seats (white/black) over the real relay [#31 regression]', async ({
    browser,
  }) => {
    test.skip(!relayReachable, `live relay ${RELAY.wssUrl} unreachable — run with broker egress`);
    const a = await bootReal(browser, 'smr-a');
    const b = await bootReal(browser, 'smr-b');
    try {
      const code = await enterNew(a.page);
      await enterDefer(b.page, code);
      await waitSeat(b.page, 'black');

      const seatA = await seatOf(a.page);
      const seatB = await seatOf(b.page);
      // DISTINCT seats — the #31 fix, over the real relay. One white, one black, never both the same.
      expect(seatA).not.toBe(seatB);
      expect([seatA, seatB].sort()).toEqual(['black', 'white']);
      expect(seatA).toBe('white');
      expect(seatB).toBe('black');

      // BOTH contexts agree on the identity-owned seat map with DISTINCT real owners (no sentinel).
      const oa = await owners(a.page);
      const ob = await owners(b.page);
      expect(oa).toEqual({ white: 'smr-a', black: 'smr-b' });
      expect(ob).toEqual({ white: 'smr-a', black: 'smr-b' });

      // Same GAME identity (uuid) and — after B adopted A's log — an IDENTICAL headHash: one game.
      expect(await gameUuid(b.page)).toBe(await gameUuid(a.page));
      const converged = await waitObservedWithNudge(
        b.page,
        `${P}.getHeadHash() === ${JSON.stringify(await headHash(a.page))}`,
        async () => a.page.evaluate(() => (window as unknown as { __pente: Pente & { resync?: () => void } }).__pente.resync?.()),
      );
      expect(converged, 'both contexts must converge to one headHash over the real relay').toBe(true);

      const shot = resolve('e2e/artifacts/sessionmodelrelay-distinct-seats.png');
      mkdirSync(dirname(shot), { recursive: true });
      await b.page.screenshot({ path: shot });
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test('A drops, A reconnects → resumes WHITE over the real relay', async ({ browser }) => {
    test.skip(!relayReachable, `live relay ${RELAY.wssUrl} unreachable — run with broker egress`);
    const a = await bootReal(browser, 'smr-a');
    const b = await bootReal(browser, 'smr-b');
    try {
      const code = await establishPair(a.page, b.page);
      const uuidBefore = await gameUuid(a.page);
      const headBefore = await headHash(a.page);

      // A (the establisher/white) drops; the surviving resident B assumes the arbiter role and RESERVES
      // white for the absent player. A returns with `defer` → B admits it back onto its RESERVED white.
      await leave(a.page);
      await enterDefer(a.page, code);
      await waitSeat(a.page, 'white');

      // A resumes WHITE, and — the mechanism, not a coincidence — A and B CONVERGE on the SAME game
      // (same uuid + headHash as before the drop), with the seat owners unchanged on BOTH contexts.
      expect(await seatOf(a.page)).toBe('white');
      expect(await seatOf(b.page)).toBe('black');
      expect(await gameUuid(a.page)).toBe(uuidBefore);
      expect(await gameUuid(b.page)).toBe(uuidBefore);
      expect(await headHash(a.page)).toBe(headBefore);
      expect(await headHash(b.page)).toBe(headBefore);
      expect(await owners(a.page)).toEqual({ white: 'smr-a', black: 'smr-b' });
      expect(await owners(b.page)).toEqual({ white: 'smr-a', black: 'smr-b' });
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test('B drops, B reconnects → resumes BLACK over the real relay', async ({ browser }) => {
    test.skip(!relayReachable, `live relay ${RELAY.wssUrl} unreachable — run with broker egress`);
    const a = await bootReal(browser, 'smr-a');
    const b = await bootReal(browser, 'smr-b');
    try {
      const code = await establishPair(a.page, b.page);
      const uuidBefore = await gameUuid(a.page);

      // B drops; the resident A RESERVES black for the absent owner ("room full" stays true).
      await leave(b.page);
      const oaAfterDrop = await owners(a.page);
      expect(oaAfterDrop?.black).toBe('smr-b');

      // B returns (same identity) with `defer` → the resident admits it back onto its RESERVED black.
      await enterDefer(b.page, code);
      await waitSeat(b.page, 'black');
      expect(await seatOf(b.page)).toBe('black');
      // Reclaim-by-identity: both contexts agree owners are unchanged, and B re-adopted the SAME uuid.
      expect(await owners(b.page)).toEqual({ white: 'smr-a', black: 'smr-b' });
      expect(await owners(a.page)).toEqual({ white: 'smr-a', black: 'smr-b' });
      expect(await gameUuid(b.page)).toBe(uuidBefore);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test('Both drop; B rejoins then A rejoins → seats preserved over the real relay', async ({
    browser,
  }) => {
    test.skip(!relayReachable, `live relay ${RELAY.wssUrl} unreachable — run with broker egress`);
    const a = await bootReal(browser, 'smr-a');
    const b = await bootReal(browser, 'smr-b');
    try {
      const code = await establishPair(a.page, b.page);
      const uuidBefore = await gameUuid(a.page);

      // BOTH drop → the room empties. Seat ownership lives in each peer's PERSISTED game (design §6.4),
      // so it survives the empty room.
      await leave(a.page);
      await leave(b.page);

      // B rejoins FIRST (re-seeds as the returning owner from its persisted game), then A rejoins and
      // the resident B admits it back onto its reserved white — arrival order does NOT reassign seats.
      await enterDefer(b.page, code);
      await waitSeat(b.page, 'black');
      await enterDefer(a.page, code);
      await waitSeat(a.page, 'white');

      // Each peer resumes the seat its identity owns — B black (though it returned first), A white.
      expect(await seatOf(b.page)).toBe('black');
      expect(await seatOf(a.page)).toBe('white');
      expect((await owners(b.page))?.black).toBe('smr-b');
      expect((await owners(a.page))?.white).toBe('smr-a');
      // B re-seeded the SAME persisted game identity it owned (not a fresh one); A converged onto it.
      expect(await gameUuid(b.page)).toBe(uuidBefore);
      expect(await gameUuid(a.page)).toBe(uuidBefore);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test('A drops; C enters claiming A’s spot → rejected (seat reserved) over the real relay', async ({
    browser,
  }) => {
    test.skip(!relayReachable, `live relay ${RELAY.wssUrl} unreachable — run with broker egress`);
    const a = await bootReal(browser, 'smr-a');
    const b = await bootReal(browser, 'smr-b');
    const c = await bootReal(browser, 'smr-c');
    try {
      const code = await establishPair(a.page, b.page);

      // A (white) drops. Its white seat is RESERVED for smr-a. C enters claiming a spot; the surviving
      // resident B must refuse it — the reserved white is never handed to a stranger.
      await leave(a.page);

      await c.page.evaluate((cd: string) => {
        const pente = (window as unknown as { __pente: Pente }).__pente;
        pente.setPendingJoinCode(cd);
        pente.dispatch('joinGame');
      }, code);
      await waitOffline(c.page);

      // C is REJECTED with the DISTINCT typed reason `seat-reserved` — A's white is held for its ABSENT
      // owner, NOT the generic `room-full`. Proof-by-state on C's own observable readout.
      expect(await seatOf(c.page)).toBeNull();
      expect(await lastReject(c.page)).toBe('seat-reserved');

      // PROOF-BY-UI (design §7): the seat-reserved reason surfaces its OWN human message in C's net
      // panel — the user sees WHY, not a silent drop back to offline.
      const joinErr = c.page.locator(
        '[data-widget-id="connectionStatus"] [data-testid="net-join-error"]',
      );
      await expect(joinErr).toBeVisible();
      await expect(joinErr).toHaveText(
        'A seat there is being held for a player who stepped away. Try again later.',
      );

      // The surviving resident B still reserves A's white for smr-a — the spot was never handed out.
      expect((await owners(b.page))?.white).toBe('smr-a');
    } finally {
      await a.context.close();
      await b.context.close();
      await c.context.close();
    }
  });

  test('A reject reason surfaces in the net panel over the real relay [proof-by-UI]', async ({
    browser,
  }) => {
    test.skip(!relayReachable, `live relay ${RELAY.wssUrl} unreachable — run with broker egress`);
    const a = await bootReal(browser, 'smr-a');
    const b = await bootReal(browser, 'smr-b');
    const c = await bootReal(browser, 'smr-c');
    try {
      const code = await establishPair(a.page, b.page);

      // Both seats owned AND both owners present → C (a stranger) hits `room-full`, the OTHER typed
      // reject reason. This complements scenario-5's `seat-reserved` to prove BOTH reason strings reach
      // the user-facing net panel over the real relay — the reject-UX §7 requirement.
      await c.page.evaluate((cd: string) => {
        const pente = (window as unknown as { __pente: Pente }).__pente;
        pente.setPendingJoinCode(cd);
        pente.dispatch('joinGame');
      }, code);
      await waitOffline(c.page);

      expect(await lastReject(c.page)).toBe('room-full');
      expect(await seatOf(c.page)).toBeNull();

      const joinErr = c.page.locator(
        '[data-widget-id="connectionStatus"] [data-testid="net-join-error"]',
      );
      await expect(joinErr).toBeVisible();
      await expect(joinErr).toHaveText('That room already has two players.');

      // The admitted pair is untouched — C's rejected entry never displaced A or B.
      const oa = await owners(a.page);
      expect(oa?.white).toBe('smr-a');
      expect(oa?.black).toBe('smr-b');

      const shot = resolve('e2e/artifacts/sessionmodelrelay-reject-ui.png');
      mkdirSync(dirname(shot), { recursive: true });
      await c.page.screenshot({ path: shot });
    } finally {
      await a.context.close();
      await b.context.close();
      await c.context.close();
    }
  });

  test('Rematch: game ends → mutual rematch → colors swap → drop → reconnect resumes the SWAPPED color [#40 regression]', async ({
    browser,
  }) => {
    test.skip(!relayReachable, `live relay ${RELAY.wssUrl} unreachable — run with broker egress`);
    const a = await bootReal(browser, 'smr-a');
    const b = await bootReal(browser, 'smr-b');
    try {
      const code = await establishPair(a.page, b.page);

      // ── Drive a REAL white five-in-a-row over the relay so the game ENDS (design N.2 end-state) ──
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
        const wk = `${whiteLine[i]![0]},${whiteLine[i]![1]},${whiteLine[i]![2]}`;
        await a.page.evaluate(
          (c) => (window as unknown as { __pente: Pente }).__pente.place(c),
          whiteLine[i]!,
        );
        const onB = await waitObservedWithNudge(
          b.page,
          `${P}.getState()?.pieces[${JSON.stringify(wk)}] === 'white'`,
          async () => a.page.evaluate(() => (window as unknown as { __pente: Pente & { resync?: () => void } }).__pente.resync?.()),
        );
        expect(onB, `white move ${wk} must reach B over the real relay`).toBe(true);
        if (i < blackSpacers.length) {
          const bk = `${blackSpacers[i]![0]},${blackSpacers[i]![1]},${blackSpacers[i]![2]}`;
          await b.page.evaluate(
            (c) => (window as unknown as { __pente: Pente }).__pente.place(c),
            blackSpacers[i]!,
          );
          const onA = await waitObservedWithNudge(
            a.page,
            `${P}.getState()?.pieces[${JSON.stringify(bk)}] === 'black'`,
            async () => b.page.evaluate(() => (window as unknown as { __pente: Pente & { resync?: () => void } }).__pente.resync?.()),
          );
          expect(onA, `black move ${bk} must reach A over the real relay`).toBe(true);
        }
      }
      // BOTH clients converge on the won state — the win crossed the relay (proof-by-state).
      for (const page of [a.page, b.page]) {
        await page.waitForFunction(
          () => (window as unknown as { __pente: Pente }).__pente.getState()?.winner === 'white',
          undefined,
          { timeout: ROUND_TRIP_MS },
        );
        expect((await page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getEndState()))?.show).toBe(true);
      }

      const uuidBeforeRematch = await gameUuid(a.page);

      // ── Mutual rematch: A proposes, B accepts (over the relay) → in-place reset, colors SWAP ──
      await a.page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.propose('rematch'));
      const bSawAsk = await waitObservedWithNudge(
        b.page,
        `${P}.getEndState()?.rematchUi === 'incoming'`,
        async () => a.page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.propose('rematch')),
      );
      expect(bSawAsk, 'B must receive the rematch ask over the real relay').toBe(true);
      await b.page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.respond(true));

      // BOTH reset to a fresh empty game, STILL connected, with SEATS SWAPPED (A white→black, B black→white).
      for (const page of [a.page, b.page]) {
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
          { timeout: ROUND_TRIP_MS },
        );
      }
      // Colors SWAPPED — proof-by-state on BOTH contexts.
      expect(await seatOf(a.page), 'A (was white) must now be black after rematch').toBe('black');
      expect(await seatOf(b.page), 'B (was black) must now be white after rematch').toBe('white');
      // The rematch minted a FRESH game identity (a different uuid than the finished one).
      const uuidAfterRematch = await gameUuid(a.page);
      expect(uuidAfterRematch).not.toBeNull();
      expect(uuidAfterRematch).not.toBe(uuidBeforeRematch);
      expect(await gameUuid(b.page)).toBe(uuidAfterRematch);

      // ── The #40 deadlock: A DROPS then RECONNECTS and must resume its SWAPPED color (black) ──
      // This is the exact interaction the hermetic mock could not surface — rematch (seat swap) THEN a
      // real-relay reconnect. Before the #40 fix, the returning peer failed to reclaim the swapped seat
      // (color deadlock). Proof-by-state: A comes back on BLACK (its post-swap color), not white.
      await leave(a.page);
      await enterDefer(a.page, code);
      await waitSeat(a.page, 'black');
      expect(await seatOf(a.page), 'A must resume its SWAPPED color (black) after reconnect [#40]').toBe('black');
      expect(await seatOf(b.page)).toBe('white');
      // Both agree on the SWAPPED-game identity + the reclaimed-seat owners — a genuine resume, not a
      // fresh coincidental seating.
      expect(await gameUuid(a.page)).toBe(uuidAfterRematch);
      expect(await gameUuid(b.page)).toBe(uuidAfterRematch);
      expect(await owners(a.page)).toEqual({ white: 'smr-b', black: 'smr-a' });
      expect(await owners(b.page)).toEqual({ white: 'smr-b', black: 'smr-a' });

      const shot = resolve('e2e/artifacts/sessionmodelrelay-rematch-reconnect.png');
      mkdirSync(dirname(shot), { recursive: true });
      await a.page.screenshot({ path: shot });
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });
});
