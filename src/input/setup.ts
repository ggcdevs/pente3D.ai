/**
 * Input wiring (Task 4.6) — the DOM boundary that turns keystrokes into command dispatch.
 *
 * The registry, scope-stack resolution, and chord normalization are all PURE
 * (`commands.ts` / `scopes.ts` / `keybindings.ts`, strict unit + mutation gate). This file
 * is the thin IO shell that: builds the command registry from the app's action handlers,
 * assembles the scope stack from the tracked `keybindings` config, and installs a `keydown`
 * listener that resolves each event's chord top-down and dispatches the resolved command.
 * It may touch the DOM (a `KeyboardEvent`, `addEventListener`) but imports no three and no
 * `src/ui`; the pure resolvers take a plain descriptor, so the DOM stays at this edge.
 *
 * Verified by Playwright driving real key events + `window.__pente` command inspectors
 * (build plan Task 4.6). `dispatch`/`handleChord` are also directly assertable so a test
 * can drive the pipeline without synthesizing a browser event.
 */

import { createRegistry, type Command, type CommandContext, type CommandRegistry } from './commands.ts';
import {
  pushScope,
  emptyStack,
  resolveKey,
  type Scope,
  type ScopeStack,
  type KeyResolution,
} from './scopes.ts';
import { chordOf, scopeFromBindings, type KeyChordEvent } from './keybindings.ts';

/** A serializable readout of the active scope stack — for `window.__pente` assertions. */
export interface InputReadout {
  /** The active scope ids, bottom-to-top. */
  scopes: string[];
  /** The registered command ids (sorted). */
  commands: string[];
}

/** The live input handle: dispatch by id/chord, inspect, and manage the scope stack. */
export interface InputHandle {
  readonly registry: CommandRegistry;
  /** The current scope stack (immutable snapshot). */
  stack(): ScopeStack;
  /** Push a scope (e.g. a modal/mode) onto the stack. */
  push(scope: Scope): void;
  /** Pop the topmost scope. */
  pop(): void;
  /** Resolve a chord against the current stack + dispatch its command. Returns the resolution. */
  handleChord(chord: string): KeyResolution;
  /** Dispatch a command id directly (the UI-button path — same registry as keys). */
  dispatch(id: string): boolean;
  /** A plain readout of scopes + commands. */
  readout(): InputReadout;
  /** Remove the installed keydown listener. */
  dispose(): void;
}

/**
 * Build the input system from a command list, a base keybindings map, and the dispatch
 * context. Installs a `keydown` listener on `target` that normalizes each event to a chord,
 * resolves it top-down through the scope stack, and dispatches the resolved command
 * (calling `preventDefault` only when the key was handled, so unhandled keys pass through).
 *
 * @param commands   The app's actions (id + handler); duplicate ids throw (authoring bug).
 * @param bindings   The tracked `keybindings` config → the base `game` scope's keymap.
 * @param ctx        The dispatch context handed to every command handler (the live scene).
 * @param target     The DOM event target to listen on (the window/canvas).
 */
export function createInput(
  commands: readonly Command[],
  bindings: Readonly<Record<string, string>>,
  ctx: CommandContext,
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
): InputHandle {
  const registry = createRegistry(commands);
  const baseScope = scopeFromBindings('game', bindings);
  let stack = pushScope(emptyStack(), baseScope);

  function dispatch(id: string): boolean {
    return registry.dispatch(id, ctx);
  }

  function handleChord(chord: string): KeyResolution {
    const resolution = resolveKey(stack, chord);
    if (resolution.commandId !== null) {
      dispatch(resolution.commandId);
    }
    return resolution;
  }

  function onKeyDown(event: Event): void {
    const ke = event as unknown as KeyboardEvent & KeyChordEvent;
    const resolution = handleChord(chordOf(ke));
    // A handled key (bound OR swallowed by a blocking scope) is consumed so it does not
    // also trigger a browser default (e.g. `/` opening quick-find). Unhandled keys fall
    // through untouched.
    if (resolution.handled && typeof ke.preventDefault === 'function') {
      ke.preventDefault();
    }
  }

  target.addEventListener('keydown', onKeyDown);

  return {
    registry,
    stack: () => stack,
    push: (scope) => {
      stack = pushScope(stack, scope);
    },
    pop: () => {
      stack = { scopes: stack.scopes.slice(0, -1) };
    },
    handleChord,
    dispatch,
    readout: () => ({
      scopes: stack.scopes.map((s) => s.id),
      commands: registry.ids().sort(),
    }),
    dispose: () => target.removeEventListener('keydown', onKeyDown),
  };
}
