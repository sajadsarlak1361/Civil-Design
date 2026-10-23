/**
 * Exact triangle–plane sections of a 3D mesh, chained into closed loops,
 * and the overbreak / underbreak between an as-built loop and a design template.
 * Planes used for tunnel sections are vertical and perpendicular to an alignment,
 * so the drawing axes are offset (right of station) and elevation.
 */

import { dedupeRing, ensureCCW, orient, polygonArea, signedArea, type Vec2 } from './geometry';
import type { SurveyPoint, Triangle } from './types';

export interface SectionVertex {
  offset: number;
  z: number;
  x: number;
  y: number;
}

export interface SectionLoop {
  closed: boolean;
  points: SectionVertex[];
}

export interface SectionPlane {
  ox: number;
  oy: number;
  oz: number;
  /** Unit normal. For an alignment section this is the forward tangent. */
  nx: number;
  ny: number;
  nz: number;
  /** Unit offset axis, lying in the plane. Positive is to the right of increasing station. */
  rx: number;
  ry: number;
  rz: number;
  station: number;
}

export interface DesignPoint {
  offset: number;
  z: number;
}

export interface BreakRegion {
  points: DesignPoint[];
  area: number;
}

export interface BreakComparison {
  overbreakArea: number;
  underbreakArea: number;
  maxOverbreak: number;
  maxUnderbreak: number;
  overbreak: BreakRegion[];
  underbreak: BreakRegion[];
}

export interface MeshCrossSection {
  station: number;
  loops: SectionLoop[];
  /** Area of the largest closed loop. Open polylines contribute perimeter only. */
  area: number;
  perimeter: number;
  centroid: DesignPoint;
  comparison: BreakComparison | null;
}

interface RawSeg {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
}

function planeScale(plane: SectionPlane, points: SurveyPoint[]): number {
  let max = 1;
  const step = Math.max(1, Math.floor(points.length / 2000));
  for (let i = 0; i < points.length; i += step) {
    const p = points[i];
    max = Math.max(max, Math.abs(p.x), Math.abs(p.y), Math.abs(p.z));
  }
  return Math.max(max, Math.hypot(plane.ox, plane.oy, plane.oz), 1);
}

/** Intersect every triangle with the plane and chain the cut into polylines. */
export function intersectMeshPlane(points: SurveyPoint[], triangles: Triangle[], plane: SectionPlane): SectionLoop[] {
  const eps = 1e-9 * planeScale(plane, points);
  const segments: RawSeg[] = [];
  for (let t = 0; t < triangles.length; t++) {
    const [ia, ib, ic] = triangles[t];
    const tri = [points[ia], points[ib], points[ic]];
    const dist = tri.map((p) => (p.x - plane.ox) * plane.nx + (p.y - plane.oy) * plane.ny + (p.z - plane.oz) * plane.nz);
    const hits: { x: number; y: number; z: number }[] = [];
    for (let e = 0; e < 3; e++) {
      const a = tri[e];
      const b = tri[(e + 1) % 3];
      const da = dist[e];
      const db = dist[(e + 1) % 3];
      if (Math.abs(da) <= eps && Math.abs(db) <= eps) {
        pushHit(hits, a, eps);
        pushHit(hits, b, eps);
        continue;
      }
      if ((da > eps && db > eps) || (da < -eps && db < -eps)) continue;
      const denom = da - db;
      if (Math.abs(denom) < 1e-18) continue;
      const u = da / denom;
      if (u < -1e-7 || u > 1 + 1e-7) continue;
      const clamped = Math.min(1, Math.max(0, u));
      pushHit(hits, {
        x: a.x + (b.x - a.x) * clamped,
        y: a.y + (b.y - a.y) * clamped,
        z: a.z + (b.z - a.z) * clamped,
      }, eps);
    }
    if (hits.length < 2) continue;
    segments.push({ ax: hits[0].x, ay: hits[0].y, az: hits[0].z, bx: hits[1].x, by: hits[1].y, bz: hits[1].z });
  }
  return chainSegments(uniqueSegments(segments, eps), plane, eps);
}

function uniqueSegments(segments: RawSeg[], eps: number): RawSeg[] {
  const tol = Math.max(eps * 10, 1e-7);
  const key = (x: number, y: number, z: number) => `${Math.round(x / tol)},${Math.round(y / tol)},${Math.round(z / tol)}`;
  const seen = new Set<string>();
  const unique: RawSeg[] = [];
  for (const segment of segments) {
    const length2 = (segment.ax - segment.bx) ** 2 + (segment.ay - segment.by) ** 2 + (segment.az - segment.bz) ** 2;
    if (length2 <= eps * eps) continue;
    const a = key(segment.ax, segment.ay, segment.az);
    const b = key(segment.bx, segment.by, segment.bz);
    const id = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(segment);
  }
  return unique;
}

