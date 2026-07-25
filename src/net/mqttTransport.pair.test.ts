/**
 * TWO REAL {@link MqttTransport}s talking to each other over an in-memory broker — the proof that
 * resident-peer republish (Task V.3, epic #47, **#45**) has a live signal in **BOTH** directions on
 * the REAL adapter, not just on the `MockRelayHub` double.
 *
 * ## Why this file exists (and why the single-transport suite was not enough)
 *
 * `mqttTransport.test.ts` drives ONE transport against a fake client and hand-fires the messages it
 * "receives". That proves routing, but it cannot prove the thing the whole un-gated design rests on:
 * that when peer B's socket comes back, peer B **hears something**. Whether it does depends on what
 * peer A's transport chooses to publish in reply — the other side of the same seam. A review of
 * Stage v31-republish showed the earlier one-shot ack latch failing exactly there: the resident's
 * ack was suppressed unless an absence had been observed, so a returner that the broker never
 * declared absent got no signal at all and never republished the move only it held (design §5's
 * mirror case). Two real transports over one broker is the smallest arrangement that can catch that.
 *
 * ## The broker
 *
 * {@link FakeBroker} is an in-memory MQTT broker, faithful on the three points that decide this
 * behaviour:
 *
 *  - **retained storage + replay on subscribe** — a retained publish is stored, and replayed to a
 *    new subscriber with the retain flag SET (that replay is a candidate, never a live peer: #5);
 *  - **retain is cleared for existing subscribers** (MQTT 3.3.1.3) — a retained publish still
 *    arrives at everyone already subscribed as a LIVE message, which is why a reconnecting peer's
 *    two announces produce two live signals at the resident;
 *  - **no echo suppression** — the broker delivers to every matching subscriber including the
 *    sender, exactly as a real one does (the transport filters its own presence topic itself).
 *
 * Nothing about Pente, presence or acks lives in the broker: it moves opaque payloads between
 * topics. Every assertion below is on what a transport OBSERVED (its `onPeerLive` / `onPresence`
 * callbacks) or what it PUT ON THE WIRE — never on a log line (agent-principles #3).
 */
import { describe, it, expect } from 'vitest';
import {
  MqttTransport,
  type MqttClientLike,
  type MqttConnectOptions,
  type MqttPublishOptions,
} from './mqttTransport';
import type { RelayConfig } from '../config/config';

const RELAY: RelayConfig = {
  wssUrl: 'wss://relay.example/mqtt',
  username: 'pente',
  password: 'pw',
  topicRoot: 'pente/v1',
};

/** One message as it left a client — the broker's wire log. */
interface WireMessage {
  readonly from: string;
  readonly topic: string;
  readonly payload: string;
  readonly retain: boolean;
}

/** Does an MQTT topic filter (with `+` single-level wildcards) match a topic? */
function matches(filter: string, topic: string): boolean {
  const f = filter.split('/');
  const t = topic.split('/');
  if (f.length !== t.length) return false;
  return f.every((seg, i) => seg === '+' || seg === t[i]);
}

/**
 * An in-memory MQTT broker (retained storage, wildcard subscriptions, Last-Will). Test-only, but a
 * faithful relay: it never inspects a payload.
 */
class FakeBroker {
  /** topic → retained payload (an empty retained publish CLEARS the topic, per MQTT). */
  private readonly retained = new Map<string, string>();
  private readonly clients = new Set<BrokerClient>();
  /** Every message that reached the broker, in order — the wire log the tests read. */
  readonly wire: WireMessage[] = [];

  /** The {@link MqttConnectFn} seam: open a client. It is NOT connected until `fireConnect()`. */
  open(opts: MqttConnectOptions): BrokerClient {
    const client = new BrokerClient(this, opts);
    this.clients.add(client);
    return client;
  }

  publish(from: BrokerClient, topic: string, payload: string, retain: boolean): void {
    this.wire.push({ from: from.clientId, topic, payload, retain });
    if (retain) {
      if (payload === '') this.retained.delete(topic);
      else this.retained.set(topic, payload);
    }
    for (const client of this.clients) {
      // Delivered with the retain flag CLEARED to everyone already subscribed (MQTT 3.3.1.3) —
      // including the sender, which a real broker does not suppress either.
      if (client.connected) client.deliverIfSubscribed(topic, payload, false);
    }
  }

