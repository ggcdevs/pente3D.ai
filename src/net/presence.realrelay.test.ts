/**
 * REAL-RELAY presence-liveness integration test (Task 6.5, issue #5).
 *
 * Proof-by-behavior over the LIVE MQTT broker that the phantom-presence bug is fixed (agent-
 * principles #3: the proof is the OTHER client's observed presence over the real relay, never a log
 * line). It exercises the exact two scenarios the issue names, against the actual broker configured
 * in the SSOT `relay.json`, in a unique room per run:
 *
 *   1. TWO LIVE PEERS SEE EACH OTHER — two {@link MqttTransport}s in one room each observe the other
 *      as present (the live hello/ack handshake completes over the wire).
 *   2. A STALE RETAINED PRESENCE IS NOT A LIVE PEER — a "crashed" peer leaves a non-empty RETAINED
 *      presence on the broker (published retained, then its client force-ended WITHOUT clearing it,
 *      simulating a killed tab whose Last-Will did not clear the retained snapshot). A FRESH joiner
 *      then connects to that room and must observe NO present peer — only the ghost's retained
 *      snapshot exists, and a retained snapshot is never counted live.
 *
 * Nothing is mocked: the mqtt.js client is real and the bytes cross the network. Each test uses a
 * fresh random room and force-clears any retained presence it seeded in `afterEach`, so it leaves no
 * retained state behind for the next run. If the relay is unreachable the suite is a genuine vitest
 * SKIP (never a zero-assertion green pass), exactly as `sync.realrelay.test.ts` does.
 */

import { afterEach, describe, expect, it } from 'vitest';
import mqtt from 'mqtt';
import { getConfig } from '../config/config';
import { roomTopic } from './transport';
import { MqttTransport, type MqttConnectFn } from './mqttTransport';
import type { RelayConfig } from '../config/config';

/** The SSOT relay config — the SAME record the client transport uses. */
const relay = getConfig('relay') as RelayConfig;

/** Real mqtt.js factory: opens an actual outbound wss connection to the broker. */
const realConnect: MqttConnectFn = (url, opts) =>
  mqtt.connect(url, opts) as unknown as ReturnType<MqttConnectFn>;

const CONNECT_PROBE_MS = 10_000;
const PROPAGATE_MS = 6_000;

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Poll `predicate` until true or `timeoutMs` elapses; returns whether it became true. */
async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await delay(50);
  }
  return predicate();
}

/** Poll `predicate` and assert it STAYS false for the whole window (proves absence, not just delay). */
async function staysFalse(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return false;
    await delay(100);
  }
  return !predicate();
}

