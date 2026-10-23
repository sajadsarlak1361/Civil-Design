import { defaultLibrary, parseLibrary, type CadLibrary } from './cadLibrary';
import type { CadShape } from './cadShapes';
import { cadEntityPath, cadGrips, describeCad, hitCad, mapCadEntity, parseCadEntity, syncHatches } from './entityOps';
import { syncDimensions } from './dimension';
import { isCadShape } from './cadShapes';
import { boundsOf, dist, orient, polygonArea, type Bounds, type Vec2 } from './geometry';
import { resolvePaint } from './aci';
import { copyStyle } from './entityStyle';
import { ensureStandardLayers, normalizeLayer, shouldDraw, type LayerFilter, type LayerRec, type LayerState, type ViewportRec } from './layers';
import type { EntityStyle } from './entityStyle';
import type { ModelObject } from './objects';

export type { EntityStyle, LayerFilter, LayerRec, LayerState, ModelObject, ViewportRec };

/** Easting / northing / elevation. Plan math uses x and y; z is carried through. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PolyVertex {
  x: number;
  y: number;
  z: number;
  /** Tangent of one-quarter of the signed sweep to the next vertex. 0 is a line. */
  bulge: number;
  startWidth?: number;
  endWidth?: number;
}

export interface DrawPoint extends EntityStyle {
  id: string;
  type: 'point';
  layer: string;
  color: string;
  lineType?: string;
  lineWeight?: number | 'bylayer';
  p: Vec3;
}

export interface DrawLine extends EntityStyle {
  id: string;
  type: 'line';
  layer: string;
  color: string;
  lineType?: string;
  lineWeight?: number | 'bylayer';
  a: Vec3;
  b: Vec3;
}

export interface DrawPolyline extends EntityStyle {
  id: string;
  type: 'polyline';
  layer: string;
  color: string;
  lineType?: string;
  lineWeight?: number | 'bylayer';
  vertices: PolyVertex[];
  closed: boolean;
  /** Constant width, drawing units. 0 is a hairline. */
  width?: number;
  globalWidth?: number;
  elevation?: number;
  thickness?: number;
  /** Continue the linetype along the polyline. Off restarts the pattern at each vertex. */
  linetypeGeneration?: boolean;
  /** 3D polyline: vertex Z, no widths. */
  poly3d?: boolean;
}

export interface DrawCircle extends EntityStyle {
  id: string;
  type: 'circle';
  layer: string;
  color: string;
  lineType?: string;
  lineWeight?: number | 'bylayer';
  center: Vec3;
  radius: number;
}

export interface DrawArc extends EntityStyle {
  id: string;
  type: 'arc';
  layer: string;
  color: string;
  lineType?: string;
  lineWeight?: number | 'bylayer';
  center: Vec3;
  radius: number;
  /** Radians, atan2. */
  startAngle: number;
  /** Radians. Sweep is endAngle − startAngle (negative is clockwise). */
  endAngle: number;
}

export interface DrawText extends EntityStyle {
  id: string;
  type: 'text';
  layer: string;
  color: string;
  lineType?: string;
  lineWeight?: number | 'bylayer';
  p: Vec3;
  height: number;
  rotation: number;
  content: string;
  style?: string;
}

export interface DrawBlock extends EntityStyle {
  id: string;
  type: 'block';
  layer: string;
  color: string;
  name: string;
  p: Vec3;
  rotation: number;
  scale: number;
  xref?: boolean;
}

export type DrawEntity = DrawPoint | DrawLine | DrawPolyline | DrawCircle | DrawArc | DrawText | DrawBlock | CadShape;

/** Segments and points from a large DXF, kept packed so the drawing can open. */
export interface BulkGeometry {
  /** x1, y1, x2, y2 per segment. */
  segments: Float64Array;
  /** x, y per point. */
  points: Float64Array;
  segmentCount: number;
  pointCount: number;
  /** Source entities, including any circles and text also listed in `entities`. */
  entityCount: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  truncated: boolean;
}

export interface DrawingDoc {
  layers: LayerRec[];
  currentLayer: string;
  currentColor: string;
  /** ACI index when the current color was chosen from the index, not a true color. */
  currentColorIndex?: number;
  linetypeScale: number;
  entities: DrawEntity[];
  /** Packed geometry for a large DXF. Individual rows are not separate entities. */
  bulk?: BulkGeometry;
  selection: string[];
  /** Blocks, groups, styles, and annotation scale. Absent only before parse fills it. */
  library?: CadLibrary;
  /** Civil and other non-geometry records: color and lock, keyed for undo. */
  objects: ModelObject[];
  filters: LayerFilter[];
  states: LayerState[];
  viewports: ViewportRec[];
}

export interface DrawingFile {
  layers: LayerRec[];
  currentLayer: string;
  currentColor: string;
  currentColorIndex?: number;
  linetypeScale: number;
  entities: DrawEntity[];
  library?: CadLibrary;
  objects?: ModelObject[];
  filters?: LayerFilter[];
  states?: LayerState[];
  viewports?: ViewportRec[];
}

export function v3(x: number, y: number, z = 0): Vec3 {
  return { x, y, z };
}

export function xy(p: Vec3): Vec2 {
  return { x: p.x, y: p.y };
}

export function fmt(n: number, digits = 3): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

let historyHooks: { note: () => void; drop: () => void; clear: () => void } | null = null;

/** Armed by the command line so drawing checkpoints share Ctrl+Z with surface edits. */
export function bindDrawingHistory(next: { note: () => void; drop: () => void; clear: () => void } | null): void {
  historyHooks = next;
}

export function emptyDrawing(): DrawingDoc {
  return {
    layers: ensureStandardLayers([]),
    currentLayer: '0',
    currentColor: 'bylayer',
    linetypeScale: 1,
    entities: [],
    selection: [],
    library: defaultLibrary(),
    objects: [],
    filters: [],
    states: [],
    viewports: [],
  };
}

interface DrawingSnap {
  layers: DrawingDoc['layers'];
  currentLayer: string;
  currentColor: string;
  linetypeScale: number;
  entities: DrawEntity[];
  bulk?: BulkGeometry;
  selection: string[];
  objects: DrawingDoc['objects'];
  filters: DrawingDoc['filters'];
  states: DrawingDoc['states'];
  viewports: DrawingDoc['viewports'];
}

export class DrawingModel {
  doc: DrawingDoc;
  /** Structural snapshots. Entity arrays are shared until the next edit, so undo does not clone the drawing. */
  private past: DrawingSnap[] = [];
  private pastLabels: string[] = [];
  private future: DrawingSnap[] = [];
  private futureLabels: string[] = [];
  private pinned = new Set<DrawEntity[]>();
  private seq = 1;
  private listeners = new Set<() => void>();
  version = 0;

