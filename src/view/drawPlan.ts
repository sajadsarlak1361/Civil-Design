import {
  boundsOf,
  cutFillColor,
  elevationColor,
  entityPolyline,
  formatStation,
  rgbCss,
  slopeColor,
  triangleSlope,
  volumeColorScale,
  type AlignmentEntity,
  type ContourPolyline,
  type SampleLine,
  type StationTick,
  type SurfaceRecord,
  isMeshSurface,
  type VolumeResult,
} from '../engine';
import type { PlanCamera } from './camera';
import { worldToScreen } from './camera';
import { niceStep } from './camera';
import { dashPixels } from '../engine/linetypes';
import { lineweightPx } from '../engine/lineweights';
import { shouldDraw } from '../engine/layers';
import { entityPaint, isEntityLocked, segmentWidths } from '../engine/objects';
import { widthRibbon } from '../engine/properties';
import { getPicture, pictureKey } from './pictures';
import {
  displayColor,
  entityPath,
  gripPoints,
  layerOf,
  type BulkGeometry,
  type DrawingDoc,
  type DrawPolyline,
  type SnapHit,
  type Vec3,
} from '../engine/drafting';
import { drawCadText, drawCadWorld, drawGroupBoxes, isPaperEntity } from './drawCad';

export interface PlanAlignment {
  id: string;
  active: boolean;
  entities: AlignmentEntity[];
  ticks: StationTick[];
  sampleLines: SampleLine[];
  pis: { x: number; y: number }[];
}

export interface PlanOverlay {
  points: { x: number; y: number; label: string }[];
  lines: { points: { x: number; y: number }[]; color: string }[];
  fills: { points: { x: number; y: number }[]; color: string; label?: { x: number; y: number; text: string } }[];
}

export interface PlanScene {
  surfaces: SurfaceRecord[];
  contours: { id: string; lines: ContourPolyline[] }[];
  volume: VolumeResult | null;
  showVolume: boolean;
  draft: { x: number; y: number }[];
  tool: string;
  activeId: string | null;
  linearUnit: string;
  alignments: PlanAlignment[];
  preview: AlignmentEntity[];
  overlay?: PlanOverlay;
  drawing?: DrawingDoc;
  figs?: { points: Vec3[]; closed?: boolean; circle?: { center: Vec3; radius: number } }[];
  snap?: SnapHit | null;
  tracks?: { a: Vec3; b: Vec3 }[];
  selectA?: { x: number; y: number } | null;
  selectB?: { x: number; y: number } | null;
  lasso?: { x: number; y: number }[] | null;
  hoverId?: string | null;
  grips?: boolean;
  lwdisplay?: boolean;
  lockFade?: number;
  vertex?: { id: string; index: number } | null;
  /** key → resolved paint. Missing keys keep the civil style color. */
  paint?: Record<string, { color: string; hidden: boolean; override: boolean; alpha: number }>;
  showGrid?: boolean;
  lineweights?: boolean;
  ucsIcon?: boolean;
  ucsAtOrigin?: boolean;
}

