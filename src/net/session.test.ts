/**
 * `NetSession.enter()` — the S.5 admission-protocol GLUE, exercised over the real {@link MockTransport}
 * + {@link MockRelayHub} (a faithful relay: fans a publish to every OTHER peer, never echoes the
 * sender). These are mock-TRANSPORT unit tests of the state transitions the app then proves
 * end-to-end in S.7: two sessions on a shared hub exchange REAL admission + sync messages, and every
 * assertion is on OBSERVABLE session state (seat owners, game uuid, phase, last reject) after the
 * other client actually received the traffic — never a log line (agent-principles #3).
 *
 * The session touches an `IDBDatabase` (only on a conflict) and a clock, so it is the Playwright-
 * verified IO boundary — these tests cover the entry state machine, not mutation-gated purity (that
 * lives in `seats.ts` / `admission.ts` / `sync.ts`). `settleMs: 0` drives the settle window
 * deterministically; a deterministic `newMessageId` keeps admission ids stable for dedup assertions.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDatabase, getGame, putGame } from '../persist/db';
import { saveGame, listArchivedGames, ArchiveError } from '../persist/archive';
import {
  writeActiveGame,
  readActiveGame,
  ACTIVE_GAME_MAX_AGE_MS,
} from './activeGame';
import { Game } from '../core/game';
import { headHash } from '../core/eventLog';
import { coordsOf } from '../core/coords';
import { MockRelayHub, MockTransport, type Transport } from './transport';
import { toAdmitMessage, toSyncMessage } from './sync';
import { NetSession, type NetSessionDeps } from './session';
import type { Proposal } from './admission';
import type { NetSeat } from '../ui/widgets/netModel';

const SIZE = 9;
// A well-formed alphanumeric code (A-Z0-9, issue #30) so `validateGameCode` accepts it and BOTH
// peers rendezvous on the SAME room — an INVALID code (non-alphanumeric / too short) would degrade
// to a fresh RANDOM code per peer and they would never meet (the honest invalid-code degrade).
const ROOM = 'RMBBCC';

let db: IDBDatabase;

beforeEach(async () => {
  db = await openDatabase(`net-session-test-${Math.random().toString(36).slice(2)}`);
});

/**
 * A spec-faithful in-memory `Storage` (mirroring config.test.ts) standing in for ONE browser's
 * localStorage — where the `activeNetworkedGame` BREADCRUMB lives. Two sessions sharing a store model
 * the SAME browser returning; separate stores model two distinct browsers (as the separate `db`s do).
 */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

