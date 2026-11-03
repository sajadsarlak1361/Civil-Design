import { describe, expect, it } from 'vitest';
import { FILE_EXPORT, FILE_IMPORT } from '../../components/fileMenu';
import { meshToPly } from '../meshExport';
import { classifyFile } from './ingest';
import { choosePlyGeometry, encodePly, looksLikePly, parsePly, surfaceToBinaryPly, surfaceToPly } from './ply';
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

  it('is listed for open, import, and export', () => {
    expect(FILE_IMPORT.find((item) => item.id === 'ply')).toMatchObject({ command: 'OPEN' });
    expect(FILE_EXPORT.find((item) => item.id === 'ply')).toMatchObject({ request: 'export-ply' });
  });
});
