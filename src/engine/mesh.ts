/**
 * Ball-pivoting surface reconstruction (Bernardini, Mittleman, Rushmeier, Silva, Taubin 1999).
 * Triangles are built in 3D from the input points. Points are never moved or inserted,
 * so a vertical face or an overhang keeps every layer that the scan actually measured.
 * Delaunay is not used: a plan triangulation cannot represent two elevations at one easting/northing.
 */

import { triangleArea3D } from './geometry';
import type { SurveyPoint, Triangle } from './types';

export type MeshOrient = 'auto' | 'outward' | 'toward-axis';

export interface MeshBuildOptions {
  /** Ball radii. When omitted, 1×, 2× and 4× the median nearest-neighbor spacing. */
  radii?: number[];
  /** Scales the automatic radii. Ignored when `radii` is set. */
  radiusScale?: number;
  /** Neighbors used for the normal's principal-component fit. */
  kNeighbors?: number;
  /** Remove triangles with any edge longer than this, after pivoting. */
  maxEdgeLength?: number | null;
  /** Fill boundary loops no longer than this many edges. 0 leaves holes open. */
  fillHoles?: number;
  orient?: MeshOrient;
  onProgress?: (fraction: number, message: string) => void;
  shouldCancel?: () => boolean;
}

export interface MeshBBox {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface MeshBuildResult {
  points: SurveyPoint[];
  triangles: Triangle[];
  /** Unit normals, one per input point, packed xyz. */
  normals: Float32Array;
  radii: number[];
  spacing: number;
  boundaryEdges: number;
  area3D: number;
  bbox: MeshBBox;
  timingMs: number;
  cancelled: boolean;
  /** How the normals were flipped after they were made consistent. */
  orientMode: 'toward-axis' | 'outward' | 'open';
}

export interface MeshStatistics {
  vertices: number;
  usedVertices: number;
  triangles: number;
  area3D: number;
  boundaryEdges: number;
  bbox: MeshBBox;
}

class EdgeTable {
  private cap: number;
  private mask: number;
  private lo: Int32Array;
  private hi: Int32Array;
  private count: Int8Array;
  private dir: Int8Array;
  private size = 0;

  constructor(expected: number) {
    let cap = 16;
    const need = Math.max(16, expected);
    while (cap < need) cap <<= 1;
    this.cap = cap;
    this.mask = cap - 1;
    this.lo = new Int32Array(cap);
    this.hi = new Int32Array(cap);
    this.lo.fill(-1);
    this.count = new Int8Array(cap);
    this.dir = new Int8Array(cap);
  }

  private slot(a: number, b: number): number {
    let h = (Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b)) >>> 0;
    h &= this.mask;
    const lo = this.lo;
    const hi = this.hi;
    while (lo[h] !== -1 && (lo[h] !== a || hi[h] !== b)) h = (h + 1) & this.mask;
    return h;
  }

  private grow(): void {
    const prevLo = this.lo;
    const prevHi = this.hi;
    const prevCount = this.count;
    const prevDir = this.dir;
    const prevCap = this.cap;
    this.cap = prevCap << 1;
    this.mask = this.cap - 1;
    this.lo = new Int32Array(this.cap);
    this.hi = new Int32Array(this.cap);
    this.lo.fill(-1);
    this.count = new Int8Array(this.cap);
    this.dir = new Int8Array(this.cap);
    this.size = 0;
    for (let i = 0; i < prevCap; i++) {
      if (prevLo[i] === -1) continue;
      const h = this.slot(prevLo[i], prevHi[i]);
      this.lo[h] = prevLo[i];
      this.hi[h] = prevHi[i];
      this.count[h] = prevCount[i];
      this.dir[h] = prevDir[i];
      this.size += 1;
    }
  }

  /** 0 when the edge is unknown. `dir` is +1 when lo→hi is a boundary half-edge. */
  read(a: number, b: number): { count: number; dir: number } {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const h = this.slot(lo, hi);
    if (this.lo[h] === -1) return { count: 0, dir: 0 };
    return { count: this.count[h], dir: this.dir[h] };
  }

  /**
   * Record the directed boundary use u→v.
   * Returns false when the edge already has two faces or already has this direction.
   */
  canTake(u: number, v: number): boolean {
    const lo = u < v ? u : v;
    const hi = u < v ? v : u;
    const want = u === lo ? 1 : -1;
    const h = this.slot(lo, hi);
    if (this.lo[h] === -1) return true;
    if (this.count[h] >= 2) return false;
    if (this.dir[h] === want) return false;
    return true;
  }

  take(u: number, v: number): void {
    const lo = u < v ? u : v;
    const hi = u < v ? v : u;
    const want = u === lo ? 1 : -1;
    if (this.size * 10 > this.cap * 7) this.grow();
    const h = this.slot(lo, hi);
    if (this.lo[h] === -1) {
      this.lo[h] = lo;
      this.hi[h] = hi;
      this.count[h] = 1;
      this.dir[h] = want;
      this.size += 1;
      return;
    }
    this.count[h] = 2;
    this.dir[h] = 0;
  }
}

class VoxelGrid {
  private readonly inv: number;
  private readonly buckets = new Map<number, { ix: number; iy: number; iz: number; ids: number[] }[]>();

  constructor(
    private readonly coords: Float64Array,
    count: number,
    cell: number,
  ) {
    this.inv = 1 / cell;
    for (let i = 0; i < count; i++) {
      const ix = Math.floor(coords[i * 3] * this.inv);
      const iy = Math.floor(coords[i * 3 + 1] * this.inv);
      const iz = Math.floor(coords[i * 3 + 2] * this.inv);
      this.cell(ix, iy, iz, true)!.push(i);
    }
  }

  private cell(ix: number, iy: number, iz: number, create: boolean): number[] | null {
    const hash = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) >>> 0;
    let list = this.buckets.get(hash);
    if (!list) {
      if (!create) return null;
      list = [];
      this.buckets.set(hash, list);
    }
    for (const entry of list) {
      if (entry.ix === ix && entry.iy === iy && entry.iz === iz) return entry.ids;
    }
    if (!create) return null;
    const ids: number[] = [];
    list.push({ ix, iy, iz, ids });
    return ids;
  }

  query(x: number, y: number, z: number, radius: number, out: number[]): number {
    const r = radius;
    const inv = this.inv;
    const ix0 = Math.floor((x - r) * inv);
    const ix1 = Math.floor((x + r) * inv);
    const iy0 = Math.floor((y - r) * inv);
    const iy1 = Math.floor((y + r) * inv);
    const iz0 = Math.floor((z - r) * inv);
    const iz1 = Math.floor((z + r) * inv);
    const r2 = r * r;
    const coords = this.coords;
    let n = 0;
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const ids = this.cell(ix, iy, iz, false);
          if (!ids) continue;
          for (let k = 0; k < ids.length; k++) {
            const i = ids[k];
            const dx = coords[i * 3] - x;
            const dy = coords[i * 3 + 1] - y;
            const dz = coords[i * 3 + 2] - z;
            if (dx * dx + dy * dy + dz * dz <= r2) out[n++] = i;
          }
        }
      }
    }
    return n;
  }

  nearest(index: number, excludeRadius = 0): number {
    const coords = this.coords;
    const x = coords[index * 3];
    const y = coords[index * 3 + 1];
    const z = coords[index * 3 + 2];
    const cell = 1 / this.inv;
    let best = Infinity;
    for (let ring = 1; ring <= 8 && best === Infinity; ring++) {
      const found = this.query(x, y, z, cell * ring, scratch);
      for (let i = 0; i < found; i++) {
        const j = scratch[i];
        if (j === index) continue;
        const dx = coords[j * 3] - x;
        const dy = coords[j * 3 + 1] - y;
        const dz = coords[j * 3 + 2] - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > excludeRadius && d2 < best) best = d2;
      }
    }
    return best === Infinity ? 0 : Math.sqrt(best);
  }
}

