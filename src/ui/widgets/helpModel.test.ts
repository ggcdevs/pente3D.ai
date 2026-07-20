import { describe, it, expect } from 'vitest';
import {
  deriveHelp,
  DEFAULT_COMMAND_LABELS,
  HELP_SCOPE_ID,
  SHOW_HELP_COMMAND,
  type HelpSources,
} from './helpModel.ts';

/**
 * PURE help-overlay view-model tests (Task 5.7) — strict unit + mutation gate. The overlay's
 * shortcut list is GENERATED from the command registry + current bindings, so these tests prove the
 * DERIVATION: registered+bound commands become rows; a stale binding (unknown command) and an
 * unbound command are each DROPPED (negative cases); multiple keys collect onto one row; labels
 * fall back to the raw id; rows + keys are deterministically ordered regardless of authoring order.
 * Genuine assertions on the exact derived model (agent-principles: specific expected values, never
 * "it ran"). The DOM/scope wiring is proven separately by Playwright.
 */

describe('deriveHelp — generation from registry + bindings', () => {
  it('builds a row per registered+bound command with its keys and friendly label', () => {
    const sources: HelpSources = {
      commandIds: ['undo', 'redo'],
      bindings: { u: 'undo', r: 'redo' },
    };
    expect(deriveHelp(sources).rows).toEqual([
      { commandId: 'redo', label: 'Redo', keys: ['r'] },
      { commandId: 'undo', label: 'Undo', keys: ['u'] },
    ]);
  });

  it('collects MULTIPLE keys bound to one command into a single row, sorted', () => {
    // Two chords bound to `undo`; authored z-before-a so the key sort is genuinely exercised.
    const sources: HelpSources = {
      commandIds: ['undo'],
      bindings: { z: 'undo', a: 'undo' },
    };
    const rows = deriveHelp(sources).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ commandId: 'undo', label: 'Undo', keys: ['a', 'z'] });
  });

  it('falls back to the raw command id when no friendly label is known', () => {
    const sources: HelpSources = {
      commandIds: ['mystery'],
      bindings: { m: 'mystery' },
    };
    // No DEFAULT_COMMAND_LABELS entry for `mystery` → the id itself is the label (never hidden).
    expect(deriveHelp(sources).rows).toEqual([{ commandId: 'mystery', label: 'mystery', keys: ['m'] }]);
  });

  it('honours an explicit empty-string label (uses ??, not ||)', () => {
    const sources: HelpSources = {
      commandIds: ['x'],
      bindings: { k: 'x' },
      labels: { x: '' },
    };
    // `??` keeps the intentional empty string rather than replacing it with the id under `||`.
    expect(deriveHelp(sources).rows[0]!.label).toBe('');
  });
});

describe('deriveHelp — negative cases (a shortcut needs BOTH a command AND a key)', () => {
  it('drops a STALE binding whose command is not registered', () => {
    // `showHelp`/`closeModal` are bound in the tracked keybindings but register no command here.
    const sources: HelpSources = {
      commandIds: ['undo'],
      bindings: { u: 'undo', '?': 'showHelp', Escape: 'closeModal' },
    };
    const ids = deriveHelp(sources).rows.map((r) => r.commandId);
    expect(ids).toEqual(['undo']);
    expect(ids).not.toContain('showHelp');
    expect(ids).not.toContain('closeModal');
  });

  it('drops a registered command that has NO key bound to it', () => {
    const sources: HelpSources = {
      commandIds: ['undo', 'redo', 'reset'],
      bindings: { u: 'undo' }, // redo + reset registered but unbound → no shortcut to show
    };
    expect(deriveHelp(sources).rows.map((r) => r.commandId)).toEqual(['undo']);
  });

  it('yields no rows when nothing is both registered and bound', () => {
    expect(deriveHelp({ commandIds: [], bindings: {} }).rows).toEqual([]);
    // Registered-but-unbound and bound-but-unregistered both yield an empty list.
    expect(deriveHelp({ commandIds: ['undo'], bindings: {} }).rows).toEqual([]);
    expect(deriveHelp({ commandIds: [], bindings: { u: 'undo' } }).rows).toEqual([]);
  });
});

