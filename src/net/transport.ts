/**
 * The `Transport` seam — the one durable artifact from the networking POC
 * (planning/2026-07-18-networking-poc-design.md, "The keeper artifact").
 *
 * The game codes against this interface only; MQTT (or any future relay:
 * Firebase, Trystero, a matchmaking `RelayTransport`, …) can be swapped in
 * without touching game logic. This is the master seam that makes the deferred
 * "Level 2 — enforced transport" a swap rather than a caller sweep.
 *
 * ## Reserved seams (design doc "Seams v1 MUST reserve now")
 *
 * - **`connect(roomCode, opts?)`** widens the signature to accept `{ password }`
 *   now, even though **v1 ignores it**. Callers won't change when a room password
 *   starts mattering.
 * - **{@link roomTopic}** is the single function that maps room identity → topic
 *   root, so folding a password into the topic (Level 1 "password via topic
 *   derivation") is a one-function change, not a caller sweep.
 *
 * This module is view-agnostic networking glue: it must not import
 * three/render/ui. It carries **no game logic** — seat/sync/undo rules live in
 * their own units on top of this seam.
 */

/** A JSON-serialisable message body. The relay treats it as opaque. */
export type TransportMessage = unknown;

/** Callback invoked with each peer message received on the room. */
export type MessageHandler = (msg: TransportMessage) => void;

/**
 * Callback invoked with the current set of present peer ids whenever presence
 * changes. The array is a snapshot; callers must not mutate it.
 */
export type PresenceHandler = (peers: readonly string[]) => void;

/**
 * Options for {@link Transport.connect}. `password` is **reserved and ignored in
 * v1** — it exists so the room-password feature (fold password into the topic)
 * drops in without changing callers (design doc "Seams v1 MUST reserve now" #2).
 */
export interface ConnectOptions {
  /** RESERVED — ignored in v1. Future: folded into the room topic. */
  readonly password?: string;
}

/**
 * The swappable networking interface (GLOSSARY "Transport"). Five methods; MQTT
 * is one implementation. All bodies are opaque JSON to the relay.
 */
export interface Transport {
  /**
   * Join a room and begin relaying. `opts.password` is reserved/ignored in v1.
   * Resolves once the transport is ready to publish/receive.
   */
  connect(roomCode: string, opts?: ConnectOptions): Promise<void>;
  /** Fire a JSON message to every other peer in the room. */
  publish(msg: TransportMessage): void;
  /** Register the handler for peer messages. The latest registration wins. */
  onMessage(cb: MessageHandler): void;
  /** Register the handler for presence changes. The latest registration wins. */
  onPresence(cb: PresenceHandler): void;
  /** Leave the room and release resources. Idempotent. */
  disconnect(): void;
}

/**
 * Map a room identity to its topic root — the single place room→topic lives, so
 * the deferred "password into topic" (Level 1) is a one-function change.
 *
 * v1 derivation is `` `${topicRoot}/${roomCode}` ``; `opts.password` is reserved
 * and **ignored** (folding it in is a future one-liner here). Throws on an empty
 * `roomCode` so a mistyped/blank room can never silently collapse onto the shared
 * `topicRoot` (where every peer would leak into one global room).
 *
 * @param topicRoot The relay topic root (SSOT: `relay.json`).
 * @param roomCode The room/game code. Must be non-empty.
 * @param _opts Reserved; `password` is ignored in v1.
 */
export function roomTopic(
  topicRoot: string,
  roomCode: string,
  _opts?: ConnectOptions,
): string {
  if (roomCode.length === 0) {
    throw new Error('roomTopic: roomCode must be non-empty');
  }
  return `${topicRoot}/${roomCode}`;
}

/**
 * A shared in-memory relay that {@link MockTransport} instances rendezvous on by
 * room code — the test-double for the MQTT broker. It fans a publish out to every
 * *other* connected peer in the same room and tracks presence, so unit tests of
 * the logic layers (seats, sync, undo) exercise real two-client message exchange
 * and presence without any network.
 *
 * It is a faithful *relay*: like the real broker it never echoes a message back
 * to its own sender and knows nothing about Pente.
 */
