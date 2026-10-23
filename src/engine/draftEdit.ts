import { mapCadEntity } from './entityOps';
import { dist } from './geometry';
import {
  arcFrom3,
  bulgeArc,
  entityPath,
  lineIntersection,
  pointInBox,
  pointOnArc,
  projectSegment,
  v3,
  type DrawArc,
  type DrawCircle,
  type DrawEntity,
  type DrawLine,
  type DrawPolyline,
  type DrawingDoc,
  type PolyVertex,
  type Vec3,
} from './drafting';
import type { Bounds } from './geometry';

export interface Edit {
  remove: string[];
  add: DrawEntity[];
  replace: DrawEntity[];
  message?: string;
}

const TOL = 1e-7;

function leftNormal(a: Vec3, b: Vec3, distance: number): { x: number; y: number } | null {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < TOL) return null;
  return { x: (-(b.y - a.y) / len) * distance, y: ((b.x - a.x) / len) * distance };
}

export function offsetLine(line: DrawLine, distance: number, side: Vec3, id: string): DrawLine | null {
  const sideSign = (line.b.x - line.a.x) * (side.y - line.a.y) - (line.b.y - line.a.y) * (side.x - line.a.x);
  const directed = leftNormal(line.a, line.b, Math.abs(distance) * (sideSign >= 0 ? 1 : -1));
  if (!directed) return null;
  return {
    ...line,
    id,
    a: { x: line.a.x + directed.x, y: line.a.y + directed.y, z: line.a.z },
    b: { x: line.b.x + directed.x, y: line.b.y + directed.y, z: line.b.z },
  };
}

export function offsetCircle(circle: DrawCircle, distance: number, side: Vec3, id: string): DrawCircle | null {
  const outward = Math.hypot(side.x - circle.center.x, side.y - circle.center.y) >= circle.radius;
  const radius = circle.radius + (outward ? Math.abs(distance) : -Math.abs(distance));
  if (radius <= TOL) return null;
  return { ...circle, id, radius };
}

export function offsetArc(arc: DrawArc, distance: number, side: Vec3, id: string): DrawArc | null {
  const outward = Math.hypot(side.x - arc.center.x, side.y - arc.center.y) >= arc.radius;
  const radius = arc.radius + (outward ? Math.abs(distance) : -Math.abs(distance));
  if (radius <= TOL) return null;
  return { ...arc, id, radius };
}

export function offsetPolyline(poly: DrawPolyline, distance: number, side: Vec3, id: string): DrawPolyline | null {
  const verts = poly.vertices;
  if (verts.length < 2) return null;
  const signed = signedOffset(verts, poly.closed, side, Math.abs(distance));
  const count = poly.closed ? verts.length : verts.length - 1;
  const shifted: { a: Vec3; b: Vec3 }[] = [];
  for (let i = 0; i < count; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    if (Math.abs(a.bulge) > 1e-8) {
      const arc = bulgeArc(a, b, a.bulge);
      if (!arc) return null;
      const midAngle = (arc.startAngle + arc.endAngle) / 2;
      const mid = { x: arc.center.x + Math.cos(midAngle) * arc.radius, y: arc.center.y + Math.sin(midAngle) * arc.radius, z: a.z };
      const radial = Math.hypot(mid.x - arc.center.x, mid.y - arc.center.y) || 1;
      const dir = signed >= 0 ? 1 : -1;
      const mag = Math.abs(signed);
      const nx = ((mid.x - arc.center.x) / radial) * mag * dir;
      const ny = ((mid.y - arc.center.y) / radial) * mag * dir;
      shifted.push({
        a: { x: a.x + nx, y: a.y + ny, z: a.z },
        b: { x: b.x + nx, y: b.y + ny, z: b.z },
      });
      continue;
    }
    const normal = leftNormal(a, b, signed);
    if (!normal) return null;
    shifted.push({
      a: { x: a.x + normal.x, y: a.y + normal.y, z: a.z },
      b: { x: b.x + normal.x, y: b.y + normal.y, z: b.z },
    });
  }
  const next: PolyVertex[] = [];
  for (let i = 0; i < shifted.length; i++) {
    if (!poly.closed && i === 0) next.push({ ...shifted[i].a, bulge: 0 });
    if (i < shifted.length - 1 || poly.closed) {
      const curr = shifted[i];
      const follow = shifted[(i + 1) % shifted.length];
      const hit = lineIntersection(curr.a, curr.b, follow.a, follow.b);
      const point = hit ? { ...hit.point, z: curr.b.z } : curr.b;
      if (next.length === 0) next.push({ ...curr.a, bulge: 0 });
      next.push({ ...point, bulge: 0 });
    } else {
      next.push({ ...shifted[i].b, bulge: 0 });
    }
  }
  const clean = next.filter((point, index) => index === 0 || dist(point, next[index - 1]) > 1e-6);
  if (clean.length < 2) return null;
  return { ...poly, id, vertices: clean, closed: poly.closed };
}

