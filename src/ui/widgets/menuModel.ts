/**
 * PURE menu view-model (Task 5.3) — render-ui design Part 6 "Widget roster: menu button + menu
 * modal (Settings, Host, Join, Load, Export)".
 *
 * The menu modal shows an ordered list of entries; each entry, when chosen, **dispatches a
 * command id** — the SAME id a keybinding fires (design Principle 3 "one action layer": a button
 * and a hotkey fire the identical command). Turning a roster of entry specs into the ordered,
 * filtered list the DOM renders is a DOM-free, deterministic derivation, so it earns the strict
 * unit + mutation gate exactly as {@link ../registry.ts} / {@link ./bannerModel.ts} do. The
 * `menu.ts` widget is the DOM/dispatch + scope-push IO glue (Playwright).
 *
 * The **entry set is data**, not hardcoded DOM: each spec carries a stable entry `id`, a `label`,
 * the `commandId` it dispatches, an `order`, and an optional `visible` flag (default shown). The
 * widget renders `deriveMenu(...)`'s output and, on click, dispatches `commandId` — it invents no
 * command ids of its own, and it never decides the entry set or its order.
 *
 * Resolution rules (mirrors the layout resolver deliberately — DRY of policy, and every rule has
 * a negative test):
 *   - **hidden dropped** — a spec with `visible === false` never appears in the output (a
 *     future config could hide Host/Join in a solo build without touching this glue).
 *   - **ordered** — entries are sorted by ascending `order`; ties break by entry `id` (stable,
 *     deterministic) so the rendered order never depends on array/object authoring order.
 * The default roster ({@link DEFAULT_MENU_ENTRIES}) is the design-Part-6 set in design order.
 */

/** The stable input scope id the open drawer pushes. */
export const MENU_SCOPE_ID = 'menu';

/**
 * Whether the drawer's input scope BLOCKS unhandled keys. `false` (non-blocking, #24): the drawer
 * slides in over the left edge of the live board WITHOUT freezing it — stray keys fall THROUGH to
 * the camera/game scopes below, so orbit/pan/zoom and placement keep working while the drawer is
 * open (render-ui design Part 5: modes don't block, mirroring `tempPlacementScope`). This is the
 * exact regression the old centered *blocking* modal had — it swallowed every key. A single named
 * constant so the drawer's blocking policy is one testable fact, not a literal buried in the glue.
 */
export const MENU_SCOPE_BLOCKING = false;

/** The drawer's open/closed view-model state — the single boolean the DOM reflects. */
export interface MenuOpenState {
  /** Whether the drawer is currently slid in (open). */
  readonly open: boolean;
}

/** The initial drawer state: closed. */
export function closedMenu(): MenuOpenState {
  return { open: false };
}

/**
 * Toggle the drawer open/closed (pure). The button fires this: an open drawer closes and a closed
 * drawer opens. Returns a fresh state, never mutating the input, so the caller keeps an undo-able
 * history without aliasing surprises (mirrors the immutable scope-stack helpers).
 */
export function toggleMenu(state: MenuOpenState): MenuOpenState {
  return { open: !state.open };
}

/**
 * Force the drawer closed (pure). Every close path (Escape, outside-click, choosing an entry, the
 * ✕ button) routes through this; it always yields a closed state. Whether a scope-pop is actually
 * owed is the GLUE's concern (it tracks a `wasOpen` flag), so this stays a trivial deterministic
 * projection with no branch to leave an equivalent mutant.
 */
export function closeMenu(_state: MenuOpenState): MenuOpenState {
  return { open: false };
}

/** A single configurable menu entry: what it shows and which command it dispatches. */
export interface MenuEntrySpec {
  /** A stable id for the entry (a DOM/test handle; distinct from the command it dispatches). */
  readonly id: string;
  /** The human label shown in the modal (e.g. `'Settings'`). */
  readonly label: string;
  /** The command id dispatched when the entry is chosen — identical to the keybinding's command. */
  readonly commandId: string;
  /** Flow order in the modal; lower comes first. Ties break by entry id. */
  readonly order: number;
  /** Whether the entry is shown at all; a `false` entry is dropped. Defaults to shown. */
  readonly visible?: boolean;
}

/** A resolved menu entry the DOM renders: its id, label, and the command id it dispatches. */
export interface MenuItem {
  /** The entry's stable id (DOM/test handle). */
  readonly id: string;
  /** The label shown on the entry. */
  readonly label: string;
  /** The command id dispatched when the entry is chosen. */
  readonly commandId: string;
}

/** The serializable menu view-model the DOM widget renders (and Playwright asserts on). */
export interface MenuModel {
  /** The visible entries in display order (ascending `order`, id tiebreak). */
  readonly items: readonly MenuItem[];
}

/**
 * The default menu roster — the design-Part-6 entries in design order: Settings, Network Game,
 * Load, Export. Each `commandId` is the id the corresponding action registers (Settings modal in
 * Task 5.4, the Network-Game panel in C.2, persistence in 5.8); the menu only *dispatches* them, so
 * an as-yet-unregistered command is a graceful no-op at dispatch (the registry returns `false`) —
 * never a crash and never a command invented here.
 *
 * Task C.2 / issue #13: the separate "Host" and "Join" entries are RETIRED in favour of a single
 * "Network Game" entry that opens the non-blocking drawer panel (`netPanel.ts`) whose picker
 * (custom / saved / random) feeds one code field with Host + Join buttons — Host/Join initiation no
 * longer lives in the always-on overlay.
 */
export const DEFAULT_MENU_ENTRIES: readonly MenuEntrySpec[] = [
  { id: 'settings', label: 'Settings', commandId: 'openSettings', order: 0 },
  { id: 'network', label: 'Network Game', commandId: 'openNetwork', order: 1 },
  { id: 'load', label: 'Load', commandId: 'loadGame', order: 3 },
  { id: 'export', label: 'Export', commandId: 'exportGame', order: 4 },
];

/**
 * Derive the {@link MenuModel} from an entry roster: drop hidden entries, sort the rest by
 * ascending `order` with entry `id` as the deterministic tiebreak, and project each to the
 * rendered {@link MenuItem} (id / label / commandId).
 *
 * @param entries The roster of entry specs (defaults to {@link DEFAULT_MENU_ENTRIES}).
 * @returns The serializable menu model: the visible entries in display order.
 */
export function deriveMenu(
  entries: readonly MenuEntrySpec[] = DEFAULT_MENU_ENTRIES,
): MenuModel {
  const items: MenuItem[] = entries
    // Hidden entries (`visible === false`) are dropped; absent `visible` means shown. `.filter`
    // returns a FRESH array, so the subsequent in-place `.sort` never touches the caller's roster
    // (the derivation stays pure — see the "does not mutate the input roster" test). No `.slice`
    // guard is needed here, and adding one would be dead code (an equivalent, unkillable mutant).
    .filter((entry) => entry.visible !== false)
    // Ascending order; ties break by id so the order is fully deterministic and never depends on
    // authoring order. `localeCompare` (a three-way −/0/+ returned directly) rather than a `<`
    // boolean ternary: two entries CAN share an id in an authored roster, so the tiebreak is
    // genuinely exercised, and `localeCompare` has no `<`-vs-`<=` boundary that would leave an
    // equivalent (unkillable) mutant — every ordering mutant is killed by a real reorder test
    // (agent-principles #7: the gate must reject reliably).
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((entry) => ({ id: entry.id, label: entry.label, commandId: entry.commandId }));

  return { items };
}
