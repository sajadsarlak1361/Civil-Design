import type { DrawEntity, DrawLine, DrawPolyline, DrawingDoc, PolyVertex, Vec3 } from './drafting';
import { bulgeArc, entityArea, entityLength, fmt, v3 } from './drafting';
import { colorLabel, parseColorInput } from './aci';
import { linetypeRuns } from './linetypes';
import { lineweightLabel, parseLineweight, type LwUnits } from './lineweights';
import {
  colorText,
  isEntityLocked,
  isModelLocked,
  modelObject,
  polylineWidthArea,
  segmentLength,
  segmentWidths,
  setEntityColor,
  setModelColor,
  type ModelObject,
} from './objects';

export type PropCategory = 'general' | 'geometry' | 'misc';

export interface PropField {
  category: PropCategory;
  key: string;
  label: string;
  kind: 'color' | 'layer' | 'linetype' | 'lineweight' | 'number' | 'text' | 'yesno' | 'enum' | 'readonly';
  options?: string[];
}

const GENERAL: PropField[] = [
  { category: 'general', key: 'color', label: 'Color', kind: 'color' },
  { category: 'general', key: 'layer', label: 'Layer', kind: 'layer' },
  { category: 'general', key: 'linetype', label: 'Linetype', kind: 'linetype' },
  { category: 'general', key: 'linetypeScale', label: 'Linetype scale', kind: 'number' },
  { category: 'general', key: 'plotStyle', label: 'Plot style', kind: 'text' },
  { category: 'general', key: 'lineweight', label: 'Lineweight', kind: 'lineweight' },
  { category: 'general', key: 'transparency', label: 'Transparency', kind: 'number' },
  { category: 'general', key: 'hyperlink', label: 'Hyperlink', kind: 'text' },
  { category: 'general', key: 'thickness', label: 'Thickness', kind: 'number' },
  { category: 'general', key: 'locked', label: 'Locked', kind: 'yesno' },
];

const TYPE_FIELD: PropField = { category: 'general', key: 'type', label: 'Type', kind: 'readonly' };
const NAME_FIELD: PropField = { category: 'general', key: 'name', label: 'Name', kind: 'readonly' };
const MATERIAL: PropField = { category: 'general', key: 'material', label: 'Material', kind: 'text' };

export function objectTypeName(target: DrawEntity | ModelObject): string {
  if (!('type' in target)) {
    return target.kind.split('-').map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part)).join(' ');
  }
  if (target.type === 'polyline') return target.poly3d ? '3D polyline' : 'Polyline';
  if (target.type === 'block') return target.xref ? 'Xref' : 'Block';
  const names: Record<string, string> = {
    line: 'Line',
    circle: 'Circle',
    arc: 'Arc',
    text: 'Text',
    point: 'Point',
    dimension: 'Dimension',
  };
  return names[target.type] ?? target.type;
}

function withMaterial(fields: PropField[], show: boolean): PropField[] {
  if (!show) return fields;
  const next = [...fields];
  const thickness = next.findIndex((field) => field.key === 'thickness');
  next.splice(thickness + 1, 0, MATERIAL);
  return next;
}

export function fieldsFor(target: DrawEntity | ModelObject, options: { vertex?: number } = {}): PropField[] {
  const fields = fieldsOf(target, options);
  return fields.some((field) => field.key === 'type') ? fields : [TYPE_FIELD, ...fields];
}

/** Properties shared by every target. One type keeps its geometry; a mix keeps the common rows. */
export function fieldsForSelection(targets: (DrawEntity | ModelObject)[]): PropField[] {
  if (targets.length === 0) return [];
  const lists = targets.map((target) => fieldsFor(target));
  const first = lists[0];
  const shared = new Map(first.map((field) => [field.key, field]));
  for (const list of lists.slice(1)) {
    const keys = new Set(list.map((field) => field.key));
    for (const key of shared.keys()) if (!keys.has(key)) shared.delete(key);
  }
  return first.filter((field) => shared.has(field.key));
}

