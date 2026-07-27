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
 *
 * ## Task V.6 (epic #47, ticket #37) — the games list is the ONLY route back to a game
 *
 * v3.1 deletes the code→game mapping (design §2) and makes a reload land on an EMPTY SLATE (§6), so
 * this list is how a player returns to a game at all (§10). That turns three more decisions into
 * pure, gated logic here rather than DOM judgement calls:
 *
 *   - **status + grouping** — every row carries an {@link ArchiveStatus} (`unfinished` / `finished` /
 *     `conflicted`) and the model groups the rows under it in {@link STATUS_ORDER}. UNFINISHED leads,
 *     and its section is emitted EVEN WHEN EMPTY (with {@link STATUS_EMPTY_TEXT}) because "what can I
 *     get back into" is the question the list exists to answer — an empty answer must be stated. The
 *     other sections are omitted when empty (no heading over nothing).
 *   - **resume BY GAME UUID** — {@link selectResumeTarget} resolves a game's portable `uuid`
 *     (design §2.2) to the RECORD to load, or a typed refusal. The uuid is the identity a game keeps
 *     across records (a pre-V.5 record keyed by a retired autosave id, a conflicted record keyed by
 *     its conflict id), which is exactly why the resume handle is the uuid and not the record key.
 *   - **the Resume SEED list** — {@link deriveSeedGames} projects the same listings into the
 *     Network-Game panel's Resume selector, so the browser and the panel can never disagree about what
 *     a game IS. What each OFFERS differs, because they are different questions: the browser's Resume
 *     button continues a game locally (unfinished only), while a seed hands a game to a room — which
 *     design §3 lists as "finished + unfinished", a finished game being brought in to look at
 *     together. A conflicted record is the only thing that cannot be seeded: it has no single log.
 */

import type { SeedGame } from './netPanelModel.ts';

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
 * What a listed game's `result` marker means for GETTING BACK INTO it (Task V.6) — the browse axis
 * ticket #37 asks for. `unfinished` is the only continuable state; `conflicted` is a fork with no
 * single continuable log; `finished` is everything else — a won game, and any marker this build does
 * not recognize (an older/foreign write), both of which are review-only.
 */
export type ArchiveStatus = 'unfinished' | 'finished' | 'conflicted';

/**
 * The order the status sections are listed in. UNFINISHED FIRST: with reload → empty slate and no
 * code→game mapping, "which games can I get back into" is what a player opens this list to find.
 */
export const STATUS_ORDER: readonly ArchiveStatus[] = ['unfinished', 'finished', 'conflicted'];

/** The section heading rendered for each status. */
export const STATUS_LABEL: Record<ArchiveStatus, string> = {
  unfinished: 'Unfinished',
  finished: 'Finished',
  conflicted: 'Conflicted',
};

/**
 * What a status section says when it holds nothing. Only the UNFINISHED section is ever rendered
 * empty (see {@link deriveArchive}); the other two are here so the rule stays uniform and the copy
 * has one home if a future section is shown empty too.
 */
export const STATUS_EMPTY_TEXT: Record<ArchiveStatus, string> = {
  unfinished: 'No unfinished games — nothing to resume.',
  finished: 'No finished games yet.',
  conflicted: 'No conflicted games.',
};

/** The separator between a seed row's players label and its head fingerprint. */
export const SEED_LABEL_SEPARATOR = ' · ';

/** How many leading characters of a `headHash` a seed label shows (enough to tell games apart). */
export const SHORT_HEAD_HASH_CHARS = 7;

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
  /**
   * The GAME's portable UUID (design §2.2), minted at genesis and part of the hashed history —
   * distinct from the record {@link ArchiveListing.id}, which is only the local store key. This is
   * the identity a game keeps across records, so it is what RESUME is keyed by (Task V.6).
   */
  readonly uuid: string;
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
  /** The RECORD id — the row's stable handle and the argument passed to review/loadConflicted. */
  readonly id: string;
  /** The GAME's portable uuid — the argument RESUME is keyed by (Task V.6, design §2.2). */
  readonly uuid: string;
  /** The deterministic `"white vs black"` players label. */
  readonly playersLabel: string;
  /** The raw result marker (e.g. `'in-progress'`, `'white-wins'`, `'conflicted'`). */
  readonly result: string;
  /** What the result means for getting back into the game (Task V.6) — the grouping key. */
  readonly status: ArchiveStatus;
  /** The human label for {@link status} (the section heading this row sits under). */
  readonly statusLabel: string;
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

/** One status SECTION of the browser: its rows (newest-first) or an explicit empty note. */
export interface ArchiveGroup {
  /** The status every row in this section shares. */
  readonly status: ArchiveStatus;
  /** The section heading ({@link STATUS_LABEL}). */
  readonly label: string;
  /** This section's rows, newest-first (a subsequence of {@link ArchiveModel.items}). */
  readonly items: readonly ArchiveItem[];
  /** True iff the section holds no rows — the widget then renders {@link emptyText}. */
  readonly isEmpty: boolean;
  /** What to say when the section is empty ({@link STATUS_EMPTY_TEXT}). */
  readonly emptyText: string;
}

