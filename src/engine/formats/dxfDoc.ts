import type { BulkGeometry, DrawEntity, DrawPolyline, Vec3 } from '../drafting';
import type { LinearUnit } from '../types';
import { createDxfStream, DXF_BULK_BYTES } from './dxfStream';

/**
 * Drawing interchange is DXF Release 2000 (header token AC1015).
 * The reader accepts later DXF releases that use the same group codes.
 * This module is the app's reader and writer. It does not call a paid CAD engine.
 * Large files stream in dxfStream.ts instead of building one group list.
 */
export const DXF_RELEASE = 'AC1015';

export interface DxfFace {
  a: Vec3;
  b: Vec3;
  c: Vec3;
}

export interface DxfLayerInfo {
  name: string;
  color: string;
  colorIndex: number;
  lineType: string;
  lineWeight: number;
  frozen: boolean;
  locked: boolean;
  visible: boolean;
}

export interface DxfModel {
  entities: DrawEntity[];
  faces: DxfFace[];
  layers: string[];
  layerRecords?: DxfLayerInfo[];
  /** Compact geometry for a large ASCII DXF. Absent on ordinary drawings. */
  bulk?: BulkGeometry;
}

const ACI: Record<number, string> = {
  1: '#ff0000',
  2: '#ffff00',
  3: '#00ff00',
  4: '#00ffff',
  5: '#0000ff',
  6: '#ff00ff',
  7: '#e8eef7',
};

function polylineHasVaryingZ(entity: DrawPolyline): boolean {
  if (entity.vertices.length === 0) return false;
  const z0 = entity.vertices[0].z;
  return entity.vertices.some((vertex) => Math.abs(vertex.z - z0) > 1e-6);
}

function polylineDxf(entity: DrawPolyline, common: string): string {
  if (entity.poly3d || polylineHasVaryingZ(entity)) {
    let body = pair(0, 'POLYLINE') + common + pair(70, (entity.closed ? 1 : 0) + 8) + pair(66, 1);
    for (const vertex of entity.vertices) {
      body += pair(0, 'VERTEX') + pair(8, entity.layer) + pair(10, num(vertex.x)) + pair(20, num(vertex.y)) + pair(30, num(vertex.z));
      if (vertex.bulge) body += pair(42, num(vertex.bulge));
    }
    return body + pair(0, 'SEQEND') + pair(8, entity.layer);
  }
  let body = pair(0, 'LWPOLYLINE') + common + pair(90, entity.vertices.length) + pair(70, entity.closed ? 1 : 0) + pair(38, num(entity.vertices[0]?.z ?? 0));
  for (const vertex of entity.vertices) {
    body += pair(10, num(vertex.x)) + pair(20, num(vertex.y));
    if (vertex.bulge) body += pair(42, num(vertex.bulge));
  }
  return body;
}

function pair(code: number, value: string | number): string {
  return `${code}\n${value}\n`;
}

function num(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Math.round(value * 1e6) / 1e6);
}

function colorOf(entity: DrawEntity): string {
  return entity.color === 'bylayer' ? 'bylayer' : entity.color;
}

function aciOf(color: string): number | null {
  if (color === 'bylayer') return 256;
  const found = Object.entries(ACI).find(([, hex]) => hex === color.toLowerCase());
  return found ? Number(found[0]) : null;
}

