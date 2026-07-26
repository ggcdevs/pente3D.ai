/**
 * DIVERGENCE panel widget (Task V.4b, epic **#47**, absorbs **#38**) — the DOM IO glue for the PURE
 * {@link deriveDivergence} view-model (`divergenceModel.ts`).
 *
 * It is the one screen where a player meets the sync protocol, so it is deliberately the plainest
 * thing in the app: a headline, one sentence, two short lists of moves, and at most three buttons.
 * No hashes, no plies in the prose, no "ours/theirs" — the build plan's collaboration point is
 * explicit that this must not read like a merge tool. Every string comes from the pure model; this
 * file paints, it does not decide.
 *
 * ## Shape (mirrors `endStateOverlay.ts`, deliberately)
 *
 * A self-contained widget by the design-Part-6 contract: a stable id (`divergencePanel`, the id the
 * tracked `layout` default places), `mount() → DOM element`, `update()`, knowing nothing about its
 * placement. Like the end-state card it has NO full-viewport backdrop — the board stays visible and
 * orbitable underneath, because seeing the position is half of choosing a resolution. It sits above
 * the end-state card in the stack (a divergence has to be settled before anything else means
 * anything).
 *
 * ## What the buttons do
 *
 * Each option button raises `deps.proposeResolution(choice)` → `session.proposeResolution`, which
 * publishes an out-of-band `resolve:<headHash>` ask over the SHARED N.1 handshake. Accept/Decline
 * raise `deps.respondResolution(accepted)`. Nothing lands until BOTH sides agree; the app applies the
 * agreed effect on the resolution (`session.applyAcceptedResolution`). These are the SAME session
 * entry points `window.__pente.proposeResolution` / `respondResolution` drive, so a button and a test
 * hit one path (design Principle 3).
 *
 * ## Untrusted-input note (the relay is PUBLICLY WRITABLE)
 *
 * Every text node is written with `textContent`, never `innerHTML`. The only peer-derived material
 * reaching the panel is the peer's LOG, and it arrives already rendered by `logDiff`'s replay-driven
 * describer — node coordinates and colours this client derived itself, never opponent free text.
 *
 * It touches `document`, so it is the Playwright-verified IO boundary (`e2e/divergence.spec.ts`
 * drives two real clients into a divergence and resolves it, asserting both converge to one
 * `headHash`), not unit/mutation-gated — the pure model it renders carries that gate.
 */

import type { Widget, WidgetFactory } from '../registry.ts';
import type { DivergenceLine, DivergenceView } from './divergenceModel.ts';
import type { ResolutionChoice } from '../../net/resolution.ts';

/** The stable widget id — matches the `divergencePanel` entry in the tracked `layout` default. */
export const DIVERGENCE_PANEL_ID = 'divergencePanel';

/** The deps the panel needs: a document to build in, the live view-model, and the two actions. */
export interface DivergencePanelDeps {
  readonly doc: Document;
  /** The live divergence card (the app's `session.divergenceView()`). */
  getDivergence(): DivergenceView;
  /** Suggest a resolution → `session.proposeResolution(choice)`. */
  proposeResolution(choice: ResolutionChoice): boolean;
  /** Accept (`true`) / decline (`false`) the peer's suggestion → `session.respondResolution`. */
  respondResolution(accepted: boolean): boolean;
}

/** The pristine (hidden) card used before any readout is supplied (mount / first paint). */
const HIDDEN: DivergenceView = {
  show: false,
  headline: '',
  explanation: '',
  sharedPly: 0,
  mine: [],
  theirs: [],
  options: [],
  ui: 'choose',
  incomingText: null,
  canAccept: false,
  note: null,
};

