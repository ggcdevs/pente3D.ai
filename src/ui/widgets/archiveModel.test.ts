import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  deriveArchive,
  deriveSeedGames,
  playersLabel,
  resolveArchiveActions,
  resolveArchiveStatus,
  selectResumeTarget,
  shortHeadHash,
  CONFLICTED_RESULT,
  IN_PROGRESS_RESULT,
  PLAYER_SEAT_ORDER,
  UNKNOWN_PLAYER,
  PLAYERS_LABEL_SEPARATOR,
  SEED_LABEL_SEPARATOR,
  SHORT_HEAD_HASH_CHARS,
  STATUS_EMPTY_TEXT,
  STATUS_LABEL,
  STATUS_ORDER,
  type ArchiveListing,
  type ArchiveStatus,
} from './archiveModel.ts';

/**
 * PURE archive-browser view-model tests (Task 5.8; extended by Task V.6, epic #47 / #37) — strict
 * unit + mutation gate. Genuine assertions on the exact derived model (agent-principles: specific
 * expected values, never "it ran"), with negative cases for every resolution rule: newest-first
 * ordering, the id tiebreak, the conflicted flag (and the non-conflicted pass-through), the
 * deterministic players label with missing/empty seats, purity, and the empty-archive state.
 *
 * V.6 adds the model half of the "the games list is the ONLY route back to a game" behaviour
 * (design §6/§10): the finished/unfinished STATUS + grouping, resume selection BY GAME UUID, and
 * the Resume-seed projection the Network-Game panel lists — all derived from the same listings so the
 * browser and the panel can never disagree about what a game is. What each OFFERS is tested as its own
 * rule: continuing a game locally needs an unfinished one, while seeding a game into a room takes
 * "finished + unfinished" (design §3) and refuses only a conflicted record, which has no single log.
 * The DOM/IndexedDB wiring is proven separately by Playwright (`e2e/archive.spec.ts`,
 * `e2e/gamesList.spec.ts`).
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
      uuid: `uuid-${id}`,
      ...meta,
    },
  };
}

/** The group for `status` in a derived model, or `undefined` when the model omits it. */
function groupOf(model: ReturnType<typeof deriveArchive>, status: ArchiveStatus) {
  return model.groups.find((g) => g.status === status);
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
  it('projects id / uuid / headHash / startedAt verbatim into the row', () => {
    const model = deriveArchive([
      listing('game-7', { headHash: 'abc123', startedAt: 4242, uuid: 'u-7' }),
    ]);
    expect(model.items[0]).toEqual({
      id: 'game-7',
      // The GAME's portable identity (design §2.2) — the handle Resume is keyed by (V.6), distinct
      // from the record id above.
      uuid: 'u-7',
      playersLabel: 'Ann vs Bo',
      result: 'in-progress',
      status: 'unfinished',
      statusLabel: 'Unfinished',
      conflicted: false,
      // An in-progress game can be reviewed OR resumed (Task 6.6): both action flags ride the row.
      canReview: true,
      canResume: true,
      headHash: 'abc123',
      startedAt: 4242,
    });
  });

  it('carries a record id that DIFFERS from the game uuid through unchanged (they are not the same key)', () => {
    // A pre-V.5 record (keyed by a retired autosave id) and a conflicted record are both stored under
    // an id that is not the game's uuid. Both must ride through so the row can offer Review by RECORD
    // id and Resume by GAME uuid.
    const model = deriveArchive([listing('autosave-legacy', { uuid: 'game-uuid-9' })]);
    expect(model.items[0]!.id).toBe('autosave-legacy');
    expect(model.items[0]!.uuid).toBe('game-uuid-9');
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

  it('STATUS_ORDER puts UNFINISHED first — the games you can get back into lead the list', () => {
    expect(STATUS_ORDER).toEqual(['unfinished', 'finished', 'conflicted']);
  });

  it('every status has a distinct human label and a distinct empty note', () => {
    expect(STATUS_LABEL).toEqual({
      unfinished: 'Unfinished',
      finished: 'Finished',
      conflicted: 'Conflicted',
    });
    // The empty notes are what a player reads when a section has nothing in it; they must be real
    // sentences, distinct per status, and never blank (a blank note renders as a headed void).
    const notes = STATUS_ORDER.map((s) => STATUS_EMPTY_TEXT[s]);
    expect(new Set(notes).size).toBe(STATUS_ORDER.length);
    for (const note of notes) expect(note.length).toBeGreaterThan(0);
    expect(STATUS_EMPTY_TEXT.unfinished).toBe('No unfinished games — nothing to resume.');
  });
});

// ─────────────────────────── Task V.6 (epic #47, #37): status, grouping, resume-by-uuid ─────────

describe('resolveArchiveStatus — finished vs unfinished vs conflicted', () => {
  it('the in-progress marker is UNFINISHED (the only continuable state)', () => {
    expect(resolveArchiveStatus(IN_PROGRESS_RESULT)).toBe('unfinished');
  });

  it('a won game is FINISHED (negative: not unfinished, not conflicted)', () => {
    expect(resolveArchiveStatus('white-wins')).toBe('finished');
    expect(resolveArchiveStatus('black-wins')).toBe('finished');
  });

  it('a forked game is CONFLICTED (negative: not finished)', () => {
    expect(resolveArchiveStatus(CONFLICTED_RESULT)).toBe('conflicted');
  });

  it('an UNKNOWN marker is FINISHED — review-only, never offered as continuable', () => {
    // The status answers "can I get back INTO this game". Anything that is neither the in-progress
    // marker nor a fork is over-or-unrecognized, so it is listed as finished and withheld from
    // Resume — the conservative arm, matching resolveArchiveActions.
    expect(resolveArchiveStatus('abandoned')).toBe('finished');
    expect(resolveArchiveStatus('')).toBe('finished');
  });

  it('agrees with resolveArchiveActions on EVERY result — one rule, not two', () => {
    // canResume and the UNFINISHED status are the same decision; a mutant that lets them drift
    // (e.g. status treating "not conflicted" as unfinished) is killed here.
    for (const result of ['in-progress', 'white-wins', 'black-wins', 'conflicted', 'weird', '']) {
      expect(resolveArchiveActions(result).canResume).toBe(
        resolveArchiveStatus(result) === 'unfinished',
      );
    }
  });
});

describe('deriveArchive — status rides each row', () => {
  it('labels each row with its status (unfinished / finished / conflicted)', () => {
    const model = deriveArchive([
      listing('live', { result: IN_PROGRESS_RESULT, startedAt: 300 }),
      listing('won', { result: 'white-wins', startedAt: 200 }),
      listing('forked', { result: CONFLICTED_RESULT, startedAt: 100 }),
    ]);
    expect(model.items.map((i) => [i.id, i.status, i.statusLabel])).toEqual([
      ['live', 'unfinished', 'Unfinished'],
      ['won', 'finished', 'Finished'],
      ['forked', 'conflicted', 'Conflicted'],
    ]);
  });
});

describe('deriveArchive — grouping (browse finished AND unfinished, #37)', () => {
  it('groups rows by status in STATUS_ORDER, each keeping the newest-first order', () => {
    const model = deriveArchive([
      listing('won-old', { result: 'white-wins', startedAt: 100 }),
      listing('live-old', { result: IN_PROGRESS_RESULT, startedAt: 200 }),
      listing('won-new', { result: 'black-wins', startedAt: 400 }),
      listing('live-new', { result: IN_PROGRESS_RESULT, startedAt: 500 }),
      listing('forked', { result: CONFLICTED_RESULT, startedAt: 300 }),
    ]);
    expect(model.groups.map((g) => g.status)).toEqual(['unfinished', 'finished', 'conflicted']);
    expect(groupOf(model, 'unfinished')!.items.map((i) => i.id)).toEqual(['live-new', 'live-old']);
    expect(groupOf(model, 'finished')!.items.map((i) => i.id)).toEqual(['won-new', 'won-old']);
    expect(groupOf(model, 'conflicted')!.items.map((i) => i.id)).toEqual(['forked']);
    // The group label is the status label (the section heading a player reads).
    expect(model.groups.map((g) => g.label)).toEqual(['Unfinished', 'Finished', 'Conflicted']);
    expect(model.groups.every((g) => !g.isEmpty)).toBe(true);
  });

  it('ALWAYS shows the UNFINISHED section — empty, with its note — when every game is over', () => {
    // The one question this list exists to answer is "what can I get back into" (design §6/§10:
    // reload → empty slate, so the list is the only route back). An empty answer must be STATED,
    // not implied by a missing heading.
    const model = deriveArchive([
      listing('won', { result: 'white-wins' }),
      listing('forked', { result: CONFLICTED_RESULT, startedAt: 900 }),
    ]);
    const unfinished = groupOf(model, 'unfinished')!;
    expect(unfinished.items).toEqual([]);
    expect(unfinished.isEmpty).toBe(true);
    expect(unfinished.emptyText).toBe('No unfinished games — nothing to resume.');
  });

  it('OMITS an empty finished/conflicted section (no heading over nothing)', () => {
    const model = deriveArchive([listing('live', { result: IN_PROGRESS_RESULT })]);
    expect(model.groups.map((g) => g.status)).toEqual(['unfinished']);
    expect(groupOf(model, 'finished')).toBeUndefined();
    expect(groupOf(model, 'conflicted')).toBeUndefined();
  });

  it('emits NO groups at all for an empty archive (the global empty state speaks instead)', () => {
    const model = deriveArchive([]);
    expect(model.groups).toEqual([]);
    expect(model.isEmpty).toBe(true);
  });

  it('every row appears in exactly ONE group, and the groups hold every row', () => {
    const listings = [
      listing('a', { result: IN_PROGRESS_RESULT, startedAt: 5 }),
      listing('b', { result: 'white-wins', startedAt: 4 }),
      listing('c', { result: CONFLICTED_RESULT, startedAt: 3 }),
      listing('d', { result: 'nonsense', startedAt: 2 }),
    ];
    const model = deriveArchive(listings);
    const grouped = model.groups.flatMap((g) => g.items.map((i) => i.id));
    expect(grouped.slice().sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(grouped).toHaveLength(new Set(grouped).size); // no row listed twice
    expect(grouped).toHaveLength(model.items.length);
  });
});

describe('deriveArchive — the listing hides nothing and duplicates nothing (V.1 + V.5)', () => {
  it('keeps EVERY listing as exactly one row — no filter, no de-duplication', () => {
    // V.1 deleted the internal `net-room:{code}` records, so there is no marker-based exclusion left;
    // V.5 keys one record per game uuid, so there is nothing to collapse either. This pins that the
    // model neither drops nor merges: what the archive lists is what the player sees.
    const listings = [
      listing('a', { result: IN_PROGRESS_RESULT }),
      listing('b', { result: 'white-wins' }),
      listing('c', { result: CONFLICTED_RESULT }),
      listing('d', { result: 'net-room' }),
    ];
    const model = deriveArchive(listings);
    expect(model.items.map((i) => i.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    // Even a record whose marker an older build used internally is shown, not silently hidden.
    expect(model.items.find((i) => i.id === 'd')!.result).toBe('net-room');
  });

  it('property: the rows are a permutation of the listings for ANY input (nothing lost or cloned)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 6 }),
            result: fc.constantFrom(IN_PROGRESS_RESULT, 'white-wins', CONFLICTED_RESULT, 'odd'),
            startedAt: fc.integer({ min: 0, max: 50 }),
          }),
          { selector: (r) => r.id },
        ),
        (raw) => {
          const listings = raw.map((r) =>
            listing(r.id, { result: r.result, startedAt: r.startedAt }),
          );
          const model = deriveArchive(listings);
          expect(model.items).toHaveLength(listings.length);
          expect(model.items.map((i) => i.id).sort()).toEqual(
            listings.map((l) => l.id).sort(),
          );
          // …and every row is reachable through exactly one group section.
          const grouped = model.groups.flatMap((g) => g.items.map((i) => i.id));
          expect(grouped.slice().sort()).toEqual(model.items.map((i) => i.id).sort());
        },
      ),
    );
  });

  it('property: rows are ordered newest-first with an id tiebreak, always', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 4 }),
            startedAt: fc.integer({ min: 0, max: 5 }),
          }),
          { selector: (r) => r.id },
        ),
        (raw) => {
          const model = deriveArchive(raw.map((r) => listing(r.id, { startedAt: r.startedAt })));
          for (let i = 1; i < model.items.length; i++) {
            const prev = model.items[i - 1]!;
            const cur = model.items[i]!;
            expect(prev.startedAt).toBeGreaterThanOrEqual(cur.startedAt);
            if (prev.startedAt === cur.startedAt) {
              expect(prev.id.localeCompare(cur.id)).toBeLessThan(0);
            }
          }
        },
      ),
    );
  });
});

