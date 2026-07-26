import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ACTIVE_GAME_KEY } from '../src/net/activeGame.ts';

/**
 * Task V.5 e2e (epic **#47**, design §6) — RELOAD → EMPTY SLATE, then a rejoin PROBE that OFFERS.
 *
 * A reload no longer restores anything. The only route straight back into a game that was live in a
 * room is the rejoin prompt, and what it offers depends on what a real look at that room finds. So this
 * spec drives TWO independent app instances in ISOLATED browser contexts over a Node-relayed transport
 * (the same harness shape `sessionModel.spec.ts` uses) and RELOADS one of them, asserting on
 * `window.__pente` real values — the board, the offer, the localStorage breadcrumb — never a log line
 * (agent-principles #3).
 *
 * The three §6 outcomes, one test each, all produced by the OTHER context actually being (or not being)
 * in the room:
 *
 *  1. the peer is there on the SAME game → "Rejoin DUDEEE as Black?", and confirming really does put B
 *     back on A's game, on the colour the seat map owns for it (DISPLAYED, never negotiated — §7);
 *  2. the peer LEFT → "no one is there anymore. Rejoin as Black anyway?";
 *  3. the peer is there on a DIFFERENT game (it re-hosted at the same code) → a warning that offers a
 *     NEW CODE and no rejoin at all (never hijack someone else's game);
 *  4. plus the lifecycle rule: DECLINING clears the breadcrumb, so a further reload asks nothing —
 *     asserted against the raw localStorage record, and the game is still in the archive.
 *
 * ## How the peer's game identity reaches the probe (no probe-specific protocol)
 *
 * The probe publishes NO admission message. It connects, and its presence announce is answered by the
 * resident republishing its state (design §4 resident-peer republish, V.3) — a log that carries the
 * game's uuid. The Node hub therefore models the broker's live-presence handshake (`__relayPeerLive`,
 * both directions on a join) exactly as `MockRelayHub` does; without it the resident would have no
 * signal to answer and this spec would be testing nothing.
 *
 * A page RELOAD kills the socket, which the real broker turns into an absence (Last-Will). The hub is
 * told the same (`hub.disconnect`) at the reload, because that absence is what makes the resident serve
 * the returning peer again rather than treating it as already-served.
 */

/** The two pinned identities, so the seat B is offered back is OURS by identity (design §2.3/§7). */
const PLAYER_A = 'player-a-rejoin';
const PLAYER_B = 'player-b-rejoin';
/** `appSession.PLAYER_ID_KEY`, as a literal exactly as the other net specs do (see their note). */
const PLAYER_ID_KEY = 'pente:playerId';
/**
 * The boot probe's listening window for these tests. Generous ON PURPOSE: every presence/publish hop
 * here crosses page → Node hub → page through `evaluate`, so the room's answer legitimately takes longer
 * than it does over a socket. It is a DEADLINE, not a gate — the answer must still arrive for the
 * same-game outcome to be derived, so widening it cannot turn a failure into a pass (#7).
 */
const PROBE_WINDOW_MS = 4_000;

/** The subset of `window.__pente` these scenarios read. */
type Pente = {
  getState(): { pieces: Record<string, 'white' | 'black'>; turn: string } | null;
  getHistory(): { maxPly: number } | null;
  getNet(): { phase: string; seat: 'white' | 'black' | null; code: string | null } | null;
  getNetGameUuid(): string | null;
  getHeadHash(): string | null;
  getArchive(): Promise<{ id: string; meta: { uuid: string; headHash: string } }[]>;
  getRejoinPrompt(): {
    show: boolean;
    outcome: string | null;
    action: string | null;
    code: string;
    colour: string | null;
    headline: string;
    detail: string;
    confirmLabel: string;
    declineLabel: string;
  };
  answerRejoin(confirmed: boolean): boolean;
  place(coords: [number, number, number]): unknown;
  dispatch(id: string): boolean | null;
  setPendingJoinCode(code: string): void;
  leaveNet(): void;
};

const pente = <T,>(page: Page, fn: (p: Pente) => T): Promise<T> =>
  page.evaluate((body: string): unknown => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    const revived = eval(`(${body})`) as (api: Pente) => unknown;
    return revived(p);
  }, fn.toString()) as Promise<T>;

