/** Drafting entities beyond line, polyline, circle, arc, point, and text. */

import type { EntityStyle } from './entityStyle';

export interface Xyz {
  x: number;
  y: number;
  z: number;
}

export interface BulgeVertex extends Xyz {
  bulge: number;
}

export interface ShapeStyle extends EntityStyle {
  id: string;
  layer: string;
  color: string;
  lineType?: string;
  lineWeight?: number | 'bylayer';
}

export interface DrawEllipse extends ShapeStyle {
  type: 'ellipse';
  center: Xyz;
  /** Vector from the center to the end of the major axis. */
  major: Xyz;
  /** Minor axis length divided by the major axis length. */
  ratio: number;
  start: number;
  end: number;
}

export interface DrawSpline extends ShapeStyle {
  type: 'spline';
  mode: 'fit' | 'cv';
  points: Xyz[];
  closed: boolean;
  degree: number;
}

export interface DrawHatch extends ShapeStyle {
  type: 'hatch';
  pattern: string;
  scale: number;
  angle: number;
  associative: boolean;
  gradient: { kind: 'linear' | 'cylinder' | 'spherical' | 'curved'; color1: string; color2: string; invert: boolean } | null;
  loops: Xyz[][];
  holes: number[];
  sourceIds: string[];
}

export interface DrawRegion extends ShapeStyle {
  type: 'region';
  loops: Xyz[][];
}

export interface DrawInfinite extends ShapeStyle {
  type: 'xline' | 'ray';
  a: Xyz;
  b: Xyz;
}

export interface DrawWipeout extends ShapeStyle {
  type: 'wipeout';
  vertices: Xyz[];
}

export interface DrawRevcloud extends ShapeStyle {
  type: 'revcloud';
  vertices: BulgeVertex[];
  closed: boolean;
}

export interface DrawDonut extends ShapeStyle {
  type: 'donut';
  center: Xyz;
  inner: number;
  outer: number;
}

export interface DrawMText extends ShapeStyle {
  type: 'mtext';
  p: Xyz;
  width: number;
  height: number;
  rotation: number;
  content: string;
  style: string;
  attachment: number;
}

export type DimKind = 'linear' | 'aligned' | 'angular' | 'arc' | 'radius' | 'diameter' | 'jogged' | 'ordinate' | 'jogged-linear';

export interface DimAssoc {
  id: string;
  role: 'start' | 'end' | 'center' | 'mid' | 'vertex' | 'point';
}

export interface DrawDimension extends ShapeStyle {
  type: 'dimension';
  kind: DimKind;
  style: string;
  p1: Xyz;
  p2: Xyz;
  p3: Xyz;
  loc: Xyz;
  /** Empty uses the measured value. */
  text: string;
  textAngle: number;
  oblique: number;
  measurement: number;
  /** Linear only. True is horizontal, false is vertical. */
  horizontal: boolean;
  jog: boolean;
  inspection: { label: string; rate: string } | null;
  /** Pairs of 0–1 parameters where the dimension line is broken. */
  breaks: number[];
  overrides: Record<string, string | number | boolean>;
  assoc: DimAssoc[];
  /** Signed distance from the measured chord to the dimension line. */
  offset: number;
  justify: 'left' | 'center' | 'right';
  civil: '' | 'station' | 'offset' | 'slope';
  /** Shift of the text along and across the dimension line, in drawing units. */
  textShift: { along: number; across: number } | null;
}

export interface DrawLeader extends ShapeStyle {
  type: 'mleader';
  style: string;
  leaders: Xyz[][];
  text: string;
  textPos: Xyz;
  dogleg: number;
}

export interface DrawTable extends ShapeStyle {
  type: 'table';
  p: Xyz;
  style: string;
  cols: number;
  rows: number;
  colWidth: number;
  rowHeight: number;
  /** Row-major cell text. */
  cells: string[];
}

export interface InsertAttr {
  tag: string;
  value: string;
  prompt: string;
  p: Xyz;
  height: number;
  rotation: number;
  invisible: boolean;
  constant: boolean;
}

export interface DrawInsert extends ShapeStyle {
  type: 'insert';
  name: string;
  p: Xyz;
  sx: number;
  sy: number;
  rotation: number;
  attributes: InsertAttr[];
}

export interface DrawAttDef extends ShapeStyle {
  type: 'attdef';
  tag: string;
  prompt: string;
  value: string;
  p: Xyz;
  height: number;
  rotation: number;
  invisible: boolean;
  constant: boolean;
}

export interface DrawCenter extends ShapeStyle {
  type: 'centermark' | 'centerline';
  center: Xyz;
  size: number;
  a: Xyz;
  b: Xyz;
  assoc: string[];
}

export interface DrawArray extends ShapeStyle {
  type: 'array';
  kind: 'rect' | 'path' | 'polar';
  /** Snapshot of the source entity. One definition, many transforms. */
  source: object;
  rows: number;
  cols: number;
  rowGap: number;
  colGap: number;
  path: Xyz[];
  count: number;
  center: Xyz;
  fillAngle: number;
  associative: boolean;
}

export type CadShape =
  | DrawEllipse
  | DrawSpline
  | DrawHatch
  | DrawRegion
  | DrawInfinite
  | DrawWipeout
  | DrawRevcloud
  | DrawDonut
  | DrawMText
  | DrawDimension
  | DrawLeader
  | DrawTable
  | DrawInsert
  | DrawAttDef
  | DrawCenter
  | DrawArray;

export function isCadShape(entity: { type: string }): entity is CadShape {
  switch (entity.type) {
    case 'ellipse':
    case 'spline':
    case 'hatch':
    case 'region':
    case 'xline':
    case 'ray':
    case 'wipeout':
    case 'revcloud':
    case 'donut':
    case 'mtext':
    case 'dimension':
    case 'mleader':
    case 'table':
    case 'insert':
    case 'attdef':
    case 'centermark':
    case 'centerline':
    case 'array':
      return true;
    default:
      return false;
  }
}
