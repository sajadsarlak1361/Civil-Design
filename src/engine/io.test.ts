import { describe, expect, it } from 'vitest';
import { contoursToDxf, trianglesToDxf } from './dxf';
import { generateContours } from './contours';
import { parseLandXml, surfaceToLandXml } from './landxml';
import { parsePointFile, pointFormatColumns, pointsToText } from './points';
import { parseProject, serializeProject, volumeReportCsv } from './project';
import { defaultSurfaceStyle } from './types';
import { buildTin } from './tin';

describe('point file import', () => {
  it('reads PNEZD, PENZD, NEZ and ENZ with comma, space and tab delimiters', () => {
    const pnezd = parsePointFile('1,5000,2000,100.5,TOP OF BANK\n2,5001,2002,101,TOE\n', { format: 'PNEZD' });
    expect(pnezd.points[0]).toMatchObject({ number: '1', y: 5000, x: 2000, z: 100.5, description: 'TOP OF BANK' });
    expect(pnezd.points).toHaveLength(2);

    const penzd = parsePointFile('10 2000 5000 99.25 EP\n', { format: 'PENZD', delimiter: 'whitespace' });
    expect(penzd.points[0]).toMatchObject({ number: '10', x: 2000, y: 5000, z: 99.25, description: 'EP' });

    const nez = parsePointFile('5000\t2000\t88.1\n', { format: 'NEZ', delimiter: 'tab' });
    expect(nez.points[0]).toMatchObject({ y: 5000, x: 2000, z: 88.1 });

    const enz = parsePointFile('2000,5000,77\n', { format: 'ENZ' });
    expect(enz.points[0]).toMatchObject({ x: 2000, y: 5000, z: 77 });

    const xyz = parsePointFile('2000 5000 77\n', { format: 'XYZ', delimiter: 'whitespace' });
    expect(xyz.format).toBe('XYZ');
    expect(xyz.points[0]).toMatchObject({ x: 2000, y: 5000, z: 77 });
    expect(parsePointFile(pointsToText(xyz.points, 'XYZ', ' '), { format: 'XYZ' }).points[0]).toMatchObject({ x: 2000, y: 5000, z: 77 });
  });

  it('maps preview columns to the selected format', () => {
    expect(pointFormatColumns('PNEZD').map((column) => column.label)).toEqual(['Point', 'Y Northing', 'X Easting', 'Z Elevation', 'Description']);
    expect(pointFormatColumns('PENZD').map((column) => column.label)).toEqual(['Point', 'X Easting', 'Y Northing', 'Z Elevation', 'Description']);
    expect(pointFormatColumns('PNEZ').map((column) => column.key)).toEqual(['point', 'y', 'x', 'z']);
    expect(pointFormatColumns('PENZ').map((column) => column.key)).toEqual(['point', 'x', 'y', 'z']);
    expect(pointFormatColumns('NEZ').map((column) => column.key)).toEqual(['y', 'x', 'z']);
    expect(pointFormatColumns('ENZ').map((column) => column.key)).toEqual(['x', 'y', 'z']);
    expect(pointFormatColumns('XYZ').map((column) => column.label)).toEqual(['X', 'Y', 'Z']);
    const row = '1,5000,2000,100.5,EP\n';
    const pnezd = parsePointFile(row, { format: 'PNEZD' }).points[0];
    const penzd = parsePointFile(row, { format: 'PENZD' }).points[0];
    expect(pnezd).toMatchObject({ y: 5000, x: 2000 });
    expect(penzd).toMatchObject({ x: 5000, y: 2000 });
  });

  it('skips comments and reads a named northing/easting header', () => {
    const text = '# sample\nPoint,Northing,Easting,Elevation,Description\n1,10,20,30,SAMPLE\n';
    const parsed = parsePointFile(text);
    expect(parsed.format).toBe('PNEZD');
    expect(parsed.points).toHaveLength(1);
    expect(parsed.points[0]).toMatchObject({ number: '1', y: 10, x: 20, z: 30, description: 'SAMPLE' });
    expect(parsed.skipped).toEqual([]);
  });

  it('maps PointNumber,X,Y,Elevation and number,X,Y,Z into finite points that triangulate', () => {
    const csv = [
      'PointNumber,X,Y,Elevation,Description',
      '1,2000,5000,99.25,EP',
      '2,2100,5000,100,TOE',
      '3,2100,5100,101.5,TOP',
      '4,2000,5100,98.75,GS',
    ].join('\n');
    const parsed = parsePointFile(csv);
    expect(parsed.delimiter).toBe('comma');
    expect(parsed.format).toBe('PENZD');
    expect(parsed.columns.map((column) => column.key)).toEqual(['point', 'x', 'y', 'z', 'description']);
    expect(parsed.skipped).toEqual([]);
    expect(parsed.points).toHaveLength(4);
    expect(parsed.points[0]).toMatchObject({ number: '1', x: 2000, y: 5000, z: 99.25, description: 'EP' });
    expect(parsed.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z))).toBe(true);

    const txt = ['number X Y Z desc', '10 2000 5000 99.25 EP', '11 2100 5000 100 GS', '12 2100 5100 101 GS', '13 2000 5100 98 GS'].join('\n');
    const textParsed = parsePointFile(txt);
    expect(textParsed.delimiter).toBe('whitespace');
    expect(textParsed.format).toBe('PENZD');
    expect(textParsed.points[0]).toMatchObject({ number: '10', x: 2000, y: 5000, z: 99.25, description: 'EP' });
    expect(textParsed.points).toHaveLength(4);

    for (const points of [parsed.points, textParsed.points]) {
      const tin = buildTin(points);
      expect(tin.points.length).toBe(4);
      expect(tin.triangles.length).toBeGreaterThan(0);
      for (const [ia, ib, ic] of tin.triangles) {
        expect(tin.points[ia]).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number), z: expect.any(Number) }));
        expect(tin.points[ib]).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
        expect(tin.points[ic]).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
      }
    }
  });
});