  /** Replay the retained set to a client that just subscribed (retain flag SET). */
  replayRetained(client: BrokerClient): void {
    for (const [topic, payload] of this.retained) {
      client.deliverIfSubscribed(topic, payload, true);
    }
  }

  /** Live presence publishes carrying the ack flag, by sender — the handshake's cost on the wire. */
  ackCount(clientId: string): number {
    return this.wire.filter(
      (m) => m.from === clientId && !m.retain && m.payload.includes('"ack":true'),
    ).length;
  }
}

/** A client on {@link FakeBroker}, exposing the slice of mqtt.js the transport uses. */
class BrokerClient implements MqttClientLike {
  readonly clientId: string;
  connected = false;
  private readonly broker: FakeBroker;
  private readonly will: MqttConnectOptions['will'];
  private readonly filters: string[] = [];
  private readonly handlers: Record<string, ((...a: never[]) => void)[]> = {};

  constructor(broker: FakeBroker, opts: MqttConnectOptions) {
    this.broker = broker;
    this.clientId = opts.clientId;
    this.will = opts.will;
  }

  on(event: string, cb: (...args: never[]) => void): this {
    (this.handlers[event] ??= []).push(cb);
    return this;
  }

  subscribe(topics: string[], cb?: (err: Error | null) => void): this {
    this.filters.push(...topics);
    cb?.(null);
    // Retained messages arrive after the SUBACK, so the callback (which publishes our announce)
    // runs first — the same ordering mqtt.js gives the transport.
    this.broker.replayRetained(this);
    return this;
  }

  publish(topic: string, payload: string, opts?: MqttPublishOptions, cb?: () => void): this {
    if (this.connected) this.broker.publish(this, topic, payload, opts?.retain === true);
    cb?.();
    return this;
  }

  end(): this {
    this.connected = false;
    return this;
  }

  deliverIfSubscribed(topic: string, payload: string, retain: boolean): void {
    if (!this.filters.some((f) => matches(f, topic))) return;
    for (const cb of this.handlers['message'] ?? []) {
      (cb as (t: string, p: Uint8Array, packet: { retain: boolean }) => void)(
        topic,
        new TextEncoder().encode(payload),
        { retain },
      );
    }
  }

  /** The broker accepts the connection: mqtt.js emits `connect` (on a reconnect too). */
  fireConnect(): void {
    this.connected = true;
    // A clean-session reconnect starts with no subscriptions; the transport re-subscribes.
    this.filters.length = 0;
    for (const cb of this.handlers['connect'] ?? []) (cb as () => void)();
  }

  /**
   * The socket dies. `will: true` models an UNGRACEFUL drop (the broker publishes our Last-Will, so
   * the peer sees us go absent); `will: false` models a drop the peer never learns about — the case
   * the mirror direction has to survive.
   */
  drop(opts: { will: boolean }): void {
    this.connected = false;
    if (opts.will) this.broker.publish(this, this.will.topic, this.will.payload, this.will.retain);
  }
}

/** A transport wired to `broker`, with its observed live-presence signals recorded. */
function peerOn(broker: FakeBroker, peerId: string) {
  let client: BrokerClient | null = null;
  const transport = new MqttTransport(RELAY, {
    peerId,
    connect: (_url, opts) => {
      client = broker.open(opts);
      return client;
    },
  });
  const live: string[] = [];
  const presence: string[][] = [];
  transport.onPeerLive((id) => live.push(id));
  transport.onPresence((p) => presence.push([...p]));
  return {
    transport,
    live,
    presence,
    /** The underlying broker client (only after `enter()`). */
    client: (): BrokerClient => {
      if (client === null) throw new Error('peer has not connected yet');
      return client;
    },
    async enter(room: string): Promise<void> {
      const connecting = transport.connect(room);
      (client as BrokerClient | null)?.fireConnect();
      await connecting;
    },
  };
}

