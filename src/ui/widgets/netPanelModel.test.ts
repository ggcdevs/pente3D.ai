import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  initialNetPanel,
  setPanelText,
  chooseRecent,
  removeRecent,
  setSeedKind,
  chooseResume,
  deriveNetPanel,
  DEFAULT_SEED_KIND,
  SEED_LABEL,
  SEED_ORDER,
  type SeedGame,
  type SeedKind,
  type SeedSources,
} from './netPanelModel.ts';
import {
  validateGameCode,
  generateGameCode,
  CODE_ALPHABET,
  CODE_LENGTH,
  CODE_ERROR_TEXT,
} from './netModel.ts';

/**
 * PURE Network-Game-panel view-model tests (issue #13 / #16 + the S.6 unified entry — the game-code
 * combobox PLUS the New/Resume/Current/Dealer's SEED SELECTOR, epic #35, closes #31). Strict, genuine
 * assertions on the exact derived model + each mutation's effect (agent-principles: specific expected
 * values, never "it ran"), with negative cases: an EMPTY input falls back to the placeholder; an
 * invalid TYPED code disables Enter + shows its exact error; a `resume` seed with no picked game is NOT
 * actionable; a `current` seed with no live game is NOT actionable; Enter needs BOTH a valid code AND
 * an actionable seed; removing a recent code drops EXACTLY that one and leaves the rest ordered.
 */

/** A valid CODE_LENGTH code fixture built from the alphabet (no length-specific literal). */
function code(seed: number): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[(seed + i) % CODE_ALPHABET.length];
  return s;
}

/** A fresh always-valid placeholder fixture (what the glue would pass in from generateGameCode). */
const PLACEHOLDER = code(0);

/** A resume-able game fixture. */
function seedGame(n: number): SeedGame {
  return { id: `g${n}`, label: `Game ${n}`, uuid: `uuid-${n}`, headHash: `hash-${n}` };
}

/** No seed sources: no resume-able games, no live local game (the common offline default). */
const NO_SOURCES: SeedSources = { games: [], hasCurrent: false };

/** Seed sources with the given games + current-game flag. */
function sources(games: readonly SeedGame[], hasCurrent: boolean): SeedSources {
  return { games, hasCurrent };
}

describe('initialNetPanel', () => {
  it('offers the placeholder + recent list + seed sources with an empty input, seed = new, no resume', () => {
    const recent = [code(1), code(2)];
    const games = [seedGame(1)];
    expect(initialNetPanel(PLACEHOLDER, recent, sources(games, true))).toEqual({
      text: '',
      placeholder: PLACEHOLDER,
      recent,
      seedKind: DEFAULT_SEED_KIND,
      resumeId: null,
      games,
      hasCurrent: true,
    });
  });

  it('defaults the seed kind to `new`', () => {
    expect(DEFAULT_SEED_KIND).toBe('new');
    expect(initialNetPanel(PLACEHOLDER, [], NO_SOURCES).seedKind).toBe('new');
  });
});

describe('code mutations — pure, immutable', () => {
  it('setPanelText records the text, leaving placeholder + recent + seed untouched', () => {
    const s0 = initialNetPanel(PLACEHOLDER, [code(1)], sources([seedGame(1)], true));
    const s1 = setPanelText(s0, 'abc234');
    expect(s1.text).toBe('abc234');
    expect(s1.placeholder).toBe(PLACEHOLDER);
    expect(s1.recent).toEqual([code(1)]);
    expect(s1.seedKind).toBe('new');
    expect(s1.hasCurrent).toBe(true);
    // Does not mutate the input.
    expect(s0.text).toBe('');
  });

  it('chooseRecent fills the typed text from a dropdown code (placeholder + recent untouched)', () => {
    const c = code(3);
    const s0 = initialNetPanel(PLACEHOLDER, [c], NO_SOURCES);
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
    const s0 = initialNetPanel(PLACEHOLDER, [a, b, c], NO_SOURCES);
    const s1 = removeRecent(s0, b);
    expect(s1.recent).toEqual([a, c]);
    expect(s1.text).toBe('');
    expect(s1.placeholder).toBe(PLACEHOLDER);
    // Immutable: the original list survives.
    expect(s0.recent).toEqual([a, b, c]);
  });

  it('removeRecent of an absent code leaves the list unchanged', () => {
    const a = code(0);
    const b = code(5);
    const s1 = removeRecent(initialNetPanel(PLACEHOLDER, [a, b], NO_SOURCES), code(20));
    expect(s1.recent).toEqual([a, b]);
  });
});