function signedOffset(verts: PolyVertex[], closed: boolean, side: Vec3, distance: number): number {
  const a = verts[0];
  const b = verts[1];
  const cross = (b.x - a.x) * (side.y - a.y) - (b.y - a.y) * (side.x - a.x);
  if (Math.abs(cross) > 1e-8) return cross > 0 ? distance : -distance;
  if (!closed) return distance;
  const ring = verts.map((vertex) => ({ x: vertex.x, y: vertex.y }));
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    area += p.x * q.y - q.x * p.y;
  }
  const inside = pointInRing(side, ring);
  const ccw = area > 0;
  const outward = !inside;
  const leftIsOut = ccw ? false : true;
  return (outward === leftIsOut ? 1 : -1) * distance;
}

function pointInRing(p: Vec3, ring: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const intersect = a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y + 0) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function offsetEntity(entity: DrawEntity, distance: number, side: Vec3, id: string): DrawEntity | null {
  if (entity.type === 'line') return offsetLine(entity, distance, side, id);
  if (entity.type === 'circle') return offsetCircle(entity, distance, side, id);
  if (entity.type === 'arc') return offsetArc(entity, distance, side, id);
  if (entity.type === 'polyline') return offsetPolyline(entity, distance, side, id);
  return null;
}

function lineCuts(line: DrawLine, cutters: DrawEntity[]): number[] {
  const ts: number[] = [];
  for (const cutter of cutters) {
    if (cutter.id === line.id) continue;
    for (const point of intersectionsWithLine(line.a, line.b, cutter)) {
      const dx = line.b.x - line.a.x;
      const dy = line.b.y - line.a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 < TOL) continue;
      const t = ((point.x - line.a.x) * dx + (point.y - line.a.y) * dy) / len2;
      if (t > 1e-4 && t < 1 - 1e-4) ts.push(t);
    }
  }
  return ts;
}

