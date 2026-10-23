import { pointInPolygon, polygonArea, type Vec2 } from './geometry';
import type { Xy } from './curves';

export interface HatchPattern {
  name: string;
  family: 'SOLID' | 'ANSI' | 'ISO' | 'gradient';
  /** Line angle in degrees. Ignored for SOLID and gradients. */
  angle: number;
  /** Model spacing before the hatch scale. */
  space: number;
  dashes: number[];
  /** A second family of lines at angle + 90°. */
  cross: boolean;
  gradient: 'none' | 'linear' | 'cylinder' | 'spherical' | 'curved';
}

const solid = (name: string, gradient: HatchPattern['gradient']): HatchPattern => ({
  name,
  family: gradient === 'none' ? 'SOLID' : 'gradient',
  angle: 0,
  space: 1,
  dashes: [],
  cross: false,
  gradient,
});

function line(name: string, family: 'ANSI' | 'ISO', angle: number, space: number, dashes: number[] = [], cross = false): HatchPattern {
  return { name, family, angle, space, dashes, cross, gradient: 'none' };
}

/** Standard hatch pattern names. Spacing is in drawing units at scale 1. */
export const HATCH_PATTERNS: HatchPattern[] = [
  solid('SOLID', 'none'),
  line('ANSI31', 'ANSI', 45, 3.175),
  line('ANSI32', 'ANSI', 45, 3.175, [], true),
  line('ANSI33', 'ANSI', 45, 6.35, [6.35, 3.175]),
  line('ANSI34', 'ANSI', 45, 6.35, [12.7, 3.175], true),
  line('ANSI35', 'ANSI', 45, 3.175, [], true),
  line('ANSI36', 'ANSI', 45, 3.175),
  line('ANSI37', 'ANSI', 45, 3.175, [], true),
  line('ANSI38', 'ANSI', 45, 3.175, [3.175, 3.175]),
  line('ISO02', 'ISO', 0, 5, [12, 3]),
  line('ISO03', 'ISO', 0, 5, [12, 18]),
  line('ISO04', 'ISO', 0, 5, [24, 3, 3, 3]),
  line('ISO05', 'ISO', 0, 5, [24, 3, 3, 3, 3, 3]),
  line('ISO06', 'ISO', 45, 5, [12, 3]),
  line('ISO07', 'ISO', 0, 5),
  line('ISO08', 'ISO', 0, 5, [], true),
  line('ISO09', 'ISO', 45, 5),
  line('ISO10', 'ISO', 45, 5, [], true),
  line('ISO11', 'ISO', 45, 5, [12, 3], true),
  line('ISO12', 'ISO', 0, 5, [6, 3], true),
  line('ISO13', 'ISO', 45, 2.5),
  line('ISO14', 'ISO', 0, 5, [3, 3]),
  line('ISO15', 'ISO', 0, 5, [12, 3, 3, 3], true),
  solid('GR_LINEAR', 'linear'),
  solid('GR_CYLINDRICAL', 'cylinder'),
  solid('GR_INVCYL', 'cylinder'),
  solid('GR_SPHERICAL', 'spherical'),
  solid('GR_HEMISP', 'spherical'),
  solid('GR_CURVED', 'curved'),
  solid('GR_INVCURVED', 'curved'),
  solid('GR_INVSPHER', 'spherical'),
];

const BY_NAME = new Map(HATCH_PATTERNS.map((pattern) => [pattern.name.toUpperCase(), pattern]));

export function hatchPattern(name: string): HatchPattern | null {
  return BY_NAME.get(name.trim().toUpperCase()) ?? null;
}

export interface HatchLoop {
  points: Xy[];
  hole: boolean;
}

export interface HatchBoundary {
  outer: Xy[];
  /** Odd nesting depth: regions left unhatched. */
  holes: Xy[][];
  /** Even nesting depth: islands hatched again inside a hole. */
  islands: Xy[][];
}

function ringArea(points: Xy[]): number {
  return Math.abs(polygonArea(points));
}

function contains(ring: Xy[], point: Vec2): boolean {
  return pointInPolygon(point, ring);
}

function strictlyInside(container: Xy[], loop: Xy[]): boolean {
  if (loop === container || ringArea(loop) >= ringArea(container) - 1e-8) return false;
  return loop.every((point) => contains(container, point));
}

/**
 * Normal island detection. The smallest closed loop that contains the point is
 * the boundary. Loops strictly inside it alternate: depth 1 is a hole, depth 2
 * is an island that is hatched again, and so on.
 */
