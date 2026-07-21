/**
 * Network-Game drawer panel widget (issue #13 / #16) — the DOM/dispatch + input-scope IO glue for the
 * pure {@link deriveNetPanel} view-model (`netPanelModel.ts`). Picker SIMPLIFIED on issue #16 from the
 * three-source (custom/saved/random) tabs to ONE unified combobox; plan of record
 * `planning/2026-07-21-menu-live-settings-batch.md`.
 *
 * It relocates the Host/Join INITIATION out of the always-on `connectionStatus` overlay INTO the
 * non-blocking drawer (issue #13 / #24): the menu's "Network Game" entry dispatches `openNetwork`,
 * which opens THIS panel. The panel carries a SINGLE game-code COMBOBOX — a text input plus a dropdown
 * of recently-used codes — then a Host button (create this room) and a Join button (enter this room).
 * It reuses Increment B's non-blocking-panel-in-drawer pattern EXACTLY (mirrors `settings.ts`):
 * opening PUSHES a NON-blocking scope ({@link NET_PANEL_SCOPE_BLOCKING} === false) so the board stays
 * interactive under it, and closing POPS it — every close path (Escape, outside-click, the ✕ button,
 * choosing Host/Join) pops exactly once, so the stack never leaks.
 *
 * The combobox input shows a FRESH random code as its PLACEHOLDER (generated via `generateGameCode`
 * when the panel opens — greyed, NOT the value). The EFFECTIVE code Host/Join act on is the typed
 * text when non-empty, else that placeholder (so hosting without typing uses the offered random
 * room). The dropdown lists the recent codes (newest-first from the C.1 store); clicking a row fills
 * the input, and each row's remove control deletes just that code from the store. All these DECISIONS
 * (effective code, validation, button enablement) live in the pure model; this file only paints the
 * model onto DOM, forwards clicks, generates the random placeholder via the injected rng, and
 * mutates the C.1 store.
 *
 * It DISPATCHES the SAME command ids a keybinding / the old inline controls fired (design Principle 3,
 * one action layer): Host → {@link HOST_GAME_COMMAND}; Join → stash the validated code via
 * `setPendingJoinCode` THEN dispatch {@link JOIN_GAME_COMMAND}. It does NOT reimplement the net
 * session/transport — that stays in `session.ts`/`appSession.ts`. On host/join it records the used
 * code into the C.1 recent-codes store (`recordRecentCode`) so it feeds the dropdown next time. It
 * touches `document`, so it is the Playwright-verified IO boundary (asserted on `window.__pente`
 * getNet() + real interactions + screenshots), not unit/mutation-gated. `data-testid`s expose the
 * rendered model + open state for readback (agent-principles #3: observable behavior).
 */

import type { Widget, WidgetFactory } from '../registry.ts';
import { HOST_GAME_COMMAND, JOIN_GAME_COMMAND, generateGameCode } from './netModel.ts';
import { listRecentCodes, recordRecentCode, removeRecentCode } from './recentCodes.ts';
import {
  initialNetPanel,
  setPanelText,
  chooseRecent,
  removeRecent,
  deriveNetPanel,
  type NetPanelState,
} from './netPanelModel.ts';

/** The stable widget id — matches the `networkGame` entry in the tracked `layout` default. */
export const NET_PANEL_WIDGET_ID = 'networkGame';

/** The stable input scope id the open panel pushes. */
export const NET_PANEL_SCOPE_ID = 'networkGame';

/**
 * Whether the panel's scope BLOCKS unhandled keys. `false` (non-blocking, #24 / Increment B): the
 * panel opens WITHIN the drawer context over the LIVE board, so unbound keys fall THROUGH to the
 * camera/game scopes below and the board stays interactive while you pick a code. Mirrors the
 * settings panel's blocking policy exactly. A single named constant so the policy is one testable
 * fact, not a literal buried in the glue.
 */
export const NET_PANEL_SCOPE_BLOCKING = false;

/** A minimal scope shape the widget pushes (mirrors `input/scopes.ts` `Scope`, as settings/menu do). */
export interface NetPanelScope {
  readonly id: string;
  readonly bindings: Readonly<Record<string, string>>;
  readonly blocking: boolean;
}

