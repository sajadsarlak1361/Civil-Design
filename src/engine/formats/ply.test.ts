import { describe, expect, it } from 'vitest';
import { FILE_EXPORT, FILE_IMPORT } from '../../components/fileMenu';
import { meshToPly } from '../meshExport';
import { classifyFile } from './ingest';
import { choosePlyGeometry, encodePly, loadPly, looksLikePly, parsePly, PLY_POINT_CAP, PLY_VERTEX_REFUSE, plyMemorySource, plySamplePlan, surfaceToBinaryPly, surfaceToPly, type PlySource } from './ply';
import type { SurveyPoint, Triangle } from '../types';

const points: SurveyPoint[] = [
  { x: 0, y: 0, z: 0, role: 'survey' },
  { x: 1.5, y: 0, z: 0, role: 'survey' },
  { x: 0, y: 2.25, z: 3, role: 'survey' },
];
const triangles: Triangle[] = [[0, 1, 2]];

function ascii(body: string): Uint8Array {
  return new TextEncoder().encode(body);
}

/** COLMAP-style vertex: xyz, normal, rgb. No faces. */
function denseCloud(count: number, littleEndian = true): Uint8Array {
  const header = [
    'ply',
    `format binary_${littleEndian ? 'little' : 'big'}_endian 1.0`,
    `element vertex ${count}`,
    'property float x',
    'property float y',
    'property float z',
    'property float nx',
    'property float ny',
    'property float nz',
    'property uchar red',
    'property uchar green',
    'property uchar blue',
    'end_header',
    '',
  ].join('\n');
  const head = new TextEncoder().encode(header);
  const stride = 27;
  const bytes = new Uint8Array(head.length + count * stride);
  bytes.set(head, 0);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < count; index += 1) {
    const at = head.length + index * stride;
    view.setFloat32(at, index, littleEndian);
    view.setFloat32(at + 4, index + 0.5, littleEndian);
    view.setFloat32(at + 8, -index, littleEndian);
    view.setFloat32(at + 12, 0, littleEndian);
    view.setFloat32(at + 16, 1, littleEndian);
    view.setFloat32(at + 20, 0, littleEndian);
    bytes[at + 24] = 255;
    bytes[at + 25] = 0;
    bytes[at + 26] = 128;
  }
  return bytes;
}

function sliced(bytes: Uint8Array, step: number): PlySource {
  return {
    byteLength: bytes.byteLength,
    read(offset, length) {
      if (offset >= bytes.byteLength || length <= 0) return Promise.resolve(new Uint8Array(0));
      const end = Math.min(bytes.byteLength, offset + Math.min(length, step));
      return Promise.resolve(bytes.slice(offset, end));
    },
  };
}

