/**
 * PURE scene-config resolver (Task 4.1).
 *
 * Turns the tracked `lighting` + `colors` config sections into a plain-number
 * descriptor the Three.js scene glue (`scene.ts`) consumes. This is the pure boundary
 * of scene bootstrap — no THREE, no DOM — so it can be unit- + mutation-tested. It:
 *   - converts hex color strings (`"#ffffff"`) to 24-bit integers (Three.js color ints),
 *   - validates that intensities and positions are finite numbers,
 *   - throws honestly on malformed input (never returns a silently-wrong scene).
 *
 * Keeping color parsing + validation here (not inline in `scene.ts`) means the scene
 * glue is a thin, Playwright-verified shell while the fiddly conversion logic gets the
 * strict pure-logic gate (build plan Task 4.1 gating model).
 */

/** A finite 3D point as plain numbers (a config position, resolved). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** The `lighting` config section shape (mirrors `defaults/lighting.json`). */
export interface LightingConfig {
  ambient: { color: string; intensity: number };
  directional: { color: string; intensity: number; position: Vec3 };
}

/** The subset of the `colors` config the scene bootstrap needs. */
export interface SceneColorsConfig {
  background: string;
}

/** Resolved scene parameters as plain numbers, ready to hand to Three.js. */
export interface ResolvedSceneConfig {
  background: number;
  ambient: { color: number; intensity: number };
  directional: { color: number; intensity: number; position: Vec3 };
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Convert a `#rrggbb` hex color string to its 24-bit integer value.
 * Throws on any non-string or non-`#rrggbb` input — no shorthand, no missing hash.
 */
export function hexToInt(hex: string): number {
  if (typeof hex !== 'string' || !HEX_COLOR.test(hex)) {
    throw new Error(`invalid hex color: ${JSON.stringify(hex)} (expected "#rrggbb")`);
  }
  return parseInt(hex.slice(1), 16);
}

/**
 * Assert a value is a finite number, throwing with `label` context otherwise.
 * `Number.isFinite` does NOT coerce, so it already rejects every non-number (string,
 * null, NaN, ±Infinity) — no separate `typeof` guard is needed (a `typeof` check here
 * would be a redundant, always-true-when-non-number branch).
 */
function requireFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`invalid ${label}: ${JSON.stringify(value)} (expected a finite number)`);
  }
  return value;
}

/** Resolve a config `Vec3`, validating each component is finite. */
function resolvePosition(pos: Vec3, label: string): Vec3 {
  return {
    x: requireFinite(pos.x, `${label} position.x`),
    y: requireFinite(pos.y, `${label} position.y`),
    z: requireFinite(pos.z, `${label} position.z`),
  };
}

/**
 * Resolve `lighting` + `colors` config into plain-number scene parameters.
 * Colors become integers; intensities and positions are validated finite.
 */
export function resolveSceneConfig(
  lighting: LightingConfig,
  colors: SceneColorsConfig,
): ResolvedSceneConfig {
  return {
    background: hexToInt(colors.background),
    ambient: {
      color: hexToInt(lighting.ambient.color),
      intensity: requireFinite(lighting.ambient.intensity, 'ambient intensity'),
    },
    directional: {
      color: hexToInt(lighting.directional.color),
      intensity: requireFinite(lighting.directional.intensity, 'directional intensity'),
      position: resolvePosition(lighting.directional.position, 'directional'),
    },
  };
}
