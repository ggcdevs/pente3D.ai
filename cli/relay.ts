/**
 * Relay config for the CLI.
 *
 * The resolution itself lives in `src/config/relayEnv.ts` and is shared with the `*.realrelay.test.ts`
 * suites: env var → tracked `relay.json` → the live deployed relay. This file used to hold its own
 * copy of the endpoint/creds, which meant the CLI talked to the real broker while the vitest suites
 * one directory over resolved the committed blanks and skipped. One answer now, so `pente` and
 * `npm test` cannot mean different brokers.
 *
 * Override any field with `PENTE_WSS_URL` / `PENTE_USERNAME` / `PENTE_PASSWORD` / `PENTE_TOPIC_ROOT`.
 */
import relayDefault from '../src/config/defaults/relay.json' with { type: 'json' };
import { hostEnv, resolveRelay } from '../src/config/relayEnv';
import type { RelayConfig } from '../src/config/config';

/**
 * The tracked `relay.json` is read DIRECTLY rather than through `getConfig`: the config store's only
 * job beyond the default is to merge a `localStorage` override, which no node process has — and
 * pulling `src/config/config.ts` in drags its whole bundle of `*.json` imports into every runtime
 * that loads the CLI (Playwright's plain-node ESM loader rejects them without import attributes,
 * which is what stopped `e2e/cliVsBrowser.spec.ts` from driving a real daemon).
 */
export function relayConfig(): RelayConfig {
  return resolveRelay(relayDefault as RelayConfig, hostEnv());
}

/** Board edge length (5 ⇒ 5×5×5), matching src/config/defaults/board.json. */
export const BOARD_SIZE = Number(hostEnv()['PENTE_BOARD_SIZE'] ?? 5);
