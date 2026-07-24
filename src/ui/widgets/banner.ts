/**
 * Score/status banner widget (Task 5.2) — the DOM IO glue for the pure {@link deriveBanner}
 * view-model (`bannerModel.ts`). Render-ui design Part 6.
 *
 * A self-contained widget by the design-Part-6 contract: a stable string id (`statusBanner`,
 * the id the tracked `layout` default places in `top-center`), `mount() → DOM element`, and
 * `update(state, config)` that re-renders from live state — knowing NOTHING about its placement
 * (the zone-based `layout` config drives that). It **reads** the {@link GameState} and repaints.
 *
 * HISTORY CONTROLS MOVED (issue #44): the Undo / Redo / Reset buttons relocated to the history
 * slider (`historySlider.ts`), their conceptual home (directly under the slider). This widget no
 * longer renders them or dispatches their commands; it is now a pure score/status readout (plus the
 * off-turn cue and the incoming networked undo/redo accept/decline prompt).
 *
 * NET STATUS MERGED IN (issue #44): the networking display — game code + copy, connection/status
 * line, seat, conflict banner, join error — now renders INSIDE this banner (its `getNet()` /
 * `copyToClipboard` deps), keeping the same `net-*` testids/classes but co-located with the score so
 * the whole HUD reads as one left-aligned, wrapping bar. `netModel.ts` stays the pure data source.
 *
 * All placement/turn/capture DECISIONS live in the pure models; this file only paints them onto DOM.
 * It touches `document`, so it is the Playwright-verified IO boundary (asserted on `window.__pente`
 * state + real interactions), not unit/mutation-gated. `getState`/`data-*` attributes are exposed so
 * a test reads the rendered model back off the live DOM (agent-principles #3: observable behavior).
 */

import type { Widget, WidgetFactory } from '../registry.ts';
import type { GameState } from '../../core/gameState.ts';
import { deriveBanner, type BannerModel } from './bannerModel.ts';
import type { HistoryControls } from './sliderModel.ts';
import { deriveNet, type NetSessionState, type NetModel } from './netModel.ts';
import type { UndoRedoPrompt } from '../../net/undoRedo.ts';

/** The stable widget id — matches the `statusBanner` entry in the tracked `layout` default. */
export const BANNER_WIDGET_ID = 'statusBanner';

/**
 * The `data-widget-id` marker the merged net-status sub-panel carries (issue #44). The net display
 * used to be a standalone `connectionStatus` widget; folding it into the banner keeps this marker on
 * the sub-panel so the few e2e specs that scoped their `net-*` queries by
 * `[data-widget-id="connectionStatus"]` keep resolving. It is NOT a registry widget any more.
 */
export const NET_MARKER_ID = 'connectionStatus';

/**
 * The deps a banner needs: a document to build in (injected for testability), plus the networking
 * readout + clipboard copy the merged net-status sub-panel needs (issue #44). No command `dispatch`
 * here any more — the Undo/Redo/Reset controls moved to the history slider.
 */
export interface BannerDeps {
  readonly doc: Document;
  /**
   * The live networking-session readout the merged net-status sub-panel renders (issue #44) — the
   * scene's `getNet`, produced off the app's net session. The banner reflects it into the code /
   * status / seat / conflict lines; `netModel.deriveNet` stays the pure data source.
   */
  getNet(): NetSessionState;
  /**
   * Copy the shown game code to the clipboard (issue #44 — the merged net "Copy" button). Injected
   * so the widget never reaches for a global `navigator`; a rejection is surfaced as a copy-failed
   * hint on the button rather than thrown.
   */
  copyToClipboard(text: string): Promise<void>;
  /**
   * Respond accept (`true`) / decline (`false`) to the INCOMING networked undo/redo proposal (Task
   * N.3.2, issue #18). The banner surfaces the accept/decline prompt (NOT the end-state overlay — the
   * game is not over) and calls this on the Accept/Decline buttons; it routes to the session handshake
   * `respond`, so on mutual accept BOTH clients roll the undo/redo (the app applies on the resolution).
   * Returns whether a response was sent (`false` if there was nothing to answer).
   */
  respondUndoRedo(accepted: boolean): boolean;
}

/**
 * The UI-context bag passed as `update`'s second arg. Carries the history-reachability flags the
 * scene computes from its `Game` (undo/redo/reset availability) — a history fact the immutable
 * `GameState` cannot know, so it rides alongside rather than being inferred from the piece map.
 */
