/** Industry-standard indexed color palette, 1–255. */

const HUES: readonly (readonly [number, number, number])[] = [
  [255, 0, 0],
  [255, 63, 0],
  [255, 127, 0],
  [255, 191, 0],
  [255, 255, 0],
  [191, 255, 0],
  [127, 255, 0],
  [63, 255, 0],
  [0, 255, 0],
  [0, 255, 63],
  [0, 255, 127],
  [0, 255, 191],
  [0, 255, 255],
  [0, 191, 255],
  [0, 127, 255],
  [0, 63, 255],
  [0, 0, 255],
  [63, 0, 255],
  [127, 0, 255],
  [191, 0, 255],
  [255, 0, 255],
  [255, 0, 191],
  [255, 0, 127],
  [255, 0, 63],
];

const FIXED: Record<number, readonly [number, number, number]> = {
  1: [255, 0, 0],
  2: [255, 255, 0],
  3: [0, 255, 0],
  4: [0, 255, 255],
  5: [0, 0, 255],
  6: [255, 0, 255],
  7: [255, 255, 255],
  8: [128, 128, 128],
  9: [192, 192, 192],
  250: [51, 51, 51],
  251: [91, 91, 91],
  252: [132, 132, 132],
  253: [173, 173, 173],
  254: [214, 214, 214],
  255: [255, 255, 255],
};

function shade(hue: readonly [number, number, number], level: number, tint: boolean): [number, number, number] {
  return hue.map((channel) => {
    if (!tint) return Math.floor((channel * level) / 255);
    if (channel === 0) return Math.floor(level / 2);
    if (channel === 255) return level;
    return Math.floor((Math.floor((channel * level) / 255) + 255) / 2);
  }) as [number, number, number];
}

export function aciRgb(index: number): [number, number, number] {
  const fixed = FIXED[index];
  if (fixed) return [fixed[0], fixed[1], fixed[2]];
  if (index < 10 || index > 249) return [255, 255, 255];
  const slot = index - 10;
  const hue = HUES[Math.floor(slot / 10)] ?? HUES[0];
  const shadeIndex = slot % 10;
  const level = [255, 255, 204, 204, 153, 153, 127, 127, 76, 76][shadeIndex];
  return shade(hue, level, shadeIndex % 2 === 1);
}

export function aciHex(index: number): string {
  const [r, g, b] = aciRgb(index);
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function hexRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = match[1];
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

/** Nearest ACI to a hex color. Used when a true color is shown as an index. */
export function nearestAci(hex: string): number {
  const rgb = hexRgb(hex);
  if (!rgb) return 7;
  let best = 7;
  let score = Number.POSITIVE_INFINITY;
  for (let index = 1; index <= 255; index += 1) {
    const candidate = aciRgb(index);
    const distance = (candidate[0] - rgb[0]) ** 2 + (candidate[1] - rgb[1]) ** 2 + (candidate[2] - rgb[2]) ** 2;
    if (distance < score) {
      score = distance;
      best = index;
    }
  }
  return best;
}

export interface ParsedColor {
  /** bylayer, byblock, or #rrggbb */
  color: string;
  colorIndex?: number;
}

const NAMES: Record<string, number> = {
  red: 1,
  yellow: 2,
  green: 3,
  cyan: 4,
  blue: 5,
  magenta: 6,
  white: 7,
};

export function parseColorInput(raw: string): ParsedColor | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  if (text === 'bylayer' || text === 'by layer') return { color: 'bylayer' };
  if (text === 'byblock' || text === 'by block') return { color: 'byblock' };
  const named = NAMES[text];
  if (named) return { color: aciHex(named), colorIndex: named };
  if (/^\d{1,3}$/.test(text)) {
    const index = Number(text);
    if (index >= 1 && index <= 255) return { color: aciHex(index), colorIndex: index };
    return null;
  }
  const hex = hexRgb(text.startsWith('#') ? text : `#${text}`);
  if (!hex) return null;
  return { color: `#${hex.map((channel) => channel.toString(16).padStart(2, '0')).join('')}` };
}

export function colorLabel(color: string, colorIndex?: number): string {
  if (!color || color === 'bylayer') return 'ByLayer';
  if (color === 'byblock') return 'ByBlock';
  if (colorIndex) return `${colorIndex}`;
  return color.toUpperCase();
}

/** Resolve ByLayer / ByBlock / true color to a CSS hex. ByBlock falls back to white. */
export function resolvePaint(color: string | undefined, layerColor: string): string {
  if (!color || color === 'bylayer') return layerColor || '#ffffff';
  if (color === 'byblock') return '#ffffff';
  return color;
}

export interface BookColor {
  name: string;
  hex: string;
}

/** Local color book. No network lookup. */
export const COLOR_BOOK: BookColor[] = [
  { name: 'Civil Design Red', hex: '#ff4d4d' },
  { name: 'Civil Design Amber', hex: '#e3a23a' },
  { name: 'Civil Design Green', hex: '#7dcea0' },
  { name: 'Civil Design Cyan', hex: '#76d7ea' },
  { name: 'Civil Design Blue', hex: '#79b8ff' },
  { name: 'Civil Design Magenta', hex: '#e39bb4' },
  { name: 'Topo', hex: '#7dbeb8' },
  { name: 'Major Contour', hex: '#f0d78c' },
  { name: 'Pavement', hex: '#c4a574' },
  { name: 'Concrete', hex: '#d5dbe6' },
];
