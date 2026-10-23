import { describe, expect, it } from 'vitest';
import { drawingToDxf, parseDxf, binaryLineDxf } from './formats/dxfDoc';
import { dwgAvailable, DWG_VERDICT } from './formats/dwg';
import { gridToAsc, gridToPoints, gridToXyz, parseAsc, parseXyzGrid, xyzIsGrid, type GridRaster } from './formats/grid';
import { readGeoTiff, writeGeoTiff } from './formats/geotiff';
import { readImageInfo, writeJpeg, writePng } from './formats/image';
import { classifyFile } from './formats/ingest';
import { LAZ_REASON, readLas, writeLas } from './formats/las';
import { parseGltf, parseObj, parseStl, surfaceToGltf, surfaceToObj, surfaceToStl } from './formats/mesh';
import { pdfToText, rgbToPdf } from './formats/plot';
import { readShp, writeShp } from './formats/shp';
import { FORMAT_CATALOG } from './formats/status';
import { parseLandXml, surfaceToLandXml } from './landxml';
import { parsePointFile, pointsToText } from './points';
import { v3 } from './drafting';

const grid = (): GridRaster => ({
  cols: 2,
  rows: 2,
  xll: 10,
  yll: 20,
  cell: 2,
  nodata: -9999,
  values: Float64Array.of(1, -9999, 3, 4),
});

describe('drawing DXF', () => {
  it('round-trips entities and a 3D face', () => {
    const text = drawingToDxf({
      layers: ['Road', 'TIN'],
      faces: [{ a: v3(0, 0, 1), b: v3(1, 0, 1), c: v3(0, 1, 2) }],
      entities: [
        { id: 'p', type: 'point', layer: 'Road', color: '#ff0000', p: v3(1, 2, 3) },
        { id: 'l', type: 'line', layer: 'Road', color: 'bylayer', a: v3(0, 0, 0), b: v3(5, 0, 1) },
        { id: 'c', type: 'circle', layer: '0', color: 'bylayer', center: v3(2, 2, 0), radius: 4 },
        { id: 'a', type: 'arc', layer: '0', color: 'bylayer', center: v3(0, 0, 0), radius: 3, startAngle: 0, endAngle: Math.PI / 2 },
        { id: 't', type: 'text', layer: '0', color: 'bylayer', p: v3(1, 1, 0), height: 2, rotation: 0, content: 'STA' },
        {
          id: 'w',
          type: 'polyline',
          layer: 'Road',
          color: 'bylayer',
          closed: true,
          vertices: [
            { x: 0, y: 0, z: 1, bulge: 0 },
            { x: 2, y: 0, z: 1, bulge: 0.5 },
            { x: 2, y: 2, z: 1, bulge: 0 },
          ],
        },
      ],
    });
    const model = parseDxf(text);
    expect(model.entities.map((entity) => entity.type)).toEqual(['point', 'line', 'circle', 'arc', 'text', 'polyline']);
    expect(model.entities[0]).toMatchObject({ p: { x: 1, y: 2, z: 3 }, color: '#ff0000' });
    expect(model.entities[4]).toMatchObject({ content: 'STA', height: 2 });
    const poly = model.entities[5];
    expect(poly.type === 'polyline' && poly.closed && poly.vertices[1].bulge).toBe(0.5);
    expect(model.faces[0]).toMatchObject({ a: { x: 0, y: 0, z: 1 }, c: { x: 0, y: 1, z: 2 } });
  });

  it('reads a binary LINE', () => {
    const model = parseDxf(binaryLineDxf());
    expect(model.entities[0]).toMatchObject({ type: 'line', a: { x: 1, y: 2, z: 3 }, b: { x: 4, y: 5, z: 6 } });
  });
});

describe('point and landxml writers', () => {
  it('round-trips PNEZD and XYZ', () => {
    const points = [{ number: '12', y: 100, x: 200, z: 5, description: 'EP', role: 'survey' as const }];
    const text = pointsToText(points, 'PNEZD', ',');
    expect(parsePointFile(text).points[0]).toMatchObject({ number: '12', y: 100, x: 200, z: 5, description: 'EP' });
    const xyz = pointsToText([{ x: 1, y: 2, z: 3, role: 'survey' }], 'ENZ', ' ');
    expect(parsePointFile(xyz, { format: 'ENZ' }).points[0]).toMatchObject({ x: 1, y: 2, z: 3 });
  });

  it('round-trips an alignment and profile', () => {
    const xml = surfaceToLandXml([{ name: 'EG', points: [{ x: 0, y: 0, z: 1, role: 'survey' }], triangles: [] }], {
      alignments: [
        {
          name: 'Main',
          startStation: 10,
          pis: [
            { x: 0, y: 100 },
            { x: 50, y: 100 },
          ],
          profile: [
            { station: 0, elevation: 10 },
            { station: 50, elevation: 12 },
          ],
        },
      ],
    });
    const read = parseLandXml(xml);
    expect(read.alignments[0]).toMatchObject({
      name: 'Main',
      startStation: 10,
      pis: [
        { x: 0, y: 100 },
        { x: 50, y: 100 },
      ],
      profile: [
        { station: 0, elevation: 10 },
        { station: 50, elevation: 12 },
      ],
    });
  });
});

