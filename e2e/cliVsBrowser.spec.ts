import { test, expect, type Browser, type Page } from '@playwright/test';
import { RELAY, injectRelay, probeRelay, relaySkipReason } from './relayFixture';
import { startPeer, statusOf, stopAll, verb, waitFor, type Peer } from '../cli/scenarios/harness';

/**
 * CLI-vs-BROWSER over the real relay — the configuration the design asks for and nothing else ran.
 *
 * ## The gap this closes
 *
 * Design §8 (`planning/2026-07-24-net-model-v3.1-design.md`) specifies: *"The `cli/` net client is the
 * lever … Run CLI-vs-CLI **and CLI-vs-browser** over the real relay."* Stage V.7 landed CLI-vs-CLI
 * (the `cli/scenarios/` matrix) and browser-vs-browser (`sessionModelRelay.spec.ts` — which, it turned
 * out, was itself DARK: it resolved its broker from the committed-blank `relay.json` and skipped in
 * every checkout, so the browser-vs-browser half was claimed rather than observed until
 * `e2e/relayFixture.ts` landed), and never ran the two implementations against each other. Two CLI peers share ONE copy of `cli/session.ts`, so no
 * amount of CLI-vs-CLI can detect a divergence that exists only between the CLI and the browser app —
 * `src/main.ts`'s archive-before-net-start path, for instance, which the daemon's `enter` skips
 * entirely.
 *
 * It matters most for the claim the stage used to justify growing the CLI's protocol surface
 * (`rematch` / `leave` / `enter` + `maybeRematchReset`): *"a client that asked for a rematch and never
 * swapped would be a second client the browser could not actually play against."* That sentence is a
 * statement about CLI-vs-browser. This spec is where it gets tested.
 *
 * ## Shape
 *
 * The browser side is the real app in a real context, driven through `window.__pente`. The CLI side is
 * a real `pente play` daemon in its own process with its own state dir and playerId, started through
 * the SAME `cli/scenarios/harness` the CLI-vs-CLI matrix uses — not a bespoke second implementation,
 * so a change to the harness cannot leave this spec quietly testing something else.
 *
 * Both sides are pointed at ONE broker by `e2e/relayFixture.ts` — which asks `src/config/relayEnv.ts`,
 * the same node-side resolver the CLI, the `*.realrelay.test.ts` suites and every other live-relay
 * spec now use. The daemon inherits it through the environment; the browser gets the same record
 * injected as its `pente:config:relay` override before boot. The committed `relay.json` is blank, so
 * without that injection the page would have no broker to dial.
 *
 * ## Proof-by-state (agent-principles #3)
 *
 * Every assertion compares OBSERVED state on both clients: the browser's `getHeadHash()` /
 * `getNetGameUuid()` / `getState()` against the daemon's own `headHash` / `gameUuid` / `game.pieces`
 * snapshot. A move is proven by the OTHER client holding it, never by a log line.
 *
 * ## Honest scope
 *
 * With no broker egress the whole suite is a genuine Playwright SKIP (never a zero-assertion green).
 * What it proves is: admission across the two implementations, moves crossing in BOTH directions to
 * an identical `headHash`, and a full CLI leave → re-enter re-admission negotiated against a BROWSER
 * arbiter. Playing a game out to a win across the two implementations, and the rematch seat-swap that
 * follows it, is NOT attempted here — that handshake is exercised CLI-vs-CLI by
 * `npm run scenario:rematch`.
 */

/** A page↔broker↔daemon round trip on a live network, under parallel workers. A deadline, not a gate. */
const ROUND_TRIP_MS = 45_000;

/** The differentiated reason this suite did not run, or `null` when it did (`relaySkipReason`). */
let skipReason: string | null = null;

/** The subset of `window.__pente` this spec reads/drives. */
type Pente = {
  getNet(): { phase: string; seat: 'white' | 'black' | null; code: string | null } | null;
  getNetSeatOwners(): { white: string | null; black: string | null } | null;
  getNetGameUuid(): string | null;
  getHeadHash(): string | null;
  getState(): { pieces: Record<string, string>; turn: string; winner: string | null } | null;
  place(coords: [number, number, number]): unknown;
  dispatch(id: string): boolean | null;
};

