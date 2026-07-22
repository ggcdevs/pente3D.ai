/**
 * Camera-controls IO glue (Task 4.6) — the Three.js boundary that BINDS a resolved
 * camera preset to a live `OrbitControls`.
 *
 * The preset *selection + validation* is PURE (`cameraPresets.ts`, strict unit + mutation
 * gate). This file is the thin IO shell: it maps a `ResolvedCameraPreset`'s gesture strings
 * onto `OrbitControls`' mouse-button map and copies the speed / invert / zoom-limit knobs
 * onto the controller. It imports three (render layer, NOT `src/core`) and is verified by
 * Playwright driving real drags/zooms against `window.__pente` (build plan Task 4.6).
 *
 * ## Gesture → OrbitControls mapping, and the FUNCTIONAL modifier
 *
 * OrbitControls has three actions (ROTATE = orbit, PAN, DOLLY = zoom) bound to LEFT/MIDDLE/RIGHT
 * buttons. A preset names which *button* AND (optionally) which keyboard MODIFIER drives orbit vs
 * pan — e.g. web's `orbit: "left"` + `pan: "shift+left"` means "LEFT rotates by default, but LEFT
 * pans while Shift is held".
 *
 * The previous glue dropped the modifier entirely (only the button token survived), so web's
 * `orbit: "left"` and `pan: "ctrl+left"` BOTH resolved to LEFT and collided — pan overwrote orbit,
 * making the base LEFT action PAN (the exact inversion the maintainer hit). {@link parseGesture}
 * now extracts BOTH button and modifier, and {@link applyCameraPreset} binds each button to its
 * gesture's UN-modified action, so a modified gesture no longer clobbers an un-modified one.
 *
 * The modifier is then made functional by OrbitControls' OWN documented behavior: with a button
 * bound to ROTATE, holding ctrl/meta/shift at press-time makes that button PAN instead, and with a
 * button bound to PAN it makes it ROTATE (OrbitControls.js `onMouseDown`). So once the base map is
 * correct, web (base LEFT = ROTATE) already pans on Shift+left, and fusion360 (base MIDDLE = PAN)
 * already rotates on Shift+middle — the native inversion does the work. We deliberately do NOT
 * ALSO rewrite `controls.mouseButtons` while a modifier is held: that would DOUBLE-invert (a PAN
 * button under shift becomes ROTATE), cancelling the intent. Proven in
 * `parseGesture.test.ts` / the e2e drag assertions.
 *
 * {@link installModifierSwaps} therefore only OBSERVES the held modifiers (a keydown/keyup listener
 * on the same DOM target the scene listens on) so the {@link CameraPresetReadout} can report the
 * EFFECTIVE action per button (what a press would do right now) — the observable that lets a test
 * prove "Shift held flips LEFT to PAN" without mutating what OrbitControls reads. It returns a
 * disposer the scene calls on teardown.
 *
 * Trackpad/pinch gestures (`drag`/`shift+drag`/`pinch`) map their `drag` token to LEFT (native
 * left-drag orbit) + wheel/pinch zoom; a `shift+drag` maps to LEFT with a shift modifier, so the
 * exact same logic applies harmlessly (the two-finger native mapping lands with the touch pass —
 * a documented deferred flex point).
 */

import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ResolvedCameraPreset } from './cameraPresets.ts';

/** A plain, serializable readout of the applied preset — for `window.__pente` assertions. */
export interface CameraPresetReadout {
  name: string;
  orbitButton: 'LEFT' | 'MIDDLE' | 'RIGHT';
  panButton: 'LEFT' | 'MIDDLE' | 'RIGHT';
  rotateSpeed: number;
  panSpeed: number;
  zoomSpeed: number;
  zoomToCursor: boolean;
  minDistance: number;
  maxDistance: number;
  /**
   * The EFFECTIVE action-per-button map, as THREE.MOUSE numbers — what a press of each button would
   * do RIGHT NOW. At rest this is the raw `OrbitControls.mouseButtons` map; while a modifier gate is
   * held it reflects OrbitControls' native rotate↔pan inversion for the buttons a modified gesture
   * claims (web: LEFT reads ROTATE at rest, PAN while Shift is down). This is the observable that
   * changes when a different preset is applied (fusion360 MIDDLE-orbit vs trackpad LEFT-orbit) AND
   * when a modifier is held — what makes a wrongly-live `controls` re-apply, or a broken modifier
   * gate, detectable where camera position/target can't (agent-principles #3, #7).
   */
  mouseButtons: { LEFT: number | undefined; MIDDLE: number | undefined; RIGHT: number | undefined };
}

