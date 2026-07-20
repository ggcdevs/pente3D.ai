/**
 * PURE settings view-model (Task 5.4) — render-ui design Part 6 "Widget roster: settings modal
 * (board size, colors/opacity live preview, keybindings, control preset, reset-to-defaults)".
 *
 * The settings modal is a form over the layered `config` store: it READS several config sections
 * and, on edit, WRITES them back (`setConfig`) or clears them (`resetConfig`). Turning the raw
 * config sections into the ordered, typed field model the DOM renders — and validating/normalizing
 * a user's edit into a config patch — is a DOM-free, deterministic derivation, so it earns the
 * strict unit + mutation gate exactly as {@link ./menuModel.ts} / {@link ./bannerModel.ts} do. The
 * `settings.ts` widget is the DOM/dispatch + `setConfig`/`resetConfig` + scope-push IO glue
 * (Playwright).
 *
 * What is PURE here (this file) vs IO glue (`settings.ts`):
 *   - PURE: the derivation `config sections → SettingsModel` (ordered board-size options, control-
 *     preset options, ordered color/opacity fields, ordered keybinding rows), the set of sections
 *     Reset-to-defaults clears, and the input→patch normalizers (`boardSizePatch`,
 *     `presetPatch`, `colorPatch`, `opacityPatch`) — each rejecting a malformed value.
 *   - IO glue: reading `getConfig`, writing `setConfig`/`resetConfig`, painting the fields onto
 *     the DOM, live-previewing colors on the scene, and pushing/popping the blocking modal scope.
 *
 * Every derivation is deterministic and every normalizer has a negative case (a bad board size, an
 * unknown preset, a non-`#rrggbb` color, an out-of-range opacity are all REJECTED → `null`), so a
 * malformed edit is never silently persisted (agent-principles: genuine tests, negative cases).
 */

/** The stable input scope id the open settings modal pushes — a BLOCKING scope (GLOSSARY
 * "Blocking scope": a modal swallows stray keys so they never fall through to the game/camera
 * scopes below). Distinct from the `menu` scope so the two never collide on the stack. */
export const SETTINGS_SCOPE_ID = 'settings';

/** The command id the menu's "Settings" entry dispatches to open this modal (design Principle 3:
 * the same id a `showSettings` keybinding would fire). Kept beside the model so the widget and any
 * future keybinding agree on one string. */
export const OPEN_SETTINGS_COMMAND = 'openSettings';

/**
 * The board sizes the modal offers. Pente is played on a cubic lattice `N×N×N`; these are the
 * supported edge lengths (GLOSSARY: `N` configurable, up to 11³). The list is the SSOT for the
 * board-size dropdown options AND the validity check `boardSizePatch` enforces.
 */
export const BOARD_SIZE_OPTIONS: readonly number[] = [5, 7, 9, 11];

/**
 * The colour fields the modal edits, in display order, each with a human label. Keys match the
 * `colors` config section (`src/config/defaults/colors.json`). `lineOpacity` is the one NUMBER
 * field (a 0..1 opacity slider); every other key is a `#rrggbb` colour. Splitting them here (not
 * in the DOM glue) keeps the field roster + its order deterministic and mutation-gated.
 */
export const COLOR_FIELDS: readonly { readonly key: string; readonly label: string }[] = [
  { key: 'background', label: 'Background' },
  { key: 'emptySphere', label: 'Empty marker' },
  { key: 'whitePiece', label: 'White piece' },
  { key: 'blackPiece', label: 'Black piece' },
  { key: 'tempPiece', label: 'Preview piece' },
  { key: 'lineOrthogonal', label: 'Orthogonal lines' },
  { key: 'lineFaceDiagonal', label: 'Face-diagonal lines' },
  { key: 'lineSpaceDiagonal', label: 'Space-diagonal lines' },
  { key: 'hoverHighlight', label: 'Hover highlight' },
  { key: 'winningLine', label: 'Winning line' },
];

