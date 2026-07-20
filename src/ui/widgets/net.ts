/**
 * Networking widget (Task 5.5) — the DOM/dispatch IO glue for the pure {@link deriveNet} view-model
 * (`netModel.ts`), wiring the Stage 3 SyncEngine + seat manager through the scene's net-session seam
 * (`src/net/session.ts`). Render-ui design Part 6 "Widget roster: host/join + connection/seat status
 * + conflict banner".
 *
 * A self-contained widget by the design-Part-6 contract: a stable string id (`connectionStatus`, the
 * id the tracked `layout` default places in `top-left`), `mount() → DOM element`, and
 * `update(state, config)` that re-renders from the live session readout — knowing NOTHING about its
 * placement (the zone-based `layout` config drives that). It **reads** the plain
 * {@link NetSessionState} (via `deps.getNet()`) and **dispatches command ids** (design Principle 3
 * "one action layer": the Host / Join buttons fire the exact same `hostGame` / `joinGame` commands a
 * keybinding or the menu's Host/Join entry does — via the deps-supplied `dispatch`, the scene's
 * command registry).
 *
 * The `joinGame` command is argument-free like every other command; the typed code rides via
 * `deps.setPendingJoinCode(code)` — the widget stashes the validated code on the session's pending-
 * code seam, THEN dispatches `joinGame`, and the session reads it. Before dispatching, the widget
 * validates the typed code with the pure {@link validateGameCode} and shows an inline error for a
 * malformed one (empty / too-short / bad-chars) — so a bad code never reaches the transport
 * (agent-principles: negative cases; #3 observable behavior, never a log line).
 *
 * All panel/label/banner DECISIONS live in the pure model; this file only paints the model onto DOM,
 * forwards clicks to `dispatch`, and copies the code to the clipboard. It touches `document`, so it
 * is the Playwright-verified IO boundary (asserted on `window.__pente` getNet() + real interactions),
 * not unit/mutation-gated. `data-testid`s expose the rendered model + panel for readback.
 */

import type { Widget, WidgetFactory } from '../registry.ts';
import {
  deriveNet,
  validateGameCode,
  CODE_ERROR_TEXT,
  HOST_GAME_COMMAND,
  JOIN_GAME_COMMAND,
  type NetSessionState,
  type NetModel,
} from './netModel.ts';

/** The stable widget id — matches the `connectionStatus` entry in the tracked `layout` default. */
export const NET_WIDGET_ID = 'connectionStatus';

/** The pristine offline state used before any session readout is supplied (mount / first paint). */
const OFFLINE_STATE: NetSessionState = {
  phase: 'offline',
  code: null,
  seat: null,
  peerPresent: false,
  joinError: null,
};

/**
 * The deps a net widget needs: a document to build in (injected for testability), the command
 * `dispatch` (the scene's registry — the SAME path a keybinding uses, design Principle 3), a live
 * `getNet()` readout of the session, and `setPendingJoinCode` (the seam the widget stashes a
 * validated join code on before dispatching the argument-free `joinGame` command).
 */
export interface NetDeps {
  readonly doc: Document;
  /** Dispatch a command id (Host / Join). Returns whether a command ran. */
  dispatch(commandId: string): boolean;
  /** The live session readout the widget renders (produced by the scene's net session). */
  getNet(): NetSessionState;
  /** Stash a validated join code for the next `joinGame` dispatch (the argument seam). */
  setPendingJoinCode(code: string): void;
  /**
   * Copy `text` to the clipboard (injected so the widget never reaches for a global `navigator`
   * directly — testable, and the app supplies the real `navigator.clipboard.writeText`). Returns a
   * promise; a rejection is surfaced as a copy-failed hint rather than thrown.
   */
  copyToClipboard(text: string): Promise<void>;
}

/**
 * Build the networking {@link WidgetFactory}. The mounted element carries three mutually-exclusive
 * sub-panels (controls / status / conflict); `update` re-derives the pure model from the live
 * session readout and shows exactly the one panel the model names. The Host / Join buttons dispatch
 * their command ids; the copy button copies the shown code.
 */
