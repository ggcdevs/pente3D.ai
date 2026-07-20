/**
 * Tests for the PURE scope-stack resolver (Task 4.6).
 *
 * A **scope** is an input layer (a `key → commandID` keymap). The app maintains a
 * **stack** of active scopes; a keypress **resolves top-down** — the topmost scope that
 * binds the key wins, else it falls through to the scope below (GLOSSARY "Context /
 * scope"). A **blocking** scope *swallows* an unhandled key instead of letting it fall
 * through (`blocking: true`) — modals block; modes (temp placement) do not, so camera
 * keys still work under a preview. This is pure logic — no THREE, no DOM — so it earns
 * the strict unit + mutation gate with genuine assertions on the resolved command id and
 * the swallow/fall-through outcome, plus negatives (empty stack, unbound key).
 */

import { describe, expect, it } from 'vitest';
import { pushScope, popScope, resolveKey, emptyStack, type Scope } from './scopes.ts';

const global: Scope = {
  id: 'global',
  bindings: { '?': 'showHelp', u: 'undo' },
};
const game: Scope = {
  id: 'game',
  bindings: { u: 'undo', r: 'redo', d: 'showAllDiagonals' },
};
const temp: Scope = {
  id: 'tempPlacement',
  bindings: { Enter: 'confirmTempPiece', t: 'exitTempMode' },
  blocking: false,
};
const modal: Scope = {
  id: 'settings',
  bindings: { Escape: 'closeModal' },
  blocking: true,
};

describe('scope stack — push/pop', () => {
  it('starts empty and reports its scopes bottom-to-top', () => {
    const s0 = emptyStack();
    expect(s0.scopes).toEqual([]);
    const s1 = pushScope(s0, global);
    const s2 = pushScope(s1, game);
    expect(s2.scopes.map((s) => s.id)).toEqual(['global', 'game']);
  });

  it('push/pop are immutable — the source stack is never mutated', () => {
    const s1 = pushScope(emptyStack(), global);
    const s2 = pushScope(s1, game);
    expect(s1.scopes.map((s) => s.id)).toEqual(['global']); // unchanged by the second push
    const s3 = popScope(s2);
    expect(s3.scopes.map((s) => s.id)).toEqual(['global']);
    expect(s2.scopes.map((s) => s.id)).toEqual(['global', 'game']); // unchanged by the pop
  });

  it('popping an empty stack returns an empty stack (no throw)', () => {
    expect(popScope(emptyStack()).scopes).toEqual([]);
  });

  it('pop removes exactly the TOP scope, keeping every lower one in order', () => {
    // A three-deep stack proves `slice(0,-1)` (drop the last) — not "keep the first" —
    // by keeping BOTH lower scopes: global (bottom) then game, top temp removed.
    const stack = pushScope(pushScope(pushScope(emptyStack(), global), game), temp);
    const popped = popScope(stack);
    expect(popped.scopes.map((s) => s.id)).toEqual(['global', 'game']);
  });
});

describe('resolveKey — top-down resolution', () => {
  it('the topmost scope binding the key wins over a lower scope', () => {
    const stack = pushScope(pushScope(emptyStack(), global), game);
    // `u` is bound in BOTH; the top scope (game) must win.
    const r = resolveKey(stack, 'u');
    expect(r).toEqual({ commandId: 'undo', scopeId: 'game', handled: true });
    // `r` is only in the top scope.
    expect(resolveKey(stack, 'r')).toEqual({
      commandId: 'redo',
      scopeId: 'game',
      handled: true,
    });
  });

  it('falls through to a lower scope when the top does not bind the key', () => {
    const stack = pushScope(pushScope(emptyStack(), global), game);
    // `?` is only in `global`; `game` (top) does not bind it → falls through.
    const r = resolveKey(stack, '?');
    expect(r).toEqual({ commandId: 'showHelp', scopeId: 'global', handled: true });
  });

  it('returns unhandled (no command) for a key bound in no scope', () => {
    const stack = pushScope(pushScope(emptyStack(), global), game);
    const r = resolveKey(stack, 'x');
    expect(r).toEqual({ commandId: null, scopeId: null, handled: false });
  });

  it('returns unhandled for an empty stack', () => {
    expect(resolveKey(emptyStack(), 'u')).toEqual({
      commandId: null,
      scopeId: null,
      handled: false,
    });
  });
});

describe('resolveKey — blocking scopes', () => {
  it('a NON-blocking mode lets an unbound key fall through to a lower scope', () => {
    // global (bottom) → game → tempPlacement (top, non-blocking).
    const stack = pushScope(
      pushScope(pushScope(emptyStack(), global), game),
      temp,
    );
    // `d` is unbound in temp and game-bound; falls through past the non-blocking mode.
    const r = resolveKey(stack, 'd');
    expect(r).toEqual({ commandId: 'showAllDiagonals', scopeId: 'game', handled: true });
  });

  it('a BLOCKING scope swallows an unbound key — no fall-through, handled=true', () => {
    // global (bottom) → settings (top, blocking). `u` is bound in global but the
    // blocking modal swallows it: handled with NO command (a modal eats stray keys).
    const stack = pushScope(pushScope(emptyStack(), global), modal);
    const r = resolveKey(stack, 'u');
    expect(r).toEqual({ commandId: null, scopeId: 'settings', handled: true });
  });

  it('a BLOCKING scope still resolves its OWN bindings before swallowing', () => {
    const stack = pushScope(pushScope(emptyStack(), global), modal);
    const r = resolveKey(stack, 'Escape');
    expect(r).toEqual({ commandId: 'closeModal', scopeId: 'settings', handled: true });
  });

  it('blocking stops the search at the blocking scope, not below it', () => {
    // global (`u`→undo) below a blocking modal that does NOT bind `u`: the undo below
    // must be shadowed, proving the search halts at the blocking layer.
    const stack = pushScope(pushScope(emptyStack(), global), modal);
    expect(resolveKey(stack, 'u').commandId).toBeNull();
    // Sanity: without the blocking modal, `u` WOULD resolve to undo (isolates the cause).
    expect(resolveKey(pushScope(emptyStack(), global), 'u').commandId).toBe('undo');
  });
});
