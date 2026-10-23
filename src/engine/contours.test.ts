import { describe, expect, it } from 'vitest';
import { generateContours, smoothPolyline } from './contours';
import { buildTin } from './tin';
import type { SurveyPoint } from './types';

function grid(n: number, zAt: (x: number, y: number) => number, step = 1): SurveyPoint[] {
  const points: SurveyPoint[] = [];
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const x = i * step;
      const y = j * step;
      points.push({ x, y, z: zAt(x, y) });
    }
  }
  return points;
}

describe('contours', () => {
  it('draws a straight contour on a known plane', () => {
    const tin = buildTin(grid(10, (x) => 2 * x));
    const contours = generateContours(tin.points, tin.triangles, 2, 10);
    const level = contours.filter((line) => Math.abs(line.elevation - 10) < 1e-6);
    expect(level.length).toBeGreaterThan(0);
    const vertices = level.flatMap((line) => line.points);
    expect(vertices.length).toBeGreaterThan(2);
    for (const vertex of vertices) expect(vertex.x).toBeCloseTo(5, 4);
    const length = level.reduce((sum, line) => {
      let run = 0;
      for (let i = 1; i < line.points.length; i++) {
        run += Math.hypot(line.points[i].x - line.points[i - 1].x, line.points[i].y - line.points[i - 1].y);
      }
      return sum + run;
    }, 0);
    expect(length).toBeGreaterThan(9.5);
    expect(level.some((line) => line.major)).toBe(true);
    expect(contours.some((line) => Math.abs(line.elevation - 8) < 1e-6 && !line.major)).toBe(true);
  });

  it('draws a closed contour on a cone at the analytical radius', () => {
    const step = 0.25;
    const n = 12 / step;
    const tin = buildTin(
      grid(n, (x, y) => 10 - Math.hypot(x - 6, y - 6), step).map((point) => ({
        ...point,
        x: point.x - 6,
        y: point.y - 6,
      })),
    );
    const contours = generateContours(tin.points, tin.triangles, 1, 2);
    const loop = contours.filter((line) => Math.abs(line.elevation - 6) < 1e-6 && line.closed);
    expect(loop.length).toBeGreaterThan(0);
    const vertices = loop.flatMap((line) => line.points);
    const radii = vertices.map((vertex) => Math.hypot(vertex.x, vertex.y));
    const mean = radii.reduce((sum, radius) => sum + radius, 0) / radii.length;
    expect(mean).toBeCloseTo(4, 1);
    for (const radius of radii) expect(Math.abs(radius - 4)).toBeLessThan(0.35);
  });

  it('smooths a jagged contour without moving a straight one', () => {
    const straight = smoothPolyline(
      [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ],
      false,
      2,
    );
    expect(straight.every((point) => Math.abs(point.y) < 1e-12)).toBe(true);
    const corner = smoothPolyline(
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 0 },
      ],
      false,
      1,
    );
    expect(corner[0]).toEqual({ x: 0, y: 0 });
    expect(corner[2]).toEqual({ x: 2, y: 0 });
    expect(corner[1].y).toBeLessThan(1);
    expect(corner[1].y).toBeGreaterThan(0);
    const tin = buildTin(grid(6, (x) => x, 2));
    const smoothed = generateContours(tin.points, tin.triangles, 2, 10, true);
    const raw = generateContours(tin.points, tin.triangles, 2, 10, false);
    expect(smoothed.length).toBe(raw.length);
    const line = smoothed.find((contour) => contour.points.length > 2);
    expect(line).toBeTruthy();
    if (!line) return;
    const xs = line.points.map((point) => point.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.05);
  });

  it('emits nothing on a flat surface', () => {
    const tin = buildTin(grid(4, () => 12));
    expect(generateContours(tin.points, tin.triangles, 1, 5)).toEqual([]);
  });
});
