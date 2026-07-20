/**
 * Camera-controls IO glue (Task 4.6) — the Three.js boundary that BINDS a resolved
 * camera preset to a live `OrbitControls`.
 *
 * The preset *selection + validation* is PURE (`cameraPresets.ts`, strict unit + mutation
 * gate). This file is the thin IO shell: it maps a `ResolvedCameraPreset`'s gesture strings
 * onto `OrbitControls`' mouse-button map and copies the speed / invert / zoom-limit knobs
 * onto the controller. It imports three (render layer, NOT `src/core`) and is verified by
 * Playwright driving real drags/zooms against `window.__pente` (build plan Task 4.6), not
 * by mutation testing.
 *
 * Gesture → OrbitControls mapping: OrbitControls has three actions (ROTATE = orbit, PAN,
 * DOLLY = zoom) bound to LEFT/MIDDLE/RIGHT buttons. A preset names which *button* (or
 * modifier+button) drives orbit vs pan; we map the button token to the corresponding
 * `MOUSE` action. Trackpad/pinch gestures (`drag`/`pinch`) fall back to the web-friendly
 * left-drag orbit + wheel zoom that OrbitControls supports natively (the two-finger native
 * mapping lands with the touch pass — a documented deferred flex point).
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
}

/** The button tokens a gesture string can reference. */
type ButtonToken = 'LEFT' | 'MIDDLE' | 'RIGHT';

/**
 * Extract the OrbitControls button an orbit/pan gesture drives. A gesture is a `+`-joined
 * chord like `'shift+middle'` or `'left'`; the *last* token is the button. Trackpad-style
 * `'drag'` maps to LEFT (native left-drag). Anything unrecognized throws honestly so a
 * malformed preset is never silently mapped to the wrong button.
 */
function buttonOf(gesture: string): ButtonToken {
  const token = gesture.split('+').pop() ?? gesture;
  switch (token) {
    case 'left':
    case 'drag':
      return 'LEFT';
    case 'middle':
      return 'MIDDLE';
    case 'right':
      return 'RIGHT';
    default:
      throw new Error(`unmappable camera gesture button: ${JSON.stringify(gesture)}`);
  }
}

/** The `MOUSE` action constant for a button token. */
const MOUSE_ACTION = {
  ROTATE: THREE.MOUSE.ROTATE,
  PAN: THREE.MOUSE.PAN,
  DOLLY: THREE.MOUSE.DOLLY,
} as const;

/**
 * Apply a resolved preset to `controls`, returning the plain readout actually installed
 * (so Playwright can assert the controller was configured FROM the preset, not merely
 * that a "controls applied" log fired — agent-principles #3).
 */
export function applyCameraPreset(
  controls: OrbitControls,
  preset: ResolvedCameraPreset,
): CameraPresetReadout {
  const orbitButton = buttonOf(preset.orbit);
  const panButton = buttonOf(preset.pan);

  // Bind orbit + pan to their buttons; the remaining button drives dolly (zoom) so a
  // mouse-only user can always zoom-drag even when the wheel is the primary zoom.
  const buttons: Record<ButtonToken, THREE.MOUSE> = {
    LEFT: MOUSE_ACTION.DOLLY,
    MIDDLE: MOUSE_ACTION.DOLLY,
    RIGHT: MOUSE_ACTION.DOLLY,
  };
  buttons[orbitButton] = MOUSE_ACTION.ROTATE;
  buttons[panButton] = MOUSE_ACTION.PAN;
  controls.mouseButtons = { LEFT: buttons.LEFT, MIDDLE: buttons.MIDDLE, RIGHT: buttons.RIGHT };

  controls.rotateSpeed = preset.orbitSpeed * (preset.invertY ? -1 : 1);
  controls.panSpeed = preset.panSpeed;
  controls.zoomSpeed = preset.zoomSpeed;
  controls.zoomToCursor = preset.zoomToCursor;
  controls.minDistance = preset.minDistance;
  controls.maxDistance = preset.maxDistance;
  controls.update();

  return {
    name: preset.name,
    orbitButton,
    panButton,
    rotateSpeed: controls.rotateSpeed,
    panSpeed: controls.panSpeed,
    zoomSpeed: controls.zoomSpeed,
    zoomToCursor: controls.zoomToCursor,
    minDistance: controls.minDistance,
    maxDistance: controls.maxDistance,
  };
}