const headHashOf = (page: Page): Promise<string | null> =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getHeadHash());
const gameUuidOf = (page: Page): Promise<string | null> =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getNetGameUuid());
const seatOf = (page: Page): Promise<string | null> =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getNet()?.seat ?? null);
const ownersOf = (page: Page): Promise<{ white: string | null; black: string | null } | null> =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getNetSeatOwners());
const piecesOf = (page: Page): Promise<Record<string, string>> =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getState()?.pieces ?? {});
const placeOn = (page: Page, coords: [number, number, number]): Promise<unknown> =>
  page.evaluate((c) => (window as unknown as { __pente: Pente }).__pente.place(c), coords);

/** Wait until the browser's own head hash equals `head` — the convergence assertion, both directions. */
async function browserReachesHead(page: Page, head: string | null, what: string): Promise<void> {
  await page
    .waitForFunction(
      (h: string | null) => (window as unknown as { __pente: Pente }).__pente.getHeadHash() === h,
      head,
      { timeout: ROUND_TRIP_MS },
    )
    .catch(async () => {
      throw new Error(
        `${what}: the browser never reached head ${String(head)} (it holds ${String(await headHashOf(page))}, ` +
          `board ${JSON.stringify(await piecesOf(page))})`,
      );
    });
}

/** Wait until the browser observes `key` occupied by `owner` — a move that genuinely crossed. */
async function browserSeesPiece(page: Page, key: string, owner: string): Promise<void> {
  await page
    .waitForFunction(
      ({ k, o }: { k: string; o: string }) =>
        (window as unknown as { __pente: Pente }).__pente.getState()?.pieces[k] === o,
      { k: key, o: owner },
      { timeout: ROUND_TRIP_MS },
    )
    .catch(async () => {
      throw new Error(
        `the CLI's ${owner} move at ${key} never reached the browser (its board is ` +
          `${JSON.stringify(await piecesOf(page))})`,
      );
    });
}

/**
 * Boot the app in a fresh context with the resolved relay injected as the config override the app
 * reads at boot. Without it the page resolves the committed-blank `relay.json` and never dials
 * anything — the browser half of the same darkness that kept the realrelay vitest tier from running.
 */
async function bootBrowser(browser: Browser, playerId: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript((pid: string) => {
    window.localStorage.clear();
    window.localStorage.setItem('pente:playerId', pid);
  }, playerId);
  // AFTER the clear (init scripts run in registration order), so the override survives it.
  await injectRelay(page);
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return !!p && typeof p.getHeadHash === 'function' && typeof p.getNetGameUuid === 'function';
  });
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: { getNet(): unknown } }).__pente;
    return !!p && p.getNet() !== null;
  });
  return page;
}

/** The browser hosts a room and returns the code it claimed. */
async function browserHosts(page: Page): Promise<string> {
  await page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.dispatch('hostGame'));
  await page.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getNet()?.phase === 'connected',
    undefined,
    { timeout: ROUND_TRIP_MS },
  );
  const code = await page.evaluate(
    () => (window as unknown as { __pente: Pente }).__pente.getNet()?.code ?? null,
  );
  expect(code, 'hosting must claim a room code').not.toBeNull();
  return code!;
}

test.beforeAll(async () => {
  skipReason = relaySkipReason(RELAY, await probeRelay());
  if (skipReason !== null) {
    console.warn(
      `[cliVsBrowser.spec] SKIPPING: ${skipReason}\n` +
        '  This suite is the only place the CLI and the browser client play each other; without a ' +
        'broker it proves nothing, and says so rather than reporting green.',
    );
  }
});

/** Stop every daemon this file started (and remove its state dir), even if an assertion threw. */
test.afterEach(async () => {
  await stopAll();
});

