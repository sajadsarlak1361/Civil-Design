import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { offlineStrings, woff2Only } from './vite.fonts.ts';
import { inlineWasmAssets, libredwgWasmResolve, stripLibredwgUrls } from './vite.dwg.ts';

/** One HTML file. `base: './'` so the page works from file:// and from a GitHub project site. */
export function singleFileConfig(outDir: string) {
  return defineConfig({
    base: './',
    define: { 'import.meta.env.VITEST': 'false' },
    plugins: [libredwgWasmResolve(), woff2Only(), offlineStrings(), stripLibredwgUrls(), react(), inlineWasmAssets(), viteSingleFile()],
    build: {
      outDir,
      emptyOutDir: true,
      copyPublicDir: false,
    },
  });
}

export default singleFileConfig('dist-single');
