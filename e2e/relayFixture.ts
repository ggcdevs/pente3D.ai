/**
 * ONE broker for every live-relay Playwright spec — resolved the same way the node tiers resolve it.
 *
 * ## The tier this stops being dark
 *
 * `src/config/defaults/relay.json` ships **blank** in every checkout (the deploy writes the real
 * endpoint from the `RELAY_CONFIG` repo variable at build time). A spec that read that file directly
 * therefore probed `wssUrl: ''`, found nothing to dial, and SKIPPED — in every checkout, forever, on
 * machines with proven egress. `src/config/relayEnv.ts` was built to answer "which broker does a node
 * process mean", and this module is how the Playwright tier asks it, so a live-relay spec cannot
 * quietly resolve a different (or empty) broker from its neighbours.
 *
 * Observed before this existed, on a machine reaching the broker fine:
 *
 *     [sessionModelRelay.spec] SKIPPING: live relay (empty relay.json — no creds) unreachable …
 *     [networked.spec] SKIPPING: live relay  unreachable …
 *     10 skipped
 *
 * Among those: "A enters, B enters → DISTINCT seats … [#31 regression]" and the #40 rematch/reconnect
 * regression — the browser-side halves of proofs the build plan leans on.
 *
 * ## Two halves, both required
 *
 * 1. **Node side** — {@link RELAY} / {@link probeRelay} decide whether the suite can run at all, and
 *    {@link relaySkipReason} says WHY it could not in the two distinguishable ways (nothing
 *    configured vs. the broker refused us).
 * 2. **Browser side** — {@link injectRelay} writes the resolved record into the page as the app's
 *    `pente:config:relay` override BEFORE boot. Resolving node-side alone is not enough: the page has
 *    its own config layer, and without the override it would read the same committed blanks and dial
 *    nothing while the node-side probe reported the broker reachable.
 *
 * The invariant that keeps this the only answer is machine-checked, not documented:
 * `tools/e2eRelayFixture.test.mjs` fails if any `e2e/*.spec.ts` imports `relay.json` directly, or
 * dials a broker without going through this module.
 */
import type { Page } from '@playwright/test';
import mqtt from 'mqtt';
import relayJson from '../src/config/defaults/relay.json' with { type: 'json' };
import { hostEnv, relaySkipReason, resolveRelay } from '../src/config/relayEnv';
import type { RelayConfig } from '../src/config/config';

export { relaySkipReason };

/** The broker every live-relay spec means: env → tracked `relay.json` → the live deployed relay. */
export const RELAY: RelayConfig = resolveRelay(relayJson as RelayConfig, hostEnv());

/** How long to wait for a CONNACK before calling the broker unreachable. */
export const CONNECT_PROBE_MS = 10_000;

/**
 * Probe the broker once: `true` if it accepted a connection, else the failure AS OBSERVED (the
 * probe's own error text, not a guess about what went wrong). Feed the result to
 * {@link relaySkipReason} for the message a skipping suite should print.
 */
export function probeRelay(timeoutMs = CONNECT_PROBE_MS): Promise<true | string> {
  return new Promise<true | string>((res) => {
    if (RELAY.wssUrl.length === 0) return res('no relay url to dial');
    const client = mqtt.connect(RELAY.wssUrl, {
      username: RELAY.username,
      password: RELAY.password,
      clientId: `e2e-probe-${Math.random().toString(36).slice(2, 10)}`,
      connectTimeout: timeoutMs,
      reconnectPeriod: 0,
    });
    let settled = false;
    const done = (r: true | string): void => {
      if (settled) return;
      settled = true;
      client.end(true);
      res(r);
    };
    client.on('connect', () => done(true));
    client.on('error', (e: Error) => done(e.message));
    setTimeout(() => done(`no CONNACK within ${timeoutMs}ms`), timeoutMs);
  });
}

/**
 * Point THIS PAGE's app at {@link RELAY}, before it boots.
 *
 * Registered as an init script, so it must be called AFTER any `localStorage.clear()` init script the
 * spec already registers — Playwright runs them in registration order, and a later clear would wipe
 * the override.
 */
export async function injectRelay(page: Page): Promise<void> {
  await page.addInitScript((relay: RelayConfig) => {
    window.localStorage.setItem('pente:config:relay', JSON.stringify(relay));
  }, RELAY);
}