function fieldsOf(target: DrawEntity | ModelObject, options: { vertex?: number } = {}): PropField[] {
  if (!('type' in target)) return [NAME_FIELD, ...withMaterial([...GENERAL], false)];
  const entity = target;
  const material = entity.type === 'polyline' && Boolean(entity.poly3d);
  const general = withMaterial(GENERAL, material || (entity.thickness ?? 0) > 0);
  if (entity.type === 'line') {
    return [
      ...general,
      { category: 'geometry', key: 'startX', label: 'Start X', kind: 'number' },
      { category: 'geometry', key: 'startY', label: 'Start Y', kind: 'number' },
      { category: 'geometry', key: 'startZ', label: 'Start Z', kind: 'number' },
      { category: 'geometry', key: 'endX', label: 'End X', kind: 'number' },
      { category: 'geometry', key: 'endY', label: 'End Y', kind: 'number' },
      { category: 'geometry', key: 'endZ', label: 'End Z', kind: 'number' },
      { category: 'geometry', key: 'deltaX', label: 'Delta X', kind: 'readonly' },
      { category: 'geometry', key: 'deltaY', label: 'Delta Y', kind: 'readonly' },
      { category: 'geometry', key: 'deltaZ', label: 'Delta Z', kind: 'readonly' },
      { category: 'geometry', key: 'length', label: 'Length', kind: 'readonly' },
      { category: 'geometry', key: 'angle', label: 'Angle', kind: 'readonly' },
    ];
  }
  if (entity.type === 'polyline') {
    const geometry: PropField[] = [
      { category: 'geometry', key: 'vertex', label: 'Vertex', kind: 'readonly' },
      { category: 'geometry', key: 'vertexX', label: 'Vertex X', kind: 'number' },
      { category: 'geometry', key: 'vertexY', label: 'Vertex Y', kind: 'number' },
    ];
    if (entity.poly3d) {
      geometry.push({ category: 'geometry', key: 'vertexZ', label: 'Vertex Z', kind: 'number' });
    } else {
      geometry.push(
        { category: 'geometry', key: 'startWidth', label: 'Start segment width', kind: 'number' },
        { category: 'geometry', key: 'endWidth', label: 'End segment width', kind: 'number' },
        { category: 'geometry', key: 'globalWidth', label: 'Global width', kind: 'number' },
        { category: 'geometry', key: 'bulge', label: 'Bulge', kind: 'number' },
        { category: 'geometry', key: 'elevation', label: 'Elevation', kind: 'number' },
        { category: 'geometry', key: 'area', label: 'Area', kind: 'readonly' },
      );
    }
    geometry.push({ category: 'geometry', key: 'length', label: 'Length', kind: 'readonly' });
    return [
      ...general,
      ...geometry,
      { category: 'misc', key: 'closed', label: 'Closed', kind: 'yesno' },
      { category: 'misc', key: 'linetypeGeneration', label: 'Linetype generation', kind: 'enum', options: ['Enabled', 'Disabled'] },
    ];
  }
  if (entity.type === 'circle') {
    return [
      ...general,
      { category: 'geometry', key: 'centerX', label: 'Center X', kind: 'number' },
      { category: 'geometry', key: 'centerY', label: 'Center Y', kind: 'number' },
      { category: 'geometry', key: 'centerZ', label: 'Center Z', kind: 'number' },
      { category: 'geometry', key: 'radius', label: 'Radius', kind: 'number' },
      { category: 'geometry', key: 'diameter', label: 'Diameter', kind: 'number' },
      { category: 'geometry', key: 'circumference', label: 'Circumference', kind: 'readonly' },
      { category: 'geometry', key: 'area', label: 'Area', kind: 'readonly' },
    ];
  }
  if (entity.type === 'arc') {
    return [
      ...general,
      { category: 'geometry', key: 'centerX', label: 'Center X', kind: 'number' },
      { category: 'geometry', key: 'centerY', label: 'Center Y', kind: 'number' },
      { category: 'geometry', key: 'centerZ', label: 'Center Z', kind: 'number' },
      { category: 'geometry', key: 'radius', label: 'Radius', kind: 'number' },
      { category: 'geometry', key: 'startAngle', label: 'Start angle', kind: 'number' },
      { category: 'geometry', key: 'endAngle', label: 'End angle', kind: 'number' },
      { category: 'geometry', key: 'length', label: 'Length', kind: 'readonly' },
    ];
  }
  if (entity.type === 'text') {
    return [
      ...general,
      { category: 'geometry', key: 'positionX', label: 'Position X', kind: 'number' },
      { category: 'geometry', key: 'positionY', label: 'Position Y', kind: 'number' },
      { category: 'geometry', key: 'positionZ', label: 'Position Z', kind: 'number' },
      { category: 'geometry', key: 'height', label: 'Height', kind: 'number' },
      { category: 'geometry', key: 'rotation', label: 'Rotation', kind: 'number' },
      { category: 'geometry', key: 'contents', label: 'Contents', kind: 'text' },
    ];
  }
  if (entity.type === 'point') {
    return [
      ...general,
      { category: 'geometry', key: 'positionX', label: 'Position X', kind: 'number' },
      { category: 'geometry', key: 'positionY', label: 'Position Y', kind: 'number' },
      { category: 'geometry', key: 'positionZ', label: 'Position Z', kind: 'number' },
    ];
  }
  if (entity.type === 'block') {
    return [
      ...general,
      { category: 'geometry', key: 'name', label: 'Name', kind: 'readonly' },
      { category: 'geometry', key: 'positionX', label: 'Position X', kind: 'number' },
      { category: 'geometry', key: 'positionY', label: 'Position Y', kind: 'number' },
      { category: 'geometry', key: 'positionZ', label: 'Position Z', kind: 'number' },
      { category: 'geometry', key: 'rotation', label: 'Rotation', kind: 'number' },
      { category: 'geometry', key: 'scale', label: 'Scale', kind: 'number' },
      { category: 'misc', key: 'xref', label: 'Xref', kind: 'yesno' },
    ];
  }
  if (entity.type === 'dimension') {
    return [
      ...general,
      { category: 'geometry', key: 'startX', label: 'Start X', kind: 'number' },
      { category: 'geometry', key: 'startY', label: 'Start Y', kind: 'number' },
      { category: 'geometry', key: 'endX', label: 'End X', kind: 'number' },
      { category: 'geometry', key: 'endY', label: 'End Y', kind: 'number' },
      { category: 'geometry', key: 'contents', label: 'Text', kind: 'text' },
      { category: 'geometry', key: 'length', label: 'Length', kind: 'readonly' },
    ];
  }
  void options;
  return general;
}

