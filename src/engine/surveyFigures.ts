import type { CogoPoint } from './cogo';
import type { FeatureLine, FeatureVertex } from './featureLine';

/**
 * Figure codes on a point description.
 * "EP1 B" begins EP1, "EP1" continues it, "EP1 E" ends it, "EP1 CLS" closes it.
 * Several figures can share a point: "EP1 B CW1".
 */

const COMMANDS = new Set(['B', 'BEGIN', 'E', 'END', 'C', 'CLS', 'CLOSE']);

export interface FigureCode {
  figure: string;
  command: 'begin' | 'continue' | 'end' | 'close';
}

function commandOf(token: string): FigureCode['command'] | null {
  const word = token.toUpperCase();
  if (word === 'B' || word === 'BEGIN') return 'begin';
  if (word === 'E' || word === 'END') return 'end';
  if (word === 'C' || word === 'CLS' || word === 'CLOSE') return 'close';
  return null;
}

export function parseFigureCodes(description: string): FigureCode[] {
  const tokens = description
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  const codes: FigureCode[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const asCommand = commandOf(token);
    if (asCommand) {
      const next = tokens[i + 1];
      if (next && !COMMANDS.has(next.toUpperCase())) {
        codes.push({ figure: next, command: asCommand });
        i += 1;
      }
      continue;
    }
    const next = tokens[i + 1];
    const nextCommand = next ? commandOf(next) : null;
    if (nextCommand) {
      codes.push({ figure: token, command: nextCommand });
      i += 1;
    } else {
      codes.push({ figure: token, command: 'continue' });
    }
  }
  return codes;
}

export function figuresFromPoints(points: CogoPoint[]): FeatureLine[] {
  const ordered = [...points].sort((a, b) => a.number - b.number || a.id.localeCompare(b.id));
  const open = new Map<string, FeatureVertex[]>();
  const finished: FeatureLine[] = [];
  const close = (name: string, vertices: FeatureVertex[], closed: boolean) => {
    if (vertices.length < 2) return;
    finished.push({
      id: `fig-${finished.length + 1}`,
      name,
      points: vertices.map((vertex) => ({ ...vertex })),
      closed,
    });
  };
  for (const point of ordered) {
    if (!point.description.trim()) continue;
    for (const code of parseFigureCodes(point.description)) {
      const vertex = { x: point.x, y: point.y, z: point.z };
      const current = open.get(code.figure);
      if (code.command === 'begin' || !current) {
        if (current) close(code.figure, current, false);
        open.set(code.figure, [vertex]);
        if (code.command === 'end' || code.command === 'close') {
          close(code.figure, [vertex], code.command === 'close');
          open.delete(code.figure);
        }
        continue;
      }
      current.push(vertex);
      if (code.command === 'end' || code.command === 'close') {
        close(code.figure, current, code.command === 'close');
        open.delete(code.figure);
      }
    }
  }
  for (const [name, vertices] of open) close(name, vertices, false);
  return finished;
}

/** Field book: PNEZD, "P,number,northing,easting,elevation,description", or "NEZ number northing easting elevation description". */
export function parseSurveyBook(text: string): { points: CogoPoint[]; warnings: string[] } {
  const points: CogoPoint[] = [];
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/);
  let auto = 1;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    if (/^point\s*,/i.test(line) && /north/i.test(line)) continue;
    const nez = line.match(/^NEZ\s+(\S+)\s+([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*(.*)$/i);
    if (nez) {
      const number = Number(nez[1]);
      points.push({
        id: `sv-${points.length + 1}`,
        number: Number.isFinite(number) ? number : auto++,
        y: Number(nez[2]),
        x: Number(nez[3]),
        z: Number(nez[4]),
        description: nez[5].trim(),
      });
      continue;
    }
    const parts = line.split(/[, \t]+/).filter((part) => part.length > 0);
    if (parts[0]?.toUpperCase() === 'P') parts.shift();
    if (parts.length < 4) {
      warnings.push(`Line ${index + 1} was skipped.`);
      continue;
    }
    const numeric = parts.slice(0, 4).map(Number);
    if (numeric.some((value) => !Number.isFinite(value))) {
      warnings.push(`Line ${index + 1} was skipped.`);
      continue;
    }
    const [number, northing, easting, elevation] = numeric;
    points.push({
      id: `sv-${points.length + 1}`,
      number,
      y: northing,
      x: easting,
      z: elevation,
      description: parts.slice(4).join(' '),
    });
  }
  return { points, warnings };
}