describe('seed mutations — pure, immutable', () => {
  it('setSeedKind selects the kind, leaving the code state untouched', () => {
    const s0 = initialNetPanel(PLACEHOLDER, [code(1)], sources([seedGame(1)], true));
    const s1 = setSeedKind(s0, 'current');
    expect(s1.seedKind).toBe('current');
    expect(s1.text).toBe('');
    expect(s1.placeholder).toBe(PLACEHOLDER);
    expect(s1.recent).toEqual([code(1)]);
    expect(s0.seedKind).toBe('new'); // immutable
  });

  it('setSeedKind AWAY from resume clears a picked resumeId', () => {
    const s0 = chooseResume(initialNetPanel(PLACEHOLDER, [], sources([seedGame(1)], false)), 'g1');
    expect(s0.resumeId).toBe('g1');
    const s1 = setSeedKind(s0, 'new');
    expect(s1.seedKind).toBe('new');
    expect(s1.resumeId).toBeNull();
  });

  it('setSeedKind BACK to resume preserves the picked resumeId', () => {
    const withPick = chooseResume(
      initialNetPanel(PLACEHOLDER, [], sources([seedGame(1)], false)),
      'g1',
    );
    // switch away then back — resumeId is cleared on the way out, so re-selecting resume has no pick
    const away = setSeedKind(withPick, 'new');
    const back = setSeedKind(away, 'resume');
    expect(back.seedKind).toBe('resume');
    expect(back.resumeId).toBeNull();
    // but selecting resume when a pick already stands (no round-trip through another kind) keeps it
    const stay = setSeedKind(withPick, 'resume');
    expect(stay.resumeId).toBe('g1');
  });

  it('chooseResume picks the game AND selects the resume kind', () => {
    const s0 = initialNetPanel(PLACEHOLDER, [], sources([seedGame(1), seedGame(2)], false));
    const s1 = chooseResume(s0, 'g2');
    expect(s1.seedKind).toBe('resume');
    expect(s1.resumeId).toBe('g2');
    expect(s0.resumeId).toBeNull(); // immutable
  });
});

describe('deriveNetPanel — effective code = typed || placeholder', () => {
  it('an empty input uses the placeholder as the effective code', () => {
    const m = deriveNetPanel(initialNetPanel(PLACEHOLDER, [], NO_SOURCES));
    expect(m.effectiveCode).toBe(PLACEHOLDER);
    expect(m.codeValid).toBe(true);
    expect(m.canonicalCode).toBe(PLACEHOLDER);
    expect(m.codeError).toBeNull();
  });

  it('a whitespace-only input still falls back to the placeholder', () => {
    const m = deriveNetPanel(setPanelText(initialNetPanel(PLACEHOLDER, [], NO_SOURCES), '   '));
    expect(m.effectiveCode).toBe(PLACEHOLDER);
    expect(m.codeValid).toBe(true);
  });

  it('typed text (trimmed) overrides the placeholder as the effective code', () => {
    const typed = code(4);
    const m = deriveNetPanel(
      setPanelText(initialNetPanel(PLACEHOLDER, [], NO_SOURCES), `  ${typed}  `),
    );
    expect(m.effectiveCode).toBe(typed);
    expect(m.effectiveCode).not.toBe(PLACEHOLDER);
  });

  it('exposes the raw typed text + placeholder verbatim for the input to render', () => {
    const m = deriveNetPanel(setPanelText(initialNetPanel(PLACEHOLDER, [], NO_SOURCES), 'ab'));
    expect(m.text).toBe('ab');
    expect(m.placeholder).toBe(PLACEHOLDER);
  });
});

