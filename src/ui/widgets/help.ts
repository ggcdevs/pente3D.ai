/**
 * Help overlay widget (Task 5.7) — the DOM + input-scope IO glue for the pure {@link deriveHelp}
 * view-model (`helpModel.ts`). Render-ui design Part 6 "Widget roster: help overlay (`?`, generated
 * from the command registry)".
 *
 * A self-contained widget by the design-Part-6 contract: a stable string id (`helpOverlay`, the id
 * the tracked `layout` default places), `mount() → DOM element`, `update(...)`, knowing NOTHING
 * about its placement (the zone-based `layout` config drives that). Like the settings modal it has
 * NO visible trigger of its own — it is opened by the `showHelp` COMMAND (design Principle 3: the
 * `?` keybinding and any future UI trigger dispatch that identical id). At mount the widget hands
 * its `open()` to `deps.registerOpenHelp`, which the shell forwards to the scene's `setOpenHelp`.
 *
 * The shortcut list is GENERATED, never hardcoded: on every open the widget reads the LIVE command
 * registry + current bindings via `deps.getHelpSources()` (the scene's registry ids + the tracked
 * `keybindings` config) and paints `deriveHelp(...)`'s rows. So the overlay always shows exactly
 * the shortcuts the keys actually fire — it cannot drift from the input system (agent-principles
 * #8: no duplicated volatile facts). Rebuilding from live sources each open also reflects a
 * rebinding made elsewhere (settings) without this widget knowing about it.
 *
 * The open modal is a MODE change in the input layer: opening PUSHES a `blocking` scope
 * (GLOSSARY "Blocking scope") and closing POPS it — every close path (Escape, outside-click, the ✕
 * button) pops exactly once, so the stack never leaks. It touches `document`, so it is the
 * Playwright-verified IO boundary (asserted on `window.__pente` getInput() + the rendered rows +
 * real interactions), not unit/mutation-gated. `data-testid`s expose the rendered model + open
 * state for readback (agent-principles #3: observable behavior, never a log line).
 */

import type { Widget, WidgetFactory } from '../registry.ts';
import { deriveHelp, HELP_SCOPE_ID, type HelpSources } from './helpModel.ts';

/** The stable widget id — matches the `helpOverlay` entry in the tracked `layout` default. */
export const HELP_WIDGET_ID = 'helpOverlay';

/** A minimal blocking scope shape the widget pushes (mirrors `input/scopes.ts` `Scope` without
 * importing it, exactly as the menu/settings widgets do). No bindings: it swallows every stray key. */
export interface HelpScope {
  readonly id: string;
  readonly bindings: Readonly<Record<string, string>>;
  readonly blocking: true;
}

/**
 * The deps a help widget needs: a document to build in (injected for testability), the scope-stack
 * `pushScope`/`popScope` (the open modal pushes/pops the blocking `help` scope), `registerOpenHelp`
 * (the widget hands its `open()` back so the `showHelp` command can call it), and `getHelpSources`
 * (the scene's LIVE registered command ids + current bindings — the shortcut list is derived from
 * these, never hardcoded).
 */
export interface HelpDeps {
  readonly doc: Document;
  /** Push the blocking `help` scope when the modal opens. */
  pushScope(scope: HelpScope): void;
  /** Pop the topmost input scope (the `help` scope) when the modal closes. */
  popScope(): void;
  /** Register the widget's `open()` so the `showHelp` command opens this modal. */
  registerOpenHelp(open: () => void): void;
  /** The LIVE command registry ids + current bindings the shortcut list is generated from. */
  getHelpSources(): HelpSources;
}

/** Build the blocking `help` scope the open modal pushes (id `help`, no bindings). */
function helpScope(): HelpScope {
  return { id: HELP_SCOPE_ID, bindings: {}, blocking: true };
}

/**
 * Build the help-overlay {@link WidgetFactory}. The mounted element is a hidden modal overlay (no
 * visible trigger — opened by the `showHelp` command). Its rows are rebuilt from the LIVE registry +
 * bindings each time it opens, so a rebinding made elsewhere is reflected.
 */
