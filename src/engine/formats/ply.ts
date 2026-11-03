import type { SurveyPoint, Triangle } from '../types';

/** Geometry Civil Design can store from a PLY file. Faces are fanned into triangles. */
export interface PlyMesh {
  points: SurveyPoint[];
  triangles: Triangle[];
}

export interface PlyGeometry extends PlyMesh {
  name: string;
}

interface ScalarType {
  size: number;
  signed: boolean;
  float: boolean;
}

interface Prop {
  name: string;
  list: boolean;
  countType?: ScalarType;
  valueType: ScalarType;
}

interface Element {
  name: string;
  count: number;
  props: Prop[];
}

type BodyFormat = 'ascii' | 'le' | 'be';

const SCALARS: Record<string, ScalarType> = {
  char: { size: 1, signed: true, float: false },
  int8: { size: 1, signed: true, float: false },
  uchar: { size: 1, signed: false, float: false },
  uint8: { size: 1, signed: false, float: false },
  short: { size: 2, signed: true, float: false },
  int16: { size: 2, signed: true, float: false },
  ushort: { size: 2, signed: false, float: false },
  uint16: { size: 2, signed: false, float: false },
  int: { size: 4, signed: true, float: false },
  int32: { size: 4, signed: true, float: false },
  uint: { size: 4, signed: false, float: false },
  uint32: { size: 4, signed: false, float: false },
  float: { size: 4, signed: false, float: true },
  float32: { size: 4, signed: false, float: true },
  double: { size: 8, signed: false, float: true },
  float64: { size: 8, signed: false, float: true },
};

const HEADER_MARK = 'end_header';

/** True when the bytes start with the PLY magic, ignoring a UTF-8 BOM. */
export function looksLikePly(bytes: Uint8Array): boolean {
  let index = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) index = 3;
  if (index + 3 >= bytes.length) return false;
  if (bytes[index] !== 0x70 || bytes[index + 1] !== 0x6c || bytes[index + 2] !== 0x79) return false;
  const next = bytes[index + 3];
  return next === 0x0a || next === 0x0d || next === 0x20 || next === 0x09;
}

/**
 * Stanford PLY, ASCII 1.0.
 * Coordinates are written in full double precision: easting, northing, elevation.
 * Faces are triangles. A vertex-only cloud still carries an empty face element.
 */
export function surfaceToPly(points: SurveyPoint[], triangles: Triangle[]): string {
  const lines = [
    'ply',
    'format ascii 1.0',
    'comment Civil Design 3D mesh',
    `element vertex ${points.length}`,
    'property float x',
    'property float y',
    'property float z',
    `element face ${triangles.length}`,
    'property list uchar int vertex_indices',
    'end_header',
  ];
  for (const point of points) lines.push(`${point.x} ${point.y} ${point.z}`);
  for (const [a, b, c] of triangles) lines.push(`3 ${a} ${b} ${c}`);
  return `${lines.join('\n')}\n`;
}

/** ASCII PLY as bytes, for the save dialog. */
export function encodePly(points: SurveyPoint[], triangles: Triangle[]): Uint8Array {
  return new TextEncoder().encode(surfaceToPly(points, triangles));
}

/**
 * Binary PLY. Float32 is the common interchange; civil coordinates that need more
 * than about seven significant digits should use {@link surfaceToPly}.
 */
export function surfaceToBinaryPly(points: SurveyPoint[], triangles: Triangle[], littleEndian = true): Uint8Array {
  const header = [
    'ply',
    `format binary_${littleEndian ? 'little' : 'big'}_endian 1.0`,
    'comment Civil Design 3D mesh',
    `element vertex ${points.length}`,
    'property float x',
    'property float y',
    'property float z',
    `element face ${triangles.length}`,
    'property list uchar int vertex_indices',
    'end_header',
    '',
  ].join('\n');
  const head = new TextEncoder().encode(header);
  const bytes = new Uint8Array(head.length + points.length * 12 + triangles.length * 13);
  bytes.set(head, 0);
  const view = new DataView(bytes.buffer);
  let offset = head.length;
  for (const point of points) {
    view.setFloat32(offset, point.x, littleEndian);
    view.setFloat32(offset + 4, point.y, littleEndian);
    view.setFloat32(offset + 8, point.z, littleEndian);
    offset += 12;
  }
  for (const [a, b, c] of triangles) {
    view.setUint8(offset, 3);
    view.setInt32(offset + 1, a, littleEndian);
    view.setInt32(offset + 5, b, littleEndian);
    view.setInt32(offset + 9, c, littleEndian);
    offset += 13;
  }
  return bytes;
}

/**
 * The surface a PLY save or export should write.
 * A selected surface object wins. Otherwise the active surface, then the first surface that has points.
 */
