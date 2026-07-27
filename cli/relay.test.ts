/**
 * WHICH BROKER A NODE RUN MEANS.
 *
 * `cli/relay.ts` used to hold its own hardcoded copy of the endpoint and credentials. That made two
 * answers to one question: the CLI talked to the real broker while the `*.realrelay.test.ts` suites
 * one directory over resolved the blanks that `src/config/defaults/relay.json` ships in every
 * checkout and skipped — live assertions dark on machines with working egress, and nothing saying so.
 * One answer now lives in `src/config/relayEnv.ts`, and this file is the CLI's call into it.
 *
 * These tests therefore assert the two things that can silently go wrong again: that a checkout with
 * NO environment still names a reachable broker (the blank-`relay.json` trap), and that every
 * `PENTE_*` variable actually redirects the field it names (the "point a run at a local Mosquitto"
 * escape hatch). The environment is stubbed per test, so no assertion depends on the machine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { relayConfig } from './relay';
import { NODE_RELAY_FALLBACK, RELAY_ENV_KEYS } from '../src/config/relayEnv';
import relayDefault from '../src/config/defaults/relay.json' with { type: 'json' };

/** Every variable that can steer a node run — cleared so a developer's shell cannot skew a result. */
const STEERING_VARS = [...Object.values(RELAY_ENV_KEYS), 'PENTE_BOARD_SIZE'];

beforeEach(() => {
  for (const name of STEERING_VARS) vi.stubEnv(name, undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('relayConfig — the one answer the CLI and the vitest suites share', () => {
  it('names a broker even though the tracked relay.json ships blank (THE BUG)', () => {
    // The trap: `relay.json` is written by the deploy, so in a checkout it is `""` — and an empty
    // wssUrl means "nothing was contacted", which is how seven live assertions went dark.
    expect(relayDefault.wssUrl).toBe('');
    expect(relayConfig().wssUrl).toBe(NODE_RELAY_FALLBACK.wssUrl);
    expect(relayConfig().wssUrl).not.toBe('');
  });

  it('prefers the TRACKED value over the fallback where the tracked file names one', () => {
    expect(relayDefault.topicRoot).toBe('pente/v1');
    expect(relayConfig().topicRoot).toBe('pente/v1');
  });

  it('lets each PENTE_* variable redirect its own field, leaving the others alone', () => {
    const before = relayConfig();
    vi.stubEnv(RELAY_ENV_KEYS.wssUrl, 'ws://localhost:9001');
    expect(relayConfig()).toEqual({ ...before, wssUrl: 'ws://localhost:9001' });
  });

  it('honours every field of the environment contract, not just the URL', () => {
    vi.stubEnv(RELAY_ENV_KEYS.wssUrl, 'ws://relay.test:1883');
    vi.stubEnv(RELAY_ENV_KEYS.username, 'u');
    vi.stubEnv(RELAY_ENV_KEYS.password, 'p');
    vi.stubEnv(RELAY_ENV_KEYS.topicRoot, 'pente/scratch');
    expect(relayConfig()).toEqual({
      wssUrl: 'ws://relay.test:1883',
      username: 'u',
      password: 'p',
      topicRoot: 'pente/scratch',
    });
  });
});

describe('BOARD_SIZE — the edge length a CLI daemon plays on', () => {
  /** Re-imported per test: the constant is resolved once, at module load, from the environment. */
  const load = async (): Promise<number> => {
    vi.resetModules();
    return (await import('./relay')).BOARD_SIZE;
  };

  it('is 5 with nothing set — matching src/config/defaults/board.json', async () => {
    await expect(load()).resolves.toBe(5);
  });

  it('follows PENTE_BOARD_SIZE, as a NUMBER rather than the raw string', async () => {
    vi.stubEnv('PENTE_BOARD_SIZE', '7');
    await expect(load()).resolves.toBe(7);
  });
});