  constructor(doc?: DrawingDoc) {
    this.doc = doc ? structuredClone(doc) : emptyDrawing();
    if (!this.doc.library) this.doc.library = defaultLibrary();
    this.reseed();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(): void {
    this.version += 1;
    if (this.doc.library) {
      syncDimensions(this.doc);
      syncHatches(this.doc);
    }
    for (const listener of this.listeners) listener();
  }

  private reseed(): void {
    for (const entity of this.doc.entities) {
      const n = Number(entity.id.replace(/\D/g, ''));
      if (Number.isFinite(n) && n >= this.seq) this.seq = n + 1;
    }
  }

  nextId(): string {
    const id = `e${this.seq}`;
    this.seq += 1;
    return id;
  }

  private capture(): DrawingSnap {
    this.pinned.add(this.doc.entities);
    return {
      layers: this.doc.layers.map((layer) => ({ ...layer })),
      currentLayer: this.doc.currentLayer,
      currentColor: this.doc.currentColor,
      linetypeScale: this.doc.linetypeScale,
      entities: this.doc.entities,
      bulk: this.doc.bulk,
      selection: this.doc.selection.slice(),
      objects: structuredClone(this.doc.objects),
      filters: structuredClone(this.doc.filters),
      states: structuredClone(this.doc.states),
      viewports: structuredClone(this.doc.viewports),
    };
  }

  private install(snap: DrawingSnap): void {
    this.pinned.add(snap.entities);
    this.doc = {
      layers: snap.layers.map((layer) => ({ ...layer })),
      currentLayer: snap.currentLayer,
      currentColor: snap.currentColor,
      linetypeScale: snap.linetypeScale,
      entities: snap.entities,
      bulk: snap.bulk,
      selection: snap.selection.slice(),
      objects: structuredClone(snap.objects),
      filters: structuredClone(snap.filters),
      states: structuredClone(snap.states),
      viewports: structuredClone(snap.viewports),
    };
    this.reseed();
    this.emit();
  }

  private detachEntities(): void {
    if (!this.pinned.has(this.doc.entities)) return;
    this.doc.entities = this.doc.entities.slice();
  }

  checkpoint(label = 'Command'): void {
    this.past.push(this.capture());
    this.pastLabels.push(label);
    if (this.past.length > 100) {
      const dropped = this.past.shift();
      if (dropped) this.pinned.delete(dropped.entities);
      this.pastLabels.shift();
    }
    this.future = [];
    this.futureLabels = [];
    historyHooks?.note();
  }

  /** Command name that Undo would reverse, such as OFFSET. */
  undoLabel(): string | null {
    return this.pastLabels[this.pastLabels.length - 1] ?? null;
  }

  redoLabel(): string | null {
    return this.futureLabels[this.futureLabels.length - 1] ?? null;
  }

  /** Newest checkpoint first. */
  undoHistory(): string[] {
    return [...this.pastLabels].reverse();
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(): boolean {
    const prev = this.past.pop();
    const label = this.pastLabels.pop();
    if (!prev) return false;
    this.future.push(this.capture());
    this.futureLabels.push(label ?? 'Command');
    this.install(prev);
    return true;
  }

  /** Drop the latest checkpoint and restore it, without creating a redo entry. */
  revert(): boolean {
    const prev = this.past.pop();
    this.pastLabels.pop();
    if (!prev) return false;
    this.pinned.delete(prev.entities);
    this.install(prev);
    historyHooks?.drop();
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    const label = this.futureLabels.pop();
    if (!next) return false;
    this.past.push(this.capture());
    this.pastLabels.push(label ?? 'Command');
    this.install(next);
    return true;
  }

  load(doc: DrawingDoc): void {
    this.doc = structuredClone(doc);
    if (!this.doc.library) this.doc.library = defaultLibrary();
    this.past = [];
    this.pastLabels = [];
    this.future = [];
    this.futureLabels = [];
    this.pinned.clear();
    this.reseed();
    this.emit();
    historyHooks?.clear();
  }

  layer(name: string): LayerRec | undefined {
    return this.doc.layers.find((item) => item.name.toLowerCase() === name.toLowerCase());
  }

  entity(id: string): DrawEntity | undefined {
    return this.doc.entities.find((item) => item.id === id);
  }

  add(entity: DrawEntity): void {
    this.detachEntities();
    this.doc.entities.push(entity);
    const n = Number(entity.id.replace(/\D/g, ''));
    if (Number.isFinite(n) && n >= this.seq) this.seq = n + 1;
  }

  remove(ids: string[]): void {
    const drop = new Set(ids);
    this.doc.entities = this.doc.entities.filter((entity) => !drop.has(entity.id));
    this.doc.selection = this.doc.selection.filter((id) => !drop.has(id));
  }

  replace(entity: DrawEntity): void {
    this.detachEntities();
    const index = this.doc.entities.findIndex((item) => item.id === entity.id);
    if (index >= 0) this.doc.entities[index] = entity;
  }

  toFile(): DrawingFile {
    return {
      layers: structuredClone(this.doc.layers),
      currentLayer: this.doc.currentLayer,
      currentColor: this.doc.currentColor,
      ...(this.doc.currentColorIndex ? { currentColorIndex: this.doc.currentColorIndex } : {}),
      linetypeScale: this.doc.linetypeScale,
      entities: structuredClone(this.doc.entities),
      library: structuredClone(this.doc.library ?? defaultLibrary()),
      objects: structuredClone(this.doc.objects ?? []),
      filters: structuredClone(this.doc.filters ?? []),
      states: structuredClone(this.doc.states ?? []),
      viewports: structuredClone(this.doc.viewports ?? []),
    };
  }
}

function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function asVec3(value: unknown): Vec3 | null {
  if (!value || typeof value !== 'object') return null;
  const point = value as Vec3;
  if (!isNum(point.x) || !isNum(point.y)) return null;
  return { x: point.x, y: point.y, z: isNum(point.z) ? point.z : 0 };
}

export function parseDrawing(value: unknown): DrawingFile {
  const empty = emptyDrawing();
  const file: DrawingFile = {
    layers: empty.layers,
    currentLayer: '0',
    currentColor: 'bylayer',
    linetypeScale: 1,
    entities: [],
    library: defaultLibrary(),
    objects: [],
    filters: [],
    states: [],
    viewports: [],
  };
  if (!value || typeof value !== 'object') return file;
  const raw = value as Partial<DrawingFile> & { objects?: ModelObject[]; filters?: LayerFilter[]; states?: LayerState[]; viewports?: ViewportRec[] };
  if (Array.isArray(raw.layers)) {
    const layers: LayerRec[] = [];
    for (const item of raw.layers) {
      if (!item || typeof item !== 'object') continue;
      const layer = item as Partial<LayerRec>;
      if (typeof layer.name !== 'string' || !layer.name.trim()) continue;
      layers.push(normalizeLayer({ ...layer, name: layer.name }));
    }
    file.layers = ensureStandardLayers(layers);
  }
  if (Array.isArray(raw.objects)) file.objects = raw.objects.filter((object) => object && typeof object.key === 'string' && typeof object.kind === 'string');
  if (Array.isArray(raw.filters)) file.filters = raw.filters.filter((filter) => filter && typeof filter.id === 'string');
  if (Array.isArray(raw.states)) file.states = raw.states.filter((state) => state && typeof state.name === 'string');
  if (Array.isArray(raw.viewports)) file.viewports = raw.viewports.filter((viewport) => viewport && typeof viewport.id === 'string');
  file.currentLayer = typeof raw.currentLayer === 'string' ? raw.currentLayer : '0';
  file.currentColor = typeof raw.currentColor === 'string' ? raw.currentColor : 'bylayer';
  if (isNum(raw.currentColorIndex) && raw.currentColorIndex >= 1 && raw.currentColorIndex <= 255) file.currentColorIndex = raw.currentColorIndex;
  file.linetypeScale = isNum(raw.linetypeScale) && raw.linetypeScale > 0 ? raw.linetypeScale : 1;
  file.library = parseLibrary((raw as { library?: unknown }).library);
  if (!Array.isArray(raw.entities)) return file;
  for (const item of raw.entities) {
    const entity = parseEntity(item);
    if (entity) file.entities.push(entity);
  }
  return file;
}

function readStyle(raw: object): { lineType?: string; lineWeight?: number | 'bylayer' } {
  const source = raw as { lineType?: unknown; lineWeight?: unknown };
  const style: { lineType?: string; lineWeight?: number | 'bylayer' } = {};
  if (typeof source.lineType === 'string') style.lineType = source.lineType;
  if (typeof source.lineWeight === 'number' || source.lineWeight === 'bylayer') style.lineWeight = source.lineWeight;
  return style;
}

/** Parse a stored entity, including lines and polylines kept inside a block definition. */
export function parseStoredEntity(value: unknown): DrawEntity | null {
  return parseEntity(value);
}

function parseEntity(value: unknown): DrawEntity | null {
  if (!value || typeof value !== 'object') return null;
  const cad = parseCadEntity(value);
  if (cad) return cad;
  const raw = value as DrawEntity;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  const layer = typeof raw.layer === 'string' ? raw.layer : '0';
  const color = typeof raw.color === 'string' ? raw.color : 'bylayer';
  const style = { ...readStyle(raw), ...copyStyle(raw) };
  if (raw.type === 'point') {
    const p = asVec3(raw.p);
    return p ? { id: raw.id, type: 'point', layer, color, p, ...style } : null;
  }
  if (raw.type === 'line') {
    const a = asVec3(raw.a);
    const b = asVec3(raw.b);
    return a && b ? { id: raw.id, type: 'line', layer, color, a, b, ...style } : null;
  }
  if (raw.type === 'circle') {
    const center = asVec3(raw.center);
    return center && isNum(raw.radius) && raw.radius > 0
      ? { id: raw.id, type: 'circle', layer, color, center, radius: raw.radius, ...style }
      : null;
  }
  if (raw.type === 'arc') {
    const center = asVec3(raw.center);
    return center && isNum(raw.radius) && raw.radius > 0 && isNum(raw.startAngle) && isNum(raw.endAngle)
      ? { id: raw.id, type: 'arc', layer, color, center, radius: raw.radius, startAngle: raw.startAngle, endAngle: raw.endAngle, ...style }
      : null;
  }
  if (raw.type === 'text') {
    const p = asVec3(raw.p);
    return p && typeof raw.content === 'string'
      ? {
          id: raw.id,
          type: 'text',
          layer,
          color,
          p,
          height: isNum(raw.height) && raw.height > 0 ? raw.height : 2.5,
          rotation: isNum(raw.rotation) ? raw.rotation : 0,
          content: raw.content,
          ...style,
        }
      : null;
  }
  if (raw.type === 'block') {
    const p = asVec3(raw.p);
    return p && typeof raw.name === 'string'
      ? { id: raw.id, type: 'block', layer, color, name: raw.name, p, rotation: isNum(raw.rotation) ? raw.rotation : 0, scale: isNum(raw.scale) && raw.scale !== 0 ? raw.scale : 1, xref: Boolean(raw.xref), ...style }
      : null;
  }
  const legacy = value as { type?: unknown; id?: unknown; a?: unknown; b?: unknown; text?: unknown };
  if (legacy.type === 'dimension' && 'a' in (value as object) && !('p1' in (value as object))) {
    const a = asVec3(legacy.a);
    const b = asVec3(legacy.b);
    if (!a || !b || typeof legacy.id !== 'string') return null;
    const measurement = Math.hypot(b.x - a.x, b.y - a.y);
    return {
      id: legacy.id,
      type: 'dimension',
      layer,
      color,
      ...style,
      kind: 'aligned',
      style: 'Standard',
      p1: a,
      p2: b,
      p3: a,
      loc: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: a.z },
      text: typeof legacy.text === 'string' ? legacy.text : '',
      textAngle: 0,
      oblique: 0,
      measurement,
      horizontal: true,
      jog: false,
      inspection: null,
      breaks: [],
      overrides: {},
      assoc: [],
      offset: 0,
      justify: 'center',
      civil: '',
      textShift: null,
    };
  }
  if (raw.type === 'polyline' && Array.isArray(raw.vertices)) {
    const vertices: PolyVertex[] = [];
    for (const vertex of raw.vertices) {
      const point = asVec3(vertex);
      if (!point) return null;
      const source = vertex as PolyVertex;
      const bulge = vertex && typeof vertex === 'object' && isNum(source.bulge) ? source.bulge : 0;
      vertices.push({
        ...point,
        bulge,
        startWidth: isNum(source.startWidth) ? source.startWidth : undefined,
        endWidth: isNum(source.endWidth) ? source.endWidth : undefined,
      });
    }
    if (vertices.length < 2) return null;
    const width = isNum(raw.width) ? raw.width : isNum(raw.globalWidth) ? raw.globalWidth : undefined;
    return {
      id: raw.id,
      type: 'polyline',
      layer,
      color,
      vertices,
      closed: Boolean(raw.closed),
      width,
      globalWidth: isNum(raw.globalWidth) ? raw.globalWidth : width,
      elevation: isNum(raw.elevation) ? raw.elevation : undefined,
      thickness: isNum(raw.thickness) ? raw.thickness : undefined,
      linetypeGeneration: Boolean(raw.linetypeGeneration),
      poly3d: Boolean(raw.poly3d),
      ...style,
    };
  }
  return null;
}

export function drawingDocFromFile(file: DrawingFile): DrawingDoc {
  const copy = structuredClone(file);
  return {
    ...copy,
    layers: ensureStandardLayers(copy.layers ?? []),
    objects: copy.objects ?? [],
    filters: copy.filters ?? [],
    states: copy.states ?? [],
    viewports: copy.viewports ?? [],
    selection: [],
  };
}

export function angleOf(dx: number, dy: number): number {
  return Math.atan2(dy, dx);
}

export function wrapPi(angle: number): number {
  let value = angle;
  while (value <= -Math.PI) value += Math.PI * 2;
  while (value > Math.PI) value -= Math.PI * 2;
  return value;
}

export function arcSweep(arc: Pick<DrawArc, 'startAngle' | 'endAngle'>): number {
  return arc.endAngle - arc.startAngle;
}

export function pointOnArc(arc: DrawArc, t: number): Vec3 {
  const angle = arc.startAngle + arcSweep(arc) * t;
  return {
    x: arc.center.x + Math.cos(angle) * arc.radius,
    y: arc.center.y + Math.sin(angle) * arc.radius,
    z: arc.center.z,
  };
}

/** Arc through three points. Null when the points are colinear. */
export function arcFrom3(a: Vec3, b: Vec3, c: Vec3): { center: Vec3; radius: number; startAngle: number; endAngle: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const ux = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const uy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  const center = { x: ux, y: uy, z: a.z };
  const radius = Math.hypot(a.x - ux, a.y - uy);
  if (!(radius > 1e-9)) return null;
  const start = Math.atan2(a.y - uy, a.x - ux);
  const mid = Math.atan2(b.y - uy, b.x - ux);
  const end = Math.atan2(c.y - uy, c.x - ux);
  const ccw = (from: number, to: number) => {
    let sweep = to - from;
    while (sweep < 0) sweep += Math.PI * 2;
    while (sweep >= Math.PI * 2) sweep -= Math.PI * 2;
    return sweep;
  };
  const sweep = ccw(start, end);
  const through = ccw(start, mid);
  const signed = through <= sweep + 1e-8 ? sweep : sweep - Math.PI * 2;
  return { center, radius, startAngle: start, endAngle: start + signed };
}

export function bulgeArc(
  p1: Vec3,
  p2: Vec3,
  bulge: number,
): { center: Vec3; radius: number; startAngle: number; endAngle: number } | null {
  if (Math.abs(bulge) < 1e-12) return null;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-12) return null;
  const theta = 4 * Math.atan(bulge);
  const half = theta / 2;
  const sinHalf = Math.sin(half);
  if (Math.abs(sinHalf) < 1e-12) return null;
  const radius = Math.abs(chord / 2 / sinHalf);
  const h = Math.sqrt(Math.max(0, radius * radius - (chord / 2) * (chord / 2)));
  const side = bulge > 0 ? 1 : -1;
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  const center = { x: mx + (-dy / chord) * side * h, y: my + (dx / chord) * side * h, z: p1.z };
  const startAngle = Math.atan2(p1.y - center.y, p1.x - center.x);
  return { center, radius, startAngle, endAngle: startAngle + theta };
}

