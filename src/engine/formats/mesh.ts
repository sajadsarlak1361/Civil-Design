import type { SurveyPoint, Triangle } from '../types';

function num(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Math.round(value * 1e6) / 1e6);
}

export function surfaceToObj(points: SurveyPoint[], triangles: Triangle[]): string {
  const lines = ['# Civil Design OBJ', ...points.map((point) => `v ${num(point.x)} ${num(point.y)} ${num(point.z)}`)];
  for (const [a, b, c] of triangles) lines.push(`f ${a + 1} ${b + 1} ${c + 1}`);
  return `${lines.join('\n')}\n`;
}

export function parseObj(text: string): { points: SurveyPoint[]; triangles: Triangle[] } {
  const points: SurveyPoint[] = [];
  const triangles: Triangle[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('v ')) {
      const [x, y, z] = trimmed.slice(2).trim().split(/\s+/).map(Number);
      if ([x, y, z].every(Number.isFinite)) points.push({ x, y, z, role: 'survey' });
    } else if (trimmed.startsWith('f ')) {
      const ids = trimmed
        .slice(2)
        .trim()
        .split(/\s+/)
        .map((part) => Number(part.split('/')[0]) - 1);
      if (ids.length >= 3 && ids.slice(0, 3).every((id) => id >= 0 && id < points.length)) triangles.push([ids[0], ids[1], ids[2]]);
    }
  }
  return { points, triangles };
}

function normal(a: SurveyPoint, b: SurveyPoint, c: SurveyPoint): [number, number, number] {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  const x = uy * vz - uz * vy;
  const y = uz * vx - ux * vz;
  const z = ux * vy - uy * vx;
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

export function surfaceToStl(points: SurveyPoint[], triangles: Triangle[]): string {
  const lines = ['solid fieldline'];
  for (const [ia, ib, ic] of triangles) {
    const a = points[ia];
    const b = points[ib];
    const c = points[ic];
    if (!a || !b || !c) continue;
    const [nx, ny, nz] = normal(a, b, c);
    lines.push(`  facet normal ${num(nx)} ${num(ny)} ${num(nz)}`);
    lines.push('    outer loop');
    for (const point of [a, b, c]) lines.push(`      vertex ${num(point.x)} ${num(point.y)} ${num(point.z)}`);
    lines.push('    endloop');
    lines.push('  endfacet');
  }
  lines.push('endsolid fieldline');
  return `${lines.join('\n')}\n`;
}

export function parseStl(text: string): { points: SurveyPoint[]; triangles: Triangle[] } {
  const points: SurveyPoint[] = [];
  const triangles: Triangle[] = [];
  const pattern = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
  let match: RegExpExecArray | null;
  const batch: number[] = [];
  while ((match = pattern.exec(text))) {
    const x = Number(match[1]);
    const y = Number(match[2]);
    const z = Number(match[3]);
    if (![x, y, z].every(Number.isFinite)) continue;
    batch.push(points.length);
    points.push({ x, y, z, role: 'survey' });
    if (batch.length === 3) {
      triangles.push([batch[0], batch[1], batch[2]]);
      batch.length = 0;
    }
  }
  return { points, triangles };
}

function b64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** glTF 2.0, Y-up. Civil Design X east, Y north, Z elevation becomes glTF X, Y=Z, Z=−north. */
export function surfaceToGltf(points: SurveyPoint[], triangles: Triangle[]): string {
  const positions = new Float32Array(points.length * 3);
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  points.forEach((point, index) => {
    const x = point.x;
    const y = point.z;
    const z = -point.y;
    positions[index * 3] = x;
    positions[index * 3 + 1] = y;
    positions[index * 3 + 2] = z;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  });
  const indices = new Uint16Array(triangles.length * 3);
  triangles.forEach((triangle, index) => {
    indices[index * 3] = triangle[0];
    indices[index * 3 + 1] = triangle[1];
    indices[index * 3 + 2] = triangle[2];
  });
  const bin = new Uint8Array(positions.byteLength + indices.byteLength);
  bin.set(new Uint8Array(positions.buffer), 0);
  bin.set(new Uint8Array(indices.buffer), positions.byteLength);
  const document = {
    asset: { version: '2.0', generator: 'Civil Design' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: bin.byteLength, uri: `data:application/octet-stream;base64,${b64(bin)}` }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength, target: 34963 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: points.length,
        type: 'VEC3',
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
      },
      { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' },
    ],
  };
  return JSON.stringify(document);
}

export function parseGltf(text: string): { points: SurveyPoint[]; triangles: Triangle[] } {
  const document = JSON.parse(text) as {
    buffers?: { uri?: string }[];
    bufferViews?: { byteOffset?: number; byteLength: number }[];
    accessors?: { bufferView: number; componentType: number; count: number; type: string }[];
  };
  const uri = document.buffers?.[0]?.uri ?? '';
  const encoded = uri.split(',')[1] ?? '';
  const binary = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  const accessors = document.accessors ?? [];
  const views = document.bufferViews ?? [];
  const position = accessors.find((item) => item.type === 'VEC3');
  const index = accessors.find((item) => item.type === 'SCALAR');
  if (!position || !index) return { points: [], triangles: [] };
  const positionView = views[position.bufferView];
  const indexView = views[index.bufferView];
  const xyz = new Float32Array(binary.buffer, positionView.byteOffset ?? 0, position.count * 3);
  const ids = new Uint16Array(binary.buffer, indexView.byteOffset ?? 0, index.count);
  const points: SurveyPoint[] = [];
  for (let i = 0; i < position.count; i += 1) {
    points.push({ x: xyz[i * 3], y: -xyz[i * 3 + 2], z: xyz[i * 3 + 1], role: 'survey' });
  }
  const triangles: Triangle[] = [];
  for (let i = 0; i + 2 < ids.length; i += 3) triangles.push([ids[i], ids[i + 1], ids[i + 2]]);
  return { points, triangles };
}
