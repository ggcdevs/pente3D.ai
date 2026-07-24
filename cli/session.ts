/**
 * Bootstraps a real {@link NetSession} in Node by injecting the same seams the
 * browser app does — the MQTT transport over mqtt.js, an IndexedDB via
 * `fake-indexeddb`, and a stable playerId — so the CLI reuses src/ verbatim and
 * cannot drift from the browser's protocol.
 */
import 'fake-indexeddb/auto';
import mqtt from 'mqtt';
import { NetSession } from '../src/net/session';
import { MqttTransport, type MqttClientLike } from '../src/net/mqttTransport';
import { openDatabase } from '../src/persist/db';
import { relayConfig, BOARD_SIZE } from './relay';

const connect = (url: string, opts: unknown): MqttClientLike =>
  mqtt.connect(url, opts as mqtt.IClientOptions) as unknown as MqttClientLike;

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
