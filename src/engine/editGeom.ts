import { pointAtDistance, splineLength, type Xy } from './curves';

export interface Segment {
  a: Xy;
  b: Xy;
}

export function breakPolyline(points: Xy[], at: number, at2: number): Xy[][] {
  const length = splineLength(points);
  const lo = Math.min(at, at2);
  const hi = Math.max(at, at2);
  if (lo <= 1e-6 && hi >= length - 1e-6) return [];
  const first = slicePolyline(points, 0, lo);
  const second = slicePolyline(points, hi, length);
  return [first, second].filter((part) => part.length >= 2);
}

export function slicePolyline(points: Xy[], start: number, end: number): Xy[] {
  if (end - start < 1e-8) return [];
  const a = pointAtDistance(points, start);
  const b = pointAtDistance(points, end);
  if (!a || !b) return [];
  const out = [a.point];
  for (let i = a.index + 1; i <= b.index; i++) out.push(points[i]);
  out.push(b.point);
  return out;
}

export function lengthenTotal(points: Xy[], total: number): Xy[] {
  const length = splineLength(points);
  if (points.length < 2 || !(total > 0)) return points;
  if (total >= length) {
    const a = points[points.length - 2];
    const b = points[points.length - 1];
    const span = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const extra = total - length;
    return [...points.slice(0, -1), { x: b.x + ((b.x - a.x) / span) * extra, y: b.y + ((b.y - a.y) / span) * extra, z: b.z }];
  }
  const cut = pointAtDistance(points, total);
  if (!cut) return points;
  return [...points.slice(0, cut.index + 1), cut.point];
}

export function lengthenDelta(points: Xy[], delta: number): Xy[] {
  return lengthenTotal(points, splineLength(points) + delta);
}

export function lengthenPercent(points: Xy[], percent: number): Xy[] {
  return lengthenTotal(points, splineLength(points) * (percent / 100));
}

export interface AlignPair {
  from: Xy;
  to: Xy;
}

/** Two-point align: translate, rotate, and optionally scale. */
export function alignTransform(pairs: AlignPair[], scale: boolean): { dx: number; dy: number; angle: number; factor: number; origin: Xy } | null {
  if (pairs.length === 0) return null;
  const origin = pairs[0].from;
  const dest = pairs[0].to;
  if (pairs.length === 1) {
    return { dx: dest.x - origin.x, dy: dest.y - origin.y, angle: 0, factor: 1, origin };
  }
  const a = pairs[0];
  const b = pairs[1];
  const fromAng = Math.atan2(b.from.y - a.from.y, b.from.x - a.from.x);
  const toAng = Math.atan2(b.to.y - a.to.y, b.to.x - a.to.x);
  const fromLen = Math.hypot(b.from.x - a.from.x, b.from.y - a.from.y);
  const toLen = Math.hypot(b.to.x - a.to.x, b.to.y - a.to.y);
  const factor = scale && fromLen > 1e-9 ? toLen / fromLen : 1;
  return { dx: dest.x - origin.x, dy: dest.y - origin.y, angle: toAng - fromAng, factor, origin };
}

export function applyAlign(p: Xy, align: { angle: number; factor: number; origin: Xy; dx: number; dy: number }): Xy {
  const dx = (p.x - align.origin.x) * align.factor;
  const dy = (p.y - align.origin.y) * align.factor;
  const c = Math.cos(align.angle);
  const s = Math.sin(align.angle);
  return { x: align.origin.x + align.dx + dx * c - dy * s, y: align.origin.y + align.dy + dx * s + dy * c, z: p.z };
}

export function sameLine(a: Segment, b: Segment, tol: number): boolean {
  const near = (p: Xy, q: Xy) => Math.hypot(p.x - q.x, p.y - q.y) <= tol;
  return (near(a.a, b.a) && near(a.b, b.b)) || (near(a.a, b.b) && near(a.b, b.a));
}

/** Drop exact duplicate segments and collinear overlaps. Returns the indexes to keep. */
export function overkillIndexes(segments: Segment[], tol = 1e-4): number[] {
  const keep: number[] = [];
  for (let i = 0; i < segments.length; i++) {
    let duplicate = false;
    for (const j of keep) {
      if (sameLine(segments[i], segments[j], tol) || collinearOverlap(segments[i], segments[j], tol)) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) keep.push(i);
  }
  return keep;
}

function collinearOverlap(a: Segment, b: Segment, tol: number): boolean {
  const dx = a.b.x - a.a.x;
  const dy = a.b.y - a.a.y;
  const len = Math.hypot(dx, dy);
  if (len < tol) return false;
  const ux = dx / len;
  const uy = dy / len;
  const dist = (p: Xy) => Math.abs((p.x - a.a.x) * -uy + (p.y - a.a.y) * ux);
  if (dist(b.a) > tol || dist(b.b) > tol) return false;
  const proj = (p: Xy) => (p.x - a.a.x) * ux + (p.y - a.a.y) * uy;
  const a0 = 0;
  const a1 = len;
  const b0 = proj(b.a);
  const b1 = proj(b.b);
  const lo = Math.max(Math.min(a0, a1), Math.min(b0, b1));
  const hi = Math.min(Math.max(a0, a1), Math.max(b0, b1));
  return hi - lo > tol;
}

export interface ArrayItem {
  x: number;
  y: number;
  rotation: number;
}

export function rectangularArray(rows: number, cols: number, rowGap: number, colGap: number): ArrayItem[] {
  const items: ArrayItem[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) items.push({ x: c * colGap, y: r * rowGap, rotation: 0 });
  }
  return items;
}

export function polarArray(count: number, fillAngle: number): ArrayItem[] {
  const items: ArrayItem[] = [];
  const step = count <= 1 ? 0 : fillAngle / (Math.abs(fillAngle - Math.PI * 2) < 1e-6 ? count : count - 1);
  for (let i = 0; i < count; i++) items.push({ x: 0, y: 0, rotation: step * i });
  return items;
}

export function pathArray(path: Xy[], count: number): ArrayItem[] {
  const length = splineLength(path);
  if (count < 1 || length <= 0) return [];
  const items: ArrayItem[] = [];
  for (let i = 0; i < count; i++) {
    const at = pointAtDistance(path, count === 1 ? 0 : (length * i) / (count - 1));
    if (!at) continue;
    const ahead = pointAtDistance(path, Math.min(length, (length * i) / Math.max(1, count - 1) + Math.min(1, length * 0.01)));
    const rotation = ahead ? Math.atan2(ahead.point.y - at.point.y, ahead.point.x - at.point.x) : 0;
    items.push({ x: at.point.x, y: at.point.y, rotation });
  }
  return items;
}

export function reversePoints<T>(points: T[]): T[] {
  return [...points].reverse();
}

export function moveDrawOrder(ids: string[], order: string[], mode: 'front' | 'back' | 'above' | 'below', target?: string): string[] {
  const moving = ids.filter((id) => order.includes(id));
  let rest = order.filter((id) => !moving.includes(id));
  if (mode === 'front') return [...rest, ...moving];
  if (mode === 'back') return [...moving, ...rest];
  if (!target) return order;
  const index = rest.indexOf(target);
  if (index < 0) return order;
  if (mode === 'above') rest = [...rest.slice(0, index + 1), ...moving, ...rest.slice(index + 1)];
  if (mode === 'below') rest = [...rest.slice(0, index), ...moving, ...rest.slice(index)];
  return rest;
}
