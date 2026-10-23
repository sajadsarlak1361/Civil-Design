import { pointAtStation, type SolvedAlignment } from './alignment';
import type { Vec2 } from './types';

/** COGO point. x is easting, y is northing. */
export interface CogoPoint {
  id: string;
  number: number;
  x: number;
  y: number;
  z: number;
  description: string;
}

export interface PointGroupQuery {
  id: string;
  name: string;
  /** Comma-separated wildcards. Empty or * includes every description. */
  description: string;
  minElevation: number | null;
  maxElevation: number | null;
  minNumber: number | null;
  maxNumber: number | null;
  excludeNumbers: number[];
}

export function matchWildcard(pattern: string, value: string): boolean {
  const tokens = pattern
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return true;
  return tokens.some((token) => {
    if (token === '*') return true;
    const body = token.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${body}$`, 'i').test(value.trim());
  });
}

export function filterPointGroup(points: CogoPoint[], query: Pick<PointGroupQuery, 'description' | 'minElevation' | 'maxElevation' | 'minNumber' | 'maxNumber' | 'excludeNumbers'>): CogoPoint[] {
  const excluded = new Set(query.excludeNumbers);
  return points.filter((point) => {
    if (excluded.has(point.number)) return false;
    if (query.minNumber !== null && point.number < query.minNumber) return false;
    if (query.maxNumber !== null && point.number > query.maxNumber) return false;
    if (query.minElevation !== null && point.z < query.minElevation) return false;
    if (query.maxElevation !== null && point.z > query.maxElevation) return false;
    return matchWildcard(query.description, point.description);
  });
}

export function interpolatePoints(
  a: Vec2 & { z: number },
  b: Vec2 & { z: number },
  segments: number,
  startNumber: number,
  description: string,
  idFor: (number: number) => string,
): CogoPoint[] {
  const count = Math.max(1, Math.floor(segments));
  const points: CogoPoint[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const number = startNumber + i;
    points.push({
      id: idFor(number),
      number,
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      description,
    });
  }
  return points;
}

export function pointsAlongAlignment(input: {
  solved: SolvedAlignment;
  startStation: number;
  fromStation: number;
  toStation: number;
  interval: number;
  offset: number;
  elevationAt: (x: number, y: number) => number | null;
  fallbackZ: number;
  startNumber: number;
  description: string;
  idFor: (number: number) => string;
}): CogoPoint[] {
  const from = Math.min(input.fromStation, input.toStation);
  const to = Math.max(input.fromStation, input.toStation);
  const step = input.interval > 1e-6 ? input.interval : Math.max(to - from, 1);
  const stations: number[] = [];
  for (let station = from; station <= to + 1e-6; station += step) {
    stations.push(Math.min(station, to));
    if (station >= to - 1e-6) break;
    if (stations.length > 10000) break;
  }
  const end = stations[stations.length - 1];
  if (end === undefined || Math.abs(end - to) > 1e-3) stations.push(to);
  const points: CogoPoint[] = [];
  stations.forEach((station, index) => {
    const at = pointAtStation(input.solved, input.startStation, station);
    if (!at) return;
    const x = at.x + at.ty * input.offset;
    const y = at.y - at.tx * input.offset;
    const z = input.elevationAt(x, y);
    const number = input.startNumber + index;
    points.push({
      id: input.idFor(number),
      number,
      x,
      y,
      z: z ?? input.fallbackZ,
      description: input.description,
    });
  });
  return points;
}

export function pointGrid(input: {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  columns: number;
  rows: number;
  elevationAt: (x: number, y: number) => number | null;
  fallbackZ: number;
  startNumber: number;
  description: string;
  idFor: (number: number) => string;
}): CogoPoint[] {
  const columns = Math.max(2, Math.floor(input.columns));
  const rows = Math.max(2, Math.floor(input.rows));
  const points: CogoPoint[] = [];
  let number = input.startNumber;
  for (let row = 0; row < rows; row++) {
    const ty = rows === 1 ? 0 : row / (rows - 1);
    for (let column = 0; column < columns; column++) {
      const tx = columns === 1 ? 0 : column / (columns - 1);
      const x = input.minX + (input.maxX - input.minX) * tx;
      const y = input.minY + (input.maxY - input.minY) * ty;
      const z = input.elevationAt(x, y);
      points.push({
        id: input.idFor(number),
        number,
        x,
        y,
        z: z ?? input.fallbackZ,
        description: input.description,
      });
      number += 1;
    }
  }
  return points;
}

export function nextPointNumber(points: CogoPoint[]): number {
  let max = 0;
  for (const point of points) if (point.number > max) max = point.number;
  return max + 1;
}