/** The button tokens a gesture string can reference. */
type ButtonToken = 'LEFT' | 'MIDDLE' | 'RIGHT';

/** The keyboard modifier a gesture can carry (or `null` for an un-modified gesture). */
type ModifierToken = 'shift' | 'ctrl' | null;

/** A parsed gesture: which OrbitControls button, and which modifier gates it (if any). */
export interface ParsedGesture {
  button: ButtonToken;
  modifier: ModifierToken;
}

/**
 * Parse an orbit/pan gesture string into its OrbitControls button + keyboard modifier. A gesture
 * is a `+`-joined chord like `'shift+middle'`, `'ctrl+left'`, `'left'`, or trackpad-style `'drag'`
 * / `'shift+drag'`. The LAST token is the button (`drag` maps to LEFT — native left-drag); a
 * leading `shift`/`ctrl` token is the modifier (absent → `null`, an un-modified gesture).
 *
 * Throws honestly on an unmappable button token or an unrecognized modifier token, so a malformed
 * preset is never silently mapped to the wrong button — or silently STRIPPED of its modifier (which
 * would collide two gestures on one button, the root bug this parse exists to prevent).
 */
export function parseGesture(gesture: string): ParsedGesture {
  const tokens = gesture.split('+');
  const buttonToken = tokens[tokens.length - 1] ?? gesture;
  let button: ButtonToken;
  switch (buttonToken) {
    case 'left':
    case 'drag':
      button = 'LEFT';
      break;
    case 'middle':
      button = 'MIDDLE';
      break;
    case 'right':
      button = 'RIGHT';
      break;
    default:
      throw new Error(`unmappable camera gesture button: ${JSON.stringify(gesture)}`);
  }

  let modifier: ModifierToken = null;
  for (const token of tokens.slice(0, -1)) {
    if (token === 'shift' || token === 'ctrl') {
      modifier = token;
    } else {
      throw new Error(`unmappable camera gesture modifier: ${JSON.stringify(gesture)}`);
    }
  }
  return { button, modifier };
}

/** The `MOUSE` action constant for each role. */
const MOUSE_ACTION = {
  ROTATE: THREE.MOUSE.ROTATE,
  PAN: THREE.MOUSE.PAN,
  DOLLY: THREE.MOUSE.DOLLY,
} as const;

/**
 * OrbitControls' native modifier inversion (its `onMouseDown`): while any of ctrl/meta/shift is
 * held at press time, a ROTATE button pans and a PAN button rotates; DOLLY is unaffected. We mirror
 * that pure mapping here (NOT to drive OrbitControls — it does its own — but to compute the
 * EFFECTIVE action for the readout while a gate modifier is held).
 */
function invertUnderModifier(action: THREE.MOUSE | undefined): THREE.MOUSE | undefined {
  if (action === MOUSE_ACTION.ROTATE) return MOUSE_ACTION.PAN;
  if (action === MOUSE_ACTION.PAN) return MOUSE_ACTION.ROTATE;
  return action;
}

/**
 * Apply a resolved preset to `controls`, returning the plain readout actually installed
 * (so Playwright can assert the controller was configured FROM the preset, not merely
 * that a "controls applied" log fired — agent-principles #3).
 *
 * The base `mouseButtons` map binds each gesture's UNMODIFIED action to its button: for a gesture
 * WITH a modifier the button gets its OTHER (un-modified) role at rest, and the modified role only
 * while the modifier is held — delivered by OrbitControls' native inversion, NOT by rewriting the
 * map. Web (`orbit: "left"`, `pan: "shift+left"`) → base LEFT = ROTATE (Shift+left pans natively);
 * fusion360 (`orbit: "shift+middle"`, `pan: "middle"`) → base MIDDLE = PAN (Shift+middle rotates
 * natively). This is what stops `orbit`/`pan` colliding on one button.
 */
