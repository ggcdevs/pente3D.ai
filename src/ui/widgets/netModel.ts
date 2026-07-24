/**
 * PURE networking view-model (Task 5.5) — render-ui design Part 6 "Widget roster: host/join +
 * connection/seat status + conflict banner". The companion DOM glue is `net.ts`; the live session
 * it reads is `src/net/session.ts` (the SyncEngine + seat manager wiring — GLOSSARY "Seat",
 * "Conflict", "Room").
 *
 * The networking widget reflects a single plain {@link NetSessionState} readout (phase / game code
 * / seat / peer presence / conflict) into: which sub-panel shows (Host+Join controls while offline,
 * a status sub-panel once connected, a conflict banner once the logs fork), the game code to show +
 * copy, and the inline join-code error. Connection/seat are shown STRUCTURALLY by the presence HUD
 * (dots + "(You)") off the raw session state, not as derived sentences (issue #44 removed the former
 * `statusText`/`seatText`). Turning that state into the serializable model the DOM renders — and
 * validating a typed join code / generating a host code — is a DOM-free, deterministic derivation, so
 * it earns the strict unit + mutation gate exactly as {@link ./menuModel.ts} /
 * {@link ./settingsModel.ts} do. The banner widget is the DOM/dispatch IO glue (Playwright): it
 * dispatches the SAME command ids a keybinding would (design Principle 3 "one action layer").
 *
 * What is PURE here (this file) vs IO glue (`banner.ts` / `session.ts`):
 *   - PURE: `deriveNet` (state → the panel/code/conflict/join-error model), `validateGameCode` (accept/REJECT
 *     a typed join code), `normalizeGameCode` (canonical form), `generateGameCode` (a code from an
 *     INJECTED rng — deterministic given the rng, so unit-testable without a real random source).
 *   - IO glue: dispatching `hostGame`/`joinGame`, reading `getNet()`, the clipboard copy, and the
 *     real transport/SyncEngine/seat orchestration in `session.ts`.
 *
 * Every derivation is deterministic and every validity rule has a negative case (an empty / too-
 * short / bad-character code is REJECTED with a machine-readable reason), so a malformed code is
 * never dispatched (agent-principles: genuine tests, negative cases; #3 observable behavior).
 */

/**
 * The command id the Host control dispatches — the id `session.ts` registers and the menu's "Host"
 * entry (`menuModel.ts`) fires. Kept beside the model so the widget, the menu, and any keybinding
 * agree on one string (design Principle 3, one action layer).
 */
export const HOST_GAME_COMMAND = 'hostGame';

/**
 * The command id the Join control dispatches. The typed code rides alongside the dispatch (the
 * widget stores it on the session's pending-code seam before dispatching), so the command id itself
 * stays argument-free like every other command (undo/redo/openSettings).
 */
export const JOIN_GAME_COMMAND = 'joinGame';

/**
 * The set of characters a game code may contain, and its fixed length: the full alphanumeric set
 * `A-Z` + `0-9` (issue #30). A user who types a CUSTOM code chose it and reasonably expects any
 * alphanumeric to work, so no glyphs are excluded — the earlier ambiguity exclusion (dropping
 * `0/O`, `1/I`, `L`) was over-restrictive here and is removed. This constant is the SSOT for BOTH
 * generation (the alphabet the random host code is drawn from) and validation (the allowed set for a
 * typed code), so the two can never disagree on what a legal code is; both use the same broad set.
 */
export const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** The fixed game-code length. Short enough to type, long enough to avoid room collisions. */
export const CODE_LENGTH = 6;

/** The four phases a networking session moves through, as reported to the widget. */
export type NetPhase =
  /** No room: the Host / Join controls are shown. */
  | 'offline'
  /** A host/join is in flight (transport connecting / claiming a seat). */
  | 'connecting'
  /** In a room with a claimed seat: the connection/seat status line is shown. */
  | 'connected'
  /** The logs forked (GLOSSARY "Conflict"): the game is stopped and the conflict banner is shown. */
  | 'conflict';

/** The seat this client holds once connected (GLOSSARY "Seat"), or `null` before a seat is held. */
export type NetSeat = 'white' | 'black' | null;

/**
 * The plain, serializable session readout the widget renders — produced by `session.ts` off the
 * live SyncEngine + seat manager, and asserted on directly by Playwright (`window.__pente` getNet).
 */
