import createDwgWrite from './vendor/dwgwrite.js';
import { convertDxfToDwg } from './dwgWrite';
import type { DwgWriteModule } from './vendor/dwgwrite';

interface WriteRequest {
  id: number;
  op: 'write';
  dxf: string;
  version: string;
  wasmUrl: string;
}

let ready: Promise<DwgWriteModule> | null = null;
let loadedFrom = '';

function module(url: string): Promise<DwgWriteModule> {
  if (!ready || loadedFrom !== url) {
    loadedFrom = url;
    ready = (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('LibreDWG writer failed to load.');
      const wasmBinary = await response.arrayBuffer();
      return createDwgWrite({
        wasmBinary,
        print() {},
        printErr() {},
      });
    })();
  }
  return ready;
}

const post = (data: object) => {
  (globalThis as unknown as { postMessage: (data: object) => void }).postMessage(data);
};

globalThis.addEventListener('message', (event: Event) => {
  const data = (event as MessageEvent<WriteRequest>).data;
  if (!data || data.op !== 'write' || typeof data.id !== 'number') return;
  void (async () => {
    try {
      const writer = await module(data.wasmUrl);
      const bytes = convertDxfToDwg(writer, data.dxf, data.version);
      const copy = bytes.slice();
      post({ id: data.id, bytes: copy });
    } catch (error) {
      post({ id: data.id, error: error instanceof Error ? error.message : 'LibreDWG could not write that DWG.' });
    }
  })();
});
