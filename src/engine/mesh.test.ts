import { describe, expect, it } from 'vitest';
import { triangleArea3D } from './geometry';
import { buildMesh, meshStatistics, type MeshBuildResult } from './mesh';
import type { SurveyPoint, Triangle } from './types';

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sphere(count: number, radius: number): SurveyPoint[] {
  const points: SurveyPoint[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    points.push({
      x: Math.cos(theta) * ring * radius,
      y: Math.sin(theta) * ring * radius,
      z: y * radius,
    });
  }
  return points;
}

function incident(triangles: Triangle[]): Set<number> {
  const used = new Set<number>();
  for (const [a, b, c] of triangles) {
    used.add(a);
    used.add(b);
    used.add(c);
  }
  return used;
}

function verticalHits(points: SurveyPoint[], triangles: Triangle[], x: number, y: number): number {
  let hits = 0;
  for (const [ia, ib, ic] of triangles) {
    const a = points[ia];
    const b = points[ib];
    const c = points[ic];
    const o1 = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    const o2 = (c.x - b.x) * (y - b.y) - (c.y - b.y) * (x - b.x);
    const o3 = (a.x - c.x) * (y - c.y) - (a.y - c.y) * (x - c.x);
    const pos = o1 > 1e-9 && o2 > 1e-9 && o3 > 1e-9;
    const neg = o1 < -1e-9 && o2 < -1e-9 && o3 < -1e-9;
    if (pos || neg) hits += 1;
  }
  return hits;
}

describe('ball pivoting mesh', () => {
  it('builds a closed sphere without moving the input points', () => {
    const points = sphere(280, 5);
    const mesh = buildMesh(points, { orient: 'outward' });
    expect(mesh.points).toBe(points);
    expect(mesh.triangles.length).toBeGreaterThan(400);
    expect(mesh.boundaryEdges).toBe(0);
    const area = 4 * Math.PI * 25;
    expect(mesh.area3D).toBeGreaterThan(area * 0.9);
    expect(mesh.area3D).toBeLessThan(area * 1.08);
    const used = incident(mesh.triangles);
    expect(used.size).toBe(points.length);
    let outward = 0;
    const step = 4;
    for (let i = 0; i < points.length; i += step) {
      outward += mesh.normals[i * 3] * points[i].x + mesh.normals[i * 3 + 1] * points[i].y + mesh.normals[i * 3 + 2] * points[i].z;
    }
    expect(outward).toBeGreaterThan(0);
  });

  it('keeps both layers of an overhang that shares plan coordinates', () => {
    const points: SurveyPoint[] = [];
    for (let y = 0; y <= 4; y += 0.5) {
      for (let z = 0; z <= 6; z += 0.5) points.push({ x: 0, y, z });
      for (let x = 0.5; x <= 2.5; x += 0.5) points.push({ x, y, z: 6 });
      for (let x = 0.5; x <= 2; x += 0.5) points.push({ x, y, z: 3 });
    }
    const mesh = buildMesh(points, { orient: 'auto' });
    expect(mesh.triangles.length).toBeGreaterThan(20);
    expect(verticalHits(points, mesh.triangles, 1.1, 2.1)).toBeGreaterThanOrEqual(2);
    const used = incident(mesh.triangles);
    const floor = points.findIndex((point) => point.x === 1 && point.y === 2 && point.z === 3);
    const ceiling = points.findIndex((point) => point.x === 1 && point.y === 2 && point.z === 6);
    expect(used.has(floor)).toBe(true);
    expect(used.has(ceiling)).toBe(true);
    const wall = points.findIndex((point) => point.x === 0 && point.y === 2 && point.z === 4);
    expect(used.has(wall)).toBe(true);
    let wallFaces = 0;
    for (const [ia, ib, ic] of mesh.triangles) {
      if (ia !== wall && ib !== wall && ic !== wall) continue;
      const a = points[ia];
      const b = points[ib];
      const c = points[ic];
      const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
      const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
      const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (Math.abs(nx) > Math.abs(ny) && Math.abs(nx) > Math.abs(nz)) wallFaces += 1;
    }
    expect(wallFaces).toBeGreaterThan(0);
  });

  it('reconstructs a noisy horseshoe tunnel as a closed tube with inward normals', () => {
    const random = mulberry32(7);
    const radius = 2;
    const wall = 1.2;
    const length = 8;
    const stations = 16;
    const segments = 28;
    const points: SurveyPoint[] = [];
    const crown = Math.PI * radius;
    const perimeter = radius * 2 + wall * 2 + crown;
    for (let s = 0; s < stations; s++) {
      const x = (length * s) / (stations - 1);
      for (let i = 0; i < segments; i++) {
        let distance = (perimeter * i) / segments;
        let y = 0;
        let z = 0;
        if (distance < radius * 2) {
          y = -radius + distance;
          z = 0;
        } else if ((distance -= radius * 2) < wall) {
          y = radius;
          z = distance;
        } else if ((distance -= wall) < crown) {
          const angle = distance / radius;
          y = Math.cos(angle) * radius;
          z = wall + Math.sin(angle) * radius;
        } else {
          distance -= crown;
          y = -radius;
          z = wall - distance;
        }
        const jitter = (random() - 0.5) * 0.03;
        const radial = Math.hypot(y, z - wall * 0.5) || 1;
        points.push({
          x: x + (random() - 0.5) * 0.02,
          y: y + (y / radial) * jitter,
          z: z + ((z - wall * 0.5) / radial) * jitter,
        });
      }
    }
    const mesh = buildMesh(points, { orient: 'auto', radii: [0.55, 0.9, 1.3] });
    expect(mesh.orientMode).toBe('toward-axis');
    expect(mesh.triangles.length).toBeGreaterThan(points.length);
    const mid = sectionLoopArea(mesh, length / 2);
    expect(mid.closed).toBe(true);
    const expected = radius * 2 * wall + (Math.PI * radius * radius) / 2;
    expect(mid.area).toBeGreaterThan(expected * 0.75);
    expect(mid.area).toBeLessThan(expected * 1.25);
    let inward = 0;
    let samples = 0;
    for (let i = 0; i < points.length; i += 3) {
      const towardY = -points[i].y;
      const towardZ = -(points[i].z - wall * 0.5);
      inward += mesh.normals[i * 3 + 1] * towardY + mesh.normals[i * 3 + 2] * towardZ;
      samples += 1;
    }
    expect(inward / samples).toBeGreaterThan(0.2);
    expect(mesh.points.every((point, index) => point === points[index])).toBe(true);
  });

  it('meshes a cylinder and reports 3D area near the analytic wall', () => {
    const radius = 2;
    const height = 6;
    const angles = 20;
    const rows = 12;
    const points: SurveyPoint[] = [];
    for (let row = 0; row < rows; row++) {
      const z = (height * row) / (rows - 1);
      for (let a = 0; a < angles; a++) {
        const theta = (a / angles) * Math.PI * 2;
        points.push({ x: Math.cos(theta) * radius, y: Math.sin(theta) * radius, z });
      }
    }
    const mesh = buildMesh(points, { orient: 'toward-axis' });
    expect(mesh.orientMode).toBe('toward-axis');
    const expected = 2 * Math.PI * radius * height;
    expect(mesh.area3D).toBeGreaterThan(expected * 0.85);
    expect(mesh.area3D).toBeLessThan(expected * 1.15);
    expect(mesh.boundaryEdges).toBeGreaterThan(0);
    const stats = meshStatistics(points, mesh.triangles);
    expect(stats.vertices).toBe(points.length);
    expect(stats.triangles).toBe(mesh.triangles.length);
    expect(stats.bbox.maxZ - stats.bbox.minZ).toBeCloseTo(height, 6);
    let analytic = 0;
    for (const [ia, ib, ic] of mesh.triangles) analytic += triangleArea3D(points[ia], points[ib], points[ic]);
    expect(analytic).toBeCloseTo(mesh.area3D, 6);
  });

  it('finishes a few thousand points quickly enough to stay off the UI thread budget', () => {
    const points = sphere(2500, 8);
    const started = performance.now();
    const mesh = buildMesh(points);
    const elapsed = performance.now() - started;
    expect(mesh.triangles.length).toBeGreaterThan(1000);
    expect(elapsed).toBeLessThan(20_000);
  });
});

