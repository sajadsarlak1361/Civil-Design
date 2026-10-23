import { describe, expect, it } from 'vitest';
import {
  alignmentFromPolyline,
  formatStation,
  pointAtDistance,
  solveAlignment,
  stationTicks,
} from './alignment';
import { dist } from './geometry';

describe('horizontal alignment', () => {
  it('stations a straight tangent', () => {
    const solved = solveAlignment([
      { x: 0, y: 0, radius: 0 },
      { x: 100, y: 0, radius: 0 },
    ]);
    expect(solved.length).toBeCloseTo(100, 6);
    expect(solved.entities).toHaveLength(1);
    const at = pointAtDistance(solved, 40);
    expect(at).toMatchObject({ x: 40, y: 0, tx: 1, ty: 0 });
    const ticks = stationTicks(solved, 1000, 25);
    expect(ticks.map((tick) => tick.station)).toEqual([1000, 1025, 1050, 1075, 1100]);
    expect(formatStation(0, 'm')).toBe('0+000.00');
    expect(formatStation(20, 'm')).toBe('0+020.00');
    expect(formatStation(1234.5, 'm')).toBe('1+234.50');
    expect(formatStation(150.25, 'ft')).toBe('1+50.25');
  });

  it('inserts a left circular curve between two tangents', () => {
    const solved = solveAlignment([
      { x: 0, y: 0, radius: 0 },
      { x: 50, y: 0, radius: 20 },
      { x: 50, y: 50, radius: 0 },
    ]);
    expect(solved.warnings).toEqual([]);
    expect(solved.radii[1]).toBeCloseTo(20, 6);
    const arc = solved.entities.find((entity) => entity.kind === 'arc');
    expect(arc?.kind).toBe('arc');
    if (arc?.kind !== 'arc') return;
    expect(arc.a.x).toBeCloseTo(30, 5);
    expect(arc.a.y).toBeCloseTo(0, 5);
    expect(arc.b.x).toBeCloseTo(50, 5);
    expect(arc.b.y).toBeCloseTo(20, 5);
    expect(arc.turn).toBe('left');
    expect(arc.length).toBeCloseTo(10 * Math.PI, 5);
    expect(solved.length).toBeCloseTo(60 + 10 * Math.PI, 5);
    const mid = pointAtDistance(solved, 30 + arc.length / 2);
    expect(mid?.x).toBeCloseTo(30 + 20 * Math.cos(-Math.PI / 4), 4);
    expect(mid?.y).toBeCloseTo(20 + 20 * Math.sin(-Math.PI / 4), 4);
    expect(solved.entities[0].kind).toBe('line');
    expect(solved.entities[solved.entities.length - 1].b).toMatchObject({ x: 50, y: 50 });
    expect(entitiesConnect(solved.entities)).toBe(true);
  });

  it('inserts a right circular curve', () => {
    const solved = solveAlignment([
      { x: 0, y: 0, radius: 0 },
      { x: 50, y: 0, radius: 20 },
      { x: 50, y: -50, radius: 0 },
    ]);
    const arc = solved.entities.find((entity) => entity.kind === 'arc');
    expect(arc?.kind).toBe('arc');
    if (arc?.kind !== 'arc') return;
    expect(arc.turn).toBe('right');
    expect(arc.b.x).toBeCloseTo(50, 5);
    expect(arc.b.y).toBeCloseTo(-20, 5);
    const mid = pointAtDistance(solved, solved.entities[0].length + arc.length / 2);
    expect(mid?.x).toBeCloseTo(30 + 20 * Math.cos(Math.PI / 4), 4);
    expect(mid?.y).toBeCloseTo(-20 + 20 * Math.sin(Math.PI / 4), 4);
  });

  it('shrinks a curve that does not fit between the PIs', () => {
    const solved = solveAlignment([
      { x: 0, y: 0, radius: 0 },
      { x: 10, y: 0, radius: 1000 },
      { x: 10, y: 10, radius: 0 },
    ]);
    expect(solved.radii[1]).toBeLessThan(20);
    expect(solved.radii[1]).toBeGreaterThan(1);
    expect(solved.length).toBeGreaterThan(10);
    expect(solved.length).toBeLessThan(20);
    expect(entitiesConnect(solved.entities)).toBe(true);
    expect(solved.entities[solved.entities.length - 1].b.y).toBeCloseTo(10, 4);
    expect(solved.warnings.some((warning) => warning.includes('reduced'))).toBe(true);
  });

  it('keeps a polyline of tangents when the radius is zero', () => {
    const pis = alignmentFromPolyline(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      0,
    );
    const solved = solveAlignment(pis);
    expect(solved.entities.every((entity) => entity.kind === 'line')).toBe(true);
    expect(solved.length).toBeCloseTo(20, 6);
    const corner = pointAtDistance(solved, 10);
    expect(corner?.x).toBeCloseTo(10, 5);
    expect(corner?.y).toBeCloseTo(0, 5);
  });

  it('inserts Euler spirals whose ends sit on the circular arc', () => {
    const solved = solveAlignment([
      { x: 0, y: 0, radius: 0 },
      { x: 200, y: 0, radius: 100, spiralLength: 30 },
      { x: 200, y: 200, radius: 0 },
    ]);
    const spirals = solved.entities.filter((entity) => entity.kind === 'spiral');
    const arc = solved.entities.find((entity) => entity.kind === 'arc');
    expect(spirals).toHaveLength(2);
    expect(arc?.kind).toBe('arc');
    if (arc?.kind !== 'arc') return;
    expect(dist(arc.center, arc.a)).toBeCloseTo(100, 3);
    expect(dist(arc.center, arc.b)).toBeCloseTo(100, 3);
    expect(arc.length).toBeCloseTo(100 * (Math.PI / 2 - 30 / 100), 2);
    expect(solved.length).toBeGreaterThan(arc.length + 60);
    expect(entitiesConnect(solved.entities)).toBe(true);
    const incoming = spirals[0];
    const atEnd = pointAtDistance(solved, incoming.start + incoming.length);
    expect(atEnd?.x).toBeCloseTo(arc.a.x, 3);
    expect(atEnd?.y).toBeCloseTo(arc.a.y, 3);
  });

  it('drops the curve on a straight tangent run', () => {
    const solved = solveAlignment([
      { x: 0, y: 0, radius: 0 },
      { x: 10, y: 0, radius: 5 },
      { x: 20, y: 0, radius: 0 },
    ]);
    expect(solved.length).toBeCloseTo(20, 6);
    expect(solved.entities.every((entity) => entity.kind === 'line')).toBe(true);
    expect(pointAtDistance(solved, 10)?.x).toBeCloseTo(10, 5);
    expect(pointAtDistance(solved, 10)?.y).toBeCloseTo(0, 5);
  });
});

function entitiesConnect(entities: { a: { x: number; y: number }; b: { x: number; y: number } }[]): boolean {
  for (let i = 1; i < entities.length; i++) {
    const gap = Math.hypot(entities[i].a.x - entities[i - 1].b.x, entities[i].a.y - entities[i - 1].b.y);
    if (gap > 1e-6) return false;
  }
  return entities.length > 0;
}