export function bulgeForTangent(p1: Vec3, p2: Vec3, tangent: number): number {
  const chord = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const delta = wrapPi(chord - tangent);
  return Math.tan(delta / 2);
}

export function segmentTangent(p1: PolyVertex, p2: PolyVertex): number {
  const arc = bulgeArc(p1, p2, p1.bulge);
  if (!arc) return Math.atan2(p2.y - p1.y, p2.x - p1.x);
  return arc.endAngle + (p1.bulge >= 0 ? Math.PI / 2 : -Math.PI / 2);
}

export function polyPoints(entity: DrawPolyline, segments = 16): Vec3[] {
  const out: Vec3[] = [];
  const count = entity.vertices.length;
  const segCount = entity.closed ? count : count - 1;
  for (let i = 0; i < segCount; i++) {
    const a = entity.vertices[i];
    const b = entity.vertices[(i + 1) % count];
    const arc = bulgeArc(a, b, a.bulge);
    if (!arc) {
      if (out.length === 0) out.push(v3(a.x, a.y, a.z));
      out.push(v3(b.x, b.y, b.z));
      continue;
    }
    const steps = Math.max(4, segments);
    for (let s = 0; s <= steps; s++) {
      if (s === 0 && out.length > 0) continue;
      const t = s / steps;
      const angle = arc.startAngle + (arc.endAngle - arc.startAngle) * t;
      out.push({
        x: arc.center.x + Math.cos(angle) * arc.radius,
        y: arc.center.y + Math.sin(angle) * arc.radius,
        z: a.z + (b.z - a.z) * t,
      });
    }
  }
  return out;
}

