/**
 * The regression test for a whole test TIER that was dark.
 *
 * `src/net/sync.realrelay.test.ts` and `src/net/presence.realrelay.test.ts` hold seven live-relay
 * assertions. They were skipping in every checkout — not because the broker was unreachable (it was
 * reachable) but because `getConfig('relay')` resolves the committed-blank `relay.json` in node,
 * where no `localStorage` override can exist. Worse, the skip line blamed the network
 * ("run again with network egress"), which is a mislabeled diagnostic: it sent readers after a
 * firewall that was not there.
 *
 * These tests pin BOTH halves of the fix — the per-field resolution that makes the suites runnable,
 * and the skip message actually distinguishing "no broker configured" from "the broker refused us".
 */
import { describe, expect, it } from 'vitest';
import {
  NODE_RELAY_FALLBACK,
  NO_RELAY,
  RELAY_ENV_KEYS,
  hostEnv,
  relaySkipReason,
  resolveRelay,
} from './relayEnv';
import type { RelayConfig } from './config';

/** The committed default, verbatim — blank endpoint/creds, only the topic root filled in. */
const COMMITTED_BLANK: RelayConfig = {
  wssUrl: '',
  username: '',
  password: '',
  topicRoot: 'pente/v1',
};

const CONFIGURED: RelayConfig = {
  wssUrl: 'wss://deployed.example/mqtt',
  username: 'deployed-user',
  password: 'deployed-pass',
  topicRoot: 'pente/deployed',
};

/**
 * The environment-variable NAMES, written out. Every other case below spells its env keys through
 * `RELAY_ENV_KEYS`, which keeps those cases readable but leaves the names themselves unpinned — feed
 * the map into the input and read it back out of the input and any rename is invisible. `PENTE_WSS_URL`
 * and friends are a documented operator interface (`cli/README.md`, the skip message), so they are
 * asserted here as literals, once, and the rest of the file may keep using the map.
 */
describe('RELAY_ENV_KEYS — the operator-facing variable names are part of the contract', () => {
  it('names each field with its documented PENTE_* variable', () => {
    expect(RELAY_ENV_KEYS).toEqual({
      wssUrl: 'PENTE_WSS_URL',
      username: 'PENTE_USERNAME',
      password: 'PENTE_PASSWORD',
      topicRoot: 'PENTE_TOPIC_ROOT',
    });
  });
});

describe('NODE_RELAY_FALLBACK — the last resort must actually NAME a broker', () => {
  /**
   * THE REGRESSION THAT HID BEHIND A TAUTOLOGY. The whole point of this module is that a node process
   * finds a usable broker with nothing exported and a blank `relay.json`. Asserting the resolved value
   * against `NODE_RELAY_FALLBACK` — the constant the implementation reads — holds for ANY fallback,
   * including an empty one, so it could not detect a blanked fallback at all. Blank the four fields in
   * `relayEnv.ts` and the entire live tier (`*.realrelay.test.ts`, `e2e/cliVsBrowser.spec.ts`) silently
   * skips again on a machine with proven egress. These assert the SHAPE the tier needs, from literals.
   */
  it('carries a dialable wss endpoint, not a blank', () => {
    expect(NODE_RELAY_FALLBACK.wssUrl).toMatch(/^wss:\/\/[^/]+\/.+/);
  });

  it('carries non-empty credentials and a topic root', () => {
    expect(NODE_RELAY_FALLBACK.username.length).toBeGreaterThan(0);
    expect(NODE_RELAY_FALLBACK.password.length).toBeGreaterThan(0);
    expect(NODE_RELAY_FALLBACK.topicRoot).toBe('pente/v1');
  });
});

describe('NO_RELAY — the explicit "nothing is configured" value', () => {
  it('is blank on every field (it is the value that MUST make a suite skip)', () => {
    expect(NO_RELAY).toEqual({ wssUrl: '', username: '', password: '', topicRoot: '' });
  });
});