function intersectionsWithLine(a: Vec3, b: Vec3, cutter: DrawEntity): Vec3[] {
  if (cutter.type === 'line') {
    const hit = lineIntersection(a, b, cutter.a, cutter.b);
    if (hit && hit.t >= -1e-6 && hit.t <= 1 + 1e-6 && hit.u >= -1e-6 && hit.u <= 1 + 1e-6) return [{ ...hit.point, z: a.z }];
    return [];
  }
  if (cutter.type === 'polyline') {
    const hits: Vec3[] = [];
    const n = cutter.closed ? cutter.vertices.length : cutter.vertices.length - 1;
    for (let i = 0; i < n; i++) {
      const p = cutter.vertices[i];
      const q = cutter.vertices[(i + 1) % cutter.vertices.length];
      const hit = lineIntersection(a, b, p, q);
      if (hit && hit.t >= -1e-6 && hit.t <= 1 + 1e-6 && hit.u >= -1e-6 && hit.u <= 1 + 1e-6) hits.push({ ...hit.point, z: a.z });
    }
    return hits;
  }
  if (cutter.type === 'circle' || cutter.type === 'arc') {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const fx = a.x - cutter.center.x;
    const fy = a.y - cutter.center.y;
    const A = dx * dx + dy * dy;
    const B = 2 * (fx * dx + fy * dy);
    const C = fx * fx + fy * fy - cutter.radius * cutter.radius;
    const disc = B * B - 4 * A * C;
    if (disc < 0 || A < TOL) return [];
    const root = Math.sqrt(disc);
    const hits: Vec3[] = [];
    for (const t of [(-B - root) / (2 * A), (-B + root) / (2 * A)]) {
      if (t < -1e-6 || t > 1 + 1e-6) continue;
      const point = { x: a.x + dx * t, y: a.y + dy * t, z: a.z };
      if (cutter.type === 'circle' || onArc(cutter, point)) hits.push(point);
    }
    return hits;
  }
  return [];
}

