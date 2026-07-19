import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { hashStep } from './hash';

/**
 * `hashStep(prevHash, entryData)` is the single hash-chain step:
 * `H(prevHash + entryData)`. It must be a pure, deterministic, stable string
 * function so identical histories fingerprint identically across runs, machines,
 * and reloads (game-core design, Part 3; GLOSSARY "Hash chain").
 */
describe('hashStep', () => {
  it('is deterministic — same inputs give the same output', () => {
    expect(hashStep('', 'a')).toBe(hashStep('', 'a'));
    expect(hashStep('seed', 'payload')).toBe(hashStep('seed', 'payload'));
  });

  it('returns a non-empty string', () => {
    expect(hashStep('', 'a')).toBeTypeOf('string');
    expect(hashStep('', 'a').length).toBeGreaterThan(0);
  });

  it('changes when the previous hash changes', () => {
    expect(hashStep('x', 'same')).not.toBe(hashStep('y', 'same'));
  });

  it('changes when the entry data changes', () => {
    expect(hashStep('seed', 'a')).not.toBe(hashStep('seed', 'b'));
  });

  it('is order-sensitive: H(prev+data) distinguishes boundary shifts', () => {
    // "ab"+"c" must not collide with "a"+"bc" — the concatenation is delimited.
    expect(hashStep('ab', 'c')).not.toBe(hashStep('a', 'bc'));
  });

  it('emits a fixed 8-char zero-padded lowercase hex digest', () => {
    // The chain contract is a fixed-width, deterministic digest. Pin a value whose
    // raw hash has a leading zero so the zero-padding is load-bearing: without
    // padStart(8, '0') this would be 7 chars and the assertion fails.
    const h = hashStep('s', '420');
    expect(h).toBe('08603254');
    expect(h).toHaveLength(8);
    expect(h).toMatch(/^[0-9a-f]{8}$/);
  });

  it('property: deterministic for any two strings', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (prev, data) => {
        expect(hashStep(prev, data)).toBe(hashStep(prev, data));
      }),
    );
  });
});
