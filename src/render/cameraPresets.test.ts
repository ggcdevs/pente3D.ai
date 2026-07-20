/**
 * Tests for the PURE camera-preset resolver (Task 4.6).
 *
 * The `controls` config section ships named presets (Fusion 360 + trackpad, render-ui
 * design Part 3) each declaring which gesture drives orbit/pan/zoom plus speed, invert,
 * and zoom-limit knobs. `resolveCameraPreset` picks the active preset by name and
 * validates it into a `ResolvedCameraPreset` the OrbitControls glue binds — this is the
 * pure boundary (no THREE, no DOM), earning the strict unit + mutation gate.
 *
 * Genuine assertions on the resolved fields + NEGATIVES: an unknown preset name throws
 * (never a silent wrong-controls fallback), a missing `presets` map throws, an
 * out-of-order / inverted zoom limit throws, a non-number speed throws. Expected values
 * derive from the tracked `controls.json` SSOT so no magic value is duplicated
 * (agent-principles #8).
 */

import { describe, expect, it } from 'vitest';
import { resolveCameraPreset, type ControlsConfig, type ControlPreset } from './cameraPresets.ts';
import controlsDefault from '../config/defaults/controls.json' with { type: 'json' };

describe('resolveCameraPreset — tracked defaults', () => {
  it('resolves the default active preset (fusion360) from the shipped config SSOT', () => {
    const resolved = resolveCameraPreset(controlsDefault as unknown as ControlsConfig);
    const fusion = controlsDefault.presets.fusion360;
    expect(resolved.name).toBe('fusion360');
    expect(resolved.orbit).toBe(fusion.orbit);
    expect(resolved.pan).toBe(fusion.pan);
    expect(resolved.zoom).toBe(fusion.zoom);
    expect(resolved.orbitSpeed).toBe(fusion.orbitSpeed);
    expect(resolved.zoomToCursor).toBe(fusion.zoomToCursor);
    expect(resolved.invertY).toBe(fusion.invertY);
    expect(resolved.minDistance).toBe(fusion.minDistance);
    expect(resolved.maxDistance).toBe(fusion.maxDistance);
  });

  it('resolves the trackpad preset when it is the active one (design requires both)', () => {
    const cfg = { ...controlsDefault, preset: 'trackpad' } as unknown as ControlsConfig;
    const resolved = resolveCameraPreset(cfg);
    expect(resolved.name).toBe('trackpad');
    expect(resolved.orbit).toBe(controlsDefault.presets.trackpad.orbit);
    expect(resolved.zoom).toBe(controlsDefault.presets.trackpad.zoom); // 'pinch'
  });

  it('ships BOTH shipped presets required by the design (fusion360 + trackpad)', () => {
    // Guards the config SSOT: the design mandates exactly these two named presets.
    expect(Object.keys(controlsDefault.presets)).toEqual(
      expect.arrayContaining(['fusion360', 'trackpad']),
    );
  });
});

