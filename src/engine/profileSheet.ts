import { pointAtDistance, type AlignmentEntity, type SolvedAlignment } from './alignment';
import { elevationAt } from './tin';
import type { SurveyPoint, Triangle, Vec2 } from './types';
import type { ProfileVertex } from './profile';

export interface ProfileSheet {
  start: number;
  end: number;
}

/** Sheets of `length` with the next sheet starting `overlap` before the previous end. */
export function profileSheets(start: number, end: number, length: number, overlap: number): ProfileSheet[] {
  if (!(end > start) || !(length > 1)) return [{ start, end }];
  const step = Math.max(1, length - Math.max(0, overlap));
  const sheets: ProfileSheet[] = [];
  for (let cursor = start; cursor < end - 1e-6; cursor += step) {
    sheets.push({ start: cursor, end: Math.min(end, cursor + length) });
    if (sheets.length > 500) break;
  }
  return sheets;
}

export function clipProfile(vertices: ProfileVertex[], start: number, end: number): ProfileVertex[] {
  const known = vertices.filter((vertex): vertex is { station: number; elevation: number } => vertex.elevation !== null);
  if (known.length === 0 || !(end > start)) return [];
  const at = (station: number): number | null => {
    if (station < known[0].station - 1e-6 || station > known[known.length - 1].station + 1e-6) return null;
    for (let i = 1; i < known.length; i++) {
      if (station > known[i].station + 1e-9) continue;
      const span = known[i].station - known[i - 1].station;
      const t = span <= 1e-12 ? 0 : (station - known[i - 1].station) / span;
      return known[i - 1].elevation + (known[i].elevation - known[i - 1].elevation) * t;
    }
    return known[known.length - 1].elevation;
  };
  const clipped: ProfileVertex[] = [];
  const startZ = at(start);
  if (startZ !== null) clipped.push({ station: start, elevation: startZ });
  for (const vertex of known) {
    if (vertex.station > start + 1e-6 && vertex.station < end - 1e-6) clipped.push(vertex);
  }
  const endZ = at(end);
  if (endZ !== null && (clipped.length === 0 || Math.abs(clipped[clipped.length - 1].station - end) > 1e-6)) {
    clipped.push({ station: end, elevation: endZ });
  }
  return clipped;
}

export interface GeometryBandCell {
  from: number;
  to: number;
  label: string;
}

export function geometryBand(solved: SolvedAlignment, startStation: number): GeometryBandCell[] {
  return solved.entities.map((entity: AlignmentEntity) => {
    const from = startStation + entity.start;
    const to = from + entity.length;
    if (entity.kind === 'line') return { from, to, label: 'Tangent' };
    if (entity.kind === 'arc') return { from, to, label: `R ${entity.radius.toFixed(1)} ${entity.turn}` };
    return { from, to, label: `Spiral ${entity.length.toFixed(1)}` };
  });
}

export interface SuperimposedSample {
  station: number;
  elevation: number;
}

/** Map source points onto the host alignment by nearest station. */
export function superimposeProfile(
  host: SolvedAlignment,
  hostStart: number,
  source: { x: number; y: number; elevation: number }[],
): SuperimposedSample[] {
  if (host.length <= 0 || source.length === 0) return [];
  const step = Math.min(1, host.length / 4);
  const samples: { station: number; x: number; y: number }[] = [];
  for (let distance = 0; distance <= host.length + 1e-6; distance += step) {
    const at = pointAtDistance(host, Math.min(distance, host.length));
    if (at) samples.push({ station: hostStart + Math.min(distance, host.length), x: at.x, y: at.y });
    if (distance >= host.length - 1e-6) break;
  }
  const mapped: SuperimposedSample[] = [];
  for (const point of source) {
    let best = samples[0];
    let bestD = Infinity;
    for (const sample of samples) {
      const d = (sample.x - point.x) ** 2 + (sample.y - point.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = sample;
      }
    }
    if (!best) continue;
    let lo = Math.max(hostStart, best.station - step);
    let hi = Math.min(hostStart + host.length, best.station + step);
    for (let iteration = 0; iteration < 18; iteration++) {
      const left = lo + (hi - lo) / 3;
      const right = hi - (hi - lo) / 3;
      const atLeft = pointAtDistance(host, left - hostStart);
      const atRight = pointAtDistance(host, right - hostStart);
      const dLeft = atLeft ? (atLeft.x - point.x) ** 2 + (atLeft.y - point.y) ** 2 : Infinity;
      const dRight = atRight ? (atRight.x - point.x) ** 2 + (atRight.y - point.y) ** 2 : Infinity;
      if (dLeft < dRight) hi = right;
      else lo = left;
    }
    mapped.push({ station: (lo + hi) / 2, elevation: point.elevation });
  }
  mapped.sort((a, b) => a.station - b.station);
  return mapped;
}

export interface QuickProfileSample {
  distance: number;
  elevations: { name: string; elevation: number | null }[];
}

export function quickProfile(
  line: Vec2[],
  surfaces: { name: string; points: SurveyPoint[]; triangles: Triangle[] }[],
  interval: number,
): QuickProfileSample[] {
  if (line.length < 2) return [];
  const distances = [0];
  for (let i = 1; i < line.length; i++) distances.push(distances[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y));
  const total = distances[distances.length - 1];
  const step = interval > 0.05 ? interval : Math.max(total / 20, 1);
  const stations: number[] = [];
  for (let distance = 0; distance <= total + 1e-6; distance += step) {
    stations.push(Math.min(distance, total));
    if (distance >= total - 1e-6) break;
  }
  if (Math.abs(stations[stations.length - 1] - total) > 1e-3) stations.push(total);
  const pointAt = (distance: number): Vec2 => {
    const target = Math.min(Math.max(distance, 0), total);
    for (let i = 1; i < line.length; i++) {
      if (distances[i] + 1e-8 < target && i !== line.length - 1) continue;
      const span = distances[i] - distances[i - 1];
      const t = span <= 1e-12 ? 0 : (target - distances[i - 1]) / span;
      return { x: line[i - 1].x + (line[i].x - line[i - 1].x) * t, y: line[i - 1].y + (line[i].y - line[i - 1].y) * t };
    }
    return line[line.length - 1];
  };
  return stations.map((distance) => {
    const point = pointAt(distance);
    return {
      distance,
      elevations: surfaces.map((surface) => ({
        name: surface.name,
        elevation: elevationAt(surface.points, surface.triangles, point.x, point.y),
      })),
    };
  });
}
