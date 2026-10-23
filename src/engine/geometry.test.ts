import { describe, expect, it } from 'vitest';
import { clipConvexPolygon, pointInPolygon, polygonArea, signedArea } from './geometry';

describe('geometry', () => {
  it('clips two overlapping squares to their intersection', () => {
    const a = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    const b = [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 3 },
      { x: 1, y: 3 },
    ];
    const clipped = clipConvexPolygon(a, b);
    expect(Math.abs(polygonArea(clipped) - 1)).toBeLessThan(1e-8);
  });

  it('treats the boundary as inside the polygon', () => {
    const ring = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 0, y: 2 },
    ];
    expect(pointInPolygon({ x: 2, y: 1 }, ring)).toBe(true);
    expect(pointInPolygon({ x: 0, y: 1 }, ring)).toBe(true);
    expect(pointInPolygon({ x: 5, y: 1 }, ring)).toBe(false);
    expect(signedArea(ring)).toBeCloseTo(8, 8);
  });
});