export function drawingToDxf(model: DxfModel, unit: LinearUnit = 'm'): string {
  const layers = [...new Set(['0', ...model.layers, ...model.entities.map((entity) => entity.layer)])];
  const records = new Map((model.layerRecords ?? []).map((layer) => [layer.name.toLowerCase(), layer]));
  let body =
    pair(0, 'SECTION') +
    pair(2, 'HEADER') +
    pair(9, '$ACADVER') +
    pair(1, DXF_RELEASE) +
    pair(9, '$INSUNITS') +
    pair(70, unit === 'ft' ? 2 : 6) +
    pair(9, '$LTSCALE') +
    pair(40, 1) +
    pair(9, '$CLAYER') +
    pair(8, '0') +
    pair(0, 'ENDSEC');
  body += pair(0, 'SECTION') + pair(2, 'TABLES') + pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, layers.length);
  for (const layer of layers) {
    const record = records.get(layer.toLowerCase());
    const flags = (record?.frozen ? 1 : 0) + (record?.locked ? 4 : 0);
    const color = record ? (record.visible ? record.colorIndex || 7 : -Math.abs(record.colorIndex || 7)) : 7;
    body += pair(0, 'LAYER') + pair(2, layer) + pair(70, flags) + pair(62, color) + pair(6, record?.lineType || 'CONTINUOUS');
    if (record && Number.isFinite(record.lineWeight)) body += pair(370, record.lineWeight);
  }
  body += pair(0, 'ENDTAB') + pair(0, 'ENDSEC');
  body += pair(0, 'SECTION') + pair(2, 'ENTITIES');
  for (const entity of model.entities) {
    const aci = aciOf(colorOf(entity));
    const common = pair(8, entity.layer) + (aci === null ? '' : pair(62, aci));
    if (entity.type === 'point') {
      body += pair(0, 'POINT') + common + pair(10, num(entity.p.x)) + pair(20, num(entity.p.y)) + pair(30, num(entity.p.z));
    } else if (entity.type === 'line') {
      body +=
        pair(0, 'LINE') +
        common +
        pair(10, num(entity.a.x)) +
        pair(20, num(entity.a.y)) +
        pair(30, num(entity.a.z)) +
        pair(11, num(entity.b.x)) +
        pair(21, num(entity.b.y)) +
        pair(31, num(entity.b.z));
    } else if (entity.type === 'polyline') {
      body += polylineDxf(entity, common);
    } else if (entity.type === 'block') {
      body +=
        pair(0, 'INSERT') +
        common +
        pair(2, entity.name) +
        pair(10, num(entity.p.x)) +
        pair(20, num(entity.p.y)) +
        pair(30, num(entity.p.z)) +
        pair(41, num(entity.scale)) +
        pair(50, num((entity.rotation * 180) / Math.PI));
    } else if (entity.type === 'circle') {
      body += pair(0, 'CIRCLE') + common + pair(10, num(entity.center.x)) + pair(20, num(entity.center.y)) + pair(30, num(entity.center.z)) + pair(40, num(entity.radius));
    } else if (entity.type === 'arc') {
      const start = (entity.startAngle * 180) / Math.PI;
      const end = (entity.endAngle * 180) / Math.PI;
      body +=
        pair(0, 'ARC') +
        common +
        pair(10, num(entity.center.x)) +
        pair(20, num(entity.center.y)) +
        pair(30, num(entity.center.z)) +
        pair(40, num(entity.radius)) +
        pair(50, num(start)) +
        pair(51, num(end));
    } else if (entity.type === 'text') {
      body +=
        pair(0, 'TEXT') +
        common +
        pair(10, num(entity.p.x)) +
        pair(20, num(entity.p.y)) +
        pair(30, num(entity.p.z)) +
        pair(40, num(entity.height)) +
        pair(1, entity.content) +
        pair(50, num((entity.rotation * 180) / Math.PI));
    }
  }
  for (const face of model.faces) {
    const corners = [face.a, face.b, face.c, face.c];
    body += pair(0, '3DFACE') + pair(8, 'TIN');
    corners.forEach((corner, index) => {
      body += pair(10 + index, num(corner.x)) + pair(20 + index, num(corner.y)) + pair(30 + index, num(corner.z));
    });
  }
  body += pair(0, 'ENDSEC') + pair(0, 'EOF');
  return body;
}

interface Group {
  code: number;
  value: string;
  number: number;
}

function asciiGroups(text: string): Group[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const groups: Group[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isFinite(code)) continue;
    const value = lines[i + 1].trim();
    groups.push({ code, value, number: Number(value) });
  }
  return groups;
}