export function entityPath(entity: DrawEntity, segments = 24): Vec3[] {
  switch (entity.type) {
    case 'point':
    case 'text':
      return [entity.p];
    case 'line':
      return [entity.a, entity.b];
    case 'polyline':
      return polyPoints(entity, segments);
    case 'circle': {
      const pts: Vec3[] = [];
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        pts.push({
          x: entity.center.x + Math.cos(angle) * entity.radius,
          y: entity.center.y + Math.sin(angle) * entity.radius,
          z: entity.center.z,
        });
      }
      return pts;
    }
    case 'arc': {
      const pts: Vec3[] = [];
      for (let i = 0; i <= segments; i++) pts.push(pointOnArc(entity, i / segments));
      return pts;
    }
    case 'block':
      return [entity.p];
    default:
      return cadEntityPath(entity, segments) ?? [];
  }
}

export function entityBounds(entity: DrawEntity): Bounds | null {
  if (entity.type === 'xline' || entity.type === 'ray') return boundsOf([xy(entity.a), xy(entity.b)]);
  return boundsOf(entityPath(entity, 12).map(xy));
}

export function drawingBounds(doc: DrawingDoc): Bounds | null {
  const points: Vec2[] = [];
  for (const entity of doc.entities) {
    const layer = doc.layers.find((item) => item.name === entity.layer);
    if (!shouldDraw(layer)) continue;
    const box = entityBounds(entity);
    if (!box) continue;
    points.push({ x: box.minX, y: box.minY }, { x: box.maxX, y: box.maxY });
  }
  const bulk = doc.bulk;
  if (bulk && bulk.entityCount > 0 && Number.isFinite(bulk.minX) && Number.isFinite(bulk.maxX)) {
    points.push({ x: bulk.minX, y: bulk.minY }, { x: bulk.maxX, y: bulk.maxY });
  }
  return boundsOf(points);
}