describe('rasters and point clouds', () => {
  it('round-trips an ASCII DEM and skips NODATA', () => {
    const text = gridToAsc(grid());
    const read = parseAsc(text);
    expect(read.cols).toBe(2);
    expect(read.values[1]).toBe(-9999);
    expect(gridToPoints(read)).toHaveLength(3);
    const full = grid();
    full.values = Float64Array.of(1, 2, 3, 4);
    const xyz = gridToXyz(full);
    expect(xyzIsGrid(xyz)).toBe(true);
    expect(parseXyzGrid(xyz).values[0]).toBeCloseTo(1);
    expect(parseXyzGrid(xyz).values[3]).toBeCloseTo(4);
  });

  it('round-trips uncompressed GeoTIFF and refuses LZW', () => {
    const source = grid();
    source.values = Float64Array.of(1, 2, 3, 4);
    const tiff = writeGeoTiff(source);
    const read = readGeoTiff(tiff);
    expect([...read.values]).toEqual([1, 2, 3, 4]);
    expect(read.xll).toBeCloseTo(10);
    expect(read.yll).toBeCloseTo(20);
    const compressed = writeGeoTiff(source);
    const view = new DataView(compressed.buffer);
    // Compression tag 259 is the 4th entry. Patch its inline value to 5 (LZW).
    view.setUint16(8 + 2 + 3 * 12 + 8, 5, true);
    expect(() => readGeoTiff(compressed)).toThrow(/LZW/);
  });

  it('round-trips LAS 1.2 and rejects LAZ', () => {
    const points = [
      { x: 1.5, y: 2.25, z: 3, role: 'survey' as const },
      { x: -4, y: 8, z: 0.5, role: 'survey' as const },
    ];
    const las = writeLas(points);
    expect(readLas(las)[0]).toMatchObject({ x: 1.5, y: 2.25, z: 3 });
    expect(readLas(las)[1].x).toBeCloseTo(-4);
    const laz = new Uint8Array(las);
    const tag = new TextEncoder().encode('laszip');
    laz.set(tag, 26);
    expect(() => readLas(laz)).toThrow(LAZ_REASON);
  });
});

describe('shapefile, image, mesh, pdf', () => {
  it('round-trips point, polyline, and polygon', () => {
    const bytes = writeShp([
      { type: 'point', points: [{ x: 1, y: 2 }] },
      { type: 'polyline', points: [{ x: 0, y: 0 }, { x: 3, y: 4 }] },
      { type: 'polygon', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
    ]);
    const features = readShp(bytes);
    expect(features[0]).toMatchObject({ type: 'point', points: [{ x: 1, y: 2 }] });
    expect(features[1].points).toHaveLength(2);
    expect(features[2].points[0]).toEqual(features[2].points[features[2].points.length - 1]);
  });

  it('reads PNG and JPEG sizes', () => {
    expect(readImageInfo(writePng(12, 34))).toEqual({ format: 'png', width: 12, height: 34 });
    expect(readImageInfo(writeJpeg(8, 9))).toEqual({ format: 'jpeg', width: 8, height: 9 });
  });

  it('round-trips OBJ, STL, and glTF', () => {
    const points = [
      { x: 0, y: 0, z: 0, role: 'survey' as const },
      { x: 1, y: 0, z: 0, role: 'survey' as const },
      { x: 0, y: 2, z: 3, role: 'survey' as const },
    ];
    const triangles: [number, number, number][] = [[0, 1, 2]];
    expect(parseObj(surfaceToObj(points, triangles)).triangles).toEqual([[0, 1, 2]]);
    expect(parseStl(surfaceToStl(points, triangles)).points).toHaveLength(3);
    const gltf = parseGltf(surfaceToGltf(points, triangles));
    expect(gltf.points[2]).toMatchObject({ x: 0, y: 2, z: 3 });
    expect(gltf.triangles).toEqual([[0, 1, 2]]);
  });

  it('writes a one-page PDF', async () => {
    const rgb = new Uint8Array([255, 0, 0, 0, 255, 0]);
    const pdf = await rgbToPdf(2, 1, rgb);
    const text = pdfToText(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/FlateDecode');
    const marker = new TextEncoder().encode('5 0 obj');
    let at = 0;
    while (at < pdf.length && !marker.every((byte, offset) => pdf[at + offset] === byte)) at += 1;
    const stream = new TextEncoder().encode('stream\n');
    let start = at;
    while (start < pdf.length && !stream.every((byte, offset) => pdf[start + offset] === byte)) start += 1;
    start += stream.length;
    const length = Number(/\/Length (\d+)/.exec(text.split('5 0 obj')[1] ?? '')?.[1]);
    const packed = pdf.slice(start, start + length);
    const inflated = new Uint8Array(await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
    expect([...inflated]).toEqual([...rgb]);
  });
});

describe('format catalog', () => {
  it('keeps DWG and LAZ closed', () => {
    expect(dwgAvailable()).toBe(true);
    expect(DWG_VERDICT.read).toBe('yes');
    expect(DWG_VERDICT.write).toBe('partial');
    expect(DWG_VERDICT.reason).toMatch(/GPL-3\.0/);
    expect(DWG_VERDICT.reason).not.toMatch(/https?:\/\//);
    expect(FORMAT_CATALOG.find((row) => row.id === 'dwg')?.read).toBe('yes');
    expect(FORMAT_CATALOG.find((row) => row.id === 'dwg')?.write).toBe('partial');
    expect(FORMAT_CATALOG.find((row) => row.id === 'laz')?.note).toMatch(/LAS 1\.2/);
    const dwg = classifyFile('site.dwg', new Uint8Array([0]));
    expect(dwg.kind).toBe('dwg');
    expect(dwg.reason).toBeUndefined();
    expect(classifyFile('mesh.obj', new TextEncoder().encode('v 0 0 0\n')).kind).toBe('obj');
  });
});
