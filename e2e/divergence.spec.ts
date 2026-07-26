import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { append, emptyLog, headHash, type EventLog } from '../src/core/eventLog.ts';

/**
 * Task V.4b e2e (epic **#47**, absorbs **#38**) — the DIVERGENCE PANEL and the RESOLUTION HANDSHAKE,
 * driven through the real app on two live clients.
 *
 * ## What this proves that no unit test can
 *
 * V.4a made the engine REFUSE to auto-adopt a divergence beyond the turn gate's one-move cap, and
 * recorded the ancestor + diff. It stopped there, which left two gaps this spec is the gate on:
 *
 *  1. **The peer that is BEHIND was never told.** Only the side that is ahead detects the gap; the
 *     side that is missing moves saw a perfectly ordinary board. Here BOTH pages must open the panel,
 *     at the SAME shared move, from ONE side's publish.
 *  2. **There was no way out.** Now there is: the two players agree over the SAME N.1 out-of-band
 *     handshake #12/#18 use, and BOTH logs converge to ONE `headHash` — asserted on
 *     `window.__pente.getHeadHash()` in both contexts (proof-by-state, never a log line;
 *     agent-principles #3), with the resolution driven through the panel's REAL buttons.
 *
 * ## Why the divergence has to be MANUFACTURED
 *
 * It cannot be played. The turn gate caps legitimate drift at exactly one move — if it is my turn the
 * opponent cannot move at all, and if it is theirs they move once and are then blocked on me — which
 * is precisely why anything longer goes to the players instead of being adopted. So two honest
 * clients on a cut link cannot produce this state, and a test that waited for one would wait forever.
 *
 * The spec therefore does what the threat model says a publicly-writable relay allows: it hands ONE
 * client a log it did not see published. The mock transport (test-owned, installed before boot) gains
 * two controls — `cut` (stop delivering this page's publishes) and `deliver` (feed this page's engine
 * one message directly) — and the injected log is a REAL, legally-playable continuation built with
 * the app's own hash chain, so the client adopts it through the ordinary one-move fast-forward. Two
 * such steps put that client two moves ahead of a peer that never heard either. Nothing is stubbed on
 * the app side: the reconciliation policy, the panel, the handshake and the apply are all the real
 * ones.
 *
 * Hermetic by construction (a BroadcastChannel relay between two pages of one context, as
 * `netWiring.spec.ts` uses) so the proof does not depend on the live broker being reachable.
 */

/** The `window.__pente` surface this spec drives. */
type Pente = {
  getState(): { pieces: Record<string, string>; turn: string } | null;
  getHeadHash(): string | null;
  getNet(): { phase: string; seat: string | null; code: string | null } | null;
  getNetGameUuid(): string | null;
  getDivergence(): {
    show: boolean;
    sharedPly: number;
    ui: string;
    mine: { ply: number; text: string }[];
    theirs: { ply: number; text: string }[];
    options: { choice: string; label: string; detail: string }[];
    incomingText: string | null;
    canAccept: boolean;
  };
  place(coords: [number, number, number]): unknown;
  dispatch(id: string): boolean | null;
  setPendingJoinCode(code: string): void;
  resync(): void;
};

/** The test-owned controls the mock transport exposes on `window` (never app code). */
type MockControls = {
  __penteMockCut(on: boolean): void;
  __penteMockDeliver(body: unknown): void;
};

const pente = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente);

const headOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getHeadHash());
const divergence = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getDivergence());
const net = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getNet());
const gameUuid = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getNetGameUuid());

/**
 * Install a BroadcastChannel-backed mock transport BEFORE the app boots (the same hermetic relay
 * `netWiring.spec.ts` uses), plus the two TEST-OWNED controls this spec needs:
 *
 *  - `__penteMockCut(on)` — while on, this page's publishes are not delivered to the peer. That is
 *    an ordinary outage, not a weakened proof: it is what makes the peer genuinely not know.
 *  - `__penteMockDeliver(body)` — feed this page's engine one inbound message directly, so a log can
 *    reach ONE client without passing the peer. The relay is publicly writable; this is that.
 */