export interface NetSessionState {
  /** The current phase (offline / connecting / connected / conflict). */
  readonly phase: NetPhase;
  /** The room's game code (GLOSSARY "Room" / game code), or `null` while offline. */
  readonly code: string | null;
  /** This client's claimed seat, or `null` before a seat is held. */
  readonly seat: NetSeat;
  /** Whether the other player is present in the room right now (presence). */
  readonly peerPresent: boolean;
  /**
   * The reason a join was refused since the last attempt, or `null`. Drives the inline error under
   * the Join input (e.g. a `room-full` seat rejection, or a transport failure). Distinct from the
   * pre-dispatch code-validation error the widget computes locally via {@link validateGameCode}.
   */
  readonly joinError: JoinErrorReason | null;
}

/**
 * Why a join attempt failed, as reported by the live session (post-dispatch). Every typed admission
 * reject (design §7 — `room-full` / `seat-reserved` / `game-mismatch` / `game-divergent`) surfaces
 * as one of these so the net panel shows a HUMAN message for EVERY reject, not just room-full — plus
 * `connect-failed` for a transport failure. Verbatim to the machine {@link AdmissionReject} reasons
 * (`src/net/sync.ts`) so a new reject reason is a compile error here until it has a human label.
 */
export type JoinErrorReason =
  /** The room already has two seated players and both owners are present (seat manager `room-full`). */
  | 'room-full'
  /** A seat is held for an absent owner and this peer is not that owner (seat manager `seat-reserved`). */
  | 'seat-reserved'
  /** The two peers proposed DIFFERENT games — different game uuids (admission `game-mismatch`). */
  | 'game-mismatch'
  /** The SAME game uuid but forked histories — divergent headHash (admission `game-divergent`). */
  | 'game-divergent'
  /** The transport could not connect (relay unreachable / rejected). */
  | 'connect-failed';

/** Why a typed join code was rejected before dispatch (pure, pre-dispatch validation). */
export type CodeError =
  /** The field is empty / whitespace-only. */
  | 'empty'
  /** Fewer than {@link CODE_LENGTH} characters. */
  | 'too-short'
  /** Contains a character outside {@link CODE_ALPHABET} (after upper-casing). */
  | 'bad-chars';

/** The result of validating a typed join code: the canonical code, or a machine-readable reason. */
export type CodeValidation =
  | { readonly ok: true; readonly code: string }
  | { readonly ok: false; readonly reason: CodeError };

/** Which sub-panel the widget shows for a given phase. */
export type NetPanel =
  /** Host button + Join input/button (offline). */
  | 'controls'
  /** Connection + seat status line (connecting / connected). */
  | 'status'
  /** The conflict banner (conflict). */
  | 'conflict';

/** The serializable networking view-model the DOM widget renders (and Playwright asserts on). */
export interface NetModel {
  /** Which sub-panel is shown (controls / status / conflict). */
  readonly panel: NetPanel;
  /** The game code to display + copy, or `null` when there is none to show (offline). */
  readonly code: string | null;
  /** Whether the conflict banner is shown (the logs forked and the game is stopped). */
  readonly conflict: boolean;
  /** The conflict banner message when {@link conflict} is true, else `null`. */
  readonly conflictText: string | null;
  /** The inline join error to show (post-dispatch session error), or `null` if none. */
  readonly joinErrorText: string | null;
}

/**
 * Human labels for a post-dispatch join failure — kept beside the model (SSOT for the widget). One
 * entry per {@link JoinErrorReason}; the `Record` type makes an unlabeled reason a compile error, so
 * a reject reason can never reach the panel with no message (the exact silent-failure design §7
 * forbids). `game-mismatch`/`game-divergent` name the #38 resolution seam in human terms.
 */
const JOIN_ERROR_TEXT: Record<JoinErrorReason, string> = {
  'room-full': 'That room already has two players.',
  'seat-reserved': 'A seat there is being held for a player who stepped away. Try again later.',
  'game-mismatch': 'You and the other player brought different games.',
  'game-divergent': 'That game has diverged from yours and can’t be joined yet.',
  'connect-failed': 'Could not connect. Check the code and try again.',
};

/** Human labels for a pre-dispatch code-validation failure — the SSOT the widget renders. */
export const CODE_ERROR_TEXT: Record<CodeError, string> = {
  empty: 'Enter a game code.',
  'too-short': `A game code is ${CODE_LENGTH} characters.`,
  'bad-chars': 'Codes use letters A-Z and digits 0-9.',
};