/** The serializable archive view-model the DOM widget renders. */
export interface ArchiveModel {
  /** The archived games as rows, newest first (id tiebreak). */
  readonly items: readonly ArchiveItem[];
  /**
   * The rows grouped by status in {@link STATUS_ORDER} (Task V.6). Empty for an empty archive (the
   * global empty state speaks instead). Otherwise the UNFINISHED section is ALWAYS present — empty
   * or not — and the finished/conflicted sections appear only when they hold something.
   */
  readonly groups: readonly ArchiveGroup[];
  /** True iff there are no archived games — lets the widget show an explicit empty state. */
  readonly isEmpty: boolean;
}

/** Why a RESUME was refused — a typed reason, surfaced to the player, never masked. */
export type ResumeRefusal =
  /**
   * No record holds that game any more: no listed game carries the uuid (the row went stale, or
   * another tab collected it), or the record the listing named vanished before the load reached it.
   * One reason for both because they are one fact — the game is not there.
   */
  | 'not-found'
  /** The game is listed, but it is over or forked — review-only, so there is nothing to continue. */
  | 'not-resumable'
  /**
   * That game is the one a LIVE session holds. Its record is the session's to write (design §2/§7),
   * so the app must not become a second writer of it.
   */
  | 'session-live'
  /**
   * A room is running, so the session's game is what the scene renders
   * (`netRouting.shouldRenderSessionGame`). Loading ANY archived game into the scene-local slot now
   * would put it somewhere nobody can see — the silent no-op this reason replaces. Applied by BOTH
   * routes into the scene, {@link selectResumeTarget} and {@link selectReviewTarget}: it was resume-only
   * at first, which left Review doing exactly the invisible load this describes.
   */
  | 'session-active'
  /**
   * The record was found but could not be turned back into a game — a corrupt/illegal stored log
   * (an `ArchiveError`), or an IndexedDB failure. Reported as damage, never as "no such game".
   */
  | 'unreadable';

/**
 * What to TELL THE PLAYER for each refusal — the single source of the copy, beside the reasons it
 * explains. A `Record` keyed by the union makes an unlabeled reason a compile error, so a refusal can
 * never reach the modal with nothing to say (the failure this replaced: every refusal was a silent
 * `log.error` and a closed modal, so clicking Resume did nothing at all).
 */
export const RESUME_REFUSAL_TEXT: Record<ResumeRefusal, string> = {
  'not-found': 'That game is no longer saved on this device.',
  'not-resumable': 'That game can’t be continued — it is finished or forked. Review it instead.',
  'session-live': 'That game is the one this room is playing — it is already on screen.',
  'session-active': 'You are in a room. Leave it first to get back into another game.',
  unreadable: 'That saved game could not be read — it may be damaged.',
};

/** Every {@link ResumeRefusal} that exists, DERIVED from the label record (never a second list). */
export const RESUME_REFUSAL_REASONS: readonly ResumeRefusal[] = Object.keys(
  RESUME_REFUSAL_TEXT,
) as ResumeRefusal[];

/**
 * What the LIVE net session means for a resume (Task V.6 review follow-up, ticket #37). Both facts
 * are needed and neither implies the other: a session can HOLD a game while no longer being
 * authoritative (after a conflict stop the scene renders its local board again), and it is
 * authoritative for exactly one game while every OTHER row in the list is still clickable.
 */
export interface ResumeSession {
  /** The game uuid the session HOLDS, or `null` when it holds none (offline / never entered). */
  readonly heldGameUuid: string | null;
  /**
   * True while the session is AUTHORITATIVE — the scene renders ITS game rather than the
   * scene-local one (`net/netRouting.ts` `shouldRenderSessionGame`, the same predicate the place
   * path routes on).
   */
  readonly authoritative: boolean;
}

/** The session state of a browser with no room running — what an offline app passes. */
export const OFFLINE_SESSION: ResumeSession = { heldGameUuid: null, authoritative: false };

/** The outcome of resolving a game uuid to something the glue can load (Task V.6). */
export type ResumeSelection =
  | {
      readonly ok: true;
      /** The game's uuid, echoed back (the identity the glue loads by). */
      readonly uuid: string;
      /** The RECORD id holding it — the row the decision was taken on. */
      readonly id: string;
    }
  | { readonly ok: false; readonly reason: ResumeRefusal };

/**
 * What a RESUME attempt did, as the widget sees it: it landed, or it was refused with a reason the
 * modal states. The glue returns this instead of resolving `void`, because a refusal that only
 * reaches a log is invisible — the modal closed and the app did nothing (agent-principles #1/#3).
 */
