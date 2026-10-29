import { DXF_RELEASE } from './formats/dxfDoc';
import { blockLocalEntities } from './blocks';
import type { CadLibrary } from './cadLibrary';
import { entityPath, parseStoredEntity, type DrawEntity, type DrawingDoc, type Vec3 } from './drafting';

function num(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Math.round(value * 1e6) / 1e6);
}

function pair(code: number, value: string | number): string {
  return `${code}\n${value}\n`;
}

function layerName(entity: DrawEntity): string {
  return entity.layer || '0';
}

/** DXF R2000 of the plan drawing. Contours and TIN keep their own writers. */
export function drawingToDxf(doc: DrawingDoc, unit: 'm' | 'ft' = 'm'): string {
  const insunits = unit === 'ft' ? 2 : 6;
  let body = pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$ACADVER') + pair(1, DXF_RELEASE) + pair(9, '$INSUNITS') + pair(70, insunits) + pair(0, 'ENDSEC');
  const layers = doc.layers.length > 0 ? doc.layers : [{ name: '0', color: '#e8eef7' }];
  body += pair(0, 'SECTION') + pair(2, 'TABLES') + pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, layers.length);
  for (const layer of layers) {
    body += pair(0, 'LAYER') + pair(2, layer.name) + pair(70, 0) + pair(62, 7) + pair(6, 'CONTINUOUS');
  }
  body += pair(0, 'ENDTAB') + pair(0, 'ENDSEC');
  body += blocks(doc.library);
  body += pair(0, 'SECTION') + pair(2, 'ENTITIES');
  for (const entity of doc.entities) body += entityDxf(entity);
  body += pair(0, 'ENDSEC') + pair(0, 'EOF');
  return body;
}

function blocks(library: CadLibrary | undefined): string {
  let body = pair(0, 'SECTION') + pair(2, 'BLOCKS') + pair(0, 'BLOCK') + pair(2, '*MODEL_SPACE') + pair(70, 0) + pair(10, 0) + pair(20, 0) + pair(30, 0) + pair(0, 'ENDBLK');
  for (const block of library?.blocks ?? []) {
    body += pair(0, 'BLOCK') + pair(2, block.name) + pair(70, 0) + pair(10, 0) + pair(20, 0) + pair(30, 0);
    for (const entity of blockLocalEntities(block, parseStoredEntity)) body += entityDxf(entity);
    body += pair(0, 'ENDBLK');
  }
  body += pair(0, 'ENDSEC');
  return body;
}

