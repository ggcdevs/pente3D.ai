import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_MENU_ENTRIES } from '../src/ui/widgets/menuModel.ts';
import { RESUME_REFUSAL_TEXT } from '../src/ui/widgets/archiveModel.ts';

/**
 * Task V.6 review follow-ups (epic **#47**, ticket **#37**) — the two NETWORKED facts the games-list
 * spec could not reach, because both need a room to have existed:
 *
 *   1. **`getGameUuid` names the game ON SCREEN.** While a session is running a game the scene renders
 *      THAT game (`render/scene.ts` `getState`), not its own local board, and `getHeadHash` already
 *      resolves the session's head first. This spec enters a room on the `new` seed — which mints a
 *      FRESH game, so the session's game and the scene-local board are genuinely different uuids — and
 *      asserts the inspect seam reports the session's game, the one the pieces on screen belong to.
 *      (A seam reporting the local board would name a game nobody is looking at, and would disagree
 *      with the head hash reported for the same moment.)
 *   1b. **A REFUSED resume SAYS SO.** Both refusals a live room causes are asserted on what the player
 *      can SEE — the list stays open with the model's reason on it — not merely on the board failing to
 *      change. `canResume` comes from the stored result alone, so every row in the list is clickable
 *      while a room runs: the game the room is playing (`session-live`) and, because the scene renders
 *      the SESSION's game, every OTHER game too (`session-active`). Both used to be silent no-ops.
 *   2. **RESUMING a game a session ran keeps saving it.** A game played in a room belongs to that
 *      session's record while the session lives (`sessionOwnedGames`, design §2/§7). After leaving, the
 *      games list is the only route back to it (§10) — and if resuming it left the record owned, every
 *      further move would return early from `autosaveTick` with no log at all and be lost on reload.
 *      Resume RE-ADOPTS the record: the moves land, and the identity-owned seat map + the date the game
 *      began survive the app becoming its writer again.
 *
 * Both assertions are on real state (`window.__pente` + the stored record), never a log line
 * (agent-principles #3). The transport is a LONE-PEER double (the technique `leaveRoomOwnership.spec.ts`
 * documents): the room connects, presence stays empty, nothing is relayed — all this needs, since the
 * writer and the renderer under test are THIS client. Everything above the transport is the real app.
 */

const PLAYER_ID = 'player-resume-owner';
/** `appSession.PLAYER_ID_KEY`, as a literal exactly as the other net specs do (see their note). */
const PLAYER_ID_KEY = 'pente:playerId';
const ROOM = 'RMRESU';
const LOAD_COMMAND = DEFAULT_MENU_ENTRIES.find((e) => e.id === 'load')!.commandId;

interface ArchiveListing {
  id: string;
  events: number;
  meta: {
    players: Record<string, string>;
    result: string;
    startedAt: number;
    headHash: string;
    uuid: string;
    seats?: { white: string | null; black: string | null };
  };
}
type Pente = {
  getState(): { pieces: Record<string, 'white' | 'black'>; winner: string | null } | null;
  getNet(): { phase: string; seat: string | null; code: string | null } | null;
  getNetGameUuid(): string | null;
  getGameUuid(): string | null;
  getHeadHash(): string | null;
  getArchive(): Promise<ArchiveListing[]>;
  dispatch(id: string): boolean | null;
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

/** Boot with a per-test archive DB, a pinned playerId, and the lone-peer transport double. */
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
    return (
      !!p &&
      typeof p.getNetGameUuid === 'function' &&
      typeof p.getGameUuid === 'function' &&
      (p.getNet as () => unknown)() !== null &&
      !!document.querySelector('[data-widget-id="archiveBrowser"]')
    );
  });
  await expect.poll(async () => (await archive(page)).length).toBeGreaterThanOrEqual(1);
}

/**
 * Enter `ROOM` through the REAL panel on the `new` seed — a FRESH game, so the session's game is NOT
 * the scene's local board (which is what makes the identity question observable).
 */
