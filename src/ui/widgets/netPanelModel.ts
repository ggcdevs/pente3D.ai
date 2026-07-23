/**
 * PURE Network-Game-panel view-model (issue #13 / #16; unified entry — S.6, epic #35, closes #31).
 * The companion DOM glue is `netPanel.ts` (the drawer panel wiring the code + the seed selection to
 * the session's `enter(code, proposal)` seam). The panel is:
 *
 *   ONE combobox — a text input plus a dropdown of recently-used codes (the room CODE = a rendezvous
 *   channel, GLOSSARY "Room / code") — PLUS a SEED SELECTOR choosing what GAME to bring into that room
 *   (design §3): **New** (mint a fresh game) / **Resume** (a persisted game from a simple list — the
 *   rich games list is #37) / **Current local board** (the game currently loaded) / **Dealer's choice**
 *   (bring nothing, adopt the opponent's). A single **Enter** button carries the chosen code + seed.
 *   (Randomized is #34 — deliberately absent, no dead control.)
 *     - The input's PLACEHOLDER is a fresh random code, generated (via `generateGameCode`) when the
 *       panel OPENS and passed into this model (the glue owns the randomness; this stays pure).
 *     - The EFFECTIVE code = the typed text (trimmed) when non-empty, else the placeholder — so an
 *       Enter with an untouched input uses the offered random code, and typing overrides it.
 *     - The DROPDOWN lists the recent codes (newest-first from the C.1 store); clicking one fills the
 *       input, and each row has a remove control that drops just that code from the store.
 *
 * This module owns the PURE decisions the panel makes: what the EFFECTIVE code is, whether it is
 * {@link validateGameCode}-valid, the human error for an invalid TYPED code, the canonical code the
 * widget stashes/records, AND — the S.6 addition — which SEED KIND is selected, whether that seed is
 * ACTIONABLE (Resume needs a chosen persisted game; Current needs a live local game; New / Dealer's
 * are always actionable), and the canonical {@link SeedChoice} the glue turns into an admission
 * {@link Proposal}. Whether Enter is enabled = the code is valid AND the seed is actionable. Turning
 * the panel state + the recent-codes + games lists into the serializable model the DOM renders is
 * DOM-free and deterministic, so it earns the strict unit + mutation gate exactly as
 * {@link ./netModel.ts} does. Validation reuses the SAME `validateGameCode` the enter path uses, so
 * the panel can never enable Enter for a code the transport would then reject. The placeholder is
 * always valid by construction (it comes from `generateGameCode`), so an empty input never blocks on
 * the code side.
 *
 * PURITY SEAM: this model does NOT read IndexedDB or the live game's uuid/headHash — the glue passes
 * in the AVAILABLE seed sources (the resume-able games as {@link SeedGame} rows; whether a current
 * local game exists) and the model only DECIDES the selection + actionability. The glue resolves the
 * chosen game id → its uuid/headHash → the concrete admission {@link Proposal} (design §4). Keeping
 * the id→proposal resolution in the glue is what keeps this file free of the persist/net-io layers.
 */

import { validateGameCode, type CodeError, CODE_ERROR_TEXT } from './netModel.ts';

/**
 * A seed kind the selector offers (design §3) — WHAT game a peer brings into the room. Maps to an
 * admission {@link Proposal} kind (the glue resolves the concrete uuid/headHash for `resume`/`current`):
 *   - `new` — mint a fresh game (`{ kind: 'new' }`). Always actionable.
 *   - `resume` — a specific persisted game picked from the games list (`{ kind: 'resume', … }`, #37 is
 *     the rich list; here a simple list). Actionable only once a game is selected.
 *   - `current` — the game currently loaded locally (`{ kind: 'current', … }`). Actionable only when a
 *     live local game exists.
 *   - `defer` — "Dealer's choice": bring nothing, adopt the opponent's (`{ kind: 'defer' }`). Always
 *     actionable.
 * (`random` — a shared randomized board — is #34, deliberately absent from this union: no dead control.)
 */