export function applyCameraPreset(
  controls: OrbitControls,
  preset: ResolvedCameraPreset,
): CameraPresetReadout {
  const orbit = parseGesture(preset.orbit);
  const pan = parseGesture(preset.pan);

  // Base map: every button drives dolly (zoom) unless a gesture claims it. A button is bound to a
  // gesture's action ONLY when that gesture is UN-modified — the button's resting role. A modified
  // gesture leaves the button at its other (un-modified) action here; OrbitControls' native
  // inversion flips it while the modifier is held. This is why `orbit:"left"` + `pan:"shift+left"`
  // no longer collide: only orbit (un-modified) claims LEFT at rest; pan is the Shift-held variant.
  const buttons: Record<ButtonToken, THREE.MOUSE> = {
    LEFT: MOUSE_ACTION.DOLLY,
    MIDDLE: MOUSE_ACTION.DOLLY,
    RIGHT: MOUSE_ACTION.DOLLY,
  };
  if (orbit.modifier === null) buttons[orbit.button] = MOUSE_ACTION.ROTATE;
  if (pan.modifier === null) buttons[pan.button] = MOUSE_ACTION.PAN;
  controls.mouseButtons = { LEFT: buttons.LEFT, MIDDLE: buttons.MIDDLE, RIGHT: buttons.RIGHT };

  controls.rotateSpeed = preset.orbitSpeed * (preset.invertY ? -1 : 1);
  controls.panSpeed = preset.panSpeed;
  controls.zoomSpeed = preset.zoomSpeed;
  controls.zoomToCursor = preset.zoomToCursor;
  controls.minDistance = preset.minDistance;
  controls.maxDistance = preset.maxDistance;
  controls.update();

  return readCameraPreset(controls, {
    name: preset.name,
    orbitButton: orbit.button,
    panButton: pan.button,
  });
}

/** A gate: which button a modified gesture claims, under which modifier. */
interface ModifierGate {
  button: ButtonToken;
  modifier: 'shift' | 'ctrl';
}

/** A DOM target that exposes add/removeEventListener (the window / canvas the scene listens on). */
type ListenerTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** The live modifier-gate handle: an effective-action readout + a disposer. */
export interface ModifierSwapHandle {
  /**
   * The EFFECTIVE `mouseButtons` action map right now: the raw base map at rest, or — for each
   * button a modified gesture claims while its modifier is currently held — OrbitControls' native
   * rotate↔pan inversion applied to the base action. Read by {@link readCameraPreset}.
   */
  effectiveMouseButtons(): { LEFT: number | undefined; MIDDLE: number | undefined; RIGHT: number | undefined };
  /** Remove the keydown/keyup listeners. */
  dispose(): void;
}

/**
 * OBSERVE the keyboard modifiers a preset's modified gestures gate on, so the readout can report
 * the EFFECTIVE per-button action while a modifier is held. It does NOT mutate
 * `controls.mouseButtons` — OrbitControls already applies the ctrl/meta/shift → rotate↔pan
 * inversion itself at press time; rewriting the map here would DOUBLE-invert and cancel the intent
 * (proven in the e2e drag assertions + `parseGesture.test.ts`). This is the seam that makes the
 * modifier FUNCTIONAL *and observable*: behavior comes from OrbitControls' native inversion over
 * the corrected base map, and this handle exposes what that inversion currently yields.
 *
 * On web (`pan: "shift+left"`, base LEFT = ROTATE): Shift down → `effectiveMouseButtons().LEFT` =
 * PAN; Shift up → LEFT = ROTATE. On fusion360 (`orbit: "shift+middle"`, base MIDDLE = PAN): Shift
 * down → MIDDLE = ROTATE; up → PAN. A preset with no modified gesture gates nothing (the readout is
 * always the raw base map) and disposal is a harmless listener removal.
 *
 * Listens on `target` (the same DOM target the input system uses — the window) and returns a
 * disposer that removes both listeners.
 *
 * @throws {Error} (via {@link parseGesture}) if a gesture is malformed.
 */
