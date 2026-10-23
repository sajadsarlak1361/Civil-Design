import { blockByName, instancePoint } from '../engine/blocks';
import { ensureLibrary, effectiveDimStyle } from '../engine/cadLibrary';
import { isCadShape, type DrawArray, type DrawDimension, type DrawInsert } from '../engine/cadShapes';
import { dimensionGeometry } from '../engine/dimension';
import { pathArray, polarArray, rectangularArray } from '../engine/editGeom';
import { mapCadEntity, parseCadEntity } from '../engine/entityOps';
import { hatchLines, hatchPattern, hatchRegions } from '../engine/hatch';
import { displayColor, entityPath, type DrawEntity, type DrawingDoc, type Vec3 } from '../engine/drafting';
import type { PlanCamera } from './camera';
import { worldToScreen } from './camera';

function worldWidth(camera: PlanCamera, px: number): number {
  return px / Math.max(camera.scale, 1e-9);
}

export function isPaperEntity(doc: DrawingDoc, id: string): boolean {
  return Boolean(doc.library?.paperIds.includes(id));
}

/** Stroke a CAD entity in world space. Text is drawn later in screen space. */
export function drawCadWorld(ctx: CanvasRenderingContext2D, doc: DrawingDoc, entity: DrawEntity, camera: PlanCamera, depth = 0): boolean {
  if (!isCadShape(entity) || depth > 4) return false;
  const color = displayColor(doc, entity);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  if (entity.type === 'hatch') return drawHatch(ctx, entity, camera);
  if (entity.type === 'wipeout') return fillRing(ctx, entity.vertices, '#0b0d11', true);
  if (entity.type === 'region') return fillRing(ctx, entity.loops[0] ?? [], 'rgba(232, 238, 247, 0.08)', true);
  if (entity.type === 'donut') return drawDonut(ctx, entity.center, entity.inner, entity.outer, color);
  if (entity.type === 'dimension') return drawDimension(ctx, doc, entity, camera);
  if (entity.type === 'mleader') return drawLeader(ctx, entity, camera);
  if (entity.type === 'table') return drawTable(ctx, doc, entity, camera);
  if (entity.type === 'insert') return drawInsert(ctx, doc, entity, camera, depth);
  if (entity.type === 'array') return drawArray(ctx, doc, entity, camera, depth);
  if (entity.type === 'centermark') return drawCenterMark(ctx, entity.center, entity.size, camera);
  if (entity.type === 'centerline') {
    stroke(ctx, [entity.a, entity.b]);
    return true;
  }
  return false;
}

export function drawCadText(ctx: CanvasRenderingContext2D, doc: DrawingDoc, camera: PlanCamera, width: number, height: number): void {
  const library = doc.library ? ensureLibrary(doc) : null;
  for (const entity of doc.entities) {
    if (isPaperEntity(doc, entity.id)) continue;
    if (entity.type === 'mtext' || entity.type === 'attdef') {
      const content = entity.type === 'attdef' ? entity.tag : entity.content;
      paintMText(ctx, camera, width, height, entity.p, entity.height, entity.rotation, content, displayColor(doc, entity));
    }
    if (entity.type === 'dimension' && library) {
      const style = effectiveDimStyle(library, entity.style, entity.overrides);
      const geom = dimensionGeometry(entity, style, library.annotationScale);
      const screen = worldToScreen(camera, geom.textPoint.x, geom.textPoint.y, width, height);
      ctx.save();
      ctx.translate(screen.x, screen.y);
      ctx.rotate(-geom.textAngle);
      ctx.fillStyle = doc.selection.includes(entity.id) ? '#e3a23a' : '#e8eef7';
      ctx.font = `${Math.max(11, style.dimtxt * dimPx(style.dimscale, library.annotationScale, style.annotative) * camera.scale)}px IBM Plex Sans, sans-serif`;
      ctx.textAlign = entity.justify === 'left' ? 'left' : entity.justify === 'right' ? 'right' : 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(geom.text, 0, 0);
      ctx.restore();
    }
    if (entity.type === 'mleader') {
      const screen = worldToScreen(camera, entity.textPos.x, entity.textPos.y, width, height);
      ctx.fillStyle = displayColor(doc, entity);
      ctx.font = `${Math.max(11, 2.5 * camera.scale)}px IBM Plex Sans, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(entity.text, screen.x, screen.y);
    }
    if (entity.type === 'table') {
      entity.cells.forEach((cell, index) => {
        const col = index % entity.cols;
        const row = Math.floor(index / entity.cols);
        const screen = worldToScreen(camera, entity.p.x + col * entity.colWidth + 1, entity.p.y - row * entity.rowHeight - 1, width, height);
        ctx.fillStyle = '#e8eef7';
        ctx.font = `${Math.max(10, 2.2 * camera.scale)}px IBM Plex Sans, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(cell, screen.x, screen.y);
      });
    }
    if (entity.type === 'insert') {
      for (const attr of entity.attributes) {
        if (attr.invisible) continue;
        paintMText(ctx, camera, width, height, attr.p, attr.height, attr.rotation, attr.value || attr.tag, displayColor(doc, entity));
      }
    }
  }
}

