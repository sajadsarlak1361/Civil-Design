import { aciHex } from '../aci';
import type { DrawEntity, LayerRec, Vec3 } from '../drafting';
import { normalizeLayer } from '../layers';

export interface DwgXrefImport {
  name: string;
  path: string;
  overlay: boolean;
  referenced: boolean;
  insertion: Vec3;
  scale: { x: number; y: number; z: number };
  rotation: number;
  entities: DrawEntity[];
  layers: { name: string; color: string; visible: boolean; locked: boolean; lineType: string }[];
}

export interface DwgImport {
  version: string;
  entities: DrawEntity[];
  layers: LayerRec[];
  xrefs: DwgXrefImport[];
  notes: string[];
}

interface Point {
  x?: number;
  y?: number;
  z?: number;
}

interface Ent {
  type?: string;
  layer?: string;
  colorIndex?: number;
  color?: number;
  lineType?: string;
  lineweight?: number;
  lineTypeScale?: number;
  isInPaperSpace?: boolean;
  startPoint?: Point;
  endPoint?: Point;
  center?: Point;
  position?: Point;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  text?: string;
  textHeight?: number;
  rotation?: number;
  insertionPoint?: Point;
  direction?: Point;
  elevation?: number;
  flag?: number;
  vertices?: { x?: number; y?: number; z?: number; bulge?: number; startWidth?: number; endWidth?: number }[];
  corner1?: Point;
  corner2?: Point;
  corner3?: Point;
  corner4?: Point;
  name?: string;
  xScale?: number;
  yScale?: number;
  zScale?: number;
}

interface BlockRec {
  name?: string;
  flags?: number;
  basePoint?: Point;
  entities?: Ent[];
}

interface LayerRecIn {
  name?: string;
  colorIndex?: number;
  color?: number;
  lineType?: string;
  lineweight?: number;
  frozen?: boolean;
  locked?: boolean;
  off?: boolean;
}

export interface DwgDatabaseLike {
  entities?: Ent[];
  tables?: {
    LAYER?: { entries?: LayerRecIn[] };
    BLOCK_RECORD?: { entries?: BlockRec[] };
  };
}

function pt(point: Point | undefined, z = 0): Vec3 {
  return { x: Number(point?.x) || 0, y: Number(point?.y) || 0, z: Number(point?.z ?? z) || 0 };
}

function radians(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 0;
  const raw = value as number;
  if (Math.abs(raw) > Math.PI * 2 + 1e-6) return (raw * Math.PI) / 180;
  return raw;
}

