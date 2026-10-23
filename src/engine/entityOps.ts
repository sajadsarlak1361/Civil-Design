import type { CadLibrary } from './cadLibrary';
import { effectiveDimStyle } from './cadLibrary';
import {
  isCadShape,
  type CadShape,
  type DrawArray,
  type DrawDimension,
  type DrawEllipse,
  type DrawHatch,
  type DrawSpline,
  type Xyz,
} from './cadShapes';
import { bulgePoints, cvSpline, ellipsePoint, ellipsePoints, fitSpline, type Xy } from './curves';
import { dimensionGeometry } from './dimension';
import { copyStyle, type EntityStyle } from './entityStyle';
import type { DrawEntity, DrawingDoc, Vec3 } from './drafting';

function xyz(p: Xy | Vec3 | Xyz): Xyz {
  return { x: p.x, y: p.y, z: p.z ?? 0 };
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asPoint(value: unknown): Xyz | null {
  if (!value || typeof value !== 'object') return null;
  const point = value as Xyz;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return { x: point.x, y: point.y, z: Number.isFinite(point.z) ? point.z : 0 };
}

type CadStyle = { id: string; layer: string; color: string; lineType?: string; lineWeight?: number | 'bylayer' } & EntityStyle;

function styleOf(raw: { id?: unknown; layer?: unknown; color?: unknown; lineType?: unknown; lineWeight?: unknown }): CadStyle | null {
  if (typeof raw.id !== 'string' || !raw.id) return null;
  const style: CadStyle = {
    ...copyStyle(raw),
    id: raw.id,
    layer: typeof raw.layer === 'string' ? raw.layer : '0',
    color: typeof raw.color === 'string' ? raw.color : 'bylayer',
  };
  if (typeof raw.lineType === 'string') style.lineType = raw.lineType;
  if (typeof raw.lineWeight === 'number' || raw.lineWeight === 'bylayer') style.lineWeight = raw.lineWeight;
  return style;
}

function pointsOf(value: unknown): Xyz[] | null {
  if (!Array.isArray(value)) return null;
  const points: Xyz[] = [];
  for (const item of value) {
    const point = asPoint(item);
    if (!point) return null;
    points.push(point);
  }
  return points;
}

export function parseCadEntity(value: unknown): DrawEntity | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as CadShape;
  const style = styleOf(raw);
  if (!style || !isCadShape(raw)) return null;
  if (raw.type === 'ellipse') {
    const center = asPoint(raw.center);
    const major = asPoint(raw.major);
    if (!center || !major) return null;
    return { ...style, type: 'ellipse', center, major, ratio: num(raw.ratio, 0.5) || 0.5, start: num(raw.start), end: num(raw.end, Math.PI * 2) };
  }
  if (raw.type === 'spline') {
    const points = pointsOf(raw.points);
    if (!points || points.length < 2) return null;
    return { ...style, type: 'spline', mode: raw.mode === 'cv' ? 'cv' : 'fit', points, closed: Boolean(raw.closed), degree: num(raw.degree, 3) || 3 };
  }
  if (raw.type === 'hatch') {
    const loops = Array.isArray(raw.loops) ? raw.loops.map((loop) => pointsOf(loop) ?? []).filter((loop) => loop.length >= 3) : [];
    if (loops.length === 0) return null;
    return {
      ...style,
      type: 'hatch',
      pattern: typeof raw.pattern === 'string' ? raw.pattern : 'ANSI31',
      scale: num(raw.scale, 1) || 1,
      angle: num(raw.angle),
      associative: raw.associative !== false,
      gradient: raw.gradient && typeof raw.gradient === 'object' ? raw.gradient : null,
      loops,
      holes: Array.isArray(raw.holes) ? raw.holes.filter((item) => typeof item === 'number') : [],
      sourceIds: Array.isArray(raw.sourceIds) ? raw.sourceIds.filter((id): id is string => typeof id === 'string') : [],
    };
  }
  if (raw.type === 'region') {
    const loops = Array.isArray(raw.loops) ? raw.loops.map((loop) => pointsOf(loop) ?? []).filter((loop) => loop.length >= 3) : [];
    if (loops.length === 0) return null;
    return { ...style, type: 'region', loops };
  }
  if (raw.type === 'xline' || raw.type === 'ray') {
    const a = asPoint(raw.a);
    const b = asPoint(raw.b);
    return a && b ? { ...style, type: raw.type, a, b } : null;
  }
  if (raw.type === 'wipeout') {
    const vertices = pointsOf(raw.vertices);
    return vertices && vertices.length >= 3 ? { ...style, type: 'wipeout', vertices } : null;
  }
  if (raw.type === 'revcloud') {
    const vertices = Array.isArray(raw.vertices)
      ? raw.vertices.flatMap((vertex) => {
          const point = asPoint(vertex);
          return point ? [{ ...point, bulge: num((vertex as { bulge?: number }).bulge) }] : [];
        })
      : [];
    return vertices.length >= 2 ? { ...style, type: 'revcloud', vertices, closed: raw.closed !== false } : null;
  }
  if (raw.type === 'donut') {
    const center = asPoint(raw.center);
    return center && num(raw.outer) > 0 ? { ...style, type: 'donut', center, inner: Math.max(0, num(raw.inner)), outer: num(raw.outer) } : null;
  }
  if (raw.type === 'mtext') {
    const p = asPoint(raw.p);
    return p && typeof raw.content === 'string'
      ? { ...style, type: 'mtext', p, width: num(raw.width, 20), height: num(raw.height, 2.5) || 2.5, rotation: num(raw.rotation), content: raw.content, style: typeof raw.style === 'string' ? raw.style : 'Standard', attachment: num(raw.attachment, 1) }
      : null;
  }
  if (raw.type === 'dimension') {
    const p1 = asPoint(raw.p1);
    const p2 = asPoint(raw.p2);
    const p3 = asPoint(raw.p3);
    const loc = asPoint(raw.loc);
    if (!p1 || !p2 || !p3 || !loc) return null;
    return {
      ...style,
      type: 'dimension',
      kind: raw.kind,
      style: typeof raw.style === 'string' ? raw.style : 'Standard',
      p1, p2, p3, loc,
      text: typeof raw.text === 'string' ? raw.text : '',
      textAngle: num(raw.textAngle),
      oblique: num(raw.oblique),
      measurement: num(raw.measurement),
      horizontal: raw.horizontal !== false,
      jog: Boolean(raw.jog),
      inspection: raw.inspection && typeof raw.inspection === 'object' ? { label: String(raw.inspection.label ?? ''), rate: String(raw.inspection.rate ?? '') } : null,
      breaks: Array.isArray(raw.breaks) ? raw.breaks.filter((item) => typeof item === 'number') : [],
      overrides: raw.overrides && typeof raw.overrides === 'object' ? raw.overrides : {},
      assoc: Array.isArray(raw.assoc) ? raw.assoc.filter((item) => item && typeof item.id === 'string') : [],
      offset: num(raw.offset),
      justify: raw.justify === 'left' || raw.justify === 'right' ? raw.justify : 'center',
      civil: raw.civil === 'station' || raw.civil === 'offset' || raw.civil === 'slope' ? raw.civil : '',
      textShift: raw.textShift && typeof raw.textShift === 'object' ? { along: num(raw.textShift.along), across: num(raw.textShift.across) } : null,
    };
  }
  if (raw.type === 'mleader') {
    const textPos = asPoint(raw.textPos);
    const leaders = Array.isArray(raw.leaders) ? raw.leaders.map((leader) => pointsOf(leader) ?? []).filter((leader) => leader.length > 0) : [];
    return textPos ? { ...style, type: 'mleader', style: typeof raw.style === 'string' ? raw.style : 'Standard', leaders, text: typeof raw.text === 'string' ? raw.text : '', textPos, dogleg: num(raw.dogleg, 2) } : null;
  }
  if (raw.type === 'table') {
    const p = asPoint(raw.p);
    return p
      ? { ...style, type: 'table', p, style: typeof raw.style === 'string' ? raw.style : 'Standard', cols: Math.max(1, num(raw.cols, 1)), rows: Math.max(1, num(raw.rows, 1)), colWidth: num(raw.colWidth, 20) || 20, rowHeight: num(raw.rowHeight, 6) || 6, cells: Array.isArray(raw.cells) ? raw.cells.map((cell) => String(cell)) : [] }
      : null;
  }
  if (raw.type === 'insert') {
    const p = asPoint(raw.p);
    if (!p || typeof raw.name !== 'string') return null;
    const attributes = Array.isArray(raw.attributes)
      ? raw.attributes.flatMap((attr) => {
          const at = asPoint(attr.p);
          if (!at || typeof attr.tag !== 'string') return [];
          return [{ tag: attr.tag, value: String(attr.value ?? ''), prompt: String(attr.prompt ?? ''), p: at, height: num(attr.height, 2.5), rotation: num(attr.rotation), invisible: Boolean(attr.invisible), constant: Boolean(attr.constant) }];
        })
      : [];
    return { ...style, type: 'insert', name: raw.name, p, sx: num(raw.sx, 1) || 1, sy: num(raw.sy, 1) || 1, rotation: num(raw.rotation), attributes };
  }
  if (raw.type === 'attdef') {
    const p = asPoint(raw.p);
    return p && typeof raw.tag === 'string'
      ? { ...style, type: 'attdef', tag: raw.tag, prompt: String(raw.prompt ?? ''), value: String(raw.value ?? ''), p, height: num(raw.height, 2.5), rotation: num(raw.rotation), invisible: Boolean(raw.invisible), constant: Boolean(raw.constant) }
      : null;
  }
  if (raw.type === 'centermark' || raw.type === 'centerline') {
    const center = asPoint(raw.center);
    const a = asPoint(raw.a);
    const b = asPoint(raw.b);
    if (!center || !a || !b) return null;
    return { ...style, type: raw.type, center, size: num(raw.size, 2.5), a, b, assoc: Array.isArray(raw.assoc) ? raw.assoc.filter((id): id is string => typeof id === 'string') : [] };
  }
  if (raw.type === 'array') {
    if (!raw.source || typeof raw.source !== 'object') return null;
    const center = asPoint(raw.center) ?? { x: 0, y: 0, z: 0 };
    return {
      ...style,
      type: 'array',
      kind: raw.kind === 'path' || raw.kind === 'polar' ? raw.kind : 'rect',
      source: raw.source,
      rows: Math.max(1, num(raw.rows, 1)),
      cols: Math.max(1, num(raw.cols, 1)),
      rowGap: num(raw.rowGap, 10),
      colGap: num(raw.colGap, 10),
      path: pointsOf(raw.path) ?? [],
      count: Math.max(1, num(raw.count, 1)),
      center,
      fillAngle: num(raw.fillAngle, Math.PI * 2),
      associative: raw.associative !== false,
    };
  }
  return null;
}

