import { describe, it, expect } from 'vitest';
import {
  deriveArchive,
  playersLabel,
  resolveArchiveActions,
  CONFLICTED_RESULT,
  IN_PROGRESS_RESULT,
  PLAYER_SEAT_ORDER,
  UNKNOWN_PLAYER,
  PLAYERS_LABEL_SEPARATOR,
  type ArchiveListing,
} from './archiveModel.ts';

/**
 * PURE archive-browser view-model tests (Task 5.8) — strict unit + mutation gate. Genuine
 * assertions on the exact derived model (agent-principles: specific expected values, never "it
 * ran"), with negative cases for every resolution rule: newest-first ordering, the id tiebreak,
 * the conflicted flag (and the non-conflicted pass-through), the deterministic players label with
 * missing/empty seats, purity, and the empty-archive state. The DOM/IndexedDB wiring is proven
 * separately by Playwright (`e2e/archive.spec.ts`).
 */

/** Build a listing with sensible defaults; override any metadata field per test. */
function listing(
  id: string,
  meta: Partial<ArchiveListing['meta']> = {},
): ArchiveListing {
  return {
    id,
    meta: {
      players: { white: 'Ann', black: 'Bo' },
      result: 'in-progress',
      startedAt: 1000,
      headHash: `hash-${id}`,
      ...meta,
    },
  };
}

describe('deriveArchive — ordering (newest first)', () => {
  it('sorts rows by startedAt DESCENDING regardless of input order', () => {
    const model = deriveArchive([
      listing('old', { startedAt: 100 }),
      listing('new', { startedAt: 300 }),
      listing('mid', { startedAt: 200 }),
    ]);
    expect(model.items.map((i) => i.id)).toEqual(['new', 'mid', 'old']);
    // The exact startedAt values ride through in the newest-first order.
    expect(model.items.map((i) => i.startedAt)).toEqual([300, 200, 100]);
  });

  it('breaks a startedAt tie by id ASCENDING (deterministic, not input order)', () => {
    // Same startedAt; authored z-before-a. The id tiebreak must put 'a' first.
    const model = deriveArchive([
      listing('z', { startedAt: 500 }),
      listing('a', { startedAt: 500 }),
    ]);
    expect(model.items.map((i) => i.id)).toEqual(['a', 'z']);
  });

  it('does not mutate the input array (pure)', () => {
    const input = [
      listing('old', { startedAt: 100 }),
      listing('new', { startedAt: 300 }),
    ];
    const snapshot = input.map((l) => l.id);
    deriveArchive(input);
    expect(input.map((l) => l.id)).toEqual(snapshot);
  });
});

describe('deriveArchive — conflicted flag', () => {
  it('flags a listing whose result is CONFLICTED_RESULT and passes the raw result through', () => {
    const model = deriveArchive([listing('c', { result: CONFLICTED_RESULT })]);
    expect(model.items[0]!.conflicted).toBe(true);
    expect(model.items[0]!.result).toBe('conflicted');
  });

  it('does NOT flag an ordinary result (negative case)', () => {
    const model = deriveArchive([
      listing('a', { result: 'in-progress' }),
      listing('b', { result: 'white-wins', startedAt: 900 }),
    ]);
    const byId = Object.fromEntries(model.items.map((i) => [i.id, i]));
    expect(byId['a']!.conflicted).toBe(false);
    expect(byId['b']!.conflicted).toBe(false);
    // An unknown/other result string passes through verbatim (not coerced/dropped).
    expect(byId['b']!.result).toBe('white-wins');
  });
});

describe('deriveArchive — projection', () => {
  it('projects id / headHash / startedAt verbatim into the row', () => {
    const model = deriveArchive([
      listing('game-7', { headHash: 'abc123', startedAt: 4242 }),
    ]);
    expect(model.items[0]).toEqual({
      id: 'game-7',
      playersLabel: 'Ann vs Bo',
      result: 'in-progress',
      conflicted: false,
      // An in-progress game can be reviewed OR resumed (Task 6.6): both action flags ride the row.
      canReview: true,
      canResume: true,
      headHash: 'abc123',
      startedAt: 4242,
    });
  });
});

