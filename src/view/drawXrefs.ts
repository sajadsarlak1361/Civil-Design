import type { DrawEntity } from '../engine/drafting';
import { hostVisible, placedEntities, pointInClip, xrefBounds, type XrefFile } from '../engine/xref';
import type { PlanCamera } from './camera';
import { worldToScreen } from './camera';

function anchor(entity: DrawEntity): { x: number; y: number } {
  if (entity.type === 'point' || entity.type === 'text' || entity.type === 'block' || entity.type === 'mtext' || entity.type === 'insert' || entity.type === 'attdef' || entity.type === 'table') return entity.p;
  if (entity.type === 'line' || entity.type === 'xline' || entity.type === 'ray') return entity.a;
  if (entity.type === 'dimension') return entity.loc;
  if (entity.type === 'polyline' || entity.type === 'wipeout' || entity.type === 'revcloud') return entity.vertices[0] ?? { x: 0, y: 0 };
  if (entity.type === 'circle' || entity.type === 'arc' || entity.type === 'ellipse' || entity.type === 'donut' || entity.type === 'centermark' || entity.type === 'centerline' || entity.type === 'array') return entity.center;
  if (entity.type === 'spline') return entity.points[0] ?? { x: 0, y: 0 };
  if (entity.type === 'hatch' || entity.type === 'region') return entity.loops[0]?.[0] ?? { x: 0, y: 0 };
  if (entity.type === 'mleader') return entity.textPos;
  return { x: 0, y: 0 };
}

/** Draw attached xrefs in the plan view. Geometry stays on the xref; a large xref draws as its box. */
export function drawXrefs(ctx: CanvasRenderingContext2D, camera: PlanCamera, doc: XrefFile, width: number, height: number): void {
  ctx.save();
  ctx.globalAlpha = 1 - doc.xfade / 100;
  ctx.lineWidth = 1;
  for (const record of doc.records) {
    if (!hostVisible(doc, record)) continue;
    const bounds = xrefBounds(record);
    const selected = doc.selectedId === record.id;
    if (record.kind === 'image' && record.image && bounds) {
      const a = worldToScreen(camera, bounds.minX, bounds.maxY, width, height);
      const b = worldToScreen(camera, bounds.maxX, bounds.minY, width, height);
      ctx.strokeStyle = selected ? '#e3a23a' : '#8eb7ff';
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.fillStyle = '#8eb7ff';
      ctx.font = '12px sans-serif';
      ctx.fillText(record.name, a.x + 4, a.y + 14);
    }
    const entities = record.snapshot?.entities ?? [];
    if (entities.length > 4000 && bounds) {
      const a = worldToScreen(camera, bounds.minX, bounds.minY, width, height);
      const b = worldToScreen(camera, bounds.maxX, bounds.maxY, width, height);
      ctx.strokeStyle = '#8eb7ff';
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      continue;
    }
    ctx.strokeStyle = selected ? '#e3a23a' : '#c5d4ea';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    for (const entity of placedEntities(record)) {
      const at = anchor(entity);
      if (!pointInClip(record.clip, at.x, at.y)) continue;
      if (entity.type === 'line') {
        const a = worldToScreen(camera, entity.a.x, entity.a.y, width, height);
        const b = worldToScreen(camera, entity.b.x, entity.b.y, width, height);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      } else if (entity.type === 'polyline') {
        entity.vertices.forEach((vertex, index) => {
          const screen = worldToScreen(camera, vertex.x, vertex.y, width, height);
          if (index === 0) ctx.moveTo(screen.x, screen.y);
          else ctx.lineTo(screen.x, screen.y);
        });
      } else if (entity.type === 'point' || entity.type === 'text') {
        const screen = worldToScreen(camera, entity.p.x, entity.p.y, width, height);
        ctx.fillRect(screen.x - 2, screen.y - 2, 4, 4);
      } else if (entity.type === 'circle') {
        const screen = worldToScreen(camera, entity.center.x, entity.center.y, width, height);
        ctx.moveTo(screen.x + entity.radius * camera.scale, screen.y);
        ctx.arc(screen.x, screen.y, Math.abs(entity.radius) * camera.scale, 0, Math.PI * 2);
      }
    }
    ctx.stroke();
    if (record.clip && record.clip.enabled && doc.xclipFrame !== 0 && record.clip.points.length >= 2) {
      ctx.beginPath();
      record.clip.points.forEach((point, index) => {
        const screen = worldToScreen(camera, point.x, point.y, width, height);
        if (index === 0) ctx.moveTo(screen.x, screen.y);
        else ctx.lineTo(screen.x, screen.y);
      });
      ctx.closePath();
      ctx.strokeStyle = '#f0d78c';
      ctx.stroke();
    }
  }
  ctx.restore();
}
