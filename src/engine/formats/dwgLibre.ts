import { mapDwgDatabase, type DwgDatabaseLike, type DwgImport } from './dwgMap';

/** Node and test reader. The browser loads the same mapper inside dwg.worker.ts. */
export async function readDwgLibre(bytes: Uint8Array): Promise<DwgImport> {
  const { Dwg_File_Type, LibreDwg } = await import('@mlightcad/libredwg-web');
  const { createRequire } = await import('node:module');
  const { dirname, join } = await import('node:path');
  const require = createRequire(import.meta.url);
  const entry = require.resolve('@mlightcad/libredwg-web');
  const lib = await LibreDwg.create(join(dirname(entry), '..', 'wasm'));
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const ptr = lib.dwg_read_data(copy.buffer, Dwg_File_Type.DWG);
  if (ptr == null) throw new Error('LibreDWG could not read that DWG.');
  try {
    const version = lib.dwg_get_version_type(ptr);
    const db = lib.convert(ptr) as DwgDatabaseLike;
    const label = version?.hdr || version?.type || '';
    return mapDwgDatabase(db, label);
  } finally {
    lib.dwg_free(ptr);
  }
}
