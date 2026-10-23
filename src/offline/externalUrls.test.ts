import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { externalResourceUrls, pageResourceProblems, rootAbsoluteResourceRefs, sourceResourceProblems } from './externalUrls';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('offline URL check', () => {
  it('rejects stylesheets, fetches, workers, and tiles', () => {
    const html = `
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans" />
      <script src="https://cdn.jsdelivr.net/npm/three"></script>
      <img src="https://tile.openstreetmap.org/1/2/3.png" />
      <style>body { background: url(https://cdn.example/photo.png); }</style>
      <script>
        fetch('https://example.com/api');
        new Worker('https://cdn.example/worker.js');
      </script>
    `;
    const urls = externalResourceUrls(html);
    expect(urls.some((url) => url.includes('fonts.googleapis.com'))).toBe(true);
    expect(urls.some((url) => url.includes('jsdelivr.net'))).toBe(true);
    expect(urls.some((url) => url.includes('tile.openstreetmap.org'))).toBe(true);
    expect(urls.some((url) => url.includes('cdn.example/photo.png'))).toBe(true);
    expect(urls.some((url) => url.includes('example.com/api'))).toBe(true);
    expect(urls.some((url) => url.includes('cdn.example/worker.js'))).toBe(true);
    expect(externalResourceUrls('visit https://react.dev/errors/418 for the full message')).toEqual([
      'https://react.dev/errors/418',
    ]);
  });

  it('ignores namespace identifiers and URLs inside data URIs', () => {
    const html = `
      <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E" />
      <style>@font-face { src: url("data:font/woff2;base64,${'A'.repeat(80)}") format("woff2"); }</style>
      <script>
        document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
        const math = 'http://www.w3.org/1998/Math/MathML';
        const xml = '<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2"></LandXML>';
        return math + xml;
      </script>
    `;
    expect(externalResourceUrls(html)).toEqual([]);
  });

  it('rejects a protocol-relative stylesheet', () => {
    expect(externalResourceUrls(`<link rel="stylesheet" href="//fonts.gstatic.com/s/plex.woff2" />`).length).toBeGreaterThan(0);
  });

  it('app source has no external resource URLs', () => {
    expect(sourceResourceProblems(root)).toEqual([]);
  });

  it('rejects a site-root asset path and accepts a relative one', () => {
    expect(rootAbsoluteResourceRefs('<script type="module" src="/assets/index.js"></script>').length).toBeGreaterThan(0);
    expect(rootAbsoluteResourceRefs('<script type="module" src="./assets/index.js"></script>')).toEqual([]);
    expect(rootAbsoluteResourceRefs(`<base href="/Civil-Design/">`).length).toBeGreaterThan(0);
    expect(pageResourceProblems('<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\'/%3E" /><style>@font-face { font-family: "IBM Plex Sans"; src: url(data:font/woff2;base64,AAAA) format("woff2"); } @font-face { font-family: "IBM Plex Mono"; src: url(data:font/woff2;base64,AAAA) format("woff2"); }</style>')).toEqual([]);
  });

  it('the built single-file page has no external resource URLs when it exists', () => {
    const page = resolve(root, 'dist-single/civil-design.html');
    let html = '';
    try {
      html = readFileSync(page, 'utf8');
    } catch {
      return;
    }
    expect(pageResourceProblems(html)).toEqual([]);
  });
});
