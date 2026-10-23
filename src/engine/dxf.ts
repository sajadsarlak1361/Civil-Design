import type { ContourPolyline, LinearUnit, SurveyPoint, Triangle } from './types';

function num(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Math.round(value * 1e6) / 1e6);
}

function dxfPair(code: number | string, value: string | number): string {
  return `${code}\n${value}\n`;
}

function header(unit: LinearUnit): string {
  const insunits = unit === 'ft' ? 2 : 6;
  return (
    dxfPair(0, 'SECTION') +
    dxfPair(2, 'HEADER') +
    dxfPair(9, '$ACADVER') +
    dxfPair(1, 'AC1009') +
    dxfPair(9, '$INSUNITS') +
    dxfPair(70, insunits) +
    dxfPair(0, 'ENDSEC')
  );
}

function layerTable(layers: { name: string; color: number }[]): string {
  let body =
    dxfPair(0, 'SECTION') +
    dxfPair(2, 'TABLES') +
    dxfPair(0, 'TABLE') +
    dxfPair(2, 'LAYER') +
    dxfPair(70, layers.length + 1) +
    dxfPair(0, 'LAYER') +
    dxfPair(2, '0') +
    dxfPair(70, 0) +
    dxfPair(62, 7) +
    dxfPair(6, 'CONTINUOUS');
  for (const layer of layers) {
    body +=
      dxfPair(0, 'LAYER') +
      dxfPair(2, layer.name) +
      dxfPair(70, 0) +
      dxfPair(62, layer.color) +
      dxfPair(6, 'CONTINUOUS');
  }
  body += dxfPair(0, 'ENDTAB') + dxfPair(0, 'ENDSEC');
  return body;
}

function endFile(entities: string): string {
  return entities + dxfPair(0, 'ENDSEC') + dxfPair(0, 'EOF');
}

export function contoursToDxf(polylines: ContourPolyline[], unit: LinearUnit = 'm'): string {
  const layers = [
    { name: 'CONT-MAJOR', color: 30 },
    { name: 'CONT-MINOR', color: 4 },
  ];
  let entities = dxfPair(0, 'SECTION') + dxfPair(2, 'ENTITIES');
  for (const line of polylines) {
    let pts = line.points;
    if (pts.length < 2) continue;
    let closed = line.closed;
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= 1e-6) {
      closed = true;
      pts = pts.slice(0, -1);
    }
    if (pts.length < 2) continue;
    const layer = line.major ? 'CONT-MAJOR' : 'CONT-MINOR';
    entities += dxfPair(0, 'LWPOLYLINE');
    entities += dxfPair(8, layer);
    entities += dxfPair(90, pts.length);
    entities += dxfPair(70, closed ? 1 : 0);
    entities += dxfPair(38, num(line.elevation));
    for (const p of pts) {
      entities += dxfPair(10, num(p.x));
      entities += dxfPair(20, num(p.y));
    }
  }
  return header(unit) + layerTable(layers) + endFile(entities);
}

export function trianglesToDxf(points: SurveyPoint[], triangles: Triangle[], unit: LinearUnit = 'm'): string {
  const layers = [{ name: 'TIN', color: 8 }];
  let entities = dxfPair(0, 'SECTION') + dxfPair(2, 'ENTITIES');
  for (const [ia, ib, ic] of triangles) {
    const a = points[ia];
    const b = points[ib];
    const c = points[ic];
    if (!a || !b || !c) continue;
    entities += dxfPair(0, '3DFACE');
    entities += dxfPair(8, 'TIN');
    const corners = [a, b, c, c];
    const codes = [10, 11, 12, 13];
    corners.forEach((corner, index) => {
      entities += dxfPair(codes[index], num(corner.x));
      entities += dxfPair(codes[index] + 10, num(corner.y));
      entities += dxfPair(codes[index] + 20, num(corner.z));
    });
  }
  return header(unit) + layerTable(layers) + endFile(entities);
}

export function drawingLayersToDxf(layers: { name: string; colorIndex?: number; frozen?: boolean; locked?: boolean; visible?: boolean; lineType?: string }[]): string {
  let body = '';
  for (const layer of layers) {
    if (layer.name === '0') continue;
    let flags = 0;
    if (layer.frozen) flags |= 1;
    if (layer.locked) flags |= 4;
    const color = layer.colorIndex ?? 7;
    body +=
      dxfPair(0, 'LAYER') +
      dxfPair(2, layer.name) +
      dxfPair(70, flags) +
      dxfPair(62, layer.visible === false ? -Math.abs(color) : color) +
      dxfPair(6, (layer.lineType || 'CONTINUOUS').toUpperCase());
  }
  return body;
}

export function parseDxfLayerTable(text: string): { name: string; color: number; frozen: boolean; locked: boolean; off: boolean; lineType: string }[] {
  const lines = text.split(/\r?\n/);
  const layers: { name: string; color: number; frozen: boolean; locked: boolean; off: boolean; lineType: string }[] = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (lines[index].trim() !== '0' || lines[index + 1].trim() !== 'LAYER') continue;
    let name = '';
    let flags = 0;
    let color = 7;
    let lineType = 'CONTINUOUS';
    for (let cursor = index + 2; cursor < lines.length - 1; cursor += 2) {
      const code = lines[cursor].trim();
      const value = lines[cursor + 1]?.trim() ?? '';
      if (code === '0') break;
      if (code === '2') name = value;
      if (code === '70') flags = Number(value) || 0;
      if (code === '62') color = Number(value) || 7;
      if (code === '6') lineType = value;
    }
    if (name) layers.push({ name, color: Math.abs(color), frozen: (flags & 1) !== 0, locked: (flags & 4) !== 0, off: color < 0, lineType });
  }
  return layers;
}
