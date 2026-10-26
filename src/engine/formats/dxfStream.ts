import type { BulkGeometry, DrawEntity } from '../drafting';
import type { DxfLayerInfo, DxfModel } from './dxfDoc';

/** ASCII DXF at or above this size is parsed in one pass and stored as compact geometry. */
export const DXF_BULK_BYTES = 4_000_000;

/** Segment cap. Past this the opened drawing is the first part of the file. */
export const DXF_MAX_SEGMENTS = 40_000_000;

const ACI: Record<number, string> = {
  1: '#ff0000',
  2: '#ffff00',
  3: '#00ff00',
  4: '#00ffff',
  5: '#0000ff',
  6: '#ff00ff',
  7: '#e8eef7',
};

const decoder = new TextDecoder('latin1');

interface Poly {
  layer: string;
  flags: number;
  verts: { x: number; y: number }[];
}

/**
 * One-pass ASCII reader. Group pairs are consumed as they arrive, including
 * when a pair is split across chunks, so the whole file is never a string.
 */
export class DxfStream {
  private carry = new Uint8Array(0);
  private expectValue = false;
  private code = 0;
  private section = '';
  private expectSection = false;
  private mode: 'idle' | 'rec' | 'vertex' = 'idle';
  private type = '';
  private num = new Map<number, number>();
  private str = new Map<number, string>();
  private lw: { x: number; y: number }[] = [];
  private pendingX: number | null = null;
  private poly: Poly | null = null;
  private entityCount = 0;
  private id = 1;
  private readonly layers = new Set<string>();
  private readonly layerRecords: DxfLayerInfo[] = [];
  private readonly entities: DrawEntity[] = [];
  private truncated = false;
  private segs: Float64Array;
  private segCount = 0;
  private pts: Float64Array;
  private ptCount = 0;
  private minX = Infinity;
  private minY = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;
  private objects = 0;
  private readonly maxSegments: number;
  private readonly objectCap = 20_000;

  constructor(byteLength = 0, maxSegments = DXF_MAX_SEGMENTS) {
    this.maxSegments = maxSegments;
    const guess = Math.min(maxSegments, Math.max(1024, Math.floor(byteLength / 48) || 1024));
    this.segs = allocate(guess * 4, 4096);
    const pointGuess = Math.min(2_000_000, Math.max(64, Math.floor(byteLength / 400) || 64));
    this.pts = allocate(pointGuess * 2, 128);
  }

  push(chunk: Uint8Array): void {
    if (chunk.byteLength === 0) return;
    let data: Uint8Array;
    if (this.carry.byteLength > 0) {
      data = new Uint8Array(this.carry.byteLength + chunk.byteLength);
      data.set(this.carry, 0);
      data.set(chunk, this.carry.byteLength);
      this.carry = new Uint8Array(0);
    } else {
      data = chunk;
    }
    if (!this.expectValue && this.code === 0 && this.section === '' && data.byteLength >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
      data = data.subarray(3);
    }
    let start = 0;
    for (let index = 0; index < data.length; index += 1) {
      if (data[index] !== 10) continue;
      let end = index;
      if (end > start && data[end - 1] === 13) end -= 1;
      this.line(data.subarray(start, end));
      start = index + 1;
    }
    if (start < data.length) this.carry = data.slice(start);
  }

  finish(): DxfModel {
    if (this.carry.byteLength > 0) {
      this.line(this.carry);
      this.carry = new Uint8Array(0);
    }
    if (this.mode === 'vertex' && this.poly) {
      this.poly.verts.push({ x: this.num.get(10) ?? 0, y: this.num.get(20) ?? 0 });
    } else if (this.mode === 'rec' && this.type !== 'POLYLINE' && this.type !== 'LAYER') {
      this.flushEntity();
    }
    if (this.poly) this.flushPoly();
    const finite = Number.isFinite(this.minX) && Number.isFinite(this.maxX);
    const bulk: BulkGeometry = {
      segments: this.segs.slice(0, this.segCount * 4),
      points: this.pts.slice(0, this.ptCount * 2),
      segmentCount: this.segCount,
      pointCount: this.ptCount,
      entityCount: this.entityCount,
      minX: finite ? this.minX : 0,
      minY: finite ? this.minY : 0,
      maxX: finite ? this.maxX : 0,
      maxY: finite ? this.maxY : 0,
      truncated: this.truncated,
    };
    return {
      entities: this.entities,
      faces: [],
      layers: [...this.layers],
      layerRecords: this.layerRecords,
      bulk,
    };
  }

