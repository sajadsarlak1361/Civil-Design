import { clothoidLocal, spiralOffsets } from './fresnel';
import { dist } from './geometry';
import type { LinearUnit, Vec2 } from './types';

/**
 * Horizontal alignment as a sequence of PIs.
 * An interior radius inserts a circular fillet. An optional spiral length adds a
 * pair of Euler spirals (clothoids) between the tangents and that arc.
 * A radius of 0 leaves an angle point.
 * Stationing runs along the solved centerline from startStation.
 * Positive offset is to the right of increasing station.
 */

export interface AlignmentPi {
  x: number;
  y: number;
  /** Curve radius at this PI. Ignored on the first and last PI. 0 keeps the angle point. */
  radius: number;
  /** Clothoid length on each side of the circular arc. 0 is a simple curve. */
  spiralLength?: number;
}

export interface AlignmentRecord {
  id: string;
  name: string;
  visible: boolean;
  startStation: number;
  pis: AlignmentPi[];
  labelInterval: number;
  profileInterval: number;
  sampleSpacing: number;
  sampleLeft: number;
  sampleRight: number;
  sectionStep: number;
  showSampleLines: boolean;
  designProfile?: { station: number; elevation: number; curveLength: number }[];
}

export interface LineEntity {
  kind: 'line';
  a: Vec2;
  b: Vec2;
  length: number;
  /** Distance from the start of the alignment. */
  start: number;
}

export interface ArcEntity {
  kind: 'arc';
  a: Vec2;
  b: Vec2;
  center: Vec2;
  radius: number;
  startAngle: number;
  /** Signed sweep in radians. Positive is a left turn (CCW). */
  sweep: number;
  length: number;
  start: number;
  turn: 'left' | 'right';
}

export interface SpiralEntity {
  kind: 'spiral';
  a: Vec2;
  b: Vec2;
  length: number;
  start: number;
  radius: number;
  /** Flat end, where curvature is zero. */
  flat: Vec2;
  /** Unit direction from the flat end toward increasing curvature. */
  fx: number;
  fy: number;
  /** +1 keeps clothoid y to the left of that direction. */
  side: 1 | -1;
  /** +1 when station increases as curvature increases. */
  curvatureSign: 1 | -1;
}

export type AlignmentEntity = LineEntity | ArcEntity | SpiralEntity;

export interface SolvedAlignment {
  entities: AlignmentEntity[];
  length: number;
  pis: AlignmentPi[];
  /** Radius actually used at each PI after tangents are fitted between PIs. */
  radii: number[];
  /** Clothoid length actually used on each side of the arc. */
  spirals: number[];
  warnings: string[];
}

export interface AlignmentPoint {
  x: number;
  y: number;
  /** Unit tangent in the direction of increasing station. */
  tx: number;
  ty: number;
}

export interface StationTick extends AlignmentPoint {
  station: number;
}

const MIN_DEFLECTION = 1e-4;
const MAX_DEFLECTION = Math.PI * 0.98;

export function solveAlignment(pis: AlignmentPi[]): SolvedAlignment {
  const cleaned = dedupePis(pis);
  if (cleaned.length < 2) {
    return { entities: [], length: 0, pis: cleaned, radii: cleaned.map(() => 0), spirals: cleaned.map(() => 0), warnings: [] };
  }
  const fitted = fitRadii(cleaned);
  const entities = buildEntities(cleaned, fitted.radii, fitted.spirals);
  const length = entities.reduce((sum, entity) => sum + entity.length, 0);
  return { entities, length, pis: cleaned, radii: fitted.radii, spirals: fitted.spirals, warnings: fitted.warnings };
}

export function alignmentFromPolyline(points: Vec2[], radius = 0, spiralLength = 0): AlignmentPi[] {
  const last = points.length - 1;
  return points.map((point, index) => ({
    x: point.x,
    y: point.y,
    radius: index === 0 || index === last ? 0 : Math.max(0, radius),
    spiralLength: index === 0 || index === last ? 0 : Math.max(0, spiralLength),
  }));
}

