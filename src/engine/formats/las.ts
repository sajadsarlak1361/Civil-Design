import type { SurveyPoint } from '../types';

/** Uncompressed LAS 1.2 point record, format 0 (20 bytes). */
export const LAZ_REASON =
  'LAZ needs a separate decompressor. Civil Design reads and writes uncompressed LAS 1.2 point format 0. Export the cloud as LAS.';

export function looksLikeLas(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x4c && bytes[1] === 0x41 && bytes[2] === 0x53 && bytes[3] === 0x46;
}

export function looksLikeLaz(bytes: Uint8Array, name = ''): boolean {
  if (name.toLowerCase().endsWith('.laz')) return true;
  if (!looksLikeLas(bytes)) return false;
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 4096))).toLowerCase();
  return head.includes('laszip');
}

function text(bytes: Uint8Array, offset: number, length: number, value: string) {
  const raw = new TextEncoder().encode(value);
  bytes.set(raw.subarray(0, length), offset);
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
  if (!looksLikeLas(bytes)) throw new Error('Not a LAS file.');
  if (looksLikeLaz(bytes)) throw new Error(LAZ_REASON);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const versionMajor = bytes[24];
  const versionMinor = bytes[25];
  if (versionMajor !== 1 || versionMinor < 2) throw new Error('Civil Design reads LAS 1.2.');
  const offset = view.getUint32(96, true);
  const format = bytes[104] & 0x3f;
  const record = view.getUint16(105, true);
  const count = view.getUint32(107, true);
  if (format !== 0 || record < 20) throw new Error('Civil Design reads LAS point format 0.');
  const scaleX = view.getFloat64(131, true) || 1;
  const scaleY = view.getFloat64(139, true) || 1;
  const scaleZ = view.getFloat64(147, true) || 1;
  const offX = view.getFloat64(155, true);
  const offY = view.getFloat64(163, true);
  const offZ = view.getFloat64(171, true);
  const points: SurveyPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = offset + index * record;
    if (at + 12 > bytes.length) break;
    points.push({
      x: view.getInt32(at, true) * scaleX + offX,
      y: view.getInt32(at + 4, true) * scaleY + offY,
      z: view.getInt32(at + 8, true) * scaleZ + offZ,
      number: String(index + 1),
      role: 'survey',
    });
  }
  return points;
}
