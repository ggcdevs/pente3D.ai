/**
 * Score/status banner widget (Task 5.2) — the DOM/dispatch IO glue for the pure
 * {@link deriveBanner} view-model (`bannerModel.ts`). Render-ui design Part 6.
 *
 * A self-contained widget by the design-Part-6 contract: a stable string id (`statusBanner`,
 * the id the tracked `layout` default places in `top-center`), `mount() → DOM element`, and
 * `update(state, config)` that re-renders from live state — knowing NOTHING about its placement
 * (the zone-based `layout` config drives that). It **reads** the {@link GameState} and the
 * scene's history-reachability flags, and **dispatches command ids** (design Principle 3 "one
 * action layer": the Undo/Redo/Reset buttons fire the exact same `undo`/`redo`/`reset` commands
 * a keybinding does — via the deps-supplied `dispatch`, the scene's command registry).
 *
 * All placement/turn/capture/enabled DECISIONS live in the pure model; this file only paints the
 * model onto DOM and forwards clicks to `dispatch`. It touches `document`, so it is the
 * Playwright-verified IO boundary (asserted on `window.__pente` state + real button clicks), not
 * unit/mutation-gated. `getState`/`data-*` attributes are exposed so a test reads the rendered
 * model back off the live DOM (agent-principles #3: observable behavior, never a log line).
 */

import type { Widget, WidgetFactory } from '../registry.ts';
import type { GameState } from '../../core/gameState.ts';
import { deriveBanner, type BannerHistory, type BannerModel } from './bannerModel.ts';

/** The stable widget id — matches the `statusBanner` entry in the tracked `layout` default. */
export const BANNER_WIDGET_ID = 'statusBanner';

/**
 * The deps a banner needs: a document to build in (injected for testability) and the command
 * `dispatch` (the scene's registry — the SAME path a keybinding uses, design Principle 3).
 */
export interface BannerDeps {
  readonly doc: Document;
  /** Dispatch a command id (Undo/Redo/Reset). Returns whether a command ran. */
  dispatch(commandId: string): boolean;
}

/**
 * The UI-context bag passed as `update`'s second arg. Carries the history-reachability flags the
 * scene computes from its `Game` (undo/redo/reset availability) — a history fact the immutable
 * `GameState` cannot know, so it rides alongside rather than being inferred from the piece map.
 */
export interface BannerContext {
  readonly history: BannerHistory;
  /**
   * The seat-turn gate's running off-turn block count (Task 6.2, issue #4c). The banner compares it to
   * the value it last rendered; when it ADVANCED (an off-turn placement was just rejected), it briefly
   * pulses the "X to move" status line — the subtle off-turn cue the task requires. Absent (older
   * callers / no net game) it is treated as 0, so the cue never fires spuriously. The pulse count is
   * mirrored onto `data-offturn-flashes` so Playwright can prove the cue fired (observable, not a log).
   */
  readonly offTurnBlocks?: number;
}

/** Pristine flags used before any state arrives (nothing to undo/redo/reset yet). */
const NO_HISTORY: BannerHistory = { canUndo: false, canRedo: false, canReset: false };

/**
 * Build the score/status banner {@link WidgetFactory}. The mounted element carries the current
 * player, both capture counts, and the Undo/Redo/Reset buttons; `update` re-derives the pure
 * model and repaints. Clicking an enabled button dispatches its command id.
 */