const scratch: number[] = new Array(4096);
const scratchB: number[] = new Array(4096);

function ensureScratch(n: number): void {
  if (scratch.length < n) {
    scratch.length = n;
    scratchB.length = n;
  }
}

function jacobiNormal(c00: number, c01: number, c02: number, c11: number, c12: number, c22: number): [number, number, number] | null {
  let a00 = c00;
  let a01 = c01;
  let a02 = c02;
  let a11 = c11;
  let a12 = c12;
  let a22 = c22;
  let v00 = 1;
  let v01 = 0;
  let v02 = 0;
  let v10 = 0;
  let v11 = 1;
  let v12 = 0;
  let v20 = 0;
  let v21 = 0;
  let v22 = 1;
  for (let iter = 0; iter < 14; iter++) {
    const a01a = Math.abs(a01);
    const a02a = Math.abs(a02);
    const a12a = Math.abs(a12);
    if (a01a < 1e-15 && a02a < 1e-15 && a12a < 1e-15) break;
    let p = 0;
    let q = 1;
    let apq = a01;
    if (a02a > Math.abs(apq)) {
      p = 0;
      q = 2;
      apq = a02;
    }
    if (a12a > Math.abs(apq)) {
      p = 1;
      q = 2;
      apq = a12;
    }
    const app = p === 0 ? a00 : a11;
    const aqq = q === 1 ? a11 : a22;
    const tau = (aqq - app) / (2 * apq || 1e-30);
    const sign = tau >= 0 ? 1 : -1;
    const t = sign / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;
    if (p === 0 && q === 1) {
      const b02 = c * a02 - s * a12;
      const b12 = s * a02 + c * a12;
      a00 = app - t * apq;
      a11 = aqq + t * apq;
      a01 = 0;
      a02 = b02;
      a12 = b12;
      const n00 = c * v00 - s * v01;
      const n01 = s * v00 + c * v01;
      const n10 = c * v10 - s * v11;
      const n11 = s * v10 + c * v11;
      const n20 = c * v20 - s * v21;
      const n21 = s * v20 + c * v21;
      v00 = n00;
      v01 = n01;
      v10 = n10;
      v11 = n11;
      v20 = n20;
      v21 = n21;
    } else if (p === 0 && q === 2) {
      const b01 = c * a01 - s * a12;
      const b12 = s * a01 + c * a12;
      a00 = app - t * apq;
      a22 = aqq + t * apq;
      a02 = 0;
      a01 = b01;
      a12 = b12;
      const n00 = c * v00 - s * v02;
      const n02 = s * v00 + c * v02;
      const n10 = c * v10 - s * v12;
      const n12 = s * v10 + c * v12;
      const n20 = c * v20 - s * v22;
      const n22 = s * v20 + c * v22;
      v00 = n00;
      v02 = n02;
      v10 = n10;
      v12 = n12;
      v20 = n20;
      v22 = n22;
    } else {
      const b01 = c * a01 - s * a02;
      const b02 = s * a01 + c * a02;
      a11 = app - t * apq;
      a22 = aqq + t * apq;
      a12 = 0;
      a01 = b01;
      a02 = b02;
      const n01 = c * v01 - s * v02;
      const n02 = s * v01 + c * v02;
      const n11 = c * v11 - s * v12;
      const n12 = s * v11 + c * v12;
      const n21 = c * v21 - s * v22;
      const n22 = s * v21 + c * v22;
      v01 = n01;
      v02 = n02;
      v11 = n11;
      v12 = n12;
      v21 = n21;
      v22 = n22;
    }
  }
  let col = 0;
  let best = a00;
  if (a11 < best) {
    best = a11;
    col = 1;
  }
  if (a22 < best) col = 2;
  const x = col === 0 ? v00 : col === 1 ? v01 : v02;
  const y = col === 0 ? v10 : col === 1 ? v11 : v12;
  const z = col === 0 ? v20 : col === 1 ? v21 : v22;
  const len = Math.hypot(x, y, z);
  if (len < 1e-15) return null;
  return [x / len, y / len, z / len];
}

function sphereCenter(
  coords: Float64Array,
  i: number,
  j: number,
  k: number,
  radius: number,
): [number, number, number] | null {
  const ax = coords[i * 3];
  const ay = coords[i * 3 + 1];
  const az = coords[i * 3 + 2];
  const abx = coords[j * 3] - ax;
  const aby = coords[j * 3 + 1] - ay;
  const abz = coords[j * 3 + 2] - az;
  const acx = coords[k * 3] - ax;
  const acy = coords[k * 3 + 1] - ay;
  const acz = coords[k * 3 + 2] - az;
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const nlen = Math.hypot(nx, ny, nz);
  if (nlen < 1e-18) return null;
  const ab2 = abx * abx + aby * aby + abz * abz;
  const ac2 = acx * acx + acy * acy + acz * acz;
  const abac = abx * acx + aby * acy + abz * acz;
  const det = ab2 * ac2 - abac * abac;
  if (det <= 1e-18) return null;
  const inv = 1 / (2 * det);
  const s = ac2 * (ab2 - abac) * inv;
  const t = ab2 * (ac2 - abac) * inv;
  const ccx = ax + s * abx + t * acx;
  const ccy = ay + s * aby + t * acy;
  const ccz = az + s * abz + t * acz;
  const dx = ccx - ax;
  const dy = ccy - ay;
  const dz = ccz - az;
  const h2 = radius * radius - (dx * dx + dy * dy + dz * dz);
  if (h2 < -1e-8 * radius * radius) return null;
  const h = Math.sqrt(Math.max(0, h2));
  const scale = h / nlen;
  return [ccx + nx * scale, ccy + ny * scale, ccz + nz * scale];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const copy = values.slice().sort((a, b) => a - b);
  const mid = copy.length >> 1;
  return copy.length % 2 ? copy[mid] : (copy[mid - 1] + copy[mid]) / 2;
}

