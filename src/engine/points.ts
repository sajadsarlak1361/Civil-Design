import type { SurveyPoint } from './types';

export type PointFormat = 'PNEZD' | 'PENZD' | 'PNEZ' | 'PENZ' | 'NEZ' | 'ENZ' | 'XYZ';
export type FormatChoice = 'auto' | PointFormat;
export type PointColumnKey = 'point' | 'x' | 'y' | 'z' | 'description';

/** One file column, in the order that format reads and the import preview shows. */
export interface PointColumn {
  key: PointColumnKey;
  label: string;
}
export type DelimiterChoice = 'auto' | 'comma' | 'whitespace' | 'tab';

export interface SkippedLine {
  line: number;
  text: string;
  reason: string;
}

export interface PointParseResult {
  points: SurveyPoint[];
  skipped: SkippedLine[];
  delimiter: 'comma' | 'whitespace' | 'tab';
  format: PointFormat;
  /** Column order used to build each point. X is easting, Y is northing, Z is elevation. */
  columns: PointColumn[];
}

const FORMATS: PointFormat[] = ['PNEZD', 'PENZD', 'PNEZ', 'PENZ', 'NEZ', 'ENZ', 'XYZ'];

const POINT_COL: PointColumn = { key: 'point', label: 'Point' };
const X_COL: PointColumn = { key: 'x', label: 'X Easting' };
const Y_COL: PointColumn = { key: 'y', label: 'Y Northing' };
const Z_COL: PointColumn = { key: 'z', label: 'Z Elevation' };
const DESC_COL: PointColumn = { key: 'description', label: 'Description' };

/** Column order and axis labels for a point format. X is easting, Y is northing, Z is elevation. */
export function pointFormatColumns(format: PointFormat): PointColumn[] {
  switch (format) {
    case 'PNEZD':
      return [POINT_COL, Y_COL, X_COL, Z_COL, DESC_COL];
    case 'PENZD':
      return [POINT_COL, X_COL, Y_COL, Z_COL, DESC_COL];
    case 'PNEZ':
      return [POINT_COL, Y_COL, X_COL, Z_COL];
    case 'PENZ':
      return [POINT_COL, X_COL, Y_COL, Z_COL];
    case 'NEZ':
      return [Y_COL, X_COL, Z_COL];
    case 'ENZ':
      return [X_COL, Y_COL, Z_COL];
    case 'XYZ':
      return [
        { key: 'x', label: 'X' },
        { key: 'y', label: 'Y' },
        { key: 'z', label: 'Z' },
      ];
  }
}

export function isPointFormat(value: string): value is PointFormat {
  return (FORMATS as string[]).includes(value);
}

function isComment(line: string): boolean {
  return line.startsWith('#') || line.startsWith(';') || line.startsWith('//');
}

export function detectDelimiter(text: string): 'comma' | 'whitespace' | 'tab' {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !isComment(line))
    .slice(0, 30);
  let commas = 0;
  let tabs = 0;
  for (const line of lines) {
    if (line.includes('\t')) tabs++;
    if (line.includes(',')) commas++;
  }
  if (tabs > 0 && tabs >= commas) return 'tab';
  if (commas > 0) return 'comma';
  return 'whitespace';
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else quoted = false;
      } else current += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(current.trim());
      current = '';
    } else current += ch;
  }
  out.push(current.trim());
  if (out.length > 1 && out[out.length - 1] === '' && line.trim().endsWith(',')) out.pop();
  return out;
}

function splitLine(line: string, delimiter: 'comma' | 'whitespace' | 'tab'): string[] {
  if (delimiter === 'comma') return splitCsv(line);
  if (delimiter === 'tab') return line.split('\t').map((part) => part.trim());
  return line.trim().split(/\s+/);
}

