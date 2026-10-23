import { describe, expect, it } from 'vitest';
import { contoursToDxf, trianglesToDxf } from './dxf';
import { generateContours } from './contours';
import { parseLandXml, surfaceToLandXml } from './landxml';
import { parsePointFile } from './points';
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
  });

  it('skips comments and a text header', () => {
    const text = '# sample\nPoint,Northing,Easting,Elevation,Description\n1,10,20,30,SAMPLE\n';
    const parsed = parsePointFile(text);
    expect(parsed.format).toBe('PNEZD');
    expect(parsed.points).toHaveLength(1);
    expect(parsed.points[0].description).toBe('SAMPLE');
    expect(parsed.skipped.length).toBeGreaterThan(0);
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
