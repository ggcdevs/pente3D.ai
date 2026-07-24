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

      // ============================================================================================
      // PRESENCE-STYLE HUD (issue #44, live iteration) — a compact stacked HUD:
      //   1. a tap-to-copy CODE ROW (game code + a copy icon), hidden when there is no code;
      //   2. a per-color PRESENCE/SCORE grid (one row per color): [dot] Color (You) …… captureCount.
      // The turn is shown by BOLDING the active row + DIMMING the other (no "X to move" text). Presence
      // dots + "(You)" only render when networked (a seat is held). The old text lines — status ("X to
      // move"), net status ("Waiting for opponent…"), and seat ("You are White") — are REPLACED by this
      // and no longer rendered. Conflict / join-error / undo-redo prompt are UNCHANGED below.
      // ============================================================================================

      // --- Code row (tap-to-copy) -------------------------------------------------------------------
      // The WHOLE row is the copy affordance (click copies getNet().code). A small copy icon (⧉) sits
      // beside the code; on success it flips to a transient "Copied ✓" state (data-copied="true"),
      // reverting on the next render. Kept net-code / net-copy testids so page-wide net selectors resolve.
      const codeRow = doc.createElement('button');
      codeRow.className = 'pente-hud-code-row';
      codeRow.setAttribute('data-testid', 'net-copy');
      codeRow.setAttribute('aria-label', 'Copy game code');
      codeRow.type = 'button';
      const codeLabel = doc.createElement('span');
      codeLabel.className = 'pente-hud-code';
      codeLabel.setAttribute('data-testid', 'net-code');
      const copyIcon = doc.createElement('span');
      copyIcon.className = 'pente-hud-copy-icon';
      copyIcon.setAttribute('aria-hidden', 'true');
      copyIcon.textContent = '⧉';
      codeRow.append(codeLabel, copyIcon);
      // `copied` is a transient success flag cleared on the next render (or the timer, whichever first).
      let copied = false;
      let copyTimer: ReturnType<typeof setTimeout> | undefined;
      codeRow.addEventListener('click', () => {
        const code = deps.getNet().code;
        if (code === null) return;
        // Copy is best-effort: reflect success in the transient icon state (observable), never throw.
        void deps.copyToClipboard(code).then(
          () => {
            copied = true;
            copyIcon.textContent = '✓';
            codeRow.setAttribute('data-copied', 'true');
            if (copyTimer) clearTimeout(copyTimer);
            copyTimer = setTimeout(() => {
              copied = false;
              copyIcon.textContent = '⧉';
              codeRow.removeAttribute('data-copied');
            }, 1400);
          },
          () => {
            copyIcon.textContent = '⧉';
            codeRow.setAttribute('data-copied', 'false');
          },
        );
      });
      element.appendChild(codeRow);

      // --- Presence/score grid (one row per color) --------------------------------------------------
      // Grid: [dot] [Color label] [(You)] …spacer… [capture count]. `render` sets the bold/dim state
      // from the turn, and `renderPresence` sets the dots + "(You)" from the live net readout. Kept
      // data-offturn-flashes on the grid so the off-turn cue (Task 6.2) still has an observable counter.
      const scoreGrid = doc.createElement('div');
      scoreGrid.className = 'pente-hud-score';
      scoreGrid.setAttribute('data-testid', 'banner-status');
      scoreGrid.setAttribute('data-offturn-flashes', '0');

      /** Build one color row; returns the pieces `render`/`renderPresence` repaint. */
      function makeRow(color: 'white' | 'black') {
        const row = doc.createElement('div');
        row.className = `pente-hud-row pente-hud-row--${color}`;
        row.setAttribute('data-color', color);
        const dot = doc.createElement('span');
        dot.className = 'pente-hud-dot';
        dot.setAttribute('aria-hidden', 'true');
        dot.hidden = true;
        const name = doc.createElement('span');
        name.className = 'pente-hud-name';
        name.textContent = cap(color);
        const you = doc.createElement('span');
        you.className = 'pente-hud-you';
        you.setAttribute('data-testid', `banner-you-${color}`);
        you.textContent = '(You)';
        you.hidden = true;
        const wins = doc.createElement('span');
        wins.className = 'pente-hud-wins';
        wins.textContent = 'wins';
        wins.hidden = true;
        const count = doc.createElement('span');
        count.className = 'pente-hud-count';
        count.setAttribute('data-testid', `banner-captures-${color}`);
        row.append(dot, name, you, wins, count);
        return { row, dot, you, wins, count };
      }
      const whiteRow = makeRow('white');
      const blackRow = makeRow('black');
      scoreGrid.append(whiteRow.row, blackRow.row);
      element.appendChild(scoreGrid);

      // The last off-turn block count this banner has rendered, so `update` can detect an INCREMENT
      // (a fresh rejected off-turn attempt) and pulse exactly once per new block — not on every repaint.
      let lastOffTurnBlocks = 0;
      let flashes = 0;

      /**
       * Fire the subtle off-turn cue (Task 6.2): bump the flash counter (mirrored to the score grid's
       * `data-offturn-flashes`) and re-trigger the CSS pulse on the ACTIVE player's row by toggling the
       * `--offturn` class off then on (repointed off the removed "X to move" line, issue #44). Kept
       * deliberately subtle — a brief pulse on the active row, no modal / no error text.
       */
      function flashOffTurn(): void {
        flashes += 1;
        scoreGrid.setAttribute('data-offturn-flashes', String(flashes));
        const active = lastActivePlayer === 'black' ? blackRow.row : whiteRow.row;
        active.classList.remove('pente-hud-row--offturn');
        // Force a reflow so removing then re-adding the class restarts the animation (standard idiom).
        void active.offsetWidth;
        active.classList.add('pente-hud-row--offturn');
      }
      // The player whose row is currently active (bold), so the off-turn pulse targets the right row.
      let lastActivePlayer: 'white' | 'black' = 'white';

      // --- Conflict / join-error (UNCHANGED behavior, issue #44) ------------------------------------
      // Kept as their own alert lines below the HUD, wrapped in the `connectionStatus` marker so the
      // few net specs that scoped by that id still resolve. `netModel.deriveNet` stays the data source.
      const net = doc.createElement('div');
      net.className = 'pente-hud-alerts';
      net.setAttribute('data-widget-id', NET_MARKER_ID);
      net.setAttribute('data-testid', 'net-widget');

      const conflict = doc.createElement('span');
      conflict.className = 'pente-net-conflict';
      conflict.setAttribute('data-testid', 'net-conflict');
      conflict.setAttribute('role', 'alert');
      conflict.hidden = true;
      net.appendChild(conflict);

      const joinError = doc.createElement('span');
      joinError.className = 'pente-net-join-error';
      joinError.setAttribute('data-testid', 'net-join-error');
      joinError.setAttribute('role', 'alert');
      joinError.hidden = true;
      net.appendChild(joinError);

      element.appendChild(net);

      /** Paint the code row + conflict/join-error from a derived net model (issue #44). */
      function renderNet(model: NetModel): void {
        net.setAttribute('data-panel', model.panel);

        const hasJoinError = model.joinErrorText !== null;
        joinError.textContent = model.joinErrorText ?? '';
        joinError.hidden = !hasJoinError;

        conflict.textContent = model.conflictText ?? '';
        conflict.hidden = model.conflictText === null;

        // Hide the alerts wrapper while there is nothing to alert about, so it leaves no gap.
        net.hidden = model.conflictText === null && !hasJoinError;

        // Code row: shown only when there is a code; reset the transient copied state when it vanishes.
        const hasCode = model.code !== null;
        codeRow.hidden = !hasCode;
        codeLabel.textContent = model.code ?? '';
        if (!hasCode || !copied) {
          copyIcon.textContent = '⧉';
          codeRow.removeAttribute('data-copied');
        }
      }

      /**
       * Paint the presence dots + "(You)" onto the per-color rows from the LIVE net readout (issue #44).
       * Dots + "(You)" render ONLY when networked (a seat is held). My own row → green FILLED dot; the
       * opponent row → green FILLED if the peer is present, else grey HOLLOW (a subtle pulse). Offline /
       * local hotseat (seat === null) → no dots, no "(You)".
       */
      function renderPresence(ns: NetSessionState): void {
        const networked = ns.phase !== 'offline' && ns.seat !== null;
        for (const [color, parts] of [
          ['white', whiteRow],
          ['black', blackRow],
        ] as const) {
          const isMe = networked && ns.seat === color;
          parts.you.hidden = !isMe;
          if (!networked) {
            parts.dot.hidden = true;
            parts.dot.removeAttribute('data-present');
            continue;
          }
          const present = isMe || ns.peerPresent;
          parts.dot.hidden = false;
          parts.dot.setAttribute('data-present', String(present));
        }
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

      /**
       * Paint a derived model onto the per-color HUD rows (issue #44). The TURN is shown structurally:
       * the active player's row is bold (`--active`) and the other dimmed (`--dim`) — no "X to move"
       * text. On a WIN the winner's row is bold + shows a "wins" badge. Capture counts are the raw
       * numbers (the row's color label supplies the name). `data-status`/`data-player` mirror the model.
       */
      function render(model: BannerModel): void {
        scoreGrid.setAttribute('data-status', model.status);
        scoreGrid.setAttribute('data-player', model.player);
        lastActivePlayer = model.player;

        const won = model.status === 'winner';
        for (const [color, parts] of [
          ['white', whiteRow],
          ['black', blackRow],
        ] as const) {
          const isActive = model.player === color;
          parts.row.classList.toggle('pente-hud-row--active', isActive);
          parts.row.classList.toggle('pente-hud-row--dim', !isActive);
          parts.wins.hidden = !(won && isActive);
        }
        // Raw counts — the color label is the row's own name (issue #44 replaces "White: N" labels).
        whiteRow.count.textContent = String(model.whiteCaptures);
        blackRow.count.textContent = String(model.blackCaptures);
      }

      /** Re-read the live session readout and repaint the code row + alerts + presence dots. */
      function refreshNet(): void {
        const ns = deps.getNet?.() ?? OFFLINE_NET;
        renderNet(deriveNet(ns));
        renderPresence(ns);
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