describe('LandXML and DXF', () => {
  it('round-trips a TIN through LandXML', () => {
    const tin = buildTin([
      { x: 0, y: 0, z: 1 },
      { x: 10, y: 0, z: 2 },
      { x: 10, y: 5, z: 3 },
      { x: 0, y: 5, z: 2 },
    ]);
    const xml = surfaceToLandXml([{ name: 'EG', points: tin.points, triangles: tin.triangles }], {
      projectName: 'Test',
      unit: 'm',
      date: new Date('2026-01-02T03:04:05Z'),
    });
    expect(xml).toContain('<P id="1">0 0 1</P>');
    const read = parseLandXml(xml);
    expect(read.surfaces[0].name).toBe('EG');
    expect(read.surfaces[0].points).toHaveLength(tin.points.length);
    expect(read.surfaces[0].triangles).toHaveLength(tin.triangles.length);
    expect(read.surfaces[0].points[0]).toMatchObject({ y: 0, x: 0, z: 1 });
  });

  it('reads CgPoints', () => {
    const xml = `<LandXML><CgPoints name="Shots"><CgPoint name="5" code="GS">500 250 12.5</CgPoint></CgPoints></LandXML>`;
    const read = parseLandXml(xml);
    expect(read.pointGroups[0].points[0]).toMatchObject({ number: '5', y: 500, x: 250, z: 12.5, description: 'GS' });
  });

  it('writes contour polylines and triangle faces', () => {
    const tin = buildTin([
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 10, z: 10 },
      { x: 0, y: 10, z: 10 },
    ]);
    const contours = generateContours(tin.points, tin.triangles, 2, 10);
    const dxf = contoursToDxf(contours, 'm');
    expect(dxf).toContain('LWPOLYLINE');
    expect(dxf).toContain('CONT-MAJOR');
    expect(dxf).toContain('CONT-MINOR');
    const faces = trianglesToDxf(tin.points, tin.triangles);
    expect(faces).toContain('3DFACE');
    expect(faces).toContain('\nTIN\n');
  });
});

describe('project file', () => {
  it('round-trips a surface and writes a volume report', () => {
    const tin = buildTin([
      { x: 0, y: 0, z: 1 },
      { x: 2, y: 0, z: 1 },
      { x: 0, y: 2, z: 2 },
    ]);
    const text = serializeProject({
      format: 'fieldline-project',
      version: 1,
      name: 'Pad',
      unit: 'm',
      activeId: 's1',
      showVolumeMap: false,
      volumeSetup: { baseId: 's1', mode: 'datum', comparisonId: null, datum: 0 },
      surfaces: [
        {
          id: 's1',
          name: 'EG',
          visible: true,
          source: 'points',
          sourcePoints: tin.points,
          points: tin.points,
          triangles: tin.triangles,
          boundary: null,
          breaklines: [],
          maxEdgeLength: null,
          style: defaultSurfaceStyle(0),
        },
      ],
    });
    const project = parseProject(text);
    expect(project.name).toBe('Pad');
    expect(project.surfaces[0].triangles).toHaveLength(1);
    const withAlignment = parseProject(
      JSON.stringify({
        format: 'fieldline-project',
        version: 1,
        name: 'Road',
        unit: 'm',
        surfaces: [],
        alignments: [
          {
            id: 'a1',
            name: 'Access',
            pis: [
              { x: 0, y: 0, radius: 0 },
              { x: 100, y: 0, radius: 40, spiralLength: 15 },
              { x: 100, y: 80, radius: 0 },
            ],
            designProfile: [
              { station: 0, elevation: 10, curveLength: 0 },
              { station: 50, elevation: 12, curveLength: 20 },
              { station: 100, elevation: 9, curveLength: 0 },
            ],
          },
        ],
      }),
    );
    expect(withAlignment.alignments?.[0].pis[1].spiralLength).toBe(15);
    expect(withAlignment.alignments?.[0].designProfile?.[1].curveLength).toBe(20);
    const csv = volumeReportCsv({
      project: 'Pad',
      unit: 'm',
      baseName: 'EG',
      comparisonName: 'Datum 0',
      method: 'Surface to datum',
      cut: 1.5,
      fill: 0,
      net: -1.5,
      cutArea: 2,
      fillArea: 0,
    });
    expect(csv).toContain('Cut volume (m^3),1.5');
    expect(csv).toContain('Net volume (m^3),-1.5');
  });
});
