import { describe, it, expect, beforeEach } from 'vitest';
import {
  MqttTransport,
  type MqttClientLike,
  type MqttConnectFn,
  type MqttPublishOptions,
} from './mqttTransport';
import type { RelayConfig } from '../config/config';

/**
 * A faithful in-memory fake of the mqtt.js client surface the transport uses.
 * It records subscriptions/publishes and lets the test drive the `connect` and
 * `message` events — so we exercise the transport's REAL routing/presence logic
 * (which callback fires for which topic) without a network. The live broker is
 * proven separately by Task 3.3.
 */
class FakeMqttClient implements MqttClientLike {
  readonly published: { topic: string; payload: string; opts?: MqttPublishOptions }[] = [];
  readonly subscribed: string[] = [];
  ended = false;
  private handlers: Record<string, ((...a: never[]) => void)[]> = {};

  on(event: string, cb: (...args: never[]) => void): this {
    (this.handlers[event] ??= []).push(cb);
    return this;
  }

  subscribe(topics: string[], cb?: (err: Error | null) => void): this {
    this.subscribed.push(...topics);
    cb?.(null);
    return this;
  }

  publish(
    topic: string,
    payload: string,
    opts?: MqttPublishOptions,
    cb?: () => void,
  ): this {
    this.published.push({ topic, payload, opts });
    cb?.();
    return this;
  }

  end(): this {
    this.ended = true;
    return this;
  }

  /** Test driver: fire the broker `connect` event. */
  fireConnect(): void {
    for (const cb of this.handlers['connect'] ?? []) (cb as () => void)();
  }

  /** Test driver: fire an incoming `message`. */
  fireMessage(topic: string, payload: string): void {
    for (const cb of this.handlers['message'] ?? []) {
      (cb as (t: string, p: Uint8Array) => void)(
        topic,
        new TextEncoder().encode(payload),
      );
    }
  }

  /** Test driver: fire an `error`. */
  fireError(err: Error): void {
    for (const cb of this.handlers['error'] ?? []) (cb as (e: Error) => void)(err);
  }
}

const RELAY: RelayConfig = {
  wssUrl: 'wss://relay.example/mqtt',
  username: 'pente',
  password: 'pw',
  topicRoot: 'pente/v1',
};

/** Build a transport wired to a fresh fake client; return both. */
function makeTransport(peerId = 'peer-A'): {
  transport: MqttTransport;
  fake: FakeMqttClient;
  connectCalls: { url: string; opts: Record<string, unknown> }[];
} {
  const fake = new FakeMqttClient();
  const connectCalls: { url: string; opts: Record<string, unknown> }[] = [];
  const connectFn: MqttConnectFn = (url, opts) => {
    connectCalls.push({ url, opts: opts as unknown as Record<string, unknown> });
    return fake;
  };
  const transport = new MqttTransport(RELAY, {
    connect: connectFn,
    peerId,
  });
  return { transport, fake, connectCalls };
}

