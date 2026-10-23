import { applyAssembly, type Assembly, type AssemblySection, type SectionLink } from './assembly';
import { entityEndpoints, pointAtStation, type SolvedAlignment } from './alignment';
import type { FeatureVertex } from './featureLine';
import { elevationAt } from './tin';
import { TriangleBvh } from './bvh';
import type { EndAreaSample } from './masshaul';
import { averageEndAreas } from './masshaul';
import type { SuperelevationStation } from './superelevation';
import type { SurveyPoint, Triangle } from './types';
import { elevationOnProfile, type VerticalPvi } from './vertical';

export interface CorridorFeatureVertex extends FeatureVertex {
  station: number;
  offset: number;
}

export interface CorridorStationModel {
  station: number;
  x: number;
  y: number;
  /** Unit tangent in the direction of increasing station. */
  tx: number;
  ty: number;
  elevation: number;
  section: AssemblySection;
}

export interface CorridorModel {
  stations: CorridorStationModel[];
  featureLines: { code: string; points: CorridorFeatureVertex[] }[];
  surfacePoints: SurveyPoint[];
  surfaceTriangles: Triangle[];
  endAreas: EndAreaSample[];
  cut: number;
  fill: number;
  pavementArea: number;
  shoulderArea: number;
  curbLength: number;
  warnings: string[];
}

export interface CorridorBuildInput {
  solved: SolvedAlignment;
  startStation: number;
  profile: VerticalPvi[];
  assembly: Assembly;
  frequency: number;
  regionStart?: number;
  regionEnd?: number;
  surfacePoints?: SurveyPoint[];
  surfaceTriangles?: Triangle[];
  sampleHalfWidth?: number;
  superelevation?: SuperelevationStation[];
}

function pushTri(points: SurveyPoint[], tris: Triangle[], ia: number, ib: number, ic: number): void {
  const a = points[ia];
  const b = points[ib];
  const c = points[ic];
  const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(area) < 1e-8) return;
  tris.push(area > 0 ? [ia, ib, ic] : [ia, ic, ib]);
}

export function corridorStations(length: number, startStation: number, frequency: number, extra: number[], regionStart?: number, regionEnd?: number): number[] {
  const from = Math.max(startStation, regionStart ?? startStation);
  const to = Math.min(startStation + length, regionEnd ?? startStation + length);
  if (!(to > from)) return [];
  const step = frequency > 0.2 ? frequency : Math.max((to - from) / 20, 1);
  const values: number[] = [];
  const add = (station: number) => {
    if (station < from - 1e-6 || station > to + 1e-6) return;
    const clamped = Math.min(to, Math.max(from, station));
    if (values.some((value) => Math.abs(value - clamped) < 1e-3)) return;
    values.push(clamped);
  };
  add(from);
  for (let station = from + step; station < to - 1e-6; station += step) add(station);
  for (const station of extra) add(station);
  add(to);
  values.sort((a, b) => a - b);
  return values;
}

function slopesAt(stations: SuperelevationStation[] | undefined, station: number): { left?: number; right?: number } {
  if (!stations || stations.length === 0) return {};
  if (station <= stations[0].station) return { left: stations[0].leftSlope, right: stations[0].rightSlope };
  const last = stations[stations.length - 1];
  if (station >= last.station) return { left: last.leftSlope, right: last.rightSlope };
  for (let i = 1; i < stations.length; i++) {
    if (station > stations[i].station) continue;
    const span = stations[i].station - stations[i - 1].station;
    const t = span <= 1e-12 ? 0 : (station - stations[i - 1].station) / span;
    return {
      left: stations[i - 1].leftSlope + (stations[i].leftSlope - stations[i - 1].leftSlope) * t,
      right: stations[i - 1].rightSlope + (stations[i].rightSlope - stations[i - 1].rightSlope) * t,
    };
  }
  return {};
}

function topPoints(section: AssemblySection): SectionLink[] {
  return section.links.filter((link) => link.code === 'Top' || link.code === 'Daylight');
}