export function targetOf(doc: DrawingDoc, id: string): DrawEntity | ModelObject | null {
  return doc.entities.find((entity) => entity.id === id) ?? modelObject(doc, id) ?? null;
}

export function readProp(doc: DrawingDoc, id: string, key: string, vertex = 0, units: LwUnits = 'mm'): string {
  const target = targetOf(doc, id);
  if (!target) return '';
  if (key === 'type') return objectTypeName(target);
  if (key === 'name' && !('type' in target)) return target.name;
  if (!('type' in target)) return readCommon(target, key, units);
  return readEntity(target, key, vertex, units);
}

function readCommon(target: { layer: string; color: string; colorIndex?: number; locked?: boolean; linetype?: string; linetypeScale?: number; lineweight?: number; transparency?: number | 'bylayer'; plotStyle?: string; thickness?: number; hyperlink?: string; material?: string }, key: string, units: LwUnits): string {
  switch (key) {
    case 'color':
      return colorText(target.color, target.colorIndex);
    case 'layer':
      return target.layer;
    case 'linetype':
      return !target.linetype || target.linetype.toLowerCase() === 'bylayer' ? 'ByLayer' : target.linetype;
    case 'linetypeScale':
      return fmt(target.linetypeScale ?? 1, 4);
    case 'plotStyle':
      return target.plotStyle || 'ByLayer';
    case 'lineweight':
      return lineweightLabel(target.lineweight ?? -1, units);
    case 'transparency':
      return target.transparency === undefined || target.transparency === 'bylayer' ? 'ByLayer' : String(target.transparency);
    case 'hyperlink':
      return target.hyperlink || '';
    case 'thickness':
      return fmt(target.thickness ?? 0, 3);
    case 'material':
      return target.material || '';
    case 'locked':
      return target.locked ? 'Yes' : 'No';
    default:
      return '';
  }
}

function vertexAt(entity: DrawPolyline, index: number): PolyVertex {
  const count = entity.vertices.length;
  const wrapped = ((index % count) + count) % count;
  return entity.vertices[wrapped];
}

