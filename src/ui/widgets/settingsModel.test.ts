import { describe, it, expect } from 'vitest';
import {
  deriveSettings,
  boardSizePatch,
  presetPatch,
  colorPatch,
  opacityPatch,
  BOARD_SIZE_OPTIONS,
  COLOR_FIELDS,
  OPACITY_FIELD_KEY,
  RESET_SECTIONS,
  SETTINGS_SCOPE_ID,
  OPEN_SETTINGS_COMMAND,
  type SettingsSources,
} from './settingsModel.ts';

/**
 * PURE settings view-model tests (Task 5.4) — strict unit + mutation gate. Genuine assertions on
 * the exact derived model and on each normalizer's accept/REJECT decision (agent-principles:
 * specific expected values, never "it ran"), with negative cases for every validity rule (bad
 * board size, unknown preset, malformed colour, out-of-range opacity). The DOM/scope/config-write
 * wiring is proven separately by Playwright.
 */

/** A representative sources bag mirroring the tracked defaults (board 5, fusion360 preset). */
function sources(overrides: Partial<SettingsSources> = {}): SettingsSources {
  return {
    board: { size: 5 },
    colors: {
      background: '#101014',
      emptySphere: '#5a5a66',
      whitePiece: '#f0f0f0',
      blackPiece: '#1a1a1a',
      tempPiece: '#4a90d9',
      lineOrthogonal: '#3a6ea5',
      lineFaceDiagonal: '#a5843a',
      lineSpaceDiagonal: '#8a3aa5',
      hoverHighlight: '#ffd24a',
      winningLine: '#4aff7a',
      lineOpacity: 0.35,
    },
    controls: {
      preset: 'fusion360',
      presets: { fusion360: {}, trackpad: {}, web: {} },
    },
    keybindings: { u: 'undo', r: 'redo', o: 'toggleOrthogonal' },
    ...overrides,
  };
}

describe('deriveSettings — board size options', () => {
  it('offers exactly BOARD_SIZE_OPTIONS with the current size marked selected', () => {
    const model = deriveSettings(sources({ board: { size: 9 } }));
    expect(model.boardSizeOptions.map((o) => o.value)).toEqual([...BOARD_SIZE_OPTIONS]);
    expect(model.boardSizeOptions.filter((o) => o.selected).map((o) => o.value)).toEqual([9]);
  });

  it('marks the size-5 default selected (concrete, not just "some option")', () => {
    const model = deriveSettings(sources({ board: { size: 5 } }));
    const selected = model.boardSizeOptions.find((o) => o.selected);
    expect(selected).toEqual({ value: 5, selected: true });
  });

  it('selects NO option when the stored size is not offered (never invents a selection)', () => {
    const model = deriveSettings(sources({ board: { size: 6 } }));
    expect(model.boardSizeOptions.some((o) => o.selected)).toBe(false);
  });
});

describe('deriveSettings — control preset options', () => {
  it('lists the configured preset ids sorted, with the active one selected', () => {
    const model = deriveSettings(sources());
    expect(model.presetOptions.map((o) => o.value)).toEqual(['fusion360', 'trackpad', 'web']);
    expect(model.presetOptions.filter((o) => o.selected).map((o) => o.value)).toEqual([
      'fusion360',
    ]);
  });

  it('marks trackpad selected when it is the active preset', () => {
    const model = deriveSettings(
      sources({ controls: { preset: 'trackpad', presets: { fusion360: {}, trackpad: {}, web: {} } } }),
    );
    expect(model.presetOptions.find((o) => o.selected)).toEqual({
      value: 'trackpad',
      selected: true,
    });
  });

  it('orders preset ids lexicographically regardless of object key order', () => {
    // Authored web-first; the sort must still yield fusion360, trackpad, web.
    const model = deriveSettings(
      sources({ controls: { preset: 'web', presets: { web: {}, fusion360: {}, trackpad: {} } } }),
    );
    expect(model.presetOptions.map((o) => o.value)).toEqual(['fusion360', 'trackpad', 'web']);
  });
});

