/**
 * REAL-RELAY two-client integration test for the sync engine (build plan Task 3.3).
 *
 * This is the proof-by-behavior that the whole networking stack works end-to-end
 * over the **live** MQTT relay (agent-principles #3: proof is the *other* client
 * actually receiving the move over the real relay, never a log line). It stands up
 * two independent {@link SyncEngine}s, each driving a real {@link MqttTransport}
 * that connects **outbound over `wss://`** to the Mosquitto broker configured in the
 * SSOT `relay.json`, in a **unique room per run**, and asserts on the peers' derived
 * game state:
 *
 *   1. **Bidirectional convergence** — a move on A appears on B and vice-versa; both
 *      logs reach an identical `headHash`.
 *   2. **Replay idempotency** — re-publishing an older/equal full-state message is a
 *      no-op (the receiver does not move backward).
 *   3. **The NARROW fast-forward** (v3.1, design §5) — on ONE game, a peer that is
 *      exactly ONE move behind catches up automatically, whatever order the messages
 *      arrive in, while a LONGER lead is never adopted: it is reported as a divergence
 *      for the players to resolve. (Until v3.1 this guarantee read "converges to the
 *      longest valid log regardless of order" — the blanket adopt the remodel removed.)
 *   4. **Conflict detection** — two forked histories are detected as a conflict and
 *      stop the game.
 *
 * Unlike the pure unit tests (which use a `MockRelayHub`), nothing here is mocked:
 * the mqtt.js client is the real one and the bytes cross the network. The test uses
 * a fresh random room each run and disconnects both clients in `afterEach`, so it
 * leaves no retained state behind on the broker.
 *
 * If the relay is unreachable (offline / CI without egress) the whole suite is
 * **skipped** via {@link describe.skipIf} rather than failing — a live-network test
 * must not turn a network outage into a red build. Crucially it is a *real* vitest
 * SKIP (reported as skipped, never a green pass): an unreachable relay used to be a
 * silent `if (!reachable) return` early-return, which vitest counts as PASSED with
 * zero assertions — a false-green that would hide a live-connectivity regression on
 * any host without egress. The reachability probe runs at module-collection time
 * (top-level await, below) so `describe.skipIf` sees the real answer. When it runs,
 * every assertion is real (agent-principles #2/#3: proof = observable behavior, and
 * an unproven path must not report green).
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import mqtt from 'mqtt';
import { Game } from '../core/game';
import { headHash } from '../core/eventLog';
import { openDatabase } from '../persist/db';
import { getConfig } from '../config/config';
import { hostEnv, relaySkipReason, resolveRelay } from '../config/relayEnv';
import { loadConflicted } from '../persist/archive';
import { MqttTransport, type MqttConnectFn } from './mqttTransport';
import { SyncEngine, toSyncMessage } from './sync';
import type { Proposal } from './admission';
import type { RelayConfig } from '../config/config';

/**
 * The relay this run talks to: the SSOT `relay.json` the client transport uses, resolved for a NODE
 * process (`src/config/relayEnv.ts`) — `PENTE_*` env first, then the tracked config, then the live
 * deployed relay. Without that last step this whole suite was dark in every checkout: `relay.json`
 * ships blank (the deploy writes it) and node has no `localStorage` to carry an override, so the
 * probe below was dialling the empty string and every test skipped even with working egress.
 */
const relay = resolveRelay(getConfig('relay') as RelayConfig, hostEnv());

/** Real mqtt.js factory: opens an actual outbound wss connection to the broker. */
const realConnect: MqttConnectFn = (url, opts) =>
  mqtt.connect(url, opts) as unknown as ReturnType<MqttConnectFn>;

/** How long to wait for the relay to accept a connection before declaring it down. */
/**
 * These real-relay tests are about MESSAGES CROSSING A LIVE BROKER, not about the design §3 seed gate:
 * dealer's choice is the one seed that imposes no game-identity constraint, so it leaves the engine's
 * adoption behaviour exactly as it is. The gate is unit-tested against real `new`/`resume` seeds in
 * `sync.test.ts`.
 */
const ANY_SEED: Proposal = { kind: 'defer' };

