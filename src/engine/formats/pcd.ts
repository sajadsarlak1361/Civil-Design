import type { SurveyPoint } from '../types';

/** PCL LZF, the codec used by PCD `binary_compressed`. */
export function decompressLzf(input: Uint8Array, outLength: number): Uint8Array {
  const out = new Uint8Array(outLength);
  let ip = 0;
  let op = 0;
  while (ip < input.length) {
    const ctrl = input[ip++];
    if (ctrl < 32) {
      const literal = ctrl + 1;
      if (ip + literal > input.length || op + literal > outLength) throw new Error('PCD compression is truncated.');
      out.set(input.subarray(ip, ip + literal), op);
      ip += literal;
      op += literal;
      continue;
    }
    let length = ctrl >> 5;
    let ref = op - ((ctrl & 0x1f) << 8) - 1;
    if (length === 7) {
      if (ip >= input.length) throw new Error('PCD compression is truncated.');
      length += input[ip++];
    }
    if (ip >= input.length) throw new Error('PCD compression is truncated.');
    ref -= input[ip++];
    const count = length + 2;
    if (ref < 0 || op + count > outLength) throw new Error('PCD compression is truncated.');
    for (let index = 0; index < count; index += 1) out[op++] = out[ref++];
  }
  if (op !== outLength) throw new Error('PCD compression did not fill the point buffer.');
  return out;
}

export function looksLikePcd(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 256))).trimStart().toLowerCase();
  return head.startsWith('# .pcd') || head.startsWith('version ') || head.startsWith('fields ');
}

interface PcdField {
  name: string;
  size: number;
  type: string;
  count: number;
}

function headerOf(bytes: Uint8Array): { fields: PcdField[]; points: number; data: string; dataAt: number } {
  let lineStart = 0;
  let dataAt = -1;
  let dataLine = '';
  const limit = Math.min(bytes.length, 65536);
  const lines: string[] = [];
  for (let index = 0; index < limit; index += 1) {
    if (bytes[index] !== 10) continue;
    const line = new TextDecoder().decode(bytes.subarray(lineStart, index)).replace(/\r$/, '');
    lines.push(line);
    lineStart = index + 1;
    if (/^DATA\s/i.test(line)) {
      dataLine = line;
      dataAt = index + 1;
      break;
    }
  }
  if (dataAt < 0) throw new Error('That PCD file has no DATA line.');
  const values = new Map<string, string[]>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split(/\s+/);
    values.set(key.toUpperCase(), rest);
  }
  const names = values.get('FIELDS') ?? values.get('FIELD') ?? [];
  const sizes = (values.get('SIZE') ?? []).map(Number);
  const types = values.get('TYPE') ?? [];
  const counts = (values.get('COUNT') ?? names.map(() => '1')).map(Number);
  if (names.length === 0) throw new Error('That PCD file does not list FIELDS.');
  const fields: PcdField[] = names.map((name, index) => ({
    name: name.toLowerCase(),
    size: sizes[index] || 4,
    type: (types[index] || 'F').toUpperCase(),
    count: counts[index] || 1,
  }));
  const width = Number(values.get('WIDTH')?.[0] ?? 0);
  const height = Number(values.get('HEIGHT')?.[0] ?? 1);
  const declared = Number(values.get('POINTS')?.[0] ?? 0);
  const points = declared > 0 ? declared : width * (height || 1);
  const data = (dataLine.trim().split(/\s+/)[1] ?? '').toLowerCase();
  if (data !== 'ascii' && data !== 'binary' && data !== 'binary_compressed') {
    throw new Error(`PCD data ${data || '(missing)'} is not supported.`);
  }
  return { fields, points, data, dataAt };
}

function readScalar(view: DataView, offset: number, field: PcdField): number {
  if (field.type === 'F' && field.size === 4) return view.getFloat32(offset, true);
  if (field.type === 'F' && field.size === 8) return view.getFloat64(offset, true);
  if (field.type === 'I' && field.size === 1) return view.getInt8(offset);
  if (field.type === 'I' && field.size === 2) return view.getInt16(offset, true);
  if (field.type === 'I' && field.size === 4) return view.getInt32(offset, true);
  if (field.type === 'U' && field.size === 1) return view.getUint8(offset);
  if (field.type === 'U' && field.size === 2) return view.getUint16(offset, true);
  if (field.type === 'U' && field.size === 4) return view.getUint32(offset, true);
  throw new Error(`PCD field ${field.name} uses ${field.type}${field.size}, which is not supported.`);
}

