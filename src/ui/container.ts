/**
 * UI container (Task 5.1) — the DOM IO boundary that mounts the composable UI shell.
 *
 * This is the glue between the two PURE modules: it asks `resolveLayout` (`layout.ts`) for the
 * ordered, per-zone plan given the `layout` config + the registry's `knownIds`, then builds one
 * absolutely-positioned zone `<div>` per populated zone and mounts each widget's DOM element
 * into its zone in flow order (design Part 6, "zone-based positioning; widgets flow within a
 * zone by order"). It imports the DOM; the placement/ordering decisions all live in the pure
 * resolver, so this file carries none of the logic under the mutation gate — it is verified by
 * Playwright driving the real app and asserting on `getLayout()` (build plan Task 5.1).
 *
 * `getLayout()` is a plain, serializable readout of what is ACTUALLY in the DOM (zone → ordered
 * widget ids, read back off the mounted elements), not a copy of the plan — so a Playwright test
 * proves the DOM reflects the config, and that reordering the config reorders the DOM
 * (agent-principles #3: observable behavior, never a log line).
 */

import { createLogger } from '../debug/log.ts';
import { resolveLayout, type LayoutConfig } from './layout.ts';
import type { Widget, WidgetRegistry } from './registry.ts';

const log = createLogger('ui:container');

/** The data attribute a mounted widget element carries, so `getLayout` can read ids off the DOM. */
export const WIDGET_ID_ATTR = 'data-widget-id';
/** The data attribute a zone element carries, naming its zone. */
export const ZONE_ATTR = 'data-zone';
/** The id of the one-time injected stylesheet, so it is installed at most once per document. */
export const UI_STYLE_ID = 'pente-ui-style';

/**
 * The overlay stylesheet: the root is a full-viewport overlay that is click-THROUGH
 * (`pointer-events: none`) so canvas orbit/pan/zoom still work under it; each anchor zone
 * (design Part 6) is absolutely positioned at its screen edge and its widgets re-enable
 * `pointer-events` so buttons are clickable. Zone anchoring is a fixed name→edge mapping (not
 * config-derived logic — the config drives WHICH widgets sit WHERE, resolved purely in
 * `layout.ts`), so it lives here as constant CSS rather than in the mutation-gated pure layer.
 */