export function suggestMeshRadii(spacing: number, scale = 1): number[] {
  const base = Math.max(spacing, 1e-9) * (scale > 0 ? scale : 1);
  return [base, base * 2, base * 4];
}

function bboxOf(coords: Float64Array, count: number): MeshBBox {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = coords[i * 3];
    const y = coords[i * 3 + 1];
    const z = coords[i * 3 + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

function diagonal(box: MeshBBox): number {
  return Math.hypot(box.maxX - box.minX, box.maxY - box.minY, box.maxZ - box.minZ);
}

export function boundaryEdgeCount(triangles: Triangle[]): number {
  const use = new Map<string, number>();
  const bump = (a: number, b: number) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    use.set(key, (use.get(key) ?? 0) + 1);
  };
  for (const [a, b, c] of triangles) {
    bump(a, b);
    bump(b, c);
    bump(c, a);
  }
  let edges = 0;
  for (const count of use.values()) if (count === 1) edges += 1;
  return edges;
}

export function meshStatistics(points: SurveyPoint[], triangles: Triangle[]): MeshStatistics {
  const box = bboxOf(
    Float64Array.from(points.flatMap((point) => [point.x, point.y, point.z])),
    points.length,
  );
  const used = new Set<number>();
  let area3D = 0;
  for (const [ia, ib, ic] of triangles) {
    used.add(ia);
    used.add(ib);
    used.add(ic);
    area3D += triangleArea3D(points[ia], points[ib], points[ic]);
  }
  return {
    vertices: points.length,
    usedVertices: used.size,
    triangles: triangles.length,
    area3D,
    boundaryEdges: boundaryEdgeCount(triangles),
    bbox: box,
  };
}

interface FrontEdge {
  u: number;
  v: number;
  o: number;
}

export function buildMesh(points: SurveyPoint[], options: MeshBuildOptions = {}): MeshBuildResult {
  const started = performance.now();
  const count = points.length;
  const coords = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) {
    coords[i * 3] = points[i].x;
    coords[i * 3 + 1] = points[i].y;
    coords[i * 3 + 2] = points[i].z;
  }
  const normals = new Float32Array(count * 3);
  const box = bboxOf(coords, count);
  const empty = (): MeshBuildResult => ({
    points,
    triangles: [],
    normals,
    radii: [],
    spacing: 0,
    boundaryEdges: 0,
    area3D: 0,
    bbox: box,
    timingMs: performance.now() - started,
    cancelled: Boolean(options.shouldCancel?.()),
    orientMode: 'open',
  });
  if (count < 3) return empty();
  const progress = options.onProgress;
  const cancelled = () => Boolean(options.shouldCancel?.());
  progress?.(0.02, 'Measuring point spacing…');

  const diag = Math.max(diagonal(box), 1e-9);
  const guess = Math.max(diag / Math.sqrt(count), diag * 1e-6);
  let grid = new VoxelGrid(coords, count, guess);
  const samples: number[] = [];
  const sampleCount = Math.min(count, 2500);
  const stride = Math.max(1, Math.floor(count / sampleCount));
  for (let i = 0; i < count && samples.length < sampleCount; i += stride) {
    const nearest = grid.nearest(i);
    if (nearest > 0) samples.push(nearest);
  }
  let spacing = median(samples);
  if (!(spacing > 0)) spacing = guess;
  if (guess > spacing * 4 || guess < spacing * 0.25) grid = new VoxelGrid(coords, count, spacing);

  const radii = (options.radii && options.radii.length > 0
    ? options.radii.filter((radius) => radius > 0).slice().sort((a, b) => a - b)
    : suggestMeshRadii(spacing, options.radiusScale ?? 1)
  ).filter((radius, index, list) => index === 0 || radius > list[index - 1] * 1.01);
  if (radii.length === 0) return empty();

  const kNeighbors = Math.max(6, Math.min(24, options.kNeighbors ?? 12));
  progress?.(0.08, 'Estimating normals…');
  const neighborRadius = spacing * 4;
  ensureScratch(2048);
  for (let i = 0; i < count; i++) {
    if ((i & 4095) === 0) {
      if (cancelled()) return { ...empty(), radii, spacing, cancelled: true };
      progress?.(0.08 + (0.2 * i) / count, 'Estimating normals…');
    }
    const found = grid.query(coords[i * 3], coords[i * 3 + 1], coords[i * 3 + 2], neighborRadius, scratch);
    const order: { j: number; d2: number }[] = [];
    for (let n = 0; n < found; n++) {
      const j = scratch[n];
      if (j === i) continue;
      const dx = coords[j * 3] - coords[i * 3];
      const dy = coords[j * 3 + 1] - coords[i * 3 + 1];
      const dz = coords[j * 3 + 2] - coords[i * 3 + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 0) order.push({ j, d2 });
    }
    order.sort((a, b) => a.d2 - b.d2);
    const take = Math.min(kNeighbors, order.length);
    if (take < 3) continue;
    let c00 = 0;
    let c01 = 0;
    let c02 = 0;
    let c11 = 0;
    let c12 = 0;
    let c22 = 0;
    for (let n = 0; n < take; n++) {
      const j = order[n].j;
      const dx = coords[j * 3] - coords[i * 3];
      const dy = coords[j * 3 + 1] - coords[i * 3 + 1];
      const dz = coords[j * 3 + 2] - coords[i * 3 + 2];
      c00 += dx * dx;
      c01 += dx * dy;
      c02 += dx * dz;
      c11 += dy * dy;
      c12 += dy * dz;
      c22 += dz * dz;
    }
    const normal = jacobiNormal(c00, c01, c02, c11, c12, c22);
    if (!normal) continue;
    normals[i * 3] = normal[0];
    normals[i * 3 + 1] = normal[1];
    normals[i * 3 + 2] = normal[2];
  }

  const orientMode = orientNormals(coords, count, normals, grid, spacing, options.orient ?? 'auto', cancelled, progress);
  if (cancelled()) return { ...empty(), radii, spacing, cancelled: true, orientMode };

  progress?.(0.42, 'Pivoting the ball…');
  const edges = new EdgeTable(Math.max(64, count * 8));
  let triStore = new Uint32Array(Math.max(64, count * 6));
  let triCount = 0;
  const used = new Uint8Array(count);
  const queue: FrontEdge[] = [];
  const pending: FrontEdge[] = [];

  const pushTri = (i: number, j: number, k: number) => {
    if (triCount + 3 > triStore.length) {
      const next = new Uint32Array(triStore.length * 2);
      next.set(triStore);
      triStore = next;
    }
    triStore[triCount++] = i;
    triStore[triCount++] = j;
    triStore[triCount++] = k;
    used[i] = 1;
    used[j] = 1;
    used[k] = 1;
  };

  const tryAdd = (i: number, j: number, k: number, born: FrontEdge[]): boolean => {
    if (i === j || j === k || k === i) return false;
    if (!edges.canTake(i, j) || !edges.canTake(j, k) || !edges.canTake(k, i)) return false;
    const abx = coords[j * 3] - coords[i * 3];
    const aby = coords[j * 3 + 1] - coords[i * 3 + 1];
    const abz = coords[j * 3 + 2] - coords[i * 3 + 2];
    const acx = coords[k * 3] - coords[i * 3];
    const acy = coords[k * 3 + 1] - coords[i * 3 + 1];
    const acz = coords[k * 3 + 2] - coords[i * 3 + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const nlen = Math.hypot(nx, ny, nz);
    if (nlen < 1e-16) return false;
    const agreement =
      nx * normals[i * 3] + ny * normals[i * 3 + 1] + nz * normals[i * 3 + 2] +
      nx * normals[j * 3] + ny * normals[j * 3 + 1] + nz * normals[j * 3 + 2] +
      nx * normals[k * 3] + ny * normals[k * 3 + 1] + nz * normals[k * 3 + 2];
    if (agreement < 0) return false;
    edges.take(i, j);
    edges.take(j, k);
    edges.take(k, i);
    pushTri(i, j, k);
    const consider = (u: number, v: number, o: number) => {
      const face = edges.read(u, v);
      if (face.count === 1) born.push({ u, v, o });
    };
    consider(i, j, k);
    consider(j, k, i);
    consider(k, i, j);
    return true;
  };

  const ballEmpty = (cx: number, cy: number, cz: number, radius: number, ia: number, ib: number, ic: number): boolean => {
    const limit = radius * 0.985;
    const limit2 = limit * limit;
    const found = grid.query(cx, cy, cz, radius, scratch);
    for (let n = 0; n < found; n++) {
      const p = scratch[n];
      if (p === ia || p === ib || p === ic) continue;
      const dx = coords[p * 3] - cx;
      const dy = coords[p * 3 + 1] - cy;
      const dz = coords[p * 3 + 2] - cz;
      if (dx * dx + dy * dy + dz * dz < limit2) return false;
    }
    return true;
  };

  const pivot = (edge: FrontEdge, radius: number): number => {
    const { u, v, o } = edge;
    const center = sphereCenter(coords, u, v, o, radius);
    if (!center) return -1;
    const ax = coords[u * 3];
    const ay = coords[u * 3 + 1];
    const az = coords[u * 3 + 2];
    const bx = coords[v * 3];
    const by = coords[v * 3 + 1];
    const bz = coords[v * 3 + 2];
    const ex = bx - ax;
    const ey = by - ay;
    const ez = bz - az;
    const elen = Math.hypot(ex, ey, ez);
    if (elen < 1e-12 || elen >= radius * 2) return -1;
    const ux = ex / elen;
    const uy = ey / elen;
    const uz = ez / elen;
    const mx = (ax + bx) * 0.5;
    const my = (ay + by) * 0.5;
    const mz = (az + bz) * 0.5;
    const half = elen * 0.5;
    const circleR = Math.sqrt(Math.max(0, radius * radius - half * half));
    let vx = center[0] - mx;
    let vy = center[1] - my;
    let vz = center[2] - mz;
    const along = vx * ux + vy * uy + vz * uz;
    vx -= ux * along;
    vy -= uy * along;
    vz -= uz * along;
    const vlen = Math.hypot(vx, vy, vz);
    if (vlen < 1e-12 || circleR < 1e-12) return -1;
    const vux = vx / vlen;
    const vuy = vy / vlen;
    const vuz = vz / vlen;
    const found = grid.query(mx, my, mz, radius * 2, scratchB);
    let best = -1;
    let bestAngle = Infinity;
    let bestCx = 0;
    let bestCy = 0;
    let bestCz = 0;
    for (let n = 0; n < found; n++) {
      const p = scratchB[n];
      if (p === u || p === v || p === o) continue;
      if (!edges.canTake(v, u) || !edges.canTake(u, p) || !edges.canTake(p, v)) continue;
      const px = coords[p * 3];
      const py = coords[p * 3 + 1];
      const pz = coords[p * 3 + 2];
      const wx = px - mx;
      const wy = py - my;
      const wz = pz - mz;
      const axial = wx * ux + wy * uy + wz * uz;
      const rx = wx - ux * axial;
      const ry = wy - uy * axial;
      const rz = wz - uz * axial;
      const rho = Math.hypot(rx, ry, rz);
      if (rho < 1e-12) continue;
      const cosAlpha = (circleR * circleR + rho * rho + axial * axial - radius * radius) / (2 * circleR * rho);
      if (cosAlpha > 1.000001 || cosAlpha < -1.000001) continue;
      const clamped = Math.min(1, Math.max(-1, cosAlpha));
      const alpha = Math.acos(clamped);
      const ix = rx / rho;
      const iy = ry / rho;
      const iz = rz / rho;
      const jx = uy * iz - uz * iy;
      const jy = uz * ix - ux * iz;
      const jz = ux * iy - uy * ix;
      const c0 = Math.cos(alpha);
      const s0 = Math.sin(alpha);
      for (let sign = -1; sign <= 1; sign += 2) {
        const dx = ix * c0 + jx * s0 * sign;
        const dy = iy * c0 + jy * s0 * sign;
        const dz = iz * c0 + jz * s0 * sign;
        const cosT = vux * dx + vuy * dy + vuz * dz;
        const cross = ux * (vuy * dz - vuz * dy) + uy * (vuz * dx - vux * dz) + uz * (vux * dy - vuy * dx);
        const angle = Math.atan2(cross, cosT);
        if (angle <= 1e-4 || angle >= bestAngle) continue;
        bestAngle = angle;
        best = p;
        bestCx = mx + dx * circleR;
        bestCy = my + dy * circleR;
        bestCz = mz + dz * circleR;
      }
    }
    if (best < 0) return -1;
    if (!ballEmpty(bestCx, bestCy, bestCz, radius, v, u, best)) {
      // The nearest hit was occupied. Walk the remaining angles once, cheapest first.
      return pivotRelaxed(edge, radius, u, v, mx, my, mz, ux, uy, uz, circleR, vux, vuy, vuz, found);
    }
    return best;
  };

  const pivotRelaxed = (
    _edge: FrontEdge,
    radius: number,
    u: number,
    v: number,
    mx: number,
    my: number,
    mz: number,
    ux: number,
    uy: number,
    uz: number,
    circleR: number,
    vux: number,
    vuy: number,
    vuz: number,
    found: number,
  ): number => {
    const hits: { p: number; angle: number; cx: number; cy: number; cz: number }[] = [];
    for (let n = 0; n < found; n++) {
      const p = scratchB[n];
      if (p === u || p === v || p === _edge.o) continue;
      if (!edges.canTake(v, u) || !edges.canTake(u, p) || !edges.canTake(p, v)) continue;
      const px = coords[p * 3];
      const py = coords[p * 3 + 1];
      const pz = coords[p * 3 + 2];
      const wx = px - mx;
      const wy = py - my;
      const wz = pz - mz;
      const axial = wx * ux + wy * uy + wz * uz;
      const rx = wx - ux * axial;
      const ry = wy - uy * axial;
      const rz = wz - uz * axial;
      const rho = Math.hypot(rx, ry, rz);
      if (rho < 1e-12) continue;
      const cosAlpha = (circleR * circleR + rho * rho + axial * axial - radius * radius) / (2 * circleR * rho);
      if (cosAlpha > 1.000001 || cosAlpha < -1.000001) continue;
      const clamped = Math.min(1, Math.max(-1, cosAlpha));
      const alpha = Math.acos(clamped);
      const ix = rx / rho;
      const iy = ry / rho;
      const iz = rz / rho;
      const jx = uy * iz - uz * iy;
      const jy = uz * ix - ux * iz;
      const jz = ux * iy - uy * ix;
      const c0 = Math.cos(alpha);
      const s0 = Math.sin(alpha);
      for (let sign = -1; sign <= 1; sign += 2) {
        const dx = ix * c0 + jx * s0 * sign;
        const dy = iy * c0 + jy * s0 * sign;
        const dz = iz * c0 + jz * s0 * sign;
        const cosT = vux * dx + vuy * dy + vuz * dz;
        const cross = ux * (vuy * dz - vuz * dy) + uy * (vuz * dx - vux * dz) + uz * (vux * dy - vuy * dx);
        const angle = Math.atan2(cross, cosT);
        if (angle <= 1e-4) continue;
        hits.push({
          p,
          angle,
          cx: mx + dx * circleR,
          cy: my + dy * circleR,
          cz: mz + dz * circleR,
        });
      }
    }
    hits.sort((a, b) => a.angle - b.angle);
    for (const hit of hits) {
      if (ballEmpty(hit.cx, hit.cy, hit.cz, radius, v, u, hit.p)) return hit.p;
    }
    return -1;
  };

  const expand = (radius: number) => {
    const born: FrontEdge[] = [];
    let guard = 0;
    const limit = count * 8;
    while (queue.length > 0 && triCount / 3 < limit) {
      const edge = queue.pop()!;
      if ((guard++ & 255) === 0 && cancelled()) return;
      const face = edges.read(edge.u, edge.v);
      if (face.count !== 1) continue;
      const next = pivot(edge, radius);
      if (next < 0 || !tryAdd(edge.v, edge.u, next, born)) {
        pending.push(edge);
        continue;
      }
      while (born.length > 0) queue.push(born.pop()!);
      if ((guard & 1023) === 0) {
        progress?.(
          0.42 + 0.5 * Math.min(1, (triCount / 3) / Math.max(1, count * 2)),
          `Pivoting r=${radius.toPrecision(3)} · ${(triCount / 3).toLocaleString()} triangles`,
        );
      }
    }
  };

  const seedFail = new Uint8Array(count);
  const findSeed = (radius: number): [number, number, number] | null => {
    const reach = radius * 2;
    for (let i = 0; i < count; i++) {
      if (used[i] || seedFail[i]) continue;
      if ((i & 511) === 0 && cancelled()) return null;
      const nx = normals[i * 3];
      const ny = normals[i * 3 + 1];
      const nz = normals[i * 3 + 2];
      if (nx === 0 && ny === 0 && nz === 0) {
        seedFail[i] = 1;
        continue;
      }
      const found = grid.query(coords[i * 3], coords[i * 3 + 1], coords[i * 3 + 2], reach, scratch);
      const near: { j: number; d2: number }[] = [];
      for (let n = 0; n < found; n++) {
        const j = scratch[n];
        if (j === i) continue;
        const dx = coords[j * 3] - coords[i * 3];
        const dy = coords[j * 3 + 1] - coords[i * 3 + 1];
        const dz = coords[j * 3 + 2] - coords[i * 3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 0 && d2 <= reach * reach) near.push({ j, d2 });
      }
      near.sort((a, b) => a.d2 - b.d2);
      const take = Math.min(12, near.length);
      let attempts = 0;
      for (let a = 0; a < take && attempts < 48; a++) {
        for (let b = a + 1; b < take && attempts < 48; b++) {
          attempts += 1;
          const j = near[a].j;
          const k = near[b].j;
          const oriented = orientTriple(coords, normals, i, j, k);
          if (!oriented) continue;
          const [ia, ib, ic] = oriented;
          const center = sphereCenter(coords, ia, ib, ic, radius);
          if (!center) continue;
          if (!edges.canTake(ia, ib) || !edges.canTake(ib, ic) || !edges.canTake(ic, ia)) continue;
          if (!ballEmpty(center[0], center[1], center[2], radius, ia, ib, ic)) continue;
          return [ia, ib, ic];
        }
      }
      seedFail[i] = 1;
    }
    return null;
  };

  for (let r = 0; r < radii.length; r++) {
    if (cancelled()) break;
    seedFail.fill(0);
    for (let i = 0; i < pending.length; i++) queue.push(pending[i]);
    pending.length = 0;
    expand(radii[r]);
    let seeds = 0;
    while (seeds < count && triCount / 3 < count * 8) {
      const seed = findSeed(radii[r]);
      if (!seed) break;
      const born: FrontEdge[] = [];
      if (!tryAdd(seed[0], seed[1], seed[2], born)) {
        seedFail[seed[0]] = 1;
        continue;
      }
      while (born.length > 0) queue.push(born.pop()!);
      expand(radii[r]);
      seeds += 1;
      if (cancelled()) break;
    }
  }

  let triangles = unpack(triStore, triCount);
  if (options.maxEdgeLength && options.maxEdgeLength > 0) {
    triangles = filterLongEdges(points, triangles, options.maxEdgeLength);
  }
  const fill = options.fillHoles ?? 0;
  if (fill >= 3) triangles = fillSmallHoles(points, triangles, fill, Math.max(...radii) * 2.5);

  let area3D = 0;
  for (const [ia, ib, ic] of triangles) area3D += triangleArea3D(points[ia], points[ib], points[ic]);
  progress?.(1, 'Mesh ready.');
  return {
    points,
    triangles,
    normals,
    radii,
    spacing,
    boundaryEdges: boundaryEdgeCount(triangles),
    area3D,
    bbox: box,
    timingMs: performance.now() - started,
    cancelled: cancelled(),
    orientMode,
  };
}

function orientTriple(
  coords: Float64Array,
  normals: Float32Array,
  i: number,
  j: number,
  k: number,
): [number, number, number] | null {
  const abx = coords[j * 3] - coords[i * 3];
  const aby = coords[j * 3 + 1] - coords[i * 3 + 1];
  const abz = coords[j * 3 + 2] - coords[i * 3 + 2];
  const acx = coords[k * 3] - coords[i * 3];
  const acy = coords[k * 3 + 1] - coords[i * 3 + 1];
  const acz = coords[k * 3 + 2] - coords[i * 3 + 2];
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  if (nx * nx + ny * ny + nz * nz < 1e-18) return null;
  const score =
    nx * normals[i * 3] + ny * normals[i * 3 + 1] + nz * normals[i * 3 + 2] +
    nx * normals[j * 3] + ny * normals[j * 3 + 1] + nz * normals[j * 3 + 2] +
    nx * normals[k * 3] + ny * normals[k * 3 + 1] + nz * normals[k * 3 + 2];
  if (Math.abs(score) < 1e-8) return [i, j, k];
  return score > 0 ? [i, j, k] : [i, k, j];
}

function orientNormals(
  coords: Float64Array,
  count: number,
  normals: Float32Array,
  grid: VoxelGrid,
  spacing: number,
  mode: MeshOrient,
  cancelled: () => boolean,
  progress?: (fraction: number, message: string) => void,
): MeshBuildResult['orientMode'] {
  progress?.(0.3, 'Orienting normals…');
  const seen = new Uint8Array(count);
  const reach = spacing * 4;
  const heapI: number[] = [];
  const heapW: number[] = [];
  const pushH = (index: number, weight: number) => {
    let i = heapI.length;
    heapI.push(index);
    heapW.push(weight);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heapW[parent] <= heapW[i]) break;
      const ti = heapI[parent];
      heapI[parent] = heapI[i];
      heapI[i] = ti;
      const tw = heapW[parent];
      heapW[parent] = heapW[i];
      heapW[i] = tw;
      i = parent;
    }
  };
  const popH = (): number => {
    const top = heapI[0];
    const lastI = heapI.pop() as number;
    const lastW = heapW.pop() as number;
    if (heapI.length > 0) {
      heapI[0] = lastI;
      heapW[0] = lastW;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heapI.length && heapW[l] < heapW[m]) m = l;
        if (r < heapI.length && heapW[r] < heapW[m]) m = r;
        if (m === i) break;
        const ti = heapI[m];
        heapI[m] = heapI[i];
        heapI[i] = ti;
        const tw = heapW[m];
        heapW[m] = heapW[i];
        heapW[i] = tw;
        i = m;
      }
    }
    return top;
  };

  const flip = (index: number) => {
    normals[index * 3] *= -1;
    normals[index * 3 + 1] *= -1;
    normals[index * 3 + 2] *= -1;
  };
  const dotN = (a: number, b: number) =>
    normals[a * 3] * normals[b * 3] + normals[a * 3 + 1] * normals[b * 3 + 1] + normals[a * 3 + 2] * normals[b * 3 + 2];

  for (let seed = 0; seed < count; seed++) {
    if (seen[seed]) continue;
    if (normals[seed * 3] === 0 && normals[seed * 3 + 1] === 0 && normals[seed * 3 + 2] === 0) continue;
    if ((seed & 1023) === 0 && cancelled()) break;
    seen[seed] = 1;
    heapI.length = 0;
    heapW.length = 0;
    const found0 = grid.query(coords[seed * 3], coords[seed * 3 + 1], coords[seed * 3 + 2], reach, scratch);
    for (let n = 0; n < found0; n++) {
      const j = scratch[n];
      if (j !== seed && !seen[j]) pushH(j, 1 - Math.abs(dotN(seed, j)));
    }
    while (heapI.length > 0) {
      const index = popH();
      if (seen[index]) continue;
      let bestFrom = -1;
      let bestWeight = Infinity;
      const found = grid.query(coords[index * 3], coords[index * 3 + 1], coords[index * 3 + 2], reach, scratch);
      for (let n = 0; n < found; n++) {
        const j = scratch[n];
        if (!seen[j] || j === index) continue;
        const weight = 1 - Math.abs(dotN(index, j));
        if (weight < bestWeight) {
          bestWeight = weight;
          bestFrom = j;
        }
      }
      if (bestFrom >= 0 && dotN(index, bestFrom) < 0) flip(index);
      seen[index] = 1;
      for (let n = 0; n < found; n++) {
        const j = scratch[n];
        if (!seen[j]) pushH(j, 1 - Math.abs(dotN(index, j)));
      }
    }
  }

  const shape = classifyCloud(coords, count, spacing);
  const flipAll = () => {
    for (let i = 0; i < count; i++) flip(i);
  };
  if (mode === 'toward-axis' || (mode === 'auto' && shape.tunnel)) {
    let sum = 0;
    let used = 0;
    const step = Math.max(1, Math.floor(count / 4000));
    for (let i = 0; i < count; i += step) {
      const toward = towardAxis(coords, i, shape);
      sum += normals[i * 3] * toward[0] + normals[i * 3 + 1] * toward[1] + normals[i * 3 + 2] * toward[2];
      used += 1;
    }
    if (used > 0 && sum < 0) flipAll();
    return 'toward-axis';
  }
  if (mode === 'outward' || shape.closed) {
    let sum = 0;
    const step = Math.max(1, Math.floor(count / 4000));
    for (let i = 0; i < count; i += step) {
      const ox = coords[i * 3] - shape.cx;
      const oy = coords[i * 3 + 1] - shape.cy;
      const oz = coords[i * 3 + 2] - shape.cz;
      sum += normals[i * 3] * ox + normals[i * 3 + 1] * oy + normals[i * 3 + 2] * oz;
    }
    if (sum < 0) flipAll();
    return 'outward';
  }
  let far = 0;
  let farD = -1;
  for (let i = 0; i < count; i += Math.max(1, Math.floor(count / 4000))) {
    const dx = coords[i * 3] - shape.cx;
    const dy = coords[i * 3 + 1] - shape.cy;
    const dz = coords[i * 3 + 2] - shape.cz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const ox = coords[far * 3] - shape.cx;
  const oy = coords[far * 3 + 1] - shape.cy;
  const oz = coords[far * 3 + 2] - shape.cz;
  if (normals[far * 3] * ox + normals[far * 3 + 1] * oy + normals[far * 3 + 2] * oz < 0) flipAll();
  return 'open';
}

