import { describe, it, expect } from 'vitest';
import {
  deriveMenu,
  DEFAULT_MENU_ENTRIES,
  MENU_SCOPE_ID,
  MENU_SCOPE_BLOCKING,
  closedMenu,
  toggleMenu,
  closeMenu,
  type MenuEntrySpec,
} from './menuModel.ts';

/**
 * PURE menu view-model tests (Task 5.3) — strict unit + mutation gate. Genuine assertions on the
 * exact derived model (agent-principles: specific expected values, never "it ran"), with
 * negative cases for each resolution rule (hidden dropped; ordering; id tiebreak). The DOM/scope
 * wiring is proven separately by Playwright.
 */

describe('deriveMenu — default roster', () => {
  it('projects the design-Part-6 entries to items in design order (id/label/commandId)', () => {
    const model = deriveMenu();
    expect(model.items).toEqual([
      { id: 'settings', label: 'Settings', commandId: 'openSettings' },
      { id: 'network', label: 'Network Game', commandId: 'openNetwork' },
      { id: 'load', label: 'Load', commandId: 'loadGame' },
      { id: 'export', label: 'Export', commandId: 'exportGame' },
    ]);
  });

  it('uses DEFAULT_MENU_ENTRIES when no roster is passed (same result as passing it)', () => {
    expect(deriveMenu()).toEqual(deriveMenu(DEFAULT_MENU_ENTRIES));
  });

  it('the default roster carries the design entries with distinct command ids', () => {
    expect(DEFAULT_MENU_ENTRIES.map((e) => e.id)).toEqual([
      'settings',
      'network',
      'load',
      'export',
    ]);
    const commandIds = DEFAULT_MENU_ENTRIES.map((e) => e.commandId);
    expect(new Set(commandIds).size).toBe(commandIds.length);
  });
});

describe('deriveMenu — ordering', () => {
  it('sorts entries by ascending order regardless of authoring order', () => {
    const entries: MenuEntrySpec[] = [
      { id: 'c', label: 'C', commandId: 'cmdC', order: 2 },
      { id: 'a', label: 'A', commandId: 'cmdA', order: 0 },
      { id: 'b', label: 'B', commandId: 'cmdB', order: 1 },
    ];
    expect(deriveMenu(entries).items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('breaks ties in order by entry id (deterministic, not authoring order)', () => {
    // Same order value; authored z-before-a. The id tiebreak must put a first.
    const entries: MenuEntrySpec[] = [
      { id: 'z', label: 'Z', commandId: 'cmdZ', order: 5 },
      { id: 'a', label: 'A', commandId: 'cmdA', order: 5 },
    ];
    expect(deriveMenu(entries).items.map((i) => i.id)).toEqual(['a', 'z']);
  });

  it('does not mutate the input roster (pure)', () => {
    const entries: MenuEntrySpec[] = [
      { id: 'c', label: 'C', commandId: 'cmdC', order: 2 },
      { id: 'a', label: 'A', commandId: 'cmdA', order: 0 },
    ];
    const snapshot = entries.map((e) => e.id);
    deriveMenu(entries);
    expect(entries.map((e) => e.id)).toEqual(snapshot);
  });
});

describe('deriveMenu — visibility (negative cases)', () => {
  it('drops an entry with visible:false', () => {
    const entries: MenuEntrySpec[] = [
      { id: 'settings', label: 'Settings', commandId: 'openSettings', order: 0 },
      { id: 'host', label: 'Host', commandId: 'hostGame', order: 1, visible: false },
    ];
    const ids = deriveMenu(entries).items.map((i) => i.id);
    expect(ids).toEqual(['settings']);
    expect(ids).not.toContain('host');
  });

  it('keeps an entry with visible:true and an entry with visible omitted (default shown)', () => {
    const entries: MenuEntrySpec[] = [
      { id: 'a', label: 'A', commandId: 'cmdA', order: 0, visible: true },
      { id: 'b', label: 'B', commandId: 'cmdB', order: 1 },
    ];
    expect(deriveMenu(entries).items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('yields an empty item list when every entry is hidden', () => {
    const entries: MenuEntrySpec[] = [
      { id: 'a', label: 'A', commandId: 'cmdA', order: 0, visible: false },
      { id: 'b', label: 'B', commandId: 'cmdB', order: 1, visible: false },
    ];
    expect(deriveMenu(entries).items).toEqual([]);
  });

  it('yields an empty item list for an empty roster', () => {
    expect(deriveMenu([]).items).toEqual([]);
  });
});

describe('MENU_SCOPE_ID', () => {
  it('is the stable "menu" scope id the drawer pushes', () => {
    expect(MENU_SCOPE_ID).toBe('menu');
  });
});

describe('MENU_SCOPE_BLOCKING', () => {
  it('is false — the drawer is NON-blocking so the board stays interactive (#24)', () => {
    // The whole point of the drawer over the old modal: the scope must NOT swallow keys, so
    // camera/game input falls through while the drawer is open. A regression to `true` here is
    // the exact bug the drawer replaces, so this pins it as a mutation-killable fact.
    expect(MENU_SCOPE_BLOCKING).toBe(false);
  });
});

describe('drawer open/closed state', () => {
  it('starts closed', () => {
    expect(closedMenu()).toEqual({ open: false });
  });

  it('toggle opens a closed drawer', () => {
    expect(toggleMenu(closedMenu())).toEqual({ open: true });
  });

  it('toggle closes an open drawer', () => {
    expect(toggleMenu({ open: true })).toEqual({ open: false });
  });

  it('toggle is its own inverse (two toggles return to the start)', () => {
    const start = closedMenu();
    expect(toggleMenu(toggleMenu(start))).toEqual(start);
  });

  it('toggle does not mutate the input state (pure)', () => {
    const start = closedMenu();
    const snapshot = { ...start };
    toggleMenu(start);
    expect(start).toEqual(snapshot);
  });

  it('close yields a closed state from an open drawer', () => {
    expect(closeMenu({ open: true })).toEqual({ open: false });
  });

  it('close yields a closed state from an already-closed drawer', () => {
    expect(closeMenu({ open: false })).toEqual({ open: false });
  });

  it('close does not mutate the input state (pure)', () => {
    const start: { open: boolean } = { open: true };
    const snapshot = { ...start };
    closeMenu(start);
    expect(start).toEqual(snapshot);
  });
});
