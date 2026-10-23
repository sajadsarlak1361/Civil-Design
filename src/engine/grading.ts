import { TriangleBvh } from './bvh';
import type { FeatureLine, FeatureVertex } from './featureLine';
import { elevationAt } from './tin';
import type { SurveyPoint, Triangle } from './types';

export interface GradingInput {
  footprint: FeatureLine;
  side: 'left' | 'right' | 'both';
  /** Horizontal distance per one unit of vertical, for example 2 for a 2:1 slope. */
  cutSlope: number;
  fillSlope: number;
  points: SurveyPoint[];
  triangles: Triangle[];
  interval?: number;
  maxDistance?: number;
}

export interface GradingResult {
  daylight: FeatureVertex[][];
  surfacePoints: SurveyPoint[];
  triangles: Triangle[];
  warnings: string[];
}

interface Hit {
  x: number;
  y: number;
  z: number;
}

function pushTri(points: SurveyPoint[], tris: Triangle[], ia: number, ib: number, ic: number): void {
  const a = points[ia];
  const b = points[ib];
  const c = points[ic];
  const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(area) < 1e-8) return;
  tris.push(area > 0 ? [ia, ib, ic] : [ia, ic, ib]);
}

function daylightPoint(
  origin: Hit,
  dirX: number,
  dirY: number,
  slopeHV: number,
  up: boolean,
  points: SurveyPoint[],
  triangles: Triangle[],
  index: TriangleBvh | undefined,
  maxDistance: number,
): Hit | null {
  const slope = Math.max(slopeHV, 0.05);
  const grade = (up ? 1 : -1) / slope;
  const zAt = (distance: number) => origin.z + grade * distance;
  const diffAt = (distance: number) => {
    const z = elevationAt(points, triangles, origin.x + dirX * distance, origin.y + dirY * distance, index);
    if (z === null) return null;
    return zAt(distance) - z;
  };
  const start = diffAt(0);
  if (start === null) return null;
  if (Math.abs(start) <= 0.02) return { ...origin };
  let previousS = 0;
  let previous = start;
  const step = 0.5;
  for (let distance = step; distance <= maxDistance + 1e-9; distance += step) {
    const diff = diffAt(distance);
    if (diff === null) return null;
    if ((previous > 0 && diff <= 0) || (previous < 0 && diff >= 0)) {
      let lo = previousS;
      let hi = distance;
      for (let iteration = 0; iteration < 28; iteration++) {
        const mid = (lo + hi) / 2;
        const midDiff = diffAt(mid);
        if (midDiff === null) return null;
        if ((previous > 0 && midDiff > 0) || (previous < 0 && midDiff < 0)) lo = mid;
        else hi = mid;
      }
      const at = (lo + hi) / 2;
      return { x: origin.x + dirX * at, y: origin.y + dirY * at, z: zAt(at) };
    }
    previous = diff;
    previousS = distance;
  }
  return null;
}

function gradeSide(
  footprint: FeatureVertex[],
  side: 1 | -1,
  input: GradingInput,
  index: TriangleBvh | undefined,
): { strips: { foot: Hit[]; day: Hit[] }[]; warnings: string[] } {
  const interval = input.interval && input.interval > 0.05 ? input.interval : 2;
  const maxDistance = input.maxDistance && input.maxDistance > 1 ? input.maxDistance : 80;
  const strips: { foot: Hit[]; day: Hit[] }[] = [];
  const warnings: string[] = [];
  const count = footprint.length;
  const segments = input.footprint.closed ? count : count - 1;
  for (let segment = 0; segment < segments; segment++) {
    const a = footprint[segment];
    const b = footprint[(segment + 1) % count];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-6) continue;
    const dx = (b.x - a.x) / length;
    const dy = (b.y - a.y) / length;
    const nx = side === 1 ? dy : -dy;
    const ny = side === 1 ? -dx : dx;
    const steps = Math.max(1, Math.ceil(length / interval));
    const foot: Hit[] = [];
    const day: Hit[] = [];
    let missed = 0;
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      const origin = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
      const ground = elevationAt(input.points, input.triangles, origin.x, origin.y, index);
      if (ground === null) {
        missed += 1;
        continue;
      }
      const up = origin.z < ground - 0.02;
      const slope = up ? input.cutSlope : input.fillSlope;
      const hit = daylightPoint(origin, nx, ny, slope, up, input.points, input.triangles, index, maxDistance);
      if (!hit) {
        missed += 1;
        continue;
      }
      foot.push(origin);
      day.push(hit);
    }
    if (missed > 0) warnings.push(`${missed} grading sample${missed === 1 ? '' : 's'} did not meet the surface.`);
    if (foot.length >= 2) strips.push({ foot, day });
  }
  return { strips, warnings };
}

function addStrips(strips: { foot: Hit[]; day: Hit[] }[], points: SurveyPoint[], triangles: Triangle[], daylight: FeatureVertex[][]): void {
  for (const strip of strips) {
    const base = points.length;
    for (const point of strip.foot) points.push({ x: point.x, y: point.y, z: point.z, role: 'breakline' });
    const dayBase = points.length;
    for (const point of strip.day) points.push({ x: point.x, y: point.y, z: point.z, role: 'breakline' });
    daylight.push(strip.day.map((point) => ({ ...point })));
    for (let i = 0; i < strip.foot.length - 1; i++) {
      pushTri(points, triangles, base + i, base + i + 1, dayBase + i + 1);
      pushTri(points, triangles, base + i, dayBase + i + 1, dayBase + i);
    }
  }
  for (let i = 0; i < strips.length - 1; i++) {
    const a = strips[i];
    const b = strips[i + 1];
    const aFoot = a.foot[a.foot.length - 1];
    const bFoot = b.foot[0];
    if (Math.hypot(aFoot.x - bFoot.x, aFoot.y - bFoot.y) > 0.05) continue;
    const ia = points.length;
    points.push({ ...aFoot, role: 'breakline' });
    const ib = points.length;
    points.push({ ...a.day[a.day.length - 1], role: 'breakline' });
    const ic = points.length;
    points.push({ ...b.day[0], role: 'breakline' });
    pushTri(points, triangles, ia, ib, ic);
  }
}

export function gradeFeatureLine(input: GradingInput): GradingResult {
  const warnings: string[] = [];
  if (input.footprint.points.length < 2) {
    return { daylight: [], surfacePoints: [], triangles: [], warnings: ['A grading needs a feature line with at least two points.'] };
  }
  const index = input.triangles.length > 0 ? new TriangleBvh(input.points, input.triangles) : undefined;
  const surfacePoints: SurveyPoint[] = [];
  const triangles: Triangle[] = [];
  const daylight: FeatureVertex[][] = [];
  const sides: (1 | -1)[] = input.side === 'both' ? [1, -1] : [input.side === 'right' ? 1 : -1];
  for (const side of sides) {
    const graded = gradeSide(input.footprint.points, side, input, index);
    warnings.push(...graded.warnings);
    addStrips(graded.strips, surfacePoints, triangles, daylight);
  }
  if (triangles.length === 0) warnings.push('The slope did not meet the target surface inside the search distance.');
  return { daylight, surfacePoints, triangles, warnings };
}
