/**
 * App-level net-session wiring (Task 5.5) — assembles a live {@link NetSession} for the running
 * app: opens the archive DB, resolves this browser's stable `playerId`, and picks the transport
 * factory. This is the one place the app chooses which {@link Transport} the session runs over, so
 * swapping the relay (mock loopback ↔ real MQTT) is a one-function change here — the whole point of
 * the `Transport` seam (`transport.ts`).
 *
 * IO glue (opens IndexedDB, reads localStorage, constructs a transport), verified end-to-end by the
 * Task 5.5 Playwright spec against the net widget + `window.__pente` getNet — NOT mutation-gated.
 * It may use the network + browser globals but must not import three/render/ui.
 *
 * ## Transport selection
 *
 * A Playwright test installs `window.__penteNetTransportFactory` (a `() => Transport`) BEFORE the
 * app boots, so host/join drive a deterministic {@link MockTransport} on a shared in-memory hub —
 * two page tabs sharing the seam's hub exchange REAL sync messages, so the test asserts on the
 * *other* client actually connecting (agent-principles #3), never on a log line, without depending
 * on the external relay in CI. Absent the seam, the app uses the real {@link MqttTransport} over the
 * config-SSOT relay (`relay.json`). `TODO(mqtt-default-e2e)`: once the relay is reachable from CI,
 * the seam can drive the real transport too; today it keeps the UI e2e hermetic.
 */

import mqtt from 'mqtt';
import { getConfig } from '../config/config';
import type { RelayConfig } from '../config/config';
import { openDatabase } from '../persist/db';
import type { Transport } from './transport';
import { MqttTransport, type MqttConnectFn } from './mqttTransport';
import { NetSession } from './session';
import { createLogger } from '../debug/log';

const log = createLogger('net:appSession');

/** The localStorage key holding this browser's stable playerId (GLOSSARY "playerId"). */
export const PLAYER_ID_KEY = 'pente:playerId';

/** The window seam a Playwright test sets to inject a deterministic transport (see file header). */
declare global {
  interface Window {
    /** Test-only: a transport factory the e2e installs to drive a mock relay instead of MQTT. */
    __penteNetTransportFactory?: () => Transport;
  }
}

/**
 * Resolve (creating on first run) this browser's stable playerId. It owns a seat across reconnects
 * (GLOSSARY "playerId"): persisted in localStorage so a refresh reclaims the same seat rather than
 * grabbing a new one. Uses `crypto.randomUUID` for a collision-resistant id.
 */
export function resolvePlayerId(): string {
  const existing = window.localStorage.getItem(PLAYER_ID_KEY);
  if (existing !== null && existing.length > 0) return existing;
  const id = crypto.randomUUID();
  window.localStorage.setItem(PLAYER_ID_KEY, id);
  return id;
}

/**
 * The transport factory the app uses: the test-injected one if present (deterministic mock relay),
 * else a fresh real {@link MqttTransport} over the config-SSOT relay. Each call builds a NEW
 * transport (one per room), so a re-host/re-join gets a clean connection.
 */
export function resolveTransportFactory(): () => Transport {
  const injected = window.__penteNetTransportFactory;
  if (injected !== undefined) {
    log.info('net transport: using injected test factory');
    return injected;
  }
  const relay = getConfig('relay') as unknown as RelayConfig;
  const connect: MqttConnectFn = (url, opts) =>
    mqtt.connect(url, opts) as unknown as ReturnType<MqttConnectFn>;
  return () => new MqttTransport(relay, { connect });
}

/**
 * Build the live {@link NetSession} for the app: open the archive DB, resolve the playerId + board
 * size + transport factory, and construct the session. Async because opening IndexedDB is async;
 * the caller wires the returned session's hooks onto the scene.
 *
 * @param size The board edge length the networked game is built at (the scene's live board size).
 */
export async function createAppNetSession(size: number): Promise<NetSession> {
  const db = await openDatabase();
  const session = new NetSession({
    createTransport: resolveTransportFactory(),
    db,
    playerId: resolvePlayerId(),
    size,
  });
  log.info('net session created', { size });
  return session;
}
