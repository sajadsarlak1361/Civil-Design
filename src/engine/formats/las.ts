import type { SurveyPoint } from '../types';

/** Uncompressed LAS reader refuses a file whose point records are LASzip-compressed. */
export const LAZ_REASON =
  'That file is LAZ-compressed. Open the .laz file, or export an uncompressed LAS.';

export function looksLikeLas(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x4c && bytes[1] === 0x41 && bytes[2] === 0x53 && bytes[3] === 0x46;
}

/** A laszip variable-length record, not the word "laszip" in the software name. */
export function hasLaszipVlr(bytes: Uint8Array): boolean {
  if (!looksLikeLas(bytes) || bytes.length < 106) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = view.getUint16(94, true);
  const vlrCount = view.getUint32(100, true);
  let offset = headerSize;
  const marker = [0x6c, 0x61, 0x73, 0x7a, 0x69, 0x70];
  const limit = Math.min(vlrCount, 64);
  for (let index = 0; index < limit; index += 1) {
    if (offset + 54 > bytes.length) return false;
    let match = true;
    for (let byte = 0; byte < marker.length; byte += 1) {
      if (bytes[offset + 2 + byte] !== marker[byte]) {
        match = false;
        break;
      }
    }
    if (match) return true;
    const recordLength = view.getUint16(offset + 20, true);
    offset += 54 + recordLength;
  }
  return false;
}

export function looksLikeLaz(bytes: Uint8Array, name = ''): boolean {
  return name.toLowerCase().endsWith('.laz') || hasLaszipVlr(bytes);
}

function text(bytes: Uint8Array, offset: number, length: number, value: string) {
  const raw = new TextEncoder().encode(value);
  bytes.set(raw.subarray(0, length), offset);
}

export interface LasLayout {
  format: number;
  record: number;
  count: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  offX: number;
  offY: number;
  offZ: number;
  pointOffset: number;
}

/** LAS 1.0 through 1.4. Point formats 0–10 keep X Y Z in the first 12 bytes. */
export function lasLayout(bytes: Uint8Array): LasLayout {
  if (!looksLikeLas(bytes)) throw new Error('Not a LAS file.');
  if (bytes.length < 227) throw new Error('That LAS header is truncated.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const versionMajor = bytes[24];
  const versionMinor = bytes[25];
  if (versionMajor !== 1 || versionMinor > 4) throw new Error('Civil Design reads LAS 1.0 through 1.4.');
  const headerSize = view.getUint16(94, true);
  const pointOffset = view.getUint32(96, true);
  const format = bytes[104] & 0x3f;
  const record = view.getUint16(105, true);
  let count = view.getUint32(107, true);
  if ((versionMinor >= 4 || headerSize >= 375) && bytes.length >= 255) {
    const lo = view.getUint32(247, true);
    const hi = view.getUint32(251, true);
    if (hi === 0 && lo > 0) count = lo;
    else if (hi > 0) count = hi * 0x100000000 + lo;
  }
  if (format > 10) throw new Error(`LAS point format ${format} is not supported.`);
  if (record < 12) throw new Error('LAS point record is too short.');
  return {
    format,
    record,
    count,
    scaleX: view.getFloat64(131, true) || 1,
    scaleY: view.getFloat64(139, true) || 1,
    scaleZ: view.getFloat64(147, true) || 1,
    offX: view.getFloat64(155, true),
    offY: view.getFloat64(163, true),
    offZ: view.getFloat64(171, true),
    pointOffset,
  };
}

export function pointsFromLasRecords(layout: LasLayout, records: Uint8Array): SurveyPoint[] {
  const view = new DataView(records.buffer, records.byteOffset, records.byteLength);
  const points: SurveyPoint[] = [];
  const count = Math.min(layout.count, Math.floor(records.length / layout.record));
  for (let index = 0; index < count; index += 1) {
    const at = index * layout.record;
    if (at + 12 > records.length) break;
    points.push({
      x: view.getInt32(at, true) * layout.scaleX + layout.offX,
      y: view.getInt32(at + 4, true) * layout.scaleY + layout.offY,
      z: view.getInt32(at + 8, true) * layout.scaleZ + layout.offZ,
      number: String(index + 1),
      role: 'survey',
    });
  }
  return points;
}

export function writeLas(points: SurveyPoint[]): Uint8Array {
  const header = 227;
  const bytes = new Uint8Array(header + points.length * 20);
  const view = new DataView(bytes.buffer);
  text(bytes, 0, 4, 'LASF');
  bytes[24] = 1;
  bytes[25] = 2;
  text(bytes, 26, 32, 'Civil Design');
  text(bytes, 58, 32, 'Civil Design');
  view.setUint16(94, header, true);
  view.setUint32(96, header, true);
  view.setUint32(100, 0, true);
  bytes[104] = 0;
  view.setUint16(105, 20, true);
  view.setUint32(107, points.length, true);
  view.setUint32(111, points.length, true);
  const scale = 0.001;
  view.setFloat64(131, scale, true);
  view.setFloat64(139, scale, true);
  view.setFloat64(147, scale, true);
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  points.forEach((point, index) => {
    const at = header + index * 20;
    view.setInt32(at, Math.round(point.x / scale), true);
    view.setInt32(at + 4, Math.round(point.y / scale), true);
    view.setInt32(at + 8, Math.round(point.z / scale), true);
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    minZ = Math.min(minZ, point.z);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
    maxZ = Math.max(maxZ, point.z);
  });
  if (points.length === 0) {
    minX = 0;
    minY = 0;
    minZ = 0;
    maxX = 0;
    maxY = 0;
    maxZ = 0;
  }
  view.setFloat64(179, maxX, true);
  view.setFloat64(187, minX, true);
  view.setFloat64(195, maxY, true);
  view.setFloat64(203, minY, true);
  view.setFloat64(211, maxZ, true);
  view.setFloat64(219, minZ, true);
  return bytes;
}

export function readLas(bytes: Uint8Array): SurveyPoint[] {
  if (hasLaszipVlr(bytes)) throw new Error(LAZ_REASON);
  const layout = lasLayout(bytes);
  const records = bytes.subarray(layout.pointOffset);
  return pointsFromLasRecords(layout, records);
}