function numeric(value: string): number | null {
  if (value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function detectFormat(rows: string[][]): PointFormat {
  const row = rows.find((fields) => fields.filter((field) => numeric(field) !== null).length >= 3);
  const n = row?.length ?? 0;
  if (n >= 5) return 'PNEZD';
  if (n === 4) return 'PNEZ';
  return 'NEZ';
}

function canonicalHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const HEADER_TO_KEY: Record<string, PointColumnKey> = {
  point: 'point',
  pointnumber: 'point',
  pointno: 'point',
  pointnum: 'point',
  number: 'point',
  num: 'point',
  pt: 'point',
  p: 'point',
  name: 'point',
  id: 'point',
  x: 'x',
  easting: 'x',
  east: 'x',
  e: 'x',
  y: 'y',
  northing: 'y',
  north: 'y',
  n: 'y',
  z: 'z',
  elevation: 'z',
  elev: 'z',
  el: 'z',
  height: 'z',
  description: 'description',
  desc: 'description',
  code: 'description',
  d: 'description',
  note: 'description',
};

/** Named survey columns such as PointNumber,X,Y,Elevation,Description. Null when the row is data. */
function columnsFromHeader(fields: string[]): PointColumn[] | null {
  if (fields.length < 3) return null;
  if (fields.filter((field) => numeric(field) !== null).length >= 3) return null;
  const keys: PointColumnKey[] = [];
  for (const field of fields) {
    const key = HEADER_TO_KEY[canonicalHeader(field)];
    if (!key) return null;
    keys.push(key);
  }
  if (!keys.includes('x') || !keys.includes('y') || !keys.includes('z')) return null;
  if (new Set(keys).size !== keys.length) return null;
  return keys.map((key) => {
    if (key === 'point') return POINT_COL;
    if (key === 'description') return DESC_COL;
    if (key === 'x') return X_COL;
    if (key === 'y') return Y_COL;
    return Z_COL;
  });
}

function formatMatching(fields: string[], columns: PointColumn[]): PointFormat | null {
  const signature = columns.map((column) => column.key).join(',');
  const matches = FORMATS.filter((format) => pointFormatColumns(format).map((column) => column.key).join(',') === signature);
  if (matches.length === 0) return null;
  if (matches.includes('XYZ') && matches.includes('ENZ')) {
    const tokens = fields.map(canonicalHeader);
    return tokens.every((token) => token === 'x' || token === 'y' || token === 'z') ? 'XYZ' : 'ENZ';
  }
  return matches[0];
}

function resolveColumns(rows: string[][], format: FormatChoice): { format: PointFormat; columns: PointColumn[] } {
  if (format !== 'auto') return { format, columns: pointFormatColumns(format) };
  const headerFields = rows[0];
  const header = headerFields ? columnsFromHeader(headerFields) : null;
  if (header) {
    const matched = formatMatching(headerFields, header);
    if (matched) return { format: matched, columns: pointFormatColumns(matched) };
    return { format: 'PENZD', columns: header };
  }
  const detected = detectFormat(rows);
  return { format: detected, columns: pointFormatColumns(detected) };
}

/**
 * Build one survey point from a row.
 * Every returned point has finite easting (x), northing (y), and elevation (z).
 * A missing axis is rejected so triangulation never reads undefined.x.
 */
function pointFromColumns(fields: string[], columns: PointColumn[]): SurveyPoint | null {
  const required = columns.filter((column) => column.key !== 'description').length;
  if (fields.length < required) return null;
  const values = new Map<PointColumnKey, string>();
  columns.forEach((column, index) => {
    if (index < fields.length) values.set(column.key, fields[index]);
  });
  const easting = numeric(values.get('x') ?? '');
  const northing = numeric(values.get('y') ?? '');
  const elevation = numeric(values.get('z') ?? '');
  if (easting === null || northing === null || elevation === null) return null;
  let description = '';
  const descriptionIndex = columns.findIndex((column) => column.key === 'description');
  if (descriptionIndex >= 0) description = fields.slice(descriptionIndex).join(' ');
  else if (fields.length > columns.length) description = fields.slice(columns.length).join(' ');
  description = description.trim();
  const point: SurveyPoint = { x: easting, y: northing, z: elevation, role: 'survey' };
  const number = values.get('point')?.trim();
  if (number) point.number = number;
  if (description) point.description = description;
  return point;
}

function prefixRows(source: string, delimiter: 'comma' | 'whitespace' | 'tab'): string[][] {
  const rows: string[][] = [];
  let i = 0;
  let seen = 0;
  while (i < source.length && seen < 40 && rows.length < 12) {
    let end = source.indexOf('\n', i);
    if (end < 0) end = source.length;
    let stop = end;
    if (stop > i && source.charCodeAt(stop - 1) === 13) stop -= 1;
    const line = source.slice(i, stop).trim();
    i = end + 1;
    seen += 1;
    if (!line || isComment(line)) continue;
    rows.push(splitLine(line, delimiter));
  }
  return rows;
}

function sliceField(source: string, start: number, end: number): string {
  while (start < end && (source.charCodeAt(start) === 32 || source.charCodeAt(start) === 9)) start += 1;
  while (end > start && (source.charCodeAt(end - 1) === 32 || source.charCodeAt(end - 1) === 9)) end -= 1;
  return source.slice(start, end);
}

/** Scan a quote-free point file without splitting it into a string per field. */
function scanPointFile(
  source: string,
  delimiter: 'comma' | 'whitespace' | 'tab',
  format: PointFormat,
  columns: PointColumn[],
): PointParseResult {
  const points: SurveyPoint[] = [];
  const skipped: SkippedLine[] = [];
  const sep = delimiter === 'comma' ? 44 : delimiter === 'tab' ? 9 : 0;
  let lineNo = 1;
  let i = 0;
  while (i < source.length) {
    let end = source.indexOf('\n', i);
    if (end < 0) end = source.length;
    let stop = end;
    if (stop > i && source.charCodeAt(stop - 1) === 13) stop -= 1;
    let start = i;
    while (start < stop && (source.charCodeAt(start) === 32 || source.charCodeAt(start) === 9)) start += 1;
    i = end + 1;
    if (start >= stop || isComment(source.slice(start, Math.min(stop, start + 2)))) {
      lineNo += 1;
      continue;
    }
    const fields: string[] = [];
    if (sep === 0) {
      let p = start;
      while (p < stop) {
        while (p < stop && (source.charCodeAt(p) === 32 || source.charCodeAt(p) === 9)) p += 1;
        if (p >= stop) break;
        const from = p;
        while (p < stop && source.charCodeAt(p) !== 32 && source.charCodeAt(p) !== 9) p += 1;
        fields.push(source.slice(from, p));
      }
    } else {
      let from = start;
      for (let p = start; p <= stop; p++) {
        if (p === stop || source.charCodeAt(p) === sep) {
          fields.push(sliceField(source, from, p));
          from = p + 1;
        }
      }
      if (fields.length > 1 && fields[fields.length - 1] === '' && source.slice(start, stop).trimEnd().endsWith(sep === 44 ? ',' : '\t')) fields.pop();
    }
    const point = pointFromColumns(fields, columns);
    if (!point) {
      if (!columnsFromHeader(fields)) {
        skipped.push({ line: lineNo, text: source.slice(start, stop).trim(), reason: 'Could not read coordinates with the selected format' });
      }
    } else points.push(point);
    lineNo += 1;
  }
  return { points, skipped, delimiter, format, columns };
}

export function parsePointFile(
  text: string,
  options: { format?: FormatChoice; delimiter?: DelimiterChoice } = {},
): PointParseResult {
  let source = text;
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
  const delimiter =
    !options.delimiter || options.delimiter === 'auto' ? detectDelimiter(source) : options.delimiter;
  const explicit = options.format ?? 'auto';
  if (!source.includes('"')) {
    const resolved = resolveColumns(prefixRows(source, delimiter), explicit);
    return scanPointFile(source, delimiter, resolved.format, resolved.columns);
  }
  const rawLines = source.split(/\r?\n/);
  const rows: { line: number; fields: string[] }[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const trimmed = rawLines[i].trim();
    if (!trimmed || isComment(trimmed)) continue;
    rows.push({ line: i + 1, fields: splitLine(trimmed, delimiter) });
  }
  const resolved = resolveColumns(rows.map((row) => row.fields), explicit);
  const points: SurveyPoint[] = [];
  const skipped: SkippedLine[] = [];
  for (const row of rows) {
    const point = pointFromColumns(row.fields, resolved.columns);
    if (!point) {
      if (!columnsFromHeader(row.fields)) {
        skipped.push({
          line: row.line,
          text: rawLines[row.line - 1].trim(),
          reason: 'Could not read coordinates with the selected format',
        });
      }
      continue;
    }
    points.push(point);
  }
  return { points, skipped, delimiter, format: resolved.format, columns: resolved.columns };
}

/** Write points in the same column order `parsePointFile` reads. */
export function pointsToText(points: SurveyPoint[], format: PointFormat = 'PNEZD', delimiter: ',' | ' ' | '\t' = ','): string {
  const join = (fields: (string | number)[]) => fields.join(delimiter === ' ' ? ' ' : delimiter);
  return points
    .map((point, index) => {
      const number = point.number ?? String(index + 1);
      const description = point.description ?? '';
      if (format === 'PENZD' || format === 'PENZ') {
        const fields: (string | number)[] = [number, point.x, point.y, point.z];
        if (format === 'PENZD' && description) fields.push(description);
        return join(fields);
      }
      if (format === 'NEZ') return join([point.y, point.x, point.z]);
      if (format === 'ENZ' || format === 'XYZ') return join([point.x, point.y, point.z]);
      const fields: (string | number)[] = [number, point.y, point.x, point.z];
      if (format === 'PNEZD' && description) fields.push(description);
      return join(fields);
    })
    .join('\n');
}
