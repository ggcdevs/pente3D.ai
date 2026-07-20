/**
 * PURE archive-browser view-model (Task 5.8) — render-ui design Part 6 "Widget roster: menu
 * (… Load …)"; GLOSSARY "Game archive". The persistence-UX companion to the Stage 2 archive
 * (`src/persist/archive.ts`): that layer stores/reconstructs games; THIS turns the archive's
 * `GameListing[]` into the ordered, serializable list the archive-browser modal renders.
 *
 * The archive browser lists every persisted game — ordinary AND conflicted (GLOSSARY "conflict":
 * a fork is archived flagged `conflicted` so it can be reviewed later). Choosing an entry loads
 * it back into the scene for review. Turning the raw listings into the rendered rows (a stable id,
 * a players label, a result label, the conflicted flag, the head-hash fingerprint, the start time)
 * is a DOM-free, deterministic derivation, so it earns the strict unit + mutation gate exactly as
 * the other widget models (`menuModel.ts`, `netModel.ts`, `sliderModel.ts`) do. The `archive.ts`
 * widget is the DOM/dispatch + IndexedDB IO glue (Playwright).
 *
 * Resolution rules (each with a negative test — agent-principles: genuine tests, negative cases):
 *   - **newest first** — rows are sorted by `startedAt` DESCENDING (the natural browse order); ties
 *     break by `id` ascending (stable, deterministic) so the order never depends on the input array
 *     order the store happened to yield.
 *   - **conflicted flagged** — `result === CONFLICTED_RESULT` sets `conflicted: true`; every other
 *     result string passes through as an ordinary game. A caller uses this to route a conflicted
 *     entry to `loadConflicted` (both forks) rather than `loadGame` (single game).
 *   - **players label is deterministic** — the seat→name map is projected to a `"white vs black"`
 *     style label with seats in a FIXED order (`PLAYER_SEAT_ORDER`), and any seat missing from the
 *     map is shown as `UNKNOWN_PLAYER` — so a partial/empty players map never yields an empty or
 *     order-dependent label.
 *   - **empty archive** — an empty listing yields `{ items: [], isEmpty: true }` so the widget can
 *     render an explicit "no saved games" state rather than a blank list.
 */

/** The `result` marker the archive stores for a conflicted (forked) game (mirrors `archive.ts`). */
export const CONFLICTED_RESULT = 'conflicted';

/**
 * The `result` marker the archive stores for an unfinished, still-playable game (mirrors the
 * `'in-progress'` marker `main.ts` writes when `winner === null`). This is the ONLY result a game
 * can be RESUMED from (Task 6.6): a finished (`*-wins`) game is over and rejects further moves, and a
 * conflicted (forked) game has no single continuable log — both are review-only. Kept as an exported
 * SSOT so the widget/glue and this decision can never drift on what "resumable" means.
 */
export const IN_PROGRESS_RESULT = 'in-progress';

/** The seats projected into a players label, in fixed display order (white first). */
export const PLAYER_SEAT_ORDER = ['white', 'black'] as const;

/** The placeholder shown for a seat with no name in a listing's players map. */
export const UNKNOWN_PLAYER = '—';

/** The separator between the two seat labels in a players label (`"Ann vs Bo"`). */
export const PLAYERS_LABEL_SEPARATOR = ' vs ';

/**
 * The subset of a stored game's metadata this model reads. Structurally compatible with the
 * archive's `GameMeta` (`src/persist/db.ts`) — declared here (not imported) so this pure UI model
 * stays free of the persist layer's types, exactly as the other widget models decouple from render.
 */
export interface ArchiveListingMeta {
  /** Seat → display name / id (opaque strings the archive round-trips). */
  readonly players: Readonly<Record<string, string>>;
  /** Outcome marker, e.g. `'in-progress' | 'white-wins' | 'conflicted'`. */
  readonly result: string;
  /** Epoch millis when the game began — the sort key (newest first). */
  readonly startedAt: number;
  /** The event log's `headHash` — the whole-history fingerprint (GLOSSARY "Hash chain"). */
  readonly headHash: string;
}

/** One archived game as the model consumes it: its stable id + listing metadata (no event log). */
export interface ArchiveListing {
  /** The stable game id (the archive key; a DOM/test handle and the load argument). */
  readonly id: string;
  /** The listing/summary metadata. */
  readonly meta: ArchiveListingMeta;
}

