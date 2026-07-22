/**
 * Networked END-STATE overlay widget (Task N.2.2, issue #12 win/rematch flow) — the DOM IO glue for
 * the PURE {@link deriveEndState} view-model (`src/net/endState.ts`, Task N.2.1). It REPLACES the
 * blocking `window.confirm('Game over — play another?')` that used to fire at `main.ts` on a finished
 * networked game.
 *
 * ## Non-blocking, view-only, board-stays-visible
 *
 * A self-contained widget by the design-Part-6 contract: a stable string id (`endStateOverlay`, the
 * id the tracked `layout` default places), `mount() → DOM element`, `update(...)`, knowing NOTHING
 * about its placement (the zone-based `layout` config drives that). Unlike the help/archive MODALS it
 * has **NO full-viewport backdrop** — the finished, read-only board STAYS VISIBLE and the overlay is
 * a small centred card whose ONLY interactive surface is its own panel (`pointer-events: auto` on the
 * card, the root stays click-through). So the win overlay never hides the board it is describing (the
 * plan-of-record N.2 decision 2: "a view-only end-state overlay … the read-only won board" stays up).
 *
 * ## What it shows (all from the pure model — this file paints, it does not decide)
 *
 * On every state change the app pushes, the widget re-reads the live {@link EndState} via
 * `deps.getEndState()` (which the app derives from the authoritative {@link GameState} + the N.1
 * handshake + this client's seat) and paints it:
 *
 *   - `show === false` → the whole card is hidden (an in-progress OR a LOCAL game shows nothing).
 *   - `show === true` → the result sentence (`resultText`) + a rematch control that mirrors the
 *     `rematchUi` sub-state:
 *       - `idle` / `declined` → a **Rematch** button (declined adds a one-line "declined" note).
 *       - `proposed-waiting` → "Waiting for opponent…" (WE proposed; the button is spent).
 *       - `incoming` → **Accept** / **Decline** (the OPPONENT proposed).
 *       - `accepted` → "Starting a fresh game…" (both sides reset — the app swaps seats + restarts).
 *
 * The Rematch button dispatches through `deps.proposeRematch()` (→ `session.propose('rematch')`);
 * Accept/Decline through `deps.respondRematch(accepted)` (→ `session.respond(accepted)`). These are
 * the SAME session handshake API the two-context e2e drives via `window.__pente.propose`/`respond`,
 * so a button and a test hit one path (design Principle 3, one action layer).
 *
 * ## Untrusted-input note (the relay is PUBLICLY WRITABLE)
 *
 * The overlay renders EVERY text node via `textContent` — NEVER `innerHTML`. The only opponent-
 * derivable input reaching this widget is the winner/win-reason folded into `resultText`, and that is
 * already an enumerated, non-free-text string minted by the pure model from the authoritative
 * `Player` union (`endState.ts` "Untrusted-input note"), not attacker free text. `textContent` here
 * is the belt-and-suspenders second line of defence so nothing networked can ever be interpreted as
 * markup (agent-principles: treat all networked/opponent data as untrusted).
 *
 * It touches `document`, so it is the Playwright-verified IO boundary (asserted on `window.__pente`
 * getEndState + the OTHER context's state + real button clicks), not unit/mutation-gated — the pure
 * `deriveEndState` it renders carries the strict unit+fast-check+mutation gate in `endState.test.ts`.
 * `data-testid`/`data-*` attributes expose the rendered model for readback (agent-principles #3).
 */

import type { Widget, WidgetFactory } from '../registry.ts';
import type { EndState, RematchUi } from '../../net/endState.ts';

/** The stable widget id — matches the `endStateOverlay` entry in the tracked `layout` default. */
export const END_STATE_OVERLAY_ID = 'endStateOverlay';

/**
 * The deps the end-state overlay needs: a document to build in (injected for testability), the live
 * {@link EndState} readout (the app derives it from the authoritative game + N.1 handshake + seat via
 * the pure `deriveEndState`), and the two rematch actions wired to the session's handshake API.
 */
export interface EndStateOverlayDeps {
  readonly doc: Document;
  /** The live end-state view-model the overlay renders (produced by the app's `deriveEndState`). */
  getEndState(): EndState;
  /** Raise a rematch proposal → `session.propose('rematch')`. Returns whether it was raised. */
  proposeRematch(): boolean;
  /** Accept (`true`) / decline (`false`) an incoming rematch → `session.respond(accepted)`. */
  respondRematch(accepted: boolean): boolean;
}

/** The pristine (hidden) end-state used before any readout is supplied (mount / first paint). */
const HIDDEN_STATE: EndState = {
  show: false,
  winner: null,
  winReason: null,
  iWon: false,
  resultText: '',
  rematchUi: 'idle',
};

/**
 * The rematch-sub-state → note-line copy for the states that do NOT show a primary button set. Kept
 * as an explicit map (not string arithmetic) so each arm is enumerated and testable; the `idle` and
 * `incoming` arms have no note (they render buttons instead) and never reach here.
 */