export function cadEntityPath(entity: DrawEntity, segments = 32): Vec3[] | null {
  if (!isCadShape(entity)) return null;
  if (entity.type === 'ellipse') return ellipsePoints(entity.center, entity.major, entity.ratio, entity.start, entity.end, segments).map(xyz);
  if (entity.type === 'spline') {
    const sampled = entity.mode === 'cv' ? cvSpline(entity.points, 8, entity.closed) : fitSpline(entity.points, 8, entity.closed);
    return sampled.map(xyz);
  }
  if (entity.type === 'hatch' || entity.type === 'region') return (entity.loops[0] ?? []).map(xyz);
  if (entity.type === 'xline' || entity.type === 'ray') return infiniteSegment(entity.a, entity.b, entity.type === 'ray');
  if (entity.type === 'wipeout') return entity.vertices.map(xyz);
  if (entity.type === 'revcloud') return bulged(entity.vertices, entity.closed);
  if (entity.type === 'donut') return ellipsePoints(entity.center, { x: entity.outer, y: 0, z: 0 }, 1, 0, Math.PI * 2, segments).map(xyz);
  if (entity.type === 'mtext' || entity.type === 'attdef') return [entity.p];
  if (entity.type === 'dimension') return [entity.p1, entity.p2, entity.loc];
  if (entity.type === 'mleader') return [...entity.leaders.flat(), entity.textPos];
  if (entity.type === 'table') return [entity.p, { x: entity.p.x + entity.colWidth * entity.cols, y: entity.p.y - entity.rowHeight * entity.rows, z: entity.p.z }];
  if (entity.type === 'insert') return [entity.p];
  if (entity.type === 'centermark') return [entity.center];
  if (entity.type === 'centerline') return [entity.a, entity.b];
  if (entity.type === 'array') return arrayGrips(entity);
  return [];
}