function pushHit(hits: { x: number; y: number; z: number }[], p: { x: number; y: number; z: number }, eps: number): void {
  for (const hit of hits) {
    if ((hit.x - p.x) ** 2 + (hit.y - p.y) ** 2 + (hit.z - p.z) ** 2 <= eps * eps) return;
  }
  hits.push({ x: p.x, y: p.y, z: p.z });
}

function chainSegments(segments: RawSeg[], plane: SectionPlane, eps: number): SectionLoop[] {
  const tol = Math.max(eps * 10, 1e-7);
  const key = (x: number, y: number, z: number) => `${Math.round(x / tol)},${Math.round(y / tol)},${Math.round(z / tol)}`;
  const at = new Map<string, number[]>();
  const add = (k: string, index: number) => {
    const list = at.get(k);
    if (list) list.push(index);
    else at.set(k, [index]);
  };
  segments.forEach((segment, index) => {
    add(key(segment.ax, segment.ay, segment.az), index);
    add(key(segment.bx, segment.by, segment.bz), index);
  });
  const used = new Uint8Array(segments.length);
  const loops: SectionLoop[] = [];
  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;
    used[start] = 1;
    const first = segments[start];
    const raw: { x: number; y: number; z: number }[] = [
      { x: first.ax, y: first.ay, z: first.az },
      { x: first.bx, y: first.by, z: first.bz },
    ];
    let guard = 0;
    let closed = false;
    while (guard++ < segments.length + 2) {
      const end = raw[raw.length - 1];
      const startKey = key(raw[0].x, raw[0].y, raw[0].z);
      if (raw.length > 2 && key(end.x, end.y, end.z) === startKey) {
        closed = true;
        raw.pop();
        break;
      }
      const candidates = at.get(key(end.x, end.y, end.z)) ?? [];
      let next = -1;
      for (const index of candidates) {
        if (!used[index]) {
          next = index;
          break;
        }
      }
      if (next < 0) break;
      used[next] = 1;
      const segment = segments[next];
      const endKey = key(end.x, end.y, end.z);
      const takeB = key(segment.ax, segment.ay, segment.az) === endKey;
      raw.push(takeB
        ? { x: segment.bx, y: segment.by, z: segment.bz }
        : { x: segment.ax, y: segment.ay, z: segment.az });
    }
    if (raw.length < 2) continue;
    loops.push({
      closed,
      points: raw.map((p) => ({
        x: p.x,
        y: p.y,
        offset: (p.x - plane.ox) * plane.rx + (p.y - plane.oy) * plane.ry + (p.z - plane.oz) * plane.rz,
        z: p.z,
      })),
    });
  }
  loops.sort((a, b) => loopArea(b) - loopArea(a));
  return loops;
}

function loopArea(loop: SectionLoop): number {
  if (!loop.closed || loop.points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < loop.points.length; i++) {
    const a = loop.points[i];
    const b = loop.points[(i + 1) % loop.points.length];
    sum += a.offset * b.z - b.offset * a.z;
  }
  return Math.abs(sum) / 2;
}

export function sectionMetrics(loop: SectionLoop): { area: number; perimeter: number; centroid: DesignPoint } {
  const pts = loop.points;
  if (pts.length === 0) return { area: 0, perimeter: 0, centroid: { offset: 0, z: 0 } };
  let perimeter = 0;
  let signed = 0;
  let cx = 0;
  let cz = 0;
  const last = loop.closed ? pts.length : pts.length - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    perimeter += Math.hypot(b.offset - a.offset, b.z - a.z);
    if (!loop.closed) continue;
    const cross = a.offset * b.z - b.offset * a.z;
    signed += cross;
    cx += (a.offset + b.offset) * cross;
    cz += (a.z + b.z) * cross;
  }
  const areaSigned = signed / 2;
  const area = Math.abs(areaSigned);
  if (area > 1e-10) {
    cx /= 6 * areaSigned;
    cz /= 6 * areaSigned;
  } else {
    cx = pts.reduce((sum, p) => sum + p.offset, 0) / pts.length;
    cz = pts.reduce((sum, p) => sum + p.z, 0) / pts.length;
  }
  return { area, perimeter, centroid: { offset: cx, z: cz } };
}

