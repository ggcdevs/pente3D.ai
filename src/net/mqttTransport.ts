/**
 * `MqttTransport` — the MQTT implementation of the {@link Transport} seam,
 * ported from `poc/transport.js` and typed (build plan Task 3.1).
 *
 * It is a **thin IO adapter**: it connects outbound over `wss://` to the dumb
 * Mosquitto relay, maps room identity → topics, and routes opaque JSON between
 * the room's `/events`, retained `/state`, and `/presence/+` topics and the
 * {@link Transport} callbacks. It carries **no game logic** — seat assignment,
 * sync decisions, and undo rules live in their own units on top of this seam.
 *
 * ## SSOT wiring
 *
 * The relay endpoint and credentials come from the config SSOT
 * (`src/config/defaults/relay.json` via {@link RelayConfig}); nothing is
 * hardcoded here. The same record feeds the real-relay integration test
 * (Task 3.3), so switching servers is a one-file edit.
 *
 * ## Testability
 *
 * The mqtt.js client is created by an **injected factory** ({@link MqttConnectFn}).
 * Unit tests pass a fake client to exercise the real routing/presence/topic logic
 * without a network; the live broker is proven by Task 3.3 (proof-by-behavior —
 * the *other* client receiving the move — not by mutation-testing this glue).
 *
 * This module may use the network but must not import three/render/ui.
 */

import type { RelayConfig } from '../config/config';
import {
  roomTopic,
  type ConnectOptions,
  type MessageHandler,
  type PresenceHandler,
  type Transport,
  type TransportMessage,
} from './transport';

/** Options accepted by an mqtt.js `publish` call (the subset we use). */
export interface MqttPublishOptions {
  readonly retain?: boolean;
  readonly qos?: 0 | 1 | 2;
}

/** The Last-Will-and-Testament registered on connect (presence auto-clear). */
export interface MqttWill {
  readonly topic: string;
  readonly payload: string;
  readonly retain: boolean;
  readonly qos: 0 | 1 | 2;
}

/** The mqtt.js connect options subset the transport sets. */
export interface MqttConnectOptions {
  readonly username: string;
  readonly password: string;
  readonly clientId: string;
  readonly reconnectPeriod: number;
  readonly connectTimeout: number;
  readonly will: MqttWill;
}

/**
 * The minimal slice of the mqtt.js client surface {@link MqttTransport} depends
 * on. Declaring our own structural type keeps the adapter decoupled from the
 * mqtt package's types and makes it trivially fakeable in unit tests.
 */
export interface MqttClientLike {
  on(event: 'connect', cb: () => void): this;
  on(event: 'message', cb: (topic: string, payload: Uint8Array) => void): this;
  on(event: 'error', cb: (err: Error) => void): this;
  on(event: string, cb: (...args: never[]) => void): this;
  subscribe(topics: string[], cb?: (err: Error | null) => void): this;
  publish(
    topic: string,
    payload: string,
    opts?: MqttPublishOptions,
    cb?: () => void,
  ): this;
  end(): this;
}

/** Factory that opens an mqtt.js client (real: `mqtt.connect`; test: a fake). */
export type MqttConnectFn = (
  url: string,
  opts: MqttConnectOptions,
) => MqttClientLike;

/** Construction dependencies — all injectable so the adapter is unit-testable. */
export interface MqttTransportDeps {
  /** Opens the underlying mqtt client (inject the real `mqtt.connect`). */
  readonly connect: MqttConnectFn;
  /** This client's stable id; auto-generated (`p-…`) when omitted. */
  readonly peerId?: string;
}

/** mqtt.js reconnect cadence (ms), ported from the POC. */
const RECONNECT_PERIOD_MS = 2000;
/** mqtt.js initial-connect timeout (ms), ported from the POC. */
const CONNECT_TIMEOUT_MS = 8000;

export class MqttTransport implements Transport {
  /** This client's stable presence id. */
  readonly peerId: string;

  private readonly cfg: RelayConfig;
  private readonly connectFn: MqttConnectFn;