/** Tessellate one solved entity for drawing. Lines stay exact. */
export function entityPolyline(entity: AlignmentEntity, segments = 16): Vec2[] {
  if (entity.kind === 'line') return [entity.a, entity.b];
  const count = entity.kind === 'spiral' ? Math.max(12, segments) : Math.max(8, Math.ceil(Math.abs(entity.kind === 'arc' ? entity.sweep : 1) / (Math.PI / 24)));
  const points: Vec2[] = [];
  for (let i = 0; i <= count; i++) {
    const at = pointOnEntity(entity, (entity.length * i) / count);
    points.push({ x: at.x, y: at.y });
  }
  return points;
}

export function pointAtDistance(solved: SolvedAlignment, distance: number): AlignmentPoint | null {
  if (solved.entities.length === 0 || solved.length <= 0) return null;
  const target = Math.min(Math.max(distance, 0), solved.length);
  for (const entity of solved.entities) {
    const end = entity.start + entity.length;
    if (target > end + 1e-8 && entity !== solved.entities[solved.entities.length - 1]) continue;
    return pointOnEntity(entity, target - entity.start);
  }
  const last = solved.entities[solved.entities.length - 1];
  return pointOnEntity(last, last.length);
}

export function pointAtStation(solved: SolvedAlignment, startStation: number, station: number): AlignmentPoint | null {
  return pointAtDistance(solved, station - startStation);
}

export function stationTicks(solved: SolvedAlignment, startStation: number, interval: number): StationTick[] {
  if (solved.length <= 0) return [];
  const step = interval > 1e-6 ? interval : solved.length;
  const ticks: StationTick[] = [];
  for (let distance = 0; distance <= solved.length + 1e-6; distance += step) {
    const along = Math.min(distance, solved.length);
    const point = pointAtDistance(solved, along);
    if (point) ticks.push({ station: startStation + along, ...point });
    if (along >= solved.length - 1e-6) break;
    if (ticks.length > 10000) break;
  }
  const endStation = startStation + solved.length;
  const last = ticks[ticks.length - 1];
  if (!last || Math.abs(last.station - endStation) > 1e-3) {
    const point = pointAtDistance(solved, solved.length);
    if (point) ticks.push({ station: endStation, ...point });
  }
  return ticks;
}

/** Metric stations are kilometers + meters. Foot stations are hundreds + feet. */
export function formatStation(station: number, unit: LinearUnit): string {
  if (!Number.isFinite(station)) return '—';
  const sign = station < 0 ? '-' : '';
  const abs = Math.abs(station);
  if (unit === 'ft') {
    const hundreds = Math.floor(abs / 100);
    const feet = abs - hundreds * 100;
    return `${sign}${hundreds}+${feet.toFixed(2).padStart(5, '0')}`;
  }
  const kilometers = Math.floor(abs / 1000);
  const meters = abs - kilometers * 1000;
  return `${sign}${kilometers}+${meters.toFixed(2).padStart(6, '0')}`;
}

export function entityEndpoints(solved: SolvedAlignment): number[] {
  const distances = [0];
  for (const entity of solved.entities) distances.push(entity.start + entity.length);
  return distances;
}

function dedupePis(pis: AlignmentPi[]): AlignmentPi[] {
  const cleaned: AlignmentPi[] = [];
  for (const pi of pis) {
    if (!Number.isFinite(pi.x) || !Number.isFinite(pi.y)) continue;
    const previous = cleaned[cleaned.length - 1];
    if (previous && dist(previous, pi) < 1e-6) continue;
    cleaned.push({
      x: pi.x,
      y: pi.y,
      radius: Number.isFinite(pi.radius) ? Math.max(0, pi.radius) : 0,
      spiralLength: Number.isFinite(pi.spiralLength) ? Math.max(0, pi.spiralLength ?? 0) : 0,
    });
  }
  if (cleaned.length > 0) cleaned[0].radius = 0;
  if (cleaned.length > 1) cleaned[cleaned.length - 1].radius = 0;
  return cleaned;
}

