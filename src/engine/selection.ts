import { pointInPolygon, segmentsProperlyIntersect, type Vec2 } from './geometry';
import { entityPath, layerOf, pointInBox, type DrawingDoc, type DrawEntity } from './drafting';

function ringHits(path: { x: number; y: number }[], ring: Vec2[], closed: boolean): boolean {
  if (path.length === 0) return false;
  if (path.every((point) => pointInPolygon(point, ring))) return true;
  if (!closed) return false;
  for (let i = 1; i < path.length; i++) {
    for (let j = 0; j < ring.length; j++) {
      const a = ring[j];
      const b = ring[(j + 1) % ring.length];
      if (segmentsProperlyIntersect(path[i - 1], path[i], a, b)) return true;
    }
  }
  return path.some((point) => pointInPolygon(point, ring));
}

/** Freeform window (drag left to right) or crossing (right to left) lasso. */
export function selectByLasso(doc: DrawingDoc, ring: Vec2[], crossing: boolean): string[] {
  if (ring.length < 3) return [];
  const ids: string[] = [];
  for (const entity of doc.entities) {
    const layer = layerOf(doc, entity);
    if (layer && (!layer.visible || layer.locked)) continue;
    const path = entityPath(entity, 12);
    if (path.length === 0) continue;
    if (!crossing) {
      if (path.every((point) => pointInPolygon(point, ring, 1e-6))) ids.push(entity.id);
      continue;
    }
    if (ringHits(path, ring, true)) ids.push(entity.id);
  }
  return ids;
}

export function similarEntities(doc: DrawingDoc, seeds: DrawEntity[]): string[] {
  if (seeds.length === 0) return [];
  const kinds = new Set(seeds.map((entity) => entity.type));
  const layers = new Set(seeds.map((entity) => entity.layer));
  return doc.entities.filter((entity) => kinds.has(entity.type) && layers.has(entity.layer)).map((entity) => entity.id);
}

export function lassoIsFreeform(origin: Vec2, points: Vec2[]): boolean {
  if (points.length < 6) return false;
  const box = {
    minX: Math.min(origin.x, ...points.map((point) => point.x)),
    maxX: Math.max(origin.x, ...points.map((point) => point.x)),
    minY: Math.min(origin.y, ...points.map((point) => point.y)),
    maxY: Math.max(origin.y, ...points.map((point) => point.y)),
  };
  const diag = Math.hypot(box.maxX - box.minX, box.maxY - box.minY);
  if (diag < 1e-6) return false;
  let off = 0;
  for (const point of points) {
    const onBox = pointInBox(point, box, diag * 0.08);
    if (!onBox) off += 1;
  }
  return off > points.length * 0.35;
}
