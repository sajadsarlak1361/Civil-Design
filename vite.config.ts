import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { offlineStrings, woff2Only } from './vite.fonts.ts';
import { libredwgWasmResolve, stripLibredwgUrls, inlineWasmAssets } from './vite.dwg.ts';

/** Tauri's custom protocol does not send CORS headers. A crossorigin module never runs, so no menu mounts. */
function stripCrossorigin(): Plugin {
  return {
    name: 'strip-crossorigin',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace(/ crossorigin/g, '');
      },
    },
  };
}

export default defineConfig({
  base: './',
  define: process.env.VITEST ? undefined : { 'import.meta.env.VITEST': 'false' },
  plugins: [libredwgWasmResolve(), woff2Only(), offlineStrings(), stripLibredwgUrls(), inlineWasmAssets(), stripCrossorigin(), react()],
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