  private line(raw: Uint8Array): void {
    const text = decoder.decode(raw).trim();
    if (!this.expectValue) {
      const code = Number(text);
      this.code = Number.isFinite(code) ? code : 0;
      this.expectValue = true;
      return;
    }
    this.expectValue = false;
    this.onGroup(this.code, text);
  }

  private onGroup(code: number, text: string): void {
    if (this.expectSection) {
      this.expectSection = false;
      if (code === 2) this.section = text;
      return;
    }
    if (code === 0) {
      this.onZero(text);
      return;
    }
    if (this.mode === 'idle') return;
    if (this.type === 'LWPOLYLINE' && this.mode === 'rec') {
      if (code === 10) this.pendingX = Number(text);
      else if (code === 20 && this.pendingX !== null && Number.isFinite(this.pendingX)) {
        this.lw.push({ x: this.pendingX, y: Number(text) });
        this.pendingX = null;
      }
    }
    if (code === 1 || code === 2 || code === 3 || code === 6 || code === 8) this.str.set(code, text);
    else {
      const number = Number(text);
      if (Number.isFinite(number)) this.num.set(code, number);
    }
  }

  private onZero(value: string): void {
    if (this.mode === 'vertex' && this.poly) {
      this.poly.verts.push({ x: this.num.get(10) ?? 0, y: this.num.get(20) ?? 0 });
    } else if (this.mode === 'rec' && this.type === 'POLYLINE' && this.poly) {
      this.poly.layer = this.str.get(8) || this.poly.layer;
      this.poly.flags = this.num.get(70) ?? this.poly.flags;
      this.layers.add(this.poly.layer);
    } else if (this.mode === 'rec' && this.type === 'LAYER') {
      this.addLayer();
    } else if (this.mode === 'rec') {
      this.flushEntity();
    }
    this.clear();
    this.mode = 'idle';
    if (value === 'SECTION') {
      this.expectSection = true;
      return;
    }
    if (value === 'ENDSEC') {
      if (this.poly) this.flushPoly();
      this.section = '';
      return;
    }
    if (value === 'EOF') {
      if (this.poly) this.flushPoly();
      return;
    }
    if (this.section === 'TABLES' && value === 'LAYER') {
      this.mode = 'rec';
      this.type = 'LAYER';
      return;
    }
    if (this.section !== 'ENTITIES') return;
    if (value === 'VERTEX' && this.poly) {
      this.mode = 'vertex';
      return;
    }
    if (value === 'SEQEND' && this.poly) {
      this.flushPoly();
      return;
    }
    if (this.poly) this.flushPoly();
    if (value === 'POLYLINE') {
      this.poly = { layer: '0', flags: 0, verts: [] };
      this.mode = 'rec';
      this.type = 'POLYLINE';
      return;
    }
    this.mode = 'rec';
    this.type = value;
  }

  private clear(): void {
    this.num = new Map();
    this.str = new Map();
    this.lw = [];
    this.pendingX = null;
  }

  private addLayer(): void {
    const name = this.str.get(2) || '0';
    const flags = this.num.get(70) ?? 0;
    const signed = this.num.get(62) ?? 7;
    const colorIndex = Math.min(255, Math.max(1, Math.abs(signed) || 7));
    this.layers.add(name);
    this.layerRecords.push({
      name,
      color: ACI[colorIndex] ?? '#e8eef7',
      colorIndex,
      lineType: this.str.get(6) || 'Continuous',
      lineWeight: this.num.get(370) ?? -3,
      frozen: (flags & 1) === 1,
      locked: (flags & 4) === 4,
      visible: signed >= 0,
    });
  }

  private color(): string {
    const aci = this.num.get(62);
    if (aci === undefined || aci === 256) return 'bylayer';
    return ACI[Math.abs(aci)] ?? 'bylayer';
  }