/**
 * The deps the Network-Game panel needs. Mirrors the settings/net widgets: a document (injected for
 * testability), the command `dispatch` (the SAME registry a keybinding uses, Principle 3), the
 * scope-stack `pushScope`/`popScope` (the open panel pushes/pops the non-blocking `networkGame`
 * scope), `registerOpenNetwork` (the widget hands its `open()` back so the `openNetwork` command
 * opens it), and `setPendingJoinCode` (the seam the widget stashes a validated join code on before
 * dispatching the argument-free `joinGame` command — reused from the inline widget, NOT reinvented).
 */
export interface NetPanelDeps {
  readonly doc: Document;
  /** Dispatch a command id (Host / Join). Returns whether a command ran. */
  dispatch(commandId: string): boolean;
  /** Push the NON-blocking `networkGame` scope when the panel opens (board stays live under it). */
  pushScope(scope: NetPanelScope): void;
  /** Pop the topmost input scope (the `networkGame` scope) when the panel closes. */
  popScope(): void;
  /** Register the widget's `open()` so the `openNetwork` command opens this panel. */
  registerOpenNetwork(open: () => void): void;
  /** Stash a validated join code for the next `joinGame` dispatch (the argument seam, from `net.ts`). */
  setPendingJoinCode(code: string): void;
}

/** Build the NON-blocking `networkGame` scope the open panel pushes (mirrors the settings scope). */
function netPanelScope(): NetPanelScope {
  return { id: NET_PANEL_SCOPE_ID, bindings: {}, blocking: NET_PANEL_SCOPE_BLOCKING };
}

/**
 * Build the Network-Game-panel {@link WidgetFactory}. The mounted element is a hidden left-edge
 * drawer panel (no visible trigger — opened by the `openNetwork` command). It is (re)populated from
 * the pure model each time it opens (a fresh random placeholder + the current recent codes), so the
 * dropdown always reflects the current store and a fresh code is offered each open.
 */
