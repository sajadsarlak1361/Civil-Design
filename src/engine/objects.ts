import type { DrawingDoc, DrawEntity, DrawPolyline, PolyVertex } from './drafting';
import { bulgeArc, layerOf } from './drafting';
import { colorLabel, parseColorInput, resolvePaint, type ParsedColor } from './aci';
import { copyStyle, type EntityStyle } from './entityStyle';
import { findLayer, shouldDraw } from './layers';
import { LINEWEIGHT_BYLAYER, LINEWEIGHT_DEFAULT } from './lineweights';

export type { EntityStyle };
export { copyStyle };

export interface ModelObject extends EntityStyle {
  key: string;
  kind: string;
  name: string;
  layer: string;
  color: string;
}

export interface CatalogEntry {
  key: string;
  kind: string;
  name: string;
  layer: string;
}

export const OBJECT_KINDS = [
  'point',
  'line',
  'polyline',
  'circle',
  'arc',
  'text',
  'block',
  'xref',
  'dimension',
  'surface',
  'contour',
  'cogo-point',
  'alignment',
  'profile',
  'profile-view',
  'sample-line',
  'section-view',
  'corridor',
  'assembly',
  'feature-line',
  'grading',
  'parcel',
  'pipe-network',
  'pressure-network',
  'intersection',
] as const;

export function defaultModelObject(entry: CatalogEntry): ModelObject {
  return {
    key: entry.key,
    kind: entry.kind,
    name: entry.name,
    layer: entry.layer,
    color: 'bylayer',
    locked: false,
    linetype: 'bylayer',
    linetypeScale: 1,
    lineweight: LINEWEIGHT_BYLAYER,
    transparency: 'bylayer',
    plotStyle: 'ByLayer',
    thickness: 0,
    hyperlink: '',
    material: '',
  };
}

/** Add missing catalog rows and drop rows whose objects are gone. Keeps color and lock. */
export function syncObjects(doc: DrawingDoc, entries: CatalogEntry[]): boolean {
  const previous = new Map((doc.objects ?? []).map((object) => [object.key, object]));
  const next = entries.map((entry) => {
    const existing = previous.get(entry.key);
    if (!existing) return defaultModelObject(entry);
    existing.kind = entry.kind;
    existing.name = entry.name;
    return existing;
  });
  const same =
    next.length === (doc.objects ?? []).length &&
    next.every((object, index) => object === (doc.objects ?? [])[index]);
  if (same) return false;
  doc.objects = next;
  return true;
}

export function modelObject(doc: DrawingDoc, key: string): ModelObject | undefined {
  return (doc.objects ?? []).find((object) => object.key === key);
}

export function isEntityLocked(doc: DrawingDoc, entity: DrawEntity): boolean {
  if (entity.locked) return true;
  const layer = layerOf(doc, entity);
  return Boolean(layer?.locked);
}

export function isModelLocked(doc: DrawingDoc, key: string): boolean {
  const object = modelObject(doc, key);
  if (!object) return false;
  if (object.locked) return true;
  return Boolean(findLayer(doc, object.layer)?.locked);
}

export function lockMessage(count: number): string {
  return count === 1 ? '1 object is locked.' : `${count} objects are locked.`;
}

export function partitionEditable(doc: DrawingDoc, ids: string[]): { editable: string[]; locked: number } {
  const editable: string[] = [];
  let locked = 0;
  for (const id of ids) {
    const entity = doc.entities.find((item) => item.id === id);
    if (entity) {
      if (isEntityLocked(doc, entity)) locked += 1;
      else editable.push(id);
      continue;
    }
    if (modelObject(doc, id)) {
      if (isModelLocked(doc, id)) locked += 1;
      else editable.push(id);
      continue;
    }
  }
  return { editable, locked };
}

export function setEntityColor(entity: DrawEntity, parsed: ParsedColor): void {
  entity.color = parsed.color;
  if (parsed.colorIndex) entity.colorIndex = parsed.colorIndex;
  else delete entity.colorIndex;
}

export function setModelColor(object: ModelObject, parsed: ParsedColor): void {
  object.color = parsed.color;
  if (parsed.colorIndex) object.colorIndex = parsed.colorIndex;
  else delete object.colorIndex;
}

