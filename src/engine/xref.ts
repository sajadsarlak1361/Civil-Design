import type { DrawEntity, LayerRec } from './drafting';
import { normalizeLayer } from './layers';

export type XrefStatus = 'loaded' | 'unloaded' | 'not-found' | 'unreferenced' | 'needs-reload' | 'orphaned';
export type XrefPathType = 'full' | 'relative' | 'none';
export type XrefAttach = 'attach' | 'overlay';
export type XrefKind = 'dxf' | 'fieldline' | 'image' | 'dwg';

export interface XrefLayer {
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
  lineType: string;
}

export interface XrefSnapshot {
  entities: DrawEntity[];
  layers: XrefLayer[];
}

export interface XrefClip {
  shape: 'rect' | 'polygon';
  points: { x: number; y: number }[];
  invert: boolean;
  enabled: boolean;
}

export interface XrefRecord {
  id: string;
  name: string;
  kind: XrefKind;
  savedPath: string;
  pathType: XrefPathType;
  attachType: XrefAttach;
  /** Stored status. Unreferenced and orphaned are derived. */
  status: 'loaded' | 'unloaded' | 'not-found' | 'needs-reload';
  referenced: boolean;
  parentId: string | null;
  insertion: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  rotation: number;
  clip: XrefClip | null;
  fingerprint: string;
  size: number;
  date: string;
  snapshot: XrefSnapshot | null;
  /** VISRETAIN. Reload keeps these overrides. */
  layerOverrides: Record<string, { visible?: boolean; color?: string; locked?: boolean }>;
  notification: string | null;
  image?: { width: number; height: number; format: 'png' | 'jpeg' };
}

export interface XrefFile {
  xfade: number;
  xclipFrame: 0 | 1 | 2;
  selectedId: string | null;
  records: XrefRecord[];
}

export interface XrefLayerRow {
  id: string;
  name: string;
  displayName: string;
  xrefName: string;
  color: string;
  visible: boolean;
  locked: boolean;
  lineType: string;
  filter: 'xref';
}

export function sampleXrefs(): XrefFile {
  const line: XrefSnapshot = {
    entities: [{ id: 'e1', type: 'line', layer: '0', color: 'bylayer', a: { x: 0, y: 0, z: 0 }, b: { x: 40, y: 10, z: 0 } }],
    layers: [{ name: '0', color: '#e8eef7', visible: true, locked: false, lineType: 'Continuous' }],
  };
  let doc = attachXref(emptyXrefs(), { name: 'Road', savedPath: 'C:/survey/road.dxf', snapshot: line });
  doc = attachXref(doc, { name: 'Parked', savedPath: 'parked.dxf', snapshot: line });
  doc = unloadXref(doc, doc.records[1].id);
  doc = attachXref(doc, { name: 'Missing', savedPath: 'missing.dxf', found: false });
  return doc;
}

export function emptyXrefs(): XrefFile {
  return { xfade: 50, xclipFrame: 2, selectedId: null, records: [] };
}

