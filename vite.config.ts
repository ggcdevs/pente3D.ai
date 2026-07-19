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
      // MACHINE-ENFORCED GATE (not documentation): the pure rules engine AND the
      // in-scope config/persist layers are held to a hard 100% floor
      // (testing-strategy.md — "hard 100% threshold on src/core"; scope
      // "src/config src/persist" pinned per Stage gate request). `npm run coverage`
      // FAILS (non-zero exit) if any pinned file regresses below 100% on any
      // metric. Each whitespace-separated scope path becomes `<path>/**/*.ts`.
      // Existing `src/core` pin preserved (idempotent). Do not weaken these
      // numbers to pass; add tests instead (agent-principles.md #6).
      thresholds: {
        'src/core/**/*.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'src/config/**/*.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'src/persist/**/*.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