export function buildCorridor(input: CorridorBuildInput): CorridorModel {
  const warnings: string[] = [];
  const extras = [
    ...entityEndpoints(input.solved).map((distance) => input.startStation + distance),
    ...input.profile.flatMap((pvi) => [pvi.station - pvi.curveLength / 2, pvi.station, pvi.station + pvi.curveLength / 2]),
  ];
  const stations = corridorStations(input.solved.length, input.startStation, input.frequency, extras, input.regionStart, input.regionEnd);
  const ground = input.surfacePoints && input.surfaceTriangles && input.surfaceTriangles.length > 0 ? input.surfaceTriangles : null;
  const index = ground && input.surfacePoints ? new TriangleBvh(input.surfacePoints, ground) : undefined;
  const half = input.sampleHalfWidth && input.sampleHalfWidth > 1 ? input.sampleHalfWidth : 80;
  const models: CorridorStationModel[] = [];
  for (const station of stations) {
    const at = pointAtStation(input.solved, input.startStation, station);
    if (!at) continue;
    const elevation = elevationOnProfile(input.profile, station);
    if (elevation === null) {
      warnings.push(`No design elevation at station ${station.toFixed(2)}.`);
      continue;
    }
    const rx = at.ty;
    const ry = -at.tx;
    const egAt = (offset: number) => {
      if (!ground || !input.surfacePoints) return null;
      if (Math.abs(offset) > half) return null;
      return elevationAt(input.surfacePoints, ground, at.x + rx * offset, at.y + ry * offset, index);
    };
    const superSlopes = slopesAt(input.superelevation, station);
    const section = applyAssembly(input.assembly, {
      centerElevation: elevation,
      egAt,
      leftSlope: superSlopes.left,
      rightSlope: superSlopes.right,
    });
    models.push({ station, x: at.x, y: at.y, tx: at.tx, ty: at.ty, elevation, section });
  }
  const featureLines = featureLinesFromStations(models);
  const surface = corridorSurface(models);
  const endAreas: EndAreaSample[] = models.map((model) => ({
    station: model.station,
    cut: model.section.cutArea,
    fill: model.section.fillArea,
  }));
  const increments = averageEndAreas(endAreas);
  const cut = increments.reduce((sum, increment) => sum + increment.cut, 0);
  const fill = increments.reduce((sum, increment) => sum + increment.fill, 0);
  const quantities = linkQuantities(models);
  if (models.length < 2) warnings.push('The corridor needs at least two stations.');
  return {
    stations: models,
    featureLines,
    surfacePoints: surface.points,
    surfaceTriangles: surface.triangles,
    endAreas,
    cut,
    fill,
    pavementArea: quantities.pavement,
    shoulderArea: quantities.shoulder,
    curbLength: quantities.curb,
    warnings,
  };
}

function featureLinesFromStations(models: CorridorStationModel[]): { code: string; points: CorridorFeatureVertex[] }[] {
  const codes = ['Crown', 'ETW', 'Shoulder', 'Daylight', 'TopCurb', 'BackCurb', 'Gutter', 'Sidewalk'];
  const lines: { code: string; points: CorridorFeatureVertex[] }[] = [];
  for (const code of codes) {
    for (const side of [-1, 1] as const) {
      const points: CorridorFeatureVertex[] = [];
      for (const model of models) {
        const matches = model.section.points.filter((point) => point.code === code && (code === 'Crown' || Math.sign(point.offset) === side || point.offset === 0));
        if (code === 'Crown' && side === -1) continue;
        const point = matches.sort((a, b) => Math.abs(b.offset) - Math.abs(a.offset))[0];
        if (!point) {
          if (points.length > 1) {
            lines.push({ code: code === 'Crown' ? code : `${code}-${side > 0 ? 'R' : 'L'}`, points: [...points] });
          }
          points.length = 0;
          continue;
        }
        const at = pointAtOffset(model, point.offset);
        points.push({ x: at.x, y: at.y, z: point.elevation, station: model.station, offset: point.offset });
      }
      if (points.length > 1) lines.push({ code: code === 'Crown' ? code : `${code}-${side > 0 ? 'R' : 'L'}`, points: [...points] });
    }
  }
  return lines;
}

function corridorSurface(models: CorridorStationModel[]): { points: SurveyPoint[]; triangles: Triangle[] } {
  const points: SurveyPoint[] = [];
  const triangles: Triangle[] = [];
  const rows: number[][] = [];
  for (const model of models) {
    const links = topPoints(model.section);
    const rowPoints = new Map<number, { offset: number; elevation: number }>();
    for (const link of links) {
      rowPoints.set(Math.round(link.a.offset * 1000), link.a);
      rowPoints.set(Math.round(link.b.offset * 1000), link.b);
    }
    const ordered = [...rowPoints.values()].sort((a, b) => a.offset - b.offset);
    const row: number[] = [];
    for (const point of ordered) {
      const at = pointAtOffset(model, point.offset);
      row.push(points.length);
      points.push({ x: at.x, y: at.y, z: point.elevation, role: 'breakline', description: 'CORRIDOR' });
    }
    rows.push(row);
  }
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    const count = Math.min(a.length, b.length);
    for (let j = 0; j < count - 1; j++) {
      pushTri(points, triangles, a[j], a[j + 1], b[j + 1]);
      pushTri(points, triangles, a[j], b[j + 1], b[j]);
    }
  }
  return { points, triangles };
}

function pointAtOffset(model: CorridorStationModel, offset: number): { x: number; y: number } {
  return { x: model.x + model.ty * offset, y: model.y - model.tx * offset };
}

function linkQuantities(models: CorridorStationModel[]): { pavement: number; shoulder: number; curb: number } {
  let pavement = 0;
  let shoulder = 0;
  let curb = 0;
  for (let i = 0; i < models.length - 1; i++) {
    const ds = models[i + 1].station - models[i].station;
    pavement += widthOf(models[i], 'Lane') * ds;
    shoulder += widthOf(models[i], 'Shoulder') * ds;
    curb += models[i].section.links.filter((link) => link.name.toLowerCase().includes('curb') && link.code === 'Top').length > 0 ? ds : 0;
  }
  return { pavement, shoulder, curb };
}

function widthOf(model: CorridorStationModel, name: string): number {
  return model.section.links
    .filter((link) => link.code === 'Top' && link.name === name)
    .reduce((sum, link) => sum + Math.abs(link.b.offset - link.a.offset), 0);
}

export function profileFromCorridor(model: CorridorModel, code: string): { station: number; elevation: number }[] {
  const line = model.featureLines.find((feature) => feature.code === code);
  if (!line) return [];
  return line.points.map((point) => ({ station: point.station, elevation: point.z }));
}