export function entityLength(entity: DrawEntity): number {
  if (entity.type === 'circle') return Math.PI * 2 * entity.radius;
  if (entity.type === 'arc') return Math.abs(arcSweep(entity)) * entity.radius;
  const pts = entityPath(entity);
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += dist(pts[i - 1], pts[i]);
  return length;
}

export function entityArea(entity: DrawEntity): number | null {
  if (entity.type === 'circle') return Math.PI * entity.radius * entity.radius;
  if (entity.type === 'arc') return null;
  if (entity.type === 'polyline') {
    const pts = polyPoints(entity);
    if (pts.length < 3) return 0;
    return polygonArea(pts);
  }
  return null;
}

export function layerOf(doc: DrawingDoc, entity: DrawEntity): LayerRec | undefined {
  return doc.layers.find((layer) => layer.name === entity.layer);
}

export function displayColor(doc: DrawingDoc, entity: DrawEntity): string {
  return resolvePaint(entity.color, layerOf(doc, entity)?.color ?? '#ffffff');
}

export function describeEntity(doc: DrawingDoc, entity: DrawEntity): string[] {
  const cad = describeCad(doc, entity);
  if (cad) return cad;
  const layer = entity.layer;
  const lines = [`${entity.type.toUpperCase()}  Layer: "${layer}"  Color: ${entity.color}`];
  if (entity.type === 'line') {
    lines.push(`from point, X= ${fmt(entity.a.x)}  Y= ${fmt(entity.a.y)}  Z= ${fmt(entity.a.z)}`);
    lines.push(`to point, X= ${fmt(entity.b.x)}  Y= ${fmt(entity.b.y)}  Z= ${fmt(entity.b.z)}`);
    lines.push(
      `Length = ${fmt(entityLength(entity))}, Angle in XY Plane = ${fmt((Math.atan2(entity.b.y - entity.a.y, entity.b.x - entity.a.x) * 180) / Math.PI)}`,
    );
    lines.push(`Delta X = ${fmt(entity.b.x - entity.a.x)}, Delta Y = ${fmt(entity.b.y - entity.a.y)}, Delta Z = ${fmt(entity.b.z - entity.a.z)}`);
  } else if (entity.type === 'circle') {
    lines.push(`center point, X= ${fmt(entity.center.x)}  Y= ${fmt(entity.center.y)}  Z= ${fmt(entity.center.z)}`);
    lines.push(`radius ${fmt(entity.radius)}`);
    lines.push(`circumference ${fmt(entityLength(entity))}`);
    lines.push(`area ${fmt(Math.PI * entity.radius * entity.radius)}`);
  } else if (entity.type === 'arc') {
    const start = pointOnArc(entity, 0);
    const end = pointOnArc(entity, 1);
    lines.push(`center point, X= ${fmt(entity.center.x)}  Y= ${fmt(entity.center.y)}  Z= ${fmt(entity.center.z)}`);
    lines.push(`radius ${fmt(entity.radius)}`);
    lines.push(`start point, X= ${fmt(start.x)}  Y= ${fmt(start.y)}  Z= ${fmt(start.z)}`);
    lines.push(`end point, X= ${fmt(end.x)}  Y= ${fmt(end.y)}  Z= ${fmt(end.z)}`);
    lines.push(`length ${fmt(entityLength(entity))}`);
  } else if (entity.type === 'polyline') {
    lines.push(`${entity.closed ? 'Closed' : 'Open'}  vertices ${entity.vertices.length}`);
    lines.push(`length ${fmt(entityLength(entity))}`);
    const area = entityArea(entity);
    if (area !== null) lines.push(`area ${fmt(area)}`);
  } else if (entity.type === 'point') {
    lines.push(`at point, X= ${fmt(entity.p.x)}  Y= ${fmt(entity.p.y)}  Z= ${fmt(entity.p.z)}`);
  } else if (entity.type === 'text') {
    lines.push(`text ${entity.content}`);
    lines.push(`at point, X= ${fmt(entity.p.x)}  Y= ${fmt(entity.p.y)}  Z= ${fmt(entity.p.z)}`);
    lines.push(`height ${fmt(entity.height)}  rotation ${fmt((entity.rotation * 180) / Math.PI)}`);
  }
  void doc;
  return lines;
}

export function rotatePoint(p: Vec3, base: Vec3, angle: number): Vec3 {
  const dx = p.x - base.x;
  const dy = p.y - base.y;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: base.x + dx * c - dy * s, y: base.y + dx * s + dy * c, z: p.z };
}

export function scalePoint(p: Vec3, base: Vec3, factor: number): Vec3 {
  return { x: base.x + (p.x - base.x) * factor, y: base.y + (p.y - base.y) * factor, z: p.z };
}

export function mirrorPoint(p: Vec3, a: Vec3, b: Vec3): Vec3 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return { ...p };
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return { x: 2 * px - p.x, y: 2 * py - p.y, z: p.z };
}

export function translatePoint(p: Vec3, dx: number, dy: number, dz = 0): Vec3 {
  return { x: p.x + dx, y: p.y + dy, z: p.z + dz };
}

function mapEntity(entity: DrawEntity, fn: (p: Vec3) => Vec3, factor = 1): DrawEntity {
  if (isCadShape(entity)) return mapCadEntity(entity, fn, factor) ?? entity;
  const next = structuredClone(entity);
  if (next.type === 'point' || next.type === 'text') {
    next.p = fn(next.p);
    if (next.type === 'text') next.height *= Math.abs(factor);
    return next;
  }
  if (next.type === 'line') {
    next.a = fn(next.a);
    next.b = fn(next.b);
    return next;
  }
  if (next.type === 'polyline') {
    next.vertices = next.vertices.map((vertex) => ({ ...vertex, ...fn(vertex), bulge: vertex.bulge }));
    return next;
  }
  if (next.type === 'block') {
    next.p = fn(next.p);
    return next;
  }
  if (next.type === 'circle') {
    next.center = fn(next.center);
    next.radius *= Math.abs(factor);
    return next;
  }
  const start = pointOnArc(next, 0);
  const mid = pointOnArc(next, 0.5);
  const end = pointOnArc(next, 1);
  const arc = arcFrom3(fn(start), fn(mid), fn(end));
  if (!arc) return next;
  next.center = arc.center;
  next.radius = arc.radius;
  next.startAngle = arc.startAngle;
  next.endAngle = arc.endAngle;
  return next;
}