async function enterOnNewGame(page: Page): Promise<void> {
  const menu = page.locator('[data-widget-id="menuButton"]');
  await menu.locator('[data-testid="menu-button"]').click();
  await menu.locator('[data-testid="menu-entry-network"]').click();
  const panel = page.locator('[data-testid="netpanel-modal"]');
  await expect(panel).toHaveClass(/pente-netpanel-modal--open/);
  await panel.locator('[data-testid="netpanel-seed-new"]').click();
  await panel.locator('[data-testid="netpanel-code-input"]').fill(ROOM);
  await panel.locator('[data-testid="netpanel-enter"]').click();
  await page.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getNet()?.phase === 'connected',
  );
}

test('getGameUuid names the game ON SCREEN — the session’s game, not the scene-local board', async ({
  page,
}) => {
  await boot(page);
  const localBefore = (await pente(page, (p) => p.getGameUuid()))!;

  await enterOnNewGame(page);
  const netUuid = (await pente(page, (p) => p.getNetGameUuid()))!;
  // The `new` seed really did mint a different game — otherwise this proves nothing.
  expect(netUuid).not.toBe(localBefore);

  // A networked move: the piece on screen belongs to the SESSION's game (the scene renders it).
  await pente(page, (p) => p.place([2, 2, 2]));
  expect(Object.keys((await pente(page, (p) => p.getState()!)).pieces)).toEqual(['2,2,2']);

  // THE IDENTITY SEAM AGREES WITH THE BOARD: it reports the session's game, not the untouched local one.
  expect(await pente(page, (p) => p.getGameUuid())).toBe(netUuid);
  // …and it agrees with the head hash reported for the same moment: the session's record is the one
  // holding that head, so the two seams describe ONE game rather than two.
  const head = (await pente(page, (p) => p.getHeadHash()))!;
  await expect
    .poll(async () => (await archive(page)).find((g) => g.id === netUuid)?.meta.headHash)
    .toBe(head);

  // LEAVING makes the scene-local board the rendered game again — and the seam follows it back.
  await pente(page, (p) => p.leaveNet());
  await page.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getNet()?.phase === 'offline',
  );
  expect(await pente(page, (p) => p.getNetGameUuid())).toBeNull();
  expect(await pente(page, (p) => p.getGameUuid())).toBe(localBefore);
});

test('RESUMING the game the ROOM is running is REFUSED — the session stays its only writer', async ({
  page,
}) => {
  await boot(page);
  const localBoard = (await pente(page, (p) => p.getGameUuid()))!;

  await enterOnNewGame(page);
  const netUuid = (await pente(page, (p) => p.getNetGameUuid()))!;
  await pente(page, (p) => p.place([2, 2, 2]));
  await expect
    .poll(async () => (await archive(page)).find((g) => g.id === netUuid)?.events)
    .toBe(1);
  const before = (await archive(page)).find((g) => g.id === netUuid)!;

  // The live game is listed like any other in-progress game, so its Resume button is clickable. It must
  // REFUSE: the board on screen already IS that game, and loading the archived snapshot as a local board
  // would put the app on the record the session is writing (two writers of one history).
  await page.evaluate((commandId: string) => {
    (window as unknown as { __pente: Pente }).__pente.dispatch(commandId);
  }, LOAD_COMMAND);
  const modal = page.locator('[data-testid="archive-modal"]');
  await expect(modal).toBeVisible();
  const row = page.locator(
    `[data-widget-id="archiveBrowser"] .pente-archive-row[data-game-uuid="${netUuid}"]`,
  );
  await expect(row).toHaveAttribute('data-status', 'unfinished');
  await row.locator('.pente-archive-resume').click();

  // THE PLAYER IS TOLD. The list stays OPEN and states the refusal in the model's own words — the
  // whole point: `canResume` is derived from the stored result, so this row is offered and clicked
  // like any other, and a refusal that only reached `log.error` behind an already-closed modal was
  // indistinguishable from a dead button.
  const refusal = page.locator('[data-testid="archive-refusal"]');
  await expect(refusal).toBeVisible();
  await expect(refusal).toHaveText(RESUME_REFUSAL_TEXT['session-live']);
  await expect(modal).toBeVisible();
  // The board behind the modal never moved: the room's game is still the one on screen.
  expect(await pente(page, (p) => p.getGameUuid())).toBe(netUuid);

  await page.locator('[data-testid="archive-close"]').click();
  await expect(modal).toBeHidden();

  // PROOF THE GATE REJECTED, by observable behaviour rather than the refusal log: the scene-LOCAL board
  // was never replaced by the snapshot. Leaving the room makes the scene-local game the rendered one
  // again, and it is still the board this page booted with — had the resume gone through, the local
  // board would now BE the networked game.
  await pente(page, (p) => p.leaveNet());
  await page.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getNet()?.phase === 'offline',
  );
  expect(await pente(page, (p) => p.getGameUuid())).toBe(localBoard);
  expect(await pente(page, (p) => p.getGameUuid())).not.toBe(netUuid);

  // …and the session's record is exactly as the session left it: one event, its seat map intact.
  const after = (await archive(page)).find((g) => g.id === netUuid)!;
  expect(after.events).toBe(1);
  expect(after.meta.headHash).toBe(before.meta.headHash);
  expect(after.meta.seats).toEqual({ white: PLAYER_ID, black: null });
});