async function installMock(page: Page, senderId: string): Promise<void> {
  await page.addInitScript((sid: string) => {
    window.localStorage.clear();
    let msgCb: (msg: unknown) => void = () => {};
    let cut = false;
    const w = window as unknown as Record<string, unknown>;
    w.__penteMockCut = (on: boolean) => {
      cut = on;
    };
    w.__penteMockDeliver = (body: unknown) => {
      msgCb(JSON.parse(JSON.stringify(body)));
    };
    w.__penteNetTransportFactory = () => {
      let channel: BroadcastChannel | null = null;
      let presenceCb: (peers: readonly string[]) => void = () => {};
      const present = new Set<string>([sid]);
      let lastBody: unknown = null;
      return {
        connect: (roomCode: string) => {
          channel = new BroadcastChannel(`pente-divergence-${roomCode}`);
          channel.onmessage = (ev: MessageEvent) => {
            const data = ev.data as { from: string; kind: string; body?: unknown };
            if (data.from === sid) return; // faithful relay: never echo to the sender
            if (data.kind === 'msg') {
              msgCb(data.body);
            } else if (data.kind === 'hello') {
              present.add(data.from);
              presenceCb([...present]);
              channel!.postMessage({ from: sid, kind: 'hello-ack' });
              if (lastBody !== null && !cut) {
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
          if (cut) return;
          channel?.postMessage({ from: sid, kind: 'msg', body: lastBody });
        },
        onMessage: (cb: (msg: unknown) => void) => {
          msgCb = cb;
        },
        onPeerLive: () => {},
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

/** Boot a page against the real app and wait until the net session is wired. */
async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return !!p && typeof p.getDivergence === 'function' && p.getNet !== undefined;
  });
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    return p.getNet() !== null;
  });
}

async function waitConnected(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getNet()?.phase === 'connected',
  );
}

/** Set the test-owned cut flag on a page. */
async function setCut(page: Page, on: boolean): Promise<void> {
  await page.evaluate((v: boolean) => {
    (window as unknown as MockControls).__penteMockCut(v);
  }, on);
}

/** Build the sync message for a log of `nodes` in game `uuid` — the app's own chain, in Node. */
function syncMessageFor(uuid: string, nodes: readonly string[]): Record<string, unknown> {
  let log: EventLog = emptyLog(uuid);
  for (const node of nodes) log = append(log, { type: 'place', node });
  return {
    version: 1,
    epoch: 0,
    uuid,
    headHash: headHash(log),
    log: log.entries.map((entry) => entry.event),
  };
}

test.describe('V.4b — a divergence is seen by BOTH players and resolved by agreement', () => {
  test('both panels open at the same shared move, and agreeing converges both logs', async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext();
    const host = await context.newPage();
    const joiner = await context.newPage();
    await installMock(host, 'div-host');
    await installMock(joiner, 'div-joiner');

    await ready(host);
    await host.evaluate(() => (window as unknown as { __pente: Pente }).__pente.dispatch('hostGame'));
    await waitConnected(host);
    const code = (await net(host))?.code;
    expect(code).not.toBeNull();
    expect((await net(host))?.seat).toBe('white');

    await ready(joiner);
    await joiner.evaluate((c: string) => {
      const p = (window as unknown as { __pente: Pente }).__pente;
      p.setPendingJoinCode(c);
      p.dispatch('joinGame');
    }, code!);
    await waitConnected(joiner);
    expect((await net(joiner))?.seat).toBe('black');

    // ── One shared move, so there is a real common history to diverge FROM. ──────────────────────
    await host.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([0, 0, 0]));
    await joiner.waitForFunction(() => {
      const s = (window as unknown as { __pente: Pente }).__pente.getState();
      return s?.pieces['0,0,0'] === 'white';
    });
    const uuid = await gameUuid(host);
    expect(uuid).toBe(await gameUuid(joiner));

    // ── Manufacture the gap (see the file header: it cannot be PLAYED). ──────────────────────────
    // Nothing either page publishes reaches the other from here on.
    await setCut(host, true);
    await setCut(joiner, true);

    // Hand the HOST black's reply, which it never saw published. This is the ordinary one-move
    // fast-forward — a legal continuation of the host's own history, and the entry was black's to
    // make — so the app adopts it exactly as it would a real move.
    await host.evaluate((msg) => {
      (window as unknown as MockControls).__penteMockDeliver(msg);
    }, syncMessageFor(uuid!, ['0,0,0', '1,1,1']));
    await host.waitForFunction(() => {
      const s = (window as unknown as { __pente: Pente }).__pente.getState();
      return s?.pieces['1,1,1'] === 'black';
    });
    // The host answers it. That publish goes nowhere, so the joiner is now TWO moves behind.
    await host.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([2, 2, 2]));

    // ── Restore the link and let one side speak. ─────────────────────────────────────────────────
    await setCut(host, false);
    await setCut(joiner, false);
    await host.evaluate(() => (window as unknown as { __pente: Pente }).__pente.resync());

    // BOTH clients open the panel — the joiner learns of it only because the detecting side ANSWERED.
    for (const page of [host, joiner]) {
      await page.waitForFunction(
        () => (window as unknown as { __pente: Pente }).__pente.getDivergence().show === true,
      );
      await expect(page.getByTestId('divergence-panel')).toBeVisible();
    }
    const hostView = await divergence(host);
    const joinerView = await divergence(joiner);
    // The SAME last-agreed move on both sides — the fact the whole resolution is anchored on.
    expect(hostView.sharedPly).toBe(1);
    expect(joinerView.sharedPly).toBe(1);
    await expect(host.getByTestId('divergence-panel')).toHaveAttribute('data-shared-ply', '1');
    await expect(joiner.getByTestId('divergence-panel')).toHaveAttribute('data-shared-ply', '1');
    // …and the two descriptions are MIRRORS: what only the host has is what the joiner is missing.
    expect(hostView.mine.map((m) => m.text)).toEqual(joinerView.theirs.map((m) => m.text));
    expect(hostView.mine.map((m) => m.text)).toEqual([
      'black plays 1,1,1',
      'white plays 2,2,2',
    ]);
    expect(joinerView.mine).toEqual([]);
    // Neither adopted anything on its own — that is the point of the refusal.
    expect(await headOf(host)).not.toBe(await headOf(joiner));

    await host.getByTestId('divergence-panel').screenshot({
      path: artifact(testInfo.outputDir, 'divergence-host-panel.png'),
    });

    // ── Resolve it through the REAL buttons. ─────────────────────────────────────────────────────
    // The joiner suggests taking the host's game; nothing has landed yet.
    const joinerHeadBefore = await headOf(joiner);
    await joiner.getByTestId('divergence-choose-take-theirs').click();
    await joiner.waitForFunction(
      () => (window as unknown as { __pente: Pente }).__pente.getDivergence().ui === 'waiting',
    );
    expect(await headOf(joiner)).toBe(joinerHeadBefore); // held out-of-band: nothing applied

    // The host sees it as an ask about ITS OWN game, and can answer it.
    await host.waitForFunction(
      () => (window as unknown as { __pente: Pente }).__pente.getDivergence().ui === 'incoming',
    );
    const incoming = await divergence(host);
    expect(incoming.canAccept).toBe(true);
    expect(incoming.incomingText).toContain('keep YOUR game');
    await host.getByTestId('divergence-panel').screenshot({
      path: artifact(testInfo.outputDir, 'divergence-host-incoming.png'),
    });
    await host.getByTestId('divergence-accept').click();

    // ── BOTH logs converge onto ONE history (proof-by-state). ────────────────────────────────────
    for (const page of [host, joiner]) {
      await page.waitForFunction(
        () => (window as unknown as { __pente: Pente }).__pente.getDivergence().show === false,
      );
    }
    const hostHead = await headOf(host);
    const joinerHead = await headOf(joiner);
    expect(joinerHead).toBe(hostHead);
    expect(joinerHead).not.toBe(joinerHeadBefore);
    // The joiner really replayed the history it agreed to — the moves are on its board.
    const joinerState = await pente(joiner).then(() => joiner.evaluate(() =>
      (window as unknown as { __pente: Pente }).__pente.getState(),
    ));
    expect(joinerState?.pieces['1,1,1']).toBe('black');
    expect(joinerState?.pieces['2,2,2']).toBe('white');
    // Both panels are gone, and the session is playable again on both sides.
    await expect(host.getByTestId('divergence-panel')).toBeHidden();
    await expect(joiner.getByTestId('divergence-panel')).toBeHidden();
    expect((await net(host))?.phase).toBe('connected');
    expect((await net(joiner))?.phase).toBe('connected');

    await context.close();
  });

  test('a DECLINE leaves both games untouched and both players free to suggest again', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const host = await context.newPage();
    const joiner = await context.newPage();
    await installMock(host, 'dec-host');
    await installMock(joiner, 'dec-joiner');

    await ready(host);
    await host.evaluate(() => (window as unknown as { __pente: Pente }).__pente.dispatch('hostGame'));
    await waitConnected(host);
    const code = (await net(host))?.code;
    await ready(joiner);
    await joiner.evaluate((c: string) => {
      const p = (window as unknown as { __pente: Pente }).__pente;
      p.setPendingJoinCode(c);
      p.dispatch('joinGame');
    }, code!);
    await waitConnected(joiner);

    await host.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([0, 0, 0]));
    await joiner.waitForFunction(() => {
      const s = (window as unknown as { __pente: Pente }).__pente.getState();
      return s?.pieces['0,0,0'] === 'white';
    });
    const uuid = await gameUuid(host);

    await setCut(host, true);
    await setCut(joiner, true);
    await host.evaluate((msg) => {
      (window as unknown as MockControls).__penteMockDeliver(msg);
    }, syncMessageFor(uuid!, ['0,0,0', '1,1,1']));
    await host.waitForFunction(() => {
      const s = (window as unknown as { __pente: Pente }).__pente.getState();
      return s?.pieces['1,1,1'] === 'black';
    });
    await host.evaluate(() => (window as unknown as { __pente: Pente }).__pente.place([2, 2, 2]));
    await setCut(host, false);
    await setCut(joiner, false);
    await host.evaluate(() => (window as unknown as { __pente: Pente }).__pente.resync());

    for (const page of [host, joiner]) {
      await page.waitForFunction(
        () => (window as unknown as { __pente: Pente }).__pente.getDivergence().show === true,
      );
    }
    const hostBefore = await headOf(host);
    const joinerBefore = await headOf(joiner);

    await host.getByTestId('divergence-choose-take-mine').click();
    await joiner.waitForFunction(
      () => (window as unknown as { __pente: Pente }).__pente.getDivergence().ui === 'incoming',
    );
    await joiner.getByTestId('divergence-decline').click();

    // Nothing landed on either side — the same guarantee #18 has.
    await host.waitForFunction(
      () => (window as unknown as { __pente: Pente }).__pente.getDivergence().ui === 'declined',
    );
    expect(await headOf(host)).toBe(hostBefore);
    expect(await headOf(joiner)).toBe(joinerBefore);
    // …and both cards still offer a way forward rather than dead-ending.
    expect((await divergence(host)).options.length).toBeGreaterThan(0);
    await expect(host.getByTestId('divergence-choose-take-theirs')).toBeVisible();
    await expect(joiner.getByTestId('divergence-panel')).toBeVisible();

    await context.close();
  });
});

/** Put a screenshot artifact under the spec's output dir (creating it if needed). */
function artifact(outputDir: string, name: string): string {
  const path = resolve(outputDir, name);
  mkdirSync(dirname(path), { recursive: true });
  return path;
}
