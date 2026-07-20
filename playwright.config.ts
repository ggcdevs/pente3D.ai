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