const CONNECT_PROBE_MS = 10_000;
/** How long to wait for a message to propagate across the live relay. */
const PROPAGATE_MS = 6_000;

/** Resolve after `ms`. */
const delay = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * Poll `predicate` until true or `timeoutMs` elapses. Returns whether it became
 * true. Used to wait on the *other* client's observed state, never on a log.
 */
async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await delay(50);
  }
  return predicate();
}

/**
 * Like {@link waitFor}, but RE-PUBLISHES `engine`'s current full log on each poll
 * tick until `predicate` (the *other* client's observed state) holds.
 *
 * This defeats a live-relay subscription race that is NOT a bug in the sync engine
 * and must not turn a slow-but-reachable broker into a false-RED build: `connect()`
 * publishes onto the **non-retained** `/events` topic the instant it connects, but
 * the peer's broker-side subscription is only guaranteed active after its own
 * `connect()` resolves — a move published in that window is silently dropped by the
 * broker (no retention, no subscriber yet). The conflict test documents and works
 * around this exact race manually (each side re-publishes its fork once both are
 * subscribed); this helper generalises the same handshake for the convergence and
 * replay tests. Re-publishing an already-delivered log is a proven no-op on the
 * receiver (replay-idempotent by design — `reconcile` reports `in-sync` on an equal head), so the
 * assertion stays genuine: it still requires the *other* client to actually receive
 * the move over the real relay (agent-principles #3), it just stops a dropped-in-the-
 * subscription-gap first publish from producing a false red.
 */
async function waitForWithRepublish(
  engine: { publishState(): void },
  predicate: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    engine.publishState();
    await delay(200);
  }
  return predicate();
}

/**
 * Probe the live relay once. Resolves `true` when the broker accepted a connection, else the
 * failure AS OBSERVED — the message is carried out, not discarded, so the skip line can quote what
 * actually happened instead of guessing at a cause.
 */
async function relayReachable(): Promise<true | string> {
  return new Promise<true | string>((resolve) => {
    if (relay.wssUrl === '') return resolve('no relay url to dial');
    const client = mqtt.connect(relay.wssUrl, {
      username: relay.username,
      password: relay.password,
      clientId: `probe-${Math.random().toString(36).slice(2, 10)}`,
      connectTimeout: CONNECT_PROBE_MS,
      reconnectPeriod: 0,
    });
    const done = (ok: true | string): void => {
      client.end(true);
      resolve(ok);
    };
    client.on('connect', () => done(true));
    client.on('error', (e: Error) => done(e.message));
    setTimeout(() => done(`no CONNACK within ${CONNECT_PROBE_MS}ms`), CONNECT_PROBE_MS);
  });
}

/**
 * Probe the live relay ONCE at module-collection time. `describe.skipIf` is
 * evaluated when the suite is registered (before any `beforeAll` runs), so the probe
 * must resolve here, at the top level, for the skip decision to see the real answer.
 * An unreachable relay therefore yields a genuine vitest SKIP for every test in the
 * suite — never a zero-assertion green pass (agent-principles #2/#3).
 *
 * The reason it prints states the OBSERVED fact (`relaySkipReason`), which distinguishes "no broker
 * was configured, nothing was contacted" from "this broker refused us, here is its error". One
 * message for both used to send readers hunting a firewall when the real cause was a blank config.
 */
const probe = await relayReachable();
const skipReason = relaySkipReason(relay, probe);
if (skipReason !== null) {
  console.warn(`[sync.realrelay] SKIPPED (vitest skip): ${skipReason}`);
}

