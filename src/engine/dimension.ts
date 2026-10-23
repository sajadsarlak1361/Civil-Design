import { dimScaleOf, effectiveDimStyle, type DimStyle } from './cadLibrary';
import type { DimKind, DrawDimension, Xyz } from './cadShapes';
import type { DrawEntity, DrawingDoc } from './drafting';

export interface DimMeasureInput {
  kind: DimKind;
  p1: Xyz;
  p2: Xyz;
  p3: Xyz;
  loc: Xyz;
  horizontal?: boolean;
}

export function measureDimension(input: DimMeasureInput): number {
  const { kind, p1, p2, p3 } = input;
  if (kind === 'aligned' || kind === 'jogged-linear') return Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if (kind === 'linear') {
    const horizontal = input.horizontal ?? Math.abs(input.loc.y - (p1.y + p2.y) / 2) >= Math.abs(input.loc.x - (p1.x + p2.x) / 2);
    return horizontal ? Math.abs(p2.x - p1.x) : Math.abs(p2.y - p1.y);
  }
  if (kind === 'radius' || kind === 'jogged') return Math.hypot(p1.x - p3.x, p1.y - p3.y);
  if (kind === 'diameter') return 2 * Math.hypot(p1.x - p3.x, p1.y - p3.y);
  if (kind === 'arc') {
    const radius = Math.hypot(p1.x - p3.x, p1.y - p3.y);
    let sweep = Math.atan2(p2.y - p3.y, p2.x - p3.x) - Math.atan2(p1.y - p3.y, p1.x - p3.x);
    while (sweep <= 0) sweep += Math.PI * 2;
    if (sweep > Math.PI) sweep = Math.PI * 2 - sweep;
    return Math.abs(sweep) * radius;
  }
  if (kind === 'angular') {
    const a1 = Math.atan2(p1.y - p3.y, p1.x - p3.x);
    const a2 = Math.atan2(p2.y - p3.y, p2.x - p3.x);
    let sweep = a2 - a1;
    while (sweep <= -Math.PI) sweep += Math.PI * 2;
    while (sweep > Math.PI) sweep -= Math.PI * 2;
    return Math.abs(sweep);
  }
  if (kind === 'ordinate') {
    const horizontal = input.horizontal ?? Math.abs(input.loc.x - p1.x) > Math.abs(input.loc.y - p1.y);
    return horizontal ? p1.x - p3.x : p1.y - p3.y;
  }
  return 0;
}

export function signedOffset(p1: Xyz, p2: Xyz, loc: Xyz): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return loc.y - p1.y;
  return ((loc.x - p1.x) * -dy + (loc.y - p1.y) * dx) / len;
}

export function formatDimNumber(value: number, decimals: number, separator: string): string {
  const digits = Math.max(0, Math.min(8, Math.round(decimals)));
  const text = (Number.isFinite(value) ? value : 0).toFixed(digits);
  if (separator && separator !== '.') return text.replace('.', separator);
  return text;
}

export function formatPrimary(value: number, style: DimStyle): string {
  const scaled = value * (style.dimlfac || 1);
  const shown = style.dimlunit === 1 ? Number(scaled.toExponential(style.dimdec)) : scaled;
  const body = style.dimlunit === 1 ? shown.toExponential(style.dimdec) : formatDimNumber(shown, style.dimdec, style.dimdsep || '.');
  const template = style.dimpost || '<>';
  return template.includes('<>') ? template.replace('<>', body) : `${template}${body}`;
}

export function formatAlternate(value: number, style: DimStyle): string {
  if (!style.dimalt) return '';
  const body = formatDimNumber(value * (style.dimaltf || 1), style.dimaltd, '.');
  const template = style.dimapost || '[]';
  return template.includes('[]') ? template.replace('[]', body) : template.replace('<>', body);
}

export function formatTolerance(value: number, style: DimStyle): string {
  if (!style.dimtol && !style.dimlim) return '';
  const upper = formatDimNumber(value + style.dimtp, style.dimtdec, style.dimdsep || '.');
  const lower = formatDimNumber(value - style.dimtm, style.dimtdec, style.dimdsep || '.');
  if (style.dimlim) return `${upper}/${lower}`;
  return `+${formatDimNumber(style.dimtp, style.dimtdec, style.dimdsep || '.')} / -${formatDimNumber(style.dimtm, style.dimtdec, style.dimdsep || '.')}`;
}

