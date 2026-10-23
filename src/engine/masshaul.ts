/**
 * Mass haul from average-end-area volumes.
 * Cut is positive and fill is negative on the diagram.
 * A free-haul chord is the horizontal line whose length equals the free-haul
 * distance. Volume above that chord (toward the peak) is overhaul.
 */

export interface EndAreaSample {
  station: number;
  /** Section area of cut. */
  cut: number;
  /** Section area of fill. */
  fill: number;
}

export interface MassHaulIncrement {
  from: number;
  to: number;
  cut: number;
  fill: number;
}

export interface MassHaulLobe {
  start: number;
  end: number;
  peak: number;
  peakStation: number;
  /** Ordinate of the free-haul chord. Same sign as the peak. */
  chord: number;
  overhaul: number;
  balanced: boolean;
}

export interface MassHaulResult {
  increments: MassHaulIncrement[];
  stations: number[];
  cumulative: number[];
  totalCut: number;
  totalFill: number;
  balanceStations: number[];
  lobes: MassHaulLobe[];
  freeHaulDistance: number;
  unbalanced: number;
}

export function averageEndAreas(samples: EndAreaSample[]): MassHaulIncrement[] {
  const ordered = [...samples].filter((sample) => Number.isFinite(sample.station)).sort((a, b) => a.station - b.station);
  const increments: MassHaulIncrement[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i];
    const b = ordered[i + 1];
    const length = b.station - a.station;
    if (length <= 1e-9) continue;
    increments.push({
      from: a.station,
      to: b.station,
      cut: ((Math.max(0, a.cut) + Math.max(0, b.cut)) / 2) * length,
      fill: ((Math.max(0, a.fill) + Math.max(0, b.fill)) / 2) * length,
    });
  }
  return increments;
}

function ordinateAt(stations: number[], cumulative: number[], station: number): number {
  if (stations.length === 0) return 0;
  if (station <= stations[0]) return cumulative[0];
  const last = stations.length - 1;
  if (station >= stations[last]) return cumulative[last];
  for (let i = 1; i < stations.length; i++) {
    if (station > stations[i]) continue;
    const span = stations[i] - stations[i - 1];
    const t = span <= 1e-12 ? 0 : (station - stations[i - 1]) / span;
    return cumulative[i - 1] + (cumulative[i] - cumulative[i - 1]) * t;
  }
  return cumulative[last];
}

function chordOfLength(stations: number[], cumulative: number[], start: number, end: number, peak: number, freeHaul: number): number {
  const sign = Math.sign(peak) || 1;
  const height = Math.abs(peak);
  const widthAt = (level: number) => {
    const y = sign * level;
    let left = -1;
    let right = -1;
    for (let i = 1; i < stations.length; i++) {
      if (stations[i] < start - 1e-6 || stations[i - 1] > end + 1e-6) continue;
      const y0 = cumulative[i - 1];
      const y1 = cumulative[i];
      const crosses = (y0 - y) * (y1 - y) <= 0 && Math.abs(y1 - y0) > 1e-12;
      const touches = Math.abs(y0 - y) <= 1e-8 || Math.abs(y1 - y) <= 1e-8;
      if (!crosses && !touches) continue;
      const t = Math.abs(y1 - y0) <= 1e-12 ? 0 : (y - y0) / (y1 - y0);
      const station = stations[i - 1] + (stations[i] - stations[i - 1]) * Math.min(1, Math.max(0, t));
      if (left < 0) left = station;
      right = station;
    }
    if (left < 0 || right < 0) return 0;
    return Math.max(0, right - left);
  };
  const full = end - start;
  if (full <= freeHaul + 1e-6) return 0;
  let lo = 0;
  let hi = height;
  for (let iteration = 0; iteration < 40; iteration++) {
    const mid = (lo + hi) / 2;
    if (widthAt(mid) > freeHaul) lo = mid;
    else hi = mid;
  }
  return sign * ((lo + hi) / 2);
}

export function massHaul(samples: EndAreaSample[], freeHaulDistance: number): MassHaulResult {
  const increments = averageEndAreas(samples);
  const ordered = [...samples].filter((sample) => Number.isFinite(sample.station)).sort((a, b) => a.station - b.station);
  const stations = ordered.map((sample) => sample.station);
  const cumulative: number[] = stations.map(() => 0);
  let cursor = 0;
  let totalCut = 0;
  let totalFill = 0;
  for (const increment of increments) {
    totalCut += increment.cut;
    totalFill += increment.fill;
    cursor += increment.cut - increment.fill;
    const index = stations.findIndex((station) => Math.abs(station - increment.to) <= 1e-6);
    if (index >= 0) cumulative[index] = cursor;
  }
  for (let i = 1; i < cumulative.length; i++) {
    if (cumulative[i] === 0 && stations[i] !== stations[0]) {
      const previous = increments.find((increment) => Math.abs(increment.to - stations[i]) <= 1e-6);
      if (!previous) cumulative[i] = cumulative[i - 1];
    }
  }
  const balanceStations: number[] = [];
  for (let i = 1; i < stations.length; i++) {
    const y0 = cumulative[i - 1];
    const y1 = cumulative[i];
    if (Math.abs(y0) <= 1e-6) {
      if (balanceStations.length === 0 || Math.abs(balanceStations[balanceStations.length - 1] - stations[i - 1]) > 1e-4) balanceStations.push(stations[i - 1]);
    }
    if (y0 * y1 < 0) {
      const t = y0 / (y0 - y1);
      balanceStations.push(stations[i - 1] + (stations[i] - stations[i - 1]) * t);
    }
  }
  if (stations.length > 0 && Math.abs(cumulative[cumulative.length - 1]) <= 1e-4) balanceStations.push(stations[stations.length - 1]);

  const lobes: MassHaulLobe[] = [];
  const marks = balanceStations.length > 0 ? balanceStations : stations.length > 0 ? [stations[0]] : [];
  for (let i = 0; i < marks.length - 1; i++) {
    const start = marks[i];
    const end = marks[i + 1];
    let peak = 0;
    let peakStation = start;
    for (let s = 0; s < stations.length; s++) {
      if (stations[s] < start - 1e-6 || stations[s] > end + 1e-6) continue;
      if (Math.abs(cumulative[s]) > Math.abs(peak)) {
        peak = cumulative[s];
        peakStation = stations[s];
      }
    }
    const mid = ordinateAt(stations, cumulative, (start + end) / 2);
    if (Math.abs(mid) > Math.abs(peak)) {
      peak = mid;
      peakStation = (start + end) / 2;
    }
    if (Math.abs(peak) <= 1e-6) continue;
    const chord = chordOfLength(stations, cumulative, start, end, peak, Math.max(0, freeHaulDistance));
    lobes.push({
      start,
      end,
      peak,
      peakStation,
      chord,
      overhaul: Math.max(0, Math.abs(peak) - Math.abs(chord)),
      balanced: true,
    });
  }
  const unbalanced = stations.length > 0 ? cumulative[cumulative.length - 1] : 0;
  return {
    increments,
    stations,
    cumulative,
    totalCut,
    totalFill,
    balanceStations,
    lobes,
    freeHaulDistance: Math.max(0, freeHaulDistance),
    unbalanced,
  };
}
