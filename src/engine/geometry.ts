import type { Vec2 } from './types';

export type { Vec2 };

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Twice signed area of triangle abc. Positive when abc is CCW. */
export function orient(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

export function signedArea(ring: Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function polygonArea(ring: Vec2[]): number {
  return Math.abs(signedArea(ring));
}

export function ensureCCW<T extends Vec2>(ring: T[]): T[] {
  return signedArea(ring) < 0 ? [...ring].reverse() : ring.slice();
}

export function dedupeRing<T extends Vec2>(ring: T[], tol = 1e-8): T[] {
  const out: T[] = [];
  for (const p of ring) {
    if (out.length === 0 || dist(out[out.length - 1], p) > tol) out.push(p);
  }
  if (out.length > 1 && dist(out[0], out[out.length - 1]) <= tol) out.pop();
  return out;
}

export function pointInTriangleStrict(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const o1 = orient(a, b, p);
  const o2 = orient(b, c, p);
  const o3 = orient(c, a, p);
  const eps = 1e-12;
  const o = orient(a, b, c);
  if (o > 0) return o1 > eps && o2 > eps && o3 > eps;
  if (o < 0) return o1 < -eps && o2 < -eps && o3 < -eps;
  return false;
}

export interface Barycentric {
  w0: number;
  w1: number;
  w2: number;
}

/** Barycentric weights for p relative to triangle abc. w0 corresponds to a. */
export function barycentric(p: Vec2, a: Vec2, b: Vec2, c: Vec2): Barycentric | null {
  const den = orient(a, b, c);
  if (Math.abs(den) < 1e-14) return null;
  const w0 = orient(b, c, p) / den;
  const w1 = orient(c, a, p) / den;
  const w2 = orient(a, b, p) / den;
  return { w0, w1, w2 };
}

export function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2, tol = 1e-8): boolean {
  const w = barycentric(p, a, b, c);
  if (!w) return false;
  return w.w0 >= -tol && w.w1 >= -tol && w.w2 >= -tol;
}

export function pointOnSegment(p: Vec2, a: Vec2, b: Vec2, tol: number): boolean {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len = Math.hypot(abx, aby);
  if (len <= tol) return dist(p, a) <= tol;
  const cross = Math.abs(abx * (p.y - a.y) - aby * (p.x - a.x));
  if (cross / len > tol) return false;
  const dot = (p.x - a.x) * abx + (p.y - a.y) * aby;
  return dot >= -tol * len && dot <= len * len + tol * len;
}

/** Strictly between the endpoints, within a perpendicular tolerance. */
export function pointOnOpenSegment(p: Vec2, a: Vec2, b: Vec2, tol: number): boolean {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const len = Math.sqrt(len2);
  if (len <= tol) return false;
  const cross = Math.abs(abx * (p.y - a.y) - aby * (p.x - a.x));
  if (cross / len > tol) return false;
  const dot = (p.x - a.x) * abx + (p.y - a.y) * aby;
  return dot > tol * len && dot < len2 - tol * len;
}

export function pointInPolygon(p: Vec2, ring: Vec2[], boundaryTol = 1e-7): boolean {
  if (ring.length < 3) return false;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (pointOnSegment(p, a, b, boundaryTol)) return true;
  }
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const intersect =
      a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function segmentsProperlyIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

export function intersectSegmentWithLine(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-18) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const tc = Math.min(1, Math.max(0, t));
  return { x: a.x + tc * rx, y: a.y + tc * ry };
}

/**
 * Sutherland–Hodgman clip. `clip` must be convex and CCW.
 * `subject` may be any simple polygon; output is clipped to `clip`.
 */
export function clipConvexPolygon(subject: Vec2[], clip: Vec2[]): Vec2[] {
  if (subject.length < 3 || clip.length < 3) return [];
  const clipCCW = ensureCCW(clip);
  let output = subject.slice();
  for (let i = 0; i < clipCCW.length; i++) {
    const cs = clipCCW[i];
    const ce = clipCCW[(i + 1) % clipCCW.length];
    const input = output;
    output = [];
    if (input.length === 0) break;
    for (let j = 0; j < input.length; j++) {
      const current = input[j];
      const previous = input[(j + input.length - 1) % input.length];
      const currentIn = orient(cs, ce, current) >= -1e-9;
      const previousIn = orient(cs, ce, previous) >= -1e-9;
      if (currentIn) {
        if (!previousIn) output.push(intersectSegmentWithLine(previous, current, cs, ce));
        output.push(current);
      } else if (previousIn) {
        output.push(intersectSegmentWithLine(previous, current, cs, ce));
      }
    }
  }
  return dedupeRing(output, 1e-8);
}

export function triangleCentroid(a: Vec2, b: Vec2, c: Vec2): Vec2 {
  return { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
}

export function triangleArea2D(a: Vec2, b: Vec2, c: Vec2): number {
  return Math.abs(orient(a, b, c)) / 2;
}

export function triangleArea3D(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  c: { x: number; y: number; z: number },
): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const acz = c.z - a.z;
  const cx = aby * acz - abz * acy;
  const cy = abz * acx - abx * acz;
  const cz = abx * acy - aby * acx;
  return 0.5 * Math.hypot(cx, cy, cz);
}

/** Slope as rise/run. Infinity is returned for a vertical face. */
export function triangleSlope(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  c: { x: number; y: number; z: number },
): number {
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

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(points: Vec2[]): Bounds | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function expandBounds(bounds: Bounds, p: Vec2): Bounds {
  return {
    minX: Math.min(bounds.minX, p.x),
    minY: Math.min(bounds.minY, p.y),
    maxX: Math.max(bounds.maxX, p.x),
    maxY: Math.max(bounds.maxY, p.y),
  };
}

export function boundsOverlap(a: Bounds, b: Bounds, eps = 0): boolean {
  return !(a.maxX < b.minX - eps || b.maxX < a.minX - eps || a.maxY < b.minY - eps || b.maxY < a.minY - eps);
}

export function convexHull(points: Vec2[]): Vec2[] {
  const pts = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  if (pts.length <= 1) return pts;
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && orient(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && orient(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export function densifyClosedRing(ring: Vec2[], spacing: number): Vec2[] {
  if (ring.length < 2 || !(spacing > 0)) return ring.slice();
  const out: Vec2[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const len = dist(a, b);
    const n = Math.max(1, Math.ceil(len / spacing));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

export function normalizeClosedRing(ring: Vec2[]): Vec2[] {
  if (ring.length >= 2 && dist(ring[0], ring[ring.length - 1]) <= 1e-8) return ring.slice(0, -1);
  return ring.slice();
}

/**
 * Incircle predicate. Positive when d is inside the circumcircle of CCW triangle abc.
 * Magnitude is not normalized.
 */
export function incircle(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  const adx = a.x - d.x;
  const ady = a.y - d.y;
  const bdx = b.x - d.x;
  const bdy = b.y - d.y;
  const cdx = c.x - d.x;
  const cdy = c.y - d.y;
  const a2 = adx * adx + ady * ady;
  const b2 = bdx * bdx + bdy * bdy;
  const c2 = cdx * cdx + cdy * cdy;
  return adx * (bdy * c2 - b2 * cdy) - ady * (bdx * c2 - b2 * cdx) + a2 * (bdx * cdy - bdy * cdx);
}