/** Probe the live relay once; if it won't connect, the suite is skipped. */
async function relayReachable(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const client = mqtt.connect(relay.wssUrl, {
      username: relay.username,
      password: relay.password,
      clientId: `probe-pres-${Math.random().toString(36).slice(2, 10)}`,
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

const reachable = await relayReachable();
if (!reachable) {
  console.warn(
    `[presence.realrelay] SKIPPED (vitest skip): relay ${relay.wssUrl} unreachable — ` +
      `run again with network egress to the broker to exercise the live presence path.`,
  );
}

/**
 * Seed a stale, non-empty RETAINED presence for `ghostId` in `room`, then force-close the client
 * WITHOUT clearing it — simulating a peer whose tab was killed and whose retained presence lingers.
 * Returns the presence topic so `afterEach` can clear it and not pollute later runs.
 */
async function seedGhostPresence(room: string, ghostId: string): Promise<string> {
  const topic = `${roomTopic(relay.topicRoot, room)}/presence/${ghostId}`;
  await new Promise<void>((resolve, reject) => {
    const client = mqtt.connect(relay.wssUrl, {
      username: relay.username,
      password: relay.password,
      clientId: ghostId,
      connectTimeout: CONNECT_PROBE_MS,
      reconnectPeriod: 0,
    });
    client.on('connect', () => {
      // Publish a RETAINED, non-empty presence — then force-end WITHOUT clearing it (no LWT set),
      // so the broker keeps the stale snapshot exactly as a crashed tab would leave it.
      client.publish(topic, JSON.stringify({ id: ghostId }), { retain: true, qos: 1 }, () => {
        client.end(true);
        resolve();
      });
    });
    client.on('error', (err) => {
      client.end(true);
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
  return topic;
}

/** Force-clear a retained presence topic so no ghost lingers for the next run. */
async function clearRetained(topic: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const client = mqtt.connect(relay.wssUrl, {
      username: relay.username,
      password: relay.password,
      clientId: `clear-${Math.random().toString(36).slice(2, 8)}`,
      connectTimeout: CONNECT_PROBE_MS,
      reconnectPeriod: 0,
    });
    const done = (): void => {
      client.end(true);
      resolve();
    };
    client.on('connect', () => {
      client.publish(topic, '', { retain: true, qos: 1 }, done);
    });
    client.on('error', done);
  });
}

describe.skipIf(!reachable)('real relay: presence liveness (issue #5)', () => {
  const transports: MqttTransport[] = [];
  const seededTopics: string[] = [];

  function makeTransport(peerId: string): {
    transport: MqttTransport;
    live: () => readonly string[];
  } {
    const transport = new MqttTransport(relay, { connect: realConnect, peerId });
    let latest: readonly string[] = [];
    transport.onPresence((peers) => {
      latest = peers;
    });
    transports.push(transport);
    return { transport, live: () => latest };
  }

  afterEach(async () => {
    for (const t of transports.splice(0)) t.disconnect();
    for (const topic of seededTopics.splice(0)) await clearRetained(topic);
  });

  it(
    'TWO LIVE PEERS see each other as present over the live relay',
    async () => {
      const room = `pres-live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const a = makeTransport('pres-a');
      const b = makeTransport('pres-b');
      await a.transport.connect(room);
      await b.transport.connect(room);

      // Each peer must observe the OTHER as present via the live hello/ack handshake.
      const aSeesB = await waitFor(() => a.live().includes('pres-b'), PROPAGATE_MS);
      const bSeesA = await waitFor(() => b.live().includes('pres-a'), PROPAGATE_MS);
      expect(aSeesB).toBe(true);
      expect(bSeesA).toBe(true);
    },
    (CONNECT_PROBE_MS + PROPAGATE_MS) * 3,
  );

  it(
    'a STALE RETAINED presence does NOT show as a live peer to a fresh joiner (the issue #5 bug)',
    async () => {
      const room = `pres-ghost-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const ghostId = 'pres-ghost';
      // A crashed peer left a non-empty retained presence and vanished (no live client anymore).
      seededTopics.push(await seedGhostPresence(room, ghostId));

      // A fresh joiner connects to that dead room. The broker replays the ghost's retained presence.
      const joiner = makeTransport('pres-joiner');
      await joiner.transport.connect(room);

      // The ghost must NEVER surface as a present peer — it is retained-only, with no live client to
      // answer the joiner's hello. Assert it stays absent for the whole propagation window (proving
      // absence, not merely a slow arrival).
      const noGhost = await staysFalse(
        () => joiner.live().includes(ghostId),
        PROPAGATE_MS,
      );
      expect(noGhost).toBe(true);
      expect(joiner.live()).not.toContain(ghostId);
    },
    (CONNECT_PROBE_MS + PROPAGATE_MS) * 3,
  );

  it(
    'a ghost retained presence does not block a REAL peer that joins afterward',
    async () => {
      const room = `pres-mix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      seededTopics.push(await seedGhostPresence(room, 'pres-ghost2'));

      const a = makeTransport('pres-real-a');
      const b = makeTransport('pres-real-b');
      await a.transport.connect(room);
      await b.transport.connect(room);

      // The two live peers still find each other (the ghost is inert, not blocking), and neither
      // counts the ghost as present.
      const aSeesB = await waitFor(() => a.live().includes('pres-real-b'), PROPAGATE_MS);
      expect(aSeesB).toBe(true);
      expect(a.live()).not.toContain('pres-ghost2');
    },
    (CONNECT_PROBE_MS + PROPAGATE_MS) * 3,
  );
});