/** The `colors` config key holding the line opacity (a 0..1 number, not a colour). */
export const OPACITY_FIELD_KEY = 'lineOpacity';

/**
 * The config sections the modal's fields read/write, hence the sections Reset-to-defaults clears
 * (via `resetConfig`). Frozen so a caller cannot append a section the modal does not actually own.
 * The DOM glue iterates this to reset every owned section in one action.
 */
export const RESET_SECTIONS: readonly string[] = ['board', 'colors', 'controls', 'keybindings'];

/** A single dropdown option: the stored value plus whether it is the current selection. */
export interface SelectOption<T> {
  /** The option's value (a board size number, or a preset id string). */
  readonly value: T;
  /** True iff this option is the currently-selected one. */
  readonly selected: boolean;
}

/** A resolved colour/opacity field the DOM renders: its config key, label, and current value. */
export interface ColorFieldModel {
  /** The `colors` config key (e.g. `background`). */
  readonly key: string;
  /** The human label shown beside the input. */
  readonly label: string;
  /** The current value — a `#rrggbb` string for a colour field. */
  readonly value: string;
}

/** The opacity field model: the current 0..1 number the slider shows. */
export interface OpacityFieldModel {
  /** The `colors` config key (`lineOpacity`). */
  readonly key: string;
  /** The human label. */
  readonly label: string;
  /** The current opacity in 0..1. */
  readonly value: number;
}

/** A single keybinding row: the key chord and the command id it fires. */
export interface KeybindingRow {
  /** The key chord (e.g. `u`, `Escape`). */
  readonly key: string;
  /** The command id the chord dispatches. */
  readonly commandId: string;
}

/** The serializable settings view-model the DOM widget renders (and Playwright asserts on). */
export interface SettingsModel {
  /** Board-size dropdown: one option per supported size, the current one marked selected. */
  readonly boardSizeOptions: readonly SelectOption<number>[];
  /** Control-preset dropdown: one option per configured preset id, current marked selected. */
  readonly presetOptions: readonly SelectOption<string>[];
  /** Colour fields in display order (each `#rrggbb`). */
  readonly colorFields: readonly ColorFieldModel[];
  /** The single 0..1 line-opacity field. */
  readonly opacityField: OpacityFieldModel;
  /** Keybinding rows, ordered by command id then key (deterministic, not authoring order). */
  readonly keybindingRows: readonly KeybindingRow[];
}

/** The `colors` config subset the model reads (all values are strings except `lineOpacity`). */
export type ColorsConfig = Record<string, string | number>;

/** The `controls` config subset the model reads (the active preset id + the preset map). */
export interface ControlsConfig {
  readonly preset: string;
  readonly presets: Readonly<Record<string, unknown>>;
}

/** The `board` config subset the model reads. */
export interface BoardConfig {
  readonly size: number;
}

/** The `keybindings` config: a `chord → commandId` map. */
export type KeybindingsConfig = Readonly<Record<string, string>>;

/** The config sections the model derives from (mirrors the sections the modal owns). */
export interface SettingsSources {
  readonly board: BoardConfig;
  readonly colors: ColorsConfig;
  readonly controls: ControlsConfig;
  readonly keybindings: KeybindingsConfig;
}

/**
 * Derive the {@link SettingsModel} from the four owned config sections. Pure and deterministic:
 *   - board-size options are {@link BOARD_SIZE_OPTIONS}; the option equal to `board.size` is
 *     `selected` (none is selected if the stored size is not an offered option — the modal then
 *     shows no selection rather than inventing one);
 *   - preset options are the KEYS of `controls.presets` sorted for a stable order; the option
 *     equal to `controls.preset` is `selected`;
 *   - colour fields are {@link COLOR_FIELDS} projected with each field's current `colors` value
 *     (coerced to a string for display); the opacity field carries `colors.lineOpacity` as a
 *     number;
 *   - keybinding rows are the `keybindings` entries sorted by command id then key (so the rendered
 *     order never depends on object key order).
 */
