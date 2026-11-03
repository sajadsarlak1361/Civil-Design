import type { SurveyPoint } from '../types';
import { hasLaszipVlr, lasLayout, looksLikeLas, pointsFromLasRecords, readLas } from './las';

interface LazModule {
  LASZip: new () => {
    open(data: number, length: number): void;
    getPoint(dest: number): void;
    getCount(): number;
    getPointLength(): number;
    delete(): void;
  };
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPU8: Uint8Array;
}

type LazFactory = (module?: { wasmBinary?: Uint8Array | ArrayBuffer }) => Promise<LazModule>;

let loading: Promise<LazModule> | null = null;

function factoryFrom(mod: unknown): LazFactory {
  const record = mod as {
    createLazPerf?: LazFactory;
    default?: LazFactory | { createLazPerf?: LazFactory };
  };
  if (typeof record.createLazPerf === 'function') return record.createLazPerf;
  if (typeof record.default === 'function') return record.default;
  if (record.default && typeof record.default.createLazPerf === 'function') return record.default.createLazPerf;
  throw new Error('The LAZ decoder did not load.');
}

async function lazModule(): Promise<LazModule> {
  if (!loading) {
    loading = (async () => {
      if (import.meta.env.VITEST) {
        const { createRequire } = await import('node:module');
        const { readFileSync } = await import('node:fs');
        const require = createRequire(import.meta.url);
        const wasmBinary = new Uint8Array(readFileSync(require.resolve('laz-perf/lib/node/laz-perf.wasm')));
        return factoryFrom(require('laz-perf'))({ wasmBinary });
      }
      const wasmUrl = (await import('laz-perf/lib/web/laz-perf.wasm?url')).default as string;
      const response = await fetch(wasmUrl);
      if (!response.ok) throw new Error('Could not load the LAZ decoder.');
      const wasmBinary = new Uint8Array(await response.arrayBuffer());
      const imported = await import('laz-perf');
      return factoryFrom(imported)({ wasmBinary });
    })();
  }
  return loading;
}

/** Decompress a LAZ file. A .laz name whose bytes are plain LAS is read as LAS. */
export async function readLaz(bytes: Uint8Array): Promise<SurveyPoint[]> {
  if (!hasLaszipVlr(bytes)) {
    if (looksLikeLas(bytes)) return readLas(bytes);
    throw new Error('Not a LAZ file.');
  }
  const layout = lasLayout(bytes);
  const laz = await lazModule();
  const laszip = new laz.LASZip();
  const dataPtr = laz._malloc(bytes.length);
  try {
    laz.HEAPU8.set(bytes, dataPtr);
    laszip.open(dataPtr, bytes.length);
    const count = laszip.getCount();
    const pointLength = laszip.getPointLength();
    if (pointLength < 12) throw new Error('That LAZ point record has no XYZ.');
    const dest = laz._malloc(pointLength);
    try {
      const records = new Uint8Array(count * pointLength);
      for (let index = 0; index < count; index += 1) {
        laszip.getPoint(dest);
        records.set(laz.HEAPU8.subarray(dest, dest + pointLength), index * pointLength);
      }
      return pointsFromLasRecords({ ...layout, count, record: pointLength }, records);
    } finally {
      laz._free(dest);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('That LAZ')) throw error;
    if (error instanceof Error && error.message.startsWith('Not a LAZ')) throw error;
    throw new Error('Could not decompress that LAZ file.');
  } finally {
    laszip.delete();
    laz._free(dataPtr);
  }
}