function onArc(arc: DrawArc, p: Vec3): boolean {
  const ang = Math.atan2(p.y - arc.center.y, p.x - arc.center.x);
  const sweep = arc.endAngle - arc.startAngle;
  let delta = ang - arc.startAngle;
  if (sweep >= 0) {
    while (delta < -1e-6) delta += Math.PI * 2;
    return delta <= sweep + 1e-5;
  }
  while (delta > 1e-6) delta -= Math.PI * 2;
  return delta >= sweep - 1e-5;
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

export function trimLine(line: DrawLine, cutters: DrawEntity[], pick: Vec3, ids: () => string): Edit | null {
  const ts = lineCuts(line, cutters);
  if (ts.length === 0) return null;
  const marks = [0, ...ts.sort((a, b) => a - b), 1];
  const proj = projectSegment(pick, line.a, line.b).t;
  let span = 0;
  for (let i = 0; i < marks.length - 1; i++) {
    if (proj >= marks[i] - 1e-6 && proj <= marks[i + 1] + 1e-6) {
      span = i;
      break;
    }
  }
  const t0 = marks[span];
  const t1 = marks[span + 1];
  const add: DrawLine[] = [];
  if (t0 > 1e-4) add.push({ ...line, id: line.id, a: line.a, b: lerp(line.a, line.b, t0) });
  if (t1 < 1 - 1e-4) add.push({ ...line, id: add.length === 0 ? line.id : ids(), a: lerp(line.a, line.b, t1), b: line.b });
  if (add.length === 0) return { remove: [line.id], add: [], replace: [] };
  if (add.length === 1 && add[0].id === line.id) return { remove: [], add: [], replace: add };
  return { remove: [line.id], add, replace: [] };
}

export function trimAt(doc: DrawingDoc, targetId: string, cutterIds: string[], pick: Vec3, ids: () => string): Edit | null {
  const target = doc.entities.find((entity) => entity.id === targetId);
  if (!target) return null;
  const cutters = doc.entities.filter((entity) => (cutterIds.length === 0 || cutterIds.includes(entity.id)) && entity.id !== targetId);
  if (target.type === 'line') return trimLine(target, cutters, pick, ids);
  if (target.type === 'polyline') return trimPolyline(target, cutters, pick, ids);
  return null;
}

function trimPolyline(poly: DrawPolyline, cutters: DrawEntity[], pick: Vec3, ids: () => string): Edit | null {
  const verts = poly.vertices;
  const segCount = poly.closed ? verts.length : verts.length - 1;
  let best = { dist: Infinity, index: -1, t: 0 };
  for (let i = 0; i < segCount; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    if (Math.abs(a.bulge) > 1e-8) continue;
    const proj = projectSegment(pick, a, b);
    if (proj.distance < best.dist) best = { dist: proj.distance, index: i, t: proj.t };
  }
  if (best.index < 0) return null;
  const a = verts[best.index];
  const b = verts[(best.index + 1) % verts.length];
  const fake: DrawLine = { id: poly.id, type: 'line', layer: poly.layer, color: poly.color, a, b };
  const ts = lineCuts(fake, cutters).filter((t) => t > 1e-4 && t < 1 - 1e-4);
  if (ts.length === 0) return null;
  const marks = [0, ...ts.sort((x, y) => x - y), 1];
  let span = 0;
  for (let i = 0; i < marks.length - 1; i++) {
    if (best.t >= marks[i] - 1e-6 && best.t <= marks[i + 1] + 1e-6) span = i;
  }
  const t0 = marks[span];
  const t1 = marks[span + 1];
  if (poly.closed || (t0 > 1e-4 && t1 < 1 - 1e-4)) {
    const left = verts.slice(0, best.index + 1);
    if (t0 > 1e-4) left.push({ ...lerp(a, b, t0), bulge: 0 });
    const right: PolyVertex[] = [{ ...lerp(a, b, t1), bulge: 0 }, ...verts.slice(best.index + 1)];
    const pieces: DrawPolyline[] = [];
    if (left.length >= 2) pieces.push({ ...poly, id: poly.id, vertices: left, closed: false });
    if (right.length >= 2) pieces.push({ ...poly, id: pieces.length === 0 ? poly.id : ids(), vertices: right, closed: false });
    if (pieces.length === 0) return { remove: [poly.id], add: [], replace: [] };
    if (pieces.length === 1 && pieces[0].id === poly.id) return { remove: [], add: [], replace: pieces };
    return { remove: [poly.id], add: pieces, replace: [] };
  }
  const next = verts.map((vertex) => ({ ...vertex }));
  if (t0 <= 1e-4) next[best.index] = { ...lerp(a, b, t1), bulge: 0 };
  else next[(best.index + 1) % next.length] = { ...lerp(a, b, t0), bulge: next[best.index].bulge };
  return { remove: [], add: [], replace: [{ ...poly, vertices: next }] };
}

export function extendEntity(doc: DrawingDoc, targetId: string, boundaryIds: string[], pick: Vec3): Edit | null {
  const target = doc.entities.find((entity) => entity.id === targetId);
  if (!target) return null;
  const bounds = doc.entities.filter((entity) => (boundaryIds.length === 0 || boundaryIds.includes(entity.id)) && entity.id !== targetId);
  if (target.type === 'line') {
    const da = dist(pick, target.a);
    const db = dist(pick, target.b);
    const moveStart = da < db;
    const origin = moveStart ? target.a : target.b;
    const other = moveStart ? target.b : target.a;
    const dir = { x: origin.x - other.x, y: origin.y - other.y };
    const len = Math.hypot(dir.x, dir.y) || 1;
    const far = { x: origin.x + (dir.x / len) * 1e6, y: origin.y + (dir.y / len) * 1e6, z: origin.z };
    let best: { point: Vec3; d: number } | null = null;
    for (const boundary of bounds) {
      for (const point of intersectionsWithLine(origin, far, boundary)) {
        const travel = (point.x - origin.x) * (dir.x / len) + (point.y - origin.y) * (dir.y / len);
        if (travel < 1e-4) continue;
        if (!best || travel < best.d) best = { point, d: travel };
      }
    }
    if (!best) return null;
    const next = { ...target, a: moveStart ? best.point : target.a, b: moveStart ? target.b : best.point };
    return { remove: [], add: [], replace: [next] };
  }
  return null;
}

export interface FilletResult {
  lineA: DrawLine;
  lineB: DrawLine;
  arc: { center: Vec3; radius: number; startAngle: number; endAngle: number } | null;
  corner: Vec3 | null;
}

export function filletLines(a: DrawLine, b: DrawLine, pickA: Vec3, pickB: Vec3, radius: number): FilletResult | null {
  const hit = lineIntersection(a.a, a.b, b.a, b.b);
  if (!hit) return null;
  const P = { ...hit.point, z: a.a.z };
  const dirA = keepDir(a, pickA, P);
  const dirB = keepDir(b, pickB, P);
  if (!dirA || !dirB) return null;
  const dot = dirA.x * dirB.x + dirA.y * dirB.y;
  const theta = Math.acos(Math.min(1, Math.max(-1, dot)));
  if (theta < 1e-4 || Math.abs(Math.PI - theta) < 1e-4) return null;
  if (radius <= 1e-9) {
    return { lineA: trimLineTo(a, P, dirA), lineB: trimLineTo(b, P, dirB), arc: null, corner: P };
  }
  const half = theta / 2;
  const tangent = radius / Math.tan(half);
  const tA = v3(P.x + dirA.x * tangent, P.y + dirA.y * tangent, P.z);
  const tB = v3(P.x + dirB.x * tangent, P.y + dirB.y * tangent, P.z);
  const bis = norm({ x: dirA.x + dirB.x, y: dirA.y + dirB.y });
  if (!bis) return null;
  const centerDist = radius / Math.sin(half);
  const center = v3(P.x + bis.x * centerDist, P.y + bis.y * centerDist, P.z);
  const start = Math.atan2(tA.y - center.y, tA.x - center.x);
  const end = Math.atan2(tB.y - center.y, tB.x - center.x);
  const sweepCcw = (from: number, to: number) => {
    let d = to - from;
    while (d < 0) d += Math.PI * 2;
    return d;
  };
  const ccw = sweepCcw(start, end);
  const signed = ccw <= Math.PI ? ccw : ccw - Math.PI * 2;
  return {
    lineA: trimLineTo(a, tA, dirA),
    lineB: trimLineTo(b, tB, dirB),
    arc: { center, radius, startAngle: start, endAngle: start + signed },
    corner: null,
  };
}

function norm(v: { x: number; y: number }): { x: number; y: number } | null {
  const len = Math.hypot(v.x, v.y);
  if (len < 1e-12) return null;
  return { x: v.x / len, y: v.y / len };
}

function keepDir(line: DrawLine, pick: Vec3, corner: Vec3): { x: number; y: number } | null {
  const proj = projectSegment(pick, line.a, line.b);
  const vx = proj.point.x - corner.x;
  const vy = proj.point.y - corner.y;
  if (Math.hypot(vx, vy) > 1e-6) return norm({ x: vx, y: vy });
  const da = dist(line.a, corner);
  const db = dist(line.b, corner);
  const far = da > db ? line.a : line.b;
  return norm({ x: far.x - corner.x, y: far.y - corner.y });
}

function trimLineTo(line: DrawLine, point: Vec3, dir: { x: number; y: number }): DrawLine {
  const da = (line.a.x - point.x) * dir.x + (line.a.y - point.y) * dir.y;
  const db = (line.b.x - point.x) * dir.x + (line.b.y - point.y) * dir.y;
  if (da >= db) return { ...line, b: point };
  return { ...line, a: point };
}

export function chamferLines(a: DrawLine, b: DrawLine, pickA: Vec3, pickB: Vec3, d1: number, d2: number): { lineA: DrawLine; lineB: DrawLine; chord: [Vec3, Vec3] } | null {
  const hit = lineIntersection(a.a, a.b, b.a, b.b);
  if (!hit) return null;
  const P = { ...hit.point, z: a.a.z };
  const dirA = keepDir(a, pickA, P);
  const dirB = keepDir(b, pickB, P);
  if (!dirA || !dirB) return null;
  const tA = v3(P.x + dirA.x * d1, P.y + dirA.y * d1, P.z);
  const tB = v3(P.x + dirB.x * d2, P.y + dirB.y * d2, P.z);
  return { lineA: trimLineTo(a, tA, dirA), lineB: trimLineTo(b, tB, dirB), chord: [tA, tB] };
}

export function explodeEntity(entity: DrawEntity, ids: () => string): DrawEntity[] | null {
  if (entity.type === 'donut') {
    const circles: DrawEntity[] = [{ id: ids(), type: 'circle', layer: entity.layer, color: entity.color, center: entity.center, radius: entity.outer }];
    if (entity.inner > 1e-6) circles.push({ id: ids(), type: 'circle', layer: entity.layer, color: entity.color, center: entity.center, radius: entity.inner });
    return circles;
  }
  if (entity.type === 'region' || entity.type === 'hatch') {
    return entity.loops.filter((loop) => loop.length >= 2).map((loop) => ({
      id: ids(),
      type: 'polyline' as const,
      layer: entity.layer,
      color: entity.color,
      closed: true,
      vertices: loop.map((point) => ({ ...point, bulge: 0 })),
    }));
  }
  if (entity.type === 'spline') {
    const path = entityPath(entity, 8);
    if (path.length < 2) return null;
    return [{ id: ids(), type: 'polyline', layer: entity.layer, color: entity.color, closed: entity.closed, vertices: path.map((point) => ({ ...point, bulge: 0 })) }];
  }
  if (entity.type !== 'polyline' && entity.type !== 'revcloud') return null;
  const out: DrawEntity[] = [];
  const verts = entity.vertices;
  const n = entity.closed ? verts.length : verts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const arc = bulgeArc(a, b, a.bulge);
    if (arc) {
      out.push({
        id: ids(),
        type: 'arc',
        layer: entity.layer,
        color: entity.color,
        center: arc.center,
        radius: arc.radius,
        startAngle: arc.startAngle,
        endAngle: arc.endAngle,
      });
    } else {
      out.push({ id: ids(), type: 'line', layer: entity.layer, color: entity.color, a: v3(a.x, a.y, a.z), b: v3(b.x, b.y, b.z) });
    }
  }
  return out;
}

