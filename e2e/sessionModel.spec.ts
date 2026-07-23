import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import mqtt from 'mqtt';
import relay from '../src/config/defaults/relay.json' with { type: 'json' };

/**
 * Task S.7 e2e — the GLUE proof for the networked SESSION MODEL (epic #35, closes #31). This is the
 * cross-component integration test the component gates cannot give: two INDEPENDENT app instances in
 * ISOLATED browser contexts (distinct `playerId`s → distinct seats) negotiate room entry over the
 * injected {@link import('../src/net/transport').MockTransport} seam
 * (`window.__penteNetTransportFactory`), and every assertion is on OBSERVABLE session state read off
 * BOTH contexts' `window.__pente` — the identity-owned seat OWNERS (`getNetSeatOwners`), the shared
 * game UUID (`getNetGameUuid`), the whole-history `headHash` (`getHeadHash`), and the TYPED admission
 * reject reason (`getNetLastReject`) — never a log line (agent-principles #3).
 *
 * ## Why a Node-relayed mock (not BroadcastChannel)
 *
 * The existing hermetic two-client specs (`netWiring`, `presenceLiveness`) put two PAGES in ONE
 * context sharing a `BroadcastChannel`. That cannot model S.7: S.7 needs two ISOLATED contexts so each
 * mints its OWN `playerId` (distinct localStorage → distinct seats), and a `BroadcastChannel` does not
 * cross Playwright's context (storage-partition) boundary. So the relay lives in the Node test process
 * — a faithful in-memory hub (the same contract as `MockRelayHub`: fan a publish to every OTHER peer,
 * never echo the sender; broadcast presence room-wide). Each page's injected transport forwards
 * `connect`/`publish`/`disconnect` to the hub via Playwright bindings, and the hub delivers messages +
 * presence back into each page. Real admission + sync JSON crosses the process, so a peer genuinely
 * receives the other's traffic — the S.5 `enter()` state machine runs end-to-end over the seam, and a
 * broken admission wiring bites here (no admit → no seat → the downstream assertions fail).
 *
 * ## The scenarios (design §6) — one test each, plus the #31 regression
 *
 *  1. A,B enter, then C enters → C rejected `room-full` (both seats owned). [PROVEN]
 *  2. A,B; B drops + rejoins → B RECLAIMS black by identity while A stays resident. [PROVEN]
 *  3. A,B; A drops + rejoins → the resident B (arbiter after handoff) admits A back onto WHITE running
 *      the SAME game — asserted by A+B converging on one uuid + headHash, not a coincidental color. [PROVEN]
 *  4. A,B; both drop; B rejoins then A rejoins → durable seat ownership is preserved (B reloads its
 *      persisted game and reclaims BLACK though it returns first; A resumes WHITE), both converging on the
 *      SAME game uuid. Wired by `buildProvisionalSeat` reloading the room-scoped persisted game+seatmap. [PROVEN]
 *  5. A,B; A drops; C enters claiming A's spot → C rejected (A's white RESERVED). The admitted peer B
 *      ASSUMES the arbiter role on A's departure (presence handoff) and its persisted seat map still
 *      reserves white for the absent player-a, so C hits room-full. [PROVEN]
 *  #31 regression: BOTH peers choose the SAME code and 'defer'/'new' (the old both-Join) → they get
 *      DISTINCT seats (one white, one black), asserted on BOTH contexts' seat + game uuid + headHash.
 *      [PROVEN — and shown to BITE: restoring the old empty-map seeding makes it fail; see the report.]
 *
 * ## Real relay (self-skips without creds)
 *
 * A final scenario exercises the REAL relay (`relay.json`) with two isolated contexts running the app's
 * DEFAULT transport — no mock injected — so the whole model is proven over MQTT too. It self-SKIPs (a
 * genuine Playwright skip, never a zero-assertion green) when the broker is unreachable, exactly like
 * `networked.spec.ts`.
 */