const NOTE_TEXT: Readonly<Record<RematchUi, string>> = {
  idle: '',
  incoming: '',
  'proposed-waiting': 'Waiting for opponent…',
  accepted: 'Starting a fresh game…',
  declined: 'Opponent declined.',
};

/**
 * Build the end-state overlay {@link WidgetFactory}. The mounted element is a hidden centred card
 * (no backdrop — the board stays visible). `update` re-reads the live {@link EndState} and paints
 * exactly the result + the one rematch control the `rematchUi` names.
 */
export function endStateOverlayWidget(): WidgetFactory {
  return {
    id: END_STATE_OVERLAY_ID,
    mount(rawDeps: unknown): Widget {
      const deps = rawDeps as EndStateOverlayDeps;
      const doc = deps.doc;

      // Root: a fixed, centred, click-THROUGH overlay (only the card re-enables pointer-events) so
      // the read-only board underneath stays visible AND interactive (orbit/scrub) — no backdrop.
      const element = doc.createElement('div');
      element.className = 'pente-endstate';
      element.setAttribute('data-testid', 'endstate-overlay');
      element.setAttribute('role', 'status');
      element.setAttribute('aria-live', 'polite');
      element.hidden = true;

      const card = doc.createElement('div');
      card.className = 'pente-endstate-card';

      // Result sentence (who won + how) — rendered via textContent (never innerHTML).
      const result = doc.createElement('div');
      result.className = 'pente-endstate-result';
      result.setAttribute('data-testid', 'endstate-result');
      card.appendChild(result);

      // A single note line (waiting / declined / starting) — shown for the button-less sub-states.
      const note = doc.createElement('div');
      note.className = 'pente-endstate-note';
      note.setAttribute('data-testid', 'endstate-note');
      card.appendChild(note);

      // The rematch controls: a Rematch button (idle/declined) and an Accept/Decline pair (incoming).
      // Exactly one group is shown per sub-state; both are hidden for the waiting/accepted notes.
      const actions = doc.createElement('div');
      actions.className = 'pente-endstate-actions';

      const rematchButton = doc.createElement('button');
      rematchButton.className = 'pente-endstate-rematch';
      rematchButton.setAttribute('data-testid', 'endstate-rematch');
      rematchButton.textContent = 'Rematch';
      rematchButton.addEventListener('click', () => {
        deps.proposeRematch();
      });
      actions.appendChild(rematchButton);

      const acceptButton = doc.createElement('button');
      acceptButton.className = 'pente-endstate-accept';
      acceptButton.setAttribute('data-testid', 'endstate-accept');
      acceptButton.textContent = 'Accept';
      acceptButton.addEventListener('click', () => {
        deps.respondRematch(true);
      });
      actions.appendChild(acceptButton);

      const declineButton = doc.createElement('button');
      declineButton.className = 'pente-endstate-decline';
      declineButton.setAttribute('data-testid', 'endstate-decline');
      declineButton.textContent = 'Decline';
      declineButton.addEventListener('click', () => {
        deps.respondRematch(false);
      });
      actions.appendChild(declineButton);

      card.appendChild(actions);
      element.appendChild(card);

      /** Paint a derived {@link EndState} onto the card (show exactly the one rematch control). */
      function render(es: EndState): void {
        element.hidden = !es.show;
        element.setAttribute('data-show', String(es.show));
        element.setAttribute('data-rematch', es.rematchUi);
        element.setAttribute('data-iwon', String(es.iWon));

        // Result sentence — the enumerated, non-free-text string from the pure model, via textContent.
        result.textContent = es.resultText;

        // The note line (waiting / declined / starting), or empty for the button sub-states.
        const noteText = NOTE_TEXT[es.rematchUi];
        note.textContent = noteText;
        note.hidden = noteText.length === 0;

        // The Rematch button shows only when a new ask is possible: idle, or after a decline (either
        // side may re-propose). It is HIDDEN once we've proposed (waiting), an ask is incoming, or the
        // rematch was accepted (a fresh game is starting) — so a spent button can't raise a duplicate.
        const showRematch = es.rematchUi === 'idle' || es.rematchUi === 'declined';
        rematchButton.hidden = !showRematch;

        // Accept/Decline show only for an INCOMING proposal (the opponent asked).
        const showRespond = es.rematchUi === 'incoming';
        acceptButton.hidden = !showRespond;
        declineButton.hidden = !showRespond;
      }

      // First paint from the live readout (falls back to hidden if the app is not yet wired).
      render(HIDDEN_STATE);
      render(deps.getEndState());

      return {
        element,
        // The overlay repaints from the live end-state on every state change the shell pushes — a
        // board move (a win appears), a handshake transition (an incoming ask / a resolution), or a
        // reset (the fresh game hides it). All route through the container's `update`.
        update(): void {
          render(deps.getEndState());
        },
      };
    },
  };
}