describe('COLOR_FIELDS roster (the SSOT for the colour form)', () => {
  it('is exactly these keys in this order (literal, not self-referential)', () => {
    // Asserted against literals — NOT `COLOR_FIELDS.map(...)` — so a mutated key/label in the
    // constant is caught here rather than comparing the constant to itself (agent-principles:
    // never assert a value equals the same literal you fed in).
    expect(COLOR_FIELDS.map((f) => f.key)).toEqual([
      'background',
      'emptySphere',
      'whitePiece',
      'blackPiece',
      'tempPiece',
      'lineOrthogonal',
      'lineFaceDiagonal',
      'lineSpaceDiagonal',
      'hoverHighlight',
      'winningLine',
    ]);
  });

  it('pairs each key with its exact human label (kills a blanked-label mutant)', () => {
    expect(COLOR_FIELDS.map((f) => f.label)).toEqual([
      'Background',
      'Empty marker',
      'White piece',
      'Black piece',
      'Preview piece',
      'Orthogonal lines',
      'Face-diagonal lines',
      'Space-diagonal lines',
      'Hover highlight',
      'Winning line',
    ]);
  });
});

describe('deriveSettings — colour + opacity fields', () => {
  it('projects every colour field in order with its current value (literal keys)', () => {
    const model = deriveSettings(sources());
    // Literal expected keys — independent of the COLOR_FIELDS constant, so a mutated key in the
    // roster changes the derived output but NOT this expectation, and the test fails (kills the
    // `key: ''` mutant that a `map(COLOR_FIELDS.key)` comparison would let survive).
    expect(model.colorFields.map((f) => f.key)).toEqual([
      'background',
      'emptySphere',
      'whitePiece',
      'blackPiece',
      'tempPiece',
      'lineOrthogonal',
      'lineFaceDiagonal',
      'lineSpaceDiagonal',
      'hoverHighlight',
      'winningLine',
    ]);
    // Every label is carried through verbatim (kills the label mutants for the derivation).
    expect(model.colorFields.map((f) => f.label)).toEqual([
      'Background',
      'Empty marker',
      'White piece',
      'Black piece',
      'Preview piece',
      'Orthogonal lines',
      'Face-diagonal lines',
      'Space-diagonal lines',
      'Hover highlight',
      'Winning line',
    ]);
    const bg = model.colorFields.find((f) => f.key === 'background');
    expect(bg).toEqual({ key: 'background', label: 'Background', value: '#101014' });
    const win = model.colorFields.find((f) => f.key === 'winningLine');
    expect(win).toEqual({ key: 'winningLine', label: 'Winning line', value: '#4aff7a' });
  });

  it('does not surface the opacity key among the colour fields', () => {
    const model = deriveSettings(sources());
    expect(model.colorFields.some((f) => f.key === OPACITY_FIELD_KEY)).toBe(false);
  });

  it('carries lineOpacity as a number in the opacity field', () => {
    const model = deriveSettings(sources());
    expect(model.opacityField).toEqual({
      key: OPACITY_FIELD_KEY,
      label: 'Line opacity',
      value: 0.35,
    });
  });
});

describe('deriveSettings — keybinding rows', () => {
  it('lists keybindings sorted by command id then key (not object key order)', () => {
    // Authored u/r/o; sorted by commandId: redo, toggleOrthogonal, undo.
    const model = deriveSettings(sources());
    expect(model.keybindingRows).toEqual([
      { key: 'r', commandId: 'redo' },
      { key: 'o', commandId: 'toggleOrthogonal' },
      { key: 'u', commandId: 'undo' },
    ]);
  });

  it('breaks a command-id tie by key (deterministic)', () => {
    // Two chords bound to the same command; the key tiebreak orders them a before z.
    const model = deriveSettings(
      sources({ keybindings: { z: 'undo', a: 'undo' } }),
    );
    expect(model.keybindingRows).toEqual([
      { key: 'a', commandId: 'undo' },
      { key: 'z', commandId: 'undo' },
    ]);
  });

  it('yields an empty row list for an empty keybindings map', () => {
    const model = deriveSettings(sources({ keybindings: {} }));
    expect(model.keybindingRows).toEqual([]);
  });
});

