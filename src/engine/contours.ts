import type { ContourPolyline, SurveyPoint, Triangle } from './types';

interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

const LEVEL_EPS = 1e-7;

function lerp(a: SurveyPoint, b: SurveyPoint, level: number): { x: number; y: number } {
  const denom = b.z - a.z;
  const t = Math.abs(denom) < 1e-14 ? 0 : (level - a.z) / denom;
  const tc = Math.min(1, Math.max(0, t));
  return { x: a.x + (b.x - a.x) * tc, y: a.y + (b.y - a.y) * tc };
}

function triangleSegments(a: SurveyPoint, b: SurveyPoint, c: SurveyPoint, level: number): Segment[] {
  const verts = [a, b, c];
  const on = verts.map((v) => Math.abs(v.z - level) <= LEVEL_EPS);
  const onCount = (on[0] ? 1 : 0) + (on[1] ? 1 : 0) + (on[2] ? 1 : 0);
  if (onCount === 3) return [];
  if (onCount === 2) {
    const idx = [0, 1, 2].filter((i) => on[i]);
    const p = verts[idx[0]];
    const q = verts[idx[1]];
    if (Math.hypot(p.x - q.x, p.y - q.y) < 1e-8) return [];
    return [{ ax: p.x, ay: p.y, bx: q.x, by: q.y }];
  }
  if (onCount === 1) {
    const iOn = on.indexOf(true);
    const others = [0, 1, 2].filter((i) => i !== iOn);
    const z0 = verts[others[0]].z - level;
    const z1 = verts[others[1]].z - level;
    if (z0 * z1 >= 0) return [];
    const hit = lerp(verts[others[0]], verts[others[1]], level);
    const p = verts[iOn];
    if (Math.hypot(p.x - hit.x, p.y - hit.y) < 1e-8) return [];
    return [{ ax: p.x, ay: p.y, bx: hit.x, by: hit.y }];
  }
  const pairs: [SurveyPoint, SurveyPoint][] = [
    [a, b],
    [b, c],
    [c, a],
  ];
  const hits: { x: number; y: number }[] = [];
  for (const [p, q] of pairs) {
    const dp = p.z - level;
    const dq = q.z - level;
    if (dp === 0 || dq === 0 || dp * dq > 0) continue;
    hits.push(lerp(p, q, level));
  }
  if (hits.length !== 2) return [];
  if (Math.hypot(hits[0].x - hits[1].x, hits[0].y - hits[1].y) < 1e-8) return [];
  return [{ ax: hits[0].x, ay: hits[0].y, bx: hits[1].x, by: hits[1].y }];
}

function pointKey(x: number, y: number): string {
  return `${Math.round(x * 1e6)}:${Math.round(y * 1e6)}`;
}

