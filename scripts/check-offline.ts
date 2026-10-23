/**
 * Fails when a built page would request a network resource,
 * or when app source (index.html, src, public) contains one.
 *
 * Usage: node --experimental-strip-types scripts/check-offline.ts [--require-web | --web-only]
 * `npm test` and `npm run build:single` both run this.
 * `npm run build:web` runs it with --web-only.
 * `npm test` runs it with --require-web, so both pages must already exist.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { externalResourceUrls, pageResourceProblems, sourceResourceProblems } from '../src/offline/externalUrls.ts';

const root = resolve(import.meta.dirname, '..');
const webOnly = process.argv.includes('--web-only');
const requireWeb = webOnly || process.argv.includes('--require-web');
const requireSingle = !webOnly;
const singlePage = resolve(root, 'dist-single/civil-design.html');
const webPage = resolve(root, 'dist-web/index.html');
const problems: string[] = [];

for (const item of sourceResourceProblems(root)) {
  problems.push(`source ${item}`);
}

function buildFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...buildFiles(path));
    else if (/\.(html|js|css|svg)$/.test(name)) out.push(path);
  }
  return out;
}

if (requireSingle && !existsSync(singlePage)) {
  problems.push('dist-single/civil-design.html is missing. Run npm run build:single first.');
}

if (requireWeb && !existsSync(webPage)) {
  problems.push('dist-web/index.html is missing. Run npm run build:web first.');
}

if (requireWeb) {
  const webDir = resolve(root, 'dist-web');
  const allowed = new Set(['index.html', 'civil-design.html', '.nojekyll']);
  if (existsSync(webDir)) {
    for (const name of readdirSync(webDir)) {
      const path = join(webDir, name);
      if (statSync(path).isDirectory() || !allowed.has(name)) {
        problems.push(`dist-web/${name} is outside the single-file pages bundle`);
      }
    }
  }
  const copy = resolve(root, 'dist-web/civil-design.html');
  if (!existsSync(copy)) problems.push('dist-web/civil-design.html is missing. build:web copies index.html to that name.');
}

for (const dirName of ['dist-single', 'dist-web', 'dist']) {
  for (const file of buildFiles(resolve(root, dirName))) {
    const text = readFileSync(file, 'utf8');
    const label = relative(root, file);
    const items = file.endsWith('.html') ? pageResourceProblems(text) : externalResourceUrls(text);
    for (const item of items) problems.push(`${label}: ${item}`);
  }
}

if (problems.length > 0) {
  console.error('offline check failed:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

const notes: string[] = [];
if (existsSync(singlePage)) notes.push(`dist-single/civil-design.html (${readFileSync(singlePage).length} bytes)`);
if (existsSync(webPage)) notes.push(`dist-web/index.html (${readFileSync(webPage).length} bytes)`);
console.log(`offline check ok: ${notes.join(', ')} has no external resource URLs`);