export function drawPlan(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  camera: PlanCamera,
  scene: PlanScene,
): void {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cssWidth * dpr, cssHeight * dpr);
  ctx.fillStyle = '#0b0d11';
  ctx.fillRect(0, 0, cssWidth * dpr, cssHeight * dpr);

  const tx = dpr * (cssWidth / 2 - camera.cx * camera.scale);
  const ty = dpr * (cssHeight / 2 + camera.cy * camera.scale);
  ctx.setTransform(dpr * camera.scale, 0, 0, -dpr * camera.scale, tx, ty);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (scene.showGrid !== false) drawGrid(ctx, camera, cssWidth, cssHeight);

  const contourById = new Map(scene.contours.map((entry) => [entry.id, entry.lines]));
  for (const surface of scene.surfaces) {
    if (!surface.visible || surface.triangles.length === 0) continue;
    if (scene.paint?.[`surface:${surface.id}`]?.hidden) continue;
    if (isMeshSurface(surface)) {
      drawMeshWire(ctx, surface, camera, painted(scene, `surface:${surface.id}`, surface.style.color));
      continue;
    }
    if (surface.style.showElevation || surface.style.showSlope) {
      drawSurfaceFill(ctx, surface);
    }
  }
  if (scene.showVolume && scene.volume && scene.volume.regions.length > 0) {
    drawVolume(ctx, scene.volume);
  }
  for (const surface of scene.surfaces) {
    if (!surface.visible || scene.paint?.[`surface:${surface.id}`]?.hidden) continue;
    const surfaceColor = painted(scene, `surface:${surface.id}`, surface.style.color);
    if (surface.style.showTriangles && surface.triangles.length <= 12_000) drawEdges(ctx, surface, camera, surfaceColor);
    drawBreaklines(ctx, surface, camera);
    if (surface.boundary && surface.boundary.length >= 3) {
      drawRing(ctx, surface.boundary, surface.id === scene.activeId ? '#e3a23a' : surfaceColor, camera, surface.id === scene.activeId);
    }
  }
  for (const surface of scene.surfaces) {
    if (!surface.visible || !surface.style.showContours) continue;
    if (scene.paint?.[`surface:${surface.id}`]?.hidden || scene.paint?.[`contour:${surface.id}`]?.hidden) continue;
    drawContours(ctx, contourById.get(surface.id) ?? [], surface, camera, scene.paint?.[`contour:${surface.id}`]);
  }
  for (const alignment of scene.alignments) {
    if (scene.paint?.[`alignment:${alignment.id}`]?.hidden) continue;
    if (!scene.paint?.[`sample-line:${alignment.id}`]?.hidden) {
      drawSampleLines(ctx, alignment.sampleLines, camera, painted(scene, `sample-line:${alignment.id}`, 'rgba(126, 182, 255, 0.9)'));
    }
    drawCenterline(ctx, alignment.entities, camera, painted(scene, `alignment:${alignment.id}`, alignment.active ? '#f2d48a' : '#9a8458'));
  }
  if (scene.preview.length > 0) drawCenterline(ctx, scene.preview, camera, '#ffe3a3');
  if (scene.overlay) drawOverlayWorld(ctx, scene.overlay, camera);
  if (scene.drawing) drawEntities(ctx, scene.drawing, camera, scene, cssWidth, cssHeight);
  drawFigs(ctx, scene.figs ?? [], camera);
  drawTracks(ctx, scene.tracks ?? [], camera);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const surface of scene.surfaces) {
    if (!surface.visible || !surface.style.showPoints) continue;
    drawPoints(ctx, surface, camera, cssWidth, cssHeight);
  }
  for (const surface of scene.surfaces) {
    if (!surface.visible || !surface.style.showContours || !surface.style.contourLabels) continue;
    labelContours(ctx, contourById.get(surface.id) ?? [], surface, camera, cssWidth, cssHeight);
  }
  if (scene.draft.length > 0) {
    drawDraftScreen(ctx, scene, camera, cssWidth, cssHeight);
  }
  if (scene.overlay) drawOverlayLabels(ctx, scene.overlay, camera, cssWidth, cssHeight);
  for (const alignment of scene.alignments) {
    drawStationLabels(ctx, alignment.ticks, camera, cssWidth, cssHeight, scene.linearUnit);
    drawPiMarkers(ctx, alignment.pis, camera, cssWidth, cssHeight, alignment.active);
  }
  if (scene.drawing) {
    drawEntityText(ctx, scene.drawing, camera, cssWidth, cssHeight);
    if (scene.grips) drawGrips(ctx, scene.drawing, camera, cssWidth, cssHeight);
  }
  if (scene.drawing && scene.vertex) drawVertexMarker(ctx, scene.drawing, scene.vertex, camera, cssWidth, cssHeight);
  if (scene.drawing && scene.hoverId) drawLockGlyph(ctx, scene.drawing, scene.hoverId, camera, cssWidth, cssHeight);
  if (scene.snap) drawSnapMarker(ctx, scene.snap, camera, cssWidth, cssHeight);
  drawSelectRect(ctx, scene, camera, cssWidth, cssHeight);
  drawNorthArrow(ctx, cssWidth);
  drawScaleBar(ctx, camera, cssHeight, scene.linearUnit);
  if (scene.showGrid !== false) drawGridLabels(ctx, camera, cssWidth, cssHeight);
  if (scene.ucsIcon !== false) drawUcsIcon(ctx, camera, cssWidth, cssHeight, scene.ucsAtOrigin === true);
}

function painted(scene: PlanScene, key: string, fallback: string): string {
  const paint = scene.paint?.[key];
  if (!paint || !paint.override) return fallback;
  return paint.color;
}