export function choosePlyGeometry(
  surfaces: { id: string; name: string; points: SurveyPoint[]; triangles: Triangle[] }[],
  activeId: string | null,
  selection: readonly string[] = [],
): PlyGeometry | null {
  const selected = selection.filter((id) => id.startsWith('surface:')).map((id) => id.slice('surface:'.length));
  if (selected.length > 0) {
    const surface = surfaces.find((item) => item.id === selected[0] && item.points.length > 0);
    return surface ? { name: surface.name, points: surface.points, triangles: surface.triangles } : null;
  }
  const active = surfaces.find((item) => item.id === activeId && item.points.length > 0);
  const surface = active ?? surfaces.find((item) => item.points.length > 0);
  return surface ? { name: surface.name, points: surface.points, triangles: surface.triangles } : null;
}

/** Read ASCII or binary PLY into points and triangles. Polygon faces are fanned from the first vertex. */
export function parsePly(bytes: Uint8Array): PlyMesh {
  const source = stripBom(bytes);
  const split = splitHeader(source);
  const { format, elements } = parseHeader(split.header);
  const vertex = elements.find((element) => element.name.toLowerCase() === 'vertex');
  if (!vertex) throw new Error('PLY file has no vertex element.');
  if (!hasXYZ(vertex)) throw new Error('PLY vertices need x, y, and z.');
  return format === 'ascii' ? parseAscii(split.body, elements) : parseBinary(split.body, elements, format === 'le');
}

function stripBom(bytes: Uint8Array): Uint8Array {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return bytes.subarray(3);
  return bytes;
}

function splitHeader(bytes: Uint8Array): { header: string; body: Uint8Array } {
  const limit = Math.min(bytes.length, 1_048_576);
  const mark = HEADER_MARK;
  for (let index = 0; index + mark.length <= limit; index += 1) {
    let match = true;
    for (let offset = 0; offset < mark.length; offset += 1) {
      if (bytes[index + offset] !== mark.charCodeAt(offset)) {
        match = false;
        break;
      }
    }
    if (!match) continue;
    if (index > 0 && bytes[index - 1] !== 10 && bytes[index - 1] !== 13) continue;
    let end = index + mark.length;
    while (end < bytes.length && (bytes[end] === 32 || bytes[end] === 9)) end += 1;
    if (end < bytes.length && bytes[end] === 13) end += 1;
    if (end < bytes.length && bytes[end] === 10) end += 1;
    else if (end !== bytes.length) continue;
    return { header: new TextDecoder('latin1').decode(bytes.subarray(0, end)), body: bytes.subarray(end) };
  }
  throw new Error('PLY header is missing end_header.');
}

function parseHeader(header: string): { format: BodyFormat; elements: Element[] } {
  const lines = header.split(/\r\n|\n|\r/);
  let format: BodyFormat | null = null;
  const elements: Element[] = [];
  let current: Element | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const keyword = parts[0].toLowerCase();
    if (keyword === 'ply' || keyword === 'comment' || keyword === 'obj_info') continue;
    if (keyword === 'format') {
      const name = (parts[1] ?? '').toLowerCase();
      if (name === 'ascii') format = 'ascii';
      else if (name === 'binary_little_endian') format = 'le';
      else if (name === 'binary_big_endian') format = 'be';
      else throw new Error(`PLY format ${name || '(missing)'} is not supported.`);
      continue;
    }
    if (keyword === 'element') {
      const count = Number(parts[2]);
      if (!parts[1] || !Number.isInteger(count) || count < 0) throw new Error('PLY element count is invalid.');
      current = { name: parts[1], count, props: [] };
      elements.push(current);
      continue;
    }
    if (keyword === 'property') {
      if (!current) throw new Error('PLY property is outside an element.');
      current.props.push(parseProperty(parts));
      continue;
    }
    if (keyword === 'end_header') break;
  }
  if (!format) throw new Error('PLY header is missing its format.');
  return { format, elements };
}

function parseProperty(parts: string[]): Prop {
  if (parts[1]?.toLowerCase() === 'list') {
    const name = parts[4];
    if (!name) throw new Error('PLY list property is invalid.');
    return { name, list: true, countType: requireScalar(parts[2]), valueType: requireScalar(parts[3]) };
  }
  const name = parts[2];
  if (!name) throw new Error('PLY property is invalid.');
  return { name, list: false, valueType: requireScalar(parts[1]) };
}

function requireScalar(name: string | undefined): ScalarType {
  if (!name) throw new Error('PLY property is invalid.');
  const type = SCALARS[name.toLowerCase()];
  if (!type) throw new Error(`PLY property type ${name} is not supported.`);
  return type;
}

function hasXYZ(element: Element): boolean {
  const names = new Set(element.props.filter((prop) => !prop.list).map((prop) => prop.name.toLowerCase()));
  return names.has('x') && names.has('y') && names.has('z');
}

function isFace(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === 'face' || lower === 'faces';
}

function faceListSlot(props: Prop[]): number {
  let slot = 0;
  let chosen = -1;
  for (const prop of props) {
    if (!prop.list) continue;
    if (chosen < 0 && /vertex/i.test(prop.name)) chosen = slot;
    slot += 1;
  }
  if (chosen >= 0) return chosen;
  return slot > 0 ? 0 : -1;
}