function segmentKey(seg: Segment): string {
  const a = pointKey(seg.ax, seg.ay);
  const b = pointKey(seg.bx, seg.by);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function chainSegments(segments: Segment[]): { points: { x: number; y: number }[]; closed: boolean }[] {
  const unique: Segment[] = [];
  const seen = new Set<string>();
  for (const seg of segments) {
    const key = segmentKey(seg);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(seg);
  }
  if (unique.length === 0) return [];

  const adj = new Map<string, number[]>();
  const pos = new Map<string, { x: number; y: number }>();
  const addEnd = (x: number, y: number, index: number) => {
    const key = pointKey(x, y);
    pos.set(key, { x, y });
    const list = adj.get(key);
    if (list) list.push(index);
    else adj.set(key, [index]);
  };
  unique.forEach((seg, i) => {
    addEnd(seg.ax, seg.ay, i);
    addEnd(seg.bx, seg.by, i);
  });

  const other = (seg: Segment, key: string): string => {
    const ka = pointKey(seg.ax, seg.ay);
    return ka === key ? pointKey(seg.bx, seg.by) : ka;
  };

  const unused = new Set(unique.map((_, i) => i));
  const lines: { points: { x: number; y: number }[]; closed: boolean }[] = [];

  const walk = (startKey: string, prevKey: string): { x: number; y: number }[] => {
    const out: { x: number; y: number }[] = [];
    let prev = prevKey;
    let cur = startKey;
    for (let guard = 0; guard <= unique.length; guard++) {
      const options = (adj.get(cur) ?? []).filter((si) => unused.has(si));
      if (options.length === 0) break;
      const incoming = pos.get(prev);
      const current = pos.get(cur);
      let best = options[0];
      if (options.length > 1 && incoming && current) {
        const ix = current.x - incoming.x;
        const iy = current.y - incoming.y;
        const il = Math.hypot(ix, iy) || 1;
        let bestScore = -Infinity;
        for (const si of options) {
          const nextKey = other(unique[si], cur);
          const next = pos.get(nextKey);
          if (!next) continue;
          const dx = next.x - current.x;
          const dy = next.y - current.y;
          const dl = Math.hypot(dx, dy) || 1;
          const score = (ix * dx + iy * dy) / (il * dl);
          if (score > bestScore) {
            bestScore = score;
            best = si;
          }
        }
      }
      unused.delete(best);
      const nextKey = other(unique[best], cur);
      const next = pos.get(nextKey);
      if (!next) break;
      out.push(next);
      prev = cur;
      cur = nextKey;
    }
    return out;
  };

  for (const seed of unique.keys()) {
    if (!unused.has(seed)) continue;
    unused.delete(seed);
    const seg = unique[seed];
    const ka = pointKey(seg.ax, seg.ay);
    const kb = pointKey(seg.bx, seg.by);
    const forward = walk(kb, ka);
    const backward = walk(ka, kb);
    const a = pos.get(ka)!;
    const b = pos.get(kb)!;
    const points = [...backward.reverse(), a, b, ...forward];
    const closed =
      points.length >= 4 &&
      pointKey(points[0].x, points[0].y) === pointKey(points[points.length - 1].x, points[points.length - 1].y);
    if (points.length >= 2) lines.push({ points, closed });
  }
  return lines;
}

/** Move interior vertices toward their neighbors. A straight polyline stays straight. */
export function smoothPolyline(points: { x: number; y: number }[], closed: boolean, passes = 1): { x: number; y: number }[] {
  if (points.length < 3 || passes < 1) return points.map((point) => ({ ...point }));
  let current = points.map((point) => ({ x: point.x, y: point.y }));
  for (let pass = 0; pass < passes; pass++) {
    const next = current.map((point) => ({ ...point }));
    const count = current.length;
    const begin = closed ? 0 : 1;
    const end = closed ? count : count - 1;
    for (let i = begin; i < end; i++) {
      const prev = current[(i - 1 + count) % count];
      const point = current[i];
      const following = current[(i + 1) % count];
      next[i] = { x: prev.x * 0.25 + point.x * 0.5 + following.x * 0.25, y: prev.y * 0.25 + point.y * 0.5 + following.y * 0.25 };
    }
    current = next;
  }
  return current;
}

function contourLevels(minZ: number, maxZ: number, interval: number): number[] {
  if (!(interval > 0) || !(maxZ > minZ)) return [];
  const start = Math.ceil((minZ + interval * 1e-6) / interval) * interval;
  const end = Math.floor((maxZ - interval * 1e-6) / interval) * interval;
  if (end < start) return [];
  const count = Math.round((end - start) / interval);
  const levels: number[] = [];
  for (let i = 0; i <= count; i++) {
    const level = start + i * interval;
    if (level > maxZ + 1e-6) break;
    levels.push(Math.round(level * 1e8) / 1e8);
  }
  return levels;
}

function isMajorLevel(level: number, major: number): boolean {
  if (!(major > 0)) return false;
  const k = Math.round(level / major);
  return Math.abs(level - k * major) <= Math.max(1e-6, Math.abs(major) * 1e-6);
}

function lowerBound(levels: number[], value: number): number {
  let lo = 0;
  let hi = levels.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (levels[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * March contours in one pass over the triangles.
 * Each triangle only emits the elevations that actually cross it, so a large
 * TIN is O(triangles + segments) instead of O(levels × triangles).
 */
export function generateContours(
  points: SurveyPoint[],
  triangles: Triangle[],
  minorInterval: number,
  majorInterval: number,
  smooth = false,
): ContourPolyline[] {
  if (triangles.length === 0 || !(minorInterval > 0)) return [];
  let minZ = Infinity;
  let maxZ = -Infinity;
  const used = new Uint8Array(points.length);
  for (let i = 0; i < triangles.length; i++) {
    const tri = triangles[i];
    used[tri[0]] = 1;
    used[tri[1]] = 1;
    used[tri[2]] = 1;
  }
  for (let i = 0; i < used.length; i++) {
    if (!used[i]) continue;
    const point = points[i];
    if (!point || !Number.isFinite(point.z)) continue;
    const z = point.z;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (!(maxZ > minZ)) return [];

  const levelMajor = new Map<number, boolean>();
  for (const level of contourLevels(minZ, maxZ, minorInterval)) {
    levelMajor.set(level, isMajorLevel(level, majorInterval));
  }
  if (majorInterval > 0 && Math.abs(majorInterval / minorInterval - Math.round(majorInterval / minorInterval)) > 1e-6) {
    for (const level of contourLevels(minZ, maxZ, majorInterval)) {
      levelMajor.set(level, true);
    }
  }
  const levels = [...levelMajor.keys()].sort((a, b) => a - b);
  if (levels.length === 0) return [];
  const buckets: Segment[][] = levels.map(() => []);

  for (let t = 0; t < triangles.length; t++) {
    const tri = triangles[t];
    const a = points[tri[0]];
    const b = points[tri[1]];
    const c = points[tri[2]];
    if (!a || !b || !c) continue;
    let loZ = a.z;
    let hiZ = a.z;
    if (b.z < loZ) loZ = b.z;
    else if (b.z > hiZ) hiZ = b.z;
    if (c.z < loZ) loZ = c.z;
    else if (c.z > hiZ) hiZ = c.z;
    if (!(hiZ > loZ)) continue;
    for (let i = lowerBound(levels, loZ - 1e-6); i < levels.length && levels[i] <= hiZ + 1e-6; i++) {
      const segs = triangleSegments(a, b, c, levels[i]);
      const bucket = buckets[i];
      for (let s = 0; s < segs.length; s++) bucket.push(segs[s]);
    }
  }

  const polylines: ContourPolyline[] = [];
  for (let i = 0; i < levels.length; i++) {
    const segments = buckets[i];
    if (segments.length === 0) continue;
    const level = levels[i];
    const major = levelMajor.get(level) ?? false;
    const lines = chainSegments(segments);
    for (let k = 0; k < lines.length; k++) {
      const line = lines[k];
      const smoothed = smooth ? smoothPolyline(line.points, line.closed, 2) : line.points;
      const out = new Array<{ x: number; y: number; z: number }>(smoothed.length);
      for (let p = 0; p < smoothed.length; p++) out[p] = { x: smoothed[p].x, y: smoothed[p].y, z: level };
      polylines.push({ elevation: level, major, closed: line.closed, points: out });
    }
  }
  polylines.sort((a, b) => a.elevation - b.elevation || Number(a.major) - Number(b.major));
  return polylines;
}

/** Contours from packed coordinates. `xyz` is x,y,z triples; `indices` is triangle corners. */
export function generateContoursPacked(
  xyz: Float64Array,
  indices: Uint32Array,
  minorInterval: number,
  majorInterval: number,
  smooth = false,
): ContourPolyline[] {
  const count = xyz.length / 3;
  const points: SurveyPoint[] = new Array(count);
  for (let i = 0; i < count; i++) points[i] = { x: xyz[i * 3], y: xyz[i * 3 + 1], z: xyz[i * 3 + 2] };
  const triangles: Triangle[] = new Array(indices.length / 3);
  for (let i = 0; i < triangles.length; i++) triangles[i] = [indices[i * 3], indices[i * 3 + 1], indices[i * 3 + 2]];
  return generateContours(points, triangles, minorInterval, majorInterval, smooth);
}
