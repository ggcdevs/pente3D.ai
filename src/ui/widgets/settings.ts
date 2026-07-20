/**
 * Settings modal widget (Task 5.4) — the DOM/config-write + input-scope IO glue for the pure
 * {@link deriveSettings} view-model (`settingsModel.ts`). Render-ui design Part 6 "Widget roster:
 * settings modal (board size, colors/opacity live preview, keybindings, control preset,
 * reset-to-defaults)".
 *
 * A self-contained widget by the design-Part-6 contract: a stable string id (`settings`, the id the
 * tracked `layout` default places), `mount() → DOM element`, `update(...)`, knowing NOTHING about
 * its placement (the zone-based `layout` config drives that). Unlike the banner/menu it has NO
 * visible trigger of its own — it is opened by the `openSettings` COMMAND (design Principle 3: the
 * menu's "Settings" entry and any keybinding dispatch that identical id). At mount the widget hands
 * its `open()` to `deps.registerOpener`, which the shell forwards to the scene's `setOpenSettings`.
 *
 * It READS/WRITES the layered config store directly (`src/ui` may import `src/config`): each field
 * is seeded from `getConfig`, and an edit persists via `setConfig` (validated first by the pure
 * normalizers — a malformed value is refused, never stored). "Reset to defaults" clears every
 * owned section via `resetConfig` ({@link RESET_SECTIONS}). Board size / preset / keybindings and
 * most colours take effect on RELOAD (the documented config contract — the board and instanced
 * buffers are built once from config); the previewable colours (background, line opacity, the three
 * line colours) update LIVE via `deps.applyColors` (the scene's `applyColors` seam) so the user
 * sees the change immediately (agent-principles #1: the reload contract is stated, not disguised).
 *
 * The open modal is a MODE change in the input layer: opening PUSHES a `blocking` scope
 * (GLOSSARY "Blocking scope") and closing POPS it — every close path (Escape, outside-click, the ✕
 * button) pops exactly once, so the stack never leaks. It touches `document`, so it is the
 * Playwright-verified IO boundary (asserted on `window.__pente` getInput()/getColors() +
 * getConfig round-trips + real interactions), not unit/mutation-gated. `data-testid`s expose the
 * rendered model + open state for readback (agent-principles #3: observable behavior, never a log).
 */

import type { Widget, WidgetFactory } from '../registry.ts';
import { getConfig, setConfig, resetConfig, type ConfigSection } from '../../config/config.ts';
import {
  deriveSettings,
  boardSizePatch,
  presetPatch,
  colorPatch,
  opacityPatch,
  SETTINGS_SCOPE_ID,
  RESET_SECTIONS,
  type SettingsSources,
  type ColorsConfig,
  type ControlsConfig,
  type BoardConfig,
  type KeybindingsConfig,
} from './settingsModel.ts';

/** The stable widget id — matches the `settings` entry in the tracked `layout` default. */
export const SETTINGS_WIDGET_ID = 'settings';

/** A minimal blocking scope shape the widget pushes (mirrors `input/scopes.ts` `Scope` without
 * importing it, exactly as the menu widget does). No bindings: it swallows every stray key. */
export interface SettingsScope {
  readonly id: string;
  readonly bindings: Readonly<Record<string, string>>;
  readonly blocking: true;
}

/** The live-previewable colour subset the widget hands to the scene's `applyColors` seam. */
export interface SettingsColorsPreview {
  background?: string;
  lineOpacity?: number;
  lineOrthogonal?: string;
  lineFaceDiagonal?: string;
  lineSpaceDiagonal?: string;
}

/**
 * The deps a settings widget needs: a document to build in (injected for testability), the scope-
 * stack `pushScope`/`popScope` (the open modal pushes/pops the blocking `settings` scope),
 * `registerOpener` (the widget hands its `open()` back so the `openSettings` command can call it),
 * and `applyColors` (the scene's live-preview seam). Config reads/writes go straight to the store.
 */
export interface SettingsDeps {
  readonly doc: Document;
  /** Push the blocking `settings` scope when the modal opens. */
  pushScope(scope: SettingsScope): void;
  /** Pop the topmost input scope (the `settings` scope) when the modal closes. */
  popScope(): void;
  /** Register the widget's `open()` so the `openSettings` command opens this modal. */
  registerOpener(open: () => void): void;
  /** Live-apply a colour preview to the scene (background / line opacity / line colours). */
  applyColors(preview: SettingsColorsPreview): void;
}

