/**
 * UI container (Task 5.1) — the DOM IO boundary that mounts the composable UI shell.
 *
 * This is the glue between the two PURE modules: it asks `resolveLayout` (`layout.ts`) for the
 * ordered, per-zone plan given the `layout` config + the registry's `knownIds`, then builds one
 * absolutely-positioned zone `<div>` per populated zone and mounts each widget's DOM element
 * into its zone in flow order (design Part 6, "zone-based positioning; widgets flow within a
 * zone by order"). It imports the DOM; the placement/ordering decisions all live in the pure
 * resolver, so this file carries none of the logic under the mutation gate — it is verified by
 * Playwright driving the real app and asserting on `getLayout()` (build plan Task 5.1).
 *
 * `getLayout()` is a plain, serializable readout of what is ACTUALLY in the DOM (zone → ordered
 * widget ids, read back off the mounted elements), not a copy of the plan — so a Playwright test
 * proves the DOM reflects the config, and that reordering the config reorders the DOM
 * (agent-principles #3: observable behavior, never a log line).
 */

import { createLogger } from '../debug/log.ts';
import { resolveLayout, type LayoutConfig } from './layout.ts';
import type { Widget, WidgetRegistry } from './registry.ts';

const log = createLogger('ui:container');

/** The data attribute a mounted widget element carries, so `getLayout` can read ids off the DOM. */
export const WIDGET_ID_ATTR = 'data-widget-id';
/** The data attribute a zone element carries, naming its zone. */
export const ZONE_ATTR = 'data-zone';

/** A plain, serializable readout of the mounted UI, read back off the live DOM. */
export interface LayoutReadout {
  /** `zone → the mounted widget ids, in DOM order`. Only populated zones appear. */
  zones: Record<string, string[]>;
}

/** The live UI container handle exposed to the app and (via `window.__pente`) to tests. */
export interface UiContainerHandle {
  /** The root overlay element (append to the app container). */
  readonly root: HTMLElement;
  /** Re-render every mounted widget from the current state + config. */
  update(state: unknown, config: unknown): void;
  /** A plain readout of the mounted layout, read back off the live DOM (for assertions). */
  getLayout(): LayoutReadout;
  /** Unmount every widget and remove the overlay. */
  dispose(): void;
}

/**
 * Mount the composable UI: resolve the layout, build zone elements, and mount each widget in
 * flow order. Widgets are built via `registry.get(id)!.mount(deps)` — the id is guaranteed
 * known because `resolveLayout` was handed `registry.knownIds()`, so only registered widgets
 * reach here.
 *
 * @param registry  The widget registry (id → factory).
 * @param config    The `layout` config section (`widgetId → placement`).
 * @param deps      The dependency bag handed to every widget factory's `mount`.
 * @param doc       The document to build elements in (injected for testability; defaults to the
 *   ambient `document`).
 */
export function createUiContainer(
  registry: WidgetRegistry,
  config: LayoutConfig,
  deps: unknown,
  doc: Document = document,
): UiContainerHandle {
  const root = doc.createElement('div');
  root.className = 'pente-ui-root';
  root.setAttribute('data-testid', 'pente-ui-root');

  const resolved = resolveLayout(config, registry.knownIds());
  const mounted: Widget[] = [];

  for (const [zone, widgets] of Object.entries(resolved.zones)) {
    const zoneEl = doc.createElement('div');
    zoneEl.className = `pente-ui-zone pente-ui-zone--${zone}`;
    zoneEl.setAttribute(ZONE_ATTR, zone);
    for (const slot of widgets) {
      // Safe non-null: only ids in registry.knownIds() survive resolveLayout, and knownIds is
      // derived from the same registry, so get(id) is always defined here.
      const factory = registry.get(slot.id)!;
      const widget = factory.mount(deps);
      widget.element.setAttribute(WIDGET_ID_ATTR, slot.id);
      if (slot.offset !== undefined) {
        widget.element.style.transform = `translate(${slot.offset.x}px, ${slot.offset.y}px)`;
      }
      zoneEl.appendChild(widget.element);
      mounted.push(widget);
    }
    root.appendChild(zoneEl);
  }

  function getLayout(): LayoutReadout {
    const zones: Record<string, string[]> = {};
    for (const zoneEl of Array.from(root.querySelectorAll(`[${ZONE_ATTR}]`))) {
      const zone = zoneEl.getAttribute(ZONE_ATTR)!;
      const ids = Array.from(zoneEl.querySelectorAll(`[${WIDGET_ID_ATTR}]`)).map(
        (el) => el.getAttribute(WIDGET_ID_ATTR)!,
      );
      zones[zone] = ids;
    }
    return { zones };
  }

  function update(state: unknown, cfg: unknown): void {
    for (const widget of mounted) widget.update(state, cfg);
  }

  function dispose(): void {
    for (const widget of mounted) widget.dispose?.();
    root.remove();
  }

  log.info('ui container mounted', getLayout().zones);

  return { root, update, getLayout, dispose };
}
