/**
 * UI shell wiring (Task 5.1) — the DOM IO shell that assembles the widget registry and mounts
 * the composable UI container over the WebGL canvas (design Part 6).
 *
 * The registry (`registry.ts`) and the layout resolver (`layout.ts`) are PURE (strict unit +
 * mutation gate). This file is the thin glue that: builds the registry from the app's widget
 * factories, resolves + mounts them into their config-driven zones via `createUiContainer`, and
 * returns a handle whose `getLayout()` is surfaced on `window.__pente` for Playwright.
 *
 * For Task 5.1 the roster is the {@link placeholderWidget} set — one factory per widget id in
 * the tracked `layout` default — enough to prove the shell reflects config and that reordering
 * the config reorders the DOM. The real widgets (banner/menu/settings/net/history/help) replace
 * these factories in Tasks 5.2+; the framework does not change.
 *
 * It may import DOM + config; it must NOT be imported BY `src/core` (the eslint boundary keeps
 * core pure).
 */

import { getConfig } from '../config/config.ts';
import { createWidgetRegistry, type WidgetFactory } from './registry.ts';
import { createUiContainer, type LayoutReadout, type UiContainerHandle } from './container.ts';
import { placeholderWidget } from './widgets/placeholder.ts';
import { bannerWidget, BANNER_WIDGET_ID } from './widgets/banner.ts';
import { menuWidget, MENU_WIDGET_ID, type MenuScope } from './widgets/menu.ts';
import {
  settingsWidget,
  SETTINGS_WIDGET_ID,
  type SettingsScope,
  type SettingsColorsPreview,
} from './widgets/settings.ts';
import { netWidget, NET_WIDGET_ID } from './widgets/net.ts';
import type { NetSessionState } from './widgets/netModel.ts';
import {
  historySliderWidget,
  HISTORY_SLIDER_WIDGET_ID,
} from './widgets/historySlider.ts';
import type { HistoryFacts } from './widgets/sliderModel.ts';
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
  pushScope(scope: MenuScope | SettingsScope): void;
  /** Pop the topmost input scope (Task 5.3) — a modal/mode leaves by popping its scope. */
  popScope(): void;
  /**
   * Register the settings-modal opener (Task 5.4). The settings widget hands its `open()` here at
   * mount; the app wires it to the scene's `openSettings` command (`scene.setOpenSettings`) so the
   * menu's "Settings" entry / a keybinding opens the modal (design Principle 3, one action layer).
   */
  registerOpener(open: () => void): void;
  /**
   * Live-apply a colour preview to the scene (Task 5.4) — the settings modal's colour/opacity live
   * preview. Supplied by the app (the scene's `applyColors` seam) so the UI shell never imports
   * render. Only the previewable subset (background / line opacity / line colours) applies live;
   * the rest of `colors` takes effect on reload (the documented config contract).
   */
  applyColors(preview: SettingsColorsPreview): void;
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
 * The widget roster: the REAL factory for each widget id that has been built (Task 5.2: the
 * score/status banner for `statusBanner`), and a placeholder for every other id the tracked
 * `layout` default still names (menu/settings/net/history land in 5.3+). Derived FROM the config
 * (not a hardcoded id list) so the roster and the layout can never drift, and a future
 * config-only widget add is picked up automatically (agent-principles #8: no duplicated volatile
 * facts). As each real widget lands it replaces its placeholder here; the framework is unchanged.
 */
export function defaultWidgetFactories(layout: LayoutConfig): WidgetFactory[] {
  return Object.keys(layout.widgets).map((id) => {
    if (id === BANNER_WIDGET_ID) return bannerWidget();
    if (id === MENU_WIDGET_ID) return menuWidget();
    if (id === SETTINGS_WIDGET_ID) return settingsWidget();
    if (id === NET_WIDGET_ID) return netWidget();
    if (id === HISTORY_SLIDER_WIDGET_ID) return historySliderWidget();
    return placeholderWidget(id);
  });
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
  const registry = createWidgetRegistry(defaultWidgetFactories(layout));
  const ui = createUiContainer(
    registry,
    layout,
    {
      doc: document,
      dispatch: deps.dispatch,
      pushScope: deps.pushScope,
      popScope: deps.popScope,
      registerOpener: deps.registerOpener,
      applyColors: deps.applyColors,
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
