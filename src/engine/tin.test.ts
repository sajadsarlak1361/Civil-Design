import { describe, expect, it } from 'vitest';
import { convexHull, incircle, pointInPolygon, polygonArea, triangleArea2D, triangleCentroid } from './geometry';
import { buildTin, triangulate } from './tin';
import type { SurveyPoint, Triangle, Vec2 } from './types';

function areaOf(points: Vec2[], triangles: Triangle[]): number {
  return triangles.reduce((sum, [a, b, c]) => sum + triangleArea2D(points[a], points[b], points[c]), 0);
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function hasEdge(triangles: Triangle[], a: number, b: number): boolean {
  const key = edgeKey(a, b);
  return triangles.some(
    (tri) => edgeKey(tri[0], tri[1]) === key || edgeKey(tri[1], tri[2]) === key || edgeKey(tri[2], tri[0]) === key,
  );
}

function rand(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

describe('delaunay triangulation', () => {
  it('splits a square into two CCW triangles that cover the hull', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 6 },
      { x: 0, y: 6 },
    ];
    const triangles = triangulate(points);
    expect(triangles).toHaveLength(2);
    for (const [a, b, c] of triangles) {
      expect((points[b].x - points[a].x) * (points[c].y - points[a].y) - (points[b].y - points[a].y) * (points[c].x - points[a].x)).toBeGreaterThan(0);
    }
    expect(areaOf(points, triangles)).toBeCloseTo(60, 6);
    const counts = new Map<string, number>();
    for (const tri of triangles) {
      for (const [u, v] of [
        [tri[0], tri[1]],
        [tri[1], tri[2]],
        [tri[2], tri[0]],
      ] as [number, number][]) {
        const key = edgeKey(u, v);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    for (const count of counts.values()) expect(count).toBeLessThanOrEqual(2);
  });

  it('keeps every point outside or on the circumcircle of every triangle', () => {
    const random = rand(11);
    const points = Array.from({ length: 40 }, () => ({ x: random() * 100, y: random() * 100 }));
    const triangles = triangulate(points);
    const hull = convexHull(points);
    expect(Math.abs(areaOf(points, triangles) - polygonArea(hull))).toBeLessThan(1e-6);
    for (const [ia, ib, ic] of triangles) {
      const a = points[ia];
      const b = points[ib];
      const c = points[ic];
      for (let i = 0; i < points.length; i++) {
        if (i === ia || i === ib || i === ic) continue;
        const d = points[i];
        const det = incircle(a, b, c, d);
        const scale =
          Math.abs(a.x) +
          Math.abs(a.y) +
          Math.abs(b.x) +
          Math.abs(b.y) +
          Math.abs(c.x) +
          Math.abs(c.y) +
          Math.abs(d.x) +
          Math.abs(d.y) +
          1;
        expect(det).toBeLessThan(1e-6 * scale ** 4 + 1e-5);
      }
    }
  });
});

describe('surface build options', () => {
  it('removes triangles longer than the maximum edge', () => {
    const points: SurveyPoint[] = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 30, y: 30, z: 0 },
    ];
    const tin = buildTin(points, { maxEdgeLength: 2 });
    expect(tin.triangles).toHaveLength(1);
    expect(areaOf(tin.points, tin.triangles)).toBeCloseTo(0.5, 6);
  });

  it('clips a point grid to an outer boundary', () => {
    const points: SurveyPoint[] = [];
    for (let x = 0; x <= 10; x++) {
      for (let y = 0; y <= 10; y++) points.push({ x, y, z: 1 });
    }
    const boundary = [
      { x: 2, y: 2 },
      { x: 8, y: 2 },
      { x: 8, y: 8 },
      { x: 2, y: 8 },
    ];
    const tin = buildTin(points, { boundary });
    expect(areaOf(tin.points, tin.triangles)).toBeCloseTo(36, 1);
    for (const tri of tin.triangles) {
      const c = triangleCentroid(tin.points[tri[0]], tin.points[tri[1]], tin.points[tri[2]]);
      expect(pointInPolygon(c, boundary)).toBe(true);
    }
  });

  it('clips a concave outer boundary', () => {
    const points: SurveyPoint[] = [];
    for (let x = 0; x <= 6; x += 0.5) {
      for (let y = 0; y <= 6; y += 0.5) points.push({ x, y, z: 2 });
    }
    const boundary = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 6 },
      { x: 0, y: 6 },
    ];
    const tin = buildTin(points, { boundary });
    expect(Math.abs(areaOf(tin.points, tin.triangles) - 20)).toBeLessThan(0.6);
    for (const tri of tin.triangles) {
      const c = triangleCentroid(tin.points[tri[0]], tin.points[tri[1]], tin.points[tri[2]]);
      expect(pointInPolygon(c, boundary)).toBe(true);
    }
  });

  it('forces a breakline that crosses the triangulation', () => {
    const points: SurveyPoint[] = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 10, z: 0 },
      { x: 0, y: 10, z: 0 },
      { x: 4, y: 6, z: 1 },
    ];
    const tin = buildTin(points, {
      breaklines: [
        [
          { x: 0, y: 0, z: 5 },
          { x: 10, y: 10, z: 5 },
        ],
      ],
    });
    expect(hasEdge(tin.triangles, 0, 2)).toBe(true);
    const diagonal = tin.points[0].z;
    expect(diagonal).toBeCloseTo(5, 6);
    expect(areaOf(tin.points, tin.triangles)).toBeCloseTo(100, 4);
  });
});
