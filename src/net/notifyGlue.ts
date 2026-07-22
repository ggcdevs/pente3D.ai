/**
 * Move-notification + auto-reconnect GLUE (Task N.5.2, issue #20) — the DOM / browser-API side effects
 * the PURE decisions in `notify.ts` (Task N.5.1) gate. This is the IO boundary the Playwright spec
 * drives and asserts on via `window.__pente` real values + screenshots (NEVER a log line,
 * agent-principles #3); the DECISIONS it stands on (is-this-a-your-turn move, which channels fire,
 * should a visibility/online edge reconnect) are unit + mutation-gated in `notify.ts`.
 *
 * ## What this owns (the side effects)
 *
 *   1. TAB-TITLE FLASH — while the tab is HIDDEN and a your-turn move lands, mutate `document.title`
 *      to the enumerated flash string (drawing the eye in the tab strip); RESTORE the original title
 *      the instant the tab becomes visible / regains focus (design #20: no banner pulse — the flash is
 *      the tab-title channel). The restore is idempotent and also runs if the config flag is off.
 *   2. BROWSER NOTIFICATION — request the `Notification` permission ONCE on first opt-in (the first
 *      your-turn moment while the browser channel is configured on and permission is still `default`),
 *      then fire a `Notification` ONLY when the tab is hidden AND permission is granted. The title/body
 *      are the enumerated constants from `notify.ts` (never opponent free text — security #20; a
 *      `Notification` title is a plain string, no markup, but we still source it from the fixed union).
 *   3. AUTO-RECONNECT LISTENERS — wire `document` `visibilitychange`→visible and `window` `online`
 *      edges to the pure {@link shouldReconnect} gate; when it holds, re-establish the session
 *      (re-join the same room, reclaiming the sticky seat) via the injected `reconnect` callback.
 *
 * ## Why a glue module (not in `session.ts` or `main.ts`)
 *
 * The session is transport IO and must not touch `document`/`Notification`; `main.ts` is already dense.
 * Concentrating the DOM/browser-API effects here — behind INJECTED `doc`/`win`/`notificationCtor` deps
 * so a test drives a spy without a real permission prompt — keeps the effects in one auditable place and
 * lets the e2e simulate hidden/visible + a `Notification` spy deterministically. It imports ONLY the
 * pure `notify.ts` decisions + the config layer + the plain session-facing callbacks it is handed; no
 * three / render / ui.
 */

import {
  isRemoteMoveForMe,
  deriveMoveNotification,
  shouldReconnect,
  type NotificationsConfig,
} from './notify';
import type { GameState } from '../core/gameState';
import type { NetSeat, NetPhase } from '../ui/widgets/netModel';
import { getConfig } from '../config/config';

/**
 * A minimal, spy-able view of the `Notification` browser API — just the two members this glue uses, so
 * a Playwright test (or a unit) can install a fake constructor and assert `requestPermission` was
 * called and a notification was constructed with the enumerated copy, WITHOUT a real OS permission
 * prompt. The real `window.Notification` structurally satisfies this.
 */
export interface NotificationApi {
  new (title: string, options?: { body?: string }): unknown;
  /** The current grant: `'granted'` fires, `'denied'` never fires, `'default'` prompts once. */
  permission: NotificationPermission;
  /** Request the one-time permission grant; resolves to the new state. */
  requestPermission(): Promise<NotificationPermission>;
}

/**
 * The browser dependencies the glue touches, all injected so it is testable without a live DOM /
 * permission prompt and so the e2e can install spies. `doc`/`win` default to the real globals in the
 * app; `notificationCtor` is the `Notification` constructor (or a spy), or `null` when the browser has
 * no Notification API (the browser channel then stays silent — a graceful, honest degrade).
 */
export interface NotifyGlueDeps {
  /** The document whose `title` is flashed + whose `visibilitychange` drives restore/reconnect. */
  readonly doc: Document;
  /** The window whose `online` event + `navigator.onLine` drive the reconnect edge. */
  readonly win: Window;
  /** The `Notification` constructor (real or a spy), or `null` if the browser lacks the API. */
  readonly notificationCtor: NotificationApi | null;
  /** Read the live session's current phase (offline/connecting/connected/conflict) at an edge. */
  getPhase(): NetPhase;
  /** Read the live session's authoritative game state (or `null` offline) at a change. */
  getGameState(): GameState | null;
  /**
   * Read the live session's authoritative move-log length (ply) at a change — the canonical,
   * capture-independent count the pure trigger compares (`session.ply()`), NOT a piece count.
   */
  getPly(): number;
  /** Read this client's claimed seat (or `null` before a seat is held) at a change. */
  getSeat(): NetSeat;
  /** Re-establish the session in place (re-join the same room, reclaim the sticky seat). */
  reconnect(): void;
  /** Resolve the live `notifications` config (tracked default + any localStorage override). */
  readNotificationsConfig?(): NotificationsConfig;
}