/** A single resolved archive row the DOM renders (and Playwright asserts on). */
export interface ArchiveItem {
  /** The game id — the row's stable handle and the argument passed to load/loadConflicted. */
  readonly id: string;
  /** The deterministic `"white vs black"` players label. */
  readonly playersLabel: string;
  /** The raw result marker (e.g. `'in-progress'`, `'white-wins'`, `'conflicted'`). */
  readonly result: string;
  /** True iff this is a conflicted (forked) game — routes to `loadConflicted`, not `loadGame`. */
  readonly conflicted: boolean;
  /**
   * True iff this row offers REVIEW (Task 6.6): load the game into the scene read-only to browse via
   * the history slider. Always `true` — every archived game is browsable, finished or not.
   */
  readonly canReview: boolean;
  /**
   * True iff this row offers RESUME (Task 6.6): load the game into the scene and CONTINUE PLAYING. Only
   * an {@link IN_PROGRESS_RESULT} game is resumable; a finished or conflicted game is review-only.
   */
  readonly canResume: boolean;
  /** The whole-history fingerprint (`headHash`), surfaced for identity/debugging. */
  readonly headHash: string;
  /** Epoch millis the game began (the row's sort key; the widget formats it for display). */
  readonly startedAt: number;
}

/** The serializable archive view-model the DOM widget renders. */
export interface ArchiveModel {
  /** The archived games as rows, newest first (id tiebreak). */
  readonly items: readonly ArchiveItem[];
  /** True iff there are no archived games — lets the widget show an explicit empty state. */
  readonly isEmpty: boolean;
}

/** The two actions an archive row can offer (Task 6.6): review (read-only) and/or resume (continue). */
export interface ArchiveActions {
  /** Whether the row offers REVIEW — load read-only + browse the history slider. Always true. */
  readonly canReview: boolean;
  /** Whether the row offers RESUME — load + continue playing. Only for an in-progress game. */
  readonly canResume: boolean;
}

/**
 * Decide which actions an archived game with `result` offers (Task 6.6, review vs resume). REVIEW is
 * ALWAYS available — every archived game can be loaded read-only and browsed via the history slider.
 * RESUME is available ONLY for an {@link IN_PROGRESS_RESULT} game: a finished (`*-wins`) game is over
 * and rejects further moves, and a conflicted (forked) game has no single continuable log, so both are
 * review-only. The check is an exact match on the in-progress SSOT (not a mere "not conflicted"),
 * so an unrecognized/other marker is treated conservatively as non-resumable (review-only).
 */
export function resolveArchiveActions(result: string): ArchiveActions {
  return { canReview: true, canResume: result === IN_PROGRESS_RESULT };
}

/**
 * Project a listing's seat→name map to a deterministic `"white vs black"` label. Seats are read in
 * the FIXED {@link PLAYER_SEAT_ORDER} (never the map's own key order), and a seat absent from the
 * map renders as {@link UNKNOWN_PLAYER} — so an empty or partial map yields a stable, non-empty
 * label rather than an order-dependent or blank one.
 */
export function playersLabel(players: Readonly<Record<string, string>>): string {
  return PLAYER_SEAT_ORDER.map((seat) => {
    const name = players[seat];
    return name !== undefined && name.length > 0 ? name : UNKNOWN_PLAYER;
  }).join(PLAYERS_LABEL_SEPARATOR);
}

/**
 * Derive the {@link ArchiveModel} from the archive's listings: sort newest-first (by `startedAt`
 * descending, id ascending as the deterministic tiebreak) and project each to a rendered
 * {@link ArchiveItem} (id / players label / result / conflicted flag / headHash / startedAt).
 *
 * @param listings The archive's `{ id, meta }` listings (no event logs). May be empty.
 * @returns The serializable archive model: the rows newest-first, plus an `isEmpty` flag.
 */
export function deriveArchive(listings: readonly ArchiveListing[]): ArchiveModel {
  const items: ArchiveItem[] = listings
    // `.slice()` first so the subsequent in-place `.sort` never mutates the caller's array (the
    // derivation stays pure — see the "does not mutate the input" test). Unlike `.filter` (which
    // returns a fresh array), we do not drop any entry here, so the copy is required, not dead code.
    .slice()
    // Newest first: `startedAt` DESCENDING (`b - a`). Ties break by `id` ASCENDING via
    // `localeCompare` (a three-way −/0/+ result returned directly) rather than a `<` boolean
    // ternary: two listings CAN share a `startedAt`, so the tiebreak is genuinely exercised, and
    // `localeCompare` has no `<`-vs-`<=` boundary that would leave an equivalent (unkillable)
    // mutant — every ordering mutant is killed by a real reorder test (agent-principles #7).
    .sort((a, b) => b.meta.startedAt - a.meta.startedAt || a.id.localeCompare(b.id))
    .map((listing) => {
      // Review is always offered; resume only for an in-progress game (Task 6.6). Derived here so the
      // action flags ride each row and the widget never re-decides (single source of the decision).
      const actions = resolveArchiveActions(listing.meta.result);
      return {
        id: listing.id,
        playersLabel: playersLabel(listing.meta.players),
        result: listing.meta.result,
        conflicted: listing.meta.result === CONFLICTED_RESULT,
        canReview: actions.canReview,
        canResume: actions.canResume,
        headHash: listing.meta.headHash,
        startedAt: listing.meta.startedAt,
      };
    });

  return { items, isEmpty: items.length === 0 };
}