export function moved(entity: DrawEntity, dx: number, dy: number, dz = 0): DrawEntity {
  return mapEntity(entity, (p) => translatePoint(p, dx, dy, dz));
}

export function rotated(entity: DrawEntity, base: Vec3, angle: number): DrawEntity {
  return mapEntity(entity, (p) => rotatePoint(p, base, angle));
}

export function scaled(entity: DrawEntity, base: Vec3, factor: number): DrawEntity {
  return mapEntity(entity, (p) => scalePoint(p, base, factor), factor);
}

export function mirrored(entity: DrawEntity, a: Vec3, b: Vec3): DrawEntity {
  const copy = mapEntity(entity, (p) => mirrorPoint(p, a, b));
  if (copy.type === 'text') copy.rotation = -copy.rotation;
  return copy;
}

export function pointInBox(p: Vec2, box: Bounds, tol = 0): boolean {
  return p.x >= box.minX - tol && p.x <= box.maxX + tol && p.y >= box.minY - tol && p.y <= box.maxY + tol;
}

function segmentHitsBox(a: Vec2, b: Vec2, box: Bounds): boolean {
  if (pointInBox(a, box) || pointInBox(b, box)) return true;
  const edges: [Vec2, Vec2][] = [
    [{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY }],
    [{ x: box.maxX, y: box.minY }, { x: box.maxX, y: box.maxY }],
    [{ x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY }],
    [{ x: box.minX, y: box.maxY }, { x: box.minX, y: box.minY }],
  ];
  return edges.some(([c, d]) => segmentsCross(a, b, c, d));
}

export function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2, tol = 1e-9): boolean {
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  if (((d1 > tol && d2 < -tol) || (d1 < -tol && d2 > tol)) && ((d3 > tol && d4 < -tol) || (d3 < -tol && d4 > tol))) return true;
  return false;
}

export function lineIntersection(
  a: Vec2,
  b: Vec2,
  c: Vec2,
  d: Vec2,
): { point: Vec2; t: number; u: number } | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-14) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  return { point: { x: a.x + t * rx, y: a.y + t * ry }, t, u };
}

export function projectSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number; distance: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 < 1e-18 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const point = { x: a.x + dx * t, y: a.y + dy * t };
  return { point, t, distance: Math.hypot(p.x - point.x, p.y - point.y) };
}

function circleLineHits(center: Vec2, radius: number, a: Vec2, b: Vec2): { point: Vec2; t: number }[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - center.x;
  const fy = a.y - center.y;
  const A = dx * dx + dy * dy;
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - radius * radius;
  const disc = B * B - 4 * A * C;
  if (disc < 0 || A < 1e-18) return [];
  const root = Math.sqrt(disc);
  return [(-B - root) / (2 * A), (-B + root) / (2 * A)]
    .filter((t) => t >= -1e-8 && t <= 1 + 1e-8)
    .map((t) => ({ point: { x: a.x + dx * t, y: a.y + dy * t }, t: Math.min(1, Math.max(0, t)) }));
}

export interface SnapHit {
  point: Vec3;
  kind: 'endpoint' | 'midpoint' | 'center' | 'node' | 'intersection' | 'nearest';
  entityId: string;
}

const SNAP_RANK: Record<SnapHit['kind'], number> = {
  intersection: 0,
  endpoint: 1,
  node: 2,
  midpoint: 3,
  center: 4,
  nearest: 5,
};

function pushSnap(hits: SnapHit[], kind: SnapHit['kind'], point: Vec3, entityId: string, cursor: Vec2, tol: number, modes: Set<string>) {
  if (!modes.has(kind)) return;
  if (Math.hypot(point.x - cursor.x, point.y - cursor.y) <= tol) hits.push({ kind, point, entityId });
}

export function snapToDrawing(doc: DrawingDoc, cursor: Vec3, tol: number, modes: SnapHit['kind'][]): SnapHit | null {
  if (tol <= 0 || modes.length === 0) return null;
  const enabled = new Set(modes);
  const hits: SnapHit[] = [];
  const visible = doc.entities.filter((entity) => shouldDraw(layerOf(doc, entity)));
  const near = visible.filter((entity) => {
    const box = entityBounds(entity);
    if (!box) return false;
    return !(cursor.x < box.minX - tol || cursor.x > box.maxX + tol || cursor.y < box.minY - tol || cursor.y > box.maxY + tol);
  });
  for (const entity of near) {
    if (entity.type === 'point') pushSnap(hits, 'node', entity.p, entity.id, cursor, tol, enabled);
    if (entity.type === 'text') pushSnap(hits, 'node', entity.p, entity.id, cursor, tol, enabled);
    if (entity.type === 'line') {
      pushSnap(hits, 'endpoint', entity.a, entity.id, cursor, tol, enabled);
      pushSnap(hits, 'endpoint', entity.b, entity.id, cursor, tol, enabled);
      pushSnap(hits, 'midpoint', v3((entity.a.x + entity.b.x) / 2, (entity.a.y + entity.b.y) / 2, (entity.a.z + entity.b.z) / 2), entity.id, cursor, tol, enabled);
      const proj = projectSegment(cursor, entity.a, entity.b);
      pushSnap(hits, 'nearest', { ...proj.point, z: entity.a.z }, entity.id, cursor, tol, enabled);
    }
    if (entity.type === 'circle' || entity.type === 'arc') {
      pushSnap(hits, 'center', entity.center, entity.id, cursor, tol, enabled);
      if (entity.type === 'arc') {
        pushSnap(hits, 'endpoint', pointOnArc(entity, 0), entity.id, cursor, tol, enabled);
        pushSnap(hits, 'endpoint', pointOnArc(entity, 1), entity.id, cursor, tol, enabled);
        pushSnap(hits, 'midpoint', pointOnArc(entity, 0.5), entity.id, cursor, tol, enabled);
      }
      const ang = Math.atan2(cursor.y - entity.center.y, cursor.x - entity.center.x);
      pushSnap(
        hits,
        'nearest',
        { x: entity.center.x + Math.cos(ang) * entity.radius, y: entity.center.y + Math.sin(ang) * entity.radius, z: entity.center.z },
        entity.id,
        cursor,
        tol,
        enabled,
      );
    }
    if (isCadShape(entity)) {
      for (const grip of cadGrips(entity) ?? []) pushSnap(hits, entity.type === 'ellipse' || entity.type === 'donut' ? 'center' : 'endpoint', grip, entity.id, cursor, tol, enabled);
      const path = cadEntityPath(entity, 12) ?? [];
      let best: { point: Vec3; distance: number } | null = null;
      for (let i = 1; i < path.length; i++) {
        const proj = projectSegment(cursor, path[i - 1], path[i]);
        if (!best || proj.distance < best.distance) best = { point: { ...proj.point, z: path[i - 1].z }, distance: proj.distance };
      }
      if (best) pushSnap(hits, 'nearest', best.point, entity.id, cursor, tol, enabled);
    }
    if (entity.type === 'polyline') {
      const verts = entity.vertices;
      const segCount = entity.closed ? verts.length : verts.length - 1;
      for (let i = 0; i < verts.length; i++) pushSnap(hits, 'endpoint', verts[i], entity.id, cursor, tol, enabled);
      for (let i = 0; i < segCount; i++) {
        const a = verts[i];
        const b = verts[(i + 1) % verts.length];
        const arc = bulgeArc(a, b, a.bulge);
        if (arc) {
          const midAngle = (arc.startAngle + arc.endAngle) / 2;
          pushSnap(hits, 'midpoint', { x: arc.center.x + Math.cos(midAngle) * arc.radius, y: arc.center.y + Math.sin(midAngle) * arc.radius, z: a.z }, entity.id, cursor, tol, enabled);
          pushSnap(hits, 'center', { ...arc.center, z: a.z }, entity.id, cursor, tol, enabled);
        } else {
          pushSnap(hits, 'midpoint', v3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), entity.id, cursor, tol, enabled);
          const proj = projectSegment(cursor, a, b);
          pushSnap(hits, 'nearest', { ...proj.point, z: a.z }, entity.id, cursor, tol, enabled);
        }
      }
    }
  }
  if (enabled.has('intersection')) {
    for (let i = 0; i < near.length; i++) {
      for (let j = i + 1; j < near.length; j++) {
        for (const point of entityIntersections(near[i], near[j])) {
          pushSnap(hits, 'intersection', point, near[i].id, cursor, tol, enabled);
        }
      }
    }
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => SNAP_RANK[a.kind] - SNAP_RANK[b.kind] || Math.hypot(a.point.x - cursor.x, a.point.y - cursor.y) - Math.hypot(b.point.x - cursor.x, b.point.y - cursor.y));
  return hits[0];
}

