import { pointAtDistance, type AlignmentPoint, type SolvedAlignment } from './alignment';
import type { Vec2 } from './types';

export interface CurbReturn {
  pc: Vec2;
  pt: Vec2;
  center: Vec2;
  radius: number;
  /** Signed sweep in radians. Positive is counter-clockwise. */
  sweep: number;
  startAngle: number;
  length: number;
  tangent: number;
  turn: 'left' | 'right';
}

export interface AlignmentCrossing {
  stationA: number;
  stationB: number;
  point: Vec2;
  tangentA: AlignmentPoint;
  tangentB: AlignmentPoint;
  distance: number;
}

function lineIntersection(originA: Vec2, dirA: Vec2, originB: Vec2, dirB: Vec2): Vec2 | null {
  const cross = dirA.x * dirB.y - dirA.y * dirB.x;
  if (Math.abs(cross) < 1e-10) return null;
  const dx = originB.x - originA.x;
  const dy = originB.y - originA.y;
  const t = (dx * dirB.y - dy * dirB.x) / cross;
  return { x: originA.x + dirA.x * t, y: originA.y + dirA.y * t };
}

export function alignmentCrossing(a: SolvedAlignment, aStart: number, b: SolvedAlignment, bStart: number): AlignmentCrossing | null {
  if (a.length <= 0 || b.length <= 0) return null;
  const step = 1;
  let bestA = 0;
  let bestB = 0;
  let best = Infinity;
  for (let da = 0; da <= a.length + 1e-6; da += step) {
    const pa = pointAtDistance(a, Math.min(da, a.length));
    if (!pa) continue;
    for (let db = 0; db <= b.length + 1e-6; db += step) {
      const pb = pointAtDistance(b, Math.min(db, b.length));
      if (!pb) continue;
      const d = (pa.x - pb.x) ** 2 + (pa.y - pb.y) ** 2;
      if (d < best) {
        best = d;
        bestA = Math.min(da, a.length);
        bestB = Math.min(db, b.length);
      }
    }
  }
  if (best > 2.25) return null;
  let loA = Math.max(0, bestA - step);
  let hiA = Math.min(a.length, bestA + step);
  let loB = Math.max(0, bestB - step);
  let hiB = Math.min(b.length, bestB + step);
  for (let iteration = 0; iteration < 12; iteration++) {
    let localBest = Infinity;
    let nextA = loA;
    let nextB = loB;
    const slices = 8;
    for (let i = 0; i <= slices; i++) {
      const da = loA + ((hiA - loA) * i) / slices;
      const pa = pointAtDistance(a, da);
      if (!pa) continue;
      for (let j = 0; j <= slices; j++) {
        const db = loB + ((hiB - loB) * j) / slices;
        const pb = pointAtDistance(b, db);
        if (!pb) continue;
        const d = (pa.x - pb.x) ** 2 + (pa.y - pb.y) ** 2;
        if (d < localBest) {
          localBest = d;
          nextA = da;
          nextB = db;
        }
      }
    }
    const spanA = (hiA - loA) / slices;
    const spanB = (hiB - loB) / slices;
    loA = Math.max(0, nextA - spanA);
    hiA = Math.min(a.length, nextA + spanA);
    loB = Math.max(0, nextB - spanB);
    hiB = Math.min(b.length, nextB + spanB);
    best = localBest;
    bestA = nextA;
    bestB = nextB;
  }
  const tangentA = pointAtDistance(a, bestA);
  const tangentB = pointAtDistance(b, bestB);
  if (!tangentA || !tangentB) return null;
  return {
    stationA: aStart + bestA,
    stationB: bStart + bestB,
    point: { x: (tangentA.x + tangentB.x) / 2, y: (tangentA.y + tangentB.y) / 2 },
    tangentA,
    tangentB,
    distance: Math.sqrt(best),
  };
}

function unitDot(ax: number, ay: number, bx: number, by: number): number {
  return ax * bx + ay * by;
}