export function netWidget(): WidgetFactory {
  return {
    id: NET_WIDGET_ID,
    mount(rawDeps: unknown): Widget {
      const deps = rawDeps as NetDeps;
      const doc = deps.doc;

      const element = doc.createElement('div');
      element.className = 'pente-widget pente-widget--net';
      element.setAttribute('data-testid', 'net-widget');

      // --- Controls panel (offline): Host button + Join input/button. ---------------------------
      const controls = doc.createElement('div');
      controls.className = 'pente-net-controls';
      controls.setAttribute('data-testid', 'net-controls');

      const hostButton = doc.createElement('button');
      hostButton.className = 'pente-net-host';
      hostButton.setAttribute('data-testid', 'net-host');
      hostButton.textContent = 'Host game';
      hostButton.addEventListener('click', () => {
        // Fire the SAME command id the menu's "Host" entry / a keybinding fires (design Principle 3).
        deps.dispatch(HOST_GAME_COMMAND);
      });
      controls.appendChild(hostButton);

      const joinRow = doc.createElement('div');
      joinRow.className = 'pente-net-join-row';

      const joinInput = doc.createElement('input');
      joinInput.type = 'text';
      joinInput.className = 'pente-net-join-input';
      joinInput.setAttribute('data-testid', 'net-join-input');
      joinInput.setAttribute('placeholder', 'Game code');
      joinInput.setAttribute('aria-label', 'Game code');
      joinRow.appendChild(joinInput);

      const joinButton = doc.createElement('button');
      joinButton.className = 'pente-net-join';
      joinButton.setAttribute('data-testid', 'net-join');
      joinButton.textContent = 'Join';
      joinButton.addEventListener('click', () => attemptJoin());
      joinRow.appendChild(joinButton);
      controls.appendChild(joinRow);

      // A single inline error line under the Join row: either the pre-dispatch code-validation
      // error (widget-local) or the post-dispatch session join error (from the readout).
      const joinError = doc.createElement('div');
      joinError.className = 'pente-net-join-error';
      joinError.setAttribute('data-testid', 'net-join-error');
      joinError.hidden = true;
      controls.appendChild(joinError);

      element.appendChild(controls);

      // --- Status panel (connecting/connected): the game code + copy, status line, seat. --------
      const status = doc.createElement('div');
      status.className = 'pente-net-status';
      status.setAttribute('data-testid', 'net-status');

      const statusLine = doc.createElement('div');
      statusLine.className = 'pente-net-status-line';
      statusLine.setAttribute('data-testid', 'net-status-line');
      status.appendChild(statusLine);

      const codeRow = doc.createElement('div');
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
      status.appendChild(codeRow);

      const seatLine = doc.createElement('div');
      seatLine.className = 'pente-net-seat';
      seatLine.setAttribute('data-testid', 'net-seat');
      status.appendChild(seatLine);

      element.appendChild(status);

      // --- Conflict panel (conflict): the stopped-game banner. ----------------------------------
      const conflict = doc.createElement('div');
      conflict.className = 'pente-net-conflict';
      conflict.setAttribute('data-testid', 'net-conflict');
      conflict.setAttribute('role', 'alert');
      element.appendChild(conflict);

      /** Validate the typed code and, if valid, stash it + dispatch `joinGame`; else show the error. */
      function attemptJoin(): void {
        const validation = validateGameCode(joinInput.value);
        if (!validation.ok) {
          showJoinError(CODE_ERROR_TEXT[validation.reason]);
          return;
        }
        clearJoinError();
        deps.setPendingJoinCode(validation.code);
        deps.dispatch(JOIN_GAME_COMMAND);
      }

      function showJoinError(text: string): void {
        joinError.textContent = text;
        joinError.hidden = false;
      }

      function clearJoinError(): void {
        joinError.textContent = '';
        joinError.hidden = true;
      }

      /** Paint a derived model + the raw state onto the three panels (show exactly one). */
      function render(model: NetModel, state: NetSessionState): void {
        element.setAttribute('data-panel', model.panel);
        controls.hidden = model.panel !== 'controls';
        status.hidden = model.panel !== 'status';
        conflict.hidden = model.panel !== 'conflict';

        statusLine.textContent = model.statusText;

        // Code + copy row: shown only when there is a code to show.
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

        // The inline join error: prefer the post-dispatch session error (a real join failure) over a
        // stale pre-dispatch validation hint. A validation hint set by `attemptJoin` persists until
        // the next attempt; a session error overrides it while present.
        if (model.joinErrorText !== null) {
          showJoinError(model.joinErrorText);
        } else if (state.joinError === null && joinError.textContent === '') {
          clearJoinError();
        }
      }

      /** Re-read the live session readout and repaint. */
      function refresh(): void {
        const state = deps.getNet();
        render(deriveNet(state), state);
      }

      // First paint from the live readout (falls back to offline if the session is not yet wired).
      render(deriveNet(OFFLINE_STATE), OFFLINE_STATE);
      refresh();

      return {
        element,
        // The widget repaints from the live session readout on every state change the shell pushes
        // (place/undo/host/join/presence/conflict all route through the scene's onStateChange).
        update(): void {
          refresh();
        },
      };
    },
  };
}