function fitRadii(pis: AlignmentPi[]): { radii: number[]; spirals: number[]; warnings: string[] } {
  const radii = pis.map((pi, index) => (index === 0 || index === pis.length - 1 ? 0 : pi.radius));
  const spirals = pis.map((pi, index) => (index === 0 || index === pis.length - 1 ? 0 : Math.max(0, pi.spiralLength ?? 0)));
  const warnings: string[] = [];
  const segment = segmentLengths(pis);
  let reduced = false;
  const clampSpirals = () => {
    for (let i = 1; i < pis.length - 1; i++) {
      if (!(radii[i] > 0) || !(spirals[i] > 0)) {
        spirals[i] = 0;
        continue;
      }
      const incoming = direction(pis[i - 1], pis[i]);
      const outgoing = direction(pis[i], pis[i + 1]);
      if (!incoming || !outgoing) {
        spirals[i] = 0;
        continue;
      }
      const delta = Math.abs(Math.atan2(incoming.x * outgoing.y - incoming.y * outgoing.x, incoming.x * outgoing.x + incoming.y * outgoing.y));
      const maxLength = radii[i] * delta * 0.85;
      if (spirals[i] > maxLength) {
        spirals[i] = Math.max(0, maxLength);
        reduced = true;
      }
    }
  };
  for (let iteration = 0; iteration < 16; iteration++) {
    clampSpirals();
    const curves = curveInfo(pis, radii, spirals);
    const scale = radii.map(() => 1);
    let changed = false;
    for (let s = 0; s < segment.length; s++) {
      const incoming = s > 0 ? curves[s].tangent : 0;
      const outgoing = s + 1 < pis.length - 1 ? curves[s + 1].tangent : 0;
      const available = segment[s];
      if (incoming + outgoing <= available * (1 - 1e-9)) continue;
      changed = true;
      reduced = true;
      const factor = available <= 1e-8 ? 0 : (available * 0.98) / Math.max(incoming + outgoing, 1e-9);
      if (s > 0 && radii[s] > 0) scale[s] = Math.min(scale[s], factor);
      if (s + 1 < pis.length - 1 && radii[s + 1] > 0) scale[s + 1] = Math.min(scale[s + 1], factor);
    }
    if (!changed) break;
    for (let i = 0; i < radii.length; i++) {
      radii[i] *= scale[i];
      spirals[i] *= scale[i];
    }
  }
  clampSpirals();
  const curves = curveInfo(pis, radii, spirals);
  for (let i = 1; i < pis.length - 1; i++) {
    if (pis[i].radius > 0 && curves[i].tangent <= 1e-8 && Math.abs(curves[i].delta) <= MIN_DEFLECTION) {
      radii[i] = 0;
      spirals[i] = 0;
    } else if (pis[i].radius > 0 && Math.abs(curves[i].delta) >= MAX_DEFLECTION) {
      radii[i] = 0;
      spirals[i] = 0;
      warnings.push(`Curve at PI ${i + 1} was dropped because the deflection is too sharp for a fillet.`);
    } else if ((pis[i].spiralLength ?? 0) > 0 && spirals[i] + 1e-6 < (pis[i].spiralLength ?? 0)) {
      warnings.push(`Spiral at PI ${i + 1} was shortened so it fits the deflection and the tangents.`);
    }
  }
  if (reduced && !warnings.some((warning) => warning.includes('reduced'))) {
    warnings.push('One or more curve radii were reduced so the tangents fit between PIs.');
  }
  return { radii, spirals, warnings };
}