describe('resolveCameraPreset — validation / negatives', () => {
  const base: ControlsConfig = {
    preset: 'p',
    presets: {
      p: {
        orbit: 'drag',
        pan: 'shift+drag',
        zoom: 'wheel',
        orbitSpeed: 1,
        panSpeed: 1,
        zoomSpeed: 1,
        invertY: false,
        zoomToCursor: true,
        minDistance: 2,
        maxDistance: 40,
      },
    },
  };

  /** The valid `p` preset from `base`, non-null (base defines exactly this key). */
  const goodPreset = base.presets['p'] as ControlPreset;

  /** Build a config from `base` with `overrides` merged onto its `p` preset. */
  const resolveInto = (
    cfg: ControlsConfig,
    overrides: Partial<Record<keyof ControlPreset, unknown>>,
  ): ControlsConfig => ({
    ...cfg,
    presets: { p: { ...goodPreset, ...overrides } as ControlPreset },
  });

  /** Build `base` with one preset field overridden to a bad value. */
  const withField = (field: string, value: unknown): ControlsConfig =>
    resolveInto(base, { [field]: value });

  it('throws for an unknown active preset name (never a silent wrong-controls fallback)', () => {
    expect(() =>
      resolveCameraPreset({ ...base, preset: 'nope' }),
    ).toThrow(/unknown control preset: "nope"/);
  });

  it('throws when the presets map is missing entirely', () => {
    expect(() =>
      resolveCameraPreset({ preset: 'p' } as unknown as ControlsConfig),
    ).toThrow(/controls\.presets/);
  });

  it('throws when presets is null (not an object)', () => {
    expect(() =>
      resolveCameraPreset({ preset: 'p', presets: null } as unknown as ControlsConfig),
    ).toThrow(/controls\.presets/);
  });

  it('throws when presets is a scalar (not an object map)', () => {
    expect(() =>
      resolveCameraPreset({ preset: 'p', presets: 'oops' } as unknown as ControlsConfig),
    ).toThrow(/controls\.presets/);
  });

  // Each validated field: a bad value throws AND the thrown message names that exact field,
  // so a mutant blanking the field-name string literal cannot survive (agent-principles #7).
  it.each(['orbit', 'pan', 'zoom'] as const)(
    'throws naming the gesture field %s when it is not a string',
    (field) => {
      expect(() => resolveCameraPreset(withField(field, 42))).toThrow(
        new RegExp(`\\b${field}\\b`),
      );
    },
  );

  it('throws naming the gesture field when it is an empty string', () => {
    expect(() => resolveCameraPreset(withField('orbit', ''))).toThrow(/\borbit\b/);
  });

  it.each(['orbitSpeed', 'panSpeed', 'zoomSpeed'] as const)(
    'throws naming the speed field %s when it is not a finite number',
    (field) => {
      expect(() => resolveCameraPreset(withField(field, 'fast'))).toThrow(
        new RegExp(`\\b${field}\\b`),
      );
    },
  );

  it('throws for a non-finite (NaN / Infinity) speed, not merely a non-number', () => {
    // Kills the `typeof !== number || !isFinite` short-circuit: NaN/Infinity ARE numbers
    // but not finite, so only the `!Number.isFinite` arm rejects them.
    expect(() => resolveCameraPreset(withField('orbitSpeed', Number.NaN))).toThrow(/orbitSpeed/);
    expect(() => resolveCameraPreset(withField('zoomSpeed', Number.POSITIVE_INFINITY))).toThrow(
      /zoomSpeed/,
    );
  });

  it.each(['minDistance', 'maxDistance'] as const)(
    'throws naming the zoom-limit field %s when it is not a finite number',
    (field) => {
      expect(() => resolveCameraPreset(withField(field, 'near' as unknown as number))).toThrow(
        new RegExp(`\\b${field}\\b`),
      );
    },
  );

  /** Build `base` with both zoom-limit fields overridden (for clamp-order cases). */
  const withLimits = (min: number, max: number): ControlsConfig =>
    resolveInto(base, { minDistance: min, maxDistance: max });

  it('throws when zoom limits are inverted (min > max — an impossible clamp)', () => {
    expect(() => resolveCameraPreset(withLimits(40, 2))).toThrow(
      /minDistance.*maxDistance|zoom limit/i,
    );
  });

  it('throws when zoom limits are EQUAL (min === max — an empty clamp, boundary case)', () => {
    // Kills the `>=` → `>` mutant: equal limits must still throw.
    expect(() => resolveCameraPreset(withLimits(10, 10))).toThrow(
      /minDistance.*maxDistance|zoom limit/i,
    );
  });

  it.each(['invertY', 'zoomToCursor'] as const)(
    'throws naming the boolean field %s when it is not a boolean',
    (field) => {
      expect(() => resolveCameraPreset(withField(field, 'yes'))).toThrow(
        new RegExp(`\\b${field}\\b`),
      );
    },
  );

  it('accepts a valid custom preset and echoes its fields verbatim', () => {
    const resolved = resolveCameraPreset(base);
    expect(resolved).toEqual({
      name: 'p',
      orbit: 'drag',
      pan: 'shift+drag',
      zoom: 'wheel',
      orbitSpeed: 1,
      panSpeed: 1,
      zoomSpeed: 1,
      invertY: false,
      zoomToCursor: true,
      minDistance: 2,
      maxDistance: 40,
    });
  });
});