const UI_STYLESHEET = `
/* --------------------------------------------------------------------------------------------
 * SHARED UI THEME + INPUT STYLING (issue #44). One source of truth for the overlay chrome's
 * accent / surface / text / danger colors and for the modern rounded look of EVERY button + input
 * (including the menu, settings, net panel, banner, and history controls). Defined as CSS custom
 * properties on the root (and inherited by the fixed modal panels, which are DOM descendants of
 * widgets mounted under the root even though they position: fixed), so a tweak here re-themes the
 * whole HUD rather than editing per-widget copies. These consolidate the accent (was the repeated
 * rgba(74,144,217,…)) / surface / text / danger values the stylesheet already owned — the 3D-scene
 * palette lives in config/colors.json; this is the UI-chrome palette the stylesheet is SSOT for.
 * ------------------------------------------------------------------------------------------------ */
.pente-ui-root {
  --pente-ui-text: #e6e6ea;
  --pente-ui-surface: rgba(16, 16, 20, 0.72);
  --pente-ui-panel: rgba(20, 20, 26, 0.94);
  --pente-ui-control-bg: rgba(255, 255, 255, 0.08);
  --pente-ui-control-bg-hover: rgba(255, 255, 255, 0.16);
  --pente-ui-control-border: rgba(255, 255, 255, 0.16);
  --pente-ui-field-bg: rgba(0, 0, 0, 0.3);
  --pente-ui-accent: rgba(74, 144, 217, 1);
  --pente-ui-accent-soft: rgba(74, 144, 217, 0.4);
  --pente-ui-accent-strong: rgba(74, 144, 217, 0.6);
  --pente-ui-danger-text: #ffb0b0;
  --pente-ui-danger-bg: rgba(255, 80, 80, 0.18);
  --pente-ui-danger-bg-hover: rgba(255, 80, 80, 0.28);
  --pente-ui-radius: 8px;
  --pente-ui-focus-ring: 0 0 0 2px rgba(74, 144, 217, 0.55);
  --pente-ui-font: system-ui, sans-serif;
}
/* Shared modern base for EVERY control in the overlay: rounded corners, consistent padding, a
 * subtle surface, hover/active feedback, and a visible focus ring (a11y). Applied generally via the
 * root scope so buttons/inputs need no per-widget style; individual rules below only add layout or
 * an intent color (accent / danger), inheriting this look. Keyboard-focus only (:focus-visible) so a
 * mouse click doesn't leave a ring. Excludes the range input, which has its own native styling. */
.pente-ui-root button,
.pente-ui-root input:not([type='range']) {
  font-family: var(--pente-ui-font);
  font-size: 13px;
  color: var(--pente-ui-text);
  border: 1px solid transparent;
  border-radius: var(--pente-ui-radius);
  padding: 6px 12px;
  background: var(--pente-ui-control-bg);
  transition: background 130ms ease, box-shadow 130ms ease, opacity 130ms ease;
}
.pente-ui-root button { cursor: pointer; }
.pente-ui-root button:hover:not(:disabled) { background: var(--pente-ui-control-bg-hover); }
.pente-ui-root button:active:not(:disabled) { transform: translateY(0.5px); }
.pente-ui-root button:disabled { cursor: default; opacity: 0.45; }
.pente-ui-root input:not([type='range']) {
  border-color: var(--pente-ui-control-border);
  background: var(--pente-ui-field-bg);
}
.pente-ui-root button:focus-visible,
.pente-ui-root input:not([type='range']):focus-visible {
  outline: none;
  box-shadow: var(--pente-ui-focus-ring);
}
.pente-ui-root { position: fixed; inset: 0; pointer-events: none; z-index: 10; }
.pente-ui-zone { position: absolute; display: flex; gap: 8px; padding: 12px; }
.pente-ui-zone > * { pointer-events: auto; }
.pente-ui-zone--top-left { top: 0; left: 0; flex-direction: column; align-items: flex-start; }
.pente-ui-zone--top-center { top: 0; left: 50%; transform: translateX(-50%); flex-direction: column; align-items: center; }
.pente-ui-zone--top-right { top: 0; right: 0; flex-direction: column; align-items: flex-end; }
.pente-ui-zone--left { top: 50%; left: 0; transform: translateY(-50%); flex-direction: column; }
.pente-ui-zone--right { top: 50%; right: 0; transform: translateY(-50%); flex-direction: column; align-items: flex-end; }
.pente-ui-zone--center { top: 50%; left: 50%; transform: translate(-50%, -50%); flex-direction: column; align-items: center; }
.pente-ui-zone--bottom-left { bottom: 0; left: 0; flex-direction: column; align-items: flex-start; }
.pente-ui-zone--bottom-center { bottom: 0; left: 50%; transform: translateX(-50%); flex-direction: column; align-items: center; }
.pente-ui-zone--bottom-right { bottom: 0; right: 0; flex-direction: column; align-items: flex-end; }
/* Issue #44: the banner is the whole score+net HUD bar. LEFT-aligned flex that WRAPS on small /
   mobile widths so its items (status, captures, net code, net status, seat) collapse to new rows
   instead of overflowing. max-width keeps it from stretching edge-to-edge on desktop. */
.pente-widget--banner { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; justify-content: flex-start; max-width: min(92vw, 640px); padding: 6px 12px; border-radius: var(--pente-ui-radius); background: var(--pente-ui-surface); color: var(--pente-ui-text); font-family: var(--pente-ui-font); font-size: 14px; }
.pente-banner-status { border-radius: 6px; padding: 0 4px; }
/* Score row: the two "Name: N" labels sit either side of a visible middle-dot separator (issue #14 —
   they used to render adjacent as "White: 0Black: 0"); the flex gap spaces the label/sep/label. */
.pente-banner-captures { display: flex; gap: 6px; align-items: baseline; }
.pente-banner-capture-sep { opacity: 0.6; }
/* The subtle off-turn cue (Task 6.2, issue #4c): a brief single pulse of the "X to move" line when a
   placement is rejected because it is not the local seat's turn. Deliberately understated — a short
   background/opacity flash, no modal, no error copy. Re-triggered by the banner toggling the class. */
.pente-banner-status--offturn { animation: pente-offturn-pulse 420ms ease-out 1; }
@keyframes pente-offturn-pulse {
  0% { background: rgba(74,144,217,0); opacity: 1; }
  30% { background: rgba(74,144,217,0.45); opacity: 0.75; }
  100% { background: rgba(74,144,217,0); opacity: 1; }
}
/* Issue #44: the merged NET STATUS sub-panel inside the banner. Inline-flex so its items (status
   line, code + Copy, seat, conflict, join error) sit on the banner row and wrap with everything
   else; each net-* child can hide itself via [hidden]. Hidden entirely when the session is idle. */
.pente-banner-net { display: inline-flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; font-size: 13px; }
.pente-banner-net[hidden], .pente-banner-net .pente-net-status-line[hidden], .pente-banner-net .pente-net-code-row[hidden], .pente-banner-net .pente-net-seat[hidden], .pente-banner-net .pente-net-conflict[hidden], .pente-banner-net .pente-net-join-error[hidden] { display: none; }
.pente-banner-net .pente-net-code-row { display: inline-flex; gap: 6px; align-items: center; }
.pente-banner-net .pente-net-code { font-family: ui-monospace, monospace; font-size: 15px; letter-spacing: 2px; }
.pente-banner-net .pente-net-copy { padding: 3px 10px; font-size: 12px; }
.pente-banner-net .pente-net-seat { opacity: 0.85; }
.pente-banner-net .pente-net-conflict { padding: 2px 8px; border-radius: 6px; background: var(--pente-ui-danger-bg); color: var(--pente-ui-danger-text); font-size: 12px; }
.pente-banner-net .pente-net-join-error { padding: 2px 8px; border-radius: 6px; background: rgba(240,180,80,0.18); color: #ffd9a0; font-size: 12px; }
.pente-menu-button { display: inline-flex; align-items: center; justify-content: center; padding: 8px; background: rgb(18,18,22); opacity: 0.55; transition: opacity 150ms ease, box-shadow 130ms ease; }
.pente-menu-button:hover { opacity: 1; }
.pente-menu-button .pente-hamburger { display: block; }
/* #24/#16 slide-in DRAWER: a LEFT-edge panel that OVERLAYS the live canvas (no backdrop, no reflow —
   the board stays visible + interactive to its right). Anchored to the LEFT viewport edge and
   SLID off-screen to the left when closed; sliding in on open. Toggled by the --open class (NOT the
   hidden attribute / display:none — display is not animatable, which would kill the slide). Closed
   it is translated fully off-screen (translateX(-100%)) AND made non-interactive + out of the a11y
   tree (visibility:hidden + pointer-events:none); open restores both. visibility is transitioned
   ALONGSIDE transform so on CLOSE the panel stays visible through the slide-out and only flips to
   hidden at the end (a visible visibility value applies immediately, so OPEN shows instantly and
   slides in). pointer-events:auto only on the panel itself so the rest of the viewport stays
   click-through to the board (the non-blocking goal). */
.pente-menu-drawer { position: fixed; top: 0; left: 0; bottom: 0; display: flex; align-items: stretch; pointer-events: none; visibility: hidden; z-index: 20; transform: translateX(-100%); transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1), visibility 200ms; }
.pente-menu-drawer--open { transform: translateX(0); visibility: visible; }
.pente-menu-panel { position: relative; display: flex; flex-direction: column; gap: 8px; width: 264px; padding: 20px 18px; background: rgba(20,20,26,0.94); backdrop-filter: blur(6px); color: #e6e6ea; font-family: system-ui, sans-serif; border-right: 1px solid rgba(255,255,255,0.08); box-shadow: 8px 0 32px rgba(0,0,0,0.45); pointer-events: auto; overflow-y: auto; }
.pente-menu-title { font-size: 16px; font-weight: 600; margin-bottom: 8px; padding-right: 28px; }
.pente-menu-close { position: absolute; top: 16px; right: 16px; cursor: pointer; border: none; background: transparent; color: #e6e6ea; font-size: 16px; line-height: 1; }
.pente-menu-entry { cursor: pointer; text-align: left; padding: 8px 12px; border-radius: 6px; border: none; background: rgba(255,255,255,0.06); color: #e6e6ea; font-size: 14px; }
.pente-menu-entry:hover { background: rgba(255,255,255,0.14); }
/* #24/#16 / Increment B: settings open WITHIN the drawer context as a LEFT-edge NON-blocking panel
   over the LIVE board — NO full-viewport backdrop (a backdrop would eat the very board clicks the
   non-blocking scope preserves), NO reflow. The board stays visible + interactive to its right so
   you can WATCH it update live while editing (colour/opacity apply immediately via the A.4 loop).
   Mirrors the menu drawer EXACTLY: fixed to the LEFT edge, slid off-screen (translateX(-100%)) +
   non-interactive + out of the a11y tree when closed, sliding in on the --open class (NOT the
   hidden attribute / display:none, which is not animatable). pointer-events only on the panel itself
   so the rest of the viewport stays click-through to the canvas. Sits above the menu drawer (z 40 > 20). */
.pente-settings-modal { position: fixed; top: 0; left: 0; bottom: 0; display: flex; align-items: stretch; pointer-events: none; visibility: hidden; z-index: 40; transform: translateX(-100%); transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1), visibility 200ms; }
.pente-settings-modal--open { transform: translateX(0); visibility: visible; }
.pente-settings-panel { position: relative; display: flex; flex-direction: column; gap: 10px; width: 320px; padding: 24px; overflow-y: auto; background: rgba(20,20,26,0.94); backdrop-filter: blur(6px); color: #e6e6ea; font-family: system-ui, sans-serif; border-right: 1px solid rgba(255,255,255,0.08); box-shadow: 8px 0 32px rgba(0,0,0,0.45); pointer-events: auto; }
/* Accessibility: users who ask for reduced motion get an instant show/hide, no slide. Disabling
   BOTH transitions means the panel still ends off-screen/hidden when closed and on-screen/visible
   when open (same end states) — just without the animated tween. */
@media (prefers-reduced-motion: reduce) {
  .pente-menu-drawer, .pente-settings-modal { transition: none; }
}
.pente-settings-title { font-size: 18px; font-weight: 600; margin-bottom: 4px; }
.pente-settings-subtitle { font-size: 14px; font-weight: 600; margin-top: 8px; }
.pente-settings-close { position: absolute; top: 16px; right: 16px; cursor: pointer; border: none; background: transparent; color: #e6e6ea; font-size: 16px; line-height: 1; }
.pente-settings-body { display: flex; flex-direction: column; gap: 8px; }
.pente-settings-field { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 13px; }
.pente-settings-keybinding-row { font-size: 12px; opacity: 0.85; font-family: ui-monospace, monospace; }
.pente-settings-reset { margin-top: 12px; cursor: pointer; padding: 8px 12px; border-radius: 6px; border: none; background: rgba(255,80,80,0.18); color: #ffb0b0; font-size: 13px; }
.pente-settings-reset:hover { background: rgba(255,80,80,0.28); }
.pente-help-modal[hidden] { display: none; }
.pente-help-modal { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.45); pointer-events: auto; z-index: 30; }
.pente-help-panel { position: relative; display: flex; flex-direction: column; gap: 4px; min-width: 320px; max-height: 80vh; overflow-y: auto; padding: 24px; border-radius: 10px; background: #1a1a20; color: #e6e6ea; font-family: system-ui, sans-serif; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
.pente-help-title { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
.pente-help-close { position: absolute; top: 16px; right: 16px; cursor: pointer; border: none; background: transparent; color: #e6e6ea; font-size: 16px; line-height: 1; }
.pente-help-body { display: flex; flex-direction: column; gap: 4px; }
.pente-help-row { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding: 4px 0; font-size: 14px; }
.pente-help-keys { display: flex; gap: 6px; }
.pente-help-key { padding: 2px 8px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: #e6e6ea; font-family: ui-monospace, monospace; font-size: 12px; }
/* Task C.2 / issue #13: the Network-Game panel opens WITHIN the drawer context as a LEFT-edge
   NON-blocking panel over the LIVE board, mirroring the settings modal EXACTLY (no backdrop, no
   reflow; slid off-screen + hidden until the --open class toggles). Sits above the settings panel
   (z 50 > 40). pointer-events only on the panel itself so the board stays click-through. */
.pente-netpanel-modal { position: fixed; top: 0; left: 0; bottom: 0; display: flex; align-items: stretch; pointer-events: none; visibility: hidden; z-index: 50; transform: translateX(-100%); transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1), visibility 200ms; }
.pente-netpanel-modal--open { transform: translateX(0); visibility: visible; }
.pente-netpanel-panel { position: relative; display: flex; flex-direction: column; gap: 12px; width: 300px; padding: 24px; overflow-y: auto; background: rgba(20,20,26,0.94); backdrop-filter: blur(6px); color: #e6e6ea; font-family: system-ui, sans-serif; border-right: 1px solid rgba(255,255,255,0.08); box-shadow: 8px 0 32px rgba(0,0,0,0.45); pointer-events: auto; }
.pente-netpanel-title { font-size: 18px; font-weight: 600; margin-bottom: 4px; padding-right: 28px; }
.pente-netpanel-close { position: absolute; top: 16px; right: 16px; cursor: pointer; border: none; background: transparent; color: #e6e6ea; font-size: 16px; line-height: 1; }
/* issue #16: ONE unified combobox (input + dropdown toggle) replaces the three source tabs. */
.pente-netpanel-combo { display: flex; gap: 0; }
.pente-netpanel-code-input { flex: 1; min-width: 0; padding: 8px 10px; border-radius: 4px 0 0 4px; border: 1px solid rgba(255,255,255,0.2); border-right: none; background: rgba(0,0,0,0.3); color: #e6e6ea; font-family: ui-monospace, monospace; font-size: 16px; letter-spacing: 2px; text-transform: uppercase; }
.pente-netpanel-code-input::placeholder { color: rgba(230,230,234,0.4); text-transform: uppercase; }
.pente-netpanel-toggle { cursor: pointer; padding: 0 10px; border-radius: 0 4px 4px 0; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.08); color: #e6e6ea; font-size: 12px; }
.pente-netpanel-toggle:hover:not(:disabled) { background: rgba(255,255,255,0.16); }
.pente-netpanel-toggle:disabled { cursor: default; opacity: 0.4; }
.pente-netpanel-recent[hidden], .pente-netpanel-error[hidden] { display: none; }
.pente-netpanel-recent { list-style: none; margin: 0; padding: 4px; display: flex; flex-direction: column; gap: 2px; max-height: 180px; overflow-y: auto; border-radius: 4px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.35); }
.pente-netpanel-recent-row { display: flex; gap: 4px; align-items: center; }
.pente-netpanel-recent-code { flex: 1; text-align: left; cursor: pointer; padding: 6px 8px; border-radius: 4px; border: none; background: transparent; color: #e6e6ea; font-family: ui-monospace, monospace; font-size: 14px; letter-spacing: 2px; }
.pente-netpanel-recent-code:hover { background: rgba(74,144,217,0.35); }
.pente-netpanel-recent-remove { cursor: pointer; padding: 4px 8px; border-radius: 4px; border: none; background: transparent; color: rgba(230,230,234,0.7); font-size: 14px; line-height: 1; }
.pente-netpanel-recent-remove:hover { background: rgba(255,80,80,0.25); color: #ffb0b0; }
.pente-netpanel-error { color: #ffb0b0; font-size: 12px; }
.pente-netpanel-seed { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.pente-netpanel-seed-option { cursor: pointer; padding: 8px 10px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.05); color: #e6e6ea; font-size: 13px; text-align: center; }
.pente-netpanel-seed-option:hover:not(:disabled) { background: rgba(255,255,255,0.12); }
.pente-netpanel-seed-option[data-selected="true"] { border-color: rgba(74,144,217,0.9); background: rgba(74,144,217,0.35); }
.pente-netpanel-seed-option:disabled { cursor: default; opacity: 0.35; }
.pente-netpanel-games[hidden] { display: none; }
.pente-netpanel-games { list-style: none; margin: 0; padding: 4px; display: flex; flex-direction: column; gap: 2px; max-height: 160px; overflow-y: auto; border-radius: 4px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.35); }
.pente-netpanel-game-row { display: flex; }
.pente-netpanel-game { flex: 1; text-align: left; cursor: pointer; padding: 6px 8px; border-radius: 4px; border: none; background: transparent; color: #e6e6ea; font-size: 13px; }
.pente-netpanel-game:hover { background: rgba(74,144,217,0.35); }
.pente-netpanel-game-row[data-selected="true"] .pente-netpanel-game { background: rgba(74,144,217,0.5); }
.pente-netpanel-actions { display: flex; gap: 8px; margin-top: 4px; }
.pente-netpanel-enter { flex: 1; cursor: pointer; padding: 8px 12px; border-radius: 4px; border: none; background: rgba(74,144,217,0.4); color: #e6e6ea; font-size: 14px; }
.pente-netpanel-enter:hover:not(:disabled) { background: rgba(74,144,217,0.6); }
.pente-netpanel-enter:disabled { cursor: default; opacity: 0.4; }
@media (prefers-reduced-motion: reduce) { .pente-netpanel-modal { transition: none; } }
/* Issue #44: the history slider now stacks the range + label on top and the relocated Undo / Redo /
   Reset controls directly UNDERNEATH (their conceptual home, moved out of the banner). */
.pente-widget--history { display: flex; flex-direction: column; gap: 8px; align-items: center; padding: 6px 12px; border-radius: var(--pente-ui-radius); background: var(--pente-ui-surface); color: var(--pente-ui-text); font-family: var(--pente-ui-font); font-size: 13px; }
.pente-history-range { width: 240px; max-width: 60vw; cursor: pointer; }
.pente-history-range:disabled { cursor: default; opacity: 0.45; }
.pente-history-label { min-width: 72px; text-align: center; font-variant-numeric: tabular-nums; }
/* The relocated history controls (issue #44): a centered row of Undo / Redo / Reset directly under
   the slider. Buttons inherit the shared rounded/hover/focus look; only layout + sizing here. */
.pente-history-controls { display: flex; gap: 6px; justify-content: center; }
.pente-history-button { padding: 4px 12px; font-size: 12px; }
.pente-archive-modal[hidden] { display: none; }
.pente-archive-modal { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.45); pointer-events: auto; z-index: 30; }
.pente-archive-panel { position: relative; display: flex; flex-direction: column; gap: 6px; min-width: 360px; max-height: 80vh; overflow-y: auto; padding: 24px; border-radius: 10px; background: #1a1a20; color: #e6e6ea; font-family: system-ui, sans-serif; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
.pente-archive-title { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
.pente-archive-close { position: absolute; top: 16px; right: 16px; cursor: pointer; border: none; background: transparent; color: #e6e6ea; font-size: 16px; line-height: 1; }
.pente-archive-body { display: flex; flex-direction: column; gap: 6px; }
.pente-archive-empty[hidden] { display: none; }
.pente-archive-empty { opacity: 0.7; font-size: 14px; padding: 8px 0; }
.pente-archive-row { display: flex; flex-direction: column; gap: 4px; text-align: left; padding: 10px 12px; border-radius: 6px; background: rgba(255,255,255,0.06); color: #e6e6ea; font-size: 14px; }
.pente-archive-row[data-conflicted="true"] { background: rgba(255,80,80,0.16); }
.pente-archive-players { font-weight: 600; }
.pente-archive-meta { font-size: 12px; opacity: 0.8; }
.pente-archive-actions { display: flex; gap: 8px; margin-top: 4px; }
.pente-archive-review, .pente-archive-resume { cursor: pointer; padding: 4px 12px; border-radius: 4px; border: none; font-size: 13px; color: #e6e6ea; }
.pente-archive-review { background: rgba(255,255,255,0.12); }
.pente-archive-review:hover { background: rgba(255,255,255,0.22); }
.pente-archive-resume { background: rgba(90,170,120,0.28); }
.pente-archive-resume:hover { background: rgba(90,170,120,0.42); }
/* Task N.2.2 / issue #12: the networked END-STATE overlay. NON-BLOCKING + view-only — there is NO
   full-viewport backdrop (a backdrop would hide the very read-only won board the overlay describes,
   and eat the canvas orbit/scrub the finished board still allows). The root is a fixed, centred,
   click-THROUGH layer (pointer-events: none); ONLY the card re-enables pointer-events so its
   Rematch / Accept / Decline buttons are clickable while the board stays visible + interactive
   underneath. Sits above the widgets but is not a modal. Hidden via the [hidden] attribute when the
   game is not over (an in-progress or a local game shows nothing). */
.pente-endstate[hidden] { display: none; }
.pente-endstate { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 35; }
.pente-endstate-card { display: flex; flex-direction: column; gap: 12px; align-items: center; min-width: 240px; padding: 20px 28px; border-radius: 10px; background: rgba(20,20,26,0.92); backdrop-filter: blur(4px); color: #e6e6ea; font-family: system-ui, sans-serif; box-shadow: 0 8px 32px rgba(0,0,0,0.5); pointer-events: auto; text-align: center; }
.pente-endstate-result { font-size: 18px; font-weight: 600; }
.pente-endstate-note[hidden] { display: none; }
.pente-endstate-note { font-size: 13px; opacity: 0.82; }
.pente-endstate-actions { display: flex; gap: 8px; }
.pente-endstate-rematch[hidden], .pente-endstate-accept[hidden], .pente-endstate-decline[hidden] { display: none; }
.pente-endstate-actions button { cursor: pointer; padding: 8px 16px; border-radius: 6px; border: none; color: #e6e6ea; font-size: 14px; }
.pente-endstate-rematch, .pente-endstate-accept { background: rgba(74,144,217,0.5); }
.pente-endstate-rematch:hover, .pente-endstate-accept:hover { background: rgba(74,144,217,0.7); }
.pente-endstate-decline { background: rgba(255,80,80,0.24); color: #ffb0b0; }
.pente-endstate-decline:hover { background: rgba(255,80,80,0.38); }
`;

