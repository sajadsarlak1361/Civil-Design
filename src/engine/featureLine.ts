import { elevationAt } from './tin';
import type { SurveyPoint, Triangle, Vec2 } from './types';

export interface FeatureVertex {
  x: number;
  y: number;
  z: number;
}

export interface FeatureLine {
  id: string;
  name: string;
  points: FeatureVertex[];
  closed?: boolean;
}

export function featureLength2d(line: Pick<FeatureLine, 'points' | 'closed'>): number {
  let length = 0;
  const count = line.points.length;
  const last = line.closed ? count : count - 1;
  for (let i = 0; i < last; i++) {
    const a = line.points[i];
    const b = line.points[(i + 1) % count];
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}

export function featureLength3d(line: Pick<FeatureLine, 'points' | 'closed'>): number {
  let length = 0;
  const count = line.points.length;
  const last = line.closed ? count : count - 1;
  for (let i = 0; i < last; i++) {
    const a = line.points[i];
    const b = line.points[(i + 1) % count];
    length += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return length;
}

export function featureStations(points: FeatureVertex[]): number[] {
  const stations = [0];
  for (let i = 1; i < points.length; i++) {
    stations.push(stations[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  return stations;
}

/** Grade is rise/run from the start vertex through the end vertex, including intermediate PIs. */
export function setFeatureGrade(line: FeatureLine, fromIndex: number, toIndex: number, grade: number): FeatureLine {
  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  if (start < 0 || end >= line.points.length || start === end) return line;
  const stations = featureStations(line.points);
  const origin = stations[start];
  const z0 = line.points[start].z;
  const points = line.points.map((point, index) => {
    if (index < start || index > end) return point;
    return { ...point, z: z0 + grade * (stations[index] - origin) };
  });
  return { ...line, points };
}

export function raiseFeatureLine(line: FeatureLine, delta: number): FeatureLine {
  return { ...line, points: line.points.map((point) => ({ ...point, z: point.z + delta })) };
}

export function elevationsFromSurface(
  line: FeatureLine,
  points: SurveyPoint[],
  triangles: Triangle[],
  index?: { candidatesAt(x: number, y: number): number[] },
): { line: FeatureLine; missing: number } {
  let missing = 0;
  const next = line.points.map((point) => {
    const z = elevationAt(points, triangles, point.x, point.y, index);
    if (z === null) {
      missing += 1;
      return point;
    }
    return { ...point, z };
  });
  return { line: { ...line, points: next }, missing };
}

export function insertFeaturePoint(line: FeatureLine, station: number, z?: number): FeatureLine {
  if (line.points.length < 2) return line;
  const stations = featureStations(line.points);
  const length = stations[stations.length - 1];
  const target = Math.min(Math.max(station, 0), length);
  for (let i = 0; i < stations.length; i++) {
    if (Math.abs(stations[i] - target) <= 1e-6) {
      if (z === undefined) return line;
      const points = line.points.map((point, index) => (index === i ? { ...point, z } : point));
      return { ...line, points };
    }
  }
  for (let i = 0; i < stations.length - 1; i++) {
    if (target < stations[i] - 1e-9 || target > stations[i + 1] + 1e-9) continue;
    const span = stations[i + 1] - stations[i];
    const t = span <= 1e-12 ? 0 : (target - stations[i]) / span;
    const a = line.points[i];
    const b = line.points[i + 1];
    const vertex: FeatureVertex = {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: z ?? a.z + (b.z - a.z) * t,
    };
    const points = [...line.points.slice(0, i + 1), vertex, ...line.points.slice(i + 1)];
    return { ...line, points };
  }
  return line;
}

export function featureLineFromPlan(points: Vec2[], elevationAtPoint: (x: number, y: number) => number | null, fallbackZ: number, id: string, name: string): FeatureLine {
  return {
    id,
    name,
    points: points.map((point) => ({ x: point.x, y: point.y, z: elevationAtPoint(point.x, point.y) ?? fallbackZ })),
  };
}