test('RESUMING SOME OTHER game while a room runs is REFUSED — not a silent load nobody can see', async ({
  page,
}) => {
  await boot(page);

  // An ordinary local game, left unfinished and archived, then abandoned for a fresh board. This is
  // the row a player clicks by mistake mid-room: it is not the room's game, so the uuid-equality guard
  // never looked at it, and `canResume` says yes because its stored result is in-progress.
  await pente(page, (p) => p.place([0, 0, 0]));
  await pente(page, (p) => p.place([4, 4, 4]));
  const otherUuid = (await pente(page, (p) => p.getGameUuid()))!;
  const otherHead = (await pente(page, (p) => p.getHeadHash()))!;
  await expect
    .poll(async () => (await archive(page)).find((g) => g.meta.uuid === otherUuid)?.meta.headHash)
    .toBe(otherHead);
  await pente(page, (p) => p.dispatch('reset'));

  await enterOnNewGame(page);
  const netUuid = (await pente(page, (p) => p.getNetGameUuid()))!;
  await pente(page, (p) => p.place([2, 2, 2]));
  expect(await pente(page, (p) => p.getGameUuid())).toBe(netUuid);

  await page.evaluate((commandId: string) => {
    (window as unknown as { __pente: Pente }).__pente.dispatch(commandId);
  }, LOAD_COMMAND);
  const modal = page.locator('[data-testid="archive-modal"]');
  await expect(modal).toBeVisible();
  const row = page.locator(
    `[data-widget-id="archiveBrowser"] .pente-archive-row[data-game-uuid="${otherUuid}"]`,
  );
  // It really is a DIFFERENT game from the room's, and the list really does offer Resume on it.
  expect(otherUuid).not.toBe(netUuid);
  await expect(row).toHaveAttribute('data-can-resume', 'true');
  await row.locator('.pente-archive-resume').click();

  // REFUSED, VISIBLY. While the session is authoritative the scene renders the SESSION's game
  // (`netRouting.shouldRenderSessionGame`), so a game swapped into the scene-local slot lands off
  // screen: the click used to do nothing at all, and the resumed game later surfaced by surprise when
  // the room was left.
  const refusal = page.locator('[data-testid="archive-refusal"]');
  await expect(refusal).toBeVisible();
  await expect(refusal).toHaveText(RESUME_REFUSAL_TEXT['session-active']);
  await expect(modal).toBeVisible();

  // The board on screen is untouched: still the room's game, still its one piece.
  expect(await pente(page, (p) => p.getGameUuid())).toBe(netUuid);
  expect(Object.keys((await pente(page, (p) => p.getState()!)).pieces)).toEqual(['2,2,2']);

  // …and LEAVING the room brings back the board the page was on, NOT the game that was refused —
  // proof nothing was loaded into the hidden scene-local slot behind the modal.
  await page.locator('[data-testid="archive-close"]').click();
  await pente(page, (p) => p.leaveNet());
  await page.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getNet()?.phase === 'offline',
  );
  expect(await pente(page, (p) => p.getGameUuid())).not.toBe(otherUuid);
  expect((await pente(page, (p) => p.getState()!)).pieces).toEqual({});
});

