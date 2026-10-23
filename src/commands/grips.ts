import { signedOffset } from '../engine/dimension';
import { mapCadEntity } from '../engine/entityOps';
import {
  gripPoints,
  mirrored,
  moved,
  rotated,
  scaled,
  type DrawEntity,
  type DrawingDoc,
  type Vec3,
} from '../engine/drafting';

export type GripMode = 'stretch' | 'move' | 'rotate' | 'scale' | 'mirror';

export const GRIP_MODES: GripMode[] = ['stretch', 'move', 'rotate', 'scale', 'mirror'];

export function nearestGrip(doc: DrawingDoc, world: Vec3, tol: number): { id: string; index: number; point: Vec3 } | null {
  let bestId = '';
  let bestIndex = -1;
  let bestPoint: Vec3 | null = null;
  let bestDistance = Infinity;
  for (const id of doc.selection) {
    const entity = doc.entities.find((item) => item.id === id);
    if (!entity) continue;
    gripPoints(entity).forEach((point, index) => {
      const distance = Math.hypot(point.x - world.x, point.y - world.y);
      if (distance <= tol && distance < bestDistance) {
        bestId = id;
        bestIndex = index;
        bestPoint = point;
        bestDistance = distance;
      }
    });
  }
  return bestPoint ? { id: bestId, index: bestIndex, point: bestPoint } : null;
}

export function nextGripMode(mode: GripMode): GripMode {
  return GRIP_MODES[(GRIP_MODES.indexOf(mode) + 1) % GRIP_MODES.length];
}

export type GripScalePhase = 'run' | 'ref' | 'new';

export function scaleFactorFromReference(reference: number, next: number): number {
  if (!(reference > 0) || !(next > 0)) return 1;
  return next / reference;
}

export interface GripScaleResult {
  phase: GripScalePhase;
  reference: number;
  /** Set when the scale can be committed. */
  factor: number | null;
  ok: boolean;
}

/** Grip scale: a typed factor, or Reference length then new length. */
export function stepGripScale(phase: GripScalePhase, reference: number, action: 'reference' | 'length' | 'factor', value: number): GripScaleResult {
  if (action === 'reference' && phase === 'run') return { phase: 'ref', reference, factor: null, ok: true };
  if ((action === 'length' || action === 'factor') && !(value > 0)) return { phase, reference, factor: null, ok: false };
  if (action === 'length' && phase === 'ref') return { phase: 'new', reference: value, factor: null, ok: true };
  if (action === 'length' && phase === 'new') return { phase: 'run', reference, factor: scaleFactorFromReference(reference, value), ok: true };
  if (action === 'factor' && phase === 'run') return { phase: 'run', reference, factor: value, ok: true };
  return { phase, reference, factor: null, ok: false };
}

export function applyGrip(entity: DrawEntity, index: number, mode: GripMode, origin: Vec3, cursor: Vec3, scaleFactor?: number): DrawEntity {
  const dx = cursor.x - origin.x;
  const dy = cursor.y - origin.y;
  if (mode === 'move' || (mode === 'stretch' && isBodyGrip(entity, index))) return moved(entity, dx, dy);
  if (mode === 'rotate') return rotated(entity, origin, Math.atan2(dy, dx));
  if (mode === 'scale') {
    const factor = scaleFactor != null && scaleFactor > 0 ? scaleFactor : Math.max(1e-4, Math.hypot(dx, dy));
    return scaled(entity, origin, factor);
  }
  if (mode === 'mirror') return mirrored(entity, origin, cursor);
  return stretchOne(entity, origin, cursor);
}

function isBodyGrip(entity: DrawEntity, index: number): boolean {
  if (entity.type === 'line') return index === 2;
  if (entity.type === 'circle') return index === 0;
  if (entity.type === 'insert' || entity.type === 'text' || entity.type === 'mtext' || entity.type === 'point') return true;
  return false;
}

function stretchOne(entity: DrawEntity, origin: Vec3, cursor: Vec3): DrawEntity {
  const near = (p: Vec3) => Math.hypot(p.x - origin.x, p.y - origin.y) <= 1e-4;
  const move = (p: Vec3) => (near(p) ? { ...cursor, z: p.z } : p);
  if (entity.type === 'line') return { ...entity, a: move(entity.a), b: move(entity.b) };
  if (entity.type === 'polyline' || entity.type === 'revcloud') {
    return { ...entity, vertices: entity.vertices.map((vertex) => ({ ...move(vertex), bulge: vertex.bulge })) };
  }
  if (entity.type === 'spline') return { ...entity, points: entity.points.map(move) };
  if (entity.type === 'dimension') {
    const next = {
      ...entity,
      p1: move(entity.p1),
      p2: move(entity.p2),
      p3: move(entity.p3),
      loc: move(entity.loc),
    };
    if (near(entity.loc) || near(entity.p1) || near(entity.p2)) next.offset = signedOffset(next.p1, next.p2, next.loc);
    return next;
  }
  return mapCadEntity(entity, move, 1) ?? entity;
}

export function gripLabel(mode: GripMode): string {
  if (mode === 'stretch') return '** STRETCH ** Specify stretch point';
  if (mode === 'move') return '** MOVE ** Specify move point';
  if (mode === 'rotate') return '** ROTATE ** Specify rotation angle';
  if (mode === 'scale') return '** SCALE ** Specify scale factor or';
  return '** MIRROR ** Specify second point';
}
