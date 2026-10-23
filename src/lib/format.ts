import type { LinearUnit } from '../engine';

export function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatElevation(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-6) {
    return Math.round(rounded).toLocaleString('en-US');
  }
  return rounded.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatSlope(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return '—';
  return `${formatNumber(ratio * 100, 1)}%`;
}

export function unitLabels(unit: LinearUnit): { linear: string; area: string; volume: string; yards: string | null } {
  if (unit === 'ft') return { linear: 'ft', area: 'ft²', volume: 'ft³', yards: 'yd³' };
  return { linear: 'm', area: 'm²', volume: 'm³', yards: null };
}

export function fileSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'surface';
}