/** The SSOT relay config — the same record the app's default transport connects over. */
const RELAY = relay as { wssUrl: string; username: string; password: string; topicRoot: string };
/** How long to wait for the broker to accept a probe connection before declaring it down. */
const CONNECT_PROBE_MS = 10_000;
/**
 * The per-wait ceiling for an admission/adopt ROUND-TRIP to land an observable state change (a seat, a
 * convergence, an offline). Each round-trip here is a page→Node-hub→page `evaluate` hop across 2–3
 * ISOLATED contexts (each a full WebGL app), so under the suite's PARALLEL workers a single hop can be
 * legitimately slow — the documented cost of the cross-context proof, NOT a logic race. This ceiling is
 * generous ENOUGH that a genuinely-completing round-trip is never cut off under load (the old 15s per-
 * wait cap lost there even though `test.slow()` tripled the whole-test budget — a `waitForFunction`
 * timeout is a hard local cap `test.slow` does not touch). It is a DEADLINE, not a gate: the awaited
 * condition must still become true — a broken admission never satisfies it, it just fails slower, so
 * the proof is unchanged (agent-principles #7). Kept well under `test.slow()`'s 180s whole-test budget.
 */
const ROUND_TRIP_MS = 45_000;
/** Whether the live broker answered the `beforeAll` probe (else the real-relay test SKIPs, genuinely). */
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

/** The subset of `window.__pente` these scenarios read (proof-by-state, never a log line). */
type Pente = {
  getNet(): { phase: string; seat: 'white' | 'black' | null; code: string | null } | null;
  getNetSeatOwners(): { white: string | null; black: string | null } | null;
  getNetGameUuid(): string | null;
  getNetLastReject(): 'room-full' | 'seat-reserved' | 'game-mismatch' | 'game-divergent' | null;
  getHeadHash(): string | null;
  leaveNet(): void;
};

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

/**
 * A faithful in-Node relay hub the injected transports rendezvous on by room code — the two-ISOLATED-
 * CONTEXT test double for the broker. Its contract matches {@link import('../src/net/transport').MockRelayHub}:
 * a publish fans out to every OTHER peer in the room (never the sender — a faithful relay does not
 * echo), and presence is broadcast room-wide on every join/leave. The hub lives in Node so it can
 * bridge two contexts a `BroadcastChannel` cannot; it delivers messages/presence back into each page
 * by invoking the page-side globals the injected transport installed.
 */
class NodeRelayHub {
  /** peerId → its page handle + current room (null when disconnected). */
  private readonly peers = new Map<string, { page: Page; room: string | null }>();

  /** Register a page under `peerId` (its transport forwards connect/publish/disconnect to the hub). */
  register(peerId: string, page: Page): void {
    this.peers.set(peerId, { page, room: null });
  }

  /** `peerId` joins `room`: record membership, then broadcast the updated presence room-wide. */
  connect(peerId: string, room: string): void {
    const peer = this.peers.get(peerId);
    if (peer === undefined) return;
    peer.room = room;
    void this.broadcastPresence(room);
  }

  /** Relay `body` from `peerId` to every OTHER peer in the same room (never echo the sender). */
  publish(peerId: string, body: unknown): void {
    const sender = this.peers.get(peerId);
    if (sender === undefined || sender.room === null) return;
    // Clone through JSON so the relay is opaque (no shared references leaking between "peers").
    const wire = JSON.parse(JSON.stringify(body)) as unknown;
    for (const [id, peer] of this.peers) {
      if (id === peerId || peer.room !== sender.room) continue;
      void peer.page
        .evaluate((b) => (window as unknown as { __relayDeliver(x: unknown): void }).__relayDeliver(b), wire)
        .catch(() => {}); // a page closed mid-relay is fine — the peer simply left.
    }
  }

  /** `peerId` leaves its room: drop membership and broadcast the shrunk presence. */
  disconnect(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer === undefined || peer.room === null) return;
    const room = peer.room;
    peer.room = null;
    void this.broadcastPresence(room);
  }

  /** The playerIds currently present in `room` (snapshot). */
  private roomPeers(room: string): string[] {
    return [...this.peers.entries()].filter(([, p]) => p.room === room).map(([id]) => id);
  }

  /** Push the current presence snapshot into every page in `room` (room-wide truth, senders included). */
  private async broadcastPresence(room: string): Promise<void> {
    const present = this.roomPeers(room);
    await Promise.all(
      [...this.peers.values()]
        .filter((p) => p.room === room)
        .map((p) =>
          p.page
            .evaluate(
              (peers) =>
                (window as unknown as { __relayPresence(x: readonly string[]): void }).__relayPresence(
                  peers,
                ),
              present,
            )
            .catch(() => {}),
        ),
    );
  }
}

