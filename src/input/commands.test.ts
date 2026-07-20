/**
 * Tests for the PURE command registry (Task 4.6).
 *
 * The command registry is the "one action layer" (render-ui design Principle 3): a
 * button and a hotkey both dispatch the same **command ID**. `createRegistry` builds
 * an id→command map; `dispatch(id, ctx)` runs the bound handler and returns whether it
 * ran; unknown ids never throw (a stale keybinding must degrade gracefully, not crash
 * the input pipeline — GLOSSARY "Command"/"Keybinding"). This is the pure boundary — no
 * THREE, no DOM — so it earns the strict unit + mutation gate with genuine assertions on
 * observable effects (agent-principles #2/#3), including negatives: duplicate-id rejected,
 * unknown-id no-ops, handler receives the exact context.
 */

import { describe, expect, it, vi } from 'vitest';
import { createRegistry, type Command } from './commands.ts';

describe('createRegistry — construction', () => {
  it('registers commands by id and exposes them via has/get', () => {
    const undo: Command = { id: 'undo', run: () => {} };
    const redo: Command = { id: 'redo', run: () => {} };
    const registry = createRegistry([undo, redo]);
    expect(registry.has('undo')).toBe(true);
    expect(registry.has('redo')).toBe(true);
    expect(registry.get('undo')).toBe(undo);
    expect(registry.ids().sort()).toEqual(['redo', 'undo']);
  });

  it('rejects a duplicate command id (an authoring bug, not silently overwritten)', () => {
    const a: Command = { id: 'undo', run: () => {} };
    const b: Command = { id: 'undo', run: () => {} };
    expect(() => createRegistry([a, b])).toThrow(/duplicate command id: "undo"/);
  });

  it('reports has=false and get=undefined for an unregistered id', () => {
    const registry = createRegistry([{ id: 'undo', run: () => {} }]);
    expect(registry.has('redo')).toBe(false);
    expect(registry.get('redo')).toBeUndefined();
  });
});

describe('dispatch — running commands', () => {
  it('runs the bound handler with the exact context and returns true', () => {
    const run = vi.fn();
    const registry = createRegistry([{ id: 'undo', run }]);
    const ctx = { marker: Symbol('ctx') };
    const dispatched = registry.dispatch('undo', ctx);
    expect(dispatched).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(ctx);
  });

  it('returns false and runs nothing for an unknown id (stale binding degrades gracefully)', () => {
    const run = vi.fn();
    const registry = createRegistry([{ id: 'undo', run }]);
    const dispatched = registry.dispatch('doesNotExist', {});
    expect(dispatched).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('dispatches distinct ids to their own handlers, not the wrong one', () => {
    const undoRun = vi.fn();
    const redoRun = vi.fn();
    const registry = createRegistry([
      { id: 'undo', run: undoRun },
      { id: 'redo', run: redoRun },
    ]);
    registry.dispatch('redo', {});
    expect(redoRun).toHaveBeenCalledTimes(1);
    expect(undoRun).not.toHaveBeenCalled();
  });

  it('propagates a handler error honestly (never swallowed or mislabeled)', () => {
    const registry = createRegistry([
      {
        id: 'boom',
        run: () => {
          throw new Error('handler failed');
        },
      },
    ]);
    expect(() => registry.dispatch('boom', {})).toThrow('handler failed');
  });
});
