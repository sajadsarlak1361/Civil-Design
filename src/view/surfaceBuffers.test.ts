import { describe, expect, it } from 'vitest';
import { defaultSurfaceStyle, type SurfaceRecord } from '../engine';
import { releaseSurfaceGeometry, retainSurfaceGeometry, surfaceCacheCount } from './surfaceBuffers';

function surface(): SurfaceRecord {
  const points = [
    { x: 0, y: 0, z: 1 },
    { x: 10, y: 0, z: 2 },
    { x: 0, y: 10, z: 3 },
  ];
  return {
    id: 'ground',
    name: 'Ground',
    visible: true,
    source: 'points',
    sourcePoints: points,
    points,
    triangles: [[0, 1, 2]],
    boundary: null,
    breaklines: [],
    maxEdgeLength: null,
    style: defaultSurfaceStyle(0),
  };
}

describe('shared surface buffers', () => {
  it('returns the same GPU geometry to every viewport', () => {
    const origin = { x: 5, y: 5 };
    const first = retainSurfaceGeometry(surface(), origin, 2);
    const second = retainSurfaceGeometry(surface(), origin, 2);
    expect(second.geometry).toBe(first.geometry);
    expect(second.edges).toBe(first.edges);
    expect(first.geometry.getAttribute('position').count).toBe(3);
    expect(surfaceCacheCount()).toBe(1);
    releaseSurfaceGeometry(first.geometry);
    releaseSurfaceGeometry(second.geometry);
    expect(surfaceCacheCount()).toBe(0);
  });
});
