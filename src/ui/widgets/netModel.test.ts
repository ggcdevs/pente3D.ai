import { describe, it, expect } from 'vitest';
import {
  deriveNet,
  validateGameCode,
  normalizeGameCode,
  generateGameCode,
  HOST_GAME_COMMAND,
  JOIN_GAME_COMMAND,
  CODE_ALPHABET,
  CODE_LENGTH,
  CODE_ERROR_TEXT,
  type NetSessionState,
} from './netModel.ts';

/**
 * PURE networking view-model tests (Task 5.5) — strict unit + mutation gate. Genuine assertions on
 * the exact derived model and on each validity rule's accept/REJECT decision (agent-principles:
 * specific expected values, never "it ran"), with negative cases for every rule (empty / too-short
 * / bad-character code; each phase's panel + status text; the seat/conflict/join-error branches).
 * The DOM/dispatch/session wiring is proven separately by Playwright.
 */

/** A representative offline state; overrides let each test vary one field. */
function state(overrides: Partial<NetSessionState> = {}): NetSessionState {
  return {
    phase: 'offline',
    code: null,
    seat: null,
    peerPresent: false,
    joinError: null,
    ...overrides,
  };
}

describe('deriveNet — panel selection', () => {
  it('offline → the Host/Join controls panel', () => {
    expect(deriveNet(state({ phase: 'offline' })).panel).toBe('controls');
  });

  it('connecting → the status panel', () => {
    expect(deriveNet(state({ phase: 'connecting' })).panel).toBe('status');
  });

  it('connected → the status panel', () => {
    expect(deriveNet(state({ phase: 'connected' })).panel).toBe('status');
  });

  it('conflict → the conflict panel', () => {
    expect(deriveNet(state({ phase: 'conflict' })).panel).toBe('conflict');
  });
});

describe('deriveNet — status text per phase', () => {
  it('offline shows NO status text (issue #16 removed the board hint — no advertisement)', () => {
    expect(deriveNet(state({ phase: 'offline' })).statusText).toBe('');
  });

  it('connecting shows a connecting message', () => {
    expect(deriveNet(state({ phase: 'connecting' })).statusText).toBe('Connecting…');
  });

  it('connected with the peer present announces the opponent', () => {
    expect(deriveNet(state({ phase: 'connected', peerPresent: true })).statusText).toBe(
      'Opponent connected',
    );
  });

  it('connected without the peer waits for the opponent', () => {
    expect(deriveNet(state({ phase: 'connected', peerPresent: false })).statusText).toBe(
      'Waiting for opponent…',
    );
  });

  it('conflict shows a stopped-by-conflict message', () => {
    expect(deriveNet(state({ phase: 'conflict' })).statusText).toBe('Game stopped by a conflict.');
  });
});

describe('deriveNet — seat label', () => {
  it('white seat → "You are White"', () => {
    expect(deriveNet(state({ phase: 'connected', seat: 'white' })).seatText).toBe('You are White');
  });

  it('black seat → "You are Black"', () => {
    expect(deriveNet(state({ phase: 'connected', seat: 'black' })).seatText).toBe('You are Black');
  });

  it('no seat → null (no label invented)', () => {
    expect(deriveNet(state({ phase: 'connecting', seat: null })).seatText).toBeNull();
  });
});

describe('deriveNet — conflict banner', () => {
  it('is shown with a message only in the conflict phase', () => {
    const m = deriveNet(state({ phase: 'conflict' }));
    expect(m.conflict).toBe(true);
    expect(m.conflictText).toBe(
      'Game stopped: the two histories diverged. The game has been saved for review.',
    );
  });

  it('is hidden (message null) in every non-conflict phase', () => {
    for (const phase of ['offline', 'connecting', 'connected'] as const) {
      const m = deriveNet(state({ phase }));
      expect(m.conflict).toBe(false);
      expect(m.conflictText).toBeNull();
    }
  });
});

describe('deriveNet — code + join error passthrough', () => {
  it('passes the game code through verbatim', () => {
    expect(deriveNet(state({ phase: 'connected', code: 'ABC234' })).code).toBe('ABC234');
  });

  it('shows null code while offline', () => {
    expect(deriveNet(state({ phase: 'offline', code: null })).code).toBeNull();
  });

  it('maps a room-full join error to its human label', () => {
    expect(deriveNet(state({ joinError: 'room-full' })).joinErrorText).toBe(
      'That room already has two players.',
    );
  });

  it('maps a seat-reserved join error to its OWN human label (not collapsed to room-full)', () => {
    // design §7: every reject reason surfaces a human message; seat-reserved is DISTINCT from
    // room-full, so its label must differ (the two are the scenario-1-vs-5 distinction).
    const text = deriveNet(state({ joinError: 'seat-reserved' })).joinErrorText;
    expect(text).toBe('A seat there is being held for a player who stepped away. Try again later.');
    expect(text).not.toBe(deriveNet(state({ joinError: 'room-full' })).joinErrorText);
  });

  it('maps a game-mismatch join error to its human label', () => {
    expect(deriveNet(state({ joinError: 'game-mismatch' })).joinErrorText).toBe(
      'You and the other player brought different games.',
    );
  });

  it('maps a game-divergent join error to its human label', () => {
    expect(deriveNet(state({ joinError: 'game-divergent' })).joinErrorText).toBe(
      'That game has diverged from yours and can’t be joined yet.',
    );
  });

  it('maps a connect-failed join error to its human label', () => {
    expect(deriveNet(state({ joinError: 'connect-failed' })).joinErrorText).toBe(
      'Could not connect. Check the code and try again.',
    );
  });

  it('shows no join error when there is none', () => {
    expect(deriveNet(state({ joinError: null })).joinErrorText).toBeNull();
  });
});