export function applyColorToIds(doc: DrawingDoc, ids: string[], raw: string): { applied: number; locked: number; error: string | null } {
  const parsed = parseColorInput(raw);
  if (!parsed) return { applied: 0, locked: 0, error: 'Color must be ByLayer, ByBlock, an ACI index, or a #hex color.' };
  let applied = 0;
  let locked = 0;
  for (const id of ids) {
    const entity = doc.entities.find((item) => item.id === id);
    if (entity) {
      if (isEntityLocked(doc, entity)) {
        locked += 1;
        continue;
      }
      setEntityColor(entity, parsed);
      applied += 1;
      continue;
    }
    const object = modelObject(doc, id);
    if (!object) continue;
    if (isModelLocked(doc, id)) {
      locked += 1;
      continue;
    }
    setModelColor(object, parsed);
    applied += 1;
  }
  return { applied, locked, error: null };
}

export function setLockedIds(doc: DrawingDoc, ids: string[], locked: boolean): number {
  let count = 0;
  for (const id of ids) {
    const entity = doc.entities.find((item) => item.id === id);
    if (entity) {
      entity.locked = locked;
      count += 1;
      continue;
    }
    const object = modelObject(doc, id);
    if (object) {
      object.locked = locked;
      count += 1;
    }
  }
  return count;
}

export function entityPaint(doc: DrawingDoc, entity: DrawEntity): { color: string; alpha: number; lineweight: number; linetype: string; scale: number } {
  const layer = layerOf(doc, entity);
  const color = resolvePaint(entity.color, layer?.color ?? '#ffffff');
  const transparency = entity.transparency === undefined || entity.transparency === 'bylayer' ? (layer?.transparency ?? 0) : entity.transparency;
  const objectAlpha = 1 - Math.min(90, Math.max(0, transparency)) / 100;
  const weight = entity.lineweight === undefined || entity.lineweight === LINEWEIGHT_BYLAYER ? (layer?.lineWeight ?? LINEWEIGHT_DEFAULT) : entity.lineweight;
  const linetype = !entity.linetype || entity.linetype.toLowerCase() === 'bylayer' ? (layer?.lineType ?? 'Continuous') : entity.linetype;
  return {
    color,
    alpha: objectAlpha,
    lineweight: weight,
    linetype,
    scale: (entity.linetypeScale ?? 1) * (doc.linetypeScale || 1),
  };
}

export function objectPaint(doc: DrawingDoc, object: ModelObject): { hidden: boolean; color: string; override: boolean; alpha: number } {
  const layer = findLayer(doc, object.layer);
  const hidden = !shouldDraw(layer);
  const override = Boolean(object.color && object.color !== 'bylayer');
  const color = resolvePaint(object.color, layer?.color ?? '#ffffff');
  const transparency = object.transparency === undefined || object.transparency === 'bylayer' ? (layer?.transparency ?? 0) : object.transparency;
  return { hidden, color, override, alpha: 1 - Math.min(90, Math.max(0, transparency)) / 100 };
}

export function colorText(color: string, colorIndex?: number): string {
  return colorLabel(color, colorIndex);
}

export function segmentWidths(entity: DrawPolyline, index: number): { start: number; end: number } {
  const vertex = entity.vertices[index];
  const global = entity.globalWidth ?? 0;
  return {
    start: vertex?.startWidth ?? global,
    end: vertex?.endWidth ?? global,
  };
}

/** Area of the filled width ribbon. A constant width is length × width. */
export function polylineWidthArea(entity: DrawPolyline): number {
  const count = entity.vertices.length;
  const segments = entity.closed ? count : count - 1;
  let area = 0;
  for (let index = 0; index < segments; index += 1) {
    const a = entity.vertices[index];
    const b = entity.vertices[(index + 1) % count];
    const widths = segmentWidths(entity, index);
    area += segmentLength(a, b) * ((widths.start + widths.end) / 2);
  }
  return area;
}

export function segmentLength(a: PolyVertex, b: PolyVertex): number {
  const arc = bulgeArc(a, b, a.bulge || 0);
  if (!arc) return Math.hypot(b.x - a.x, b.y - a.y);
  return Math.abs(arc.endAngle - arc.startAngle) * arc.radius;
}

export function defaultLayerForKind(kind: string): string {
  switch (kind) {
    case 'surface':
    case 'contour':
      return 'C-TOPO';
    case 'alignment':
    case 'profile':
    case 'profile-view':
    case 'sample-line':
    case 'section-view':
      return 'C-ROAD';
    case 'corridor':
    case 'assembly':
      return 'C-CORR';
    case 'feature-line':
      return 'C-FEAT';
    case 'grading':
      return 'C-GRADING';
    case 'parcel':
      return 'C-PARCEL';
    case 'pipe-network':
      return 'C-PIPE';
    case 'pressure-network':
      return 'C-PRESS';
    case 'cogo-point':
      return 'C-PNT';
    default:
      return '0';
  }
}