export function formatDimension(entity: Pick<DrawDimension, 'text' | 'measurement' | 'kind' | 'inspection' | 'civil'>, style: DimStyle): string {
  if (entity.text.trim()) return entity.text;
  const angular = entity.kind === 'angular';
  const value = angular ? (entity.measurement * 180) / Math.PI : entity.measurement;
  let text = formatPrimary(value, style);
  if (angular && !style.dimpost.includes('°') && style.dimpost === '<>') text = `${text}°`;
  const alt = formatAlternate(value, style);
  if (alt) text = `${text} ${alt}`;
  const tol = formatTolerance(value, style);
  if (tol) text = `${text} ${tol}`;
  if (entity.inspection) {
    const label = entity.inspection.label || ' ';
    const rate = entity.inspection.rate || ' ';
    text = `${label} | ${text} | ${rate}`;
  }
  if (entity.civil === 'station') text = `STA ${text}`;
  if (entity.civil === 'offset') text = `OFF ${text}`;
  if (entity.civil === 'slope') text = `${formatDimNumber(entity.measurement, style.dimdec, style.dimdsep || '.')}%`;
  return text;
}

export interface DimGeometry {
  ext1: [Xyz, Xyz];
  ext2: [Xyz, Xyz];
  dim: [Xyz, Xyz];
  arrows: [Xyz, Xyz, Xyz][];
  textPoint: Xyz;
  textAngle: number;
  text: string;
  jog?: [Xyz, Xyz];
}

function zOf(p: Xyz): Xyz {
  return { x: p.x, y: p.y, z: p.z || 0 };
}

function add(p: Xyz, x: number, y: number): Xyz {
  return { x: p.x + x, y: p.y + y, z: p.z || 0 };
}

export function linearDirection(entity: Pick<DrawDimension, 'kind' | 'p1' | 'p2' | 'horizontal'>): { dx: number; dy: number; ux: number; uy: number } {
  if (entity.kind === 'linear' || entity.kind === 'ordinate') {
    if (entity.horizontal) return { dx: 1, dy: 0, ux: 0, uy: 1 };
    return { dx: 0, dy: 1, ux: -1, uy: 0 };
  }
  const dx = entity.p2.x - entity.p1.x;
  const dy = entity.p2.y - entity.p1.y;
  const len = Math.hypot(dx, dy) || 1;
  return { dx: dx / len, dy: dy / len, ux: -dy / len, uy: dx / len };
}