export type SeedKind = 'new' | 'resume' | 'current' | 'defer';

/** The default seed kind a freshly-opened panel selects — `new`, always actionable (design §3). */
export const DEFAULT_SEED_KIND: SeedKind = 'new';

/**
 * One resume-able persisted game the selector lists (the simple games list — the rich one is #37). The
 * glue supplies these from the archive; the model lists them and, on selection, hands the chosen `id`
 * back so the glue resolves it to a `resume(uuid, headHash)` {@link Proposal}. `uuid`/`headHash` are
 * carried through so the resolution stays a pure lookup in the glue with no second archive read.
 */
export interface SeedGame {
  /** The stable archive game id — the selection handle + the DOM/test key. */
  readonly id: string;
  /** A human label for the row (e.g. "White vs Black · in-progress"), rendered via `textContent`. */
  readonly label: string;
  /** The game's stable UUID (minted at genesis, S.1) — the glue's `resume` proposal identity. */
  readonly uuid: string;
  /** The game's current `headHash` — the glue's `resume` proposal head (divergence check, design §5). */
  readonly headHash: string;
}

/**
 * The panel's editable state — the single source of truth the DOM reflects and the pure mutations
 * below transform. `text` is the raw typed input (any case / whitespace; validated on derive);
 * `placeholder` is the fresh random code offered when the panel opened (shown greyed as the input's
 * HTML placeholder, NOT its value); `recent` is the recent-codes list from the C.1 store (newest-
 * first, canonical). `seedKind` is the selected seed (WHAT game to bring); `resumeId` is the chosen
 * resume game's id (only meaningful when `seedKind === 'resume'`), or `null` if none picked yet. The
 * `games` list is the resume-able persisted games and `hasCurrent` is whether a live local game exists
 * — both AVAILABILITY facts the glue supplies (the model reads, never fetches). The EFFECTIVE code is
 * DERIVED from `text` + `placeholder`, and the seed's actionability from `seedKind` + these lists, by
 * {@link deriveNetPanel} — never stored separately.
 */
export interface NetPanelState {
  /** The raw text typed in the combobox input (any case / whitespace; validated on derive). */
  readonly text: string;
  /** The fresh random code offered when the panel opened — shown as the input's placeholder. */
  readonly placeholder: string;
  /** The recent codes to list in the dropdown, newest-first + canonical (from the C.1 store). */
  readonly recent: readonly string[];
  /** The selected seed kind (WHAT game to bring — design §3). */
  readonly seedKind: SeedKind;
  /** The chosen resume game's id (only when `seedKind === 'resume'`), or `null` if none picked. */
  readonly resumeId: string | null;
  /** The resume-able persisted games the selector lists (the simple list; the rich list is #37). */
  readonly games: readonly SeedGame[];
  /** Whether a live local game exists (so `current` is offerable/actionable). */
  readonly hasCurrent: boolean;
}

/**
 * The seed sources the glue passes when opening the panel: the resume-able persisted `games` and
 * whether a live local game exists (`hasCurrent`). Availability facts the model reads to decide seed
 * actionability — supplied so this module never touches the archive / live game itself (purity seam).
 */
export interface SeedSources {
  /** The resume-able persisted games (a simple list — the rich games list is #37). */
  readonly games: readonly SeedGame[];
  /** Whether a live local game currently exists (so `current` can be seeded). */
  readonly hasCurrent: boolean;
}

/**
 * The initial panel state for a freshly-opened panel: the given fresh random `placeholder`, the given
 * `recent` list, an empty typed input (so Enter defaults to the placeholder code), the given seed
 * `sources`, and the default seed kind ({@link DEFAULT_SEED_KIND} = `new`, always actionable) with no
 * resume game picked yet. The `placeholder` is generated by the glue via `generateGameCode` and the
 * `sources` supplied from the archive + live game — all randomness / IO stays out of this pure module.
 *
 * @param placeholder The fresh random code to offer as the input's placeholder.
 * @param recent The recent codes (newest-first, canonical) from the C.1 store.
 * @param sources The available seed sources (resume-able games + whether a current local game exists).
 */