test('RESUMING a game a session ran keeps saving it — moves land, seats and start date survive', async ({
  page,
}) => {
  await boot(page);

  await enterOnNewGame(page);
  const netUuid = (await pente(page, (p) => p.getNetGameUuid()))!;
  await pente(page, (p) => p.place([2, 2, 2]));
  // The SESSION wrote the game's record, with the identity-owned seat map (design §2.3).
  await expect
    .poll(async () => (await archive(page)).find((g) => g.id === netUuid)?.events)
    .toBe(1);
  const before = (await archive(page)).find((g) => g.id === netUuid)!;
  expect(before.meta.seats).toEqual({ white: PLAYER_ID, black: null });
  expect(before.meta.result).toBe('in-progress');

  // Leave the room: the session goes offline, and the record stays ITS record — until the games list
  // hands the game back.
  await pente(page, (p) => p.leaveNet());
  await page.waitForFunction(
    () => (window as unknown as { __pente: Pente }).__pente.getNet()?.phase === 'offline',
  );

  // The games list is the only route back (design §10): the networked game is listed UNFINISHED, and
  // RESUME is offered on it.
  await page.evaluate((commandId: string) => {
    (window as unknown as { __pente: Pente }).__pente.dispatch(commandId);
  }, LOAD_COMMAND);
  const modal = page.locator('[data-testid="archive-modal"]');
  await expect(modal).toBeVisible();
  const row = page.locator(
    `[data-widget-id="archiveBrowser"] .pente-archive-row[data-game-uuid="${netUuid}"]`,
  );
  await expect(row).toHaveAttribute('data-status', 'unfinished');
  await row.locator('.pente-archive-resume').click();
  await expect(modal).toBeHidden();
  await page.waitForFunction(
    (want: string) => (window as unknown as { __pente: Pente }).__pente.getGameUuid() === want,
    netUuid,
  );
  expect(Object.keys((await pente(page, (p) => p.getState()!)).pieces)).toEqual(['2,2,2']);

  // KEEP PLAYING. Every move must be persisted — the resumed board is the ONE board the player is on.
  await pente(page, (p) => p.place([0, 0, 0]));
  await expect
    .poll(async () => (await archive(page)).find((g) => g.id === netUuid)?.events)
    .toBe(2);
  await page.waitForTimeout(300); // let any further writes land before asserting the rest

  const after = (await archive(page)).find((g) => g.id === netUuid)!;
  // The record grew with the move, still under the GAME's uuid (V.5: one record per game)…
  expect(after.meta.headHash).toBe(await pente(page, (p) => p.getHeadHash()));
  expect(after.meta.result).toBe('in-progress');
  // …the identity-owned seat map the empty-room reclaim (§6.4) and the rejoin colour read is intact —
  // the app carried it forward rather than stamping the local `{white:'You', black:'You'}` over it…
  expect(after.meta.seats).toEqual({ white: PLAYER_ID, black: null });
  expect(after.meta.players).toEqual(before.meta.players);
  // …and the game keeps the date it BEGAN, so returning to it does not shuffle it up the games list.
  expect(after.meta.startedAt).toBe(before.meta.startedAt);
  // Nothing forked off into a second record for this game.
  expect((await archive(page)).filter((g) => g.meta.uuid === netUuid)).toHaveLength(1);
});