export function circleDesign(radius: number, offset = 0, elevation = 0, segments = 48): DesignPoint[] {
  const ring: DesignPoint[] = [];
  const count = Math.max(12, segments);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    ring.push({ offset: offset + radius * Math.cos(angle), z: elevation + radius * Math.sin(angle) });
  }
  return ring;
}

/** Horseshoe: flat invert, vertical walls, semicircular crown. Width is wall to wall. */
export function horseshoeDesign(width: number, wallHeight: number, segments = 36): DesignPoint[] {
  const radius = width / 2;
  const wall = Math.max(0, wallHeight);
  const ring: DesignPoint[] = [];
  const floorSteps = Math.max(4, Math.round(segments / 4));
  for (let i = 0; i <= floorSteps; i++) ring.push({ offset: -radius + (width * i) / floorSteps, z: 0 });
  const wallSteps = Math.max(2, Math.round(segments / 6));
  for (let i = 1; i <= wallSteps; i++) ring.push({ offset: radius, z: (wall * i) / wallSteps });
  const crownSteps = Math.max(8, segments);
  for (let i = 1; i < crownSteps; i++) {
    const angle = (i / crownSteps) * Math.PI;
    ring.push({ offset: Math.cos(angle) * radius, z: wall + Math.sin(angle) * radius });
  }
  for (let i = wallSteps - 1; i >= 1; i--) ring.push({ offset: -radius, z: (wall * i) / wallSteps });
  return ring;
}

export function stationsInRange(from: number, to: number, interval: number): number[] {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const step = interval > 1e-9 ? interval : Math.max(end - start, 1);
  const stations: number[] = [];
  for (let station = start; station <= end + step * 1e-6; station += step) {
    stations.push(Math.min(station, end));
    if (station >= end - 1e-6) break;
    if (stations.length > 5000) break;
  }
  const last = stations[stations.length - 1];
  if (last === undefined || Math.abs(last - end) > 1e-4) stations.push(end);
  return stations;
}

export function sectionMesh(
  points: SurveyPoint[],
  triangles: Triangle[],
  planes: SectionPlane[],
  design: DesignPoint[] | null,
): MeshCrossSection[] {
  const template = design && design.length >= 3 ? design : null;
  return planes.map((plane) => {
    const loops = intersectMeshPlane(points, triangles, plane);
    const primary = loops.find((loop) => loop.closed) ?? loops[0];
    const metrics = primary ? sectionMetrics(primary) : { area: 0, perimeter: 0, centroid: { offset: 0, z: 0 } };
    const comparison = primary && primary.closed && template
      ? compareRings(primary.points.map((point) => ({ offset: point.offset, z: point.z })), template)
      : null;
    return {
      station: plane.station,
      loops,
      area: metrics.area,
      perimeter: metrics.perimeter,
      centroid: metrics.centroid,
      comparison,
    };
  });
}

export function compareRings(asBuilt: DesignPoint[], design: DesignPoint[]): BreakComparison {
  const built = asVec(asBuilt);
  const wanted = asVec(design);
  const overPieces = polygonDifference(built, wanted);
  const underPieces = polygonDifference(wanted, built);
  const overbreak = overPieces.map(toRegion);
  const underbreak = underPieces.map(toRegion);
  return {
    overbreakArea: overbreak.reduce((sum, region) => sum + region.area, 0),
    underbreakArea: underbreak.reduce((sum, region) => sum + region.area, 0),
    maxOverbreak: maxDeviation(built, wanted, false),
    maxUnderbreak: maxDeviation(built, wanted, true),
    overbreak,
    underbreak,
  };
}

function asVec(ring: DesignPoint[]): Vec2[] {
  const cleaned = dedupeRing(ring.map((point) => ({ x: point.offset, y: point.z })), 1e-8);
  return ensureCCW(cleaned);
}

function toRegion(ring: Vec2[]): BreakRegion {
  return {
    points: ring.map((point) => ({ offset: point.x, z: point.y })),
    area: polygonArea(ring),
  };
}

export function meshSectionCsv(sections: MeshCrossSection[]): string {
  const lines = ['Station,Area,Perimeter,Centroid offset,Centroid elevation,Overbreak area,Underbreak area,Max overbreak,Max underbreak,Loops'];
  for (const section of sections) {
    const comparison = section.comparison;
    lines.push([
      section.station,
      section.area,
      section.perimeter,
      section.centroid.offset,
      section.centroid.z,
      comparison?.overbreakArea ?? '',
      comparison?.underbreakArea ?? '',
      comparison?.maxOverbreak ?? '',
      comparison?.maxUnderbreak ?? '',
      section.loops.length,
    ].join(','));
  }
  return lines.join('\n') + '\n';
}

