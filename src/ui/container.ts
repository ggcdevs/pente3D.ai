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
/** The id of the one-time injected stylesheet, so it is installed at most once per document. */
export const UI_STYLE_ID = 'pente-ui-style';

/**
 * The overlay stylesheet: the root is a full-viewport overlay that is click-THROUGH
 * (`pointer-events: none`) so canvas orbit/pan/zoom still work under it; each anchor zone
 * (design Part 6) is absolutely positioned at its screen edge and its widgets re-enable
 * `pointer-events` so buttons are clickable. Zone anchoring is a fixed name→edge mapping (not
 * config-derived logic — the config drives WHICH widgets sit WHERE, resolved purely in
 * `layout.ts`), so it lives here as constant CSS rather than in the mutation-gated pure layer.
 */
const UI_STYLESHEET = `
.pente-ui-root { position: fixed; inset: 0; pointer-events: none; z-index: 10; }
.pente-ui-zone { position: absolute; display: flex; gap: 8px; padding: 12px; }
.pente-ui-zone > * { pointer-events: auto; }
.pente-ui-zone--top-left { top: 0; left: 0; flex-direction: column; align-items: flex-start; }
.pente-ui-zone--top-center { top: 0; left: 50%; transform: translateX(-50%); flex-direction: column; align-items: center; }
.pente-ui-zone--top-right { top: 0; right: 0; flex-direction: column; align-items: flex-end; }
.pente-ui-zone--left { top: 50%; left: 0; transform: translateY(-50%); flex-direction: column; }
.pente-ui-zone--right { top: 50%; right: 0; transform: translateY(-50%); flex-direction: column; align-items: flex-end; }
.pente-ui-zone--center { top: 50%; left: 50%; transform: translate(-50%, -50%); flex-direction: column; align-items: center; }
.pente-ui-zone--bottom-left { bottom: 0; left: 0; flex-direction: column; align-items: flex-start; }
.pente-ui-zone--bottom-center { bottom: 0; left: 50%; transform: translateX(-50%); flex-direction: column; align-items: center; }
.pente-ui-zone--bottom-right { bottom: 0; right: 0; flex-direction: column; align-items: flex-end; }
.pente-widget--banner { display: flex; gap: 12px; align-items: center; padding: 6px 12px; border-radius: 6px; background: rgba(16,16,20,0.72); color: #e6e6ea; font-family: system-ui, sans-serif; font-size: 14px; }
.pente-banner-controls { display: flex; gap: 6px; }
.pente-banner-button { cursor: pointer; }
.pente-banner-button:disabled { cursor: default; opacity: 0.45; }
`;

/** Install the overlay stylesheet once per document (idempotent, keyed by {@link UI_STYLE_ID}). */
function ensureStyles(doc: Document): void {
  if (doc.getElementById(UI_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = UI_STYLE_ID;
  style.textContent = UI_STYLESHEET;
  (doc.head ?? doc.documentElement).appendChild(style);
}

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
  ensureStyles(doc);
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
