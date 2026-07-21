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
 * Task C.2 / issue #13: the Host/Join INITIATION controls have MOVED into the non-blocking drawer's
 * "Network Game" panel (`netPanel.ts`) with a code picker. This widget no longer HOSTS/JOINS — it is
 * now the PERSISTENT connection/seat/turn/conflict STATUS display that must stay visible on the board
 * (it must NOT be buried in the transient drawer). While offline it shows a passive prompt pointing at
 * the menu; once connected it shows the live code/seat/status; a fork shows the conflict banner.
 *
 * All panel/label/banner DECISIONS live in the pure model; this file only paints the model onto DOM
 * and copies the code to the clipboard. It touches `document`, so it is the Playwright-verified IO
 * boundary (asserted on `window.__pente` getNet() + real interactions), not unit/mutation-gated.
 * `data-testid`s expose the rendered model + panel for readback.
 */

import type { Widget, WidgetFactory } from '../registry.ts';
import {
  deriveNet,
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
 * The deps the net STATUS widget needs: a document to build in (injected for testability), a live
 * `getNet()` readout of the session, and the clipboard copy. Host/Join initiation moved to the
 * drawer's Network-Game panel (`netPanel.ts`), so this widget no longer dispatches commands or
 * stashes a join code — it is a pure readout of the live session.
 */
export interface NetDeps {
  readonly doc: Document;
  /** The live session readout the widget renders (produced by the scene's net session). */
  getNet(): NetSessionState;
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

      // --- Controls panel (offline): a PASSIVE prompt pointing at the menu (Task C.2 / issue #13 —
      //     Host/Join initiation moved to the drawer's Network-Game panel; this widget no longer
      //     initiates, it only reflects status). The status line below carries the offline prompt copy;
      //     this panel is otherwise empty of controls now.
      const controls = doc.createElement('div');
      controls.className = 'pente-net-controls';
      controls.setAttribute('data-testid', 'net-controls');
      const offlinePrompt = doc.createElement('div');
      offlinePrompt.className = 'pente-net-offline-prompt';
      offlinePrompt.setAttribute('data-testid', 'net-offline-prompt');
      controls.appendChild(offlinePrompt);
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

      /** Paint a derived model onto the three panels (show exactly one). */
      function render(model: NetModel): void {
        element.setAttribute('data-panel', model.panel);
        controls.hidden = model.panel !== 'controls';
        status.hidden = model.panel !== 'status';
        conflict.hidden = model.panel !== 'conflict';

        // Offline prompt (controls panel): the same status copy, pointing the user at the menu where
        // Host/Join now live (Task C.2). The status panel's own line carries connecting/connected copy.
        offlinePrompt.textContent = model.statusText;
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
      }

      /** Re-read the live session readout and repaint. */
      function refresh(): void {
        render(deriveNet(deps.getNet()));
      }

      // First paint from the live readout (falls back to offline if the session is not yet wired).
      render(deriveNet(OFFLINE_STATE));
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