/**
 * A faithful in-Node relay hub the injected transports rendezvous on by room code — the two-ISOLATED-
 * CONTEXT test double for the broker, with the LIVE-PRESENCE HANDSHAKE modelled: a publish fans out to
 * every OTHER peer in the room (never echoing the sender), presence is broadcast room-wide on every
 * join/leave, and a join makes the arriver and every resident see each other's fresh live presence —
 * which is the signal resident-peer republish (design §4) stands on.
 */
class NodeRelayHub {
  private readonly peers = new Map<string, { page: Page; room: string | null }>();

  register(peerId: string, page: Page): void {
    this.peers.set(peerId, { page, room: null });
  }

  /** `peerId` joins `room`: membership, then presence room-wide, then the two-way live-presence pings. */
  connect(peerId: string, room: string): void {
    const peer = this.peers.get(peerId);
    if (peer === undefined) return;
    const residents = [...this.peers.entries()]
      .filter(([id, p]) => id !== peerId && p.room === room)
      .map(([id]) => id);
    peer.room = room;
    void this.broadcastPresence(room);
    // The broker's announce/ack exchange (`mqttTransport` routePresence/ackHello): the arriver's live
    // announce is seen by every resident, and each resident's ack is seen by the arriver.
    for (const resident of residents) {
      void this.peerLive(resident, peerId);
      void this.peerLive(peerId, resident);
    }
  }

  publish(peerId: string, body: unknown): void {
    const sender = this.peers.get(peerId);
    if (sender === undefined || sender.room === null) return;
    const wire = JSON.parse(JSON.stringify(body)) as unknown;
    for (const [id, peer] of this.peers) {
      if (id === peerId || peer.room !== sender.room) continue;
      void peer.page
        .evaluate(
          (b) => (window as unknown as { __relayDeliver(x: unknown): void }).__relayDeliver(b),
          wire,
        )
        .catch(() => {});
    }
  }

  disconnect(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer === undefined || peer.room === null) return;
    const room = peer.room;
    peer.room = null;
    void this.broadcastPresence(room);
  }

  private async peerLive(toPeer: string, livePeer: string): Promise<void> {
    const target = this.peers.get(toPeer);
    if (target === undefined) return;
    await target.page
      .evaluate(
        (id) => (window as unknown as { __relayPeerLive(x: string): void }).__relayPeerLive(id),
        livePeer,
      )
      .catch(() => {});
  }

  private async broadcastPresence(room: string): Promise<void> {
    const present = [...this.peers.entries()].filter(([, p]) => p.room === room).map(([id]) => id);
    await Promise.all(
      [...this.peers.values()]
        .filter((p) => p.room === room)
        .map((p) =>
          p.page
            .evaluate(
              (peers) =>
                (
                  window as unknown as { __relayPresence(x: readonly string[]): void }
                ).__relayPresence(peers),
              present,
            )
            .catch(() => {}),
        ),
    );
  }
}

/**
 * Boot a FRESH ISOLATED context+page wired to `hub` under a FIXED `playerId` and a per-peer archive DB
 * name that SURVIVES a reload (so the returning peer still holds its game). localStorage is cleared only
 * on the FIRST navigation (a sentinel), because a reload must keep the breadcrumb + playerId under test.
 */