  private flushEntity(): void {
    const type = this.type;
    const layer = this.str.get(8) || '0';
    this.layers.add(layer);
    if (type === 'LINE') {
      this.entityCount += 1;
      this.addSeg(this.num.get(10) ?? 0, this.num.get(20) ?? 0, this.num.get(11) ?? 0, this.num.get(21) ?? 0);
      return;
    }
    if (type === 'POINT') {
      this.entityCount += 1;
      this.addPt(this.num.get(10) ?? 0, this.num.get(20) ?? 0);
      return;
    }
    if (type === 'LWPOLYLINE') {
      this.entityCount += 1;
      this.addChain(this.lw, ((this.num.get(70) ?? 0) & 1) === 1);
      return;
    }
    if (type === '3DFACE') {
      this.entityCount += 1;
      const a = { x: this.num.get(10) ?? 0, y: this.num.get(20) ?? 0 };
      const b = { x: this.num.get(11) ?? 0, y: this.num.get(21) ?? 0 };
      const c = { x: this.num.get(12) ?? 0, y: this.num.get(22) ?? 0 };
      this.addSeg(a.x, a.y, b.x, b.y);
      this.addSeg(b.x, b.y, c.x, c.y);
      this.addSeg(c.x, c.y, a.x, a.y);
      return;
    }
    if (type === 'CIRCLE' || type === 'ARC') {
      this.entityCount += 1;
      if (this.objects >= this.objectCap) {
        this.tessellate(type === 'ARC');
        return;
      }
      this.objects += 1;
      const center = { x: this.num.get(10) ?? 0, y: this.num.get(20) ?? 0, z: this.num.get(30) ?? 0 };
      const radius = this.num.get(40) ?? 0;
      if (type === 'CIRCLE') {
        this.entities.push({ id: `e${this.id++}`, type: 'circle', layer, color: this.color(), center, radius });
      } else {
        this.entities.push({
          id: `e${this.id++}`,
          type: 'arc',
          layer,
          color: this.color(),
          center,
          radius,
          startAngle: ((this.num.get(50) ?? 0) * Math.PI) / 180,
          endAngle: ((this.num.get(51) ?? 0) * Math.PI) / 180,
        });
      }
      this.note(center.x - radius, center.y - radius);
      this.note(center.x + radius, center.y + radius);
      return;
    }
    if (type === 'TEXT' || type === 'MTEXT') {
      this.entityCount += 1;
      if (this.objects >= this.objectCap) return;
      this.objects += 1;
      const p = { x: this.num.get(10) ?? 0, y: this.num.get(20) ?? 0, z: this.num.get(30) ?? 0 };
      this.entities.push({
        id: `e${this.id++}`,
        type: 'text',
        layer,
        color: this.color(),
        p,
        height: this.num.get(40) ?? 1,
        rotation: ((this.num.get(50) ?? 0) * Math.PI) / 180,
        content: this.str.get(1) ?? '',
      });
      this.note(p.x, p.y);
      return;
    }
    if (type === 'INSERT') {
      this.entityCount += 1;
      if (this.objects >= this.objectCap) return;
      this.objects += 1;
      const p = { x: this.num.get(10) ?? 0, y: this.num.get(20) ?? 0, z: this.num.get(30) ?? 0 };
      this.entities.push({
        id: `e${this.id++}`,
        type: 'block',
        layer,
        color: this.color(),
        name: this.str.get(2) || 'BLOCK',
        p,
        rotation: ((this.num.get(50) ?? 0) * Math.PI) / 180,
        scale: this.num.get(41) || 1,
      });
      this.note(p.x, p.y);
    }
  }

  private flushPoly(): void {
    const poly = this.poly;
    this.poly = null;
    if (!poly) return;
    this.layers.add(poly.layer);
    this.entityCount += 1;
    this.addChain(poly.verts, (poly.flags & 1) === 1);
  }

  private addChain(verts: { x: number; y: number }[], closed: boolean): void {
    for (let index = 1; index < verts.length; index += 1) {
      const a = verts[index - 1];
      const b = verts[index];
      if (!this.addSeg(a.x, a.y, b.x, b.y)) return;
    }
    if (closed && verts.length > 2) {
      const first = verts[0];
      const last = verts[verts.length - 1];
      this.addSeg(last.x, last.y, first.x, first.y);
    }
  }

