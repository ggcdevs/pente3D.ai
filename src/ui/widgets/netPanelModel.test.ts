import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  initialNetPanel,
  setPanelSource,
  setPanelCustom,
  setPanelSaved,
  setPanelRandom,
  deriveNetPanel,
  type NetPanelState,
} from './netPanelModel.ts';
import {
  validateGameCode,
  generateGameCode,
  CODE_ALPHABET,
  CODE_LENGTH,
  CODE_ERROR_TEXT,
} from './netModel.ts';

/**
 * PURE Network-Game-panel view-model tests (Task C.2 — issue #13 picker). Strict, genuine assertions
 * on the exact derived model + each mutation's effect (agent-principles: specific expected values,
 * never "it ran"), with negative cases for every source's invalid-code path (empty custom / no random
 * / no saved chosen / malformed custom), the lossless-switch invariant, and the round-trip that the
 * canonical code the panel hands out is exactly what `setPendingJoinCode`/the C.1 store would accept.
 */

/** A valid CODE_LENGTH code fixture built from the alphabet (no length-specific literal). */
function code(seed: number): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[(seed + i) % CODE_ALPHABET.length];
  return s;
}

describe('initialNetPanel', () => {
  it('starts on the random source with empty custom/saved/random', () => {
    expect(initialNetPanel()).toEqual({
      source: 'random',
      custom: '',
      saved: null,
      random: null,
    });
  });
});

describe('mutations — pure, immutable, lossless', () => {
  it('setPanelSource switches source only, leaving every field untouched', () => {
    const s0: NetPanelState = { source: 'random', custom: 'ABC', saved: 'XYZ234', random: 'AAA234' };
    const s1 = setPanelSource(s0, 'custom');
    expect(s1).toEqual({ source: 'custom', custom: 'ABC', saved: 'XYZ234', random: 'AAA234' });
    // Does not mutate the input.
    expect(s0.source).toBe('random');
  });

  it('setPanelCustom records the text AND selects the custom source', () => {
    const s = setPanelCustom(initialNetPanel(), 'abc234');
    expect(s.custom).toBe('abc234');
    expect(s.source).toBe('custom');
  });

  it('setPanelSaved records the chosen code AND selects the saved source', () => {
    const c = code(0);
    const s = setPanelSaved(initialNetPanel(), c);
    expect(s.saved).toBe(c);
    expect(s.source).toBe('saved');
  });

  it('setPanelRandom records the generated code AND selects the random source', () => {
    const c = code(3);
    const s = setPanelRandom(setPanelSource(initialNetPanel(), 'custom'), c);
    expect(s.random).toBe(c);
    expect(s.source).toBe('random');
  });

  it('switching away from custom and back preserves the typed text (lossless)', () => {
    let s = setPanelCustom(initialNetPanel(), 'MYCODE');
    s = setPanelSource(s, 'saved');
    expect(s.custom).toBe('MYCODE'); // survived the peek at saved
    s = setPanelSource(s, 'custom');
    expect(s.custom).toBe('MYCODE');
  });
});

describe('deriveNetPanel — effective code per source', () => {
  it('custom source → the raw typed text is the effective code', () => {
    const c = code(0);
    const m = deriveNetPanel(setPanelCustom(initialNetPanel(), c), []);
    expect(m.effectiveCode).toBe(c);
    expect(m.source).toBe('custom');
  });

  it('saved source → the chosen saved code is the effective code', () => {
    const c = code(1);
    const m = deriveNetPanel(setPanelSaved(initialNetPanel(), c), [c]);
    expect(m.effectiveCode).toBe(c);
  });

  it('random source → the generated code is the effective code', () => {
    const c = code(2);
    const m = deriveNetPanel(setPanelRandom(initialNetPanel(), c), []);
    expect(m.effectiveCode).toBe(c);
    expect(m.randomCode).toBe(c);
  });

  it('saved source with nothing chosen → empty effective code (buttons disabled)', () => {
    const m = deriveNetPanel(setPanelSource(initialNetPanel(), 'saved'), [code(0)]);
    expect(m.effectiveCode).toBe('');
    expect(m.codeValid).toBe(false);
  });

  it('random source before any code is generated → empty effective code (buttons disabled)', () => {
    const m = deriveNetPanel(initialNetPanel(), []); // random, random === null
    expect(m.effectiveCode).toBe('');
    expect(m.codeValid).toBe(false);
    expect(m.codeError).toBe(CODE_ERROR_TEXT.empty);
  });
});

