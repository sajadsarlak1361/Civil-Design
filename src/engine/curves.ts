/** Plan curves that do not depend on the drawing model. */

export interface Xy {
  x: number;
  y: number;
  z?: number;
}

export function hypot(a: Xy, b: Xy): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function lerp(a: Xy, b: Xy, t: number): Xy {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t };
}

export function ellipsePoint(center: Xy, major: Xy, ratio: number, t: number): Xy {
  const minorX = -major.y * ratio;
  const minorY = major.x * ratio;
  return {
    x: center.x + Math.cos(t) * major.x + Math.sin(t) * minorX,
    y: center.y + Math.cos(t) * major.y + Math.sin(t) * minorY,
    z: center.z ?? 0,
  };
}

export function ellipsePoints(center: Xy, major: Xy, ratio: number, start: number, end: number, segments = 48): Xy[] {
  const sweep = end - start;
  const n = Math.max(8, Math.ceil(segments * Math.min(1, Math.abs(sweep) / (Math.PI * 2))));
  const pts: Xy[] = [];
  for (let i = 0; i <= n; i++) pts.push(ellipsePoint(center, major, ratio, start + (sweep * i) / n));
  return pts;
}

export function ellipseFromCenterAxis(center: Xy, majorEnd: Xy, minorDistance: number): { major: Xy; ratio: number } | null {
  const major = { x: majorEnd.x - center.x, y: majorEnd.y - center.y, z: 0 };
  const length = Math.hypot(major.x, major.y);
  if (length < 1e-9) return null;
  const ratio = Math.min(1, Math.abs(minorDistance) / length);
  return { major, ratio: ratio <= 0 ? 1 : ratio };
}

export function ellipseFromAxes(a: Xy, b: Xy, other: Xy): { center: Xy; major: Xy; ratio: number } | null {
  const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: a.z ?? 0 };
  const major = { x: b.x - center.x, y: b.y - center.y, z: 0 };
  const length = Math.hypot(major.x, major.y);
  if (length < 1e-9) return null;
  const ux = major.x / length;
  const uy = major.y / length;
  const dx = other.x - center.x;
  const dy = other.y - center.y;
  const minor = Math.abs(-uy * dx + ux * dy);
  return { center, major, ratio: Math.min(1, minor / length) || 1e-4 };
}

/** Centripetal Catmull-Rom through fit points. */
export function fitSpline(points: Xy[], segments = 16, closed = false): Xy[] {
  if (points.length < 2) return points.map((p) => ({ ...p }));
  const src = closed ? [...points, points[0], points[1], points[2] ?? points[0]] : points;
  const out: Xy[] = [];
  const n = closed ? points.length : src.length - 1;
  for (let i = 0; i < n; i++) {
    const p0 = closed ? src[(i - 1 + points.length) % points.length] : src[Math.max(0, i - 1)];
    const p1 = closed ? points[i] : src[i];
    const p2 = closed ? points[(i + 1) % points.length] : src[Math.min(src.length - 1, i + 1)];
    const p3 = closed ? points[(i + 2) % points.length] : src[Math.min(src.length - 1, i + 2)];
    const span = closed || i < src.length - 1 ? segments : 1;
    for (let s = 0; s < span; s++) {
      const t = span === 1 ? 0 : s / span;
      out.push(catmull(p0, p1, p2, p3, t));
    }
  }
  out.push({ ...(closed ? points[0] : src[src.length - 1]) });
  return out;
}

function catmull(p0: Xy, p1: Xy, p2: Xy, p3: Xy, t: number): Xy {
  const t2 = t * t;
  const t3 = t2 * t;
  const x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  const y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
  const z0 = p0.z ?? 0;
  const z1 = p1.z ?? 0;
  const z2 = p2.z ?? 0;
  const z3 = p3.z ?? 0;
  const z = 0.5 * (2 * z1 + (-z0 + z2) * t + (2 * z0 - 5 * z1 + 4 * z2 - z3) * t2 + (-z0 + 3 * z1 - 3 * z2 + z3) * t3);
  return { x, y, z };
}