/** Install the overlay stylesheet once per document (idempotent, keyed by {@link UI_STYLE_ID}). */
function ensureStyles(doc: Document): void {
  if (doc.getElementById(UI_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = UI_STYLE_ID;
  style.textContent = UI_STYLESHEET;
  (doc.head ?? doc.documentElement).appendChild(style);
}

/** A plain, serializable readout of the mounted UI, read back off the live DOM. */
export interface LayoutReadout {
  /** `zone → the mounted widget ids, in DOM order`. Only populated zones appear. */
  zones: Record<string, string[]>;
}

/** The live UI container handle exposed to the app and (via `window.__pente`) to tests. */
export interface UiContainerHandle {
  /** The root overlay element (append to the app container). */
  readonly root: HTMLElement;
  /** Re-render every mounted widget from the current state + config. */
  update(state: unknown, config: unknown): void;
  /** A plain readout of the mounted layout, read back off the live DOM (for assertions). */
  getLayout(): LayoutReadout;
  /** Unmount every widget and remove the overlay. */
  dispose(): void;
}

/**
 * Mount the composable UI: resolve the layout, build zone elements, and mount each widget in
 * flow order. Widgets are built via `registry.get(id)!.mount(deps)` — the id is guaranteed
 * known because `resolveLayout` was handed `registry.knownIds()`, so only registered widgets
 * reach here.
 *
 * @param registry  The widget registry (id → factory).
 * @param config    The `layout` config section (`widgetId → placement`).
 * @param deps      The dependency bag handed to every widget factory's `mount`.
 * @param doc       The document to build elements in (injected for testability; defaults to the
 *   ambient `document`).
 */
export function createUiContainer(
  registry: WidgetRegistry,
  config: LayoutConfig,
  deps: unknown,
  doc: Document = document,
): UiContainerHandle {
  ensureStyles(doc);
  const root = doc.createElement('div');
  root.className = 'pente-ui-root';
  root.setAttribute('data-testid', 'pente-ui-root');

  const resolved = resolveLayout(config, registry.knownIds());
  const mounted: Widget[] = [];

  for (const [zone, widgets] of Object.entries(resolved.zones)) {
    const zoneEl = doc.createElement('div');
    zoneEl.className = `pente-ui-zone pente-ui-zone--${zone}`;
    zoneEl.setAttribute(ZONE_ATTR, zone);
    for (const slot of widgets) {
      // Safe non-null: only ids in registry.knownIds() survive resolveLayout, and knownIds is
      // derived from the same registry, so get(id) is always defined here.
      const factory = registry.get(slot.id)!;
      const widget = factory.mount(deps);
      widget.element.setAttribute(WIDGET_ID_ATTR, slot.id);
      if (slot.offset !== undefined) {
        widget.element.style.transform = `translate(${slot.offset.x}px, ${slot.offset.y}px)`;
      }
      zoneEl.appendChild(widget.element);
      mounted.push(widget);
    }
    root.appendChild(zoneEl);
  }

  function getLayout(): LayoutReadout {
    const zones: Record<string, string[]> = {};
    for (const zoneEl of Array.from(root.querySelectorAll(`[${ZONE_ATTR}]`))) {
      const zone = zoneEl.getAttribute(ZONE_ATTR)!;
      const ids = Array.from(zoneEl.querySelectorAll(`[${WIDGET_ID_ATTR}]`)).map(
        (el) => el.getAttribute(WIDGET_ID_ATTR)!,
      );
      zones[zone] = ids;
    }
    return { zones };
  }

  function update(state: unknown, cfg: unknown): void {
    for (const widget of mounted) widget.update(state, cfg);
  }

  function dispose(): void {
    for (const widget of mounted) widget.dispose?.();
    root.remove();
  }

  log.info('ui container mounted', getLayout().zones);

  return { root, update, getLayout, dispose };
}
