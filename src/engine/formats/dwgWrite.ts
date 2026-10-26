import type { DwgWriteModule } from './vendor/dwgwrite';

/** LibreDWG refuses a DXF shorter than this. An empty drawing can land under it. */
const MIN_DXF_BYTES = 256;

/** Bits at or above this are a failed LibreDWG read or write. */
const CRITICAL = 128;

/** Pad a short DXF inside the header. The writer rejects anything under 256 bytes. */
export function dxfForWriter(dxf: string): string {
  if (dxf.length >= MIN_DXF_BYTES) return dxf;
  const note = `999\n${'x'.repeat(MIN_DXF_BYTES)}\n`;
  const headerEnd = dxf.indexOf('0\nENDSEC');
  if (headerEnd < 0) return `${note}${dxf}`;
  return `${dxf.slice(0, headerEnd)}${note}${dxf.slice(headerEnd)}`;
}

export function convertDxfToDwg(mod: DwgWriteModule, dxf: string, version: string): Uint8Array {
  const stamp = Math.random().toString(36).slice(2);
  const input = `in-${stamp}.dxf`;
  const output = `out-${stamp}.dwg`;
  mod.FS.writeFile(input, dxfForWriter(dxf));
  try {
    const code = mod.cwrap('cd_dxf_to_dwg', 'number', ['string', 'string', 'string'])(input, output, version);
    const written = mod.FS.analyzePath(output);
    if (code >= CRITICAL || !written.exists) throw new Error(`LibreDWG could not write that DWG (${code}).`);
    return mod.FS.readFile(output).slice();
  } finally {
    if (mod.FS.analyzePath(input).exists) mod.FS.unlink(input);
    if (mod.FS.analyzePath(output).exists) mod.FS.unlink(output);
  }
}