describe('selectResumeTarget — resume by GAME UUID (#37)', () => {
  const model = () =>
    deriveArchive([
      listing('rec-live', { result: IN_PROGRESS_RESULT, uuid: 'u-live', startedAt: 300 }),
      listing('rec-won', { result: 'white-wins', uuid: 'u-won', startedAt: 200 }),
      listing('rec-forked', { result: CONFLICTED_RESULT, uuid: 'u-forked', startedAt: 100 }),
    ]);

  it('resolves an unfinished game to the RECORD id to load, alongside its uuid', () => {
    expect(selectResumeTarget(model(), 'u-live')).toEqual({
      ok: true,
      uuid: 'u-live',
      id: 'rec-live',
    });
  });

  it('refuses an unknown uuid with a typed not-found (negative)', () => {
    expect(selectResumeTarget(model(), 'u-nope')).toEqual({ ok: false, reason: 'not-found' });
  });

  it('refuses a FINISHED game with a typed not-resumable (negative)', () => {
    expect(selectResumeTarget(model(), 'u-won')).toEqual({ ok: false, reason: 'not-resumable' });
  });

  it('refuses a CONFLICTED game with a typed not-resumable (negative)', () => {
    expect(selectResumeTarget(model(), 'u-forked')).toEqual({
      ok: false,
      reason: 'not-resumable',
    });
  });

  it('refuses the empty archive with not-found (negative)', () => {
    expect(selectResumeTarget(deriveArchive([]), 'u-live')).toEqual({
      ok: false,
      reason: 'not-found',
    });
  });

  it('prefers the RESUMABLE record when two records claim one uuid', () => {
    // Real case: a conflicted record archives a fork under its own key while carrying the game's
    // uuid, so a game can be claimed twice. Picking the first match by order would refuse a game
    // that IS resumable; the resumable claimant wins.
    const twoClaims = deriveArchive([
      listing('rec-conflict', { result: CONFLICTED_RESULT, uuid: 'u-x', startedAt: 500 }),
      listing('rec-game', { result: IN_PROGRESS_RESULT, uuid: 'u-x', startedAt: 100 }),
    ]);
    expect(selectResumeTarget(twoClaims, 'u-x')).toEqual({ ok: true, uuid: 'u-x', id: 'rec-game' });
  });

  it('still refuses when EVERY claimant of the uuid is unresumable (negative)', () => {
    const twoDeadClaims = deriveArchive([
      listing('rec-conflict', { result: CONFLICTED_RESULT, uuid: 'u-x', startedAt: 500 }),
      listing('rec-won', { result: 'black-wins', uuid: 'u-x', startedAt: 100 }),
    ]);
    expect(selectResumeTarget(twoDeadClaims, 'u-x')).toEqual({
      ok: false,
      reason: 'not-resumable',
    });
  });

  it('property: a uuid resolves iff some listing with that uuid is unfinished', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 4 }),
            uuid: fc.constantFrom('u-1', 'u-2', 'u-3'),
            result: fc.constantFrom(IN_PROGRESS_RESULT, 'white-wins', CONFLICTED_RESULT),
          }),
          { maxLength: 8 },
        ),
        fc.constantFrom('u-1', 'u-2', 'u-3', 'u-absent'),
        (raw, wanted) => {
          const listings = raw.map((r, i) =>
            listing(`${r.id}-${i}`, { uuid: r.uuid, result: r.result }),
          );
          const sel = selectResumeTarget(deriveArchive(listings), wanted);
          const claimants = listings.filter((l) => l.meta.uuid === wanted);
          const resumable = claimants.filter((l) => l.meta.result === IN_PROGRESS_RESULT);
          if (resumable.length > 0) {
            expect(sel.ok).toBe(true);
            if (sel.ok) {
              expect(resumable.map((l) => l.id)).toContain(sel.id);
              expect(sel.uuid).toBe(wanted);
            }
          } else {
            expect(sel.ok).toBe(false);
            if (!sel.ok) {
              expect(sel.reason).toBe(claimants.length === 0 ? 'not-found' : 'not-resumable');
            }
          }
        },
      ),
    );
  });
});