function buildEntities(pis: AlignmentPi[], radii: number[], spirals: number[]): AlignmentEntity[] {
  const curves = curveInfo(pis, radii, spirals);
  const entities: AlignmentEntity[] = [];
  let cursor: Vec2 = { x: pis[0].x, y: pis[0].y };
  let distance = 0;
  const pushLine = (end: Vec2) => {
    const length = dist(cursor, end);
    if (length <= 1e-8) {
      cursor = end;
      return;
    }
    entities.push({ kind: 'line', a: cursor, b: end, length, start: distance });
    distance += length;
    cursor = end;
  };
  for (let i = 1; i < pis.length - 1; i++) {
    const curve = curves[i];
    if (curve.tangent <= 1e-8) {
      pushLine({ x: pis[i].x, y: pis[i].y });
      continue;
    }
    const incoming = direction(pis[i - 1], pis[i]);
    const outgoing = direction(pis[i], pis[i + 1]);
    if (!incoming || !outgoing) {
      pushLine({ x: pis[i].x, y: pis[i].y });
      continue;
    }
    const left = curve.delta > 0;
    const side = left ? 1 : -1;
    if (curve.spiral > 0.05) {
      const ts = { x: pis[i].x - incoming.x * curve.tangent, y: pis[i].y - incoming.y * curve.tangent };
      const st = { x: pis[i].x + outgoing.x * curve.tangent, y: pis[i].y + outgoing.y * curve.tangent };
      const end = clothoidLocal(curve.radius, curve.spiral, curve.spiral);
      const inLeft = { x: -incoming.y, y: incoming.x };
      const sc = {
        x: ts.x + end.x * incoming.x + side * end.y * inLeft.x,
        y: ts.y + end.x * incoming.y + side * end.y * inLeft.y,
      };
      const tanSc = rotate(incoming, side * end.theta);
      const inward = scaleVec(leftNormal(tanSc), side);
      const center = { x: sc.x + curve.radius * inward.x, y: sc.y + curve.radius * inward.y };
      const sweep = side * (Math.abs(curve.delta) - 2 * end.theta);
      const startAngle = Math.atan2(sc.y - center.y, sc.x - center.x);
      const cs = {
        x: center.x + curve.radius * Math.cos(startAngle + sweep),
        y: center.y + curve.radius * Math.sin(startAngle + sweep),
      };
      pushLine(ts);
      entities.push(spiralEntity(ts, sc, curve.radius, curve.spiral, incoming, side as 1 | -1, 1, distance));
      distance += curve.spiral;
      const arcLength = Math.abs(sweep) * curve.radius;
      if (arcLength > 1e-8) {
        entities.push({
          kind: 'arc',
          a: sc,
          b: cs,
          center,
          radius: curve.radius,
          startAngle,
          sweep,
          length: arcLength,
          start: distance,
          turn: left ? 'left' : 'right',
        });
        distance += arcLength;
      }
      const back = { x: -outgoing.x, y: -outgoing.y };
      entities.push(spiralEntity(cs, st, curve.radius, curve.spiral, back, (side === 1 ? -1 : 1) as 1 | -1, -1, distance));
      distance += curve.spiral;
      cursor = st;
      continue;
    }
    const pc = { x: pis[i].x - incoming.x * curve.tangent, y: pis[i].y - incoming.y * curve.tangent };
    const pt = { x: pis[i].x + outgoing.x * curve.tangent, y: pis[i].y + outgoing.y * curve.tangent };
    pushLine(pc);
    const normal = left ? { x: -incoming.y, y: incoming.x } : { x: incoming.y, y: -incoming.x };
    const center = { x: pc.x + curve.radius * normal.x, y: pc.y + curve.radius * normal.y };
    const startAngle = Math.atan2(pc.y - center.y, pc.x - center.x);
    const endAngle = Math.atan2(pt.y - center.y, pt.x - center.x);
    let sweep = endAngle - startAngle;
    if (left) {
      while (sweep <= 0) sweep += Math.PI * 2;
    } else {
      while (sweep >= 0) sweep -= Math.PI * 2;
    }
    const length = Math.abs(sweep) * curve.radius;
    if (length > 1e-8) {
      entities.push({
        kind: 'arc',
        a: pc,
        b: pt,
        center,
        radius: curve.radius,
        startAngle,
        sweep,
        length,
        start: distance,
        turn: left ? 'left' : 'right',
      });
      distance += length;
    }
    cursor = pt;
  }
  pushLine({ x: pis[pis.length - 1].x, y: pis[pis.length - 1].y });
  return entities;
}

interface CurveInfo {
  delta: number;
  tangent: number;
  radius: number;
  spiral: number;
}

