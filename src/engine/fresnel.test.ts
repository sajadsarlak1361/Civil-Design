import { describe, expect, it } from 'vitest';
import { clothoidLocal, fresnel } from './fresnel';

/** Slow independent check: composite Simpson on the Fresnel integrand. */
function fresnelSimpson(x: number): { C: number; S: number } {
  const steps = 4000;
  const h = x / steps;
  let cEven = 0;
  let cOdd = 0;
  let sEven = 0;
  let sOdd = 0;
  for (let i = 1; i < steps; i++) {
    const t = i * h;
    const phase = (Math.PI / 2) * t * t;
    if (i % 2 === 0) {
      cEven += Math.cos(phase);
      sEven += Math.sin(phase);
    } else {
      cOdd += Math.cos(phase);
      sOdd += Math.sin(phase);
    }
  }
  const end = (Math.PI / 2) * x * x;
  return {
    C: (h / 3) * (1 + Math.cos(end) + 4 * cOdd + 2 * cEven),
    S: (h / 3) * (0 + Math.sin(end) + 4 * sOdd + 2 * sEven),
  };
}

describe('Fresnel integrals and clothoids', () => {
  it('matches the published values at 1', () => {
    const value = fresnel(1);
    expect(value.C).toBeCloseTo(0.7798934003768228, 10);
    expect(value.S).toBeCloseTo(0.43825914739035476, 10);
    expect(fresnel(-1).C).toBeCloseTo(-value.C, 12);
    expect(fresnel(0)).toEqual({ C: 0, S: 0 });
  });

  it('matches an independent Simpson integration', () => {
    for (const x of [0.3, 1.2, 2.4]) {
      const fast = fresnel(x);
      const slow = fresnelSimpson(x);
      expect(fast.C).toBeCloseTo(slow.C, 6);
      expect(fast.S).toBeCloseTo(slow.S, 6);
    }
  });

  it('places a clothoid at the analytical arc length and tangent angle', () => {
    const radius = 80;
    const length = 40;
    const end = clothoidLocal(radius, length, length);
    expect(end.theta).toBeCloseTo(length / (2 * radius), 12);
    const slow = fresnelSimpson(length / Math.sqrt(radius * length * Math.PI));
    const scale = Math.sqrt(radius * length * Math.PI);
    expect(end.x).toBeCloseTo(scale * slow.C, 5);
    expect(end.y).toBeCloseTo(scale * slow.S, 5);
    expect(end.tx).toBeCloseTo(Math.cos(end.theta), 12);
    expect(end.ty).toBeCloseTo(Math.sin(end.theta), 12);
    const mid = clothoidLocal(radius, length, length / 2);
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.y).toBeGreaterThan(0);
    expect(mid.y).toBeLessThan(end.y);
  });
});