function entityIntersections(a: DrawEntity, b: DrawEntity): Vec3[] {
  const segs = (entity: DrawEntity): [Vec3, Vec3][] => {
    if (entity.type === 'line') return [[entity.a, entity.b]];
    if (entity.type === 'polyline') {
      const out: [Vec3, Vec3][] = [];
      const n = entity.closed ? entity.vertices.length : entity.vertices.length - 1;
      for (let i = 0; i < n; i++) {
        const p = entity.vertices[i];
        const q = entity.vertices[(i + 1) % entity.vertices.length];
        if (Math.abs(p.bulge) < 1e-8) out.push([p, q]);
      }
      return out;
    }
    return [];
  };
  const hits: Vec3[] = [];
  const addLineLine = (p: Vec3, q: Vec3, r: Vec3, s: Vec3) => {
    const hit = lineIntersection(p, q, r, s);
    if (hit && hit.t >= -1e-8 && hit.t <= 1 + 1e-8 && hit.u >= -1e-8 && hit.u <= 1 + 1e-8) {
      hits.push({ ...hit.point, z: p.z });
    }
  };
  for (const [p, q] of segs(a)) {
    for (const [r, s] of segs(b)) addLineLine(p, q, r, s);
    if (b.type === 'circle' || b.type === 'arc') {
      for (const hit of circleLineHits(b.center, b.radius, p, q)) {
        if (b.type === 'circle' || angleOnArc(b, hit.point)) hits.push({ ...hit.point, z: p.z });
      }
    }
  }
  for (const [p, q] of segs(b)) {
    if (a.type === 'circle' || a.type === 'arc') {
      for (const hit of circleLineHits(a.center, a.radius, p, q)) {
        if (a.type === 'circle' || angleOnArc(a, hit.point)) hits.push({ ...hit.point, z: p.z });
      }
    }
  }
  if ((a.type === 'circle' || a.type === 'arc') && (b.type === 'circle' || b.type === 'arc')) {
    for (const point of circleCircle(a.center, a.radius, b.center, b.radius)) {
      const onA = a.type === 'circle' || angleOnArc(a, point);
      const onB = b.type === 'circle' || angleOnArc(b, point);
      if (onA && onB) hits.push({ ...point, z: a.center.z });
    }
  }
  return hits;
}

function angleOnArc(arc: DrawArc, p: Vec2): boolean {
  const ang = Math.atan2(p.y - arc.center.y, p.x - arc.center.x);
  const sweep = arcSweep(arc);
  let delta = ang - arc.startAngle;
  if (sweep >= 0) {
    while (delta < -1e-8) delta += Math.PI * 2;
    return delta <= sweep + 1e-6;
  }
  while (delta > 1e-8) delta -= Math.PI * 2;
  return delta >= sweep - 1e-6;
}

function circleCircle(c1: Vec2, r1: number, c2: Vec2, r2: number): Vec2[] {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-9 || d > r1 + r2 + 1e-8 || d < Math.abs(r1 - r2) - 1e-8) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  const h = Math.sqrt(Math.max(0, h2));
  const xm = c1.x + (a * dx) / d;
  const ym = c1.y + (a * dy) / d;
  const rx = (-dy * h) / d;
  const ry = (dx * h) / d;
  if (h < 1e-8) return [{ x: xm, y: ym }];
  return [
    { x: xm + rx, y: ym + ry },
    { x: xm - rx, y: ym - ry },
  ];
}

export function pickEntity(doc: DrawingDoc, p: Vec2, tol: number): string | null {
  for (let i = doc.entities.length - 1; i >= 0; i--) {
    const entity = doc.entities[i];
    const layer = layerOf(doc, entity);
    if (!shouldDraw(layer) || layer?.locked) continue;
    if (hitsEntity(entity, p, tol)) return entity.id;
  }
  return null;
}

function hitsEntity(entity: DrawEntity, p: Vec2, tol: number): boolean {
  const cad = hitCad(entity, p, tol);
  if (cad !== null) return cad;
  if (entity.type === 'point' || entity.type === 'text' || entity.type === 'mtext' || entity.type === 'attdef') {
    const at = entity.type === 'point' || entity.type === 'text' ? entity.p : entity.p;
    const height = entity.type === 'text' || entity.type === 'mtext' || entity.type === 'attdef' ? entity.height : tol;
    return Math.hypot(at.x - p.x, at.y - p.y) <= Math.max(tol, height);
  }
  if (entity.type === 'circle') {
    const d = Math.hypot(entity.center.x - p.x, entity.center.y - p.y);
    return Math.abs(d - entity.radius) <= tol;
  }
  if (entity.type === 'arc') {
    const d = Math.hypot(entity.center.x - p.x, entity.center.y - p.y);
    return Math.abs(d - entity.radius) <= tol && angleOnArc(entity, p);
  }
  const path = entityPath(entity, 12);
  for (let i = 1; i < path.length; i++) {
    if (projectSegment(p, path[i - 1], path[i]).distance <= tol) return true;
  }
  return false;
}