function readEntity(entity: DrawEntity, key: string, vertex: number, units: LwUnits): string {
  const common = readCommon(entity, key, units);
  if (common || GENERAL.some((field) => field.key === key) || key === 'material' || key === 'locked') return common;
  if (entity.type === 'line') {
    const dx = entity.b.x - entity.a.x;
    const dy = entity.b.y - entity.a.y;
    const dz = entity.b.z - entity.a.z;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const values: Record<string, string> = {
      startX: fmt(entity.a.x),
      startY: fmt(entity.a.y),
      startZ: fmt(entity.a.z),
      endX: fmt(entity.b.x),
      endY: fmt(entity.b.y),
      endZ: fmt(entity.b.z),
      deltaX: fmt(dx),
      deltaY: fmt(dy),
      deltaZ: fmt(dz),
      length: fmt(entityLength(entity)),
      angle: fmt(angle),
    };
    return values[key] ?? '';
  }
  if (entity.type === 'polyline') {
    const current = vertexAt(entity, vertex);
    const widths = segmentWidths(entity, vertex);
    if (key === 'vertex') return String(vertex + 1);
    if (key === 'vertexX') return fmt(current.x);
    if (key === 'vertexY') return fmt(current.y);
    if (key === 'vertexZ') return fmt(current.z);
    if (key === 'startWidth') return fmt(widths.start);
    if (key === 'endWidth') return fmt(widths.end);
    if (key === 'globalWidth') return fmt(entity.globalWidth ?? 0);
    if (key === 'bulge') return fmt(current.bulge || 0, 6);
    if (key === 'elevation') return fmt(entity.elevation ?? current.z);
    if (key === 'area') return fmt(entityArea(entity) ?? 0);
    if (key === 'length') return fmt(entityLength(entity));
    if (key === 'closed') return entity.closed ? 'Yes' : 'No';
    if (key === 'linetypeGeneration') return entity.linetypeGeneration ? 'Enabled' : 'Disabled';
    return '';
  }
  if (entity.type === 'circle' || entity.type === 'arc') {
    if (key === 'centerX') return fmt(entity.center.x);
    if (key === 'centerY') return fmt(entity.center.y);
    if (key === 'centerZ') return fmt(entity.center.z);
    if (key === 'radius') return fmt(entity.radius);
    if (key === 'diameter') return fmt(entity.radius * 2);
    if (key === 'circumference' || key === 'length') return fmt(entityLength(entity));
    if (key === 'area') return fmt(entityArea(entity) ?? 0);
    if (entity.type === 'arc' && key === 'startAngle') return fmt((entity.startAngle * 180) / Math.PI);
    if (entity.type === 'arc' && key === 'endAngle') return fmt((entity.endAngle * 180) / Math.PI);
    return '';
  }
  if (entity.type === 'point' || entity.type === 'text' || entity.type === 'block') {
    const point = entity.type === 'block' ? entity.p : entity.p;
    if (key === 'positionX') return fmt(point.x);
    if (key === 'positionY') return fmt(point.y);
    if (key === 'positionZ') return fmt(point.z);
    if (entity.type === 'text' && key === 'height') return fmt(entity.height);
    if (entity.type === 'text' && key === 'rotation') return fmt((entity.rotation * 180) / Math.PI);
    if (entity.type === 'text' && key === 'contents') return entity.content;
    if (entity.type === 'block' && key === 'name') return entity.name;
    if (entity.type === 'block' && key === 'rotation') return fmt((entity.rotation * 180) / Math.PI);
    if (entity.type === 'block' && key === 'scale') return fmt(entity.scale);
    if (entity.type === 'block' && key === 'xref') return entity.xref ? 'Yes' : 'No';
    return '';
  }
  if (entity.type === 'dimension') {
    if (key === 'startX') return fmt(entity.p1.x);
    if (key === 'startY') return fmt(entity.p1.y);
    if (key === 'endX') return fmt(entity.p2.x);
    if (key === 'endY') return fmt(entity.p2.y);
    if (key === 'contents') return entity.text;
    if (key === 'length') return fmt(entity.measurement);
  }
  return '';
}

const GEOMETRY_KEYS = new Set([
  'startX', 'startY', 'startZ', 'endX', 'endY', 'endZ', 'vertexX', 'vertexY', 'vertexZ',
  'startWidth', 'endWidth', 'globalWidth', 'bulge', 'elevation', 'closed', 'centerX', 'centerY', 'centerZ',
  'radius', 'diameter', 'startAngle', 'endAngle', 'positionX', 'positionY', 'positionZ', 'height', 'rotation',
  'scale', 'contents',
]);