describe('deriveHelp — deterministic ordering', () => {
  it('orders rows by label, independent of registry/binding authoring order', () => {
    const sources: HelpSources = {
      commandIds: ['undo', 'redo'],
      // Authored redo-first via bindings; labels are Undo/Redo → sorted "Redo" < "Undo".
      bindings: { u: 'undo', r: 'redo' },
    };
    expect(deriveHelp(sources).rows.map((r) => r.label)).toEqual(['Redo', 'Undo']);
  });

  it('breaks a label tie by command id', () => {
    // Two commands sharing a label; the command-id tiebreak must order them beta-before-zeta.
    const sources: HelpSources = {
      commandIds: ['zeta', 'beta'],
      bindings: { z: 'zeta', b: 'beta' },
      labels: { zeta: 'Same', beta: 'Same' },
    };
    expect(deriveHelp(sources).rows.map((r) => r.commandId)).toEqual(['beta', 'zeta']);
  });

  it('does not mutate the input bindings (pure)', () => {
    const bindings = { u: 'undo', r: 'redo' };
    const snapshot = { ...bindings };
    deriveHelp({ commandIds: ['undo', 'redo'], bindings });
    expect(bindings).toEqual(snapshot);
  });
});

describe('deriveHelp — default labels + constants', () => {
  it('uses DEFAULT_COMMAND_LABELS when no labels override is passed', () => {
    const rows = deriveHelp({ commandIds: ['openSettings'], bindings: { s: 'openSettings' } }).rows;
    expect(rows[0]!.label).toBe(DEFAULT_COMMAND_LABELS.openSettings);
    expect(rows[0]!.label).toBe('Open settings');
  });

  it('HELP_SCOPE_ID is the stable "help" scope id and SHOW_HELP_COMMAND is "showHelp"', () => {
    expect(HELP_SCOPE_ID).toBe('help');
    expect(SHOW_HELP_COMMAND).toBe('showHelp');
  });

  it('renders EACH default label verbatim for its command (no empty/blank labels)', () => {
    // Every label literal in the shipped roster must reach the row for its command exactly as
    // written — a data-driven check so a typo/blanking of ANY label is caught (not just the few
    // spot-checked above). Bind one key per labelled command and read its rendered label back.
    const commandIds = Object.keys(DEFAULT_COMMAND_LABELS);
    const bindings: Record<string, string> = {};
    commandIds.forEach((id, i) => {
      bindings[`k${i}`] = id; // a unique synthetic chord per command so each gets a row
    });
    const rows = deriveHelp({ commandIds, bindings }).rows;
    const labelByCommand = new Map(rows.map((r) => [r.commandId, r.label]));
    for (const [id, expected] of Object.entries(DEFAULT_COMMAND_LABELS)) {
      expect(labelByCommand.get(id)).toBe(expected);
      expect(expected.length).toBeGreaterThan(0);
    }
    // The roster covers every command id it claims (one row each) — nothing dropped.
    expect(rows).toHaveLength(commandIds.length);
  });

  it('spot-checks the exact shipped labels for the core action commands', () => {
    // A few explicit literals so the exact strings are asserted directly (belt-and-braces with the
    // data-driven check above — a reader sees the concrete expected text, not only the round-trip).
    expect(DEFAULT_COMMAND_LABELS.undo).toBe('Undo');
    expect(DEFAULT_COMMAND_LABELS.redo).toBe('Redo');
    expect(DEFAULT_COMMAND_LABELS.reset).toBe('Reset game');
    expect(DEFAULT_COMMAND_LABELS.toggleOrthogonal).toBe('Toggle orthogonal lines');
    expect(DEFAULT_COMMAND_LABELS.toggleFaceDiagonals).toBe('Toggle face-diagonal lines');
    expect(DEFAULT_COMMAND_LABELS.toggleSpaceDiagonals).toBe('Toggle space-diagonal lines');
    expect(DEFAULT_COMMAND_LABELS.showAllDiagonals).toBe('Show all diagonals');
    expect(DEFAULT_COMMAND_LABELS.enterTempMode).toBe('Enter temp-placement mode');
    expect(DEFAULT_COMMAND_LABELS.exitTempMode).toBe('Exit temp-placement mode');
    expect(DEFAULT_COMMAND_LABELS.confirmTempPiece).toBe('Confirm previewed piece');
    expect(DEFAULT_COMMAND_LABELS.hostGame).toBe('Host game');
    expect(DEFAULT_COMMAND_LABELS.joinGame).toBe('Join game');
    expect(DEFAULT_COMMAND_LABELS.showHelp).toBe('Show this help');
  });
});