/**
 * Boot a FRESH ISOLATED context+page wired to `hub` under a FIXED `playerId`. The context is isolated
 * (its own storage partition → its own seats), and the init script (a) clears + pins this browser's
 * stable `playerId` so seats are deterministic, and (b) installs the injected transport factory that
 * forwards to the Node hub via bindings. Returns the context + page + playerId.
 */
async function bootPeer(
  browser: Browser,
  hub: NodeRelayHub,
  playerId: string,
): Promise<{ context: BrowserContext; page: Page; playerId: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();

  // Bindings the in-page transport calls (page → Node hub). Registered on the CONTEXT so they exist
  // for the page from first script. `connect`/`publish`/`disconnect` mirror the Transport methods.
  await context.exposeBinding('__relayConnect', (_src, room: string) => hub.connect(playerId, room));
  await context.exposeBinding('__relayPublish', (_src, body: unknown) => hub.publish(playerId, body));
  await context.exposeBinding('__relayDisconnect', () => hub.disconnect(playerId));

  await page.addInitScript((pid: string) => {
    window.localStorage.clear();
    // Pin the stable playerId BEFORE the app reads it (appSession.resolvePlayerId), so this context's
    // seats are deterministic and distinct across contexts — the identity that owns a seat (design §2.3).
    window.localStorage.setItem('pente:playerId', pid);

    // The page-side half of the Node-relayed transport: the hub calls these globals to deliver a peer
    // message / a presence change; the injected transport wires its onMessage/onPresence callbacks here.
    interface Wiring {
      msgCb: (msg: unknown) => void;
      presenceCb: (peers: readonly string[]) => void;
    }
    const wiring: Wiring = { msgCb: () => {}, presenceCb: () => {} };
    (window as unknown as { __relayDeliver(m: unknown): void }).__relayDeliver = (m) =>
      wiring.msgCb(m);
    (window as unknown as { __relayPresence(p: readonly string[]): void }).__relayPresence = (p) =>
      wiring.presenceCb(p);

    (window as unknown as { __penteNetTransportFactory: () => unknown }).__penteNetTransportFactory =
      () => ({
        connect: (roomCode: string) => {
          void (window as unknown as { __relayConnect(r: string): Promise<void> }).__relayConnect(
            roomCode,
          );
          return Promise.resolve();
        },
        publish: (body: unknown) => {
          void (window as unknown as { __relayPublish(b: unknown): Promise<void> }).__relayPublish(
            body,
          );
        },
        onMessage: (cb: (msg: unknown) => void) => {
          wiring.msgCb = cb;
        },
        onPresence: (cb: (peers: readonly string[]) => void) => {
          wiring.presenceCb = cb;
        },
        disconnect: () => {
          void (window as unknown as { __relayDisconnect(): Promise<void> }).__relayDisconnect();
        },
      });
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
      typeof p.getHeadHash === 'function'
    );
  });
  // The session wires up async (opens IndexedDB); wait until it reports an (offline) readout.
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: { getNet(): unknown } }).__pente;
    return !!p && p.getNet() !== null;
  });
  return { context, page, playerId };
}

/**
 * ENTER a room with a seed `proposal` by driving the SAME session seam the panel/commands drive — a
 * direct `enter()` on the live session behind `window.__pente` is NOT exposed, so use the command +
 * pending-code path for `defer` (join) and the host command for `new` (host). To keep the seed EXPLICIT
 * per scenario we call the session's `enter` through a tiny test hook installed by the app… but the app
 * exposes only `hostGame` (→ `new`) and `joinGame` (→ `defer`). Those two proposals are exactly what
 * scenarios 1–5 + the #31 regression need, so we map: `new` → host, `defer` → join(code).
 */
async function enterNew(page: Page): Promise<string> {
  await page.evaluate(() =>
    (window as unknown as { __pente: { dispatch(id: string): boolean } }).__pente.dispatch('hostGame'),
  );
  await waitConnected(page);
  const code = await page.evaluate(
    () => (window as unknown as { __pente: Pente }).__pente.getNet()?.code ?? null,
  );
  expect(code, 'establishing entry must claim a room code').not.toBeNull();
  return code!;
}

