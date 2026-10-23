import { describe, expect, it } from 'vitest';
import { TriangleBvh } from './bvh';
import { buildTin, elevationAt } from './tin';

describe('triangle BVH', () => {
  it('returns the same elevation as a full triangle scan', () => {
    const points = [];
    for (let y = 0; y <= 8; y++) {
      for (let x = 0; x <= 8; x++) points.push({ x, y, z: 2 * x + 0.5 * y });
    }
    const tin = buildTin(points);
    const bvh = new TriangleBvh(tin.points, tin.triangles);
    for (let y = 0.2; y < 8; y += 0.7) {
      for (let x = 0.2; x < 8; x += 0.7) {
        const indexed = elevationAt(tin.points, tin.triangles, x, y, bvh);
        const brute = elevationAt(tin.points, tin.triangles, x, y);
        expect(indexed).toBeCloseTo(brute ?? NaN, 8);
        expect(indexed).toBeCloseTo(2 * x + 0.5 * y, 6);
      }
    }
    expect(elevationAt(tin.points, tin.triangles, -2, -2, bvh)).toBeNull();
  });
});