export function dimensionGeometry(entity: DrawDimension, style: DimStyle, annotationScale: number): DimGeometry {
  const scale = dimScaleOf(style, annotationScale);
  const exo = style.dimexo * scale;
  const exe = style.dimexe * scale;
  const asz = style.dimasz * scale;
  const gap = style.dimgap * scale;
  const text = formatDimension(entity, style);
  const dir = linearDirection(entity);
  const off = entity.offset;
  const sign = off >= 0 ? 1 : -1;
  const along = (p: Xyz) => p.x * dir.dx + p.y * dir.dy;
  const across = (p: Xyz) => p.x * dir.ux + p.y * dir.uy;
  const at = (s: number, c: number, z = 0): Xyz => ({ x: dir.dx * s + dir.ux * c, y: dir.dy * s + dir.uy * c, z });

  if (entity.kind === 'radius' || entity.kind === 'jogged' || entity.kind === 'diameter') {
    const center = entity.p3;
    const rim = entity.p1;
    const ang = Math.atan2(rim.y - center.y, rim.x - center.x);
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const start = entity.kind === 'diameter' ? add(center, -ux * (entity.measurement / 2), -uy * (entity.measurement / 2)) : center;
    const end = rim;
    const textPoint = add(lerp(start, end, 0.5), -uy * (style.dimtad ? gap + style.dimtxt * scale : 0), ux * 0);
    const arrows = [arrowHead(end, ang + Math.PI, asz)];
    if (entity.kind === 'diameter') arrows.push(arrowHead(start, ang, asz));
    const geom: DimGeometry = {
      ext1: [center, center],
      ext2: [rim, rim],
      dim: [start, end],
      arrows,
      textPoint,
      textAngle: style.dimtih ? 0 : ang,
      text,
    };
    if (entity.kind === 'jogged' || entity.jog) {
      const mid = lerp(start, end, 0.55);
      geom.jog = [add(mid, -uy * asz, ux * asz), add(mid, uy * asz, -ux * asz)];
    }
    return geom;
  }

  if (entity.kind === 'angular' || entity.kind === 'arc') {
    const center = entity.p3;
    const a1 = Math.atan2(entity.p1.y - center.y, entity.p1.x - center.x);
    const a2 = Math.atan2(entity.p2.y - center.y, entity.p2.x - center.x);
    const radius = Math.hypot(entity.loc.x - center.x, entity.loc.y - center.y) || Math.hypot(entity.p1.x - center.x, entity.p1.y - center.y);
    const q1 = add(center, Math.cos(a1) * radius, Math.sin(a1) * radius);
    const q2 = add(center, Math.cos(a2) * radius, Math.sin(a2) * radius);
    const midA = a1 + (a2 - a1) / 2;
    return {
      ext1: [entity.p1, q1],
      ext2: [entity.p2, q2],
      dim: [q1, q2],
      arrows: [arrowHead(q1, a1 + Math.PI / 2, asz), arrowHead(q2, a2 - Math.PI / 2, asz)],
      textPoint: add(center, Math.cos(midA) * (radius + (style.dimtad ? gap : 0)), Math.sin(midA) * (radius + (style.dimtad ? gap : 0))),
      textAngle: style.dimtih ? 0 : midA + Math.PI / 2,
      text,
    };
  }

  const s1 = along(entity.p1);
  const s2 = along(entity.p2);
  const base = across(entity.p1);
  const c = base + off;
  const e1 = at(s1, c, entity.p1.z);
  const e2 = at(s2, c, entity.p2.z);
  const extOver = sign * exe;
  const extStart = (p: Xyz, s: number) => at(s, across(p) + sign * exo, p.z);
  let textS = (s1 + s2) / 2;
  if (entity.justify === 'left') textS = Math.min(s1, s2) + asz;
  if (entity.justify === 'right') textS = Math.max(s1, s2) - asz;
  if (entity.textShift) textS += entity.textShift.along;
  const textC = c + (style.dimtad > 0 ? sign * (gap + style.dimtxt * scale * 0.15) : 0) + (entity.textShift?.across ?? 0);
  const textPoint = at(textS, textC, entity.p1.z);
  const geom: DimGeometry = {
    ext1: style.dimse1 ? [e1, e1] : [extStart(entity.p1, s1), at(s1, c + extOver, entity.p1.z)],
    ext2: style.dimse2 ? [e2, e2] : [extStart(entity.p2, s2), at(s2, c + extOver, entity.p2.z)],
    dim: style.dimsd1 && style.dimsd2 ? [e1, e1] : [e1, e2],
    arrows: [],
    textPoint,
    textAngle: entity.textAngle || (style.dimtih ? 0 : Math.atan2(dir.dy, dir.dx)),
    text,
  };
  if (!style.dimsd1) geom.arrows.push(arrowHead(e1, Math.atan2(e2.y - e1.y, e2.x - e1.x), asz));
  if (!style.dimsd2) geom.arrows.push(arrowHead(e2, Math.atan2(e1.y - e2.y, e1.x - e2.x), asz));
  if (entity.jog) {
    const mid = lerp(e1, e2, 0.5);
    geom.jog = [add(mid, dir.ux * asz * 0.8, dir.uy * asz * 0.8), add(mid, dir.ux * -asz * 0.4, dir.uy * -asz * 0.4)];
  }
  return geom;
}

function lerp(a: Xyz, b: Xyz, t: number): Xyz {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z };
}

function arrowHead(tip: Xyz, angle: number, size: number): [Xyz, Xyz, Xyz] {
  const back = size;
  const wing = size * 0.28;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  return [
    zOf(tip),
    add(tip, -ux * back + -uy * wing, -uy * back + ux * wing),
    add(tip, -ux * back + uy * wing, -uy * back + -ux * wing),
  ];
}