function nearlyCollinear(a: DrawLine, b: DrawLine): boolean {
  const dx1 = a.b.x - a.a.x;
  const dy1 = a.b.y - a.a.y;
  const dx2 = b.b.x - b.a.x;
  const dy2 = b.b.y - b.a.y;
  const cross = dx1 * dy2 - dy1 * dx2;
  const len = Math.hypot(dx1, dy1) * Math.hypot(dx2, dy2);
  return len < 1e-12 || Math.abs(cross) / len < 1e-6;
}

function touch(a: Vec3, b: Vec3, tol = 1e-4): boolean {
  return dist(a, b) <= tol;
}

export function joinLines(lines: DrawLine[], id: string): DrawLine | null {
  if (lines.length < 2) return null;
  if (!lines.every((line, index) => index === 0 || nearlyCollinear(lines[0], line))) return null;
  const dir = norm({ x: lines[0].b.x - lines[0].a.x, y: lines[0].b.y - lines[0].a.y });
  if (!dir) return null;
  const pts = lines.flatMap((line) => [line.a, line.b]);
  let min = pts[0];
  let max = pts[0];
  let minT = 0;
  let maxT = 0;
  for (const point of pts) {
    const t = point.x * dir.x + point.y * dir.y;
    if (t < minT) {
      minT = t;
      min = point;
    }
    if (t > maxT) {
      maxT = t;
      max = point;
    }
  }
  const connected = lines.every((line) =>
    lines.some((other) => other !== line && (touch(line.a, other.a) || touch(line.a, other.b) || touch(line.b, other.a) || touch(line.b, other.b))),
  );
  if (!connected) return null;
  return { ...lines[0], id, a: min, b: max };
}

