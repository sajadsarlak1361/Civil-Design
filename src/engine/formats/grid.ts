import type { SurveyPoint } from '../types';

/** ESRI ASCII raster. Row 0 is the northern row. Cell values are elevations. */
export interface GridRaster {
  cols: number;
  rows: number;
  xll: number;
  yll: number;
  cell: number;
  nodata: number;
  values: Float64Array;
}

function num(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Math.round(value * 1e6) / 1e6);
}

export function gridToAsc(grid: GridRaster): string {
  const lines = [
    `ncols ${grid.cols}`,
    `nrows ${grid.rows}`,
    `xllcorner ${num(grid.xll)}`,
    `yllcorner ${num(grid.yll)}`,
    `cellsize ${num(grid.cell)}`,
    `NODATA_value ${num(grid.nodata)}`,
  ];
  for (let row = 0; row < grid.rows; row += 1) {
    const cells: string[] = [];
    for (let col = 0; col < grid.cols; col += 1) cells.push(num(grid.values[row * grid.cols + col]));
    lines.push(cells.join(' '));
  }
  return `${lines.join('\n')}\n`;
}

function headerValue(text: string, name: string): number | null {
  const match = new RegExp(`^${name}\\s+(\\S+)`, 'im').exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function looksLikeAsc(text: string): boolean {
  return /^ncols\s+\d+/im.test(text) && /^nrows\s+\d+/im.test(text);
}

export function parseAsc(text: string): GridRaster {
  const cols = headerValue(text, 'ncols');
  const rows = headerValue(text, 'nrows');
  const xll = headerValue(text, 'xllcorner') ?? headerValue(text, 'xllcenter');
  const yll = headerValue(text, 'yllcorner') ?? headerValue(text, 'yllcenter');
  const cell = headerValue(text, 'cellsize');
  const nodata = headerValue(text, 'NODATA_value') ?? -9999;
  if (cols === null || rows === null || xll === null || yll === null || cell === null || cell <= 0) {
    throw new Error('ASCII DEM is missing ncols, nrows, origin, or cellsize.');
  }
  const body = text
    .split(/\r?\n/)
    .filter((line) => line.trim() && !/^(ncols|nrows|xll|yll|cellsize|nodata)/i.test(line.trim()))
    .join(' ');
  const numbers = body
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);
  if (numbers.length < cols * rows || numbers.some((value) => !Number.isFinite(value))) {
    throw new Error('ASCII DEM does not contain a full elevation grid.');
  }
  const values = Float64Array.from(numbers.slice(0, cols * rows));
  let originX = xll;
  let originY = yll;
  if (/^xllcenter\s+/im.test(text)) originX -= cell / 2;
  if (/^yllcenter\s+/im.test(text)) originY -= cell / 2;
  return { cols, rows, xll: originX, yll: originY, cell, nodata, values };
}

/** XYZ grid: one "easting northing elevation" per cell center, row-major from the north. */
export function gridToXyz(grid: GridRaster): string {
  const lines: string[] = [];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      const z = grid.values[row * grid.cols + col];
      if (z === grid.nodata) continue;
      const x = grid.xll + (col + 0.5) * grid.cell;
      const y = grid.yll + (grid.rows - row - 0.5) * grid.cell;
      lines.push(`${num(x)} ${num(y)} ${num(z)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export function xyzIsGrid(text: string): boolean {
  const points: { x: number; y: number }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (parts.length >= 2 && parts.slice(0, 2).every(Number.isFinite)) points.push({ x: parts[0], y: parts[1] });
  }
  if (points.length < 4) return false;
  const xs = new Set(points.map((point) => point.x));
  const ys = new Set(points.map((point) => point.y));
  return xs.size > 1 && ys.size > 1 && xs.size * ys.size <= points.length * 1.25;
}

export function parseXyzGrid(text: string): GridRaster {
  const rows: { x: number; y: number; z: number }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/[\s,]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some((value) => !Number.isFinite(value))) continue;
    rows.push({ x: parts[0], y: parts[1], z: parts[2] });
  }
  if (rows.length < 1) throw new Error('XYZ grid has no points.');
  const xs = [...new Set(rows.map((point) => point.x))].sort((a, b) => a - b);
  const ys = [...new Set(rows.map((point) => point.y))].sort((a, b) => b - a);
  const cell = xs.length > 1 ? xs[1] - xs[0] : ys.length > 1 ? Math.abs(ys[0] - ys[1]) : 1;
  const values = new Float64Array(xs.length * ys.length);
  values.fill(-9999);
  const xIndex = new Map(xs.map((value, index) => [value, index]));
  const yIndex = new Map(ys.map((value, index) => [value, index]));
  for (const point of rows) {
    const col = xIndex.get(point.x);
    const row = yIndex.get(point.y);
    if (col === undefined || row === undefined) continue;
    values[row * xs.length + col] = point.z;
  }
  return {
    cols: xs.length,
    rows: ys.length,
    xll: (xs[0] ?? 0) - cell / 2,
    yll: (ys[ys.length - 1] ?? 0) - cell / 2,
    cell,
    nodata: -9999,
    values,
  };
}

export function gridToPoints(grid: GridRaster): SurveyPoint[] {
  const points: SurveyPoint[] = [];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      const z = grid.values[row * grid.cols + col];
      if (z === grid.nodata) continue;
      points.push({
        x: grid.xll + (col + 0.5) * grid.cell,
        y: grid.yll + (grid.rows - row - 0.5) * grid.cell,
        z,
        role: 'survey',
      });
    }
  }
  return points;
}
