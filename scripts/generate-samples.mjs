import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Synthetic survey points for the sample project.
 * These are not a real survey. Elevations are a smooth made-up site:
 * a hill in the northeast, a shallow swale through the south, and a graded pad.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'samples');

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleExistingElevation(easting, northing) {
  const hill = 8.6 * Math.exp(-((easting - 10172) ** 2) / 2600 - ((northing - 50140) ** 2) / 2100);
  const ridge = 2.2 * Math.exp(-((easting - 10075) ** 2) / 1800 - ((northing - 50175) ** 2) / 900);
  const swale =
    -3.1 * Math.exp(-((northing - 50098) ** 2) / 420) * Math.exp(-((easting - 10120) ** 2) / 8000);
  const roll = 0.45 * Math.sin((easting - 10040) / 52) + 0.28 * Math.cos((northing - 50040) / 46);
  return 101.5 + hill + ridge + swale + roll;
}

const PAD = { minE: 10095, maxE: 10175, minN: 50082, maxN: 50142, z: 102.85 };

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function csv(lines) {
  return lines.join('\n') + '\n';
}

function existingRows() {
  const rand = mulberry32(20261022);
  const rows = [
    '# Fieldline sample — synthetic existing ground. Not a real survey.',
    '# Units: meters. Format: PNEZD (Point, Northing, Easting, Elevation, Description).',
    '# Local grid. Do not use these coordinates for construction.',
    'Point,Northing,Easting,Elevation,Description',
  ];
  let number = 1001;
  for (let easting = 10040; easting <= 10260.001; easting += 8) {
    for (let northing = 50040; northing <= 50220.001; northing += 8) {
      const e = easting + (rand() - 0.5) * 2.2;
      const n = northing + (rand() - 0.5) * 2.2;
      const z = round3(sampleExistingElevation(e, n));
      rows.push(`${number},${round3(n)},${round3(e)},${z.toFixed(3)},SAMPLE EG`);
      number += 1;
    }
  }
  return rows;
}

function insidePad(e, n) {
  return e >= PAD.minE && e <= PAD.maxE && n >= PAD.minN && n <= PAD.maxN;
}

function outwardNormal(e, n) {
  const left = Math.abs(e - PAD.minE);
  const right = Math.abs(PAD.maxE - e);
  const bottom = Math.abs(n - PAD.minN);
  const top = Math.abs(PAD.maxN - n);
  const m = Math.min(left, right, bottom, top);
  let x = 0;
  let y = 0;
  if (m === left) x = -1;
  else if (m === right) x = 1;
  if (m === bottom) y = -1;
  else if (m === top) y = 1;
  // Corners get a diagonal so the daylight wraps the pad.
  if (left < 1e-6 && bottom < 1e-6) return { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };
  if (right < 1e-6 && bottom < 1e-6) return { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
  if (right < 1e-6 && top < 1e-6) return { x: Math.SQRT1_2, y: Math.SQRT1_2 };
  if (left < 1e-6 && top < 1e-6) return { x: -Math.SQRT1_2, y: Math.SQRT1_2 };
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

function padRows() {
  const rows = [
    '# Fieldline sample — synthetic proposed pad. Not a real design.',
    `# Units: meters. Format: PNEZD. Pad elevation ${PAD.z.toFixed(3)} with 2:1 daylight to the sample existing ground.`,
    '# Local grid. Do not use these coordinates for construction.',
    'Point,Northing,Easting,Elevation,Description',
  ];
  let number = 5001;
  const push = (n, e, z, description) => {
    rows.push(`${number},${round3(n)},${round3(e)},${z.toFixed(3)},${description}`);
    number += 1;
  };

  for (let e = PAD.minE; e <= PAD.maxE + 1e-6; e += 5) {
    for (let n = PAD.minN; n <= PAD.maxN + 1e-6; n += 5) {
      push(n, e, PAD.z, 'SAMPLE PAD');
    }
  }

  const stations = [];
  const step = 5;
  for (let e = PAD.minE; e <= PAD.maxE + 1e-6; e += step) stations.push({ e, n: PAD.minN }, { e, n: PAD.maxN });
  for (let n = PAD.minN + step; n < PAD.maxN - 1e-6; n += step) stations.push({ e: PAD.minE, n }, { e: PAD.maxE, n });

  for (const station of stations) {
    const normal = outwardNormal(station.e, station.n);
    const edgeGround = sampleExistingElevation(station.e, station.n);
    const direction = edgeGround >= PAD.z ? 1 : -1;
    let prevD = 0;
    let prevZ = PAD.z;
    let prevGround = edgeGround;
    for (let d = 3; d <= 36; d += 3) {
      const e = station.e + normal.x * d;
      const n = station.n + normal.y * d;
      const z = PAD.z + direction * (d / 2);
      const ground = sampleExistingElevation(e, n);
      const crossed = direction > 0 ? z >= ground : z <= ground;
      if (crossed) {
        const denom = z - prevZ - (ground - prevGround);
        const t = Math.abs(denom) < 1e-9 ? 0 : Math.min(1, Math.max(0, (prevGround - prevZ) / denom));
        const de = station.e + normal.x * (prevD + t * (d - prevD));
        const dn = station.n + normal.y * (prevD + t * (d - prevD));
        push(dn, de, round3(sampleExistingElevation(de, dn)), 'SAMPLE DAYLIGHT');
        break;
      }
      push(n, e, round3(z), 'SAMPLE SLOPE');
      prevD = d;
      prevZ = z;
      prevGround = ground;
    }
  }
  return rows;
}

function roughPadBalance() {
  let cut = 0;
  let fill = 0;
  const cell = 25;
  for (let e = PAD.minE; e < PAD.maxE; e += 5) {
    for (let n = PAD.minN; n < PAD.maxN; n += 5) {
      const dz = PAD.z - sampleExistingElevation(e + 2.5, n + 2.5);
      if (dz >= 0) fill += dz * cell;
      else cut += -dz * cell;
    }
  }
  return { cut, fill };
}

mkdirSync(outDir, { recursive: true });
const existing = existingRows();
const pad = padRows();
writeFileSync(join(outDir, 'existing-ground-pnezd.csv'), csv(existing));
writeFileSync(join(outDir, 'proposed-pad-pnezd.csv'), csv(pad));
const balance = roughPadBalance();
console.log(`existing points: ${existing.length - 4}`);
console.log(`pad points: ${pad.length - 4}`);
console.log(`rough pad cut ${balance.cut.toFixed(1)} fill ${balance.fill.toFixed(1)}`);
