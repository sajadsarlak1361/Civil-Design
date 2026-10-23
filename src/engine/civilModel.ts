import type { Assembly, Subassembly } from './assembly';
import type { CogoPoint, PointGroupQuery } from './cogo';
import type { CorridorFeatureVertex } from './corridor';
import type { FeatureLine } from './featureLine';
import type { CurbReturn } from './intersection';
import type { MassHaulResult } from './masshaul';
import type { Parcel } from './parcels';
import type { GravityPipe, GravityPipeResult, PipeStructure } from './pipes';
import type { PressureNode, PressurePipe, PressureResult } from './pressure';
import type { SuperelevationCurve, SuperelevationStation } from './superelevation';

export interface CorridorRecord {
  id: string;
  name: string;
  alignmentId: string;
  assemblyId: string;
  surfaceId: string | null;
  frequency: number;
  cut: number;
  fill: number;
  pavementArea: number;
  shoulderArea: number;
  featureLines: { code: string; points: CorridorFeatureVertex[] }[];
  endAreas: { station: number; cut: number; fill: number }[];
}

export interface GradingRecord {
  id: string;
  name: string;
  featureLineId: string;
  side: 'left' | 'right' | 'both';
  cutSlope: number;
  fillSlope: number;
  surfaceId: string;
}

export interface IntersectionRecord {
  id: string;
  name: string;
  alignmentA: string;
  alignmentB: string;
  stationA: number;
  stationB: number;
  returns: CurbReturn[];
}

export interface PipeNetworkRecord {
  id: string;
  name: string;
  structures: PipeStructure[];
  pipes: GravityPipe[];
  results: GravityPipeResult[];
}

export interface PressureNetworkRecord {
  id: string;
  name: string;
  nodes: PressureNode[];
  pipes: PressurePipe[];
  result: PressureResult;
}

export interface CivilModel {
  points: CogoPoint[];
  pointGroups: PointGroupQuery[];
  featureLines: FeatureLine[];
  gradings: GradingRecord[];
  assemblies: Assembly[];
  corridors: CorridorRecord[];
  intersections: IntersectionRecord[];
  pipeNetworks: PipeNetworkRecord[];
  pressureNetworks: PressureNetworkRecord[];
  parcels: Parcel[];
  superelevation: { alignmentId: string; stations: SuperelevationStation[]; curves: SuperelevationCurve[] } | null;
  massHaul: MassHaulResult | null;
}

export function emptyCivil(): CivilModel {
  return {
    points: [],
    pointGroups: [],
    featureLines: [],
    gradings: [],
    assemblies: [],
    corridors: [],
    intersections: [],
    pipeNetworks: [],
    pressureNetworks: [],
    parcels: [],
    superelevation: null,
    massHaul: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function vec(value: unknown): { x: number; y: number; z: number } | null {
  if (!isRecord(value)) return null;
  if (typeof value.x !== 'number' || typeof value.y !== 'number') return null;
  return { x: value.x, y: value.y, z: num(value.z) };
}

export function parseCivil(value: unknown): CivilModel {
  const empty = emptyCivil();
  if (!isRecord(value)) return empty;
  const points: CogoPoint[] = [];
  if (Array.isArray(value.points)) {
    for (const item of value.points) {
      const point = vec(item);
      if (!point || !isRecord(item)) continue;
      points.push({
        id: str(item.id, `pt-${points.length + 1}`),
        number: num(item.number, points.length + 1),
        x: point.x,
        y: point.y,
        z: point.z,
        description: typeof item.description === 'string' ? item.description : '',
      });
    }
  }
  const featureLines: FeatureLine[] = [];
  if (Array.isArray(value.featureLines)) {
    for (const item of value.featureLines) {
      if (!isRecord(item) || !Array.isArray(item.points)) continue;
      const vertices = item.points.map(vec).filter((point): point is { x: number; y: number; z: number } => point !== null);
      if (vertices.length < 2) continue;
      featureLines.push({
        id: str(item.id, `fl-${featureLines.length + 1}`),
        name: str(item.name, `Feature line ${featureLines.length + 1}`),
        points: vertices,
        closed: Boolean(item.closed),
      });
    }
  }
  return {
    ...empty,
    points,
    featureLines,
    pointGroups: Array.isArray(value.pointGroups) ? (value.pointGroups as PointGroupQuery[]) : [],
    gradings: Array.isArray(value.gradings) ? (value.gradings as GradingRecord[]) : [],
    assemblies: Array.isArray(value.assemblies) ? (value.assemblies.filter(isAssembly) as Assembly[]) : [],
    corridors: Array.isArray(value.corridors) ? (value.corridors as CorridorRecord[]) : [],
    intersections: Array.isArray(value.intersections) ? (value.intersections as IntersectionRecord[]) : [],
    pipeNetworks: Array.isArray(value.pipeNetworks) ? (value.pipeNetworks as PipeNetworkRecord[]) : [],
    pressureNetworks: Array.isArray(value.pressureNetworks) ? (value.pressureNetworks as PressureNetworkRecord[]) : [],
    parcels: Array.isArray(value.parcels) ? (value.parcels as Parcel[]) : [],
    superelevation: isRecord(value.superelevation) ? (value.superelevation as CivilModel['superelevation']) : null,
    massHaul: isRecord(value.massHaul) ? (value.massHaul as unknown as MassHaulResult) : null,
  };
}

function isAssembly(value: unknown): value is Assembly {
  if (!isRecord(value) || !Array.isArray(value.right)) return false;
  return value.right.every(isSubassembly);
}

function isSubassembly(value: unknown): value is Subassembly {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  return value.kind === 'lane' || value.kind === 'shoulder' || value.kind === 'curb' || value.kind === 'sidewalk' || value.kind === 'daylight';
}