export function writeProp(doc: DrawingDoc, id: string, key: string, raw: string, vertex = 0): string | null {
  const entity = doc.entities.find((item) => item.id === id);
  if (entity) {
    if (isEntityLocked(doc, entity) && key !== 'locked') return '1 object is locked.';
    return writeEntity(entity, key, raw, vertex);
  }
  const object = modelObject(doc, id);
  if (!object) return 'Object not found.';
  if (isModelLocked(doc, id) && key !== 'locked') return '1 object is locked.';
  return writeCommon(object, key, raw);
}

function writeCommon(target: DrawEntity | ModelObject, key: string, raw: string): string | null {
  if (key === 'color') {
    const parsed = parseColorInput(raw);
    if (!parsed) return 'Color must be ByLayer, ByBlock, an ACI index, or a #hex color.';
    if ('type' in target) setEntityColor(target, parsed);
    else setModelColor(target, parsed);
    return null;
  }
  if (key === 'layer') {
    const name = raw.trim();
    if (!name) return 'Layer name required.';
    target.layer = name;
    return null;
  }
  if (key === 'linetype') {
    target.linetype = raw.trim() || 'bylayer';
    return null;
  }
  if (key === 'linetypeScale') {
    const value = Number(raw);
    if (!(value > 0)) return 'Linetype scale must be positive.';
    target.linetypeScale = value;
    return null;
  }
  if (key === 'plotStyle') {
    target.plotStyle = raw.trim() || 'ByLayer';
    return null;
  }
  if (key === 'lineweight') {
    const value = parseLineweight(raw);
    if (value === null) return 'Lineweight must be ByLayer, ByBlock, Default, or a millimetre value.';
    target.lineweight = value;
    return null;
  }
  if (key === 'transparency') {
    if (raw.trim().toLowerCase() === 'bylayer') {
      target.transparency = 'bylayer';
      return null;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 90) return 'Transparency must be ByLayer or 0–90.';
    target.transparency = value;
    return null;
  }
  if (key === 'hyperlink') {
    target.hyperlink = raw.trim();
    return null;
  }
  if (key === 'thickness') {
    const value = Number(raw);
    if (!Number.isFinite(value)) return 'Thickness must be a number.';
    target.thickness = value;
    return null;
  }
  if (key === 'material') {
    target.material = raw.trim();
    return null;
  }
  if (key === 'locked') {
    target.locked = /^y/i.test(raw.trim()) || raw.trim() === '1';
    return null;
  }
  return 'Unknown property.';
}