function entityDxf(entity: DrawEntity): string {
  const layer = layerName(entity);
  if (entity.type === 'line') return line(layer, entity.a, entity.b);
  if (entity.type === 'point') return pair(0, 'POINT') + pair(8, layer) + pair(10, num(entity.p.x)) + pair(20, num(entity.p.y)) + pair(30, num(entity.p.z));
  if (entity.type === 'circle') return pair(0, 'CIRCLE') + pair(8, layer) + pair(10, num(entity.center.x)) + pair(20, num(entity.center.y)) + pair(30, num(entity.center.z)) + pair(40, num(entity.radius));
  if (entity.type === 'arc') {
    const start = (entity.startAngle * 180) / Math.PI;
    const end = (entity.endAngle * 180) / Math.PI;
    return pair(0, 'ARC') + pair(8, layer) + pair(10, num(entity.center.x)) + pair(20, num(entity.center.y)) + pair(40, num(entity.radius)) + pair(50, num(start)) + pair(51, num(end));
  }
  if (entity.type === 'text' || entity.type === 'mtext' || entity.type === 'attdef') {
    const p = entity.p;
    const text = entity.type === 'text' ? entity.content : entity.type === 'mtext' ? entity.content : entity.value || entity.tag;
    const kind = entity.type === 'mtext' ? 'MTEXT' : entity.type === 'attdef' ? 'ATTDEF' : 'TEXT';
    return pair(0, kind) + pair(8, layer) + pair(10, num(p.x)) + pair(20, num(p.y)) + pair(30, num(p.z)) + pair(40, num(entity.height)) + pair(1, text.replace(/\n/g, '\\P'));
  }
  if (entity.type === 'polyline' || entity.type === 'revcloud') {
    const varyingZ = entity.vertices.some((vertex) => Math.abs(vertex.z - (entity.vertices[0]?.z ?? 0)) > 1e-6);
    const as3d = entity.type === 'polyline' && (entity.poly3d || varyingZ);
    if (as3d) {
      let out = pair(0, 'POLYLINE') + pair(8, layer) + pair(70, (entity.closed ? 1 : 0) + 8) + pair(66, 1);
      for (const vertex of entity.vertices) {
        out += pair(0, 'VERTEX') + pair(8, layer) + pair(10, num(vertex.x)) + pair(20, num(vertex.y)) + pair(30, num(vertex.z));
        if (vertex.bulge) out += pair(42, num(vertex.bulge));
      }
      return out + pair(0, 'SEQEND') + pair(8, layer);
    }
    let out = pair(0, 'LWPOLYLINE') + pair(8, layer) + pair(90, entity.vertices.length) + pair(70, entity.closed ? 1 : 0);
    if (entity.type === 'polyline' && entity.width) out += pair(43, num(entity.width));
    const elevation = entity.vertices[0]?.z ?? 0;
    if (elevation) out += pair(38, num(elevation));
    for (const vertex of entity.vertices) {
      out += pair(10, num(vertex.x)) + pair(20, num(vertex.y)) + pair(42, num(vertex.bulge));
    }
    return out;
  }
  if (entity.type === 'ellipse') {
    return (
      pair(0, 'ELLIPSE') +
      pair(8, layer) +
      pair(10, num(entity.center.x)) +
      pair(20, num(entity.center.y)) +
      pair(11, num(entity.major.x)) +
      pair(21, num(entity.major.y)) +
      pair(40, num(entity.ratio)) +
      pair(41, num(entity.start)) +
      pair(42, num(entity.end))
    );
  }
  if (entity.type === 'spline') {
    let out = pair(0, 'SPLINE') + pair(8, layer) + pair(70, entity.closed ? 1 : 0) + pair(71, entity.degree) + pair(74, entity.points.length);
    for (const point of entity.points) out += pair(11, num(point.x)) + pair(21, num(point.y)) + pair(31, num(point.z));
    return out;
  }
  if (entity.type === 'hatch') {
    const loop = entity.loops[0] ?? [];
    let out = pair(0, 'HATCH') + pair(8, layer) + pair(2, entity.pattern) + pair(70, entity.pattern.toUpperCase() === 'SOLID' ? 1 : 0) + pair(91, 1) + pair(92, 1) + pair(93, loop.length);
    for (const point of loop) out += pair(10, num(point.x)) + pair(20, num(point.y));
    return out;
  }
  if (entity.type === 'xline' || entity.type === 'ray') {
    return pair(0, entity.type === 'ray' ? 'RAY' : 'XLINE') + pair(8, layer) + pair(10, num(entity.a.x)) + pair(20, num(entity.a.y)) + pair(11, num(entity.b.x - entity.a.x)) + pair(21, num(entity.b.y - entity.a.y));
  }
  if (entity.type === 'insert') {
    return pair(0, 'INSERT') + pair(8, layer) + pair(2, entity.name) + pair(10, num(entity.p.x)) + pair(20, num(entity.p.y)) + pair(41, num(entity.sx)) + pair(42, num(entity.sy)) + pair(50, num((entity.rotation * 180) / Math.PI));
  }
  if (entity.type === 'dimension') {
    const text = entity.text || String(entity.measurement);
    return pair(0, 'DIMENSION') + pair(8, layer) + pair(2, entity.style) + pair(10, num(entity.loc.x)) + pair(20, num(entity.loc.y)) + pair(11, num((entity.p1.x + entity.p2.x) / 2)) + pair(21, num((entity.p1.y + entity.p2.y) / 2)) + pair(13, num(entity.p1.x)) + pair(23, num(entity.p1.y)) + pair(14, num(entity.p2.x)) + pair(24, num(entity.p2.y)) + pair(1, text) + pair(70, entity.kind === 'aligned' ? 1 : 0);
  }
  if (entity.type === 'mleader') {
    const tip = entity.leaders[0]?.[0] ?? entity.textPos;
    return line(layer, tip, entity.textPos) + pair(0, 'TEXT') + pair(8, layer) + pair(10, num(entity.textPos.x)) + pair(20, num(entity.textPos.y)) + pair(40, 2.5) + pair(1, entity.text);
  }
  if (entity.type === 'table') {
    let out = '';
    for (let r = 0; r <= entity.rows; r++) {
      out += line(layer, { x: entity.p.x, y: entity.p.y - r * entity.rowHeight, z: entity.p.z }, { x: entity.p.x + entity.cols * entity.colWidth, y: entity.p.y - r * entity.rowHeight, z: entity.p.z });
    }
    for (let c = 0; c <= entity.cols; c++) {
      out += line(layer, { x: entity.p.x + c * entity.colWidth, y: entity.p.y, z: entity.p.z }, { x: entity.p.x + c * entity.colWidth, y: entity.p.y - entity.rows * entity.rowHeight, z: entity.p.z });
    }
    return out;
  }
  if (entity.type === 'wipeout' || entity.type === 'region' || entity.type === 'donut' || entity.type === 'array' || entity.type === 'centermark' || entity.type === 'centerline') {
    const path = entityPath(entity, 24);
    if (path.length < 2) return '';
    let out = pair(0, 'LWPOLYLINE') + pair(8, layer) + pair(90, path.length) + pair(70, entity.type === 'region' || entity.type === 'donut' ? 1 : 0);
    for (const point of path) out += pair(10, num(point.x)) + pair(20, num(point.y));
    return out;
  }
  return '';
}

function line(layer: string, a: Vec3, b: Vec3): string {
  return pair(0, 'LINE') + pair(8, layer) + pair(10, num(a.x)) + pair(20, num(a.y)) + pair(30, num(a.z)) + pair(11, num(b.x)) + pair(21, num(b.y)) + pair(31, num(b.z));
}