function pointsFromXyz(xs: number[], ys: number[], zs: number[]): SurveyPoint[] {
  const count = Math.min(xs.length, ys.length, zs.length);
  const points: SurveyPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const x = xs[index];
    const y = ys[index];
    const z = zs[index];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    points.push({ x, y, z, number: String(points.length + 1), role: 'survey' });
  }
  return points;
}

export function readPcd(bytes: Uint8Array): SurveyPoint[] {
  const header = headerOf(bytes);
  const xField = header.fields.findIndex((field) => field.name === 'x');
  const yField = header.fields.findIndex((field) => field.name === 'y');
  const zField = header.fields.findIndex((field) => field.name === 'z');
  if (xField < 0 || yField < 0 || zField < 0) throw new Error('That PCD file has no x y z fields.');
  if (header.points <= 0) return [];
  if (header.data === 'ascii') {
    const text = new TextDecoder().decode(bytes.subarray(header.dataAt));
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const parts = trimmed.split(/\s+/);
      xs.push(Number(parts[xField]));
      ys.push(Number(parts[yField]));
      zs.push(Number(parts[zField]));
      if (xs.length >= header.points) break;
    }
    return pointsFromXyz(xs, ys, zs);
  }
  let body = bytes.subarray(header.dataAt);
  const stride = header.fields.reduce((sum, field) => sum + field.size * field.count, 0);
  if (header.data === 'binary_compressed') {
    if (body.length < 8) throw new Error('That compressed PCD is truncated.');
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const compressedSize = view.getUint32(0, true);
    const uncompressedSize = view.getUint32(4, true);
    body = decompressLzf(body.subarray(8, 8 + compressedSize), uncompressedSize);
  }
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const xs = new Array<number>(header.points);
  const ys = new Array<number>(header.points);
  const zs = new Array<number>(header.points);
  if (header.data === 'binary_compressed') {
    let block = 0;
    const columns = header.fields.map((field) => {
      const bytesPerPoint = field.size * field.count;
      const start = block;
      block += bytesPerPoint * header.points;
      return start;
    });
    const xStep = header.fields[xField].size * header.fields[xField].count;
    const yStep = header.fields[yField].size * header.fields[yField].count;
    const zStep = header.fields[zField].size * header.fields[zField].count;
    for (let index = 0; index < header.points; index += 1) {
      xs[index] = readScalar(view, columns[xField] + index * xStep, header.fields[xField]);
      ys[index] = readScalar(view, columns[yField] + index * yStep, header.fields[yField]);
      zs[index] = readScalar(view, columns[zField] + index * zStep, header.fields[zField]);
    }
    return pointsFromXyz(xs, ys, zs);
  }
  for (let index = 0; index < header.points; index += 1) {
    let cursor = index * stride;
    if (cursor + stride > body.length) break;
    for (let fieldIndex = 0; fieldIndex < header.fields.length; fieldIndex += 1) {
      const field = header.fields[fieldIndex];
      if (fieldIndex === xField) xs[index] = readScalar(view, cursor, field);
      else if (fieldIndex === yField) ys[index] = readScalar(view, cursor, field);
      else if (fieldIndex === zField) zs[index] = readScalar(view, cursor, field);
      cursor += field.size * field.count;
    }
  }
  return pointsFromXyz(xs, ys, zs);
}

/** ASCII PCD. Extra point attributes are not written. */
export function pointsToPcd(points: SurveyPoint[]): string {
  const lines = [
    '# .PCD v0.7 - Civil Design',
    'VERSION 0.7',
    'FIELDS x y z',
    'SIZE 4 4 4',
    'TYPE F F F',
    'COUNT 1 1 1',
    `WIDTH ${points.length}`,
    'HEIGHT 1',
    'VIEWPOINT 0 0 0 1 0 0 0',
    `POINTS ${points.length}`,
    'DATA ascii',
  ];
  for (const point of points) lines.push(`${point.x} ${point.y} ${point.z}`);
  return `${lines.join('\n')}\n`;
}