async function bootPeer(
  browser: Browser,
  hub: NodeRelayHub,
  playerId: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const dbName = `pente3d-e2e-${playerId}-${crypto.randomUUID()}`;

  await context.exposeBinding('__relayConnect', (_src, room: string) => hub.connect(playerId, room));
  await context.exposeBinding('__relayPublish', (_src, body: unknown) => hub.publish(playerId, body));
  await context.exposeBinding('__relayDisconnect', () => hub.disconnect(playerId));

  await page.addInitScript(
    ([pid, key, db, probeMs]) => {
      (window as unknown as { __penteDbName: string }).__penteDbName = db as string;
      if (window.localStorage.getItem('__e2e_booted') === null) {
        window.localStorage.clear();
        window.localStorage.setItem('__e2e_booted', '1');
      }
      window.localStorage.setItem(key as string, pid as string);
      (window as unknown as { __penteRejoinProbeMs: number }).__penteRejoinProbeMs =
        probeMs as number;

      interface Wiring {
        msgCb: (msg: unknown) => void;
        presenceCb: (peers: readonly string[]) => void;
        peerLiveCb: (peerId: string) => void;
      }
      // ONE wiring per live transport. The rejoin PROBE builds a transport of its own alongside any
      // session transport, and the latest registration wins — which is correct here: the probe is the
      // only live transport while the session is offline, exactly when the probe runs.
      const wiring: Wiring = { msgCb: () => {}, presenceCb: () => {}, peerLiveCb: () => {} };
      (window as unknown as { __relayDeliver(m: unknown): void }).__relayDeliver = (m) =>
        wiring.msgCb(m);
      (window as unknown as { __relayPresence(p: readonly string[]): void }).__relayPresence = (p) =>
        wiring.presenceCb(p);
      (window as unknown as { __relayPeerLive(id: string): void }).__relayPeerLive = (id) =>
        wiring.peerLiveCb(id);

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
          // The V.3 resident-peer republish trigger, modelled: the hub pings both sides on a join, so a
          // resident really does answer the probe's arrival with its state (which carries the game uuid).
          onPeerLive: (cb: (peerId: string) => void) => {
            wiring.peerLiveCb = cb;
          },
          disconnect: () => {
            void (window as unknown as { __relayDisconnect(): Promise<void> }).__relayDisconnect();
          },
        });
    },
    [playerId, PLAYER_ID_KEY, dbName, PROBE_WINDOW_MS] as const,
  );

  hub.register(playerId, page);
  await ready(page);
  return { context, page };
}

/** Navigate + wait until the inspect API and the (offline) net session readout exist. */
async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.getRejoinPrompt === 'function' &&
      typeof p.answerRejoin === 'function' &&
      typeof p.getNetGameUuid === 'function' &&
      p.getNet !== undefined &&
      (p.getNet as () => unknown)() !== null
    );
  });
}

const waitConnected = (page: Page): Promise<unknown> =>
  page.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getNet()?.phase === 'connected',
  );

/** The raw `activeNetworkedGame` record in the REAL localStorage (what a reload has to work from). */
const breadcrumb = (page: Page): Promise<{ code: string; gameUuid: string } | null> =>
  page.evaluate((key: string) => {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as { code: string; gameUuid: string });
  }, ACTIVE_GAME_KEY);

/** Wait until this page's archive holds the live net game at the live head (so a return can re-seed it). */
async function waitGameDurable(page: Page): Promise<void> {
  await page.waitForFunction(async () => {
    const p = (window as unknown as { __pente?: Pente }).__pente;
    if (!p) return false;
    const uuid = p.getNetGameUuid();
    const head = p.getHeadHash();
    if (uuid === null || head === null) return false;
    return (await p.getArchive()).some((g) => g.id === uuid && g.meta.headHash === head);
  });
}

/** Wait until the rejoin prompt is showing, and return it. */
async function waitPrompt(page: Page): Promise<ReturnType<Pente['getRejoinPrompt']>> {
  await page.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getRejoinPrompt().show,
    undefined,
    { timeout: 30_000 },
  );
  return pente(page, (p) => p.getRejoinPrompt());
}

/**
 * A REAL two-player game: A hosts, B joins (dealer's choice, so B adopts A's game and is seated black by
 * admission), A plays one move, and B durably archives the shared game. Returns the room + game identity
 * and B's context, ready to be reloaded.
 */
async function playedGame(
  browser: Browser,
  hub: NodeRelayHub,
): Promise<{
  a: { context: BrowserContext; page: Page };
  b: { context: BrowserContext; page: Page };
  code: string;
  uuid: string;
}> {
  const a = await bootPeer(browser, hub, PLAYER_A);
  const b = await bootPeer(browser, hub, PLAYER_B);

  await pente(a.page, (p) => p.dispatch('hostGame'));
  await waitConnected(a.page);
  const code = (await pente(a.page, (p) => p.getNet()!.code))!;
  expect(code).not.toBeNull();

  await b.page.evaluate((c: string) => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    p.setPendingJoinCode(c);
    p.dispatch('joinGame');
  }, code);
  await waitConnected(b.page);

  // A move by A, adopted by B — so the game B is offered back has real history, and B's seat is the one
  // admission gave it (black), not one this test asserted into being.
  await pente(a.page, (p) => p.place([0, 0, 0]));
  await b.page.waitForFunction(
    () =>
      Object.keys((window as unknown as { __pente: Pente }).__pente.getState()!.pieces).length === 1,
  );
  expect(await pente(b.page, (p) => p.getNet()!.seat)).toBe('black');
  const uuid = (await pente(b.page, (p) => p.getNetGameUuid()))!;
  expect(uuid).toBe(await pente(a.page, (p) => p.getNetGameUuid()));
  await waitGameDurable(b.page);
  expect(await breadcrumb(b.page)).toMatchObject({ code, gameUuid: uuid });

  return { a, b, code, uuid };
}

