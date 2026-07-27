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

/**
 * WHICH BOARD A CLI DAEMON PLAYS ON — and that it refuses to play on a nonsense one.
 *
 * Two ways this went silently wrong, both invisible to the gates `cli/relay.ts` sits inside (it
 * scores full marks on coverage AND mutation; neither can see a refusal nobody wrote):
 *
 *   · `Number(hostEnv()['PENTE_BOARD_SIZE'] ?? 5)` re-stated the tracked default as a LITERAL under
 *     a comment claiming it matched `src/config/defaults/board.json`. It did not read that file, so
 *     editing board.json moved the browser and left the CLI behind — observed: with board.json set
 *     to `{ "size": 7 }`, `board.json size = 7 | CLI BOARD_SIZE = 5`, suite green. The old test
 *     asserted `toBe(5)` against the same 5 the code hardcoded: the literal checked against itself.
 *   · Nothing was refused: `PENTE_BOARD_SIZE=abc` -> `NaN`, `PENTE_BOARD_SIZE=` -> `0`. A daemon
 *     then played on a NaN- or 0-edged board and every render, coordinate check and scenario
 *     assertion past that point was meaningless, with nothing said.
 */
describe('BOARD_SIZE — the edge length a CLI daemon plays on', () => {
  /** Re-imported per test: the constant is resolved once, at module load, from the environment. */
  const load = async (): Promise<number> => {
    vi.resetModules();
    return (await import('./relay')).BOARD_SIZE;
  };

  it('follows src/config/defaults/board.json, which is the SSOT — not a copy of its number', async () => {
    const board = (await import('../src/config/defaults/board.json', { with: { type: 'json' } }))
      .default;
    await expect(load()).resolves.toBe(board.size);
  });

  it('follows PENTE_BOARD_SIZE, as a NUMBER rather than the raw string', async () => {
    vi.stubEnv('PENTE_BOARD_SIZE', '7');
    await expect(load()).resolves.toBe(7);
  });

  it('accepts a MULTI-DIGIT size — 11 is an offered board, not a typo', async () => {
    // `BOARD_SIZE_OPTIONS` (src/ui/widgets/settingsModel.ts) offers 5/7/9/11, so a one-digit-only
    // rule would refuse a board the product ships. Caught by the mutation gate: narrowing the
    // guard to `/^[0-9]$/` survived until this case existed.
    vi.stubEnv('PENTE_BOARD_SIZE', '11');
    await expect(load()).resolves.toBe(11);
  });

  it('refuses a non-numeric PENTE_BOARD_SIZE instead of playing on a NaN board', async () => {
    vi.stubEnv('PENTE_BOARD_SIZE', 'abc');
    await expect(load()).rejects.toThrow(/PENTE_BOARD_SIZE.*got "abc"/);
  });

  it('refuses an empty PENTE_BOARD_SIZE instead of a 0-edged board', async () => {
    vi.stubEnv('PENTE_BOARD_SIZE', '');
    await expect(load()).rejects.toThrow(/PENTE_BOARD_SIZE/);
  });

  it.each(['0', '-5', '5.5', ' 5 ', '0x7', '5e0'])(
    'refuses "%s", which `Number()` alone would have zeroed or reinterpreted',
    async (raw) => {
      vi.stubEnv('PENTE_BOARD_SIZE', raw);
      await expect(load()).rejects.toThrow(/PENTE_BOARD_SIZE/);
    },
  );

  it('names the variable and the tracked default it would fall back to', async () => {
    // The refusal has to be actionable at the boundary: this is the only place the operator can
    // still be told WHICH variable is wrong and what unsetting it would give them.
    const board = (await import('../src/config/defaults/board.json', { with: { type: 'json' } }))
      .default;
    const { boardSize } = await import('./relay');
    expect(() => boardSize({ PENTE_BOARD_SIZE: 'abc' })).toThrow(
      `PENTE_BOARD_SIZE: not a positive whole number of cells (got "abc") — ` +
        `unset it to play on the tracked default of ${board.size}`,
    );
  });
});
