import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FILE_EXPORT, FILE_IMPORT } from '../../components/fileMenu';
import { OPEN_EXTENSIONS, OPEN_FILTERS } from '../../lib/openFiles';
import { parsePointFile, parseXyzCloud } from '../points';
import { readPointCloudFile } from './cloud';
import { readE57 } from './e57';
import { classifyFile } from './ingest';
import { LAZ_REASON, readLas, writeLas } from './las';
import { readLaz } from './laz';
import { decompressLzf, pointsToPcd, readPcd } from './pcd';
import { pointsToPts, readPts, readPtx } from './pts';

const fixture = (name: string) => new Uint8Array(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name)));

const cloud = [
  { x: 1.5, y: 2.25, z: 3, role: 'survey' as const },
  { x: -4, y: 8, z: 0.5, role: 'survey' as const },
  { x: 10, y: -2, z: 100.25, role: 'survey' as const },
];

describe('point cloud open and export', () => {
  it('lists the cloud extensions in the open dialog and the menus', () => {
    for (const extension of ['laz', 'e57', 'pcd', 'pts', 'ptx']) {
      expect(OPEN_EXTENSIONS).toContain(extension);
      expect(OPEN_FILTERS[0].extensions).toContain(extension);
    }
    expect(OPEN_FILTERS.find((filter) => filter.name === 'Point cloud')?.extensions).toEqual([
      'las', 'laz', 'e57', 'pcd', 'ply', 'pts', 'ptx', 'xyz',
    ]);
    expect(OPEN_FILTERS.some((filter) => filter.extensions.includes('dwg'))).toBe(false);
    expect(FILE_IMPORT.find((item) => item.id === 'laz')?.command).toBe('OPEN');
    expect(FILE_IMPORT.find((item) => item.id === 'e57')?.command).toBe('OPEN');
    expect(FILE_EXPORT.find((item) => item.id === 'las')?.request).toBe('export-las');
    expect(FILE_EXPORT.find((item) => item.id === 'laz')).toBeUndefined();
    expect(FILE_IMPORT.find((item) => item.id === 'dxf')?.command).toBe('OPEN');
  });

  it('classifies each cloud by extension and signature without touching DXF', () => {
    const las = writeLas(cloud);
    expect(classifyFile('scan.las', las).kind).toBe('las');
    expect(classifyFile('scan.laz', las).kind).toBe('laz');
    expect(classifyFile('scan.laz', fixture('tiny.laz')).kind).toBe('laz');
    expect(classifyFile('scan.las', fixture('tiny.laz')).kind).toBe('laz');
    expect(classifyFile('scan.e57', fixture('tiny.e57')).kind).toBe('e57');
    expect(classifyFile('scan.bin', fixture('tiny.e57')).kind).toBe('e57');
    expect(classifyFile('scan.pcd', new TextEncoder().encode('# .PCD v0.7\nFIELDS x y z\n')).kind).toBe('pcd');
    expect(classifyFile('scan.pts', new TextEncoder().encode('1\n0 0 0\n')).kind).toBe('pts');
    expect(classifyFile('scan.ptx', new TextEncoder().encode('1\n1\n')).kind).toBe('ptx');
    expect(classifyFile('scan.xyz', new TextEncoder().encode('1 2 3\n')).kind).toBe('points');
    expect(classifyFile('site.dxf', new TextEncoder().encode('0\nSECTION\n2\nENTITIES\n')).kind).toBe('dxf');
    expect(classifyFile('site.dwg', fixture('tiny.laz')).kind).toBe('dwg');
  });

  it('reads LAZ and keeps an uncompressed LAS on the plain reader', async () => {
    const points = await readLaz(fixture('tiny.laz'));
    expect(points.map(({ x, y, z }) => [x, y, z])).toEqual([
      [1.5, 2.25, 3],
      [-4, 8, 0.5],
      [10, -2, 100.25],
    ]);
    expect(() => readLas(fixture('tiny.laz'))).toThrow(LAZ_REASON);
    const plain = writeLas(cloud);
    await expect(readLaz(plain)).resolves.toHaveLength(3);
  });

  it('reads LAS point formats other than 0, including a LAS 1.4 count', () => {
    const las = writeLas(cloud);
    const format3 = new Uint8Array(227 + cloud.length * 34);
    format3.set(las.subarray(0, 227));
    const view = new DataView(format3.buffer);
    format3[104] = 3;
    view.setUint16(105, 34, true);
    for (let index = 0; index < cloud.length; index += 1) {
      format3.set(las.subarray(227 + index * 20, 227 + index * 20 + 20), 227 + index * 34);
    }
    expect(readLas(format3)[2].z).toBeCloseTo(100.25);

    const las14 = new Uint8Array(375 + 2 * 20);
    las14.set(las.subarray(0, 227));
    const wide = new DataView(las14.buffer);
    las14[25] = 4;
    wide.setUint16(94, 375, true);
    wide.setUint32(96, 375, true);
    wide.setUint32(107, 0, true);
    wide.setUint32(247, 2, true);
    las14.set(las.subarray(227, 227 + 40), 375);
    const read = readLas(las14);
    expect(read).toHaveLength(2);
    expect(read[0]).toMatchObject({ x: 1.5, y: 2.25, z: 3 });
  });

  it('reads an E57 scan in double precision', async () => {
    const points = await readE57(fixture('tiny.e57'));
    expect(points.map(({ x, y, z }) => [x, y, z])).toEqual([
      [1.5, 2.25, 3],
      [-4, 8, 0.5],
      [10, -2, 100.25],
    ]);
  });

  it('reads XYZ with intensity and RGB, and writes PTS and PCD', () => {
    const text = 'x,y,z,intensity,r,g,b\n1.5,2.25,3,10,255,0,0\n-4,8,0.5,0,0,1,2\n';
    expect(parsePointFile(text).points[0]).toMatchObject({ x: 1.5, y: 2.25, z: 3 });
    expect(parsePointFile(text).format).toBe('XYZ');
    const wide = '1 2 3 9 1 2 3\n4 5 6 8 0 0 1\n';
    expect(parsePointFile(wide).format).toBe('XYZ');
    expect(parsePointFile(wide).points[1]).toMatchObject({ x: 4, y: 5, z: 6 });
    expect(parseXyzCloud('3\n10 20 30 1 2 3\n').map((point) => [point.x, point.y, point.z])).toEqual([[10, 20, 30]]);
    expect(readPts(pointsToPts(cloud)).map((point) => point.z)).toEqual([3, 0.5, 100.25]);
    expect(readPcd(new TextEncoder().encode(pointsToPcd(cloud)))[2].z).toBeCloseTo(100.25);
  });

  it('reads binary PCD and LZF-compressed PCD', () => {
    const header = [
      'VERSION 0.7',
      'FIELDS x y z',
      'SIZE 4 4 4',
      'TYPE F F F',
      'COUNT 1 1 1',
      'WIDTH 1',
      'HEIGHT 1',
      'POINTS 1',
      'DATA binary',
      '',
    ].join('\n');
    const body = new Uint8Array(12);
    const floats = new DataView(body.buffer);
    floats.setFloat32(0, 1.5, true);
    floats.setFloat32(4, 2.25, true);
    floats.setFloat32(8, 3, true);
    const binary = new Uint8Array(header.length + body.length);
    binary.set(new TextEncoder().encode(header));
    binary.set(body, header.length);
    expect(readPcd(binary)[0]).toMatchObject({ x: 1.5, y: 2.25, z: 3 });

    expect([...decompressLzf(Uint8Array.of(2, 97, 98, 99, 32, 2), 6)]).toEqual([97, 98, 99, 97, 98, 99]);
    const raw = new Uint8Array(24);
    const rawView = new DataView(raw.buffer);
    rawView.setFloat32(0, 1, true);
    rawView.setFloat32(4, 2, true);
    rawView.setFloat32(8, 3, true);
    rawView.setFloat32(12, 4, true);
    rawView.setFloat32(16, 5, true);
    rawView.setFloat32(20, 6, true);
    const literals = new Uint8Array(raw.length * 2);
    raw.forEach((byte, index) => {
      literals[index * 2] = 0;
      literals[index * 2 + 1] = byte;
    });
    const packed = new Uint8Array(8 + literals.length);
    const packedView = new DataView(packed.buffer);
    packedView.setUint32(0, literals.length, true);
    packedView.setUint32(4, raw.length, true);
    packed.set(literals, 8);
    const compressedHeader = header.replace('WIDTH 1', 'WIDTH 2').replace('POINTS 1', 'POINTS 2').replace('DATA binary', 'DATA binary_compressed');
    const compressed = new Uint8Array(compressedHeader.length + packed.length);
    compressed.set(new TextEncoder().encode(compressedHeader));
    compressed.set(packed, compressedHeader.length);
    expect(readPcd(compressed).map((point) => [point.x, point.y, point.z])).toEqual([
      [1, 3, 5],
      [2, 4, 6],
    ]);
  });

  it('applies a PTX registration and skips empty returns', () => {
    const ptx = [
      '2',
      '1',
      '0 0 0',
      '1 0 0',
      '0 1 0',
      '0 0 1',
      '1 0 0 0',
      '0 1 0 0',
      '0 0 1 0',
      '10 20 30 1',
      '1 2 3 4 5 6 7',
      '0 0 0 0 0 0 0',
    ].join('\n');
    expect(readPtx(ptx).map((point) => [point.x, point.y, point.z])).toEqual([[11, 22, 33]]);
  });

  it('opens the same clouds through the shared reader', async () => {
    await expect(readPointCloudFile('scan.laz', fixture('tiny.laz'))).resolves.toHaveLength(3);
    await expect(readPointCloudFile('scan.e57', fixture('tiny.e57'))).resolves.toHaveLength(3);
    await expect(readPointCloudFile('scan.xyz', new TextEncoder().encode('8 9 10\n'))).resolves.toMatchObject([{ x: 8, y: 9, z: 10 }]);
    await expect(readPointCloudFile('book.csv', new TextEncoder().encode('1,5000,2000,10,EP\n'))).resolves.toMatchObject([{ y: 5000, x: 2000, z: 10 }]);
  });
});
