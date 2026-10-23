import { elevationColor, slopeColor } from './color';
import { memoryBudgetBytes } from './budget';

export interface Heightfield {
  cols: number;
  rows: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Row-major elevation. NaN is an empty cell. */
  z: Float32Array;
  minZ: number;
  maxZ: number;
}

export function lodResolution(pointCount: number, budgetBytes = memoryBudgetBytes()): number {
  const fromPoints = Math.round(Math.sqrt(Math.max(pointCount, 1) / 6));
  const fromBudget = Math.floor(Math.sqrt(Math.max(budgetBytes, 32 * 1024 * 1024) / 48));
  return Math.max(48, Math.min(520, fromPoints, fromBudget));
}

export function heightfieldFromPacked(xyz: Float64Array, cells: number): Heightfield {
  const count = xyz.length / 3;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = xyz[i * 3];
    const y = xyz[i * 3 + 1];
    const z = xyz[i * 3 + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) {
    return { cols: 2, rows: 2, minX: 0, minY: 0, maxX: 1, maxY: 1, z: new Float32Array(4).fill(Number.NaN), minZ: 0, maxZ: 0 };
  }
  const cols = Math.max(2, cells);
  const rows = Math.max(2, cells);
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const sum = new Float64Array(cols * rows);
  const hits = new Uint16Array(cols * rows);
  for (let i = 0; i < count; i++) {
    const x = xyz[i * 3];
    const y = xyz[i * 3 + 1];
    let col = Math.floor(((x - minX) / spanX) * (cols - 1));
    let row = Math.floor(((y - minY) / spanY) * (rows - 1));
    if (col < 0) col = 0;
    else if (col >= cols) col = cols - 1;
    if (row < 0) row = 0;
    else if (row >= rows) row = rows - 1;
    const cell = row * cols + col;
    sum[cell] += xyz[i * 3 + 2];
    if (hits[cell] < 65535) hits[cell] += 1;
  }
  const z = new Float32Array(cols * rows);
  for (let i = 0; i < z.length; i++) z[i] = hits[i] ? sum[i] / hits[i] : Number.NaN;
  fillHoles(z, cols, rows);
  return { cols, rows, minX, minY, maxX, maxY, z, minZ, maxZ };
}

function fillHoles(z: Float32Array, cols: number, rows: number): void {
  const next = new Float32Array(z.length);
  for (let pass = 0; pass < 8; pass++) {
    let filled = 0;
    next.set(z);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const cell = row * cols + col;
        if (Number.isFinite(z[cell])) continue;
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = row + dy;
          if (yy < 0 || yy >= rows) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const xx = col + dx;
            if (xx < 0 || xx >= cols) continue;
            const value = z[yy * cols + xx];
            if (!Number.isFinite(value)) continue;
            sum += value;
            n += 1;
          }
        }
        if (n >= 2) {
          next[cell] = sum / n;
          filled += 1;
        }
      }
    }
    z.set(next);
    if (filled === 0) break;
  }
}

export type ShadeMode = 'solid' | 'elevation' | 'slope';

/** RGBA pixels, row 0 at the south edge so a world-space drawImage stands upright. */
export function rasterHeightfield(field: Heightfield, mode: ShadeMode, solid: { r: number; g: number; b: number } = { r: 213, g: 219, b: 230 }): Uint8ClampedArray {
  const { cols, rows, z, minZ, maxZ } = field;
  const pixels = new Uint8ClampedArray(cols * rows * 4);
  const stepX = (field.maxX - field.minX) / Math.max(cols - 1, 1);
  const stepY = (field.maxY - field.minY) / Math.max(rows - 1, 1);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const value = z[row * cols + col];
      const pixel = ((rows - 1 - row) * cols + col) * 4;
      if (!Number.isFinite(value)) continue;
      let color = solid;
      if (mode === 'elevation') color = elevationColor(value, minZ, maxZ);
      else if (mode === 'slope') {
        const left = col > 0 ? z[row * cols + col - 1] : value;
        const right = col + 1 < cols ? z[row * cols + col + 1] : value;
        const down = row > 0 ? z[(row - 1) * cols + col] : value;
        const up = row + 1 < rows ? z[(row + 1) * cols + col] : value;
        const dzdx = (Number.isFinite(right) ? right : value) - (Number.isFinite(left) ? left : value);
        const dzdy = (Number.isFinite(up) ? up : value) - (Number.isFinite(down) ? down : value);
        const slope = Math.hypot(dzdx / (2 * stepX), dzdy / (2 * stepY));
        color = slopeColor(slope);
      }
      pixels[pixel] = color.r;
      pixels[pixel + 1] = color.g;
      pixels[pixel + 2] = color.b;
      pixels[pixel + 3] = 255;
    }
  }
  return pixels;
}

export interface LodMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

/** One indexed grid mesh. Empty cells are left out so holes stay open. */
export function heightfieldMesh(field: Heightfield, exaggeration = 1): LodMesh {
  const { cols, rows, z, minX, minY, maxX, maxY } = field;
  const positions = new Float32Array(cols * rows * 3);
  const stepX = (maxX - minX) / Math.max(cols - 1, 1);
  const stepY = (maxY - minY) / Math.max(rows - 1, 1);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const value = z[row * cols + col];
      const i = (row * cols + col) * 3;
      positions[i] = minX + col * stepX;
      positions[i + 1] = (Number.isFinite(value) ? value : field.minZ) * exaggeration;
      positions[i + 2] = -(minY + row * stepY);
    }
  }
  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let n = 0;
  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const a = row * cols + col;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      if (!Number.isFinite(z[a]) || !Number.isFinite(z[b]) || !Number.isFinite(z[c]) || !Number.isFinite(z[d])) continue;
      indices[n++] = a;
      indices[n++] = c;
      indices[n++] = b;
      indices[n++] = b;
      indices[n++] = c;
      indices[n++] = d;
    }
  }
  return { positions, indices: indices.slice(0, n) };
}
