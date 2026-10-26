import { desktopAvailable } from '../../lib/desktopFiles';
import { convertOda, probeOda } from '../../lib/oda';
import { normalizeLayer } from '../layers';
import type { LinearUnit } from '../types';
import { drawingToDxf, parseDxf, type DxfModel } from './dxfDoc';
import { DWG_WRITE_LIMIT, ODA_MISSING, dwgFallbackNote, dwgLibreWritable, dwgVersion, readDwgSettings, type DwgSettings, type DwgVersionId } from './dwg';
import type { DwgImport } from './dwgMap';

export interface DwgSave {
  extension: 'dwg' | 'dxf';
  bytes: Uint8Array;
  note: string;
}

function fromDxf(bytes: Uint8Array, version: string): DwgImport {
  const model = parseDxf(bytes);
  const entities = model.entities.slice();
  for (const face of model.faces) {
    entities.push(
      { id: 'f', type: 'line', layer: 'TIN', color: 'bylayer', a: face.a, b: face.b },
      { id: 'f', type: 'line', layer: 'TIN', color: 'bylayer', a: face.b, b: face.c },
      { id: 'f', type: 'line', layer: 'TIN', color: 'bylayer', a: face.c, b: face.a },
    );
  }
  const layers = (model.layerRecords ?? []).map((layer) =>
    normalizeLayer({
      name: layer.name,
      color: layer.color,
      colorIndex: layer.colorIndex,
      lineType: layer.lineType,
      lineWeight: layer.lineWeight,
      frozen: layer.frozen,
      locked: layer.locked,
      visible: layer.visible,
    }),
  );
  if (layers.length === 0) {
    for (const name of model.layers) layers.push(normalizeLayer({ name }));
  }
  return {
    version,
    entities,
    layers,
    xrefs: [],
    notes: [`Opened with ODA File Converter (${version}).`],
  };
}

let workerPromise: Promise<Worker> | null = null;

function worker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = import('./dwg.worker.ts?worker&inline').then((mod) => new mod.default());
  }
  return workerPromise;
}

async function wasmHref(): Promise<string> {
  const mod = await import('@mlightcad/libredwg-web/wasm/libredwg-web.wasm?url');
  const url = mod.default;
  if (/^(data:|blob:|asset:|tauri:|file:)/i.test(url)) return url;
  if (typeof window === 'undefined') return url;
  return new URL(url, window.location.href).href;
}

function readInWorker(bytes: Uint8Array): Promise<DwgImport> {
  return new Promise((resolve, reject) => {
    void Promise.all([worker(), wasmHref()]).then(([thread, url]) => {
      const id = Math.floor(Math.random() * 1e9);
      const onMessage = (event: MessageEvent<{ id?: number; imported?: DwgImport; error?: string }>) => {
        if (event.data?.id !== id) return;
        thread.removeEventListener('message', onMessage);
        if (event.data.error) reject(new Error(event.data.error));
        else if (event.data.imported) resolve(event.data.imported);
        else reject(new Error('DWG read failed.'));
      };
      thread.addEventListener('message', onMessage);
      const copy = bytes.slice();
      thread.postMessage({ id, op: 'read', bytes: copy, wasmUrl: url }, [copy.buffer]);
    }, reject);
  });
}

async function probeConverter(odaPath: string): Promise<{ path: string } | null> {
  if (!desktopAvailable()) return null;
  const probe = await probeOda(odaPath);
  if (!probe.found) return null;
  return { path: probe.path };
}

let writerPromise: Promise<Worker> | null = null;

function writerThread(): Promise<Worker> {
  if (!writerPromise) {
    writerPromise = import('./dwgWrite.worker.ts?worker&inline').then((mod) => new mod.default());
  }
  return writerPromise;
}

async function writerWasmHref(): Promise<string> {
  const mod = await import('./vendor/dwgwrite.wasm?url');
  return absoluteAsset(mod.default);
}

