import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  build: {
    outDir: process.env.WEBCAST_BUILD_DIR ?? 'dist', emptyOutDir: false,
    lib: { entry: resolve('src/content.ts'), name: 'WebcastMonitor', formats: ['iife'], fileName: () => 'content.js' },
  },
});