function infiniteSegment(a: Xyz, b: Xyz, ray: boolean): Vec3[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const reach = 5000;
  const ux = (dx / len) * reach;
  const uy = (dy / len) * reach;
  if (ray) return [a, { x: a.x + ux, y: a.y + uy, z: a.z }];
  return [{ x: a.x - ux, y: a.y - uy, z: a.z }, { x: a.x + ux, y: a.y + uy, z: a.z }];
}

function bulged(vertices: { x: number; y: number; z: number; bulge: number }[], closed: boolean): Vec3[] {
  const out: Vec3[] = [];
  const n = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const pts = bulgePoints(a, b, a.bulge, 6);
    if (out.length > 0) pts.shift();
    out.push(...pts.map(xyz));
  }
  return out;
}

export function cadGrips(entity: DrawEntity): Vec3[] | null {
  if (!isCadShape(entity)) return null;
  if (entity.type === 'ellipse') {
    const majorEnd = { x: entity.center.x + entity.major.x, y: entity.center.y + entity.major.y, z: entity.center.z };
    const minor = xyz(ellipsePoint(entity.center, entity.major, entity.ratio, Math.PI / 2));
    return [entity.center, majorEnd, minor];
  }
  if (entity.type === 'spline') return entity.points.map(xyz);
  if (entity.type === 'dimension') return [entity.p1, entity.p2, entity.loc, entity.p3];
  if (entity.type === 'mleader') return [...entity.leaders.flat(), entity.textPos];
  if (entity.type === 'insert' || entity.type === 'mtext' || entity.type === 'attdef') return [entity.p];
  if (entity.type === 'table') return [entity.p];
  if (entity.type === 'donut' || entity.type === 'centermark') return [entity.center];
  if (entity.type === 'xline' || entity.type === 'ray') return [entity.a, entity.b];
  if (entity.type === 'centerline') return [entity.a, entity.b];
  if (entity.type === 'wipeout') return entity.vertices.map(xyz);
  if (entity.type === 'revcloud') return entity.vertices.map(xyz);
  if (entity.type === 'hatch' || entity.type === 'region') return (entity.loops[0] ?? []).map(xyz);
  if (entity.type === 'array') return arrayGrips(entity);
  return [];
}