describe('deriveNetPanel — validation drives button enablement + canonical code', () => {
  it('a valid effective code enables the buttons and yields the CANONICAL code', () => {
    const c = code(0);
    // Lower-cased custom entry — canonicalized to upper-case, exactly what join would accept.
    const m = deriveNetPanel(setPanelCustom(initialNetPanel(), c.toLowerCase()), []);
    expect(m.codeValid).toBe(true);
    expect(m.canonicalCode).toBe(c);
    expect(m.codeError).toBeNull();
    // The canonical code the panel hands out is exactly what validateGameCode accepts (SSOT round-trip).
    expect(validateGameCode(m.effectiveCode)).toEqual({ ok: true, code: m.canonicalCode });
  });

  it('a too-short custom code disables the buttons with the too-short message', () => {
    const m = deriveNetPanel(setPanelCustom(initialNetPanel(), 'ABC'), []);
    expect(m.codeValid).toBe(false);
    expect(m.canonicalCode).toBeNull();
    expect(m.codeError).toBe(CODE_ERROR_TEXT['too-short']);
  });

  it('a bad-chars custom code disables the buttons with the bad-chars message', () => {
    const m = deriveNetPanel(setPanelCustom(initialNetPanel(), 'ABC230'), []); // 0 excluded
    expect(m.codeValid).toBe(false);
    expect(m.canonicalCode).toBeNull();
    expect(m.codeError).toBe(CODE_ERROR_TEXT['bad-chars']);
  });

  it('an empty custom code reports the empty message', () => {
    const m = deriveNetPanel(setPanelCustom(initialNetPanel(), '   '), []);
    expect(m.codeValid).toBe(false);
    expect(m.codeError).toBe(CODE_ERROR_TEXT.empty);
  });
});

describe('deriveNetPanel — saved options', () => {
  it('lists the recent codes verbatim (newest-first from the store), flagging the chosen one', () => {
    const a = code(0);
    const b = code(1);
    const cc = code(2);
    const m = deriveNetPanel(setPanelSaved(initialNetPanel(), b), [a, b, cc]);
    expect(m.savedOptions).toEqual([
      { code: a, selected: false },
      { code: b, selected: true },
      { code: cc, selected: false },
    ]);
  });

  it('no chosen saved code → no option is flagged selected', () => {
    const a = code(0);
    const m = deriveNetPanel(setPanelSource(initialNetPanel(), 'saved'), [a]);
    expect(m.savedOptions).toEqual([{ code: a, selected: false }]);
  });

  it('an empty recent list → no saved options', () => {
    const m = deriveNetPanel(initialNetPanel(), []);
    expect(m.savedOptions).toEqual([]);
  });
});

describe('property: a generated random code always enables the buttons + round-trips (fast-check)', () => {
  it('setPanelRandom(generated) yields a valid, canonical, button-enabling effective code', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 0.9999999, noNaN: true }), {
          minLength: CODE_LENGTH,
          maxLength: CODE_LENGTH * 4,
        }),
        (rands) => {
          let i = 0;
          const generated = generateGameCode(() => rands[i++ % rands.length] ?? 0);
          const m = deriveNetPanel(setPanelRandom(initialNetPanel(), generated), []);
          expect(m.source).toBe('random');
          expect(m.effectiveCode).toBe(generated);
          expect(m.codeValid).toBe(true);
          // A generated code is already canonical, so it round-trips to itself.
          expect(m.canonicalCode).toBe(generated);
          expect(m.codeError).toBeNull();
        },
      ),
    );
  });
});
