import type { SurveyPoint, Triangle } from './types';

function vertex(point: SurveyPoint): string {
  return `${point.x} ${point.y} ${point.z}`;
}

/** Wavefront OBJ. Indices are 1-based. `v` lines are the input points, unmoved. */
export function meshToObj(name: string, points: SurveyPoint[], triangles: Triangle[]): string {
  const lines = [`o ${name.replace(/\s+/g, '_') || 'mesh'}`];
  for (const point of points) lines.push(`v ${vertex(point)}`);
  for (const [a, b, c] of triangles) lines.push(`f ${a + 1} ${b + 1} ${c + 1}`);
  return lines.join('\n') + '\n';
}

/** ASCII STL. Each triangle is written with its own geometric normal. */
export function meshToStl(name: string, points: SurveyPoint[], triangles: Triangle[]): string {
  const lines = [`solid ${name.replace(/\s+/g, '_') || 'mesh'}`];
  for (const [ia, ib, ic] of triangles) {
    const a = points[ia];
    const b = points[ib];
    const c = points[ic];
    const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
    const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const len = Math.hypot(nx, ny, nz) || 1;
    lines.push(`  facet normal ${nx / len} ${ny / len} ${nz / len}`);
    lines.push('    outer loop');
    lines.push(`      vertex ${vertex(a)}`);
    lines.push(`      vertex ${vertex(b)}`);
    lines.push(`      vertex ${vertex(c)}`);
    lines.push('    endloop');
    lines.push('  endfacet');
  }
  lines.push(`endsolid ${name.replace(/\s+/g, '_') || 'mesh'}`);
  return lines.join('\n') + '\n';
}

/** Binary STL, little-endian, 50-byte header and one 50-byte record per triangle. */
export function meshToBinaryStl(points: SurveyPoint[], triangles: Triangle[]): Uint8Array {
  const bytes = new Uint8Array(84 + triangles.length * 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, triangles.length, true);
  let offset = 84;
  for (const [ia, ib, ic] of triangles) {
    const a = points[ia];
    const b = points[ib];
    const c = points[ic];
    const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
    const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const len = Math.hypot(nx, ny, nz) || 1;
    view.setFloat32(offset, nx / len, true);
    view.setFloat32(offset + 4, ny / len, true);
    view.setFloat32(offset + 8, nz / len, true);
    const corners = [a, b, c];
    for (let i = 0; i < 3; i++) {
      view.setFloat32(offset + 12 + i * 12, corners[i].x, true);
      view.setFloat32(offset + 16 + i * 12, corners[i].y, true);
      view.setFloat32(offset + 20 + i * 12, corners[i].z, true);
    }
    offset += 50;
  }
  return bytes;
}

/** Stanford PLY, ASCII, with vertex and face elements. */
export function meshToPly(points: SurveyPoint[], triangles: Triangle[]): string {
  const lines = [
    'ply',
    'format ascii 1.0',
    'comment Civil Design 3D mesh',
    `element vertex ${points.length}`,
    'property float x',
    'property float y',
    'property float z',
    `element face ${triangles.length}`,
    'property list uchar int vertex_indices',
    'end_header',
  ];
  for (const point of points) lines.push(vertex(point));
  for (const [a, b, c] of triangles) lines.push(`3 ${a} ${b} ${c}`);
  return lines.join('\n') + '\n';
}