function num(raw: string): number | null {
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function writeEntity(entity: DrawEntity, key: string, raw: string, vertex: number): string | null {
  if (!GEOMETRY_KEYS.has(key) && key !== 'linetypeGeneration' && key !== 'xref') return writeCommon(entity, key, raw);
  if (entity.type === 'line') return writeLine(entity, key, raw);
  if (entity.type === 'polyline') return writePolyline(entity, key, raw, vertex);
  if (entity.type === 'circle' || entity.type === 'arc') return writeCurve(entity, key, raw);
  if (entity.type === 'point' || entity.type === 'text') return writePointLike(entity, key, raw);
  if (entity.type === 'block') return writeBlock(entity, key, raw);
  if (entity.type === 'dimension') return writeDimension(entity, key, raw);
  return writeCommon(entity, key, raw);
}

function writePoint(point: Vec3, key: string, raw: string, axes: Record<string, 'x' | 'y' | 'z'>): string | null {
  const axis = axes[key];
  if (!axis) return 'Unknown property.';
  const value = num(raw);
  if (value === null) return 'Requires a number.';
  point[axis] = value;
  return null;
}

function writeLine(entity: DrawLine, key: string, raw: string): string | null {
  if (key.startsWith('start')) return writePoint(entity.a, key, raw, { startX: 'x', startY: 'y', startZ: 'z' });
  if (key.startsWith('end')) return writePoint(entity.b, key, raw, { endX: 'x', endY: 'y', endZ: 'z' });
  return 'Unknown property.';
}

function writePolyline(entity: DrawPolyline, key: string, raw: string, vertex: number): string | null {
  const current = entity.vertices[Math.max(0, Math.min(vertex, entity.vertices.length - 1))];
  if (!current) return 'No vertex.';
  if (key === 'vertexX' || key === 'vertexY' || key === 'vertexZ') {
    return writePoint(current, key, raw, { vertexX: 'x', vertexY: 'y', vertexZ: 'z' });
  }
  if (key === 'startWidth' || key === 'endWidth') {
    const value = num(raw);
    if (value === null || value < 0) return 'Width must be zero or positive.';
    if (key === 'startWidth') current.startWidth = value;
    else current.endWidth = value;
    return null;
  }
  if (key === 'globalWidth') {
    const value = num(raw);
    if (value === null || value < 0) return 'Width must be zero or positive.';
    entity.globalWidth = value;
    for (const item of entity.vertices) {
      item.startWidth = value;
      item.endWidth = value;
    }
    return null;
  }
  if (key === 'bulge') {
    const value = num(raw);
    if (value === null) return 'Bulge must be a number.';
    current.bulge = value;
    return null;
  }
  if (key === 'elevation') {
    const value = num(raw);
    if (value === null) return 'Elevation must be a number.';
    entity.elevation = value;
    for (const item of entity.vertices) item.z = value;
    return null;
  }
  if (key === 'closed') {
    entity.closed = /^y/i.test(raw.trim());
    return null;
  }
  if (key === 'linetypeGeneration') {
    entity.linetypeGeneration = /^e/i.test(raw.trim()) || raw.trim().toLowerCase() === 'yes';
    return null;
  }
  return 'Unknown property.';
}

function writeCurve(entity: Extract<DrawEntity, { type: 'circle' | 'arc' }>, key: string, raw: string): string | null {
  if (key === 'centerX' || key === 'centerY' || key === 'centerZ') {
    return writePoint(entity.center, key, raw, { centerX: 'x', centerY: 'y', centerZ: 'z' });
  }
  if (key === 'radius' || key === 'diameter') {
    const value = num(raw);
    if (value === null || value <= 0) return 'Radius must be positive.';
    entity.radius = key === 'diameter' ? value / 2 : value;
    return null;
  }
  if (entity.type === 'arc' && (key === 'startAngle' || key === 'endAngle')) {
    const value = num(raw);
    if (value === null) return 'Angle must be a number.';
    const radians = (value * Math.PI) / 180;
    if (key === 'startAngle') entity.startAngle = radians;
    else entity.endAngle = radians;
    return null;
  }
  return 'Unknown property.';
}

function writePointLike(entity: Extract<DrawEntity, { type: 'point' | 'text' }>, key: string, raw: string): string | null {
  if (key === 'positionX' || key === 'positionY' || key === 'positionZ') {
    return writePoint(entity.p, key, raw, { positionX: 'x', positionY: 'y', positionZ: 'z' });
  }
  if (entity.type === 'text' && key === 'height') {
    const value = num(raw);
    if (value === null || value <= 0) return 'Height must be positive.';
    entity.height = value;
    return null;
  }
  if (entity.type === 'text' && key === 'rotation') {
    const value = num(raw);
    if (value === null) return 'Rotation must be a number.';
    entity.rotation = (value * Math.PI) / 180;
    return null;
  }
  if (entity.type === 'text' && key === 'contents') {
    entity.content = raw;
    return null;
  }
  return 'Unknown property.';
}

function writeBlock(entity: Extract<DrawEntity, { type: 'block' }>, key: string, raw: string): string | null {
  if (key === 'positionX' || key === 'positionY' || key === 'positionZ') {
    return writePoint(entity.p, key, raw, { positionX: 'x', positionY: 'y', positionZ: 'z' });
  }
  if (key === 'rotation') {
    const value = num(raw);
    if (value === null) return 'Rotation must be a number.';
    entity.rotation = (value * Math.PI) / 180;
    return null;
  }
  if (key === 'scale') {
    const value = num(raw);
    if (value === null || value === 0) return 'Scale must be non-zero.';
    entity.scale = value;
    return null;
  }
  if (key === 'xref') {
    entity.xref = /^y/i.test(raw.trim());
    return null;
  }
  return 'Unknown property.';
}

function writeDimension(entity: Extract<DrawEntity, { type: 'dimension' }>, key: string, raw: string): string | null {
  if (key.startsWith('start')) return writePoint(entity.p1, key, raw, { startX: 'x', startY: 'y', startZ: 'z' });
  if (key.startsWith('end')) return writePoint(entity.p2, key, raw, { endX: 'x', endY: 'y', endZ: 'z' });
  if (key === 'contents') {
    entity.text = raw;
    return null;
  }
  return 'Unknown property.';
}

export const VARIES = '*VARIES*';

export function commonValue(doc: DrawingDoc, ids: string[], key: string, vertex = 0): string {
  const values = ids.map((id) => readProp(doc, id, key, vertex)).filter((_, index) => targetOf(doc, ids[index]));
  if (values.length === 0) return '';
  return values.every((value) => value === values[0]) ? values[0] : VARIES;
}

export function listText(doc: DrawingDoc, entity: DrawEntity): string[] {
  const lines = [
    `${entity.type === 'polyline' && entity.poly3d ? 'POLYLINE' : entity.type === 'block' && entity.xref ? 'XREF' : entity.type.toUpperCase()}  Layer: "${entity.layer}"`,
    `Color: ${colorLabel(entity.color, entity.colorIndex)}    Linetype: ${!entity.linetype || entity.linetype === 'bylayer' ? 'ByLayer' : entity.linetype}`,
    `Lineweight: ${lineweightLabel(entity.lineweight ?? -1)}    Transparency: ${entity.transparency === undefined || entity.transparency === 'bylayer' ? 'ByLayer' : entity.transparency}`,
    `Locked: ${entity.locked ? 'Yes' : 'No'}`,
    `LTSCALE ${fmt(doc.linetypeScale, 4)}`,
  ];
  if (entity.type === 'line') {
    lines.push(`from point, X= ${fmt(entity.a.x)}  Y= ${fmt(entity.a.y)}  Z= ${fmt(entity.a.z)}`);
    lines.push(`to point, X= ${fmt(entity.b.x)}  Y= ${fmt(entity.b.y)}  Z= ${fmt(entity.b.z)}`);
    lines.push(`Length = ${fmt(entityLength(entity))}, Angle in XY Plane = ${fmt((Math.atan2(entity.b.y - entity.a.y, entity.b.x - entity.a.x) * 180) / Math.PI)}`);
    lines.push(`Delta X = ${fmt(entity.b.x - entity.a.x)}, Delta Y = ${fmt(entity.b.y - entity.a.y)}, Delta Z = ${fmt(entity.b.z - entity.a.z)}`);
  } else if (entity.type === 'polyline') {
    lines.push(`${entity.closed ? 'Closed' : 'Open'}  vertices ${entity.vertices.length}`);
    lines.push(`length ${fmt(entityLength(entity))}`);
    const area = entityArea(entity);
    if (area !== null && !entity.poly3d) lines.push(`area ${fmt(area)}`);
    lines.push(`global width ${fmt(entity.globalWidth ?? 0)}`);
    lines.push(`linetype generation ${entity.linetypeGeneration ? 'Enabled' : 'Disabled'}`);
    const runs = linetypeRuns(entity.closed ? entity.vertices.length : Math.max(0, entity.vertices.length - 1), Boolean(entity.linetypeGeneration));
    lines.push(`pattern runs ${runs}`);
    if ((entity.globalWidth ?? 0) > 0 || entity.vertices.some((item) => (item.startWidth ?? 0) > 0 || (item.endWidth ?? 0) > 0)) {
      lines.push(`width area ${fmt(polylineWidthArea(entity))}`);
    }
  } else if (entity.type === 'circle') {
    lines.push(`center point, X= ${fmt(entity.center.x)}  Y= ${fmt(entity.center.y)}  Z= ${fmt(entity.center.z)}`);
    lines.push(`radius ${fmt(entity.radius)}`);
    lines.push(`circumference ${fmt(entityLength(entity))}`);
    lines.push(`area ${fmt(Math.PI * entity.radius * entity.radius)}`);
  } else if (entity.type === 'point' || entity.type === 'text' || entity.type === 'block') {
    lines.push(`at point, X= ${fmt(entity.p.x)}  Y= ${fmt(entity.p.y)}  Z= ${fmt(entity.p.z)}`);
    if (entity.type === 'text') lines.push(`text ${entity.content}`);
    if (entity.type === 'block') lines.push(`${entity.xref ? 'xref' : 'block'} ${entity.name}`);
  } else if (entity.type === 'dimension') {
    lines.push(`${entity.kind}  measurement ${fmt(entity.measurement)}  style ${entity.style}`);
    lines.push(`from point, X= ${fmt(entity.p1.x)}  Y= ${fmt(entity.p1.y)}  Z= ${fmt(entity.p1.z)}`);
    lines.push(`to point, X= ${fmt(entity.p2.x)}  Y= ${fmt(entity.p2.y)}  Z= ${fmt(entity.p2.z)}`);
  }
  return lines;
}

export function matchProperties(source: DrawEntity | ModelObject, target: DrawEntity | ModelObject): void {
  target.color = source.color;
  target.colorIndex = source.colorIndex;
  target.layer = source.layer;
  target.linetype = source.linetype;
  target.linetypeScale = source.linetypeScale;
  target.lineweight = source.lineweight;
  target.transparency = source.transparency;
  target.thickness = source.thickness;
  target.plotStyle = source.plotStyle;
}

export interface QuickQuery {
  kind: string;
  property: 'color' | 'layer' | 'linetype' | 'locked' | 'name';
  operator: '=' | '<>' | '*';
  value: string;
}

export function matchQuery(target: DrawEntity | ModelObject, query: QuickQuery): boolean {
  const kind = 'type' in target ? (target.type === 'block' && target.xref ? 'xref' : target.type) : target.kind;
  if (query.kind !== '*' && query.kind !== kind) return false;
  let value = '';
  if (query.property === 'color') value = colorLabel(target.color, target.colorIndex);
  else if (query.property === 'layer') value = target.layer;
  else if (query.property === 'linetype') value = target.linetype || 'ByLayer';
  else if (query.property === 'locked') value = target.locked ? 'Yes' : 'No';
  else value = 'type' in target ? target.type : target.name;
  if (query.operator === '*') return true;
  const same = value.toLowerCase() === query.value.trim().toLowerCase();
  return query.operator === '=' ? same : !same;
}

export function selectByQuery(doc: DrawingDoc, query: QuickQuery): string[] {
  const ids: string[] = [];
  for (const entity of doc.entities) if (matchQuery(entity, query)) ids.push(entity.id);
  for (const object of doc.objects ?? []) if (matchQuery(object, query)) ids.push(object.key);
  return ids;
}

export function polylineSegmentCount(entity: DrawPolyline): number {
  if (entity.vertices.length < 2) return 0;
  return entity.closed ? entity.vertices.length : entity.vertices.length - 1;
}

export function patternRuns(entity: DrawPolyline): number {
  return linetypeRuns(polylineSegmentCount(entity), Boolean(entity.linetypeGeneration));
}

export function widthRibbon(a: PolyVertex, b: PolyVertex, startWidth: number, endWidth: number, steps = 8): Vec3[] {
  const length = segmentLength(a, b);
  const arc = bulgeArc(a, b, a.bulge || 0);
  const left: Vec3[] = [];
  const right: Vec3[] = [];
  const count = arc ? steps : 1;
  for (let step = 0; step <= count; step += 1) {
    const t = step / count;
    let x: number;
    let y: number;
    let z: number;
    let tx: number;
    let ty: number;
    if (!arc) {
      x = a.x + (b.x - a.x) * t;
      y = a.y + (b.y - a.y) * t;
      z = a.z + (b.z - a.z) * t;
      const hypot = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      tx = (b.x - a.x) / hypot;
      ty = (b.y - a.y) / hypot;
    } else {
      const angle = arc.startAngle + (arc.endAngle - arc.startAngle) * t;
      x = arc.center.x + Math.cos(angle) * arc.radius;
      y = arc.center.y + Math.sin(angle) * arc.radius;
      z = a.z + (b.z - a.z) * t;
      const sweep = arc.endAngle - arc.startAngle;
      tx = -Math.sin(angle) * Math.sign(sweep || 1);
      ty = Math.cos(angle) * Math.sign(sweep || 1);
    }
    const width = startWidth + (endWidth - startWidth) * (length === 0 ? 0 : t);
    const nx = -ty * (width / 2);
    const ny = tx * (width / 2);
    left.push(v3(x + nx, y + ny, z));
    right.push(v3(x - nx, y - ny, z));
  }
  return [...left, ...right.reverse()];
}
