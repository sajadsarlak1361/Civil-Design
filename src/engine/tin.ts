import Delaunator from 'delaunator';
import {
  barycentric,
  boundsOf,
  densifyClosedRing,
  dist,
  normalizeClosedRing,
  orient,
  pointInPolygon,
  pointInTriangle,
  pointInTriangleStrict,
  pointOnOpenSegment,
  segmentsProperlyIntersect,
  triangleArea2D,
  triangleCentroid,
} from './geometry';
import type { SurveyPoint, Triangle, Vec2 } from './types';

export interface BuildOptions {
  /** Drop triangles with any edge longer than this. Null keeps every triangle. */
  maxEdgeLength?: number | null;
  /** Closed outer boundary. Triangles whose centroid falls outside are removed. */
  boundary?: Vec2[] | null;
  /** Polylines that must appear as TIN edges. Elevations are taken from the vertices. */
  breaklines?: SurveyPoint[][];
  /** Horizontal snap tolerance when merging coincident vertices. */
  tolerance?: number;
}

export interface Tin {
  points: SurveyPoint[];
  triangles: Triangle[];
}

/** Drop coincident vertices. `kept[i]` is the source index of compact vertex i. */
export function dedupeCoords(xyz: Float64Array, tolerance = 1e-4): { xyz: Float64Array; kept: Uint32Array } {
  const count = xyz.length / 3;
  const cell = Math.max(tolerance, 1e-6);
  const cols = new Map<number, Map<number, number[]>>();
  const kept: number[] = [];
  const out = new Float64Array(xyz.length);
  const tol2 = tolerance * tolerance;
  const find = (x: number, y: number): number => {
    const ix = Math.floor(x / cell);
    const iy = Math.floor(y / cell);
    for (let dx = -1; dx <= 1; dx++) {
      const col = cols.get(ix + dx);
      if (!col) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = col.get(iy + dy);
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k++) {
          const i = bucket[k];
          const ddx = out[i * 3] - x;
          const ddy = out[i * 3 + 1] - y;
          if (ddx * ddx + ddy * ddy <= tol2) return i;
        }
      }
    }
    return -1;
  };
  for (let i = 0; i < count; i++) {
    const x = xyz[i * 3];
    const y = xyz[i * 3 + 1];
    const z = xyz[i * 3 + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (find(x, y) >= 0) continue;
    const id = kept.length;
    kept.push(i);
    out[id * 3] = x;
    out[id * 3 + 1] = y;
    out[id * 3 + 2] = z;
    const ix = Math.floor(x / cell);
    const iy = Math.floor(y / cell);
    let col = cols.get(ix);
    if (!col) {
      col = new Map();
      cols.set(ix, col);
    }
    const bucket = col.get(iy);
    if (bucket) bucket.push(id);
    else col.set(iy, [id]);
  }
  const compact = new Float64Array(kept.length * 3);
  compact.set(out.subarray(0, kept.length * 3));
  return { xyz: compact, kept: Uint32Array.from(kept) };
}

/** Delaunay indices into a packed x,y,z array. Triangles are counterclockwise. */
export function triangulateCoords(xyz: Float64Array): Uint32Array {
  const count = xyz.length / 3;
  if (count < 3) return new Uint32Array(0);
  const coords = new Float64Array(count * 2);
  for (let i = 0; i < count; i++) {
    coords[i * 2] = xyz[i * 3];
    coords[i * 2 + 1] = xyz[i * 3 + 1];
  }
  let delaunay: Delaunator<Float64Array>;
  try {
    delaunay = new Delaunator(coords);
  } catch {
    return new Uint32Array(0);
  }
  const raw = delaunay.triangles;
  const indices = new Uint32Array(raw.length);
  let n = 0;
  for (let t = 0; t < raw.length; t += 3) {
    const ia = raw[t];
    const ib = raw[t + 1];
    const ic = raw[t + 2];
    const ax = xyz[ia * 3];
    const ay = xyz[ia * 3 + 1];
    const bx = xyz[ib * 3];
    const by = xyz[ib * 3 + 1];
    const cx = xyz[ic * 3];
    const cy = xyz[ic * 3 + 1];
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) <= 1e-12) continue;
    if (area > 0) {
      indices[n++] = ia;
      indices[n++] = ib;
      indices[n++] = ic;
    } else {
      indices[n++] = ia;
      indices[n++] = ic;
      indices[n++] = ib;
    }
  }
  return indices.slice(0, n);
}

