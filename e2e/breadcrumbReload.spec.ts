import { test, expect, type Page } from '@playwright/test';
import { ACTIVE_GAME_KEY } from '../src/net/activeGame.ts';

/**
 * THE RELOAD HALF OF THE BREADCRUMB (V.1, epic #47, design §2 "Dual-tracked: localStorage for reload
 * recovery, a JS var for the live session") — proven across a REAL page reload against the REAL
 * `window.localStorage`.
 *
 * Why this spec exists: every other proof of the breadcrumb runs against an INJECTED in-memory
 * `Storage` (the unit suites) or leaves + re-enters on the SAME page (`sessionModel.spec.ts` scenario
 * 4), where `resumableBreadcrumbUuid` is satisfied by the JS-var half (`this.activeGame ?? …`) and
 * `readActiveGame` is never reached. `createAppNetSession` passes NO `storage`, so the whole reload path
 * hangs on `resolveStorage(undefined) → globalThis.localStorage` — a resolution nothing exercised in a
 * browser. A reload is the one event that kills the JS var and leaves ONLY the durable half, so it is
 * the only way to observe that half working (or not).
 *
 * Both directions are asserted, so the mechanism is shown to be LOAD-BEARING rather than incidental:
 *
 *   1. host a game + move, RELOAD (empty slate, JS var gone), re-enter the same code → the SAME game
 *      comes back (uuid + headHash + the piece on the board), seated on the colour we owned;
 *   2. the same flow with ONLY the `activeNetworkedGame` key removed from localStorage after the reload
 *      → re-entering the same code brings a DIFFERENT, EMPTY game. Nothing else changes, so this pins
 *      the durable breadcrumb as the thing that carried the game across the reload.
 *
 * Assertions are on observable state (`getNetGameUuid`, `getHeadHash`, `getState`, and the raw
 * localStorage record) — never a log line (agent-principles #3). The storage KEYS come from the modules
 * under test, so nothing is hardcoded (#8).
 */

type Pente = {
  getState(): { pieces: Record<string, 'white' | 'black'>; turn: string } | null;
  getNet(): { phase: string; seat: 'white' | 'black' | null; code: string | null } | null;
  getNetGameUuid(): string | null;
  getHeadHash(): string | null;
  getArchive(): Promise<{ id: string; meta: { headHash: string; startedAt: number } }[]>;
  place(coords: [number, number, number]): unknown;
  dispatch(id: string): boolean | null;
  setPendingJoinCode(code: string): void;
};

/** This browser's pinned identity, so the seat we reclaim after the reload is OURS by identity. */
const PLAYER_ID = 'player-reload';
/**
 * `appSession.PLAYER_ID_KEY`, written as a literal exactly as `sessionModel.spec.ts` does: importing
 * `appSession.ts` here would pull `config/config.ts`'s JSON imports through Playwright's ESM loader,
 * which rejects them without an import attribute. `ACTIVE_GAME_KEY` — the key this spec is ABOUT — is
 * imported from its module, so the value under test is never hardcoded.
 */
const PLAYER_ID_KEY = 'pente:playerId';

/**
 * Boot config installed BEFORE the app loads: an isolated archive DB (stable across the reload so the
 * reload re-opens the SAME store), a pinned `playerId`, and a LONE-PEER transport — `connect` resolves
 * and reports a presence set containing only us, so the session settles into establishing alone. The
 * localStorage clear happens only on the FIRST navigation (sentinel), because clearing it on the reload
 * would wipe the very breadcrumb + playerId under test.
 */
async function isolate(page: Page): Promise<void> {
  const dbName = `pente3d-e2e-${crypto.randomUUID()}`;
  await page.addInitScript(
    ([name, playerKey, playerId]) => {
      (window as unknown as { __penteDbName: string }).__penteDbName = name;
      if (window.localStorage.getItem('__e2e_booted') === null) {
        window.localStorage.clear();
        window.localStorage.setItem('__e2e_booted', '1');
      }
      window.localStorage.setItem(playerKey, playerId);
      (window as unknown as { __penteNetTransportFactory: () => unknown }).__penteNetTransportFactory =
        () => {
          let presenceCb: (peers: readonly string[]) => void = () => {};
          return {
            connect: () => {
              presenceCb([playerId]);
              return Promise.resolve();
            },
            publish: () => {},
            onMessage: () => {},
            onPresence: (cb: (peers: readonly string[]) => void) => {
              presenceCb = cb;
            },
            disconnect: () => {},
          };
        };
    },
    [dbName, PLAYER_ID_KEY, PLAYER_ID] as const,
  );
}

async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.getNet === 'function' &&
      typeof p.getNetGameUuid === 'function' &&
      typeof p.getArchive === 'function' &&
      typeof p.place === 'function'
    );
  });
  // The session is wired asynchronously (it opens IndexedDB); wait for its offline readout.
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: { getNet(): unknown } }).__pente;
    return !!p && p.getNet() !== null;
  });
}

const get = <T,>(page: Page, fn: (p: Pente) => T): Promise<T> =>
  page.evaluate((body: string): unknown => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    const revived = eval(`(${body})`) as (api: Pente) => unknown;
    return revived(p);
  }, fn.toString()) as Promise<T>;

async function waitConnected(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getNet()?.phase === 'connected',
  );
}

/** Wait until the LIVE (networked) game is durably archived under its own uuid — the re-seed source. */
async function waitPersisted(page: Page): Promise<void> {
  await page.waitForFunction(async () => {
    const p = (window as unknown as { __pente?: Pente }).__pente;
    if (!p) return false;
    const head = p.getHeadHash();
    const uuid = p.getNetGameUuid();
    if (head === null || uuid === null) return false;
    return (await p.getArchive()).some((g) => g.id === uuid && g.meta.headHash === head);
  });
}