function curveInfo(pis: AlignmentPi[], radii: number[], spirals: number[]): CurveInfo[] {
  return pis.map((_pi, index) => {
    if (index === 0 || index === pis.length - 1) return { delta: 0, tangent: 0, radius: 0, spiral: 0 };
    const incoming = direction(pis[index - 1], pis[index]);
    const outgoing = direction(pis[index], pis[index + 1]);
    if (!incoming || !outgoing) return { delta: 0, tangent: 0, radius: 0, spiral: 0 };
    const delta = Math.atan2(incoming.x * outgoing.y - incoming.y * outgoing.x, incoming.x * outgoing.x + incoming.y * outgoing.y);
    const radius = radii[index] ?? 0;
    const spiral = spirals[index] ?? 0;
    if (radius <= 1e-8 || Math.abs(delta) < MIN_DEFLECTION || Math.abs(delta) > MAX_DEFLECTION) {
      return { delta, tangent: 0, radius: 0, spiral: 0 };
    }
    if (spiral > 0.05 && spiral < radius * Math.abs(delta) * 0.9) {
      const shift = spiralOffsets(radius, spiral);
      if (2 * shift.theta < Math.abs(delta) - 1e-4) {
        return { delta, tangent: (radius + shift.p) * Math.tan(Math.abs(delta) / 2) + shift.k, radius, spiral };
      }
    }
    return { delta, tangent: radius * Math.tan(Math.abs(delta) / 2), radius, spiral: 0 };
  });
}

function segmentLengths(pis: AlignmentPi[]): number[] {
  const lengths: number[] = [];
  for (let i = 0; i < pis.length - 1; i++) lengths.push(dist(pis[i], pis[i + 1]));
  return lengths;
}

function direction(a: Vec2, b: Vec2): Vec2 | null {
  const length = dist(a, b);
  if (length < 1e-9) return null;
  return { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
}

function pointOnEntity(entity: AlignmentEntity, along: number): AlignmentPoint {
  const clamped = Math.min(Math.max(along, 0), entity.length);
  if (entity.kind === 'line') {
    const t = entity.length <= 1e-12 ? 0 : clamped / entity.length;
    const tx = (entity.b.x - entity.a.x) / entity.length;
    const ty = (entity.b.y - entity.a.y) / entity.length;
    return { x: entity.a.x + (entity.b.x - entity.a.x) * t, y: entity.a.y + (entity.b.y - entity.a.y) * t, tx, ty };
  }
  if (entity.kind === 'spiral') {
    const l = entity.curvatureSign > 0 ? clamped : entity.length - clamped;
    const local = clothoidLocal(entity.radius, entity.length, l);
    const left = leftNormal({ x: entity.fx, y: entity.fy });
    let tx = local.tx * entity.fx + entity.side * local.ty * left.x;
    let ty = local.tx * entity.fy + entity.side * local.ty * left.y;
    if (entity.curvatureSign < 0) {
      tx = -tx;
      ty = -ty;
    }
    const mag = Math.hypot(tx, ty) || 1;
    return {
      x: entity.flat.x + local.x * entity.fx + entity.side * local.y * left.x,
      y: entity.flat.y + local.x * entity.fy + entity.side * local.y * left.y,
      tx: tx / mag,
      ty: ty / mag,
    };
  }
  const t = entity.length <= 1e-12 ? 0 : clamped / entity.length;
  const angle = entity.startAngle + t * entity.sweep;
  const sign = entity.sweep >= 0 ? 1 : -1;
  return {
    x: entity.center.x + entity.radius * Math.cos(angle),
    y: entity.center.y + entity.radius * Math.sin(angle),
    tx: -Math.sin(angle) * sign,
    ty: Math.cos(angle) * sign,
  };
}

function spiralEntity(
  a: Vec2,
  b: Vec2,
  radius: number,
  length: number,
  axis: Vec2,
  side: 1 | -1,
  curvatureSign: 1 | -1,
  start: number,
): SpiralEntity {
  const flat = curvatureSign > 0 ? a : b;
  return {
    kind: 'spiral',
    a,
    b,
    length,
    start,
    radius,
    flat,
    fx: axis.x,
    fy: axis.y,
    side,
    curvatureSign,
  };
}

function leftNormal(v: Vec2): Vec2 {
  return { x: -v.y, y: v.x };
}

function scaleVec(v: Vec2, scale: number): Vec2 {
  return { x: v.x * scale, y: v.y * scale };
}

function rotate(v: Vec2, angle: number): Vec2 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}