export function boundaryAtPoint(loops: Xy[][], point: Vec2): HatchBoundary | null {
  const closed = loops.filter((loop) => loop.length >= 3 && ringArea(loop) > 1e-8);
  const owners = closed.filter((loop) => contains(loop, point));
  if (owners.length === 0) return null;
  owners.sort((a, b) => ringArea(a) - ringArea(b));
  const outer = owners[0];
  const inners = closed.filter((loop) => loop !== outer && strictlyInside(outer, loop) && !contains(loop, point));
  const depth = (loop: Xy[]) => 1 + inners.filter((other) => other !== loop && strictlyInside(other, loop)).length;
  return {
    outer,
    holes: inners.filter((loop) => depth(loop) % 2 === 1),
    islands: inners.filter((loop) => depth(loop) % 2 === 0),
  };
}

export interface HatchLine {
  a: Xy;
  b: Xy;
}

/** Portions of AB that lie inside or outside a simple polygon, split at every edge crossing. */
function clipSegment(a: Xy, b: Xy, polygon: Xy[], keep: 'inside' | 'outside'): Xy[][] {
  const hits: { t: number; p: Xy }[] = [];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const c = polygon[i];
    const d = polygon[(i + 1) % n];
    const sx = d.x - c.x;
    const sy = d.y - c.y;
    const den = dx * sy - dy * sx;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
    const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / den;
    if (t >= -1e-8 && t <= 1 + 1e-8 && u >= -1e-8 && u <= 1 + 1e-8) {
      hits.push({ t: Math.min(1, Math.max(0, t)), p: { x: a.x + dx * t, y: a.y + dy * t, z: a.z } });
    }
  }
  hits.sort((p, q) => p.t - q.t);
  const unique: { t: number; p: Xy }[] = [];
  for (const hit of hits) {
    if (unique.length === 0 || Math.abs(hit.t - unique[unique.length - 1].t) > 1e-6) unique.push(hit);
  }
  const inside = (t: number) => contains(polygon, { x: a.x + dx * t, y: a.y + dy * t });
  const pieces: Xy[][] = [];
  if (unique.length === 0) {
    if (inside(0.5) === (keep === 'inside')) pieces.push([a, b]);
    return pieces;
  }
  const marks = [{ t: 0, p: a }, ...unique, { t: 1, p: b }];
  for (let i = 1; i < marks.length; i++) {
    const mid = (marks[i - 1].t + marks[i].t) / 2;
    if (marks[i].t - marks[i - 1].t < 1e-6) continue;
    if (inside(mid) === (keep === 'inside')) pieces.push([marks[i - 1].p, marks[i].p]);
  }
  return pieces;
}

/** Stored hatch loops: index 0 is the outer boundary, `holeIndexes` are unhatched, and the rest are islands. */
export function hatchRegions(loops: Xy[][], holeIndexes: readonly number[]): HatchBoundary | null {
  const outer = loops[0];
  if (!outer || outer.length < 3) return null;
  const holes = new Set(holeIndexes);
  return {
    outer,
    holes: loops.filter((loop, index) => holes.has(index) && loop.length >= 3),
    islands: loops.filter((loop, index) => index > 0 && !holes.has(index) && loop.length >= 3),
  };
}

/** Parallel hatch lines clipped to the outer loop, then split out of holes and filled back on islands. Capped so a tiny scale cannot flood the view. */
export function hatchLines(boundary: HatchBoundary, angleDeg: number, spacing: number, maxLines = 400): HatchLine[] {
  if (!(spacing > 0)) return [];
  const poly = boundary.outer;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const radius = Math.hypot(maxX - minX, maxY - minY);
  const angle = (angleDeg * Math.PI) / 180;
  const nx = Math.cos(angle + Math.PI / 2);
  const ny = Math.sin(angle + Math.PI / 2);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const count = Math.min(maxLines, Math.ceil(radius / spacing) + 2);
  const lines: HatchLine[] = [];
  for (let i = -count; i <= count; i++) {
    const ox = cx + nx * spacing * i;
    const oy = cy + ny * spacing * i;
    const a = { x: ox - dx * radius, y: oy - dy * radius, z: 0 };
    const b = { x: ox + dx * radius, y: oy + dy * radius, z: 0 };
    let pieces = clipSegment(a, b, poly, 'inside');
    for (const hole of boundary.holes) {
      const next: Xy[][] = [];
      for (const piece of pieces) next.push(...clipSegment(piece[0], piece[1], hole, 'outside'));
      pieces = next;
    }
    for (const island of boundary.islands ?? []) {
      pieces.push(...clipSegment(a, b, island, 'inside'));
    }
    pieces = pieces.filter((part) => Math.hypot(part[0].x - part[1].x, part[0].y - part[1].y) > 1e-4);
    for (const piece of pieces) lines.push({ a: piece[0], b: piece[1] });
    if (lines.length > maxLines * 4) break;
  }
  return lines;
}
