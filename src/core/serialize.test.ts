import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Game } from './game';
import { headHash } from './eventLog';
import {
  exportGame,
  importGame,
  serializeGame,
  deserializeGame,
  ExportError,
  type GameExport,
} from './serialize';
import type { Coord } from './coords';

/** A short scripted game exercising place / undo / redo / capture / win-recompute. */
function scriptedGame(): Game {
  const g = new Game(9);
  g.place([0, 0, 0]); // W
  g.place([1, 0, 0]); // B
  g.place([8, 8, 8]); // W
  g.place([2, 0, 0]); // B
  g.place([3, 0, 0]); // W closes bracket -> captures 1,0,0 and 2,0,0
  g.place([4, 4, 4]); // B
  g.undo(); // undo B's 4,4,4
  g.redo(); // redo it back
  return g;
}

describe('exportGame — human-readable snapshot', () => {
  it('produces { size, settings, log }', () => {
    const g = scriptedGame();
    const dump = exportGame(g);
    expect(dump.size).toBe(9);
    expect(dump).toHaveProperty('settings');
    expect(dump).toHaveProperty('log');
    // The log carries the events, not derived pieces.
    expect(Array.isArray(dump.log)).toBe(true);
    expect(dump.log[0]).toEqual({ type: 'place', node: '0,0,0' });
  });

  it('preserves settings passed alongside the game', () => {
    const g = new Game(9);
    g.place([4, 4, 4]);
    const settings = { winLength: 5, theme: 'dark' };
    const dump = exportGame(g, settings);
    expect(dump.settings).toEqual(settings);
  });

  it('serializeGame yields a human-readable JSON string that parses back', () => {
    const g = scriptedGame();
    const json = serializeGame(g);
    expect(typeof json).toBe('string');
    // Human-readable: pretty-printed (contains newlines) and the node keys are visible.
    expect(json).toContain('\n');
    expect(json).toContain('0,0,0');
    const parsed = JSON.parse(json) as GameExport;
    expect(parsed.size).toBe(9);
  });
});

describe('importGame — round-trip fidelity', () => {
  it('reconstructs an identical Game (same headHash, state, ply)', () => {
    const g = scriptedGame();
    const restored = importGame(exportGame(g));
    expect(headHash(restored.log)).toBe(headHash(g.log));
    expect(restored.state()).toEqual(g.state());
    expect(restored.ply()).toBe(g.ply());
  });

  it('deserializeGame round-trips through the JSON string', () => {
    const g = scriptedGame();
    const restored = deserializeGame(serializeGame(g));
    expect(headHash(restored.log)).toBe(headHash(g.log));
    expect(restored.state()).toEqual(g.state());
    expect(restored.ply()).toBe(g.ply());
  });

  it('carries the full undo/redo history, not just the derived board', () => {
    const g = new Game(9);
    g.place([4, 4, 4]);
    g.place([0, 0, 0]);
    g.undo();
    const restored = importGame(exportGame(g));
    // The redo tail survives: we can redo the undone move on the restored game.
    expect(restored.ply()).toBe(1);
    expect(() => restored.redo()).not.toThrow();
    expect(restored.state()).toEqual((() => {
      const g2 = new Game(9);
      g2.place([4, 4, 4]);
      g2.place([0, 0, 0]);
      return g2.state();
    })());
  });
});

describe('importGame / deserializeGame — corrupt input throws a clear error', () => {
  it('rejects malformed JSON with ExportError (never a broken game)', () => {
    expect(() => deserializeGame('{not json')).toThrow(ExportError);
  });

  it('rejects a non-object payload', () => {
    expect(() => importGame(42 as unknown as GameExport)).toThrow(ExportError);
    expect(() => importGame(null as unknown as GameExport)).toThrow(ExportError);
  });

  it('rejects a missing / invalid size', () => {
    expect(() =>
      importGame({ settings: {}, log: [] } as unknown as GameExport),
    ).toThrow(ExportError);
    expect(() =>
      importGame({ size: 0, settings: {}, log: [] } as unknown as GameExport),
    ).toThrow(ExportError);
    expect(() =>
      importGame({ size: -3, settings: {}, log: [] } as unknown as GameExport),
    ).toThrow(ExportError);
    expect(() =>
      importGame({ size: 2.5, settings: {}, log: [] } as unknown as GameExport),
    ).toThrow(ExportError);
  });

  it('rejects a non-array log', () => {
    expect(() =>
      importGame({ size: 9, settings: {}, log: 'nope' } as unknown as GameExport),
    ).toThrow(ExportError);
  });

  it('rejects an unknown event type in the log', () => {
    expect(() =>
      importGame({
        size: 9,
        settings: {},
        log: [{ type: 'teleport', node: '0,0,0' }],
      } as unknown as GameExport),
    ).toThrow(ExportError);
  });

  it('rejects a place event with a malformed node key', () => {
    expect(() =>
      importGame({
        size: 9,
        settings: {},
        log: [{ type: 'place', node: 'x,y,z' }],
      } as unknown as GameExport),
    ).toThrow(ExportError);
  });

  it('rejects a log whose events describe an illegal game', () => {
    // Two places on the same node is illegal — import must reject, not build a broken game.
    expect(() =>
      importGame({
        size: 9,
        settings: {},
        log: [
          { type: 'place', node: '4,4,4' },
          { type: 'place', node: '4,4,4' },
        ],
      } as unknown as GameExport),
    ).toThrow(ExportError);
  });
});

describe('property: export/import is an identity on any reachable game', () => {
  it('round-trips state, headHash, and ply for arbitrary action streams', () => {
    const arbMove = fc.tuple(
      fc.integer({ min: 0, max: 8 }),
      fc.integer({ min: 0, max: 8 }),
      fc.integer({ min: 0, max: 8 }),
    );
    const arbAction = fc.oneof(
      arbMove.map((m) => ({ kind: 'place' as const, m: m as Coord })),
      fc.constant({ kind: 'undo' as const }),
      fc.constant({ kind: 'redo' as const }),
    );

    fc.assert(
      fc.property(fc.array(arbAction, { maxLength: 40 }), (actions) => {
        const g = new Game(9);
        for (const a of actions) {
          try {
            if (a.kind === 'place') g.place(a.m);
            else if (a.kind === 'undo') g.undo();
            else g.redo();
          } catch {
            // Illegal actions are ignored; the log is unchanged.
          }
        }
        const restored = deserializeGame(serializeGame(g));
        expect(headHash(restored.log)).toBe(headHash(g.log));
        expect(restored.state()).toEqual(g.state());
        expect(restored.ply()).toBe(g.ply());
      }),
    );
  });
});