function binaryValueKind(code: number): 'string' | 'double' | 'i16' | 'i32' | 'u8' {
  if (code >= 0 && code <= 9) return 'string';
  if (code >= 10 && code <= 59) return 'double';
  if (code >= 60 && code <= 79) return 'i16';
  if (code >= 90 && code <= 99) return 'i32';
  if (code >= 100 && code <= 109) return 'string';
  if (code >= 110 && code <= 149) return 'double';
  if (code >= 160 && code <= 179) return 'i16';
  if (code >= 210 && code <= 239) return 'double';
  if (code >= 270 && code <= 289) return 'i16';
  if (code >= 290 && code <= 299) return 'u8';
  if (code >= 300 && code <= 369) return 'string';
  if (code >= 370 && code <= 389) return 'i16';
  if (code >= 390 && code <= 399) return 'string';
  if (code >= 400 && code <= 409) return 'i16';
  if (code >= 410 && code <= 419) return 'string';
  if (code >= 420 && code <= 429) return 'i32';
  if (code >= 430 && code <= 439) return 'string';
  if (code >= 440 && code <= 449) return 'i32';
  if (code >= 450 && code <= 459) return 'i32';
  if (code >= 460 && code <= 469) return 'double';
  if (code >= 470 && code <= 479) return 'string';
  if (code >= 1000 && code <= 1009) return 'string';
  if (code >= 1010 && code <= 1059) return 'double';
  if (code >= 1060 && code <= 1070) return 'i16';
  return 'string';
}

function readCString(bytes: Uint8Array, offset: number): { value: string; next: number } {
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0) end += 1;
  return { value: new TextDecoder().decode(bytes.subarray(offset, end)), next: end + 1 };
}

export function binaryGroups(bytes: Uint8Array): Group[] {
  const header = new TextDecoder().decode(bytes.subarray(0, 22));
  if (!header.startsWith('AutoCAD Binary DXF')) throw new Error('Not a binary DXF file.');
  let offset = 22;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const groups: Group[] = [];
  while (offset + 2 <= bytes.length) {
    const code = view.getInt16(offset, true);
    offset += 2;
    const kind = binaryValueKind(code);
    if (kind === 'string') {
      const read = readCString(bytes, offset);
      offset = read.next;
      groups.push({ code, value: read.value.trim(), number: Number(read.value) });
    } else if (kind === 'double') {
      if (offset + 8 > bytes.length) break;
      const number = view.getFloat64(offset, true);
      offset += 8;
      groups.push({ code, value: String(number), number });
    } else if (kind === 'i16') {
      if (offset + 2 > bytes.length) break;
      const number = view.getInt16(offset, true);
      offset += 2;
      groups.push({ code, value: String(number), number });
    } else if (kind === 'i32') {
      if (offset + 4 > bytes.length) break;
      const number = view.getInt32(offset, true);
      offset += 4;
      groups.push({ code, value: String(number), number });
    } else {
      const number = bytes[offset] ?? 0;
      offset += 1;
      groups.push({ code, value: String(number), number });
    }
    if (groups.length > 2 && groups[groups.length - 1].value === 'EOF' && groups[groups.length - 1].code === 0) break;
  }
  return groups;
}

function vec(map: Map<number, number>, x: number, y: number, z: number): Vec3 {
  return { x: map.get(x) ?? 0, y: map.get(y) ?? 0, z: map.get(z) ?? 0 };
}

function takeColor(map: Map<number, number>): string {
  const aci = map.get(62);
  if (aci === undefined || aci === 256) return 'bylayer';
  return ACI[aci] ?? 'bylayer';
}

