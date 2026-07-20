/**
 * Placeholder widget factory (Task 5.1) — the minimal self-contained widget that proves the
 * framework end-to-end before the real roster (banner/menu/settings/net/history/help) lands in
 * Tasks 5.2+.
 *
 * It is a genuine widget by the design-Part-6 contract: a stable string id, `mount() → DOM
 * element`, and `update(state, config)` that re-renders from live state — while knowing NOTHING
 * about its placement (the zone-based `layout` config drives that). It dispatches nothing yet;
 * the real widgets wire command dispatch in 5.2+. Kept deliberately tiny so the Playwright
 * proof is about the SHELL (zones reflect config; reordering config reorders the DOM), not about
 * any one widget's contents.
 *
 * This is DOM IO glue (it touches `document`), verified by Playwright — not unit/mutation-gated.
 */

import type { Widget, WidgetFactory } from '../registry.ts';

/** The deps a placeholder needs: a document to build in (injected for testability). */
export interface PlaceholderDeps {
  readonly doc: Document;
}

/**
 * Build a placeholder {@link WidgetFactory} for `id`. Each mounted instance is a `<div>` labelled
 * with its id, so a test can see the exact widget the layout placed in a zone. Its `update`
 * writes the current turn (when a state is supplied) so it is observably a live, state-reading
 * widget, not an inert div.
 */
export function placeholderWidget(id: string): WidgetFactory {
  return {
    id,
    mount(deps: unknown): Widget {
      const { doc } = deps as PlaceholderDeps;
      const element = doc.createElement('div');
      element.className = `pente-widget pente-widget--${id}`;
      element.textContent = id;

      return {
        element,
        update(state: unknown): void {
          // Reflect a scrap of live state so the widget is observably a subscriber, not a
          // static label (design Part 6: widgets read GameState). Defensive against a null
          // state / missing turn — the shell must render before a game exists.
          const turn = (state as { turn?: string } | null)?.turn;
          element.dataset.turn = turn ?? '';
        },
      };
    },
  };
}