export function drawGroupBoxes(ctx: CanvasRenderingContext2D, doc: DrawingDoc, camera: PlanCamera): void {
  const library = doc.library;
  if (!library?.groupBBox) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(126, 200, 255, 0.7)';
  ctx.lineWidth = worldWidth(camera, 1);
  ctx.setLineDash([worldWidth(camera, 4), worldWidth(camera, 3)]);
  for (const group of library.groups) {
    const points = doc.entities.filter((entity) => group.ids.includes(entity.id)).flatMap((entity) => entityPath(entity, 8));
    if (points.length === 0) continue;
    const minX = Math.min(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxX = Math.max(...points.map((point) => point.x));
    const maxY = Math.max(...points.map((point) => point.y));
    ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
  }
  ctx.restore();
}

function dimPx(dimscale: number, annotationScale: number, annotative: boolean): number {
  return (dimscale === 0 ? 1 : dimscale) * (annotative ? annotationScale : 1);
}

function stroke(ctx: CanvasRenderingContext2D, points: Vec3[]): void {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
}

function fillRing(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[], color: string, alsoStroke: boolean): boolean {
  if (points.length < 3) return false;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  if (alsoStroke) ctx.stroke();
  return true;
}

function traceLoop(ctx: CanvasRenderingContext2D, loop: { x: number; y: number }[]): void {
  ctx.moveTo(loop[0].x, loop[0].y);
  for (const point of loop) ctx.lineTo(point.x, point.y);
  ctx.closePath();
}

function drawHatch(ctx: CanvasRenderingContext2D, entity: Extract<DrawEntity, { type: 'hatch' }>, camera: PlanCamera): boolean {
  const regions = hatchRegions(entity.loops, entity.holes);
  if (!regions) return false;
  const { outer, holes, islands } = regions;
  const pattern = hatchPattern(entity.pattern);
  if (!pattern || pattern.family === 'SOLID' || pattern.family === 'gradient' || entity.gradient) {
    ctx.save();
    if (entity.gradient) {
      const grad = ctx.createLinearGradient(outer[0].x, outer[0].y, outer[Math.min(2, outer.length - 1)].x, outer[Math.min(2, outer.length - 1)].y);
      grad.addColorStop(0, entity.gradient.color1);
      grad.addColorStop(1, entity.gradient.color2);
      ctx.fillStyle = grad;
    } else ctx.fillStyle = 'rgba(227, 162, 58, 0.35)';
    ctx.beginPath();
    traceLoop(ctx, outer);
    for (const loop of holes) traceLoop(ctx, loop);
    for (const loop of islands) traceLoop(ctx, loop);
    ctx.fill('evenodd');
    ctx.restore();
    return true;
  }
  const lines = hatchLines(regions, entity.angle, Math.max(0.2, (pattern.space || 4) * entity.scale));
  ctx.save();
  ctx.lineWidth = worldWidth(camera, 1);
  for (const line of lines) stroke(ctx, [{ ...line.a, z: line.a.z ?? 0 }, { ...line.b, z: line.b.z ?? 0 }]);
  ctx.restore();
  return true;
}

function drawDonut(ctx: CanvasRenderingContext2D, center: Vec3, inner: number, outer: number, color: string): boolean {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(center.x, center.y, outer, 0, Math.PI * 2);
  if (inner > 0) ctx.arc(center.x, center.y, inner, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
  ctx.restore();
  return true;
}

function drawDimension(ctx: CanvasRenderingContext2D, doc: DrawingDoc, entity: DrawDimension, camera: PlanCamera): boolean {
  const library = ensureLibrary(doc);
  const style = effectiveDimStyle(library, entity.style, entity.overrides);
  const geom = dimensionGeometry(entity, style, library.annotationScale);
  ctx.save();
  ctx.lineWidth = worldWidth(camera, 1.25);
  ctx.strokeStyle = style.dimclre === 'bylayer' ? displayColor(doc, entity) : style.dimclre;
  if (!style.dimse1) stroke(ctx, geom.ext1);
  if (!style.dimse2) stroke(ctx, geom.ext2);
  ctx.strokeStyle = style.dimclrd === 'bylayer' ? displayColor(doc, entity) : style.dimclrd;
  stroke(ctx, geom.dim);
  if (geom.jog) stroke(ctx, geom.jog);
  for (const arrow of geom.arrows) {
    ctx.beginPath();
    ctx.moveTo(arrow[0].x, arrow[0].y);
    ctx.lineTo(arrow[1].x, arrow[1].y);
    ctx.lineTo(arrow[2].x, arrow[2].y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  return true;
}

function drawLeader(ctx: CanvasRenderingContext2D, entity: Extract<DrawEntity, { type: 'mleader' }>, camera: PlanCamera): boolean {
  ctx.save();
  ctx.lineWidth = worldWidth(camera, 1.25);
  for (const leader of entity.leaders) stroke(ctx, leader);
  ctx.restore();
  return true;
}

function drawTable(ctx: CanvasRenderingContext2D, doc: DrawingDoc, entity: Extract<DrawEntity, { type: 'table' }>, camera: PlanCamera): boolean {
  ctx.save();
  ctx.lineWidth = worldWidth(camera, 1);
  ctx.strokeStyle = displayColor(doc, entity);
  for (let row = 0; row <= entity.rows; row++) {
    stroke(ctx, [
      { x: entity.p.x, y: entity.p.y - row * entity.rowHeight, z: entity.p.z },
      { x: entity.p.x + entity.cols * entity.colWidth, y: entity.p.y - row * entity.rowHeight, z: entity.p.z },
    ]);
  }
  for (let col = 0; col <= entity.cols; col++) {
    stroke(ctx, [
      { x: entity.p.x + col * entity.colWidth, y: entity.p.y, z: entity.p.z },
      { x: entity.p.x + col * entity.colWidth, y: entity.p.y - entity.rows * entity.rowHeight, z: entity.p.z },
    ]);
  }
  ctx.restore();
  return true;
}

function drawInsert(ctx: CanvasRenderingContext2D, doc: DrawingDoc, insert: DrawInsert, camera: PlanCamera, depth: number): boolean {
  const block = blockByName(ensureLibrary(doc), insert.name);
  if (!block) {
    stroke(ctx, [insert.p, { x: insert.p.x + 2, y: insert.p.y, z: insert.p.z }]);
    return true;
  }
  for (const raw of block.entities) {
    const parsed = parseCadEntity(raw) ?? (raw as DrawEntity);
    if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) continue;
    const placed = mapCadEntity(parsed, (point) => instancePoint(block, insert, point), insert.sx) ?? placeClassic(parsed, (point) => instancePoint(block, insert, point));
    const record = { ...placed, id: insert.id, layer: insert.layer, color: insert.color };
    if (!drawCadWorld(ctx, doc, record, camera, depth + 1)) stroke(ctx, entityPath(record, 16));
  }
  return true;
}

function placeClassic(entity: DrawEntity, fn: (point: Vec3) => Vec3): DrawEntity {
  if (entity.type === 'line') return { ...entity, a: fn(entity.a), b: fn(entity.b) };
  if (entity.type === 'point' || entity.type === 'text') return { ...entity, p: fn(entity.p) };
  if (entity.type === 'circle' || entity.type === 'arc') return { ...entity, center: fn(entity.center) };
  if (entity.type === 'polyline') return { ...entity, vertices: entity.vertices.map((vertex) => ({ ...fn(vertex), bulge: vertex.bulge })) };
  return entity;
}

function drawArray(ctx: CanvasRenderingContext2D, doc: DrawingDoc, entity: DrawArray, camera: PlanCamera, depth: number): boolean {
  const items = entity.kind === 'polar'
    ? polarArray(entity.count, entity.fillAngle)
    : entity.kind === 'path'
      ? pathArray(entity.path, entity.count)
      : rectangularArray(entity.rows, entity.cols, entity.rowGap, entity.colGap);
  const source = parseCadEntity(entity.source) ?? (entity.source && typeof entity.source === 'object' && 'type' in entity.source ? entity.source as DrawEntity : null);
  for (const item of items) {
    ctx.save();
    ctx.translate(entity.center.x + item.x, entity.center.y + item.y);
    ctx.rotate(item.rotation);
    if (source && !drawCadWorld(ctx, doc, source, camera, depth + 1)) stroke(ctx, entityPath(source, 12));
    ctx.restore();
  }
  return true;
}

function drawCenterMark(ctx: CanvasRenderingContext2D, center: Vec3, size: number, camera: PlanCamera): boolean {
  const arm = Math.max(size, worldWidth(camera, 8));
  stroke(ctx, [{ x: center.x - arm, y: center.y, z: center.z }, { x: center.x + arm, y: center.y, z: center.z }]);
  stroke(ctx, [{ x: center.x, y: center.y - arm, z: center.z }, { x: center.x, y: center.y + arm, z: center.z }]);
  return true;
}

function paintMText(
  ctx: CanvasRenderingContext2D,
  camera: PlanCamera,
  width: number,
  height: number,
  p: Vec3,
  textHeight: number,
  rotation: number,
  content: string,
  color: string,
): void {
  const screen = worldToScreen(camera, p.x, p.y, width, height);
  const paragraphs = content.split('\\P');
  ctx.save();
  ctx.translate(screen.x, screen.y);
  ctx.rotate(-rotation);
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  let y = 0;
  for (const paragraph of paragraphs) {
    const plain = paragraph.replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '');
    const bold = paragraph.includes('\\B1');
    const italic = paragraph.includes('\\I1');
    const size = Math.max(10, textHeight * camera.scale);
    ctx.font = `${italic ? 'italic ' : ''}${bold ? '700 ' : ''}${size}px IBM Plex Sans, sans-serif`;
    ctx.fillText(plain, 0, y);
    y += size * 1.25;
  }
  ctx.restore();
}
