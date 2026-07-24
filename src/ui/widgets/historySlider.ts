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
 * READ-ONLY, LOCAL SCRUB (the slider itself). The `<input type=range>` SCRUB dispatches NO command
 * and syncs NOTHING — dragging back drives the scene's `scrubTo(k)` seam, which re-renders
 * `game.stateAt(k)` for the LOCAL viewer only —
 * later pieces vanish for this viewer, the canonical `Game` (log / cursor / headHash) is untouched.
 * Reaching the end snaps back to live (`scrubTo` with a `>= maxPly` value clears the local view).
 * A real state change (place/undo/redo/reset) is expected to snap the scene back to live; `update`
 * then repaints the slider from the fresh readout.
 *
 * HISTORY CONTROLS (issue #44): the Undo / Redo / Reset buttons MOVED here from the banner and now
 * render directly UNDER the slider — their conceptual home. Distinct from the scrub, these DO
 * dispatch command ids (the shared `dispatch` seam — design Principle 3, one action layer), and
 * `update` repaints their enabled state from the context's history-reachability flags. The scrub
 * itself remains command-free; only these explicit controls dispatch.
 *
 * All range/label/enabled DECISIONS live in the pure model (`deriveSlider` + `deriveHistoryControls`);
 * this file only paints them onto a `<input type=range>` + buttons, forwards drags to `scrubTo`,
 * forwards control clicks to `dispatch`, and reads the live `getHistory()` readout. It touches
 * `document`, so it is the Playwright-verified IO boundary (asserted on `window.__pente`
 * getState/getHistory + real drags/clicks), not unit/mutation-gated. `data-*`/`data-testid` expose
 * the rendered model for readback (agent-principles #3: observable behavior, never a log line).
 */

import type { Widget, WidgetFactory } from '../registry.ts';
import {
  deriveSlider,
  resolveScrub,
  deriveHistoryControls,
  type HistoryFacts,
  type HistoryControls,
  type SliderModel,
} from './sliderModel.ts';

/** The stable widget id — matches the `historySlider` entry in the tracked `layout` default. */
export const HISTORY_SLIDER_WIDGET_ID = 'historySlider';

/** The pristine facts used before any history readout is supplied (mount / first paint). */
const PRISTINE_FACTS: HistoryFacts = { maxPly: 0, viewedPly: 0 };

/** Pristine reachability used before any context arrives (nothing to undo/redo/reset yet). */
const NO_HISTORY_CONTROLS: HistoryControls = { canUndo: false, canRedo: false, canReset: false };

/**
 * The context the slider reads off the container's `update(state, config)` — the SAME
 * {@link BannerContext}-shaped object every widget receives. The slider only needs the `history`
 * reachability flags (issue #44 moved the Undo/Redo/Reset controls under the slider); everything
 * else on that object is ignored. Typed structurally so the slider need not import the banner.
 */
interface HistoryControlsContext {
  readonly history?: HistoryControls;
}

/**
 * The deps a history slider needs: a document to build in (injected for testability), a live
 * `getHistory()` readout of the scene's `Game` (live head + the viewed ply), and `scrubTo(k)` —
 * the scene's READ-ONLY local scrub seam. `scrubTo` re-renders `game.stateAt(k)` for the local
 * viewer without mutating the game; a `k >= maxPly` snaps back to live.
 *
 * `dispatch` (issue #44) fires the relocated Undo / Redo / Reset controls — the SAME command ids a
 * keybinding does (design Principle 3, one action layer). The scrub seam stays command-free (the
 * slider emits/syncs nothing for scrubbing); only the explicit history controls dispatch.
 */
export interface HistorySliderDeps {
  readonly doc: Document;
  /** The live history readout the widget renders (live head ply + the currently-viewed ply). */
  getHistory(): HistoryFacts;
  /** Scrub the LOCAL view to ply `k` (read-only; `k >= maxPly` snaps back to live). */
  scrubTo(k: number): void;
  /** Dispatch a command id (the relocated Undo/Redo/Reset controls). Returns whether it ran. */
  dispatch(commandId: string): boolean;
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

      // History controls (issue #44): the Undo / Redo / Reset buttons, MOVED here from the banner and
      // rendered directly UNDER the slider (their conceptual home). Built once from the derived button
      // set so ids/order/handlers are stable; each dispatches the SAME command id a keybinding fires
      // (design Principle 3). A disabled button's `disabled` attribute blocks the click, but the guard
      // stops a programmatic click firing a command the model says is unavailable. `update` repaints
      // only labels/enabled from the context's reachability flags — the wiring never re-binds.
      const controls = doc.createElement('div');
      controls.className = 'pente-history-controls';
      const buttonEls = new Map<string, HTMLButtonElement>();
      for (const spec of deriveHistoryControls(NO_HISTORY_CONTROLS)) {
        const btn = doc.createElement('button');
        btn.className = `pente-history-button pente-history-button--${spec.commandId}`;
        btn.setAttribute('data-testid', `history-button-${spec.commandId}`);
        btn.setAttribute('data-command', spec.commandId);
        btn.textContent = spec.label;
        btn.disabled = !spec.enabled;
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          deps.dispatch(spec.commandId);
        });
        controls.appendChild(btn);
        buttonEls.set(spec.commandId, btn);
      }
      element.appendChild(controls);

      /** Paint the derived history-control buttons (labels + enabled) from the reachability flags. */
      function renderControls(history: HistoryControls): void {
        for (const spec of deriveHistoryControls(history)) {
          const btn = buttonEls.get(spec.commandId);
          if (btn === undefined) continue;
          btn.textContent = spec.label;
          btn.disabled = !spec.enabled;
        }
      }

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
      renderControls(NO_HISTORY_CONTROLS);

      return {
        element,
        // Repaint from the live history readout on every state change the shell pushes (a place
        // while reviewing snaps the scene back to live; `getHistory` then reports the new head), and
        // repaint the relocated Undo/Redo/Reset controls from the context's reachability flags (#44).
        update(_state: unknown, config: unknown): void {
          refresh();
          const context = config as HistoryControlsContext | null;
          renderControls(context?.history ?? NO_HISTORY_CONTROLS);
        },
      };
    },
  };
}