export function triangulate(points: Vec2[]): Triangle[] {
  if (points.length < 3) return [];
  const coords = new Float64Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    coords[i * 2] = points[i].x;
    coords[i * 2 + 1] = points[i].y;
  }
  let delaunay: Delaunator<Float64Array>;
  try {
    delaunay = new Delaunator(coords);
  } catch {
    return [];
  }
  const triangles: Triangle[] = [];
  for (let t = 0; t < delaunay.triangles.length; t += 3) {
    const ia = delaunay.triangles[t];
    const ib = delaunay.triangles[t + 1];
    const ic = delaunay.triangles[t + 2];
    const area = orient(points[ia], points[ib], points[ic]);
    if (Math.abs(area) <= 1e-12) continue;
    if (area > 0) triangles.push([ia, ib, ic]);
    else triangles.push([ia, ic, ib]);
  }
  return triangles;
}

class PointIndex {
  private readonly cols = new Map<number, Map<number, number[]>>();

  constructor(
    private readonly points: SurveyPoint[],
    private readonly cell: number,
  ) {}

  add(index: number): void {
    const p = this.points[index];
    const ix = Math.floor(p.x / this.cell);
    const iy = Math.floor(p.y / this.cell);
    let col = this.cols.get(ix);
    if (!col) {
      col = new Map();
      this.cols.set(ix, col);
    }
    const bucket = col.get(iy);
    if (bucket) bucket.push(index);
    else col.set(iy, [index]);
  }

  find(x: number, y: number, tol: number): number {
    const ix = Math.floor(x / this.cell);
    const iy = Math.floor(y / this.cell);
    const tol2 = tol * tol;
    for (let dx = -1; dx <= 1; dx++) {
      const col = this.cols.get(ix + dx);
      if (!col) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = col.get(iy + dy);
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k++) {
          const i = bucket[k];
          const p = this.points[i];
          const ddx = p.x - x;
          const ddy = p.y - y;
          if (ddx * ddx + ddy * ddy <= tol2) return i;
        }
      }
    }
    return -1;
  }
}

function estimateSpacing(points: SurveyPoint[]): number {
  const bounds = boundsOf(points);
  if (!bounds || points.length < 2) return 1;
  const area = Math.max((bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY), 1e-6);
  return Math.max(Math.sqrt(area / points.length), 1e-3);
}

function nearestZ(points: SurveyPoint[], x: number, y: number): number {
  let best = points[0]?.z ?? 0;
  let bestD = Infinity;
  for (const p of points) {
    const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
    if (d < bestD) {
      bestD = d;
      best = p.z;
    }
  }
  return best;
}

export function elevationAt(
  points: SurveyPoint[],
  triangles: Triangle[],
  x: number,
  y: number,
  index?: { candidatesAt(x: number, y: number): number[] },
): number | null {
  const probe = { x, y };
  const candidates = index ? index.candidatesAt(x, y) : triangles.map((_, i) => i);
  for (const ti of candidates) {
    const [ia, ib, ic] = triangles[ti];
    const a = points[ia];
    const b = points[ib];
    const c = points[ic];
    if (!pointInTriangle(probe, a, b, c, 1e-7)) continue;
    const w = barycentric(probe, a, b, c);
    if (!w) continue;
    return w.w0 * a.z + w.w1 * b.z + w.w2 * c.z;
  }
  return null;
}

