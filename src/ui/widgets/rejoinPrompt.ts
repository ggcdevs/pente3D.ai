/**
 * REJOIN PROMPT widget (Task V.5, epic **#47**, design §6) — the DOM IO glue for the PURE
 * {@link deriveRejoinPrompt} view-model (`rejoinPromptModel.ts`).
 *
 * A tab reload lands on an EMPTY SLATE, so this card is the one thing that offers a way straight back
 * into a game that was live in a room. It is a QUESTION with two answers and nothing else: no board is
 * loaded and no room is entered until the player picks one, and picking "no" forgets the breadcrumb.
 *
 * Every string comes from the pure model (this file paints, it does not decide) and is written with
 * `textContent`, never `innerHTML` — the copy is derived from a room code and a colour this client
 * derived itself, never from peer free text.
 *
 * Shape mirrors `endStateOverlay.ts`: a stable id (the id the tracked `layout` default places), a
 * centred card with NO backdrop (the empty board stays visible and orbitable underneath), and no input
 * scope push — the prompt is an offer, not a modal that takes the app hostage while it waits.
 *
 * It touches `document`, so it is the Playwright-verified IO boundary (`e2e/rejoinPrompt.spec.ts` drives
 * the real app through the three §6 probe outcomes), not unit/mutation-gated — the pure model it renders
 * carries that gate.
 */

import type { Widget, WidgetFactory } from '../registry.ts';
import { HIDDEN_REJOIN_PROMPT, type RejoinPromptView } from './rejoinPromptModel.ts';

/** The stable widget id — matches the `rejoinPrompt` entry in the tracked `layout` default. */
export const REJOIN_PROMPT_ID = 'rejoinPrompt';

/** The deps the card needs: a document to build in, the live view-model, and the one answer action. */
export interface RejoinPromptDeps {
  readonly doc: Document;
  /** The live rejoin card (the app's `deriveRejoinPrompt` over the breadcrumb + the room probe). */
  getRejoinPrompt(): RejoinPromptView;
  /**
   * Answer it: `true` re-enters (or takes the game to a new code — whichever the view's `action` names),
   * `false` declines and CLEARS the breadcrumb (design §6). The same seam
   * `window.__pente.answerRejoin` drives, so a button and a test hit one path (design Principle 3).
   */
  answerRejoin(confirmed: boolean): boolean;
}

/** Build the rejoin-prompt {@link WidgetFactory}. */
export function rejoinPromptWidget(): WidgetFactory {
  return {
    id: REJOIN_PROMPT_ID,
    mount(rawDeps: unknown): Widget {
      const deps = rawDeps as RejoinPromptDeps;
      const doc = deps.doc;

      const element = doc.createElement('div');
      element.className = 'pente-rejoin';
      element.setAttribute('data-testid', 'rejoin-prompt');
      element.setAttribute('role', 'alertdialog');
      element.setAttribute('aria-live', 'polite');
      element.hidden = true;

      const card = doc.createElement('div');
      card.className = 'pente-rejoin-card';

      const headline = doc.createElement('div');
      headline.className = 'pente-rejoin-headline';
      headline.setAttribute('data-testid', 'rejoin-headline');
      card.appendChild(headline);

      const detail = doc.createElement('div');
      detail.className = 'pente-rejoin-detail';
      detail.setAttribute('data-testid', 'rejoin-detail');
      card.appendChild(detail);

      const actions = doc.createElement('div');
      actions.className = 'pente-rejoin-actions';

      const confirmButton = doc.createElement('button');
      confirmButton.className = 'pente-rejoin-confirm';
      confirmButton.setAttribute('data-testid', 'rejoin-confirm');
      confirmButton.addEventListener('click', () => {
        deps.answerRejoin(true);
      });
      actions.appendChild(confirmButton);

      const declineButton = doc.createElement('button');
      declineButton.className = 'pente-rejoin-decline';
      declineButton.setAttribute('data-testid', 'rejoin-decline');
      declineButton.addEventListener('click', () => {
        deps.answerRejoin(false);
      });
      actions.appendChild(declineButton);

      card.appendChild(actions);
      element.appendChild(card);

      /** Paint a derived {@link RejoinPromptView}. */
      function render(view: RejoinPromptView): void {
        element.hidden = !view.show;
        element.setAttribute('data-show', String(view.show));
        // The machine-readable facts a test asserts on: WHICH §6 outcome this is, what YES does, and
        // the colour the card claims (`none` when the game owns no seat for us — the model's rule).
        element.setAttribute('data-outcome', view.outcome ?? 'none');
        element.setAttribute('data-action', view.action ?? 'none');
        element.setAttribute('data-colour', view.colour ?? 'none');
        element.setAttribute('data-code', view.code);

        headline.textContent = view.headline;
        detail.textContent = view.detail;
        confirmButton.textContent = view.confirmLabel;
        declineButton.textContent = view.declineLabel;
      }

      render(HIDDEN_REJOIN_PROMPT);
      render(deps.getRejoinPrompt());

      return {
        element,
        // Repainted from the live model on every state change the shell pushes — the boot probe
        // producing an offer, and the answer dismissing it.
        update(): void {
          render(deps.getRejoinPrompt());
        },
      };
    },
  };
}
