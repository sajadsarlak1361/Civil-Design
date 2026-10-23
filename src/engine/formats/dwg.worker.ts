import { Dwg_File_Type, LibreDwg, createModule, type LibreDwgEx } from '@mlightcad/libredwg-web';
import { DWG_WRITE_LIMIT } from './dwg';
import { mapDwgDatabase, type DwgDatabaseLike, type DwgImport } from './dwgMap';

interface ReadRequest {
  id: number;
  op: 'read';
  bytes: Uint8Array;
  wasmUrl: string;
}

interface WriteRequest {
  id: number;
  op: 'write';
  dxf: string;
  version: string;
  wasmUrl: string;
}

type Request = ReadRequest | WriteRequest;

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
  const data = (event as MessageEvent<Request>).data;
  if (!data || typeof data.id !== 'number') return;
  void (async () => {
    try {
      if (data.op === 'write') {
        const lib = await module(data.wasmUrl);
        const writer = lib as unknown as {
          dwg_write_file?: (input: string, output: string) => number;
          FS?: {
            writeFile: (name: string, bytes: Uint8Array) => void;
            readFile: (name: string) => Uint8Array;
            unlink: (name: string) => void;
            analyzePath: (name: string, follow: boolean) => { exists: boolean };
          };
        };
        if (typeof writer.dwg_write_file !== 'function' || !writer.FS) {
          post({ id: data.id, bytes: null, note: DWG_WRITE_LIMIT, version: data.version });
          return;
        }
        const input = 'in.dxf';
        const output = 'out.dwg';
        try {
          writer.FS.writeFile(input, new TextEncoder().encode(data.dxf));
          const error = writer.dwg_write_file(input, output);
          if (error !== 0 || !writer.FS.analyzePath(output, false).exists) {
            post({ id: data.id, bytes: null, note: DWG_WRITE_LIMIT, version: data.version });
            return;
          }
          const bytes = writer.FS.readFile(output);
          post({ id: data.id, bytes: bytes.slice(), version: data.version });
        } finally {
          if (writer.FS.analyzePath(input, false).exists) writer.FS.unlink(input);
          if (writer.FS.analyzePath(output, false).exists) writer.FS.unlink(output);
        }
        return;
      }
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
