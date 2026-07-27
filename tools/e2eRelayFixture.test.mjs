/**
 * THE DARK-TIER REGRESSION TEST — nothing under `e2e/` may resolve a broker for itself.
 *
 * ## What went wrong, and why a test rather than a note
 *
 * `src/config/defaults/relay.json` ships BLANK in every checkout (the deploy writes the real endpoint
 * from the `RELAY_CONFIG` repo variable at build time). Seven Playwright specs imported it directly
 * and probed `RELAY.wssUrl`, so every one of them found nothing to dial and SKIPPED — in every
 * checkout, on machines with proven egress. Observed with the broker reachable:
 *
 *     [sessionModelRelay.spec] SKIPPING: live relay (empty relay.json — no creds) unreachable …
 *     [networked.spec] SKIPPING: live relay  unreachable …
 *     10 skipped
 *
 * Among the skipped: "A enters, B enters → DISTINCT seats … [#31 regression]" and the #40
 * rematch-reconnect proof — browser-side halves the build plan leans on while the CLI matrix covers
 * only the CLI-vs-CLI half. A whole tier reported green-by-absence.
 *
 * `src/config/relayEnv.ts` answers "which broker does a node process mean", and `e2e/relayFixture.ts`
 * is how the Playwright tier asks it. The fix is only durable if the NEXT spec cannot re-open the
 * hole, so the invariant is machine-checked here instead of written in a comment:
 *
 *   - no `e2e/*.spec.ts` may import `src/config/defaults/relay.json` (only the fixture may); and
 *   - a spec that dials a broker (`mqtt.connect`) must get it from `./relayFixture`.
 *
 * Re-add either and `npm test` goes red — which is the only reason we know the rule holds.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const E2E_DIR = path.join(REPO_ROOT, 'e2e');
const FIXTURE = 'relayFixture.ts';

/** `{ name, source }` for every Playwright spec (not the fixture, not the lint fixtures). */
function specs() {
  return readdirSync(E2E_DIR)
    .filter((f) => f.endsWith('.spec.ts'))
    .sort()
    .map((name) => ({ name, source: readFileSync(path.join(E2E_DIR, name), 'utf8') }));
}

/** Import statements only — so the word appearing in a doc comment is not read as a dependency. */
function importsOf(source) {
  return [...source.matchAll(/^import[\s\S]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
}

describe('e2e live-relay specs resolve their broker in ONE place (the dark-tier regression)', () => {
  const all = specs();

  it('finds the specs at all — this suite must not pass by looking at nothing', () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it('NO spec imports the committed-blank relay.json directly', () => {
    // Named as a map: a violation's diff says WHICH spec re-opened it, not just that the count moved.
    const offenders = all
      .filter((s) => importsOf(s.source).some((i) => i.includes('defaults/relay.json')))
      .map((s) => s.name);
    expect(offenders).toEqual([]);
  });

  it('the fixture is the one file that DOES read it (the rule has a subject)', () => {
    // Without this, blanking the fixture's own import would make the rule above vacuously true.
    const fixture = readFileSync(path.join(E2E_DIR, FIXTURE), 'utf8');
    expect(importsOf(fixture).some((i) => i.includes('defaults/relay.json'))).toBe(true);
    expect(importsOf(fixture).some((i) => i.includes('config/relayEnv'))).toBe(true);
  });

  it('every spec that DIALS a broker gets it from the fixture', () => {
    const dialers = all.filter((s) => s.source.includes('mqtt.connect('));
    const fromFixture = Object.fromEntries(
      dialers.map((s) => [s.name, importsOf(s.source).includes(`./${FIXTURE.replace('.ts', '')}`)]),
    );
    expect(fromFixture).toEqual(Object.fromEntries(dialers.map((s) => [s.name, true])));
  });

  it('the live-relay specs that were dark all import the fixture now', () => {
    // The exact six the reviewer observed skipping, plus the two that already resolved correctly.
    // Listed explicitly so deleting a spec's fixture import is caught by name rather than by a count.
    const expected = [
      'cliVsBrowser.spec.ts',
      'handshake.spec.ts',
      'networked.spec.ts',
      'rematchFlow.spec.ts',
      'sessionModel.spec.ts',
      'sessionModelRelay.spec.ts',
      'undoRedo.spec.ts',
    ];
    const importsFixture = Object.fromEntries(
      expected.map((name) => {
        const spec = all.find((s) => s.name === name);
        return [name, spec !== undefined && importsOf(spec.source).includes('./relayFixture')];
      }),
    );
    expect(importsFixture).toEqual(Object.fromEntries(expected.map((n) => [n, true])));
  });

  it('each of those also INJECTS the resolved relay into the page (the browser half)', () => {
    // Resolving node-side only moves the darkness: the probe would report the broker reachable while
    // the page still read the committed blanks and dialed nothing.
    const expected = [
      'cliVsBrowser.spec.ts',
      'handshake.spec.ts',
      'networked.spec.ts',
      'rematchFlow.spec.ts',
      'sessionModel.spec.ts',
      'sessionModelRelay.spec.ts',
      'undoRedo.spec.ts',
    ];
    const injects = Object.fromEntries(
      expected.map((name) => {
        const spec = all.find((s) => s.name === name);
        return [name, spec !== undefined && spec.source.includes('await injectRelay(page)')];
      }),
    );
    expect(injects).toEqual(Object.fromEntries(expected.map((n) => [n, true])));
  });
});