/**
 * Curb return between two edge-of-lane lines.
 * `sideA` and `sideB` are +1 for the right of each tangent and -1 for the left.
 * Incoming travel points toward the edge intersection; outgoing travel points away
 * from the centerline crossing.
 */
export function curbReturn(
  approach: AlignmentPoint,
  depart: AlignmentPoint,
  laneWidth: number,
  radius: number,
  sideA: 1 | -1 = -1,
  sideB: 1 | -1 = 1,
): CurbReturn | null {
  if (!(radius > 0.05) || !(laneWidth > 0)) return null;
  const edgeApproach = {
    x: approach.x + approach.ty * laneWidth * sideA,
    y: approach.y - approach.tx * laneWidth * sideA,
  };
  const edgeDepart = {
    x: depart.x + depart.ty * laneWidth * sideB,
    y: depart.y - depart.tx * laneWidth * sideB,
  };
  const pi = lineIntersection(edgeApproach, { x: approach.tx, y: approach.ty }, edgeDepart, { x: depart.tx, y: depart.ty });
  if (!pi) return null;
  const towardX = pi.x - edgeApproach.x;
  const towardY = pi.y - edgeApproach.y;
  const approachSign = unitDot(towardX, towardY, approach.tx, approach.ty) >= 0 ? 1 : -1;
  const incoming = { x: approach.tx * approachSign, y: approach.ty * approachSign };
  const awayX = pi.x - approach.x;
  const awayY = pi.y - approach.y;
  const departSign = unitDot(awayX, awayY, depart.tx, depart.ty) >= 0 ? 1 : -1;
  const outgoing = { x: depart.tx * departSign, y: depart.ty * departSign };
  const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
  const delta = Math.atan2(cross, incoming.x * outgoing.x + incoming.y * outgoing.y);
  if (Math.abs(delta) < 0.08 || Math.abs(Math.abs(delta) - Math.PI) < 0.08) return null;
  const tangent = radius * Math.tan(Math.abs(delta) / 2);
  if (!Number.isFinite(tangent) || tangent <= 0 || tangent > 5000) return null;
  const pc = { x: pi.x - incoming.x * tangent, y: pi.y - incoming.y * tangent };
  const pt = { x: pi.x + outgoing.x * tangent, y: pi.y + outgoing.y * tangent };
  const leftX = -incoming.y;
  const leftY = incoming.x;
  const center = {
    x: pc.x + (delta > 0 ? leftX : -leftX) * radius,
    y: pc.y + (delta > 0 ? leftY : -leftY) * radius,
  };
  const startAngle = Math.atan2(pc.y - center.y, pc.x - center.x);
  let sweep = Math.atan2(pt.y - center.y, pt.x - center.x) - startAngle;
  if (delta > 0) {
    while (sweep <= 0) sweep += Math.PI * 2;
  } else {
    while (sweep >= 0) sweep -= Math.PI * 2;
  }
  if (Math.abs(Math.abs(sweep) - Math.abs(delta)) > 0.25) return null;
  return {
    pc,
    pt,
    center,
    radius,
    sweep,
    startAngle,
    length: Math.abs(sweep) * radius,
    tangent,
    turn: delta > 0 ? 'left' : 'right',
  };
}

export function curbReturns(crossing: AlignmentCrossing, laneWidth: number, radius: number): CurbReturn[] {
  const approach = { ...crossing.tangentA, x: crossing.point.x, y: crossing.point.y };
  const depart = { ...crossing.tangentB, x: crossing.point.x, y: crossing.point.y };
  const returns: CurbReturn[] = [];
  for (const sideA of [1, -1] as const) {
    for (const sideB of [1, -1] as const) {
      const fit = curbReturn(approach, depart, laneWidth, radius, sideA, sideB);
      if (!fit) continue;
      const duplicate = returns.some((existing) => Math.hypot(existing.center.x - fit.center.x, existing.center.y - fit.center.y) < radius * 0.25);
      if (!duplicate) returns.push(fit);
    }
  }
  return returns;
}
