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
    },
  },
});