describe.skipIf(skipReason !== null)('real relay: two SyncEngines over the LIVE MQTT broker', () => {
  const meta = { players: { white: 'w', black: 'b' }, startedAt: 2000 };
  const engines: SyncEngine[] = [];
  let db: IDBDatabase;

  /** Build a SyncEngine on a real MqttTransport with a stable peer id. */
  /**
   * @param uuid Give BOTH engines of a pair the SAME game uuid when the test is about two peers on
   *   ONE game (a fork, a resync). Omitted, each engine mints its own — fine only while at least one
   *   side holds no history, because the seed gate (V.2, design §3) refuses a FOREIGN game's log once
   *   we have moves of our own. The conflict test below drifted red on exactly that: two engines with
   *   different uuids are not a fork, they are two games, and refusing the crossing is correct.
   */
  function makeEngine(
    peerId: string,
    myColor: 'white' | 'black' = 'white',
    size = 9,
    uuid?: string,
  ): SyncEngine {
    const transport = new MqttTransport(relay, { connect: realConnect, peerId });
    const engine = new SyncEngine(new Game(size, uuid), transport, db, () => meta, myColor, ANY_SEED);
    engines.push(engine);
    return engine;
  }

  beforeAll(async () => {
    db = await openDatabase(`realrelay-${Math.random().toString(36).slice(2)}`);
  });

  afterEach(() => {
    // Disconnect every engine's transport so no retained state lingers on the
    // broker (each test used a fresh unique room anyway).
    for (const engine of engines.splice(0)) {
      // The transport is private on the engine; reach it to disconnect so no
      // retained presence/state lingers on the broker after the test.
      const t = (engine as unknown as { transport: { disconnect(): void } })
        .transport;
      t.disconnect();
    }
  });

  it(
    'converges BIDIRECTIONALLY: a move on each client reaches the other',
    async () => {
      const room = `it-conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const a = makeEngine('rr-a');
      const b = makeEngine('rr-b');
      await a.connect(room);
      await b.connect(room);

      // A → B. Re-publish on each poll tick until B actually observes the move:
      // connect()'s first publish can land in B's subscription gap on the
      // non-retained /events topic (see waitForWithRepublish). B receiving the
      // piece over the real relay is still the genuine proof (#3).
      a.place([0, 0, 0]);
      const gotA = await waitForWithRepublish(
        a,
        () => b.game().state().pieces['0,0,0'] === 'white',
        PROPAGATE_MS,
      );
      expect(gotA).toBe(true);

      // B → A (black's move), same re-publish handshake.
      b.place([1, 1, 1]);
      const gotB = await waitForWithRepublish(
        b,
        () => a.game().state().pieces['1,1,1'] === 'black',
        PROPAGATE_MS,
      );
      expect(gotB).toBe(true);

      // Both logs converged to an identical head hash. Re-publish from A on each
      // tick so B adopts A's latest even if an earlier publish was dropped in the
      // subscription gap; adopting a strict extension is the real proof (#3).
      const converged = await waitForWithRepublish(
        a,
        () => headHash(a.game().log) === headHash(b.game().log),
        PROPAGATE_MS,
      );
      expect(converged).toBe(true);
      expect(a.game().ply()).toBe(2);
      expect(b.game().ply()).toBe(2);
    },
    (CONNECT_PROBE_MS + PROPAGATE_MS) * 3,
  );

  it(
    'is REPLAY-idempotent over the live relay: re-publishing a stale log is a no-op',
    async () => {
      const room = `it-replay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const a = makeEngine('rr-a2');
      const b = makeEngine('rr-b2');
      await a.connect(room);
      await b.connect(room);

      a.place([0, 0, 0]);
      a.place([0, 1, 0]);
      // Re-publish until B has genuinely received both moves over the relay
      // (defeats the connect() subscription-gap race; the first publish onto the
      // non-retained /events topic can be dropped before B is subscribed).
      const bGotBoth = await waitForWithRepublish(
        a,
        () => b.game().ply() === 2,
        PROPAGATE_MS,
      );
      expect(bGotBoth).toBe(true);
      const headBefore = headHash(b.game().log);

      // A re-publishes a STALE 1-move snapshot onto the live relay.
      const staleGame = new Game(9);
      staleGame.place([0, 0, 0]);
      const transportA = (a as unknown as { transport: { publish(m: unknown): void } })
        .transport;
      transportA.publish(toSyncMessage(staleGame.log));

      // Give it real propagation time, then assert B did NOT move backward.
      await delay(1_500);
      expect(headHash(b.game().log)).toBe(headBefore);
      expect(b.game().ply()).toBe(2);
    },
    (CONNECT_PROBE_MS + PROPAGATE_MS) * 3,
  );

  it(
    'the NARROW fast-forward over the live relay: ONE move behind catches up, TWO does not',
    async () => {
      const room = `it-ff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // ONE game, two seats — the only situation the reconciliation policy speaks about. (The
      // pre-v3.1 version of this test left both engines on their OWN games, so what it actually
      // exercised was the cross-game crossing path in `receiveOtherGame`, not the policy in its
      // title. With a shared uuid, as here, that old claim is simply false: a 3-move lead is a
      // divergence now, not something to adopt.)
      const shared = `rr-ff-${Date.now()}`;
      const a = makeEngine('rr-a3', 'white', 9, shared);
      const b = makeEngine('rr-b3', 'black', 9, shared);
      await a.connect(room);
      await b.connect(room);

      // A is ONE move ahead, and the missing entry is WHITE's — not B's to add. B fast-forwards.
      a.placeLocalOnly([0, 0, 0]);
      const one = a.game().log;
      const caughtUp = await waitForWithRepublish(
        a,
        () => b.game().ply() === 1 && headHash(b.game().log) === headHash(one),
        PROPAGATE_MS,
      );
      expect(caughtUp).toBe(true);

      // A REPLAY of what B already holds moves nothing (guarantee #2, re-proven on one game).
      a.publishState();
      await delay(400);
      expect(b.game().ply()).toBe(1);

      // Now A runs TWO moves ahead. B's log is still a prefix of A's, but the gap is beyond the one
      // move the turn gate can legitimately produce, so B must NOT adopt: it records a divergence
      // and waits for the players (design §5 — never auto-adopt beyond one move).
      a.placeLocalOnly([1, 1, 1]);
      a.placeLocalOnly([2, 2, 2]);
      a.publishState();
      await delay(PROPAGATE_MS / 2);
      a.publishState();
      await delay(PROPAGATE_MS / 2);

      expect(b.game().ply()).toBe(1);
      expect(headHash(b.game().log)).toBe(headHash(one));
      expect(b.needsResolution()).not.toBeNull();
    },
    (CONNECT_PROBE_MS + PROPAGATE_MS) * 3,
  );

  it(
    'detects a CONFLICT over the live relay: forked histories stop the game',
    async () => {
      const room = `it-conflict-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // ONE game, two divergent histories — that is what a fork IS. (Distinct uuids would be two
      // different games, which the seed gate refuses rather than calls a conflict, mirroring the
      // hermetic twin's shared PAIR_UUID in sync.test.ts.)
      const forked = `rr-fork-${Date.now()}`;
      const a = makeEngine('rr-a4', 'white', 9, forked);
      const b = makeEngine('rr-b4', 'white', 9, forked);
      // Fork BEFORE connecting so neither adopts the other first.
      a.placeLocalOnly([0, 0, 0]);
      b.placeLocalOnly([1, 1, 1]);
      await a.connect(room);
      await b.connect(room);
      // connect()'s publish races subscription on a non-retained /events topic, so
      // once BOTH are subscribed each re-publishes its fork to guarantee the peer
      // observes the divergent history (the message really crosses the relay).
      a.publishState();
      b.publishState();

      // Each peer detects the other's forked history as a conflict.
      const bConflicted = await waitFor(
        () => b.status().kind === 'conflict',
        PROPAGATE_MS,
      );
      const aConflicted = await waitFor(
        () => a.status().kind === 'conflict',
        PROPAGATE_MS,
      );
      expect(bConflicted).toBe(true);
      expect(aConflicted).toBe(true);

      // The stopped game refuses further local moves.
      expect(() => b.place([2, 2, 2])).toThrow();

      // Both forks were archived; reload proves the fork survives.
      await b.whenSettled();
      const st = b.status();
      expect(st.kind).toBe('conflict');
      if (st.kind !== 'conflict') throw new Error('expected conflict');
      const loaded = await loadConflicted(db, st.conflictId);
      expect(loaded).toBeDefined();
      expect(loaded!.mine.state().pieces['1,1,1']).toBe('white'); // B's own fork
      expect(loaded!.theirs.state().pieces['0,0,0']).toBe('white'); // A's fork
    },
    (CONNECT_PROBE_MS + PROPAGATE_MS) * 3,
  );
});