export type ResumeOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ResumeRefusal };

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
  return { canReview: true, canResume: resolveArchiveStatus(result) === 'unfinished' };
}

/**
 * Classify a stored `result` marker for BROWSING (Task V.6, ticket #37): {@link IN_PROGRESS_RESULT}
 * is `unfinished` (the only continuable state — see {@link resolveArchiveActions}, which is this same
 * decision), {@link CONFLICTED_RESULT} is `conflicted`, and EVERYTHING ELSE is `finished`.
 *
 * The catch-all is deliberate and conservative: a `*-wins` marker means the game is over, and an
 * unrecognized marker (an older or foreign build's) is not something this build knows how to
 * continue — both are review-only, which is exactly what "finished" promises the player. The row
 * still carries its raw `result`, so nothing is hidden by the classification.
 */
export function resolveArchiveStatus(result: string): ArchiveStatus {
  if (result === IN_PROGRESS_RESULT) return 'unfinished';
  if (result === CONFLICTED_RESULT) return 'conflicted';
  return 'finished';
}

/**
 * The leading {@link SHORT_HEAD_HASH_CHARS} characters of a `headHash` — the fingerprint a seed row
 * shows so two games with the same players (the common case: an unnamed local board is
 * `"— vs —"`) are still tellable apart. A shorter hash is returned unchanged.
 */
export function shortHeadHash(headHash: string): string {
  return headHash.slice(0, SHORT_HEAD_HASH_CHARS);
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
 * descending, id ascending as the deterministic tiebreak), project each to a rendered
 * {@link ArchiveItem} (record id / game uuid / players label / result + status / conflicted flag /
 * headHash / startedAt), and group the rows by status (Task V.6).
 *
 * EVERY listing yields EXACTLY ONE ROW — one row per RECORD, not per game uuid. Nothing is filtered
 * here and nothing is merged (V.1 deleted the internal `net-room:{code}` records the old marker
 * filter existed for): what the archive lists is what the player sees.
 *
 * V.5 keys a record by its game's uuid, so ONE row per game is the normal shape — but it is not an
 * invariant this model may assume. Two records can genuinely claim one uuid: the V.5 migration
 * (`persist/archive.ts` `rekeyArchiveRecordsByGameUuid`) deliberately leaves a divergent record where
 * it is rather than delete a history it cannot prove is contained. Merging or hiding one of them here
 * would hide exactly the history that migration refused to destroy, so both are shown and
 * {@link selectResumeTarget} decides which one a resume continues.
 *
 * @param listings The archive's `{ id, meta }` listings (no event logs). May be empty.
 * @returns The serializable archive model: the rows newest-first, their sections, and `isEmpty`.
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
      const status = resolveArchiveStatus(listing.meta.result);
      return {
        id: listing.id,
        uuid: listing.meta.uuid,
        playersLabel: playersLabel(listing.meta.players),
        result: listing.meta.result,
        status,
        statusLabel: STATUS_LABEL[status],
        conflicted: listing.meta.result === CONFLICTED_RESULT,
        canReview: actions.canReview,
        canResume: actions.canResume,
        headHash: listing.meta.headHash,
        startedAt: listing.meta.startedAt,
      };
    });

  // Sections (Task V.6). An EMPTY archive gets no sections at all — the global empty state is the
  // whole message. Otherwise UNFINISHED is always emitted, even holding nothing, because "what can I
  // get back into" is the question this list exists to answer and an empty answer must be SAID; the
  // other sections appear only when they hold rows, so no heading ever sits over nothing.
  const groups: ArchiveGroup[] =
    items.length === 0
      ? []
      : STATUS_ORDER.map((status) => {
          const groupItems = items.filter((item) => item.status === status);
          return {
            status,
            label: STATUS_LABEL[status],
            items: groupItems,
            isEmpty: groupItems.length === 0,
            emptyText: STATUS_EMPTY_TEXT[status],
          };
        }).filter((group) => !group.isEmpty || group.status === 'unfinished');

  return { items, groups, isEmpty: items.length === 0 };
}

