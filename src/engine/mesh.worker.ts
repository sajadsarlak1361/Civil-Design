import { buildMesh, type MeshBuildOptions, type MeshOrient } from './mesh';
import { sectionMesh, type DesignPoint, type SectionPlane } from './meshSection';
import type { SurveyPoint, Triangle } from './types';

interface BuildRequest {
  type: 'build';
  coords: Float64Array;
  numbers: string[];
  descriptions: string[];
  radii: number[] | null;
  radiusScale: number;
  kNeighbors: number;
  maxEdgeLength: number | null;
  fillHoles: number;
  orient: MeshOrient;
}

interface SectionRequest {
  type: 'section';
  coords: Float64Array;
  triangles: Uint32Array;
  planes: Float64Array;
  design: Float64Array | null;
}

type MeshRequest = BuildRequest | SectionRequest | { type: 'cancel' };

let cancel = false;

function pointsFrom(coords: Float64Array, numbers?: string[], descriptions?: string[]): SurveyPoint[] {
  const count = coords.length / 3;
  const points: SurveyPoint[] = new Array(count);
  for (let i = 0; i < count; i++) {
    points[i] = {
      x: coords[i * 3],
      y: coords[i * 3 + 1],
      z: coords[i * 3 + 2],
      number: numbers?.[i] ?? '',
      description: descriptions?.[i] ?? '',
      role: 'survey',
    };
  }
  return points;
}

function post(data: object, transfer: Transferable[] = []): void {
  (globalThis as unknown as { postMessage: (data: object, transfer: Transferable[]) => void }).postMessage(data, transfer);
}

globalThis.addEventListener('message', (event: Event) => {
  const data = (event as MessageEvent<MeshRequest>).data;
  if (!data) return;
  if (data.type === 'cancel') {
    cancel = true;
    return;
  }
  if (data.type === 'build') {
    cancel = false;
    try {
      const points = pointsFrom(data.coords, data.numbers, data.descriptions);
      const options: MeshBuildOptions = {
        ...(data.radii && data.radii.length > 0 ? { radii: data.radii } : { radiusScale: data.radiusScale }),
        kNeighbors: data.kNeighbors,
        maxEdgeLength: data.maxEdgeLength,
        fillHoles: data.fillHoles,
        orient: data.orient,
        shouldCancel: () => cancel,
        onProgress: (fraction, message) => post({ type: 'progress', fraction, message }),
      };
      const mesh = buildMesh(points, options);
      const triangles = new Uint32Array(mesh.triangles.length * 3);
      for (let i = 0; i < mesh.triangles.length; i++) {
        triangles[i * 3] = mesh.triangles[i][0];
        triangles[i * 3 + 1] = mesh.triangles[i][1];
        triangles[i * 3 + 2] = mesh.triangles[i][2];
      }
      post(
        {
          type: 'mesh',
          triangles,
          normals: mesh.normals,
          radii: mesh.radii,
          spacing: mesh.spacing,
          boundaryEdges: mesh.boundaryEdges,
          area3D: mesh.area3D,
          timingMs: mesh.timingMs,
          cancelled: mesh.cancelled || cancel,
          orientMode: mesh.orientMode,
        },
        [triangles.buffer, mesh.normals.buffer],
      );
    } catch (error) {
      post({ type: 'error', message: error instanceof Error ? error.message : '3D mesh build failed.' });
    }
    return;
  }
  try {
    const points = pointsFrom(data.coords);
    const triangles: Triangle[] = new Array(data.triangles.length / 3);
    for (let i = 0; i < triangles.length; i++) {
      triangles[i] = [data.triangles[i * 3], data.triangles[i * 3 + 1], data.triangles[i * 3 + 2]];
    }
    const planes: SectionPlane[] = [];
    for (let i = 0; i + 9 < data.planes.length; i += 10) {
      planes.push({
        ox: data.planes[i],
        oy: data.planes[i + 1],
        oz: data.planes[i + 2],
        nx: data.planes[i + 3],
        ny: data.planes[i + 4],
        nz: data.planes[i + 5],
        rx: data.planes[i + 6],
        ry: data.planes[i + 7],
        rz: data.planes[i + 8],
        station: data.planes[i + 9],
      });
    }
    let design: DesignPoint[] | null = null;
    if (data.design && data.design.length >= 6) {
      design = [];
      for (let i = 0; i < data.design.length; i += 2) design.push({ offset: data.design[i], z: data.design[i + 1] });
    }
    const sections = sectionMesh(points, triangles, planes, design);
    post({ type: 'sections', sections });
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : 'Mesh section failed.' });
  }
});
