/**
 * PURE command registry (Task 4.6) — the "one action layer".
 *
 * A **command** is an action with a stable string id (GLOSSARY "Command"). Every user
 * action — from a keybinding or a UI button — dispatches a command id (render-ui design
 * Principle 3: "a button and a hotkey fire the identical command"). The registry maps
 * `id → Command` and dispatches by id.
 *
 * Two deliberate design choices, both agent-principles-aligned:
 *   - A **duplicate id at construction throws** — that is an authoring bug (two commands
 *     claiming one name); silently overwriting one would hide it.
 *   - **Dispatching an unknown id is a graceful no-op** returning `false` — a *runtime*
 *     stale keybinding (e.g. a localStorage binding to a removed command) must never
 *     crash the input pipeline. The two cases are asymmetric on purpose.
 *
 * This is the pure boundary of the input system — no THREE, no DOM — so it earns the
 * strict unit + mutation gate. Handlers receive an opaque **context** (`CommandContext`)
 * supplied by the caller (the scene wires in the live `Game`/scene handle); the registry
 * itself knows nothing about rendering or rules. It builds no game logic.
 */

/** A stable command id (e.g. `'undo'`, `'toggleOrthogonal'`). */
export type CommandId = string;

/**
 * The opaque context passed to a command handler at dispatch time. The registry is
 * agnostic to its shape; the app supplies whatever the handlers need (the live scene /
 * `Game` handle). Kept `unknown` so this pure module never depends on render/core types.
 */
export type CommandContext = unknown;

/** A registered action: a stable id plus the handler that performs it. */
export interface Command {
  /** The stable string id dispatched by keybindings and UI widgets alike. */
  readonly id: CommandId;
  /** Perform the action. Receives the caller-supplied dispatch context. */
  run(ctx: CommandContext): void;
}

/** The immutable registry surface: lookup + dispatch by id. */
export interface CommandRegistry {
  /** True iff a command with `id` is registered. */
  has(id: CommandId): boolean;
  /** The registered command for `id`, or `undefined`. */
  get(id: CommandId): Command | undefined;
  /** All registered ids (unordered). */
  ids(): CommandId[];
  /**
   * Run the command bound to `id` with `ctx`. Returns `true` if a command ran, `false`
   * if `id` is unknown (a graceful no-op — a stale binding must not crash input). A
   * handler that throws propagates honestly (errors are never swallowed).
   */
  dispatch(id: CommandId, ctx: CommandContext): boolean;
}

/**
 * Build a {@link CommandRegistry} from a list of commands.
 *
 * @throws {Error} if two commands share an id (an authoring bug — never silently
 *   overwritten, so the collision surfaces at startup).
 */
export function createRegistry(commands: readonly Command[]): CommandRegistry {
  const byId = new Map<CommandId, Command>();
  for (const command of commands) {
    if (byId.has(command.id)) {
      throw new Error(`duplicate command id: ${JSON.stringify(command.id)}`);
    }
    byId.set(command.id, command);
  }

  return {
    has: (id) => byId.has(id),
    get: (id) => byId.get(id),
    ids: () => [...byId.keys()],
    dispatch: (id, ctx) => {
      const command = byId.get(id);
      if (command === undefined) return false;
      command.run(ctx);
      return true;
    },
  };
}