describe('MqttTransport ⇄ MqttTransport over a broker — live presence in BOTH directions (V.3, #45)', () => {
  it('a return the broker never announced as an absence still reaches BOTH peers', async () => {
    const broker = new FakeBroker();
    const a = peerOn(broker, 'peer-A');
    const b = peerOn(broker, 'peer-B');
    await a.enter('room1');
    await b.enter('room1');

    // The rendezvous itself: each peer saw the other LIVE (never merely retained).
    expect(a.live).toEqual(['peer-B', 'peer-B']); // B's retained + live announce, both delivered live
    expect(b.live).toEqual(['peer-A', 'peer-A']); // A's answer to each of them (A's own announce
    // predates B's subscription, so B learns A is live ONLY from those answers)
    expect(a.presence.at(-1)).toEqual(['peer-B']);
    expect(b.presence.at(-1)).toEqual(['peer-A']);

    // ── The outage the mirror case turns on: B's socket dies and NO absence is ever published ──
    b.client().drop({ will: false });
    const aBefore = a.live.length;
    const bBefore = b.live.length;
    // A is none the wiser: no Last-Will, so its live set never changed.
    expect(a.presence.at(-1)).toEqual(['peer-B']);

    // B reconnects: mqtt.js re-emits `connect`, the transport re-subscribes and re-announces.
    b.client().fireConnect();

    // The RESIDENT direction (the #45 fix): A sees B live again and can serve it the missed move.
    expect(a.live.slice(aBefore)).toEqual(['peer-B', 'peer-B']);
    // The MIRROR direction (design §5): B hears A is live, so B republishes the move only IT holds.
    // Before the ack latch was removed this array stayed EMPTY and the mirror deadlock survived.
    expect(b.live.slice(bBefore)).toEqual(['peer-A', 'peer-A']);
    // …and none of it came from a presence CHANGE — the change-gated path was silent throughout.
    expect(a.presence.at(-1)).toEqual(['peer-B']);
    expect(b.presence.at(-1)).toEqual(['peer-A']);
  });

  it('a return the broker DID announce as an absence reaches both peers too (Last-Will control)', async () => {
    const broker = new FakeBroker();
    const a = peerOn(broker, 'peer-A');
    const b = peerOn(broker, 'peer-B');
    await a.enter('room1');
    await b.enter('room1');

    b.client().drop({ will: true });
    // The control: here the absence IS observed, so A's live set really did change.
    expect(a.presence.at(-1)).toEqual([]);
    const aBefore = a.live.length;
    const bBefore = b.live.length;

    b.client().fireConnect();

    expect(a.live.slice(aBefore)).toEqual(['peer-B', 'peer-B']);
    expect(b.live.slice(bBefore)).toEqual(['peer-A', 'peer-A']);
    expect(a.presence.at(-1)).toEqual(['peer-B']);
  });

  it('the handshake TERMINATES: an ack is never answered, so the exchange is bounded', async () => {
    // Answering every announce is only safe because an ACK is not an announce. If it were, these two
    // transports would publish live presence at each other until the stack blew.
    const broker = new FakeBroker();
    const a = peerOn(broker, 'peer-A');
    const b = peerOn(broker, 'peer-B');
    await a.enter('room1');
    await b.enter('room1');

    // B's two announces (retained + live) each earn exactly one ack from A; B answers none of them.
    expect(broker.ackCount('peer-A')).toBe(2);
    expect(broker.ackCount('peer-B')).toBe(0);

    const wireAfterRendezvous = broker.wire.length;
    b.client().fireConnect(); // one more return: two more announces, two more acks, then silence
    expect(broker.wire.length - wireAfterRendezvous).toBe(4);
    expect(broker.ackCount('peer-B')).toBe(0);
  });

  it('a RETAINED presence replay is not a live signal (a ghost room never triggers republish)', async () => {
    // The #5 guard, at the pair level: A leaves its retained presence behind and stops answering.
    // A joiner must read that as a candidate, not as a peer to serve.
    const broker = new FakeBroker();
    const a = peerOn(broker, 'peer-A');
    await a.enter('room1');
    a.client().drop({ will: false }); // crashed WITHOUT clearing its retained presence

    const c = peerOn(broker, 'peer-C');
    await c.enter('room1');

    expect(c.live).toEqual([]);
    expect(c.presence.at(-1) ?? []).toEqual([]);
  });
});
