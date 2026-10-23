import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { offlineStrings, woff2Only } from './vite.fonts.ts';
import { libredwgWasmResolve, stripLibredwgUrls, inlineWasmAssets } from './vite.dwg.ts';

export default defineConfig({
  base: './',
  plugins: [libredwgWasmResolve(), woff2Only(), offlineStrings(), stripLibredwgUrls(), inlineWasmAssets(), react()],
  server: {
    host: '0.0.0.0',
    port: 43123,
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 43123,
    strictPort: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
