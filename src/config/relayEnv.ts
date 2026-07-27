/**
 * How a NODE process resolves which relay to talk to — the one place that answers it.
 *
 * ## Why this exists
 *
 * `src/config/defaults/relay.json` is the browser's SSOT for the relay, and it ships **blank** in
 * every checkout: the deploy workflow writes the real endpoint/creds into it from the `RELAY_CONFIG`
 * repo variable at build time. That is right for the browser and wrong for everything that runs in
 * node, because node has no `localStorage` to carry an override — so `getConfig('relay')` there
 * resolves the committed blanks and every live-relay suite skips, in every checkout, forever.
 *
 * That is not theoretical: the two `*.realrelay.test.ts` suites were dark on machines WITH working
 * egress (seven live-relay assertions silently unavailable), while `cli/relay.ts` sat one directory
 * over with the working values hardcoded. Two answers to one question, and the wrong one won wherever
 * it was asked. This module is the single answer both sides now call, so the CLI and the vitest
 * suites cannot disagree about which broker they mean.
 *
 * ## Purity
 *
 * Every function here is pure: the environment is an ARGUMENT ({@link hostEnv} is the only thing that
 * looks at a global, and even that takes the scope as a parameter). Nothing imports `process`, so this
 * file type-checks and bundles under the browser tsconfig exactly like the rest of `src/config`.
 */

import type { RelayConfig } from './config';

/** A process environment: names to values, values possibly absent. */
export type EnvRecord = Readonly<Record<string, string | undefined>>;

/**
 * The environment variable that names each relay field. Reading one of these is how an operator
 * points a node run at a DIFFERENT broker (a local Mosquitto, a staging relay) without editing
 * tracked files.
 */
export const RELAY_ENV_KEYS: Readonly<Record<keyof RelayConfig, string>> = {
  wssUrl: 'PENTE_WSS_URL',
  username: 'PENTE_USERNAME',
  password: 'PENTE_PASSWORD',
  topicRoot: 'PENTE_TOPIC_ROOT',
};

/**
 * The LIVE deployed relay — the same broker/topic-root the GitHub Pages build bakes into
 * `relay.json` from the `RELAY_CONFIG` repo variable, and the same values the CLI has always
 * shipped. It is the last resort, used only when neither the environment nor the tracked config
 * names a broker.
 *
 * These are the room-rendezvous credentials of a publicly-writable hobby relay, already public in
 * this repo's deployed bundle; they authenticate nothing about a player and guard nothing but the
 * broker itself. Point a run somewhere else with the `PENTE_*` variables above.
 */
export const NODE_RELAY_FALLBACK: RelayConfig = {
  wssUrl: 'wss://api.shitchell.com/289d700bfbd3-mqtt',
  username: 'pente',
  password: '01cdb6fbbccb8a5d149027a14e37ef7bec9f76a66f7f1e58',
  topicRoot: 'pente/v1',
};

/** A relay config that names no broker at all — the "nothing is configured" value. */
export const NO_RELAY: RelayConfig = { wssUrl: '', username: '', password: '', topicRoot: '' };

/** Blank counts as ABSENT everywhere here: a committed `""` names no broker and no credential. */
function present(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

/**
 * The host process's environment, or an empty record when there is no `process` (a browser, a
 * worker). The scope is a parameter so this is testable without touching the real environment —
 * and so nothing in `src/` has to reference the `process` global directly.
 */
export function hostEnv(scope: object = globalThis): EnvRecord {
  return (scope as { process?: { env?: EnvRecord } }).process?.env ?? {};
}

/**
 * Resolve the relay a node process should use, FIELD BY FIELD: an explicit environment variable
 * wins, then whatever the tracked config carries, then `fallback`.
 *
 * Per-field rather than all-or-nothing on purpose — `PENTE_WSS_URL=ws://localhost:9001` alone must
 * be enough to point a run at a local broker without re-stating credentials that did not change.
 */
export function resolveRelay(
  configured: RelayConfig,
  env: EnvRecord,
  fallback: RelayConfig = NODE_RELAY_FALLBACK,
): RelayConfig {
  const pick = (field: keyof RelayConfig): string =>
    present(env[RELAY_ENV_KEYS[field]]) ?? present(configured[field]) ?? fallback[field];
  return {
    wssUrl: pick('wssUrl'),
    username: pick('username'),
    password: pick('password'),
    topicRoot: pick('topicRoot'),
  };
}

/**
 * The honest, DIFFERENTIATED reason a live-relay suite did not run — or `null` when it did.
 *
 * One message for two causes is a mislabeled diagnostic (agent-principles, logging discipline): "run
 * again with network egress" sent people chasing a firewall when the truth was that the resolved
 * config named no broker to reach. The two are now distinguishable at a glance, and the second one
 * quotes the probe's OWN error rather than a guess about what went wrong.
 *
 * @param probe `true` if the broker accepted a connection, else the failure as the probe observed it.
 */
export function relaySkipReason(cfg: RelayConfig, probe: true | string): string | null {
  if (probe === true) return null;
  if (present(cfg.wssUrl) === undefined) {
    return (
      'no relay is configured: wssUrl resolved EMPTY — nothing was contacted. ' +
      `src/config/defaults/relay.json ships blank (the deploy writes it) and ${RELAY_ENV_KEYS.wssUrl} ` +
      'is not set. Export the PENTE_* variables to name a broker.'
    );
  }
  return `the relay at ${cfg.wssUrl} did not accept a connection: ${probe}`;
}