/**
 * Resolve a GAME UUID (design §2.2) to the archived record the app should load to CONTINUE it —
 * the resume path's one decision (Task V.6, ticket #37).
 *
 * Keyed by the uuid, not the record id, because the uuid is what a game keeps: a conflicted record
 * is stored under its conflict id, and a record an older build wrote lives under its retired autosave
 * id until the boot re-key moves it. The RESUMABLE claimant wins when more than one record claims a
 * uuid — a conflicted record carries the same game's uuid, so picking the first match by order would
 * refuse a game that genuinely can be continued.
 *
 * THE LIVE SESSION IS PART OF THE DECISION, not a separate guard bolted onto the caller, so BOTH of
 * its refusals are stated in one place and neither can be forgotten:
 *
 *   - the game the session HOLDS is refused (`session-live`): that record is the SESSION's to write
 *     (design §2/§7 — it is the writer of the identity-owned seat map), so the app loading the
 *     archived snapshot as a local board would put a second writer on one record;
 *   - while the session is AUTHORITATIVE, EVERY OTHER row is refused too (`session-active`): the
 *     scene renders the session's game (`shouldRenderSessionGame`), so a game loaded into the
 *     scene-local slot would land off screen. Guarding only the session's own uuid left every other
 *     Resume button a silent no-op — the player clicked, the list closed, and the board never changed.
 *
 * Refusals are TYPED and distinct so the caller can SAY which one happened
 * ({@link RESUME_REFUSAL_TEXT}) instead of silently doing nothing.
 */
/**
 * Whether a REVIEW of the record `id` may go ahead, or the typed reason it may not (Task V.6 review
 * follow-up, ticket #37). The pure sibling of {@link selectResumeTarget}, and it exists because the
 * two buttons sit in the SAME row and were not held to the same rule: resume grew both session
 * guards while review kept none, so clicking Review inside a room loaded a board into the
 * scene-local slot while the scene renders the SESSION's game — the load happened, and the player
 * saw nothing change.
 *
 * Only the `session-active` guard applies. `session-live` does not: reviewing the game the room is
 * playing is a read-only look at a record, not a second writer of it — but it is still refused by
 * the active-room rule, for the same reason as any other row.
 */
export function selectReviewTarget(
  model: ArchiveModel,
  id: string,
  session: ResumeSession,
): ResumeSelection {
  if (session.authoritative) return { ok: false, reason: 'session-active' };
  const item = model.items.find((candidate) => candidate.id === id);
  if (item === undefined) return { ok: false, reason: 'not-found' };
  return { ok: true, uuid: item.uuid, id: item.id };
}

export function selectResumeTarget(
  model: ArchiveModel,
  uuid: string,
  session: ResumeSession,
): ResumeSelection {
  if (session.heldGameUuid === uuid) return { ok: false, reason: 'session-live' };
  if (session.authoritative) return { ok: false, reason: 'session-active' };
  const claimants = model.items.filter((item) => item.uuid === uuid);
  if (claimants.length === 0) return { ok: false, reason: 'not-found' };
  const resumable = claimants.find((item) => item.canResume);
  if (resumable === undefined) return { ok: false, reason: 'not-resumable' };
  return { ok: true, uuid: resumable.uuid, id: resumable.id };
}

/**
 * Project the SAME listings into the Network-Game panel's Resume selector (design §3 "Resume — pick
 * from your **games list** (finished + unfinished) → seed that UUID (#37)"; Task V.6 wires the panel
 * to this list so the two can never disagree about what a game is).
 *
 * FINISHED GAMES ARE OFFERED, exactly as that design line says: seeding a game that is over is how two
 * players bring a finished game into a room to look at it together (it is also what #36 spectator and
 * #33 networked slider are about), and the N.2 rematch handshake is how they then start playing. A
 * CONFLICTED record is the one thing that cannot be seeded — it has no single continuable log, so
 * there is no one history to hand the room. This is deliberately a WIDER rule than the browser's
 * Resume button ({@link ArchiveItem.canResume}, unfinished only — a finished game rejects further
 * moves locally); the two answer different questions, so each states its own rule against the same
 * rows rather than sharing one that fits neither.
 *
 * Rows come in the same newest-first order, minus the uuids the caller excludes (the board already
 * loaded, and the live networked game: offering to "resume" the game you are playing is a confusing
 * self-reference, not a seed). A `null` exclusion is IGNORED, so a source that has no game right now
 * (there is no live net game offline) excludes nothing rather than matching a literal `"null"` uuid.
 *
 * The label is the players label plus a short head fingerprint, because local boards share the same
 * `"— vs —"` players and would otherwise render as a column of identical rows.
 */
export function deriveSeedGames(
  listings: readonly ArchiveListing[],
  excludeUuids: readonly (string | null)[],
): readonly SeedGame[] {
  // A `null` entry is carried into the set rather than filtered out: a row's `uuid` is always a
  // string, so a null can never match one, and NOT having a filter here means there is no branch to
  // get wrong (the two conditions a filter would introduce were both provably equivalent mutants —
  // a structural fix, not a rule about them).
  const excluded = new Set<string | null>(excludeUuids);
  return deriveArchive(listings)
    .items.filter((item) => !item.conflicted && !excluded.has(item.uuid))
    .map((item) => ({
      id: item.id,
      label: `${item.playersLabel}${SEED_LABEL_SEPARATOR}${shortHeadHash(item.headHash)}`,
      uuid: item.uuid,
      headHash: item.headHash,
    }));
}
