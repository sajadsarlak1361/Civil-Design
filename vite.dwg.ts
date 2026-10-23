import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Package exports omit the wasm file, so Vite cannot deep-import it. */
export const libredwgWasm = resolve(process.cwd(), 'node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.wasm');

const WASM_SPECIFIER = '@mlightcad/libredwg-web/wasm/libredwg-web.wasm';

export function libredwgWasmResolve(): Plugin {
  return {
    name: 'libredwg-wasm-resolve',
    enforce: 'pre',
    resolveId(source) {
      const queryAt = source.indexOf('?');
      const bare = queryAt === -1 ? source : source.slice(0, queryAt);
      if (bare !== WASM_SPECIFIER) return null;
      return libredwgWasm + (queryAt === -1 ? '' : source.slice(queryAt));
    },
  };
}

/** Comments in the LibreDWG package name upstream issue trackers. Those are not fetched. */
export function stripLibredwgUrls(): Plugin {
  return {
    name: 'strip-libredwg-urls',
    transform(code, id) {
      if (!id.includes('libredwg-web')) return null;
      const next = code.replace(/https?:\/\/(?!www\.w3\.org\/)[^\s"'`)]+/g, '');
      return next === code ? null : { code: next, map: null };
    },
  };
}

/** The single-file page has to carry the DWG module. A separate .wasm fetch would fail offline. */
export function inlineWasmAssets(): Plugin {
  return {
    name: 'inline-wasm-assets',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const name of Object.keys(bundle)) {
        const file = bundle[name];
        if (!file || file.type !== 'asset' || !name.endsWith('.wasm')) continue;
        const bytes = typeof file.source === 'string' ? Buffer.from(file.source) : Buffer.from(file.source);
        const dataUrl = `data:application/octet-stream;base64,${bytes.toString('base64')}`;
        const base = name.split('/').pop() ?? name;
        delete bundle[name];
        for (const item of Object.values(bundle)) {
          if (item.type === 'chunk' && (item.code.includes(name) || item.code.includes(base))) {
            item.code = item.code.split(name).join(dataUrl).split(base).join(dataUrl);
          }
        }
      }
    },
  };
}