/**
 * Derive the {@link NetModel} from the live {@link NetSessionState}. Pure and deterministic:
 *   - **panel** — `offline` → `controls`; `conflict` → `conflict`; otherwise (`connecting` /
 *     `connected`) → `status`.
 *   - **code** — the game code to display + copy, passed through verbatim (or `null` when offline).
 *   - **conflict** — true iff the phase is `conflict`; `conflictText` carries the banner copy then.
 *   - **joinErrorText** — the human label for a post-dispatch `joinError`, else `null`.
 *
 * The former `statusText` ("Waiting for opponent…" etc.) and `seatText` ("You are White") fields were
 * REMOVED in issue #44: the compact presence HUD (`banner.ts`) shows connection/seat structurally —
 * per-color presence DOTS and a "(You)" marker — rather than as sentences, so the pure model no longer
 * derives those strings (no consumer reads them; grep `statusText`/`seatText`). Presence/seat now ride
 * on the raw {@link NetSessionState} (`peerPresent` / `seat`) the widget reflects directly.
 *
 * @param state The live session readout.
 * @returns The serializable model the DOM renders.
 */
export function deriveNet(state: NetSessionState): NetModel {
  const panel: NetPanel =
    state.phase === 'offline' ? 'controls' : state.phase === 'conflict' ? 'conflict' : 'status';

  const conflict = state.phase === 'conflict';
  const conflictText = conflict
    ? 'Game stopped: the two histories diverged. The game has been saved for review.'
    : null;

  const joinErrorText = state.joinError === null ? null : JOIN_ERROR_TEXT[state.joinError];

  return { panel, code: state.code, conflict, conflictText, joinErrorText };
}

/**
 * Canonicalize a raw code string: trim surrounding whitespace and upper-case it. Used by both
 * {@link validateGameCode} (before checking) and the host path (a generated code is already
 * canonical). Splitting this out keeps "what is the canonical form" in one place.
 */
export function normalizeGameCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Validate a raw typed join code into its canonical form, or reject it with a machine-readable
 * reason (pure — no side effects). Rules, in order:
 *   - `empty`     — nothing but whitespace.
 *   - `too-short` — fewer than {@link CODE_LENGTH} characters.
 *   - `bad-chars` — any character outside {@link CODE_ALPHABET} (after upper-casing).
 *
 * The order matters: empty is reported before length (an empty field is "enter a code", not "too
 * short"), and length before charset (a short-but-clean prefix is "too short", clearer than a
 * charset complaint). A valid code round-trips to its normalized (trimmed, upper-cased) form, so a
 * lower-case or padded paste is accepted and canonicalized rather than rejected.
 */
export function validateGameCode(raw: string): CodeValidation {
  const code = normalizeGameCode(raw);
  if (code.length === 0) return { ok: false, reason: 'empty' };
  if (code.length < CODE_LENGTH) return { ok: false, reason: 'too-short' };
  for (const ch of code) {
    if (!CODE_ALPHABET.includes(ch)) return { ok: false, reason: 'bad-chars' };
  }
  return { ok: true, code };
}

/**
 * Generate a fresh {@link CODE_LENGTH}-character game code from the {@link CODE_ALPHABET}, drawing
 * each character via the injected `rand` (a `() => number` in `[0, 1)`, e.g. `Math.random`). The
 * rng is injected so this stays PURE and deterministic under test: a fixed `rand` yields a fixed
 * code, and the mapping `rand() → alphabet index` is exercised at both ends (index 0 from `0`, the
 * last index from a value at the top of the range) so every off-by-one mutant is killed.
 *
 * The index is clamped to the last valid position so a `rand` that returns exactly `1` (outside the
 * documented `[0, 1)` contract, but cheap to defend against) can never index past the alphabet and
 * yield an `undefined` character — the guard keeps a generated code always {@link validateGameCode}-
 * valid, which the tests assert as a round-trip (including the `rand() === 1` boundary).
 */
export function generateGameCode(rand: () => number): string {
  const last = CODE_ALPHABET.length - 1;
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    const index = Math.min(last, Math.floor(rand() * CODE_ALPHABET.length));
    code += CODE_ALPHABET[index];
  }
  return code;
}