interface CloudShape {
  cx: number;
  cy: number;
  cz: number;
  ax: number;
  ay: number;
  az: number;
  tunnel: boolean;
  closed: boolean;
}

function classifyCloud(coords: Float64Array, count: number, spacing: number): CloudShape {
  const step = Math.max(1, Math.floor(count / 6000));
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let n = 0;
  for (let i = 0; i < count; i += step) {
    cx += coords[i * 3];
    cy += coords[i * 3 + 1];
    cz += coords[i * 3 + 2];
    n += 1;
  }
  cx /= n;
  cy /= n;
  cz /= n;
  let c00 = 0;
  let c01 = 0;
  let c02 = 0;
  let c11 = 0;
  let c12 = 0;
  let c22 = 0;
  for (let i = 0; i < count; i += step) {
    const x = coords[i * 3] - cx;
    const y = coords[i * 3 + 1] - cy;
    const z = coords[i * 3 + 2] - cz;
    c00 += x * x;
    c01 += x * y;
    c02 += x * z;
    c11 += y * y;
    c12 += y * z;
    c22 += z * z;
  }
  const basis = eigenBasis(c00, c01, c02, c11, c12, c22);
  const radii: number[] = [];
  const bins = new Uint16Array(16);
  let mx = 0;
  let my = 0;
  let mz = 0;
  let samples = 0;
  for (let i = 0; i < count; i += step) {
    const x = coords[i * 3] - cx;
    const y = coords[i * 3 + 1] - cy;
    const z = coords[i * 3 + 2] - cz;
    const axial = x * basis.major[0] + y * basis.major[1] + z * basis.major[2];
    const rx = x - basis.major[0] * axial;
    const ry = y - basis.major[1] * axial;
    const rz = z - basis.major[2] * axial;
    const radius = Math.hypot(rx, ry, rz);
    radii.push(radius);
    const u = rx * basis.mid[0] + ry * basis.mid[1] + rz * basis.mid[2];
    const v = rx * basis.minor[0] + ry * basis.minor[1] + rz * basis.minor[2];
    const bin = Math.min(15, Math.floor(((Math.atan2(v, u) + Math.PI) / (Math.PI * 2)) * 16));
    bins[bin] += 1;
    const len = Math.hypot(x, y, z) || 1;
    mx += x / len;
    my += y / len;
    mz += z / len;
    samples += 1;
  }
  const med = median(radii);
  let inner = 0;
  for (const radius of radii) if (radius < med * 0.35) inner += 1;
  let occupied = 0;
  for (const bin of bins) if (bin > samples * 0.02) occupied += 1;
  const round = basis.midValue > 0 && basis.minorValue / basis.midValue > 0.35;
  const elongated = basis.majorValue > basis.midValue * 1.35 && basis.majorValue > 0;
  const tunnel = elongated && round && occupied >= 13 && inner / Math.max(1, radii.length) < 0.18 && med > spacing * 3;
  const spread = Math.hypot(mx, my, mz) / Math.max(1, samples);
  const closed = !tunnel && spread < 0.25 && med > spacing * 2;
  return {
    cx,
    cy,
    cz,
    ax: basis.major[0],
    ay: basis.major[1],
    az: basis.major[2],
    tunnel,
    closed,
  };
}

