/**
 * Network-Game drawer panel widget (Task C.2 — GitHub issue #13) — the DOM/dispatch + input-scope IO
 * glue for the pure {@link deriveNetPanel} view-model (`netPanelModel.ts`). Picker design resolved on
 * issue #13; plan of record `planning/2026-07-21-menu-live-settings-batch.md` step 7 (Increment C).
 *
 * It relocates the Host/Join INITIATION out of the always-on `connectionStatus` overlay INTO the
 * non-blocking drawer (issue #13 / #24): the menu's "Network Game" entry dispatches `openNetwork`,
 * which opens THIS panel. The panel carries a SINGLE game-code field fed by a picker with three
 * sources (custom / saved / random), then a Host button (create this room) and a Join button (enter
 * this room). It reuses Increment B's non-blocking-panel-in-drawer pattern EXACTLY (mirrors
 * `settings.ts`): opening PUSHES a NON-blocking scope ({@link NET_PANEL_SCOPE_BLOCKING} === false) so
 * the board stays interactive under it, and closing POPS it — every close path (Escape, outside-click,
 * the ✕ button, choosing Host/Join) pops exactly once, so the stack never leaks.
 *
 * It DISPATCHES the SAME command ids a keybinding / the old inline controls fired (design Principle 3,
 * one action layer): Host → {@link HOST_GAME_COMMAND}; Join → stash the validated code via
 * `setPendingJoinCode` THEN dispatch {@link JOIN_GAME_COMMAND}. It does NOT reimplement the net
 * session/transport — that stays in `session.ts`/`appSession.ts`. On host/join it records the used
 * code into the C.1 recent-codes store (`recordRecentCode`) so it feeds the "saved" dropdown next
 * time. The picker DECISIONS (effective code, validation, button enablement) all live in the pure
 * model; this file only paints the model onto DOM, forwards clicks, and generates a random code via
 * the injected rng. It touches `document`, so it is the Playwright-verified IO boundary (asserted on
 * `window.__pente` getNet() + real interactions + screenshots), not unit/mutation-gated. `data-testid`s
 * expose the rendered model + open state for readback (agent-principles #3: observable behavior).
 */