export function helpWidget(): WidgetFactory {
  return {
    id: HELP_WIDGET_ID,
    mount(rawDeps: unknown): Widget {
      const deps = rawDeps as HelpDeps;
      const doc = deps.doc;

      // Root is the modal overlay itself (hidden until opened). Placement is irrelevant — it is a
      // fixed full-viewport overlay — but it still mounts into its layout zone as a widget.
      const element = doc.createElement('div');
      element.className = 'pente-help-modal';
      element.setAttribute('data-testid', 'help-modal');
      element.setAttribute('role', 'dialog');
      element.setAttribute('aria-label', 'Keyboard shortcuts');
      element.hidden = true;

      const panel = doc.createElement('div');
      panel.className = 'pente-help-panel';

      const title = doc.createElement('div');
      title.className = 'pente-help-title';
      title.textContent = 'Keyboard shortcuts';
      panel.appendChild(title);

      const closeButton = doc.createElement('button');
      closeButton.className = 'pente-help-close';
      closeButton.setAttribute('data-testid', 'help-close');
      closeButton.setAttribute('aria-label', 'Close help');
      closeButton.textContent = '✕';
      panel.appendChild(closeButton);

      // The rows body is (re)populated from the live registry + bindings each open, so it always
      // reflects the current shortcuts (including a rebinding made in the settings modal).
      const body = doc.createElement('div');
      body.className = 'pente-help-body';
      body.setAttribute('data-testid', 'help-rows');
      panel.appendChild(body);

      element.appendChild(panel);

      let open = false;

      /** Rebuild the shortcut rows from the pure model derived off the LIVE registry + bindings. */
      function renderRows(): void {
        const model = deriveHelp(deps.getHelpSources());
        body.replaceChildren();
        for (const row of model.rows) {
          const rowEl = doc.createElement('div');
          rowEl.className = 'pente-help-row';
          rowEl.setAttribute('data-testid', `help-row-${row.commandId}`);
          rowEl.setAttribute('data-command', row.commandId);
          rowEl.setAttribute('data-keys', row.keys.join(', '));

          const labelEl = doc.createElement('span');
          labelEl.className = 'pente-help-label';
          labelEl.textContent = row.label;
          rowEl.appendChild(labelEl);

          const keysEl = doc.createElement('span');
          keysEl.className = 'pente-help-keys';
          // One <kbd> per bound chord — the visible, generated shortcut(s) for this command.
          for (const key of row.keys) {
            const kbd = doc.createElement('kbd');
            kbd.className = 'pente-help-key';
            kbd.textContent = key;
            keysEl.appendChild(kbd);
          }
          rowEl.appendChild(keysEl);

          body.appendChild(rowEl);
        }
      }

      function onKeyDown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      }

      /** Close on a click OUTSIDE the panel (the backdrop overlay). */
      function onOutsidePointer(event: Event): void {
        const target = event.target as Node | null;
        if (target !== null && panel.contains(target)) return;
        close();
      }

      function openModal(): void {
        if (open) return; // idempotent — a second open must not push a second scope
        open = true;
        renderRows(); // rebuild from the live registry + bindings every open
        element.hidden = false;
        element.setAttribute('data-open', 'true');
        deps.pushScope(helpScope());
        doc.addEventListener('keydown', onKeyDown);
        doc.addEventListener('pointerdown', onOutsidePointer, true);
      }

      function close(): void {
        if (!open) return; // idempotent — closing when closed must not pop a scope
        open = false;
        element.hidden = true;
        element.setAttribute('data-open', 'false');
        doc.removeEventListener('keydown', onKeyDown);
        doc.removeEventListener('pointerdown', onOutsidePointer, true);
        deps.popScope();
      }

      closeButton.addEventListener('click', () => close());
      element.setAttribute('data-open', 'false');

      // Hand our opener to the shell so the `showHelp` command opens this modal.
      deps.registerOpenHelp(openModal);

      return {
        element,
        // Help reads the registry + bindings on open, not on every board change — `update` is a no-op.
        update(): void {},
        dispose(): void {
          if (open) close();
        },
      };
    },
  };
}
