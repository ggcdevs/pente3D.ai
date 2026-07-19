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
