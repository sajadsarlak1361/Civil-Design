/** Lineweights in hundredths of a millimetre. */

export const LINEWEIGHT_BYLAYER = -1;
export const LINEWEIGHT_BYBLOCK = -2;
export const LINEWEIGHT_DEFAULT = -3;

/** Standard list, excluding the sentinels. 0 is 0.00 mm. */
export const LINEWEIGHT_VALUES = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211] as const;

export type LwUnits = 'mm' | 'in';

export function lineweightMm(value: number): number {
  if (value === LINEWEIGHT_BYLAYER || value === LINEWEIGHT_BYBLOCK || value === LINEWEIGHT_DEFAULT || value < 0) return 0.25;
  return value / 100;
}

export function lineweightLabel(value: number, units: LwUnits = 'mm'): string {
  if (value === LINEWEIGHT_BYLAYER) return 'ByLayer';
  if (value === LINEWEIGHT_BYBLOCK) return 'ByBlock';
  if (value === LINEWEIGHT_DEFAULT) return 'Default';
  const mm = value / 100;
  if (units === 'in') return `${(mm / 25.4).toFixed(3)}"`;
  return `${mm.toFixed(2)} mm`;
}

/** Screen pixels at 96 dpi. Independent of zoom. LWDISPLAY off is a hairline. */
export function lineweightPx(value: number, display: boolean): number {
  if (!display) return 1;
  const mm = lineweightMm(value);
  return Math.max(1, (mm * 96) / 25.4);
}

export function parseLineweight(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (text === 'bylayer' || text === 'by layer') return LINEWEIGHT_BYLAYER;
  if (text === 'byblock' || text === 'by block') return LINEWEIGHT_BYBLOCK;
  if (text === 'default') return LINEWEIGHT_DEFAULT;
  const mm = Number(text.replace(/mm|in|"/g, ''));
  if (!Number.isFinite(mm) || mm < 0) return null;
  const hundredths = text.includes('in') || text.includes('"') ? Math.round(mm * 25.4 * 100) : Math.round(mm * 100);
  let best: number = LINEWEIGHT_VALUES[0];
  let score = Infinity;
  for (const value of LINEWEIGHT_VALUES) {
    const delta = Math.abs(value - hundredths);
    if (delta < score) {
      score = delta;
      best = value;
    }
  }
  return best;
}
