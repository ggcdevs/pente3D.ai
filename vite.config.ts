import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/core': path.resolve(__dirname, './src/core'),
      '@/rendering': path.resolve(__dirname, './src/rendering'),
      '@/ui': path.resolve(__dirname, './src/ui'),
      '@/network': path.resolve(__dirname, './src/network'),
      '@/utils': path.resolve(__dirname, './src/utils'),
      '@/types': path.resolve(__dirname, './src/types'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    open: true,
  },
  build: {
    target: 'es2020',
    minify: 'terser',
    sourcemap: true,
  },
});