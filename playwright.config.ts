import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the walking-skeleton e2e.
 *
 * Uses a `webServer` to run the Vite dev server, then drives the real canvas.
 * Chromium is launched with SwiftShader software WebGL so the 3D scene renders
 * headless in CI / sandboxes without a GPU.
 */
export default defineConfig({
  testDir: './e2e',
  // `e2e/lintFixtures/` holds SPECS THAT MUST FAIL LINT (a focused describe, a bare `test.skip()`,
  // …) — they exist only as the fixture `tools/lintGate.test.mjs` runs eslint over to prove the
  // test-integrity rules bite. They are not tests and must never be executed here; running them
  // would do exactly the damage they demonstrate (the focused describe would drop the whole run).
  testIgnore: '**/lintFixtures/**',
  // A `.only` that reaches the repo makes Playwright run that spec ALONE and exit 0 — a green
  // suite that tested almost nothing. The lint gate rejects it at review time; this rejects it at
  // RUN time, so the two do not depend on each other. Unconditional, not `!!process.env.CI`: a
  // local run reporting green off one focused spec is the same lie as a CI run doing it.
  forbidOnly: true,
  timeout: 60_000,
  // Tests within a file run serially; separate spec files still run on parallel WORKERS (each a
  // separate browser process, and each test a fresh context → isolated localStorage + IndexedDB).
  // Cross-file parallelism is deliberately kept: specs that touch persistence isolate their own
  // state (settings/net clear localStorage per test; archive additionally opens a per-test DB via
  // the `__penteDbName` seam), so no two workers contend on the shared-origin `pente3d` store. Do
  // NOT "fix" a persistence flake by pinning `workers:1` — that only masks a race under lighter
  // load (agent-principles #7). Fix the isolation/durability at the source, as the archive spec does.
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173/pente3D.ai/',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173/pente3D.ai/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
