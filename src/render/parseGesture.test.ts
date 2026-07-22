/**
 * Tests for `parseGesture` — the pure gesture-string → { button, modifier } extractor that
 * makes a camera preset's `shift+`/`ctrl+` modifier FUNCTIONAL (camera-controls fix).
 *
 * Before this, the modifier in a gesture like `"shift+left"` was dropped (only the button token
 * survived), so web's `orbit: "left"` and `pan: "ctrl+left"` both resolved to LEFT and collided
 * — the preset could not express "LEFT rotates by default, LEFT pans while Shift is held".
 * `parseGesture` extracts BOTH so the swap listener can wire the modifier. These assertions cover
 * every button token, every modifier (incl. the no-modifier case), and the honest throws on a
 * malformed button OR modifier token — so a mutant dropping the modifier or mis-mapping a button
 * cannot survive (agent-principles #7).
 *
 * This file lives beside `cameraControls.ts` (the IO glue), but `parseGesture` itself is a PURE
 * string function (no THREE, no DOM) — importing it pulls THREE transitively, harmless under jsdom.
 */

import { describe, expect, it } from 'vitest';
import { parseGesture } from './cameraControls.ts';
import controlsDefault from '../config/defaults/controls.json' with { type: 'json' };

describe('parseGesture — button extraction', () => {
  it.each([
    ['left', 'LEFT'],
    ['middle', 'MIDDLE'],
    ['right', 'RIGHT'],
    ['drag', 'LEFT'],
  ] as const)('maps the bare button token %s to %s with no modifier', (gesture, button) => {
    expect(parseGesture(gesture)).toEqual({ button, modifier: null });
  });
});

describe('parseGesture — modifier extraction', () => {
  it('extracts a shift modifier AND the button (shift+left → LEFT gated by shift)', () => {
    expect(parseGesture('shift+left')).toEqual({ button: 'LEFT', modifier: 'shift' });
  });

  it('extracts a ctrl modifier AND the button (ctrl+left → LEFT gated by ctrl)', () => {
    expect(parseGesture('ctrl+left')).toEqual({ button: 'LEFT', modifier: 'ctrl' });
  });

  it('extracts shift with a non-left button (shift+middle → MIDDLE gated by shift)', () => {
    expect(parseGesture('shift+middle')).toEqual({ button: 'MIDDLE', modifier: 'shift' });
  });

  it('extracts shift over a trackpad drag (shift+drag → LEFT gated by shift)', () => {
    // A trackpad `shift+drag` maps to LEFT with a shift modifier, so the same swap logic applies
    // harmlessly — it does not crash and does not silently drop the modifier.
    expect(parseGesture('shift+drag')).toEqual({ button: 'LEFT', modifier: 'shift' });
  });

  it('does NOT invent a modifier for a bare gesture (no-modifier case is null, not "")', () => {
    // Kills a mutant that returns an empty-string / truthy modifier for an un-modified gesture:
    // the base map depends on `modifier === null` to decide which action a button rests at.
    expect(parseGesture('left').modifier).toBeNull();
  });
});

describe('parseGesture — negatives (honest throws)', () => {
  it('throws on an unmappable button token (never silently maps to the wrong button)', () => {
    expect(() => parseGesture('scroll')).toThrow(/unmappable camera gesture button: "scroll"/);
  });

  it('throws on an unmappable button token even behind a valid modifier', () => {
    expect(() => parseGesture('shift+scroll')).toThrow(
      /unmappable camera gesture button: "shift\+scroll"/,
    );
  });

  it('throws on an unrecognized modifier token (never silently DROPS it → button collision)', () => {
    // The root bug this parse prevents: an unknown modifier must NOT be silently ignored (which
    // would drop `alt+` and collide two gestures on one button). It throws, naming the gesture.
    expect(() => parseGesture('alt+left')).toThrow(/unmappable camera gesture modifier: "alt\+left"/);
  });

  it('throws when the modifier and button positions are swapped (left+shift)', () => {
    // `left+shift`: last token `shift` is not a button → button-mapping throws, so a preset that
    // wrote the chord backwards fails loudly rather than binding nothing.
    expect(() => parseGesture('left+shift')).toThrow(/unmappable camera gesture button/);
  });
});

describe('parseGesture — the tracked preset SSOT round-trips', () => {
  it('parses every shipped preset gesture into a button + modifier (no throw)', () => {
    // Guards the config: every orbit/pan gesture in the tracked presets must be parseable, so a
    // future preset edit that introduces an un-parseable gesture is caught here, not at runtime.
    for (const preset of Object.values(controlsDefault.presets)) {
      expect(() => parseGesture(preset.orbit)).not.toThrow();
      expect(() => parseGesture(preset.pan)).not.toThrow();
    }
  });

  it('web pan is FUNCTIONAL shift+left (LEFT gated by shift — the maintainer fix)', () => {
    // The concrete fix: web orbit is un-modified LEFT (base ROTATE) and pan is shift-gated LEFT.
    expect(parseGesture(controlsDefault.presets.web.orbit)).toEqual({
      button: 'LEFT',
      modifier: null,
    });
    expect(parseGesture(controlsDefault.presets.web.pan)).toEqual({
      button: 'LEFT',
      modifier: 'shift',
    });
  });
});
