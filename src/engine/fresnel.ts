/**
 * Fresnel integrals used by Euler spirals (clothoids):
 * C(x) = ∫ cos(π t² / 2) dt from 0 to x
 * S(x) = ∫ sin(π t² / 2) dt from 0 to x
 * Small arguments use the power series. Larger arguments use Gauss–Legendre
 * panels, which stay accurate once the integrand starts to oscillate.
 */

const SERIES_LIMIT = 1.6;

const GL_X = [
  -0.9602898564975363, -0.7966664774136267, -0.525532409916329, -0.1834346424956498, 0.1834346424956498, 0.525532409916329,
  0.7966664774136267, 0.9602898564975363,
];
const GL_W = [
  0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.362683783378362, 0.362683783378362, 0.3137066458778873, 0.2223810344533745,
  0.1012285362903763,
];

export interface Fresnel {
  C: number;
  S: number;
}

export function fresnel(x: number): Fresnel {
  if (!Number.isFinite(x) || x === 0) return { C: 0, S: 0 };
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const value = ax <= SERIES_LIMIT ? fresnelSeries(ax) : fresnelQuadrature(ax);
  return { C: sign * value.C, S: sign * value.S };
}

/**
 * Clothoid point at arc length `distance` along a spiral that runs from
 * curvature 0 to 1/radius over `length`. Local x is the starting tangent.
 * Local y is to the left. The parameter length is the arc length.
 */
export function clothoidLocal(
  radius: number,
  length: number,
  distance: number,
): { x: number; y: number; tx: number; ty: number; theta: number } {
  if (!(radius > 0) || !(length > 0)) return { x: 0, y: 0, tx: 1, ty: 0, theta: 0 };
  const l = Math.min(Math.max(distance, 0), length);
  const scale = Math.sqrt(radius * length * Math.PI);
  const { C, S } = fresnel(l / scale);
  const theta = (l * l) / (2 * radius * length);
  return { x: scale * C, y: scale * S, tx: Math.cos(theta), ty: Math.sin(theta), theta };
}

/** Shift of the circular arc (p, k) for a clothoid of this radius and length. */
export function spiralOffsets(radius: number, length: number): { x: number; y: number; theta: number; p: number; k: number } {
  if (!(radius > 0) || !(length > 0)) return { x: 0, y: 0, theta: 0, p: 0, k: 0 };
  const end = clothoidLocal(radius, length, length);
  return {
    x: end.x,
    y: end.y,
    theta: end.theta,
    p: end.y - radius * (1 - Math.cos(end.theta)),
    k: end.x - radius * Math.sin(end.theta),
  };
}

function fresnelSeries(x: number): Fresnel {
  const p2 = (Math.PI / 2) * (Math.PI / 2);
  const x4 = x * x * x * x;
  let cTerm = x;
  let sTerm = (Math.PI / 2) * x * x * x / 3;
  let C = cTerm;
  let S = sTerm;
  for (let n = 0; n < 24; n++) {
    cTerm *= (-p2 * x4 * (4 * n + 1)) / ((2 * n + 1) * (2 * n + 2) * (4 * n + 5));
    sTerm *= (-p2 * x4 * (4 * n + 3)) / ((2 * n + 2) * (2 * n + 3) * (4 * n + 7));
    C += cTerm;
    S += sTerm;
    if (Math.abs(cTerm) < 1e-16 && Math.abs(sTerm) < 1e-16) break;
  }
  return { C, S };
}

function fresnelQuadrature(x: number): Fresnel {
  const panels = Math.max(1, Math.ceil(x / 0.2));
  const width = x / panels;
  let C = 0;
  let S = 0;
  for (let panel = 0; panel < panels; panel++) {
    const mid = (panel + 0.5) * width;
    const half = width / 2;
    for (let k = 0; k < GL_X.length; k++) {
      const t = mid + half * GL_X[k];
      const phase = (Math.PI / 2) * t * t;
      const weight = half * GL_W[k];
      C += Math.cos(phase) * weight;
      S += Math.sin(phase) * weight;
    }
  }
  return { C, S };
}