test.describe('CLI vs BROWSER over the real relay (design §8: two implementations, one game)', () => {
  // Two heavyweight clients (a full WebGL app + a spawned node daemon) negotiating over a live
  // broker. `test.slow()` triples the deadline; it changes no assertion.
  test.slow();

  test('the CLI joins a BROWSER-hosted room, and moves cross in BOTH directions to one headHash', async ({
    browser,
  }) => {
    test.skip(skipReason !== null, skipReason ?? '');
    const page = await bootBrowser(browser, `cvb-browser-${Date.now()}`);
    const code = await browserHosts(page);
    expect(await seatOf(page)).toBe('white');

    // A REAL `pente play` daemon walks into the browser's room — started through the same harness
    // the CLI-vs-CLI matrix uses, so this is the actual second client, not a stand-in.
    const cli: Peer = await startPeer({ name: 'cli', code, host: false });
    const joined = await statusOf(cli);
    expect(joined.seat, 'the browser arbiter must admit the CLI onto the free seat').toBe('black');

    // Both implementations agree on ONE game identity, and on WHO owns each seat.
    expect(joined.gameUuid).toBe(await gameUuidOf(page));
    const browserOwners = await ownersOf(page);
    expect(joined.seatOwners).toEqual(browserOwners);
    expect(browserOwners?.white).not.toBe(browserOwners?.black);

    // BROWSER → CLI. The proof is the daemon's own board holding the stone.
    await placeOn(page, [0, 0, 0]);
    const cliSaw = await waitFor(
      cli,
      (s) => s.game?.pieces['0,0,0'] === 'white',
      "the CLI to receive the browser's move",
      ROUND_TRIP_MS,
    );
    expect(cliSaw.game?.pieces['0,0,0']).toBe('white');

    // CLI → BROWSER. The proof is the page's own state holding the stone.
    const afterCliMove = await verb(cli, ['move', '2,2,2']);
    expect(afterCliMove.game?.pieces['2,2,2']).toBe('black');
    await browserSeesPiece(page, '2,2,2', 'black');

    // CONVERGED: identical whole-history fingerprints across the two implementations. `headHash`
    // folds identity + every event, so equality here is the real claim; the board comparison after
    // it is what makes a failure readable.
    const cliHead = (await statusOf(cli)).headHash;
    expect(cliHead).not.toBeNull();
    await browserReachesHead(page, cliHead, 'after a move from each side');
    expect(await headHashOf(page)).toBe(cliHead);
    expect(await piecesOf(page)).toEqual((await statusOf(cli)).game?.pieces);
  });

  test('the CLI LEAVES and RE-ENTERS: re-admission negotiated against a BROWSER arbiter', async ({
    browser,
  }) => {
    test.skip(skipReason !== null, skipReason ?? '');
    const page = await bootBrowser(browser, `cvb-browser2-${Date.now()}`);
    const code = await browserHosts(page);
    const cli: Peer = await startPeer({ name: 'cli2', code, host: false });
    expect((await statusOf(cli)).seat).toBe('black');

    // Play one move each so the room holds a real history to come back to.
    await placeOn(page, [0, 0, 0]);
    await waitFor(cli, (s) => s.game?.pieces['0,0,0'] === 'white', 'the CLI to see the opening', ROUND_TRIP_MS);
    await verb(cli, ['move', '2,2,2']);
    const beforeLeave = await statusOf(cli);
    await browserReachesHead(page, beforeLeave.headHash, 'before the CLI leaves');

    // A real DEPARTURE (transport down, seat + engine dropped) — not the `drop` outage.
    const left = await verb(cli, ['leave']);
    expect(left.phase).toBe('offline');

    // …and back in on the dealer's-choice seed, the one a returning peer re-seeds from its
    // breadcrumb on. The arbiter answering the hello is the BROWSER app — the half of the admission
    // path no CLI-vs-CLI scenario can exercise.
    // Spelled as the FLAG. The positional form was inert — the CLI collected it and never read it —
    // so this line matched its own description only by the coincidence that `defer` is also the
    // default; `['enter', 'new']` would have silently tested `defer` and passed green. The CLI now
    // refuses an unexpected positional outright (`cli/args.ts`), which is why this spelling changed.
    const back = await verb(cli, ['enter', '--seed', 'defer'], 90_000);
    expect(back.phase).toBe('connected');
    expect(back.seat, 'a returning peer is re-admitted by IDENTITY onto its own seat').toBe('black');
    expect(back.gameUuid, 'it must come back to the SAME game, not a fresh one').toBe(beforeLeave.gameUuid);
    expect(back.headHash).toBe(beforeLeave.headHash);
    expect(await headHashOf(page)).toBe(back.headHash);

    // And it is genuinely playable again: the browser moves, the returned CLI answers, both converge.
    await placeOn(page, [1, 0, 0]);
    await waitFor(cli, (s) => s.game?.pieces['1,0,0'] === 'white', 'the returned CLI to see a new move', ROUND_TRIP_MS);
    const afterReturn = await verb(cli, ['move', '3,3,3']);
    expect(afterReturn.game?.pieces['3,3,3']).toBe('black');
    await browserReachesHead(page, afterReturn.headHash, 'after the CLI returned and moved');
  });
});
