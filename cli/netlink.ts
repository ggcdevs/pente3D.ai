/**
 * The CLI's mqtt.js connect seam, plus a **controllable network link**: the ability to
 * sever the socket underneath a LIVE session and later let it come back — without the
 * session ever being told (no `NetSession.disconnect()`, no re-`enter()`).
 *
 * ## Why this exists
 *
 * Issue #45 ("i played from my phone, then locked the screen… it reconnected, but it
 * never got an update") is a **transport-level** drop under a session that stays
 * `connected`: mqtt.js reconnects on its own (`reconnectPeriod`), re-subscribes, and
 * re-announces presence, but nothing re-runs admission — and because sync is
 * incremental + NON-retained, every move made during the outage is simply gone.
 * Reproducing that needs a killed socket, not a session teardown, so the seam is here.
 *
 * Kept entirely CLI-side: `src/` is untouched, and the daemon exposes it as the
 * `drop`/`restore` verbs so a scenario script can script an outage deterministically.
 *
 * A session holds ONE transport (hence one client) at a time; a re-enter builds a fresh
 * one, so tracking only the most recent client is exactly the live link.
 */
import mqtt, { type MqttClient } from 'mqtt';
import type { MqttClientLike } from '../src/net/mqttTransport';

/** Whether the CLI currently holds a live socket to the relay. */
export type LinkStatus = 'up' | 'down' | 'none';

/** The most recently opened client — the session's live link. */
let current: MqttClient | null = null;
/** The `reconnectPeriod` the transport asked for, restored by {@link restoreLink}. */
let reconnectPeriod = 2000;

/**
 * The `connect` seam handed to {@link MqttTransport}: opens the real mqtt.js client and
 * remembers it as the live link so {@link dropLink}/{@link restoreLink} can act on it.
 */
export function connect(url: string, opts: unknown): MqttClientLike {
  const options = opts as mqtt.IClientOptions;
  reconnectPeriod = options.reconnectPeriod ?? reconnectPeriod;
  const client = mqtt.connect(url, options);
  current = client;
  return client as unknown as MqttClientLike;
}

/** `up` while the socket is connected, `down` once dropped, `none` before any connect. */
export function linkStatus(): LinkStatus {
  if (current === null) return 'none';
  return current.connected ? 'up' : 'down';
}

/** How an outage behaves at the broker — see {@link dropLink}. */
export interface DropOptions {
  /**
   * GRACEFUL disconnect: send the MQTT DISCONNECT packet, which makes the broker DISCARD our
   * Last-Will. The peer therefore never sees us go absent — its live set never changes, and the
   * only thing that can tell it we came back is our re-announce (and its answer). This is the case
   * resident-peer republish's un-gated trigger exists for; a Last-Will outage cannot exercise it.
   */
  readonly silent?: boolean;
  /**
   * LOSSY: publishes issued while the link is down are DROPPED (`queueQoSZero = false`) instead of
   * being queued and flushed on reconnect. Without this, mqtt.js's own offline queue delivers the
   * move made during the outage as soon as the socket returns — convergence would prove the queue
   * works, not that the peers republished. "A move that never got out" (design §5) needs it gone.
   */
  readonly lossy?: boolean;
}

/**
 * DROP the link: stop mqtt.js from auto-reconnecting (`reconnectPeriod = 0`), then take the socket
 * down — a screen-lock / lost-signal drop. The session keeps its engine, seat and game in memory and
 * stays `connected`, exactly as the browser tab does.
 *
 * By default the drop is UNGRACEFUL (the socket is destroyed), which is indistinguishable from a
 * real one at the broker: our Last-Will fires and the peer sees us go absent. {@link DropOptions}
 * selects the harder variants the design has to survive.
 *
 * @returns `false` if there is no link to drop (never connected).
 */
export function dropLink(opts: DropOptions = {}): boolean {
  if (current === null) return false;
  current.options.reconnectPeriod = 0;
  // NB: the live flag is the CLIENT property (mqtt.js copies `options.queueQoSZero` once, at
  // construction) — setting `options` here would silently keep queueing. Probed, not assumed.
  if (opts.lossy === true) current.queueQoSZero = false;
  if (opts.silent === true) current.end(false);
  else current.stream.destroy();
  return true;
}

/**
 * RESTORE the link: re-enable auto-reconnect and reconnect now. Fires mqtt.js's `connect`
 * again, so the transport re-subscribes and re-announces presence — the peer sees us return.
 * Whether we then CATCH UP on moves made during the outage is the behaviour under test
 * (today: we do not — issue #45).
 *
 * @returns `false` if there is no link to restore (never connected).
 */
export function restoreLink(): boolean {
  if (current === null) return false;
  current.options.reconnectPeriod = reconnectPeriod;
  // Publishes are queued again once we are back — the loss belongs to the outage, not to the peer.
  current.queueQoSZero = true;
  if (!current.connected) current.reconnect();
  return true;
}
