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
 *   3. **Out-of-order tolerance** — the engine converges to the longest valid log
 *      regardless of message order.
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
import { loadConflicted } from '../persist/archive';
import { MqttTransport, type MqttConnectFn } from './mqttTransport';
import { SyncEngine, toSyncMessage } from './sync';
import type { RelayConfig } from '../config/config';

/** The SSOT relay config — the SAME record the client transport uses. */
const relay = getConfig('relay') as RelayConfig;

/** Real mqtt.js factory: opens an actual outbound wss connection to the broker. */
const realConnect: MqttConnectFn = (url, opts) =>
  mqtt.connect(url, opts) as unknown as ReturnType<MqttConnectFn>;

/** How long to wait for the relay to accept a connection before declaring it down. */
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

/** Probe the live relay once; if it won't connect, the suite is skipped. */
async function relayReachable(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const client = mqtt.connect(relay.wssUrl, {
      username: relay.username,
      password: relay.password,
      clientId: `probe-${Math.random().toString(36).slice(2, 10)}`,
      connectTimeout: CONNECT_PROBE_MS,
      reconnectPeriod: 0,
    });
    const done = (ok: boolean): void => {
      client.end(true);
      resolve(ok);
    };
    client.on('connect', () => done(true));
    client.on('error', () => done(false));
    setTimeout(() => done(false), CONNECT_PROBE_MS);
  });
}

/**
 * Probe the live relay ONCE at module-collection time. `describe.skipIf` is
 * evaluated when the suite is registered (before any `beforeAll` runs), so the probe
 * must resolve here, at the top level, for the skip decision to see the real answer.
 * An unreachable relay therefore yields a genuine vitest SKIP for every test in the
 * suite — never a zero-assertion green pass (agent-principles #2/#3).
 */
const reachable = await relayReachable();
if (!reachable) {
  console.warn(
    `[sync.realrelay] SKIPPED (vitest skip): relay ${relay.wssUrl} unreachable — ` +
      `run again with network egress to the broker to exercise the live path.`,
  );
}

describe.skipIf(!reachable)('real relay: two SyncEngines over the LIVE MQTT broker', () => {
  const meta = { players: { white: 'w', black: 'b' }, startedAt: 2000 };
  const engines: SyncEngine[] = [];
  let db: IDBDatabase;

  /** Build a SyncEngine on a real MqttTransport with a stable peer id. */
  function makeEngine(
    peerId: string,
    myColor: 'white' | 'black' = 'white',
    size = 9,
  ): SyncEngine {
    const transport = new MqttTransport(relay, { connect: realConnect, peerId });
    const engine = new SyncEngine(new Game(size), transport, db, () => meta, myColor);
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

      // A → B
      a.place([0, 0, 0]);
      const gotA = await waitFor(
        () => b.game().state().pieces['0,0,0'] === 'white',
        PROPAGATE_MS,
      );
      expect(gotA).toBe(true);

      // B → A (black's move)
      b.place([1, 1, 1]);
      const gotB = await waitFor(
        () => a.game().state().pieces['1,1,1'] === 'black',
        PROPAGATE_MS,
      );
      expect(gotB).toBe(true);

      // Both logs converged to an identical head hash.
      const converged = await waitFor(
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
      await waitFor(() => b.game().ply() === 2, PROPAGATE_MS);
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
    'tolerates OUT-OF-ORDER live delivery: converges to the longest valid log',
    async () => {
      const room = `it-ooo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const a = makeEngine('rr-a3');
      const b = makeEngine('rr-b3');
      await a.connect(room);
      await b.connect(room);

      // A builds a 3-move log locally, then publishes snapshots OUT OF ORDER:
      // full(3) first, then a stale mid(2), then a stale one(1). B must end at 3.
      a.placeLocalOnly([0, 0, 0]);
      a.placeLocalOnly([1, 1, 1]);
      a.placeLocalOnly([2, 2, 2]);
      const full = a.game().log;

      const mid = new Game(9);
      mid.place([0, 0, 0]);
      mid.place([1, 1, 1]);
      const one = new Game(9);
      one.place([0, 0, 0]);

      const transportA = (a as unknown as { transport: { publish(m: unknown): void } })
        .transport;
      transportA.publish(toSyncMessage(full));
      await delay(400);
      transportA.publish(toSyncMessage(mid.log));
      await delay(400);
      transportA.publish(toSyncMessage(one.log));

      const converged = await waitFor(
        () => b.game().ply() === 3 && headHash(b.game().log) === headHash(full),
        PROPAGATE_MS,
      );
      expect(converged).toBe(true);
    },
    (CONNECT_PROBE_MS + PROPAGATE_MS) * 3,
  );

  it(
    'detects a CONFLICT over the live relay: forked histories stop the game',
    async () => {
      const room = `it-conflict-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const a = makeEngine('rr-a4');
      const b = makeEngine('rr-b4');
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