export interface BannerContext {
  /**
   * The history-reachability flags (`canUndo` / `canRedo` / `canReset`) the scene computes from its
   * `Game`. The banner no longer renders the Undo/Redo/Reset buttons (they moved to the history
   * slider, issue #44), but this context still rides through the container's `update(state, config)`
   * — the SAME config object every widget receives — so the history slider reads `history` off it to
   * enable/disable its relocated controls. Kept here so the scene's `getBannerContext` stays the one
   * place that computes these flags.
   */
  readonly history: HistoryControls;
  /**
   * The seat-turn gate's running off-turn block count (Task 6.2, issue #4c). The banner compares it to
   * the value it last rendered; when it ADVANCED (an off-turn placement was just rejected), it briefly
   * pulses the "X to move" status line — the subtle off-turn cue the task requires. Absent (older
   * callers / no net game) it is treated as 0, so the cue never fires spuriously. The pulse count is
   * mirrored onto `data-offturn-flashes` so Playwright can prove the cue fired (observable, not a log).
   */
  readonly offTurnBlocks?: number;
  /**
   * The INCOMING networked undo/redo accept/decline PROMPT view-model (Task N.3.2, issue #18): the pure
   * `deriveUndoRedoPrompt` output the session folds over the N.1 handshake + this client's seat. When
   * `show` is `true` the banner surfaces an accept/decline prompt naming the opponent (rendered via
   * `textContent` — opponent-derived color from the fixed `Player` union, never `innerHTML`/eval). Absent
   * (older callers / no net game) it is treated as hidden, so the prompt never appears spuriously. Its
   * fields are mirrored onto `data-*` so Playwright reads the rendered prompt back off the live DOM (#3).
   */
  readonly undoRedoPrompt?: UndoRedoPrompt;
}

/** The pristine offline net state used before any session readout is supplied (mount / first paint). */
const OFFLINE_NET: NetSessionState = {
  phase: 'offline',
  code: null,
  seat: null,
  peerPresent: false,
  joinError: null,
};

