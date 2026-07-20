/**
 * A collision-resistant random id (UUID v4) that WORKS IN AN INSECURE CONTEXT (GitHub issue #6).
 *
 * ## Why this exists — the plain-http boot crash
 *
 * `crypto.randomUUID()` is a **secure-context-only** Web API. The browser exposes it only on HTTPS
 * origins and on `localhost`; served over plain **http** to a remote origin — the app opened on a
 * phone via the dev box's LAN IP — `crypto.randomUUID` is `undefined`. It was called at BOOT to mint
 * the autosave id (`main.ts`) and the net playerId (`net/appSession.ts`), so over LAN http it threw a
 * `TypeError` during init and crashed the boot before the DOM UI overlay mounted (the Three.js scene
 * came up on a separate path, so the board rendered but no menu / status / net widgets did).
 *
 * `randomId()` is the drop-in replacement. It degrades gracefully through progressively-weaker
 * sources, ALWAYS returning a valid RFC-4122 v4 UUID string:
 *
 *   1. `crypto.randomUUID()` — the native path, when the secure-context API is present.
 *   2. `crypto.getRandomValues()` — cryptographic randomness that IS available over plain http;
 *      16 random bytes with the version/variant nibbles forced, formatted as a v4 UUID.
 *   3. `Math.random()` — the final fallback when no `crypto` (or no `getRandomValues`) exists at all,
 *      so a boot subsystem never throws. Not cryptographically strong, but a valid, distinct id.
 *
 * ## Placement
 *
 * NOT in `src/core` (which stays pure — no DOM/net/browser globals; the eslint boundary rule enforces
 * it). This helper reads the `crypto` browser global, so it lives under `src/util`. It is otherwise
 * pure, deterministic-given-its-source logic and carries the strict pure-logic gate (unit + mutation +
 * 100% coverage), including fault-injected tests that delete the `crypto` members to exercise the
 * insecure-context and final-fallback branches.
 */

/**
 * Format 16 raw bytes as an RFC-4122 v4 UUID, forcing the version nibble to `4` and the variant
 * nibble into {8,9,a,b}. Shared by the `getRandomValues` and `Math.random` paths so both emit an
 * identically-valid v4 string.
 */
function formatV4(bytes: Uint8Array): string {
  // Version: high nibble of byte 6 → 4. Variant: high two bits of byte 8 → 10. Iterating the typed
  // array (rather than index access) yields a plain `number`, avoiding a `?? 0` fallback branch that
  // could never be taken on a fixed-length buffer (which would leave an uncoverable branch).
  let hex = '';
  let i = 0;
  for (const raw of bytes) {
    let b = raw;
    if (i === 6) b = (b & 0x0f) | 0x40;
    else if (i === 8) b = (b & 0x3f) | 0x80;
    hex += b.toString(16).padStart(2, '0');
    i++;
  }
  // 8-4-4-4-12 grouping.
  return (
    hex.slice(0, 8) +
    '-' +
    hex.slice(8, 12) +
    '-' +
    hex.slice(12, 16) +
    '-' +
    hex.slice(16, 20) +
    '-' +
    hex.slice(20, 32)
  );
}

/**
 * Return a fresh UUID v4 string, working in secure AND insecure contexts (see file header).
 * Prefers the native `crypto.randomUUID`, then `crypto.getRandomValues`, then `Math.random`.
 */
export function randomId(): string {
  const c: Crypto | undefined = globalThis.crypto;
  // 1. Native secure-context API.
  if (typeof c?.randomUUID === 'function') {
    return c.randomUUID();
  }
  // 2. Cryptographic randomness that DOES work over plain http (the issue #6 fix).
  if (typeof c?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    return formatV4(bytes);
  }
  // 3. Final fallback: no crypto at all. Not cryptographically strong, but a valid, distinct id so a
  //    boot subsystem never throws.
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return formatV4(bytes);
}
