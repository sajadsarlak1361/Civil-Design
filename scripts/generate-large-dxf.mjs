import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Synthetic ASCII DXF drawings used when no public file reaches the requested size.
 * Each entity is a LINE on layer Road. Coordinates form a grid so a zoom-extents
 * view still shows the drawing when the canvas strokes a sample of the segments.
 *
 * Usage: node scripts/generate-large-dxf.mjs [output-dir]
 */
const outputDir = resolve(process.argv[2] || '/tmp/large-dxf');
const targets = [
  ['lines-100mb.dxf', 100 * 1024 * 1024],
  ['lines-500mb.dxf', 500 * 1024 * 1024],
  ['lines-1gb.dxf', 1024 * 1024 * 1024],
];

const header = '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n';
const footer = '0\nENDSEC\n0\nEOF\n';

function lineOf(index) {
  const col = index % 4000;
  const row = Math.floor(index / 4000) % 4000;
  if ((index & 1) === 0) return `0\nLINE\n8\nRoad\n10\n${col}\n20\n${row}\n30\n0\n11\n${col + 1}\n21\n${row}\n31\n0\n`;
  return `0\nLINE\n8\nRoad\n10\n${col}\n20\n${row}\n30\n0\n11\n${col}\n21\n${row + 1}\n31\n0\n`;
}

function writeFile(name, bytes) {
  const path = resolve(outputDir, name);
  return new Promise((done, reject) => {
    const out = createWriteStream(path);
    out.on('error', reject);
    out.write(header);
    let written = header.length;
    let index = 0;
    const stopAt = bytes - footer.length;
    const pump = () => {
      let ok = true;
      while (ok && written < stopAt) {
        const line = lineOf(index);
        index += 1;
        written += line.length;
        ok = out.write(line);
      }
      if (written >= stopAt) {
        out.end(footer, () => done({ path, bytes: written + footer.length, entities: index }));
        return;
      }
      out.once('drain', pump);
    };
    pump();
  });
}

await mkdir(outputDir, { recursive: true });
for (const [name, bytes] of targets) {
  const started = Date.now();
  const result = await writeFile(name, bytes);
  console.log(`${result.path} ${result.bytes} bytes ${result.entities} lines ${(Date.now() - started) / 1000}s`);
}
