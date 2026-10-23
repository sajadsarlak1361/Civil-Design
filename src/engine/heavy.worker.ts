import { packBvh, TriangleBvh } from './bvh';
import { generateContoursPacked } from './contours';
import { parseDxf } from './formats/dxfDoc';
import { readGeoTiff } from './formats/geotiff';
import { gridToPoints, parseAsc, parseXyzGrid } from './formats/grid';
import { readLas } from './formats/las';
import { parseGltf, parseObj, parseStl } from './formats/mesh';
import { parsePointFile, type DelimiterChoice, type FormatChoice } from './points';
import { dedupeCoords, triangulateCoords, buildTin } from './tin';
import type { BuildOptions } from './tin';
import type { SurveyPoint, Triangle } from './types';

interface WorkerRequest {
  id?: number;
  op?: string;
  xyz?: Float64Array;
  indices?: Uint32Array;
  coords?: Float64Array;
  numbers?: string[];
  descriptions?: string[];
  roles?: string[];
  options?: BuildOptions;
  tolerance?: number;
  minor?: number;
  major?: number;
  smooth?: boolean;
  text?: string;
  format?: FormatChoice;
  delimiter?: DelimiterChoice;
  bytes?: Uint8Array;
}

const post = (data: object, transfer: Transferable[] = []) => {
  (globalThis as unknown as { postMessage: (data: object, transfer: Transferable[]) => void }).postMessage(data, transfer);
};

function fail(id: number | undefined, error: unknown): void {
  const message = error instanceof Error ? error.message : 'TIN build failed.';
  post({
    id,
    error: message,
    coords: new Float64Array(0),
    numbers: [],
    descriptions: [],
    roles: [],
    triangles: new Uint32Array(0),
  });
}

function legacyTin(data: WorkerRequest): void {
  const coords = data.coords ?? new Float64Array(0);
  const count = coords.length / 3;
  const points: SurveyPoint[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const role = data.roles?.[i];
    points[i] = {
      x: coords[i * 3],
      y: coords[i * 3 + 1],
      z: coords[i * 3 + 2],
      number: data.numbers?.[i] ?? '',
      description: data.descriptions?.[i] ?? '',
      role: role === 'boundary' || role === 'breakline' ? role : 'survey',
    };
  }
  const tin = buildTin(points, data.options ?? {});
  const out = new Float64Array(tin.points.length * 3);
  const numbers = new Array<string>(tin.points.length);
  const descriptions = new Array<string>(tin.points.length);
  const roles = new Array<string>(tin.points.length);
  for (let i = 0; i < tin.points.length; i++) {
    const point = tin.points[i];
    out[i * 3] = point.x;
    out[i * 3 + 1] = point.y;
    out[i * 3 + 2] = point.z;
    numbers[i] = point.number ?? '';
    descriptions[i] = point.description ?? '';
    roles[i] = point.role ?? 'survey';
  }
  const triangles = new Uint32Array(tin.triangles.length * 3);
  for (let i = 0; i < tin.triangles.length; i++) {
    triangles[i * 3] = tin.triangles[i][0];
    triangles[i * 3 + 1] = tin.triangles[i][1];
    triangles[i * 3 + 2] = tin.triangles[i][2];
  }
  post({ id: data.id, coords: out, numbers, descriptions, roles, triangles }, [out.buffer, triangles.buffer]);
}

function pointsOf(xyz: Float64Array): SurveyPoint[] {
  const points: SurveyPoint[] = new Array(xyz.length / 3);
  for (let i = 0; i < points.length; i++) points[i] = { x: xyz[i * 3], y: xyz[i * 3 + 1], z: xyz[i * 3 + 2] };
  return points;
}

function trianglesOf(indices: Uint32Array): Triangle[] {
  const triangles: Triangle[] = new Array(indices.length / 3);
  for (let i = 0; i < triangles.length; i++) triangles[i] = [indices[i * 3], indices[i * 3 + 1], indices[i * 3 + 2]];
  return triangles;
}

