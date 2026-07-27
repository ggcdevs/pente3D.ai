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
import { openDatabase, resolveDbName } from '../persist/db';
import type { Transport } from './transport';
import { MqttTransport, type MqttConnectFn } from './mqttTransport';
import { NetSession } from './session';
import { createLogger } from '../debug/log';
import { randomId } from '../util/randomId';

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
 * grabbing a new one. Uses `randomId` (a collision-resistant UUID v4) rather than `crypto.randomUUID`
 * directly so this boot-time mint works over plain http on the LAN (issue #6): `crypto.randomUUID` is
 * secure-context-only and undefined there, which crashed boot.
 */
export function resolvePlayerId(): string {
  const existing = window.localStorage.getItem(PLAYER_ID_KEY);
  if (existing !== null && existing.length > 0) return existing;
  const id = randomId();
  window.localStorage.setItem(PLAYER_ID_KEY, id);
  return id;
}

/**
 * The transport factory the app uses: the test-injected one if present (deterministic mock relay),
 * else a fresh real {@link MqttTransport} over the config-SSOT relay. Each call builds a NEW
 * transport (one per room), so a re-host/re-join gets a clean connection.
 *
 * `playerId` becomes the transport's PRESENCE id, and that is load-bearing rather than cosmetic.
 * Seats are owned by `playerId` (`seats.ts`), and the arbiter answers a full room by asking whether
 * every seat OWNER is present (`claimSeat`'s `room-full` vs `seat-reserved`). With the transport
 * minting its own random `p-…` id per connection, that comparison held two different namespaces:
 * the present-set could never contain another peer's `playerId`, so a blocking owner ALWAYS looked
 * absent and `room-full` was unreachable on the real relay. Observed from the arbiter itself, in a
 * room where both owners were live and each side's `peerPresent` was `true`:
 *
 *     DIAGARB me=smr-a reason=seat-reserved
 *             seatMap={"white":"smr-a","black":"smr-b"}
 *             present=["smr-a","p-3x9m56","p-c67xmd"]
 *
 * The hermetic `MockTransport` is built WITH the playerId, which is why the two namespaces never
 * diverged there and only the real-relay tier could show it — that tier was dark until now.
 *
 * The id is stable per PLAYER rather than per connection. `RepublishLimiter` only ever compares it
 * for equality and forgets peers observed to leave (`republish.ts`), so a returning peer is still
 * served; and a stable MQTT `clientId` means a reconnect displaces its own stale ghost session
 * instead of racing it.
 */
export function resolveTransportFactory(playerId: string): () => Transport {
  const injected = window.__penteNetTransportFactory;
  if (injected !== undefined) {
    log.info('net transport: using injected test factory');
    return injected;
  }
  const relay = getConfig('relay') as unknown as RelayConfig;
  const connect: MqttConnectFn = (url, opts) =>
    mqtt.connect(url, opts) as unknown as ReturnType<MqttConnectFn>;
  return () => new MqttTransport(relay, { connect, peerId: playerId });
}

/**
 * Build the live {@link NetSession} for the app: open the archive DB, resolve the playerId + board
 * size + transport factory, and construct the session. Async because opening IndexedDB is async;
 * the caller wires the returned session's hooks onto the scene.
 *
 * @param size The board edge length the networked game is built at (the scene's live board size).
 */
export async function createAppNetSession(size: number): Promise<NetSession> {
  const db = await openDatabase(resolveDbName());
  // ONE identity: the same playerId owns the seat AND names this client in presence, so the arbiter's
  // "is every seat owner present?" question can actually be answered (see `resolveTransportFactory`).
  const playerId = resolvePlayerId();
  const session = new NetSession({
    createTransport: resolveTransportFactory(playerId),
    db,
    playerId,
    size,
  });
  log.info('net session created', { size });
  return session;
}
