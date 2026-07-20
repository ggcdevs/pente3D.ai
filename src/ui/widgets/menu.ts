/**
 * Menu button + modal widget (Task 5.3) — the DOM/dispatch + input-scope IO glue for the pure
 * {@link deriveMenu} view-model (`menuModel.ts`). Render-ui design Part 6 "Widget roster: menu
 * button + menu modal (Settings, Host, Join, Load, Export)".
 *
 * A self-contained widget by the design-Part-6 contract: a stable string id (`menuButton`, the id
 * the tracked `layout` default places in `top-right`), `mount() → DOM element`, and
 * `update(state, config)` — knowing NOTHING about its placement (the zone-based `layout` config
 * drives that). It **dispatches command ids** (design Principle 3 "one action layer": choosing a
 * menu entry fires the exact same command a keybinding would, via the deps-supplied `dispatch` —
 * the scene's command registry).
 *
 * The open modal is a MODE change in the input layer: opening PUSHES a `blocking` input scope
 * (GLOSSARY "Blocking scope": a modal swallows stray keys so they never fall through to the
 * game/camera scopes below), and closing POPS it — so this widget is handed `pushScope`/`popScope`
 * (the scene's scope stack) alongside `dispatch`. The modal closes on **Escape** or an
 * **outside-click**, and every close path (Escape, outside-click, choosing an entry, the ✕
 * button) pops the scope exactly once, so the stack can never leak a scope.
 *
 * All entry DECISIONS (which entries, their order, their command ids) live in the pure model; this
 * file only paints the model onto DOM, forwards clicks to `dispatch`, and manages open/close +
 * the blocking scope. It touches `document`, so it is the Playwright-verified IO boundary (asserted
 * on `window.__pente` getInput() scope stack + real interactions), not unit/mutation-gated.
 * `data-*` attributes + `data-testid`s are exposed so a test reads the rendered model + open state
 * back off the live DOM (agent-principles #3: observable behavior, never a log line).
 */

import type { Widget, WidgetFactory } from '../registry.ts';
import { deriveMenu, MENU_SCOPE_ID, type MenuEntrySpec } from './menuModel.ts';

/** The stable widget id — matches the `menuButton` entry in the tracked `layout` default. */
export const MENU_WIDGET_ID = 'menuButton';

/** A minimal scope shape the widget pushes — mirrors `input/scopes.ts` `Scope` without importing
 * it (keeps this UI glue decoupled from the input module's internals; the scene supplies the
 * push/pop that consume it). A blocking scope with no bindings: it swallows every key. */
export interface MenuScope {
  /** The scope's id (`menu`), so a test can see it on the `getInput()` stack. */
  readonly id: string;
  /** No key bindings — the modal handles Escape itself; every other key is swallowed. */
  readonly bindings: Readonly<Record<string, string>>;
  /** Blocking: stray keys are swallowed here, never falling through to game/camera scopes. */
  readonly blocking: true;
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
  /** Push an input scope (the blocking `menu` scope) when the modal opens. */
  pushScope(scope: MenuScope): void;
  /** Pop the topmost input scope (the `menu` scope) when the modal closes. */
  popScope(): void;
  /** The menu entry roster (defaults to the design-Part-6 set). Injectable for tests. */
  readonly entries?: readonly MenuEntrySpec[];
}

/** Build the blocking `menu` scope the open modal pushes (id `menu`, no bindings, blocking). */
function menuScope(): MenuScope {
  return { id: MENU_SCOPE_ID, bindings: {}, blocking: true };
}

/**
 * Build the menu-button {@link WidgetFactory}. The mounted element is the button; the modal is a
 * sibling overlay toggled open/closed. Opening pushes the blocking scope and shows the modal;
 * Escape / outside-click / an entry choice / the ✕ button all close it (pop the scope once).
 */