import type { Widget, WidgetFactory } from '../registry.ts';
import { HOST_GAME_COMMAND, JOIN_GAME_COMMAND, generateGameCode } from './netModel.ts';
import { listRecentCodes, recordRecentCode } from './recentCodes.ts';
import {
  initialNetPanel,
  setPanelSource,
  setPanelCustom,
  setPanelSaved,
  setPanelRandom,
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
 * the pure model each time it opens (fresh recent codes + a fresh random code), so the "saved"
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

      // --- Source picker: three radio-like buttons (custom / saved / random). --------------------
      const sources = doc.createElement('div');
      sources.className = 'pente-netpanel-sources';
      const customBtn = sourceButton(doc, sources, 'custom', 'Custom');
      const savedBtn = sourceButton(doc, sources, 'saved', 'Saved');
      const randomBtn = sourceButton(doc, sources, 'random', 'Random');
      panel.appendChild(sources);

      // --- The single game-code field feeding Host/Join. Editing it selects the custom source. ---
      const codeInput = doc.createElement('input');
      codeInput.type = 'text';
      codeInput.className = 'pente-netpanel-code-input';
      codeInput.setAttribute('data-testid', 'netpanel-code-input');
      codeInput.setAttribute('placeholder', 'Game code');
      codeInput.setAttribute('aria-label', 'Game code');
      panel.appendChild(codeInput);

      // --- The saved-code dropdown (shown when the saved source is active). ----------------------
      const savedSelect = doc.createElement('select');
      savedSelect.className = 'pente-netpanel-saved';
      savedSelect.setAttribute('data-testid', 'netpanel-saved');
      savedSelect.setAttribute('aria-label', 'Saved game codes');
      panel.appendChild(savedSelect);

      // --- Regenerate button (shown when the random source is active). ---------------------------
      const regenBtn = doc.createElement('button');
      regenBtn.className = 'pente-netpanel-regen';
      regenBtn.setAttribute('data-testid', 'netpanel-regen');
      regenBtn.textContent = 'New random code';
      panel.appendChild(regenBtn);

      // --- Inline validation error (invalid effective code). -------------------------------------
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
      // The picker state (the single source of truth the pure model reads). Rebuilt on each open.
      let state: NetPanelState = initialNetPanel();

      /** Rebuild the DOM from the pure model derived off the picker state + the live recent codes. */
      function render(): void {
        const model = deriveNetPanel(state, listRecentCodes());

        element.setAttribute('data-source', model.source);

        // Highlight the active source button.
        for (const [btn, src] of [
          [customBtn, 'custom'],
          [savedBtn, 'saved'],
          [randomBtn, 'random'],
        ] as const) {
          btn.setAttribute('data-active', String(model.source === src));
        }

        // The single field shows the effective code; only DIRECTLY editable in the custom source
        // (saved/random drive it). Keeping it read-only elsewhere prevents an edit that would silently
        // desync from the chosen source without also switching to custom.
        codeInput.value = model.effectiveCode;
        codeInput.readOnly = model.source !== 'custom';

        // Saved dropdown: rebuild options from the store; shown only in the saved source.
        savedSelect.replaceChildren();
        const placeholder = doc.createElement('option');
        placeholder.value = '';
        placeholder.textContent =
          model.savedOptions.length === 0 ? 'No saved codes yet' : 'Pick a saved code…';
        placeholder.selected = model.savedOptions.every((o) => !o.selected);
        savedSelect.appendChild(placeholder);
        for (const opt of model.savedOptions) {
          const o = doc.createElement('option');
          o.value = opt.code;
          o.textContent = opt.code;
          o.selected = opt.selected;
          savedSelect.appendChild(o);
        }
        savedSelect.hidden = model.source !== 'saved';
        regenBtn.hidden = model.source !== 'random';

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
      }

      /** Regenerate the random code from the injected rng and re-render. */
      function regenerate(): void {
        state = setPanelRandom(state, generateGameCode(Math.random));
        render();
      }

      // --- Wiring ---------------------------------------------------------------------------------
      customBtn.addEventListener('click', () => {
        state = setPanelSource(state, 'custom');
        render();
        codeInput.focus();
      });
      savedBtn.addEventListener('click', () => {
        state = setPanelSource(state, 'saved');
        render();
      });
      randomBtn.addEventListener('click', () => {
        // Selecting random with no code yet generates one; otherwise keep the current random code.
        if (state.random === null) regenerate();
        else {
          state = setPanelSource(state, 'random');
          render();
        }
      });
      codeInput.addEventListener('input', () => {
        state = setPanelCustom(state, codeInput.value);
        render();
      });
      savedSelect.addEventListener('change', () => {
        if (savedSelect.value === '') return; // the placeholder — no choice made
        state = setPanelSaved(state, savedSelect.value);
        render();
      });
      regenBtn.addEventListener('click', () => regenerate());

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
        const model = deriveNetPanel(state, listRecentCodes());
        if (model.canonicalCode === null) return; // invalid — never dispatch (buttons are disabled)
        const canonical = model.canonicalCode;
        // Remember the code for next time (feeds the "saved" dropdown). Canonical → the store keeps it.
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
        // Fresh picker each open: a fresh random code offered, and the saved list re-read from the store.
        state = setPanelRandom(initialNetPanel(), generateGameCode(Math.random));
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
        // The panel is driven by its own picker state, not the game state — `update` is a no-op (the
        // open panel is rebuilt from the store on open; nothing to repaint on a board change).
        update(): void {},
        dispose(): void {
          if (open) close();
        },
      };
    },
  };
}

/** Append a source-selector button to `parent`; returns it for wiring + active-state marking. */
function sourceButton(
  doc: Document,
  parent: HTMLElement,
  source: string,
  label: string,
): HTMLButtonElement {
  const btn = doc.createElement('button');
  btn.className = `pente-netpanel-source pente-netpanel-source--${source}`;
  btn.setAttribute('data-testid', `netpanel-source-${source}`);
  btn.setAttribute('data-source', source);
  btn.textContent = label;
  parent.appendChild(btn);
  return btn;
}
