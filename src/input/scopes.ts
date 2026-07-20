/**
 * PURE scope-stack resolver (Task 4.6).
 *
 * A **scope** is an input layer: a `key → commandID` keymap plus a `blocking` flag. The
 * app keeps a **stack** of active scopes; opening a mode/modal pushes one, closing pops
 * it (GLOSSARY "Context / scope"). A keypress **resolves top-down**: the topmost scope
 * that binds the key wins; otherwise the search falls through to the scope below.
 *
 * A **blocking** scope (`blocking: true`) *swallows* an unhandled key — the search halts
 * there and the key is reported handled with **no** command, so a lower scope never sees
 * it. Modals block (they must eat stray keys); modes like temp-placement do **not**, so
 * camera controls still fall through under a preview (GLOSSARY "Blocking scope"; render-
 * ui design Part 5). A non-blocking scope that misses simply falls through.
 *
 * This is pure logic — no THREE, no DOM — so it earns the strict unit + mutation gate.
 * Stacks are immutable: `pushScope`/`popScope` return a new stack, never mutating the
 * input, so the caller can keep a scope history without aliasing surprises.
 */

/** A command id a key resolves to (mirrors `commands.ts` `CommandId`, kept local & pure). */
export type CommandId = string;

/** A single input layer: a keymap plus whether it swallows unhandled keys. */
export interface Scope {
  /** A human id for diagnostics + `window.__pente` readouts (e.g. `'game'`). */
  readonly id: string;
  /** The `key → commandID` map this scope binds. */
  readonly bindings: Readonly<Record<string, CommandId>>;
  /**
   * When true, an unbound key is *swallowed* here (handled, no command) instead of
   * falling through to a lower scope. Defaults to non-blocking (falls through).
   */
  readonly blocking?: boolean;
}

/** An immutable stack of active scopes, ordered bottom (index 0) to top. */
export interface ScopeStack {
  /** The active scopes, bottom-to-top. The last element is the topmost. */
  readonly scopes: readonly Scope[];
}

/** The outcome of resolving a key against a scope stack. */
export interface KeyResolution {
  /** The resolved command id, or `null` when no command runs (unbound / swallowed). */
  readonly commandId: CommandId | null;
  /** The id of the scope that decided the outcome, or `null` when nothing did. */
  readonly scopeId: string | null;
  /**
   * Whether the key was consumed. `true` when a scope bound it *or* a blocking scope
   * swallowed it; `false` only when the key fell through every scope unbound.
   */
  readonly handled: boolean;
}

/** An empty scope stack — no active scopes. */
export function emptyStack(): ScopeStack {
  return { scopes: [] };
}

/** Push `scope` onto the top of `stack`, returning a new stack (never mutates `stack`). */
export function pushScope(stack: ScopeStack, scope: Scope): ScopeStack {
  return { scopes: [...stack.scopes, scope] };
}

/**
 * Pop the topmost scope, returning a new stack. Popping an empty stack is a no-op
 * (returns an empty stack) — closing "nothing" must not throw. No length guard is
 * needed: `[].slice(0, -1)` is already `[]`, so the empty case falls out for free (and
 * a guard here would be an equivalent mutant — no observable difference to test).
 */
export function popScope(stack: ScopeStack): ScopeStack {
  return { scopes: stack.scopes.slice(0, -1) };
}

/**
 * Resolve `key` against `stack`, top-down.
 *
 * Walks scopes from topmost to bottom:
 *   - if a scope **binds** the key → resolved to that command (`handled: true`);
 *   - else if that scope is **blocking** → swallowed there (`handled: true`, no command),
 *     and the search stops (lower scopes never see the key);
 *   - else → fall through to the next scope below.
 * If every scope is exhausted without a binding or a block, the key is **unhandled**.
 */
export function resolveKey(stack: ScopeStack, key: string): KeyResolution {
  for (let i = stack.scopes.length - 1; i >= 0; i--) {
    const scope = stack.scopes[i]!;
    const bound = scope.bindings[key];
    if (bound !== undefined) {
      return { commandId: bound, scopeId: scope.id, handled: true };
    }
    if (scope.blocking === true) {
      return { commandId: null, scopeId: scope.id, handled: true };
    }
  }
  return { commandId: null, scopeId: null, handled: false };
}
