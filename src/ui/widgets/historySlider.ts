/**
 * History-slider widget (Task 5.6) — the DOM/scrub IO glue for the pure {@link deriveSlider} /
 * {@link resolveScrub} view-model (`sliderModel.ts`). Render-ui design Part 6 "Widget roster:
 * history slider (read-only local scrubber over `game.stateAt(k)`)"; GLOSSARY "History slider".
 *
 * A self-contained widget by the design-Part-6 contract: a stable string id (`historySlider`, the
 * id the tracked `layout` default places in `bottom-center`), `mount() → DOM element`, and
 * `update(state, config)` that re-renders from the live history readout — knowing NOTHING about
 * its placement (the zone-based `layout` config drives that).
 *
 * READ-ONLY, LOCAL, EMITS NOTHING. Unlike the banner's Undo/Redo (real, synced game actions that
 * dispatch command ids), the slider dispatches NO command and syncs NOTHING. Dragging back drives
 * the scene's `scrubTo(k)` seam, which re-renders `game.stateAt(k)` for the LOCAL viewer only —
 * later pieces vanish for this viewer, the canonical `Game` (log / cursor / headHash) is untouched.
 * Reaching the end snaps back to live (`scrubTo` with a `>= maxPly` value clears the local view).
 * A real state change (place/undo/redo/reset) is expected to snap the scene back to live; `update`
 * then repaints the slider from the fresh readout. This is why it takes a bespoke `scrubTo` /
 * `getHistory` deps seam rather than the shared command `dispatch` — the read-only contract is
 * structural, not a policy the widget could accidentally break by firing a command.
 *
 * All range/label/enabled DECISIONS live in the pure model; this file only paints the model onto a
 * `<input type=range>`, forwards drags to `scrubTo`, and reads the live `getHistory()` readout. It
 * touches `document`, so it is the Playwright-verified IO boundary (asserted on `window.__pente`
 * getState/getHistory + real drags), not unit/mutation-gated. `data-*`/`data-testid` expose the
 * rendered model for readback (agent-principles #3: observable behavior, never a log line).
 */

import type { Widget, WidgetFactory } from '../registry.ts';
import { deriveSlider, resolveScrub, type HistoryFacts, type SliderModel } from './sliderModel.ts';

/** The stable widget id — matches the `historySlider` entry in the tracked `layout` default. */
export const HISTORY_SLIDER_WIDGET_ID = 'historySlider';

/** The pristine facts used before any history readout is supplied (mount / first paint). */
const PRISTINE_FACTS: HistoryFacts = { maxPly: 0, viewedPly: 0 };

/**
 * The deps a history slider needs: a document to build in (injected for testability), a live
 * `getHistory()` readout of the scene's `Game` (live head + the viewed ply), and `scrubTo(k)` —
 * the scene's READ-ONLY local scrub seam. `scrubTo` re-renders `game.stateAt(k)` for the local
 * viewer without mutating the game; a `k >= maxPly` snaps back to live. No command `dispatch`
 * here on purpose: the slider emits/syncs nothing (design Part 6 / GLOSSARY "History slider").
 */
export interface HistorySliderDeps {
  readonly doc: Document;
  /** The live history readout the widget renders (live head ply + the currently-viewed ply). */
  getHistory(): HistoryFacts;
  /** Scrub the LOCAL view to ply `k` (read-only; `k >= maxPly` snaps back to live). */
  scrubTo(k: number): void;
}

/**
 * Build the history-slider {@link WidgetFactory}. The mounted element carries a `<input
 * type=range>` (0..maxPly) plus a position label; `update` re-derives the pure model from the live
 * `getHistory()` readout and repaints. Dragging the range drives `scrubTo` through the pure
 * {@link resolveScrub} (clamp + snap-to-live), never a command dispatch.
 */
export function historySliderWidget(): WidgetFactory {
  return {
    id: HISTORY_SLIDER_WIDGET_ID,
    mount(rawDeps: unknown): Widget {
      const deps = rawDeps as HistorySliderDeps;
      const doc = deps.doc;

      const element = doc.createElement('div');
      element.className = 'pente-widget pente-widget--history';
      element.setAttribute('data-testid', 'history-widget');

      // The scrub range: min 0 (initial board) .. max maxPly (live head), integer steps.
      const range = doc.createElement('input');
      range.type = 'range';
      range.className = 'pente-history-range';
      range.setAttribute('data-testid', 'history-range');
      range.setAttribute('aria-label', 'Review move history');
      range.min = '0';
      range.step = '1';
      element.appendChild(range);

      // The position label: "Live" at the head, "Move k / max" while reviewing.
      const label = doc.createElement('span');
      label.className = 'pente-history-label';
      label.setAttribute('data-testid', 'history-label');
      element.appendChild(label);

      // Dragging the range scrubs the LOCAL view. The pure `resolveScrub` clamps the raw value
      // against the live head and decides live-vs-earlier; we drive the scene's read-only seam
      // with the resolved ply (a `>= maxPly` resolves to the head → the scene snaps back to live).
      // We do NOT dispatch any command — the slider emits/syncs nothing.
      range.addEventListener('input', () => {
        const maxPly = deps.getHistory().maxPly;
        const { viewedPly } = resolveScrub(range.valueAsNumber, maxPly);
        deps.scrubTo(viewedPly);
      });

      /** Paint a derived model onto the range + label (bounds, value, enabled, live flag). */
      function render(model: SliderModel): void {
        range.min = String(model.min);
        range.max = String(model.max);
        // Only overwrite the thumb when it drifts from the model, so an in-flight drag isn't
        // yanked mid-gesture by a repaint (the browser fires `input` faster than `update` runs).
        if (range.valueAsNumber !== model.value) {
          range.value = String(model.value);
        }
        range.disabled = !model.enabled;

        label.textContent = model.label;

        // Mirror the model onto data-* so Playwright reads the rendered position off the DOM.
        element.setAttribute('data-at-live', String(model.atLive));
        element.setAttribute('data-value', String(model.value));
        element.setAttribute('data-max', String(model.max));
        element.setAttribute('data-enabled', String(model.enabled));
      }

      /** Re-read the live history readout and repaint. */
      function refresh(): void {
        render(deriveSlider(deps.getHistory()));
      }

      // First paint from the live readout (falls back to pristine if the scene is not yet wired).
      render(deriveSlider(PRISTINE_FACTS));
      refresh();

      return {
        element,
        // Repaint from the live history readout on every state change the shell pushes (a place
        // while reviewing snaps the scene back to live; `getHistory` then reports the new head).
        update(): void {
          refresh();
        },
      };
    },
  };
}
