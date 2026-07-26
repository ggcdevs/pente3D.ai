import { test, expect, type Page } from '@playwright/test';

/**
 * Task V.5 e2e (epic **#47**, design §2/§7) — ONE WRITER PER RECORD, INCLUDING AFTER THE ROOM.
 *
 * A networked game's record belongs to `NetSession.persistGame`: it is the only writer that establishes
 * the identity-owned seat map (design §2.3), which is the value the empty-room reclaim (§6.4) and the
 * rejoin prompt's colour are derived from. The app's autosave writes the LOCAL board.
 *
 * Those two are normally different games — except when a room is entered on the **"Current local board"**
 * seed from a PRISTINE board: `startNetGame` only resets a board that has been PLAYED, so scene and
 * session then share ONE game uuid. Nothing about that is visible while the session is live; it bites
 * the moment the session goes OFFLINE, because a guard that asks "is the session on this game right
 * now?" answers `null` from then on. This spec drives exactly that sequence against the real app —
 * enter on `current`, play, LEAVE, then keep playing — and asserts on the stored record: the seat map
 * and the networked history are still there, byte for byte, and the player's own board is a NEW record
 * that still saves.
 *
 * Every assertion is on real state (`window.__pente` + the stored record), never a log line
 * (agent-principles #3). Written RED against the pre-fix behaviour: with the session-liveness guard the
 * post-leave board overwrites the networked record with `players: {white:'You', black:'You'}`, no
 * `seats`, and the shorter local log.
 */

const PLAYER_ID = 'player-leave-owner';
/** `appSession.PLAYER_ID_KEY`, as a literal exactly as the other net specs do (see their note). */
const PLAYER_ID_KEY = 'pente:playerId';
const ROOM = 'RMLEAV';

interface ArchiveListing {
  id: string;
  events: number;
  meta: {
    players: Record<string, string>;
    result: string;
    headHash: string;
    uuid: string;
    seats?: { white: string | null; black: string | null };
  };
}
type Pente = {
  getState(): { pieces: Record<string, 'white' | 'black'> } | null;
  getNet(): { phase: string; seat: string | null; code: string | null } | null;
  getNetGameUuid(): string | null;
  getNetSeatOwners(): { white: string | null; black: string | null } | null;
  getHeadHash(): string | null;
  getArchive(): Promise<ArchiveListing[]>;
  place(coords: [number, number, number]): unknown;
  leaveNet(): void;
};

const pente = <T,>(page: Page, fn: (p: Pente) => T): Promise<T> =>
  page.evaluate((body: string): unknown => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    const revived = eval(`(${body})`) as (api: Pente) => unknown;
    return revived(p);
  }, fn.toString()) as Promise<T>;

const archive = (page: Page): Promise<ArchiveListing[]> =>
  page.evaluate(() => (window as unknown as { __pente: Pente }).__pente.getArchive());

/**
 * Boot the app with its OWN archive DB, a pinned playerId (so the seat map's owner is a value this spec
 * can name), and a LONE-PEER transport double: the room connects, presence stays empty, and nothing is
 * relayed — which is all this scenario needs, because the writer under test is THIS client.
 */
async function boot(page: Page): Promise<void> {
  const dbName = `pente3d-e2e-${crypto.randomUUID()}`;
  await page.addInitScript(
    ([db, key, pid]) => {
      (window as unknown as { __penteDbName: string }).__penteDbName = db as string;
      window.localStorage.clear();
      window.localStorage.setItem(key as string, pid as string);
      (
        window as unknown as { __penteNetTransportFactory: () => unknown }
      ).__penteNetTransportFactory = () => {
        let presenceCb: (peers: readonly string[]) => void = () => {};
        return {
          connect: () => {
            presenceCb([]);
            return Promise.resolve();
          },
          publish: () => {},
          onMessage: () => {},
          onPeerLive: () => {},
          onPresence: (cb: (peers: readonly string[]) => void) => {
            presenceCb = cb;
          },
          disconnect: () => {},
        };
      };
    },
    [dbName, PLAYER_ID_KEY, PLAYER_ID] as const,
  );
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return !!p && typeof p.getNetGameUuid === 'function' && (p.getNet as () => unknown)() !== null;
  });
  // The pristine board's record exists (boot autosave) — it is what the `current` seed loads by uuid.
  await page.waitForFunction(async () => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    return (await p.getArchive()).length >= 1;
  });
}

