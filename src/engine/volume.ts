import { barycentric, boundsOf, boundsOverlap, clipConvexPolygon, dedupeRing, ensureCCW, signedArea } from './geometry';
import { TriangleIndex } from './tin';
import type { SurveyPoint, Triangle, Vec2, VolumeRegion, VolumeResult } from './types';

/**
 * Earthwork sign convention for base-versus-comparison volumes:
 * depth = comparison elevation − base elevation.
 * Positive depth is fill (comparison is higher). Negative depth is cut.
 * Net = fill − cut, so a positive net is net fill.
 * A datum comparison treats the datum as a flat comparison surface.
 * Volumes are integrated only where both surfaces exist in plan.
 */

interface ElevatedPoint extends Vec2 {
  dz: number;
}

function emptyResult(method: VolumeResult['method']): VolumeResult {
  return { method, cut: 0, fill: 0, net: 0, cutArea: 0, fillArea: 0, regions: [] };
}

function triRing(points: SurveyPoint[], tri: Triangle): Vec2[] {
  return [points[tri[0]], points[tri[1]], points[tri[2]]].map((p) => ({ x: p.x, y: p.y }));
}

function triBounds(points: SurveyPoint[], tri: Triangle) {
  return boundsOf(triRing(points, tri))!;
}

function zOn(points: SurveyPoint[], tri: Triangle, p: Vec2): number {
  const a = points[tri[0]];
  const b = points[tri[1]];
  const c = points[tri[2]];
  const w = barycentric(p, a, b, c);
  if (!w) return (a.z + b.z + c.z) / 3;
  return w.w0 * a.z + w.w1 * b.z + w.w2 * c.z;
}

function integrate(points: ElevatedPoint[]): { area: number; volume: number; ring: ElevatedPoint[] } {
  const ring = ensureCCW(dedupeRing(points, 1e-8));
  if (ring.length < 3) return { area: 0, volume: 0, ring };
  let area = 0;
  let volume = 0;
  const a = ring[0];
  for (let i = 1; i < ring.length - 1; i++) {
    const b = ring[i];
    const c = ring[i + 1];
    const signed = ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
    if (signed <= 1e-12) continue;
    area += signed;
    volume += (signed * (a.dz + b.dz + c.dz)) / 3;
  }
  return { area, volume, ring };
}

/** Split a CCW polygon into the dz >= 0 and dz <= 0 portions. */
function splitByZero(points: ElevatedPoint[]): { pos: ElevatedPoint[]; neg: ElevatedPoint[] } {
  const pos: ElevatedPoint[] = [];
  const neg: ElevatedPoint[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    if (a.dz >= 0) pos.push(a);
    if (a.dz <= 0) neg.push(a);
    if ((a.dz > 0 && b.dz < 0) || (a.dz < 0 && b.dz > 0)) {
      const t = a.dz / (a.dz - b.dz);
      const hit: ElevatedPoint = {
        x: a.x + t * (b.x - a.x),
        y: a.y + t * (b.y - a.y),
        dz: 0,
      };
      pos.push(hit);
      neg.push(hit);
    }
  }
  return { pos, neg };
}

function addPolygon(result: VolumeResult, polygon: ElevatedPoint[]): void {
  if (polygon.length < 3 || Math.abs(signedArea(polygon)) < 1e-10) return;
  const oriented = ensureCCW(polygon);
  const parts = splitByZero(oriented);
  for (const part of [parts.pos, parts.neg]) {
    const { area, volume, ring } = integrate(part);
    if (area < 1e-8 || Math.abs(volume) < 1e-8) continue;
    const region: VolumeRegion = {
      ring: ring.map((p) => ({ x: p.x, y: p.y })),
      depth: volume / area,
      kind: volume >= 0 ? 'fill' : 'cut',
      area,
      volume: Math.abs(volume),
    };
    result.regions.push(region);
    if (volume >= 0) {
      result.fill += volume;
      result.fillArea += area;
    } else {
      result.cut += -volume;
      result.cutArea += area;
    }
  }
  result.net = result.fill - result.cut;
}

export function volumeToDatum(points: SurveyPoint[], triangles: Triangle[], datum: number): VolumeResult {
  const result = emptyResult('surface-to-datum');
  for (const tri of triangles) {
    const ring = triRing(points, tri).map((p, i) => {
      const vertex = points[tri[i]];
      return { x: p.x, y: p.y, dz: datum - vertex.z };
    });
    addPolygon(result, ring);
  }
  return result;
}

export function volumeTinToTin(
  basePoints: SurveyPoint[],
  baseTriangles: Triangle[],
  comparisonPoints: SurveyPoint[],
  comparisonTriangles: Triangle[],
): VolumeResult {
  const result = emptyResult('tin-to-tin');
  if (baseTriangles.length === 0 || comparisonTriangles.length === 0) return result;
  const index = new TriangleIndex(comparisonPoints, comparisonTriangles);
  for (const triA of baseTriangles) {
    const boxA = triBounds(basePoints, triA);
    const ringA = ensureCCW(triRing(basePoints, triA));
    const candidates = index.candidatesIn(boxA.minX, boxA.minY, boxA.maxX, boxA.maxY);
    for (const ti of candidates) {
      const triB = comparisonTriangles[ti];
      const boxB = triBounds(comparisonPoints, triB);
      if (!boundsOverlap(boxA, boxB)) continue;
      const ringB = ensureCCW(triRing(comparisonPoints, triB));
      const clipped = clipConvexPolygon(ringA, ringB);
      if (clipped.length < 3) continue;
      const elevated: ElevatedPoint[] = clipped.map((p) => ({
        x: p.x,
        y: p.y,
        dz: zOn(comparisonPoints, triB, p) - zOn(basePoints, triA, p),
      }));
      addPolygon(result, elevated);
    }
  }
  return result;
}

export function volumeSummary(result: VolumeResult): { cut: number; fill: number; net: number } {
  return { cut: result.cut, fill: result.fill, net: result.net };
}

/** Depth at which the cut/fill color ramp saturates, so one deep cell does not wash out the map. */
export function volumeColorScale(result: VolumeResult): number {
  if (result.regions.length === 0) return 1;
  const depths = result.regions.map((region) => Math.abs(region.depth)).sort((a, b) => a - b);
  const index = Math.min(depths.length - 1, Math.floor(depths.length * 0.9));
  return Math.max(depths[index], 0.05);
}
