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
import type { LayoutConfig } from './layout.ts';

/** The live UI handle exposed to the app + tests: the container plus its layout readout. */
export interface UiHandle {
  /** The mounted container (root element / update / dispose). */
  readonly container: UiContainerHandle;
  /** The mounted layout, read back off the live DOM (surfaced on `window.__pente`). */
  getLayout(): LayoutReadout;
}

/**
 * The Task 5.1 widget roster: a placeholder factory for every widget id the tracked `layout`
 * default names. Derived FROM the config (not a hardcoded id list) so the roster and the layout
 * can never drift, and a future config-only widget add is picked up automatically (agent-
 * principles #8: no duplicated volatile facts).
 */
export function defaultWidgetFactories(layout: LayoutConfig): WidgetFactory[] {
  return Object.keys(layout.widgets).map((id) => placeholderWidget(id));
}

/**
 * Assemble + mount the UI shell over `container`. Reads the `layout` config, builds the registry
 * from the default roster, resolves the zones, and mounts the widgets. Returns the {@link UiHandle}.
 *
 * @param container The app container the overlay is appended to (over the canvas).
 */
export function createUi(container: HTMLElement): UiHandle {
  const layout = getConfig('layout') as unknown as LayoutConfig;
  const registry = createWidgetRegistry(defaultWidgetFactories(layout));
  const ui = createUiContainer(registry, layout, { doc: document }, document);
  container.appendChild(ui.root);
  return {
    container: ui,
    getLayout: () => ui.getLayout(),
  };
}
