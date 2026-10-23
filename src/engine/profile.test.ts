import { describe, expect, it } from 'vitest';
import { solveAlignment } from './alignment';
import { sampleLineAt, sampleLinesAlong, sectionFromSurface, surfaceProfile } from './profile';
import { buildTin } from './tin';

const square = [
  { x: 0, y: 0, z: 0 },
  { x: 10, y: 0, z: 0 },
  { x: 10, y: 10, z: 0 },
  { x: 0, y: 10, z: 0 },
];

describe('surface profile', () => {
  it('samples a flat surface at a constant elevation', () => {
    const tin = buildTin(square.map((point) => ({ ...point, z: 4 })));
    const solved = solveAlignment([
      { x: 1, y: 5, radius: 0 },
      { x: 9, y: 5, radius: 0 },
    ]);
    const profile = surfaceProfile(tin.points, tin.triangles, solved, 0, 2);
    expect(profile.length).toBeGreaterThan(2);
    expect(profile.every((vertex) => vertex.elevation !== null && Math.abs(vertex.elevation - 4) < 1e-6)).toBe(true);
    expect(profile[0].station).toBeCloseTo(0, 6);
    expect(profile[profile.length - 1].station).toBeCloseTo(solved.length, 6);
  });

  it('follows a plane z = x and returns null outside the TIN', () => {
    const tin = buildTin([
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 10 },
      { x: 10, y: 10, z: 10 },
      { x: 0, y: 10, z: 0 },
    ]);
    const solved = solveAlignment([
      { x: -5, y: 5, radius: 0 },
      { x: 15, y: 5, radius: 0 },
    ]);
    const profile = surfaceProfile(tin.points, tin.triangles, solved, 100, 5);
    const at = (station: number) => profile.find((vertex) => Math.abs(vertex.station - station) < 1e-6);
    expect(at(100)?.elevation).toBeNull();
    expect(at(110)?.elevation).toBeCloseTo(5, 4);
    expect(at(115)?.elevation).toBeCloseTo(10, 4);
    expect(at(120)?.elevation).toBeNull();
  });
});

describe('sample lines and sections', () => {
  it('offsets to the right of increasing station', () => {
    const solved = solveAlignment([
      { x: 0, y: 5, radius: 0 },
      { x: 10, y: 5, radius: 0 },
    ]);
    const line = sampleLineAt(solved, 0, 5, 3, 3);
    expect(line).not.toBeNull();
    expect(line?.origin).toMatchObject({ x: 5, y: 5 });
    expect(line?.rx).toBeCloseTo(0, 6);
    expect(line?.ry).toBeCloseTo(-1, 6);
    const lines = sampleLinesAlong(solved, 0, 5, 3, 3);
    expect(lines.map((item) => item.station)).toEqual([0, 5, 10]);
  });

  it('reads a plane z = y across the section', () => {
    const tin = buildTin([
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 10, z: 10 },
      { x: 0, y: 10, z: 10 },
    ]);
    const solved = solveAlignment([
      { x: 0, y: 5, radius: 0 },
      { x: 10, y: 5, radius: 0 },
    ]);
    const line = sampleLineAt(solved, 0, 5, 3, 3);
    expect(line).not.toBeNull();
    if (!line) return;
    const section = sectionFromSurface(tin.points, tin.triangles, line, 3);
    const at = (offset: number) => section.find((sample) => Math.abs(sample.offset - offset) < 1e-6);
    expect(at(-3)?.elevation).toBeCloseTo(8, 4);
    expect(at(0)?.elevation).toBeCloseTo(5, 4);
    expect(at(3)?.elevation).toBeCloseTo(2, 4);
  });

  it('holds a constant elevation on a flat section', () => {
    const tin = buildTin(square.map((point) => ({ ...point, z: 7 })));
    const solved = solveAlignment([
      { x: 1, y: 5, radius: 0 },
      { x: 9, y: 5, radius: 0 },
    ]);
    const line = sampleLineAt(solved, 0, 4, 2, 2);
    expect(line).not.toBeNull();
    if (!line) return;
    const section = sectionFromSurface(tin.points, tin.triangles, line, 1);
    expect(section.length).toBeGreaterThan(2);
    expect(section.every((sample) => sample.elevation !== null && Math.abs(sample.elevation - 7) < 1e-6)).toBe(true);
  });
});
