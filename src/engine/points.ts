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

function fieldCount(format: PointFormat): number {
  if (format === 'NEZ' || format === 'ENZ' || format === 'XYZ') return 3;
  return 4;
}

export function detectFormat(rows: string[][]): PointFormat {
  const row = rows.find((fields) => fields.filter((field) => numeric(field) !== null).length >= 3);
  const n = row?.length ?? 0;
  if (n >= 5) return 'PNEZD';
  if (n === 4) return 'PNEZ';
  return 'NEZ';
}

function parseRow(fields: string[], format: PointFormat): SurveyPoint | null {
  const need = fieldCount(format);
  if (fields.length < need) return null;
  let number: string | undefined;
  let northing: number | null;
  let easting: number | null;
  let elevation: number | null;
  let descStart = need;

  switch (format) {
    case 'PNEZD':
    case 'PNEZ':
      number = fields[0];
      northing = numeric(fields[1]);
      easting = numeric(fields[2]);
      elevation = numeric(fields[3]);
      descStart = 4;
      break;
    case 'PENZD':
    case 'PENZ':
      number = fields[0];
      easting = numeric(fields[1]);
      northing = numeric(fields[2]);
      elevation = numeric(fields[3]);
      descStart = 4;
      break;
    case 'NEZ':
      northing = numeric(fields[0]);
      easting = numeric(fields[1]);
      elevation = numeric(fields[2]);
      descStart = 3;
      break;
    case 'ENZ':
    case 'XYZ':
      easting = numeric(fields[0]);
      northing = numeric(fields[1]);
      elevation = numeric(fields[2]);
      descStart = 3;
      break;
  }
  if (northing === null || easting === null || elevation === null) return null;
  const description = fields.slice(descStart).join(' ').trim();
  const point: SurveyPoint = { x: easting, y: northing, z: elevation, role: 'survey' };
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
    const point = parseRow(fields, format);
    if (!point) {
      skipped.push({ line: lineNo, text: source.slice(start, stop).trim(), reason: 'Could not read coordinates with the selected format' });
    } else points.push(point);
    lineNo += 1;
  }
  return { points, skipped, delimiter, format };
}

export function parsePointFile(
  text: string,
  options: { format?: FormatChoice; delimiter?: DelimiterChoice } = {},
): PointParseResult {
  let source = text;
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
  const delimiter =
    !options.delimiter || options.delimiter === 'auto' ? detectDelimiter(source) : options.delimiter;
  if (!source.includes('"')) {
    const format = !options.format || options.format === 'auto' ? detectFormat(prefixRows(source, delimiter)) : options.format;
    return scanPointFile(source, delimiter, format);
  }
  const rawLines = source.split(/\r?\n/);
  const rows: { line: number; fields: string[] }[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const trimmed = rawLines[i].trim();
    if (!trimmed || isComment(trimmed)) continue;
    rows.push({ line: i + 1, fields: splitLine(trimmed, delimiter) });
  }
  const format = !options.format || options.format === 'auto' ? detectFormat(rows.map((row) => row.fields)) : options.format;
  const points: SurveyPoint[] = [];
  const skipped: SkippedLine[] = [];
  for (const row of rows) {
    const point = parseRow(row.fields, format);
    if (!point) {
      skipped.push({
        line: row.line,
        text: rawLines[row.line - 1].trim(),
        reason: 'Could not read coordinates with the selected format',
      });
      continue;
    }
    points.push(point);
  }
  return { points, skipped, delimiter, format };
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