function polygonDifference(subject: Vec2[], clip: Vec2[]): Vec2[][] {
  if (subject.length < 3 || clip.length < 3) return subject.length >= 3 ? [subject] : [];
  let pieces = earClip(subject);
  const knives = earClip(clip);
  for (const knife of knives) {
    const next: Vec2[][] = [];
    for (const piece of pieces) next.push(...subtractConvex(piece, knife));
    pieces = next;
    if (pieces.length === 0) break;
  }
  return pieces.filter((piece) => polygonArea(piece) > 1e-8);
}

function earClip(ring: Vec2[]): Vec2[][] {
  const source = ensureCCW(dedupeRing(ring, 1e-9));
  if (source.length < 3) return [];
  if (source.length === 3) return [source];
  const poly = source.slice();
  const tris: Vec2[][] = [];
  let guard = 0;
  while (poly.length > 3 && guard++ < poly.length * poly.length) {
    let clipped = false;
    for (let i = 0; i < poly.length; i++) {
      const prev = poly[(i + poly.length - 1) % poly.length];
      const cur = poly[i];
      const next = poly[(i + 1) % poly.length];
      if (orient(prev, cur, next) <= 1e-12) continue;
      let contains = false;
      for (const point of poly) {
        if (point === prev || point === cur || point === next) continue;
        if (pointInTriangle(point, prev, cur, next)) {
          contains = true;
          break;
        }
      }
      if (contains) continue;
      tris.push([prev, cur, next]);
      poly.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (poly.length === 3 && Math.abs(signedArea(poly)) > 1e-12) tris.push(poly.slice());
  return tris;
}

function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const o1 = orient(a, b, p);
  const o2 = orient(b, c, p);
  const o3 = orient(c, a, p);
  return o1 > 1e-12 && o2 > 1e-12 && o3 > 1e-12;
}

/** Subject minus a convex clip. Subject is treated as convex, which ear-clipped triangles are. */
function subtractConvex(subject: Vec2[], clip: Vec2[]): Vec2[][] {
  if (subject.length < 3) return [];
  const knife = ensureCCW(clip);
  let inside: Vec2[][] = [subject.slice()];
  const outside: Vec2[][] = [];
  for (let i = 0; i < knife.length; i++) {
    const a = knife[i];
    const b = knife[(i + 1) % knife.length];
    const next: Vec2[][] = [];
    for (const poly of inside) {
      const split = splitByEdge(poly, a, b);
      if (split.outside.length >= 3 && polygonArea(split.outside) > 1e-10) outside.push(split.outside);
      if (split.inside.length >= 3 && polygonArea(split.inside) > 1e-10) next.push(split.inside);
    }
    inside = next;
  }
  return outside;
}

function splitByEdge(poly: Vec2[], a: Vec2, b: Vec2): { inside: Vec2[]; outside: Vec2[] } {
  const inside: Vec2[] = [];
  const outside: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const current = poly[i];
    const next = poly[(i + 1) % poly.length];
    const currentIn = orient(a, b, current) >= -1e-9;
    const nextIn = orient(a, b, next) >= -1e-9;
    if (currentIn) inside.push(current);
    else outside.push(current);
    if (currentIn !== nextIn) {
      const hit = lineHit(current, next, a, b);
      inside.push(hit);
      outside.push(hit);
    }
  }
  return { inside: dedupeRing(inside, 1e-9), outside: dedupeRing(outside, 1e-9) };
}

function lineHit(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-18) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const clamped = Math.min(1, Math.max(0, t));
  return { x: a.x + clamped * rx, y: a.y + clamped * ry };
}

function maxDeviation(asBuilt: Vec2[], design: Vec2[], wantInside: boolean): number {
  let max = 0;
  const samples: Vec2[] = [];
  for (let i = 0; i < asBuilt.length; i++) {
    const a = asBuilt[i];
    const b = asBuilt[(i + 1) % asBuilt.length];
    samples.push(a, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  for (const sample of samples) {
    const inside = pointInRing(sample, design);
    const distance = distanceToRing(sample, design);
    if (distance < 1e-7) continue;
    if (wantInside === inside) max = Math.max(max, distance);
  }
  return max;
}

function pointInRing(p: Vec2, ring: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToRing(p: Vec2, ring: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    best = Math.min(best, distanceToSegment(p, a, b));
  }
  return best;
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
