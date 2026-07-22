/**
 * PURE #20 notify/reconnect decisions (Task N.5.1) — the DOM-free, transport-free triggers the
 * networking session GLUE (`session.ts`/`appSession.ts`) consumes to drive move notifications and the
 * background→return auto-reconnect, separated from the IO glue so it earns the strict unit + mutation
 * gate exactly like the other pure net logic (`turnGate.ts`, `netRouting.ts`, `handshake.ts`, …).
 *
 * ## What this decides (and what stays in the glue)
 *
 * This module answers three questions with pure functions:
 *
 *   1. {@link isRemoteMoveForMe} — was an adopted state change the OPPONENT's move that made it MY
 *      turn? That is the trigger for a 'your turn' notification. It is TRUE only when the move-log grew
 *      (a placement landed), the game is not won, and it is now this client's seat to move — so a self
 *      move, a non-move re-emit, an undo (log shrank), a still-opponent-turn change (a defensive
 *      multi-move / malformed-log case), and a winning move all correctly do NOT notify.
 *   2. {@link deriveMoveNotification} — given that trigger + the {@link NotificationsConfig} + whether
 *      the browser-notification permission is granted, WHICH channels fire and with WHAT copy. The copy
 *      is drawn from the enumerated {@link YOUR_TURN_BODY}/{@link YOUR_TURN_TITLE_FLASH} constants —
 *      NEVER from any opponent free text (security #20: the glue renders it via `textContent`).
 *   3. {@link shouldReconnect} — should a `visibilitychange`→visible or `online` edge trigger an
 *      auto-reconnect? TRUE only when the session is offline/dropped AND the tab just became visible or
 *      the network just came back — never when already connected/connecting/conflicted.
 *
 * The GLUE owns the SIDE EFFECTS these decisions gate: subscribing to the session's game-change seam and
 * reading the engine's ply, writing `document.title`, calling the `Notification` API + requesting its
 * permission, and re-joining the room. This module reads only plain values + the core `Player`/
 * `GameState` types + the {@link NetPhase} enum — no transport, engine, three, or DOM — so it is held to
 * the hard 100% unit-coverage + mutation floor the whole `src/net/**` scope carries.
 */

import type { GameState, Player } from '../core/gameState';
import type { NetSeat, NetPhase } from '../ui/widgets/netModel';
import { getDefault } from '../config/config';

/**
 * The tracked shape of the `notifications` config section (SSOT: `src/config/defaults/notifications.json`).
 * Design decision #20 (locked): `titleFlash` on (no permission needed), `browserNotification` on-by-config
 * but still gated by the runtime permission grant, `sound` off — and NO banner pulse (the score banner
 * keeps showing whose turn it is with no animation, so there is no pulse flag here at all).
 */
export interface NotificationsConfig {
  /** Flash the tab title (`document.title`) on your turn — on by default, needs no permission. */
  readonly titleFlash: boolean;
  /** Fire a browser `Notification` on your turn — on by config, but only when permission is granted. */
  readonly browserNotification: boolean;
  /**
   * TODO(sound-effect-not-implemented): the your-turn sound EFFECT is not wired in the glue yet. The pure
   * decision computes {@link MoveNotification.sound} from this flag and it is unit-gated, but
   * `NotifyGlue.onSessionChange` has no audio side effect to consume it (there is no audio player in
   * `src/`), so this flag is INERT end-to-end today. It ships `false` by default and is NOT a named
   * deliverable of the #20 batch (`planning/2026-07-21-networking-ux-batch.md` §N.5 lists only the
   * tab-title flash + browser Notification channels). Kept in the tracked shape so the config SSOT and the
   * pure decision stay in lock-step for when the audio effect is added; setting it `true` does nothing yet.
   */
  readonly sound: boolean;
}

/** The your-turn notification/flash BODY copy — an enumerated constant, never opponent free text (#20). */
export const YOUR_TURN_BODY = 'Your turn';

/**
 * The your-turn tab-title FLASH string (design #20's `'(!) Your turn — Pente'`) — the leading `(!)`
 * marker draws the eye in the browser tab strip. An enumerated constant, never opponent free text.
 */
export const YOUR_TURN_TITLE_FLASH = '(!) Your turn — Pente';

/**
 * The resolved per-channel notification the glue applies for one state change. Each field is inert when
 * its channel should stay silent:
 *   - `titleFlash`: the flash string to write to `document.title`, or `null` to leave the title alone.
 *   - `browserNotification`: the `{ title, body }` to pass to the `Notification` API, or `null`.
 *   - `sound`: whether the your-turn sound WOULD play — see TODO below; no glue consumes it yet.
 * All copy is the enumerated constants above — the glue never has to (and must never) inject networked text.
 */
export interface MoveNotification {
  readonly titleFlash: string | null;
  readonly browserNotification: { readonly title: string; readonly body: string } | null;
  /**
   * TODO(sound-effect-not-implemented): computed from {@link NotificationsConfig.sound} but INERT — no glue
   * side effect consumes it (no audio player in `src/`; see the field doc on `NotificationsConfig.sound`).
   */
  readonly sound: boolean;
}

