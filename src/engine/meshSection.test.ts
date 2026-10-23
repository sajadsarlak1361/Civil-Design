import { describe, expect, it } from 'vitest';
import { compareRings, intersectMeshPlane, meshSectionCsv, sectionMesh, sectionMetrics, stationsInRange, type SectionPlane } from './meshSection';
import type { SurveyPoint, Triangle } from './types';

function squareTube(): { points: SurveyPoint[]; triangles: Triangle[] } {
  const points: SurveyPoint[] = [
    { x: 0, y: -1, z: -1 },
    { x: 0, y: 1, z: -1 },
    { x: 0, y: 1, z: 1 },
    { x: 0, y: -1, z: 1 },
    { x: 4, y: -1, z: -1 },
    { x: 4, y: 1, z: -1 },
    { x: 4, y: 1, z: 1 },
    { x: 4, y: -1, z: 1 },
  ];
  const wall = (a: number, b: number, c: number, d: number): Triangle[] => [
    [a, b, c],
    [a, c, d],
  ];
  const triangles = [
    ...wall(0, 1, 5, 4),
    ...wall(1, 2, 6, 5),
    ...wall(2, 3, 7, 6),
    ...wall(3, 0, 4, 7),
  ];
  return { points, triangles };
}

function planeAt(x: number): SectionPlane {
  return { ox: x, oy: 0, oz: 0, nx: 1, ny: 0, nz: 0, rx: 0, ry: 1, rz: 0, station: x };
}

describe('mesh plane sections', () => {
  it('cuts a square tube into one closed loop of the right area', () => {
    const tube = squareTube();
    const loops = intersectMeshPlane(tube.points, tube.triangles, planeAt(2));
    expect(loops.filter((loop) => loop.closed)).toHaveLength(1);
    const metrics = sectionMetrics(loops[0]);
    expect(metrics.area).toBeCloseTo(4, 6);
    expect(metrics.perimeter).toBeCloseTo(8, 6);
    expect(metrics.centroid.offset).toBeCloseTo(0, 6);
    expect(metrics.centroid.z).toBeCloseTo(0, 6);
  });

  it('returns two loops when the plane cuts two separate tubes', () => {
    const a = squareTube();
    const b = squareTube();
    const shift = b.points.map((point) => ({ ...point, y: point.y + 5 }));
    const points = [...a.points, ...shift];
    const triangles = [...a.triangles, ...b.triangles.map((tri) => tri.map((index) => index + a.points.length) as Triangle)];
    const loops = intersectMeshPlane(points, triangles, planeAt(1)).filter((loop) => loop.closed);
    expect(loops).toHaveLength(2);
    expect(loops[0].points.length).toBeGreaterThanOrEqual(4);
    expect(loops[1].points.length).toBeGreaterThanOrEqual(4);
  });

  it('measures overbreak and underbreak on shifted squares', () => {
    const design = [
      { offset: 0, z: 0 },
      { offset: 4, z: 0 },
      { offset: 4, z: 4 },
      { offset: 0, z: 4 },
    ];
    const asBuilt = [
      { offset: 1, z: 1 },
      { offset: 5, z: 1 },
      { offset: 5, z: 5 },
      { offset: 1, z: 5 },
    ];
    const report = compareRings(asBuilt, design);
    expect(report.overbreakArea).toBeCloseTo(7, 4);
    expect(report.underbreakArea).toBeCloseTo(7, 4);
    expect(report.maxOverbreak).toBeGreaterThan(1);
    expect(report.maxUnderbreak).toBeGreaterThan(0.5);
  });

  it('reports a pure overbreak ring when the as-built opening contains the design', () => {
    const design = [
      { offset: -1, z: -1 },
      { offset: 1, z: -1 },
      { offset: 1, z: 1 },
      { offset: -1, z: 1 },
    ];
    const asBuilt = [
      { offset: -2, z: -2 },
      { offset: 2, z: -2 },
      { offset: 2, z: 2 },
      { offset: -2, z: 2 },
    ];
    const report = compareRings(asBuilt, design);
    expect(report.overbreakArea).toBeCloseTo(12, 4);
    expect(report.underbreakArea).toBeCloseTo(0, 4);
    expect(report.maxOverbreak).toBeCloseTo(Math.SQRT2, 4);
    expect(report.maxUnderbreak).toBe(0);
    expect(report.overbreak.length).toBeGreaterThan(0);
  });

  it('compares a tube section with a smaller design square', () => {
    const tube = squareTube();
    const design = [
      { offset: -0.5, z: -0.5 },
      { offset: 0.5, z: -0.5 },
      { offset: 0.5, z: 0.5 },
      { offset: -0.5, z: 0.5 },
    ];
    const [section] = sectionMesh(tube.points, tube.triangles, [planeAt(2)], design);
    expect(section.area).toBeCloseTo(4, 5);
    expect(section.comparison?.overbreakArea).toBeCloseTo(3, 4);
    expect(section.comparison?.underbreakArea).toBeCloseTo(0, 4);
    const csv = meshSectionCsv([section]);
    expect(csv).toContain('Overbreak area');
    expect(csv).toContain('2,4,');
  });

  it('lists stations across a range and sections a large grid quickly', () => {
    expect(stationsInRange(10, 0, 5)).toEqual([0, 5, 10]);
    const points: SurveyPoint[] = [];
    const triangles: Triangle[] = [];
    const n = 200;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) points.push({ x, y, z: 0 });
    }
    const id = (x: number, y: number) => y * n + x;
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        triangles.push([id(x, y), id(x + 1, y), id(x + 1, y + 1)]);
        triangles.push([id(x, y), id(x + 1, y + 1), id(x, y + 1)]);
      }
    }
    const plane: SectionPlane = { ox: 40, oy: 0, oz: 0, nx: 1, ny: 0, nz: 0, rx: 0, ry: 1, rz: 0, station: 40 };
    const started = performance.now();
    const loops = intersectMeshPlane(points, triangles, plane);
    const elapsed = performance.now() - started;
    expect(loops.some((loop) => loop.points.length > 10)).toBe(true);
    expect(elapsed).toBeLessThan(2000);
    expect(triangles.length).toBeGreaterThan(70_000);
  });
});
