import { describe, it, expect, vi } from 'vitest';
import {
  MockRelayHub,
  MockTransport,
  roomTopic,
  type Transport,
  type ConnectOptions,
} from './transport';

describe('roomTopic', () => {
  it('derives `${topicRoot}/${roomCode}` (v1 seam)', () => {
    expect(roomTopic('pente/v1', 'abc123')).toBe('pente/v1/abc123');
    expect(roomTopic('r', 'xyz')).toBe('r/xyz');
  });

  it('ignores the reserved password (v1) — same topic with or without it', () => {
    const withPw: ConnectOptions = { password: 'secret' };
    expect(roomTopic('pente/v1', 'room', withPw)).toBe(
      roomTopic('pente/v1', 'room'),
    );
    expect(roomTopic('pente/v1', 'room', withPw)).toBe('pente/v1/room');
  });

  it('throws on an empty roomCode (never collapse onto the shared root)', () => {
    expect(() => roomTopic('pente/v1', '')).toThrow(/non-empty/);
  });
});

describe('MockTransport', () => {
  it('delivers a published message to the OTHER connected peer, not the sender', async () => {
    const hub = new MockRelayHub();
    const a = new MockTransport(hub, 'A');
    const b = new MockTransport(hub, 'B');
    const aSeen: unknown[] = [];
    const bSeen: unknown[] = [];
    a.onMessage((m) => aSeen.push(m));
    b.onMessage((m) => bSeen.push(m));

    await a.connect('room1');
    await b.connect('room1');

    a.publish({ move: 'e4', seq: 1 });

    // The OTHER client actually received the move (proof-by-behavior).
    expect(bSeen).toEqual([{ move: 'e4', seq: 1 }]);
    // The relay never echoes back to the sender.
    expect(aSeen).toEqual([]);
  });

  it('is bidirectional — B->A also delivers', async () => {
    const hub = new MockRelayHub();
    const a = new MockTransport(hub, 'A');
    const b = new MockTransport(hub, 'B');
    const aSeen: unknown[] = [];
    a.onMessage((m) => aSeen.push(m));
    await a.connect('r');
    await b.connect('r');

    b.publish({ from: 'B' });

    expect(aSeen).toEqual([{ from: 'B' }]);
  });

  it('isolates rooms — a message in one room does not reach another', async () => {
    const hub = new MockRelayHub();
    const a = new MockTransport(hub, 'A');
    const other = new MockTransport(hub, 'C');
    const otherSeen: unknown[] = [];
    other.onMessage((m) => otherSeen.push(m));
    await a.connect('room1');
    await other.connect('room2');

    a.publish({ x: 1 });

    expect(otherSeen).toEqual([]);
  });

  it('clones the wire payload so peers never share a mutable reference', async () => {
    const hub = new MockRelayHub();
    const a = new MockTransport(hub, 'A');
    const b = new MockTransport(hub, 'B');
    let received: { n: number } | undefined;
    b.onMessage((m) => {
      received = m as { n: number };
    });
    await a.connect('r');
    await b.connect('r');

    const payload = { n: 1 };
    a.publish(payload);
    payload.n = 999; // mutate the sender's object after publish

    expect(received).toEqual({ n: 1 });
  });

  it('reports presence to both peers as they join', async () => {
    const hub = new MockRelayHub();
    const a = new MockTransport(hub, 'A');
    const b = new MockTransport(hub, 'B');
    const aPresence: string[][] = [];
    const bPresence: string[][] = [];
    a.onPresence((p) => aPresence.push([...p]));
    b.onPresence((p) => bPresence.push([...p]));

    await a.connect('r');
    await b.connect('r');

    // A saw itself, then both after B joined.
    expect(aPresence.at(-1)).toEqual(['A', 'B']);
    expect(bPresence.at(-1)).toEqual(['A', 'B']);
  });

  it('updates presence on disconnect', async () => {
    const hub = new MockRelayHub();
    const a = new MockTransport(hub, 'A');
    const b = new MockTransport(hub, 'B');
    const aPresence: string[][] = [];
    a.onPresence((p) => aPresence.push([...p]));
    await a.connect('r');
    await b.connect('r');

    b.disconnect();

    expect(aPresence.at(-1)).toEqual(['A']);
    expect(hub.peerIds('r')).toEqual(['A']);
  });

  it('rejects connect with an empty roomCode', async () => {
    const hub = new MockRelayHub();
    const a = new MockTransport(hub);
    await expect(a.connect('')).rejects.toThrow(/non-empty/);
  });

  it('throws when publishing before connect', () => {
    const hub = new MockRelayHub();
    const a = new MockTransport(hub);
    expect(() => a.publish({ x: 1 })).toThrow(/not connected/);
  });

  it('disconnect is idempotent and safe before connect', () => {
    const hub = new MockRelayHub();
    const a = new MockTransport(hub);
    expect(() => {
      a.disconnect();
      a.disconnect();
    }).not.toThrow();
  });

  it('the latest onMessage/onPresence registration wins', async () => {
    const hub = new MockRelayHub();
    const a = new MockTransport(hub, 'A');
    const b = new MockTransport(hub, 'B');
    const first = vi.fn();
    const second = vi.fn();
    b.onMessage(first);
    b.onMessage(second);
    await a.connect('r');
    await b.connect('r');

    a.publish({ v: 1 });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ v: 1 });
  });

  it('tolerates a delivered message before any onMessage handler (default no-op)', async () => {
    const hub = new MockRelayHub();
    const a = new MockTransport(hub, 'A');
    const b = new MockTransport(hub, 'B');
    // b registers NO onMessage handler.
    await a.connect('r');
    await b.connect('r');
    expect(() => a.publish({ x: 1 })).not.toThrow();
  });

  it('generates a distinct default peerId when none is given', () => {
    const hub = new MockRelayHub();
    const a = new MockTransport(hub);
    const b = new MockTransport(hub);
    expect(a.peerId).toMatch(/^mock-/);
    expect(a.peerId).not.toBe(b.peerId);
  });

  it('satisfies the Transport interface', async () => {
    const hub = new MockRelayHub();
    const t: Transport = new MockTransport(hub, 'A');
    // opts is accepted (reserved password ignored) and connect resolves.
    await expect(t.connect('r', { password: 'ignored' })).resolves.toBeUndefined();
    t.disconnect();
  });

  it('empty room after all leave — peerIds returns []', async () => {
    const hub = new MockRelayHub();
    const a = new MockTransport(hub, 'A');
    await a.connect('r');
    a.disconnect();
    expect(hub.peerIds('r')).toEqual([]);
    // publishing into a now-empty/unknown room is a no-op, not a throw
    expect(hub.peerIds('never-used')).toEqual([]);
  });
});

describe('MockRelayHub direct guards (unknown room)', () => {
  it('publish to a room with no members is a safe no-op', () => {
    const hub = new MockRelayHub();
    const a = new MockTransport(hub, 'A');
    // sender not joined anywhere; publishing to an unknown room delivers nowhere
    const seen: unknown[] = [];
    a.onMessage((m) => seen.push(m));
    expect(() => hub.publish('ghost-room', a, { x: 1 })).not.toThrow();
    expect(seen).toEqual([]);
  });

  it('leave on an unknown room is a safe no-op', () => {
    const hub = new MockRelayHub();
    const a = new MockTransport(hub, 'A');
    expect(() => hub.leave('ghost-room', a)).not.toThrow();
    expect(hub.peerIds('ghost-room')).toEqual([]);
  });
});