/** Uniform cubic B-spline through control vertices. Endpoints are clamped. */
export function cvSpline(points: Xy[], segments = 16, closed = false): Xy[] {
  if (points.length < 2) return points.map((p) => ({ ...p }));
  if (points.length === 2) return [points[0], points[1]];
  const src = closed
    ? [points[points.length - 1], ...points, points[0], points[1]]
    : [points[0], ...points, points[points.length - 1]];
  const out: Xy[] = [];
  const spans = closed ? points.length : points.length - 1;
  for (let i = 0; i < spans; i++) {
    const p0 = src[i];
    const p1 = src[i + 1];
    const p2 = src[i + 2];
    const p3 = src[i + 3];
    for (let s = 0; s < segments; s++) {
      const t = s / segments;
      out.push(basis(p0, p1, p2, p3, t));
    }
  }
  out.push(closed ? { ...points[0] } : { ...points[points.length - 1] });
  return out;
}

function basis(p0: Xy, p1: Xy, p2: Xy, p3: Xy, t: number): Xy {
  const t2 = t * t;
  const t3 = t2 * t;
  const b0 = (-t3 + 3 * t2 - 3 * t + 1) / 6;
  const b1 = (3 * t3 - 6 * t2 + 4) / 6;
  const b2 = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6;
  const b3 = t3 / 6;
  return {
    x: b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x,
    y: b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y,
    z: b0 * (p0.z ?? 0) + b1 * (p1.z ?? 0) + b2 * (p2.z ?? 0) + b3 * (p3.z ?? 0),
  };
}

export function splineLength(points: Xy[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += hypot(points[i - 1], points[i]);
  return length;
}

/** Point at distance along a polyline. */
export function pointAtDistance(points: Xy[], distance: number): { point: Xy; index: number; t: number } | null {
  if (points.length === 0) return null;
  if (distance <= 0) return { point: points[0], index: 0, t: 0 };
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const span = hypot(points[i - 1], points[i]);
    if (walked + span >= distance - 1e-9) {
      const t = span < 1e-12 ? 0 : (distance - walked) / span;
      return { point: lerp(points[i - 1], points[i], Math.min(1, Math.max(0, t))), index: i - 1, t };
    }
    walked += span;
  }
  return { point: points[points.length - 1], index: points.length - 2, t: 1 };
}

export function divideDistances(length: number, segments: number): number[] {
  if (segments < 1 || length <= 0) return [];
  const out: number[] = [];
  for (let i = 1; i < segments; i++) out.push((length * i) / segments);
  return out;
}

export function measureDistances(length: number, step: number): number[] {
  if (!(step > 0) || length <= 0) return [];
  const out: number[] = [];
  for (let d = step; d < length - 1e-8; d += step) out.push(d);
  return out;
}

export interface Line2 {
  a: Xy;
  b: Xy;
}

function offsetLine(line: Line2, distance: number): Line2 | null {
  const dx = line.b.x - line.a.x;
  const dy = line.b.y - line.a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const ox = (-dy / len) * distance;
  const oy = (dx / len) * distance;
  return {
    a: { x: line.a.x + ox, y: line.a.y + oy, z: line.a.z },
    b: { x: line.b.x + ox, y: line.b.y + oy, z: line.b.z },
  };
}

function lineLine(a: Xy, b: Xy, c: Xy, d: Xy): Xy | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  return { x: a.x + t * rx, y: a.y + t * ry, z: a.z ?? 0 };
}

/** Circle tangent to two lines with a given radius. Side points pick the offset direction. */
export function circleTtr(line1: Line2, line2: Line2, radius: number, side1: Xy, side2: Xy): { center: Xy; radius: number } | null {
  if (!(radius > 0)) return null;
  const sign = (line: Line2, side: Xy) => {
    const cross = (line.b.x - line.a.x) * (side.y - line.a.y) - (line.b.y - line.a.y) * (side.x - line.a.x);
    return cross >= 0 ? 1 : -1;
  };
  const o1 = offsetLine(line1, sign(line1, side1) * radius);
  const o2 = offsetLine(line2, sign(line2, side2) * radius);
  if (!o1 || !o2) return null;
  const center = lineLine(o1.a, o1.b, o2.a, o2.b);
  return center ? { center, radius } : null;
}

