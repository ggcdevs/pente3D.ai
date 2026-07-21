/**
 * Layered config store (build plan Task 2.3; game-core design Part 1 "Everything is
 * config, no magic values").
 *
 * A section is resolved by **deep-merging** a localStorage override over its tracked
 * JSON default. The defaults in `./defaults/*.json` are the single source of truth
 * for every configurable subsystem — colors, keybindings, control presets, layout,
 * line visibility, and the render layer (`rendering`, `materials`, `lighting`,
 * `geometry`, `blending`; render-ui design Part 4) — and `relay.json` is the SSOT
 * for the relay endpoint/creds
 * consumed by both the client transport (Task 3.1) and the real-relay networking
 * tests (Task 3.3). No magic values live in code.
 *
 * Robustness contract (agent-principles: errors propagate honestly, but a *user's*
 * stored override must never break the app): a missing, corrupt, or ill-typed
 * override is ignored and the pristine default is returned — `getConfig` never
 * throws on a bad stored record. What is stored is the *override only* (a partial),
 * not the merged whole, so upgrading a default automatically reaches users who only
 * changed a sibling field.
 *
 * This module is *not* `src/core`: it may read `localStorage` (a DOM API). The
 * `Storage` is injected (defaulting to `globalThis.localStorage` when present) so it
 * is fully testable in a node environment and can be pointed at any backing store.
 * It must not import three/render/ui.
 */

import { createEmitter } from '../util/emitter';
import keybindingsDefault from './defaults/keybindings.json';
import controlsDefault from './defaults/controls.json';
import colorsDefault from './defaults/colors.json';
import layoutDefault from './defaults/layout.json';
import lineVisibilityDefault from './defaults/lineVisibility.json';
import relayDefault from './defaults/relay.json';
import renderingDefault from './defaults/rendering.json';
import materialsDefault from './defaults/materials.json';
import lightingDefault from './defaults/lighting.json';
import geometryDefault from './defaults/geometry.json';
import blendingDefault from './defaults/blending.json';
import interactionDefault from './defaults/interaction.json';
import boardDefault from './defaults/board.json';

/**
 * The relay SSOT shape: the single record consumed by both `MqttTransport` and the
 * networking integration tests. Declared here (not in `src/net`) so the config layer
 * owns the contract and `src/core`-adjacent code never re-declares endpoints/creds.
 */
export interface RelayConfig {
  readonly wssUrl: string;
  readonly username: string;
  readonly password: string;
  readonly topicRoot: string;
}

/**
 * The tracked default for every section. This object *is* the registry: its keys are
 * the valid sections and its values the parsed JSON defaults. Keeping one map means a
 * new section is added in exactly one place.
 */
const DEFAULTS = {
  keybindings: keybindingsDefault,
  controls: controlsDefault,
  colors: colorsDefault,
  layout: layoutDefault,
  lineVisibility: lineVisibilityDefault,
  relay: relayDefault,
  rendering: renderingDefault,
  materials: materialsDefault,
  lighting: lightingDefault,
  geometry: geometryDefault,
  blending: blendingDefault,
  interaction: interactionDefault,
  board: boardDefault,
} as const;

/** A configurable section name (`'keybindings' | 'controls' | …`). */
export type ConfigSection = keyof typeof DEFAULTS;

/** The resolved value type of a section, derived from its default. */
export type ConfigOf<S extends ConfigSection> = (typeof DEFAULTS)[S];

/** The list of registered sections, for iteration and validation. */
export const CONFIG_SECTIONS = Object.keys(DEFAULTS) as ConfigSection[];

/**
 * The single config-owned change notifier (Menu & live-settings batch, Task A.2 — GitHub
 * issue #15). Backed by the pure `createEmitter` (A.1). It carries a `ConfigSection` name and
 * NOTHING ELSE — subscribers re-read the new value via `getConfig`, keeping this module the
 * single source of truth (no value is duplicated into the event). One shared emitter, not a
 * per-call-site bus.
 *
 * This is module-level notification state deliberately kept OUT of the pure resolvers
 * (`getConfig`/`deepMerge`/`getDefault`/`readOverride`) — those stay pure and side-effect-free.
 * Only the two WRITERS (`setConfig`/`resetConfig`) touch it, and only after a successful write.
 *
 * Universal to LOCAL and PROGRAMMATIC/NETWORKED writers: a section changed by the local UI and
 * one changed by an opponent's move arriving over the relay (e.g. #9 opponent-changed-board-size)
 * both notify through this one seam, for free.
 */
const configChangeEmitter = createEmitter<ConfigSection>();

/**
 * Subscribe to config-section changes. `listener` is invoked with the changed SECTION NAME
 * after a successful `setConfig`/`resetConfig` write; it re-reads the new value via `getConfig`
 * (the SSOT — the section name is all that is delivered). Returns an unsubscribe function that
 * removes exactly this listener; call it on dispose to avoid leaks (idempotent — a second call is
 * a harmless no-op).
 *
 * A listener that throws propagates its error out of the triggering `setConfig`/`resetConfig`
 * call (errors are never masked — agent-principles "errors propagate honestly"). The write has
 * already been persisted by then, so the store is not corrupted; the throw only signals a broken
 * subscriber to its caller.
 */
