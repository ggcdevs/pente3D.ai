/**
 * Menu button + slide-in DRAWER widget (Task 5.3 / #24) — the DOM/dispatch + input-scope IO glue
 * for the pure {@link deriveMenu} view-model (`menuModel.ts`). Render-ui design Part 6 "Widget
 * roster: menu button + menu (Settings, Host, Join, Load, Export)".
 *
 * A self-contained widget by the design-Part-6 contract: a stable string id (`menuButton`, the id
 * the tracked `layout` default places in `top-right`), `mount() → DOM element`, and
 * `update(state, config)` — knowing NOTHING about its placement (the zone-based `layout` config
 * drives that). It **dispatches command ids** (design Principle 3 "one action layer": choosing a
 * menu entry fires the exact same command a keybinding would, via the deps-supplied `dispatch` —
 * the scene's command registry).
 *
 * #24/#16: the menu is a **left-edge, NON-blocking slide-in drawer**, not a centered blocking modal.
 * Opening PUSHES a NON-blocking input scope ({@link MENU_SCOPE_BLOCKING} `=== false`) so stray keys
 * fall THROUGH to the camera/game scopes below — the board stays fully interactive (orbit/pan/zoom
 * + placement keep working) WHILE the drawer is open. That is the whole point of the drawer: you
 * edit settings and watch the live board. Closing POPS the scope — so this widget is handed
 * `pushScope`/`popScope` (the scene's scope stack) alongside `dispatch`. The drawer closes on
 * **Escape** or an **outside-click**, and every close path (Escape, outside-click, choosing an
 * entry, the ✕ button) pops the scope exactly once, so the stack can never leak a scope.
 *
 * The drawer OVERLAYS the left edge of the full-viewport canvas — it does NOT reflow the board and
 * has NO full-viewport backdrop (a backdrop would eat the very board clicks the non-blocking scope
 * is meant to preserve). Outside-click detection is therefore a document-level "was the click
 * outside our button + panel?" check while open.
 *
 * All entry DECISIONS (which entries, their order, their command ids) and the open/closed STATE
 * transitions live in the pure model; this file only paints the model onto DOM, forwards clicks to
 * `dispatch`, and manages the non-blocking scope. It touches `document`, so it is the
 * Playwright-verified IO boundary (asserted on `window.__pente` getInput() scope stack + getCamera
 * delta + real interactions), not unit/mutation-gated. `data-*` attributes + `data-testid`s are
 * exposed so a test reads the rendered model + open state back off the live DOM (agent-principles
 * #3: observable behavior, never a log line).
 */

import type { Widget, WidgetFactory } from '../registry.ts';
import {
  deriveMenu,
  MENU_SCOPE_ID,
  MENU_SCOPE_BLOCKING,
  closedMenu,
  toggleMenu,
  closeMenu,
  type MenuEntrySpec,
} from './menuModel.ts';

/** The stable widget id — matches the `menuButton` entry in the tracked `layout` default. */
export const MENU_WIDGET_ID = 'menuButton';

/** A minimal scope shape the widget pushes — mirrors `input/scopes.ts` `Scope` without importing
 * it (keeps this UI glue decoupled from the input module's internals; the scene supplies the
 * push/pop that consume it). A NON-blocking scope with no bindings: unhandled keys fall through to
 * the camera/game scopes below (#24), so the board stays interactive while the drawer is open. */
export interface MenuScope {
  /** The scope's id (`menu`), so a test can see it on the `getInput()` stack. */
  readonly id: string;
  /** No key bindings — the drawer handles Escape itself (via its own document listener); every
   * other key is left unbound so it falls through to the scopes below. */
  readonly bindings: Readonly<Record<string, string>>;
  /** Non-blocking ({@link MENU_SCOPE_BLOCKING}): unbound keys fall through to game/camera scopes,
   * keeping the board interactive while the drawer is open. */
  readonly blocking: boolean;
}

