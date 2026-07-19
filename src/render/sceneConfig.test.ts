/**
 * Tests for the PURE scene-config resolver (Task 4.1).
 *
 * `resolveSceneConfig` turns the tracked `lighting` + `colors` config sections into a
 * plain-number descriptor the Three.js glue consumes: hex color strings (`"#ffffff"`)
 * become 24-bit integers (`0xffffff`), intensities/positions pass through as numbers.
 * This is the pure boundary — no THREE, no DOM — so it is unit- + mutation-tested with
 * genuine assertions on observed return values (agent-principles #2/#3), including
 * negative cases: malformed hex, out-of-range, non-string input each throw.
 */

import { describe, expect, it } from 'vitest';
import { hexToInt, resolveSceneConfig } from './sceneConfig.ts';

describe('hexToInt', () => {
  it('parses a 6-digit hex color to its integer value', () => {
    expect(hexToInt('#ffffff')).toBe(0xffffff);
    expect(hexToInt('#000000')).toBe(0x000000);
    expect(hexToInt('#101014')).toBe(0x101014);
    expect(hexToInt('#3a6ea5')).toBe(0x3a6ea5);
  });

  it('is case-insensitive on the hex digits', () => {
    expect(hexToInt('#ABCDEF')).toBe(0xabcdef);
    expect(hexToInt('#AbCdEf')).toBe(0xabcdef);
  });

  it('throws on a missing leading hash', () => {
    expect(() => hexToInt('ffffff')).toThrow(/hex color/i);
  });

  it('throws on the wrong digit count (3-digit shorthand not supported)', () => {
    expect(() => hexToInt('#fff')).toThrow(/hex color/i);
    expect(() => hexToInt('#fffffff')).toThrow(/hex color/i);
  });

  it('throws on a non-hex character', () => {
    expect(() => hexToInt('#gggggg')).toThrow(/hex color/i);
    expect(() => hexToInt('#12345z')).toThrow(/hex color/i);
  });

  it('throws on a non-string input', () => {
    expect(() => hexToInt(0xffffff as unknown as string)).toThrow(/hex color/i);
    expect(() => hexToInt(null as unknown as string)).toThrow(/hex color/i);
  });

  it('rejects a non-string even when it stringifies to a valid hex (typeof guard, not regex coercion)', () => {
    // An object whose toString() is a valid hex would slip past a regex-only check
    // (regex coerces its argument). The explicit `typeof !== 'string'` guard must
    // reject it — this kills the mutant that drops that guard.
    const coercible = { toString: () => '#ffffff' } as unknown as string;
    expect(() => hexToInt(coercible)).toThrow(/hex color/i);
  });

  it('anchors the pattern: junk before a valid hex is rejected (leading ^ anchor)', () => {
    // Without the `^` anchor, `x#ffffff` would match the trailing `#ffffff`. The
    // anchored pattern must reject any leading characters.
    expect(() => hexToInt('x#ffffff')).toThrow(/hex color/i);
    expect(() => hexToInt('  #ffffff')).toThrow(/hex color/i);
  });
});

describe('resolveSceneConfig', () => {
  const lighting = {
    ambient: { color: '#ffffff', intensity: 0.6 },
    directional: {
      color: '#eeddcc',
      intensity: 0.8,
      position: { x: 5, y: 10, z: 7 },
    },
  };
  const colors = { background: '#101014' } as const;

  it('resolves the background color to an integer', () => {
    const r = resolveSceneConfig(lighting, colors);
    expect(r.background).toBe(0x101014);
  });

  it('resolves the ambient light color and intensity', () => {
    const r = resolveSceneConfig(lighting, colors);
    expect(r.ambient.color).toBe(0xffffff);
    expect(r.ambient.intensity).toBe(0.6);
  });

  it('resolves the directional light color, intensity, and position', () => {
    const r = resolveSceneConfig(lighting, colors);
    expect(r.directional.color).toBe(0xeeddcc);
    expect(r.directional.intensity).toBe(0.8);
    expect(r.directional.position).toEqual({ x: 5, y: 10, z: 7 });
  });

  it('passes through distinct intensities (does not conflate ambient and directional)', () => {
    const r = resolveSceneConfig(
      {
        ambient: { color: '#111111', intensity: 0.25 },
        directional: { color: '#222222', intensity: 0.9, position: { x: 1, y: 2, z: 3 } },
      },
      { background: '#000000' },
    );
    expect(r.ambient.intensity).toBe(0.25);
    expect(r.directional.intensity).toBe(0.9);
    expect(r.ambient.color).toBe(0x111111);
    expect(r.directional.color).toBe(0x222222);
    expect(r.directional.position).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('throws, naming the ambient intensity, when it is NaN or non-numeric', () => {
    expect(() =>
      resolveSceneConfig(
        { ...lighting, ambient: { color: '#ffffff', intensity: Number.NaN } },
        colors,
      ),
    ).toThrow(/invalid ambient intensity/i);
    expect(() =>
      resolveSceneConfig(
        { ...lighting, ambient: { color: '#ffffff', intensity: 'bright' as unknown as number } },
        colors,
      ),
    ).toThrow(/invalid ambient intensity/i);
  });

  it('throws, naming the directional intensity specifically, when it is not finite', () => {
    expect(() =>
      resolveSceneConfig(
        {
          ...lighting,
          directional: {
            color: '#ffffff',
            intensity: Number.POSITIVE_INFINITY,
            position: { x: 5, y: 10, z: 7 },
          },
        },
        colors,
      ),
    ).toThrow(/invalid directional intensity/i);
  });

  it('throws, naming the exact directional position component, when it is not finite', () => {
    expect(() =>
      resolveSceneConfig(
        {
          ...lighting,
          directional: {
            color: '#ffffff',
            intensity: 0.8,
            position: { x: 5, y: Number.POSITIVE_INFINITY, z: 7 },
          },
        },
        colors,
      ),
    ).toThrow(/invalid directional position\.y/i);
    // The x component names its own label (distinct from y/z).
    expect(() =>
      resolveSceneConfig(
        {
          ...lighting,
          directional: {
            color: '#ffffff',
            intensity: 0.8,
            position: { x: Number.NaN, y: 10, z: 7 },
          },
        },
        colors,
      ),
    ).toThrow(/invalid directional position\.x/i);
    // A different component names a different label (x vs z distinguishable).
    expect(() =>
      resolveSceneConfig(
        {
          ...lighting,
          directional: {
            color: '#ffffff',
            intensity: 0.8,
            position: { x: 5, y: 10, z: Number.NaN },
          },
        },
        colors,
      ),
    ).toThrow(/invalid directional position\.z/i);
  });

  it('throws when a color is malformed (propagates hexToInt failure)', () => {
    expect(() =>
      resolveSceneConfig({ ...lighting, ambient: { color: 'nope', intensity: 0.6 } }, colors),
    ).toThrow(/hex color/i);
  });
});
