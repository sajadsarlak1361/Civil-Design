import { Dwg_File_Type, LibreDwg, createModule, type LibreDwgEx } from '@mlightcad/libredwg-web';
import { mapDwgDatabase, type DwgDatabaseLike, type DwgImport } from './dwgMap';

interface ReadRequest {
  id: number;
  op: 'read';
  bytes: Uint8Array;
  wasmUrl: string;
}

let ready: Promise<LibreDwgEx> | null = null;
let loadedFrom = '';

function module(url: string): Promise<LibreDwgEx> {
  if (!ready || loadedFrom !== url) {
    loadedFrom = url;
    ready = (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('LibreDWG module failed to load.');
      const binary = new Uint8Array(await response.arrayBuffer());
      const instance = await createModule({ wasmBinary: binary } as object);
      return LibreDwg.createByWasmInstance(instance);
    })();
  }
  return ready;
}

const post = (data: object) => {
  (globalThis as unknown as { postMessage: (data: object) => void }).postMessage(data);
};

globalThis.addEventListener('message', (event: Event) => {
  const data = (event as MessageEvent<ReadRequest>).data;
  if (!data || data.op !== 'read' || typeof data.id !== 'number') return;
  void (async () => {
    try {
      const lib = await module(data.wasmUrl);
      const copy = new Uint8Array(data.bytes.byteLength);
      copy.set(data.bytes);
      const ptr = lib.dwg_read_data(copy.buffer, Dwg_File_Type.DWG);
      if (ptr == null) throw new Error('LibreDWG could not read that DWG.');
      try {
        const version = lib.dwg_get_version_type(ptr);
        const db = lib.convert(ptr) as DwgDatabaseLike;
        const label = version?.hdr || version?.type || '';
        const imported: DwgImport = mapDwgDatabase(db, label);
        post({ id: data.id, imported });
      } finally {
        lib.dwg_free(ptr);
      }
    } catch (error) {
      post({ id: data.id, error: error instanceof Error ? error.message : 'DWG read failed.' });
    }
  })();
});
