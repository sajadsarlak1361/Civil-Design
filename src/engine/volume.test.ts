import { describe, expect, it } from 'vitest';
import { buildTin } from './tin';
import type { SurveyPoint } from './types';
import { volumeTinToTin, volumeToDatum } from './volume';

function tinFrom(points: SurveyPoint[]) {
  return buildTin(points);
}

describe('volumes', () => {
  it('computes the volume of a flat box against a datum', () => {
    const tin = tinFrom([
      { x: 0, y: 0, z: 5 },
      { x: 10, y: 0, z: 5 },
      { x: 10, y: 10, z: 5 },
      { x: 0, y: 10, z: 5 },
    ]);
    const result = volumeToDatum(tin.points, tin.triangles, 0);
    expect(result.cut).toBeCloseTo(500, 4);
    expect(result.fill).toBeCloseTo(0, 4);
    expect(result.net).toBeCloseTo(-500, 4);
  });

  it('integrates a single prism with the exact average-depth formula', () => {
    const base = tinFrom([
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 0, y: 3, z: 0 },
    ]);
    const comparison = tinFrom([
      { x: 0, y: 0, z: 1 },
      { x: 4, y: 0, z: 2 },
      { x: 0, y: 3, z: 3 },
    ]);
    const result = volumeTinToTin(base.points, base.triangles, comparison.points, comparison.triangles);
    expect(result.fill).toBeCloseTo(12, 4);
    expect(result.cut).toBeCloseTo(0, 4);
  });

  it('computes the volume of a pyramid against a datum', () => {
    const tin = tinFrom([
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 10, z: 0 },
      { x: 0, y: 10, z: 0 },
      { x: 5, y: 5, z: 9 },
    ]);
    const result = volumeToDatum(tin.points, tin.triangles, 0);
    // V = (1/3) * base * height = 300. The surface is above the datum, so it is cut.
    expect(result.cut).toBeCloseTo(300, 3);
    expect(result.fill).toBeCloseTo(0, 3);
  });

  it('computes a wedge that is linear in easting', () => {
    const tin = tinFrom([
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 10 },
      { x: 10, y: 10, z: 10 },
      { x: 0, y: 10, z: 0 },
    ]);
    const result = volumeToDatum(tin.points, tin.triangles, 0);
    expect(result.cut).toBeCloseTo(500, 3);
    expect(result.fill).toBeCloseTo(0, 3);
  });

  it('compares two flat surfaces with the TIN-to-TIN composite', () => {
    const base = tinFrom([
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 10, z: 0 },
      { x: 0, y: 10, z: 0 },
    ]);
    const proposed = tinFrom([
      { x: 0, y: 0, z: 4 },
      { x: 10, y: 0, z: 4 },
      { x: 10, y: 10, z: 4 },
      { x: 0, y: 10, z: 4 },
    ]);
    const result = volumeTinToTin(base.points, base.triangles, proposed.points, proposed.triangles);
    expect(result.fill).toBeCloseTo(400, 3);
    expect(result.cut).toBeCloseTo(0, 3);
    expect(result.net).toBeCloseTo(400, 3);
  });

  it('splits cut and fill where a comparison plane crosses the base', () => {
    const base = tinFrom([
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 10, z: 0 },
      { x: 0, y: 10, z: 0 },
    ]);
    const proposed = tinFrom([
      { x: 0, y: 0, z: -5 },
      { x: 10, y: 0, z: 5 },
      { x: 10, y: 10, z: 5 },
      { x: 0, y: 10, z: -5 },
    ]);
    const result = volumeTinToTin(base.points, base.triangles, proposed.points, proposed.triangles);
    expect(result.fill).toBeCloseTo(125, 2);
    expect(result.cut).toBeCloseTo(125, 2);
    expect(result.net).toBeCloseTo(0, 2);
  });

  it('limits the composite volume to the plan overlap', () => {
    const base = tinFrom([
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 10, z: 0 },
      { x: 0, y: 10, z: 0 },
    ]);
    const proposed = tinFrom([
      { x: 0, y: 0, z: 2 },
      { x: 5, y: 0, z: 2 },
      { x: 5, y: 10, z: 2 },
      { x: 0, y: 10, z: 2 },
    ]);
    const result = volumeTinToTin(base.points, base.triangles, proposed.points, proposed.triangles);
    expect(result.fill).toBeCloseTo(100, 2);
    expect(result.cut).toBeCloseTo(0, 2);
    expect(result.fillArea).toBeCloseTo(50, 2);
  });
});
