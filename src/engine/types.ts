/** Project linear unit. Coordinates are stored as-is; this is a label, not a conversion. */
export type LinearUnit = 'm' | 'ft';

export interface Vec2 {
  x: number;
  y: number;
}

export interface SurveyPoint {
  /** Easting */
  x: number;
  /** Northing */
  y: number;
  /** Elevation */
  z: number;
  number?: string;
  description?: string;
  /** survey = imported point; boundary/breakline vertices are added by the TIN builder. */
  role?: 'survey' | 'boundary' | 'breakline';
}

/** CCW vertex indices into a surface point array. */
export type Triangle = [number, number, number];

export interface SurfaceStyle {
  color: string;
  opacity: number;
  showPoints: boolean;
  showTriangles: boolean;
  showContours: boolean;
  showElevation: boolean;
  showSlope: boolean;
  contourLabels: boolean;
  minorInterval: number;
  majorInterval: number;
  minorColor: string;
  majorColor: string;
}

export interface ContourPolyline {
  elevation: number;
  major: boolean;
  closed: boolean;
  points: { x: number; y: number; z: number }[];
}

export interface VolumeRegion {
  ring: Vec2[];
  /** Average signed depth, comparison minus base. Positive is fill. */
  depth: number;
  kind: 'cut' | 'fill';
  area: number;
  /** Absolute volume of this piece. */
  volume: number;
}

export interface VolumeResult {
  method: 'tin-to-tin' | 'surface-to-datum';
  cut: number;
  fill: number;
  /** fill − cut. Positive is net fill. */
  net: number;
  cutArea: number;
  fillArea: number;
  regions: VolumeRegion[];
}

export interface SurfaceStats {
  pointCount: number;
  triangleCount: number;
  minZ: number;
  maxZ: number;
  meanZ: number;
  area2D: number;
  area3D: number;
  /** Rise/run. 0 is flat. */
  minSlope: number;
  maxSlope: number;
  meanSlope: number;
}

export const SURFACE_PALETTE = ['#d5dbe6', '#e3a23a', '#79b8ff', '#8fd0b3', '#e39bb4', '#d2b48c'];

export function defaultSurfaceStyle(index = 0): SurfaceStyle {
  return {
    color: SURFACE_PALETTE[index % SURFACE_PALETTE.length],
    opacity: 1,
    showPoints: false,
    showTriangles: false,
    showContours: true,
    showElevation: index === 0,
    showSlope: false,
    contourLabels: true,
    minorInterval: 1,
    majorInterval: 5,
    minorColor: index === 0 ? '#7dbeb8' : '#8eb7ff',
    majorColor: index === 0 ? '#f0d78c' : '#ffb25e',
  };
}

/** A 3D mesh has no contours and no slope bands. Overhangs make both meaningless. */
export function defaultMeshStyle(index = 0): SurfaceStyle {
  return {
    ...defaultSurfaceStyle(index),
    showContours: false,
    showSlope: false,
    showElevation: true,
    showTriangles: false,
    contourLabels: false,
    opacity: 1,
  };
}
