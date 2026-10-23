import { bvhFor } from './bvh';
import { elevationAt } from './tin';
import { entityEndpoints, pointAtStation, type AlignmentPoint, type SolvedAlignment } from './alignment';
import type { SurveyPoint, Triangle, Vec2 } from './types';

export interface ProfileVertex {
  station: number;
  elevation: number | null;
}

export interface SampleLine {
  station: number;
  left: number;
  right: number;
  origin: Vec2;
  /** Unit vector toward positive offset, which is to the right of increasing station. */
  rx: number;
  ry: number;
}

export interface SectionSample {
  offset: number;
  elevation: number | null;
  x: number;
  y: number;
}

/** Stations at a fixed interval plus the PC, PT, and angle-point distances in `extra`. */
export function profileStations(length: number, startStation: number, interval: number, extra: number[] = []): number[] {
  const keys = new Set<number>();
  const stations: number[] = [];
  const add = (distance: number) => {
    if (!Number.isFinite(distance)) return;
    const clamped = Math.min(Math.max(distance, 0), Math.max(length, 0));
    const key = Math.round(clamped * 1000);
    if (keys.has(key)) return;
    keys.add(key);
    stations.push(startStation + clamped);
  };
  add(0);
  if (interval > 1e-6 && length > 0) {
    for (let distance = interval; distance < length - 1e-6; distance += interval) add(distance);
  }
  for (const distance of extra) add(distance);
  add(length);
  stations.sort((a, b) => a - b);
  return stations;
}

export function surfaceProfile(
  points: SurveyPoint[],
  triangles: Triangle[],
  solved: SolvedAlignment,
  startStation: number,
  interval: number,
): ProfileVertex[] {
  const stations = profileStations(solved.length, startStation, interval, entityEndpoints(solved));
  if (stations.length === 0) return [];
  const index = triangles.length > 0 ? bvhFor(points, triangles) : undefined;
  return stations.map((station) => {
    const at = pointAtStation(solved, startStation, station);
    if (!at) return { station, elevation: null };
    return { station, elevation: elevationAt(points, triangles, at.x, at.y, index) };
  });
}

export function sampleLineAt(
  solved: SolvedAlignment,
  startStation: number,
  station: number,
  left: number,
  right: number,
): SampleLine | null {
  const at = pointAtStation(solved, startStation, station);
  if (!at) return null;
  return lineFromPoint(at, station, left, right);
}

export function sampleLinesAlong(
  solved: SolvedAlignment,
  startStation: number,
  spacing: number,
  left: number,
  right: number,
): SampleLine[] {
  const stations = profileStations(solved.length, startStation, spacing > 1e-6 ? spacing : solved.length);
  const lines: SampleLine[] = [];
  for (const station of stations) {
    const line = sampleLineAt(solved, startStation, station, left, right);
    if (line) lines.push(line);
  }
  return lines;
}

export function sectionFromSurface(
  points: SurveyPoint[],
  triangles: Triangle[],
  line: SampleLine,
  step: number,
): SectionSample[] {
  const offsets = offsetsAcross(line.left, line.right, step);
  const index = triangles.length > 0 ? bvhFor(points, triangles) : undefined;
  return offsets.map((offset) => {
    const x = line.origin.x + line.rx * offset;
    const y = line.origin.y + line.ry * offset;
    return { offset, x, y, elevation: elevationAt(points, triangles, x, y, index) };
  });
}

function lineFromPoint(at: AlignmentPoint, station: number, left: number, right: number): SampleLine {
  return {
    station,
    left: Math.max(0, left),
    right: Math.max(0, right),
    origin: { x: at.x, y: at.y },
    rx: at.ty,
    ry: -at.tx,
  };
}

function offsetsAcross(left: number, right: number, step: number): number[] {
  const start = -Math.max(0, left);
  const end = Math.max(0, right);
  const size = step > 1e-6 ? step : Math.max(end - start, 1);
  const offsets: number[] = [];
  for (let offset = start; offset <= end + 1e-6; offset += size) {
    offsets.push(Math.min(offset, end));
    if (offset >= end - 1e-6) break;
    if (offsets.length > 10000) break;
  }
  if (offsets.length === 0 || Math.abs(offsets[offsets.length - 1] - end) > 1e-4) offsets.push(end);
  return offsets;
}