describe('deriveNetPanel — code validation drives canonical code', () => {
  it('a valid typed code (lower-cased) yields the CANONICAL code with no error', () => {
    const c = code(0);
    const m = deriveNetPanel(
      setPanelText(initialNetPanel(PLACEHOLDER, [], NO_SOURCES), c.toLowerCase()),
    );
    expect(m.codeValid).toBe(true);
    expect(m.canonicalCode).toBe(c);
    expect(m.codeError).toBeNull();
    expect(validateGameCode(m.effectiveCode)).toEqual({ ok: true, code: m.canonicalCode });
  });

  it('a too-short typed code is invalid with the too-short message and disables Enter', () => {
    const m = deriveNetPanel(setPanelText(initialNetPanel(PLACEHOLDER, [], NO_SOURCES), 'ABC'));
    expect(m.codeValid).toBe(false);
    expect(m.canonicalCode).toBeNull();
    expect(m.codeError).toBe(CODE_ERROR_TEXT['too-short']);
    expect(m.canEnter).toBe(false); // even with an actionable `new` seed, a bad code blocks Enter
  });

  it('a bad-chars typed code is invalid with the bad-chars message', () => {
    // 'ABC-23' has a non-alphanumeric char; a digit-bearing code like 'ABC230' is now VALID (#30).
    const m = deriveNetPanel(setPanelText(initialNetPanel(PLACEHOLDER, [], NO_SOURCES), 'ABC-23'));
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
    const m = deriveNetPanel(initialNetPanel(PLACEHOLDER, [a, b, c], NO_SOURCES));
    expect(m.recentRows).toEqual([{ code: a }, { code: b }, { code: c }]);
  });

  it('an empty recent list → no dropdown rows', () => {
    const m = deriveNetPanel(initialNetPanel(PLACEHOLDER, [], NO_SOURCES));
    expect(m.recentRows).toEqual([]);
  });

  it('reflects a removeRecent by dropping the row', () => {
    const a = code(0);
    const b = code(5);
    const s = removeRecent(initialNetPanel(PLACEHOLDER, [a, b], NO_SOURCES), a);
    expect(deriveNetPanel(s).recentRows).toEqual([{ code: b }]);
  });
});

describe('seed labels — exact SSOT copy', () => {
  it('each seed kind maps to its exact non-empty human label', () => {
    expect(SEED_LABEL.new).toBe('New game');
    expect(SEED_LABEL.resume).toBe('Resume a game');
    expect(SEED_LABEL.current).toBe('Current local board');
    expect(SEED_LABEL.defer).toBe("Dealer's choice");
  });
});

describe('deriveNetPanel — seed options (New / Resume / Current / Dealer’s)', () => {
  it('lists all four kinds in order with their SSOT labels, `new` selected by default', () => {
    const m = deriveNetPanel(initialNetPanel(PLACEHOLDER, [], NO_SOURCES));
    expect(m.seedOptions.map((o) => o.kind)).toEqual(['new', 'resume', 'current', 'defer']);
    // Assert each option's label is EXACTLY its SSOT string (a wrong/empty label is caught here).
    expect(m.seedOptions.find((o) => o.kind === 'new')!.label).toBe('New game');
    expect(m.seedOptions.find((o) => o.kind === 'resume')!.label).toBe('Resume a game');
    expect(m.seedOptions.find((o) => o.kind === 'current')!.label).toBe('Current local board');
    expect(m.seedOptions.find((o) => o.kind === 'defer')!.label).toBe("Dealer's choice");
    expect(m.seedOptions.find((o) => o.selected)?.kind).toBe('new');
    expect(m.seedKind).toBe('new');
  });

  it('new + defer are ALWAYS available; resume gates on games ONLY; current gates on hasCurrent ONLY', () => {
    // no games, no current → resume + current unavailable, new + defer available
    const bare = deriveNetPanel(initialNetPanel(PLACEHOLDER, [], NO_SOURCES));
    const availOf = (m: ReturnType<typeof deriveNetPanel>) => (k: SeedKind): boolean =>
      m.seedOptions.find((o) => o.kind === k)!.available;
    expect(availOf(bare)('new')).toBe(true);
    expect(availOf(bare)('defer')).toBe(true);
    expect(availOf(bare)('resume')).toBe(false);
    expect(availOf(bare)('current')).toBe(false);

    // A DISCRIMINATING pair proves resume keys off `games` and current off `hasCurrent`
    // INDEPENDENTLY (a fall-through of resume into current's rule would flip one of these):
    //  - games present but NO current board → resume available, current NOT.
    const gamesOnly = deriveNetPanel(initialNetPanel(PLACEHOLDER, [], sources([seedGame(1)], false)));
    expect(availOf(gamesOnly)('resume')).toBe(true);
    expect(availOf(gamesOnly)('current')).toBe(false);
    //  - a current board but NO games → current available, resume NOT.
    const currentOnly = deriveNetPanel(initialNetPanel(PLACEHOLDER, [], sources([], true)));
    expect(availOf(currentOnly)('resume')).toBe(false);
    expect(availOf(currentOnly)('current')).toBe(true);

    // with a game + a current board → all four available
    const rich = deriveNetPanel(initialNetPanel(PLACEHOLDER, [], sources([seedGame(1)], true)));
    for (const k of SEED_ORDER) {
      expect(rich.seedOptions.find((o) => o.kind === k)!.available).toBe(true);
    }
  });

  it('reflects the selected kind after setSeedKind', () => {
    const m = deriveNetPanel(
      setSeedKind(initialNetPanel(PLACEHOLDER, [], sources([], true)), 'current'),
    );
    expect(m.seedKind).toBe('current');
    expect(m.seedOptions.find((o) => o.selected)?.kind).toBe('current');
  });
});