describe('PLY', () => {
  it('round-trips an ASCII mesh through write and read', () => {
    const text = surfaceToPly(points, triangles);
    expect(text).toBe(meshToPly(points, triangles));
    expect(text).toContain('format ascii 1.0');
    expect(text).toContain('element vertex 3');
    expect(text).toContain('element face 1');
    const mesh = parsePly(encodePly(points, triangles));
    expect(mesh.points.map(({ x, y, z }) => [x, y, z])).toEqual([
      [0, 0, 0],
      [1.5, 0, 0],
      [0, 2.25, 3],
    ]);
    expect(mesh.triangles).toEqual([[0, 1, 2]]);
  });

  it('round-trips binary little-endian and big-endian meshes', () => {
    for (const littleEndian of [true, false]) {
      const mesh = parsePly(surfaceToBinaryPly(points, triangles, littleEndian));
      expect(mesh.points[1].x).toBeCloseTo(1.5);
      expect(mesh.points[2]).toMatchObject({ x: 0, y: 2.25, z: 3 });
      expect(mesh.triangles).toEqual([[0, 1, 2]]);
    }
  });

  it('keeps double coordinates and skips color bytes', () => {
    const header = [
      'ply',
      'format binary_little_endian 1.0',
      'element vertex 1',
      'property double x',
      'property double y',
      'property double z',
      'property uchar red',
      'property uchar green',
      'property uchar blue',
      'element face 0',
      'property list uchar int vertex_indices',
      'end_header',
      '',
    ].join('\n');
    const head = new TextEncoder().encode(header);
    const bytes = new Uint8Array(head.length + 24 + 3);
    bytes.set(head, 0);
    const view = new DataView(bytes.buffer);
    view.setFloat64(head.length, 1234567.125, true);
    view.setFloat64(head.length + 8, -20.5, true);
    view.setFloat64(head.length + 16, 4, true);
    bytes[head.length + 24] = 255;
    bytes[head.length + 25] = 10;
    bytes[head.length + 26] = 0;
    const mesh = parsePly(bytes);
    expect(mesh.points[0]).toMatchObject({ x: 1234567.125, y: -20.5, z: 4 });
    expect(mesh.triangles).toEqual([]);
  });

  it('fans a quad, ignores an edge element, and reads x after other properties', () => {
    const text = [
      'ply',
      'format ascii 1.0',
      'comment kept',
      'element vertex 4',
      'property float z',
      'property float y',
      'property float x',
      'element edge 1',
      'property int vertex1',
      'property int vertex2',
      'element face 1',
      'property list uchar int vertex_indices',
      'end_header',
      '0 0 0',
      '0 0 1',
      '0 1 1',
      '0 1 0',
      '0 1',
      '4 0 1 2 3',
      '',
    ].join('\n');
    const mesh = parsePly(ascii(text));
    expect(mesh.points.map(({ x, y, z }) => [x, y, z])).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ]);
    expect(mesh.triangles).toEqual([
      [0, 1, 2],
      [0, 2, 3],
    ]);
  });

  it('reads a CRLF header and a vertex-only cloud', () => {
    const text = 'ply\r\nformat ascii 1.0\r\nelement vertex 2\r\nproperty float x\r\nproperty float y\r\nproperty float z\r\nend_header\r\n5 6 7\r\n8 9 10\r\n';
    const mesh = parsePly(ascii(text));
    expect(mesh.points).toHaveLength(2);
    expect(mesh.points[1]).toMatchObject({ x: 8, y: 9, z: 10 });
    expect(mesh.triangles).toEqual([]);
  });

  it('refuses a truncated file and a vertex element without coordinates', () => {
    expect(() => parsePly(ascii('ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n'))).toThrow(/truncated/);
    expect(() => parsePly(ascii('ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nend_header\n0 0\n'))).toThrow(/x, y, and z/);
    expect(() => parsePly(ascii('hello'))).toThrow(/end_header/);
  });

  it('classifies ASCII and binary PLY, including a file with a zero byte', () => {
    const binary = surfaceToBinaryPly(points, triangles);
    expect(looksLikePly(binary)).toBe(true);
    expect(binary.includes(0)).toBe(true);
    expect(classifyFile('scan.ply', binary).kind).toBe('ply');
    expect(classifyFile('scan.bin', binary).kind).toBe('ply');
    expect(classifyFile('notes.txt', ascii('ply\nformat ascii 1.0\n'))).toMatchObject({ kind: 'ply' });
  });

  it('picks the selected surface, then the active surface', () => {
    const surfaces = [
      { id: 'a', name: 'Empty', points: [], triangles: [] as Triangle[] },
      { id: 'b', name: 'Ground', points, triangles },
      { id: 'c', name: 'Pad', points: [points[0]], triangles: [] as Triangle[] },
    ];
    expect(choosePlyGeometry(surfaces, 'c', ['surface:b'])?.name).toBe('Ground');
    expect(choosePlyGeometry(surfaces, 'c')?.name).toBe('Pad');
    expect(choosePlyGeometry(surfaces, 'a')?.name).toBe('Ground');
    expect(choosePlyGeometry([], null)).toBeNull();
    expect(choosePlyGeometry(surfaces, 'b', ['surface:a'])).toBeNull();
  });

  it('samples a dense binary cloud in short reads and skips normals and color', async () => {
    const count = 1_000;
    const bytes = denseCloud(count);
    const cap = 100;
    const plan = plySamplePlan(count, cap);
    const seen: number[] = [];
    const mesh = await loadPly(sliced(bytes, 20), {
      cap,
      chunkBytes: 64,
      yield: false,
      onProgress: (progress) => seen.push(progress.fraction),
    });
    expect(plan).toEqual({ stride: 10, kept: 100 });
    expect(mesh.sampled).toBe(true);
    expect(mesh.stride).toBe(10);
    expect(mesh.points).toHaveLength(100);
    expect(mesh.triangles).toEqual([]);
    expect(mesh.points[0]).toMatchObject({ x: 0, y: 0.5, z: -0 });
    expect(mesh.points[1].x).toBeCloseTo(10);
    expect(mesh.points[1].y).toBeCloseTo(10.5);
    expect(mesh.points[1].z).toBeCloseTo(-10);
    expect(mesh.points[99].x).toBeCloseTo(990);
    expect(mesh.status).toContain(mesh.kept.toLocaleString());
    expect(mesh.status).toContain(count.toLocaleString());
    expect(mesh.status).toMatch(/normals and colors/);
    expect(seen.at(-1)).toBe(1);
    expect(seen.every((fraction, index) => index === 0 || fraction >= seen[index - 1])).toBe(true);
    const same = await loadPly(plyMemorySource(bytes), { cap, chunkBytes: 64, yield: false });
    expect(same.points.map((point) => point.x)).toEqual(mesh.points.map((point) => point.x));
  });

  it('samples a big-endian dense cloud when the header break is split across reads', async () => {
    const mesh = await loadPly(sliced(denseCloud(8, false), 1), { cap: 4, chunkBytes: 13, yield: false });
    expect(mesh.stride).toBe(2);
    expect(mesh.points.map((point) => point.x)).toEqual([0, 2, 4, 6]);
    expect(mesh.points.map((point) => point.y)).toEqual([0.5, 2.5, 4.5, 6.5]);
  });

  it('keeps faces when a chunked mesh fits the cap', async () => {
    const bytes = surfaceToBinaryPly(points, triangles);
    const mesh = await loadPly(sliced(bytes, 7), { inlineMax: 0, chunkBytes: 11, yield: false });
    expect(mesh.sampled).toBe(false);
    expect(mesh.points.map((point) => point.x)).toEqual([0, 1.5, 0]);
    expect(mesh.triangles).toEqual([[0, 1, 2]]);
    expect(mesh.status).toBe('');
  });

  it('drops faces when a meshed cloud is sampled', async () => {
    const cloud = Array.from({ length: 30 }, (_, index) => ({ x: index, y: 1, z: 2, role: 'survey' as const }));
    const mesh = await loadPly(sliced(surfaceToBinaryPly(cloud, [[0, 1, 2]]), 13), { cap: 10, yield: false });
    expect(mesh.sampled).toBe(true);
    expect(mesh.triangles).toEqual([]);
    expect(mesh.points).toHaveLength(10);
    expect(mesh.points[1].x).toBeCloseTo(3);
    expect(mesh.status).toMatch(/Faces were not loaded/);
  });

  it('samples an ASCII cloud across token boundaries', async () => {
    const lines = ['ply', 'format ascii 1.0', 'element vertex 25', 'property float x', 'property float y', 'property float z', 'property uchar red', 'end_header'];
    for (let index = 0; index < 25; index += 1) lines.push(`${index} ${index + 1} ${index + 2} 9`);
    const mesh = await loadPly(sliced(ascii(`${lines.join('\n')}\n`), 3), { cap: 10, chunkBytes: 5, yield: false });
    expect(mesh.stride).toBe(3);
    expect(mesh.points.map((point) => [point.x, point.y, point.z])).toEqual([
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [9, 10, 11],
      [12, 13, 14],
      [15, 16, 17],
      [18, 19, 20],
      [21, 22, 23],
      [24, 25, 26],
    ]);
  });

  it('refuses an absurd vertex count and a short body without allocating the cloud', async () => {
    expect(() => plySamplePlan(PLY_VERTEX_REFUSE + 1)).toThrow(/too large to open/);
    expect(plySamplePlan(33_059_019)).toEqual({ stride: 166, kept: Math.ceil(33_059_019 / 166) });
    expect(plySamplePlan(33_059_019).kept).toBeLessThanOrEqual(PLY_POINT_CAP);
    const header = 'ply\nformat binary_little_endian 1.0\nelement vertex 400000000\nproperty float x\nproperty float y\nproperty float z\nend_header\n';
    await expect(loadPly(plyMemorySource(ascii(header)), { yield: false })).rejects.toThrow(/truncated/);
  });

  it('stops when the read is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(loadPly(sliced(denseCloud(20), 16), { signal: controller.signal, cap: 5, yield: false })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('is listed for open, import, and export', () => {
    expect(FILE_IMPORT.find((item) => item.id === 'ply')).toMatchObject({ command: 'OPEN' });
    expect(FILE_EXPORT.find((item) => item.id === 'ply')).toMatchObject({ request: 'export-ply' });
  });
});