export function bannerWidget(): WidgetFactory {
  return {
    id: BANNER_WIDGET_ID,
    mount(rawDeps: unknown): Widget {
      const deps = rawDeps as BannerDeps;
      const doc = deps.doc;

      const element = doc.createElement('div');
      element.className = 'pente-widget pente-widget--banner';

      // Status line: whose turn / who won (data-* mirror the model for Playwright readback).
      const status = doc.createElement('div');
      status.className = 'pente-banner-status';
      status.setAttribute('data-testid', 'banner-status');
      // The off-turn cue counter (Task 6.2): mirrors how many times the "X to move" line has pulsed
      // because an off-turn placement was rejected. Starts at 0; Playwright reads it to prove the
      // subtle cue fired without depending on animation timing (observable behavior, not a log — #3).
      status.setAttribute('data-offturn-flashes', '0');
      element.appendChild(status);

      // The last off-turn block count this banner has rendered, so `update` can detect an INCREMENT
      // (a fresh rejected off-turn attempt) and pulse exactly once per new block — not on every repaint.
      let lastOffTurnBlocks = 0;
      let flashes = 0;

      /**
       * Fire the subtle off-turn cue: bump the flash counter (mirrored to `data-offturn-flashes`) and
       * re-trigger the CSS pulse on the status line by toggling the `--offturn` class off then on (so a
       * second block within the animation window still visibly re-pulses). Kept deliberately subtle — a
       * brief pulse on the existing "X to move" line, no modal / no error text (the task's requirement).
       */
      function flashOffTurn(): void {
        flashes += 1;
        status.setAttribute('data-offturn-flashes', String(flashes));
        status.classList.remove('pente-banner-status--offturn');
        // Force a reflow so removing then re-adding the class restarts the animation (standard idiom).
        void status.offsetWidth;
        status.classList.add('pente-banner-status--offturn');
      }

      // Capture counts, one per player.
      const captures = doc.createElement('div');
      captures.className = 'pente-banner-captures';
      const whiteCap = doc.createElement('span');
      whiteCap.className = 'pente-banner-capture pente-banner-capture--white';
      whiteCap.setAttribute('data-testid', 'banner-captures-white');
      const blackCap = doc.createElement('span');
      blackCap.className = 'pente-banner-capture pente-banner-capture--black';
      blackCap.setAttribute('data-testid', 'banner-captures-black');
      // Visible divider BETWEEN the two score labels (issue #14: they used to render adjacent as
      // "White: 0Black: 0"). Its text is the model's `capturesSeparator`, painted in `render`.
      const capSep = doc.createElement('span');
      capSep.className = 'pente-banner-capture-sep';
      capSep.setAttribute('data-testid', 'banner-captures-sep');
      capSep.setAttribute('aria-hidden', 'true');
      captures.append(whiteCap, capSep, blackCap);
      element.appendChild(captures);

      // Controls: one button per model button, each dispatching its command id on click. Built
      // once from the initial (empty) model's button set so the ids/order/handlers are stable;
      // `update` only repaints labels/enabled — the button↔command wiring never re-binds.
      const controls = doc.createElement('div');
      controls.className = 'pente-banner-controls';
      const initial = deriveBanner(emptyStateFallback(), NO_HISTORY);
      const buttonEls = new Map<string, HTMLButtonElement>();
      for (const spec of initial.buttons) {
        const btn = doc.createElement('button');
        btn.className = `pente-banner-button pente-banner-button--${spec.commandId}`;
        btn.setAttribute('data-testid', `banner-button-${spec.commandId}`);
        btn.setAttribute('data-command', spec.commandId);
        btn.textContent = spec.label;
        // Dispatch the SAME command id a keybinding fires (design Principle 3). A disabled
        // button's `disabled` attribute already blocks the click, but guard anyway so a
        // programmatic click can't fire a command the model says is unavailable.
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          deps.dispatch(spec.commandId);
        });
        controls.appendChild(btn);
        buttonEls.set(spec.commandId, btn);
      }
      element.appendChild(controls);

      /** Paint a derived model onto the DOM (status text, captures, button labels/enabled). */
      function render(model: BannerModel): void {
        status.textContent =
          model.status === 'winner'
            ? `${cap(model.player)} wins`
            : `${cap(model.player)} to move`;
        status.setAttribute('data-status', model.status);
        status.setAttribute('data-player', model.player);

        // Score text + divider all come from the pure model (single source of truth, issue #14):
        // "White: N", a visible separator, then "Black: N" — never rendered run-together.
        whiteCap.textContent = model.whiteCapturesLabel;
        capSep.textContent = model.capturesSeparator;
        blackCap.textContent = model.blackCapturesLabel;

        for (const spec of model.buttons) {
          const btn = buttonEls.get(spec.commandId);
          if (btn === undefined) continue;
          btn.textContent = spec.label;
          btn.disabled = !spec.enabled;
        }
      }

      render(initial);

      return {
        element,
        update(state: unknown, config: unknown): void {
          // Before a game exists the shell still renders (pristine fallback). The history flags
          // ride in via the context bag; absent it, nothing is undo/redo/reset-able.
          const gameState = (state as GameState | null) ?? emptyStateFallback();
          const context = config as BannerContext | null;
          const history = context?.history ?? NO_HISTORY;
          render(deriveBanner(gameState, history));
          // Off-turn cue (Task 6.2): if the scene's off-turn block count ADVANCED since our last
          // paint, the local seat just attempted a move on the opponent's turn — pulse the status line.
          const blocks = context?.offTurnBlocks ?? 0;
          if (blocks > lastOffTurnBlocks) flashOffTurn();
          lastOffTurnBlocks = blocks;
        },
      };
    },
  };
}

/** Capitalise a player name for display (`white` → `White`). */
function cap(player: string): string {
  return player.charAt(0).toUpperCase() + player.slice(1);
}

/**
 * A pristine, view-only fallback state used when the banner renders before a real game state is
 * supplied (mount / first paint). White to move, no captures, no winner — matches
 * `initialState`, but built inline so this DOM glue needs no board size.
 */
function emptyStateFallback(): GameState {
  return {
    size: 0,
    pieces: {},
    turn: 'white',
    captures: { white: 0, black: 0 },
    winner: null,
  };
}
