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

/**
 * Vertices kept from a dense cloud. Above this, opening samples the cloud so a
 * surface can still be built. Matches the point budget used for 3D display.
 */
export const PLY_POINT_CAP = 200_000;

/**
 * Files at or above this size are read in parts. A single base64 copy of a
 * dense cloud is large enough to abort the desktop shell.
 */
export const PLY_STREAM_BYTES = 8_000_000;

/** Declared vertex counts above this are refused before any point storage. */
export const PLY_VERTEX_REFUSE = 500_000_000;

const PLY_INLINE_MAX = 48 * 1024 * 1024;
const PLY_CHUNK_BYTES = 8 * 1024 * 1024;

export interface PlyLoad extends PlyMesh {
  /** Vertices declared on the vertex element. */
  vertexCount: number;
  /** Points stored. */
  kept: number;
  /** True when the file had more vertices than the cap. */
  sampled: boolean;
  /** 1 when every vertex is kept. */
  stride: number;
  /** Command-line sentence. Empty when the file was loaded in full. */
  status: string;
}

export interface PlySource {
  byteLength: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface PlyProgress {
  fraction: number;
  /** Counts only, for example `12,000 of 33,000,000 vertices`. */
  message: string;
}

export interface PlyLoadOptions {
  cap?: number;
  /** Read size. Short reads are filled until the span is complete. */
  chunkBytes?: number;
  /** Files at or under this size, when every vertex is kept, use the full parser. */
  inlineMax?: number;
  signal?: AbortSignal;
  /** Yield to the UI between chunks. Tests pass false. */
  yield?: boolean;
  onProgress?: (progress: PlyProgress) => void;
}

export interface PlySamplePlan {
  stride: number;
  kept: number;
}

/** How many vertices a dense cloud keeps. `kept` is never above the cap. */
export function plySamplePlan(count: number, cap = PLY_POINT_CAP): PlySamplePlan {
  if (!Number.isInteger(count) || count < 0) throw new Error('PLY element count is invalid.');
  if (count > PLY_VERTEX_REFUSE) {
    throw new Error(`This PLY declares ${count.toLocaleString()} vertices, which is too large to open.`);
  }
  const limit = Math.max(1, Math.min(PLY_POINT_CAP, Math.floor(cap) || PLY_POINT_CAP));
  if (count <= limit) return { stride: 1, kept: count };
  const stride = Math.ceil(count / limit);
  return { stride, kept: Math.ceil(count / stride) };
}

/** In-memory bytes as a part reader. Each read is a view, not a copy of the file. */
export function plyMemorySource(bytes: Uint8Array): PlySource {
  return {
    byteLength: bytes.byteLength,
    read(offset, length) {
      if (offset < 0 || length < 0 || offset >= bytes.byteLength) return Promise.resolve(new Uint8Array(0));
      const end = Math.min(bytes.byteLength, offset + length);
      return Promise.resolve(bytes.subarray(offset, end));
    },
  };
}

/**
 * Read a PLY from successive slices.
 * Dense vertex clouds are sampled on a fixed stride. Normals, color, and other
 * vertex properties are not stored. A cloud that fits the cap is kept whole,
 * including polygon faces.
 */
export async function loadPly(source: PlySource, options: PlyLoadOptions = {}): Promise<PlyLoad> {
  if (source.byteLength > 8 * 1024 * 1024 * 1024) {
    throw new Error('This PLY is too large to open.');
  }
  throwIfAborted(options.signal);
  const headerEnd = await locateHeader(source, options.signal);
  const headerBytes = await readExact(source, 0, headerEnd, options.signal);
  const stripped = stripBom(headerBytes);
  const split = splitHeader(stripped);
  const parsed = parseHeader(split.header);
  const vertex = parsed.elements.find((element) => element.name.toLowerCase() === 'vertex');
  if (!vertex) throw new Error('PLY file has no vertex element.');
  if (!hasXYZ(vertex)) throw new Error('PLY vertices need x, y, and z.');
  const plan = plySamplePlan(vertex.count, options.cap);
  const inlineMax = options.inlineMax ?? PLY_INLINE_MAX;
  if (plan.stride === 1 && source.byteLength <= inlineMax) {
    options.onProgress?.({ fraction: 1, message: progressMessage(vertex.count, vertex.count) });
    const mesh = parsePly(await readExact(source, 0, source.byteLength, options.signal));
    return {
      points: mesh.points,
      triangles: mesh.triangles,
      vertexCount: vertex.count,
      kept: mesh.points.length,
      sampled: false,
      stride: 1,
      status: '',
    };
  }
  if (parsed.format === 'ascii') return loadAscii(source, headerEnd, parsed.elements, vertex, plan, options);
  const layout = vertexLayout(vertex);
  if (!layout) {
    throw new Error('This PLY stores vertices as variable-length records. Export x, y, and z as scalar properties.');
  }
  return loadBinary(source, headerEnd, parsed.elements, vertex, layout, parsed.format === 'le', plan, options);
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

function splitHeader(bytes: Uint8Array, partial = false): { header: string; body: Uint8Array } {
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
    else if (end !== bytes.length || partial) continue;
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

interface FieldRef {
  offset: number;
  type: ScalarType;
}

interface VertexLayout {
  stride: number;
  x: FieldRef;
  y: FieldRef;
  z: FieldRef;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('The operation was cancelled.');
  error.name = 'AbortError';
  throw error;
}

function yieldTurn(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function progressMessage(done: number, total: number): string {
  return `${done.toLocaleString()} of ${total.toLocaleString()} vertices`;
}

function memoryMessage(vertexCount: number, kept: number): string {
  const count = vertexCount > 0 ? `${vertexCount.toLocaleString()} vertices` : 'a dense cloud';
  return `Not enough memory to open this PLY (${count}). Civil Design keeps at most ${PLY_POINT_CAP.toLocaleString()} points and could not store ${Math.max(0, kept).toLocaleString()}. Close other drawings and try again.`;
}

function allocatePoints(count: number, vertexCount: number): SurveyPoint[] {
  if (!Number.isInteger(count) || count < 0 || count > PLY_POINT_CAP) throw new Error(memoryMessage(vertexCount, count));
  try {
    return new Array<SurveyPoint>(count);
  } catch {
    throw new Error(memoryMessage(vertexCount, count));
  }
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.byteLength;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function headerEndOf(bytes: Uint8Array, partial: boolean): number | null {
  try {
    const stripped = stripBom(bytes);
    const split = splitHeader(stripped, partial);
    return bytes.byteLength - stripped.byteLength + (stripped.byteLength - split.body.byteLength);
  } catch (error) {
    if (error instanceof Error && error.message.includes('end_header')) return null;
    throw error;
  }
}

async function locateHeader(source: PlySource, signal?: AbortSignal): Promise<number> {
  const limit = Math.min(source.byteLength, 1_048_576);
  const pieces: Uint8Array[] = [];
  let got = 0;
  while (got < limit) {
    throwIfAborted(signal);
    const part = await source.read(got, Math.min(65_536, limit - got));
    if (part.byteLength === 0) break;
    pieces.push(part.slice());
    got += part.byteLength;
    const end = headerEndOf(concatBytes(pieces), got < source.byteLength);
    if (end != null) return end;
  }
  throw new Error('PLY header is missing end_header.');
}

async function readExact(source: PlySource, offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
  if (length === 0) return new Uint8Array(0);
  if (length > 16 * 1024 * 1024) throw new Error('Not enough memory to read this PLY. Close other drawings and try again.');
  let out: Uint8Array;
  try {
    out = new Uint8Array(length);
  } catch {
    throw new Error('Not enough memory to read this PLY. Close other drawings and try again.');
  }
  let filled = 0;
  while (filled < length) {
    throwIfAborted(signal);
    const need = length - filled;
    const part = await source.read(offset + filled, need);
    if (part.byteLength === 0) throw new Error('This PLY is truncated.');
    const take = Math.min(part.byteLength, need);
    out.set(part.subarray(0, take), filled);
    filled += take;
  }
  return out;
}

function checkedMul(count: number, stride: number): number {
  if (count === 0) return 0;
  if (!Number.isInteger(stride) || stride <= 0 || stride > 1_000_000) throw new Error('PLY vertex record is invalid.');
  if (count > Math.floor(Number.MAX_SAFE_INTEGER / stride)) {
    throw new Error(`This PLY declares ${count.toLocaleString()} vertices, which is too large to open.`);
  }
  return count * stride;
}

function fixedElementBytes(element: Element): number | null {
  let stride = 0;
  for (const prop of element.props) {
    if (prop.list) return null;
    stride += prop.valueType.size;
  }
  if (stride <= 0) return element.count === 0 ? 0 : null;
  return checkedMul(element.count, stride);
}

function vertexLayout(element: Element): VertexLayout | null {
  let offset = 0;
  let x: FieldRef | null = null;
  let y: FieldRef | null = null;
  let z: FieldRef | null = null;
  for (const prop of element.props) {
    if (prop.list) return null;
    const field = { offset, type: prop.valueType };
    const name = prop.name.toLowerCase();
    if (name === 'x') x = field;
    else if (name === 'y') y = field;
    else if (name === 'z') z = field;
    offset += prop.valueType.size;
  }
  if (!x || !y || !z || offset <= 0) return null;
  return { stride: offset, x, y, z };
}

function vertexDataOffset(headerEnd: number, elements: Element[], vertex: Element): number {
  let cursor = headerEnd;
  for (const element of elements) {
    if (element === vertex) return cursor;
    const size = fixedElementBytes(element);
    if (size == null) throw new Error('This PLY has a variable-length element before the vertices.');
    cursor += size;
  }
  return cursor;
}

function faceByteOffset(headerEnd: number, elements: Element[], vertex: Element, recordStride: number): number | null {
  let cursor = headerEnd;
  for (const element of elements) {
    if (isFace(element.name)) return cursor;
    if (element === vertex) {
      cursor += checkedMul(element.count, recordStride);
      continue;
    }
    const size = fixedElementBytes(element);
    if (size == null) return null;
    cursor += size;
  }
  return null;
}

function readScalarAt(view: DataView, offset: number, type: ScalarType, littleEndian: boolean): number {
  if (offset < 0 || offset + type.size > view.byteLength) throw new Error('This PLY is truncated.');
  if (type.float) return type.size === 8 ? view.getFloat64(offset, littleEndian) : view.getFloat32(offset, littleEndian);
  if (type.size === 1) return type.signed ? view.getInt8(offset) : view.getUint8(offset);
  if (type.size === 2) return type.signed ? view.getInt16(offset, littleEndian) : view.getUint16(offset, littleEndian);
  return type.signed ? view.getInt32(offset, littleEndian) : view.getUint32(offset, littleEndian);
}

function takeSamples(
  bytes: Uint8Array,
  layout: VertexLayout,
  indexStart: number,
  indexCount: number,
  plan: PlySamplePlan,
  littleEndian: boolean,
  points: SurveyPoint[],
  written: number,
): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let index = indexStart;
  if (plan.stride > 1) {
    const mod = index % plan.stride;
    if (mod !== 0) index += plan.stride - mod;
  }
  const end = indexStart + indexCount;
  for (; index < end; index += plan.stride) {
    const local = (index - indexStart) * layout.stride;
    const x = readScalarAt(view, local + layout.x.offset, layout.x.type, littleEndian);
    const y = readScalarAt(view, local + layout.y.offset, layout.y.type, littleEndian);
    const z = readScalarAt(view, local + layout.z.offset, layout.z.type, littleEndian);
    if (![x, y, z].every(Number.isFinite)) throw new Error('PLY vertices need x, y, and z.');
    points[written] = { x, y, z, role: 'survey' };
    written += 1;
  }
  return written;
}

function describeLoad(vertexCount: number, kept: number, stride: number, skippedFaces: boolean): string {
  if (stride <= 1 && !skippedFaces) return '';
  if (stride > 1) {
    const faces = skippedFaces ? ' Faces were not loaded with the sample.' : '';
    return `Opened ${kept.toLocaleString()} of ${vertexCount.toLocaleString()} PLY vertices (every ${stride.toLocaleString()}th point). Extra properties such as normals and colors were skipped.${faces} The sample is triangulated as a surface.`;
  }
  return `Opened ${kept.toLocaleString()} PLY vertices. Faces were skipped because there are too many to load at once.`;
}

class BinQueue {
  private chunks: Uint8Array[] = [];
  private offset = 0;
  private available = 0;
  private filePos: number;

  constructor(
    private source: PlySource,
    start: number,
    private signal?: AbortSignal,
  ) {
    this.filePos = start;
  }

  async read(size: number): Promise<Uint8Array> {
    while (this.available < size) {
      throwIfAborted(this.signal);
      if (this.filePos >= this.source.byteLength) throw new Error('This PLY is truncated.');
      const part = await this.source.read(this.filePos, Math.min(PLY_CHUNK_BYTES, this.source.byteLength - this.filePos));
      if (part.byteLength === 0) throw new Error('This PLY is truncated.');
      this.filePos += part.byteLength;
      this.chunks.push(part.slice());
      this.available += part.byteLength;
    }
    const out = new Uint8Array(size);
    let filled = 0;
    while (filled < size) {
      const chunk = this.chunks[0];
      const take = Math.min(chunk.length - this.offset, size - filled);
      out.set(chunk.subarray(this.offset, this.offset + take), filled);
      filled += take;
      this.offset += take;
      this.available -= take;
      if (this.offset >= chunk.length) {
        this.chunks.shift();
        this.offset = 0;
      }
    }
    return out;
  }
}

async function readQueuedScalar(queue: BinQueue, type: ScalarType, littleEndian: boolean): Promise<number> {
  const bytes = await queue.read(type.size);
  return readScalarAt(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 0, type, littleEndian);
}

async function readFaces(
  source: PlySource,
  offset: number,
  element: Element,
  vertexCount: number,
  littleEndian: boolean,
  signal?: AbortSignal,
): Promise<Triangle[]> {
  const slot = faceListSlot(element.props);
  if (slot < 0 || element.count === 0) return [];
  const queue = new BinQueue(source, offset, signal);
  const polygons: number[][] = [];
  for (let index = 0; index < element.count; index += 1) {
    throwIfAborted(signal);
    let listIndex = 0;
    let chosen: number[] | null = null;
    for (const prop of element.props) {
      if (prop.list) {
        const count = await readQueuedScalar(queue, prop.countType ?? prop.valueType, littleEndian);
        if (!Number.isFinite(count) || count < 0 || count > 1_000_000) throw new Error('PLY list count is invalid.');
        const values: number[] = [];
        const total = Math.trunc(count);
        for (let item = 0; item < total; item += 1) values.push(await readQueuedScalar(queue, prop.valueType, littleEndian));
        if (listIndex === slot) chosen = values;
        listIndex += 1;
      } else {
        await readQueuedScalar(queue, prop.valueType, littleEndian);
      }
    }
    if (chosen) polygons.push(chosen);
  }
  return fan(polygons, vertexCount);
}

async function loadBinary(
  source: PlySource,
  headerEnd: number,
  elements: Element[],
  vertex: Element,
  layout: VertexLayout,
  littleEndian: boolean,
  plan: PlySamplePlan,
  options: PlyLoadOptions,
): Promise<PlyLoad> {
  const dataOffset = vertexDataOffset(headerEnd, elements, vertex);
  const region = checkedMul(vertex.count, layout.stride);
  if (dataOffset > source.byteLength || region > source.byteLength - dataOffset) throw new Error('This PLY is truncated.');
  const points = allocatePoints(plan.kept, vertex.count);
  let written = 0;
  const chunkVerts = Math.max(1, Math.floor((options.chunkBytes && options.chunkBytes > 0 ? options.chunkBytes : PLY_CHUNK_BYTES) / layout.stride));
  if (vertex.count === 0) {
    options.onProgress?.({ fraction: 1, message: progressMessage(0, 0) });
  }
  for (let start = 0; start < vertex.count; ) {
    throwIfAborted(options.signal);
    const count = Math.min(chunkVerts, vertex.count - start);
    const bytes = await readExact(source, dataOffset + start * layout.stride, count * layout.stride, options.signal);
    written = takeSamples(bytes, layout, start, count, plan, littleEndian, points, written);
    start += count;
    options.onProgress?.({ fraction: start / vertex.count, message: progressMessage(start, vertex.count) });
    if (options.yield !== false) await yieldTurn();
  }
  if (written !== plan.kept) throw new Error(`PLY sample kept ${written} points, expected ${plan.kept}.`);
  const face = elements.find((element) => isFace(element.name));
  let skippedFaces = false;
  let triangles: Triangle[] = [];
  if (face && face.count > 0) {
    if (plan.stride > 1 || face.count > PLY_POINT_CAP) skippedFaces = true;
    else {
      const at = faceByteOffset(headerEnd, elements, vertex, layout.stride);
      if (at == null) skippedFaces = true;
      else triangles = await readFaces(source, at, face, points.length, littleEndian, options.signal);
    }
  }
  return {
    points,
    triangles,
    vertexCount: vertex.count,
    kept: written,
    sampled: plan.stride > 1,
    stride: plan.stride,
    status: describeLoad(vertex.count, written, plan.stride, skippedFaces),
  };
}

function createTokens(source: PlySource, start: number, options: PlyLoadOptions): () => Promise<string> {
  let offset = start;
  let partial = '';
  const pending: string[] = [];
  const chunk = options.chunkBytes && options.chunkBytes > 0 ? options.chunkBytes : PLY_CHUNK_BYTES;
  return async () => {
    while (pending.length === 0) {
      throwIfAborted(options.signal);
      if (offset >= source.byteLength) {
        if (!partial) throw new Error('This PLY is truncated.');
        const token = partial;
        partial = '';
        return token;
      }
      const part = await source.read(offset, Math.min(chunk, source.byteLength - offset));
      if (part.byteLength === 0) {
        offset = source.byteLength;
        continue;
      }
      offset += part.byteLength;
      const text = partial + new TextDecoder('latin1').decode(part);
      const ended = /\s$/.test(text);
      const bits = text.split(/\s+/);
      partial = ended ? '' : (bits.pop() ?? '');
      for (const bit of bits) if (bit) pending.push(bit);
    }
    const next = pending.shift();
    if (next === undefined) throw new Error('This PLY is truncated.');
    return next;
  };
}

async function readAsciiRecord(pull: () => Promise<string>, props: Prop[]): Promise<{ x?: number; y?: number; z?: number; lists: number[][] }> {
  let x: number | undefined;
  let y: number | undefined;
  let z: number | undefined;
  const lists: number[][] = [];
  for (const prop of props) {
    if (prop.list) {
      const count = Number(await pull());
      if (!Number.isInteger(count) || count < 0 || count > 1_000_000) throw new Error('PLY list count is invalid.');
      const values: number[] = [];
      for (let index = 0; index < count; index += 1) {
        const value = Number(await pull());
        if (!Number.isFinite(value)) throw new Error('PLY value is not a number.');
        values.push(value);
      }
      lists.push(values);
    } else {
      const value = Number(await pull());
      if (!Number.isFinite(value)) throw new Error('PLY value is not a number.');
      const name = prop.name.toLowerCase();
      if (name === 'x') x = value;
      else if (name === 'y') y = value;
      else if (name === 'z') z = value;
    }
  }
  return { x, y, z, lists };
}

async function loadAscii(
  source: PlySource,
  headerEnd: number,
  elements: Element[],
  vertex: Element,
  plan: PlySamplePlan,
  options: PlyLoadOptions,
): Promise<PlyLoad> {
  const points = allocatePoints(plan.kept, vertex.count);
  const polygons: number[][] = [];
  const pull = createTokens(source, headerEnd, options);
  let written = 0;
  let tookVertices = false;
  let tookFaces = false;
  let skippedFaces = false;
  for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
    const element = elements[elementIndex];
    if (tookVertices && plan.stride > 1) {
      skippedFaces = elements.slice(elementIndex).some((item) => isFace(item.name) && item.count > 0);
      break;
    }
    const isVertex = !tookVertices && element.name.toLowerCase() === 'vertex';
    const face = !tookFaces && isFace(element.name);
    if (face && element.count > PLY_POINT_CAP) {
      skippedFaces = true;
      break;
    }
    const slot = face ? faceListSlot(element.props) : -1;
    for (let index = 0; index < element.count; index += 1) {
      throwIfAborted(options.signal);
      const record = await readAsciiRecord(pull, element.props);
      if (isVertex) {
        if (index % plan.stride === 0) {
          const { x, y, z } = record;
          if (x === undefined || y === undefined || z === undefined || ![x, y, z].every(Number.isFinite)) {
            throw new Error('PLY vertices need x, y, and z.');
          }
          points[written] = { x, y, z, role: 'survey' };
          written += 1;
        }
        if (index === element.count - 1 || index % 50_000 === 0) {
          options.onProgress?.({ fraction: (index + 1) / element.count, message: progressMessage(index + 1, element.count) });
          if (options.yield !== false) await yieldTurn();
        }
      } else if (face && slot >= 0 && record.lists[slot]) polygons.push(record.lists[slot]);
    }
    if (isVertex) tookVertices = true;
    if (face) tookFaces = true;
  }
  if (written !== plan.kept) throw new Error(`PLY sample kept ${written} points, expected ${plan.kept}.`);
  const triangles = plan.stride > 1 ? [] : fan(polygons, points.length);
  return {
    points,
    triangles,
    vertexCount: vertex.count,
    kept: written,
    sampled: plan.stride > 1,
    stride: plan.stride,
    status: describeLoad(vertex.count, written, plan.stride, skippedFaces),
  };
}
