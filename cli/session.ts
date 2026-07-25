/**
 * Bootstraps a real {@link NetSession} in Node by injecting the same seams the
 * browser app does — the MQTT transport over mqtt.js, an IndexedDB via
 * `fake-indexeddb`, and a stable playerId — so the CLI reuses src/ verbatim and
 * cannot drift from the browser's protocol.
 *
 * The mqtt.js connect seam comes from {@link connect} in `netlink.ts` rather than
 * `mqtt.connect` directly, so the socket stays controllable (`drop`/`restore`) for
 * outage scenarios like the issue #45 repro.
 */
import 'fake-indexeddb/auto';
import { NetSession } from '../src/net/session';
import { MqttTransport } from '../src/net/mqttTransport';
import { openDatabase } from '../src/persist/db';
import { relayConfig, BOARD_SIZE } from './relay';
import { connect } from './netlink';

export interface CliSession {
  readonly session: NetSession;
  readonly playerId: string;
}

/**
 * Build a connected-capable session. `dbName` isolates the fake-IndexedDB store
 * (unique per daemon so two local CLIs don't share a DB); `playerId` is the
 * stable seat identity — persisted by the caller so a reconnect reclaims the seat.
 */
export async function createSession(dbName: string, playerId: string): Promise<CliSession> {
  const db = await openDatabase(dbName);
  const session = new NetSession({
    createTransport: () => new MqttTransport(relayConfig(), { connect }),
    db,
    playerId,
    size: BOARD_SIZE,
  });
  return { session, playerId };
}
