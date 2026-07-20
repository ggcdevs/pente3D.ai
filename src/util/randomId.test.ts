/**
 * Tests for the PURE-logic {@link randomId} helper (GitHub issue #6).
 *
 * ## Why this exists — the insecure-context boot crash
 *
 * `crypto.randomUUID()` is a SECURE-CONTEXT-ONLY Web API: the browser only defines it on HTTPS
 * origins and on `localhost`. Served over plain **http** to a remote origin (the app opened on a
 * phone via the dev box's LAN IP), `crypto.randomUUID` is `undefined`, so calling it throws a
 * `TypeError` at BOOT (autosave-id + net playerId minting) and the boot crashes before the DOM UI
 * overlay mounts. `randomId()` is the fix: it returns `crypto.randomUUID()` when that API exists,
 * else derives a valid **UUID v4** from `crypto.getRandomValues` (which DOES work in insecure
 * contexts), else — both crypto paths absent — a `Math.random` fallback. It ALWAYS returns a valid
 * UUID-format string.
 *
 * The insecure-context and final-fallback tests below fault-inject by deleting the relevant `crypto`
 * members (the genuinely-unreachable-in-a-secure-test paths), then assert the RETURNED VALUE is a
 * real v4 UUID (agent-principles #2/#3: proof by the value, not a log). They FAIL if the guard that
 * routes around a missing `randomUUID` is removed — proving the gate bites (agent-principles #7).
 * No volatile fact is hardcoded (agent-principles #8): the shape is checked against the RFC-4122 v4
 * pattern, not a frozen literal.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomId } from './randomId.ts';

/** RFC-4122 v4 UUID: 8-4-4-4-12 hex, version nibble `4`, variant nibble in {8,9,a,b}. */
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('randomId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns a valid v4 UUID in a normal (secure) context', () => {
    const id = randomId();
    expect(id).toMatch(UUID_V4);
  });

  it('delegates to crypto.randomUUID when it exists', () => {
    const spy = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValue('12345678-1234-4234-8234-1234567890ab');
    const id = randomId();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(id).toBe('12345678-1234-4234-8234-1234567890ab');
  });

  it('produces distinct ids across calls', () => {
    const a = randomId();
    const b = randomId();
    expect(a).not.toBe(b);
  });

  // --- INSECURE CONTEXT (plain http to a remote origin): randomUUID is undefined -----------------
  it('still returns a valid v4 UUID via getRandomValues when randomUUID is undefined', () => {
    // Simulate an insecure context: `crypto` exists (getRandomValues works over http) but
    // `randomUUID` is absent — exactly the phone-over-LAN-http case that crashed boot (issue #6).
    const insecureCrypto = {
      getRandomValues: crypto.getRandomValues.bind(crypto),
    } as Crypto;
    vi.stubGlobal('crypto', insecureCrypto);
    expect(crypto.randomUUID).toBeUndefined();

    const id = randomId();
    expect(id).toMatch(UUID_V4);
  });

  it('produces the EXACT UUID from an all-0xff getRandomValues buffer (bit-forcing on every byte)', () => {
    // Feed getRandomValues a fully-KNOWN buffer (all 0xff) so the derived UUID is deterministic end to
    // end. Byte 6 → (0xff & 0x0f) | 0x40 = 0x4f (version '4'); byte 8 → (0xff & 0x3f) | 0x80 = 0xbf
    // (variant 'b'); every other byte stays 0xff. Asserting the WHOLE string (not just the shape) pins
    // the exact byte→hex mapping AND the two bit-force branches — a mutant that drops either force, or
    // mangles a byte, changes this literal (agent-principles #2).
    const insecureCrypto = {
      getRandomValues: (buf: Uint8Array): Uint8Array => {
        buf.fill(0xff);
        return buf;
      },
    } as unknown as Crypto;
    vi.stubGlobal('crypto', insecureCrypto);

    const id = randomId();
    expect(id).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(id).toMatch(UUID_V4);
  });

  it('produces the EXACT UUID from a DISTINCT-per-byte getRandomValues buffer', () => {
    // Byte i = i (0,1,2,…15). Byte 6 (=0x06) → (0x06 & 0x0f) | 0x40 = 0x46 ('46'); byte 8 (=0x08) →
    // (0x08 & 0x3f) | 0x80 = 0x88 ('88'); every other byte is its own index. This distinct-byte input
    // catches any mutation that transposes, drops, or mis-groups a byte (which an all-same input can't).
    const insecureCrypto = {
      getRandomValues: (buf: Uint8Array): Uint8Array => {
        for (let i = 0; i < buf.length; i++) buf[i] = i;
        return buf;
      },
    } as unknown as Crypto;
    vi.stubGlobal('crypto', insecureCrypto);

    const id = randomId();
    expect(id).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
  });

  // --- FINAL FALLBACK: neither crypto.randomUUID nor crypto.getRandomValues available ------------
  it('falls back to a valid v4 UUID via Math.random when crypto is entirely absent', () => {
    // No `crypto` global at all (getRandomValues also gone) — the deepest degradation. The Math.random
    // fallback must STILL yield a valid v4 UUID so a boot subsystem never throws (issue #6 resilience).
    vi.stubGlobal('crypto', undefined);
    expect(globalThis.crypto).toBeUndefined();

    const id = randomId();
    expect(id).toMatch(UUID_V4);
  });

  it('falls back to Math.random when crypto exists but getRandomValues is absent', () => {
    // A partial `crypto` with neither randomUUID nor getRandomValues (defensive: some locked-down
    // embeddings). Still a valid v4 UUID, never a throw.
    vi.stubGlobal('crypto', {} as Crypto);
    expect(crypto.randomUUID).toBeUndefined();

    const id = randomId();
    expect(id).toMatch(UUID_V4);
  });

  it('the Math.random fallback still forces version/variant bits', () => {
    // Pin Math.random to its extreme (→ nibble 15) so the version/variant forcing is proven on the
    // fallback path too, not just the crypto path.
    vi.stubGlobal('crypto', undefined);
    vi.spyOn(Math, 'random').mockReturnValue(0.999999999);

    const id = randomId();
    expect(id).toMatch(UUID_V4);
    expect(id[14]).toBe('4');
    expect('89ab').toContain(id[19]);
  });

  it('produces the EXACT UUID from a DISTINCT-per-byte Math.random sequence', () => {
    // Drive the 16-byte fill loop with a known sequence: the k-th call returns k/256, so
    // Math.floor((k/256) * 256) = k — byte i = i, the same distinct-byte input as the crypto case, so
    // the SAME exact UUID must fall out. Asserting the whole literal pins the loop bounds, the `* 256`
    // scale, and the `Math.floor` — a mutant to any of them (e.g. `* 256` → `* 255`, `<` → `<=`,
    // dropping `Math.floor`) shifts a byte and breaks this literal (agent-principles #2). Also proves
    // the crypto-path and fallback-path share the SAME formatter (identical output for identical bytes).
    vi.stubGlobal('crypto', undefined);
    let call = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => {
      const v = call / 256;
      call++;
      return v;
    });

    const id = randomId();
    expect(id).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
    // Exactly 16 draws — one per byte. A boundary mutant (`< 16` → `<= 16`) would draw 17.
    expect(call).toBe(16);
  });
});
