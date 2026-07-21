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
 * The minimal element shape {@link isEditableTarget} needs to decide whether a keystroke is
 * being typed into a text-editing surface. A plain descriptor (not a live DOM `Element`) so
 * this module stays DOM-free — the scene glue at the `setup.ts` edge projects a real
 * `event.target` onto it, exactly as `chordOf` takes a projected {@link KeyChordEvent}.
 */
export interface EditableProbe {
  /** The element's `tagName` (`'INPUT'`, `'DIV'`, …), matched case-insensitively. */
  readonly tagName?: string;
  /** Whether the element is a `contenteditable` host. */
  readonly isContentEditable?: boolean;
}

/**
 * True when `target` is a text-editing surface — an `<input>`, `<textarea>`, `<select>`, or a
 * `contenteditable` host — so a global keydown handler can bail out and let the field receive
 * the key instead of firing a game shortcut. False for a null/undefined target and for any
 * non-editable element.
 *
 * PURE: it inspects the plain {@link EditableProbe} descriptor only; the DOM stays at the
 * `setup.ts` edge. Per issue #27 this predicate becomes the `inputFocus` context in the
 * future keybindings-scope revamp (an `inputFocus` scope that swallows game chords), so it
 * lives here beside the other pure resolvers rather than inline in the IO shell.
 */
export function isEditableTarget(target: EditableProbe | null | undefined): boolean {
  if (target === null || target === undefined) return false;
  const tag = target.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true;
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
