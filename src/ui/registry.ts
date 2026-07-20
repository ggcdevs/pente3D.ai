/**
 * PURE widget registry (Task 5.1) — render-ui design Part 6, "the one action layer" companion
 * to the command registry (`src/input/commands.ts`).
 *
 * A **widget** is a self-contained UI element with a stable string id. It `mount()`s to a DOM
 * element and `update(state, config)`s from live game state + config; it **knows nothing about
 * its placement** — the pure `resolveLayout` (`layout.ts`) decides that from the `layout`
 * config. This module maps `widgetId → WidgetFactory` and hands the container the factory for
 * an id.
 *
 * The registry *structure* — the id→factory map, dup-at-construction detection, lookup by id —
 * is THREE-free / DOM-free PURE logic, so it earns the strict unit + mutation gate exactly as
 * the command registry does. The `mount`/`update` a factory returns are the DOM IO boundary,
 * exercised by Playwright driving the real app (build plan Task 5.1 gating model).
 *
 * The dup/unknown asymmetry mirrors `commands.ts` deliberately (DRY of policy):
 *   - a **duplicate id at construction throws** — two factories claiming one id is an authoring
 *     bug; silently overwriting one would hide it.
 *   - **looking up an unknown id returns `undefined`** (a graceful miss) — a stale layout entry
 *     naming a removed widget must resolve to "no widget", not crash. `resolveLayout` uses
 *     `knownIds()` to drop such entries before mount, so the two layers agree.
 */

/** A stable widget id (e.g. `'statusBanner'`, `'menuButton'`). A key into both this registry
 * and the `layout` config. */
export type WidgetId = string;

/**
 * A live widget instance: its root DOM element plus an `update` that re-renders it from the
 * current game state + config. Widgets subscribe to state/config and dispatch command ids
 * (design Part 6); the shapes are opaque here so this module stays free of core/DOM specifics.
 */
export interface Widget {
  /** The widget's root element, inserted into its zone by the container. */
  readonly element: HTMLElement;
  /** Re-render the widget from the current state + config. Called on every relevant change. */
  update(state: unknown, config: unknown): void;
  /** Detach listeners / subscriptions; called when the widget is unmounted. */
  dispose?(): void;
}

/**
 * A widget factory: builds a live {@link Widget}. Invoked by the container once, when the
 * widget is mounted into its resolved zone. The `deps` bag carries whatever the widget needs
 * to read state/config and dispatch commands (kept opaque so this pure module never imports
 * core/render/DOM types).
 */
export interface WidgetFactory {
  /** The stable id this factory builds — must equal its registry key. */
  readonly id: WidgetId;
  /** Build the live widget (mounts its DOM). Called by the container at mount time. */
  mount(deps: unknown): Widget;
}

/** The immutable registry surface: lookup by id + the set of known ids. */
export interface WidgetRegistry {
  /** True iff a factory with `id` is registered. */
  has(id: WidgetId): boolean;
  /** The registered factory for `id`, or `undefined` (a graceful miss for a stale layout id). */
  get(id: WidgetId): WidgetFactory | undefined;
  /** All registered ids (unordered). */
  ids(): WidgetId[];
  /** The set of registered ids — passed to `resolveLayout` to drop unknown layout entries. */
  knownIds(): Set<WidgetId>;
}

/**
 * Build a {@link WidgetRegistry} from a list of factories.
 *
 * @throws {Error} if two factories share an id (an authoring bug — never silently overwritten,
 *   so the collision surfaces at startup, exactly like the command registry).
 */
export function createWidgetRegistry(factories: readonly WidgetFactory[]): WidgetRegistry {
  const byId = new Map<WidgetId, WidgetFactory>();
  for (const factory of factories) {
    if (byId.has(factory.id)) {
      throw new Error(`duplicate widget id: ${JSON.stringify(factory.id)}`);
    }
    byId.set(factory.id, factory);
  }

  return {
    has: (id) => byId.has(id),
    get: (id) => byId.get(id),
    ids: () => [...byId.keys()],
    knownIds: () => new Set(byId.keys()),
  };
}
