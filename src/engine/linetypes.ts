/** Classic CAD linetype patterns. Positive is pen-down, negative is a gap, 0 is a dot. Values are drawing units. */

export interface LinetypeDef {
  name: string;
  description: string;
  pattern: number[];
}

export const LINETYPES: LinetypeDef[] = [
  { name: 'Continuous', description: 'Solid line', pattern: [] },
  { name: 'Dashed', description: 'Dashed __ __ __', pattern: [0.5, -0.25] },
  { name: 'Hidden', description: 'Hidden _ _ _ _', pattern: [0.25, -0.125] },
  { name: 'Center', description: 'Center ____ _ ____', pattern: [1.25, -0.25, 0.25, -0.25] },
  { name: 'Phantom', description: 'Phantom ____ _ _ ____', pattern: [1.25, -0.25, 0.25, -0.25, 0.25, -0.25] },
  { name: 'Dot', description: 'Dot . . . .', pattern: [0, -0.25] },
  { name: 'DashDot', description: 'Dash dot __ . __ .', pattern: [0.5, -0.25, 0, -0.25] },
  { name: 'Border', description: 'Border __ __ .', pattern: [0.5, -0.25, 0.5, -0.25, 0, -0.25] },
  { name: 'Divide', description: 'Divide __ . .', pattern: [0.5, -0.25, 0, -0.25, 0, -0.25] },
];

const BY_NAME = new Map(LINETYPES.map((entry) => [entry.name.toLowerCase(), entry]));

export function linetypeByName(name: string | undefined): LinetypeDef {
  return BY_NAME.get((name || 'Continuous').toLowerCase()) ?? LINETYPES[0];
}

/**
 * Dash array in screen pixels. Pattern lengths are drawing units times LTSCALE
 * times the entity scale, then converted with the view scale (pixels per unit).
 * A zero dash (dot) becomes a 1px mark.
 */
export function dashPixels(name: string | undefined, linetypeScale: number, entityScale: number, pixelsPerUnit: number): number[] {
  const pattern = linetypeByName(name).pattern;
  if (pattern.length === 0) return [];
  const scale = Math.max(0.0001, linetypeScale) * Math.max(0.0001, entityScale) * Math.max(pixelsPerUnit, 1e-9);
  return pattern.map((dash) => {
    if (dash === 0) return 1;
    return Math.max(1, Math.abs(dash) * scale);
  });
}

/** How many times the pattern restarts. Generation on continues along the polyline. */
export function linetypeRuns(segmentCount: number, generation: boolean): number {
  if (segmentCount <= 0) return 0;
  return generation ? 1 : segmentCount;
}