/**
 * Observable readouts the glue exposes for the e2e to assert real behaviour on (`window.__pente`),
 * never a log line (agent-principles #3): the CURRENT `document.title`, how many your-turn
 * notifications have FIRED (title-flash counter), how many browser `Notification`s were CONSTRUCTED,
 * how many permission requests were made, and the last flash/notification copy actually used.
 */
export interface NotifyReadout {
  /** The live `document.title` (flashed while hidden on your turn; restored on visible). */
  readonly title: string;
  /** The original (non-flashed) title the flash restores to. */
  readonly baseTitle: string;
  /** How many times the tab-title flash has fired (advances only on a real your-turn move while hidden). */
  readonly titleFlashCount: number;
  /** How many browser `Notification`s the glue constructed (hidden + configured on + permission granted). */
  readonly notificationCount: number;
  /** How many times the glue called `Notification.requestPermission` (the one-time opt-in). */
  readonly permissionRequests: number;
  /** The last flash string written to `document.title`, or `null` if none fired. */
  readonly lastFlash: string | null;
  /** The last browser-notification copy constructed, or `null` if none fired. */
  readonly lastNotification: { readonly title: string; readonly body: string } | null;
}

/**
 * The live move-notification + auto-reconnect glue. Construct once with the browser deps + session
 * accessors, then feed it every session-state change via {@link onSessionChange}; it tracks the ply
 * across changes, applies the pure decision, and drives the title flash / browser notification. It
 * installs the `visibilitychange` + `online` listeners in its constructor (removable via {@link stop}).
 */
export class NotifyGlue {
  private readonly deps: NotifyGlueDeps;

  /** The move-log length observed at the LAST change — the `prevPly` the pure trigger compares against. */
  private prevPly: number;

  /** The original document title the flash restores to (captured at construction). */
  private baseTitle: string;
  /** Whether the title is currently in the FLASHED state (so restore is a no-op when already restored). */
  private flashed = false;

  /** Whether we have already requested the one-time browser-notification permission this session. */
  private permissionRequested = false;

  // Observable counters (e2e readout — proof-by-behaviour, never a log line).
  private titleFlashCount = 0;
  private notificationCount = 0;
  private permissionRequests = 0;
  private lastFlash: string | null = null;
  private lastNotification: { readonly title: string; readonly body: string } | null = null;

  private readonly onVisibility: () => void;
  private readonly onOnline: () => void;

  constructor(deps: NotifyGlueDeps) {
    this.deps = deps;
    this.baseTitle = deps.doc.title;
    // Seed prevPly from the current game so the FIRST change compares against the real starting ply
    // (a session that boots mid-game does not spuriously notify on its first observed state).
    this.prevPly = deps.getPly();

    // AUTO-RECONNECT: a tab returning to VISIBLE, or the network coming back ONLINE, is the edge that
    // may resume a dropped session. Both funnel through the pure `shouldReconnect` gate so a live /
    // connecting session is never re-connected over (design #20 / N.5.1). On visible we ALSO restore
    // a flashed title (the your-turn nudge is done the moment the user is looking again).
    this.onVisibility = () => {
      if (this.isVisible()) this.restoreTitle();
      this.maybeReconnect();
    };
    this.onOnline = () => this.maybeReconnect();
    deps.doc.addEventListener('visibilitychange', this.onVisibility);
    // `focus` also restores the flashed title — a user alt-tabbing back focuses the window even if the
    // visibility state lags; restoring on both edges guarantees the flash never sticks once looked at.
    deps.win.addEventListener('focus', this.onVisibility);
    deps.win.addEventListener('online', this.onOnline);
  }

