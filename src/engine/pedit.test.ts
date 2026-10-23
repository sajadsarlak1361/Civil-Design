import { describe, expect, it } from 'vitest';
import { v3 } from './drafting';
import { breakPolylineAt, fitPolyline, joinChains, reversePolyline, straightenRange } from './pedit';

const vertex = (x: number, y: number, bulge = 0) => ({ ...v3(x, y), bulge });

describe('PEDIT geometry', () => {
  it('joins an open chain onto either end within the fuzz distance', () => {
    const appended = joinChains([vertex(0, 0), vertex(10, 0)], false, [{ id: 'b', vertices: [vertex(10.2, 0), vertex(20, 0)], closed: false }], 0.5);
    expect(appended.consumed).toEqual(['b']);
    expect(appended.vertices.map((item) => item.x)).toEqual([0, 10, 20]);
    const prepended = joinChains([vertex(10, 0), vertex(20, 0)], false, [{ id: 'a', vertices: [vertex(0, 0), vertex(10, 0)], closed: false }], 0);
    expect(prepended.vertices.map((item) => item.x)).toEqual([0, 10, 20]);
    const flipped = joinChains([vertex(10, 0), vertex(20, 0)], false, [{ id: 'a', vertices: [vertex(10, 0), vertex(0, 0)], closed: false }], 0);
    expect(flipped.vertices.map((item) => item.x)).toEqual([0, 10, 20]);
    const closed = joinChains([vertex(0, 0), vertex(10, 0)], true, [{ id: 'b', vertices: [vertex(10, 0), vertex(0, 5)], closed: false }], 0);
    expect(closed.consumed).toEqual([]);
    expect(closed.closed).toBe(true);
  });

  it('reverses bulges onto the segment that still owns them', () => {
    const reversed = reversePolyline([vertex(0, 0, 1), vertex(10, 0, 0), vertex(10, 10, 0)], false);
    expect(reversed.map((item) => item.x)).toEqual([10, 10, 0]);
    expect(reversed[1]?.bulge).toBeCloseTo(-1);
    expect(reversed[2]?.bulge).toBe(0);
    const loop = reversePolyline([vertex(0, 0, 0.5), vertex(10, 0, 0), vertex(10, 10, -0.25)], true);
    expect(loop[1]?.bulge).toBeCloseTo(-0.5);
    expect(loop[2]?.bulge).toBeCloseTo(0.25);
  });

  it('fits a curve, breaks a vertex, and straightens a span', () => {
    const fit = fitPolyline([vertex(0, 0), vertex(10, 5), vertex(20, 0)], false);
    expect(fit[0]?.bulge).not.toBe(0);
    expect(fit[2]?.bulge).toBe(0);
    const directed = fitPolyline([vertex(0, 0), vertex(10, 0), vertex(20, 0)], false, [Math.PI / 2, null, null]);
    expect(directed[0]?.bulge).toBeCloseTo(Math.tan(Math.PI / 4));
    const broken = breakPolylineAt([vertex(0, 0, 1), vertex(5, 0), vertex(10, 0), vertex(15, 0)], 1, 1, false);
    expect(broken?.primary).toHaveLength(2);
    expect(broken?.primary[1]?.bulge).toBe(0);
    expect(broken?.extra).toHaveLength(3);
    const straight = straightenRange([vertex(0, 0, 1), vertex(5, 5), vertex(10, 0), vertex(15, 0)], 0, 2);
    expect(straight.map((item) => item.x)).toEqual([0, 10, 15]);
    expect(straight[0]?.bulge).toBe(0);
  });
});