describe('normalizeGameCode', () => {
  it('trims surrounding whitespace and upper-cases', () => {
    expect(normalizeGameCode('  ab2 ')).toBe('AB2');
  });

  it('leaves an already-canonical code unchanged', () => {
    expect(normalizeGameCode('ABC234')).toBe('ABC234');
  });
});

describe('validateGameCode — accepts', () => {
  it('accepts a well-formed 6-char code and returns its canonical form', () => {
    expect(validateGameCode('abc234')).toEqual({ ok: true, code: 'ABC234' });
  });

  it('accepts a padded, lower-cased paste (canonicalized, not rejected)', () => {
    expect(validateGameCode('  abc234  ')).toEqual({ ok: true, code: 'ABC234' });
  });
});

describe('validateGameCode — rejects (negative cases, in precedence order)', () => {
  it('rejects an empty string as empty', () => {
    expect(validateGameCode('')).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects a whitespace-only string as empty (not too-short)', () => {
    expect(validateGameCode('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects a short-but-clean code as too-short (length before charset)', () => {
    expect(validateGameCode('ABC')).toEqual({ ok: false, reason: 'too-short' });
  });

  it('rejects a full-length code containing an ambiguous/excluded glyph as bad-chars', () => {
    // `0` and `O` are excluded from CODE_ALPHABET; a 6-char code with `0` is length-valid but
    // charset-invalid, so it must reach the bad-chars rule (not too-short).
    expect(validateGameCode('ABC230')).toEqual({ ok: false, reason: 'bad-chars' });
  });

  it('rejects a full-length code with punctuation as bad-chars', () => {
    expect(validateGameCode('ABC-23')).toEqual({ ok: false, reason: 'bad-chars' });
  });

  it('a code one short of the length is too-short even if every char is legal', () => {
    expect(validateGameCode('ABCDE')).toEqual({ ok: false, reason: 'too-short' });
    expect('ABCDE'.length).toBe(CODE_LENGTH - 1);
  });
});

describe('generateGameCode', () => {
  it('draws index 0 for rand()===0 → the first alphabet char, CODE_LENGTH times', () => {
    const code = generateGameCode(() => 0);
    expect(code).toBe(CODE_ALPHABET.charAt(0).repeat(CODE_LENGTH));
    expect(code.length).toBe(CODE_LENGTH);
  });

  it('draws the LAST index for a rand at the top of the range', () => {
    // A value just under 1 maps to the last index via floor; assert the exact last char.
    const nearlyOne = (CODE_ALPHABET.length - 1) / CODE_ALPHABET.length + 0.001;
    const last = CODE_ALPHABET.charAt(CODE_ALPHABET.length - 1);
    expect(generateGameCode(() => nearlyOne)).toBe(last.repeat(CODE_LENGTH));
  });

  it('clamps a contract-violating rand()===1 to the last index (never undefined)', () => {
    const last = CODE_ALPHABET.charAt(CODE_ALPHABET.length - 1);
    const code = generateGameCode(() => 1);
    expect(code).toBe(last.repeat(CODE_LENGTH));
    expect(code).not.toContain('undefined');
  });

  it('produces distinct chars from a varying rng and always a valid code', () => {
    // A sequence that steps across the alphabet — proves the mapping is index-sensitive (not a
    // constant), and that a generated code round-trips through validateGameCode.
    let n = 0;
    const seq = () => {
      const v = (n * 0.137) % 1;
      n += 1;
      return v;
    };
    const code = generateGameCode(seq);
    expect(code.length).toBe(CODE_LENGTH);
    expect(validateGameCode(code)).toEqual({ ok: true, code });
    // Not all identical (the varying rng exercised more than one index).
    expect(new Set(code).size).toBeGreaterThan(1);
  });
});

describe('constants', () => {
  it('exposes the stable host/join command ids', () => {
    expect(HOST_GAME_COMMAND).toBe('hostGame');
    expect(JOIN_GAME_COMMAND).toBe('joinGame');
  });

  it('the code alphabet excludes the ambiguous glyphs 0/O/1/I/L', () => {
    for (const ch of ['0', 'O', '1', 'I', 'L']) {
      expect(CODE_ALPHABET).not.toContain(ch);
    }
  });

  it('every CodeError reason has a human label', () => {
    expect(Object.keys(CODE_ERROR_TEXT).sort()).toEqual(['bad-chars', 'empty', 'too-short']);
    for (const text of Object.values(CODE_ERROR_TEXT)) {
      expect(text.length).toBeGreaterThan(0);
    }
  });
});
