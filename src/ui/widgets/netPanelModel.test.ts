import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  initialNetPanel,
  setPanelText,
  chooseRecent,
  removeRecent,
  deriveNetPanel,
} from './netPanelModel.ts';
import {
  validateGameCode,
  generateGameCode,
  CODE_ALPHABET,
  CODE_LENGTH,
  CODE_ERROR_TEXT,
} from './netModel.ts';

/**
 * PURE Network-Game-panel view-model tests (issue #13 / #16 — the game-code combobox). Strict,
 * genuine assertions on the exact derived model + each mutation's effect (agent-principles: specific
 * expected values, never "it ran"), with negative cases: an EMPTY input falls back to the placeholder
 * (buttons enabled); a whitespace-only input likewise; an invalid TYPED code disables the buttons +
 * shows its exact error; removing a recent code drops EXACTLY that one and leaves the rest ordered.
 */

/** A valid CODE_LENGTH code fixture built from the alphabet (no length-specific literal). */
function code(seed: number): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[(seed + i) % CODE_ALPHABET.length];
  return s;
}

/** A fresh always-valid placeholder fixture (what the glue would pass in from generateGameCode). */
const PLACEHOLDER = code(0);

describe('initialNetPanel', () => {
  it('offers the given placeholder + recent list with an empty typed input', () => {
    const recent = [code(1), code(2)];
    expect(initialNetPanel(PLACEHOLDER, recent)).toEqual({
      text: '',
      placeholder: PLACEHOLDER,
      recent,
    });
  });
});

describe('mutations — pure, immutable', () => {
  it('setPanelText records the text, leaving placeholder + recent untouched', () => {
    const s0 = initialNetPanel(PLACEHOLDER, [code(1)]);
    const s1 = setPanelText(s0, 'abc234');
    expect(s1).toEqual({ text: 'abc234', placeholder: PLACEHOLDER, recent: [code(1)] });
    // Does not mutate the input.
    expect(s0.text).toBe('');
  });

  it('chooseRecent fills the typed text from a dropdown code (placeholder + recent untouched)', () => {
    const c = code(3);
    const s0 = initialNetPanel(PLACEHOLDER, [c]);
    const s1 = chooseRecent(s0, c);
    expect(s1.text).toBe(c);
    expect(s1.placeholder).toBe(PLACEHOLDER);
    expect(s1.recent).toEqual([c]);
    expect(s0.text).toBe(''); // input untouched
  });

  it('removeRecent drops EXACTLY the one matching code, keeping the rest in order', () => {
    const a = code(0);
    const b = code(5);
    const c = code(10);
    const s0 = initialNetPanel(PLACEHOLDER, [a, b, c]);
    const s1 = removeRecent(s0, b);
    expect(s1.recent).toEqual([a, c]);
    // The others are untouched and the input is unchanged.
    expect(s1.text).toBe('');
    expect(s1.placeholder).toBe(PLACEHOLDER);
    // Immutable: the original list survives.
    expect(s0.recent).toEqual([a, b, c]);
  });

  it('removeRecent of an absent code leaves the list unchanged', () => {
    const a = code(0);
    const b = code(5);
    const s1 = removeRecent(initialNetPanel(PLACEHOLDER, [a, b]), code(20));
    expect(s1.recent).toEqual([a, b]);
  });
});

describe('deriveNetPanel — effective code = typed || placeholder', () => {
  it('an empty input uses the placeholder as the effective code', () => {
    const m = deriveNetPanel(initialNetPanel(PLACEHOLDER, []));
    expect(m.effectiveCode).toBe(PLACEHOLDER);
    // The placeholder is always valid → buttons enabled with no error.
    expect(m.codeValid).toBe(true);
    expect(m.canonicalCode).toBe(PLACEHOLDER);
    expect(m.codeError).toBeNull();
  });

  it('a whitespace-only input still falls back to the placeholder', () => {
    const m = deriveNetPanel(setPanelText(initialNetPanel(PLACEHOLDER, []), '   '));
    expect(m.effectiveCode).toBe(PLACEHOLDER);
    expect(m.codeValid).toBe(true);
  });

  it('typed text (trimmed) overrides the placeholder as the effective code', () => {
    const typed = code(4);
    const m = deriveNetPanel(setPanelText(initialNetPanel(PLACEHOLDER, []), `  ${typed}  `));
    expect(m.effectiveCode).toBe(typed);
    expect(m.effectiveCode).not.toBe(PLACEHOLDER);
  });

  it('exposes the raw typed text + placeholder verbatim for the input to render', () => {
    const m = deriveNetPanel(setPanelText(initialNetPanel(PLACEHOLDER, []), 'ab'));
    expect(m.text).toBe('ab');
    expect(m.placeholder).toBe(PLACEHOLDER);
  });
});