/** Build the blocking `settings` scope the open modal pushes (id `settings`, no bindings). */
function settingsScope(): SettingsScope {
  return { id: SETTINGS_SCOPE_ID, bindings: {}, blocking: true };
}

/** Read the four owned config sections into the pure model's sources shape. */
function readSources(): SettingsSources {
  return {
    board: getConfig('board') as unknown as BoardConfig,
    colors: getConfig('colors') as unknown as ColorsConfig,
    controls: getConfig('controls') as unknown as ControlsConfig,
    keybindings: getConfig('keybindings') as unknown as KeybindingsConfig,
  };
}

/**
 * Build the settings-modal {@link WidgetFactory}. The mounted element is a hidden modal overlay
 * (no visible trigger — opened by the `openSettings` command). Its fields are rebuilt from live
 * config each time it opens, so a reset-to-defaults or an override made elsewhere is reflected.
 */
export function settingsWidget(): WidgetFactory {
  return {
    id: SETTINGS_WIDGET_ID,
    mount(rawDeps: unknown): Widget {
      const deps = rawDeps as SettingsDeps;
      const doc = deps.doc;

      // Root is the modal overlay itself (hidden until opened). Placement is irrelevant — it is a
      // fixed full-viewport overlay — but it still mounts into its layout zone as a widget.
      const element = doc.createElement('div');
      element.className = 'pente-settings-modal';
      element.setAttribute('data-testid', 'settings-modal');
      element.setAttribute('role', 'dialog');
      element.setAttribute('aria-label', 'Settings');
      element.hidden = true;

      const panel = doc.createElement('div');
      panel.className = 'pente-settings-panel';

      const title = doc.createElement('div');
      title.className = 'pente-settings-title';
      title.textContent = 'Settings';
      panel.appendChild(title);

      const closeButton = doc.createElement('button');
      closeButton.className = 'pente-settings-close';
      closeButton.setAttribute('data-testid', 'settings-close');
      closeButton.setAttribute('aria-label', 'Close settings');
      closeButton.textContent = '✕';
      panel.appendChild(closeButton);

      // The body is (re)populated from live config each open, so it always reflects the current
      // overrides (including a just-performed reset-to-defaults).
      const body = doc.createElement('div');
      body.className = 'pente-settings-body';
      panel.appendChild(body);

      element.appendChild(panel);

      let open = false;

      /** Rebuild the form body from the pure model derived off live config. */
      function renderBody(): void {
        const model = deriveSettings(readSources());
        body.replaceChildren();

        // --- Board size (a <select>; takes effect on reload). ------------------------------------
        const boardSelect = labelledSelect(doc, body, 'Board size', 'settings-board-size');
        for (const opt of model.boardSizeOptions) {
          const o = doc.createElement('option');
          o.value = String(opt.value);
          o.textContent = `${opt.value} × ${opt.value} × ${opt.value}`;
          o.selected = opt.selected;
          boardSelect.appendChild(o);
        }
        boardSelect.addEventListener('change', () => {
          const patch = boardSizePatch(boardSelect.value);
          if (patch !== null) setConfig('board', patch);
        });

        // --- Control preset (a <select>; takes effect on reload). --------------------------------
        const presetSelect = labelledSelect(doc, body, 'Control preset', 'settings-preset');
        const presetIds = model.presetOptions.map((o) => o.value);
        for (const opt of model.presetOptions) {
          const o = doc.createElement('option');
          o.value = opt.value;
          o.textContent = opt.value;
          o.selected = opt.selected;
          presetSelect.appendChild(o);
        }
        presetSelect.addEventListener('change', () => {
          const patch = presetPatch(presetSelect.value, presetIds);
          if (patch !== null) setConfig('controls', patch);
        });

        // --- Colours (each an <input type=color>; background + line colours preview LIVE). -------
        for (const field of model.colorFields) {
          const input = labelledColor(doc, body, field.label, `settings-color-${field.key}`);
          input.value = field.value;
          input.addEventListener('input', () => {
            const patch = colorPatch(field.key, input.value);
            if (patch === null) return;
            setConfig('colors', patch);
            // Live-preview the subset the scene can apply without a reload.
            deps.applyColors({ [field.key]: patch[field.key] } as SettingsColorsPreview);
          });
        }

        // --- Line opacity (a 0..1 range slider; previews LIVE). ----------------------------------
        const opacity = labelledRange(doc, body, model.opacityField.label, 'settings-opacity');
        opacity.value = String(model.opacityField.value);
        opacity.addEventListener('input', () => {
          const patch = opacityPatch(opacity.value);
          if (patch === null) return;
          setConfig('colors', patch);
          deps.applyColors({ lineOpacity: patch.lineOpacity });
        });

        // --- Keybindings (read-only rows here; rebinding UI is the help-overlay's remit, 5.7). ---
        const kbSection = doc.createElement('div');
        kbSection.className = 'pente-settings-keybindings';
        kbSection.setAttribute('data-testid', 'settings-keybindings');
        const kbTitle = doc.createElement('div');
        kbTitle.className = 'pente-settings-subtitle';
        kbTitle.textContent = 'Keybindings';
        kbSection.appendChild(kbTitle);
        for (const row of model.keybindingRows) {
          const rowEl = doc.createElement('div');
          rowEl.className = 'pente-settings-keybinding-row';
          rowEl.setAttribute('data-testid', `settings-keybinding-${row.commandId}`);
          rowEl.setAttribute('data-key', row.key);
          rowEl.setAttribute('data-command', row.commandId);
          rowEl.textContent = `${row.commandId}: ${row.key}`;
          kbSection.appendChild(rowEl);
        }
        body.appendChild(kbSection);

        // --- Reset to defaults (clears every owned section, then re-derives the form). -----------
        const reset = doc.createElement('button');
        reset.className = 'pente-settings-reset';
        reset.setAttribute('data-testid', 'settings-reset');
        reset.textContent = 'Reset to defaults';
        reset.addEventListener('click', () => {
          // Clear every section the modal owns — the single list lives in the pure model
          // (RESET_SECTIONS), so the widget and its tests never drift on which sections reset.
          for (const section of RESET_SECTIONS) {
            resetConfig(section as ConfigSection);
          }
          // Re-apply the (now-default) previewable colours live, then rebuild the form fields.
          const c = getConfig('colors') as unknown as {
            background: string;
            lineOpacity: number;
            lineOrthogonal: string;
            lineFaceDiagonal: string;
            lineSpaceDiagonal: string;
          };
          deps.applyColors({
            background: c.background,
            lineOpacity: c.lineOpacity,
            lineOrthogonal: c.lineOrthogonal,
            lineFaceDiagonal: c.lineFaceDiagonal,
            lineSpaceDiagonal: c.lineSpaceDiagonal,
          });
          renderBody();
        });
        body.appendChild(reset);
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
        renderBody(); // rebuild from live config every open
        element.hidden = false;
        element.setAttribute('data-open', 'true');
        deps.pushScope(settingsScope());
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

      // Hand our opener to the shell so the `openSettings` command opens this modal.
      deps.registerOpener(openModal);

      return {
        element,
        // Settings reads config on open, not on every board change — `update` is a no-op.
        update(): void {},
        dispose(): void {
          if (open) close();
        },
      };
    },
  };
}

/** Append a labelled `<select>` to `parent`; returns the select for option population + wiring. */
function labelledSelect(
  doc: Document,
  parent: HTMLElement,
  label: string,
  testid: string,
): HTMLSelectElement {
  const row = doc.createElement('label');
  row.className = 'pente-settings-field';
  row.textContent = label;
  const select = doc.createElement('select');
  select.setAttribute('data-testid', testid);
  row.appendChild(select);
  parent.appendChild(row);
  return select;
}

/** Append a labelled `<input type=color>` to `parent`; returns the input. */
function labelledColor(
  doc: Document,
  parent: HTMLElement,
  label: string,
  testid: string,
): HTMLInputElement {
  const row = doc.createElement('label');
  row.className = 'pente-settings-field';
  row.textContent = label;
  const input = doc.createElement('input');
  input.type = 'color';
  input.setAttribute('data-testid', testid);
  row.appendChild(input);
  parent.appendChild(row);
  return input;
}

/** Append a labelled 0..1 `<input type=range>` to `parent`; returns the input. */
function labelledRange(
  doc: Document,
  parent: HTMLElement,
  label: string,
  testid: string,
): HTMLInputElement {
  const row = doc.createElement('label');
  row.className = 'pente-settings-field';
  row.textContent = label;
  const input = doc.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '1';
  input.step = '0.01';
  input.setAttribute('data-testid', testid);
  row.appendChild(input);
  parent.appendChild(row);
  return input;
}