describe('playersLabel — deterministic seat ordering', () => {
  it('renders "white vs black" in fixed seat order even when the map is keyed black-first', () => {
    // Object key order is black-then-white; the label must still be white-first (fixed order).
    expect(playersLabel({ black: 'Bo', white: 'Ann' })).toBe('Ann vs Bo');
  });

  it('shows the em-dash placeholder for a seat missing from the map', () => {
    // Assert on the LITERAL placeholder text (not the `UNKNOWN_PLAYER` constant), so a mutant that
    // blanks the constant to "" is killed here — comparing against the constant itself would be a
    // tautology (agent-principles: never assert a value equals the same literal you fed in).
    expect(playersLabel({ white: 'Ann' })).toBe('Ann vs —');
    expect(playersLabel({ black: 'Bo' })).toBe('— vs Bo');
    // The exported constant IS the em-dash (pin the SSOT the widget/date labels also read).
    expect(UNKNOWN_PLAYER).toBe('—');
  });

  it('shows UNKNOWN_PLAYER for an EMPTY-STRING seat name (negative: empty is not a name)', () => {
    expect(playersLabel({ white: '', black: 'Bo' })).toBe(
      `${UNKNOWN_PLAYER}${PLAYERS_LABEL_SEPARATOR}Bo`,
    );
  });

  it('shows both seats unknown for an empty players map', () => {
    expect(playersLabel({})).toBe(
      `${UNKNOWN_PLAYER}${PLAYERS_LABEL_SEPARATOR}${UNKNOWN_PLAYER}`,
    );
  });

  it('ignores extra non-seat keys in the map (only the fixed seats are read)', () => {
    expect(playersLabel({ white: 'Ann', black: 'Bo', spectator: 'Cy' })).toBe('Ann vs Bo');
  });
});

describe('deriveArchive — empty archive', () => {
  it('yields an empty item list and isEmpty:true for no listings', () => {
    const model = deriveArchive([]);
    expect(model.items).toEqual([]);
    expect(model.isEmpty).toBe(true);
  });

  it('is NOT empty when at least one listing is present', () => {
    const model = deriveArchive([listing('a')]);
    expect(model.items).toHaveLength(1);
    expect(model.isEmpty).toBe(false);
  });
});

describe('resolveArchiveActions — review vs resume (Task 6.6)', () => {
  it('an in-progress game can be reviewed AND resumed', () => {
    // Only a genuinely-unfinished game (no winner, not forked) can be continued.
    expect(resolveArchiveActions('in-progress')).toEqual({ canReview: true, canResume: true });
    // Pin the SSOT the widget/glue also read (the only resumable marker).
    expect(IN_PROGRESS_RESULT).toBe('in-progress');
  });

  it('a FINISHED game (white-wins) is review-only — NOT resumable (negative case)', () => {
    // A won game rejects further moves (game over), so Resume must be withheld: review-only.
    expect(resolveArchiveActions('white-wins')).toEqual({ canReview: true, canResume: false });
  });

  it('a FINISHED game (black-wins) is review-only — NOT resumable (negative case)', () => {
    expect(resolveArchiveActions('black-wins')).toEqual({ canReview: true, canResume: false });
  });

  it('a CONFLICTED game is review-only — NOT resumable (negative case)', () => {
    // A fork has two divergent logs and no single continuable game — review-only until resolution.
    expect(resolveArchiveActions(CONFLICTED_RESULT)).toEqual({
      canReview: true,
      canResume: false,
    });
  });

  it('an UNKNOWN/other result string is review-only — NOT resumable (defensive default)', () => {
    // Any marker that is not exactly the in-progress SSOT is treated as non-resumable: resuming an
    // unrecognized state is unsafe, so only review is offered. Proves the decision is not a mere
    // "not conflicted" check (that would wrongly resume a `white-wins` game — killed above too).
    expect(resolveArchiveActions('abandoned')).toEqual({ canReview: true, canResume: false });
    expect(resolveArchiveActions('')).toEqual({ canReview: true, canResume: false });
  });

  it('review is ALWAYS available regardless of result (every archived game is browsable)', () => {
    for (const result of ['in-progress', 'white-wins', 'black-wins', 'conflicted', 'weird']) {
      expect(resolveArchiveActions(result).canReview).toBe(true);
    }
  });
});

describe('deriveArchive — action flags thread onto each row (Task 6.6)', () => {
  it('flags an in-progress row resumable and a finished row review-only', () => {
    const model = deriveArchive([
      listing('live', { result: 'in-progress', startedAt: 300 }),
      listing('won', { result: 'white-wins', startedAt: 200 }),
      listing('forked', { result: CONFLICTED_RESULT, startedAt: 100 }),
    ]);
    const byId = Object.fromEntries(model.items.map((i) => [i.id, i]));
    expect(byId['live']).toMatchObject({ canReview: true, canResume: true });
    expect(byId['won']).toMatchObject({ canReview: true, canResume: false });
    expect(byId['forked']).toMatchObject({ canReview: true, canResume: false });
  });
});

describe('archiveModel — constants', () => {
  it('CONFLICTED_RESULT matches the archive layer marker', () => {
    expect(CONFLICTED_RESULT).toBe('conflicted');
  });

  it('IN_PROGRESS_RESULT is the archive layer in-progress marker (the only resumable one)', () => {
    expect(IN_PROGRESS_RESULT).toBe('in-progress');
  });

  it('PLAYER_SEAT_ORDER is white then black', () => {
    expect(PLAYER_SEAT_ORDER).toEqual(['white', 'black']);
  });
});