export class MockRelayHub {
  /** roomCode → set of connected transports. */
  private readonly rooms = new Map<string, Set<MockTransport>>();

  /** Register a transport as present in a room; announce presence to the room. */
  join(room: string, peer: MockTransport): void {
    let members = this.rooms.get(room);
    if (members === undefined) {
      members = new Set();
      this.rooms.set(room, members);
    }
    members.add(peer);
    this.broadcastPresence(room);
  }

  /** Remove a transport from a room; announce the updated presence. */
  leave(room: string, peer: MockTransport): void {
    const members = this.rooms.get(room);
    if (members === undefined) return;
    members.delete(peer);
    if (members.size === 0) this.rooms.delete(room);
    this.broadcastPresence(room);
  }

  /** Relay a message to every peer in the room *except* the sender. */
  publish(room: string, sender: MockTransport, msg: TransportMessage): void {
    const members = this.rooms.get(room);
    if (members === undefined) return;
    // Clone through JSON so mocks behave like a real relay (opaque JSON, no
    // shared references leaking between "peers").
    const wire = JSON.parse(JSON.stringify(msg)) as TransportMessage;
    for (const peer of members) {
      if (peer !== sender) peer.deliver(wire);
    }
  }

  /** The peer ids currently present in a room (snapshot). */
  peerIds(room: string): string[] {
    const members = this.rooms.get(room);
    if (members === undefined) return [];
    return [...members].map((p) => p.peerId);
  }

  private broadcastPresence(room: string): void {
    const members = this.rooms.get(room);
    const peers = members === undefined ? [] : [...members].map((p) => p.peerId);
    // Notify every member (including senders) — presence is room-wide truth.
    if (members !== undefined) {
      for (const peer of members) peer.presenceChanged(peers);
    }
  }
}

/**
 * An in-memory {@link Transport} for unit-testing the logic layers (seats, sync,
 * undo) without a network. Two `MockTransport`s sharing a {@link MockRelayHub}
 * and the same room code exchange real messages and see each other's presence —
 * so tests assert on the *other* client actually receiving a move, never on a log
 * line (agent-principles #3).
 */
export class MockTransport implements Transport {
  /** This peer's stable id within the hub. */
  readonly peerId: string;

  private readonly hub: MockRelayHub;
  private room: string | null = null;
  private msgCb: MessageHandler = () => {};
  private presenceCb: PresenceHandler = () => {};

  /**
   * @param hub The shared in-memory relay both peers rendezvous on.
   * @param peerId This peer's id (default: a random `mock-…`).
   */
  constructor(hub: MockRelayHub, peerId: string = randomPeerId()) {
    this.hub = hub;
    this.peerId = peerId;
  }

  connect(roomCode: string, _opts?: ConnectOptions): Promise<void> {
    if (roomCode.length === 0) {
      return Promise.reject(new Error('connect: roomCode must be non-empty'));
    }
    this.room = roomCode;
    this.hub.join(roomCode, this);
    return Promise.resolve();
  }

  publish(msg: TransportMessage): void {
    if (this.room === null) {
      throw new Error('publish: not connected');
    }
    this.hub.publish(this.room, this, msg);
  }

  onMessage(cb: MessageHandler): void {
    this.msgCb = cb;
  }

  onPresence(cb: PresenceHandler): void {
    this.presenceCb = cb;
  }

  disconnect(): void {
    if (this.room === null) return;
    const room = this.room;
    this.room = null;
    this.hub.leave(room, this);
  }

  /** Hub-internal: deliver a relayed message to this peer's handler. */
  deliver(msg: TransportMessage): void {
    this.msgCb(msg);
  }

  /** Hub-internal: notify this peer of a presence change. */
  presenceChanged(peers: readonly string[]): void {
    this.presenceCb(peers);
  }
}

/** A random, collision-resistant-enough mock peer id. */
function randomPeerId(): string {
  return `mock-${Math.random().toString(36).slice(2, 10)}`;
}