export function initialNetPanel(
  placeholder: string,
  recent: readonly string[],
  sources: SeedSources,
): NetPanelState {
  return {
    text: '',
    placeholder,
    recent,
    seedKind: DEFAULT_SEED_KIND,
    resumeId: null,
    games: sources.games,
    hasCurrent: sources.hasCurrent,
  };
}

/** Set the typed text (pure, immutable). Leaves the placeholder + recent list + seed untouched. */
export function setPanelText(state: NetPanelState, text: string): NetPanelState {
  return { ...state, text };
}

/**
 * Select a seed KIND (pure, immutable). Switching AWAY from `resume` clears the picked `resumeId` (a
 * stale resume selection must not survive a switch to New/Current/Dealer's, where it is meaningless);
 * switching TO or WITHIN `resume` preserves whatever game was picked. Leaves the code state untouched.
 */
export function setSeedKind(state: NetPanelState, seedKind: SeedKind): NetPanelState {
  const resumeId = seedKind === 'resume' ? state.resumeId : null;
  return { ...state, seedKind, resumeId };
}

/**
 * Pick a specific resume game by its archive `id` (pure, immutable): sets `resumeId` AND selects the
 * `resume` seed kind (picking a game IS choosing to resume it — one action for the call site). Leaves
 * the code state untouched. The glue guards that the id is one of `state.games` before calling.
 */
export function chooseResume(state: NetPanelState, id: string): NetPanelState {
  return { ...state, seedKind: 'resume', resumeId: id };
}

/**
 * Fill the input from a chosen recent code (pure). Clicking a dropdown row copies its code into the
 * typed text so it becomes the effective code (and can then be edited); it is just a targeted
 * {@link setPanelText}, named for the call site's intent.
 */
export function chooseRecent(state: NetPanelState, code: string): NetPanelState {
  return setPanelText(state, code);
}

/**
 * Remove exactly one code from the recent list (pure, immutable). Drops every entry equal to `code`
 * (the store is deduped, so at most one matches) and leaves the rest in order; the typed text +
 * placeholder are untouched. The glue also removes it from the C.1 store; this keeps the rendered
 * model in sync without a re-read.
 */
export function removeRecent(state: NetPanelState, code: string): NetPanelState {
  return { ...state, recent: state.recent.filter((c) => c !== code) };
}

/** A recent-code row the dropdown renders (its code; newest-first order comes from the store). */
export interface NetPanelRecentRow {
  /** The canonical recent code. */
  readonly code: string;
}

/** One seed-kind option row the selector renders (design §3). */
export interface SeedOptionRow {
  /** The seed kind this option selects. */
  readonly kind: SeedKind;
  /** The human label for the option (rendered via `textContent`; SSOT is {@link SEED_LABEL}). */
  readonly label: string;
  /** Whether this is the currently-selected seed kind (drives the DOM's checked/pressed state). */
  readonly selected: boolean;
  /**
   * Whether choosing this kind would be ACTIONABLE right now: `new`/`defer` always; `resume` only when
   * at least one persisted game exists to pick; `current` only when a live local game exists. A
   * non-actionable option is still OFFERED (so the user sees why Enter is blocked), but disabled.
   */
  readonly available: boolean;
}

/** One resume game row the selector renders when `resume` is the selected kind. */
export interface SeedGameRow {
  /** The archive game id — the row's selection handle + DOM/test key. */
  readonly id: string;
  /** The human label for the game (rendered via `textContent`). */
  readonly label: string;
  /** Whether this is the currently-picked resume game. */
  readonly selected: boolean;
}