/** The raw `activeNetworkedGame` record in the REAL localStorage (what a reload has to work from). */
const breadcrumb = (page: Page): Promise<{ code: string; gameUuid: string } | null> =>
  page.evaluate((key: string) => {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as { code: string; gameUuid: string });
  }, ACTIVE_GAME_KEY);

/** Host a game, play one move, and wait until it is durable. Returns the room + game identity. */
async function hostAndMove(page: Page): Promise<{ code: string; uuid: string; head: string }> {
  await get(page, (p) => p.dispatch('hostGame'));
  await waitConnected(page);
  await get(page, (p) => p.place([0, 0, 0]));
  await page.waitForFunction(
    () => Object.keys((window as unknown as { __pente: Pente }).__pente.getState()!.pieces).length === 1,
  );
  await waitPersisted(page);
  const code = (await get(page, (p) => p.getNet()!.code))!;
  const uuid = (await get(page, (p) => p.getNetGameUuid()))!;
  const head = (await get(page, (p) => p.getHeadHash()))!;
  expect(code).not.toBeNull();
  expect(uuid).not.toBeNull();
  return { code, uuid, head };
}

/** The `startedAt` the archive currently holds for the game record keyed by `uuid`. */
async function archivedStartedAt(page: Page, uuid: string): Promise<number | undefined> {
  const games = await page.evaluate(() =>
    (window as unknown as { __pente: Pente }).__pente.getArchive(),
  );
  return games.find((g) => g.id === uuid)?.meta.startedAt;
}

/** Re-enter `code` with the app's join (a `defer` proposal — "dealer's choice", the reconnect path). */
async function reenter(page: Page, code: string): Promise<void> {
  await page.evaluate((c: string) => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    p.setPendingJoinCode(c);
    p.dispatch('joinGame');
  }, code);
  await waitConnected(page);
}

test('after a RELOAD the localStorage breadcrumb brings the game back (real Storage, real reload)', async ({
  page,
}) => {
  await isolate(page);
  await ready(page);
  const { code, uuid, head } = await hostAndMove(page);
  const began = await archivedStartedAt(page, uuid);
  expect(began, 'the live net game must be archived under its own uuid').not.toBeUndefined();

  // The durable half really is in the REAL localStorage — written through
  // `resolveStorage(undefined) → globalThis.localStorage`, since `createAppNetSession` injects none.
  expect(await breadcrumb(page)).toEqual({ code, gameUuid: uuid, updatedAt: expect.any(Number) });

  await page.reload();
  await ready(page);

  // A reload lands on an EMPTY SLATE (design §6): no live session, no net game — so the JS-var half of
  // the breadcrumb is definitively gone and only the durable record can carry the game.
  expect(await get(page, (p) => p.getNet()!.phase)).toBe('offline');
  expect(await get(page, (p) => p.getNetGameUuid())).toBeNull();
  expect(await breadcrumb(page)).toMatchObject({ code, gameUuid: uuid });

  // Re-enter the SAME room: the breadcrumb names the game, the archive holds it by uuid, and the two
  // together restore it — same identity, same whole history, the piece back on the board, and the seat
  // we owned reclaimed by identity.
  await reenter(page, code);
  expect(await get(page, (p) => p.getNetGameUuid())).toBe(uuid);
  expect(await get(page, (p) => p.getHeadHash())).toBe(head);
  const state = await get(page, (p) => p.getState()!);
  expect(Object.keys(state.pieces)).toEqual(['0,0,0']);
  expect(state.pieces['0,0,0']).toBe('white');
  expect(await get(page, (p) => p.getNet()!.seat)).toBe('white');

  // …AND the returned-to game is still dated when it BEGAN, seconds-ago-before-the-reload, not now.
  // Both writers of this one uuid-keyed record are exercised here — `NetSession.persistGame` and the
  // app's autosave (`main.ts` `autosaveMeta`, which reads the session's `gameStartedAt()`) — and each
  // has its own way of getting this wrong: the session re-minting a stamp for a game it had not
  // persisted in THIS page's lifetime, or the app falling back to its own `Date.now()` mint because it
  // never asked the session. Either shows up as a date from AFTER the reload, which is why this holds
  // deterministically rather than by a sub-millisecond coincidence.
  await waitPersisted(page);
  expect(await archivedStartedAt(page, uuid)).toBe(began);
  expect(began!).toBeLessThan(Date.now());
});

test('with ONLY that localStorage record removed, the same reload+re-enter brings a DIFFERENT empty game', async ({
  page,
}) => {
  await isolate(page);
  await ready(page);
  const { code, uuid } = await hostAndMove(page);

  await page.reload();
  await ready(page);

  // The ONE change from the test above: drop the durable breadcrumb (the archive still holds the game,
  // keyed by its uuid, and the room code is unchanged). If anything else were carrying the game across
  // the reload, this would still resume it.
  await page.evaluate((key: string) => window.localStorage.removeItem(key), ACTIVE_GAME_KEY);
  expect(await breadcrumb(page)).toBeNull();

  await reenter(page, code);

  // A fresh, empty game with a NEW identity: re-using the code resurrects nothing (#43), and the game
  // that was only reachable through the breadcrumb is no longer offered by it.
  expect(await get(page, (p) => p.getNetGameUuid())).not.toBe(uuid);
  expect(await get(page, (p) => p.getNetGameUuid())).not.toBeNull();
  expect(Object.keys((await get(page, (p) => p.getState()!)).pieces)).toEqual([]);
});
