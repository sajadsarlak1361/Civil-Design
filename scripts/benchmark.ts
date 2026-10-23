/**
 * Large-terrain timings. Not part of `npm test`.
 * Run: npm run benchmark
 *
 * The plane checks are analytical. A regular grid with z = 2x + 0.5y must
 * interpolate exactly, and a unit-height TIN-to-TIN composite must equal the plan area.
 */
import { bvhFor } from '../src/engine/bvh';
import { generateContours } from '../src/engine/contours';
import { TriangleIndex, buildTin, elevationAt, type Tin } from '../src/engine/tin';
import { volumeTinToTin } from '../src/engine/volume';
import type { SurveyPoint } from '../src/engine/types';

function grid(cols: number, rows: number, zAt: (x: number, y: number) => number): SurveyPoint[] {
  const points: SurveyPoint[] = new Array(cols * rows);
  let n = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) points[n++] = { x, y, z: zAt(x, y) };
  }
  return points;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function plane(x: number, y: number): number {
  return 2 * x + 0.5 * y;
}

function report(label: string, value: string | number): void {
  console.log(`${label}\t${value}`);
}

function time<T>(label: string, run: () => T): T {
  const start = performance.now();
  const value = run();
  report(label, (performance.now() - start).toFixed(1));
  return value;
}

const probeX = 10.25;
const probeY = 20.5;
const probeZ = plane(probeX, probeY);

const small = buildTin(grid(40, 40, plane));
const smallBvh = bvhFor(small.points, small.triangles);
const smallZ = elevationAt(small.points, small.triangles, probeX, probeY, smallBvh);
report('plane_40x40_elevation_error', smallZ === null ? 'null' : Math.abs(smallZ - probeZ).toExponential(3));

const smallBase = buildTin(grid(40, 40, () => 0));
const smallTop = buildTin(grid(40, 40, () => 1));
const smallVolume = volumeTinToTin(smallBase.points, smallBase.triangles, smallTop.points, smallTop.triangles);
report('plane_40x40_volume_error', Math.abs(smallVolume.fill - 39 * 39).toExponential(3));
report('plane_40x40_cut', smallVolume.cut.toExponential(3));

let million: Tin | null = time('triangulate_1000x1000_ms', () => buildTin(grid(1000, 1000, plane)));
report('triangulate_1000x1000_points', million.points.length);
report('triangulate_1000x1000_triangles', million.triangles.length);
const millionBvh = time('bvh_build_1000x1000_ms', () => bvhFor(million!.points, million!.triangles));
const millionZ = elevationAt(million.points, million.triangles, probeX, probeY, millionBvh);
report('plane_1000x1000_elevation_error', millionZ === null ? 'null' : Math.abs(millionZ - probeZ).toExponential(3));

const contours = time('contours_1000x1000_ms', () => generateContours(million.points, million.triangles, 500, 1000, false));
report('contours_1000x1000_polylines', contours.length);

const queries = 100_000;
const random = mulberry32(20261022);
const samples: { x: number; y: number }[] = new Array(queries);
for (let i = 0; i < queries; i++) samples[i] = { x: 1 + random() * 997, y: 1 + random() * 997 };

time('bvh_queries_100000_ms', () => {
  for (const sample of samples) elevationAt(million!.points, million!.triangles, sample.x, sample.y, millionBvh);
});

const gridIndex = time('grid_index_build_1000x1000_ms', () => new TriangleIndex(million.points, million.triangles));
let mismatches = 0;
let maxMiss = 0;
time('grid_queries_100000_ms', () => {
  for (const sample of samples) {
    const a = elevationAt(million!.points, million!.triangles, sample.x, sample.y, millionBvh);
    const b = elevationAt(million!.points, million!.triangles, sample.x, sample.y, gridIndex);
    if (a === null || b === null || Math.abs(a - b) > 1e-6) {
      mismatches += 1;
      maxMiss = Math.max(maxMiss, a === null || b === null ? 1 : Math.abs(a - b));
    }
  }
});
report('query_mismatches', mismatches);
report('query_max_abs_diff', maxMiss.toExponential(3));

million = null;

const side = 500;
const basePoints = grid(side, side, () => 0);
const topPoints = grid(side, side, () => 1);
const baseTin = time('triangulate_500x500_base_ms', () => buildTin(basePoints));
const topTin = time('triangulate_500x500_comparison_ms', () => buildTin(topPoints));
const volume = time('volume_tin_to_tin_500x500_ms', () => volumeTinToTin(baseTin.points, baseTin.triangles, topTin.points, topTin.triangles));
const expected = (side - 1) * (side - 1);
report('volume_500x500_points_each', side * side);
report('volume_500x500_fill', volume.fill.toFixed(6));
report('volume_500x500_cut', volume.cut.toExponential(3));
report('volume_500x500_expected_fill', expected);
report('volume_500x500_fill_error', Math.abs(volume.fill - expected).toExponential(3));