  /**
   * Feed a session-state change: compute whether this was a your-turn opponent move (pure
   * {@link isRemoteMoveForMe} over the tracked ply delta + seat + winner), resolve which channels fire
   * (pure {@link deriveMoveNotification} over the live config + permission grant), and apply the DOM /
   * browser-API side effects — but ONLY while the tab is HIDDEN (a your-turn nudge is pointless when
   * the user is already looking at the board). Always advances the tracked ply so the next change
   * compares against the right baseline.
   */
  onSessionChange(): void {
    const next = this.deps.getGameState();
    const nextPly = this.deps.getPly();
    const seat = this.deps.getSeat();
    // No live game (offline) → nothing to notify; just keep the ply baseline in step.
    if (next === null) {
      this.prevPly = nextPly;
      return;
    }
    const triggered = isRemoteMoveForMe(next, seat, this.prevPly, nextPly);
    this.prevPly = nextPly;
    if (!triggered) return;

    const config = this.readConfig();
    // Request the one-time permission on the FIRST your-turn moment while the browser channel is
    // configured on and permission is still undecided (the opt-in). Fire-and-forget: the grant lands
    // asynchronously and gates a LATER notification, not this one — we never block the game on it.
    if (config.browserNotification) this.maybeRequestPermission();

    // The your-turn nudge only makes sense when the user is NOT looking. When visible, do nothing
    // (the banner already shows whose turn it is, unchanged — design #20).
    if (this.isVisible()) return;

    const permission = this.currentPermission() === 'granted';
    const decision = deriveMoveNotification(triggered, config, permission);
    if (decision.titleFlash !== null) this.flashTitle(decision.titleFlash);
    if (decision.browserNotification !== null) {
      this.fireNotification(decision.browserNotification);
    }
  }

  /** The current observable readout (title, counters, last copy) for `window.__pente` (#3). */
  readout(): NotifyReadout {
    return {
      title: this.deps.doc.title,
      baseTitle: this.baseTitle,
      titleFlashCount: this.titleFlashCount,
      notificationCount: this.notificationCount,
      permissionRequests: this.permissionRequests,
      lastFlash: this.lastFlash,
      lastNotification: this.lastNotification,
    };
  }

  /** Remove the visibility/focus/online listeners (page teardown; symmetric with the constructor). */
  stop(): void {
    this.deps.doc.removeEventListener('visibilitychange', this.onVisibility);
    this.deps.win.removeEventListener('focus', this.onVisibility);
    this.deps.win.removeEventListener('online', this.onOnline);
  }

  // ── internals ───────────────────────────────────────────────────────────────────────────────────

  /** Resolve the live `notifications` config (injected reader in tests; the config SSOT in the app). */
  private readConfig(): NotificationsConfig {
    return this.deps.readNotificationsConfig
      ? this.deps.readNotificationsConfig()
      : getConfig('notifications');
  }

  /** Whether the tab is currently VISIBLE (a hidden tab is the one a your-turn nudge is for). */
  private isVisible(): boolean {
    return this.deps.doc.visibilityState === 'visible';
  }

  /** The current browser-notification permission, or `'denied'` when the API is absent (never fires). */
  private currentPermission(): NotificationPermission {
    return this.deps.notificationCtor?.permission ?? 'denied';
  }

  /**
   * Flash the tab title (mutate `document.title` to the enumerated string) — the tab-strip nudge. Only
   * captures a fresh base title when NOT already flashed, so a second flash before a restore does not
   * overwrite the real base with the flash string.
   */
  private flashTitle(flash: string): void {
    if (!this.flashed) this.baseTitle = this.deps.doc.title;
    this.deps.doc.title = flash;
    this.flashed = true;
    this.titleFlashCount += 1;
    this.lastFlash = flash;
  }

  /** Restore the pre-flash title (idempotent — a no-op when nothing is flashed). */
  private restoreTitle(): void {
    if (!this.flashed) return;
    this.deps.doc.title = this.baseTitle;
    this.flashed = false;
  }

  /** Request the one-time browser-notification permission (only while it is still `'default'`). */
  private maybeRequestPermission(): void {
    const ctor = this.deps.notificationCtor;
    if (ctor === null) return;
    if (this.permissionRequested) return;
    if (ctor.permission !== 'default') return;
    this.permissionRequested = true;
    this.permissionRequests += 1;
    // Fire-and-forget: the grant gates future notifications, not this one. A rejection is swallowed
    // deliberately — a denied permission is a valid user choice, not an error to surface.
    void ctor.requestPermission().catch(() => {});
  }

  /** Construct a browser `Notification` with the enumerated copy (caller already gated hidden+granted). */
  private fireNotification(copy: { readonly title: string; readonly body: string }): void {
    const ctor = this.deps.notificationCtor;
    if (ctor === null) return;
    // The Notification is a fire-and-forget side effect (the OS owns the surfaced notification); we
    // discard the handle deliberately (a `void new` would be a syntax error, so bind + ignore).
    const _notification = new ctor(copy.title, { body: copy.body });
    void _notification;
    this.notificationCount += 1;
    this.lastNotification = copy;
  }

  /** Apply the pure reconnect gate at a visibility/online edge; call `reconnect` only when it holds. */
  private maybeReconnect(): void {
    const online = this.deps.win.navigator.onLine;
    const visibility = this.isVisible() ? 'visible' : 'hidden';
    if (shouldReconnect(this.deps.getPhase(), visibility, online)) {
      this.deps.reconnect();
    }
  }
}