/**
 * The deps a menu widget needs: a document to build in (injected for testability), the command
 * `dispatch` (the scene's registry — the SAME path a keybinding uses, design Principle 3), and the
 * scene's scope-stack `pushScope`/`popScope` so opening/closing the modal pushes/pops the blocking
 * `menu` scope.
 */
export interface MenuDeps {
  readonly doc: Document;
  /** Dispatch a command id (a chosen menu entry). Returns whether a command ran. */
  dispatch(commandId: string): boolean;
  /** Push an input scope (the non-blocking `menu` scope) when the drawer opens. */
  pushScope(scope: MenuScope): void;
  /** Pop the topmost input scope (the `menu` scope) when the drawer closes. */
  popScope(): void;
  /** The menu entry roster (defaults to the design-Part-6 set). Injectable for tests. */
  readonly entries?: readonly MenuEntrySpec[];
}

/** Build the NON-blocking `menu` scope the open drawer pushes (id `menu`, no bindings; blocking is
 * the pure {@link MENU_SCOPE_BLOCKING} policy so unbound keys fall through to the board — #24). */
function menuScope(): MenuScope {
  return { id: MENU_SCOPE_ID, bindings: {}, blocking: MENU_SCOPE_BLOCKING };
}

/**
 * Build the menu-button {@link WidgetFactory}. The mounted element is the button; the drawer is a
 * sibling panel toggled open/closed. Opening pushes the NON-blocking scope and slides the drawer
 * in; Escape / outside-click / an entry choice / the ✕ button all close it (pop the scope once).
 */
