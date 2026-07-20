/**
 * PURE camera-preset resolver (Task 4.6).
 *
 * The `controls` config section (render-ui design Part 3/4) ships named **control presets**
 * — Fusion 360 and trackpad — each declaring which gesture drives orbit / pan / zoom plus
 * speed, invert-Y, zoom-to-cursor, and zoom-distance limits. `resolveCameraPreset` selects
 * the active preset by name and validates every field into a `ResolvedCameraPreset` that the
 * OrbitControls glue in `scene.ts` binds to the live controller.
 *
 * This is the PURE boundary of the camera controls — no THREE, no DOM — so the selection +
 * validation logic earns the strict unit + mutation gate, while the actual drag/zoom against
 * OrbitControls is the IO boundary verified by Playwright (build plan Task 4.6). It reads
 * only the config record; it touches no rendering and no rules.
 *
 * Validation is strict and honest (agent-principles): an unknown active preset name throws
 * (never a silent fall-back to the wrong controls), and every numeric/boolean field is type-
 * and range-checked (inverted zoom limits are an impossible clamp) so a corrupt override
 * surfaces at resolution rather than producing subtly-broken controls.
 */

/** A gesture binding string for orbit/pan/zoom (e.g. `'shift+middle'`, `'drag'`, `'pinch'`). */
export type Gesture = string;

/** One named control preset as it appears in `controls.json`. */
export interface ControlPreset {
  readonly orbit: Gesture;
  readonly pan: Gesture;
  readonly zoom: Gesture;
  readonly orbitSpeed: number;
  readonly panSpeed: number;
  readonly zoomSpeed: number;
  readonly invertY: boolean;
  readonly zoomToCursor: boolean;
  readonly minDistance: number;
  readonly maxDistance: number;
}

/** The `controls` config section shape (mirrors `defaults/controls.json`). */
export interface ControlsConfig {
  /** The name of the active preset — a key into `presets`. */
  readonly preset: string;
  /** The named presets, keyed by name. */
  readonly presets: Readonly<Record<string, ControlPreset>>;
}

/** A validated, ready-to-bind preset — the resolved preset plus its resolved `name`. */
export interface ResolvedCameraPreset extends ControlPreset {
  /** The active preset's name (the key it was resolved under). */
  readonly name: string;
}

/**
 * Assert a field is a finite number, else throw naming the field (honest failure).
 * `Number.isFinite` is complete on its own — it never coerces, so it returns `false` for
 * every non-number (string/boolean/null/undefined) and for `NaN`/±Infinity — hence no
 * redundant `typeof` guard (which would be an equivalent mutant with no killing input).
 */
function requireFiniteNumber(value: unknown, field: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`invalid controls preset ${field}: ${JSON.stringify(value)} (expected a finite number)`);
  }
  return value as number;
}

/** Assert a field is a boolean, else throw naming the field. */
function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`invalid controls preset ${field}: ${JSON.stringify(value)} (expected a boolean)`);
  }
  return value;
}

/** Assert a field is a non-empty string gesture, else throw naming the field. */
function requireGesture(value: unknown, field: string): Gesture {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`invalid controls preset ${field}: ${JSON.stringify(value)} (expected a gesture string)`);
  }
  return value;
}

/**
 * Resolve the active {@link ResolvedCameraPreset} from a `controls` config.
 *
 * @throws {Error} if `presets` is absent, the active `preset` name is not present in the
 *   map, any gesture/number/boolean field is ill-typed, or the zoom limits are inverted
 *   (`minDistance >= maxDistance`, which would make the zoom clamp empty).
 */
export function resolveCameraPreset(config: ControlsConfig): ResolvedCameraPreset {
  const presets = config.presets;
  // `typeof null === 'object'`, so the explicit `!== null` is load-bearing; `undefined`
  // and every scalar are caught by the `typeof` check (no redundant `=== undefined`).
  if (presets === null || typeof presets !== 'object') {
    throw new Error(`invalid controls.presets: ${JSON.stringify(presets)} (expected a preset map)`);
  }
  const name = config.preset;
  const preset = presets[name];
  if (preset === undefined) {
    throw new Error(`unknown control preset: ${JSON.stringify(name)}`);
  }

  const minDistance = requireFiniteNumber(preset.minDistance, 'minDistance');
  const maxDistance = requireFiniteNumber(preset.maxDistance, 'maxDistance');
  if (minDistance >= maxDistance) {
    throw new Error(
      `invalid zoom limit: minDistance (${minDistance}) must be < maxDistance (${maxDistance})`,
    );
  }

  return {
    name,
    orbit: requireGesture(preset.orbit, 'orbit'),
    pan: requireGesture(preset.pan, 'pan'),
    zoom: requireGesture(preset.zoom, 'zoom'),
    orbitSpeed: requireFiniteNumber(preset.orbitSpeed, 'orbitSpeed'),
    panSpeed: requireFiniteNumber(preset.panSpeed, 'panSpeed'),
    zoomSpeed: requireFiniteNumber(preset.zoomSpeed, 'zoomSpeed'),
    invertY: requireBoolean(preset.invertY, 'invertY'),
    zoomToCursor: requireBoolean(preset.zoomToCursor, 'zoomToCursor'),
    minDistance,
    maxDistance,
  };
}
