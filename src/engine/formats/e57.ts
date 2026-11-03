import type { SurveyPoint } from '../types';
import wasmUrl from './vendor/e57/e57_read.wasm?url';

interface E57Exports {
  memory: WebAssembly.Memory;
  input_ptr(len: number): number;
  parse(len: number): number;
  points_ptr(): number;
  error_ptr(): number;
  error_len(): number;
}

let loading: Promise<E57Exports> | null = null;

export function looksLikeE57(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  return bytes[0] === 0x41 && bytes[1] === 0x53 && bytes[2] === 0x54 && bytes[3] === 0x4d && bytes[4] === 0x2d && bytes[5] === 0x45 && bytes[6] === 0x35 && bytes[7] === 0x37;
}

async function wasmBytes(): Promise<Uint8Array> {
  if (import.meta.env.VITEST) {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    return new Uint8Array(readFileSync(fileURLToPath(new URL('./vendor/e57/e57_read.wasm', import.meta.url))));
  }
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error('Could not load the E57 reader.');
  return new Uint8Array(await response.arrayBuffer());
}

async function exportsOf(): Promise<E57Exports> {
  if (!loading) {
    loading = (async () => {
      const { instance } = await WebAssembly.instantiate(await wasmBytes(), {});
      return instance.exports as unknown as E57Exports;
    })();
  }
  return loading;
}

/**
 * ASTM E57. Cartesian and spherical point records, with the scan pose applied.
 * Images stored in the file are skipped. Coordinates stay double precision.
 */
export async function readE57(bytes: Uint8Array): Promise<SurveyPoint[]> {
  if (!looksLikeE57(bytes)) throw new Error('Not an E57 file.');
  const wasm = await exportsOf();
  const ptr = wasm.input_ptr(bytes.length);
  new Uint8Array(wasm.memory.buffer).set(bytes, ptr);
  const count = wasm.parse(bytes.length);
  if (count < 0) {
    const start = wasm.error_ptr();
    const length = wasm.error_len();
    const message = new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, start, length));
    throw new Error(message || 'Could not read that E57 file.');
  }
  const view = new Float64Array(wasm.memory.buffer, wasm.points_ptr(), count * 3);
  const points: SurveyPoint[] = new Array(count);
  for (let index = 0; index < count; index += 1) {
    points[index] = {
      x: view[index * 3],
      y: view[index * 3 + 1],
      z: view[index * 3 + 2],
      number: String(index + 1),
      role: 'survey',
    };
  }
  return points;
}
