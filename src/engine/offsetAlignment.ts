import { pointAtDistance, type AlignmentPi, type SolvedAlignment } from './alignment';
import type { Vec2 } from './types';

/**
 * Constant offset of a solved alignment. Positive offset is to the right of
 * increasing station. Lines and arcs are sampled tightly enough that the
 * chord error stays under about 2 cm on a 100 m radius.
 */
export function offsetAlignmentPis(solved: SolvedAlignment, offset: number): { pis: AlignmentPi[]; warnings: string[] } {
  const warnings: string[] = [];
  if (solved.entities.length === 0 || !(solved.length > 0)) {
    return { pis: [], warnings: ['The alignment is too short to offset.'] };
  }
  const points: Vec2[] = [];
  const push = (point: Vec2) => {
    const last = points[points.length - 1];
    if (!last || Math.hypot(last.x - point.x, last.y - point.y) > 1e-4) points.push(point);
  };
  for (const entity of solved.entities) {
    const steps =
      entity.kind === 'line' ? 1 : Math.max(2, Math.ceil((entity.kind === 'arc' ? Math.abs(entity.sweep) : entity.length) / (entity.kind === 'arc' ? Math.PI / 90 : 1)));
    for (let i = 0; i <= steps; i++) {
      const at = pointAtDistance(solved, entity.start + (entity.length * i) / steps);
      if (!at) continue;
      push({ x: at.x + at.ty * offset, y: at.y - at.tx * offset });
    }
    if (entity.kind === 'arc') {
      const inward = entity.turn === 'right' ? offset : -offset;
      if (entity.radius - inward <= 0.05) {
        warnings.push('An inward offset is larger than a curve radius, so that curve was sampled instead of solved as a concentric arc.');
      }
    }
  }
  if (points.length < 2) return { pis: [], warnings: ['The offset collapsed to a point.'] };
  return {
    pis: points.map((point) => ({ x: point.x, y: point.y, radius: 0 })),
    warnings,
  };
}