globalThis.addEventListener('message', (event: Event) => {
  const data = (event as MessageEvent<WorkerRequest>).data;
  if (!data || data.op === 'cancel') return;
  try {
    if (!data.op) {
      legacyTin(data);
      return;
    }
    if (data.op === 'tin') {
      const xyz = data.xyz ?? new Float64Array(0);
      const packed = dedupeCoords(xyz, data.tolerance ?? 1e-4);
      const indices = triangulateCoords(packed.xyz);
      post({ id: data.id, op: 'tin', xyz: packed.xyz, indices, kept: packed.kept }, [packed.xyz.buffer, indices.buffer, packed.kept.buffer]);
      return;
    }
    if (data.op === 'contours') {
      const lines = generateContoursPacked(data.xyz ?? new Float64Array(0), data.indices ?? new Uint32Array(0), data.minor ?? 1, data.major ?? 5, data.smooth ?? false);
      post({ id: data.id, op: 'contours', lines });
      return;
    }
    if (data.op === 'bvh') {
      const bvh = new TriangleBvh(pointsOf(data.xyz ?? new Float64Array(0)), trianglesOf(data.indices ?? new Uint32Array(0)));
      const packed = packBvh(bvh);
      post(
        { id: data.id, op: 'bvh', minX: packed.minX, minY: packed.minY, maxX: packed.maxX, maxY: packed.maxY, left: packed.left, right: packed.right, tri: packed.tri, count: packed.count },
        [packed.minX.buffer, packed.minY.buffer, packed.maxX.buffer, packed.maxY.buffer, packed.left.buffer, packed.right.buffer, packed.tri.buffer],
      );
      return;
    }
    if (data.op === 'constrained') {
      const body = data as WorkerRequest & { points?: SurveyPoint[]; build?: BuildOptions };
      const tin = buildTin(body.points ?? [], body.build ?? {});
      post({ id: data.id, op: 'constrained', points: tin.points, triangles: tin.triangles });
      return;
    }
    if (data.op === 'parse') {
      const parsed = parsePointFile(data.text ?? '', { format: data.format, delimiter: data.delimiter });
      post({ id: data.id, op: 'parse', points: parsed.points, skipped: parsed.skipped.length, delimiter: parsed.delimiter, format: parsed.format });
      return;
    }
    if (data.op === 'dxf') {
      const model = parseDxf(data.bytes ?? new Uint8Array());
      const transfers: Transferable[] = [];
      if (model.bulk) {
        if (model.bulk.segments.byteLength > 0) transfers.push(model.bulk.segments.buffer);
        if (model.bulk.points.byteLength > 0) transfers.push(model.bulk.points.buffer);
      }
      post(
        { id: data.id, op: 'dxf', entities: model.entities, faces: model.faces, layers: model.layers, layerRecords: model.layerRecords, bulk: model.bulk },
        transfers,
      );
      return;
    }
    if (data.op === 'las') {
      post({ id: data.id, op: 'las', points: readLas(data.bytes ?? new Uint8Array()) });
      return;
    }
    if (data.op === 'dem') {
      post({ id: data.id, op: 'dem', points: gridToPoints(parseAsc(data.text ?? '')) });
      return;
    }
    if (data.op === 'xyz-grid') {
      post({ id: data.id, op: 'xyz-grid', points: gridToPoints(parseXyzGrid(data.text ?? '')) });
      return;
    }
    if (data.op === 'geotiff') {
      post({ id: data.id, op: 'geotiff', points: gridToPoints(readGeoTiff(data.bytes ?? new Uint8Array())) });
      return;
    }
    if (data.op === 'obj' || data.op === 'stl' || data.op === 'gltf') {
      const parsed = data.op === 'obj' ? parseObj(data.text ?? '') : data.op === 'stl' ? parseStl(data.text ?? '') : parseGltf(data.text ?? '');
      post({ id: data.id, op: data.op, points: parsed.points, triangles: parsed.triangles });
      return;
    }
    post({ id: data.id, error: 'TIN build failed.' });
  } catch (error) {
    fail(data.id, error);
  }
});
