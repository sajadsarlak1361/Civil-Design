/**
 * Assemblies and subassemblies.
 * Slope is dz/dOffset on the right side: negative drains away from the crown.
 * The left side mirrors that slope. Offset is positive to the right.
 * Daylight slopes are horizontal:vertical, so 2 is a 2:1 slope.
 */

export type Subassembly =
  | { kind: 'lane'; name: string; width: number; slope: number; depth: number }
  | { kind: 'shoulder'; name: string; width: number; slope: number; depth: number }
  | { kind: 'curb'; name: string; gutterWidth: number; gutterSlope: number; curbHeight: number; curbWidth: number }
  | { kind: 'sidewalk'; name: string; buffer: number; width: number; slope: number }
  | { kind: 'daylight'; name: string; cutSlope: number; fillSlope: number; maxWidth: number };

export interface Assembly {
  id: string;
  name: string;
  right: Subassembly[];
  left: Subassembly[];
}

export interface SectionPoint {
  code: string;
  offset: number;
  elevation: number;
}

export interface SectionLink {
  code: string;
  name: string;
  a: SectionPoint;
  b: SectionPoint;
}

export interface AssemblySection {
  points: SectionPoint[];
  links: SectionLink[];
  cutArea: number;
  fillArea: number;
}

export function stockLaneAssembly(id: string, name = 'Lane-Shoulder-Daylight'): Assembly {
  const right: Subassembly[] = [
    { kind: 'lane', name: 'Lane', width: 3.6, slope: -0.02, depth: 0.15 },
    { kind: 'shoulder', name: 'Shoulder', width: 1.5, slope: -0.04, depth: 0.15 },
    { kind: 'daylight', name: 'Daylight', cutSlope: 2, fillSlope: 3, maxWidth: 40 },
  ];
  return { id, name, right, left: [] };
}

export function resolveSides(assembly: Assembly): { right: Subassembly[]; left: Subassembly[] } {
  return { right: assembly.right, left: assembly.left.length > 0 ? assembly.left : assembly.right };
}

function addLink(section: AssemblySection, code: string, name: string, a: SectionPoint, b: SectionPoint): void {
  section.points.push(a, b);
  section.links.push({ code, name, a, b });
}

function crossSlope(authored: number, side: 1 | -1, override: number | undefined): number {
  if (override !== undefined) return override;
  return side === 1 ? authored : -authored;
}

export function applyAssembly(
  assembly: Assembly,
  input: {
    centerElevation: number;
    egAt: (offset: number) => number | null;
    leftSlope?: number;
    rightSlope?: number;
  },
): AssemblySection {
  const section: AssemblySection = { points: [], links: [], cutArea: 0, fillArea: 0 };
  const crown: SectionPoint = { code: 'Crown', offset: 0, elevation: input.centerElevation };
  section.points.push(crown);
  const sides = resolveSides(assembly);
  applySide(section, sides.right, 1, crown, input.rightSlope, input.egAt);
  applySide(section, sides.left, -1, crown, input.leftSlope, input.egAt);
  const earthwork = section.links.filter((link) => link.code === 'Datum' || link.code === 'Daylight');
  const design = earthwork.length > 0 ? earthwork : section.links.filter((link) => link.code === 'Top');
  const areas = sectionAreasFromLinks(design, input.egAt, 0.5);
  section.cutArea = areas.cut;
  section.fillArea = areas.fill;
  return section;
}

export function sectionAreasFromLinks(
  links: SectionLink[],
  egAt: (offset: number) => number | null,
  step: number,
): { cut: number; fill: number } {
  let cut = 0;
  let fill = 0;
  for (const link of links) {
    const piece = sectionAreas([link.a, link.b], egAt, step);
    cut += piece.cut;
    fill += piece.fill;
  }
  return { cut, fill };
}

function applySide(
  section: AssemblySection,
  subs: Subassembly[],
  side: 1 | -1,
  start: SectionPoint,
  laneOverride: number | undefined,
  egAt: (offset: number) => number | null,
): void {
  let cursor = start;
  for (const sub of subs) {
    if (sub.kind === 'lane' || sub.kind === 'shoulder') {
      const slope = crossSlope(sub.slope, side, sub.kind === 'lane' ? laneOverride : undefined);
      const next: SectionPoint = {
        code: sub.kind === 'lane' ? 'ETW' : 'Shoulder',
        offset: cursor.offset + side * sub.width,
        elevation: cursor.elevation + slope * side * sub.width,
      };
      addLink(section, 'Top', sub.name, cursor, next);
      const a: SectionPoint = { code: 'Datum', offset: cursor.offset, elevation: cursor.elevation - sub.depth };
      const b: SectionPoint = { code: 'Datum', offset: next.offset, elevation: next.elevation - sub.depth };
      addLink(section, 'Datum', sub.name, a, b);
      cursor = next;
      continue;
    }
    if (sub.kind === 'curb') {
      const gutterSlope = crossSlope(sub.gutterSlope, side, undefined);
      const gutter: SectionPoint = {
        code: 'Gutter',
        offset: cursor.offset + side * sub.gutterWidth,
        elevation: cursor.elevation + gutterSlope * side * sub.gutterWidth,
      };
      addLink(section, 'Top', sub.name, cursor, gutter);
      const face: SectionPoint = { code: 'TopCurb', offset: gutter.offset, elevation: gutter.elevation + sub.curbHeight };
      addLink(section, 'Top', sub.name, gutter, face);
      const back: SectionPoint = { code: 'BackCurb', offset: face.offset + side * sub.curbWidth, elevation: face.elevation };
      addLink(section, 'Top', sub.name, face, back);
      cursor = back;
      continue;
    }
    if (sub.kind === 'sidewalk') {
      const shelf: SectionPoint = { code: 'Sidewalk', offset: cursor.offset + side * sub.buffer, elevation: cursor.elevation };
      if (sub.buffer > 0) addLink(section, 'Top', sub.name, cursor, shelf);
      const slope = crossSlope(sub.slope, side, undefined);
      const edge: SectionPoint = {
        code: 'Sidewalk',
        offset: shelf.offset + side * sub.width,
        elevation: shelf.elevation + slope * side * sub.width,
      };
      addLink(section, 'Top', sub.name, shelf, edge);
      cursor = edge;
      continue;
    }
    const hit = daylightOffset(cursor, side, sub, egAt);
    if (!hit) continue;
    const point: SectionPoint = { code: 'Daylight', offset: hit.offset, elevation: hit.elevation };
    addLink(section, 'Daylight', sub.name, cursor, point);
    addLink(section, 'Top', sub.name, cursor, point);
    cursor = point;
  }
}