function pointOf(entity: DrawEntity, role: string): Xyz | null {
  if (entity.type === 'line') {
    if (role === 'start') return entity.a;
    if (role === 'end') return entity.b;
    if (role === 'mid') return { x: (entity.a.x + entity.b.x) / 2, y: (entity.a.y + entity.b.y) / 2, z: entity.a.z };
  }
  if (entity.type === 'circle' || entity.type === 'arc') {
    if (role === 'center') return entity.center;
  }
  if ((entity.type === 'point' || entity.type === 'text') && role === 'point') return entity.p;
  if (entity.type === 'polyline' && entity.vertices.length > 0) {
    if (role === 'start') return entity.vertices[0];
    if (role === 'end') return entity.vertices[entity.vertices.length - 1];
  }
  return null;
}

/** Recompute associative dimensions from the geometry they reference. */
export function syncDimensions(doc: DrawingDoc): void {
  const library = doc.library;
  if (!library) return;
  const byId = new Map(doc.entities.map((entity) => [entity.id, entity]));
  for (const entity of doc.entities) {
    if (entity.type !== 'dimension' || entity.assoc.length === 0) continue;
    const next = { ...entity, p1: { ...entity.p1 }, p2: { ...entity.p2 }, p3: { ...entity.p3 }, loc: { ...entity.loc } };
    for (const link of entity.assoc) {
      const source = byId.get(link.id);
      if (!source) continue;
      const point = pointOf(source, link.role);
      if (!point) continue;
      if (link.role === 'start' || link.role === 'point') next.p1 = { ...point };
      else if (link.role === 'end') next.p2 = { ...point };
      else if (link.role === 'center' || link.role === 'vertex') next.p3 = { ...point };
      else if (link.role === 'mid') next.p1 = { ...point };
    }
    if (entity.kind === 'linear' || entity.kind === 'aligned' || entity.kind === 'jogged-linear') {
      const dir = linearDirection(next);
      next.loc = {
        x: next.p1.x + dir.ux * entity.offset,
        y: next.p1.y + dir.uy * entity.offset,
        z: next.p1.z,
      };
    }
    const style = effectiveDimStyle(library, entity.style, entity.overrides);
    next.measurement = measureDimension({ ...next, horizontal: next.horizontal });
    if (entity.civil === 'slope' && entity.assoc[0]) {
      const source = byId.get(entity.assoc[0].id);
      if (source && source.type === 'line') {
        const dx = source.b.x - source.a.x;
        next.measurement = Math.abs(dx) < 1e-9 ? 0 : ((source.b.y - source.a.y) / dx) * 100;
      }
    }
    void style;
    entity.p1 = next.p1;
    entity.p2 = next.p2;
    entity.p3 = next.p3;
    entity.loc = next.loc;
    entity.measurement = next.measurement;
  }
}

export function spaceDimensions(dims: DrawDimension[], gap: number): void {
  if (dims.length < 2) return;
  const sorted = [...dims].sort((a, b) => a.offset - b.offset);
  const start = sorted[0].offset;
  sorted.forEach((dim, index) => {
    dim.offset = start + gap * index;
  });
}

export function continueFrom(previous: DrawDimension, nextPoint: Xyz): Pick<DrawDimension, 'p1' | 'p2' | 'loc' | 'offset' | 'horizontal' | 'kind'> {
  return {
    kind: previous.kind === 'aligned' ? 'aligned' : 'linear',
    p1: previous.p2,
    p2: nextPoint,
    loc: { ...previous.loc },
    offset: previous.offset,
    horizontal: previous.horizontal,
  };
}

export function baselineFrom(previous: DrawDimension, nextPoint: Xyz, spacing: number): Pick<DrawDimension, 'p1' | 'p2' | 'loc' | 'offset' | 'horizontal' | 'kind'> {
  const sign = previous.offset >= 0 ? 1 : -1;
  return {
    kind: previous.kind === 'aligned' ? 'aligned' : 'linear',
    p1: previous.p1,
    p2: nextPoint,
    loc: previous.loc,
    offset: previous.offset + sign * spacing,
    horizontal: previous.horizontal,
  };
}