function arrayGrips(entity: DrawArray): Vec3[] {
  if (entity.kind === 'polar') return [entity.center];
  return [{ x: 0, y: 0, z: 0 }, { x: entity.colGap, y: 0, z: 0 }, { x: 0, y: entity.rowGap, z: 0 }];
}

export function mapCadEntity(entity: DrawEntity, fn: (p: Vec3) => Vec3, factor = 1): DrawEntity | null {
  if (!isCadShape(entity)) return null;
  const scale = Math.abs(factor) || 1;
  const next = structuredClone(entity) as CadShape;
  const move = (p: Xyz) => fn(p);
  if (next.type === 'ellipse') {
    const end = move({ x: next.center.x + next.major.x, y: next.center.y + next.major.y, z: next.center.z });
    next.center = move(next.center);
    next.major = { x: (end.x - next.center.x), y: (end.y - next.center.y), z: 0 };
    return next;
  }
  if (next.type === 'spline') {
    next.points = next.points.map(move);
    return next;
  }
  if (next.type === 'hatch' || next.type === 'region') {
    next.loops = next.loops.map((loop) => loop.map(move));
    return next;
  }
  if (next.type === 'xline' || next.type === 'ray') {
    next.a = move(next.a);
    next.b = move(next.b);
    return next;
  }
  if (next.type === 'wipeout') {
    next.vertices = next.vertices.map(move);
    return next;
  }
  if (next.type === 'revcloud') {
    next.vertices = next.vertices.map((vertex) => ({ ...move(vertex), bulge: vertex.bulge }));
    return next;
  }
  if (next.type === 'donut') {
    next.center = move(next.center);
    next.inner *= scale;
    next.outer *= scale;
    return next;
  }
  if (next.type === 'mtext' || next.type === 'attdef') {
    next.p = move(next.p);
    next.height *= scale;
    if (next.type === 'mtext') next.width *= scale;
    return next;
  }
  if (next.type === 'dimension') {
    next.p1 = move(next.p1);
    next.p2 = move(next.p2);
    next.p3 = move(next.p3);
    next.loc = move(next.loc);
    next.offset *= factor || 1;
    return next;
  }
  if (next.type === 'mleader') {
    next.leaders = next.leaders.map((leader) => leader.map(move));
    next.textPos = move(next.textPos);
    return next;
  }
  if (next.type === 'table') {
    next.p = move(next.p);
    next.colWidth *= scale;
    next.rowHeight *= scale;
    return next;
  }
  if (next.type === 'insert') {
    next.p = move(next.p);
    next.sx *= factor || 1;
    next.sy *= scale;
    next.attributes = next.attributes.map((attr) => ({ ...attr, p: move(attr.p), height: attr.height * scale }));
    return next;
  }
  if (next.type === 'centermark') {
    next.center = move(next.center);
    next.size *= scale;
    return next;
  }
  if (next.type === 'centerline') {
    next.a = move(next.a);
    next.b = move(next.b);
    return next;
  }
  if (next.type === 'array') {
    next.center = move(next.center);
    next.colGap *= factor || 1;
    next.rowGap *= scale;
    next.path = next.path.map(move);
    return next;
  }
  return next;
}