export function joinPolylines(polys: DrawPolyline[], id: string): DrawPolyline | null {
  if (polys.length === 0) return null;
  let verts = polys[0].vertices.map((vertex) => ({ ...vertex }));
  const rest = polys.slice(1).map((poly) => poly.vertices.map((vertex) => ({ ...vertex })));
  let guard = 0;
  while (rest.length > 0 && guard < 20) {
    guard += 1;
    const start = verts[0];
    const end = verts[verts.length - 1];
    const index = rest.findIndex((chain) => touch(end, chain[0]) || touch(end, chain[chain.length - 1]) || touch(start, chain[0]) || touch(start, chain[chain.length - 1]));
    if (index < 0) return null;
    let chain = rest.splice(index, 1)[0];
    if (touch(end, chain[chain.length - 1])) chain = chain.reverse().map((vertex, i, arr) => ({ ...vertex, bulge: i < arr.length - 1 ? -arr[i + 1].bulge : 0 }));
    if (touch(start, chain[0])) {
      chain = chain.reverse().map((vertex, i, arr) => ({ ...vertex, bulge: i < arr.length - 1 ? -arr[i + 1].bulge : 0 }));
      verts = [...chain.slice(0, -1), ...verts];
    } else if (touch(end, chain[0])) {
      verts = [...verts, ...chain.slice(1)];
    } else if (touch(start, chain[chain.length - 1])) {
      verts = [...chain.slice(0, -1), ...verts];
    } else return null;
  }
  if (rest.length > 0) return null;
  return { ...polys[0], id, vertices: verts, closed: false };
}