export function selectByBox(doc: DrawingDoc, a: Vec2, b: Vec2): { ids: string[]; crossing: boolean; box: Bounds } {
  const box: Bounds = {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
  const crossing = b.x < a.x;
  const ids: string[] = [];
  for (const entity of doc.entities) {
    const layer = layerOf(doc, entity);
    if (!shouldDraw(layer) || layer?.locked) continue;
    const path = entityPath(entity, 16);
    if (path.length === 0) continue;
    const inside = path.every((point) => pointInBox(point, box));
    if (!crossing) {
      if (inside) ids.push(entity.id);
      continue;
    }
    if (inside || path.some((point) => pointInBox(point, box))) {
      ids.push(entity.id);
      continue;
    }
    let hit = false;
    for (let i = 1; i < path.length; i++) {
      if (segmentHitsBox(path[i - 1], path[i], box)) {
        hit = true;
        break;
      }
    }
    if (hit) ids.push(entity.id);
  }
  return { ids, crossing, box };
}

export function applyConstraint(base: Vec3 | null, cursor: Vec3, ortho: boolean, polar: boolean, polarAngleDeg: number): Vec3 {
  if (!base) return cursor;
  const dx = cursor.x - base.x;
  const dy = cursor.y - base.y;
  if (ortho) {
    if (Math.abs(dx) >= Math.abs(dy)) return { x: cursor.x, y: base.y, z: cursor.z };
    return { x: base.x, y: cursor.y, z: cursor.z };
  }
  if (polar && polarAngleDeg > 0) {
    const step = (polarAngleDeg * Math.PI) / 180;
    const ang = Math.atan2(dy, dx);
    const snapped = Math.round(ang / step) * step;
    if (Math.abs(wrapPi(ang - snapped)) <= (8 * Math.PI) / 180) {
      const length = Math.hypot(dx, dy);
      return { x: base.x + Math.cos(snapped) * length, y: base.y + Math.sin(snapped) * length, z: cursor.z };
    }
  }
  return cursor;
}

export function directDistance(base: Vec3, cursor: Vec3, distance: number): Vec3 | null {
  const dx = cursor.x - base.x;
  const dy = cursor.y - base.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return null;
  const scale = distance / length;
  return { x: base.x + dx * scale, y: base.y + dy * scale, z: base.z };
}

export interface TrackLine {
  a: Vec3;
  b: Vec3;
}

/** Object-snap tracking: project onto acquired alignment rays and their crossings. */
export function objectTrack(acquired: Vec3[], cursor: Vec3, tol: number, angles: number[]): { point: Vec3; lines: TrackLine[] } | null {
  if (acquired.length === 0 || angles.length === 0) return null;
  const lines: { origin: Vec3; angle: number }[] = [];
  for (const origin of acquired) {
    for (const angle of angles) lines.push({ origin, angle });
  }
  const near = lines
    .map((line) => {
      const dx = Math.cos(line.angle);
      const dy = Math.sin(line.angle);
      const t = (cursor.x - line.origin.x) * dx + (cursor.y - line.origin.y) * dy;
      const point = { x: line.origin.x + dx * t, y: line.origin.y + dy * t, z: cursor.z };
      return { ...line, point, distance: Math.hypot(point.x - cursor.x, point.y - cursor.y), t };
    })
    .filter((line) => line.distance <= tol && line.t > tol);
  if (near.length === 0) return null;
  near.sort((a, b) => a.distance - b.distance);
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      if (near[i].origin === near[j].origin) continue;
      const hit = lineIntersection(
        near[i].origin,
        { x: near[i].origin.x + Math.cos(near[i].angle), y: near[i].origin.y + Math.sin(near[i].angle) },
        near[j].origin,
        { x: near[j].origin.x + Math.cos(near[j].angle), y: near[j].origin.y + Math.sin(near[j].angle) },
      );
      if (!hit) continue;
      if (Math.hypot(hit.point.x - cursor.x, hit.point.y - cursor.y) <= tol) {
        return {
          point: { ...hit.point, z: cursor.z },
          lines: [span(near[i].origin, hit.point), span(near[j].origin, hit.point)],
        };
      }
    }
  }
  const best = near[0];
  return { point: best.point, lines: [span(best.origin, best.point)] };
}

function span(a: Vec3, b: Vec2): TrackLine {
  return { a, b: { ...b, z: a.z } };
}

export function gripPoints(entity: DrawEntity): Vec3[] {
  if (entity.locked) return [];
  if (entity.type === 'line') return [entity.a, entity.b, v3((entity.a.x + entity.b.x) / 2, (entity.a.y + entity.b.y) / 2, (entity.a.z + entity.b.z) / 2)];
  if (entity.type === 'point' || entity.type === 'text' || entity.type === 'block') return [entity.p];
  if (entity.type === 'circle') return [entity.center, v3(entity.center.x + entity.radius, entity.center.y, entity.center.z)];
  if (entity.type === 'arc') return [pointOnArc(entity, 0), pointOnArc(entity, 0.5), pointOnArc(entity, 1), entity.center];
  if (entity.type === 'polyline') return entity.vertices.map((vertex) => v3(vertex.x, vertex.y, vertex.z));
  return cadGrips(entity) ?? [];
}

export const ACI: Record<string, string> = {
  '1': '#ff4d4d',
  '2': '#f0d78c',
  '3': '#7dcea0',
  '4': '#76d7ea',
  '5': '#79b8ff',
  '6': '#e39bb4',
  '7': '#e8eef7',
  red: '#ff4d4d',
  yellow: '#f0d78c',
  green: '#7dcea0',
  cyan: '#76d7ea',
  blue: '#79b8ff',
  magenta: '#e39bb4',
  white: '#e8eef7',
  bylayer: 'bylayer',
};

export function alignmentPointsOf(entity: DrawEntity): Vec3[] {
  if (entity.type === 'line') return [entity.a, entity.b];
  if (entity.type === 'polyline') {
    const pts = polyPoints(entity, 8);
    if (entity.closed && pts.length > 2) {
      const first = pts[0];
      const last = pts[pts.length - 1];
      if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) return pts.slice(0, -1);
    }
    return pts;
  }
  if (entity.type === 'arc') return [pointOnArc(entity, 0), pointOnArc(entity, 0.5), pointOnArc(entity, 1)];
  return [];
}