/** Circle tangent to three lines (incenter of the triangle they form). */
export function circleTtt(a: Line2, b: Line2, c: Line2): { center: Xy; radius: number } | null {
  const p = lineLine(a.a, a.b, b.a, b.b);
  const q = lineLine(b.a, b.b, c.a, c.b);
  const r = lineLine(c.a, c.b, a.a, a.b);
  if (!p || !q || !r) return null;
  const ab = hypot(p, q);
  const bc = hypot(q, r);
  const ca = hypot(r, p);
  const per = ab + bc + ca;
  if (per < 1e-9) return null;
  const center = {
    x: (ab * r.x + bc * p.x + ca * q.x) / per,
    y: (ab * r.y + bc * p.y + ca * q.y) / per,
    z: p.z ?? 0,
  };
  const radius = Math.abs((q.x - p.x) * (center.y - p.y) - (q.y - p.y) * (center.x - p.x)) / ab;
  if (!(radius > 1e-8)) return null;
  return { center, radius };
}

export function arcFromStartCenter(start: Xy, center: Xy, end: Xy, sweepSign = 1): { center: Xy; radius: number; startAngle: number; endAngle: number } | null {
  const radius = hypot(center, start);
  if (radius < 1e-9) return null;
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  let sweep = Math.atan2(end.y - center.y, end.x - center.x) - startAngle;
  if (sweepSign >= 0) {
    while (sweep <= 1e-8) sweep += Math.PI * 2;
  } else {
    while (sweep >= -1e-8) sweep -= Math.PI * 2;
  }
  return { center: { ...center, z: center.z ?? 0 }, radius, startAngle, endAngle: startAngle + sweep };
}

export function arcFromStartCenterAngle(start: Xy, center: Xy, angleRad: number): { center: Xy; radius: number; startAngle: number; endAngle: number } | null {
  const radius = hypot(center, start);
  if (radius < 1e-9 || !Number.isFinite(angleRad) || Math.abs(angleRad) < 1e-8) return null;
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  return { center: { ...center, z: center.z ?? 0 }, radius, startAngle, endAngle: startAngle + angleRad };
}

export function arcFromStartCenterLength(start: Xy, center: Xy, chord: number): { center: Xy; radius: number; startAngle: number; endAngle: number } | null {
  const radius = hypot(center, start);
  if (radius < 1e-9 || Math.abs(chord) < 1e-9 || Math.abs(chord) > 2 * radius + 1e-6) return null;
  const sweep = 2 * Math.asin(Math.min(1, Math.abs(chord) / (2 * radius))) * Math.sign(chord || 1);
  return arcFromStartCenterAngle(start, center, sweep);
}

export function arcFromStartEndAngle(start: Xy, end: Xy, angleRad: number): { center: Xy; radius: number; startAngle: number; endAngle: number } | null {
  const chord = hypot(start, end);
  if (chord < 1e-9 || Math.abs(angleRad) < 1e-6 || Math.abs(angleRad) >= Math.PI * 2) return null;
  const radius = chord / (2 * Math.sin(Math.abs(angleRad) / 2));
  const mid = lerp(start, end, 0.5);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const h = Math.sqrt(Math.max(0, radius * radius - (chord * chord) / 4));
  const side = angleRad >= 0 ? 1 : -1;
  const center = { x: mid.x + (-dy / chord) * h * side, y: mid.y + (dx / chord) * h * side, z: start.z ?? 0 };
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  return { center, radius, startAngle, endAngle: startAngle + angleRad };
}

