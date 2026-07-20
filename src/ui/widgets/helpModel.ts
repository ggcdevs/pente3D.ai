/**
 * PURE help-overlay view-model (Task 5.7) — render-ui design Part 6 "Widget roster: help overlay
 * (`?`, generated from the command registry)".
 *
 * The help overlay lists the keyboard SHORTCUTS — GENERATED from the command registry + the current
 * keybindings, never a hardcoded list (build plan Task 5.7; agent-principles #8: no duplicated
 * volatile facts — the shortcut list is DERIVED from the same registry + config the input system
 * uses, so it can never drift from what the keys actually do). Turning the registered command ids +
 * the `key→commandId` bindings into the ordered rows the modal renders is a DOM-free, deterministic
 * derivation, so it earns the strict unit + mutation gate exactly as {@link ./menuModel.ts} /
 * {@link ./settingsModel.ts} do. The `help.ts` widget is the DOM + scope-push IO glue (Playwright).
 *
 * A **shortcut** needs BOTH a bound key AND a real command, so `deriveHelp` shows exactly the
 * commands that are (a) registered in the command registry AND (b) bound to at least one key. The
 * two negative cases fall out of that single rule and each has a test:
 *   - **stale binding dropped** — a binding whose command id is NOT in the registry (e.g. a
 *     localStorage binding to a removed command, or a config binding like `closeModal` that no
 *     command registers) is NOT a real shortcut and never appears. This mirrors the registry's
 *     "dispatching an unknown id is a graceful no-op" — a stale binding must not surface a phantom
 *     row any more than it should crash dispatch.
 *   - **unbound command dropped** — a registered command with NO key bound to it has no shortcut to
 *     show, so it is omitted (the overlay lists shortcuts, not the full command catalogue).
 *
 * A command MAY have several keys (two chords bound to one id); they are collected into the row's
 * `keys`, sorted for a deterministic display. Rows are sorted by their human `label` then
 * `commandId`, so the rendered order never depends on registry/binding authoring order. The label
 * is a friendly string from {@link DEFAULT_COMMAND_LABELS} when known, else the raw command id
 * (a newly-registered command still shows — just with its id as the label — never silently hidden,
 * agent-principles #1).
 */

/** The stable input scope id the open help modal pushes — a BLOCKING scope (GLOSSARY "Blocking
 * scope": a modal swallows stray keys so they never fall through to the game/camera scopes below).
 * Distinct from `menu`/`settings` so the three never collide on the stack. */
export const HELP_SCOPE_ID = 'help';

/** The command id the `?` keybinding (tracked `keybindings` default) dispatches to open this modal
 * — design Principle 3 (the SAME id a UI trigger would fire). Kept beside the model so the widget,
 * the scene command, and the config binding all agree on one string. */
export const SHOW_HELP_COMMAND = 'showHelp';

/**
 * Friendly, human-readable labels for the known command ids — a display concern kept OUT of the DOM
 * glue so the label roster + its use in ordering is deterministic and mutation-gated. This is NOT
 * the shortcut list (that is derived live from the registry + bindings); it only prettifies a
 * command id for display. A command id absent here falls back to the raw id, so a command is never
 * hidden merely for lacking a friendly label (agent-principles #1: incompleteness is visible, not
 * disguised). Keyed by the command ids the scene registers (Task 4.6 / 4.8 / 5.4 / 5.5).
 */
export const DEFAULT_COMMAND_LABELS: Readonly<Record<string, string>> = {
  undo: 'Undo',
  redo: 'Redo',
  reset: 'Reset game',
  toggleOrthogonal: 'Toggle orthogonal lines',
  toggleFaceDiagonals: 'Toggle face-diagonal lines',
  toggleSpaceDiagonals: 'Toggle space-diagonal lines',
  showAllDiagonals: 'Show all diagonals',
  enterTempMode: 'Enter temp-placement mode',
  exitTempMode: 'Exit temp-placement mode',
  confirmTempPiece: 'Confirm previewed piece',
  openSettings: 'Open settings',
  hostGame: 'Host game',
  joinGame: 'Join game',
  showHelp: 'Show this help',
};