function daylightOffset(
  cursor: SectionPoint,
  side: 1 | -1,
  sub: Extract<Subassembly, { kind: 'daylight' }>,
  egAt: (offset: number) => number | null,
): { offset: number; elevation: number } | null {
  const ground = egAt(cursor.offset);
  if (ground === null) return null;
  if (Math.abs(cursor.elevation - ground) <= 0.02) return { offset: cursor.offset, elevation: cursor.elevation };
  const up = cursor.elevation < ground;
  const slope = Math.max(0.05, up ? sub.cutSlope : sub.fillSlope);
  const grade = (up ? 1 : -1) / slope;
  const maxWidth = sub.maxWidth > 1 ? sub.maxWidth : 40;
  const diffAt = (distance: number) => {
    const offset = cursor.offset + side * distance;
    const eg = egAt(offset);
    if (eg === null) return null;
    return cursor.elevation + grade * distance - eg;
  };
  let previous = diffAt(0);
  if (previous === null) return null;
  const step = 0.25;
  for (let distance = step; distance <= maxWidth + 1e-9; distance += step) {
    const diff = diffAt(distance);
    if (diff === null) return null;
    if ((previous > 0 && diff <= 0) || (previous < 0 && diff >= 0)) {
      let lo = distance - step;
      let hi = distance;
      for (let iteration = 0; iteration < 24; iteration++) {
        const mid = (lo + hi) / 2;
        const midDiff = diffAt(mid);
        if (midDiff === null) return null;
        if ((previous > 0 && midDiff > 0) || (previous < 0 && midDiff < 0)) lo = mid;
        else hi = mid;
      }
      const at = (lo + hi) / 2;
      return { offset: cursor.offset + side * at, elevation: cursor.elevation + grade * at };
    }
    previous = diff;
  }
  return null;
}

export function sectionAreas(points: SectionPoint[], egAt: (offset: number) => number | null, step: number): { cut: number; fill: number } {
  const unique = new Map<number, number>();
  for (const point of points) {
    const key = Math.round(point.offset * 1000) / 1000;
    unique.set(key, point.elevation);
  }
  const offsets = [...unique.keys()].sort((a, b) => a - b);
  if (offsets.length < 2) return { cut: 0, fill: 0 };
  const designAt = (offset: number) => {
    if (offset <= offsets[0]) return unique.get(offsets[0]) ?? 0;
    const last = offsets[offsets.length - 1];
    if (offset >= last) return unique.get(last) ?? 0;
    for (let i = 1; i < offsets.length; i++) {
      if (offset > offsets[i]) continue;
      const span = offsets[i] - offsets[i - 1];
      const t = span <= 1e-12 ? 0 : (offset - offsets[i - 1]) / span;
      const z0 = unique.get(offsets[i - 1]) ?? 0;
      const z1 = unique.get(offsets[i]) ?? 0;
      return z0 + (z1 - z0) * t;
    }
    return 0;
  };
  let cut = 0;
  let fill = 0;
  const size = step > 0.05 ? step : 0.5;
  for (let offset = offsets[0]; offset < offsets[offsets.length - 1] - 1e-9; offset += size) {
    const next = Math.min(offset + size, offsets[offsets.length - 1]);
    const eg0 = egAt(offset);
    const eg1 = egAt(next);
    if (eg0 === null || eg1 === null) {
      offset = next - size;
      continue;
    }
    const h0 = designAt(offset) - eg0;
    const h1 = designAt(next) - eg1;
    const width = next - offset;
    if (h0 === 0 && h1 === 0) continue;
    if (h0 * h1 < 0) {
      const t = h0 / (h0 - h1);
      const left = Math.abs(h0) * t * width * 0.5;
      const right = Math.abs(h1) * (1 - t) * width * 0.5;
      if (h0 > 0) {
        fill += left;
        cut += right;
      } else {
        cut += left;
        fill += right;
      }
    } else {
      const area = (Math.abs(h0) + Math.abs(h1)) * 0.5 * width;
      if (h0 > 0 || h1 > 0) fill += area;
      else cut += area;
    }
    if (next >= offsets[offsets.length - 1] - 1e-9) break;
  }
  return { cut, fill };
}
