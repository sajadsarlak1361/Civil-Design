import MeshWorker from './mesh.worker.ts?worker&inline';
import { buildMesh, type MeshBuildOptions, type MeshBuildResult } from './mesh';
import { sectionMesh, type DesignPoint, type MeshCrossSection, type SectionPlane } from './meshSection';
import type { SurveyPoint, Triangle } from './types';

/** Clouds at or above this size are reconstructed off the main thread. */
export const MESH_WORKER_MIN = 800;

export class MeshCancelled extends Error {
  constructor() {
    super('3D mesh cancelled.');
    this.name = 'MeshCancelled';
  }
}

let active: { worker: Worker; cancel: () => void } | null = null;

/** Stop the mesh worker. The in-flight promise rejects with MeshCancelled. */
export function cancelActiveMesh(): void {
  const job = active;
  if (!job) return;
  active = null;
  job.worker.terminate();
  job.cancel();
}

export function buildMeshAsync(
  points: SurveyPoint[],
  options: MeshBuildOptions = {},
  onProgress?: (fraction: number, message: string) => void,
): Promise<MeshBuildResult> {
  if (points.length < MESH_WORKER_MIN || typeof Worker === 'undefined') {
    return Promise.resolve(buildMesh(points, { ...options, onProgress }));
  }
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new MeshWorker();
    } catch {
      resolve(buildMesh(points, { ...options, onProgress }));
      return;
    }
    const coords = new Float64Array(points.length * 3);
    const numbers = new Array<string>(points.length);
    const descriptions = new Array<string>(points.length);
    for (let i = 0; i < points.length; i++) {
      coords[i * 3] = points[i].x;
      coords[i * 3 + 1] = points[i].y;
      coords[i * 3 + 2] = points[i].z;
      numbers[i] = points[i].number ?? '';
      descriptions[i] = points[i].description ?? '';
    }
    let settled = false;
    const finish = (result: MeshBuildResult | null, error?: Error) => {
      if (settled) return;
      settled = true;
      if (active?.worker === worker) active = null;
      worker.terminate();
      if (error) reject(error);
      else if (result) resolve(result);
    };
    active = { worker, cancel: () => finish(null, new MeshCancelled()) };
    worker.onmessage = (event: MessageEvent<{ type: string; message?: string; fraction?: number; triangles?: Uint32Array; normals?: Float32Array; radii?: number[]; spacing?: number; boundaryEdges?: number; area3D?: number; timingMs?: number; cancelled?: boolean; orientMode?: MeshBuildResult['orientMode'] }>) => {
      const data = event.data;
      if (data.type === 'progress' && data.fraction !== undefined && data.message) {
        onProgress?.(data.fraction, data.message);
        return;
      }
      if (data.type === 'error') {
        finish(null, new Error(data.message || '3D mesh build failed.'));
        return;
      }
      if (data.type !== 'mesh' || !data.triangles) return;
      if (data.cancelled) {
        finish(null, new MeshCancelled());
        return;
      }
      const triangles: Triangle[] = new Array(data.triangles.length / 3);
      for (let i = 0; i < triangles.length; i++) {
        triangles[i] = [data.triangles[i * 3], data.triangles[i * 3 + 1], data.triangles[i * 3 + 2]];
      }
      finish({
        points,
        triangles,
        normals: data.normals ?? new Float32Array(points.length * 3),
        radii: data.radii ?? [],
        spacing: data.spacing ?? 0,
        boundaryEdges: data.boundaryEdges ?? 0,
        area3D: data.area3D ?? 0,
        bbox: bbox(points),
        timingMs: data.timingMs ?? 0,
        cancelled: false,
        orientMode: data.orientMode ?? 'open',
      });
    };
    worker.onerror = () => {
      try {
        finish(buildMesh(points, options));
      } catch (error) {
        finish(null, error instanceof Error ? error : new Error('3D mesh build failed.'));
      }
    };
    const payload = {
      type: 'build' as const,
      coords,
      numbers,
      descriptions,
      radii: options.radii ?? null,
      radiusScale: options.radiusScale ?? 1,
      kNeighbors: options.kNeighbors ?? 12,
      maxEdgeLength: options.maxEdgeLength ?? null,
      fillHoles: options.fillHoles ?? 0,
      orient: options.orient ?? 'auto',
    };
    worker.postMessage(payload, [coords.buffer]);
  });
}

export function sectionMeshAsync(
  points: SurveyPoint[],
  triangles: Triangle[],
  planes: SectionPlane[],
  design: DesignPoint[] | null,
): Promise<MeshCrossSection[]> {
  if (triangles.length < 20_000 || typeof Worker === 'undefined') {
    return Promise.resolve(sectionMesh(points, triangles, planes, design));
  }
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new MeshWorker();
    } catch {
      resolve(sectionMesh(points, triangles, planes, design));
      return;
    }
    const coords = new Float64Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      coords[i * 3] = points[i].x;
      coords[i * 3 + 1] = points[i].y;
      coords[i * 3 + 2] = points[i].z;
    }
    const indices = new Uint32Array(triangles.length * 3);
    for (let i = 0; i < triangles.length; i++) {
      indices[i * 3] = triangles[i][0];
      indices[i * 3 + 1] = triangles[i][1];
      indices[i * 3 + 2] = triangles[i][2];
    }
    const packed = new Float64Array(planes.length * 10);
    planes.forEach((plane, index) => {
      const o = index * 10;
      packed[o] = plane.ox;
      packed[o + 1] = plane.oy;
      packed[o + 2] = plane.oz;
      packed[o + 3] = plane.nx;
      packed[o + 4] = plane.ny;
      packed[o + 5] = plane.nz;
      packed[o + 6] = plane.rx;
      packed[o + 7] = plane.ry;
      packed[o + 8] = plane.rz;
      packed[o + 9] = plane.station;
    });
    const designPacked = design && design.length >= 3 ? new Float64Array(design.length * 2) : null;
    if (design && designPacked) {
      design.forEach((point, index) => {
        designPacked[index * 2] = point.offset;
        designPacked[index * 2 + 1] = point.z;
      });
    }
    let settled = false;
    const finish = (sections: MeshCrossSection[] | null, error?: Error) => {
      if (settled) return;
      settled = true;
      if (active?.worker === worker) active = null;
      worker.terminate();
      if (error) reject(error);
      else if (sections) resolve(sections);
    };
    active = { worker, cancel: () => finish(null, new MeshCancelled()) };
    worker.onmessage = (event: MessageEvent<{ type: string; message?: string; sections?: MeshCrossSection[] }>) => {
      const data = event.data;
      if (data.type === 'error') {
        finish(null, new Error(data.message || 'Mesh section failed.'));
        return;
      }
      if (data.type === 'sections' && data.sections) finish(data.sections);
    };
    worker.onerror = () => {
      try {
        finish(sectionMesh(points, triangles, planes, design));
      } catch (error) {
        finish(null, error instanceof Error ? error : new Error('Mesh section failed.'));
      }
    };
    const transfer: Transferable[] = [coords.buffer, indices.buffer, packed.buffer];
    if (designPacked) transfer.push(designPacked.buffer);
    worker.postMessage({ type: 'section', coords, triangles: indices, planes: packed, design: designPacked }, transfer);
  });
}

function bbox(points: SurveyPoint[]): MeshBuildResult['bbox'] {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.z < minZ) minZ = point.z;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
    if (point.z > maxZ) maxZ = point.z;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
  return { minX, minY, minZ, maxX, maxY, maxZ };
}
