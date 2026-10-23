import { triangleArea2D, triangleArea3D, triangleSlope } from './geometry';
import type { SurfaceStats, SurveyPoint, Triangle } from './types';

const statsCache = new WeakMap<Triangle[], SurfaceStats>();

export function surfaceStats(points: SurveyPoint[], triangles: Triangle[]): SurfaceStats {
  if (triangles.length > 0) {
    const cached = statsCache.get(triangles);
    if (cached) return cached;
  }
  const computed = computeSurfaceStats(points, triangles);
  if (triangles.length > 0) statsCache.set(triangles, computed);
  return computed;
}

function computeSurfaceStats(points: SurveyPoint[], triangles: Triangle[]): SurfaceStats {
  if (triangles.length === 0) {
    let minZ = Infinity;
    let maxZ = -Infinity;
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      const z = points[i].z;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      sum += z;
    }
    if (!Number.isFinite(minZ)) return { pointCount: 0, triangleCount: 0, minZ: 0, maxZ: 0, meanZ: 0, area2D: 0, area3D: 0, minSlope: 0, maxSlope: 0, meanSlope: 0 };
    return {
      pointCount: points.length,
      triangleCount: 0,
      minZ,
      maxZ,
      meanZ: sum / points.length,
      area2D: 0,
      area3D: 0,
      minSlope: 0,
      maxSlope: 0,
      meanSlope: 0,
    };
  }

  const used = new Uint8Array(points.length);
  let area2D = 0;
  let area3D = 0;
  let elevSum = 0;
  let slopeSum = 0;
  let minSlope = Infinity;
  let maxSlope = 0;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const [ia, ib, ic] of triangles) {
    used[ia] = 1;
    used[ib] = 1;
    used[ic] = 1;
    const a = points[ia];
    const b = points[ib];
    const c = points[ic];
    const a2 = triangleArea2D(a, b, c);
    const a3 = triangleArea3D(a, b, c);
    area2D += a2;
    area3D += a3;
    const mean = (a.z + b.z + c.z) / 3;
    elevSum += mean * a2;
    const slope = triangleSlope(a, b, c);
    const finite = Number.isFinite(slope) ? slope : 999;
    slopeSum += finite * a2;
    if (finite < minSlope) minSlope = finite;
    if (finite > maxSlope) maxSlope = finite;
  }

  let pointCount = 0;
  for (let i = 0; i < used.length; i++) {
    if (!used[i]) continue;
    pointCount += 1;
    const z = points[i].z;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  return {
    pointCount,
    triangleCount: triangles.length,
    minZ,
    maxZ,
    meanZ: area2D > 0 ? elevSum / area2D : (minZ + maxZ) / 2,
    area2D,
    area3D,
    minSlope: Number.isFinite(minSlope) ? minSlope : 0,
    maxSlope,
    meanSlope: area2D > 0 ? slopeSum / area2D : 0,
  };
}

export function suggestContourInterval(minZ: number, maxZ: number): { minor: number; major: number } {
  const relief = Math.max(maxZ - minZ, 0);
  const steps = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200];
  if (relief <= 0) return { minor: 1, major: 5 };
  let minor = steps[steps.length - 1];
  for (const step of steps) {
    if (relief / step <= 14) {
      minor = step;
      break;
    }
  }
  const five = minor * 5;
  const match = steps.find((step) => Math.abs(step - five) < 1e-9);
  return { minor, major: match ?? five };
}