/** A monotonic id source so each session's admission messages carry stable, unique ids. */
function idSource(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${n++}`;
}

/**
 * Build a {@link NetSession} whose transport factory rendezvouses on the shared `hub` with a fixed
 * `playerId` (so presence + hellos identify it deterministically). `settleMs: 0` fires the settle
 * window on the next macrotask; a fixed `now` feeds each hello a stable arrivalTag unless overridden.
 */
function makeSession(
  hub: MockRelayHub,
  playerId: string,
  opts: Partial<NetSessionDeps> = {},
): NetSession {
  let arrival = 0;
  return new NetSession({
    createTransport: (): Transport => new MockTransport(hub, playerId),
    // Default to the shared per-test `db`; a durable-reclaim test that models TWO distinct browsers
    // overrides `db` per identity so their room-scoped persisted state does not collide on one store
    // (mirroring the e2e's per-context IndexedDB isolation).
    db,
    playerId,
    size: SIZE,
    settleMs: 0,
    // A distinct, monotonically-increasing arrivalTag per hello (the initiator-election input); a test
    // that needs a specific arrival order overrides `now`.
    now: () => arrival++,
    // Its OWN breadcrumb store by default (one fresh "browser" per session); a test that models the
    // SAME browser returning passes the same `storage` to both sessions, as it does with `db`.
    storage: memoryStorage(),
    newMessageId: idSource(playerId),
    ...opts,
  });
}

/** Flush pending microtasks + the `settleMs: 0` macrotask so a real-timer settle window resolves. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

const NEW: Proposal = { kind: 'new' };
const DEFER: Proposal = { kind: 'defer' };

describe('NetSession.enter — a lone arriver ESTABLISHES the room', () => {
  it('a `new` proposal mints a game, claims WHITE, and reaches connected', async () => {
    const hub = new MockRelayHub();
    const a = makeSession(hub, 'player-a');

    await a.enter(ROOM, NEW);

    expect(a.state().phase).toBe('connected');
    expect(a.state().seat).toBe('white');
    // The lone establisher owns white; black is UNOWNED (null) until a partner is admitted — no
    // `'host'` sentinel, every owner a real playerId or null (design §2.3).
    expect(a.seatOwners()).toEqual({ white: 'player-a', black: null });
    expect(a.gameUuid()).not.toBeNull();
    expect(a.lastRejectReason()).toBeNull();
  });
});

describe('NetSession.enter — a resident ADMITS a newcomer (design §4 Case 1)', () => {
  it('the second peer is admitted onto BLACK and BOTH converge on ONE game uuid (the #31 fix)', async () => {
    const hub = new MockRelayHub();
    const a = makeSession(hub, 'player-a');
    const b = makeSession(hub, 'player-b');

    // A establishes first (alone), then B enters and is admitted by the resident A.
    await a.enter(ROOM, NEW);
    await b.enter(ROOM, DEFER);

    expect(b.state().phase).toBe('connected');
    // DISTINCT real seat owners — NOT both black (the #31 both-Join-both-Black regression is gone).
    expect(b.state().seat).toBe('black');
    expect(b.seatOwners()).toEqual({ white: 'player-a', black: 'player-b' });
    // Both reference the SAME game identity after admission (design §2.2): B adopted A's game uuid.
    expect(b.gameUuid()).toBe(a.gameUuid());
    expect(b.lastRejectReason()).toBeNull();
  });

  it("the resident's own seat map records the admitted newcomer's ownership", async () => {
    const hub = new MockRelayHub();
    const a = makeSession(hub, 'player-a');
    const b = makeSession(hub, 'player-b');

    await a.enter(ROOM, NEW);
    await b.enter(ROOM, DEFER);
    await flush();

    // After admitting B, the RESIDENT A's durable seat map reserves both seats to their real owners.
    expect(a.seatOwners()).toEqual({ white: 'player-a', black: 'player-b' });
  });
});

describe('NetSession.enter — a third peer is REJECTED room-full (design §4 / scenario 1)', () => {
  it('rejects with a typed reason and stays offline when both seats are owned', async () => {
    const hub = new MockRelayHub();
    const a = makeSession(hub, 'player-a');
    const b = makeSession(hub, 'player-b');
    const c = makeSession(hub, 'player-c');

    await a.enter(ROOM, NEW);
    await b.enter(ROOM, DEFER);
    await c.enter(ROOM, DEFER);
    await flush();

    // C owns neither seat and both are owned → the arbiter refuses with the HONEST typed reason.
    expect(c.lastRejectReason()).toBe('room-full');
    expect(c.state().phase).toBe('offline');
    expect(c.state().seat).toBeNull();
    // …AND the reject reason SURVIVES to the USER-FACING session state as `joinError` (design §7 —
    // the net panel shows a human message for EVERY reject). This is the round-3 regression proof:
    // before the fix, `disconnect()` → `resetToOffline(null)` nulled `joinError` before any emit, so
    // the panel showed nothing. The reason must be on `state()` (what the widget derives from), not
    // just the debug-only `lastRejectReason()` readout.
    expect(c.state().joinError).toBe('room-full');
    // The admitted pair is untouched — C's rejected entry never displaced an owner.
    expect(a.seatOwners()).toEqual({ white: 'player-a', black: 'player-b' });
  });
});

describe('NetSession.reconnect — a returning owner RECLAIMS its seat by identity', () => {
  it('B drops and re-enters the SAME room, reclaiming BLACK (design §2.3, scenario 2)', async () => {
    const hub = new MockRelayHub();
    const a = makeSession(hub, 'player-a');
    // B reuses ONE playerId across the drop (a stable identity is what reclaim keys on), so a fresh
    // session with the same id models the same browser returning.
    const b1 = makeSession(hub, 'player-b');

    await a.enter(ROOM, NEW);
    await b1.enter(ROOM, DEFER);
    expect(b1.state().seat).toBe('black');

    b1.disconnect();
    await flush();

    // The same browser (same playerId) returns: the resident A still reserves black for player-b, so
    // B is admitted back onto BLACK — a reconnect is a non-event for ownership. A returning browser
    // mints FRESH admission ids (a distinct `newMessageId` source), so its new hello is NOT deduped as
    // a replay of the pre-drop one (the id-dedup guardrail correctly drops a replay, not a fresh ask).
    const b2 = makeSession(hub, 'player-b', { newMessageId: idSource('player-b-return') });
    // reconnect() re-enters lastCode; b2 is a fresh object, so drive an explicit enter to the room.
    await b2.enter(ROOM, DEFER);
    await flush();

    expect(b2.state().seat).toBe('black');
    expect(b2.seatOwners()).toEqual({ white: 'player-a', black: 'player-b' });
    expect(b2.gameUuid()).toBe(a.gameUuid());
  });

  it('reconnect() re-enters the last room and returns false with nothing to reconnect to', async () => {
    const hub = new MockRelayHub();
    const a = makeSession(hub, 'player-a');

    // Never entered → nothing to reconnect to.
    expect(await a.reconnect()).toBe(false);

    await a.enter(ROOM, NEW);
    a.disconnect();
    await flush();

    // After a real entry, reconnect() re-enters the remembered room and re-establishes (alone here).
    expect(await a.reconnect()).toBe(true);
    expect(a.state().phase).toBe('connected');
    expect(a.state().seat).toBe('white');
  });

  /**
   * BUG #40 (cross-feature: rematch color-alternation #12 × identity-owned reconnect #35). After a
   * mutual rematch the seats SWAP (design/#12: "colors ALTERNATE every game"). If a player then drops
   * and reconnects, it must reclaim the color it owns in the CURRENT (post-swap) game — NOT its
   * pre-swap color. The bug: `resetForRematch` swapped only `this.seat` and left the durable seat map
   * (`this.seatMap`, and the persisted `net-room:{code}` record) holding the PRE-swap ownership, so a
   * resident arbiter re-admitted the returner onto its OLD color → two same-color seats → turn-gate
   * deadlock ("no one can move"). This asserts the fix on OBSERVABLE state on BOTH contexts.
   */
  it('a reconnect after a rematch color-swap reclaims the CURRENT (swapped) color, not the pre-swap one (#40)', async () => {
    const hub = new MockRelayHub();
    // TWO distinct browsers (each its own IndexedDB archive + its own breadcrumb store) so their
    // persisted state does not collide — mirrors the e2e's per-context isolation and the /dev/ repro.
    const dbA = await openDatabase(`net-rematch-a-${Math.random().toString(36).slice(2)}`);
    const dbB = await openDatabase(`net-rematch-b-${Math.random().toString(36).slice(2)}`);
    const storeA = memoryStorage();
    const storeB = memoryStorage();
    const a = makeSession(hub, 'player-a', { db: dbA, storage: storeA });
    const b = makeSession(hub, 'player-b', { db: dbB, storage: storeB });

    // A enters → white; B enters → black (the #31-fixed distinct seats).
    await a.enter(ROOM, NEW);
    await b.enter(ROOM, DEFER);
    await a.whenPersisted();
    await b.whenPersisted();
    await flush();
    expect(a.state().seat).toBe('white');
    expect(b.state().seat).toBe('black');

    // Play a couple of moves so the game is genuinely underway before the rematch (faithful to the
    // "complete a game then rematch" repro; the reset does not depend on a win, only on a live game).
    a.syncEngine()!.place(coordsOf('0,0,0')); // white
    await flush();
    b.syncEngine()!.place(coordsOf('1,1,1')); // black
    await flush();

    // MUTUAL rematch: BOTH clients reset in place on the accepted resolution (proposer + accepter),
    // each alternating its OWN color deterministically → colors SWAP (design/#12).
    expect(a.resetForRematch()).toBe(true);
    expect(b.resetForRematch()).toBe(true);
    // Await the durable writes the reset must now commit so the reconnect below reads COMMITTED state.
    await a.whenPersisted();
    await b.whenPersisted();
    await flush();

    // Colors have SWAPPED on both contexts: A is now black, B is now white.
    expect(a.state().seat).toBe('black');
    expect(b.state().seat).toBe('white');
    // The durable seat map on BOTH contexts reflects the SWAP (this is what a reconnect reclaims from).
    expect(a.seatOwners()).toEqual({ white: 'player-b', black: 'player-a' });
    expect(b.seatOwners()).toEqual({ white: 'player-b', black: 'player-a' });

    // B (now WHITE) drops. A stays resident and is the arbiter for B's return.
    b.disconnect();
    await flush();

    // B reconnects (same playerId + same db + same breadcrumb store = the same browser; fresh
    // admission ids so its hello is not deduped).
    const b2 = makeSession(hub, 'player-b', {
      db: dbB,
      storage: storeB,
      newMessageId: idSource('player-b-return'),
    });
    await b2.enter(ROOM, DEFER);
    await flush();

    // B must resume WHITE — the color it owns in the CURRENT post-swap game — NOT its pre-swap black.
    expect(b2.state().phase).toBe('connected');
    expect(b2.state().seat).toBe('white');
    // Seats stay DISTINCT and identity-stable across the reconnect: A black, B white. Two same-color
    // seats (the bug) would fail here.
    expect(b2.seatOwners()).toEqual({ white: 'player-b', black: 'player-a' });
    expect(a.seatOwners()).toEqual({ white: 'player-b', black: 'player-a' });
    expect(a.state().seat).toBe('black');

    // Turn gate is HEALTHY: on a fresh post-rematch board white moves first, so exactly ONE seat may
    // place. B (white) may place; A (black) may not — not the deadlock where neither/both could.
    expect(b2.canPlace()).toBe(true);
    expect(a.canPlace()).toBe(false);
  });

  /**
   * BUG #40, empty-room facet: after a rematch swap BOTH players drop, then the first owner returns
   * into the EMPTY room and must reclaim its SWAPPED color from the game its BREADCRUMB names (the
   * archive record keyed by that game's uuid — V.1, epic #47) — proving `resetForRematch` persists the
   * swapped seat map + re-points the breadcrumb at the fresh rematch game, not just updates memory. If
   * the reset failed to persist either, the returner would reclaim its PRE-swap color from a stale
   * record (the same two-same-color deadlock, this time via the empty-room reclaim path).
   */
  it('after a rematch swap BOTH drop; the first returner reclaims its SWAPPED color from the PERSISTED map (#40)', async () => {
    const hub = new MockRelayHub();
    const dbA = await openDatabase(`net-rematch-empty-a-${Math.random().toString(36).slice(2)}`);
    const dbB = await openDatabase(`net-rematch-empty-b-${Math.random().toString(36).slice(2)}`);
    const storeA = memoryStorage();
    const storeB = memoryStorage();
    const a = makeSession(hub, 'player-a', { db: dbA, storage: storeA });
    const b = makeSession(hub, 'player-b', { db: dbB, storage: storeB });

    await a.enter(ROOM, NEW);
    await b.enter(ROOM, DEFER);
    await a.whenPersisted();
    await b.whenPersisted();
    await flush();
    expect(a.state().seat).toBe('white');
    expect(b.state().seat).toBe('black');

    // Mutual rematch → colors swap: A black, B white. Commit both browsers' durable post-swap state.
    expect(a.resetForRematch()).toBe(true);
    expect(b.resetForRematch()).toBe(true);
    await a.whenPersisted();
    await b.whenPersisted();
    await flush();
    const swappedUuid = a.gameUuid();
    expect(a.state().seat).toBe('black');
    expect(b.state().seat).toBe('white');

    // BOTH drop → the room empties on the relay. Ownership now lives ONLY in each browser's archived
    // game (keyed by the post-swap game's uuid), which the reset must have written as the SWAPPED map,
    // reachable via that browser's breadcrumb.
    a.disconnect();
    b.disconnect();
    await flush();

    // B returns FIRST into the empty room: it must re-seed as WHITE (its post-swap owned color),
    // reclaiming from the game its OWN breadcrumb names — not its pre-swap black.
    const b2 = makeSession(hub, 'player-b', {
      db: dbB,
      storage: storeB,
      newMessageId: idSource('player-b-return'),
    });
    await b2.enter(ROOM, DEFER);
    await b2.whenPersisted();
    await flush();

    expect(b2.state().phase).toBe('connected');
    expect(b2.state().seat).toBe('white');
    expect(b2.seatOwners()).toEqual({ white: 'player-b', black: 'player-a' });

    // A returns second: the resident B admits it back onto its RESERVED black.
    const a2 = makeSession(hub, 'player-a', {
      db: dbA,
      storage: storeA,
      newMessageId: idSource('player-a-return'),
    });
    await a2.enter(ROOM, DEFER);
    await flush();

    expect(a2.state().seat).toBe('black');
    expect(a2.seatOwners()).toEqual({ white: 'player-b', black: 'player-a' });
    // Both converge on the post-rematch game identity, and the turn gate is healthy (white to move).
    expect(a2.gameUuid()).toBe(swappedUuid);
    expect(b2.gameUuid()).toBe(swappedUuid);
    expect(b2.canPlace()).toBe(true);
    expect(a2.canPlace()).toBe(false);
  });
});

describe('NetSession.enter — a live session refuses a second enter (no double-connect)', () => {
  it('enter() is a no-op while already connected', async () => {
    const hub = new MockRelayHub();
    const a = makeSession(hub, 'player-a');

    await a.enter(ROOM, NEW);
    const uuid = a.gameUuid();
    // A second enter while live must NOT tear down or re-mint the game.
    await a.enter('QRSTUV', NEW);
    expect(a.gameUuid()).toBe(uuid);
    expect(a.state().code).toBe(ROOM);
  });
});

describe('NetSession.enter — a connect failure surfaces honestly', () => {
  it('a rejected transport connect leaves the session offline with connect-failed', async () => {
    // A transport whose connect always rejects (the relay refused / unreachable).
    const failing = new NetSession({
      createTransport: (): Transport => ({
        connect: () => Promise.reject(new Error('relay down')),
        publish: () => {},
        onMessage: () => {},
        onPresence: () => {},
        disconnect: () => {},
      }),
      db,
      playerId: 'player-a',
      size: SIZE,
      settleMs: 0,
      newMessageId: idSource('player-a'),
    });

    await failing.enter(ROOM, NEW);

    expect(failing.state().phase).toBe('offline');
    expect(failing.state().joinError).toBe('connect-failed');
    expect(failing.seatOwners()).toBeNull();
    expect(failing.gameUuid()).toBeNull();
  });
});

describe('NetSession.enter — two peers ARRIVE TOGETHER → initiator election (design §4 Case 2)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /**
   * Drive a GENUINE simultaneous arrival: both peers connect + hello inside the SAME long settle
   * window, so neither has established before the window expires and the {@link electInitiator} —
   * NOT the mock relay's synchronous delivery order — decides the winner. `aTag`/`bTag` are the
   * arrivalTags each peer stamps on its hello (injected via `now`), the SOLE distinguishing input to
   * the election.
   *
   * Both `enter()` calls are kicked WITHOUT awaiting between them, so both connect + publish their
   * hello before either settle timer fires — each then sees the other JOIN presence and RE-ANNOUNCES
   * its hello, so both hold the other's hello (and arrivalTag) within the window even though the
   * first hello was published before the co-arriver had subscribed. This models the true relay race
   * the election exists to kill (#31): convergence must come from the election agreeing across peers
   * on the SAME winner, never from who happened to be delivered first. Uses fake timers so a fresh
   * per-`it` clock (the describe's `beforeEach`) drives the window deterministically.
   */
  async function arriveTogether(
    aTag: number,
    bTag: number,
  ): Promise<{
    a: { seat: NetSeat; uuid: string | null };
    b: { seat: NetSeat; uuid: string | null };
  }> {
    const hub = new MockRelayHub();
    const a = makeSession(hub, 'player-a', { settleMs: 1000, now: () => aTag });
    const b = makeSession(hub, 'player-b', { settleMs: 1000, now: () => bTag });

    const pa = a.enter(ROOM, NEW);
    const pb = b.enter(ROOM, NEW);
    // Flush connects + hello publishes + presence re-announces (microtasks), still inside the window.
    await vi.advanceTimersByTimeAsync(0);
    // Expire the window: onSettle fires on BOTH; both independently elect the same initiator by the
    // shared arrivalTags; the winner establishes + admits, the loser adopts.
    await vi.advanceTimersByTimeAsync(1000);
    await pa;
    await pb;

    // BOTH must reach a live game — a peer left `connecting` would mean it never got the winner's
    // admit (the asymmetric-delivery bug), which the assertions below would then also catch.
    expect(a.state().phase).toBe('connected');
    expect(b.state().phase).toBe('connected');
    return {
      a: { seat: a.state().seat, uuid: a.gameUuid() },
      b: { seat: b.state().seat, uuid: b.gameUuid() },
    };
  }

  it('the EARLIER arrivalTag wins white (A earlier → A white, B black; one shared game)', async () => {
    const aEarlier = await arriveTogether(0, 5);
    expect(aEarlier.a.seat).toBe('white');
    expect(aEarlier.b.seat).toBe('black');
    expect(aEarlier.a.uuid).toBe(aEarlier.b.uuid);
    expect(aEarlier.a.uuid).not.toBeNull();
  });

  it('SWAPPING the arrivalTags SWAPS the winner (B earlier → B white, A black) — the election bites', async () => {
    // SWAP the ONLY distinguishing input relative to the test above: now B's tag is earlier. If the
    // election reads the arrivalTag as designed the winner FLIPS to B; the pre-fix bug (each peer
    // hardcoded its OWN arrivalOrder to 0 and elected ITSELF, so A always established first and took
    // white regardless of the tag) left this UNCHANGED (A white, B black). These assertions are
    // exactly the gate that rejects a broken/absent election (agent-principles #7) — proven by the
    // swap experiment: with the bug present, B is black here; with the fix, B is white.
    const bEarlier = await arriveTogether(5, 0);
    expect(bEarlier.b.seat).toBe('white');
    expect(bEarlier.a.seat).toBe('black');
    expect(bEarlier.a.uuid).toBe(bEarlier.b.uuid);
    expect(bEarlier.a.uuid).not.toBeNull();
  });

  it('EQUAL arrivalTags break the tie by the lexicographically-lower playerId (player-a wins white)', async () => {
    // Same tag on both → the election falls through to the playerId tiebreak; 'player-a' < 'player-b'.
    const tie = await arriveTogether(3, 3);
    expect(tie.a.seat).toBe('white');
    expect(tie.b.seat).toBe('black');
    expect(tie.a.uuid).toBe(tie.b.uuid);
  });
});

/**
 * The DURABLE identity-owned seat map (design §2/§6.4): seat ownership is persisted WITH the game, in
 * the archive keyed by that game's UUID, so it survives an EMPTY room — reached on a return via the
 * `activeNetworkedGame` BREADCRUMB's uuid, never via the room code (V.1, epic #47: there is no
 * code→game record any more). These model TWO distinct browsers, each with its OWN archive db + its
 * OWN breadcrumb store (mirroring the e2e's per-context isolation) so their persisted state does not
 * collide. `flush()` lets the fire-and-forget durable write commit before the returning peer reads it.
 */
describe('NetSession — durable seats survive an empty room (design §6.4, scenario 4)', () => {
  it('both drop; the first returning owner re-seeds as the color it OWNED, not white-by-arrival', async () => {
    const hub = new MockRelayHub();
    // Distinct per-browser stores so A and B's archived games + breadcrumbs never collide.
    const dbA = await openDatabase(`net-durable-a-${Math.random().toString(36).slice(2)}`);
    const dbB = await openDatabase(`net-durable-b-${Math.random().toString(36).slice(2)}`);
    const storeA = memoryStorage();
    const storeB = memoryStorage();
    const a = makeSession(hub, 'player-a', { db: dbA, storage: storeA });
    const b = makeSession(hub, 'player-b', { db: dbB, storage: storeB });

    // Establish A (white) + B (black), then await the durable persists so both browsers' uuid-keyed
    // seat map + game are COMMITTED before the drop (deterministic durability, not a timing guess).
    await a.enter(ROOM, NEW);
    await b.enter(ROOM, DEFER);
    await a.whenPersisted();
    await b.whenPersisted();
    await flush();
    const uuidBefore = a.gameUuid();
    expect(b.state().seat).toBe('black');

    // BOTH drop → the room empties on the relay. Seat ownership lives in each browser's persisted game.
    a.disconnect();
    b.disconnect();
    await flush();

    // B rejoins FIRST into the now-empty room with `defer`. The OLD bug re-seeded a fresh empty game
    // and grabbed first-available WHITE. The durable fix reloads the game B's BREADCRUMB names (SAME
    // uuid) and RECLAIMS black — the color B owned — even though B arrives first into the empty room.
    const b2 = makeSession(hub, 'player-b', {
      db: dbB,
      storage: storeB,
      newMessageId: idSource('player-b-return'),
    });
    await b2.enter(ROOM, DEFER);
    await b2.whenPersisted();
    await flush();

    expect(b2.state().phase).toBe('connected');
    expect(b2.state().seat).toBe('black');
    // B re-seeded the SAME game identity it owned (not a fresh one), and its seat map still reserves
    // white for the absent player-a.
    expect(b2.gameUuid()).toBe(uuidBefore);
    expect(b2.seatOwners()).toEqual({ white: 'player-a', black: 'player-b' });

    // A rejoins second; the resident B admits A back onto its RESERVED white — A resumes white.
    const a2 = makeSession(hub, 'player-a', {
      db: dbA,
      storage: storeA,
      newMessageId: idSource('player-a-return'),
    });
    await a2.enter(ROOM, DEFER);
    await flush();

    expect(a2.state().seat).toBe('white');
    expect(a2.gameUuid()).toBe(uuidBefore);
    expect(a2.seatOwners()).toEqual({ white: 'player-a', black: 'player-b' });
  });

  it('a returning BLACK owner that WINS the election re-seeds as BLACK — not white-by-arrival', async () => {
    // The reclaim-by-identity path on the ELECTED-INITIATOR branch (design §2.3/§6.4): when the winner
    // of a simultaneous arrival already OWNS a color, it must keep that color — the pre-fix
    // `establishAsInitiator` discarded the reclaimed seat and unconditionally claimed first-available
    // WHITE, so a returning owner of BLACK that won would have stolen white (review finding #2).
    // REAL timers throughout (this exercises the IndexedDB durable persist, which needs real
    // macrotasks) — the simultaneous return is driven by a real short settle window + `flush`.
    const hub = new MockRelayHub();
    const dbA = await openDatabase(`net-reclaim-a-${Math.random().toString(36).slice(2)}`);
    const dbB = await openDatabase(`net-reclaim-b-${Math.random().toString(36).slice(2)}`);
    const storeA = memoryStorage();
    const storeB = memoryStorage();

    // Establish A=white, B=black, commit both browsers' durable game + breadcrumb, then both drop.
    const a = makeSession(hub, 'player-a', { db: dbA, storage: storeA });
    const b = makeSession(hub, 'player-b', { db: dbB, storage: storeB });
    await a.enter(ROOM, NEW);
    await b.enter(ROOM, DEFER);
    await a.whenPersisted();
    await b.whenPersisted();
    await flush();
    const uuidBefore = b.gameUuid();
    expect(b.state().seat).toBe('black');
    a.disconnect();
    b.disconnect();
    await flush();

    // B and A now RETURN SIMULTANEOUSLY into the empty room. Give B the EARLIER arrivalTag so B — the
    // returning BLACK owner — WINS the election and runs the initiator branch. B must re-seed BLACK
    // (its owned color from its persisted map), NOT grab white; A adopts B's game + its reserved
    // white. A short REAL settle window (long enough for both to connect + re-announce, driven by the
    // real macrotask flush below) makes this a genuine co-arrival, not a sequential resident/join.
    const b2 = makeSession(hub, 'player-b', {
      db: dbB,
      storage: storeB,
      settleMs: 20,
      now: () => 0,
      newMessageId: idSource('player-b-return'),
    });
    const a2 = makeSession(hub, 'player-a', {
      db: dbA,
      storage: storeA,
      settleMs: 20,
      now: () => 5,
      newMessageId: idSource('player-a-return'),
    });
    // Kick BOTH without awaiting so both connect + hello + re-announce inside the 20ms window. Both
    // enter() promises resolve after the real settle window elapses (winner establishes + admits, the
    // loser adopts the admit); `Promise.all` awaits both, then a real wait past the window drains any
    // trailing admit/persist macrotask.
    const pb = b2.enter(ROOM, DEFER);
    const pa = a2.enter(ROOM, DEFER);
    await Promise.all([pb, pa]);
    await new Promise((r) => setTimeout(r, 40));

    expect(b2.state().phase).toBe('connected');
    expect(a2.state().phase).toBe('connected');
    // The winning initiator B kept BLACK (reclaim-by-identity), A took the reserved WHITE — the seat
    // map is identity-stable across the drop even though B won the election.
    expect(b2.state().seat).toBe('black');
    expect(a2.state().seat).toBe('white');
    expect(b2.seatOwners()).toEqual({ white: 'player-a', black: 'player-b' });
    expect(a2.seatOwners()).toEqual({ white: 'player-a', black: 'player-b' });
    // B re-seeded the SAME game identity it owned (its reconciled `defer`/`defer` would otherwise mint
    // a fresh one); both peers converge on that owned uuid.
    expect(b2.gameUuid()).toBe(uuidBefore);
    expect(a2.gameUuid()).toBe(uuidBefore);
  });
});

/**
 * SEEDING A RETURN — from the BREADCRUMB, NEVER from the room code (V.1, epic #47; #43/#46,
 * design §2/§6).
 *
 * A room code is a rendezvous channel, NOT a game: the v3 `net-room:{code}` record (a game + seat map
 * persisted per CODE) is deleted, and with it every code→game lookup. What a live session leaves
 * behind is (a) the game in the archive keyed by its OWN uuid and (b) a single `activeNetworkedGame`
 * BREADCRUMB — "I am currently mid-game in room X as game Y" — which a `defer` return re-seeds from.
 *
 * The pair of tests below is the experiment that proves the rule bites (agent-principles #7): with an
 * IDENTICAL precondition (a prior game archived + the breadcrumb pointing at it), `defer` ADOPTS that
 * game and `new` MINTS a fresh one — only the proposal kind differs. The #43 bug was exactly the
 * missing distinction: any owned prior game was adopted regardless of the proposal, so "New Game" at a
 * re-used code resurrected the old board.
 */
describe('NetSession — a return re-seeds from the BREADCRUMB, never from the room code (#43, #47)', () => {
  /** A second valid room code, so a "different room" precondition is a real, enterable code. */
  const OTHER_ROOM = 'QRSTUV';

  /**
   * Leave behind exactly what a real prior session leaves: `game` archived UNDER ITS OWN UUID with the
   * identity-owned seat map, plus the breadcrumb naming it. Written directly (rather than by playing a
   * game) so each test states its own precondition explicitly and asserts on the OUTCOME.
   */
  async function seedPriorGame(
    into: IDBDatabase,
    store: Storage,
    game: Game,
    seatMap: { white: string | null; black: string | null },
    crumb: { code: string; updatedAt: number } = { code: ROOM, updatedAt: 0 },
  ): Promise<void> {
    await saveGame(into, game.uuid, game, {
      players: {},
      result: 'in-progress',
      startedAt: 0,
      seats: seatMap,
    });
    writeActiveGame({ code: crumb.code, gameUuid: game.uuid, updatedAt: crumb.updatedAt }, store);
  }

  /** A three-move prior game whose WHITE seat player-a owns — the "mid-game I stepped away from". */
  function priorGame(): Game {
    const g = new Game(SIZE);
    g.place(coordsOf('0,0,0'));
    g.place(coordsOf('1,1,1'));
    g.place(coordsOf('2,2,2'));
    return g;
  }

  it('a DEFER return ADOPTS the breadcrumb\'s game — same uuid, same 3 pieces, owned colour', async () => {
    const hub = new MockRelayHub();
    const own = await openDatabase(`net-crumb-defer-${Math.random().toString(36).slice(2)}`);
    const store = memoryStorage();
    const prior = priorGame();
    await seedPriorGame(own, store, prior, { white: 'player-a', black: 'player-b' });

    // Returning to ROOM with `defer` ("dealer's choice" / a reconnect) re-seeds the game the BREADCRUMB
    // names, resolved from the archive BY UUID.
    const a = makeSession(hub, 'player-a', { db: own, storage: store });
    await a.enter(ROOM, DEFER);
    await a.whenPersisted();
    await flush();

    expect(a.state().phase).toBe('connected');
    expect(a.gameUuid()).toBe(prior.uuid);
    expect(Object.keys(a.gameState()!.pieces).length).toBe(3);
    // The seat map came back with the game, so player-a reclaims WHITE and black stays reserved.
    expect(a.state().seat).toBe('white');
    expect(a.seatOwners()).toEqual({ white: 'player-a', black: 'player-b' });
  });

  it('a NEW proposal on the SAME precondition starts EMPTY with a DIFFERENT uuid (#43)', async () => {
    const hub = new MockRelayHub();
    const own = await openDatabase(`net-crumb-new-${Math.random().toString(36).slice(2)}`);
    const store = memoryStorage();
    const prior = priorGame();
    expect(Object.keys(prior.state().pieces).length).toBe(3); // sanity: the prior board has pieces.
    await seedPriorGame(own, store, prior, { white: 'player-a', black: 'player-b' });

    // The ONLY difference from the test above: the seed kind. "New Game" must start over.
    const a = makeSession(hub, 'player-a', { db: own, storage: store });
    await a.enter(ROOM, NEW);
    await a.whenPersisted();
    await flush();

    expect(a.state().phase).toBe('connected');
    // FRESH board, DISTINCT identity. The bug kept the 3 prior pieces and re-used the prior uuid.
    expect(Object.keys(a.gameState()!.pieces).length).toBe(0);
    expect(a.gameUuid()).not.toBe(prior.uuid);
    expect(a.gameUuid()).not.toBeNull();
    // A `new` game claims WHITE as first owner on a FRESH map — black is unowned, not the stale owner.
    expect(a.state().seat).toBe('white');
    expect(a.seatOwners()).toEqual({ white: 'player-a', black: null });
  });

  it('a NEW game REPLACES the breadcrumb, so a later return reclaims the FRESH game, not the old one', async () => {
    const hub = new MockRelayHub();
    const own = await openDatabase(`net-crumb-replace-${Math.random().toString(36).slice(2)}`);
    const store = memoryStorage();
    const prior = priorGame();
    await seedPriorGame(own, store, prior, { white: 'player-a', black: 'player-b' });

    const a = makeSession(hub, 'player-a', { db: own, storage: store });
    await a.enter(ROOM, NEW);
    await a.whenPersisted();
    const freshUuid = a.gameUuid();
    // The breadcrumb now names the FRESH game (the establish re-pointed it), not the pre-reuse one.
    expect(readActiveGame(store)?.gameUuid).toBe(freshUuid);
    expect(readActiveGame(store)?.code).toBe(ROOM);
    a.disconnect();
    await flush();

    // The same browser returns with `defer`: it must re-seed the FRESH game the `new` established.
    const a2 = makeSession(hub, 'player-a', {
      db: own,
      storage: store,
      newMessageId: idSource('player-a-return'),
    });
    await a2.enter(ROOM, DEFER);
    await a2.whenPersisted();
    await flush();

    expect(a2.state().phase).toBe('connected');
    expect(a2.gameUuid()).toBe(freshUuid);
    expect(a2.gameUuid()).not.toBe(prior.uuid);
    expect(Object.keys(a2.gameState()!.pieces).length).toBe(0);
  });

  it('a breadcrumb for a DIFFERENT room brings NOTHING — this code starts fresh (no code→game map)', async () => {
    const hub = new MockRelayHub();
    const own = await openDatabase(`net-crumb-otherroom-${Math.random().toString(36).slice(2)}`);
    const store = memoryStorage();
    const prior = priorGame();
    // The breadcrumb says we are mid-game in OTHER_ROOM. Entering ROOM must not drag that game in —
    // and there is no per-code record to consult either, because none exists any more.
    await seedPriorGame(own, store, prior, { white: 'player-a', black: 'player-b' }, {
      code: OTHER_ROOM,
      updatedAt: 0,
    });

    const a = makeSession(hub, 'player-a', { db: own, storage: store });
    await a.enter(ROOM, DEFER);
    await a.whenPersisted();
    await flush();

    expect(a.gameUuid()).not.toBe(prior.uuid);
    expect(Object.keys(a.gameState()!.pieces).length).toBe(0);
    expect(a.state().seat).toBe('white');
  });

  it('a STALE breadcrumb expires QUIETLY — a return starts fresh (design §6)', async () => {
    const hub = new MockRelayHub();
    const own = await openDatabase(`net-crumb-stale-${Math.random().toString(36).slice(2)}`);
    const store = memoryStorage();
    const prior = priorGame();
    await seedPriorGame(own, store, prior, { white: 'player-a', black: 'player-b' });

    // The clock is now past the credibility horizon: "I am currently mid-game there" is no longer a
    // believable claim, so the game is NOT dragged into the room (it stays reachable via the archive).
    const a = makeSession(hub, 'player-a', {
      db: own,
      storage: store,
      now: () => ACTIVE_GAME_MAX_AGE_MS + 1,
    });
    await a.enter(ROOM, DEFER);
    await a.whenPersisted();
    await flush();

    expect(a.state().phase).toBe('connected');
    expect(a.gameUuid()).not.toBe(prior.uuid);
    expect(Object.keys(a.gameState()!.pieces).length).toBe(0);
  });

  it('a breadcrumb naming a game we do NOT hold degrades to a fresh game (honest, never a throw)', async () => {
    const hub = new MockRelayHub();
    const own = await openDatabase(`net-crumb-missing-${Math.random().toString(36).slice(2)}`);
    const store = memoryStorage();
    // A breadcrumb whose uuid resolves to nothing in THIS archive (e.g. the record was cleared).
    writeActiveGame({ code: ROOM, gameUuid: 'a-uuid-this-browser-does-not-hold', updatedAt: 0 }, store);

    const a = makeSession(hub, 'player-a', { db: own, storage: store });
    await a.enter(ROOM, DEFER);
    await a.whenPersisted();
    await flush();

    expect(a.state().phase).toBe('connected');
    expect(Object.keys(a.gameState()!.pieces).length).toBe(0);
    expect(a.state().seat).toBe('white');
  });
});

/**
 * THE BREADCRUMB ITSELF (design §2): session state — "I am CURRENTLY mid-game in room X as game Y" —
 * written while a game is live, re-pointed when the session moves, CLEARED when the game is decided,
 * and deliberately NOT cleared by a disconnect (a background drop / tab reload is what it recovers).
 * Single-valued: entering a second room REPLACES it, never accumulates a per-code entry.
 */
describe('NetSession — the activeNetworkedGame breadcrumb', () => {
  const OTHER_ROOM = 'QRSTUV';

  it('records the live room + game uuid on establish, and the ADOPTED uuid on the admitted peer', async () => {
    const hub = new MockRelayHub();
    const storeA = memoryStorage();
    const storeB = memoryStorage();
    const a = makeSession(hub, 'player-a', { storage: storeA });
    const b = makeSession(hub, 'player-b', { storage: storeB });

    await a.enter(ROOM, NEW);
    await b.enter(ROOM, DEFER);
    await flush();

    const crumbA = readActiveGame(storeA);
    expect(crumbA?.code).toBe(ROOM);
    expect(crumbA?.gameUuid).toBe(a.gameUuid());
    expect(typeof crumbA?.updatedAt).toBe('number');
    // The admitted peer's breadcrumb names the game it ADOPTED (A's uuid, which is also B's live game
    // after admission) — NOT the provisional game B minted before it was admitted.
    const crumbB = readActiveGame(storeB);
    expect(crumbB?.code).toBe(ROOM);
    expect(crumbB?.gameUuid).toBe(a.gameUuid());
    expect(crumbB?.gameUuid).toBe(b.gameUuid());
    expect(typeof crumbB?.updatedAt).toBe('number');
  });

  it('survives a disconnect (that is what a reload/return recovers from)', async () => {
    const hub = new MockRelayHub();
    const store = memoryStorage();
    const a = makeSession(hub, 'player-a', { storage: store });

    await a.enter(ROOM, NEW);
    const uuid = a.gameUuid();
    a.disconnect();
    await flush();

    expect(readActiveGame(store)).not.toBeNull();
    expect(readActiveGame(store)?.gameUuid).toBe(uuid);
    expect(readActiveGame(store)?.code).toBe(ROOM);
  });

  it('is SINGLE-VALUED: entering a second room REPLACES it (no per-code entry accumulates)', async () => {
    const hub = new MockRelayHub();
    const store = memoryStorage();
    const first = makeSession(hub, 'player-a', { storage: store });
    await first.enter(ROOM, NEW);
    const firstUuid = first.gameUuid();
    first.disconnect();
    await flush();

    const second = makeSession(hub, 'player-a', {
      storage: store,
      newMessageId: idSource('player-a-second'),
    });
    await second.enter(OTHER_ROOM, NEW);
    await flush();

    // Exactly ONE record, naming the CURRENT room + game. The prior room's game is not retrievable by
    // its code from anywhere — it lives in the archive by uuid, reachable from the games list (#37).
    expect(store.length).toBe(1);
    expect(readActiveGame(store)?.code).toBe(OTHER_ROOM);
    expect(readActiveGame(store)?.gameUuid).toBe(second.gameUuid());
    expect(readActiveGame(store)?.gameUuid).not.toBe(firstUuid);
  });

  it('is CLEARED when the game is DECIDED — a finished game is never offered to rejoin', async () => {
    const hub = new MockRelayHub();
    const storeA = memoryStorage();
    const storeB = memoryStorage();
    const a = makeSession(hub, 'player-a', { storage: storeA });
    const b = makeSession(hub, 'player-b', { storage: storeB });

    await a.enter(ROOM, NEW);
    await b.enter(ROOM, DEFER);
    await flush();
    expect(a.state().seat).toBe('white');
    expect(b.state().seat).toBe('black');

    // Play a REAL game to a white win: five white in a row along x while black builds elsewhere. Each
    // move crosses the mock relay, so both sessions fold the same authoritative log.
    const white = ['0,0,0', '1,0,0', '2,0,0', '3,0,0', '4,0,0'];
    const black = ['0,4,4', '1,4,4', '2,4,4', '3,4,4'];
    for (let i = 0; i < white.length; i++) {
      a.place(coordsOf(white[i]!));
      await flush();
      // The breadcrumb is REFRESHED while the game is live — proof the clear below is a real
      // transition, not a breadcrumb that was never written.
      if (i === 0) expect(readActiveGame(storeA)?.gameUuid).toBe(a.gameUuid());
      if (i < black.length) {
        b.place(coordsOf(black[i]!));
        await flush();
      }
    }

    // The game is genuinely decided on BOTH sides…
    expect(a.gameState()!.winner).toBe('white');
    expect(b.gameState()!.winner).toBe('white');
    // …and NEITHER browser keeps an "I am currently mid-game" claim.
    expect(readActiveGame(storeA)).toBeNull();
    expect(readActiveGame(storeB)).toBeNull();
  });
});

/**
 * ARBITER HANDOFF (design §2.4/§6.5): an ADMITTED peer (never the establisher) assumes the arbiter
 * role when its partner leaves and it becomes the sole resident, so a stranger cannot take a RESERVED
 * seat. Proof-by-observable-state: the stranger is rejected and stays offline; the reserved seat is
 * never handed out.
 */
describe('NetSession — an admitted peer arbitrates once its partner leaves (scenario 5)', () => {
  it('A drops; C enters claiming A’s spot → resident B refuses it, white stays RESERVED for A', async () => {
    const hub = new MockRelayHub();
    const dbA = await openDatabase(`net-handoff-a-${Math.random().toString(36).slice(2)}`);
    const dbB = await openDatabase(`net-handoff-b-${Math.random().toString(36).slice(2)}`);
    const dbC = await openDatabase(`net-handoff-c-${Math.random().toString(36).slice(2)}`);
    const a = makeSession(hub, 'player-a', { db: dbA });
    const b = makeSession(hub, 'player-b', { db: dbB });

    await a.enter(ROOM, NEW);
    await b.enter(ROOM, DEFER);
    await flush();
    expect(b.state().seat).toBe('black');
    // B is an ADMITTED peer, not the establisher — before the handoff it is not the arbiter.

    // A (the establisher/white) leaves. B is now the SOLE resident and must take over arbitration.
    a.disconnect();
    await flush();

    // C enters claiming a spot with `defer`. It owns neither seat; white is RESERVED for ABSENT A and
    // black is present B's → the resident B refuses C with the DISTINCT `seat-reserved` reason (a seat
    // held for its owner's return — design §6/§7 scenario 5), NOT the generic `room-full` (that is
    // scenario 1, where both owners are present). A dropped, so A is not in B's presence snapshot.
    const c = makeSession(hub, 'player-c', {
      db: dbC,
      newMessageId: idSource('player-c'),
    });
    await c.enter(ROOM, DEFER);
    await flush();

    expect(c.state().phase).toBe('offline');
    expect(c.state().seat).toBeNull();
    expect(c.lastRejectReason()).toBe('seat-reserved');
    // …and the DISTINCT `seat-reserved` reason ALSO surfaces on the user-facing `joinError` (design
    // §7): a seat-reserved reject is not silent, and it is not collapsed to the generic `room-full`
    // human message — the net panel shows the reason the arbiter actually gave.
    expect(c.state().joinError).toBe('seat-reserved');
    // B never handed out A's reserved white — the surviving resident still reserves it for player-a.
    expect(b.seatOwners()).toEqual({ white: 'player-a', black: 'player-b' });
  });
});

/**
 * The `current`/`resume` seed proposal (design §3): the establisher brings a CONCRETE game it already
 * holds. The bug this covers: `buildProvisionalSeat` used to mint a FRESH game whatever the proposal,
 * so the establisher's engine uuid differed from the uuid it published in its hello — and when a
 * deferring partner arrived, the arbiter's honesty guard reconciled to `existing{uuid: REAL}` but saw
 * its own provisional uuid ≠ REAL and REFUSED its own resume as `game-mismatch`. The fix seeds the
 * provisional from the real archived game named by the proposal's uuid, so the uuids agree and the
 * partner is admitted onto the resumed game.
 */
describe('NetSession — a `current` establisher resumes its real game and admits a deferrer (no game-mismatch)', () => {
  it('seeds the game the proposal names; a deferring partner adopts it, not a false game-mismatch', async () => {
    const hub = new MockRelayHub();
    const dbA = await openDatabase(`net-current-a-${Math.random().toString(36).slice(2)}`);
    const dbB = await openDatabase(`net-current-b-${Math.random().toString(36).slice(2)}`);

    // Seed A's archive with a real, non-empty game (a couple of moves) and capture its identity.
    const local = new Game(SIZE);
    local.place(coordsOf('0,0,0'));
    local.place(coordsOf('1,1,1'));
    const localUuid = local.uuid;
    const localHead = headHash(local.log);
    await saveGame(dbA, 'local-current', local, {
      players: {},
      result: 'in-progress',
      startedAt: 0,
    });

    const a = makeSession(hub, 'player-a', { db: dbA });
    const b = makeSession(hub, 'player-b', { db: dbB });

    // A enters proposing its CURRENT local board (by uuid + headHash). B defers.
    const CURRENT: Proposal = { kind: 'current', uuid: localUuid, headHash: localHead };
    await a.enter(ROOM, CURRENT);
    await flush();
    // A's engine holds the REAL game identity it proposed (not a fresh mint) — the crux of the fix.
    expect(a.gameUuid()).toBe(localUuid);
    expect(a.state().seat).toBe('white');

    await b.enter(ROOM, DEFER);
    await flush();

    // B is admitted onto black and ADOPTS A's resumed game — NOT rejected game-mismatch.
    expect(b.state().phase).toBe('connected');
    expect(b.lastRejectReason()).toBeNull();
    expect(b.state().seat).toBe('black');
    expect(b.gameUuid()).toBe(localUuid);
    // Both converged on the SAME resumed history (identical headHash after B adopted A's log).
    expect(a.gameUuid()).toBe(b.gameUuid());
    expect(a.seatOwners()).toEqual({ white: 'player-a', black: 'player-b' });
    expect(b.seatOwners()).toEqual({ white: 'player-a', black: 'player-b' });
  });
});

/**
 * WIRE-ENFORCED SEED SEMANTICS (V.2, epic #47 — design §3; fixes #46, #43, and #42's genesis half).
 *
 * The user's rule, verbatim: *"when selecting 'New Game', i would expect the laptop to never send
 * non-empty gamestate data and i would expect my phone to reject any non-empty gamestate data. only
 * 'Dealer's Choice' should allow a device to accept non-empty gamestate data from the other device."*
 *
 * These are the GLUE proofs that the pure matrix (`admission.ts`, unit+mutation-gated) is actually
 * WIRED to both ends of the relay: two real sessions on a shared {@link MockRelayHub} exchange real
 * admission traffic, and every assertion is on OBSERVABLE session state (phase / seat / game uuid /
 * board / typed reason) after the other client genuinely received it — never a log line.
 */
describe('NetSession — a `new` entry is never served a game WITH HISTORY (#46/#43)', () => {
  it('a resident whose board has MOVED ON refuses a `new` newcomer — typed, and it adopts nothing', async () => {
    const hub = new MockRelayHub();
    const dbA = await openDatabase(`net-seed-a-${Math.random().toString(36).slice(2)}`);
    const dbB = await openDatabase(`net-seed-b-${Math.random().toString(36).slice(2)}`);
    const dbC = await openDatabase(`net-seed-c-${Math.random().toString(36).slice(2)}`);
    const a = makeSession(hub, 'player-a', { db: dbA });
    const b = makeSession(hub, 'player-b', { db: dbB });

    // A establishes with `new` — a genuinely fresh, EMPTY game — then plays a move while it waits. Its
    // PROPOSAL is still `new`, but the bytes it now holds carry history: exactly the case the proposal
    // matrix alone cannot see, and exactly how a peer that asked for a fresh board used to be handed
    // someone else's game (#46).
    await a.enter(ROOM, NEW);
    await flush();
    a.place(coordsOf('0,0,0'));
    const residentUuid = a.gameUuid();
    expect(a.ply()).toBe(1);

    await b.enter(ROOM, NEW);
    await flush();

    // B chose New Game, so it is refused rather than dropped onto A's game in progress.
    expect(b.state().phase).toBe('offline');
    expect(b.lastRejectReason()).toBe('seed-refused');
    expect(b.state().joinError).toBe('seed-refused');
    // …and it adopted NOTHING: no game, no seat. (Before V.2 this was `connected` on A's board.)
    expect(b.gameUuid()).toBeNull();
    expect(b.state().seat).toBeNull();
    expect(b.gameState()).toBeNull();
    // A is untouched: same game, same single move, and the refused peer never took the black seat.
    expect(a.gameUuid()).toBe(residentUuid);
    expect(a.ply()).toBe(1);
    expect(a.seatOwners()).toEqual({ white: 'player-a', black: null });

    // CONTRAST — the room is not closed, the SEED was refused: a `defer` (dealer's choice) newcomer in
    // the very same room IS admitted onto that same played game, taking the still-free black seat.
    const c = makeSession(hub, 'player-c', { db: dbC, newMessageId: idSource('player-c') });
    await c.enter(ROOM, DEFER);
    await flush();
    expect(c.state().phase).toBe('connected');
    expect(c.lastRejectReason()).toBeNull();
    expect(c.state().seat).toBe('black');
    expect(c.gameUuid()).toBe(residentUuid);
    expect(c.ply()).toBe(1);
  });

  it('New vs Current: a resident that brought its LOCAL BOARD refuses a `new` newcomer', async () => {
    const hub = new MockRelayHub();
    const dbA = await openDatabase(`net-seed-cur-a-${Math.random().toString(36).slice(2)}`);
    const dbB = await openDatabase(`net-seed-cur-b-${Math.random().toString(36).slice(2)}`);

    // A carries a real, played local board into the room (the `current` seed).
    const local = new Game(SIZE);
    local.place(coordsOf('0,0,0'));
    local.place(coordsOf('1,1,1'));
    await saveGame(dbA, 'local-current', local, { players: {}, result: 'in-progress', startedAt: 0 });

    const a = makeSession(hub, 'player-a', { db: dbA });
    const b = makeSession(hub, 'player-b', { db: dbB });
    await a.enter(ROOM, { kind: 'current', uuid: local.uuid, headHash: headHash(local.log) });
    await flush();
    expect(a.gameUuid()).toBe(local.uuid);

    await b.enter(ROOM, NEW);
    await flush();

    // The user's sentence, mechanised: *"if i choose 'new game', but the other user chose to start with
    // loading their local board… we can't play; it throws an error because i opted for a new game."*
    expect(b.state().phase).toBe('offline');
    expect(b.lastRejectReason()).toBe('seed-refused');
    expect(b.state().joinError).toBe('seed-refused');
    expect(b.gameUuid()).toBeNull();
    // A keeps its own board — the refusal never rewound the resident either.
    expect(a.gameUuid()).toBe(local.uuid);
    expect(a.ply()).toBe(2);
  });

  it('the MIRROR: a `new` resident refuses a newcomer that brings a RESUMED game', async () => {
    const hub = new MockRelayHub();
    const dbA = await openDatabase(`net-seed-mir-a-${Math.random().toString(36).slice(2)}`);
    const dbB = await openDatabase(`net-seed-mir-b-${Math.random().toString(36).slice(2)}`);

    // B holds a real archived game it wants to resume; A is hosting a fresh New Game.
    const prior = new Game(SIZE);
    prior.place(coordsOf('2,2,2'));
    await saveGame(dbB, 'prior', prior, { players: {}, result: 'in-progress', startedAt: 0 });

    const a = makeSession(hub, 'player-a', { db: dbA });
    const b = makeSession(hub, 'player-b', { db: dbB });
    await a.enter(ROOM, NEW);
    await flush();
    const freshUuid = a.gameUuid();

    await b.enter(ROOM, { kind: 'resume', uuid: prior.uuid, headHash: headHash(prior.log) });
    await flush();

    // A chose New Game: it must never ACCEPT B's game either (the "never send / never accept" rule is
    // symmetric), so B is refused instead of A silently adopting the resumed board.
    expect(b.state().phase).toBe('offline');
    expect(b.lastRejectReason()).toBe('seed-refused');
    expect(b.state().joinError).toBe('seed-refused');
    // A still holds its OWN fresh, EMPTY game — B's history never crossed into it.
    expect(a.gameUuid()).toBe(freshUuid);
    expect(a.ply()).toBe(0);
    expect(a.seatOwners()).toEqual({ white: 'player-a', black: null });
  });

  it('BACKSTOP: a `new` peer refuses a played game pushed by a NON-ENFORCING arbiter', async () => {
    // The threat model (design §5): the relay cannot referee and a peer may be older or modified, so a
    // client must enforce its own seed on RECEIPT — not merely trust that the arbiter checked. Here a
    // rogue peer publishes a perfectly well-formed `admit` carrying a game WITH HISTORY to a session
    // that entered with `new`; the session must refuse it, not adopt it.
    const hub = new MockRelayHub();
    const b = makeSession(hub, 'player-b', { settleMs: 200 });

    const rogueTransport = new MockTransport(hub, 'player-rogue');
    await rogueTransport.connect(ROOM);
    const pushed = new Game(SIZE);
    pushed.place(coordsOf('0,0,0'));
    pushed.place(coordsOf('1,1,1'));

    // Kick the entry (connect + hello happen inside), then push the admit while B is still `connecting`.
    const entering = b.enter(ROOM, NEW);
    await flush();
    expect(b.state().phase).toBe('connecting');
    rogueTransport.publish(
      toAdmitMessage('rogue-admit-1', toSyncMessage(pushed.log, 0), {
        white: 'player-rogue',
        black: 'player-b',
      }),
    );
    await entering;

    // Refused on our own authority, with the honest typed reason — and NOT seated, though the admit
    // offered us black.
    expect(b.state().phase).toBe('offline');
    expect(b.lastRejectReason()).toBe('seed-refused');
    expect(b.state().joinError).toBe('seed-refused');
    expect(b.state().seat).toBeNull();
    expect(b.gameUuid()).toBeNull();
    // The pushed game's identity never became ours.
    expect(b.gameState()).toBeNull();
  });

  it('CONTROL for the backstop: the SAME pushed admit carrying an EMPTY game IS adopted', async () => {
    // Proves the refusal above is the SEED rule biting on the game's HISTORY — not the session simply
    // refusing every hand-crafted admit (which would make the test above prove nothing).
    const hub = new MockRelayHub();
    const b = makeSession(hub, 'player-b', { settleMs: 200 });
    const rogueTransport = new MockTransport(hub, 'player-rogue');
    await rogueTransport.connect(ROOM);
    const fresh = new Game(SIZE);

    const entering = b.enter(ROOM, NEW);
    await flush();
    rogueTransport.publish(
      toAdmitMessage('rogue-admit-2', toSyncMessage(fresh.log, 0), {
        white: 'player-rogue',
        black: 'player-b',
      }),
    );
    await entering;

    expect(b.state().phase).toBe('connected');
    expect(b.lastRejectReason()).toBeNull();
    expect(b.state().seat).toBe('black');
    expect(b.gameUuid()).toBe(fresh.uuid);
    expect(b.ply()).toBe(0);
  });
});

/**
 * BOTH peers pick New Game → ONE shared game uuid AT GENESIS (#42). The v3 behaviour "converges on the
 * first move" is not the fix: two empty games with different genesis uuids are two DIFFERENT games
 * whose logs can never be prefixes of one another. The deterministic initiator election settles which
 * genesis wins before a single move exists. (The SIMULTANEOUS-arrival half is proven in the election
 * describe above; this is the sequential resident/newcomer half.)
 */
describe('NetSession — both peers pick `new` → one shared game at genesis (#42)', () => {
  it('the newcomer adopts the resident’s FRESH EMPTY game: one uuid, two distinct seats, ply 0', async () => {
    const hub = new MockRelayHub();
    const dbA = await openDatabase(`net-bothnew-a-${Math.random().toString(36).slice(2)}`);
    const dbB = await openDatabase(`net-bothnew-b-${Math.random().toString(36).slice(2)}`);
    const a = makeSession(hub, 'player-a', { db: dbA });
    const b = makeSession(hub, 'player-b', { db: dbB });

    await a.enter(ROOM, NEW);
    await flush();
    const genesis = a.gameUuid();
    expect(genesis).not.toBeNull();

    await b.enter(ROOM, NEW);
    await flush();

    // ONE game identity across both peers, from genesis — no move was ever played.
    expect(b.state().phase).toBe('connected');
    expect(b.gameUuid()).toBe(genesis);
    expect(a.ply()).toBe(0);
    expect(b.ply()).toBe(0);
    // Two DISTINCT seat owners, both real playerIds, agreed on by both sides (no double-white, #31).
    expect(a.seatOwners()).toEqual({ white: 'player-a', black: 'player-b' });
    expect(b.seatOwners()).toEqual({ white: 'player-a', black: 'player-b' });
    expect(a.state().seat).toBe('white');
    expect(b.state().seat).toBe('black');

    // And the shared genesis is REAL, not cosmetic: a move by white lands on the peer's board, which
    // only works because both sides hold the same hash chain (a per-peer genesis would fork instead).
    a.place(coordsOf('0,0,0'));
    expect(b.ply()).toBe(1);
    expect(b.gameState()?.pieces['0,0,0']).toBe('white');
  });
});

/**
 * SEEDING A GAME THIS BROWSER OWNS NO SEAT IN (V.1 review round 4) — the honest outcomes for a
 * `resume`/`current` proposal and for a breadcrumb, where the game IS in our archive but its
 * identity-owned seat map owns BOTH seats for other playerIds (design §2.3: absence never vacates
 * ownership). Reachable for real: `pente:playerId` lives in localStorage while the games live in
 * IndexedDB, so losing the former (cleared site data, a fresh profile) while keeping the latter puts
 * this browser in front of games it can no longer sit down at.
 *
 * Neither path may THROW: `enter()` is called as `void session.enter(...).then(refreshUi)` in the app,
 * so a rejected promise is unhandled — the session would be left reporting `phase: 'connecting'`
 * forever with no reason anywhere, a readout that LIES about what is happening.
 */
describe('NetSession — a seed whose seats belong to OTHER identities (no throw, no wedge)', () => {
  /** A 3-move game archived UNDER ITS UUID whose seats are owned by two OTHER playerIds. */
  async function seedForeignOwnedGame(into: IDBDatabase): Promise<Game> {
    const g = new Game(SIZE);
    g.place(coordsOf('0,0,0'));
    g.place(coordsOf('1,1,1'));
    g.place(coordsOf('2,2,2'));
    await saveGame(into, g.uuid, g, {
      players: { white: 'player-OLD', black: 'player-OTHER' },
      result: 'in-progress',
      startedAt: 0,
      seats: { white: 'player-OLD', black: 'player-OTHER' },
    });
    return g;
  }

  it('a RESUME of it is refused with the seat manager’s typed reason — offline, never connecting', async () => {
    const hub = new MockRelayHub();
    const own = await openDatabase(`net-foreign-resume-${Math.random().toString(36).slice(2)}`);
    const prior = await seedForeignOwnedGame(own);

    const a = makeSession(hub, 'player-NEW', { db: own, storage: memoryStorage() });
    await a.enter(ROOM, { kind: 'resume', uuid: prior.uuid, headHash: headHash(prior.log) });
    await flush();

    // OFFLINE with the honest reason on the USER-FACING state (design §7) — both seats are owned by
    // absent players, so the seat manager's `seat-reserved` is exactly what happened.
    expect(a.state().phase).toBe('offline');
    expect(a.state().joinError).toBe('seat-reserved');
    expect(a.state().seat).toBeNull();
    expect(a.gameUuid()).toBeNull();
    // Not an ARBITER reject: nobody refused us over the relay, so the typed admission readout stays
    // null rather than claiming a reject that never crossed the wire.
    expect(a.lastRejectReason()).toBeNull();
    // The transport was never even connected — we refused before touching the relay, so the room has
    // no phantom peer sitting in it.
    expect(hub.peerIds(ROOM)).toEqual([]);
  });

  it('a DEFER whose BREADCRUMB names it degrades to a fresh game (the honest degrade it promises)', async () => {
    const hub = new MockRelayHub();
    const own = await openDatabase(`net-foreign-defer-${Math.random().toString(36).slice(2)}`);
    const store = memoryStorage();
    const prior = await seedForeignOwnedGame(own);
    writeActiveGame({ code: ROOM, gameUuid: prior.uuid, updatedAt: 0 }, store);

    // A `defer` did not ASK for that game — the breadcrumb is a hint about what we were last doing, so
    // an unusable hint brings an EMPTY game rather than refusing an entry aimed at no game in
    // particular (the same degrade a breadcrumb naming a game we no longer hold takes).
    const a = makeSession(hub, 'player-NEW', { db: own, storage: store });
    await a.enter(ROOM, DEFER);
    await a.whenPersisted();
    await flush();

    expect(a.state().phase).toBe('connected');
    expect(a.state().joinError).toBeNull();
    expect(a.gameUuid()).not.toBe(prior.uuid);
    expect(Object.keys(a.gameState()!.pieces).length).toBe(0);
    // A genuinely fresh game: first-available white on an EMPTY map, not the foreign owners' map.
    expect(a.state().seat).toBe('white');
    expect(a.seatOwners()).toEqual({ white: 'player-NEW', black: null });
  });
});

/**
 * THE BREADCRUMB'S JS-VAR HALF (design §2 "Dual-tracked: localStorage for reload recovery, a JS var
 * for the live session — the JS var survives a win so the rematch flow works").
 *
 * The regression this pins: with only the localStorage half implemented (cleared on the winning move),
 * a peer that dropped after a decided game and returned established a BRAND-NEW empty game and
 * ORPHANED the finished one — the #40 empty-room facet, and the state the rematch flow needs.
 */
describe('NetSession — a return after a WIN recovers the finished game (design §2 dual-tracking)', () => {
  it('the live session re-seeds the DECIDED game on return, while localStorage still offers nothing', async () => {
    const hub = new MockRelayHub();
    const dbA = await openDatabase(`net-postwin-a-${Math.random().toString(36).slice(2)}`);
    const dbB = await openDatabase(`net-postwin-b-${Math.random().toString(36).slice(2)}`);
    const storeA = memoryStorage();
    const storeB = memoryStorage();
    const a = makeSession(hub, 'player-a', { db: dbA, storage: storeA });
    const b = makeSession(hub, 'player-b', { db: dbB, storage: storeB });

    await a.enter(ROOM, NEW);
    await b.enter(ROOM, DEFER);
    await flush();
    expect(a.state().seat).toBe('white');
    expect(b.state().seat).toBe('black');

    // A REAL networked white five-in-a-row over the mock relay (black builds elsewhere, no captures).
    const white = ['0,0,0', '1,0,0', '2,0,0', '3,0,0', '4,0,0'];
    const black = ['0,4,4', '1,4,4', '2,4,4', '3,4,4'];
    for (let i = 0; i < white.length; i++) {
      a.place(coordsOf(white[i]!));
      await flush();
      if (i < black.length) {
        b.place(coordsOf(black[i]!));
        await flush();
      }
    }
    await a.whenPersisted();
    const wonUuid = a.gameUuid();
    expect(a.gameState()!.winner).toBe('white');
    // The reload half is CLEARED by the win (a finished game must not be offered to a fresh boot)…
    expect(readActiveGame(storeA)).toBeNull();

    // BOTH peers drop after the win (nobody proposed a rematch yet), then A returns to the room.
    a.disconnect();
    b.disconnect();
    await flush();
    await a.enter(ROOM, DEFER);
    await a.whenPersisted();
    await flush();

    // …yet THIS session's return lands back on the game it just finished: same identity, the full
    // nine-piece board, the white seat it owned, and the result still visible. Before the JS-var half
    // existed this was a fresh empty game with a different uuid and the win orphaned.
    expect(a.state().phase).toBe('connected');
    expect(a.gameUuid()).toBe(wonUuid);
    expect(Object.keys(a.gameState()!.pieces).length).toBe(9);
    expect(a.gameState()!.winner).toBe('white');
    expect(a.state().seat).toBe('white');
    expect(a.seatOwners()).toEqual({ white: 'player-a', black: 'player-b' });
    // The localStorage half is STILL empty — re-establishing a decided game must not resurrect the
    // "I am currently mid-game" claim a reload would act on.
    expect(readActiveGame(storeA)).toBeNull();
  });
});

/**
 * ONE GAME, ONE LISTED RECORD — the reachable `current`-seed path (V.1 review round 4, design §2 "the
 * UUID-keyed archive is the source of truth").
 *
 * Carrying a played local board into a room genuinely writes TWO records: the app already archived
 * that board under its own autosave id, and the session then persists the SAME game under the game's
 * uuid (with the identity-owned seat map). This drives the real seam — a `current` entry over the mock
 * relay — and asserts the games list shows the game ONCE, as the canonical record. Listing both would
 * offer the player two entries for one game, the seat-less one being a stale fork of it.
 */
describe('NetSession — a `current`-seeded game is ONE entry in the games list, not two', () => {
  it('the played board carried into a room lists once, keyed by its uuid, with its seat map', async () => {
    const hub = new MockRelayHub();
    const own = await openDatabase(`net-current-listing-${Math.random().toString(36).slice(2)}`);

    // What the app leaves behind for a PLAYED local board before a net start: the game archived under
    // the app's autosave id (`archiveResetBeforeStart` → the lifecycle's finalize).
    const local = new Game(SIZE);
    local.place(coordsOf('0,0,0'));
    local.place(coordsOf('1,1,1'));
    await saveGame(own, 'app-autosave-id', local, {
      players: { white: 'You', black: 'You' },
      result: 'in-progress',
      startedAt: 1,
    });

    const a = makeSession(hub, 'player-a', { db: own, storage: memoryStorage() });
    await a.enter(ROOM, { kind: 'current', uuid: local.uuid, headHash: headHash(local.log) });
    await a.whenPersisted();
    await flush();
    expect(a.gameUuid()).toBe(local.uuid); // the session really is running THAT game

    // Both records exist in the store (the session wrote the canonical one)…
    expect(await getGame(own, 'app-autosave-id')).not.toBeUndefined();
    expect(await getGame(own, local.uuid)).not.toBeUndefined();
    // …and the games list shows the game ONCE: the canonical uuid-keyed record, seat map intact.
    const list = await listArchivedGames(own);
    expect(list.filter((l) => l.meta.uuid === local.uuid).map((l) => l.id)).toEqual([local.uuid]);
    expect(list[0]!.meta.seats).toEqual({ white: 'player-a', black: null });
  });
});

/**
 * A seed we cannot LOAD (V.1 review round 4): the archived record the proposal/breadcrumb names holds a
 * corrupt or illegal log, so reconstructing it fails. That is a genuine FAILURE, not a refusal — the
 * `ArchiveError` must reach the caller VERBATIM (never masked, never relabelled as a seat/connect
 * reason) while the session state stays HONEST about where it ended up: `offline`, with no phantom
 * `connecting` phase and no transport left in the room.
 */
describe('NetSession — a seed whose archived log is CORRUPT fails honestly (no phantom connecting)', () => {
  it('propagates the ArchiveError verbatim and leaves the session offline, out of the room', async () => {
    const hub = new MockRelayHub();
    const own = await openDatabase(`net-corrupt-seed-${Math.random().toString(36).slice(2)}`);
    // A record whose stored log is ILLEGAL: two placements on the SAME node (the rules engine refuses
    // the second), so folding it throws — exactly what a truncated/tampered record does.
    const corruptUuid = 'corrupt-seed-uuid';
    await putGame(own, {
      id: corruptUuid,
      log: [
        { type: 'place', node: '0,0,0' },
        { type: 'place', node: '0,0,0' },
      ],
      meta: {
        players: {},
        result: 'in-progress',
        startedAt: 0,
        uuid: corruptUuid,
        headHash: 'unused-on-load',
      },
    });

    const a = makeSession(hub, 'player-a', { db: own, storage: memoryStorage() });
    await expect(
      a.enter(ROOM, { kind: 'resume', uuid: corruptUuid, headHash: 'whatever' }),
    ).rejects.toThrow(ArchiveError);

    // The failure is honest in the STATE too: offline, unseated, and the room holds no phantom peer
    // (we never connected a transport).
    expect(a.state().phase).toBe('offline');
    expect(a.state().seat).toBeNull();
    expect(a.gameUuid()).toBeNull();
    expect(hub.peerIds(ROOM)).toEqual([]);
    // …AND the player is TOLD (V.2, carried over from the V.1 review): before, this path reset to
    // offline with `joinError: null`, so the panel repainted to a plain offline state and the person who
    // pressed Enter learned nothing at all. It now carries its OWN typed reason — not one of the wire
    // reject reasons it is not, and not the `connect-failed` of a transport that was never touched —
    // which the pure `deriveNet` turns into human copy (netModel.test.ts).
    expect(a.state().joinError).toBe('seed-unreadable');
    // …and it stays a LOCAL failure: `lastRejectReason` is the ARBITER's typed refusal, and nobody
    // refused us (nothing was even published), so it must remain null. Reporting a local read failure
    // as a peer's reject would point the diagnosis at the wrong machine.
    expect(a.lastRejectReason()).toBeNull();
  });
});

/**
 * THE ARCHIVED `startedAt` — ONE date per GAME, established once and never re-minted (V.1 review).
 *
 * `startedAt` is the date the archive browser renders for a game and the key
 * {@link listArchivedGames} sorts newest-first by — and since V.1 the uuid-keyed record it lives on is
 * the SOLE user-facing record of a networked game, reached through the games list (design §10, #37).
 * Two regressions are pinned here, both invisible to every other gate:
 *
 *  1. RE-STAMPING PER MOVE. The session persists on every engine change, so a stamp minted per write
 *     would re-date the record on every move and keep shuffling it to the top of the listing.
 *  2. RE-DATING A GAME WE RETURN TO. `startedAtFor` mints from the clock for any uuid it has no stamp
 *     for, so without {@link NetSession.primeStartedAts} the FIRST persist after a return overwrote the
 *     archived date with `now()` — permanently, and visibly, since the record is what the player sees.
 *     Both the breadcrumb-return path and the wire-adopt path are covered.
 */
describe('NetSession — the archived startedAt is the GAME’s date, not the writing session’s clock', () => {
  /** The `meta.startedAt` currently stored for `uuid`, read straight out of the store. */
  async function storedStartedAt(from: IDBDatabase, uuid: string): Promise<number | undefined> {
    return (await getGame(from, uuid))?.meta.startedAt;
  }

  it('is stamped ONCE per game — three moves later the record still carries the FIRST stamp', async () => {
    const hub = new MockRelayHub();
    const own = await openDatabase(`net-stamp-once-${Math.random().toString(36).slice(2)}`);
    // A MOVING clock: every read returns a later value, so a per-write stamp would be observably
    // different on each persist (a frozen clock could not tell the two behaviours apart).
    let clock = 5_000;
    const a = makeSession(hub, 'player-a', {
      db: own,
      storage: memoryStorage(),
      now: () => clock++,
    });

    await a.enter(ROOM, NEW);
    await a.whenPersisted();
    const uuid = a.gameUuid()!;
    const first = await storedStartedAt(own, uuid);
    expect(first).not.toBeUndefined();
    expect(a.gameStartedAt()).toBe(first);

    // Three real moves, each of which persists the record again (the per-change autosave).
    for (const node of ['0,0,0', '1,1,1', '2,2,2']) {
      a.place(coordsOf(node));
      await flush();
    }
    await a.whenPersisted();

    // The record genuinely WAS re-written (its history grew to 3 events)…
    const listing = (await listArchivedGames(own)).find((l) => l.id === uuid)!;
    expect(listing.events).toBe(3);
    // …and yet its date is UNCHANGED — the stamp is the game's, not each write's. The clock has moved
    // on by now, so a re-stamping session would fail this.
    expect(await storedStartedAt(own, uuid)).toBe(first);
    expect(a.gameStartedAt()).toBe(first);
    expect(clock).toBeGreaterThan(first! + 1); // the clock really did advance past the stamp
  });

  it('a genuinely NEW game IS stamped from the clock (the control: priming suppresses no mint)', async () => {
    const hub = new MockRelayHub();
    const own = await openDatabase(`net-stamp-mint-${Math.random().toString(36).slice(2)}`);
    const a = makeSession(hub, 'player-a', {
      db: own,
      storage: memoryStorage(),
      now: () => 4_242_000,
    });

    await a.enter(ROOM, NEW);
    await a.whenPersisted();

    // A game this browser has never held gets TODAY's date — the mint path is alive.
    expect(await storedStartedAt(own, a.gameUuid()!)).toBe(4_242_000);
  });

  it('a breadcrumb RETURN preserves the archived startedAt (never re-dates the game to now)', async () => {
    const hub = new MockRelayHub();
    const own = await openDatabase(`net-stamp-return-${Math.random().toString(36).slice(2)}`);
    const store = memoryStorage();
    // The precondition a real prior session leaves: a 3-move game archived under its uuid with the date
    // it BEGAN, plus a fresh breadcrumb naming it. `NOW` is a much later clock — the return is happening
    // long after the game started (but inside the breadcrumb's credibility horizon).
    const BEGAN_AT = 1_000_000;
    const NOW = 999_000_000;
    const prior = new Game(SIZE);
    prior.place(coordsOf('0,0,0'));
    prior.place(coordsOf('1,1,1'));
    prior.place(coordsOf('2,2,2'));
    await saveGame(own, prior.uuid, prior, {
      players: {},
      result: 'in-progress',
      startedAt: BEGAN_AT,
      seats: { white: 'player-a', black: 'player-b' },
    });
    writeActiveGame({ code: ROOM, gameUuid: prior.uuid, updatedAt: NOW }, store);

    const a = makeSession(hub, 'player-a', { db: own, storage: store, now: () => NOW });
    await a.enter(ROOM, DEFER);
    await a.whenPersisted();
    await flush();
    // Sanity: we really did return to THAT game (else the assertions below would be about a fresh one).
    expect(a.gameUuid()).toBe(prior.uuid);

    // The return re-persisted the record (that is how a returner's seat map + log stay current) — and
    // a further move re-persists it again — yet the date it BEGAN at survives both writes.
    a.place(coordsOf('3,3,3'));
    await flush();
    await a.whenPersisted();
    expect((await listArchivedGames(own)).find((l) => l.id === prior.uuid)!.events).toBe(4);
    expect(await storedStartedAt(own, prior.uuid)).toBe(BEGAN_AT);
    expect(a.gameStartedAt()).toBe(BEGAN_AT);
    // The user-facing consequence: the games list still dates the game when it began, so returning to
    // it does not shuffle it to the top of the newest-first listing.
    expect((await listArchivedGames(own))[0]!.meta.startedAt).toBe(BEGAN_AT);
  });

  it('a game ADOPTED from the arbiter keeps the date THIS browser archived it with', async () => {
    const hub = new MockRelayHub();
    const dbA = await openDatabase(`net-stamp-adopt-a-${Math.random().toString(36).slice(2)}`);
    const dbB = await openDatabase(`net-stamp-adopt-b-${Math.random().toString(36).slice(2)}`);
    const BEGAN_AT = 777_000;
    // The shared game both browsers hold from an earlier sitting, with its identity-owned seat map.
    const shared = new Game(SIZE);
    shared.place(coordsOf('0,0,0'));
    shared.place(coordsOf('1,1,1'));
    const seats = { white: 'player-a', black: 'player-b' };
    for (const into of [dbA, dbB]) {
      await saveGame(into, shared.uuid, shared, {
        players: {},
        result: 'in-progress',
        startedAt: BEGAN_AT,
        seats,
      });
    }

    // A RESUMES the game (arbiter). B has NO breadcrumb, so it enters "dealer's choice" with a fresh
    // provisional and receives the shared game over the wire in A's admit — the adopt path, which never
    // touches `seedFromUuid`.
    const a = makeSession(hub, 'player-a', { db: dbA, storage: memoryStorage(), now: () => 999_000_000 });
    const b = makeSession(hub, 'player-b', { db: dbB, storage: memoryStorage(), now: () => 999_000_000 });
    await a.enter(ROOM, { kind: 'resume', uuid: shared.uuid, headHash: headHash(shared.log) });
    await b.enter(ROOM, DEFER);
    await flush();
    await a.whenPersisted();
    await b.whenPersisted();

    // B really did adopt A's game (not a fresh one), and its OWN archive still dates that game when it
    // began — the adopting peer does not re-date a game it already holds either.
    expect(b.gameUuid()).toBe(shared.uuid);
    expect(b.state().seat).toBe('black');
    expect(await storedStartedAt(dbB, shared.uuid)).toBe(BEGAN_AT);
    expect(b.gameStartedAt()).toBe(BEGAN_AT);
    // …and so does the arbiter's, via the resume/seed path.
    expect(await storedStartedAt(dbA, shared.uuid)).toBe(BEGAN_AT);
    expect(a.gameStartedAt()).toBe(BEGAN_AT);
  });
});
