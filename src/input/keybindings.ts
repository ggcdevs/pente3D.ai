/**
 * PURE keybindings resolver (Task 4.6).
 *
 * Keybindings map a **key chord** → command id, loaded from the tracked `keybindings`
 * JSON default and overridable via localStorage (GLOSSARY "Keybinding"). Two pure pieces:
 *
 *   - `chordOf(event)` normalizes a keyboard-event-like descriptor into a canonical chord
 *     string. Modifiers are emitted in a **fixed order** (`ctrl+alt+shift+meta+key`) so a
 *     configured chord matches regardless of the order the user pressed the modifiers, and
 *     a bare modifier press (`Control` alone) yields just the modifier name — never a
 *     dangling `ctrl+Control`.
 *   - `scopeFromBindings` builds a `Scope` (see `scopes.ts`) from a `key→commandID` config
 *     record, so the tracked `keybindings` default drops straight into the scope stack.
 *
 * The resolver takes a **plain descriptor** (`KeyChordEvent`), not a live `KeyboardEvent`,
 * so it is DOM-free and earns the strict unit + mutation gate. The scene glue reads the
 * three modifier booleans + `key` off the real event and hands them here; this module
 * touches no DOM and builds no rules.
 */

import type { CommandId, Scope } from './scopes.ts';

/**
 * The minimal keyboard-event shape the chord normalizer needs — the subset of the DOM
 * `KeyboardEvent` that determines a chord. Declared locally (not `KeyboardEvent`) so this
 * module stays DOM-free; the scene glue projects a real event onto it.
 */
export interface KeyChordEvent {
  /** The `KeyboardEvent.key` value (`'a'`, `'Enter'`, `'Control'`, …). */
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
}

/**
 * The modifier keys, paired with the canonical chord token each emits. Order here IS the
 * canonical emission order, so `chordOf` is deterministic regardless of press order.
 */
const MODIFIERS: readonly { readonly held: (e: KeyChordEvent) => boolean; readonly token: string }[] = [
  { held: (e) => e.ctrlKey, token: 'ctrl' },
  { held: (e) => e.altKey, token: 'alt' },
  { held: (e) => e.shiftKey, token: 'shift' },
  { held: (e) => e.metaKey, token: 'meta' },
];

/** The bare modifier key names — pressing one alone yields just its token. */
const MODIFIER_KEY_NAMES = new Set(['Control', 'Alt', 'Shift', 'Meta']);

/**
 * Normalize a keyboard descriptor into a canonical chord string.
 *
 * - Modifiers are prefixed in the fixed order `ctrl+alt+shift+meta`, so any press-order
 *   of the same combination maps to one chord.
 * - A **bare** modifier press (the key *is* a modifier, e.g. `Control`) yields just the
 *   held-modifier tokens — never a `ctrl+Control` with the modifier doubled.
 * - Any other key (`'d'`, `'Enter'`) is appended verbatim so config matches it literally.
 */
export function chordOf(event: KeyChordEvent): string {
  const parts: string[] = [];
  for (const mod of MODIFIERS) {
    if (mod.held(event)) parts.push(mod.token);
  }
  if (!MODIFIER_KEY_NAMES.has(event.key)) {
    parts.push(event.key);
  }
  return parts.join('+');
}

/**
 * Build a {@link Scope} from a `key→commandID` config record (e.g. the tracked
 * `keybindings` default). The record's keys are chord strings as produced by `chordOf`;
 * `blocking` marks a modal/blocking scope.
 */
export function scopeFromBindings(
  id: string,
  bindings: Readonly<Record<string, CommandId>>,
  blocking = false,
): Scope {
  return { id, bindings, blocking };
}
