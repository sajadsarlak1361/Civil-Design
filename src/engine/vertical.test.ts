import { describe, expect, it } from 'vitest';
import { elevationOnProfile, verticalExtremum } from './vertical';

const crest = [
  { station: 0, elevation: 48, curveLength: 0 },
  { station: 100, elevation: 50, curveLength: 40 },
  { station: 200, elevation: 48, curveLength: 0 },
];

describe('parabolic vertical curves', () => {
  it('matches the PVC, PVI, and PVT elevations of a crest', () => {
    expect(elevationOnProfile(crest, 0)).toBeCloseTo(48, 8);
    expect(elevationOnProfile(crest, 80)).toBeCloseTo(49.6, 8);
    expect(elevationOnProfile(crest, 100)).toBeCloseTo(49.8, 8);
    expect(elevationOnProfile(crest, 120)).toBeCloseTo(49.6, 8);
    expect(elevationOnProfile(crest, 200)).toBeCloseTo(48, 8);
    const quarter = elevationOnProfile(crest, 90);
    expect(quarter).toBeCloseTo(49.6 + 0.02 * 10 + ((-0.04 / 40) * 100) / 2, 8);
  });

  it('puts the high point where the grade passes through zero', () => {
    const extreme = verticalExtremum(crest, 1);
    expect(extreme?.station).toBeCloseTo(100, 8);
    expect(extreme?.elevation).toBeCloseTo(49.8, 8);
  });

  it('follows the tangent grades outside the curve', () => {
    expect(elevationOnProfile(crest, 50)).toBeCloseTo(49, 8);
    expect(elevationOnProfile(crest, 150)).toBeCloseTo(49, 8);
  });

  it('keeps a grade break when the curve length is zero', () => {
    const kink = [
      { station: 0, elevation: 10, curveLength: 0 },
      { station: 10, elevation: 12, curveLength: 0 },
      { station: 20, elevation: 11, curveLength: 0 },
    ];
    expect(elevationOnProfile(kink, 10)).toBeCloseTo(12, 8);
    expect(elevationOnProfile(kink, 5)).toBeCloseTo(11, 8);
  });
});