function drawEntities(ctx: CanvasRenderingContext2D, doc: DrawingDoc, camera: PlanCamera, scene: PlanScene, cssWidth: number, cssHeight: number): void {
  const selected = new Set(doc.selection);
  const fade = 1 - Math.min(90, Math.max(0, scene.lockFade ?? 50)) / 100;
  for (const entity of doc.entities) {
    const layer = layerOf(doc, entity);
    if (!shouldDraw(layer)) continue;
    if (entity.type === 'text' || isPaperEntity(doc, entity.id)) continue;
    const paint = entityPaint(doc, entity);
    ctx.save();
    ctx.globalAlpha = paint.alpha * (layer?.locked ? fade : 1);
    ctx.strokeStyle = paint.color;
    ctx.fillStyle = paint.color;
    ctx.lineWidth = worldWidth(camera, lineweightPx(paint.lineweight, scene.lwdisplay !== false && scene.lineweights !== false));
    ctx.setLineDash(dashPixels(paint.linetype, paint.scale, 1, camera.scale).map((px) => px / Math.max(camera.scale, 1e-9)));
    if (drawCadWorld(ctx, doc, entity, camera)) {
      if (selected.has(entity.id)) {
        ctx.strokeStyle = '#e3a23a';
        ctx.lineWidth = worldWidth(camera, 2);
        ctx.setLineDash([]);
        strokePath(ctx, entityPath(entity, 24), false);
      }
    } else if (entity.type === 'point') {
      const r = worldWidth(camera, 3.5);
      ctx.beginPath();
      ctx.moveTo(entity.p.x - r, entity.p.y - r);
      ctx.lineTo(entity.p.x + r, entity.p.y + r);
      ctx.moveTo(entity.p.x - r, entity.p.y + r);
      ctx.lineTo(entity.p.x + r, entity.p.y - r);
      ctx.stroke();
    } else if (entity.type === 'circle') {
      ctx.beginPath();
      ctx.arc(entity.center.x, entity.center.y, entity.radius, 0, Math.PI * 2);
      ctx.stroke();
    } else if (entity.type === 'polyline') {
      drawPolyline(ctx, entity, camera, scene);
    } else if (entity.type === 'block') {
      const s = Math.max(entity.scale, 0.1);
      ctx.strokeRect(entity.p.x - s, entity.p.y - s, s * 2, s * 2);
    } else {
      strokePath(ctx, entityPath(entity, 24), false);
    }
    if (selected.has(entity.id)) {
      ctx.strokeStyle = '#e3a23a';
      ctx.lineWidth = worldWidth(camera, 2);
      ctx.setLineDash([]);
      if (entity.type === 'circle') {
        ctx.beginPath();
        ctx.arc(entity.center.x, entity.center.y, entity.radius, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        strokePath(ctx, entityPath(entity, 24), entity.type === 'polyline' && entity.closed);
      }
    }
    ctx.restore();
  }
  if (doc.bulk && (doc.bulk.segmentCount > 0 || doc.bulk.pointCount > 0)) drawBulk(ctx, doc.bulk, camera, cssWidth, cssHeight);
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  drawGroupBoxes(ctx, doc, camera);
}

const BULK_BUDGET = 200_000;

function drawBulk(ctx: CanvasRenderingContext2D, bulk: BulkGeometry, camera: PlanCamera, cssWidth: number, cssHeight: number): void {
  const halfW = cssWidth / 2 / Math.max(camera.scale, 1e-9);
  const halfH = cssHeight / 2 / Math.max(camera.scale, 1e-9);
  const minX = camera.cx - halfW;
  const maxX = camera.cx + halfW;
  const minY = camera.cy - halfH;
  const maxY = camera.cy + halfH;
  const worldW = Math.max(bulk.maxX - bulk.minX, 1e-9);
  const worldH = Math.max(bulk.maxY - bulk.minY, 1e-9);
  const hit = Math.min(1, ((maxX - minX) / worldW) * ((maxY - minY) / worldH) * 2);
  const stride = Math.max(1, Math.ceil((bulk.segmentCount * hit) / BULK_BUDGET));
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  const segs = bulk.segments;
  let drawn = 0;
  const limit = Math.min(bulk.segmentCount, BULK_BUDGET * stride);
  for (let index = 0; index < limit && drawn < BULK_BUDGET; index += stride) {
    const offset = index * 4;
    const x1 = segs[offset];
    const y1 = segs[offset + 1];
    const x2 = segs[offset + 2];
    const y2 = segs[offset + 3];
    if (x1 < minX && x2 < minX) continue;
    if (x1 > maxX && x2 > maxX) continue;
    if (y1 < minY && y2 < minY) continue;
    if (y1 > maxY && y2 > maxY) continue;
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    drawn += 1;
  }
  ctx.strokeStyle = '#9ecbff';
  ctx.lineWidth = worldWidth(camera, 1);
  ctx.stroke();
  const points = bulk.points;
  if (bulk.pointCount === 0) return;
  const pointStride = Math.max(1, Math.ceil(bulk.pointCount / 50_000));
  const mark = worldWidth(camera, 3);
  ctx.beginPath();
  for (let index = 0; index < bulk.pointCount; index += pointStride) {
    const x = points[index * 2];
    const y = points[index * 2 + 1];
    if (x < minX || x > maxX || y < minY || y > maxY) continue;
    ctx.moveTo(x - mark, y - mark);
    ctx.lineTo(x + mark, y + mark);
    ctx.moveTo(x - mark, y + mark);
    ctx.lineTo(x + mark, y - mark);
  }
  ctx.stroke();
}

function drawPolyline(ctx: CanvasRenderingContext2D, entity: DrawPolyline, camera: PlanCamera, scene: PlanScene): void {
  const count = entity.vertices.length;
  const segments = entity.closed ? count : count - 1;
  let wide = (entity.globalWidth ?? 0) > 0;
  for (let index = 0; index < segments; index += 1) {
    const widths = segmentWidths(entity, index);
    if (widths.start > 0 || widths.end > 0) wide = true;
  }
  if (wide && !entity.poly3d) {
    for (let index = 0; index < segments; index += 1) {
      const a = entity.vertices[index];
      const b = entity.vertices[(index + 1) % count];
      const widths = segmentWidths(entity, index);
      const ring = widthRibbon(a, b, widths.start, widths.end);
      if (ring.length < 3) continue;
      ctx.beginPath();
      ctx.moveTo(ring[0].x, ring[0].y);
      for (let point = 1; point < ring.length; point += 1) ctx.lineTo(ring[point].x, ring[point].y);
      ctx.closePath();
      ctx.fill();
    }
    return;
  }
  if (entity.linetypeGeneration) {
    strokePath(ctx, entityPath(entity, 24), entity.closed);
    return;
  }
  const dash = ctx.getLineDash();
  for (let index = 0; index < segments; index += 1) {
    const a = entity.vertices[index];
    const b = entity.vertices[(index + 1) % count];
    ctx.setLineDash(dash);
    strokePath(ctx, entityPath({ ...entity, vertices: [a, b], closed: false }, 16), false);
  }
  void camera;
  void scene;
}

function strokePath(ctx: CanvasRenderingContext2D, points: Vec3[], closed: boolean): void {
  if (points.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  if (closed) ctx.closePath();
  ctx.stroke();
}


function drawFigs(
  ctx: CanvasRenderingContext2D,
  figs: { points: Vec3[]; closed?: boolean; circle?: { center: Vec3; radius: number } }[],
  camera: PlanCamera,
): void {
  ctx.save();
  ctx.strokeStyle = '#e3a23a';
  ctx.lineWidth = worldWidth(camera, 1.25);
  ctx.setLineDash([worldWidth(camera, 6), worldWidth(camera, 4)]);
  for (const fig of figs) {
    if (fig.circle && fig.circle.radius > 0) {
      ctx.beginPath();
      ctx.arc(fig.circle.center.x, fig.circle.center.y, fig.circle.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    strokePath(ctx, fig.points, Boolean(fig.closed));
  }
  ctx.restore();
}

function drawTracks(ctx: CanvasRenderingContext2D, tracks: { a: Vec3; b: Vec3 }[], camera: PlanCamera): void {
  if (tracks.length === 0) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(227, 162, 58, 0.85)';
  ctx.lineWidth = worldWidth(camera, 1);
  ctx.setLineDash([worldWidth(camera, 10), worldWidth(camera, 4)]);
  for (const track of tracks) strokePath(ctx, [track.a, track.b], false);
  ctx.restore();
}

function drawEntityText(ctx: CanvasRenderingContext2D, doc: DrawingDoc, camera: PlanCamera, width: number, height: number): void {
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  for (const entity of doc.entities) {
    if (entity.type !== 'text') continue;
    const layer = layerOf(doc, entity);
    if (!shouldDraw(layer)) continue;
    const screen = worldToScreen(camera, entity.p.x, entity.p.y, width, height);
    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(-entity.rotation);
    ctx.fillStyle = selectedColor(doc, entity.id, displayColor(doc, entity));
    ctx.font = `${Math.max(10, entity.height * camera.scale)}px ${'IBM Plex Sans, Segoe UI, sans-serif'}`;
    ctx.textAlign = 'left';
    ctx.fillText(entity.content, 0, 0);
    ctx.restore();
  }
  drawCadText(ctx, doc, camera, width, height);
  ctx.restore();
}

function selectedColor(doc: DrawingDoc, id: string, color: string): string {
  return doc.selection.includes(id) ? '#e3a23a' : color;
}

function drawGrips(ctx: CanvasRenderingContext2D, doc: DrawingDoc, camera: PlanCamera, width: number, height: number): void {
  const selected = new Set(doc.selection);
  ctx.save();
  ctx.fillStyle = '#12151b';
  ctx.strokeStyle = '#7ec8ff';
  ctx.lineWidth = 1;
  for (const entity of doc.entities) {
    if (!selected.has(entity.id) || isEntityLocked(doc, entity)) continue;
    for (const grip of gripPoints(entity)) {
      const screen = worldToScreen(camera, grip.x, grip.y, width, height);
      ctx.strokeRect(screen.x - 4, screen.y - 4, 8, 8);
      ctx.fillRect(screen.x - 3, screen.y - 3, 6, 6);
    }
  }
  ctx.restore();
}

function drawVertexMarker(ctx: CanvasRenderingContext2D, doc: DrawingDoc, marker: { id: string; index: number }, camera: PlanCamera, width: number, height: number): void {
  const entity = doc.entities.find((item) => item.id === marker.id);
  if (!entity || entity.type !== 'polyline') return;
  const vertex = entity.vertices[marker.index];
  if (!vertex) return;
  const screen = worldToScreen(camera, vertex.x, vertex.y, width, height);
  ctx.save();
  ctx.fillStyle = '#e3a23a';
  ctx.strokeStyle = '#1a1408';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawLockGlyph(ctx: CanvasRenderingContext2D, doc: DrawingDoc, id: string, camera: PlanCamera, width: number, height: number): void {
  const entity = doc.entities.find((item) => item.id === id);
  if (!entity || !isEntityLocked(doc, entity)) return;
  const path = entityPath(entity, 8);
  const anchor = path[0];
  if (!anchor) return;
  const screen = worldToScreen(camera, anchor.x, anchor.y, width, height);
  ctx.save();
  ctx.translate(screen.x + 10, screen.y - 14);
  ctx.strokeStyle = '#f4f7fb';
  ctx.fillStyle = 'rgba(18, 21, 27, 0.9)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, -3, 3.2, Math.PI, 0);
  ctx.stroke();
  ctx.fillRect(-4, -3, 8, 7);
  ctx.strokeRect(-4, -3, 8, 7);
  ctx.restore();
}

function drawSnapMarker(ctx: CanvasRenderingContext2D, snap: SnapHit, camera: PlanCamera, width: number, height: number): void {
  const screen = worldToScreen(camera, snap.point.x, snap.point.y, width, height);
  const x = screen.x;
  const y = screen.y;
  ctx.save();
  ctx.strokeStyle = '#7dffb3';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (snap.kind === 'endpoint') ctx.strokeRect(x - 6, y - 6, 12, 12);
  else if (snap.kind === 'midpoint') {
    ctx.moveTo(x, y - 7);
    ctx.lineTo(x + 7, y + 6);
    ctx.lineTo(x - 7, y + 6);
    ctx.closePath();
    ctx.stroke();
  } else if (snap.kind === 'center') {
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.stroke();
  } else if (snap.kind === 'nearest') {
    ctx.moveTo(x - 6, y - 6);
    ctx.lineTo(x + 6, y + 6);
    ctx.moveTo(x - 6, y + 6);
    ctx.lineTo(x + 6, y - 6);
    ctx.moveTo(x, y - 6);
    ctx.lineTo(x, y + 6);
    ctx.stroke();
  } else if (snap.kind === 'node') {
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.moveTo(x - 4, y - 4);
    ctx.lineTo(x + 4, y + 4);
    ctx.moveTo(x - 4, y + 4);
    ctx.lineTo(x + 4, y - 4);
    ctx.stroke();
  } else {
    ctx.moveTo(x - 6, y - 6);
    ctx.lineTo(x + 6, y + 6);
    ctx.moveTo(x - 6, y + 6);
    ctx.lineTo(x + 6, y - 6);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSelectRect(ctx: CanvasRenderingContext2D, scene: PlanScene, camera: PlanCamera, width: number, height: number): void {
  if (!scene.selectA || !scene.selectB) return;
  const a = worldToScreen(camera, scene.selectA.x, scene.selectA.y, width, height);
  const b = worldToScreen(camera, scene.selectB.x, scene.selectB.y, width, height);
  const crossing = scene.selectB.x < scene.selectA.x;
  ctx.save();
  ctx.strokeStyle = crossing ? '#7ec8ff' : '#e8eef7';
  ctx.fillStyle = crossing ? 'rgba(106, 164, 255, 0.12)' : 'rgba(232, 238, 247, 0.08)';
  ctx.setLineDash(crossing ? [5, 4] : []);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  if (scene.lasso && scene.lasso.length > 1) {
    ctx.save();
    ctx.strokeStyle = '#7ec8ff';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    const first = worldToScreen(camera, scene.lasso[0].x, scene.lasso[0].y, width, height);
    ctx.moveTo(first.x, first.y);
    for (const point of scene.lasso) {
      const screen = worldToScreen(camera, point.x, point.y, width, height);
      ctx.lineTo(screen.x, screen.y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

function worldWidth(camera: PlanCamera, px: number): number {
  return px / camera.scale;
}

function drawGrid(ctx: CanvasRenderingContext2D, camera: PlanCamera, width: number, height: number): void {
  const step = niceStep(worldWidth(camera, 96));
  const minX = camera.cx - width / 2 / camera.scale;
  const maxX = camera.cx + width / 2 / camera.scale;
  const minY = camera.cy - height / 2 / camera.scale;
  const maxY = camera.cy + height / 2 / camera.scale;
  const major = step * 5;
  ctx.beginPath();
  ctx.strokeStyle = '#1a2230';
  ctx.lineWidth = worldWidth(camera, 1);
  for (let x = Math.ceil(minX / step) * step; x <= maxX; x += step) {
    if (Math.abs(x / major - Math.round(x / major)) < 1e-6) continue;
    ctx.moveTo(x, minY);
    ctx.lineTo(x, maxY);
  }
  for (let y = Math.ceil(minY / step) * step; y <= maxY; y += step) {
    if (Math.abs(y / major - Math.round(y / major)) < 1e-6) continue;
    ctx.moveTo(minX, y);
    ctx.lineTo(maxX, y);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.strokeStyle = '#2a3548';
  ctx.lineWidth = worldWidth(camera, 1.25);
  for (let x = Math.ceil(minX / major) * major; x <= maxX; x += major) {
    ctx.moveTo(x, minY);
    ctx.lineTo(x, maxY);
  }
  for (let y = Math.ceil(minY / major) * major; y <= maxY; y += major) {
    ctx.moveTo(minX, y);
    ctx.lineTo(maxX, y);
  }
  ctx.stroke();
}

function drawSurfaceFill(ctx: CanvasRenderingContext2D, surface: SurfaceRecord): void {
  if (surface.triangles.length > 12_000) {
    const mode = surface.style.showSlope ? 'slope' : 'elevation';
    const picture =
      getPicture(pictureKey(surface.id, surface.triangles.length, mode, surface.style.minorInterval, surface.style.majorInterval)) ??
      getPicture(pictureKey(surface.id, surface.triangles.length, 'elevation', surface.style.minorInterval, surface.style.majorInterval));
    ctx.globalAlpha = Math.min(1, Math.max(0.15, surface.style.opacity));
    if (picture) {
      const width = picture.maxX - picture.minX;
      const height = picture.maxY - picture.minY;
      ctx.drawImage(picture.canvas, picture.minX, picture.maxY, width, -height);
    } else {
      const bounds = boundsOf(surface.points);
      if (bounds) {
        ctx.fillStyle = surface.style.color;
        ctx.fillRect(bounds.minX, bounds.minY, Math.max(bounds.maxX - bounds.minX, 1e-6), Math.max(bounds.maxY - bounds.minY, 1e-6));
      }
    }
    ctx.globalAlpha = 1;
    return;
  }
  let minZ = Infinity;
  let maxZ = -Infinity;
  if (surface.style.showElevation) {
    const used = new Set<number>();
    for (const tri of surface.triangles) {
      used.add(tri[0]);
      used.add(tri[1]);
      used.add(tri[2]);
    }
    for (const index of used) {
      const point = surface.points[index];
      if (!point) continue;
      const z = point.z;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  ctx.globalAlpha = Math.min(1, Math.max(0.15, surface.style.opacity));
  for (const [ia, ib, ic] of surface.triangles) {
    const a = surface.points[ia];
    const b = surface.points[ib];
    const c = surface.points[ic];
    if (!a || !b || !c) continue;
    if (surface.style.showSlope) {
      const slope = triangleSlope(a, b, c);
      ctx.fillStyle = rgbCss(slopeColor(slope));
    } else {
      const z = (a.z + b.z + c.z) / 3;
      ctx.fillStyle = rgbCss(elevationColor(z, minZ, maxZ));
    }
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawVolume(ctx: CanvasRenderingContext2D, volume: VolumeResult): void {
  const scale = volumeColorScale(volume);
  ctx.globalAlpha = 0.92;
  for (const region of volume.regions) {
    if (region.ring.length < 3) continue;
    ctx.fillStyle = rgbCss(cutFillColor(region.depth, scale));
    ctx.beginPath();
    ctx.moveTo(region.ring[0].x, region.ring[0].y);
    for (let i = 1; i < region.ring.length; i++) ctx.lineTo(region.ring[i].x, region.ring[i].y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawMeshWire(ctx: CanvasRenderingContext2D, surface: SurfaceRecord, camera: PlanCamera, color: string): void {
  const stride = Math.max(1, Math.ceil(surface.triangles.length / 40_000));
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = worldWidth(camera, 1);
  for (let i = 0; i < surface.triangles.length; i += stride) {
    const [ia, ib, ic] = surface.triangles[i];
    const a = surface.points[ia];
    const b = surface.points[ib];
    const c = surface.points[ic];
    if (!a || !b || !c) continue;
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.closePath();
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawEdges(ctx: CanvasRenderingContext2D, surface: SurfaceRecord, camera: PlanCamera, color = surface.style.color): void {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = worldWidth(camera, 1);
  for (const [ia, ib, ic] of surface.triangles) {
    const a = surface.points[ia];
    const b = surface.points[ib];
    const c = surface.points[ic];
    if (!a || !b || !c) continue;
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.closePath();
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawBreaklines(ctx: CanvasRenderingContext2D, surface: SurfaceRecord, camera: PlanCamera): void {
  if (surface.breaklines.length === 0) return;
  ctx.strokeStyle = '#f0c27a';
  ctx.lineWidth = worldWidth(camera, 1.75);
  ctx.setLineDash([worldWidth(camera, 7), worldWidth(camera, 5)]);
  for (const line of surface.breaklines) {
    if (line.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(line[0].x, line[0].y);
    for (let i = 1; i < line.length; i++) ctx.lineTo(line[i].x, line[i].y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawRing(
  ctx: CanvasRenderingContext2D,
  ring: { x: number; y: number }[],
  color: string,
  camera: PlanCamera,
  emphasize: boolean,
): void {
  ctx.beginPath();
  ctx.moveTo(ring[0].x, ring[0].y);
  for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].x, ring[i].y);
  ctx.closePath();
  ctx.strokeStyle = color;
  ctx.globalAlpha = emphasize ? 0.95 : 0.7;
  ctx.lineWidth = worldWidth(camera, emphasize ? 2 : 1.25);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawContours(
  ctx: CanvasRenderingContext2D,
  lines: ContourPolyline[],
  surface: SurfaceRecord,
  camera: PlanCamera,
  paint?: { color: string; override: boolean },
): void {
  const minor = lines.filter((line) => !line.major);
  const major = lines.filter((line) => line.major);
  const minorColor = paint?.override ? paint.color : surface.style.minorColor;
  const majorColor = paint?.override ? paint.color : surface.style.majorColor;
  strokeLines(ctx, minor, minorColor, worldWidth(camera, 1));
  strokeLines(ctx, major, majorColor, worldWidth(camera, paint?.override ? 1.8 : 1.8));
}

function strokeLines(ctx: CanvasRenderingContext2D, lines: ContourPolyline[], color: string, width: number): void {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  for (const line of lines) {
    if (line.points.length < 2) continue;
    ctx.moveTo(line.points[0].x, line.points[0].y);
    for (let i = 1; i < line.points.length; i++) ctx.lineTo(line.points[i].x, line.points[i].y);
  }
  ctx.stroke();
}

function drawPoints(
  ctx: CanvasRenderingContext2D,
  surface: SurfaceRecord,
  camera: PlanCamera,
  width: number,
  height: number,
): void {
  ctx.fillStyle = surface.style.color;
  const source = surface.sourcePoints.length > 0 ? surface.sourcePoints : surface.points;
  const cols = Math.max(1, Math.ceil(width / 4));
  const rows = Math.max(1, Math.ceil(height / 4));
  const occupied = new Uint8Array(cols * rows);
  for (let i = 0; i < source.length; i++) {
    const point = source[i];
    if (point.role && point.role !== 'survey') continue;
    const screen = worldToScreen(camera, point.x, point.y, width, height);
    if (screen.x < 0 || screen.y < 0 || screen.x >= width || screen.y >= height) continue;
    const cell = (Math.floor(screen.y / 4) * cols + Math.floor(screen.x / 4)) | 0;
    if (occupied[cell]) continue;
    occupied[cell] = 1;
    ctx.fillRect(screen.x - 1.5, screen.y - 1.5, 3, 3);
  }
}

function labelContours(
  ctx: CanvasRenderingContext2D,
  lines: ContourPolyline[],
  surface: SurfaceRecord,
  camera: PlanCamera,
  width: number,
  height: number,
): void {
  ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const line of lines) {
    if (!line.major || line.points.length < 2) continue;
    const screen = line.points.map((point) => worldToScreen(camera, point.x, point.y, width, height));
    let length = 0;
    for (let i = 1; i < screen.length; i++) {
      length += Math.hypot(screen[i].x - screen[i - 1].x, screen[i].y - screen[i - 1].y);
    }
    if (length < 72) continue;
    const label = formatContour(line.elevation);
    let walked = 0;
    let nextAt = Math.min(length * 0.5, 90);
    const gap = Math.max(140, length / 4);
    for (let i = 1; i < screen.length; i++) {
      const a = screen[i - 1];
      const b = screen[i];
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      while (walked + seg >= nextAt && seg > 0) {
        const t = (nextAt - walked) / seg;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        if (x > 36 && x < width - 36 && y > 28 && y < height - 28) {
          let angle = Math.atan2(b.y - a.y, b.x - a.x);
          if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(angle);
          ctx.lineWidth = 4;
          ctx.strokeStyle = 'rgba(11, 13, 17, 0.88)';
          ctx.strokeText(label, 0, 0);
          ctx.fillStyle = surface.style.majorColor;
          ctx.fillText(label, 0, 0);
          ctx.restore();
        }
        nextAt += gap;
      }
      walked += seg;
    }
  }
}

function formatContour(elevation: number): string {
  const rounded = Math.round(elevation * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-6) return Math.round(rounded).toString();
  return rounded.toFixed(2).replace(/0$/, '').replace(/\.0$/, '');
}

function drawCenterline(ctx: CanvasRenderingContext2D, entities: AlignmentEntity[], camera: PlanCamera, color: string): void {
  if (entities.length === 0) return;
  ctx.beginPath();
  for (const entity of entities) {
    const samples = entityPolyline(entity);
    ctx.moveTo(samples[0].x, samples[0].y);
    for (let i = 1; i < samples.length; i++) ctx.lineTo(samples[i].x, samples[i].y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = worldWidth(camera, 1.8);
  ctx.stroke();
}

function drawSampleLines(ctx: CanvasRenderingContext2D, lines: SampleLine[], camera: PlanCamera, color = 'rgba(126, 182, 255, 0.9)'): void {
  if (lines.length === 0) return;
  ctx.beginPath();
  for (const line of lines) {
    ctx.moveTo(line.origin.x - line.rx * line.left, line.origin.y - line.ry * line.left);
    ctx.lineTo(line.origin.x + line.rx * line.right, line.origin.y + line.ry * line.right);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = worldWidth(camera, 1);
  ctx.stroke();
}

function drawStationLabels(
  ctx: CanvasRenderingContext2D,
  ticks: StationTick[],
  camera: PlanCamera,
  width: number,
  height: number,
  unit: string,
): void {
  ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineJoin = 'round';
  for (const tick of ticks) {
    const screen = worldToScreen(camera, tick.x, tick.y, width, height);
    if (screen.x < 4 || screen.x > width - 4 || screen.y < 4 || screen.y > height - 4) continue;
    ctx.save();
    ctx.translate(screen.x, screen.y);
    let sx = tick.tx;
    let sy = -tick.ty;
    if (sx < 0 || (Math.abs(sx) < 1e-6 && sy > 0)) {
      sx = -sx;
      sy = -sy;
    }
    ctx.rotate(Math.atan2(sy, sx));
    const label = formatStation(tick.station, unit === 'ft' ? 'ft' : 'm');
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(11, 13, 17, 0.88)';
    ctx.strokeText(label, 0, -6);
    ctx.fillStyle = '#f4e2b0';
    ctx.fillText(label, 0, -6);
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.lineTo(0, 4);
    ctx.strokeStyle = '#f2d48a';
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.restore();
  }
}

function drawOverlayWorld(ctx: CanvasRenderingContext2D, overlay: PlanOverlay, camera: PlanCamera): void {
  ctx.lineWidth = worldWidth(camera, 1.6);
  for (const fill of overlay.fills) {
    if (fill.points.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(fill.points[0].x, fill.points[0].y);
    for (let i = 1; i < fill.points.length; i++) ctx.lineTo(fill.points[i].x, fill.points[i].y);
    ctx.closePath();
    ctx.fillStyle = fill.color;
    ctx.globalAlpha = 0.18;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = fill.color;
    ctx.stroke();
  }
  for (const line of overlay.lines) {
    if (line.points.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(line.points[0].x, line.points[0].y);
    for (let i = 1; i < line.points.length; i++) ctx.lineTo(line.points[i].x, line.points[i].y);
    ctx.strokeStyle = line.color;
    ctx.stroke();
  }
}

function drawOverlayLabels(
  ctx: CanvasRenderingContext2D,
  overlay: PlanOverlay,
  camera: PlanCamera,
  width: number,
  height: number,
): void {
  ctx.font = '11px "IBM Plex Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  for (const point of overlay.points) {
    const screen = worldToScreen(camera, point.x, point.y, width, height);
    ctx.fillStyle = '#f4f7fb';
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d5dbe6';
    ctx.fillText(point.label, screen.x + 4, screen.y - 3);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const fill of overlay.fills) {
    if (!fill.label) continue;
    const screen = worldToScreen(camera, fill.label.x, fill.label.y, width, height);
    ctx.fillStyle = '#f2d48a';
    ctx.fillText(fill.label.text, screen.x, screen.y);
  }
}

function drawPiMarkers(
  ctx: CanvasRenderingContext2D,
  pis: { x: number; y: number }[],
  camera: PlanCamera,
  width: number,
  height: number,
  active: boolean,
): void {
  ctx.fillStyle = active ? '#f2d48a' : '#9a8458';
  for (const pi of pis) {
    const screen = worldToScreen(camera, pi.x, pi.y, width, height);
    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-3, -3, 6, 6);
    ctx.restore();
  }
}

function drawDraftScreen(
  ctx: CanvasRenderingContext2D,
  scene: PlanScene,
  camera: PlanCamera,
  width: number,
  height: number,
): void {
  const screen = scene.draft.map((point) => worldToScreen(camera, point.x, point.y, width, height));
  ctx.beginPath();
  ctx.moveTo(screen[0].x, screen[0].y);
  for (let i = 1; i < screen.length; i++) ctx.lineTo(screen[i].x, screen[i].y);
  ctx.strokeStyle = scene.tool === 'breakline' ? '#f0c27a' : '#e3a23a';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const point of screen) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#e3a23a';
    ctx.fill();
  }
}

function drawUcsIcon(ctx: CanvasRenderingContext2D, camera: PlanCamera, width: number, height: number, atOrigin: boolean): void {
  const projected = atOrigin ? worldToScreen(camera, 0, 0, width, height) : { x: 46, y: height - 46 };
  const visible = projected.x > 24 && projected.y > 24 && projected.x < width - 24 && projected.y < height - 24;
  const x = visible ? projected.x : 46;
  const y = visible ? projected.y : height - 46;
  ctx.save();
  ctx.strokeStyle = '#e7e9ee';
  ctx.fillStyle = '#e7e9ee';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 32, y);
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 32);
  ctx.stroke();
  ctx.font = '600 11px "IBM Plex Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('E', x + 36, y);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('N', x, y - 36);
  ctx.restore();
}

function drawNorthArrow(ctx: CanvasRenderingContext2D, width: number): void {
  const x = width - 36;
  const y = 46;
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, -16);
  ctx.lineTo(6, 8);
  ctx.lineTo(0, 4);
  ctx.lineTo(-6, 8);
  ctx.closePath();
  ctx.fillStyle = '#e7e9ee';
  ctx.fill();
  ctx.font = '600 11px "IBM Plex Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#c5cad3';
  ctx.fillText('N', 0, 12);
  ctx.restore();
}

function drawScaleBar(ctx: CanvasRenderingContext2D, camera: PlanCamera, height: number, unit: string): void {
  const world = niceStep(120 / camera.scale);
  const px = world * camera.scale;
  const x = 16;
  const y = height - 22;
  ctx.strokeStyle = '#e7e9ee';
  ctx.fillStyle = '#e7e9ee';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + px, y);
  ctx.moveTo(x, y - 5);
  ctx.lineTo(x, y + 5);
  ctx.moveTo(x + px, y - 5);
  ctx.lineTo(x + px, y + 5);
  ctx.stroke();
  ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  const digits = world >= 1 ? 0 : 2;
  ctx.fillText(`${world.toLocaleString('en-US', { maximumFractionDigits: digits })} ${unit}`, x, y - 6);
}

function drawGridLabels(ctx: CanvasRenderingContext2D, camera: PlanCamera, width: number, height: number): void {
  const step = niceStep(worldWidth(camera, 140));
  const minX = camera.cx - width / 2 / camera.scale;
  const maxX = camera.cx + width / 2 / camera.scale;
  const minY = camera.cy - height / 2 / camera.scale;
  const maxY = camera.cy + height / 2 / camera.scale;
  ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillStyle = '#8b95a8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const digits = step >= 1 ? 0 : 1;
  for (let x = Math.ceil(minX / step) * step; x <= maxX; x += step) {
    const screen = worldToScreen(camera, x, 0, width, height);
    if (screen.x < 70 || screen.x > width - 70) continue;
    ctx.fillText(x.toLocaleString('en-US', { maximumFractionDigits: digits }), screen.x, height - 4);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let y = Math.ceil(minY / step) * step; y <= maxY; y += step) {
    const screen = worldToScreen(camera, 0, y, width, height);
    if (screen.y < 24 || screen.y > height - 36) continue;
    ctx.fillText(y.toLocaleString('en-US', { maximumFractionDigits: digits }), 8, screen.y);
  }
}

export function visibleBounds(surfaces: SurfaceRecord[], extra?: { minX: number; minY: number; maxX: number; maxY: number } | null) {
  const visible = surfaces.filter((surface) => surface.visible);
  const source = visible.length > 0 ? visible : surfaces;
  const points = source.flatMap((surface) => surface.points);
  const bounds = boundsOf(points);
  if (!extra) return bounds;
  if (!bounds) return extra;
  return {
    minX: Math.min(bounds.minX, extra.minX),
    minY: Math.min(bounds.minY, extra.minY),
    maxX: Math.max(bounds.maxX, extra.maxX),
    maxY: Math.max(bounds.maxY, extra.maxY),
  };
}
