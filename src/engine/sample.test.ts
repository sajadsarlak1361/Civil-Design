import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateContours } from './contours';
import { parsePointFile } from './points';
import { surfaceStats } from './stats';
import { buildTin } from './tin';
import { volumeReportCsv } from './project';
import { volumeTinToTin, volumeToDatum } from './volume';

function load(name: string): string {
  return readFileSync(join(process.cwd(), 'public', 'samples', name), 'utf8');
}

describe('bundled sample terrain', () => {
  it('builds a surface, contours, and a cut/fill report from the sample points', () => {
    const existing = parsePointFile(load('existing-ground-pnezd.csv'), { format: 'PNEZD' });
    const pad = parsePointFile(load('proposed-pad-pnezd.csv'), { format: 'PNEZD' });
    expect(existing.points.length).toBeGreaterThan(400);
    expect(pad.points.length).toBeGreaterThan(80);
    expect(existing.points.every((point) => point.description?.includes('SAMPLE'))).toBe(true);
    expect(pad.points.every((point) => point.description?.includes('SAMPLE'))).toBe(true);

    const eg = buildTin(existing.points);
    const fg = buildTin(pad.points);
    const egStats = surfaceStats(eg.points, eg.triangles);
    expect(eg.triangles.length).toBeGreaterThan(400);
    expect(egStats.area2D).toBeGreaterThan(25000);
    expect(egStats.maxZ).toBeGreaterThan(egStats.minZ + 5);

    const contours = generateContours(eg.points, eg.triangles, 1, 5);
    expect(contours.length).toBeGreaterThan(8);
    expect(contours.some((line) => line.major)).toBe(true);

    const datum = volumeToDatum(eg.points, eg.triangles, egStats.minZ);
    expect(datum.cut).toBeGreaterThan(1000);

    const earthwork = volumeTinToTin(eg.points, eg.triangles, fg.points, fg.triangles);
    expect(earthwork.cut).toBeGreaterThan(10);
    expect(earthwork.fill).toBeGreaterThan(10);
    const csv = volumeReportCsv({
      project: 'Sample site',
      unit: 'm',
      baseName: 'Existing Ground',
      comparisonName: 'Proposed Pad',
      method: 'TIN-to-TIN composite',
      cut: earthwork.cut,
      fill: earthwork.fill,
      net: earthwork.net,
      cutArea: earthwork.cutArea,
      fillArea: earthwork.fillArea,
    });
    expect(csv).toContain('TIN-to-TIN composite');
    expect(csv).toContain(String(earthwork.cut));
  });
});