describe('deriveNetPanel — seed actionability + choice + canEnter', () => {
  it('`new` is actionable → choice {new,null}, and (valid code) Enter enabled', () => {
    const m = deriveNetPanel(initialNetPanel(PLACEHOLDER, [], NO_SOURCES));
    expect(m.seedActionable).toBe(true);
    expect(m.seedChoice).toEqual({ kind: 'new', resumeId: null });
    expect(m.canEnter).toBe(true);
  });

  it('`defer` is actionable → choice {defer,null}', () => {
    const m = deriveNetPanel(setSeedKind(initialNetPanel(PLACEHOLDER, [], NO_SOURCES), 'defer'));
    expect(m.seedActionable).toBe(true);
    expect(m.seedChoice).toEqual({ kind: 'defer', resumeId: null });
    expect(m.canEnter).toBe(true);
  });

  it('`current` is actionable ONLY with a live local game', () => {
    const withGame = deriveNetPanel(
      setSeedKind(initialNetPanel(PLACEHOLDER, [], sources([], true)), 'current'),
    );
    expect(withGame.seedActionable).toBe(true);
    expect(withGame.seedChoice).toEqual({ kind: 'current', resumeId: null });
    expect(withGame.canEnter).toBe(true);

    const noGame = deriveNetPanel(
      setSeedKind(initialNetPanel(PLACEHOLDER, [], sources([], false)), 'current'),
    );
    expect(noGame.seedActionable).toBe(false);
    expect(noGame.seedChoice).toBeNull();
    expect(noGame.canEnter).toBe(false); // valid code but a non-actionable seed blocks Enter
  });

  it('`resume` is NOT actionable until a game is picked', () => {
    const s0 = setSeedKind(initialNetPanel(PLACEHOLDER, [], sources([seedGame(1)], false)), 'resume');
    const noPick = deriveNetPanel(s0);
    expect(noPick.seedActionable).toBe(false);
    expect(noPick.seedChoice).toBeNull();
    expect(noPick.canEnter).toBe(false);

    const picked = deriveNetPanel(chooseResume(s0, 'g1'));
    expect(picked.seedActionable).toBe(true);
    expect(picked.seedChoice).toEqual({ kind: 'resume', resumeId: 'g1' });
    expect(picked.canEnter).toBe(true);
  });

  it('`resume` with a picked id NO LONGER in the games list is NOT actionable (stale pick)', () => {
    // pick g1, then the sources shrink to only g2 (g1 removed) — carried via a fresh initial state
    const stale = deriveNetPanel({
      ...initialNetPanel(PLACEHOLDER, [], sources([seedGame(2)], false)),
      seedKind: 'resume',
      resumeId: 'g1',
    });
    expect(stale.seedActionable).toBe(false);
    expect(stale.seedChoice).toBeNull();
    expect(stale.canEnter).toBe(false);
  });

  it('`resume` picked from a MULTI-game list is actionable only for a member id (some, not every)', () => {
    // Two games, pick g1 (a member). `some(g.id===g1)` is true; `every(g.id===g1)` would be FALSE
    // (g2 !== g1), so a some→every mutation flips this to non-actionable — this asserts it stays true.
    const s = deriveNetPanel({
      ...initialNetPanel(PLACEHOLDER, [], sources([seedGame(1), seedGame(2)], false)),
      seedKind: 'resume',
      resumeId: 'g1',
    });
    expect(s.seedActionable).toBe(true);
    expect(s.seedChoice).toEqual({ kind: 'resume', resumeId: 'g1' });
  });

  it('`resume` with a NULL pick is not actionable even when games exist (the null guard bites)', () => {
    // resumeId null, games non-empty: `resumeId !== null` is false → not actionable. A `true &&`
    // mutation of that guard would (with a non-empty list whose ids never equal null) still be false
    // via `some`, so pair it with the some check: assert BOTH the flag AND that no choice is produced.
    const s = deriveNetPanel({
      ...initialNetPanel(PLACEHOLDER, [], sources([seedGame(1)], false)),
      seedKind: 'resume',
      resumeId: null,
    });
    expect(s.seedActionable).toBe(false);
    expect(s.seedChoice).toBeNull();
  });

  it('a NON-resume actionable seed always yields resumeId null in its choice, even if one lingers', () => {
    // A `current` seed carrying a stale resumeId: the choice's resumeId MUST be null (only `resume`
    // carries an id). The `state.seedKind === 'resume' ? resumeId : null` guard is what enforces this;
    // a `true ? resumeId : null` mutation would leak the stale id into a current choice.
    const s = deriveNetPanel({
      ...initialNetPanel(PLACEHOLDER, [], sources([seedGame(1)], true)),
      seedKind: 'current',
      resumeId: 'g1',
    });
    expect(s.seedActionable).toBe(true);
    expect(s.seedChoice).toEqual({ kind: 'current', resumeId: null });
    expect(s.seedChoice!.resumeId).toBeNull();
  });

  it('seedGameRows list the games only when resume is selected, flagging the picked one', () => {
    const games = [seedGame(1), seedGame(2)];
    // not resume → no rows even though games exist
    const notResume = deriveNetPanel(initialNetPanel(PLACEHOLDER, [], sources(games, false)));
    expect(notResume.seedGameRows).toEqual([]);

    // resume, no pick → rows with none selected
    const s0 = setSeedKind(initialNetPanel(PLACEHOLDER, [], sources(games, false)), 'resume');
    expect(deriveNetPanel(s0).seedGameRows).toEqual([
      { id: 'g1', label: 'Game 1', selected: false },
      { id: 'g2', label: 'Game 2', selected: false },
    ]);

    // pick g2 → g2 flagged selected
    expect(deriveNetPanel(chooseResume(s0, 'g2')).seedGameRows).toEqual([
      { id: 'g1', label: 'Game 1', selected: false },
      { id: 'g2', label: 'Game 2', selected: true },
    ]);
  });

  it('an invalid code blocks Enter even when the seed IS actionable', () => {
    const m = deriveNetPanel(setPanelText(initialNetPanel(PLACEHOLDER, [], NO_SOURCES), 'ABC'));
    expect(m.seedActionable).toBe(true); // `new` seed
    expect(m.codeValid).toBe(false);
    expect(m.canEnter).toBe(false);
  });
});