/** The config/registry sources the model derives from — the SAME two the input system uses. */
export interface HelpSources {
  /** The registered command ids (from the command registry; unordered). */
  readonly commandIds: readonly string[];
  /** The current `key chord → commandId` bindings (the tracked `keybindings` config). */
  readonly bindings: Readonly<Record<string, string>>;
  /**
   * Friendly labels per command id (defaults to {@link DEFAULT_COMMAND_LABELS}). Injectable so a
   * test can pin the label mapping without depending on the shipped roster.
   */
  readonly labels?: Readonly<Record<string, string>>;
}

/** A single resolved shortcut row the DOM renders (and Playwright asserts on). */
export interface HelpRow {
  /** The command id this shortcut dispatches (the DOM/test handle). */
  readonly commandId: string;
  /** The human label shown for the shortcut (friendly, or the raw id as fallback). */
  readonly label: string;
  /** The key chord(s) bound to the command, sorted for a deterministic display (≥1, never empty). */
  readonly keys: readonly string[];
}

/** The serializable help view-model the DOM widget renders. */
export interface HelpModel {
  /** The shortcut rows, ordered by label then command id (deterministic, not authoring order). */
  readonly rows: readonly HelpRow[];
}

/**
 * Derive the {@link HelpModel} from the live command registry + current bindings.
 *
 * Steps (each deterministic):
 *   1. Invert `bindings` into `commandId → keys[]`, collecting the (possibly several) chords bound
 *      to each command.
 *   2. Keep only command ids that are BOTH registered (`commandIds`) AND have ≥1 bound key — the
 *      exact definition of a shortcut. This drops stale bindings (unknown command) and unbound
 *      commands (no key) in one pass.
 *   3. Project each surviving command to a row: its friendly `label` (or the raw id) and its keys
 *      sorted lexicographically.
 *   4. Sort rows by `label` then `commandId` for a stable, authoring-order-independent display.
 *
 * @param sources The registered command ids + current bindings (+ optional label overrides).
 * @returns The serializable help model: the shortcut rows in display order.
 */
export function deriveHelp(sources: HelpSources): HelpModel {
  const labels = sources.labels ?? DEFAULT_COMMAND_LABELS;

  // Registered-id set for the O(1) "is this a real command?" membership test used below.
  const registered = new Set(sources.commandIds);

  // Invert bindings: commandId → the key chords bound to it. A command may collect several keys.
  const keysByCommand = new Map<string, string[]>();
  for (const [key, commandId] of Object.entries(sources.bindings)) {
    // Drop stale bindings up front: a binding whose command is not registered is not a real
    // shortcut (mirrors the registry's graceful-no-op on an unknown id) and never seeds a row.
    if (!registered.has(commandId)) continue;
    const existing = keysByCommand.get(commandId);
    if (existing === undefined) {
      keysByCommand.set(commandId, [key]);
    } else {
      existing.push(key);
    }
  }

  const rows: HelpRow[] = [...keysByCommand.entries()].map(([commandId, keys]) => ({
    commandId,
    // Friendly label when known, else the raw id — a labelled-or-not command still shows (never
    // hidden for lacking a friendly label). `??` (not `||`) so an intentional empty-string label
    // is honoured rather than silently replaced by the id.
    label: labels[commandId] ?? commandId,
    // Sort the chords so a multi-key command renders its keys deterministically. `.sort` mutates
    // its receiver, but `keys` is the fresh array built above (never the caller's data), so the
    // derivation stays pure.
    keys: keys.sort((a, b) => a.localeCompare(b)),
  }));

  // Order rows by label then command id — both parts are exercised (two rows can share neither),
  // so every ordering mutant is killed by a real reorder test (agent-principles #7). An unbound or
  // stale-only command never reaches here, so `rows` lists exactly the real shortcuts.
  rows.sort((a, b) => a.label.localeCompare(b.label) || a.commandId.localeCompare(b.commandId));

  return { rows };
}