export function arcFromStartEndRadius(start: Xy, end: Xy, radius: number, major = false): { center: Xy; radius: number; startAngle: number; endAngle: number } | null {
  const chord = hypot(start, end);
  if (!(Math.abs(radius) > 0) || chord < 1e-9 || chord > Math.abs(radius) * 2 + 1e-6) return null;
  const r = Math.abs(radius);
  const mid = lerp(start, end, 0.5);
  const dx = (end.x - start.x) / chord;
  const dy = (end.y - start.y) / chord;
  const h = Math.sqrt(Math.max(0, r * r - (chord * chord) / 4));
  const side = radius >= 0 ? 1 : -1;
  const center = { x: mid.x + -dy * h * side, y: mid.y + dx * h * side, z: start.z ?? 0 };
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  let sweep = Math.atan2(end.y - center.y, end.x - center.x) - startAngle;
  while (sweep <= 0) sweep += Math.PI * 2;
  while (sweep > Math.PI * 2) sweep -= Math.PI * 2;
  if (major) sweep = sweep - Math.PI * 2;
  if (!major && sweep > Math.PI) sweep -= Math.PI * 2;
  return { center, radius: r, startAngle, endAngle: startAngle + sweep };
}

export function arcFromStartEndDirection(start: Xy, end: Xy, direction: number): { center: Xy; radius: number; startAngle: number; endAngle: number } | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-9) return null;
  const tx = Math.cos(direction);
  const ty = Math.sin(direction);
  const cross = tx * dy - ty * dx;
  if (Math.abs(cross) < 1e-9) return null;
  const radius = (chord * chord) / (2 * cross);
  const center = { x: start.x - ty * radius, y: start.y + tx * radius, z: start.z ?? 0 };
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  let sweep = Math.atan2(end.y - center.y, end.x - center.x) - startAngle;
  if (radius > 0) {
    while (sweep <= 0) sweep += Math.PI * 2;
  } else {
    while (sweep >= 0) sweep -= Math.PI * 2;
  }
  return { center, radius: Math.abs(radius), startAngle, endAngle: startAngle + sweep };
}

export interface RectOptions {
  chamfer1: number;
  chamfer2: number;
  fillet: number;
  rotation: number;
  elevation: number;
}

export interface PolyV {
  x: number;
  y: number;
  z: number;
  bulge: number;
}

function rot(p: Xy, origin: Xy, angle: number): Xy {
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: origin.x + dx * c - dy * s, y: origin.y + dx * s + dy * c, z: p.z };
}

/** Closed rectangle from two corners, with fillet, chamfer, and rotation about the first corner. */
export function rectangleVertices(a: Xy, b: Xy, opt: RectOptions): PolyV[] {
  const z = opt.elevation || a.z || 0;
  const angle = opt.rotation || 0;
  const p1 = rot(a, a, -angle);
  const p2 = rot(b, a, -angle);
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);
  const w = maxX - minX;
  const h = maxY - minY;
  const corners: Xy[] = [
    { x: minX, y: minY, z },
    { x: maxX, y: minY, z },
    { x: maxX, y: maxY, z },
    { x: minX, y: maxY, z },
  ];
  const fillet = opt.fillet > 0 ? Math.min(opt.fillet, w / 2 - 1e-6, h / 2 - 1e-6) : 0;
  const c1 = opt.chamfer1 > 0 ? Math.min(opt.chamfer1, w / 2, h / 2) : 0;
  const c2 = opt.chamfer2 > 0 ? Math.min(opt.chamfer2, w / 2, h / 2) : 0;
  const raw: PolyV[] = [];
  if (fillet > 0) {
    const bulge = Math.tan(Math.PI / 8);
    const inset = [
      [{ x: minX + fillet, y: minY }, { x: maxX - fillet, y: minY }],
      [{ x: maxX, y: minY + fillet }, { x: maxX, y: maxY - fillet }],
      [{ x: maxX - fillet, y: maxY }, { x: minX + fillet, y: maxY }],
      [{ x: minX, y: maxY - fillet }, { x: minX, y: minY + fillet }],
    ];
    for (const [start, end] of inset) {
      raw.push({ ...rot(start, a, angle), z, bulge: 0 });
      raw.push({ ...rot(end, a, angle), z, bulge });
    }
    return raw;
  }
  if (c1 > 0 || c2 > 0) {
    const dx = c1 || c2;
    const dy = c2 || c1;
    const pts: Xy[] = [
      { x: minX + dx, y: minY },
      { x: maxX - dx, y: minY },
      { x: maxX, y: minY + dy },
      { x: maxX, y: maxY - dy },
      { x: maxX - dx, y: maxY },
      { x: minX + dx, y: maxY },
      { x: minX, y: maxY - dy },
      { x: minX, y: minY + dy },
    ];
    return pts.map((p) => ({ ...rot(p, a, angle), z, bulge: 0 }));
  }
  return corners.map((p) => ({ ...rot(p, a, angle), z, bulge: 0 }));
}

