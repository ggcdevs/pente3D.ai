/**
 * FIXTURE — the CONTROL. A perfectly ordinary Playwright spec that must produce ZERO eslint
 * findings. Without it, `tools/lintGate.test.mjs` could not tell "the selectors match the banned
 * forms" from "the selectors match everything": a rule that rejects every spec is not a gate
 * either, it is a broken build. See `e2e/lintFixtures/README.md`.
 */
import { test, expect } from '@playwright/test';

test.describe('a compliant spec produces no test-integrity findings', () => {
  test('asserts something', async () => {
    expect(2 + 2).toBe(4);
  });

  test('skips at RUNTIME, with a reported condition and reason', async () => {
    test.skip(String(process.env.NOPE) === 'yes', 'documented reason');
    expect(2 + 2).toBe(4);
  });
});