describe('MqttTransport.connect', () => {
  let t: ReturnType<typeof makeTransport>;
  beforeEach(() => {
    t = makeTransport();
  });

  it('connects to the SSOT relay url with the SSOT credentials', async () => {
    const p = t.transport.connect('room1');
    t.fake.fireConnect();
    await p;

    expect(t.connectCalls).toHaveLength(1);
    expect(t.connectCalls[0]!.url).toBe(RELAY.wssUrl);
    expect(t.connectCalls[0]!.opts.username).toBe(RELAY.username);
    expect(t.connectCalls[0]!.opts.password).toBe(RELAY.password);
    expect(t.connectCalls[0]!.opts.clientId).toBe('peer-A');
  });

  it('registers a retained empty-payload Last-Will on our presence topic', async () => {
    const p = t.transport.connect('room1');
    t.fake.fireConnect();
    await p;

    const will = t.connectCalls[0]!.opts.will as {
      topic: string;
      payload: string;
      retain: boolean;
    };
    expect(will.topic).toBe('pente/v1/room1/presence/peer-A');
    expect(will.payload).toBe('');
    expect(will.retain).toBe(true);
  });

  it('subscribes to the room events, state, and presence-wildcard topics', async () => {
    const p = t.transport.connect('room1');
    t.fake.fireConnect();
    await p;

    expect(t.fake.subscribed).toEqual([
      'pente/v1/room1/events',
      'pente/v1/room1/state',
      'pente/v1/room1/presence/+',
    ]);
  });

  it('announces our own presence (retained) on connect', async () => {
    const p = t.transport.connect('room1');
    t.fake.fireConnect();
    await p;

    const presence = t.fake.published.find((m) =>
      m.topic.endsWith('/presence/peer-A'),
    );
    expect(presence).toBeDefined();
    expect(presence!.opts?.retain).toBe(true);
    expect(JSON.parse(presence!.payload)).toEqual({ id: 'peer-A' });
  });

  it('resolves only after the broker `connect` event fires', async () => {
    let resolved = false;
    const p = t.transport.connect('room1').then(() => {
      resolved = true;
    });
    // not yet connected -> promise still pending
    await Promise.resolve();
    expect(resolved).toBe(false);

    t.fake.fireConnect();
    await p;
    expect(resolved).toBe(true);
  });

  it('rejects when the broker emits an error before connecting', async () => {
    const p = t.transport.connect('room1');
    t.fake.fireError(new Error('bad handshake'));
    await expect(p).rejects.toThrow('bad handshake');
  });

  it('rejects an empty roomCode without creating a client', async () => {
    await expect(t.transport.connect('')).rejects.toThrow(/non-empty/);
    expect(t.connectCalls).toHaveLength(0);
  });

  it('ignores the reserved password option (v1) — url/topics unchanged', async () => {
    const p = t.transport.connect('room1', { password: 'ignored-in-v1' });
    t.fake.fireConnect();
    await p;
    expect(t.fake.subscribed).toContain('pente/v1/room1/events');
    // reserved password does not leak into the mqtt auth password
    expect(t.connectCalls[0]!.opts.password).toBe(RELAY.password);
  });
});

describe('MqttTransport.publish', () => {
  it('publishes JSON to the room events topic', async () => {
    const t = makeTransport();
    const p = t.transport.connect('room1');
    t.fake.fireConnect();
    await p;

    t.transport.publish({ move: 'a1', seq: 7 });

    const ev = t.fake.published.find((m) => m.topic === 'pente/v1/room1/events');
    expect(ev).toBeDefined();
    expect(JSON.parse(ev!.payload)).toEqual({ move: 'a1', seq: 7 });
  });

  it('throws if publish is called before connect', () => {
    const t = makeTransport();
    expect(() => t.transport.publish({ x: 1 })).toThrow(/not connected/);
  });
});