export function menuWidget(): WidgetFactory {
  return {
    id: MENU_WIDGET_ID,
    mount(rawDeps: unknown): Widget {
      const deps = rawDeps as MenuDeps;
      const doc = deps.doc;
      const model = deriveMenu(deps.entries);

      // Root carries BOTH the trigger button and the modal, so outside-click detection is a
      // single "is the click within our root?" check (the button + modal are our surface).
      const element = doc.createElement('div');
      element.className = 'pente-widget pente-widget--menu';

      const button = doc.createElement('button');
      button.className = 'pente-menu-button';
      button.setAttribute('data-testid', 'menu-button');
      button.setAttribute('aria-haspopup', 'menu');
      button.textContent = 'Menu';
      element.appendChild(button);

      // The modal overlay: a labelled panel listing one button per menu item. Hidden until open.
      const modal = doc.createElement('div');
      modal.className = 'pente-menu-modal';
      modal.setAttribute('data-testid', 'menu-modal');
      modal.setAttribute('role', 'menu');
      modal.hidden = true;

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

      // One entry button per pure-model item; each dispatches its command id and closes the modal.
      for (const item of model.items) {
        const entry = doc.createElement('button');
        entry.className = `pente-menu-entry pente-menu-entry--${item.id}`;
        entry.setAttribute('data-testid', `menu-entry-${item.id}`);
        entry.setAttribute('data-command', item.commandId);
        entry.textContent = item.label;
        entry.addEventListener('click', () => {
          // Close FIRST — pop this menu's blocking scope — THEN dispatch the SAME command id a
          // keybinding fires (design Principle 3). Ordering matters: a command that opens another
          // modal (Settings, 5.4) pushes its own scope, and popping ours first keeps the stack
          // clean (the new modal's scope sits directly on the game scope, not atop a stale menu).
          close();
          deps.dispatch(item.commandId);
        });
        panel.appendChild(entry);
      }

      modal.appendChild(panel);
      element.appendChild(modal);

      let open = false;

      /** Close on Escape (only while open). Attached to the document while the modal is open. */
      function onKeyDown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      }

      /**
       * Close on a click that lands OUTSIDE the interactive surface (the trigger button + the
       * modal panel). A click on the button or inside the panel is "inside" and keeps the modal
       * open; a click on the backdrop overlay (which fills the viewport but is NOT the panel) or
       * anywhere else on the page is "outside" and closes it (design Part 6: "outside-click
       * closes"). Checking button/panel containment — not the whole root — is what makes the
       * backdrop count as outside even though it is a descendant of the root element.
       */
      function onOutsidePointer(event: Event): void {
        const target = event.target as Node | null;
        if (target !== null && (button.contains(target) || panel.contains(target))) return;
        close();
      }

      function open_(): void {
        if (open) return; // idempotent — a second open must not push a second scope
        open = true;
        modal.hidden = false;
        element.setAttribute('data-open', 'true');
        button.setAttribute('aria-expanded', 'true');
        // Push the blocking scope: stray keys are now swallowed (GLOSSARY "Blocking scope").
        deps.pushScope(menuScope());
        // Listen on the document (capture phase for the outside-click, so it fires before any
        // canvas handler) only while open — removed on close so we never leak listeners.
        doc.addEventListener('keydown', onKeyDown);
        doc.addEventListener('pointerdown', onOutsidePointer, true);
      }

      function close(): void {
        if (!open) return; // idempotent — closing when already closed must not pop a scope
        open = false;
        modal.hidden = true;
        element.setAttribute('data-open', 'false');
        button.setAttribute('aria-expanded', 'false');
        doc.removeEventListener('keydown', onKeyDown);
        doc.removeEventListener('pointerdown', onOutsidePointer, true);
        // Pop the blocking scope exactly once (every close path routes through here).
        deps.popScope();
      }

      button.addEventListener('click', () => {
        // Toggle: the button opens a closed menu and closes an open one.
        if (open) close();
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
        // menu never leaks a scope onto the stack.
        dispose(): void {
          if (open) close();
        },
      };
    },
  };
}