export function slopeAt(
  points: SurveyPoint[],
  triangles: Triangle[],
  x: number,
  y: number,
  index?: { candidatesAt(x: number, y: number): number[] },
): number | null {
  const probe = { x, y };
  const candidates = index ? index.candidatesAt(x, y) : triangles.map((_, i) => i);
  for (const ti of candidates) {
    const [ia, ib, ic] = triangles[ti];
    const a = points[ia];
    const b = points[ib];
    const c = points[ic];
    if (!pointInTriangle(probe, a, b, c, 1e-7)) continue;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const acx = c.x - a.x;
    const acy = c.y - a.y;
    const acz = c.z - a.z;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const horiz = Math.hypot(nx, ny);
    if (Math.abs(nz) < 1e-14) return horiz < 1e-14 ? 0 : Number.POSITIVE_INFINITY;
    return horiz / Math.abs(nz);
  }
  return null;
}

/**
 * Build a TIN from survey points.
 * Boundary rings are densified, inserted, and enforced as constrained edges.
 * Breaklines are constrained edges with the elevations stored on their vertices.
 * Triangles outside an outer boundary, or with an edge longer than the maximum, are removed.
 */
function buildTinSimple(input: SurveyPoint[], tol: number): Tin {
  const xyz = new Float64Array(input.length * 3);
  const finite: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const point = input[i];
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) continue;
    const n = finite.length;
    xyz[n * 3] = point.x;
    xyz[n * 3 + 1] = point.y;
    xyz[n * 3 + 2] = point.z;
    finite.push(i);
  }
  const packed = dedupeCoords(xyz.subarray(0, finite.length * 3), tol);
  const indices = triangulateCoords(packed.xyz);
  const points: SurveyPoint[] = new Array(packed.kept.length);
  for (let i = 0; i < packed.kept.length; i++) {
    const src = input[finite[packed.kept[i]]];
    points[i] = {
      x: packed.xyz[i * 3],
      y: packed.xyz[i * 3 + 1],
      z: packed.xyz[i * 3 + 2],
      number: src.number,
      description: src.description,
      role: src.role ?? 'survey',
    };
  }
  const triangles: Triangle[] = new Array(indices.length / 3);
  for (let i = 0; i < triangles.length; i++) triangles[i] = [indices[i * 3], indices[i * 3 + 1], indices[i * 3 + 2]];
  return { points, triangles };
}