describe('MqttTransport message routing', () => {
  it('routes an /events message to the onMessage handler (parsed JSON)', async () => {
    const t = makeTransport();
    const seen: unknown[] = [];
    t.transport.onMessage((m) => seen.push(m));
    const p = t.transport.connect('room1');
    t.fake.fireConnect();
    await p;

    t.fake.fireMessage('pente/v1/room1/events', JSON.stringify({ move: 'b2' }));

    expect(seen).toEqual([{ move: 'b2' }]);
  });

  it('does NOT route a /state message to onMessage (events only)', async () => {
    const t = makeTransport();
    const seen: unknown[] = [];
    t.transport.onMessage((m) => seen.push(m));
    const p = t.transport.connect('room1');
    t.fake.fireConnect();
    await p;

    t.fake.fireMessage('pente/v1/room1/state', JSON.stringify({ snapshot: 1 }));

    expect(seen).toEqual([]);
  });

  it('ignores an empty /events payload (retained-clear), not a JSON parse crash', async () => {
    const t = makeTransport();
    const seen: unknown[] = [];
    t.transport.onMessage((m) => seen.push(m));
    const p = t.transport.connect('room1');
    t.fake.fireConnect();
    await p;

    expect(() => t.fake.fireMessage('pente/v1/room1/events', '')).not.toThrow();
    expect(seen).toEqual([]);
  });

  it('tracks presence: a non-empty presence payload adds the peer', async () => {
    const t = makeTransport();
    const presence: string[][] = [];
    t.transport.onPresence((p) => presence.push([...p]));
    const p = t.transport.connect('room1');
    t.fake.fireConnect();
    await p;

    t.fake.fireMessage(
      'pente/v1/room1/presence/peer-B',
      JSON.stringify({ id: 'peer-B' }),
    );

    expect(presence.at(-1)).toEqual(['peer-B']);
  });

  it('tracks presence: an empty presence payload removes the peer (LWT/drop)', async () => {
    const t = makeTransport();
    const presence: string[][] = [];
    t.transport.onPresence((p) => presence.push([...p]));
    const p = t.transport.connect('room1');
    t.fake.fireConnect();
    await p;

    t.fake.fireMessage('pente/v1/room1/presence/peer-B', JSON.stringify({ id: 'peer-B' }));
    expect(presence.at(-1)).toEqual(['peer-B']);

    // peer-B drops -> broker delivers empty retained payload on its presence topic
    t.fake.fireMessage('pente/v1/room1/presence/peer-B', '');
    expect(presence.at(-1)).toEqual([]);
  });

  it('tolerates events/presence before any handler is registered (default no-op)', async () => {
    const t = makeTransport();
    // Deliberately register NO onMessage/onPresence handlers.
    const p = t.transport.connect('room1');
    t.fake.fireConnect();
    await p;

    expect(() => {
      t.fake.fireMessage('pente/v1/room1/events', JSON.stringify({ m: 1 }));
      t.fake.fireMessage(
        'pente/v1/room1/presence/peer-B',
        JSON.stringify({ id: 'peer-B' }),
      );
    }).not.toThrow();
  });

  it('ignores messages on unrelated topics', async () => {
    const t = makeTransport();
    const seen: unknown[] = [];
    const presence: string[][] = [];
    t.transport.onMessage((m) => seen.push(m));
    t.transport.onPresence((p) => presence.push([...p]));
    const p = t.transport.connect('room1');
    t.fake.fireConnect();
    await p;

    t.fake.fireMessage('pente/v1/room1/other', 'whatever');

    expect(seen).toEqual([]);
    // presence unchanged (only the initial [] snapshot if any)
    expect(presence.every((snap) => snap.length === 0)).toBe(true);
  });
});

describe('MqttTransport.disconnect', () => {
  it('clears our retained presence then ends the client', async () => {
    const t = makeTransport();
    const p = t.transport.connect('room1');
    t.fake.fireConnect();
    await p;

    t.transport.disconnect();

    const clear = t.fake.published.find(
      (m) => m.topic === 'pente/v1/room1/presence/peer-A' && m.payload === '',
    );
    expect(clear).toBeDefined();
    expect(clear!.opts?.retain).toBe(true);
    expect(t.fake.ended).toBe(true);
  });

  it('is a safe no-op before connect', () => {
    const t = makeTransport();
    expect(() => t.transport.disconnect()).not.toThrow();
    expect(t.fake.ended).toBe(false);
  });
});

describe('MqttTransport internal invariant guard', () => {
  it('topic() tripwire: if room is nulled while connected, it throws (not a silent bad topic)', async () => {
    const t = makeTransport();
    const p = t.transport.connect('room1');
    t.fake.fireConnect();
    await p;

    // Force the invariant violation: client still live but room lost. The guard
    // must surface a clear error rather than build `undefined`-laced topics.
    (t.transport as unknown as { room: string | null }).room = null;

    expect(() => t.transport.publish({ x: 1 })).toThrow('topic: not connected');
  });
});

describe('MqttTransport default construction (SSOT wiring)', () => {
  it('generates a peerId when none is injected', () => {
    // Construct with only a connect factory; no peerId -> auto-generated.
    const fake = new FakeMqttClient();
    const transport = new MqttTransport(RELAY, {
      connect: () => fake,
    });
    expect(transport.peerId).toMatch(/^p-/);
    expect(transport.peerId.length).toBeGreaterThan(2);
  });
});
