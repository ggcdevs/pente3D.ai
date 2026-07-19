/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/pente3D.ai/',
  build: {
    outDir: 'docs',
    emptyOutDir: true,
  },
  test: {
    globals: true,
    environment: 'node',
    // Vitest owns src/**/*.test.ts; Playwright owns e2e/. Keep them from colliding.
    include: ['src/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'docs/**', 'poc/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Core is the pure rules engine held to a 100% floor (see testing-strategy).
      // The rest is pragmatic; boundaries added per-stage.
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/main.ts', 'src/render/**', 'src/debug/window.ts'],
      // MACHINE-ENFORCED GATE (not documentation): the pure rules engine is held
      // to a hard 100% floor (testing-strategy.md — "hard 100% threshold on
      // src/core"). `npm run coverage` FAILS (non-zero exit) if any src/core file
      // regresses below 100% on any metric. Do not weaken these numbers to pass;
      // add tests instead (agent-principles.md #6).
      thresholds: {
        'src/core/**/*.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
