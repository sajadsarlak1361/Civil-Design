/**
 * Finds http(s) URLs that a browser would request.
 *
 * XML namespace identifiers are not resources: nothing is fetched for them.
 * The single-file page may contain only these, and only as identifiers:
 * - http://www.w3.org/1999/xhtml          Three.js createElementNS
 * - http://www.w3.org/2000/svg            inline favicon SVG
 * - http://www.w3.org/1998/Math/MathML    React MathML namespace
 * - http://www.w3.org/1999/xlink          SVG attribute namespace
 * - http://www.w3.org/2000/xmlns/         xmlns namespace
 * - http://www.w3.org/XML/1998/namespace  xml namespace
 * - http://www.landxml.org/schema/LandXML-1.2   LandXML 1.2 export xmlns
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

export const NAMESPACE_URLS = new Set([
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1998/Math/MathML',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/2000/xmlns/',
  'http://www.w3.org/XML/1998/namespace',
  'http://www.landxml.org/schema/LandXML-1.2',
]);

const BANNED_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
  'unpkg.com',
  'jsdelivr.net',
  'esm.sh',
  'openstreetmap.org',
  'tile.openstreetmap.org',
  'googleapis.com',
  'gstatic.com',
];

const TEXT_EXT = new Set(['.html', '.css', '.ts', '.tsx', '.js', '.mjs', '.svg', '.json', '.webmanifest']);

const URL_RE = /https?:\/\/[^\s"'<>\\)]+/gi;
const PROTOCOL_RELATIVE_RE = /(?:href|src|url)\s*[=:(]\s*['"]?\/\/[^\s"'<>)]+/gi;

export function stripDataUris(text: string): string {
  return text
    .replace(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '')
    .replace(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+,[^"'\s)]*/gi, '');
}

function cleanUrl(raw: string): string {
  return raw.replace(/[),.;]+$/g, '').replace(/&amp;/g, '&');
}

/** http(s) URLs in `text` that are resource loads, not namespace identifiers or data URIs. */
export function externalResourceUrls(text: string): string[] {
  const source = stripDataUris(text);
  const found = new Set<string>();
  for (const match of source.matchAll(URL_RE)) {
    const url = cleanUrl(match[0]);
    if (!NAMESPACE_URLS.has(url)) found.add(url);
  }
  for (const match of source.matchAll(PROTOCOL_RELATIVE_RE)) {
    found.add(match[0].trim());
  }
  return [...found];
}

function walk(dir: string, out: string[], root: string): void {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'dist-single' || name === '.git') continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path, out, root);
      continue;
    }
    if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) continue;
    if (!TEXT_EXT.has(extname(name))) continue;
    out.push(relative(root, path));
  }
}

/** App source that ships to the browser. Tests are skipped because they contain fixture URLs. */
export function appSourceFiles(root: string): string[] {
  const files: string[] = [];
  if (existsSync(join(root, 'index.html'))) files.push('index.html');
  for (const dir of ['src', 'public']) {
    const path = join(root, dir);
    if (existsSync(path)) walk(path, files, root);
  }
  return files;
}

export function sourceResourceProblems(root: string): string[] {
  const problems: string[] = [];
  for (const file of appSourceFiles(root)) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const url of externalResourceUrls(text)) problems.push(`${file}: ${url}`);
  }
  return problems;
}

/** `src`/`href`/`url(` values that start at the site root. Project Pages cannot use those. */
export function rootAbsoluteResourceRefs(text: string): string[] {
  const source = stripDataUris(text);
  const found: string[] = [];
  const patterns = [
    /(?:\bsrc|\bhref)\s*=\s*(['"])\s*\/(?!\/)/gi,
    /url\(\s*(['"]?)\s*\/(?!\/)/gi,
    /<base\b[^>]*\bhref\s*=\s*(['"])\s*(?:\/(?!\/)|https?:)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.push(match[0].trim());
  }
  return found;
}

export function pageResourceProblems(html: string): string[] {
  const problems: string[] = [];
  for (const url of externalResourceUrls(html)) problems.push(url);
  for (const ref of rootAbsoluteResourceRefs(html)) problems.push(`root-absolute resource ${ref}`);
  const stripped = stripDataUris(html);
  for (const host of BANNED_HOSTS) {
    if (stripped.includes(host)) problems.push(`banned host ${host}`);
  }
  if (!html.includes('@font-face') || !html.includes('IBM Plex Sans') || !html.includes('IBM Plex Mono')) {
    problems.push('IBM Plex @font-face is missing from the page');
  }
  if (!/data:[^)'"\s]*;base64,/i.test(html)) {
    problems.push('font files were not inlined as data URIs');
  }
  if (/url\(\s*['"]?(?!data:)[^)'"]+\.woff2/i.test(html)) {
    problems.push('a .woff2 file is still referenced outside a data URI');
  }
  return problems;
}