function takeRecord(groups: Group[], index: number, polyline = false): { map: Map<number, number>; strings: Map<number, string>; poly: { x: number; y: number; bulge: number }[]; next: number } {
  const map = new Map<number, number>();
  const strings = new Map<number, string>();
  const poly: { x: number; y: number; bulge: number }[] = [];
  let pendingX: number | null = null;
  let cursor = index;
  while (cursor < groups.length && groups[cursor].code !== 0) {
    const item = groups[cursor];
    if (polyline && item.code === 10) pendingX = item.number;
    else if (polyline && item.code === 20 && pendingX !== null) {
      poly.push({ x: pendingX, y: item.number, bulge: 0 });
      pendingX = null;
    } else if (polyline && item.code === 42 && poly.length > 0) poly[poly.length - 1].bulge = item.number;
    if (item.code === 1 || item.code === 2 || item.code === 3 || item.code === 6 || item.code === 8) strings.set(item.code, item.value);
    else if (Number.isFinite(item.number)) map.set(item.code, item.number);
    cursor += 1;
  }
  return { map, strings, poly, next: cursor };
}

export function modelFromGroups(groups: Group[]): DxfModel {
  const entities: DrawEntity[] = [];
  const faces: DxfFace[] = [];
  const layers = new Set<string>();
  const layerRecords: DxfLayerInfo[] = [];
  let inEntities = false;
  let section = '';
  let id = 1;
  const nextId = () => `e${id++}`;
  let index = 0;
  while (index < groups.length) {
    const group = groups[index];
    if (group.code === 0 && group.value === 'SECTION') {
      section = groups[index + 1]?.code === 2 ? groups[index + 1].value : '';
      inEntities = section === 'ENTITIES';
      index += 1;
      continue;
    }
    if (group.code === 0 && group.value === 'ENDSEC') {
      inEntities = false;
      index += 1;
      continue;
    }
    if (section === 'TABLES' && group.code === 0 && group.value === 'LAYER') {
      const record = takeRecord(groups, index + 1);
      const name = record.strings.get(2) || '0';
      const flags = record.map.get(70) ?? 0;
      const signed = record.map.get(62) ?? 7;
      const colorIndex = Math.min(255, Math.max(1, Math.abs(signed) || 7));
      layers.add(name);
      layerRecords.push({
        name,
        color: ACI[colorIndex] ?? '#e8eef7',
        colorIndex,
        lineType: record.strings.get(6) || 'Continuous',
        lineWeight: record.map.get(370) ?? -3,
        frozen: (flags & 1) === 1,
        locked: (flags & 4) === 4,
        visible: signed >= 0,
      });
      index = record.next;
      continue;
    }
    if (!inEntities || group.code !== 0) {
      index += 1;
      continue;
    }
    const type = group.value;
    const record = takeRecord(groups, index + 1, type === 'LWPOLYLINE');
    index = record.next;
    const map = record.map;
    const strings = record.strings;
    if (strings.get(8)) layers.add(strings.get(8) as string);
    const layer = strings.get(8) || '0';
    layers.add(layer);
    const color = takeColor(map);
    if (type === 'LINE') {
      entities.push({ id: nextId(), type: 'line', layer, color, a: vec(map, 10, 20, 30), b: vec(map, 11, 21, 31) });
    } else if (type === 'POINT') {
      entities.push({ id: nextId(), type: 'point', layer, color, p: vec(map, 10, 20, 30) });
    } else if (type === 'CIRCLE') {
      entities.push({ id: nextId(), type: 'circle', layer, color, center: vec(map, 10, 20, 30), radius: map.get(40) ?? 0 });
    } else if (type === 'ARC') {
      entities.push({
        id: nextId(),
        type: 'arc',
        layer,
        color,
        center: vec(map, 10, 20, 30),
        radius: map.get(40) ?? 0,
        startAngle: ((map.get(50) ?? 0) * Math.PI) / 180,
        endAngle: ((map.get(51) ?? 0) * Math.PI) / 180,
      });
    } else if (type === 'TEXT' || type === 'MTEXT') {
      entities.push({
        id: nextId(),
        type: 'text',
        layer,
        color,
        p: vec(map, 10, 20, 30),
        height: map.get(40) ?? 1,
        rotation: ((map.get(50) ?? 0) * Math.PI) / 180,
        content: strings.get(1) ?? '',
      });
    } else if (type === 'LWPOLYLINE') {
      const elevation = map.get(38) ?? 0;
      entities.push({
        id: nextId(),
        type: 'polyline',
        layer,
        color,
        closed: ((map.get(70) ?? 0) & 1) === 1,
        vertices: record.poly.map((vertex) => ({ x: vertex.x, y: vertex.y, z: elevation, bulge: vertex.bulge })),
      });
    } else if (type === 'POLYLINE') {
      const vertices: { x: number; y: number; z: number; bulge: number }[] = [];
      while (index < groups.length && groups[index].code === 0 && (groups[index].value === 'VERTEX' || groups[index].value === 'SEQEND')) {
        const kind = groups[index].value;
        const vertex = takeRecord(groups, index + 1);
        index = vertex.next;
        if (kind === 'SEQEND') break;
        vertices.push({ x: vertex.map.get(10) ?? 0, y: vertex.map.get(20) ?? 0, z: vertex.map.get(30) ?? 0, bulge: vertex.map.get(42) ?? 0 });
      }
      entities.push({
        id: nextId(),
        type: 'polyline',
        layer,
        color,
        closed: ((map.get(70) ?? 0) & 1) === 1,
        poly3d: ((map.get(70) ?? 0) & 8) === 8,
        vertices,
      });
    } else if (type === 'INSERT') {
      entities.push({
        id: nextId(),
        type: 'block',
        layer,
        color,
        name: strings.get(2) || 'BLOCK',
        p: vec(map, 10, 20, 30),
        rotation: ((map.get(50) ?? 0) * Math.PI) / 180,
        scale: map.get(41) || 1,
      });
    } else if (type === '3DFACE') {
      const a = vec(map, 10, 20, 30);
      const b = vec(map, 11, 21, 31);
      const c = vec(map, 12, 22, 32);
      faces.push({ a, b, c });
    }
  }
  return { entities, faces, layers: [...layers], layerRecords };
}