export function describeCad(doc: DrawingDoc, entity: DrawEntity): string[] | null {
  if (!isCadShape(entity)) return null;
  const lines = [`${entity.type.toUpperCase()}  Layer: "${entity.layer}"  Color: ${entity.color}`];
  if (entity.lineType) lines.push(`Linetype: ${entity.lineType}`);
  if (entity.lineWeight !== undefined) lines.push(`Lineweight: ${entity.lineWeight}`);
  if (entity.type === 'ellipse') lines.push(`center ${entity.center.x}, ${entity.center.y}  ratio ${entity.ratio}`);
  if (entity.type === 'spline') lines.push(`${entity.mode}  ${entity.points.length} points  ${entity.closed ? 'closed' : 'open'}`);
  if (entity.type === 'hatch') lines.push(`pattern ${entity.pattern}  scale ${entity.scale}  angle ${entity.angle}  ${entity.associative ? 'associative' : 'non-associative'}`);
  if (entity.type === 'dimension') {
    const style = doc.library ? effectiveDimStyle(doc.library, entity.style, entity.overrides) : null;
    lines.push(`${entity.kind}  measurement ${entity.measurement}  style ${entity.style}`);
    if (style) lines.push(`DIMSCALE ${style.dimscale}  DIMDEC ${style.dimdec}  text ${style.dimtxt}`);
    const geom = style && doc.library ? dimensionGeometry(entity, style, doc.library.annotationScale) : null;
    if (geom) lines.push(`text ${geom.text}`);
  }
  if (entity.type === 'mtext') lines.push(entity.content);
  if (entity.type === 'insert') lines.push(`block ${entity.name}  scale ${entity.sx}, ${entity.sy}  rotation ${entity.rotation}`);
  if (entity.type === 'table') lines.push(`${entity.rows} x ${entity.cols}`);
  if (entity.type === 'mleader') lines.push(entity.text);
  return lines;
}