/**
 * The canonical seed the glue turns into an admission {@link Proposal}. `kind` maps 1:1 to a proposal
 * kind; for `resume` the chosen game's `id` (which the glue resolves to its uuid/headHash) rides
 * along, else `null`. Only produced when the seed is ACTIONABLE — a non-actionable selection yields a
 * `null` `seedChoice` on the model, so the glue never builds a malformed proposal.
 */
export interface SeedChoice {
  /** The seed kind — maps to the admission proposal kind. */
  readonly kind: SeedKind;
  /** The chosen resume game's archive id (only for `kind === 'resume'`), else `null`. */
  readonly resumeId: string | null;
}

/** The serializable Network-Game-panel view-model the DOM renders (and Playwright asserts on). */
export interface NetPanelModel {
  /** The raw typed text to show in the combobox input. */
  readonly text: string;
  /** The placeholder (fresh random code) to show greyed in the empty input. */
  readonly placeholder: string;
  /** The dropdown rows (recent codes, newest-first). */
  readonly recentRows: readonly NetPanelRecentRow[];
  /**
   * The EFFECTIVE code Enter acts on: the trimmed typed text when non-empty, else the placeholder.
   * Never empty in practice (the placeholder is always a valid generated code), so an untouched input
   * enters the offered random room.
   */
  readonly effectiveCode: string;
  /**
   * The CANONICAL (trimmed, upper-cased) effective code when it validates, or `null` when it does
   * not — exactly what the widget stashes and records into the C.1 store, so the panel never hands a
   * malformed code to the transport or the store.
   */
  readonly canonicalCode: string | null;
  /** Whether the effective code validates (one of the two Enter-enablement conditions). */
  readonly codeValid: boolean;
  /**
   * The human error for the TYPED code when it is invalid, or `null` when valid. Reuses the SAME
   * {@link CODE_ERROR_TEXT} labels the inline validation uses (SSOT). Only a non-empty typed code can
   * be invalid — an empty input falls back to the always-valid placeholder, so there is no error then.
   */
  readonly codeError: string | null;
  /** The seed-kind option rows (New / Resume / Current / Dealer's — design §3, in order). */
  readonly seedOptions: readonly SeedOptionRow[];
  /** The selected seed kind (mirrors `state.seedKind`, for the DOM/test to read directly). */
  readonly seedKind: SeedKind;
  /**
   * The resume game rows to show when `resume` is selected (one per persisted game, the picked one
   * flagged). Empty when `resume` is not the selected kind OR there are no persisted games.
   */
  readonly seedGameRows: readonly SeedGameRow[];
  /**
   * Whether the SELECTED seed is ACTIONABLE: `new`/`defer` always; `resume` only with a picked game;
   * `current` only with a live local game. The second Enter-enablement condition (beside `codeValid`).
   */
  readonly seedActionable: boolean;
  /**
   * The canonical {@link SeedChoice} the glue turns into a proposal, or `null` when the selected seed
   * is not actionable — so the widget never dispatches a malformed/incomplete seed.
   */
  readonly seedChoice: SeedChoice | null;
  /**
   * Whether Enter is enabled: the code validates AND the selected seed is actionable. The single
   * enablement fact the button reads (both conditions must hold to hand a code + proposal to enter()).
   */
  readonly canEnter: boolean;
}

/** Human labels for each seed kind — the SSOT the selector renders (design §3 copy). */
export const SEED_LABEL: Record<SeedKind, string> = {
  new: 'New game',
  resume: 'Resume a game',
  current: 'Current local board',
  defer: "Dealer's choice",
};

/** The seed kinds in the order the selector shows them (New first — the default, design §3). */
export const SEED_ORDER: readonly SeedKind[] = ['new', 'resume', 'current', 'defer'];