function towardAxis(coords: Float64Array, index: number, shape: CloudShape): [number, number, number] {
  const x = coords[index * 3] - shape.cx;
  const y = coords[index * 3 + 1] - shape.cy;
  const z = coords[index * 3 + 2] - shape.cz;
  const axial = x * shape.ax + y * shape.ay + z * shape.az;
  const rx = x - shape.ax * axial;
  const ry = y - shape.ay * axial;
  const rz = z - shape.az * axial;
  const len = Math.hypot(rx, ry, rz) || 1;
  return [-rx / len, -ry / len, -rz / len];
}

function eigenBasis(c00: number, c01: number, c02: number, c11: number, c12: number, c22: number): {
  major: [number, number, number];
  mid: [number, number, number];
  minor: [number, number, number];
  majorValue: number;
  midValue: number;
  minorValue: number;
} {
  let a00 = c00;
  let a01 = c01;
  let a02 = c02;
  let a11 = c11;
  let a12 = c12;
  let a22 = c22;
  let v00 = 1;
  let v01 = 0;
  let v02 = 0;
  let v10 = 0;
  let v11 = 1;
  let v12 = 0;
  let v20 = 0;
  let v21 = 0;
  let v22 = 1;
  const rotate = (p: 0 | 1, q: 1 | 2) => {
    const apq = p === 0 && q === 1 ? a01 : p === 0 && q === 2 ? a02 : a12;
    if (Math.abs(apq) < 1e-15) return;
    const app = p === 0 ? a00 : a11;
    const aqq = q === 1 ? a11 : a22;
    const tau = (aqq - app) / (2 * apq);
    const sign = tau >= 0 ? 1 : -1;
    const t = sign / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;
    if (p === 0 && q === 1) {
      a00 = app - t * apq;
      a11 = aqq + t * apq;
      a01 = 0;
      const b02 = c * a02 - s * a12;
      const b12 = s * a02 + c * a12;
      a02 = b02;
      a12 = b12;
      const n00 = c * v00 - s * v01;
      v01 = s * v00 + c * v01;
      v00 = n00;
      const n10 = c * v10 - s * v11;
      v11 = s * v10 + c * v11;
      v10 = n10;
      const n20 = c * v20 - s * v21;
      v21 = s * v20 + c * v21;
      v20 = n20;
    } else if (p === 0 && q === 2) {
      a00 = app - t * apq;
      a22 = aqq + t * apq;
      a02 = 0;
      const b01 = c * a01 - s * a12;
      const b12 = s * a01 + c * a12;
      a01 = b01;
      a12 = b12;
      const n00 = c * v00 - s * v02;
      v02 = s * v00 + c * v02;
      v00 = n00;
      const n10 = c * v10 - s * v12;
      v12 = s * v10 + c * v12;
      v10 = n10;
      const n20 = c * v20 - s * v22;
      v22 = s * v20 + c * v22;
      v20 = n20;
    } else {
      a11 = app - t * apq;
      a22 = aqq + t * apq;
      a12 = 0;
      const b01 = c * a01 - s * a02;
      const b02 = s * a01 + c * a02;
      a01 = b01;
      a02 = b02;
      const n01 = c * v01 - s * v02;
      v02 = s * v01 + c * v02;
      v01 = n01;
      const n11 = c * v11 - s * v12;
      v12 = s * v11 + c * v12;
      v11 = n11;
      const n21 = c * v21 - s * v22;
      v22 = s * v21 + c * v22;
      v21 = n21;
    }
  };
  for (let iter = 0; iter < 16; iter++) {
    rotate(0, 1);
    rotate(0, 2);
    rotate(1, 2);
  }
  const cols: { value: number; v: [number, number, number] }[] = [
    { value: a00, v: [v00, v10, v20] },
    { value: a11, v: [v01, v11, v21] },
    { value: a22, v: [v02, v12, v22] },
  ];
  cols.sort((a, b) => b.value - a.value);
  const unit = (v: [number, number, number]): [number, number, number] => {
    const len = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
  };
  return {
    major: unit(cols[0].v),
    mid: unit(cols[1].v),
    minor: unit(cols[2].v),
    majorValue: cols[0].value,
    midValue: cols[1].value,
    minorValue: cols[2].value,
  };
}