export function fingerprintOf(snapshot: XrefSnapshot | null): string {
  if (!snapshot) return '';
  const first = snapshot.entities[0];
  return `${snapshot.entities.length}:${snapshot.layers.map((layer) => layer.name).join(',')}:${first?.id ?? ''}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function byId(doc: XrefFile, id: string): XrefRecord | undefined {
  return doc.records.find((record) => record.id === id);
}

export function displayStatus(doc: XrefFile, record: XrefRecord): XrefStatus {
  if (!record.referenced) return 'unreferenced';
  let parentId = record.parentId;
  const seen = new Set<string>();
  while (parentId) {
    if (seen.has(parentId)) return 'orphaned';
    seen.add(parentId);
    const parent = byId(doc, parentId);
    if (!parent || !parent.referenced) return 'orphaned';
    if (parent.status === 'unloaded' || parent.status === 'not-found') return 'orphaned';
    parentId = parent.parentId;
  }
  return record.status;
}

/** Top-level attach and overlay are drawn. A nested overlay is not. A nested attach is drawn when its parents are loaded. */
export function hostVisible(doc: XrefFile, record: XrefRecord, stack: Set<string> = new Set()): boolean {
  if (!record.referenced) return false;
  if (record.status !== 'loaded' && record.status !== 'needs-reload') return false;
  if (stack.has(record.id)) return false;
  if (!record.parentId) return true;
  if (record.attachType === 'overlay') return false;
  const parent = byId(doc, record.parentId);
  if (!parent) return false;
  return hostVisible(doc, parent, new Set([...stack, record.id]));
}

export function visibleXrefs(doc: XrefFile): XrefRecord[] {
  return doc.records.filter((record) => hostVisible(doc, record));
}

export interface AttachInput {
  name: string;
  savedPath: string;
  kind?: XrefKind;
  pathType?: XrefPathType;
  attachType?: XrefAttach;
  parentId?: string | null;
  insertion?: { x: number; y: number; z: number };
  scale?: { x: number; y: number; z: number };
  rotation?: number;
  snapshot?: XrefSnapshot | null;
  found?: boolean;
  size?: number;
  image?: XrefRecord['image'];
}

let xrefSeq = 1;

export function attachXref(doc: XrefFile, input: AttachInput): XrefFile {
  const found = input.found !== false && input.snapshot != null;
  const record: XrefRecord = {
    id: `xref-${xrefSeq++}`,
    name: input.name,
    kind: input.kind ?? 'dxf',
    savedPath: input.pathType === 'none' ? input.savedPath.split(/[\\/]/).pop() || input.savedPath : input.savedPath,
    pathType: input.pathType ?? 'full',
    attachType: input.attachType ?? 'attach',
    status: found ? 'loaded' : 'not-found',
    referenced: true,
    parentId: input.parentId ?? null,
    insertion: input.insertion ?? { x: 0, y: 0, z: 0 },
    scale: input.scale ?? { x: 1, y: 1, z: 1 },
    rotation: input.rotation ?? 0,
    clip: null,
    fingerprint: fingerprintOf(input.snapshot ?? null),
    size: input.size ?? input.snapshot?.entities.length ?? 0,
    date: new Date().toISOString(),
    snapshot: input.snapshot ? clone(input.snapshot) : null,
    layerOverrides: {},
    notification: found ? null : `Not found: ${input.savedPath}`,
    ...(input.image ? { image: input.image } : {}),
  };
  return { ...doc, records: [...doc.records, record], selectedId: record.id };
}

export function detachXref(doc: XrefFile, id: string): XrefFile {
  const drop = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const record of doc.records) {
      if (record.parentId && drop.has(record.parentId) && !drop.has(record.id)) {
        drop.add(record.id);
        grew = true;
      }
    }
  }
  return { ...doc, records: doc.records.filter((record) => !drop.has(record.id)), selectedId: doc.selectedId === id ? null : doc.selectedId };
}

export function unloadXref(doc: XrefFile, id: string): XrefFile {
  return mapRecord(doc, id, (record) => ({ ...record, status: 'unloaded', notification: null }));
}

export function reloadXref(doc: XrefFile, id: string, snapshot: XrefSnapshot | null, found = snapshot != null): XrefFile {
  return mapRecord(doc, id, (record) => {
    const fingerprint = fingerprintOf(snapshot);
    const changed = fingerprint !== record.fingerprint && record.fingerprint !== '';
    return {
      ...record,
      snapshot: snapshot ? clone(snapshot) : record.snapshot,
      fingerprint: snapshot ? fingerprint : record.fingerprint,
      status: found ? 'loaded' : 'not-found',
      notification: found ? (changed ? `${record.name} reloaded.` : null) : `Not found: ${record.savedPath}`,
      layerOverrides: record.layerOverrides,
    };
  });
}

export function markNeedsReload(doc: XrefFile, id: string): XrefFile {
  return mapRecord(doc, id, (record) =>
    record.status === 'loaded' ? { ...record, status: 'needs-reload', notification: `${record.name} needs reloading.` } : record,
  );
}

export function setXrefPath(doc: XrefFile, id: string, savedPath: string, pathType: XrefPathType): XrefFile {
  const path = pathType === 'none' ? savedPath.split(/[\\/]/).pop() || savedPath : savedPath;
  return mapRecord(doc, id, (record) => ({ ...record, savedPath: path, pathType, notification: null }));
}

export function replaceXrefPaths(doc: XrefFile, find: string, replacement: string): XrefFile {
  return {
    ...doc,
    records: doc.records.map((record) =>
      record.savedPath.includes(find) ? { ...record, savedPath: record.savedPath.split(find).join(replacement) } : record,
    ),
  };
}

export function setXrefClip(doc: XrefFile, id: string, clip: XrefClip | null): XrefFile {
  return mapRecord(doc, id, (record) => ({ ...record, clip: clip ? clone(clip) : null }));
}

export function setXfade(doc: XrefFile, value: number): XrefFile {
  return { ...doc, xfade: Math.max(0, Math.min(90, value)) };
}

export function setReferenced(doc: XrefFile, id: string, referenced: boolean): XrefFile {
  return mapRecord(doc, id, (record) => ({ ...record, referenced }));
}

function mapRecord(doc: XrefFile, id: string, update: (record: XrefRecord) => XrefRecord): XrefFile {
  return { ...doc, records: doc.records.map((record) => (record.id === id ? update(record) : record)) };
}

function bindLayerName(xrefName: string, layer: string, taken: Set<string>): string {
  let index = 0;
  let candidate = `${xrefName}$${index}$${layer}`;
  while (taken.has(candidate.toLowerCase())) {
    index += 1;
    candidate = `${xrefName}$${index}$${layer}`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

function transformPoint(record: XrefRecord, point: { x: number; y: number; z: number }) {
  const x = point.x * record.scale.x;
  const y = point.y * record.scale.y;
  const cos = Math.cos(record.rotation);
  const sin = Math.sin(record.rotation);
  return {
    x: record.insertion.x + x * cos - y * sin,
    y: record.insertion.y + x * sin + y * cos,
    z: record.insertion.z + point.z * record.scale.z,
  };
}

function retarget(entity: DrawEntity, layer: string, id: string, record: XrefRecord): DrawEntity {
  const next = clone(entity);
  next.id = id;
  next.layer = layer;
  if (next.type === 'point' || next.type === 'text') next.p = transformPoint(record, next.p);
  else if (next.type === 'line') {
    next.a = transformPoint(record, next.a);
    next.b = transformPoint(record, next.b);
  } else if (next.type === 'polyline') next.vertices = next.vertices.map((vertex) => ({ ...vertex, ...transformPoint(record, vertex) }));
  else if (next.type === 'circle' || next.type === 'arc') {
    next.center = transformPoint(record, next.center);
    next.radius *= Math.abs(record.scale.x);
  } else if (next.type === 'block') next.p = transformPoint(record, next.p);
  else if (next.type === 'dimension') {
    next.p1 = transformPoint(record, next.p1);
    next.p2 = transformPoint(record, next.p2);
    next.p3 = transformPoint(record, next.p3);
    next.loc = transformPoint(record, next.loc);
  }
  return next;
}

export interface BindResult {
  doc: XrefFile;
  entities: DrawEntity[];
  layers: LayerRec[];
}

/** Bind renames layers to Name$0$Layer. Insert merges layer names. Nested overlays are left out. */
export function bindXref(doc: XrefFile, id: string, mode: 'bind' | 'insert', hostLayers: string[]): BindResult {
  const record = byId(doc, id);
  if (!record || !record.snapshot) return { doc, entities: [], layers: [] };
  const taken = new Set(hostLayers.map((layer) => layer.toLowerCase()));
  const layerMap = new Map<string, string>();
  const layers: LayerRec[] = [];
  for (const layer of record.snapshot.layers) {
    const override = record.layerOverrides[layer.name];
    const name = mode === 'bind' ? bindLayerName(record.name, layer.name, taken) : layer.name;
    layerMap.set(layer.name, name);
    if (!hostLayers.some((host) => host.toLowerCase() === name.toLowerCase())) {
      layers.push(
        normalizeLayer({
          name,
          color: override?.color ?? layer.color,
          visible: override?.visible ?? layer.visible,
          locked: override?.locked ?? layer.locked,
          lineType: layer.lineType,
        }),
      );
    }
  }
  let entityId = 1;
  const entities = record.snapshot.entities.map((entity) => retarget(entity, layerMap.get(entity.layer) ?? entity.layer, `b${record.id}-${entityId++}`, record));
  return { doc: detachXref(doc, id), entities, layers };
}

export function xbindLayers(doc: XrefFile, id: string, names: string[], hostLayers: string[]): { layers: LayerRec[] } {
  const record = byId(doc, id);
  if (!record?.snapshot) return { layers: [] };
  const taken = new Set(hostLayers.map((layer) => layer.toLowerCase()));
  const layers: LayerRec[] = [];
  for (const layer of record.snapshot.layers) {
    if (!names.includes(layer.name)) continue;
    const name = bindLayerName(record.name, layer.name, taken);
    const override = record.layerOverrides[layer.name];
    layers.push(
    normalizeLayer({
      name,
      color: override?.color ?? layer.color,
      visible: override?.visible ?? layer.visible,
      locked: override?.locked ?? layer.locked,
      lineType: layer.lineType,
    }),
  );
  }
  return { layers };
}

export function setLayerOverride(doc: XrefFile, id: string, layer: string, patch: { visible?: boolean; color?: string; locked?: boolean }): XrefFile {
  return mapRecord(doc, id, (record) => ({
    ...record,
    layerOverrides: { ...record.layerOverrides, [layer]: { ...record.layerOverrides[layer], ...patch } },
  }));
}

export function xrefLayerRows(doc: XrefFile): XrefLayerRow[] {
  const rows: XrefLayerRow[] = [];
  for (const record of doc.records) {
    if (!record.snapshot || !record.referenced) continue;
    if (record.status === 'unloaded' || record.status === 'not-found') continue;
    for (const layer of record.snapshot.layers) {
      const override = record.layerOverrides[layer.name];
      rows.push({
        id: `${record.id}:${layer.name}`,
        name: layer.name,
        displayName: `${record.name}|${layer.name}`,
        xrefName: record.name,
        color: override?.color ?? layer.color,
        visible: override?.visible ?? layer.visible,
        locked: override?.locked ?? layer.locked,
        lineType: layer.lineType,
        filter: 'xref',
      });
    }
  }
  return rows;
}

export function pointInClip(clip: XrefClip | null, x: number, y: number): boolean {
  if (!clip || !clip.enabled || clip.points.length < 3) return true;
  let inside = false;
  for (let i = 0, j = clip.points.length - 1; i < clip.points.length; j = i, i += 1) {
    const a = clip.points[i];
    const b = clip.points[j];
    const hit = a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1e-12) + a.x;
    if (hit) inside = !inside;
  }
  return clip.invert ? !inside : inside;
}

/** Transformed copies for display. The host drawing is not modified. */
export function placedEntities(record: XrefRecord): DrawEntity[] {
  if (!record.snapshot) return [];
  return record.snapshot.entities.map((entity, index) => retarget(entity, entity.layer, `draw-${record.id}-${index}`, record));
}

export function xrefBounds(record: XrefRecord): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const entities = record.snapshot?.entities ?? [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const take = (x: number, y: number) => {
    const point = transformPoint(record, { x, y, z: 0 });
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  };
  for (const entity of entities) {
    if (entity.type === 'point' || entity.type === 'text' || entity.type === 'block') take(entity.p.x, entity.p.y);
    else if (entity.type === 'line') {
      take(entity.a.x, entity.a.y);
      take(entity.b.x, entity.b.y);
    } else if (entity.type === 'dimension') {
      take(entity.p1.x, entity.p1.y);
      take(entity.p2.x, entity.p2.y);
      take(entity.loc.x, entity.loc.y);
    } else if (entity.type === 'polyline') entity.vertices.forEach((vertex) => take(vertex.x, vertex.y));
    else if (entity.type === 'circle' || entity.type === 'arc') {
      take(entity.center.x - entity.radius, entity.center.y - entity.radius);
      take(entity.center.x + entity.radius, entity.center.y + entity.radius);
    }
  }
  if (record.kind === 'image' && record.image) {
    take(0, 0);
    take(record.image.width, record.image.height);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

export function pickXref(doc: XrefFile, x: number, y: number): string | null {
  for (let index = doc.records.length - 1; index >= 0; index -= 1) {
    const record = doc.records[index];
    if (!hostVisible(doc, record)) continue;
    const bounds = xrefBounds(record);
    if (!bounds) continue;
    if (x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY) {
      if (!pointInClip(record.clip, x, y) && record.clip?.enabled) continue;
      return record.id;
    }
  }
  return null;
}

export function selectXref(doc: XrefFile, id: string | null): XrefFile {
  return { ...doc, selectedId: id };
}

export function resolvedPath(record: XrefRecord): string {
  if (record.pathType === 'none') return record.savedPath.split(/[\\/]/).pop() || record.savedPath;
  return record.savedPath;
}

function isRecord(value: unknown): value is Partial<XrefRecord> {
  return Boolean(value) && typeof value === 'object';
}

export function parseXrefFile(value: unknown): XrefFile {
  const empty = emptyXrefs();
  if (!value || typeof value !== 'object') return empty;
  const raw = value as Partial<XrefFile>;
  const records: XrefRecord[] = [];
  if (Array.isArray(raw.records)) {
    for (const item of raw.records) {
      if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string') continue;
      records.push({
        id: item.id,
        name: item.name,
        kind: item.kind === 'image' || item.kind === 'fieldline' || item.kind === 'dwg' ? item.kind : 'dxf',
        savedPath: typeof item.savedPath === 'string' ? item.savedPath : '',
        pathType: item.pathType === 'relative' || item.pathType === 'none' ? item.pathType : 'full',
        attachType: item.attachType === 'overlay' ? 'overlay' : 'attach',
        status: item.status === 'unloaded' || item.status === 'not-found' || item.status === 'needs-reload' ? item.status : 'loaded',
        referenced: item.referenced !== false,
        parentId: typeof item.parentId === 'string' ? item.parentId : null,
        insertion: item.insertion ?? { x: 0, y: 0, z: 0 },
        scale: item.scale ?? { x: 1, y: 1, z: 1 },
        rotation: typeof item.rotation === 'number' ? item.rotation : 0,
        clip: item.clip ?? null,
        fingerprint: typeof item.fingerprint === 'string' ? item.fingerprint : '',
        size: typeof item.size === 'number' ? item.size : 0,
        date: typeof item.date === 'string' ? item.date : '',
        snapshot: item.snapshot ?? null,
        layerOverrides: item.layerOverrides ?? {},
        notification: typeof item.notification === 'string' ? item.notification : null,
        ...(item.image ? { image: item.image } : {}),
      });
    }
  }
  const frame = raw.xclipFrame === 0 || raw.xclipFrame === 1 ? raw.xclipFrame : 2;
  return {
    xfade: typeof raw.xfade === 'number' ? Math.max(0, Math.min(90, raw.xfade)) : 50,
    xclipFrame: frame,
    selectedId: typeof raw.selectedId === 'string' ? raw.selectedId : null,
    records,
  };
}

type Listener = () => void;
const listeners = new Set<Listener>();
let current = emptyXrefs();

export function subscribeXrefs(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getXrefDoc(): XrefFile {
  return current;
}

export function replaceXrefs(doc: XrefFile): void {
  current = doc;
  for (const listener of listeners) listener();
}

export function updateXrefs(update: (doc: XrefFile) => XrefFile): XrefFile {
  current = update(current);
  for (const listener of listeners) listener();
  return current;
}

/** Command-line -XREF. Returns the message Civil Design should print. */
export function dashXref(doc: XrefFile, line: string, hostLayers: string[] = []): { doc: XrefFile; message: string; entities: DrawEntity[]; layers: LayerRec[] } {
  const parts = line.trim().replace(/^-XR(EF)?\s+/i, '').split(/\s+/).filter(Boolean);
  const verb = (parts[0] ?? '?').toLowerCase();
  const name = parts[1] ?? '';
  const found = () => doc.records.find((record) => record.name.toLowerCase() === name.toLowerCase());
  const none = { entities: [] as DrawEntity[], layers: [] as LayerRec[] };
  if (verb === '?' || verb === '') {
    const rows = doc.records.map((record) => `${record.name} ${displayStatus(doc, record)} ${record.attachType} ${record.savedPath}`);
    return { doc, message: rows.length ? rows.join('\n') : 'No external references.', ...none };
  }
  if ((verb === 'detach' || verb === 'd') && found()) return { doc: detachXref(doc, found()!.id), message: `${name} detached.`, ...none };
  if ((verb === 'unload' || verb === 'u') && found()) return { doc: unloadXref(doc, found()!.id), message: `${name} unloaded.`, ...none };
  if ((verb === 'reload' || verb === 'r') && found()) {
    const record = found()!;
    return { doc: reloadXref(doc, record.id, record.snapshot, record.snapshot != null), message: `${name} reloaded.`, ...none };
  }
  if ((verb === 'bind' || verb === 'b') && found()) {
    const bound = bindXref(doc, found()!.id, parts[2]?.toLowerCase() === 'insert' ? 'insert' : 'bind', hostLayers);
    return { doc: bound.doc, message: `${name} bound.`, entities: bound.entities, layers: bound.layers };
  }
  if ((verb === 'path' || verb === 'p') && found()) {
    const pathType = parts[3] === 'relative' || parts[3] === 'none' || parts[3] === 'full' ? parts[3] : 'full';
    return { doc: setXrefPath(doc, found()!.id, parts[2] ?? found()!.savedPath, pathType), message: `${name} path updated.`, ...none };
  }
  if (verb === 'attach' || verb === 'overlay' || verb === 'a' || verb === 'o') {
    const path = parts[1] ?? '';
    const base = path.split(/[\\/]/).pop() || 'xref';
    const next = attachXref(doc, { name: base.replace(/\.[^.]+$/, ''), savedPath: path, attachType: verb === 'overlay' || verb === 'o' ? 'overlay' : 'attach', found: false });
    return { doc: next, message: `${base} attached as not found. Use XATTACH to load a file.`, ...none };
  }
  return { doc, message: 'Use ? Bind Detach Path Unload Reload Overlay Attach.', ...none };
}
