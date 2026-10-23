import type { SolvedAlignment } from './alignment';

/**
 * AASHTO high-speed side friction. f = 0.24 − 0.002·mph passes through the
 * Green Book Table 3-7 values cited by FHWA-HRT-17-098: 0.14 at 50 mph,
 * 0.13 at 55 mph, 0.10 at 70 mph, and the 0.07 value the Green Book gives
 * for 85 mph. Speeds are clamped to that 15–85 mph range.
 */
export function aashtoSideFriction(speedKmh: number): number {
  const mph = Math.min(85, Math.max(15, speedKmh / 1.609344));
  return 0.24 - 0.002 * mph;
}

/** AASHTO maximum relative gradient, as a decimal (0.005 is 0.50%). */
const RELATIVE_GRADIENT: { mph: number; percent: number }[] = [
  { mph: 15, percent: 0.78 },
  { mph: 20, percent: 0.74 },
  { mph: 25, percent: 0.7 },
  { mph: 30, percent: 0.66 },
  { mph: 35, percent: 0.62 },
  { mph: 40, percent: 0.58 },
  { mph: 45, percent: 0.54 },
  { mph: 50, percent: 0.5 },
  { mph: 55, percent: 0.47 },
  { mph: 60, percent: 0.45 },
  { mph: 65, percent: 0.43 },
  { mph: 70, percent: 0.4 },
  { mph: 75, percent: 0.38 },
  { mph: 80, percent: 0.35 },
];

export function maximumRelativeGradient(speedKmh: number): number {
  const mph = speedKmh / 1.609344;
  if (mph <= RELATIVE_GRADIENT[0].mph) return RELATIVE_GRADIENT[0].percent / 100;
  const last = RELATIVE_GRADIENT[RELATIVE_GRADIENT.length - 1];
  if (mph >= last.mph) return last.percent / 100;
  for (let i = 1; i < RELATIVE_GRADIENT.length; i++) {
    const b = RELATIVE_GRADIENT[i];
    const a = RELATIVE_GRADIENT[i - 1];
    if (mph > b.mph) continue;
    const t = (mph - a.mph) / (b.mph - a.mph);
    return (a.percent + (b.percent - a.percent) * t) / 100;
  }
  return last.percent / 100;
}

/** Equilibrium superelevation, clamped to emax. Values are decimals, not percent. */
export function superelevationRate(speedKmh: number, radius: number, emax: number, friction = aashtoSideFriction(speedKmh)): number {
  if (!(radius > 0) || !(speedKmh > 0)) return 0;
  const demand = (speedKmh * speedKmh) / (127 * radius);
  return Math.min(Math.max(emax, 0), Math.max(0, demand - friction));
}

export interface SuperelevationStation {
  station: number;
  /** dz/dOffset. Positive slopes up to the right. */
  leftSlope: number;
  rightSlope: number;
  label: string;
}

export interface SuperelevationCurve {
  start: number;
  end: number;
  radius: number;
  turn: 'left' | 'right';
  rate: number;
  runoff: number;
  runout: number;
}

