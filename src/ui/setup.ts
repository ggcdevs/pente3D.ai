/**
 * UI shell wiring (Task 5.1) — the DOM IO shell that assembles the widget registry and mounts
 * the composable UI container over the WebGL canvas (design Part 6).
 *
 * The registry (`registry.ts`) and the layout resolver (`layout.ts`) are PURE (strict unit +
 * mutation gate). This file is the thin glue that: builds the registry from the app's widget
 * factories, resolves + mounts them into their config-driven zones via `createUiContainer`, and
 * returns a handle whose `getLayout()` is surfaced on `window.__pente` for Playwright.
 *
 * The roster is the {@link defaultWidgetFactories} set — one factory per real widget the app can
 * mount (banner/menu/settings/net/history/help/archive). The registry reconciles it against the
 * `layout` config: a config entry with no factory is dropped by `resolveLayout`, and a factory
 * with no config entry is never placed — so the config and the roster can diverge safely without
 * ever painting a stub on screen.
 *
 * It may import DOM + config; it must NOT be imported BY `src/core` (the eslint boundary keeps
 * core pure).
 */

import { getConfig } from '../config/config.ts';
import { createWidgetRegistry, type WidgetFactory } from './registry.ts';
import { createUiContainer, type LayoutReadout, type UiContainerHandle } from './container.ts';
import { bannerWidget } from './widgets/banner.ts';
import { menuWidget, type MenuScope } from './widgets/menu.ts';
import { settingsWidget, type SettingsScope } from './widgets/settings.ts';
import { netWidget } from './widgets/net.ts';
import type { NetSessionState } from './widgets/netModel.ts';
import { historySliderWidget } from './widgets/historySlider.ts';
import type { HistoryFacts } from './widgets/sliderModel.ts';
import { helpWidget, type HelpScope } from './widgets/help.ts';
import type { HelpSources } from './widgets/helpModel.ts';
import { archiveWidget, type ArchiveScope } from './widgets/archive.ts';
import type { ArchiveListing } from './widgets/archiveModel.ts';
import type { LayoutConfig } from './layout.ts';

/**
 * The command-dispatch surface widgets need — the SAME registry keybindings use (design
 * Principle 3). Supplied by the app (the scene handle) so the UI shell never imports render.
 */
export interface UiDeps {
  /** Dispatch a command id (e.g. `'undo'`). Returns whether a command ran. */
  dispatch(commandId: string): boolean;
  /**
   * Push an input scope (Task 5.3) — a modal/mode widget (e.g. the menu modal pushes a `blocking`
   * scope) enters by pushing its scope onto the scene's stack. Supplied by the app (the scene
   * handle) so the UI shell never imports the input module.
   */
  pushScope(scope: MenuScope | SettingsScope | HelpScope | ArchiveScope): void;
  /** Pop the topmost input scope (Task 5.3) — a modal/mode leaves by popping its scope. */
  popScope(): void;
  /**
   * Register the settings-modal opener (Task 5.4). The settings widget hands its `open()` here at
   * mount; the app wires it to the scene's `openSettings` command (`scene.setOpenSettings`) so the
   * menu's "Settings" entry / a keybinding opens the modal (design Principle 3, one action layer).
   */
  registerOpener(open: () => void): void;
  /**
   * Register the help-overlay opener (Task 5.7). The help widget hands its `open()` here at mount;
   * the app wires it to the scene's `showHelp` command (`scene.setOpenHelp`) so the `?` keybinding
   * (or any UI trigger) opens the overlay (design Principle 3, one action layer).
   */
  registerOpenHelp(open: () => void): void;
  /**
   * Register the archive-browser opener (Task 5.8). The archive widget hands its `open()` here at
   * mount; the app wires it to the scene's `loadGame` command (`scene.setOpenArchive`) so the menu's
   * "Load" entry / a keybinding opens the browser (design Principle 3, one action layer).
   */
  registerOpenArchive(open: () => void): void;
  /**
   * List every archived game as `{ id, meta }` (no logs) for the archive browser (Task 5.8) — the
   * app's `listArchivedGames` over IndexedDB. Supplied by the app so the UI shell never opens the
   * DB itself; the pure model sorts them newest-first.
   */
  listArchive(): Promise<readonly ArchiveListing[]>;
  /**
   * REVIEW an archived game (Task 6.6): reconstruct game `id` and swap it into the scene READ-ONLY —
   * the app's archive→scene load path (fold the stored log into a `Game`, then `scene.loadGame`),
   * without re-minting the autosave id. Supplied by the app so the UI shell never imports
   * `src/persist` / `src/render`.
   */
  reviewArchived(id: string): Promise<void>;
  /**
   * RESUME an archived game (Task 6.6): reconstruct game `id`, swap it into the scene, and make it the
   * live CONTINUABLE game — the app mints a fresh autosave record so continued play accumulates and the
   * original archived record stays intact. Only invoked for a resumable (in-progress) row.
   */
  resumeArchived(id: string): Promise<void>;
  /**
   * The LIVE sources the help overlay generates its shortcut list from (Task 5.7) — the scene's
   * `getHelpSources` (registered command ids + current bindings). Supplied by the app so the UI
   * shell never imports `src/render`. The overlay derives its rows from these, never a hardcoded
   * list (design Part 6; agent-principles #8).
   */
  getHelpSources(): HelpSources;
  /**
   * The live networking-session readout (Task 5.5) the net widget renders — the scene's `getNet`,
   * produced off the app's net session (SyncEngine + seat manager). Supplied by the app so the UI
   * shell never imports `src/net`.
   */
  getNet(): NetSessionState;
  /**
   * Stash a validated join code for the next `joinGame` dispatch (Task 5.5 argument seam) — the
   * scene's `setPendingJoinCode`. The net widget validates a typed code, stashes it here, then
   * dispatches the argument-free `joinGame` command; the session reads it.
   */
  setPendingJoinCode(code: string): void;
  /**
   * Copy text to the clipboard (Task 5.5) — the net widget's "Copy game code". Supplied by the app
   * (the real `navigator.clipboard.writeText`) so the widget never reaches for a global directly.
   */
  copyToClipboard(text: string): Promise<void>;
  /**
   * The live read-only history readout (Task 5.6) the slider renders — the scene's `getHistory`
   * (the untouched canonical `Game` head + the currently-viewed ply). Supplied by the app so the
   * UI shell never imports `src/render`.
   */
  getHistory(): HistoryFacts;
  /**
   * Scrub the LOCAL view to ply `k` (Task 5.6, read-only) — the scene's `scrubTo`. Re-renders
   * `game.stateAt(k)` for the local viewer without mutating the game; `k >= head` snaps to live.
   */
  scrubTo(k: number): void;
}