/** Enter `ROOM` through the REAL panel on the "Current local board" seed (design §3, the S.6 path). */
async function enterOnCurrentBoard(page: Page): Promise<void> {
  const menu = page.locator('[data-widget-id="menuButton"]');
  await menu.locator('[data-testid="menu-button"]').click();
  await menu.locator('[data-testid="menu-entry-network"]').click();
  const panel = page.locator('[data-testid="netpanel-modal"]');
  await expect(panel).toHaveClass(/pente-netpanel-modal--open/);
  await panel.locator('[data-testid="netpanel-seed-current"]').click();
  await expect(panel.locator('[data-testid="netpanel-seed-current"]')).toHaveAttribute(
    'data-selected',
    'true',
  );
  await panel.locator('[data-testid="netpanel-code-input"]').fill(ROOM);
  await panel.locator('[data-testid="netpanel-enter"]').click();
  await page.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getNet()?.phase === 'connected',
  );
}

test('LEAVING a room entered on the current board never rewrites that game from the local board', async ({
  page,
}) => {
  await boot(page);
  const board = (await archive(page))[0]!;

  await enterOnCurrentBoard(page);
  // The room really is running the board we were on — this is the shared-uuid case the guard exists for.
  expect(await pente(page, (p) => p.getNetGameUuid())).toBe(board.meta.uuid);
  expect(await pente(page, (p) => p.getNetSeatOwners())).toEqual({
    white: PLAYER_ID,
    black: null,
  });

  // A networked move, written to the game's record by the SESSION with its seat map.
  await pente(page, (p) => p.place([0, 0, 0]));
  await page.waitForFunction(
    async (uuid: string) => {
      const p = (window as unknown as { __pente: Pente }).__pente;
      const rec = (await p.getArchive()).find((g) => g.id === uuid);
      return rec !== undefined && rec.events === 1 && rec.meta.seats !== undefined;
    },
    board.meta.uuid,
  );
  const before = (await archive(page)).find((g) => g.id === board.meta.uuid)!;
  expect(before.meta.seats).toEqual({ white: PLAYER_ID, black: null });
  expect(before.meta.players).toEqual({ white: PLAYER_ID });

  // LEAVE the room. The session goes offline — and the game it was playing is still ITS record.
  await pente(page, (p) => p.leaveNet());
  await page.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getNet()?.phase === 'offline',
  );
  expect(await pente(page, (p) => p.getNetGameUuid())).toBeNull();

  // Keep playing locally — the change that used to rewrite the networked record from the stale board.
  await pente(page, (p) => p.place([2, 2, 2]));
  await page.waitForFunction(async () => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    return (await p.getArchive()).some((g) => g.meta.players.white === 'You' && g.events === 1);
  });
  await page.waitForTimeout(300); // let any further (erroneous) writes land before asserting

  const after = (await archive(page)).find((g) => g.id === board.meta.uuid)!;
  // THE NETWORKED RECORD IS UNTOUCHED: same head, same history, and — the value #31/#40 depend on —
  // the identity-owned seat map is still there, with the real owner, not `You`.
  expect(after.meta.headHash).toBe(before.meta.headHash);
  expect(after.events).toBe(1);
  expect(after.meta.seats).toEqual({ white: PLAYER_ID, black: null });
  expect(after.meta.players).toEqual({ white: PLAYER_ID });

  // …and the player is not left playing on a board nothing saves: the local move landed in its OWN
  // record, a different game entirely.
  const local = (await archive(page)).filter((g) => g.id !== board.meta.uuid);
  expect(local).toHaveLength(1);
  expect(local[0]!.meta.players).toEqual({ white: 'You', black: 'You' });
  expect(local[0]!.events).toBe(1);
  expect(local[0]!.meta.headHash).toBe(await pente(page, (p) => p.getHeadHash()));
  expect(Object.keys((await pente(page, (p) => p.getState()!)).pieces)).toEqual(['2,2,2']);
});