export function buildTin(input: SurveyPoint[], options: BuildOptions = {}): Tin {
  const tol = options.tolerance ?? 1e-4;
  const constrained =
    (options.boundary != null && options.boundary.length >= 3) ||
    (options.breaklines != null && options.breaklines.length > 0) ||
    (options.maxEdgeLength != null && options.maxEdgeLength > 0);
  if (!constrained) return buildTinSimple(input, tol);
  const points: SurveyPoint[] = [];
  const index = new PointIndex(points, Math.max(tol, 1e-6));

  const add = (p: SurveyPoint, overwriteZ: boolean): number => {
    const existing = index.find(p.x, p.y, tol);
    if (existing >= 0) {
      if (overwriteZ) points[existing].z = p.z;
      return existing;
    }
    points.push({
      x: p.x,
      y: p.y,
      z: p.z,
      number: p.number,
      description: p.description,
      role: p.role ?? 'survey',
    });
    const id = points.length - 1;
    index.add(id);
    return id;
  };

  for (const p of input) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
    add({ ...p, role: p.role ?? 'survey' }, false);
  }
  if (points.length < 3) return { points, triangles: [] };

  let triangles = triangulate(points);
  const segments: [number, number][] = [];
  const boundary = options.boundary && options.boundary.length >= 3 ? normalizeClosedRing(options.boundary) : null;

  if (boundary) {
    let spacing = estimateSpacing(points);
    if (options.maxEdgeLength && options.maxEdgeLength > 0) {
      spacing = Math.min(spacing, options.maxEdgeLength * 0.75);
    }
    const dense = densifyClosedRing(boundary, spacing);
    let first = -1;
    let prev = -1;
    for (const vertex of dense) {
      const z = elevationAt(points, triangles, vertex.x, vertex.y) ?? nearestZ(points, vertex.x, vertex.y);
      const id = add({ x: vertex.x, y: vertex.y, z, role: 'boundary', description: 'BOUNDARY' }, false);
      if (first < 0) first = id;
      if (prev >= 0 && prev !== id) segments.push([prev, id]);
      prev = id;
    }
    if (prev >= 0 && first >= 0 && prev !== first) segments.push([prev, first]);
  }

  if (options.breaklines) {
    for (const line of options.breaklines) {
      if (line.length < 2) continue;
      let prev = -1;
      for (const vertex of line) {
        if (!Number.isFinite(vertex.x) || !Number.isFinite(vertex.y) || !Number.isFinite(vertex.z)) continue;
        const id = add({ ...vertex, role: 'breakline' }, true);
        if (prev >= 0 && prev !== id) segments.push([prev, id]);
        prev = id;
      }
    }
  }

  if (boundary || (options.breaklines && options.breaklines.length > 0)) {
    triangles = triangulate(points);
  }
  if (segments.length > 0) {
    triangles = applyConstraints(points, triangles, segments);
  }
  if (options.maxEdgeLength && options.maxEdgeLength > 0) {
    const maxEdge = options.maxEdgeLength;
    const constrained = new Set(segments.map(([a, b]) => edgeKey(a, b)));
    triangles = triangles.filter((tri) => {
      const edges: [number, number][] = [
        [tri[0], tri[1]],
        [tri[1], tri[2]],
        [tri[2], tri[0]],
      ];
      for (const [u, v] of edges) {
        if (constrained.has(edgeKey(u, v))) continue;
        if (dist(points[u], points[v]) > maxEdge) return false;
      }
      return true;
    });
  }
  if (boundary) {
    triangles = triangles.filter((tri) => {
      const c = triangleCentroid(points[tri[0]], points[tri[1]], points[tri[2]]);
      return pointInPolygon(c, boundary);
    });
  }
  return { points, triangles };
}

