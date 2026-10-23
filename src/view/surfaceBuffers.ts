import * as THREE from 'three';
import { elevationColor, type SurfaceRecord } from '../engine';

/**
 * One BufferGeometry per surface, shared by every model-space viewport.
 * Viewports render that geometry with their own cameras. They do not copy
 * the vertex buffer. A 1.5M-point surface is uploaded once.
 */
export interface SharedSurface {
  key: string;
  geometry: THREE.BufferGeometry;
  edges: THREE.BufferGeometry;
}

interface Entry extends SharedSurface {
  refs: number;
}

const cache = new Map<string, Entry>();

export function surfaceCacheKey(surface: SurfaceRecord, origin: { x: number; y: number }, exaggeration: number): string {
  const step = surface.points.length > 200_000 ? Math.floor(surface.points.length / 64) : 1;
  let hash = (surface.points.length * 17 + surface.triangles.length) | 0;
  for (let i = 0; i < surface.points.length; i += step) {
    const point = surface.points[i];
    hash = Math.imul(hash ^ Math.round(point.z * 100), 16777619) ^ Math.round(point.x) ^ Math.round(point.y);
  }
  return `${surface.id}:${origin.x.toFixed(3)}:${origin.y.toFixed(3)}:${exaggeration}:${hash}`;
}

export function retainSurfaceGeometry(surface: SurfaceRecord, origin: { x: number; y: number }, exaggeration: number): SharedSurface {
  const key = surfaceCacheKey(surface, origin, exaggeration);
  const found = cache.get(key);
  if (found) {
    found.refs += 1;
    return found;
  }
  const built = build(surface, origin, exaggeration, key);
  cache.set(key, { ...built, refs: 1 });
  return built;
}

export function releaseSurfaceGeometry(geometry: THREE.BufferGeometry): void {
  for (const [key, entry] of cache) {
    if (entry.geometry !== geometry) continue;
    entry.refs -= 1;
    if (entry.refs <= 0) {
      entry.geometry.dispose();
      entry.edges.dispose();
      cache.delete(key);
    }
    return;
  }
}

export function surfaceCacheCount(): number {
  return cache.size;
}

function build(surface: SurfaceRecord, origin: { x: number; y: number }, exaggeration: number, key: string): SharedSurface {
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of surface.points) {
    if (point.z < minZ) minZ = point.z;
    if (point.z > maxZ) maxZ = point.z;
  }
  const positions = new Float32Array(surface.points.length * 3);
  const colors = new Float32Array(surface.points.length * 3);
  for (let i = 0; i < surface.points.length; i++) {
    const point = surface.points[i];
    positions[i * 3] = point.x - origin.x;
    positions[i * 3 + 1] = point.z * exaggeration;
    positions[i * 3 + 2] = -(point.y - origin.y);
    const color = elevationColor(point.z, minZ, maxZ);
    colors[i * 3] = color.r / 255;
    colors[i * 3 + 1] = color.g / 255;
    colors[i * 3 + 2] = color.b / 255;
  }
  const indices = new Uint32Array(surface.triangles.length * 3);
  for (let i = 0; i < surface.triangles.length; i++) {
    const tri = surface.triangles[i];
    indices[i * 3] = tri[0];
    indices[i * 3 + 1] = tri[1];
    indices[i * 3 + 2] = tri[2];
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  const edgePositions: number[] = [];
  for (const [ia, ib, ic] of surface.triangles) {
    const corners = [ia, ib, ic, ia];
    for (let i = 0; i < 3; i++) {
      const a = corners[i] * 3;
      const b = corners[i + 1] * 3;
      edgePositions.push(positions[a], positions[a + 1], positions[a + 2], positions[b], positions[b + 1], positions[b + 2]);
    }
  }
  const edges = new THREE.BufferGeometry();
  edges.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
  return { key, geometry, edges };
}
