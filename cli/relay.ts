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
import boardDefault from '../src/config/defaults/board.json' with { type: 'json' };
import { hostEnv, resolveRelay, type EnvRecord } from '../src/config/relayEnv';
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

/** The environment variable that overrides the tracked board size for a node run. */
export const BOARD_SIZE_ENV_KEY = 'PENTE_BOARD_SIZE';

/**
 * The board edge length a CLI daemon plays on (5 ⇒ 5×5×5): `PENTE_BOARD_SIZE`, else the tracked
 * default — which is READ from `src/config/defaults/board.json`, the same file `src/config/config.ts`
 * imports, rather than re-stated as a literal here. A copy of the number would let the two halves of
 * one product disagree in silence, and the CLI is the measuring instrument `npm run scenario:all`
 * and `e2e/cliVsBrowser.spec.ts` grade the browser against.
 *
 * Garbage THROWS rather than resolving. `Number(env ?? 5)` accepted everything: `PENTE_BOARD_SIZE=abc`
 * gave `NaN` and `PENTE_BOARD_SIZE=` gave `0`, so a daemon started playing on a NaN- or 0-edged board
 * and every coordinate check, every render and every scenario assertion past that point was
 * meaningless while the run reported green. Refusing at the boundary is the only place the operator
 * can still be told which variable is wrong.
 */
export function boardSize(env: EnvRecord): number {
  const raw = env[BOARD_SIZE_ENV_KEY];
  if (raw === undefined) return boardDefault.size;
  if (!/^[0-9]+$/.test(raw) || Number(raw) === 0) {
    throw new Error(
      `${BOARD_SIZE_ENV_KEY}: not a positive whole number of cells (got "${raw}") — ` +
        `unset it to play on the tracked default of ${boardDefault.size}`,
    );
  }
  return Number(raw);
}

/** Board edge length for THIS process, resolved once at load — see {@link boardSize}. */
export const BOARD_SIZE = boardSize(hostEnv());
