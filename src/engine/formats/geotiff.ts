import type { GridRaster } from './grid';

/**
 * Uncompressed classic GeoTIFF (little-endian, one float32 strip).
 * LZW, JPEG, Deflate, and PackBits are rejected with a clear message.
 * ModelPixelScale (33550) and ModelTiepoint (33922) carry the georeference.
 */
export function writeGeoTiff(grid: GridRaster): Uint8Array {
  const tags = [256, 257, 258, 259, 262, 273, 277, 278, 279, 339, 33550, 33922];
  const ifdStart = 8;
  const ifdBytes = 2 + tags.length * 12 + 4;
  const scaleAt = ifdStart + ifdBytes;
  const tieAt = scaleAt + 24;
  const stripAt = tieAt + 48;
  const stripBytes = grid.cols * grid.rows * 4;
  const bytes = new Uint8Array(stripAt + stripBytes);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x49;
  bytes[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdStart, true);
  view.setUint16(ifdStart, tags.length, true);
  const inline = (tag: number, type: number, count: number, value: number) => {
    const offset = ifdStart + 2 + tags.indexOf(tag) * 12;
    view.setUint16(offset, tag, true);
    view.setUint16(offset + 2, type, true);
    view.setUint32(offset + 4, count, true);
    if (type === 3) view.setUint16(offset + 8, value, true);
    else view.setUint32(offset + 8, value, true);
  };
  const pointer = (tag: number, type: number, count: number, offset: number) => {
    const at = ifdStart + 2 + tags.indexOf(tag) * 12;
    view.setUint16(at, tag, true);
    view.setUint16(at + 2, type, true);
    view.setUint32(at + 4, count, true);
    view.setUint32(at + 8, offset, true);
  };
  inline(256, 4, 1, grid.cols);
  inline(257, 4, 1, grid.rows);
  inline(258, 3, 1, 32);
  inline(259, 3, 1, 1);
  inline(262, 3, 1, 1);
  inline(273, 4, 1, stripAt);
  inline(277, 3, 1, 1);
  inline(278, 4, 1, grid.rows);
  inline(279, 4, 1, stripBytes);
  inline(339, 3, 1, 3);
  pointer(33550, 12, 3, scaleAt);
  pointer(33922, 12, 6, tieAt);
  view.setFloat64(scaleAt, grid.cell, true);
  view.setFloat64(scaleAt + 8, grid.cell, true);
  view.setFloat64(scaleAt + 16, 0, true);
  const north = grid.yll + grid.rows * grid.cell;
  view.setFloat64(tieAt, 0, true);
  view.setFloat64(tieAt + 8, 0, true);
  view.setFloat64(tieAt + 16, 0, true);
  view.setFloat64(tieAt + 24, grid.xll, true);
  view.setFloat64(tieAt + 32, north, true);
  view.setFloat64(tieAt + 40, 0, true);
  for (let i = 0; i < grid.values.length; i += 1) {
    const sample = grid.values[i] === grid.nodata ? Number.NaN : grid.values[i];
    view.setFloat32(stripAt + i * 4, sample, true);
  }
  return bytes;
}

const COMPRESSION_NAMES: Record<number, string> = {
  5: 'LZW',
  7: 'JPEG',
  8: 'Deflate',
  32946: 'Deflate',
  32773: 'PackBits',
};

export function readGeoTiff(bytes: Uint8Array): GridRaster {
  if (bytes.length < 16) throw new Error('GeoTIFF file is too small.');
  const little = bytes[0] === 0x49 && bytes[1] === 0x49;
  const big = bytes[0] === 0x4d && bytes[1] === 0x4d;
  if (!little && !big) throw new Error('Not a TIFF file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, little);
  const u32 = (offset: number) => view.getUint32(offset, little);
  const f64 = (offset: number) => view.getFloat64(offset, little);
  if (u16(2) !== 42) throw new Error('Not a classic TIFF file.');
  let ifd = u32(4);
  const tags = new Map<number, { type: number; count: number; value: number }>();
  const count = u16(ifd);
  ifd += 2;
  for (let i = 0; i < count; i += 1) {
    const at = ifd + i * 12;
    tags.set(u16(at), { type: u16(at + 2), count: u32(at + 4), value: u32(at + 8) });
  }
  const width = tags.get(256)?.value ?? 0;
  const height = tags.get(257)?.value ?? 0;
  const compression = tags.get(259)?.value ?? 1;
  if (compression !== 1) {
    const name = COMPRESSION_NAMES[compression] ?? `code ${compression}`;
    throw new Error(`GeoTIFF compression ${name} is not read. Export an uncompressed TIFF.`);
  }
  const format = tags.get(339)?.value ?? 1;
  if (format !== 3) throw new Error('GeoTIFF samples must be IEEE float.');
  const strip = tags.get(273)?.value ?? 0;
  if (width < 1 || height < 1 || strip + width * height * 4 > bytes.length) throw new Error('GeoTIFF strip is missing.');
  const values = new Float64Array(width * height);
  for (let i = 0; i < values.length; i += 1) {
    const sample = view.getFloat32(strip + i * 4, little);
    values[i] = Number.isFinite(sample) ? sample : -9999;
  }
  let cell = 1;
  let xll = 0;
  let north = height;
  const scale = tags.get(33550);
  if (scale && scale.count >= 2) cell = f64(scale.value);
  const tie = tags.get(33922);
  if (tie && tie.count >= 6) {
    xll = f64(tie.value + 24);
    north = f64(tie.value + 32);
  }
  return { cols: width, rows: height, xll, yll: north - height * cell, cell, nodata: -9999, values };
}
