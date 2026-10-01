import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'extension',
  publicDir: '../public',
  base: './',
  resolve: { alias: { '/src': resolve('src') } },
  worker: { format: 'es' },
  build: {
    outDir: process.env.WEBCAST_BUILD_DIR ?? '../dist', emptyOutDir: false,
    rollupOptions: {
      input: {
        popup: resolve('extension/popup.html'),
        settings: resolve('extension/settings.html'),
        offscreen: resolve('extension/offscreen.html'),
        'service-worker': resolve('src/service-worker.ts'),
      },
      output: {
        entryFileNames: '[name].js', chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
