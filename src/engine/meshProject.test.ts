import { describe, expect, it } from 'vitest';
import { meshToObj, meshToPly, meshToStl } from './meshExport';
import { parseProject, serializeProject } from './project';
import type { SurveyPoint, Triangle } from './types';

const points: SurveyPoint[] = [
  { x: 0, y: 0, z: 0 },
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 1, z: 1 },
];
const triangles: Triangle[] = [[0, 1, 2]];

describe('3D mesh project file', () => {
  it('keeps a mesh and forces contours off', () => {
    const text = serializeProject({
      format: 'fieldline-project',
      version: 1,
      name: 'Tube',
      unit: 'm',
      activeId: 'mesh-1',
      surfaces: [
        {
          id: 'mesh-1',
          name: 'Scan',
          visible: true,
          source: 'points',
          sourcePoints: points,
          points,
          triangles,
          boundary: null,
          breaklines: [],
          maxEdgeLength: null,
          style: {
            color: '#79b8ff',
            opacity: 1,
            showPoints: false,
            showTriangles: true,
            showContours: true,
            showElevation: true,
            showSlope: true,
            contourLabels: true,
            minorInterval: 1,
            majorInterval: 5,
            minorColor: '#7dbeb8',
            majorColor: '#f0d78c',
          },
          kind: 'mesh',
          description: 'horseshoe',
          layer: 'MESH',
          locked: true,
          meshRadii: [0.5, 1],
          meshOrient: 'toward-axis',
          meshFillHoles: 8,
        },
      ],
      volumeSetup: { baseId: null, mode: 'datum', comparisonId: null, datum: 0 },
      showVolumeMap: false,
      meshSections: {
        surfaceId: 'mesh-1',
        alignmentId: null,
        sections: [
          {
            station: 10,
            loops: [{ closed: true, points: [{ offset: 0, z: 1, x: 0, y: 0 }] }],
            area: 4,
            perimeter: 8,
            centroid: { offset: 0, z: 1 },
            comparison: null,
          },
        ],
        design: [{ offset: -1, z: 0 }, { offset: 1, z: 0 }, { offset: 0, z: 2 }],
      },
    });
    const read = parseProject(text);
    expect(read.surfaces[0].kind).toBe('mesh');
    expect(read.surfaces[0].style.showContours).toBe(false);
    expect(read.surfaces[0].style.showSlope).toBe(false);
    expect(read.surfaces[0].style.contourLabels).toBe(false);
    expect(read.surfaces[0].locked).toBe(true);
    expect(read.surfaces[0].meshOrient).toBe('toward-axis');
    expect(read.surfaces[0].description).toBe('horseshoe');
    expect(read.meshSections?.sections).toHaveLength(1);
    expect(read.meshSections?.sections[0].area).toBe(4);
    expect(read.meshSections?.design).toHaveLength(3);
  });

  it('writes OBJ, STL, and PLY without moving vertices', () => {
    const obj = meshToObj('Scan', points, triangles);
    expect(obj).toContain('v 0 0 0');
    expect(obj).toContain('v 1 0 0');
    expect(obj).toContain('f 1 2 3');
    const stl = meshToStl('Scan', points, triangles);
    expect(stl).toContain('vertex 0 1 1');
    const ply = meshToPly(points, triangles);
    expect(ply).toContain('element vertex 3');
    expect(ply).toContain('element face 1');
  });
});
