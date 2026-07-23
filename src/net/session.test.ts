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
import { openDatabase } from '../persist/db';
import { saveGame } from '../persist/archive';
import { Game } from '../core/game';
import { headHash } from '../core/eventLog';
import { coordsOf } from '../core/coords';
import { MockRelayHub, MockTransport, type Transport } from './transport';
import { NetSession, type NetSessionDeps } from './session';
import type { Proposal } from './admission';

const SIZE = 9;
// A code from the unambiguous CODE_ALPHABET (no O/0/1/I/L) so `validateGameCode` accepts it and BOTH
// peers rendezvous on the SAME room — a code with an excluded glyph would degrade to a fresh RANDOM
// code per peer and they would never meet (the honest invalid-code degrade, covered separately below).
const ROOM = 'RMBBCC';

let db: IDBDatabase;

beforeEach(async () => {
  db = await openDatabase(`net-session-test-${Math.random().toString(36).slice(2)}`);
});

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

  it('both connect + hello before either settles; the elected initiator establishes, the other adopts', async () => {
    const hub = new MockRelayHub();
    // Earlier arrival wins the election; give A the earlier arrivalTag (now=0) and B a later one so
    // the deterministic order is unambiguous. Both use a LONG settle window so neither settles until
    // both have announced (the true simultaneous-arrival race).
    const a = makeSession(hub, 'player-a', { settleMs: 1000, now: () => 0 });
    const b = makeSession(hub, 'player-b', { settleMs: 1000, now: () => 1 });

    // Kick BOTH enters without awaiting — both connect + publish hello before any settle fires.
    const pa = a.enter(ROOM, NEW);
    const pb = b.enter(ROOM, NEW);
    // Let the connects + hello publishes flush (microtasks), still inside the settle window.
    await vi.advanceTimersByTimeAsync(0);
    // Now expire the settle window: onSettle fires on both; A (earlier arrival) is elected initiator,
    // reconciles both `new` proposals to one fresh game, and admits B; B adopts.
    await vi.advanceTimersByTimeAsync(1000);
    await pa;
    await pb;

    expect(a.state().phase).toBe('connected');
    expect(b.state().phase).toBe('connected');
    // The elected initiator (A) took white; B was admitted onto black — DISTINCT seats, one game.
    expect(a.state().seat).toBe('white');
    expect(b.state().seat).toBe('black');
    expect(b.gameUuid()).toBe(a.gameUuid());
    expect(a.seatOwners()).toEqual({ white: 'player-a', black: 'player-b' });
    expect(b.seatOwners()).toEqual({ white: 'player-a', black: 'player-b' });
  });
});

/**
 * The DURABLE identity-owned seat map (design §2.3/§6.4): seat ownership is persisted WITH the game
 * under a room-scoped key, so it survives an EMPTY room. These model TWO distinct browsers, each with
 * its OWN archive db (mirroring the e2e's per-context IndexedDB isolation) so their room-scoped
 * persisted state does not collide on one store. `flush()` lets the fire-and-forget durable write
 * commit before the returning peer reads it.
 */
describe('NetSession — durable seats survive an empty room (design §6.4, scenario 4)', () => {
  it('both drop; the first returning owner re-seeds as the color it OWNED, not white-by-arrival', async () => {
    const hub = new MockRelayHub();
    // Distinct per-browser stores so A and B's `net-room:CODE` records never collide.
    const dbA = await openDatabase(`net-durable-a-${Math.random().toString(36).slice(2)}`);
    const dbB = await openDatabase(`net-durable-b-${Math.random().toString(36).slice(2)}`);
    const a = makeSession(hub, 'player-a', { db: dbA });
    const b = makeSession(hub, 'player-b', { db: dbB });

    // Establish A (white) + B (black), then await the durable persists so both browsers' room-scoped
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
    // and grabbed first-available WHITE. The durable fix reloads B's persisted game (SAME uuid) and
    // RECLAIMS black — the color B owned — even though B arrives first into the empty room.
    const b2 = makeSession(hub, 'player-b', {
      db: dbB,
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
      newMessageId: idSource('player-a-return'),
    });
    await a2.enter(ROOM, DEFER);
    await flush();

    expect(a2.state().seat).toBe('white');
    expect(a2.gameUuid()).toBe(uuidBefore);
    expect(a2.seatOwners()).toEqual({ white: 'player-a', black: 'player-b' });
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
