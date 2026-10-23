import type { Plugin } from 'vite';

/**
 * @fontsource ships each face as woff2 and woff. Civil Design only needs woff2.
 * Vite expands the @import after earlier transforms, so the extra woff url is
 * removed from the finished CSS (and from the single-file page that inlines it).
 */
function stripWoff(text: string): string {
  return text.replace(/,url\([^)]*\) format\(["']woff["']\)/g, '');
}

export function woff2Only(): Plugin {
  return {
    name: 'fieldline-woff2-only',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const [fileName, item] of Object.entries(bundle)) {
        if (item.type === 'asset' && typeof item.source === 'string') {
          const next = stripWoff(item.source);
          if (next !== item.source) item.source = next;
        } else if (item.type === 'chunk') {
          const next = stripWoff(item.code);
          if (next !== item.code) item.code = next;
        }
        if (fileName.endsWith('.woff')) delete bundle[fileName];
      }
    },
  };
}

/**
 * React's production build embeds https://react.dev/errors/ in minified error
 * text. Nothing fetches it. Rewrite it so the shipped page has no such URL.
 */
export function offlineStrings(): Plugin {
  return {
    name: 'fieldline-offline-strings',
    renderChunk(code) {
      const next = code.replaceAll('https://react.dev/errors/', 'react-error/');
      return next === code ? null : next;
    },
  };
}
