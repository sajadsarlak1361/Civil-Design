import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { convertDxfToDwg } from './dwgWrite';

/** Test and Node loader. The browser uses dwgWrite.worker.ts instead. */
export async function writeDwgNode(dxf: string, version: string): Promise<Uint8Array> {
  const require = createRequire(import.meta.url);
  const jsPath = require.resolve('./vendor/dwgwrite.js');
  const wasmBinary = readFileSync(join(dirname(jsPath), 'dwgwrite.wasm'));
  const factory = (await import('./vendor/dwgwrite.js')).default;
  const mod = await factory({
    wasmBinary,
    print() {},
    printErr() {},
  });
  return convertDxfToDwg(mod, dxf, version);
}
