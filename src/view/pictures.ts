import type { Heightfield } from '../engine/lod';

export interface SurfacePicture {
  key: string;
  canvas: HTMLCanvasElement;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const pictures = new Map<string, SurfacePicture>();

export function pictureKey(id: string, triangles: number, mode: string, minor: number, major: number): string {
  return `${id}:${triangles}:${mode}:${minor}:${major}`;
}

export function getPicture(key: string): SurfacePicture | null {
  return pictures.get(key) ?? null;
}

export function putPicture(key: string, pixels: Uint8ClampedArray, field: Heightfield): SurfacePicture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = field.cols;
  canvas.height = field.rows;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.putImageData(new ImageData(pixels, field.cols, field.rows), 0, 0);
  const picture: SurfacePicture = { key, canvas, minX: field.minX, minY: field.minY, maxX: field.maxX, maxY: field.maxY };
  pictures.set(key, picture);
  return picture;
}