export function longestEdge(points: Vec2[], tri: Triangle): number {
  const a = points[tri[0]];
  const b = points[tri[1]];
  const c = points[tri[2]];
  return Math.max(dist(a, b), dist(b, c), dist(c, a));
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function triEdges(tri: Triangle): [number, number][] {
  return [
    [tri[0], tri[1]],
    [tri[1], tri[2]],
    [tri[2], tri[0]],
  ];
}

function edgeExists(triangles: Triangle[], a: number, b: number): boolean {
  const key = edgeKey(a, b);
  for (const tri of triangles) {
    if (
      edgeKey(tri[0], tri[1]) === key ||
      edgeKey(tri[1], tri[2]) === key ||
      edgeKey(tri[2], tri[0]) === key
    ) {
      return true;
    }
  }
  return false;
}

function pointsAlongSegment(points: Vec2[], a: number, b: number, tol: number): number[] {
  const start = points[a];
  const end = points[b];
  const abx = end.x - start.x;
  const aby = end.y - start.y;
  const hits: { i: number; t: number }[] = [{ i: a, t: 0 }];
  for (let i = 0; i < points.length; i++) {
    if (i === a || i === b) continue;
    if (!pointOnOpenSegment(points[i], start, end, tol)) continue;
    const t = ((points[i].x - start.x) * abx + (points[i].y - start.y) * aby) / (abx * abx + aby * aby);
    hits.push({ i, t });
  }
  hits.push({ i: b, t: 1 });
  hits.sort((p, q) => p.t - q.t);
  const chain: number[] = [];
  for (const hit of hits) {
    if (chain.length === 0 || chain[chain.length - 1] !== hit.i) chain.push(hit.i);
  }
  return chain;
}

function triangleStabbed(points: Vec2[], tri: Triangle, a: number, b: number): boolean {
  const pa = points[a];
  const pb = points[b];
  for (const [u, v] of triEdges(tri)) {
    if (u === a || u === b || v === a || v === b) continue;
    if (segmentsProperlyIntersect(pa, pb, points[u], points[v])) return true;
  }
  return false;
}

function orderLoop(edges: [number, number][]): number[] | null {
  const adj = new Map<number, number[]>();
  for (const [u, v] of edges) {
    if (!adj.has(u)) adj.set(u, []);
    if (!adj.has(v)) adj.set(v, []);
    adj.get(u)!.push(v);
    adj.get(v)!.push(u);
  }
  for (const neighbors of adj.values()) {
    if (neighbors.length !== 2) return null;
  }
  if (edges.length < 3) return null;
  const start = edges[0][0];
  const loop = [start];
  let prev = -1;
  let cur = start;
  for (let guard = 0; guard <= edges.length; guard++) {
    const neighbors = adj.get(cur);
    if (!neighbors) return null;
    const next = neighbors[0] === prev ? neighbors[1] : neighbors[0];
    if (next === undefined) return null;
    if (next === start) return loop.length >= 3 ? loop : null;
    loop.push(next);
    prev = cur;
    cur = next;
    if (loop.length > edges.length) return null;
  }
  return null;
}

function chainBetween(ring: number[], from: number, to: number): number[] {
  const out: number[] = [];
  let i = from;
  for (let guard = 0; guard <= ring.length; guard++) {
    out.push(ring[i]);
    if (i === to) return out;
    i = (i + 1) % ring.length;
  }
  return out;
}

function polygonIndexArea(ids: number[], points: Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < ids.length; i++) {
    const a = points[ids[i]];
    const b = points[ids[(i + 1) % ids.length]];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function earClip(indices: number[], points: Vec2[]): Triangle[] | null {
  let ids = indices.filter((id, i) => i === 0 || id !== indices[i - 1]);
  if (ids.length > 1 && ids[0] === ids[ids.length - 1]) ids = ids.slice(0, -1);
  if (ids.length < 3) return null;
  if (polygonIndexArea(ids, points) < 0) ids = [...ids].reverse();
  if (ids.length === 3) {
    if (orient(points[ids[0]], points[ids[1]], points[ids[2]]) <= 1e-12) return null;
    return [[ids[0], ids[1], ids[2]]];
  }
  const rem = ids.slice();
  const triangles: Triangle[] = [];
  let guard = 0;
  while (rem.length > 3 && guard++ < rem.length * rem.length + 5) {
    let clipped = false;
    for (let i = 0; i < rem.length; i++) {
      const i0 = rem[(i + rem.length - 1) % rem.length];
      const i1 = rem[i];
      const i2 = rem[(i + 1) % rem.length];
      if (orient(points[i0], points[i1], points[i2]) <= 1e-12) continue;
      let contains = false;
      for (const j of rem) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (pointInTriangleStrict(points[j], points[i0], points[i1], points[i2])) {
          contains = true;
          break;
        }
      }
      if (contains) continue;
      triangles.push([i0, i1, i2]);
      rem.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) return null;
  }
  if (rem.length !== 3) return null;
  if (orient(points[rem[0]], points[rem[1]], points[rem[2]]) <= 1e-12) return null;
  triangles.push([rem[0], rem[1], rem[2]]);
  return triangles;
}

function triangleListArea(triangles: Triangle[], points: Vec2[]): number {
  let area = 0;
  for (const [a, b, c] of triangles) area += triangleArea2D(points[a], points[b], points[c]);
  return area;
}

function insertConstraint(points: Vec2[], triangles: Triangle[], a: number, b: number): Triangle[] {
  if (a === b || edgeExists(triangles, a, b)) return triangles;
  const stabbed: number[] = [];
  for (let i = 0; i < triangles.length; i++) {
    if (triangleStabbed(points, triangles[i], a, b)) stabbed.push(i);
  }
  if (stabbed.length === 0) return triangles;

  const edgeUse = new Map<string, { u: number; v: number; count: number }>();
  for (const ti of stabbed) {
    for (const [u, v] of triEdges(triangles[ti])) {
      const key = edgeKey(u, v);
      const rec = edgeUse.get(key);
      if (rec) rec.count++;
      else edgeUse.set(key, { u, v, count: 1 });
    }
  }
  const boundary: [number, number][] = [];
  for (const rec of edgeUse.values()) {
    if (rec.count === 1) boundary.push([rec.u, rec.v]);
  }
  const ring = orderLoop(boundary);
  if (!ring) return triangles;
  const iA = ring.indexOf(a);
  const iB = ring.indexOf(b);
  if (iA < 0 || iB < 0) return triangles;
  const chainA = chainBetween(ring, iA, iB);
  const chainB = chainBetween(ring, iB, iA);
  const left = earClip(chainA, points);
  const right = earClip(chainB, points);
  if (!left || !right) return triangles;

  const stabbedSet = new Set(stabbed);
  const before = triangleListArea(
    stabbed.map((i) => triangles[i]),
    points,
  );
  const after = triangleListArea(left, points) + triangleListArea(right, points);
  if (Math.abs(before - after) > Math.max(1e-5, before * 1e-4)) return triangles;

  const next = triangles.filter((_, i) => !stabbedSet.has(i));
  next.push(...left, ...right);
  return next;
}

export function applyConstraints(points: Vec2[], triangles: Triangle[], segments: [number, number][]): Triangle[] {
  let current = triangles;
  for (const [a, b] of segments) {
    if (a === b) continue;
    const chain = pointsAlongSegment(points, a, b, 1e-6);
    for (let i = 0; i < chain.length - 1; i++) {
      current = insertConstraint(points, current, chain[i], chain[i + 1]);
    }
  }
  return current;
}

/** Uniform grid of triangle indices for point location and overlay queries. */
export class TriangleIndex {
  private readonly cells = new Map<string, number[]>();
  private readonly originX: number;
  private readonly originY: number;
  private readonly cell: number;

  constructor(points: Vec2[], triangles: Triangle[]) {
    const bounds = boundsOf(points) ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    this.originX = bounds.minX;
    this.originY = bounds.minY;
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1e-6);
    const n = Math.max(1, Math.ceil(Math.sqrt(Math.max(triangles.length, 1))));
    this.cell = span / n;
    for (let i = 0; i < triangles.length; i++) {
      const [ia, ib, ic] = triangles[i];
      const xs = [points[ia].x, points[ib].x, points[ic].x];
      const ys = [points[ia].y, points[ib].y, points[ic].y];
      const i0 = this.ix(Math.min(...xs));
      const i1 = this.ix(Math.max(...xs));
      const j0 = this.iy(Math.min(...ys));
      const j1 = this.iy(Math.max(...ys));
      for (let ix = i0; ix <= i1; ix++) {
        for (let iy = j0; iy <= j1; iy++) {
          const key = `${ix}:${iy}`;
          const bucket = this.cells.get(key);
          if (bucket) bucket.push(i);
          else this.cells.set(key, [i]);
        }
      }
    }
  }

  candidatesAt(x: number, y: number): number[] {
    return this.cells.get(`${this.ix(x)}:${this.iy(y)}`) ?? [];
  }

  candidatesIn(minX: number, minY: number, maxX: number, maxY: number): number[] {
    const seen = new Set<number>();
    const out: number[] = [];
    const i0 = this.ix(minX);
    const i1 = this.ix(maxX);
    const j0 = this.iy(minY);
    const j1 = this.iy(maxY);
    for (let ix = i0; ix <= i1; ix++) {
      for (let iy = j0; iy <= j1; iy++) {
        const bucket = this.cells.get(`${ix}:${iy}`);
        if (!bucket) continue;
        for (const tri of bucket) {
          if (seen.has(tri)) continue;
          seen.add(tri);
          out.push(tri);
        }
      }
    }
    return out;
  }

  private ix(x: number): number {
    return Math.floor((x - this.originX) / this.cell);
  }

  private iy(y: number): number {
    return Math.floor((y - this.originY) / this.cell);
  }
}