export function entityPropertyRows(doc: DrawingDoc, entity: DrawEntity): { key: string; value: string }[] {
  const rows = [
    { key: 'Type', value: entity.type },
    { key: 'Layer', value: entity.layer },
    { key: 'Color', value: entity.color },
    { key: 'Linetype', value: 'lineType' in entity && entity.lineType ? String(entity.lineType) : 'ByLayer' },
    { key: 'Lineweight', value: 'lineWeight' in entity && entity.lineWeight !== undefined ? String(entity.lineWeight) : 'ByLayer' },
  ];
  const extra = describeCad(doc, entity);
  if (extra) rows.push(...extra.slice(1).map((line) => ({ key: 'Geometry', value: line })));
  return rows;
}

export function libraryOrEmpty(doc: DrawingDoc): CadLibrary | null {
  return doc.library ?? null;
}

export function hitCad(entity: DrawEntity, p: { x: number; y: number }, tol: number): boolean | null {
  if (!isCadShape(entity)) return null;
  if (entity.type === 'hatch' || entity.type === 'wipeout' || entity.type === 'region') {
    const loop = entity.type === 'wipeout' ? entity.vertices : entity.loops[0] ?? [];
    return loop.length >= 3 && pointInRing(p, loop);
  }
  if (entity.type === 'xline' || entity.type === 'ray') return distanceToInfinite(p, entity.a, entity.b, entity.type === 'ray') <= tol;
  if (entity.type === 'donut') {
    const d = Math.hypot(p.x - entity.center.x, p.y - entity.center.y);
    return Math.abs(d - entity.outer) <= tol || Math.abs(d - entity.inner) <= tol;
  }
  return null;
}

function pointInRing(p: { x: number; y: number }, ring: Xyz[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-12) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToInfinite(p: { x: number; y: number }, a: Xyz, b: Xyz, ray: boolean): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  if (ray) t = Math.max(0, t);
  const x = a.x + dx * t;
  const y = a.y + dy * t;
  return Math.hypot(p.x - x, p.y - y);
}

export function splineEntityPoints(entity: DrawSpline | DrawEllipse, segments = 24): Xyz[] {
  if (entity.type === 'ellipse') return ellipsePoints(entity.center, entity.major, entity.ratio, entity.start, entity.end, segments).map(xyz);
  return (entity.mode === 'cv' ? cvSpline(entity.points, 8, entity.closed) : fitSpline(entity.points, 8, entity.closed)).map(xyz);
}

export function dimensionPreview(entity: DrawDimension, doc: DrawingDoc): ReturnType<typeof dimensionGeometry> | null {
  if (!doc.library) return null;
  const style = effectiveDimStyle(doc.library, entity.style, entity.overrides);
  return dimensionGeometry(entity, style, doc.library.annotationScale);
}

/** Rebuild associative hatch loops from the objects that defined them. */
export function syncHatches(doc: DrawingDoc): void {
  const byId = new Map(doc.entities.map((entity) => [entity.id, entity]));
  for (const entity of doc.entities) {
    if (entity.type !== 'hatch' || !entity.associative || entity.sourceIds.length === 0) continue;
    const loops: Xyz[][] = [];
    for (const id of entity.sourceIds) {
      const source = byId.get(id);
      if (!source) continue;
      if (source.type === 'polyline' && source.closed) loops.push(source.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y, z: vertex.z })));
      if (source.type === 'circle') {
        loops.push(ellipsePoints(source.center, { x: source.radius, y: 0, z: 0 }, 1, 0, Math.PI * 2, 48).map(xyz));
      }
      if (source.type === 'region') loops.push(...source.loops);
    }
    if (loops.length > 0) {
      entity.loops = loops;
      entity.holes = entity.holes.filter((index) => index > 0 && index < loops.length);
    }
  }
}

export function hatchLoops(entity: DrawHatch): { outer: Xyz[]; holes: Xyz[][] } {
  const holes = new Set(entity.holes);
  const outer = entity.loops[0] ?? [];
  return { outer, holes: entity.loops.filter((_, index) => holes.has(index)) };
}
