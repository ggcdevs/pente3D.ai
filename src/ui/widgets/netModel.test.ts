import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
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
  JOIN_ERROR_REASONS,
  type JoinErrorReason,
  type NetSessionState,
} from './netModel.ts';

/**
 * PURE networking view-model tests (Task 5.5) — strict unit + mutation gate. Genuine assertions on
 * the exact derived model and on each validity rule's accept/REJECT decision (agent-principles:
 * specific expected values, never "it ran"), with negative cases for every rule (empty / too-short
 * / bad-character code; each phase's panel; the conflict/join-error branches).
 *
 * Issue #44 REMOVED the derived `statusText`/`seatText` sentences from the model (the compact presence
 * HUD shows connection/seat structurally — dots + "(You)" — off the raw session state, not strings);
 * a guard test below pins that the model no longer carries those keys so a re-introduction is caught.
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

describe('deriveNet — model shape (issue #44 trim)', () => {
  it('does NOT carry the removed statusText/seatText sentence fields', () => {
    // The compact presence HUD reflects connection/seat structurally off the raw session state, so
    // the pure model no longer derives those strings. Assert they are absent — a re-introduction of a
    // dead field is caught here (agent-principles: no genuinely-dead fields).
    const m = deriveNet(state({ phase: 'connected', seat: 'white', peerPresent: true }));
    expect(m).not.toHaveProperty('statusText');
    expect(m).not.toHaveProperty('seatText');
    // The kept fields are exactly these five.
    expect(Object.keys(m).sort()).toEqual(
      ['code', 'conflict', 'conflictText', 'joinErrorText', 'panel'].sort(),
    );
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

  it('maps a seed-refused join error to its OWN human label naming the seed rule (design §3)', () => {
    // The refusal a player is most likely to meet (#46: "New game" vs the other device's board), so the
    // copy must say WHAT clashed and WHAT to pick instead — and must not read like the identity-level
    // game-mismatch, which is a different fact.
    const text = deriveNet(state({ joinError: 'seed-refused' })).joinErrorText;
    expect(text).toBe(
      'One of you chose New game and the other brought an existing game. Pick the same game, or choose Dealer’s choice to take theirs.',
    );
    expect(text).not.toBe(deriveNet(state({ joinError: 'game-mismatch' })).joinErrorText);
  });

  it('maps a seed-unreadable join error to its OWN label (a LOCAL failure, not a peer refusal)', () => {
    // V.2 (carried from the V.1 review): a seed whose archived log is corrupt used to leave the panel
    // silent. It now has its own message, distinct from connect-failed — nothing failed to connect.
    const text = deriveNet(state({ joinError: 'seed-unreadable' })).joinErrorText;
    expect(text).toBe('That saved game could not be read — it may be damaged. Try another game.');
    expect(text).not.toBe(deriveNet(state({ joinError: 'connect-failed' })).joinErrorText);
  });

  it('maps a seed-unavailable join error to its OWN label (the game is not on this device)', () => {
    // V.2 round 2: a `resume`/`current` seed for a game this browser does not hold used to degrade to a
    // fresh game while still announcing the named one — and the refusal that caused downstream read
    // "You and the other player brought different games", which was false. Its own reason, its own copy.
    const text = deriveNet(state({ joinError: 'seed-unavailable' })).joinErrorText;
    expect(text).toBe('That game is not saved on this device. Pick another, or choose Dealer’s choice.');
    expect(text).not.toBe(deriveNet(state({ joinError: 'game-mismatch' })).joinErrorText);
    expect(text).not.toBe(deriveNet(state({ joinError: 'seed-unreadable' })).joinErrorText);
  });

  it('gives EVERY join-error reason a distinct, non-empty human message', () => {
    // design §7: no reason may reach the panel with no message (the Record type makes that a compile
    // error) — and none may silently share another's copy, which would mislabel the failure.
    //
    // Enumerated from the model's OWN exported reason set, NOT a hand-copied list: a reason added to the
    // union is covered here the moment it exists, instead of quietly falling outside a list that has
    // stopped matching (agent-principles #8 — no second copy of a fact that can go stale).
    const reasons: readonly JoinErrorReason[] = JOIN_ERROR_REASONS;
    expect(reasons.length).toBeGreaterThan(0);
    const texts = reasons.map((r) => deriveNet(state({ joinError: r })).joinErrorText);
    for (const t of texts) expect(t).toMatch(/\S/);
    expect(new Set(texts).size).toBe(reasons.length);
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

  // issue #30: the full A-Z0-9 alphabet is legal for a CUSTOM code — the earlier ambiguity
  // exclusions (0/1/I/L/O) no longer reject a user-chosen code. Digits and every letter accepted.
  it('accepts a code containing digits (regression: TEST12 was rejected on the "1"/"2")', () => {
    expect(validateGameCode('TEST12')).toEqual({ ok: true, code: 'TEST12' });
  });

  it('accepts a code containing the formerly-excluded letters O and L', () => {
    expect(validateGameCode('TESTOL')).toEqual({ ok: true, code: 'TESTOL' });
  });

  it('accepts the formerly-ambiguous glyphs 0/1/I/L/O all in one code', () => {
    expect(validateGameCode('O0IL1O')).toEqual({ ok: true, code: 'O0IL1O' });
  });

  it('uppercase-normalizes a lower-case custom code (test12 → TEST12)', () => {
    expect(validateGameCode('test12')).toEqual({ ok: true, code: 'TEST12' });
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

  it('rejects a full-length code containing a space as bad-chars', () => {
    // A space is not alphanumeric; a 6-char code with an interior space is length-valid but
    // charset-invalid, so it must reach the bad-chars rule (not too-short). (issue #30)
    expect(validateGameCode('TEST 1')).toEqual({ ok: false, reason: 'bad-chars' });
  });

  it('rejects a full-length code with punctuation as bad-chars', () => {
    expect(validateGameCode('TEST-1')).toEqual({ ok: false, reason: 'bad-chars' });
    expect(validateGameCode('TEST_1')).toEqual({ ok: false, reason: 'bad-chars' });
    expect(validateGameCode('TES#12')).toEqual({ ok: false, reason: 'bad-chars' });
  });

  it('a code one short of the length is too-short even if every char is legal', () => {
    expect(validateGameCode('ABCDE')).toEqual({ ok: false, reason: 'too-short' });
    expect('ABCDE'.length).toBe(CODE_LENGTH - 1);
  });
});

describe('validateGameCode — properties (fast-check)', () => {
  // Any CODE_LENGTH-long string drawn from the full A-Z0-9 alphabet (in either case, with padding)
  // is ACCEPTED and round-trips to its upper-cased, trimmed form. This pins the #30 policy across
  // the whole alphabet, not just the hand-picked literals above — including every digit and the
  // formerly-excluded 0/1/I/L/O.
  const alnumChar = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''));
  it('accepts every full-length alphanumeric code and canonicalizes it (upper + trim)', () => {
    fc.assert(
      fc.property(
        fc.array(alnumChar, { minLength: CODE_LENGTH, maxLength: CODE_LENGTH }),
        fc.constantFrom('', ' ', '  '),
        fc.constantFrom('', ' ', '  '),
        (chars, padL, padR) => {
          const raw = padL + chars.join('') + padR;
          const canonical = chars.join('').toUpperCase();
          expect(validateGameCode(raw)).toEqual({ ok: true, code: canonical });
        },
      ),
    );
  });

  // Any full-length code with an INTERIOR non-alphanumeric char is REJECTED as bad-chars. The bad
  // char is placed strictly between two good chars so it survives the leading/trailing trim (a
  // leading/trailing space is trimmed away and correctly reported as too-short, not bad-chars —
  // covered by its own case below).
  it('rejects a full-length code with an interior non-alphanumeric character as bad-chars', () => {
    const badChar = fc.constantFrom(...' -_!@#$%.,/*+?'.split(''));
    fc.assert(
      fc.property(
        fc.array(alnumChar, { minLength: CODE_LENGTH - 1, maxLength: CODE_LENGTH - 1 }),
        badChar,
        fc.integer({ min: 1, max: CODE_LENGTH - 2 }), // interior only (never index 0 or the last)
        (goodChars, bad, pos) => {
          const arr = goodChars.slice();
          arr.splice(pos, 0, bad);
          expect(validateGameCode(arr.join(''))).toEqual({ ok: false, reason: 'bad-chars' });
        },
      ),
    );
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

  it('the code alphabet is the full A-Z0-9 set — INCLUDES the formerly-excluded 0/O/1/I/L (issue #30)', () => {
    for (const ch of ['0', 'O', '1', 'I', 'L']) {
      expect(CODE_ALPHABET).toContain(ch);
    }
    // Every uppercase letter and every digit is present, and nothing else is.
    const expected = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    expect([...CODE_ALPHABET].sort().join('')).toBe([...expected].sort().join(''));
    expect(CODE_ALPHABET.length).toBe(36);
  });

  it('every CodeError reason has a human label', () => {
    expect(Object.keys(CODE_ERROR_TEXT).sort()).toEqual(['bad-chars', 'empty', 'too-short']);
    for (const text of Object.values(CODE_ERROR_TEXT)) {
      expect(text.length).toBeGreaterThan(0);
    }
  });
});
