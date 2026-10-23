import { polygonArea, signedArea } from './geometry';
import type { Vec2 } from './types';

export interface ParcelSegment {
  bearing: string;
  distance: number;
  east: number;
  north: number;
}

export interface Parcel {
  id: string;
  name: string;
  ring: Vec2[];
  area: number;
  perimeter: number;
  centroid: Vec2;
  /** Gap between the last vertex and the first, before the ring is closed. */
  misclosure: number;
  segments: ParcelSegment[];
}

function bearingOf(east: number, north: number): string {
  const azimuth = (Math.atan2(east, north) * 180) / Math.PI;
  const wrapped = azimuth < 0 ? azimuth + 360 : azimuth;
  const format = (angle: number) => {
    const total = Math.round(angle * 3600);
    const degrees = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return `${degrees}°${minutes.toString().padStart(2, '0')}'${seconds.toString().padStart(2, '0')}"`;
  };
  if (wrapped <= 90) return `N ${format(wrapped)} E`;
  if (wrapped <= 180) return `S ${format(180 - wrapped)} E`;
  if (wrapped <= 270) return `S ${format(wrapped - 180)} W`;
  return `N ${format(360 - wrapped)} W`;
}

export function buildParcel(id: string, name: string, ring: Vec2[]): Parcel {
  const cleaned: Vec2[] = [];
  for (const point of ring) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const last = cleaned[cleaned.length - 1];
    if (last && Math.hypot(last.x - point.x, last.y - point.y) <= 1e-6) continue;
    cleaned.push({ x: point.x, y: point.y });
  }
  let misclosure = 0;
  if (cleaned.length >= 2) {
    const gap = Math.hypot(cleaned[0].x - cleaned[cleaned.length - 1].x, cleaned[0].y - cleaned[cleaned.length - 1].y);
    if (gap <= 1e-4) {
      misclosure = gap;
      cleaned.pop();
    }
  }
  const segments: ParcelSegment[] = [];
  let perimeter = 0;
  for (let i = 0; i < cleaned.length; i++) {
    const a = cleaned[i];
    const b = cleaned[(i + 1) % cleaned.length];
    const east = b.x - a.x;
    const north = b.y - a.y;
    const distance = Math.hypot(east, north);
    perimeter += distance;
    segments.push({ bearing: bearingOf(east, north), distance, east, north });
  }
  let cx = 0;
  let cy = 0;
  const areaSigned = signedArea(cleaned);
  if (Math.abs(areaSigned) > 1e-10) {
    for (let i = 0; i < cleaned.length; i++) {
      const a = cleaned[i];
      const b = cleaned[(i + 1) % cleaned.length];
      const cross = a.x * b.y - b.x * a.y;
      cx += (a.x + b.x) * cross;
      cy += (a.y + b.y) * cross;
    }
    cx /= 6 * areaSigned;
    cy /= 6 * areaSigned;
  } else if (cleaned.length > 0) {
    cx = cleaned.reduce((sum, point) => sum + point.x, 0) / cleaned.length;
    cy = cleaned.reduce((sum, point) => sum + point.y, 0) / cleaned.length;
  }
  return {
    id,
    name,
    ring: cleaned,
    area: polygonArea(cleaned),
    perimeter,
    centroid: { x: cx, y: cy },
    misclosure,
    segments,
  };
}