function trueColor(color: number): string {
  const b = color & 255;
  const g = (color >> 8) & 255;
  const r = (color >> 16) & 255;
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function entityColor(entity: Ent): string {
  if (typeof entity.color === 'number' && entity.color > 0 && (entity.colorIndex === undefined || entity.colorIndex === 256)) return trueColor(entity.color);
  const index = entity.colorIndex;
  if (index === undefined || index === 256 || index === 0 || index < 0) return 'bylayer';
  return aciHex(index);
}

function styleOf(entity: Ent): Pick<DrawEntity, 'linetype' | 'lineweight' | 'linetypeScale' | 'colorIndex'> {
  const style: Pick<DrawEntity, 'linetype' | 'lineweight' | 'linetypeScale' | 'colorIndex'> = {};
  if (entity.lineType) style.linetype = entity.lineType;
  if (typeof entity.lineweight === 'number' && Number.isFinite(entity.lineweight)) style.lineweight = entity.lineweight;
  if (typeof entity.lineTypeScale === 'number' && Number.isFinite(entity.lineTypeScale)) style.linetypeScale = entity.lineTypeScale;
  if (typeof entity.colorIndex === 'number' && Number.isFinite(entity.colorIndex)) style.colorIndex = entity.colorIndex;
  return style;
}

function layerOf(name: string | undefined): string {
  return name && name.trim() ? name : '0';
}

let seq = 1;
function nextId(): string {
  seq += 1;
  return `dwg-${seq.toString(36)}`;
}

function mapPrimitive(entity: Ent): DrawEntity[] {
  if (entity.isInPaperSpace) return [];
  const layer = layerOf(entity.layer);
  const color = entityColor(entity);
  const style = styleOf(entity);
  const type = entity.type;
  if (type === 'LINE') {
    return [{ id: nextId(), type: 'line', layer, color, ...style, a: pt(entity.startPoint), b: pt(entity.endPoint) }];
  }
  if (type === 'POINT') {
    return [{ id: nextId(), type: 'point', layer, color, ...style, p: pt(entity.position) }];
  }
  if (type === 'CIRCLE') {
    return [{ id: nextId(), type: 'circle', layer, color, ...style, center: pt(entity.center), radius: Number(entity.radius) || 0 }];
  }
  if (type === 'ARC') {
    return [{
      id: nextId(),
      type: 'arc',
      layer,
      color,
      ...style,
      center: pt(entity.center),
      radius: Number(entity.radius) || 0,
      startAngle: radians(entity.startAngle),
      endAngle: radians(entity.endAngle),
    }];
  }
  if (type === 'TEXT') {
    return [{
      id: nextId(),
      type: 'text',
      layer,
      color,
      ...style,
      p: pt(entity.startPoint),
      height: Number(entity.textHeight) || 1,
      rotation: radians(entity.rotation),
      content: entity.text ?? '',
    }];
  }
  if (type === 'MTEXT') {
    const direction = entity.direction;
    const rotation = Number.isFinite(entity.rotation ?? NaN)
      ? radians(entity.rotation)
      : direction
        ? Math.atan2(Number(direction.y) || 0, Number(direction.x) || 1)
        : 0;
    return [{
      id: nextId(),
      type: 'text',
      layer,
      color,
      ...style,
      p: pt(entity.insertionPoint),
      height: Number(entity.textHeight) || 1,
      rotation,
      content: (entity.text ?? '').replace(/\\P/g, '\n'),
    }];
  }
  if (type === 'LWPOLYLINE' || type === 'POLYLINE2D' || type === 'POLYLINE3D') {
    const elevation = Number(entity.elevation) || 0;
    const closed = ((entity.flag ?? 0) & 1) === 1;
    return [{
      id: nextId(),
      type: 'polyline',
      layer,
      color,
      ...style,
      closed,
      poly3d: type === 'POLYLINE3D',
      vertices: (entity.vertices ?? []).map((vertex) => ({
        x: Number(vertex.x) || 0,
        y: Number(vertex.y) || 0,
        z: type === 'LWPOLYLINE' ? elevation : Number(vertex.z) || elevation,
        bulge: Number(vertex.bulge) || 0,
        startWidth: vertex.startWidth,
        endWidth: vertex.endWidth,
      })),
    }];
  }
  if (type === '3DFACE') {
    const corners = [pt(entity.corner1), pt(entity.corner2), pt(entity.corner3), pt(entity.corner4 ?? entity.corner3)];
    const edges: DrawEntity[] = [];
    for (let index = 0; index < 4; index += 1) {
      const a = corners[index];
      const b = corners[(index + 1) % 4];
      if (a.x === b.x && a.y === b.y && a.z === b.z) continue;
      edges.push({ id: nextId(), type: 'line', layer, color, ...style, a, b });
    }
    return edges;
  }
  return [];
}

function isModelBlock(name: string): boolean {
  const key = name.toLowerCase();
  return key === '*model_space' || key.startsWith('*paper_space');
}

function isXref(flags: number): boolean {
  return (flags & 4) === 4 || (flags & 8) === 8;
}

interface Insert {
  name: string;
  entity: DrawEntity & { type: 'block' };
  x: number;
  y: number;
  z: number;
  xScale: number;
  yScale: number;
  zScale: number;
  rotation: number;
}

function asInsert(entity: Ent): Insert | null {
  if (entity.type !== 'INSERT' || entity.isInPaperSpace) return null;
  const layer = layerOf(entity.layer);
  const insertion = pt(entity.insertionPoint);
  const xScale = Number(entity.xScale) || 1;
  const yScale = Number(entity.yScale) || 1;
  const zScale = Number(entity.zScale) || 1;
  const rotation = radians(entity.rotation);
  return {
    name: entity.name || 'BLOCK',
    x: insertion.x,
    y: insertion.y,
    z: insertion.z,
    xScale,
    yScale,
    zScale,
    rotation,
    entity: {
      id: nextId(),
      type: 'block',
      layer,
      color: entityColor(entity),
      ...styleOf(entity),
      name: entity.name || 'BLOCK',
      p: insertion,
      rotation,
      scale: xScale,
      xref: false,
    },
  };
}

function placePoint(point: Vec3, insert: Insert, base: Vec3): Vec3 {
  const sx = (point.x - base.x) * insert.xScale;
  const sy = (point.y - base.y) * insert.yScale;
  const sz = (point.z - base.z) * insert.zScale;
  const c = Math.cos(insert.rotation);
  const s = Math.sin(insert.rotation);
  return { x: sx * c - sy * s + insert.x, y: sx * s + sy * c + insert.y, z: sz + insert.z };
}

function explode(entities: DrawEntity[], insert: Insert, base: Vec3): DrawEntity[] {
  const flip = insert.xScale * insert.yScale < 0;
  const out: DrawEntity[] = [];
  for (const entity of entities) {
    if (entity.type === 'point' || entity.type === 'text' || entity.type === 'block') {
      const next = { ...entity, id: nextId(), p: placePoint(entity.p, insert, base) };
      if (next.type === 'text') next.rotation += insert.rotation;
      if (next.type === 'text') next.height *= Math.abs(insert.yScale) || 1;
      out.push(next);
    } else if (entity.type === 'line') {
      out.push({ ...entity, id: nextId(), a: placePoint(entity.a, insert, base), b: placePoint(entity.b, insert, base) });
    } else if (entity.type === 'polyline') {
      out.push({
        ...entity,
        id: nextId(),
        vertices: entity.vertices.map((vertex) => {
          const moved = placePoint(vertex, insert, base);
          return { ...vertex, ...moved, bulge: flip ? -vertex.bulge : vertex.bulge };
        }),
      });
    } else if (entity.type === 'circle' || entity.type === 'arc') {
      const scale = Math.max(Math.abs(insert.xScale), Math.abs(insert.yScale)) || 1;
      const next = { ...entity, id: nextId(), center: placePoint(entity.center, insert, base), radius: entity.radius * scale };
      if (next.type === 'arc') {
        next.startAngle += insert.rotation;
        next.endAngle += insert.rotation;
      }
      out.push(next);
    }
  }
  return out;
}

function layerRecords(entries: LayerRecIn[] | undefined): LayerRec[] {
  return (entries ?? []).filter((entry) => entry.name).map((entry) => {
    const index = entry.colorIndex && entry.colorIndex > 0 && entry.colorIndex < 256 ? entry.colorIndex : 7;
    return normalizeLayer({
      name: entry.name as string,
      color: entry.color && entry.color > 0 ? trueColor(entry.color) : aciHex(index),
      colorIndex: index,
      visible: !entry.off,
      frozen: Boolean(entry.frozen),
      locked: Boolean(entry.locked),
      lineType: entry.lineType || 'Continuous',
      lineWeight: entry.lineweight,
    });
  });
}

export function mapDwgDatabase(db: DwgDatabaseLike, version = ''): DwgImport {
  const notes: string[] = [];
  const layers = layerRecords(db.tables?.LAYER?.entries);
  const blocks = new Map<string, BlockRec>();
  for (const block of db.tables?.BLOCK_RECORD?.entries ?? []) {
    if (block.name) blocks.set(block.name.toLowerCase(), block);
  }
  const entities: DrawEntity[] = [];
  const xrefs: DwgXrefImport[] = [];
  const used = new Set<string>();
  let skipped = 0;
  const consider = (entity: Ent, into: DrawEntity[], inserts: Insert[]) => {
    const insert = asInsert(entity);
    if (insert) {
      inserts.push(insert);
      return;
    }
    const mapped = mapPrimitive(entity);
    if (mapped.length === 0 && entity.type && !entity.isInPaperSpace) skipped += 1;
    into.push(...mapped);
  };
  const modelInserts: Insert[] = [];
  for (const entity of db.entities ?? []) consider(entity, entities, modelInserts);
  for (const insert of modelInserts) {
    const block = blocks.get(insert.name.toLowerCase());
    const flags = block?.flags ?? 0;
    const xref = isXref(flags);
    insert.entity.xref = xref;
    entities.push(insert.entity);
    if (!block || isModelBlock(block.name || '')) continue;
    used.add(insert.name.toLowerCase());
    const nested: DrawEntity[] = [];
    const nestedInserts: Insert[] = [];
    for (const child of block.entities ?? []) consider(child, nested, nestedInserts);
    const base = pt(block.basePoint);
    const placed = explode(nested, insert, base);
    if (xref) {
      const overlay = (flags & 8) === 8;
      xrefs.push({
        name: insert.name,
        path: insert.name,
        overlay,
        referenced: true,
        insertion: { x: insert.x, y: insert.y, z: insert.z },
        scale: { x: insert.xScale, y: insert.yScale, z: insert.zScale },
        rotation: insert.rotation,
        entities: placed,
        layers: layers
          .filter((layer) => placed.some((entity) => entity.layer === layer.name))
          .map((layer) => ({ name: layer.name, color: layer.color, visible: layer.visible, locked: layer.locked, lineType: layer.lineType })),
      });
    } else {
      entities.push(...placed);
    }
  }
  for (const block of blocks.values()) {
    const name = block.name || '';
    if (!name || isModelBlock(name) || !isXref(block.flags ?? 0) || used.has(name.toLowerCase())) continue;
    const nested: DrawEntity[] = [];
    for (const child of block.entities ?? []) nested.push(...mapPrimitive(child));
    xrefs.push({
      name,
      path: name,
      overlay: ((block.flags ?? 0) & 8) === 8,
      referenced: false,
      insertion: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: 0,
      entities: nested,
      layers: [],
    });
  }
  if (skipped > 0) notes.push(`${skipped} DWG ${skipped === 1 ? 'entity was' : 'entities were'} left out (not a line, polyline, arc, circle, text, point, 3DFACE, or block).`);
  if (version) notes.push(`LibreDWG read ${version}.`);
  return { version, entities, layers, xrefs, notes };
}
