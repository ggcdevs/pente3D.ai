/**
 * PURE zone-based layout resolver (Task 5.1) — render-ui design Part 6.
 *
 * The composable UI is a set of self-contained widgets (`registry.ts`), each with a stable
 * string id and knowing NOTHING about where it sits. **Placement is pure config**: the
 * `layout` config section maps `widgetId → { zone, order, visible, offset }`. This module is
 * the deterministic function that turns that config (plus the set of ids that actually have a
 * registered factory) into an ordered, per-zone plan the container mounts.
 *
 * Being THREE-free / DOM-free, this is the strict unit + mutation boundary of the UI shell
 * (build plan Task 5.1 gating model): the DOM container that mounts the plan is the
 * Playwright-verified IO glue in `registry.ts`'s consumers / `main.ts`.
 *
 * Resolution rules (all asserted by the tests + negative cases):
 *   - **hidden dropped** — an entry with `visible === false` never appears in the output.
 *   - **unknown id ignored gracefully** — a layout entry whose id has no registered factory is
 *     skipped (no throw): stale localStorage layout must never crash the shell.
 *   - **ordered within a zone** — widgets in a zone are sorted by ascending `order`; ties break
 *     by the widget id (stable, deterministic) so the plan never depends on object-key order.
 *   - **grouped by zone** — the output is keyed by zone; only zones that end up with at least
 *     one visible, known widget appear.
 */

/** A widget's placement record in the `layout` config (design Part 6). */
export interface WidgetPlacement {
  /** The anchor zone the widget flows into (e.g. `'top-left'`, `'left'`, `'bottom-center'`). */
  readonly zone: string;
  /** Flow order within the zone; lower comes first. Ties break by widget id. */
  readonly order: number;
  /** Whether the widget is shown at all; a `false` widget is dropped from the plan. */
  readonly visible: boolean;
  /** Optional per-widget pixel nudge off its zone anchor; passed through verbatim. */
  readonly offset?: { readonly x: number; readonly y: number };
}

/** The `layout` config section: `widgetId → placement`. */
export interface LayoutConfig {
  readonly widgets: Readonly<Record<string, WidgetPlacement>>;
}

/** A single resolved widget slot in a zone's ordered plan. */
export interface ResolvedWidget {
  /** The widget id (a key into the registry). */
  readonly id: string;
  /** The resolved flow order within the zone. */
  readonly order: number;
  /** The resolved per-widget offset, or `undefined` if none was configured. */
  readonly offset?: { readonly x: number; readonly y: number };
}

/** The resolved layout: for each populated zone, its widgets in flow order. */
export interface ResolvedLayout {
  /** `zone → ordered visible widgets`. Only non-empty zones are present. */
  readonly zones: Readonly<Record<string, readonly ResolvedWidget[]>>;
}

/**
 * Resolve the layout config into an ordered, per-zone plan.
 *
 * @param config    The `layout` config section (`widgetId → placement`).
 * @param knownIds  The set of widget ids that have a registered factory. A layout entry for an
 *   id not in this set is ignored gracefully (a stale/unknown widget must not crash the shell).
 * @returns The {@link ResolvedLayout}: each populated zone's visible widgets, sorted by
 *   ascending `order` with id as the deterministic tiebreak.
 */
export function resolveLayout(
  config: LayoutConfig,
  knownIds: ReadonlySet<string>,
): ResolvedLayout {
  const byZone = new Map<string, ResolvedWidget[]>();

  for (const [id, placement] of Object.entries(config.widgets)) {
    // Hidden widgets are dropped from the plan entirely.
    if (!placement.visible) continue;
    // An unknown id (no registered factory) is ignored gracefully — stale layout config
    // (e.g. a localStorage override naming a removed widget) must never crash the shell.
    if (!knownIds.has(id)) continue;

    const slot: ResolvedWidget = {
      id,
      order: placement.order,
      ...(placement.offset !== undefined ? { offset: placement.offset } : {}),
    };
    const existing = byZone.get(placement.zone);
    if (existing !== undefined) {
      existing.push(slot);
    } else {
      byZone.set(placement.zone, [slot]);
    }
  }

  const zones: Record<string, readonly ResolvedWidget[]> = {};
  for (const [zone, widgets] of byZone) {
    // Ascending order; ties break by id so the plan is fully deterministic and never depends on
    // object-key iteration order (not a contract to rely on). The id tiebreak uses `localeCompare`
    // (a three-way −/0/+ result returned directly) rather than a `<` boolean ternary: ids in a Map
    // are unique so `a.id === b.id` never occurs, which would make a `<`-vs-`<=` mutant EQUIVALENT
    // (unkillable). `localeCompare` has no such boundary operator, so every ordering mutant here is
    // killed by a genuine reorder assertion (agent-principles #7 — the gate must reject reliably).
    widgets.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    zones[zone] = widgets;
  }

  return { zones };
}