/** The live UI handle exposed to the app + tests: the container plus its layout readout. */
export interface UiHandle {
  /** The mounted container (root element / update / dispose). */
  readonly container: UiContainerHandle;
  /** The mounted layout, read back off the live DOM (surfaced on `window.__pente`). */
  getLayout(): LayoutReadout;
}

/**
 * The widget roster: the REAL factory for every widget that has been built. Each factory owns
 * its own id (the `*_WIDGET_ID` constant), so the roster is the single source of truth for what
 * the app can mount — it does NOT derive its ids from the `layout` config. Reconciliation with
 * the config is the registry's job: `resolveLayout` drops any config entry whose id has no
 * registered factory (design Part 6: "Unknown widget id → ignored gracefully"), and a factory
 * with no config entry is simply never placed. That two-layer contract means a config-only
 * widget add lands as a graceful no-op until its factory ships here — never as scaffolding
 * painted on screen. As each new widget is built (design Part 6 roster), its factory is added.
 */
export function defaultWidgetFactories(): WidgetFactory[] {
  return [
    bannerWidget(),
    menuWidget(),
    settingsWidget(),
    netWidget(),
    historySliderWidget(),
    helpWidget(),
    archiveWidget(),
  ];
}

/**
 * Assemble + mount the UI shell over `container`. Reads the `layout` config, builds the registry
 * from the default roster, resolves the zones, and mounts the widgets. Returns the {@link UiHandle}.
 *
 * @param container The app container the overlay is appended to (over the canvas).
 * @param deps      The command-dispatch surface widgets dispatch through (the scene's registry —
 *   the SAME path a keybinding uses, design Principle 3). Carried into every widget's `mount`
 *   alongside the document.
 */
export function createUi(container: HTMLElement, deps: UiDeps): UiHandle {
  const layout = getConfig('layout') as unknown as LayoutConfig;
  const registry = createWidgetRegistry(defaultWidgetFactories());
  const ui = createUiContainer(
    registry,
    layout,
    {
      doc: document,
      dispatch: deps.dispatch,
      pushScope: deps.pushScope,
      popScope: deps.popScope,
      registerOpener: deps.registerOpener,
      registerOpenHelp: deps.registerOpenHelp,
      registerOpenArchive: deps.registerOpenArchive,
      listArchive: deps.listArchive,
      reviewArchived: deps.reviewArchived,
      resumeArchived: deps.resumeArchived,
      getHelpSources: deps.getHelpSources,
      getNet: deps.getNet,
      setPendingJoinCode: deps.setPendingJoinCode,
      copyToClipboard: deps.copyToClipboard,
      getHistory: deps.getHistory,
      scrubTo: deps.scrubTo,
    },
    document,
  );
  container.appendChild(ui.root);
  return {
    container: ui,
    getLayout: () => ui.getLayout(),
  };
}
