import { parseDxf, type DxfModel } from './formats/dxfDoc';
import { DXF_BULK_BYTES } from './formats/dxfStream';
import { readGeoTiff } from './formats/geotiff';
import { gridToPoints, parseAsc, parseXyzGrid } from './formats/grid';
import { readLas } from './formats/las';
import { parseGltf, parseObj, parseStl } from './formats/mesh';
import { poolAvailable, runPool } from './pool';
import type { TaskHandle } from './tasks';
import type { SurveyPoint, Triangle } from './types';

/** Binary clouds and rasters at or above this size parse on the worker pool. */
export const HEAVY_BYTES = 500_000;
/** Text DEM and mesh files at or above this size parse on the worker pool. */
export const HEAVY_TEXT = 750_000;

export function heavyBinary(bytes: Uint8Array): boolean {
  return bytes.byteLength >= HEAVY_BYTES && poolAvailable();
}

export function heavyText(text: string): boolean {
  return text.length >= HEAVY_TEXT && poolAvailable();
}

async function offThread<T>(op: string, message: Record<string, unknown>, transfer: Transferable[], task: TaskHandle | undefined, stage: string): Promise<T> {
  task?.stage(stage, 0.2);
  return runPool<T>(op, message, transfer, task?.signal);
}

export async function readDxfOffThread(bytes: Uint8Array, task?: TaskHandle): Promise<DxfModel> {
  if (bytes.byteLength < DXF_BULK_BYTES || !poolAvailable()) return parseDxf(bytes);
  const reply = await offThread<{
    entities?: DxfModel['entities'];
    faces?: DxfModel['faces'];
    layers?: string[];
    layerRecords?: DxfModel['layerRecords'];
    bulk?: DxfModel['bulk'];
  }>('dxf', { bytes }, [bytes.buffer], task, 'Reading DXF');
  return {
    entities: reply.entities ?? [],
    faces: reply.faces ?? [],
    layers: reply.layers ?? [],
    layerRecords: reply.layerRecords,
    bulk: reply.bulk,
  };
}

export async function readLasOffThread(bytes: Uint8Array, task?: TaskHandle): Promise<SurveyPoint[]> {
  if (!heavyBinary(bytes)) return readLas(bytes);
  const copy = bytes.slice();
  const reply = await offThread<{ points: SurveyPoint[] }>('las', { bytes: copy }, [copy.buffer], task, 'Reading LAS');
  return reply.points;
}

export async function readDemOffThread(text: string, task?: TaskHandle): Promise<SurveyPoint[]> {
  if (!heavyText(text)) return gridToPoints(parseAsc(text));
  const reply = await offThread<{ points: SurveyPoint[] }>('dem', { text }, [], task, 'Reading DEM');
  return reply.points;
}

export async function readXyzGridOffThread(text: string, task?: TaskHandle): Promise<SurveyPoint[]> {
  if (!heavyText(text)) return gridToPoints(parseXyzGrid(text));
  const reply = await offThread<{ points: SurveyPoint[] }>('xyz-grid', { text }, [], task, 'Reading XYZ grid');
  return reply.points;
}

export async function readGeoTiffOffThread(bytes: Uint8Array, task?: TaskHandle): Promise<SurveyPoint[]> {
  if (!heavyBinary(bytes)) return gridToPoints(readGeoTiff(bytes));
  const copy = bytes.slice();
  const reply = await offThread<{ points: SurveyPoint[] }>('geotiff', { bytes: copy }, [copy.buffer], task, 'Reading GeoTIFF');
  return reply.points;
}

export type MeshKind = 'obj' | 'stl' | 'gltf';

export async function readMeshOffThread(kind: MeshKind, text: string, task?: TaskHandle): Promise<{ points: SurveyPoint[]; triangles: Triangle[] }> {
  if (!heavyText(text)) {
    if (kind === 'obj') return parseObj(text);
    if (kind === 'stl') return parseStl(text);
    return parseGltf(text);
  }
  return offThread<{ points: SurveyPoint[]; triangles: Triangle[] }>(kind, { text }, [], task, `Reading ${kind.toUpperCase()}`);
}