export function parseDxf(input: string | Uint8Array, options?: { bulkBytes?: number; maxSegments?: number }): DxfModel {
  if (typeof input !== 'string') {
    const head = new TextDecoder().decode(input.subarray(0, 22));
    if (head.startsWith('AutoCAD Binary DXF')) return modelFromGroups(binaryGroups(input));
    const bulkBytes = options?.bulkBytes ?? DXF_BULK_BYTES;
    if (input.byteLength >= bulkBytes) {
      const stream = createDxfStream(input.byteLength, options?.maxSegments);
      stream.push(input);
      return stream.finish();
    }
    return modelFromGroups(asciiGroups(new TextDecoder().decode(input)));
  }
  return modelFromGroups(asciiGroups(input));
}

/** One LINE, for the binary reader test. Group codes are little-endian. */
export function binaryLineDxf(): Uint8Array {
  const chunks: number[] = [];
  const push = (...bytes: number[]) => chunks.push(...bytes);
  const text = 'AutoCAD Binary DXF\r\n\x1a\0';
  for (const ch of text) push(ch.charCodeAt(0));
  const code = (value: number) => {
    push(value & 255, (value >> 8) & 255);
  };
  const str = (value: string) => {
    for (const ch of value) push(ch.charCodeAt(0));
    push(0);
  };
  const dbl = (value: number) => {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setFloat64(0, value, true);
    push(...new Uint8Array(buffer));
  };
  const groupStr = (group: number, value: string) => {
    code(group);
    str(value);
  };
  const groupDbl = (group: number, value: number) => {
    code(group);
    dbl(value);
  };
  groupStr(0, 'SECTION');
  groupStr(2, 'ENTITIES');
  groupStr(0, 'LINE');
  groupStr(8, '0');
  groupDbl(10, 1);
  groupDbl(20, 2);
  groupDbl(30, 3);
  groupDbl(11, 4);
  groupDbl(21, 5);
  groupDbl(31, 6);
  groupStr(0, 'ENDSEC');
  groupStr(0, 'EOF');
  return Uint8Array.from(chunks);
}