export function onConfigChange(listener: (section: ConfigSection) => void): () => void {
  return configChangeEmitter.subscribe(listener);
}

/** The localStorage prefix for stored overrides. Namespaced to avoid collisions. */
export const OVERRIDE_KEY_PREFIX = 'pente:config:';

/** The localStorage key under which a section's override partial is stored. */
export function overrideStorageKey(section: ConfigSection): string {
  return `${OVERRIDE_KEY_PREFIX}${section}`;
}

/** A JSON-shaped record (the merge operates on these). */
type JsonRecord = Record<string, unknown>;

/** True for a non-null, non-array plain object — the only shape we deep-merge. */
function isPlainObject(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Recursively deep-merge `override` onto a fresh copy of `base`. Nested plain objects
 * are merged key-by-key; every other value (scalars, arrays) from `override` replaces
 * the corresponding `base` value wholesale. Neither input is mutated — the result is
 * always a new tree, so the shared default can never be corrupted by a merge.
 */
function deepMerge(base: JsonRecord, override: JsonRecord): JsonRecord {
  const out: JsonRecord = { ...base };
  for (const [key, overrideValue] of Object.entries(override)) {
    const baseValue = out[key];
    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      out[key] = deepMerge(baseValue, overrideValue);
    } else {
      out[key] = overrideValue;
    }
  }
  return out;
}

/** Structured-clone a JSON value so callers can never mutate a shared default. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Return a fresh deep copy of a section's tracked default — never the shared instance,
 * so a caller mutating the result cannot corrupt the module-level default.
 */
export function getDefault<S extends ConfigSection>(section: S): ConfigOf<S> {
  return clone(DEFAULTS[section]);
}

/** Resolve the injected storage, defaulting to `globalThis.localStorage` when present. */
function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  const g = globalThis as { localStorage?: Storage };
  return g.localStorage ?? null;
}

/**
 * Read and validate a section's stored override. Returns the override partial when it
 * is present and a plain object; returns `undefined` for a missing key, unparseable
 * JSON, or a non-object (scalar / array / null) record. Never throws — a corrupt
 * stored value must degrade to "no override", not break config resolution.
 */
function readOverride(section: ConfigSection, storage: Storage | null): JsonRecord | undefined {
  if (storage === null) return undefined;
  const raw = storage.getItem(overrideStorageKey(section));
  if (raw === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return isPlainObject(parsed) ? parsed : undefined;
}

/**
 * Resolve a section: the tracked default deep-merged with the stored override (if any
 * valid one exists). A missing, corrupt, or ill-typed override yields the pristine
 * default. Always returns a fresh object; the shared default is never mutated.
 *
 * @param section The section to resolve.
 * @param storage Backing store; omit to use `globalThis.localStorage`, pass `null`
 *   to force defaults-only (no store).
 */
export function getConfig<S extends ConfigSection>(
  section: S,
  storage?: Storage | null,
): ConfigOf<S> {
  const base = getDefault(section) as JsonRecord;
  const override = readOverride(section, resolveStorage(storage));
  if (override === undefined) return base as ConfigOf<S>;
  return deepMerge(base, override) as ConfigOf<S>;
}

/**
 * Persist a partial override for a section, deep-merged onto any existing override so
 * successive edits accumulate rather than clobber. Only the override partial is stored
 * (not the merged whole), so users who tweak one field still inherit future changes to
 * every other default. No-op with a warning path is avoided: with no store available
 * the call simply does nothing (there is nowhere durable to write) and — because no write
 * happened — it does NOT notify `onConfigChange` subscribers (agent-principles: notify observed
 * facts only; a no-op wrote nothing to react to).
 */
export function setConfig<S extends ConfigSection>(
  section: S,
  partial: Partial<ConfigOf<S>>,
  storage?: Storage | null,
): void {
  const store = resolveStorage(storage);
  if (store === null) return;
  const existing = readOverride(section, store) ?? {};
  const merged = deepMerge(existing, partial as JsonRecord);
  store.setItem(overrideStorageKey(section), JSON.stringify(merged));
  // Notify AFTER the write lands, so a subscriber that re-reads via getConfig sees the new value.
  // Emit the section NAME only — never the value (subscribers re-read the SSOT).
  configChangeEmitter.emit(section);
}

/**
 * Restore a section to its tracked default by removing its stored override. Removing a
 * section with no override is a no-op (matching `Storage.removeItem`). With no store
 * available the call does nothing and does NOT notify subscribers (nothing was written).
 */
export function resetConfig(section: ConfigSection, storage?: Storage | null): void {
  const store = resolveStorage(storage);
  if (store === null) return;
  store.removeItem(overrideStorageKey(section));
  // The reset write path ran (removeItem executed) — notify subscribers to re-read the now-default
  // value. Emit the section NAME only, mirroring setConfig; a null store returned above without
  // emitting (no write happened).
  configChangeEmitter.emit(section);
}