export function installModifierSwaps(
  controls: OrbitControls,
  preset: ResolvedCameraPreset,
  target: ListenerTarget,
): ModifierSwapHandle {
  const gates: ModifierGate[] = [];
  const addGate = (gesture: string): void => {
    const parsed = parseGesture(gesture);
    if (parsed.modifier !== null) gates.push({ button: parsed.button, modifier: parsed.modifier });
  };
  addGate(preset.orbit);
  addGate(preset.pan);

  const held = { shift: false, ctrl: false };

  /** Map a KeyboardEvent to the modifier token it represents, or null for an irrelevant key. */
  const modifierOfEvent = (event: KeyboardEvent): 'shift' | 'ctrl' | null => {
    if (event.key === 'Shift') return 'shift';
    if (event.key === 'Control') return 'ctrl';
    return null;
  };

  const onKeyDown = (event: Event): void => {
    const modifier = modifierOfEvent(event as KeyboardEvent);
    if (modifier !== null) held[modifier] = true;
  };
  const onKeyUp = (event: Event): void => {
    const modifier = modifierOfEvent(event as KeyboardEvent);
    if (modifier !== null) held[modifier] = false;
  };

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);

  return {
    effectiveMouseButtons: () => {
      const mb = controls.mouseButtons;
      const eff: Record<ButtonToken, THREE.MOUSE | undefined> = {
        LEFT: mb.LEFT ?? undefined,
        MIDDLE: mb.MIDDLE ?? undefined,
        RIGHT: mb.RIGHT ?? undefined,
      };
      // For each button a modified gesture claims whose modifier is currently held, report the
      // action AFTER OrbitControls' native inversion — i.e. what a press would actually do now.
      for (const gate of gates) {
        if (held[gate.modifier]) eff[gate.button] = invertUnderModifier(eff[gate.button]);
      }
      return { LEFT: eff.LEFT, MIDDLE: eff.MIDDLE, RIGHT: eff.RIGHT };
    },
    dispose: () => {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
    },
  };
}

/** The as-applied identity of a preset — the fields NOT recoverable from the live controls alone. */
export interface AppliedPresetTag {
  name: string;
  orbitButton: ButtonToken;
  panButton: ButtonToken;
}

/**
 * Read the plain readout, combining the LIVE `OrbitControls` state (speeds, zoom limits) with the
 * `tag` from the last apply (the preset `name` + which button the orbit/pan gesture chose — not
 * losslessly recoverable from the button map, since two gestures can name one button) and the
 * EFFECTIVE `mouseButtons` map. When a `modifiers` handle is supplied the map reflects any held
 * modifier gate (web: LEFT reads PAN while Shift is down); without one it is the raw base map.
 *
 * Reflecting the controller's CURRENT state — not a construction-time snapshot — is what makes
 * `window.__pente.getCameraPreset()` observe whatever most recently touched the controls (or the
 * modifier state), so the "`controls` is a live-apply no-op" e2e gate bites AND a held modifier is
 * observably reflected — where camera position/target would not move (agent-principles #3, #7).
 */
export function readCameraPreset(
  controls: OrbitControls,
  tag: AppliedPresetTag,
  modifiers?: Pick<ModifierSwapHandle, 'effectiveMouseButtons'>,
): CameraPresetReadout {
  const mb = controls.mouseButtons;
  const mouseButtons = modifiers
    ? modifiers.effectiveMouseButtons()
    : { LEFT: mb.LEFT ?? undefined, MIDDLE: mb.MIDDLE ?? undefined, RIGHT: mb.RIGHT ?? undefined };
  return {
    name: tag.name,
    orbitButton: tag.orbitButton,
    panButton: tag.panButton,
    rotateSpeed: controls.rotateSpeed,
    panSpeed: controls.panSpeed,
    zoomSpeed: controls.zoomSpeed,
    zoomToCursor: controls.zoomToCursor,
    minDistance: controls.minDistance,
    maxDistance: controls.maxDistance,
    mouseButtons,
  };
}
