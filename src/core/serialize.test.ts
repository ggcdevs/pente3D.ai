import { describe, it, expect, vi, afterEach } from 'vitest';
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
  it('produces { uuid, size, settings, log }', () => {
    const g = scriptedGame();
    const dump = exportGame(g);
    expect(dump.size).toBe(9);
    expect(dump).toHaveProperty('settings');
    expect(dump).toHaveProperty('log');
    // The game uuid (minted at genesis, S.1) is threaded through the export.
    expect(dump.uuid).toBe(g.uuid);
    expect(typeof dump.uuid).toBe('string');
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
  it('reconstructs an identical Game (same uuid, headHash, state, ply)', () => {
    const g = scriptedGame();
    const restored = importGame(exportGame(g));
    // The uuid round-trips, so the headHash matches — under S.1 that means the
    // reconstruction is the SAME game identity, not merely the same moves.
    expect(restored.uuid).toBe(g.uuid);
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

  it('wraps a non-Error JSON.parse fault in ExportError, stringifying the thrown value', () => {
    // JSON.parse normally throws a SyntaxError, but the error formatter must also
    // handle a thrown non-Error value by String()-ing it rather than reading
    // `.message`. Force that path and assert the message still comes through.
    const spy = vi.spyOn(JSON, 'parse').mockImplementation(() => {
      throw 'raw string fault';
    });
    try {
      expect(() => deserializeGame('{}')).toThrow(ExportError);
      expect(() => deserializeGame('{}')).toThrow(/raw string fault/);
    } finally {
      spy.mockRestore();
    }
  });

  it('ExportError is named and carries its message', () => {
    // `name` and message text are the diagnostic surface callers/logs read.
    const e = new ExportError('boom');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('ExportError');
    expect(e.message).toBe('boom');
  });

  it('rejects a non-object payload', () => {
    expect(() => importGame(42 as unknown as GameExport)).toThrow(ExportError);
    expect(() => importGame(null as unknown as GameExport)).toThrow(ExportError);
    // The message must name the object guard, not a generic failure.
    expect(() => importGame(42 as unknown as GameExport)).toThrow(
      /export must be an object/,
    );
  });

  it('rejects a missing / invalid size', () => {
    expect(() =>
      importGame({ settings: {}, log: [] } as unknown as GameExport),
    ).toThrow(/invalid size: expected a positive integer/);
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

  it('accepts the minimal valid board size (size: 1)', () => {
    // size >= 1 is the boundary: a 1x1x1 board is legal. This pins size < 1 (not
    // <= 1): the sole node 0,0,0 must import cleanly rather than being rejected.
    const g = importGame({
      size: 1,
      settings: {},
      log: [{ type: 'place', node: '0,0,0' }],
    });
    expect(g.state().size).toBe(1);
    expect(g.state().pieces['0,0,0']).toBe('white');
  });

  it('rejects a non-array log', () => {
    expect(() =>
      importGame({ size: 9, settings: {}, log: 'nope' } as unknown as GameExport),
    ).toThrow(/invalid log: expected an array/);
  });

  it('rejects an unknown event type in the log', () => {
    expect(() =>
      importGame({
        size: 9,
        settings: {},
        log: [{ type: 'teleport', node: '0,0,0' }],
      } as unknown as GameExport),
    ).toThrow(/unknown event type at index 0: teleport/);
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

  it('rejects a log entry that is not an object', () => {
    expect(() =>
      importGame({
        size: 9,
        settings: {},
        log: [42],
      } as unknown as GameExport),
    ).toThrow(/not an object/i);
    expect(() =>
      importGame({
        size: 9,
        settings: {},
        log: [null],
      } as unknown as GameExport),
    ).toThrow(ExportError);
  });

  it('rejects a place event whose node is not a string', () => {
    expect(() =>
      importGame({
        size: 9,
        settings: {},
        log: [{ type: 'place', node: 123 }],
      } as unknown as GameExport),
    ).toThrow(/node must be a string/i);
    expect(() =>
      importGame({
        size: 9,
        settings: {},
        log: [{ type: 'place' }],
      } as unknown as GameExport),
    ).toThrow(/node must be a string/i);
  });

  it('rejects a place event whose node key has the wrong number of parts', () => {
    // "1,2" has only two components — not a valid "x,y,z" triple.
    expect(() =>
      importGame({
        size: 9,
        settings: {},
        log: [{ type: 'place', node: '1,2' }],
      } as unknown as GameExport),
    ).toThrow(/invalid node key/i);
  });

  it('rejects a place event whose node key is out of bounds', () => {
    // "9,0,0" parses to a valid integer triple but is off-board for N=9.
    expect(() =>
      importGame({
        size: 9,
        settings: {},
        log: [{ type: 'place', node: '9,0,0' }],
      } as unknown as GameExport),
    ).toThrow(/invalid node key/i);
  });

  it('rejects a non-canonical key with a leading zero ("01,2,3")', () => {
    // Number("01") === 1 and is in bounds, so this passes the integer + bounds
    // checks — only the round-trip guard (keyOf(coord) !== node) rejects it. This
    // isolates that guard: without it, "01,2,3" would import as the coord (1,2,3),
    // giving two distinct keys that fold to the same node.
    expect(() =>
      importGame({
        size: 9,
        settings: {},
        log: [{ type: 'place', node: '01,2,3' }],
      } as unknown as GameExport),
    ).toThrow(/invalid node key/i);
  });

  it('rejects a non-canonical key with leading whitespace (" 1,2,3")', () => {
    // Number(" 1") === 1 (JS trims), in bounds and integer — again only the
    // round-trip guard catches the non-canonical form.
    expect(() =>
      importGame({
        size: 9,
        settings: {},
        log: [{ type: 'place', node: ' 1,2,3' }],
      } as unknown as GameExport),
    ).toThrow(/invalid node key/i);
  });

  it('rejects a non-integer coordinate ("1.5,2,3")', () => {
    // Number("1.5") === 1.5 is finite and in bounds but not an integer — this
    // isolates the integer guard (coord.every(Number.isInteger)). Without it a
    // fractional coordinate would slip past into an off-lattice node.
    expect(() =>
      importGame({
        size: 9,
        settings: {},
        log: [{ type: 'place', node: '1.5,2,3' }],
      } as unknown as GameExport),
    ).toThrow(/invalid node key/i);
  });

  it('rejects a key with too many components ("1,2,3,4")', () => {
    // Four components — coordsOf reads the first three, which round-trip and are
    // in bounds, so this isolates the parts.length !== 3 arity guard.
    expect(() =>
      importGame({
        size: 9,
        settings: {},
        log: [{ type: 'place', node: '1,2,3,4' }],
      } as unknown as GameExport),
    ).toThrow(/invalid node key/i);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('re-throws an unexpected (non-IllegalMove) error from the fold unwrapped', () => {
    // The fold only ever throws IllegalMove for a bad move sequence; any *other*
    // error is an unexpected fault and must propagate verbatim, never masked as
    // an ExportError. Force such a fault and assert the original error escapes.
    const boom = new RangeError('unexpected fold fault');
    const spy = vi.spyOn(Game, 'fromLog').mockImplementation(() => {
      throw boom;
    });
    expect(() =>
      importGame({
        size: 9,
        settings: {},
        log: [{ type: 'place', node: '0,0,0' }],
      } as unknown as GameExport),
    ).toThrow(boom);
    // It is the raw error, not wrapped in ExportError.
    let caught: unknown;
    try {
      importGame({ size: 9, settings: {}, log: [] } as unknown as GameExport);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(boom);
    expect(caught).not.toBeInstanceOf(ExportError);
    expect(spy).toHaveBeenCalled();
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
    // The wrapper message must name the illegal-game cause and carry the
    // underlying IllegalMove text, not swallow it into a blank string.
    expect(() =>
      importGame({
        size: 9,
        settings: {},
        log: [
          { type: 'place', node: '4,4,4' },
          { type: 'place', node: '4,4,4' },
        ],
      } as unknown as GameExport),
    ).toThrow(/log describes an illegal game: .*already occupied/);
  });
});

describe('importGame — game uuid (S.1)', () => {
  it('lazily mints a fresh uuid for a legacy dump with NO uuid (was never networked)', () => {
    // A dump written before S.1 has no uuid. importGame mints one — a fresh id is
    // correct because such a game was never networked (design §2.2). The result is a
    // valid game whose headHash is self-consistent with the minted uuid.
    const dump = { size: 9, settings: {}, log: [{ type: 'place', node: '4,4,4' }] };
    const g = importGame(dump as unknown as GameExport);
    expect(typeof g.uuid).toBe('string');
    expect(g.uuid.length).toBeGreaterThan(0);
    // The reconstructed headHash is the uuid-seeded chain over the one move: an
    // independently-built game with the SAME minted uuid and the same move matches.
    const ref = new Game(9, g.uuid);
    ref.place([4, 4, 4]);
    expect(headHash(g.log)).toBe(headHash(ref.log));
  });

  it('two legacy dumps (no uuid) mint DISTINCT uuids → distinct headHashes', () => {
    const dump = { size: 9, settings: {}, log: [{ type: 'place', node: '4,4,4' }] };
    const g1 = importGame({ ...dump } as unknown as GameExport);
    const g2 = importGame({ ...dump } as unknown as GameExport);
    expect(g1.uuid).not.toBe(g2.uuid);
    expect(headHash(g1.log)).not.toBe(headHash(g2.log));
  });

  it('preserves an explicit uuid on import (round-trip identity)', () => {
    const dump = {
      uuid: 'carried-uuid',
      size: 9,
      settings: {},
      log: [{ type: 'place', node: '4,4,4' }],
    };
    const g = importGame(dump as unknown as GameExport);
    expect(g.uuid).toBe('carried-uuid');
  });

  it('rejects a present-but-EMPTY uuid (corrupt, not legacy — must not silently mint over it)', () => {
    // A missing uuid is legacy (mint). A present-but-empty uuid is corruption — masking
    // it by minting would hide a broken payload. It must throw, not paper over.
    expect(() =>
      importGame({ uuid: '', size: 9, settings: {}, log: [] } as unknown as GameExport),
    ).toThrow(ExportError);
    expect(() =>
      importGame({ uuid: '', size: 9, settings: {}, log: [] } as unknown as GameExport),
    ).toThrow(/invalid uuid: expected a non-empty string/);
  });

  it('rejects a non-string uuid', () => {
    expect(() =>
      importGame({ uuid: 42, size: 9, settings: {}, log: [] } as unknown as GameExport),
    ).toThrow(/invalid uuid: expected a non-empty string, got 42/);
    expect(() =>
      importGame({ uuid: null, size: 9, settings: {}, log: [] } as unknown as GameExport),
    ).toThrow(ExportError);
  });

  it('the uuid survives the full JSON string round-trip (deserializeGame)', () => {
    const g = scriptedGame();
    const restored = deserializeGame(serializeGame(g));
    expect(restored.uuid).toBe(g.uuid);
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
        expect(restored.uuid).toBe(g.uuid); // uuid stable across serialize round-trip
        expect(headHash(restored.log)).toBe(headHash(g.log));
        expect(restored.state()).toEqual(g.state());
        expect(restored.ply()).toBe(g.ply());
      }),
    );
  });

  it('a minted uuid is stable across a serialize round-trip for a legacy (uuid-less) dump', () => {
    const arbMove = fc.tuple(
      fc.integer({ min: 0, max: 8 }),
      fc.integer({ min: 0, max: 8 }),
      fc.integer({ min: 0, max: 8 }),
    );
    fc.assert(
      fc.property(fc.array(arbMove, { maxLength: 12 }), (moves) => {
        // Build a legacy dump (no uuid) from a set of distinct legal moves.
        const seen = new Set<string>();
        const log: { type: 'place'; node: string }[] = [];
        for (const [x, y, z] of moves) {
          const node = `${x},${y},${z}`;
          if (seen.has(node)) continue;
          seen.add(node);
          log.push({ type: 'place', node });
        }
        const legacy = { size: 9, settings: {}, log } as unknown as GameExport;
        const g = importGame(legacy); // mints a uuid
        // Re-exporting now carries the minted uuid, and re-importing preserves it.
        const g2 = importGame(exportGame(g));
        expect(g2.uuid).toBe(g.uuid);
        expect(headHash(g2.log)).toBe(headHash(g.log));
      }),
    );
  });
});