  private tessellate(arc: boolean): void {
    const cx = this.num.get(10) ?? 0;
    const cy = this.num.get(20) ?? 0;
    const radius = this.num.get(40) ?? 0;
    const start = arc ? ((this.num.get(50) ?? 0) * Math.PI) / 180 : 0;
    const end = arc ? ((this.num.get(51) ?? 0) * Math.PI) / 180 : Math.PI * 2;
    const sweep = arc ? end - start : Math.PI * 2;
    const steps = 16;
    let previousX = cx + Math.cos(start) * radius;
    let previousY = cy + Math.sin(start) * radius;
    for (let step = 1; step <= steps; step += 1) {
      const angle = start + (sweep * step) / steps;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      if (!this.addSeg(previousX, previousY, x, y)) return;
      previousX = x;
      previousY = y;
    }
  }

  private addSeg(x1: number, y1: number, x2: number, y2: number): boolean {
    if (this.truncated) return false;
    if (this.segCount >= this.maxSegments) {
      this.truncated = true;
      return false;
    }
    if ((this.segCount + 1) * 4 > this.segs.length) {
      const next = allocate(Math.min(this.maxSegments * 4, Math.max(this.segs.length * 2, (this.segCount + 1) * 4)), this.segs.length);
      next.set(this.segs);
      this.segs = next;
    }
    const offset = this.segCount * 4;
    this.segs[offset] = x1;
    this.segs[offset + 1] = y1;
    this.segs[offset + 2] = x2;
    this.segs[offset + 3] = y2;
    this.segCount += 1;
    this.note(x1, y1);
    this.note(x2, y2);
    return true;
  }

  private addPt(x: number, y: number): void {
    if (this.truncated) return;
    if ((this.ptCount + 1) * 2 > this.pts.length) {
      const next = allocate(Math.max(this.pts.length * 2, (this.ptCount + 1) * 2), this.pts.length);
      next.set(this.pts);
      this.pts = next;
    }
    this.pts[this.ptCount * 2] = x;
    this.pts[this.ptCount * 2 + 1] = y;
    this.ptCount += 1;
    this.note(x, y);
  }

  private note(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < this.minX) this.minX = x;
    if (y < this.minY) this.minY = y;
    if (x > this.maxX) this.maxX = x;
    if (y > this.maxY) this.maxY = y;
  }
}

function allocate(length: number, fallback: number): Float64Array {
  try {
    return new Float64Array(length);
  } catch {
    return new Float64Array(fallback);
  }
}

export function createDxfStream(byteLength = 0, maxSegments = DXF_MAX_SEGMENTS): DxfStream {
  return new DxfStream(byteLength, maxSegments);
}

/** Read an ASCII DXF from successive slices. Used for desktop part reads and file streams. */
export async function parseDxfParts(byteLength: number, read: (offset: number, length: number) => Promise<Uint8Array>, maxSegments = DXF_MAX_SEGMENTS): Promise<DxfModel> {
  const stream = createDxfStream(byteLength, maxSegments);
  const chunk = 8 * 1024 * 1024;
  let offset = 0;
  const total = byteLength > 0 ? byteLength : Number.POSITIVE_INFINITY;
  while (offset < total) {
    const length = byteLength > 0 ? Math.min(chunk, byteLength - offset) : chunk;
    const part = await read(offset, length);
    if (part.byteLength === 0) break;
    stream.push(part);
    offset += part.byteLength;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return stream.finish();
}

/** Stream a File so a large DXF is not copied into one string. */
export async function parseDxfFile(file: File): Promise<DxfModel> {
  const stream = createDxfStream(file.size);
  const reader = file.stream().getReader();
  let pending = 0;
  const yieldEvery = 4 * 1024 * 1024;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      stream.push(next.value);
      pending += next.value.byteLength;
      if (pending >= yieldEvery) {
        pending = 0;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  } finally {
    reader.releaseLock();
  }
  return stream.finish();
}
