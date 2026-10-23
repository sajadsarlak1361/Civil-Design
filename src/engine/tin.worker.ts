import { buildTin, type BuildOptions } from './tin';
import type { SurveyPoint } from './types';

interface TinRequest {
  coords: Float64Array;
  numbers: string[];
  descriptions: string[];
  roles: string[];
  options: BuildOptions;
}

interface TinResponse {
  coords: Float64Array;
  numbers: string[];
  descriptions: string[];
  roles: string[];
  triangles: Uint32Array;
  error?: string;
}

const post = (data: TinResponse, transfer: Transferable[]) => {
  (globalThis as unknown as { postMessage: (data: TinResponse, transfer: Transferable[]) => void }).postMessage(data, transfer);
};

globalThis.addEventListener('message', (event: Event) => {
  const data = (event as MessageEvent<TinRequest>).data;
  try {
    const count = data.coords.length / 3;
    const points: SurveyPoint[] = new Array(count);
    for (let i = 0; i < count; i++) {
      const role = data.roles[i];
      points[i] = {
        x: data.coords[i * 3],
        y: data.coords[i * 3 + 1],
        z: data.coords[i * 3 + 2],
        number: data.numbers[i] ?? '',
        description: data.descriptions[i] ?? '',
        role: role === 'boundary' || role === 'breakline' ? role : 'survey',
      };
    }
    const tin = buildTin(points, data.options);
    const coords = new Float64Array(tin.points.length * 3);
    const numbers = new Array<string>(tin.points.length);
    const descriptions = new Array<string>(tin.points.length);
    const roles = new Array<string>(tin.points.length);
    for (let i = 0; i < tin.points.length; i++) {
      const point = tin.points[i];
      coords[i * 3] = point.x;
      coords[i * 3 + 1] = point.y;
      coords[i * 3 + 2] = point.z;
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
    post({ coords, numbers, descriptions, roles, triangles }, [coords.buffer, triangles.buffer]);
  } catch (error) {
    post(
      {
        coords: new Float64Array(0),
        numbers: [],
        descriptions: [],
        roles: [],
        triangles: new Uint32Array(0),
        error: error instanceof Error ? error.message : 'TIN build failed.',
      },
      [],
    );
  }
});