function sectionLoopArea(mesh: MeshBuildResult, x: number): { closed: boolean; area: number } {
  const segments: { ay: number; az: number; by: number; bz: number }[] = [];
  for (const [ia, ib, ic] of mesh.triangles) {
    const tri = [mesh.points[ia], mesh.points[ib], mesh.points[ic]];
    const side = tri.map((point) => point.x - x);
    const hits: { y: number; z: number }[] = [];
    for (let e = 0; e < 3; e++) {
      const a = tri[e];
      const b = tri[(e + 1) % 3];
      const da = side[e];
      const db = side[(e + 1) % 3];
      if ((da > 0 && db > 0) || (da < 0 && db < 0)) continue;
      if (da === 0 && db === 0) continue;
      const denom = da - db;
      if (Math.abs(denom) < 1e-15) continue;
      const t = da / denom;
      if (t < -1e-8 || t > 1 + 1e-8) continue;
      hits.push({ y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
    }
    if (hits.length < 2) continue;
    segments.push({ ay: hits[0].y, az: hits[0].z, by: hits[1].y, bz: hits[1].z });
  }
  const unused = new Set(segments.map((_, index) => index));
  let bestArea = 0;
  let closed = false;
  const key = (y: number, z: number) => `${Math.round(y * 1000)},${Math.round(z * 1000)}`;
  while (unused.size > 0) {
    const start = unused.values().next().value as number;
    unused.delete(start);
    const loop = [{ y: segments[start].ay, z: segments[start].az }, { y: segments[start].by, z: segments[start].bz }];
    let guard = 0;
    while (guard++ < segments.length + 2) {
      const end = loop[loop.length - 1];
      let found = -1;
      let flip = false;
      for (const index of unused) {
        const segment = segments[index];
        if (key(segment.ay, segment.az) === key(end.y, end.z)) {
          found = index;
          flip = false;
          break;
        }
        if (key(segment.by, segment.bz) === key(end.y, end.z)) {
          found = index;
          flip = true;
          break;
        }
      }
      if (found < 0) break;
      unused.delete(found);
      const segment = segments[found];
      loop.push(flip ? { y: segment.ay, z: segment.az } : { y: segment.by, z: segment.bz });
      if (key(loop[loop.length - 1].y, loop[loop.length - 1].z) === key(loop[0].y, loop[0].z)) {
        let area = 0;
        for (let i = 0; i < loop.length - 1; i++) area += loop[i].y * loop[i + 1].z - loop[i + 1].y * loop[i].z;
        area = Math.abs(area) / 2;
        if (area > bestArea) {
          bestArea = area;
          closed = true;
        }
        break;
      }
    }
  }
  return { closed, area: bestArea };
}
