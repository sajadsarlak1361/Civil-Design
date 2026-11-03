import { parseXyzCloud, pointsToText } from '../points';
import type { SurveyPoint } from '../types';

/** Leica PTS. A leading count is ignored. Extra intensity and RGB columns are ignored. */
export function readPts(text: string): SurveyPoint[] {
  return parseXyzCloud(text);
}

export function pointsToPts(points: SurveyPoint[]): string {
  return `${points.length}\n${pointsToText(points, 'XYZ', ' ')}\n`;
}

function numbers(line: string): number[] {
  return line.trim().split(/\s+/).filter(Boolean).map(Number);
}

/**
 * Leica PTX. Each scan is a column count, a row count, a sensor pose,
 * a 4×4 registration (one column per line), then the points.
 * A 0 0 0 return is an empty range and is skipped before the transform.
 */
export function readPtx(text: string): SurveyPoint[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith('#'));
  const points: SurveyPoint[] = [];
  let index = 0;
  while (index < lines.length) {
    const columns = Number(lines[index++]);
    const rows = Number(lines[index++]);
    if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 0 || rows < 0) {
      throw new Error('That PTX header is not a column and row count.');
    }
    if (index + 8 > lines.length) throw new Error('That PTX scan is missing its transform.');
    for (let line = 0; line < 4; line += 1) {
      const sensor = numbers(lines[index++]);
      if (sensor.length < 3 || sensor.slice(0, 3).some((value) => !Number.isFinite(value))) {
        throw new Error('That PTX sensor pose is incomplete.');
      }
    }
    const matrix: number[][] = [];
    for (let column = 0; column < 4; column += 1) {
      const values = numbers(lines[index++]);
      if (values.length < 4 || values.slice(0, 4).some((value) => !Number.isFinite(value))) {
        throw new Error('That PTX transform is incomplete.');
      }
      matrix.push(values);
    }
    const count = columns * rows;
    for (let point = 0; point < count && index < lines.length; point += 1) {
      const fields = numbers(lines[index++]);
      if (fields.length < 3 || fields.slice(0, 3).some((value) => !Number.isFinite(value))) continue;
      const x = fields[0];
      const y = fields[1];
      const z = fields[2];
      if (x === 0 && y === 0 && z === 0) continue;
      points.push({
        x: x * matrix[0][0] + y * matrix[1][0] + z * matrix[2][0] + matrix[3][0],
        y: x * matrix[0][1] + y * matrix[1][1] + z * matrix[2][1] + matrix[3][1],
        z: x * matrix[0][2] + y * matrix[1][2] + z * matrix[2][2] + matrix[3][2],
        number: String(points.length + 1),
        role: 'survey',
      });
    }
  }
  return points;
}