async function enterDefer(page: Page, code: string): Promise<void> {
  await page.evaluate((c: string) => {
    const pente = (
      window as unknown as {
        __pente: { setPendingJoinCode(x: string): void; dispatch(id: string): boolean };
      }
    ).__pente;
    pente.setPendingJoinCode(c);
    pente.dispatch('joinGame');
  }, code);
  await waitConnected(page);
}

/** Wait until `page`'s session reports `connected`. */
async function waitConnected(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getNet()?.phase === 'connected',
    undefined,
    { timeout: ROUND_TRIP_MS },
  );
}

/** Wait until `page`'s session returns to `offline` (a drop / a reject settled it). */
async function waitOffline(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getNet()?.phase === 'offline',
    undefined,
    { timeout: ROUND_TRIP_MS },
  );
}

/** Gracefully leave the room (drops presence so the resident observes us depart). */
async function leave(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.leaveNet());
  await waitOffline(page);
}

/**
 * Establish a two-peer game: A enters `new` (→ white, arbiter), B enters `defer` on A's code
 * (→ admitted black). Returns the room code + a proof both peers converged on ONE game (distinct real
 * seat owners, same uuid) — the baseline every scenario builds on. Asserting the convergence here means
 * a broken admission wiring fails the SETUP, not just a downstream scenario line.
 */
async function establishPair(a: Page, b: Page): Promise<string> {
  const code = await enterNew(a);
  await enterDefer(b, code);
  // Give the admit round-trip a beat to land B's seat + adopted game.
  await b.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getNet()?.seat === 'black',
    undefined,
    { timeout: ROUND_TRIP_MS },
  );
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
  return code;
}

test.beforeAll(async () => {
  relayReachable = await probeRelay();
});

