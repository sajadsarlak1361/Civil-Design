import { rememberBvh, unpackBvh, type BvhPacked } from './bvh';
import { getCpuLimit, workerCount } from './budget';
import { generateContours } from './contours';
import { heightfieldFromPacked, lodResolution, rasterHeightfield, type Heightfield, type ShadeMode } from './lod';
import { parsePointFile, type DelimiterChoice, type FormatChoice, type PointParseResult } from './points';
import { cancelPool, poolAvailable, runPool } from './pool';
import { surfaceStats } from './stats';
import { buildTin, type BuildOptions, type Tin } from './tin';
import type { TaskHandle } from './tasks';
import type { ContourPolyline, SurveyPoint, Triangle } from './types';

const OFF_THREAD = 25_000;

export interface PreparedSurface {
  tin: Tin;
  contours: ContourPolyline[];
  field: Heightfield | null;
  pixels: Uint8ClampedArray | null;
  shade: ShadeMode;
}

function packInput(points: SurveyPoint[]): { xyz: Float64Array; source: number[] } {
  const xyz = new Float64Array(points.length * 3);
  const source: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) continue;
    const n = source.length;
    xyz[n * 3] = point.x;
    xyz[n * 3 + 1] = point.y;
    xyz[n * 3 + 2] = point.z;
    source.push(i);
  }
  return { xyz: xyz.subarray(0, source.length * 3), source };
}

function hydrate(input: SurveyPoint[], source: number[], xyz: Float64Array, indices: Uint32Array, kept: Uint32Array): Tin {
  const points: SurveyPoint[] = new Array(kept.length);
  for (let i = 0; i < kept.length; i++) {
    const src = input[source[kept[i]]];
    points[i] = {
      x: xyz[i * 3],
      y: xyz[i * 3 + 1],
      z: xyz[i * 3 + 2],
      number: src?.number,
      description: src?.description,
      role: src?.role ?? 'survey',
    };
  }
  const triangles: Triangle[] = new Array(indices.length / 3);
  for (let i = 0; i < triangles.length; i++) triangles[i] = [indices[i * 3], indices[i * 3 + 1], indices[i * 3 + 2]];
  return { points, triangles };
}

function packTin(tin: Tin): { xyz: Float64Array; indices: Uint32Array } {
  const xyz = new Float64Array(tin.points.length * 3);
  for (let i = 0; i < tin.points.length; i++) {
    xyz[i * 3] = tin.points[i].x;
    xyz[i * 3 + 1] = tin.points[i].y;
    xyz[i * 3 + 2] = tin.points[i].z;
  }
  const indices = new Uint32Array(tin.triangles.length * 3);
  for (let i = 0; i < tin.triangles.length; i++) {
    indices[i * 3] = tin.triangles[i][0];
    indices[i * 3 + 1] = tin.triangles[i][1];
    indices[i * 3 + 2] = tin.triangles[i][2];
  }
  return { xyz, indices };
}

async function indexSurface(tin: Tin, xyz: Float64Array, indices: Uint32Array, signal?: AbortSignal): Promise<void> {
  if (tin.triangles.length < 8_000 || !poolAvailable()) return;
  const reply = await runPool<BvhPacked & { count: number }>('bvh', { xyz, indices }, [xyz.buffer, indices.buffer], signal);
  rememberBvh(tin.triangles, unpackBvh(reply));
}

