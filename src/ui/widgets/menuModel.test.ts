import { describe, it, expect } from 'vitest';
import {
  deriveMenu,
  DEFAULT_MENU_ENTRIES,
  MENU_SCOPE_ID,
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
      { id: 'host', label: 'Host', commandId: 'hostGame' },
      { id: 'join', label: 'Join', commandId: 'joinGame' },
      { id: 'load', label: 'Load', commandId: 'loadGame' },
      { id: 'export', label: 'Export', commandId: 'exportGame' },
    ]);
  });

  it('uses DEFAULT_MENU_ENTRIES when no roster is passed (same result as passing it)', () => {
    expect(deriveMenu()).toEqual(deriveMenu(DEFAULT_MENU_ENTRIES));
  });

  it('the default roster carries the five design entries with distinct command ids', () => {
    expect(DEFAULT_MENU_ENTRIES.map((e) => e.id)).toEqual([
      'settings',
      'host',
      'join',
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
  it('is the stable "menu" scope id the modal pushes', () => {
    expect(MENU_SCOPE_ID).toBe('menu');
  });
});