describe('property: canEnter iff (codeValid AND seedActionable) (fast-check)', () => {
  it('holds across arbitrary code text + seed kind + sources', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant(''), fc.constant('   '), fc.constant('ABC'), fc.constant(code(7))),
        fc.constantFrom<SeedKind>('new', 'resume', 'current', 'defer'),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (text, kind, hasGame, hasCurrent, pick) => {
          const games = hasGame ? [seedGame(1)] : [];
          let s = initialNetPanel(PLACEHOLDER, [], sources(games, hasCurrent));
          s = setPanelText(s, text);
          s = setSeedKind(s, kind);
          if (pick && hasGame) s = chooseResume(s, 'g1');
          // chooseResume selects resume; only leave it that way if the arbitrary kind was resume
          if (kind !== 'resume') s = setSeedKind(s, kind);
          const m = deriveNetPanel(s);
          expect(m.canEnter).toBe(m.codeValid && m.seedActionable);
          // a null choice iff not actionable; a non-null choice always carries the selected kind
          if (m.seedChoice === null) expect(m.seedActionable).toBe(false);
          else expect(m.seedChoice.kind).toBe(m.seedKind);
        },
      ),
    );
  });
});

describe('property: a generated placeholder + `new` seed always allows Enter (fast-check)', () => {
  it('effective = placeholder, valid, canonical round-trips, canEnter true', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 0.9999999, noNaN: true }), {
          minLength: CODE_LENGTH,
          maxLength: CODE_LENGTH * 4,
        }),
        (rands) => {
          let i = 0;
          const placeholder = generateGameCode(() => rands[i++ % rands.length] ?? 0);
          const m = deriveNetPanel(initialNetPanel(placeholder, [], NO_SOURCES));
          expect(m.effectiveCode).toBe(placeholder);
          expect(m.codeValid).toBe(true);
          expect(m.canonicalCode).toBe(placeholder);
          expect(m.codeError).toBeNull();
          expect(m.canEnter).toBe(true); // default `new` seed is always actionable
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
          const m = deriveNetPanel(setPanelText(initialNetPanel(PLACEHOLDER, [], NO_SOURCES), typed));
          expect(m.effectiveCode).toBe(typed);
          expect(m.codeValid).toBe(true);
          expect(m.canonicalCode).toBe(typed);
        },
      ),
    );
  });
});