/**
 * Build the score/status banner {@link WidgetFactory}. The mounted element carries the current
 * player, both capture counts, and the merged net-status sub-panel (code / status / seat / conflict /
 * join error); `update` re-derives the pure models and repaints. History controls (Undo/Redo/Reset)
 * live under the slider now (issue #44).
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

      // --- Merged NET STATUS sub-panel (issue #44) --------------------------------------------------
      // Moved INTO the banner from the former standalone `connectionStatus` widget so the whole HUD
      // reads as one left-aligned, wrapping bar (score + captures + code + status). Same `net-*`
      // testids/classes as before (page-wide selectors keep resolving); wrapped in a marker carrying
      // `data-widget-id="connectionStatus"` so the few net specs that scoped by that id still resolve,
      // and so `getNet`-driven status reads back off the live DOM (#3). `netModel.deriveNet` stays the
      // pure data source; this only paints it. The panel HIDES itself when idle (offline, no error).
      const net = doc.createElement('div');
      net.className = 'pente-banner-net';
      net.setAttribute('data-widget-id', NET_MARKER_ID);
      net.setAttribute('data-testid', 'net-widget');

      const netStatusLine = doc.createElement('span');
      netStatusLine.className = 'pente-net-status-line';
      netStatusLine.setAttribute('data-testid', 'net-status-line');
      net.appendChild(netStatusLine);

      const codeRow = doc.createElement('span');
      codeRow.className = 'pente-net-code-row';
      const codeLabel = doc.createElement('span');
      codeLabel.className = 'pente-net-code';
      codeLabel.setAttribute('data-testid', 'net-code');
      codeRow.appendChild(codeLabel);
      const copyButton = doc.createElement('button');
      copyButton.className = 'pente-net-copy';
      copyButton.setAttribute('data-testid', 'net-copy');
      copyButton.setAttribute('aria-label', 'Copy game code');
      copyButton.textContent = 'Copy';
      copyButton.addEventListener('click', () => {
        const code = deps.getNet().code;
        if (code === null) return;
        // Copy is best-effort: reflect success/failure in the button label (observable), never throw.
        void deps.copyToClipboard(code).then(
          () => {
            copyButton.textContent = 'Copied';
            copyButton.setAttribute('data-copied', 'true');
          },
          () => {
            copyButton.textContent = 'Copy failed';
            copyButton.setAttribute('data-copied', 'false');
          },
        );
      });
      codeRow.appendChild(copyButton);
      net.appendChild(codeRow);

      const seatLine = doc.createElement('span');
      seatLine.className = 'pente-net-seat';
      seatLine.setAttribute('data-testid', 'net-seat');
      net.appendChild(seatLine);

      const conflict = doc.createElement('span');
      conflict.className = 'pente-net-conflict';
      conflict.setAttribute('data-testid', 'net-conflict');
      conflict.setAttribute('role', 'alert');
      net.appendChild(conflict);

      const joinError = doc.createElement('span');
      joinError.className = 'pente-net-join-error';
      joinError.setAttribute('data-testid', 'net-join-error');
      joinError.setAttribute('role', 'alert');
      joinError.hidden = true;
      net.appendChild(joinError);

      element.appendChild(net);

      /** Paint a derived net model onto the merged status sub-panel (issue #44). */
      function renderNet(model: NetModel): void {
        net.setAttribute('data-panel', model.panel);

        const hasJoinError = model.joinErrorText !== null;
        joinError.textContent = model.joinErrorText ?? '';
        joinError.hidden = !hasJoinError;

        // Hide the whole net sub-panel while idle (offline, empty controls panel, no join error) so
        // it leaves no gap in the banner — matching the former standalone widget's hide behavior.
        net.hidden = model.panel === 'controls' && !hasJoinError;

        // Status line: connecting/connected copy (offline yields empty text).
        netStatusLine.textContent = model.statusText;
        netStatusLine.hidden = model.statusText === '';

        const hasCode = model.code !== null;
        codeRow.hidden = !hasCode;
        codeLabel.textContent = model.code ?? '';
        if (!hasCode) {
          copyButton.textContent = 'Copy';
          copyButton.removeAttribute('data-copied');
        }

        seatLine.textContent = model.seatText ?? '';
        seatLine.hidden = model.seatText === null;

        conflict.textContent = model.conflictText ?? '';
        conflict.hidden = model.conflictText === null;
      }

      // Networked undo/redo accept/decline PROMPT (Task N.3.2, issue #18). Surfaced HERE in the banner
      // (NOT the end-state overlay — the game is not over) when the peer proposes an undo/redo. The
      // headline text is opponent-derived (the fixed `Player` color word from the pure model), so it is
      // painted via `textContent` ONLY — never innerHTML/eval (the relay is publicly writable; treat any
      // opponent-derived text as untrusted). Built once; `update` toggles visibility + repaints copy.
      const prompt = doc.createElement('div');
      prompt.className = 'pente-banner-undoredo-prompt';
      prompt.setAttribute('data-testid', 'banner-undoredo-prompt');
      prompt.setAttribute('data-show', 'false');
      prompt.setAttribute('data-action', '');
      prompt.hidden = true;
      const promptText = doc.createElement('span');
      promptText.className = 'pente-banner-undoredo-text';
      promptText.setAttribute('data-testid', 'banner-undoredo-text');
      const acceptBtn = doc.createElement('button');
      acceptBtn.className = 'pente-banner-button pente-banner-undoredo-accept';
      acceptBtn.setAttribute('data-testid', 'banner-undoredo-accept');
      acceptBtn.textContent = 'Accept';
      acceptBtn.addEventListener('click', () => deps.respondUndoRedo(true));
      const declineBtn = doc.createElement('button');
      declineBtn.className = 'pente-banner-button pente-banner-undoredo-decline';
      declineBtn.setAttribute('data-testid', 'banner-undoredo-decline');
      declineBtn.textContent = 'Decline';
      declineBtn.addEventListener('click', () => deps.respondUndoRedo(false));
      prompt.append(promptText, acceptBtn, declineBtn);
      element.appendChild(prompt);

      /**
       * Paint the incoming undo/redo prompt (Task N.3.2). When `show` is `true` the prompt is revealed
       * with the opponent-derived headline (via `textContent` only) and Accept/Decline; otherwise it is
       * hidden. The `data-*` mirror lets Playwright read the rendered prompt off the live DOM (#3).
       */
      function renderUndoRedoPrompt(p: UndoRedoPrompt | undefined): void {
        const show = p?.show === true;
        prompt.hidden = !show;
        prompt.setAttribute('data-show', String(show));
        prompt.setAttribute('data-action', show && p ? (p.action ?? '') : '');
        // textContent ONLY — the copy is opponent-derived; never innerHTML (untrusted relay input).
        promptText.textContent = show && p ? p.promptText : '';
      }

      /** Paint a derived model onto the DOM (status text + captures). */
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
      }

      /** Re-read the live session readout and repaint the merged net-status sub-panel. */
      function refreshNet(): void {
        renderNet(deriveNet(deps.getNet?.() ?? OFFLINE_NET));
      }

      render(deriveBanner(emptyStateFallback()));
      renderUndoRedoPrompt(undefined);
      refreshNet();

      return {
        element,
        update(state: unknown, config: unknown): void {
          // Before a game exists the shell still renders (pristine fallback).
          const gameState = (state as GameState | null) ?? emptyStateFallback();
          const context = config as BannerContext | null;
          render(deriveBanner(gameState));
          // Merged net status (issue #44): repaint from the live session readout every update
          // (host/join/presence/conflict all route through the scene's onStateChange).
          refreshNet();
          // Off-turn cue (Task 6.2): if the scene's off-turn block count ADVANCED since our last
          // paint, the local seat just attempted a move on the opponent's turn — pulse the status line.
          const blocks = context?.offTurnBlocks ?? 0;
          if (blocks > lastOffTurnBlocks) flashOffTurn();
          lastOffTurnBlocks = blocks;
          // Networked undo/redo accept/decline prompt (Task N.3.2, issue #18): surface it when the peer
          // has proposed an undo/redo. Hidden when absent (offline / no incoming ask).
          renderUndoRedoPrompt(context?.undoRedoPrompt);
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
