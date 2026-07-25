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

  /** True once our LIVE (non-retained) presence hello was published on connect. */
  helloPublished(peerId: string): boolean {
    return this.published.some(
      (m) => m.topic.endsWith(`/presence/${peerId}`) && m.opts?.retain === false && m.payload !== '',
    );
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

  /**
   * Test driver: fire an incoming `message`. `retained` models the mqtt.js `packet.retain` flag —
   * a message the broker replayed because it was retained (`true`) vs a live publish seen while
   * subscribed (`false`, the default). This is load-bearing for issue #5: a retained presence must
   * not count as a live peer.
   */
  fireMessage(topic: string, payload: string, retained = false): void {
    for (const cb of this.handlers['message'] ?? []) {
      (cb as (t: string, p: Uint8Array, packet: { retain: boolean }) => void)(
        topic,
        new TextEncoder().encode(payload),
        { retain: retained },
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

/** How many LIVE (non-retained, non-empty) presence publishes `peerId` has put on the wire. */
function liveAcks(fake: FakeMqttClient, peerId = 'peer-A'): number {
  return fake.published.filter(
    (m) => m.topic.endsWith(`/presence/${peerId}`) && m.opts?.retain === false && m.payload !== '',
  ).length;
}

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

    const presence = t.fake.published.find(
      (m) => m.topic.endsWith('/presence/peer-A') && m.opts?.retain === true,
    );
    expect(presence).toBeDefined();
    expect(JSON.parse(presence!.payload)).toEqual({ id: 'peer-A' });
  });

  it('also publishes a LIVE (non-retained) presence hello on connect (issue #5 handshake)', async () => {
    // The retained presence is for discovery; the live hello is the FRESH signal a present peer
    // replies to. Without it, two peers already retained on the broker would each only see the
    // other's retained snapshot and never confirm liveness.
    const p = t.transport.connect('room1');
    t.fake.fireConnect();
    await p;
    expect(t.fake.helloPublished('peer-A')).toBe(true);
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

  it('tracks presence: a non-empty LIVE presence payload adds the peer', async () => {
    const t = makeTransport();
    const presence: string[][] = [];
    t.transport.onPresence((p) => presence.push([...p]));
    const p = t.transport.connect('room1');
    t.fake.fireConnect();
    await p;

    t.fake.fireMessage(
      'pente/v1/room1/presence/peer-B',
      JSON.stringify({ id: 'peer-B' }),
      false, // live (non-retained) — a genuinely present peer
    );

    expect(presence.at(-1)).toEqual(['peer-B']);
  });

  it('issue #5: a RETAINED presence does NOT surface a peer as present (phantom guard)', async () => {
    // The dead-room scenario: a joiner subscribes to a room where peer-B crashed leaving a stale
    // RETAINED presence. The broker replays it (retain=true). It must NOT be reported as present —
    // there is no live opponent, only a ghost. (mqtt-level proof of the issue #5 fix.)
    const t = makeTransport();
    const presence: string[][] = [];
    t.transport.onPresence((p) => presence.push([...p]));
    const pr = t.transport.connect('room1');
    t.fake.fireConnect();
    await pr;

    t.fake.fireMessage(
      'pente/v1/room1/presence/peer-B',
      JSON.stringify({ id: 'peer-B' }),
      true, // RETAINED — a stale snapshot from a peer that is gone
    );

    // No presence callback fired with peer-B present (the live set never changed).
    expect(presence.every((snap) => !snap.includes('peer-B'))).toBe(true);
  });

  it('issue #5: a retained snapshot FOLLOWED BY a live announcement DOES surface the peer', async () => {
    // The same peer that first appeared retained then sends a FRESH live presence (e.g. it really is
    // online and answers our hello) — now it is a genuine live opponent and must be reported.
    const t = makeTransport();
    const presence: string[][] = [];
    t.transport.onPresence((p) => presence.push([...p]));
    const pr = t.transport.connect('room1');
    t.fake.fireConnect();
    await pr;

    t.fake.fireMessage('pente/v1/room1/presence/peer-B', JSON.stringify({ id: 'peer-B' }), true);
    expect(presence.every((snap) => !snap.includes('peer-B'))).toBe(true);

    t.fake.fireMessage('pente/v1/room1/presence/peer-B', JSON.stringify({ id: 'peer-B' }), false);
    expect(presence.at(-1)).toEqual(['peer-B']);
  });

  it('issue #5: replies to a peer\'s LIVE hello with our own live presence (handshake ack)', async () => {
    // When a live peer announces itself, we must answer with a fresh live presence so IT learns we
    // are alive too — completing the handshake both ways. The ack is a non-retained publish on our
    // own presence topic.
    const t = makeTransport();
    const pr = t.transport.connect('room1');
    t.fake.fireConnect();
    await pr;
    const beforeAck = t.fake.published.filter(
      (m) => m.topic.endsWith('/presence/peer-A') && m.opts?.retain === false,
    ).length;

    t.fake.fireMessage('pente/v1/room1/presence/peer-B', JSON.stringify({ id: 'peer-B' }), false);

    const afterAck = t.fake.published.filter(
      (m) => m.topic.endsWith('/presence/peer-A') && m.opts?.retain === false,
    ).length;
    expect(afterAck).toBe(beforeAck + 1); // exactly one live ack published in response
  });

  it('answers EVERY announce, including a re-announce from a peer we already believe is live', async () => {
    // The V.3 (#45) correction: the ack used to be latched one-per-peer, which went silent for a
    // peer that dropped and returned WITHOUT the broker publishing an absence — leaving the returner
    // with no live signal at all, so it never republished the move only it holds (design §5 mirror).
    // Every announce is answered; the ack flag (below) is what stops the ping-pong instead.
    const t = makeTransport();
    const pr = t.transport.connect('room1');
    t.fake.fireConnect();
    await pr;

    t.fake.fireMessage('pente/v1/room1/presence/peer-B', JSON.stringify({ id: 'peer-B' }), false);
    const afterFirst = liveAcks(t.fake);
    // A socket-level return: peer-B re-announces into a live set that never changed.
    t.fake.fireMessage('pente/v1/room1/presence/peer-B', JSON.stringify({ id: 'peer-B' }), false);

    expect(liveAcks(t.fake)).toBe(afterFirst + 1);
  });

  it('answers NOTHING once disconnected (a late presence after teardown must not publish)', async () => {
    // mqtt.js can deliver a message that was already in flight when we tore the client down. There
    // is no client to publish on then, so the answer is skipped — and skipped silently, not by
    // throwing out of the broker's message handler.
    const t = makeTransport();
    const pr = t.transport.connect('room1');
    t.fake.fireConnect();
    await pr;
    t.transport.disconnect();
    const afterDisconnect = t.fake.published.length;

    expect(() =>
      t.fake.fireMessage('pente/v1/room1/presence/peer-B', JSON.stringify({ id: 'peer-B' }), false),
    ).not.toThrow();

    expect(t.fake.published.length).toBe(afterDisconnect);
  });

  it('never answers an ACK — the flag, not a latch, is what terminates the handshake', async () => {
    // Our own ack is marked `ack: true`; a peer's ack carries the same flag. Answering one would
    // make two peers publish live presence at each other forever, which is why the un-latched
    // announce-answering above is safe.
    const t = makeTransport();
    const pr = t.transport.connect('room1');
    t.fake.fireConnect();
    await pr;
    const before = liveAcks(t.fake);

    t.fake.fireMessage(
      'pente/v1/room1/presence/peer-B',
      JSON.stringify({ id: 'peer-B', ack: true }),
      false,
    );

    expect(liveAcks(t.fake)).toBe(before);
  });

  it('marks its own ack `ack: true` so the peer it answers does not answer back', async () => {
    const t = makeTransport();
    const pr = t.transport.connect('room1');
    t.fake.fireConnect();
    await pr;

    t.fake.fireMessage('pente/v1/room1/presence/peer-B', JSON.stringify({ id: 'peer-B' }), false);

    const ack = t.fake.published
      .filter((m) => m.topic.endsWith('/presence/peer-A') && m.opts?.retain === false)
      .at(-1);
    expect(JSON.parse(ack!.payload)).toEqual({ id: 'peer-A', ack: true });
    // …and the connect-time ANNOUNCE carries no flag, or a peer would never answer it.
    const announce = t.fake.published.find(
      (m) => m.topic.endsWith('/presence/peer-A') && m.opts?.retain === false,
    );
    expect(JSON.parse(announce!.payload)).toEqual({ id: 'peer-A' });
  });

  it('answers a MALFORMED live presence body (an unreadable peer is still a peer to answer)', async () => {
    // Only an explicit `ack: true` suppresses the answer. Anything unparseable is read as an
    // announce — the safe direction, and it must not crash routing either.
    const t = makeTransport();
    const live: string[] = [];
    t.transport.onPeerLive((id) => live.push(id));
    const pr = t.transport.connect('room1');
    t.fake.fireConnect();
    await pr;
    const before = liveAcks(t.fake);

    expect(() =>
      t.fake.fireMessage('pente/v1/room1/presence/peer-B', 'not json at all', false),
    ).not.toThrow();

    expect(liveAcks(t.fake)).toBe(before + 1);
    expect(live).toEqual(['peer-B']);
  });

  it('issue #5: ignores our OWN presence topic (never self-counts)', async () => {
    const t = makeTransport('me');
    const presence: string[][] = [];
    t.transport.onPresence((p) => presence.push([...p]));
    const pr = t.transport.connect('room1');
    t.fake.fireConnect();
    await pr;

    // The broker echoes our own live presence back on our topic; it must never make US present.
    t.fake.fireMessage('pente/v1/room1/presence/me', JSON.stringify({ id: 'me' }), false);

    expect(presence.every((snap) => !snap.includes('me'))).toBe(true);
  });

  it('tracks presence: an empty presence payload removes the peer (LWT/drop)', async () => {
    const t = makeTransport();
    const presence: string[][] = [];
    t.transport.onPresence((p) => presence.push([...p]));
    const p = t.transport.connect('room1');
    t.fake.fireConnect();
    await p;

    t.fake.fireMessage('pente/v1/room1/presence/peer-B', JSON.stringify({ id: 'peer-B' }), false);
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

/**
 * Task V.3 (epic #47, fixes **#45**) — the FRESH-LIVE-PRESENCE signal resident-peer republish
 * stands on (`onPeerLive`). It exists because this adapter's other presence path is CHANGE-gated:
 * `PresenceTracker` reports only a change to the LIVE SET, and an observed absence is what makes a
 * return a change. A peer whose socket dropped and returned WITHOUT the broker publishing an
 * absence re-announces into an unchanged set and produces no presence callback at all — so the
 * resident would never republish the move it missed. That is the exact suppression measured on the
 * real relay while building the #45 repro.
 */
describe('MqttTransport.onPeerLive — the un-gated fresh-live-presence signal (V.3, #45)', () => {
  it('fires on a peer\'s LIVE presence, carrying that peer\'s id', async () => {
    const t = makeTransport();
    const live: string[] = [];
    t.transport.onPeerLive((id) => live.push(id));
    const p = t.transport.connect('room1');
    t.fake.fireConnect();
    await p;

    t.fake.fireMessage('pente/v1/room1/presence/peer-B', JSON.stringify({ id: 'peer-B' }), false);

    expect(live).toEqual(['peer-B']);
  });

  it('fires AGAIN for an already-live peer, when NO presence change occurs (the #45 case)', async () => {
    // The suppression this signal exists to survive, reproduced at the adapter level: peer-B is
    // already live, so a re-announce changes the live SET not at all. The change-gated path goes
    // quiet; the peer-live signal must not — and our answer must go out anyway, because that answer
    // is the only signal the RETURNER gets (design §5 mirror).
    const t = makeTransport();
    const presence: string[][] = [];
    const live: string[] = [];
    t.transport.onPresence((p) => presence.push([...p]));
    t.transport.onPeerLive((id) => live.push(id));
    const pr = t.transport.connect('room1');
    t.fake.fireConnect();
    await pr;

    t.fake.fireMessage('pente/v1/room1/presence/peer-B', JSON.stringify({ id: 'peer-B' }), false);
    const presenceCallbacks = presence.length;
    const acks = liveAcks(t.fake);

    // The peer drops and returns WITHOUT the broker ever publishing an absence: it simply
    // re-announces itself live.
    t.fake.fireMessage('pente/v1/room1/presence/peer-B', JSON.stringify({ id: 'peer-B' }), false);

    // Proof the change-gated path is silent here — this is not a signal derivable from it.
    expect(presence.length).toBe(presenceCallbacks);
    // …the un-gated signal fired for the return…
    expect(live).toEqual(['peer-B', 'peer-B']);
    // …and the returning peer was told we are live, so IT can republish too.
    expect(liveAcks(t.fake)).toBe(acks + 1);
  });

  it('does NOT fire for a RETAINED snapshot (a ghost is not a returning peer)', async () => {
    const t = makeTransport();
    const live: string[] = [];
    t.transport.onPeerLive((id) => live.push(id));
    const p = t.transport.connect('room1');
    t.fake.fireConnect();
    await p;

    t.fake.fireMessage('pente/v1/room1/presence/peer-B', JSON.stringify({ id: 'peer-B' }), true);

    expect(live).toEqual([]);
  });

  it('does NOT fire for an ABSENCE (an empty payload — a leave or a fired Last-Will)', async () => {
    const t = makeTransport();
    const live: string[] = [];
    t.transport.onPeerLive((id) => live.push(id));
    const p = t.transport.connect('room1');
    t.fake.fireConnect();
    await p;

    t.fake.fireMessage('pente/v1/room1/presence/peer-B', JSON.stringify({ id: 'peer-B' }), false);
    t.fake.fireMessage('pente/v1/room1/presence/peer-B', '', false);

    expect(live).toEqual(['peer-B']);
  });

  it('never fires for our OWN presence (we are not a peer to serve)', async () => {
    const t = makeTransport('peer-A');
    const live: string[] = [];
    t.transport.onPeerLive((id) => live.push(id));
    const p = t.transport.connect('room1');
    t.fake.fireConnect();
    await p;

    t.fake.fireMessage('pente/v1/room1/presence/peer-A', JSON.stringify({ id: 'peer-A' }), false);

    expect(live).toEqual([]);
  });

  it('with NO handler registered a live presence is harmless (the default is a no-op)', async () => {
    const t = makeTransport();
    const p = t.transport.connect('room1');
    t.fake.fireConnect();
    await p;

    expect(() =>
      t.fake.fireMessage('pente/v1/room1/presence/peer-B', JSON.stringify({ id: 'peer-B' }), false),
    ).not.toThrow();
  });
});