describe('shortHeadHash — the disambiguating fingerprint in a seed label', () => {
  it('takes the first SHORT_HEAD_HASH_CHARS characters of the head hash', () => {
    expect(shortHeadHash('0123456789abcdef')).toBe('0123456');
    expect(SHORT_HEAD_HASH_CHARS).toBe(7);
  });

  it('returns a SHORTER hash unchanged (never pads, never throws)', () => {
    expect(shortHeadHash('abc')).toBe('abc');
    expect(shortHeadHash('')).toBe('');
  });
});

describe('deriveSeedGames — the net panel Resume selector, from the SAME list (#37)', () => {
  it('offers FINISHED and unfinished games (design §3), newest-first, labelled players + head', () => {
    const games = deriveSeedGames(
      [
        listing('rec-won', {
          result: 'white-wins',
          startedAt: 500,
          uuid: 'u-won',
          headHash: 'wwwwwwwwww',
          players: { white: 'Ann', black: 'Bo' },
        }),
        listing('rec-b', {
          result: IN_PROGRESS_RESULT,
          startedAt: 400,
          uuid: 'u-b',
          headHash: 'bbbbbbbbbb',
          players: { white: 'Ann', black: 'Bo' },
        }),
        listing('rec-a', {
          result: IN_PROGRESS_RESULT,
          startedAt: 300,
          uuid: 'u-a',
          headHash: 'aaaaaaaaaa',
          players: {},
        }),
        listing('rec-forked', { result: CONFLICTED_RESULT, startedAt: 450, uuid: 'u-f' }),
      ],
      [],
    );
    // A FINISHED game IS seedable — design §3 line "Resume — pick from your games list (finished +
    // unfinished)": bringing a game that is over into a room is how two players look at it together.
    // The CONFLICTED record is the one that is not: it has no single log to hand the room.
    expect(games).toEqual([
      { id: 'rec-won', label: 'Ann vs Bo · wwwwwww', uuid: 'u-won', headHash: 'wwwwwwwwww' },
      { id: 'rec-b', label: 'Ann vs Bo · bbbbbbb', uuid: 'u-b', headHash: 'bbbbbbbbbb' },
      { id: 'rec-a', label: '— vs — · aaaaaaa', uuid: 'u-a', headHash: 'aaaaaaaaaa' },
    ]);
    // The separator is the shared SSOT, so the label can never drift from the constant.
    expect(games[0]!.label).toContain(SEED_LABEL_SEPARATOR);
  });

  it('never offers a CONFLICTED record, even when it is the only game there is (negative)', () => {
    expect(deriveSeedGames([listing('rec-forked', { result: CONFLICTED_RESULT })], [])).toEqual([]);
  });

  it('offers a game whose result this build does not recognize (it still has ONE log)', () => {
    // `resolveArchiveStatus` files an unknown marker under `finished` — review-only LOCALLY, but it is
    // still a single history, so it can be handed to a room. Pins that the seed rule keys on
    // "conflicted or not", not on the in-progress SSOT.
    const games = deriveSeedGames([listing('rec-odd', { result: 'abandoned-by-v9' })], []);
    expect(games.map((g) => g.id)).toEqual(['rec-odd']);
  });

  it('EXCLUDES the games whose uuids the caller names (the loaded board, the live net game)', () => {
    const listings = [
      listing('rec-live', { result: IN_PROGRESS_RESULT, uuid: 'u-loaded', startedAt: 300 }),
      listing('rec-net', { result: IN_PROGRESS_RESULT, uuid: 'u-net', startedAt: 200 }),
      listing('rec-other', { result: IN_PROGRESS_RESULT, uuid: 'u-other', startedAt: 100 }),
    ];
    expect(deriveSeedGames(listings, ['u-loaded', 'u-net']).map((g) => g.uuid)).toEqual(['u-other']);
  });

  it('ignores a NULL exclusion (a source with no game right now excludes nothing)', () => {
    // The glue passes the live net game's uuid, which is `null` offline. A null must not be matched
    // against anything — least of all a game whose uuid is the string "null".
    const listings = [
      listing('rec-a', { result: IN_PROGRESS_RESULT, uuid: 'u-a' }),
      listing('rec-null', { result: IN_PROGRESS_RESULT, uuid: 'null', startedAt: 900 }),
    ];
    expect(deriveSeedGames(listings, [null]).map((g) => g.uuid).sort()).toEqual(['null', 'u-a']);
  });

  it('yields an empty selector when the only seedable games are excluded (negative)', () => {
    // Every remaining row is either forked (never seedable) or the caller's own excluded game, so the
    // selector is empty — the negative that makes "offers finished games" a rule and not a pass-through.
    expect(
      deriveSeedGames(
        [
          listing('rec-won', { result: 'white-wins', uuid: 'u-loaded' }),
          listing('rec-forked', { result: CONFLICTED_RESULT, uuid: 'u-f' }),
        ],
        ['u-loaded'],
      ),
    ).toEqual([]);
  });

  it('yields an empty selector for an empty archive', () => {
    expect(deriveSeedGames([], [])).toEqual([]);
  });

  it('property: every seed row is a NON-CONFLICTED, non-excluded row of the SAME derived list', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 4 }),
            uuid: fc.constantFrom('u-1', 'u-2', 'u-3', 'u-4'),
            result: fc.constantFrom(IN_PROGRESS_RESULT, 'white-wins', CONFLICTED_RESULT),
            startedAt: fc.integer({ min: 0, max: 10 }),
          }),
          { selector: (r) => r.id },
        ),
        fc.array(fc.constantFrom<string | null>('u-1', 'u-2', null), { maxLength: 3 }),
        (raw, exclude) => {
          const listings = raw.map((r) =>
            listing(r.id, { uuid: r.uuid, result: r.result, startedAt: r.startedAt }),
          );
          const seeds = deriveSeedGames(listings, exclude);
          const rows = deriveArchive(listings).items;
          const rowById = new Map(rows.map((r) => [r.id, r]));
          for (const seed of seeds) {
            const row = rowById.get(seed.id)!;
            expect(row.conflicted).toBe(false);
            expect(row.status).not.toBe('conflicted');
            expect(row.uuid).toBe(seed.uuid);
            expect(row.headHash).toBe(seed.headHash);
            expect(exclude).not.toContain(seed.uuid);
          }
          // …and nothing seedable and non-excluded is missing from the selector.
          const expected = rows
            .filter((r) => !r.conflicted && !exclude.includes(r.uuid))
            .map((r) => r.id);
          expect(seeds.map((s) => s.id)).toEqual(expected);
        },
      ),
    );
  });
});