describe('boardSizePatch — accept + reject', () => {
  it('accepts an offered size, coercing the string to a number', () => {
    expect(boardSizePatch('9')).toEqual({ size: 9 });
  });

  it('rejects a size not in BOARD_SIZE_OPTIONS', () => {
    expect(boardSizePatch('6')).toBeNull();
    expect(boardSizePatch('12')).toBeNull();
  });

  it('rejects a non-integer / non-numeric value', () => {
    expect(boardSizePatch('9.5')).toBeNull();
    expect(boardSizePatch('abc')).toBeNull();
    expect(boardSizePatch('')).toBeNull();
  });
});

describe('presetPatch — accept + reject', () => {
  const available = ['fusion360', 'trackpad', 'web'];

  it('accepts a configured preset id', () => {
    expect(presetPatch('trackpad', available)).toEqual({ preset: 'trackpad' });
  });

  it('rejects an id that is not among the available presets', () => {
    expect(presetPatch('joystick', available)).toBeNull();
    expect(presetPatch('', available)).toBeNull();
  });
});

describe('colorPatch — accept + reject', () => {
  it('accepts a #rrggbb colour and lower-cases it for a canonical stored form', () => {
    expect(colorPatch('background', '#ABCDEF')).toEqual({ background: '#abcdef' });
    expect(colorPatch('whitePiece', '#f0f0f0')).toEqual({ whitePiece: '#f0f0f0' });
  });

  it('rejects a malformed colour (short, missing #, non-hex)', () => {
    expect(colorPatch('background', '#fff')).toBeNull();
    expect(colorPatch('background', 'fff000')).toBeNull();
    expect(colorPatch('background', '#gggggg')).toBeNull();
    // Trailing junk — a valid colour with extra chars after the 6 hex. Kills a dropped `$` anchor
    // (without `$` the regex would match the `#123456` prefix and wrongly accept this).
    expect(colorPatch('background', '#1234567')).toBeNull();
    expect(colorPatch('background', '')).toBeNull();
  });

  it('rejects a valid colour preceded by junk (kills a dropped ^ anchor)', () => {
    // Without the leading `^`, the regex would find `#abcdef` anywhere in the string and wrongly
    // accept this. The anchor forces the match to START at the string's beginning.
    expect(colorPatch('background', 'x#abcdef')).toBeNull();
    expect(colorPatch('background', '  #abcdef')).toBeNull();
  });
});

describe('opacityPatch — accept + reject', () => {
  it('accepts a finite value in 0..1 inclusive at both ends', () => {
    expect(opacityPatch('0')).toEqual({ lineOpacity: 0 });
    expect(opacityPatch('1')).toEqual({ lineOpacity: 1 });
    expect(opacityPatch('0.35')).toEqual({ lineOpacity: 0.35 });
  });

  it('rejects a value below 0 or above 1', () => {
    expect(opacityPatch('-0.1')).toBeNull();
    expect(opacityPatch('1.5')).toBeNull();
  });

  it('rejects a non-finite / non-numeric value', () => {
    expect(opacityPatch('NaN')).toBeNull();
    expect(opacityPatch('Infinity')).toBeNull();
    expect(opacityPatch('abc')).toBeNull();
  });
});

describe('exported constants', () => {
  it('SETTINGS_SCOPE_ID is the stable "settings" scope id the modal pushes', () => {
    expect(SETTINGS_SCOPE_ID).toBe('settings');
  });

  it('OPEN_SETTINGS_COMMAND matches the menu entry the design wires (openSettings)', () => {
    expect(OPEN_SETTINGS_COMMAND).toBe('openSettings');
  });

  it('RESET_SECTIONS is exactly the sections the modal owns (board/colors/controls/keybindings)', () => {
    expect([...RESET_SECTIONS]).toEqual(['board', 'colors', 'controls', 'keybindings']);
  });
});