  private client: MqttClientLike | null = null;
  private room: string | null = null;
  private readonly online = new Set<string>();

  private msgCb: MessageHandler = () => {};
  private presenceCb: PresenceHandler = () => {};

  /**
   * @param cfg The relay SSOT (endpoint + credentials + topic root).
   * @param deps Injected mqtt factory and optional peerId.
   */
  constructor(cfg: RelayConfig, deps: MqttTransportDeps) {
    this.cfg = cfg;
    this.connectFn = deps.connect;
    this.peerId = deps.peerId ?? randomPeerId();
  }

  /** The full topic for a `suffix` under the current room (e.g. `/events`). */
  private topic(suffix: string): string {
    if (this.room === null) throw new Error('topic: not connected');
    return `${roomTopic(this.cfg.topicRoot, this.room)}${suffix}`;
  }

  connect(roomCode: string, _opts?: ConnectOptions): Promise<void> {
    // `_opts.password` is RESERVED and ignored in v1 (design doc seam #2). It is
    // deliberately NOT folded into the topic or the mqtt auth password here.
    if (roomCode.length === 0) {
      return Promise.reject(new Error('connect: roomCode must be non-empty'));
    }
    this.room = roomCode;
    const presenceMine = this.topic(`/presence/${this.peerId}`);

    return new Promise<void>((resolve, reject) => {
      const client = this.connectFn(this.cfg.wssUrl, {
        username: this.cfg.username,
        password: this.cfg.password,
        clientId: this.peerId,
        reconnectPeriod: RECONNECT_PERIOD_MS,
        connectTimeout: CONNECT_TIMEOUT_MS,
        // Last-Will: on an ungraceful drop the broker clears our presence.
        will: { topic: presenceMine, payload: '', retain: true, qos: 0 },
      });
      this.client = client;

      client.on('connect', () => {
        client.subscribe(
          [this.topic('/events'), this.topic('/state'), this.topic('/presence/+')],
          () => {
            // Announce ourselves (retained so late joiners see us).
            client.publish(presenceMine, JSON.stringify({ id: this.peerId }), {
              retain: true,
            });
            resolve();
          },
        );
      });

      client.on('message', (topic: string, payload: Uint8Array) => {
        this.route(topic, decode(payload));
      });

      client.on('error', reject);
    });
  }

  /**
   * Route an inbound message by topic suffix — the pure logic of the adapter:
   * `/events` → onMessage, `/presence/*` → presence set, everything else
   * (including the retained `/state` snapshot) is ignored by this seam.
   */
  private route(topic: string, body: string): void {
    if (topic.endsWith('/events')) {
      if (body) this.msgCb(JSON.parse(body) as TransportMessage);
      return;
    }
    const presenceMarker = '/presence/';
    const idx = topic.indexOf(presenceMarker);
    if (idx !== -1) {
      const id = topic.slice(idx + presenceMarker.length);
      if (body) this.online.add(id);
      else this.online.delete(id);
      this.presenceCb([...this.online]);
    }
    // `/state` and any other topic: not part of this seam — ignore.
  }

  publish(msg: TransportMessage): void {
    if (this.client === null) throw new Error('publish: not connected');
    this.client.publish(this.topic('/events'), JSON.stringify(msg));
  }

  onMessage(cb: MessageHandler): void {
    this.msgCb = cb;
  }

  onPresence(cb: PresenceHandler): void {
    this.presenceCb = cb;
  }

  disconnect(): void {
    const client = this.client;
    if (client === null) return;
    const presenceMine = this.topic(`/presence/${this.peerId}`);
    this.client = null;
    // Clear our retained presence, then close.
    client.publish(presenceMine, '', { retain: true }, () => {
      client.end();
    });
  }
}

/** Decode an mqtt payload (Uint8Array) to a UTF-8 string. */
function decode(payload: Uint8Array): string {
  return new TextDecoder().decode(payload);
}

/** A random peer id, matching the POC's `p-xxxxxx` shape. */
function randomPeerId(): string {
  return 'p-' + Math.random().toString(36).slice(2, 8);
}