/**
 * Whether the state change from `prev` → `next` was the OPPONENT's move that made it MY turn — the
 * trigger for a 'your turn' notification (pure — no side effects).
 *
 * TRUE iff ALL hold:
 *   - the move-log GREW (`nextPly > prevPly`): a placement actually landed. A non-move re-emit
 *     (`nextPly === prevPly`) or an adopted undo (`nextPly < prevPly`) is not a forward opponent move;
 *   - the game is not won (`next.winner === null`): a winning move ends the game — that is the end-state
 *     overlay's job (#12), not a your-turn nudge;
 *   - it is now MY seat to move (`next.turn === mySeat`): the mover was therefore the opponent, and the
 *     turn has come to me. If a move landed yet it is STILL the opponent's turn — a defensive
 *     multi-move / malformed-log case that standard alternating-turn Pente never produces — this is
 *     false: it is not my turn, so nothing is notified.
 *
 * A held-seat check is NOT needed as a separate clause: `next.turn` is always a `Player` (`'white'` /
 * `'black'`), so `next.turn === mySeat` is already false whenever `mySeat` is `null` — the no-seat case
 * falls out of the turn comparison, and a negative test pins it (a redundant `mySeat !== null` guard is
 * deliberately omitted rather than left as an unkillable/equivalent branch).
 *
 * The BEFORE state is not needed — the only fact the trigger reads from history is the ply GROWTH,
 * passed explicitly as `prevPly`/`nextPly` (the session tracks `engine.game().ply()` across the change).
 *
 * @param next The authoritative game state AFTER the change.
 * @param mySeat This client's claimed seat, or `null` before a seat is held.
 * @param prevPly The move-log length before the change (the session tracks `engine.game().ply()`).
 * @param nextPly The move-log length after the change.
 * @returns `true` iff this was an opponent move that made it my turn.
 */
export function isRemoteMoveForMe(
  next: GameState,
  mySeat: NetSeat,
  prevPly: number,
  nextPly: number,
): boolean {
  return nextPly > prevPly && next.winner === null && next.turn === mySeat;
}

/**
 * Resolve WHICH notification channels fire (and with what enumerated copy) for one state change, given
 * the trigger + config + permission grant (pure — no side effects).
 *
 * When `triggered` is false every channel is silent (no flash, no browser notif, sound off) regardless
 * of config — nothing happened worth notifying. When `triggered`:
 *   - `titleFlash` fires (the enumerated flash string) iff `config.titleFlash` — it needs no permission;
 *   - `browserNotification` fires (the enumerated `{ title, body }`) iff `config.browserNotification`
 *     AND `permissionGranted` — the on-by-config-but-permission-gated rule (design #20);
 *   - `sound` mirrors `config.sound` exactly, but is INERT — no glue plays audio yet
 *     (TODO(sound-effect-not-implemented); see {@link NotificationsConfig.sound}).
 *
 * @param triggered The {@link isRemoteMoveForMe} result — whether this is a your-turn moment.
 * @param config The resolved {@link NotificationsConfig} (tracked default + any localStorage override).
 * @param permissionGranted Whether the browser Notification permission has been granted at runtime.
 */
export function deriveMoveNotification(
  triggered: boolean,
  config: NotificationsConfig,
  permissionGranted: boolean,
): MoveNotification {
  if (!triggered) {
    return { titleFlash: null, browserNotification: null, sound: false };
  }
  return {
    titleFlash: config.titleFlash ? YOUR_TURN_TITLE_FLASH : null,
    browserNotification:
      config.browserNotification && permissionGranted
        ? { title: YOUR_TURN_TITLE_FLASH, body: YOUR_TURN_BODY }
        : null,
    sound: config.sound,
  };
}

/**
 * Whether a `visibilitychange`→visible or `online` edge should trigger an auto-reconnect (pure — no
 * side effects). TRUE iff the session is `offline` (dropped / never connected) AND either the tab is now
 * `visible` OR the network is `online` — the background→return / network-restored trigger (design #20).
 *
 * FALSE for any live phase (`connecting` / `connected` / `conflict`): a visibility/online edge must not
 * re-connect a session that is already up or deliberately stopped by a fork, and must not stack a second
 * connect over an in-flight one.
 *
 * @param phase The current session phase.
 * @param visibility The tab's visibility state at the edge (`'visible'` / `'hidden'`).
 * @param online Whether the browser reports the network as online (`navigator.onLine`) at the edge.
 * @returns `true` iff an auto-reconnect should be attempted.
 */
export function shouldReconnect(
  phase: NetPhase,
  visibility: 'visible' | 'hidden',
  online: boolean,
): boolean {
  return phase === 'offline' && (visibility === 'visible' || online);
}

/**
 * The tracked `notifications` config default (#20 SSOT) as a fresh object each call — a thin pure
 * accessor over the config layer's {@link getDefault} so the glue reads the default (flash on, browser
 * on, sound off) with NO magic values duplicated here. A caller that layers a localStorage override
 * reads it via the config layer's `getConfig('notifications')` in the glue; this returns the pristine
 * default the decisions fall back to.
 */
export function defaultNotificationsConfig(): NotificationsConfig {
  return getDefault('notifications');
}

/** Re-export the seat/turn types the decision reads, for glue callers that import from this module. */
export type { Player, NetSeat };