export function rectangleFromArea(anchor: Xy, length: number, area: number): Xy | null {
  if (!(Math.abs(length) > 1e-9) || !(Math.abs(area) > 0)) return null;
  const width = area / length;
  return { x: anchor.x + length, y: anchor.y + width, z: anchor.z ?? 0 };
}

/** Bulged revision-cloud segments along a polyline. */
export function revisionCloud(points: Xy[], chord = 2, closed = true): PolyV[] {
  if (points.length < 2) return [];
  const path = closed ? [...points, points[0]] : points;
  const out: PolyV[] = [];
  const bulge = Math.tan(Math.PI / 6);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = hypot(a, b);
    const n = Math.max(1, Math.round(len / Math.max(chord, 0.1)));
    for (let s = 0; s < n; s++) {
      const p = lerp(a, b, s / n);
      out.push({ x: p.x, y: p.y, z: p.z ?? 0, bulge });
    }
  }
  return out;
}

/** Cubic Hermite blend between two directed ends. */
export function blendCurve(a: Xy, aTan: Xy, b: Xy, bTan: Xy, segments = 16): Xy[] {
  const out: Xy[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    out.push({
      x: h00 * a.x + h10 * aTan.x + h01 * b.x + h11 * bTan.x,
      y: h00 * a.y + h10 * aTan.y + h01 * b.y + h11 * bTan.y,
      z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t,
    });
  }
  return out;
}

/** Sample a polyline bulge. Bulge is tan of one-quarter of the signed sweep. */
export function bulgePoints(a: Xy, b: Xy, bulge: number, segments = 8): Xy[] {
  if (Math.abs(bulge) < 1e-8) return [a, b];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-12) return [a];
  const sweep = 4 * Math.atan(bulge);
  const radius = chord / (2 * Math.sin(sweep / 2));
  const mid = lerp(a, b, 0.5);
  const h = Math.sqrt(Math.max(0, radius * radius - (chord * chord) / 4));
  const side = bulge >= 0 ? 1 : -1;
  const center = { x: mid.x + (-dy / chord) * h * side, y: mid.y + (dx / chord) * h * side, z: a.z ?? 0 };
  const start = Math.atan2(a.y - center.y, a.x - center.x);
  const pts: Xy[] = [];
  const n = Math.max(2, segments);
  for (let i = 0; i <= n; i++) {
    const t = start + (sweep * i) / n;
    pts.push({ x: center.x + Math.cos(t) * Math.abs(radius), y: center.y + Math.sin(t) * Math.abs(radius), z: a.z ?? 0 });
  }
  return pts;
}

export function polygonRing(center: Xy, radius: number, sides: number, rotation = 0): Xy[] {
  const pts: Xy[] = [];
  for (let i = 0; i < sides; i++) {
    const t = rotation + (i / sides) * Math.PI * 2;
    pts.push({ x: center.x + Math.cos(t) * radius, y: center.y + Math.sin(t) * radius, z: center.z ?? 0 });
  }
  return pts;
}
