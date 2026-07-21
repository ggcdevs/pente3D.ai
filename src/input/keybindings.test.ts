/**
 * Tests for the PURE keybindings resolver (Task 4.6).
 *
 * Keybindings map a **key chord** → command id, loaded from the tracked `keybindings`
 * JSON default and overridable via localStorage (GLOSSARY "Keybinding"; render-ui design
 * Part 5). Two pure pieces here:
 *   - `chordOf(event)`: normalize a keyboard-event-like descriptor into a canonical chord
 *     string (`'ctrl+shift+k'`, `'Enter'`) — modifiers in a fixed order, so a binding is
 *     matched regardless of which order the user held the modifiers.
 *   - `scopeFromBindings`: build a `Scope` from a `key→commandID` config record, so the
 *     config default drops straight into the scope-stack resolver.
 *
 * Pure logic — no THREE, no DOM (the resolver takes a *plain descriptor*, not a live
 * `KeyboardEvent`) — so it earns the strict unit + mutation gate with genuine assertions,
 * including negatives (bare modifier presses, unbound chord, config integration).
 */

import { describe, expect, it } from 'vitest';
import { chordOf, scopeFromBindings, isEditableTarget, type KeyChordEvent } from './keybindings.ts';
import { resolveKey, pushScope, emptyStack } from './scopes.ts';
import keybindingsDefault from '../config/defaults/keybindings.json' with { type: 'json' };

const ev = (e: Partial<KeyChordEvent> & { key: string }): KeyChordEvent => ({
  key: e.key,
  ctrlKey: e.ctrlKey ?? false,
  shiftKey: e.shiftKey ?? false,
  altKey: e.altKey ?? false,
  metaKey: e.metaKey ?? false,
});

describe('chordOf — plain keys', () => {
  it('returns a single character key unchanged', () => {
    expect(chordOf(ev({ key: 'd' }))).toBe('d');
    expect(chordOf(ev({ key: '?' }))).toBe('?');
  });

  it('returns named keys (Enter/Escape) verbatim so config matches them literally', () => {
    expect(chordOf(ev({ key: 'Enter' }))).toBe('Enter');
    expect(chordOf(ev({ key: 'Escape' }))).toBe('Escape');
  });
});

describe('chordOf — modifiers', () => {
  it('prefixes a single modifier', () => {
    expect(chordOf(ev({ key: 's', ctrlKey: true }))).toBe('ctrl+s');
  });

  it('orders multiple modifiers canonically (ctrl, alt, shift, meta) regardless of input', () => {
    // Every modifier held: always emitted in the fixed canonical order.
    const chord = chordOf(ev({ key: 'k', shiftKey: true, ctrlKey: true, metaKey: true, altKey: true }));
    expect(chord).toBe('ctrl+alt+shift+meta+k');
  });

  it('two different modifier-orderings of the same chord normalize identically', () => {
    const a = chordOf(ev({ key: 'z', ctrlKey: true, shiftKey: true }));
    const b = chordOf(ev({ key: 'z', shiftKey: true, ctrlKey: true }));
    expect(a).toBe(b);
    expect(a).toBe('ctrl+shift+z');
  });

  it('returns just the modifier name for a bare modifier keypress (no dangling +)', () => {
    // Pressing Control alone must not yield "ctrl+Control" — a bare modifier is its own name.
    expect(chordOf(ev({ key: 'Control', ctrlKey: true }))).toBe('ctrl');
    expect(chordOf(ev({ key: 'Shift', shiftKey: true }))).toBe('shift');
    expect(chordOf(ev({ key: 'Alt', altKey: true }))).toBe('alt');
    expect(chordOf(ev({ key: 'Meta', metaKey: true }))).toBe('meta');
  });
});

describe('isEditableTarget', () => {
  it('is true for a text-input element (INPUT)', () => {
    expect(isEditableTarget({ tagName: 'INPUT' })).toBe(true);
  });

  it('is true for TEXTAREA and SELECT', () => {
    expect(isEditableTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isEditableTarget({ tagName: 'SELECT' })).toBe(true);
  });

  it('matches tagName case-insensitively (lowercase input)', () => {
    // The DOM reports upper-case tagNames, but guard against a projected lower-case one.
    expect(isEditableTarget({ tagName: 'input' })).toBe(true);
  });

  it('is true for a contenteditable host regardless of tagName', () => {
    expect(isEditableTarget({ isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('is false for a non-editable element (DIV)', () => {
    expect(isEditableTarget({ tagName: 'DIV' })).toBe(false);
  });

  it('is false for a non-editable contenteditable value (explicit false, not just missing)', () => {
    // `isContentEditable === true` — a false must NOT pass (kills the `!== false`/truthiness mutant).
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: false })).toBe(false);
  });

  it('is false for an empty descriptor (no tagName, no contentEditable)', () => {
    expect(isEditableTarget({})).toBe(false);
  });

  it('is false for null and undefined targets', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
  });
});

describe('scopeFromBindings + resolveKey integration', () => {
  it('builds a scope whose bindings resolve chords to their config command ids', () => {
    const scope = scopeFromBindings('game', { u: 'undo', 'ctrl+s': 'save' });
    const stack = pushScope(emptyStack(), scope);
    expect(resolveKey(stack, chordOf(ev({ key: 'u' }))).commandId).toBe('undo');
    expect(resolveKey(stack, chordOf(ev({ key: 's', ctrlKey: true }))).commandId).toBe('save');
  });

  it('an unbound chord resolves to no command (handled=false)', () => {
    const scope = scopeFromBindings('game', { u: 'undo' });
    const stack = pushScope(emptyStack(), scope);
    const r = resolveKey(stack, chordOf(ev({ key: 'x' })));
    expect(r.handled).toBe(false);
    expect(r.commandId).toBeNull();
  });

  it('carries the blocking flag through to the built scope', () => {
    const scope = scopeFromBindings('modal', { Escape: 'closeModal' }, true);
    expect(scope.blocking).toBe(true);
    // A blocking scope swallows an unbound key (handled, no command).
    const stack = pushScope(emptyStack(), scope);
    const r = resolveKey(stack, chordOf(ev({ key: 'q' })));
    expect(r).toEqual({ commandId: null, scopeId: 'modal', handled: true });
  });

  it('resolves the real tracked keybindings default (the SSOT drops straight in)', () => {
    // Uses the actual config JSON so the wiring is proven against the shipped defaults,
    // not a hand-made fixture (agent-principles #8 — no duplicated magic values).
    const scope = scopeFromBindings('game', keybindingsDefault);
    const stack = pushScope(emptyStack(), scope);
    // Pick a couple of real bindings from the default file.
    expect(resolveKey(stack, chordOf(ev({ key: 'd' }))).commandId).toBe(
      keybindingsDefault['d'],
    );
    expect(resolveKey(stack, chordOf(ev({ key: 'Enter' }))).commandId).toBe(
      keybindingsDefault['Enter'],
    );
  });
});