export function stretchEntity(entity: DrawEntity, box: Bounds | null, dx: number, dy: number): DrawEntity {
  const move = (p: Vec3) => (box === null || pointInBox(p, box) ? { ...p, x: p.x + dx, y: p.y + dy } : p);
  if (entity.type === 'line') return { ...entity, a: move(entity.a), b: move(entity.b) };
  if (entity.type === 'point') return { ...entity, p: move(entity.p) };
  if (entity.type === 'text') return { ...entity, p: move(entity.p) };
  if (entity.type === 'circle') return { ...entity, center: move(entity.center) };
  if (entity.type === 'arc') {
    const start = move(pointOnArc(entity, 0));
    const mid = move(pointOnArc(entity, 0.5));
    const end = move(pointOnArc(entity, 1));
    const arc = arcFrom3(start, mid, end);
    if (!arc) return { ...entity, center: move(entity.center) };
    return { ...entity, ...arc };
  }
  if (entity.type === 'polyline' || entity.type === 'revcloud') {
    return { ...entity, vertices: entity.vertices.map((vertex) => ({ ...vertex, ...move(vertex), bulge: vertex.bulge })) };
  }
  if (entity.type === 'block') return { ...entity, p: move(entity.p) };
  return mapCadEntity(entity, move, 1) ?? entity;
}

export function polygonVertices(center: Vec3, radius: number, sides: number, rotation = 0): PolyVertex[] {
  const verts: PolyVertex[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = rotation + (i / sides) * Math.PI * 2;
    verts.push({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius, z: center.z, bulge: 0 });
  }
  return verts;
}

export function rectVertices(a: Vec3, b: Vec3): PolyVertex[] {
  return [
    { x: a.x, y: a.y, z: a.z, bulge: 0 },
    { x: b.x, y: a.y, z: a.z, bulge: 0 },
    { x: b.x, y: b.y, z: b.z, bulge: 0 },
    { x: a.x, y: b.y, z: a.z, bulge: 0 },
  ];
}

export function closestOnEntity(entity: DrawEntity, pick: Vec3): Vec3 {
  const path = entityPath(entity, 24);
  let best = path[0] ?? pick;
  let bestD = Infinity;
  for (let i = 1; i < path.length; i++) {
    const proj = projectSegment(pick, path[i - 1], path[i]);
    if (proj.distance < bestD) {
      bestD = proj.distance;
      best = { ...proj.point, z: path[i - 1].z };
    }
  }
  return best;
}
