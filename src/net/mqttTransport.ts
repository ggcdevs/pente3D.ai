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
  type PeerLiveHandler,
  type PresenceHandler,
  type Transport,
  type TransportMessage,
} from './transport';
import { PresenceTracker } from './presence';

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
  /**
   * The mqtt.js `message` event delivers `(topic, payload, packet)`. The `packet.retain` flag is
   * LOAD-BEARING for issue #5: a message the broker replayed because it was retained arrives with
   * `retain === true`, while a live publish seen while subscribed arrives with `retain === false`.
   * The transport uses that flag to refuse counting a stale retained presence as a live peer.
   */
  on(
    event: 'message',
    cb: (topic: string, payload: Uint8Array, packet: { retain: boolean }) => void,
  ): this;
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
  /**
   * Presence-liveness evaluator (issue #5). A retained presence snapshot the broker replays is
   * recorded as a CANDIDATE, never a live peer; only a fresh LIVE presence publish (a genuinely
   * online peer's own announcement or its reply to our hello) promotes it. This is what stops a dead
   * room — where a crashed peer left a stale retained presence — showing a phantom opponent.
   */
  private readonly presence = new PresenceTracker();

  private msgCb: MessageHandler = () => {};
  private presenceCb: PresenceHandler = () => {};
  private peerLiveCb: PeerLiveHandler = () => {};

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
            // Announce ourselves TWICE, deliberately (issue #5 handshake):
            //   1. a RETAINED presence so a late joiner discovers we exist (a candidate to ping);
            //   2. a LIVE (non-retained) hello — an ANNOUNCE (no `ack` flag) so an already-present
            //      peer sees a FRESH signal from us and — per `routePresence` — answers with its own
            //      live presence, proving IT is alive too. mqtt.js re-emits `connect` on every
            //      reconnect, so this pair is republished on a socket-level return as well: that
            //      re-announce is what earns the resident's answer and lets a returner republish.
            // The retained publish does not carry liveness on its own (a crashed peer's retained
            // message looks identical); only the live exchange does. A dead peer never answers the
            // hello, so it stays a candidate and is never counted as a live opponent.
            const body = JSON.stringify({ id: this.peerId });
            client.publish(presenceMine, body, { retain: true });
            client.publish(presenceMine, body, { retain: false });
            resolve();
          },
        );
      });

      client.on('message', (topic: string, payload: Uint8Array, packet: { retain: boolean }) => {
        this.route(topic, decode(payload), packet.retain);
      });

      client.on('error', reject);
    });
  }

  /**
   * Route an inbound message by topic suffix — the glue of the adapter:
   * `/events` → onMessage, `/presence/*` → the presence tracker, everything else
   * (including the retained `/state` snapshot) is ignored by this seam.
   *
   * @param retained Whether the broker delivered this as a RETAINED message (mqtt.js `packet.retain`).
   *   Load-bearing for issue #5: a retained presence is a candidate, not a live peer.
   */
  private route(topic: string, body: string, retained: boolean): void {
    if (topic.endsWith('/events')) {
      if (body) this.msgCb(JSON.parse(body) as TransportMessage);
      return;
    }
    const presenceMarker = '/presence/';
    const idx = topic.indexOf(presenceMarker);
    if (idx !== -1) {
      const id = topic.slice(idx + presenceMarker.length);
      // Our OWN presence (retained or live) is not a peer; ignore it so we never self-count.
      if (id === this.peerId) return;
      this.routePresence(id, body, retained);
    }
    // `/state` and any other topic: not part of this seam — ignore.
  }

  /**
   * Fold one peer's presence into the tracker and, if the LIVE-peer set changed, notify the caller
   * with the LIVE peers only (never a mere retained candidate — the issue #5 fix). An empty body is
   * an absence (graceful clear / Last-Will); a non-empty body is a candidate if retained, or a live
   * confirmation if fresh. Every fresh live ANNOUNCE is answered with our own live ack so that peer
   * learns WE are alive too (completing the handshake both ways); an ack is never answered, which is
   * what terminates the exchange (see {@link ackHello}).
   *
   * Every LIVE signal — announce or ack — is ALSO forwarded verbatim to {@link onPeerLive}, after
   * the presence update. That is deliberate and load-bearing for issue #45: `PresenceTracker.apply`
   * reports only a CHANGE to the live SET, and an observed ABSENCE is what makes a return a change.
   * A peer whose socket dropped and returned without the broker ever publishing its absence
   * re-announces into an unchanged live set: no presence callback at all — and the resident would
   * never republish the moves it missed. The peer-live callback is the un-gated signal that survives
   * that; making its repeats harmless belongs to the decision layer (`republish.ts`), not here.
   *
   * The MIRROR direction (design §5) rides the ack: the returner learns the resident is live only
   * because the resident answers its re-announce, so that answer must NOT be conditioned on the
   * return having been seen as an absence. It is not — every announce is answered.
   */
  private routePresence(id: string, body: string, retained: boolean): void {
    const kind = body === '' ? 'absent' : retained ? 'retained' : 'live';
    if (kind === 'live' && !isPresenceAck(body)) this.ackHello();
    const changed = this.presence.apply({ peerId: id, kind });
    if (changed) this.presenceCb(this.presence.livePeers());
    if (kind === 'live') this.peerLiveCb(id);
  }

  /**
   * Answer a peer's fresh live ANNOUNCE with our own live presence publish, so it confirms our
   * liveness in return. Marked `ack: true` on the wire, and an ack is never itself answered — that
   * flag, not a per-peer latch, is what stops two peers ping-ponging live publishes forever.
   *
   * It deliberately answers EVERY announce, including a re-announce from a peer we already believe
   * is live. That peer may have dropped and come back without the broker ever publishing an absence
   * (a socket-level reconnect: mqtt.js re-subscribes and re-announces, nothing else changes). A
   * latch would go quiet exactly there and leave the returner with no signal that anyone is in the
   * room — so it would never republish the move it holds and the resident missed (issue #45's mirror
   * case, design §5). Skipped only while disconnected, when there is no client to publish on.
   *
   * The ack goes on OUR presence topic (the same one our announce uses), so it needs no addressee:
   * every peer subscribed to `/presence/+` reads it as "we are live", and a peer that was not
   * waiting on it simply treats it as one more live signal.
   */
  private ackHello(): void {
    if (this.client === null) return;
    this.client.publish(
      this.topic(`/presence/${this.peerId}`),
      JSON.stringify({ id: this.peerId, ack: true }),
      { retain: false },
    );
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

  onPeerLive(cb: PeerLiveHandler): void {
    this.peerLiveCb = cb;
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

/**
 * Is this live presence body an ACK (an answer to someone's announce) rather than an ANNOUNCE?
 *
 * The only discriminator on the wire is the `ack: true` flag {@link MqttTransport.ackHello} sets;
 * anything else — an announce, an unparseable body, a payload from an older client that predates
 * the flag — is read as an ANNOUNCE and therefore answered. Erring that way is safe: answering an
 * announce twice costs one extra live publish, whereas mistaking an announce for an ack would
 * silently strand a returning peer with no signal that anyone is in the room.
 */
function isPresenceAck(body: string): boolean {
  try {
    return (JSON.parse(body) as { ack?: unknown }).ack === true;
  } catch {
    return false;
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