interface PlyRecord {
  scalars: number[];
  lists: number[][];
}

function pointFrom(props: Prop[], record: PlyRecord): SurveyPoint {
  const named = new Map<string, number>();
  let index = 0;
  for (const prop of props) {
    if (prop.list) continue;
    named.set(prop.name.toLowerCase(), record.scalars[index] ?? Number.NaN);
    index += 1;
  }
  const x = named.get('x');
  const y = named.get('y');
  const z = named.get('z');
  if (x === undefined || y === undefined || z === undefined || ![x, y, z].every(Number.isFinite)) {
    throw new Error('PLY vertices need x, y, and z.');
  }
  return { x, y, z, role: 'survey' };
}

function fan(polygons: number[][], vertexCount: number): Triangle[] {
  const triangles: Triangle[] = [];
  for (const polygon of polygons) {
    if (polygon.length < 3) continue;
    const ids = polygon.map((value) => Math.trunc(value));
    const base = ids[0];
    for (let index = 1; index + 1 < ids.length; index += 1) {
      const b = ids[index];
      const c = ids[index + 1];
      if (base < 0 || b < 0 || c < 0 || base >= vertexCount || b >= vertexCount || c >= vertexCount) continue;
      if (base === b || b === c || c === base) continue;
      triangles.push([base, b, c]);
    }
  }
  return triangles;
}

function parseAscii(body: Uint8Array, elements: Element[]): PlyMesh {
  const text = new TextDecoder('latin1').decode(body);
  const tokens = text.trim() ? text.trim().split(/\s+/) : [];
  const cursor = { index: 0 };
  const next = (): string => {
    if (cursor.index >= tokens.length) throw new Error('This PLY is truncated.');
    const token = tokens[cursor.index];
    cursor.index += 1;
    return token;
  };
  const read = (props: Prop[]): PlyRecord => {
    const scalars: number[] = [];
    const lists: number[][] = [];
    for (const prop of props) {
      if (prop.list) {
        const count = Number(next());
        if (!Number.isInteger(count) || count < 0 || count > 1_000_000) throw new Error('PLY list count is invalid.');
        const values: number[] = [];
        for (let index = 0; index < count; index += 1) {
          const value = Number(next());
          if (!Number.isFinite(value)) throw new Error('PLY value is not a number.');
          values.push(value);
        }
        lists.push(values);
      } else {
        const value = Number(next());
        if (!Number.isFinite(value)) throw new Error('PLY value is not a number.');
        scalars.push(value);
      }
    }
    return { scalars, lists };
  };
  return collect(elements, read);
}

function parseBinary(body: Uint8Array, elements: Element[], littleEndian: boolean): PlyMesh {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  let offset = 0;
  const readScalar = (type: ScalarType): number => {
    if (offset + type.size > view.byteLength) throw new Error('This PLY is truncated.');
    const at = offset;
    offset += type.size;
    if (type.float) return type.size === 8 ? view.getFloat64(at, littleEndian) : view.getFloat32(at, littleEndian);
    if (type.size === 1) return type.signed ? view.getInt8(at) : view.getUint8(at);
    if (type.size === 2) return type.signed ? view.getInt16(at, littleEndian) : view.getUint16(at, littleEndian);
    return type.signed ? view.getInt32(at, littleEndian) : view.getUint32(at, littleEndian);
  };
  const read = (props: Prop[]): PlyRecord => {
    const scalars: number[] = [];
    const lists: number[][] = [];
    for (const prop of props) {
      if (prop.list) {
        const count = readScalar(prop.countType ?? prop.valueType);
        if (!Number.isFinite(count) || count < 0 || count > 1_000_000) throw new Error('PLY list count is invalid.');
        const values: number[] = [];
        for (let index = 0; index < count; index += 1) values.push(readScalar(prop.valueType));
        lists.push(values);
      } else scalars.push(readScalar(prop.valueType));
    }
    return { scalars, lists };
  };
  return collect(elements, read);
}

function collect(elements: Element[], read: (props: Prop[]) => PlyRecord): PlyMesh {
  const points: SurveyPoint[] = [];
  const polygons: number[][] = [];
  let tookVertices = false;
  let tookFaces = false;
  for (const element of elements) {
    const vertex = !tookVertices && element.name.toLowerCase() === 'vertex';
    const face = !tookFaces && isFace(element.name);
    const slot = face ? faceListSlot(element.props) : -1;
    for (let index = 0; index < element.count; index += 1) {
      const record = read(element.props);
      if (vertex) points.push(pointFrom(element.props, record));
      else if (face && slot >= 0 && record.lists[slot]) polygons.push(record.lists[slot]);
    }
    if (vertex) tookVertices = true;
    if (face) tookFaces = true;
  }
  return { points, triangles: fan(polygons, points.length) };
}