function absoluteAsset(url: string): string {
  if (/^(data:|blob:|asset:|tauri:|file:|https?:)/i.test(url)) return url;
  if (typeof window === 'undefined') return url;
  return new URL(url, window.location.href).href;
}

function writeInWorker(dxf: string, version: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    void Promise.all([writerThread(), writerWasmHref()]).then(([thread, url]) => {
      const id = Math.floor(Math.random() * 1e9);
      const onMessage = (event: MessageEvent<{ id?: number; bytes?: Uint8Array | null; error?: string }>) => {
        if (event.data?.id !== id) return;
        thread.removeEventListener('message', onMessage);
        if (event.data.error) reject(new Error(event.data.error));
        else if (event.data.bytes && event.data.bytes.byteLength > 0) resolve(event.data.bytes);
        else reject(new Error(DWG_WRITE_LIMIT));
      };
      thread.addEventListener('message', onMessage);
      thread.postMessage({ id, op: 'write', dxf, version, wasmUrl: url });
    }, reject);
  });
}

async function writeDwgBytes(dxf: string, version: string): Promise<Uint8Array> {
  if (import.meta.env.VITEST) {
    const { writeDwgNode } = await import('./dwgWriteNode.ts');
    return writeDwgNode(dxf, version);
  }
  return writeInWorker(dxf, version);
}

export async function openDwg(name: string, bytes: Uint8Array): Promise<DwgImport> {
  const settings = readDwgSettings();
  if (settings.engine === 'oda') {
    const oda = await probeConverter(settings.odaPath);
    if (!oda) throw new Error(ODA_MISSING);
    const dxf = await convertOda(oda.path, name, bytes, 'ACAD2018', 'DXF');
    return fromDxf(dxf, dwgVersion('ACAD2018').label);
  }
  try {
    return await readInWorker(bytes);
  } catch (error) {
    if (settings.engine === 'libredwg') throw error;
    const oda = await probeConverter(settings.odaPath);
    if (!oda) throw error;
    const dxf = await convertOda(oda.path, name, bytes, 'ACAD2018', 'DXF');
    return fromDxf(dxf, dwgVersion('ACAD2018').label);
  }
}

export async function saveDwg(model: DxfModel, unit: LinearUnit, settings: DwgSettings = readDwgSettings()): Promise<DwgSave> {
  const encoded = new TextEncoder().encode(drawingToDxf(model, unit));
  const dxf = new TextDecoder().decode(encoded);
  const requested = dwgVersion(settings.version);
  if (settings.engine === 'oda') {
    const oda = await probeConverter(settings.odaPath);
    if (!oda) throw new Error(ODA_MISSING);
    const bytes = await convertOda(oda.path, 'drawing.dxf', encoded, requested.id, 'DWG');
    return { extension: 'dwg', bytes, note: `Wrote ${requested.label} with ODA File Converter.` };
  }
  const native = dwgLibreWritable(requested.id);
  if (!native && settings.engine === 'auto') {
    const oda = await probeConverter(settings.odaPath);
    if (oda) {
      const bytes = await convertOda(oda.path, 'drawing.dxf', encoded, requested.id, 'DWG');
      return { extension: 'dwg', bytes, note: `Wrote ${requested.label} with ODA File Converter.` };
    }
  }
  const token = native ? requested.libre : 'r2000';
  try {
    const written = await writeDwgBytes(dxf, token);
    const note = native ? `Wrote ${requested.label} with LibreDWG.` : dwgFallbackNote(requested.label);
    return { extension: 'dwg', bytes: written, note };
  } catch (error) {
    const detail = error instanceof Error ? error.message : DWG_WRITE_LIMIT;
    return { extension: 'dxf', bytes: encoded, note: detail.includes('DXF') ? detail : `${detail} Civil Design saved a DXF instead.` };
  }
}

export function exportVersion(): DwgVersionId {
  return readDwgSettings().version;
}
