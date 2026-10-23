/**
 * Gravity pipe network.
 * Manning: Q = (k/n) A R^(2/3) S^(1/2). k is 1 in SI and 1.486 in US customary.
 * Partial flow uses the standard circular-section angle.
 */

export interface PipeStructure {
  id: string;
  name: string;
  x: number;
  y: number;
  rim: number;
}

export interface GravityPipe {
  id: string;
  name: string;
  fromId: string;
  toId: string;
  diameter: number;
  manningN: number;
  /** Rise/run. Positive falls from the start structure to the end structure. */
  slope?: number;
  invertFrom?: number;
  invertTo?: number;
  /** Design flow. */
  flow: number;
}

export interface GravityPipeResult {
  id: string;
  name: string;
  length: number;
  slope: number;
  invertFrom: number;
  invertTo: number;
  coverFrom: number;
  coverTo: number;
  capacityFull: number;
  capacityDesign: number;
  velocity: number;
  depthRatio: number;
  warnings: string[];
}

export function manningDischarge(diameter: number, slope: number, manningN: number, depthRatio: number, unit: 'm' | 'ft'): number {
  if (!(diameter > 0) || !(slope > 0) || !(manningN > 0) || !(depthRatio > 0)) return 0;
  const ratio = Math.min(1, depthRatio);
  const radius = diameter / 2;
  let area: number;
  let perimeter: number;
  if (ratio >= 0.999) {
    area = Math.PI * radius * radius;
    perimeter = 2 * Math.PI * radius;
  } else {
    const theta = 2 * Math.acos(1 - 2 * ratio);
    area = (radius * radius * (theta - Math.sin(theta))) / 2;
    perimeter = radius * theta;
  }
  if (!(perimeter > 0) || !(area > 0)) return 0;
  const hydraulic = area / perimeter;
  const k = unit === 'ft' ? 1.486 : 1;
  return ((k / manningN) * area * hydraulic ** (2 / 3) * Math.sqrt(slope));
}

export function solveGravityNetwork(input: {
  structures: PipeStructure[];
  pipes: GravityPipe[];
  unit: 'm' | 'ft';
  minCover: number;
  minSlope: number;
  designDepthRatio: number;
}): GravityPipeResult[] {
  const byId = new Map(input.structures.map((structure) => [structure.id, structure]));
  return input.pipes.map((pipe) => {
    const from = byId.get(pipe.fromId);
    const to = byId.get(pipe.toId);
    const warnings: string[] = [];
    if (!from || !to) {
      return {
        id: pipe.id,
        name: pipe.name,
        length: 0,
        slope: 0,
        invertFrom: 0,
        invertTo: 0,
        coverFrom: 0,
        coverTo: 0,
        capacityFull: 0,
        capacityDesign: 0,
        velocity: 0,
        depthRatio: 0,
        warnings: ['The pipe is missing a structure.'],
      };
    }
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    let invertFrom = pipe.invertFrom;
    let invertTo = pipe.invertTo;
    let slope = pipe.slope;
    if (invertFrom === undefined) invertFrom = from.rim - input.minCover - pipe.diameter;
    if (slope === undefined && invertTo !== undefined) slope = length > 1e-6 ? (invertFrom - invertTo) / length : 0;
    if (slope === undefined) slope = Math.max(input.minSlope, 0.005);
    if (invertTo === undefined) invertTo = invertFrom - slope * length;
    slope = length > 1e-6 ? (invertFrom - invertTo) / length : slope;
    const coverFrom = from.rim - (invertFrom + pipe.diameter);
    const coverTo = to.rim - (invertTo + pipe.diameter);
    const ratio = Math.min(1, Math.max(0.05, input.designDepthRatio));
    const falling = Math.max(slope, 0);
    const capacityFull = manningDischarge(pipe.diameter, falling, pipe.manningN, 1, input.unit);
    const capacityDesign = manningDischarge(pipe.diameter, falling, pipe.manningN, ratio, input.unit);
    const radius = pipe.diameter / 2;
    const theta = ratio >= 0.999 ? Math.PI * 2 : 2 * Math.acos(1 - 2 * ratio);
    const area = ratio >= 0.999 ? Math.PI * radius * radius : (radius * radius * (theta - Math.sin(theta))) / 2;
    const velocity = area > 0 ? pipe.flow / area : 0;
    if (coverFrom < input.minCover - 1e-6 || coverTo < input.minCover - 1e-6) warnings.push('Cover is below the minimum.');
    if (slope + 1e-9 < input.minSlope) warnings.push('Slope is below the minimum.');
    if (slope < 0) warnings.push('The pipe flows uphill.');
    if (pipe.flow > capacityDesign + 1e-8) warnings.push('Design flow exceeds the capacity at the design depth.');
    if (velocity > (input.unit === 'ft' ? 15 : 4.5)) warnings.push('Velocity is high.');
    return {
      id: pipe.id,
      name: pipe.name,
      length,
      slope,
      invertFrom,
      invertTo,
      coverFrom,
      coverTo,
      capacityFull,
      capacityDesign,
      velocity,
      depthRatio: ratio,
      warnings,
    };
  });
}