describe('deriveNetPanel — validation drives button enablement + canonical code', () => {
  it('a valid typed code (lower-cased) enables the buttons and yields the CANONICAL code', () => {
    const c = code(0);
    const m = deriveNetPanel(setPanelText(initialNetPanel(PLACEHOLDER, []), c.toLowerCase()));
    expect(m.codeValid).toBe(true);
    expect(m.canonicalCode).toBe(c);
    expect(m.codeError).toBeNull();
    // The canonical code the panel hands out is exactly what validateGameCode accepts (SSOT round-trip).
    expect(validateGameCode(m.effectiveCode)).toEqual({ ok: true, code: m.canonicalCode });
  });

  it('a too-short typed code disables the buttons with the too-short message', () => {
    const m = deriveNetPanel(setPanelText(initialNetPanel(PLACEHOLDER, []), 'ABC'));
    expect(m.codeValid).toBe(false);
    expect(m.canonicalCode).toBeNull();
    expect(m.codeError).toBe(CODE_ERROR_TEXT['too-short']);
  });

  it('a bad-chars typed code disables the buttons with the bad-chars message', () => {
    const m = deriveNetPanel(setPanelText(initialNetPanel(PLACEHOLDER, []), 'ABC230')); // 0 excluded
    expect(m.codeValid).toBe(false);
    expect(m.canonicalCode).toBeNull();
    expect(m.codeError).toBe(CODE_ERROR_TEXT['bad-chars']);
  });
});

describe('deriveNetPanel — recent rows', () => {
  it('lists the recent codes verbatim (newest-first from the store), one row each', () => {
    const a = code(0);
    const b = code(5);
    const c = code(10);
    const m = deriveNetPanel(initialNetPanel(PLACEHOLDER, [a, b, c]));
    expect(m.recentRows).toEqual([{ code: a }, { code: b }, { code: c }]);
  });

  it('an empty recent list → no dropdown rows', () => {
    const m = deriveNetPanel(initialNetPanel(PLACEHOLDER, []));
    expect(m.recentRows).toEqual([]);
  });

  it('reflects a removeRecent by dropping the row', () => {
    const a = code(0);
    const b = code(5);
    const s = removeRecent(initialNetPanel(PLACEHOLDER, [a, b]), a);
    expect(deriveNetPanel(s).recentRows).toEqual([{ code: b }]);
  });
});

describe('property: a generated placeholder with an empty input always enables the buttons (fast-check)', () => {
  it('effective = placeholder, valid, canonical round-trips (fast-check)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 0.9999999, noNaN: true }), {
          minLength: CODE_LENGTH,
          maxLength: CODE_LENGTH * 4,
        }),
        (rands) => {
          let i = 0;
          const placeholder = generateGameCode(() => rands[i++ % rands.length] ?? 0);
          const m = deriveNetPanel(initialNetPanel(placeholder, []));
          expect(m.effectiveCode).toBe(placeholder);
          expect(m.codeValid).toBe(true);
          // A generated code is already canonical, so it round-trips to itself.
          expect(m.canonicalCode).toBe(placeholder);
          expect(m.codeError).toBeNull();
        },
      ),
    );
  });

  it('any typed valid code overrides the placeholder and round-trips (fast-check)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 0.9999999, noNaN: true }), {
          minLength: CODE_LENGTH,
          maxLength: CODE_LENGTH * 4,
        }),
        (rands) => {
          let i = 0;
          const typed = generateGameCode(() => rands[i++ % rands.length] ?? 0);
          const m = deriveNetPanel(setPanelText(initialNetPanel(PLACEHOLDER, []), typed));
          expect(m.effectiveCode).toBe(typed);
          expect(m.codeValid).toBe(true);
          expect(m.canonicalCode).toBe(typed);
        },
      ),
    );
  });
});