/**
 * Derive the {@link NetPanelModel} from the combobox {@link NetPanelState}. Pure and deterministic:
 *   - **effectiveCode** — `state.text.trim()` when non-empty, else `state.placeholder`. So an
 *     untouched input uses the offered random code; typing overrides it.
 *   - **canonicalCode / codeValid / codeError** — run the effective code through the SAME
 *     {@link validateGameCode} the join path uses. A valid code yields its canonical form and enables
 *     the buttons; an invalid one yields `null` + the human reason and disables them. The placeholder
 *     is valid by construction, so only a bad TYPED code can disable the buttons.
 *   - **recentRows** — the recent codes verbatim (already newest-first, deduped, canonical from the
 *     C.1 store), one row each for the dropdown.
 *
 * @param state The combobox state.
 * @returns The serializable model the DOM renders.
 */
export function deriveNetPanel(state: NetPanelState): NetPanelModel {
  const typed = state.text.trim();
  const effectiveCode = typed !== '' ? typed : state.placeholder;

  const validation = validateGameCode(effectiveCode);
  const codeValid = validation.ok;
  const canonicalCode = validation.ok ? validation.code : null;
  const codeError = validation.ok ? null : codeErrorText(validation.reason);

  const recentRows: NetPanelRecentRow[] = state.recent.map((code) => ({ code }));

  // Seed selection (design §3). Each kind's AVAILABILITY: new/defer always; resume iff any persisted
  // game exists; current iff a live local game exists. The SELECTED kind is additionally ACTIONABLE
  // only when it is available AND (for resume) a game is actually picked.
  const seedOptions: SeedOptionRow[] = SEED_ORDER.map((kind) => ({
    kind,
    label: SEED_LABEL[kind],
    selected: kind === state.seedKind,
    available: seedAvailable(kind, state),
  }));

  const seedGameRows: SeedGameRow[] =
    state.seedKind === 'resume'
      ? state.games.map((g) => ({ id: g.id, label: g.label, selected: g.id === state.resumeId }))
      : [];

  const seedActionable = isSeedActionable(state);
  const seedChoice: SeedChoice | null = seedActionable
    ? { kind: state.seedKind, resumeId: state.seedKind === 'resume' ? state.resumeId : null }
    : null;

  const canEnter = codeValid && seedActionable;

  return {
    text: state.text,
    placeholder: state.placeholder,
    recentRows,
    effectiveCode,
    canonicalCode,
    codeValid,
    codeError,
    seedOptions,
    seedKind: state.seedKind,
    seedGameRows,
    seedActionable,
    seedChoice,
    canEnter,
  };
}

/**
 * Whether a seed KIND is available to select given the state's sources: `new` and `defer` bring
 * nothing that must exist, so they are ALWAYS available; `resume` needs at least one persisted game;
 * `current` needs a live local game. Used for both the option's disabled flag and the actionability
 * of the selected kind (which additionally requires a picked resume game).
 */
function seedAvailable(kind: SeedKind, state: NetPanelState): boolean {
  switch (kind) {
    case 'new':
    case 'defer':
      return true;
    case 'resume':
      return state.games.length > 0;
    case 'current':
      return state.hasCurrent;
  }
}

/**
 * Whether the SELECTED seed is actionable — the seed half of Enter enablement. `new`/`defer` always;
 * `current` iff a live local game exists; `resume` iff a game is actually PICKED (`resumeId` names one
 * of `state.games`). A `resume` kind with no pick, or a `resumeId` that is not in the list (e.g. a
 * game removed since it was picked), is NOT actionable — the glue then has no valid game to resolve.
 */
function isSeedActionable(state: NetPanelState): boolean {
  switch (state.seedKind) {
    case 'new':
    case 'defer':
      return true;
    case 'current':
      return state.hasCurrent;
    case 'resume':
      return state.resumeId !== null && state.games.some((g) => g.id === state.resumeId);
  }
}

/** Map a validation reason to its human label (SSOT: the same table the inline error uses). */
function codeErrorText(reason: CodeError): string {
  return CODE_ERROR_TEXT[reason];
}