export async function prepareSurface(
  input: SurveyPoint[],
  options: BuildOptions & { minor?: number; major?: number; shade?: ShadeMode } = {},
  task?: TaskHandle,
): Promise<PreparedSurface> {
  const shade = options.shade ?? 'elevation';
  const minor = options.minor ?? 1;
  const major = options.major ?? 5;
  if (input.length < OFF_THREAD || !poolAvailable()) {
    task?.stage('Triangulating', 0.15);
    const tin = buildTin(input, options);
    task?.stage('Building contours', 0.55);
    const contours = tin.triangles.length > 0 && minor > 0 ? generateContours(tin.points, tin.triangles, minor, major, tin.triangles.length < 20_000) : [];
    task?.stage('Rendering', 0.85);
    surfaceStats(tin.points, tin.triangles);
    const field = tin.points.length > 20_000 ? heightfieldFromPacked(packTin(tin).xyz, lodResolution(tin.points.length)) : null;
    const pixels = field ? rasterHeightfield(field, shade) : null;
    task?.progress(1);
    return { tin, contours, field, pixels, shade };
  }

  task?.stage('Triangulating', 0.05);
  const constrained =
    (options.boundary != null && options.boundary.length >= 3) ||
    (options.breaklines != null && options.breaklines.length > 0) ||
    (options.maxEdgeLength != null && options.maxEdgeLength > 0);
  let tin: Tin;
  try {
    if (constrained) {
      const reply = await runPool<{ points: SurveyPoint[]; triangles: Triangle[] }>('constrained', { points: input, build: options }, [], task?.signal);
      tin = { points: reply.points, triangles: reply.triangles };
    } else {
      const packedInput = packInput(input);
      const xyz = new Float64Array(packedInput.xyz);
      const reply = await runPool<{ xyz: Float64Array; indices: Uint32Array; kept: Uint32Array }>('tin', { xyz, tolerance: options.tolerance ?? 1e-4 }, [xyz.buffer], task?.signal);
      tin = hydrate(input, packedInput.source, reply.xyz, reply.indices, reply.kept);
    }
    if (task?.signal.aborted) throw abortError();
  } catch (error) {
    if (task?.signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    tin = buildTin(input, options);
  }
  task?.stage('Building contours', 0.45);
  const mesh = packTin(tin);
  const contourXyz = mesh.xyz.slice();
  const contourIndex = mesh.indices.slice();
  const bvhXyz = mesh.xyz.slice();
  const bvhIndex = mesh.indices.slice();
  const workers = workerCount(getCpuLimit());
  const contourJob =
    workers >= 1 && poolAvailable()
      ? runPool<{ lines: ContourPolyline[] }>('contours', { xyz: contourXyz, indices: contourIndex, minor, major, smooth: false }, [contourXyz.buffer, contourIndex.buffer], task?.signal)
          .then((reply) => reply.lines)
          .catch(() => generateContours(tin.points, tin.triangles, minor, major, false))
      : Promise.resolve(generateContours(tin.points, tin.triangles, minor, major, false));
  const bvhJob = indexSurface(tin, bvhXyz, bvhIndex, task?.signal).catch(() => undefined);
  task?.stage('Indexing surface', 0.6);
  const field = heightfieldFromPacked(mesh.xyz, lodResolution(tin.points.length));
  const pixels = rasterHeightfield(field, shade);
  const contours = await contourJob;
  await bvhJob;
  if (task?.signal.aborted) throw abortError();
  task?.stage('Rendering', 0.92);
  surfaceStats(tin.points, tin.triangles);
  task?.progress(1);
  return { tin, contours, field, pixels, shade };
}

function abortError(): Error {
  const error = new Error('The operation was cancelled.');
  error.name = 'AbortError';
  return error;
}

export function splitPointText(text: string, parts: number): string[] {
  if (parts <= 1 || text.length < 1_000_000) return [text];
  const chunks: string[] = [];
  const size = Math.ceil(text.length / parts);
  let start = 0;
  while (start < text.length && chunks.length < parts) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const nl = text.indexOf('\n', end);
      end = nl < 0 ? text.length : nl + 1;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

export async function parsePointsOffThread(
  text: string,
  options: { format?: FormatChoice; delimiter?: DelimiterChoice } = {},
  task?: TaskHandle,
): Promise<PointParseResult> {
  if (text.length < 750_000 || !poolAvailable()) return parsePointFile(text, options);
  task?.stage('Parsing points', 0.1);
  const probe = parsePointFile(text.slice(0, 8000), options);
  const parts = splitPointText(text, workerCount(getCpuLimit()));
  let done = 0;
  const parsed = await Promise.all(
    parts.map((part) =>
      runPool<{ points: SurveyPoint[]; skipped: number; delimiter: PointParseResult['delimiter']; format: PointParseResult['format'] }>(
        'parse',
        { text: part, format: probe.format, delimiter: probe.delimiter },
        [],
        task?.signal,
      ).then((reply) => {
        done += 1;
        task?.progress(done / parts.length);
        return reply;
      }),
    ),
  );
  const points: SurveyPoint[] = [];
  let skipped = 0;
  for (const part of parsed) {
    for (let i = 0; i < part.points.length; i++) points.push(part.points[i]);
    skipped += part.skipped;
  }
  return {
    points,
    skipped: skipped ? [{ line: 0, text: '', reason: `${skipped} lines skipped` }] : [],
    delimiter: probe.delimiter,
    format: probe.format,
    columns: probe.columns,
  };
}

export async function contoursOffThread(
  points: SurveyPoint[],
  triangles: Triangle[],
  minor: number,
  major: number,
  signal?: AbortSignal,
): Promise<ContourPolyline[]> {
  if (triangles.length < 8_000 || !poolAvailable()) return generateContours(points, triangles, minor, major, true);
  const mesh = packTin({ points, triangles });
  try {
    const reply = await runPool<{ lines: ContourPolyline[] }>('contours', { xyz: mesh.xyz, indices: mesh.indices, minor, major, smooth: false }, [mesh.xyz.buffer, mesh.indices.buffer], signal);
    return reply.lines;
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    return generateContours(points, triangles, minor, major, false);
  }
}

export function cancelSurfaceWork(task: TaskHandle): void {
  const id = Number(task.id.replace(/\D/g, ''));
  if (Number.isFinite(id)) cancelPool(id);
  task.cancel();
}
