import TinWorker from './tin.worker.ts?worker&inline';
import { buildTin, type BuildOptions, type Tin } from './tin';
import type { SurveyPoint, Triangle } from './types';

/** Point clouds at or above this size are triangulated off the main thread. */
export const TIN_WORKER_MIN = 25_000;

export function buildTinAsync(points: SurveyPoint[], options: BuildOptions = {}): Promise<Tin> {
  if (points.length < TIN_WORKER_MIN || typeof Worker === 'undefined') {
    return Promise.resolve(buildTin(points, options));
  }
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      // Vite inlines this worker as a Blob URL, so it still starts from a file:// page.
      worker = new TinWorker();
    } catch {
      resolve(buildTin(points, options));
      return;
    }
    const coords = new Float64Array(points.length * 3);
    const numbers = new Array<string>(points.length);
    const descriptions = new Array<string>(points.length);
    const roles = new Array<string>(points.length);
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      coords[i * 3] = point.x;
      coords[i * 3 + 1] = point.y;
      coords[i * 3 + 2] = point.z;
      numbers[i] = point.number ?? '';
      descriptions[i] = point.description ?? '';
      roles[i] = point.role ?? 'survey';
    }
    let settled = false;
    const finish = (tin: Tin) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      resolve(tin);
    };
    worker.onmessage = (event: MessageEvent<{ coords: Float64Array; numbers: string[]; descriptions: string[]; roles: string[]; triangles: Uint32Array; error?: string }>) => {
      const data = event.data;
      if (data.error) {
        finish(buildTin(points, options));
        return;
      }
      const built: SurveyPoint[] = new Array(data.coords.length / 3);
      for (let i = 0; i < built.length; i++) {
        const role = data.roles[i];
        built[i] = {
          x: data.coords[i * 3],
          y: data.coords[i * 3 + 1],
          z: data.coords[i * 3 + 2],
          number: data.numbers[i] ?? '',
          description: data.descriptions[i] ?? '',
          role: role === 'boundary' || role === 'breakline' ? role : 'survey',
        };
      }
      const triangles: Triangle[] = new Array(data.triangles.length / 3);
      for (let i = 0; i < triangles.length; i++) {
        triangles[i] = [data.triangles[i * 3], data.triangles[i * 3 + 1], data.triangles[i * 3 + 2]];
      }
      finish({ points: built, triangles });
    };
    worker.onerror = () => finish(buildTin(points, options));
    worker.postMessage({ coords, numbers, descriptions, roles, options });
  });
}
