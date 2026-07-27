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

describe('resolveRelay — env over configured over fallback, field by field', () => {
  it('THE BUG: a blank committed config no longer resolves to a blank relay', () => {
    // This is the exact input every checkout has. Before the fix it produced `wssUrl: ''`, and the
    // realrelay suites skipped on a machine with working egress.
    const resolved = resolveRelay(COMMITTED_BLANK, {});
    expect(resolved.wssUrl).toBe(NODE_RELAY_FALLBACK.wssUrl);
    expect(resolved.username).toBe(NODE_RELAY_FALLBACK.username);
    expect(resolved.password).toBe(NODE_RELAY_FALLBACK.password);
    // The one field the committed default DOES carry is kept — it is not blank, so it wins.
    expect(resolved.topicRoot).toBe('pente/v1');
  });

  it('a deployed (non-blank) config beats the fallback on every field', () => {
    expect(resolveRelay(CONFIGURED, {})).toEqual(CONFIGURED);
  });

  it('the environment beats a deployed config', () => {
    const resolved = resolveRelay(CONFIGURED, {
      [RELAY_ENV_KEYS.wssUrl]: 'ws://localhost:9001',
      [RELAY_ENV_KEYS.username]: 'local',
      [RELAY_ENV_KEYS.password]: 'local-pass',
      [RELAY_ENV_KEYS.topicRoot]: 'pente/local',
    });
    expect(resolved).toEqual({
      wssUrl: 'ws://localhost:9001',
      username: 'local',
      password: 'local-pass',
      topicRoot: 'pente/local',
    });
  });

  it('resolves PER FIELD: naming only the url points a run at a local broker, creds unchanged', () => {
    const resolved = resolveRelay(CONFIGURED, { [RELAY_ENV_KEYS.wssUrl]: 'ws://localhost:9001' });
    expect(resolved.wssUrl).toBe('ws://localhost:9001');
    expect(resolved.username).toBe(CONFIGURED.username);
    expect(resolved.password).toBe(CONFIGURED.password);
  });

  it('treats a BLANK env value as unset (an exported-but-empty var must not blank the relay)', () => {
    const resolved = resolveRelay(CONFIGURED, { [RELAY_ENV_KEYS.wssUrl]: '' });
    expect(resolved.wssUrl).toBe(CONFIGURED.wssUrl);
  });

  it('an explicit fallback is honoured, so a caller can ask for "nothing configured"', () => {
    expect(resolveRelay(COMMITTED_BLANK, {}, NO_RELAY)).toEqual({ ...NO_RELAY, topicRoot: 'pente/v1' });
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
    expect(reason).toContain(RELAY_ENV_KEYS.wssUrl);
    // It must NOT blame the network — that is the mislabeled diagnostic this replaces.
    expect(reason).not.toContain('did not accept a connection');
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