export function superelevationDiagram(input: {
  solved: SolvedAlignment;
  startStation: number;
  designSpeedKmh: number;
  emax: number;
  laneWidth: number;
  normalCrown: number;
}): { stations: SuperelevationStation[]; curves: SuperelevationCurve[]; warnings: string[] } {
  const crown = Math.abs(input.normalCrown);
  const warnings: string[] = [];
  const curves: SuperelevationCurve[] = [];
  const stations: SuperelevationStation[] = [];
  const entities = input.solved.entities;
  for (let index = 0; index < entities.length; index++) {
    const entity = entities[index];
    if (entity.kind !== 'arc') continue;
    const entry = entities[index - 1];
    const exit = entities[index + 1];
    const entrySpiral = entry?.kind === 'spiral' ? entry.length : 0;
    const exitSpiral = exit?.kind === 'spiral' ? exit.length : 0;
    const rate = superelevationRate(input.designSpeedKmh, entity.radius, input.emax);
    const curveStart = input.startStation + (entrySpiral > 0 && entry ? entry.start : entity.start);
    const curveEnd = input.startStation + (exitSpiral > 0 && exit ? exit.start + exit.length : entity.start + entity.length);
    const arcStart = input.startStation + entity.start;
    const arcEnd = input.startStation + entity.start + entity.length;
    if (rate <= crown + 1e-6) {
      curves.push({ start: arcStart, end: arcEnd, radius: entity.radius, turn: entity.turn, rate, runoff: 0, runout: 0 });
      continue;
    }
    const delta = maximumRelativeGradient(input.designSpeedKmh);
    const computedRunoff = delta > 1e-8 ? (input.laneWidth * rate) / delta : 0;
    const runoff = entrySpiral > 0 ? entrySpiral : computedRunoff;
    const exitRunoff = exitSpiral > 0 ? exitSpiral : computedRunoff;
    const runout = delta > 1e-8 ? (input.laneWidth * crown) / delta : 0;
    curves.push({ start: arcStart, end: arcEnd, radius: entity.radius, turn: entity.turn, rate, runoff, runout });
    const tangentFraction = entrySpiral > 0 ? 1 : 2 / 3;
    const fullStart = entrySpiral > 0 ? arcStart : curveStart + (1 - tangentFraction) * runoff;
    const fullEnd = exitSpiral > 0 ? arcEnd : curveEnd - (1 - tangentFraction) * exitRunoff;
    if (fullStart >= fullEnd - 0.5) warnings.push(`The curve at station ${arcStart.toFixed(1)} is shorter than the superelevation runoff.`);
    const sign = entity.turn === 'left' ? 1 : -1;
    const normal = () => ({ left: crown, right: -crown });
    const adverseRemoved = () => (sign > 0 ? { left: crown, right: crown } : { left: -crown, right: -crown });
    const full = () => ({ left: sign * rate, right: sign * rate });
    const runoffStart = fullStart - runoff;
    const runoutStart = runoffStart - runout;
    const levelExit = fullEnd + exitRunoff;
    const normalExit = levelExit + runout;
    const add = (station: number, slopes: { left: number; right: number }, label: string) => {
      stations.push({ station, leftSlope: slopes.left, rightSlope: slopes.right, label });
    };
    add(runoutStart, normal(), 'Normal crown');
    add(runoffStart, adverseRemoved(), 'Adverse crown removed');
    add(Math.min(fullStart, fullEnd), full(), 'Full super');
    add(Math.max(fullStart, fullEnd), full(), 'Full super ends');
    add(levelExit, adverseRemoved(), 'Runoff ends');
    add(normalExit, normal(), 'Normal crown');
  }
  stations.sort((a, b) => a.station - b.station);
  const deduped: SuperelevationStation[] = [];
  for (const station of stations) {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(last.station - station.station) < 1e-3) deduped[deduped.length - 1] = station;
    else deduped.push(station);
  }
  return { stations: deduped, curves, warnings };
}

export function slopesAtStation(
  stations: SuperelevationStation[],
  station: number,
  normalCrown: number,
): { left: number; right: number } {
  const crown = Math.abs(normalCrown);
  if (stations.length === 0) return { left: crown, right: -crown };
  if (station <= stations[0].station) return { left: stations[0].leftSlope, right: stations[0].rightSlope };
  const last = stations[stations.length - 1];
  if (station >= last.station) return { left: last.leftSlope, right: last.rightSlope };
  for (let i = 1; i < stations.length; i++) {
    if (station > stations[i].station) continue;
    const span = stations[i].station - stations[i - 1].station;
    const t = span <= 1e-12 ? 0 : (station - stations[i - 1].station) / span;
    return {
      left: stations[i - 1].leftSlope + (stations[i].leftSlope - stations[i - 1].leftSlope) * t,
      right: stations[i - 1].rightSlope + (stations[i].rightSlope - stations[i - 1].rightSlope) * t,
    };
  }
  return { left: crown, right: -crown };
}
