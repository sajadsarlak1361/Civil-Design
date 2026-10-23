import { desktopAvailable } from '../../lib/desktopFiles';
import { convertOda, probeOda } from '../../lib/oda';
import { normalizeLayer } from '../layers';
import type { LinearUnit } from '../types';
import { drawingToDxf, parseDxf, type DxfModel } from './dxfDoc';
import { DWG_WRITE_LIMIT, ODA_MISSING, dwgVersion, readDwgSettings, type DwgVersionId } from './dwg';
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

async function resolveOda(engine: 'auto' | 'libredwg' | 'oda', odaPath: string): Promise<{ path: string } | null> {
  if (engine === 'libredwg' || !desktopAvailable()) return null;
  const probe = await probeOda(odaPath);
  if (engine === 'oda' && !probe.found) throw new Error(probe.message || ODA_MISSING);
  if (!probe.found) return null;
  return { path: probe.path };
}

export async function openDwg(name: string, bytes: Uint8Array): Promise<DwgImport> {
  const settings = readDwgSettings();
  const oda = await resolveOda(settings.engine, settings.odaPath);
  if (oda) {
    const dxf = await convertOda(oda.path, name, bytes, 'ACAD2018', 'DXF');
    return fromDxf(dxf, dwgVersion('ACAD2018').label);
  }
  return readInWorker(bytes);
}

export async function saveDwg(model: DxfModel, unit: LinearUnit): Promise<DwgSave> {
  const settings = readDwgSettings();
  const encoded = new TextEncoder().encode(drawingToDxf(model, unit));
  const oda = await resolveOda(settings.engine, settings.odaPath);
  if (oda) {
    const bytes = await convertOda(oda.path, 'drawing.dxf', encoded, settings.version, 'DWG');
    return { extension: 'dwg', bytes, note: `Wrote ${dwgVersion(settings.version).label} with ODA File Converter.` };
  }
  return { extension: 'dxf', bytes: encoded, note: DWG_WRITE_LIMIT };
}

export function exportVersion(): DwgVersionId {
  return readDwgSettings().version;
}