describe('resolveRelay — env over configured over fallback, field by field', () => {
  it('THE BUG: a blank committed config resolves to a DIALABLE relay, and the tier runs', () => {
    // This is the exact input every checkout has. Before the fix it produced `wssUrl: ''`, and the
    // realrelay suites skipped on a machine with working egress.
    const resolved = resolveRelay(COMMITTED_BLANK, {});
    // Asserted against the shape a live-relay suite needs, NOT against the constant the implementation
    // reads: `toBe(NODE_RELAY_FALLBACK.wssUrl)` is true even when the fallback is `''`, which is the
    // defect itself.
    expect(resolved.wssUrl).toMatch(/^wss:\/\/[^/]+\/.+/);
    expect(resolved.username.length).toBeGreaterThan(0);
    expect(resolved.password.length).toBeGreaterThan(0);
    // The one field the committed default DOES carry is kept — it is not blank, so it wins.
    expect(resolved.topicRoot).toBe('pente/v1');
    // …and the consequence that actually matters: the live tier does not report "nothing to dial".
    expect(relaySkipReason(resolved, 'no CONNACK within 10000ms')).not.toContain(
      'no relay is configured',
    );
  });

  it('a deployed (non-blank) config beats the fallback on every field', () => {
    expect(resolveRelay(CONFIGURED, {})).toEqual({
      wssUrl: 'wss://deployed.example/mqtt',
      username: 'deployed-user',
      password: 'deployed-pass',
      topicRoot: 'pente/deployed',
    });
  });

  it('the environment beats a deployed config', () => {
    // Spelled with the LITERAL variable names, so this case also proves the names an operator types
    // are the names the resolver reads (the map is pinned to these literals above).
    const resolved = resolveRelay(CONFIGURED, {
      PENTE_WSS_URL: 'ws://localhost:9001',
      PENTE_USERNAME: 'local',
      PENTE_PASSWORD: 'local-pass',
      PENTE_TOPIC_ROOT: 'pente/local',
    });
    expect(resolved).toEqual({
      wssUrl: 'ws://localhost:9001',
      username: 'local',
      password: 'local-pass',
      topicRoot: 'pente/local',
    });
  });

  it('resolves PER FIELD: naming only the url points a run at a local broker, creds unchanged', () => {
    const resolved = resolveRelay(CONFIGURED, { PENTE_WSS_URL: 'ws://localhost:9001' });
    expect(resolved.wssUrl).toBe('ws://localhost:9001');
    expect(resolved.username).toBe('deployed-user');
    expect(resolved.password).toBe('deployed-pass');
  });

  it('treats a BLANK env value as unset (an exported-but-empty var must not blank the relay)', () => {
    const resolved = resolveRelay(CONFIGURED, { PENTE_WSS_URL: '' });
    expect(resolved.wssUrl).toBe('wss://deployed.example/mqtt');
  });

  it('an explicit fallback is honoured, so a caller can ask for "nothing configured"', () => {
    // Literal, not `{ ...NO_RELAY }`: spreading the constant the caller passed in asserts nothing
    // about what the resolver did with it.
    expect(resolveRelay(COMMITTED_BLANK, {}, NO_RELAY)).toEqual({
      wssUrl: '',
      username: '',
      password: '',
      topicRoot: 'pente/v1',
    });
  });

  it('and THAT is the config that must make a suite skip — the honest negative', () => {
    const nothing = resolveRelay(COMMITTED_BLANK, {}, NO_RELAY);
    expect(relaySkipReason(nothing, 'no CONNACK within 10000ms')).toContain(
      'no relay is configured',
    );
  });
});

describe('hostEnv — the environment, without any src/ file touching `process`', () => {
  it('reads process.env off the given scope', () => {
    expect(hostEnv({ process: { env: { PENTE_WSS_URL: 'ws://scoped' } } })).toEqual({
      PENTE_WSS_URL: 'ws://scoped',
    });
  });

  it('is EMPTY where there is no process (a browser) — never throws', () => {
    expect(hostEnv({})).toEqual({});
  });

  it('is EMPTY where process carries no env', () => {
    expect(hostEnv({ process: {} })).toEqual({});
  });

  it('defaults to the real host environment', () => {
    // Set by vitest itself for every worker, so this asserts a real read rather than a stub.
    expect(hostEnv()['VITEST']).toBeDefined();
  });
});

describe('relaySkipReason — the two causes are NOT one message', () => {
  it('is null when the broker answered (there is no skip to explain)', () => {
    expect(relaySkipReason(NODE_RELAY_FALLBACK, true)).toBeNull();
  });

  it('says NO BROKER WAS CONTACTED when the resolved url is empty', () => {
    const reason = relaySkipReason(NO_RELAY, 'no CONNACK within 10000ms');
    expect(reason).toContain('no relay is configured');
    expect(reason).toContain('nothing was contacted');
    expect(reason).toContain('PENTE_WSS_URL');
    // It must NOT blame the network — that is the mislabeled diagnostic this replaces.
    expect(reason).not.toContain('did not accept a connection');
    // …and it must say what to DO about it. A diagnostic that names a cause without an action is
    // half a diagnostic: the whole reason this message exists is that "run again with network
    // egress" sent readers after a firewall that was not there.
    expect(reason).toContain('Export the PENTE_* variables to name a broker.');
  });

  it('names the url AND quotes the probe error when a real broker refused us', () => {
    const reason = relaySkipReason(CONFIGURED, 'Connection refused: Not authorized');
    expect(reason).toBe(
      'the relay at wss://deployed.example/mqtt did not accept a connection: Connection refused: Not authorized',
    );
  });

  it('distinguishes the two: the messages share no wording', () => {
    const unconfigured = relaySkipReason(NO_RELAY, 'boom');
    const refused = relaySkipReason(CONFIGURED, 'boom');
    expect(unconfigured).not.toBe(refused);
  });
});
