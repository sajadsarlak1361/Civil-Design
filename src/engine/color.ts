export interface Rgb {
  r: number;
  g: number;
  b: number;
}

type Stop = readonly [number, number, number, number];

/** t, r, g, b with t in 0..1 and channels in 0..255. */
export const ELEVATION_RAMP: readonly Stop[] = [
  [0, 22, 58, 52],
  [0.22, 40, 112, 72],
  [0.45, 186, 184, 96],
  [0.66, 206, 142, 62],
  [0.84, 140, 78, 52],
  [1, 244, 239, 230],
];

/** Fixed civil slope scale: 0% through 50%+. */
export const SLOPE_RAMP: readonly Stop[] = [
  [0, 32, 122, 78],
  [0.2, 154, 190, 72],
  [0.45, 224, 186, 70],
  [0.7, 214, 112, 58],
  [1, 176, 48, 40],
];

export function rampRgb(t: number, stops: readonly Stop[]): Rgb {
  const x = Math.min(1, Math.max(0, t));
  let i = 1;
  while (i < stops.length - 1 && stops[i][0] < x) i++;
  const a = stops[Math.max(0, i - 1)];
  const b = stops[i];
  const span = b[0] - a[0] || 1;
  const u = (x - a[0]) / span;
  return {
    r: Math.round(a[1] + (b[1] - a[1]) * u),
    g: Math.round(a[2] + (b[2] - a[2]) * u),
    b: Math.round(a[3] + (b[3] - a[3]) * u),
  };
}

export function rgbCss(c: Rgb, alpha = 1): string {
  if (alpha >= 1) return `rgb(${c.r}, ${c.g}, ${c.b})`;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

export function elevationColor(z: number, minZ: number, maxZ: number): Rgb {
  const span = maxZ - minZ;
  const t = span <= 1e-9 ? 0.5 : (z - minZ) / span;
  return rampRgb(t, ELEVATION_RAMP);
}

export function slopeColor(slopeRatio: number): Rgb {
  const percent = Number.isFinite(slopeRatio) ? slopeRatio * 100 : 999;
  return rampRgb(Math.min(1, percent / 50), SLOPE_RAMP);
}

export function cutFillColor(depth: number, scale: number): Rgb {
  const t = Math.min(1, Math.abs(depth) / Math.max(scale, 1e-9));
  const u = Math.sqrt(t);
  if (depth >= 0) {
    return lerpRgb({ r: 176, g: 208, b: 255 }, { r: 24, g: 78, b: 210 }, u);
  }
  return lerpRgb({ r: 255, g: 196, b: 184 }, { r: 176, g: 36, b: 28 }, u);
}

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

export function parseHex(hex: string): Rgb {
  const h = hex.replace('#', '').trim();
  if (h.length === 3) {
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16),
    };
  }
  return {
    r: parseInt(h.slice(0, 2), 16) || 200,
    g: parseInt(h.slice(2, 4), 16) || 200,
    b: parseInt(h.slice(4, 6), 16) || 200,
  };
}
