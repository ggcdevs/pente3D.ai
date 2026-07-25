/**
 * PURE resident-peer-republish decision (Task V.3, epic #47 — fixes **#45**).
 *
 * ## The bug this exists to kill
 *
 * > *"i played from my phone, then locked the screen. it disconnected. i played a move on the
 * > laptop. after turning my phone back on, it reconnected, but it never got an update. so it was
 * > never able to play because it thought it was still the laptop's turn."*
 *
 * Sync is **incremental and non-retained**: a move published while a peer is away is simply gone by
 * the time it returns. mqtt.js reconnects on its own, re-subscribes and re-announces presence, but
 * nothing re-runs admission and nothing replays the missed move — so the returning peer sits one
 * ply behind, believing it is the opponent's turn, and the game is bricked.
 *
 * Design §4's answer is **resident-peer republish**, deliberately chosen over a retained MQTT
 * state message: a retained per-room message would re-couple code↔game *at the broker* and destroy
 * the "re-use DUDEEE forever" model the whole v3.1 remodel exists to serve. So convergence is
 * driven by the peers: whoever is in the room republishes its FULL authoritative log
 * ({@link SyncEngine.publishState}) when it sees a peer live. It runs in **both directions** — the
 * resident serves the returner, and the returner serves a resident that missed ITS last move
 * (design §5's mirror case) — and it needs no new message kind.
 *
 * ## What this module decides
 *
 * This is the decision half only: *given* that a peer showed fresh live presence, does anything go
 * on the wire? The transport/session glue owns the signal and the publish; this owns the rule.
 *
 * ## Why the trigger is ANY fresh live presence, not an absent→present EDGE
 *
 * Measured on the real relay while building the #45 repro: `MqttTransport`'s `acked` set dedupes
 * the live-presence ack per peer and `PresenceTracker` only notifies when the LIVE SET changes —
 * and an observed **absence** is what resets both. A blip the broker never turns into an absence
 * therefore produces no presence transition at all, so an edge-triggered republish would never
 * fire. The signal fed to {@link RepublishLimiter.onPeerLive} is consequently every fresh live
 * presence publish, transition or not; making repeats harmless is this module's job, not the
 * trigger's.
 *
 * ## The limiter, and why it is a window and not a latch
 *
 * A latch ("serve each peer once") starves a genuine second return: a peer can drop again *before*
 * our republish reaches it, come back, and — with our log unchanged — have nothing to distinguish
 * it from a duplicate. So suppression is bounded three ways, and any one of them re-opens a peer:
 *
 *  - **a head it has not been served** — our log advanced, which IS the #45 case;
 *  - **the window elapsing** — the ack ping-pong is milliseconds, a genuine return is not;
 *  - **an observed absence** ({@link RepublishLimiter.observePresent}) — a peer that left has
 *    definitely missed traffic, so it is forgotten outright and served the moment it returns.
 *
 * ## Purity
 *
 * No transport, DOM, clock or randomness — the observation time is an argument, so the whole rule
 * is a deterministic fold over signals (agent-principles: keep the IO adapter thin, the decision
 * separable). This module carries no game logic and imports nothing from three/render/ui.
 */

/** Why a fresh live presence did NOT put our log on the wire. */
export type RepublishSkip =
  /**
   * We hold no authoritative log to serve — offline, or entry is still open (the admission
   * protocol, not this rule, decides what a peer gets before the session settles on a game).
   */
  | 'nothing-to-serve'
  /**
   * We already served this peer this exact head, moments ago. The handshake's live-presence ack
   * arrives right behind the announce it answers; without this, one return would publish twice.
   */
  | 'rate-limited';

/** The outcome of one fresh-live-presence observation. */
export type RepublishDecision =
  | { readonly publish: true }
  | { readonly publish: false; readonly reason: RepublishSkip };

/** One observation: a peer showed fresh live presence while we held (or did not hold) a log. */
export interface RepublishSignal {
  /**
   * The peer that announced itself. Any stable per-connection id will do — the rule only ever
   * compares it for equality, never interprets it.
   */
  readonly peerId: string;
  /**
   * A fingerprint of the log we would republish, or `null` when we hold none. The caller passes
   * the log's `headHash`: it folds in the game uuid at genesis, so it identifies **both** which
   * game and how much history — exactly what "has this peer already got what we would send" asks.
   */
  readonly serving: string | null;
  /** When the signal was observed (an injected clock in the caller; this module has none). */
  readonly at: number;
}

/**
 * How long an identical repeat is suppressed (ms). Sized against what it is suppressing: the
 * transport's live-presence handshake (announce → ack) completes in milliseconds, while a genuine
 * drop-and-return is orders of magnitude slower — so a window this side of a second silences the
 * ack echo without ever silencing a real return.
 */
export const DEFAULT_REPUBLISH_INTERVAL_MS = 1000;

/** What we last put on the wire for one peer. */
interface Served {
  readonly serving: string;
  readonly at: number;
}

/**
 * Decides whether a peer's fresh live presence should make us republish our authoritative log, and
 * remembers just enough to make repeats harmless. See the file header for the rule and for why the
 * suppression is a window rather than a latch.
 */
export class RepublishLimiter {
  /** How long an identical repeat is suppressed for one peer. */
  private readonly minIntervalMs: number;
  /** peerId → the head we last served it, and when. Absent = never served (or forgotten). */
  private readonly served = new Map<string, Served>();

  /**
   * @param minIntervalMs How long an identical repeat is suppressed (ms). `0` disables the window
   *   entirely (every signal for an unchanged head republishes); defaults to
   *   {@link DEFAULT_REPUBLISH_INTERVAL_MS}.
   */
  constructor(minIntervalMs: number = DEFAULT_REPUBLISH_INTERVAL_MS) {
    this.minIntervalMs = minIntervalMs;
  }

  /**
   * Decide one fresh-live-presence observation, recording the serve when it publishes.
   *
   * A `serving: null` signal is refused WITHOUT touching the record — holding nothing is not
   * "having served" the peer (so the next real signal still publishes) and it is not a serve to
   * forget either (so it cannot smuggle a peer past the window).
   */
  onPeerLive(signal: RepublishSignal): RepublishDecision {
    const { peerId, serving, at } = signal;
    if (serving === null) return { publish: false, reason: 'nothing-to-serve' };
    const last = this.served.get(peerId);
    // Suppress ONLY an identical repeat inside the window: same peer, same head, and the window
    // since we actually served it has not elapsed. The elapsed check runs from the last SERVE, so a
    // stream of refusals can never keep extending the silence.
    if (last !== undefined && last.serving === serving && at - last.at < this.minIntervalMs) {
      return { publish: false, reason: 'rate-limited' };
    }
    this.served.set(peerId, { serving, at });
    return { publish: true };
  }

  /**
   * Fold the transport's live-presence snapshot in: any peer we have served but that is NOT in
   * `peers` has been observed to LEAVE, so forget it. A peer that left may have dropped before our
   * republish reached it, so its return must be served at once rather than mistaken for a repeat.
   *
   * This is a limiter reset, never a trigger — {@link onPeerLive} fires on any fresh live presence
   * whether or not an absence was ever observed (see the file header).
   */
  observePresent(peers: readonly string[]): void {
    const present = new Set(peers);
    for (const peerId of [...this.served.keys()]) {
      if (!present.has(peerId)) this.served.delete(peerId);
    }
  }
}
