/**
 * Symmetric parabolic vertical curves.
 * Grade is rise/run. Curve length is centered on the PVI.
 * Elevation at distance x from the PVC:
 * y = yPVC + g1 x + ((g2 − g1) / L) x² / 2
 */

export interface VerticalPvi {
  station: number;
  elevation: number;
  /** Parabolic curve length. Zero is a grade break. Ignored on the first and last PVI. */
  curveLength: number;
}

export interface ProfileSamplePoint {
  station: number;
  elevation: number;
}

interface GradeRun {
  startStation: number;
  endStation: number;
  startElevation: number;
  grade: number;
}

interface CurveSpan {
  start: number;
  end: number;
  pvcElevation: number;
  g1: number;
  rate: number;
}

export function elevationOnProfile(pvis: VerticalPvi[], station: number): number | null {
  const solved = solveVertical(pvis);
  if (!solved) return null;
  if (station <= solved.start + 1e-9) return solved.startElevation + solved.grades[0].grade * (station - solved.start);
  if (station >= solved.end - 1e-9) {
    const last = solved.grades[solved.grades.length - 1];
    return last.startElevation + last.grade * (station - last.startStation);
  }
  for (const curve of solved.curves) {
    if (station < curve.start - 1e-9 || station > curve.end + 1e-9) continue;
    const x = station - curve.start;
    return curve.pvcElevation + curve.g1 * x + (curve.rate * x * x) / 2;
  }
  for (const run of solved.grades) {
    if (station < run.startStation - 1e-8 || station > run.endStation + 1e-8) continue;
    return run.startElevation + run.grade * (station - run.startStation);
  }
  return null;
}

export function sampleDesignProfile(pvis: VerticalPvi[], startStation: number, length: number, interval: number): ProfileSamplePoint[] {
  if (!(length > 0)) return [];
  const end = startStation + length;
  const step = interval > 1e-6 ? interval : length;
  const samples: ProfileSamplePoint[] = [];
  for (let station = startStation; station <= end + 1e-6; station += step) {
    const at = Math.min(station, end);
    const elevation = elevationOnProfile(pvis, at);
    if (elevation !== null) samples.push({ station: at, elevation });
    if (at >= end - 1e-6) break;
    if (samples.length > 10000) break;
  }
  return samples;
}

/** Station of the high or low point, if it falls inside the curve. */
export function verticalExtremum(pvis: VerticalPvi[], pviIndex: number): { station: number; elevation: number } | null {
  const sorted = normalize(pvis);
  if (pviIndex <= 0 || pviIndex >= sorted.length - 1) return null;
  const solved = solveVertical(sorted);
  const curve = solved?.curves[pviIndex - 1];
  if (!curve || Math.abs(curve.rate) < 1e-12) return null;
  const x = -curve.g1 / curve.rate;
  if (x < -1e-6 || x > curve.end - curve.start + 1e-6) return null;
  const station = curve.start + x;
  return { station, elevation: curve.pvcElevation + curve.g1 * x + (curve.rate * x * x) / 2 };
}

function solveVertical(pvis: VerticalPvi[]): { start: number; end: number; startElevation: number; grades: GradeRun[]; curves: CurveSpan[] } | null {
  const sorted = normalize(pvis);
  if (sorted.length < 2) return null;
  const grades: GradeRun[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const run = b.station - a.station;
    grades.push({
      startStation: a.station,
      endStation: b.station,
      startElevation: a.elevation,
      grade: run === 0 ? 0 : (b.elevation - a.elevation) / run,
    });
  }
  const curves: CurveSpan[] = [];
  for (let i = 1; i < sorted.length - 1; i++) {
    const incoming = grades[i - 1];
    const outgoing = grades[i];
    const available = Math.min(incoming.endStation - incoming.startStation, outgoing.endStation - outgoing.startStation);
    let length = sorted[i].curveLength;
    if (!(length > 0)) continue;
    length = Math.min(length, available * 0.98);
    if (!(length > 1e-6)) continue;
    const g1 = incoming.grade;
    const g2 = outgoing.grade;
    const pvc = sorted[i].station - length / 2;
    curves.push({
      start: pvc,
      end: pvc + length,
      pvcElevation: sorted[i].elevation - g1 * (length / 2),
      g1,
      rate: (g2 - g1) / length,
    });
  }
  return { start: sorted[0].station, end: sorted[sorted.length - 1].station, startElevation: sorted[0].elevation, grades, curves };
}

function normalize(pvis: VerticalPvi[]): VerticalPvi[] {
  return pvis
    .filter((pvi) => Number.isFinite(pvi.station) && Number.isFinite(pvi.elevation))
    .map((pvi) => ({
      station: pvi.station,
      elevation: pvi.elevation,
      curveLength: Number.isFinite(pvi.curveLength) ? Math.max(0, pvi.curveLength) : 0,
    }))
    .sort((a, b) => a.station - b.station);
}