test.describe('two-context session model over the injected MockTransport (S.7, epic #35, closes #31)', () => {
  // Each scenario boots 2–3 ISOLATED contexts (each a full WebGL app) and negotiates admission over a
  // Node-bridged relay whose round-trips are page↔process `evaluate` hops. That is genuinely 2–3× the
  // work of a single-context spec, and under the full suite's parallel workers the boot + hops can
  // exceed the 60s default — a real cost of the cross-context proof, NOT a logic race. `test.slow()`
  // triples the budget (the sanctioned Playwright knob for legitimately-heavy tests); it does NOT pin
  // workers or serialize (agent-principles #7 — the isolation/proof is unchanged, only the deadline).
  test.slow();

  test('scenario 1: A,B established, then C enters → C rejected room-full (both seats owned)', async ({
    browser,
  }) => {
    const hub = new NodeRelayHub();
    const a = await bootPeer(browser, hub, 'player-a');
    const b = await bootPeer(browser, hub, 'player-b');
    const c = await bootPeer(browser, hub, 'player-c');
    hub.register(a.playerId, a.page);
    hub.register(b.playerId, b.page);
    hub.register(c.playerId, c.page);
    try {
      const code = await establishPair(a.page, b.page);

      // C enters the FULL room with `defer`. It owns neither seat and both are owned → the resident
      // arbiter refuses with the HONEST typed reason, and C stays OFFLINE (never displaces an owner).
      await c.page.evaluate((cd: string) => {
        const pente = (
          window as unknown as {
            __pente: { setPendingJoinCode(x: string): void; dispatch(id: string): boolean };
          }
        ).__pente;
        pente.setPendingJoinCode(cd);
        pente.dispatch('joinGame');
      }, code);
      await waitOffline(c.page);

      expect(await lastReject(c.page)).toBe('room-full');
      expect(await seatOf(c.page)).toBeNull();
      // The admitted pair is untouched — C's rejected entry never displaced A or B.
      const oa = await owners(a.page);
      expect(oa?.white).toBe('player-a');
      expect(oa?.black).toBe('player-b');

      const shot = resolve('e2e/artifacts/sessionmodel-scenario1-roomfull.png');
      mkdirSync(dirname(shot), { recursive: true });
      await c.page.screenshot({ path: shot });
    } finally {
      await a.context.close();
      await b.context.close();
      await c.context.close();
    }
  });

  test('scenario 2: A,B; B drops and rejoins → B RECLAIMS black by identity', async ({ browser }) => {
    const hub = new NodeRelayHub();
    const a = await bootPeer(browser, hub, 'player-a');
    const b = await bootPeer(browser, hub, 'player-b');
    hub.register(a.playerId, a.page);
    hub.register(b.playerId, b.page);
    try {
      const code = await establishPair(a.page, b.page);
      const uuidBefore = await gameUuid(a.page);

      // B drops (graceful leave → presence departs; the resident A reserves black for player-b).
      await leave(b.page);
      // The resident's seat map still RESERVES black for the absent owner — "room full" stays true.
      const oaAfterDrop = await owners(a.page);
      expect(oaAfterDrop?.black).toBe('player-b');

      // B returns (same playerId) with `defer` → the resident admits it back onto its RESERVED black.
      await enterDefer(b.page, code);
      await b.page.waitForFunction(
        () => (window as unknown as { __pente: Pente }).__pente.getNet()?.seat === 'black',
        undefined,
        { timeout: ROUND_TRIP_MS },
      );
      expect(await seatOf(b.page)).toBe('black');
      // Reclaim-by-identity: B is back on BLACK, both contexts agree the owners are unchanged, and B
      // re-adopted the SAME game uuid (design §2.3) — a reconnect is a non-event for ownership.
      expect(await owners(b.page)).toEqual({ white: 'player-a', black: 'player-b' });
      expect(await gameUuid(b.page)).toBe(uuidBefore);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test('scenario 3: A,B; A drops and rejoins → A resumes WHITE', async ({ browser }) => {
    const hub = new NodeRelayHub();
    const a = await bootPeer(browser, hub, 'player-a');
    const b = await bootPeer(browser, hub, 'player-b');
    hub.register(a.playerId, a.page);
    hub.register(b.playerId, b.page);
    try {
      await establishPair(a.page, b.page);
      const code = (await a.page.evaluate(
        () => (window as unknown as { __pente: Pente }).__pente.getNet()?.code ?? null,
      ))!;
      const uuidBefore = await gameUuid(a.page);
      const headBefore = await headHash(a.page);

      // A (the establisher/white) drops, then returns to the SAME room with `defer`. When A leaves, the
      // surviving resident B ASSUMES the arbiter role (design §2.4 handoff), so on A's return B admits
      // it back onto its RESERVED white running the SAME game — a genuine resume, not a coincidence.
      await leave(a.page);
      await enterDefer(a.page, code);
      await waitConnected(a.page);
      // Wait until A is back on WHITE — the admit round-trip from the resident B.
      await a.page.waitForFunction(
        () => (window as unknown as { __pente: Pente }).__pente.getNet()?.seat === 'white',
        undefined,
        { timeout: ROUND_TRIP_MS },
      );

      // A resumes on WHITE, and — the mechanism, not a coincidence — A and B CONVERGE on the SAME game:
      // A re-adopted B's authoritative game (same uuid + headHash as before the drop), and BOTH contexts
      // agree the seat owners are unchanged. This asserts on B too, and on the shared identity/history,
      // so a divergent-fresh-game resume (the old proof-by-inference gap) would now FAIL here.
      expect(await seatOf(a.page)).toBe('white');
      expect(await seatOf(b.page)).toBe('black');
      expect(await gameUuid(a.page)).toBe(uuidBefore);
      expect(await gameUuid(b.page)).toBe(uuidBefore);
      expect(await headHash(a.page)).toBe(headBefore);
      expect(await headHash(b.page)).toBe(headBefore);
      expect(await owners(a.page)).toEqual({ white: 'player-a', black: 'player-b' });
      expect(await owners(b.page)).toEqual({ white: 'player-a', black: 'player-b' });
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  // Design §6.4: seat ownership is a DURABLE property of each peer's persisted game, so it survives an
  // EMPTY room — B re-seeds as BLACK and A resumes WHITE regardless of who returns first. The S.5 glue
  // now wires that persistence: `NetSession.buildProvisionalSeat` reloads this room's persisted game +
  // seat map and RECLAIMS the owned color (`persistRoomState`/`loadRoomState` under a room-scoped key),
  // so the first returning owner re-establishes as the color it owned, not first-available white. This
  // is the integration gate that exposed the missing wiring; it is now a REAL proof (proof-by-state on
  // both contexts). The mock-transport unit proof of the same mechanism lives in `session.test.ts`.
  test(
    'scenario 4: A,B; both drop; B rejoins then A rejoins → seat ownership preserved',
    async ({ browser }) => {
    const hub = new NodeRelayHub();
    const a = await bootPeer(browser, hub, 'player-a');
    const b = await bootPeer(browser, hub, 'player-b');
    hub.register(a.playerId, a.page);
    hub.register(b.playerId, b.page);
    try {
      const code = await establishPair(a.page, b.page);
      const uuidBefore = await gameUuid(a.page);

      // BOTH drop → the room empties. Seat ownership lives in each peer's persisted game (design §6.4),
      // so it survives the empty room.
      await leave(a.page);
      await leave(b.page);

      // B rejoins FIRST (re-seeds as the returning owner from its persisted game), then A rejoins and
      // the resident B admits it back onto its reserved white.
      await enterDefer(b.page, code);
      await b.page.waitForFunction(
        () => (window as unknown as { __pente: Pente }).__pente.getNet()?.seat === 'black',
        undefined,
        { timeout: ROUND_TRIP_MS },
      );
      await enterDefer(a.page, code);
      await a.page.waitForFunction(
        () => (window as unknown as { __pente: Pente }).__pente.getNet()?.seat === 'white',
        undefined,
        { timeout: ROUND_TRIP_MS },
      );

      // Each peer resumes the seat its identity owns — B black, A white — NOT reassigned by arrival
      // order (B arrived first but is still BLACK, not white). Proof-by-state on both contexts.
      expect(await seatOf(b.page)).toBe('black');
      expect(await seatOf(a.page)).toBe('white');
      expect((await owners(b.page))?.black).toBe('player-b');
      expect((await owners(a.page))?.white).toBe('player-a');
      // B re-seeded the SAME persisted game identity it owned (not a fresh one), and A converged onto it.
      expect(await gameUuid(b.page)).toBe(uuidBefore);
      expect(await gameUuid(a.page)).toBe(uuidBefore);
    } finally {
      await a.context.close();
      await b.context.close();
    }
    },
  );

  // Design §6.5: C is rejected when A's white is RESERVED. Both pieces of S.5 wiring are now in place:
  // (1) an ADMITTED peer (B) ASSUMES the arbiter role when the establisher A drops and B becomes the
  // sole resident (`onPresence` handoff), so there IS a resident to refuse C; and (2) B's identity-owned
  // seat map — persisted and kept in memory — still RESERVES white for the absent player-a, so a claim
  // by the stranger C hits room-full. This integration test, once a tracked `fixme`, is now a REAL proof
  // (proof-by-state: C is rejected + stays offline; the reserved seat is never handed out).
  test('scenario 5: A,B; A drops; C enters claiming A’s spot → C rejected (white RESERVED)', async ({
    browser,
  }) => {
    const hub = new NodeRelayHub();
    const a = await bootPeer(browser, hub, 'player-a');
    const b = await bootPeer(browser, hub, 'player-b');
    const c = await bootPeer(browser, hub, 'player-c');
    hub.register(a.playerId, a.page);
    hub.register(b.playerId, b.page);
    hub.register(c.playerId, c.page);
    try {
      const code = await establishPair(a.page, b.page);

      // A (white) drops. Its white seat is RESERVED for player-a (design §6.5). C now enters claiming a
      // spot; the surviving resident B must refuse it — the reserved white is never handed to a stranger.
      await leave(a.page);

      await c.page.evaluate((cd: string) => {
        const pente = (
          window as unknown as {
            __pente: { setPendingJoinCode(x: string): void; dispatch(id: string): boolean };
          }
        ).__pente;
        pente.setPendingJoinCode(cd);
        pente.dispatch('joinGame');
      }, code);

      // The DESIRED outcome (design §6.5 / §7 scenario 5): C is REJECTED with the DISTINCT typed reason
      // `seat-reserved` — A's white is held for its ABSENT owner, NOT the generic `room-full` (scenario
      // 1, both owners present). Pinned to the exact value on C's own observable state (proof-by-state),
      // mirroring scenario 1's `.toBe('room-full')` — the scenario-1-vs-5 reason distinction the design
      // requires. C is never seated onto A's reserved white.
      await waitOffline(c.page);
      expect(await seatOf(c.page)).toBeNull();
      expect(await lastReject(c.page)).toBe('seat-reserved');
      // The surviving resident B still reserves A's white for player-a — the spot was never handed out.
      expect((await owners(b.page))?.white).toBe('player-a');
    } finally {
      await a.context.close();
      await b.context.close();
      await c.context.close();
    }
  });

  test('#31 REGRESSION: both peers enter the SAME code → DISTINCT seats (one white, one black), one game', async ({
    browser,
  }) => {
    const hub = new NodeRelayHub();
    const a = await bootPeer(browser, hub, 'player-a');
    const b = await bootPeer(browser, hub, 'player-b');
    hub.register(a.playerId, a.page);
    hub.register(b.playerId, b.page);
    try {
      // The OLD both-Join: A establishes, B joins the SAME code with `defer`. Pre-#31 BOTH got Black
      // (seats were derived from the button, not negotiated). Now admission negotiates identity-owned
      // seats → DISTINCT colors. Assert on BOTH contexts' seat + game uuid + headHash (proof-by-state).
      const code = await enterNew(a.page);
      await enterDefer(b.page, code);
      await b.page.waitForFunction(
        () => (window as unknown as { __pente: Pente }).__pente.getNet()?.seat === 'black',
        undefined,
        { timeout: ROUND_TRIP_MS },
      );

      const seatA = await seatOf(a.page);
      const seatB = await seatOf(b.page);
      // DISTINCT seats — the #31 fix. One is white, one is black, never both the same.
      expect(seatA).not.toBe(seatB);
      expect([seatA, seatB].sort()).toEqual(['black', 'white']);

      // BOTH contexts see the SAME identity-owned seat map with DISTINCT real owners (no sentinel).
      const oa = await owners(a.page);
      const ob = await owners(b.page);
      expect(oa).toEqual({ white: 'player-a', black: 'player-b' });
      expect(ob).toEqual({ white: 'player-a', black: 'player-b' });

      // Same GAME identity (uuid) on both contexts, and — after B adopted A's log — an IDENTICAL
      // headHash: they converged on ONE game, not two forks.
      const uuidA = await gameUuid(a.page);
      const uuidB = await gameUuid(b.page);
      expect(uuidA).not.toBeNull();
      expect(uuidB).toBe(uuidA);
      await b.page.waitForFunction(
        (expected) => (window as unknown as { __pente: Pente }).__pente.getHeadHash() === expected,
        await headHash(a.page),
        { timeout: ROUND_TRIP_MS },
      );
      expect(await headHash(b.page)).toBe(await headHash(a.page));

      const shot = resolve('e2e/artifacts/sessionmodel-31-distinct-seats.png');
      mkdirSync(dirname(shot), { recursive: true });
      await b.page.screenshot({ path: shot });
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test('REAL RELAY: two isolated contexts negotiate DISTINCT seats over MQTT (self-skips offline)', async ({
    browser,
  }) => {
    test.skip(!relayReachable, `live relay ${RELAY.wssUrl} unreachable — run with egress to exercise MQTT`);
    // No mock injected: both isolated contexts run the app's DEFAULT MqttTransport over relay.json.
    const mkReal = async (): Promise<{ context: BrowserContext; page: Page }> => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.addInitScript(() => window.localStorage.clear());
      await page.goto('/');
      await page.waitForFunction(() => {
        const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
        return (
          !!p &&
          typeof p.getNet === 'function' &&
          typeof p.getNetSeatOwners === 'function' &&
          typeof p.getNetGameUuid === 'function'
        );
      });
      await page.waitForFunction(() => {
        const p = (window as unknown as { __pente?: { getNet(): unknown } }).__pente;
        return !!p && p.getNet() !== null;
      });
      return { context, page };
    };
    const a = await mkReal();
    const b = await mkReal();
    try {
      const code = await enterNew(a.page);
      await enterDefer(b.page, code);
      await b.page.waitForFunction(
        () => (window as unknown as { __pente: Pente }).__pente.getNet()?.seat === 'black',
        undefined,
        { timeout: ROUND_TRIP_MS },
      );
      // Over the REAL relay, the two isolated contexts negotiated DISTINCT seats and converged on one
      // game identity — the whole model proven end-to-end on MQTT, not a mock.
      expect(await seatOf(a.page)).toBe('white');
      expect(await seatOf(b.page)).toBe('black');
      expect(await gameUuid(b.page)).toBe(await gameUuid(a.page));
      const oa = await owners(a.page);
      expect(oa?.white).not.toBeNull();
      expect(oa?.black).not.toBeNull();
      expect(oa?.white).not.toBe(oa?.black);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });
});