/**
 * RELOAD B the way a real tab reload happens: the socket dies (so the broker clears its presence — the
 * hub is told the same) and the page boots fresh. Asserts the EMPTY SLATE that boot must land on.
 */
async function reloadOntoEmptySlate(page: Page, hub: NodeRelayHub): Promise<void> {
  hub.disconnect(PLAYER_B);
  await page.reload();
  await ready(page);
  // Design §6, the user's words: "if you restart (i.e.: reload the tab), you should always get dropped
  // back to the main page with an empty slate/board". Nothing restored: no pieces, no history, no
  // session, no game.
  expect(Object.keys((await pente(page, (p) => p.getState()!)).pieces)).toEqual([]);
  expect((await pente(page, (p) => p.getHistory()!)).maxPly).toBe(0);
  expect(await pente(page, (p) => p.getNet()!.phase)).toBe('offline');
  expect(await pente(page, (p) => p.getNetGameUuid())).toBeNull();
}

/** Land the card's screenshot where the visual review looks. */
async function shoot(page: Page, name: string): Promise<void> {
  const shot = resolve(`e2e/artifacts/${name}.png`);
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
}

test('the peer is there on the SAME game: the reload OFFERS it back, and confirming rejoins', async ({
  browser,
}) => {
  test.slow();
  const hub = new NodeRelayHub();
  const { a, b, code, uuid } = await playedGame(browser, hub);

  await reloadOntoEmptySlate(b.page, hub);
  // The breadcrumb SURVIVED the reload — the durable half is what the probe works from.
  expect(await breadcrumb(b.page)).toMatchObject({ code, gameUuid: uuid });

  const view = await waitPrompt(b.page);
  // A's presence was answered with A's state, so the probe knows the room is on OUR game…
  expect(view.outcome).toBe('same-game');
  expect(view.action).toBe('rejoin');
  expect(view.code).toBe(code);
  // …and the colour is the one the GAME's seat map owns for this browser — displayed, not negotiated.
  expect(view.colour).toBe('black');
  expect(view.headline).toBe(`Rejoin ${code} as Black?`);
  // The DOM card says the same thing (the widget paints the model, it does not decide).
  const card = b.page.locator('[data-testid="rejoin-prompt"]');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-outcome', 'same-game');
  await expect(b.page.locator('[data-testid="rejoin-headline"]')).toHaveText(
    `Rejoin ${code} as Black?`,
  );
  await shoot(b.page, 'rejoin-prompt-same-game');

  // CONFIRM through the real button: B re-enters the room and is put back on THE SAME game, as black,
  // with A's move on the board. The prompt is gone (it asked once and was answered).
  await b.page.locator('[data-testid="rejoin-confirm"]').click();
  await waitConnected(b.page);
  expect(await pente(b.page, (p) => p.getNetGameUuid())).toBe(uuid);
  expect(await pente(b.page, (p) => p.getNet()!.seat)).toBe('black');
  expect(Object.keys((await pente(b.page, (p) => p.getState()!)).pieces)).toEqual(['0,0,0']);
  expect(await pente(b.page, (p) => p.getHeadHash())).toBe(
    await pente(a.page, (p) => p.getHeadHash()),
  );
  expect((await pente(b.page, (p) => p.getRejoinPrompt())).show).toBe(false);

  await a.context.close();
  await b.context.close();
});