export function deriveSettings(sources: SettingsSources): SettingsModel {
  const boardSizeOptions: SelectOption<number>[] = BOARD_SIZE_OPTIONS.map((value) => ({
    value,
    selected: value === sources.board.size,
  }));

  // Preset ids sorted lexicographically for a stable, authoring-order-independent dropdown.
  // `Object.keys` already returns a fresh array, so the in-place `.sort` never touches `sources`
  // (no defensive `.slice()` needed — it would be dead code / an equivalent mutant).
  const presetOptions: SelectOption<string>[] = Object.keys(sources.controls.presets)
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ value, selected: value === sources.controls.preset }));

  const colorFields: ColorFieldModel[] = COLOR_FIELDS.map((field) => ({
    key: field.key,
    label: field.label,
    value: String(sources.colors[field.key]),
  }));

  const opacityField: OpacityFieldModel = {
    key: OPACITY_FIELD_KEY,
    label: 'Line opacity',
    value: Number(sources.colors[OPACITY_FIELD_KEY]),
  };

  const keybindingRows: KeybindingRow[] = Object.entries(sources.keybindings)
    .map(([key, commandId]) => ({ key, commandId }))
    // Sort by command id, then key — deterministic + independent of object key order. Both parts
    // are exercised (two rows can share neither), so every ordering mutant is killed by a reorder
    // test (agent-principles #7).
    .sort((a, b) => a.commandId.localeCompare(b.commandId) || a.key.localeCompare(b.key));

  return { boardSizeOptions, presetOptions, colorFields, opacityField, keybindingRows };
}

/**
 * Normalize a raw board-size input (a string from a `<select>`) into a `board`-section patch, or
 * `null` if it is not one of the offered {@link BOARD_SIZE_OPTIONS}. Rejecting an unknown size
 * means a tampered/stale option value can never persist an unsupported board (the scene would fail
 * to build it) — the write is simply refused.
 */
export function boardSizePatch(raw: string): { size: number } | null {
  const size = Number(raw);
  // Membership in the integer-only option list is the complete check: any non-integer (e.g.
  // `Number('9.5') === 9.5`) or non-numeric (`Number('abc') === NaN`) value is simply absent from
  // BOARD_SIZE_OPTIONS and rejected here. A separate `Number.isInteger` guard would be redundant
  // (an equivalent mutant), so the one `includes` check is the single, complete gate.
  if (!BOARD_SIZE_OPTIONS.includes(size)) return null;
  return { size };
}

/**
 * Normalize a raw control-preset id against the available preset ids into a `controls`-section
 * patch, or `null` if the id is not a configured preset. The available ids are passed in (derived
 * from `controls.presets`), so this stays data-driven — a future preset needs no change here.
 */
export function presetPatch(raw: string, available: readonly string[]): { preset: string } | null {
  if (!available.includes(raw)) return null;
  return { preset: raw };
}

/** Matches a `#rrggbb` colour (exactly six hex digits, case-insensitive). */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Normalize a raw colour input into a `colors`-section patch `{ [key]: '#rrggbb' }`, or `null` if
 * the value is not a well-formed 6-digit hex colour. The colour is lower-cased for a canonical
 * stored form (so `#FFFFFF` and `#ffffff` never round-trip as two different overrides).
 */
export function colorPatch(key: string, raw: string): Record<string, string> | null {
  if (!HEX_COLOR.test(raw)) return null;
  return { [key]: raw.toLowerCase() };
}

/**
 * Normalize a raw line-opacity input into a `colors`-section patch `{ lineOpacity: n }`, or `null`
 * if the value is not a finite number in the inclusive range 0..1. Rejecting out-of-range keeps a
 * fully-transparent-or-broken opacity from ever being persisted.
 */
export function opacityPatch(raw: string): { lineOpacity: number } | null {
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  if (value < 0 || value > 1) return null;
  return { lineOpacity: value };
}