export function netPanelWidget(): WidgetFactory {
  return {
    id: NET_PANEL_WIDGET_ID,
    mount(rawDeps: unknown): Widget {
      const deps = rawDeps as NetPanelDeps;
      const doc = deps.doc;

      // Root is the LEFT-edge slide-in panel (slid off-screen + hidden until opened, mirroring the
      // settings modal). Toggled by the `--open` class (NOT `[hidden]`/`display:none`, not animatable).
      const element = doc.createElement('div');
      element.className = 'pente-netpanel-modal';
      element.setAttribute('data-testid', 'netpanel-modal');
      element.setAttribute('role', 'dialog');
      element.setAttribute('aria-label', 'Network Game');

      const panel = doc.createElement('div');
      panel.className = 'pente-netpanel-panel';

      const title = doc.createElement('div');
      title.className = 'pente-netpanel-title';
      title.textContent = 'Network Game';
      panel.appendChild(title);

      const closeButton = doc.createElement('button');
      closeButton.className = 'pente-netpanel-close';
      closeButton.setAttribute('data-testid', 'netpanel-close');
      closeButton.setAttribute('aria-label', 'Close network game');
      closeButton.textContent = '✕';
      panel.appendChild(closeButton);

      // --- The unified combobox: a text input + a dropdown-toggle chevron. -------------------------
      const combo = doc.createElement('div');
      combo.className = 'pente-netpanel-combo';

      const codeInput = doc.createElement('input');
      codeInput.type = 'text';
      codeInput.className = 'pente-netpanel-code-input';
      codeInput.setAttribute('data-testid', 'netpanel-code-input');
      codeInput.setAttribute('aria-label', 'Game code');
      codeInput.setAttribute('autocomplete', 'off');
      combo.appendChild(codeInput);

      const toggle = doc.createElement('button');
      toggle.type = 'button';
      toggle.className = 'pente-netpanel-toggle';
      toggle.setAttribute('data-testid', 'netpanel-toggle');
      toggle.setAttribute('aria-label', 'Show recent codes');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-controls', 'netpanel-recent-list');
      toggle.textContent = '▾';
      combo.appendChild(toggle);

      panel.appendChild(combo);

      // --- The recent-codes dropdown (revealed by the toggle). ------------------------------------
      const recentList = doc.createElement('ul');
      recentList.className = 'pente-netpanel-recent';
      recentList.id = 'netpanel-recent-list';
      recentList.setAttribute('data-testid', 'netpanel-recent');
      recentList.setAttribute('role', 'listbox');
      recentList.setAttribute('aria-label', 'Recent game codes');
      recentList.hidden = true;
      panel.appendChild(recentList);

      // --- Inline validation error (invalid typed code). -----------------------------------------
      const error = doc.createElement('div');
      error.className = 'pente-netpanel-error';
      error.setAttribute('data-testid', 'netpanel-error');
      error.hidden = true;
      panel.appendChild(error);

      // --- Host + Join actions. ------------------------------------------------------------------
      const actions = doc.createElement('div');
      actions.className = 'pente-netpanel-actions';
      const hostButton = doc.createElement('button');
      hostButton.className = 'pente-netpanel-host';
      hostButton.setAttribute('data-testid', 'netpanel-host');
      hostButton.textContent = 'Host';
      const joinButton = doc.createElement('button');
      joinButton.className = 'pente-netpanel-join';
      joinButton.setAttribute('data-testid', 'netpanel-join');
      joinButton.textContent = 'Join';
      actions.appendChild(hostButton);
      actions.appendChild(joinButton);
      panel.appendChild(actions);

      element.appendChild(panel);

      let open = false;
      let dropdownOpen = false;
      // The combobox state (the single source of truth the pure model reads). Rebuilt on each open.
      let state: NetPanelState = initialNetPanel(generateGameCode(Math.random), listRecentCodes());

      /** Rebuild the DOM from the pure model derived off the combobox state. */
      function render(): void {
        const model = deriveNetPanel(state);

        // The input shows the raw typed text as its VALUE and the fresh random code as its PLACEHOLDER
        // (greyed, not the value) — an untouched input hosts/joins the placeholder (agent-principles
        // #3: the placeholder is observable via the input's `placeholder` attribute).
        if (codeInput.value !== model.text) codeInput.value = model.text;
        codeInput.setAttribute('placeholder', model.placeholder);

        // Rebuild the dropdown rows: each row is a clickable code + a remove control.
        recentList.replaceChildren();
        for (const row of model.recentRows) {
          recentList.appendChild(recentRow(doc, row.code, chooseCode, removeCode));
        }
        toggle.disabled = model.recentRows.length === 0;

        // Error line + button enablement come straight from the pure model.
        if (model.codeError !== null) {
          error.textContent = model.codeError;
          error.hidden = false;
        } else {
          error.textContent = '';
          error.hidden = true;
        }
        hostButton.disabled = !model.codeValid;
        joinButton.disabled = !model.codeValid;
        element.setAttribute('data-code-valid', String(model.codeValid));
        element.setAttribute('data-recent-count', String(model.recentRows.length));
      }

      /** Show/hide the recent dropdown (reflected on the toggle's aria-expanded). */
      function setDropdown(nextOpen: boolean): void {
        dropdownOpen = nextOpen;
        recentList.hidden = !nextOpen;
        toggle.setAttribute('aria-expanded', String(nextOpen));
        element.setAttribute('data-dropdown-open', String(nextOpen));
      }

      /** Fill the input from a chosen recent code, then collapse the dropdown. */
      function chooseCode(code: string): void {
        state = chooseRecent(state, code);
        render();
        setDropdown(false);
        codeInput.focus();
      }

      /** Remove a recent code from BOTH the C.1 store and the rendered model, keeping them in sync. */
      function removeCode(code: string): void {
        removeRecentCode(code);
        state = removeRecent(state, code);
        render();
        // Collapse if the list just emptied (the toggle is now disabled and nothing is left to show).
        if (state.recent.length === 0) setDropdown(false);
      }

      // --- Wiring ---------------------------------------------------------------------------------
      codeInput.addEventListener('input', () => {
        state = setPanelText(state, codeInput.value);
        render();
      });
      toggle.addEventListener('click', () => {
        if (toggle.disabled) return;
        setDropdown(!dropdownOpen);
      });

      hostButton.addEventListener('click', () => act(HOST_GAME_COMMAND));
      joinButton.addEventListener('click', () => act(JOIN_GAME_COMMAND));

      /**
       * Perform a Host or Join with the canonical effective code: record it into the recent-codes
       * store, stash it on the pending-code seam, dispatch the command, and close the panel. BOTH
       * Host and Join ride the chosen code — issue #13's "one code, two actions": Host creates the
       * room THIS code names, Join enters it (the app's host/join hooks read the stashed code). Guarded
       * by the model's validity — a disabled button never fires, but the guard is defensive
       * (agent-principles: never dispatch an empty/malformed code to the transport).
       */
      function act(commandId: string): void {
        const model = deriveNetPanel(state);
        if (model.canonicalCode === null) return; // invalid — never dispatch (buttons are disabled)
        const canonical = model.canonicalCode;
        // Remember the code for next time (feeds the dropdown). Canonical → the store keeps it.
        recordRecentCode(canonical);
        // Stash the chosen code for BOTH actions: Host creates this room, Join enters it (the app's
        // host/join hooks consume the stashed code). The command id itself stays argument-free.
        deps.setPendingJoinCode(canonical);
        // Close FIRST (pop our scope) THEN dispatch, mirroring the menu: a command that changes scope
        // downstream sees a clean stack.
        close();
        deps.dispatch(commandId);
      }

      function onKeyDown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      }

      /** Close on a click OUTSIDE the panel (no backdrop — mirrors the settings/menu outside-click). */
      function onOutsidePointer(event: Event): void {
        const target = event.target as Node | null;
        if (target !== null && panel.contains(target)) return;
        close();
      }

      function openPanel(): void {
        if (open) return; // idempotent — a second open must not push a second scope
        open = true;
        // Fresh combobox each open: a fresh random placeholder generated, the recent list re-read.
        state = initialNetPanel(generateGameCode(Math.random), listRecentCodes());
        setDropdown(false);
        render();
        element.classList.add('pente-netpanel-modal--open');
        element.setAttribute('data-open', 'true');
        deps.pushScope(netPanelScope());
        doc.addEventListener('keydown', onKeyDown);
        doc.addEventListener('pointerdown', onOutsidePointer, true);
      }

      function close(): void {
        if (!open) return; // idempotent — closing when closed must not pop a scope
        open = false;
        setDropdown(false);
        element.classList.remove('pente-netpanel-modal--open');
        element.setAttribute('data-open', 'false');
        doc.removeEventListener('keydown', onKeyDown);
        doc.removeEventListener('pointerdown', onOutsidePointer, true);
        deps.popScope();
      }

      closeButton.addEventListener('click', () => close());
      element.setAttribute('data-open', 'false');

      // Hand our opener to the shell so the `openNetwork` command opens this panel.
      deps.registerOpenNetwork(openPanel);

      return {
        element,
        // The panel is driven by its own combobox state, not the game state — `update` is a no-op (the
        // open panel is rebuilt from the store on open; nothing to repaint on a board change).
        update(): void {},
        dispose(): void {
          if (open) close();
        },
      };
    },
  };
}

/**
 * Build one recent-code dropdown row: a clickable code cell (fills the input) plus a remove control
 * (drops just that code). The remove button carries an accessible label naming the code it removes.
 */
function recentRow(
  doc: Document,
  code: string,
  onChoose: (code: string) => void,
  onRemove: (code: string) => void,
): HTMLLIElement {
  const li = doc.createElement('li');
  li.className = 'pente-netpanel-recent-row';
  li.setAttribute('role', 'option');
  li.setAttribute('data-testid', 'netpanel-recent-row');
  li.setAttribute('data-code', code);

  const codeBtn = doc.createElement('button');
  codeBtn.type = 'button';
  codeBtn.className = 'pente-netpanel-recent-code';
  codeBtn.setAttribute('data-testid', 'netpanel-recent-code');
  codeBtn.textContent = code;
  codeBtn.addEventListener('click', () => onChoose(code));
  li.appendChild(codeBtn);

  const removeBtn = doc.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'pente-netpanel-recent-remove';
  removeBtn.setAttribute('data-testid', 'netpanel-recent-remove');
  removeBtn.setAttribute('aria-label', `Remove ${code} from recent codes`);
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', () => onRemove(code));
  li.appendChild(removeBtn);

  return li;
}