test('the room is EMPTY: the offer says so and rejoins to WAIT', async ({ browser }) => {
  test.slow();
  const hub = new NodeRelayHub();
  const { a, b, code } = await playedGame(browser, hub);

  // A leaves the room for real (the session disconnects, so the hub drops its presence).
  await pente(a.page, (p) => p.leaveNet());
  await reloadOntoEmptySlate(b.page, hub);

  const view = await waitPrompt(b.page);
  expect(view.outcome).toBe('empty-room');
  expect(view.action).toBe('rejoin');
  expect(view.headline).toBe(`You were playing in ${code}, but no one is there anymore.`);
  expect(view.detail).toBe(
    'Rejoin as Black anyway? You will be waiting there when they come back.',
  );
  await expect(b.page.locator('[data-testid="rejoin-prompt"]')).toHaveAttribute(
    'data-outcome',
    'empty-room',
  );
  await shoot(b.page, 'rejoin-prompt-empty-room');

  await a.context.close();
  await b.context.close();
});

test('the peer re-hosted a DIFFERENT game at the same code: warn, offer a new code, never hijack', async ({
  browser,
}) => {
  test.slow();
  const hub = new NodeRelayHub();
  const { a, b, code, uuid } = await playedGame(browser, hub);

  // Both players leave, then A starts a BRAND-NEW game at the SAME code ("New Game" on a re-used code —
  // the #46 model): the room now holds a game that is not ours.
  //
  // B has to leave FIRST, and that ordering is the v3.1 seed matrix working as designed rather than a
  // test convenience: while B is still resident holding a played game, a `new` entry is REFUSED
  // (`seed-refused`, V.2 — "new sends/accepts EMPTY only"), so A could not re-host over it at all.
  await pente(b.page, (p) => p.leaveNet());
  await pente(a.page, (p) => p.leaveNet());
  await a.page.evaluate((c: string) => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    p.setPendingJoinCode(c);
    p.dispatch('hostGame');
  }, code);
  await waitConnected(a.page);
  const theirGame = await pente(a.page, (p) => p.getNetGameUuid());
  expect(theirGame).not.toBe(uuid); // re-using the code really did mint a different game

  await reloadOntoEmptySlate(b.page, hub);

  const view = await waitPrompt(b.page);
  // The probe heard A's game uuid and it is NOT ours, so no rejoin is offered at all.
  expect(view.outcome).toBe('other-game');
  expect(view.action).toBe('new-code');
  expect(view.headline).toBe(`There is a different game going in ${code}.`);
  expect(view.confirmLabel).toBe('Use a new code');
  // Nothing was hijacked: B is still offline, still on no game.
  expect(await pente(b.page, (p) => p.getNet()!.phase)).toBe('offline');
  expect(await pente(b.page, (p) => p.getNetGameUuid())).toBeNull();
  await shoot(b.page, 'rejoin-prompt-other-game');

  await a.context.close();
  await b.context.close();
});

test('DECLINING clears the breadcrumb, so the next reload asks nothing (the game stays archived)', async ({
  browser,
}) => {
  test.slow();
  const hub = new NodeRelayHub();
  const { a, b, code, uuid } = await playedGame(browser, hub);

  await pente(a.page, (p) => p.leaveNet());
  await reloadOntoEmptySlate(b.page, hub);
  await waitPrompt(b.page);

  // Decline through the real button.
  await b.page.locator('[data-testid="rejoin-decline"]').click();

  // The card is gone, and the BREADCRUMB is gone from the real localStorage — design §6 "declining
  // clears the breadcrumb". Asserted on storage + state, not on a log line.
  expect((await pente(b.page, (p) => p.getRejoinPrompt())).show).toBe(false);
  await expect(b.page.locator('[data-testid="rejoin-prompt"]')).toBeHidden();
  expect(await breadcrumb(b.page)).toBeNull();

  // …so a FURTHER reload lands on the empty slate and asks NOTHING. (Waiting a full probe window plus a
  // margin: if the prompt were going to appear, this is when it would.)
  await b.page.reload();
  await ready(b.page);
  await b.page.waitForTimeout(PROBE_WINDOW_MS + 1_000);
  expect((await pente(b.page, (p) => p.getRejoinPrompt())).show).toBe(false);
  expect(await breadcrumb(b.page)).toBeNull();

  // The game itself was NOT deleted — declining forgets the room, not the game: its uuid-keyed record is
  // still in the archive, which is the route back to it (the games list, #37).
  const archived = await pente(b.page, (p) => p.getArchive());
  expect(archived.some((g) => g.meta.uuid === uuid)).toBe(true);
  expect(code.length).toBeGreaterThan(0);

  await a.context.close();
  await b.context.close();
});