export function menuWidget(): WidgetFactory {
  return {
    id: MENU_WIDGET_ID,
    mount(rawDeps: unknown): Widget {
      const deps = rawDeps as MenuDeps;
      const doc = deps.doc;
      const model = deriveMenu(deps.entries);

      // Root carries BOTH the trigger button and the drawer panel, so outside-click detection is a
      // "is the click within the button or the panel?" check (those two are our interactive surface).
      const element = doc.createElement('div');
      element.className = 'pente-widget pente-widget--menu';

      const button = doc.createElement('button');
      button.className = 'pente-menu-button';
      button.setAttribute('data-testid', 'menu-button');
      button.setAttribute('aria-haspopup', 'menu');
      // Hamburger icon (inline SVG — no icon-font dependency). The button has no visible text, so
      // aria-label carries its accessible name; the SVG is decorative (aria-hidden).
      button.setAttribute('aria-label', 'Menu');
      button.innerHTML =
        '<svg class="pente-hamburger" viewBox="0 0 24 24" width="20" height="20" ' +
        'aria-hidden="true" focusable="false">' +
        '<path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round"/></svg>';
      element.appendChild(button);

      // The slide-in drawer panel: a labelled list of one button per menu item, anchored to the
      // LEFT viewport edge (CSS in container.ts). NO backdrop — the board stays visible + live to
      // its right. Slid off-screen (translateX(-100%)) + non-interactive + hidden from the a11y tree
      // via CSS until the `--open` class is toggled on. NOT `[hidden]`/`display:none` — `display` is
      // not animatable, so the toggle is a CLASS to allow the slide (#16). `data-testid` stays
      // `menu-modal` so existing wiring/tests keep their handle; the class carries the drawer role.
      const panelWrap = doc.createElement('div');
      panelWrap.className = 'pente-menu-drawer';
      panelWrap.setAttribute('data-testid', 'menu-modal');
      panelWrap.setAttribute('role', 'menu');
      panelWrap.setAttribute('aria-label', 'Menu');

      const panel = doc.createElement('div');
      panel.className = 'pente-menu-panel';

      const title = doc.createElement('div');
      title.className = 'pente-menu-title';
      title.textContent = 'Menu';
      panel.appendChild(title);

      const closeButton = doc.createElement('button');
      closeButton.className = 'pente-menu-close';
      closeButton.setAttribute('data-testid', 'menu-close');
      closeButton.setAttribute('aria-label', 'Close menu');
      closeButton.textContent = '✕'; // ✕
      panel.appendChild(closeButton);

      // One entry button per pure-model item; each dispatches its command id and closes the drawer.
      for (const item of model.items) {
        const entry = doc.createElement('button');
        entry.className = `pente-menu-entry pente-menu-entry--${item.id}`;
        entry.setAttribute('data-testid', `menu-entry-${item.id}`);
        entry.setAttribute('data-command', item.commandId);
        entry.textContent = item.label;
        entry.addEventListener('click', () => {
          // Close FIRST — pop this menu's scope — THEN dispatch the SAME command id a keybinding
          // fires (design Principle 3). Ordering matters: a command that opens another panel
          // (Settings) pushes its own scope, and popping ours first keeps the stack clean.
          close();
          deps.dispatch(item.commandId);
        });
        panel.appendChild(entry);
      }

      panelWrap.appendChild(panel);
      element.appendChild(panelWrap);

      // Open/closed lives in the pure model; this holds the current state and mirrors it to DOM +
      // the scope stack. `state.open` is the single source of truth the guards read (idempotency).
      let state = closedMenu();

      /** Close on Escape (only while open). Attached to the document while the drawer is open. */
      function onKeyDown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      }

      /**
       * Close on a pointerdown OUTSIDE the interactive surface (trigger button + drawer panel). A
       * click on the button or inside the panel keeps the drawer open; a click anywhere else —
       * including on the live board/canvas — is "outside" and closes it (design Part 6:
       * "outside-click closes"). There is deliberately NO backdrop, so the canvas underneath stays
       * clickable; this document-level listener is how outside-click still works without one.
       */
      function onOutsidePointer(event: Event): void {
        const target = event.target as Node | null;
        if (target !== null && (button.contains(target) || panel.contains(target))) return;
        close();
      }

      function open_(): void {
        if (state.open) return; // idempotent — a second open must not push a second scope
        state = toggleMenu(state);
        // Slide in by toggling the `--open` class (CSS animates transform + visibility). NOT the
        // `[hidden]` attribute — `display:none` is not animatable and would kill the slide (#16).
        panelWrap.classList.add('pente-menu-drawer--open');
        element.setAttribute('data-open', 'true');
        button.setAttribute('aria-expanded', 'true');
        // Push the NON-blocking scope: unbound keys fall THROUGH to the board (#24), so orbit/pan/
        // zoom + placement keep working while the drawer is open.
        deps.pushScope(menuScope());
        // Listen on the document (capture phase for outside-click, so it fires before any canvas
        // handler) only while open — removed on close so we never leak listeners.
        doc.addEventListener('keydown', onKeyDown);
        doc.addEventListener('pointerdown', onOutsidePointer, true);
      }

      function close(): void {
        if (!state.open) return; // idempotent — closing when already closed must not pop a scope
        state = closeMenu(state);
        // Slide out by removing the `--open` class (CSS animates back to translateX(-100%) and,
        // at the end of the tween, visibility:hidden — so the panel is non-interactive + out of the
        // a11y tree once closed, without the display:none that would prevent the animation, #16).
        panelWrap.classList.remove('pente-menu-drawer--open');
        element.setAttribute('data-open', 'false');
        button.setAttribute('aria-expanded', 'false');
        doc.removeEventListener('keydown', onKeyDown);
        doc.removeEventListener('pointerdown', onOutsidePointer, true);
        // Pop the scope exactly once (every close path routes through here).
        deps.popScope();
      }

      button.addEventListener('click', () => {
        // Toggle: the button opens a closed drawer and closes an open one.
        if (state.open) close();
        else open_();
      });
      closeButton.addEventListener('click', () => close());

      element.setAttribute('data-open', 'false');
      button.setAttribute('aria-expanded', 'false');

      return {
        element,
        // The menu is stateless w.r.t. game state — its entries are fixed config. `update` is a
        // no-op so the widget satisfies the contract without re-rendering on every board change.
        update(): void {},
        // On unmount, drop any open listeners AND pop a still-open scope so a disposed-while-open
        // drawer never leaks a scope onto the stack.
        dispose(): void {
          if (state.open) close();
        },
      };
    },
  };
}