/** Build the divergence panel {@link WidgetFactory}. */
export function divergencePanelWidget(): WidgetFactory {
  return {
    id: DIVERGENCE_PANEL_ID,
    mount(rawDeps: unknown): Widget {
      const deps = rawDeps as DivergencePanelDeps;
      const doc = deps.doc;

      const element = doc.createElement('div');
      element.className = 'pente-divergence';
      element.setAttribute('data-testid', 'divergence-panel');
      element.setAttribute('role', 'alertdialog');
      element.setAttribute('aria-live', 'polite');
      element.hidden = true;

      const card = doc.createElement('div');
      card.className = 'pente-divergence-card';

      const headline = doc.createElement('div');
      headline.className = 'pente-divergence-headline';
      headline.setAttribute('data-testid', 'divergence-headline');
      card.appendChild(headline);

      const explanation = doc.createElement('div');
      explanation.className = 'pente-divergence-explanation';
      explanation.setAttribute('data-testid', 'divergence-explanation');
      card.appendChild(explanation);

      // The two histories, side by side. Each is a labelled list of the moves only that side has.
      const columns = doc.createElement('div');
      columns.className = 'pente-divergence-columns';
      const mine = buildColumn(doc, 'mine', 'Only in your game');
      const theirs = buildColumn(doc, 'theirs', 'Only in your opponent’s');
      columns.appendChild(mine.column);
      columns.appendChild(theirs.column);
      card.appendChild(columns);

      // The peer's suggestion, said back in our own terms (shown only while answering one).
      const incoming = doc.createElement('div');
      incoming.className = 'pente-divergence-incoming';
      incoming.setAttribute('data-testid', 'divergence-incoming');
      card.appendChild(incoming);

      const note = doc.createElement('div');
      note.className = 'pente-divergence-note';
      note.setAttribute('data-testid', 'divergence-note');
      card.appendChild(note);

      // The offered resolutions: one button per option, rebuilt on each paint so the set and its
      // copy always match the model exactly (the options depend on the shape of the divergence).
      const actions = doc.createElement('div');
      actions.className = 'pente-divergence-actions';
      actions.setAttribute('data-testid', 'divergence-actions');
      card.appendChild(actions);

      const answer = doc.createElement('div');
      answer.className = 'pente-divergence-answer';
      const acceptButton = doc.createElement('button');
      acceptButton.className = 'pente-divergence-accept';
      acceptButton.setAttribute('data-testid', 'divergence-accept');
      acceptButton.textContent = 'Agree';
      acceptButton.addEventListener('click', () => {
        deps.respondResolution(true);
      });
      const declineButton = doc.createElement('button');
      declineButton.className = 'pente-divergence-decline';
      declineButton.setAttribute('data-testid', 'divergence-decline');
      declineButton.textContent = 'No, something else';
      declineButton.addEventListener('click', () => {
        deps.respondResolution(false);
      });
      answer.appendChild(acceptButton);
      answer.appendChild(declineButton);
      card.appendChild(answer);

      element.appendChild(card);

      /** Paint a derived {@link DivergenceView}. */
      function render(view: DivergenceView): void {
        element.hidden = !view.show;
        element.setAttribute('data-show', String(view.show));
        element.setAttribute('data-ui', view.ui);
        // The shared ply is the machine-readable anchor a test asserts BOTH clients agree on.
        element.setAttribute('data-shared-ply', String(view.sharedPly));

        headline.textContent = view.headline;
        explanation.textContent = view.explanation;
        mine.fill(view.mine);
        theirs.fill(view.theirs);

        incoming.textContent = view.incomingText ?? '';
        incoming.hidden = view.incomingText === null;
        note.textContent = view.note ?? '';
        note.hidden = view.note === null;

        actions.replaceChildren();
        for (const option of view.options) {
          actions.appendChild(buildOption(doc, option, () => deps.proposeResolution(option.choice)));
        }

        const answering = view.ui === 'incoming';
        answer.hidden = !answering;
        // Accept is offered only for a suggestion this client can actually honour; otherwise the
        // only honest answer is Decline, and it is the only one reachable.
        acceptButton.hidden = !answering || !view.canAccept;
        declineButton.hidden = !answering;
      }

      render(HIDDEN);
      render(deps.getDivergence());

      return {
        element,
        // Repainted from the live model on every state change the shell pushes — an inbound log that
        // opens or closes a divergence, or a handshake transition (the peer's suggestion, a decline).
        update(): void {
          render(deps.getDivergence());
        },
      };
    },
  };
}

/** One labelled column of divergent moves, with a `fill` that repaints its rows. */
function buildColumn(
  doc: Document,
  side: 'mine' | 'theirs',
  label: string,
): { column: HTMLElement; fill(lines: readonly DivergenceLine[]): void } {
  const column = doc.createElement('div');
  column.className = 'pente-divergence-column';
  column.setAttribute('data-testid', `divergence-${side}`);

  const heading = doc.createElement('div');
  heading.className = 'pente-divergence-column-label';
  heading.textContent = label;
  column.appendChild(heading);

  const list = doc.createElement('ul');
  list.className = 'pente-divergence-list';
  column.appendChild(list);

  return {
    column,
    fill(lines) {
      list.replaceChildren();
      if (lines.length === 0) {
        const empty = doc.createElement('li');
        empty.className = 'pente-divergence-empty';
        empty.textContent = 'nothing';
        list.appendChild(empty);
        return;
      }
      for (const line of lines) {
        const row = doc.createElement('li');
        row.setAttribute('data-ply', String(line.ply));
        row.textContent = line.text;
        list.appendChild(row);
      }
    },
  };
}

/** One resolution button: its label, its one-sentence detail, and the ask it raises. */
function buildOption(
  doc: Document,
  option: { choice: ResolutionChoice; label: string; detail: string },
  onPick: () => void,
): HTMLElement {
  const wrapper = doc.createElement('div');
  wrapper.className = 'pente-divergence-option';

  const button = doc.createElement('button');
  button.className = 'pente-divergence-choose';
  button.setAttribute('data-testid', `divergence-choose-${option.choice}`);
  button.textContent = option.label;
  button.addEventListener('click', onPick);
  wrapper.appendChild(button);

  const detail = doc.createElement('div');
  detail.className = 'pente-divergence-detail';
  detail.textContent = option.detail;
  wrapper.appendChild(detail);

  return wrapper;
}