function unpack(store: Uint32Array, count: number): Triangle[] {
  const triangles: Triangle[] = new Array(count / 3);
  for (let i = 0; i < triangles.length; i++) triangles[i] = [store[i * 3], store[i * 3 + 1], store[i * 3 + 2]];
  return triangles;
}

function filterLongEdges(points: SurveyPoint[], triangles: Triangle[], maxEdge: number): Triangle[] {
  const max2 = maxEdge * maxEdge;
  const kept: Triangle[] = [];
  for (const tri of triangles) {
    const a = points[tri[0]];
    const b = points[tri[1]];
    const c = points[tri[2]];
    const ab = (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
    const bc = (b.x - c.x) ** 2 + (b.y - c.y) ** 2 + (b.z - c.z) ** 2;
    const ca = (c.x - a.x) ** 2 + (c.y - a.y) ** 2 + (c.z - a.z) ** 2;
    if (ab <= max2 && bc <= max2 && ca <= max2) kept.push(tri);
  }
  return kept;
}

function fillSmallHoles(points: SurveyPoint[], triangles: Triangle[], maxEdges: number, maxNewEdge: number): Triangle[] {
  const use = new Map<string, number>();
  const outgoing = new Map<number, number[]>();
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const bump = (a: number, b: number) => use.set(key(a, b), (use.get(key(a, b)) ?? 0) + 1);
  for (const [a, b, c] of triangles) {
    bump(a, b);
    bump(b, c);
    bump(c, a);
  }
  const addOut = (u: number, v: number) => {
    const list = outgoing.get(u);
    if (list) list.push(v);
    else outgoing.set(u, [v]);
  };
  for (const [a, b, c] of triangles) {
    if ((use.get(key(a, b)) ?? 0) === 1) addOut(a, b);
    if ((use.get(key(b, c)) ?? 0) === 1) addOut(b, c);
    if ((use.get(key(c, a)) ?? 0) === 1) addOut(c, a);
  }
  const seen = new Set<string>();
  const extra: Triangle[] = [];
  const max2 = maxNewEdge * maxNewEdge;
  for (const [start, nexts] of outgoing) {
    for (const first of nexts) {
      const mark = `${start},${first}`;
      if (seen.has(mark)) continue;
      const loop = [start];
      let prev = start;
      let cur = first;
      let closed = false;
      for (let guard = 0; guard < maxEdges + 2; guard++) {
        seen.add(`${prev},${cur}`);
        loop.push(cur);
        if (cur === start) {
          closed = true;
          loop.pop();
          break;
        }
        const choices = outgoing.get(cur) ?? [];
        const nxt = choices.find((candidate) => candidate !== prev && !seen.has(`${cur},${candidate}`)) ?? choices.find((candidate) => candidate !== prev);
        if (nxt === undefined) break;
        prev = cur;
        cur = nxt;
      }
      if (!closed || loop.length < 3 || loop.length > maxEdges) continue;
      const added = earClip(points, loop);
      for (const tri of added) {
        const a = points[tri[0]];
        const b = points[tri[1]];
        const c = points[tri[2]];
        const ab = (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
        const bc = (b.x - c.x) ** 2 + (b.y - c.y) ** 2 + (b.z - c.z) ** 2;
        const ca = (c.x - a.x) ** 2 + (c.y - a.y) ** 2 + (c.z - a.z) ** 2;
        if (ab > max2 || bc > max2 || ca > max2) continue;
        const kab = key(tri[0], tri[1]);
        const kbc = key(tri[1], tri[2]);
        const kca = key(tri[2], tri[0]);
        if ((use.get(kab) ?? 0) >= 2 || (use.get(kbc) ?? 0) >= 2 || (use.get(kca) ?? 0) >= 2) continue;
        extra.push(tri);
        use.set(kab, (use.get(kab) ?? 0) + 1);
        use.set(kbc, (use.get(kbc) ?? 0) + 1);
        use.set(kca, (use.get(kca) ?? 0) + 1);
      }
    }
  }
  return extra.length > 0 ? triangles.concat(extra) : triangles;
}

function earClip(points: SurveyPoint[], loop: number[]): Triangle[] {
  const origin = points[loop[0]];
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 1; i < loop.length - 1; i++) {
    const b = points[loop[i]];
    const c = points[loop[i + 1]];
    const abx = b.x - origin.x;
    const aby = b.y - origin.y;
    const abz = b.z - origin.z;
    const acx = c.x - origin.x;
    const acy = c.y - origin.y;
    const acz = c.z - origin.z;
    nx += aby * acz - abz * acy;
    ny += abz * acx - abx * acz;
    nz += abx * acy - aby * acx;
  }
  const nlen = Math.hypot(nx, ny, nz);
  if (nlen < 1e-12) return [];
  nx /= nlen;
  ny /= nlen;
  nz /= nlen;
  const ax = Math.abs(nx) < 0.9 ? 1 : 0;
  const ay = Math.abs(nx) < 0.9 ? 0 : 1;
  const az = 0;
  let ux = ay * nz - az * ny;
  let uy = az * nx - ax * nz;
  let uz = ax * ny - ay * nx;
  const ulen = Math.hypot(ux, uy, uz) || 1;
  ux /= ulen;
  uy /= ulen;
  uz /= ulen;
  const vx = ny * uz - nz * uy;
  const vy = nz * ux - nx * uz;
  const vz = nx * uy - ny * ux;
  const flat = loop.map((id) => {
    const p = points[id];
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    const dz = p.z - origin.z;
    return { id, x: dx * ux + dy * uy + dz * uz, y: dx * vx + dy * vy + dz * vz };
  });
  let area = 0;
  for (let i = 0; i < flat.length; i++) {
    const a = flat[i];
    const b = flat[(i + 1) % flat.length];
    area += a.x * b.y - b.x * a.y;
  }
  if (area < 0) flat.reverse();
  const ring = flat.slice();
  const tris: Triangle[] = [];
  let guard = 0;
  while (ring.length > 3 && guard++ < ring.length * ring.length) {
    let clipped = false;
    for (let i = 0; i < ring.length; i++) {
      const prev = ring[(i + ring.length - 1) % ring.length];
      const cur = ring[i];
      const next = ring[(i + 1) % ring.length];
      const cross = (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x);
      if (cross <= 1e-12) continue;
      let inside = false;
      for (const point of ring) {
        if (point === prev || point === cur || point === next) continue;
        if (pointInTri(point, prev, cur, next)) {
          inside = true;
          break;
        }
      }
      if (inside) continue;
      tris.push([prev.id, cur.id, next.id]);
      ring.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (ring.length === 3) tris.push([ring[0].id, ring[1].id, ring[2].id]);
  return tris;
}

function pointInTri(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): boolean {
  const o1 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const o2 = (c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x);
  const o3 = (a.x - c.x) * (p.y - c.y) - (a.y - c.y) * (p.x - c.x);
  return o1 > 1e-12 && o2 > 1e-12 && o3 > 1e-12;
}
