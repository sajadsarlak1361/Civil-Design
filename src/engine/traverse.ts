/**
 * Coordinate traverse with Bowditch (compass) or transit adjustment.
 * Azimuth is degrees clockwise from north. x is easting, y is northing.
 * Angle-right is measured clockwise from the backsight: next = previous + angle − 180°.
 * Deflection-right is measured from the prolongation of the previous course.
 */

export interface TraverseCourseInput {
  distance: number;
  /** Absolute azimuth. Wins over angle and deflection when set. */
  azimuthDeg?: number;
  angleRightDeg?: number;
  deflectionRightDeg?: number;
}

export interface TraverseSetup {
  startX: number;
  startY: number;
  /** Azimuth of the first course when that course has no absolute azimuth. */
  startAzimuthDeg: number;
  courses: TraverseCourseInput[];
  method: 'compass' | 'transit' | 'none';
  /** Defaults to the start when closed. */
  closeX?: number;
  closeY?: number;
  closed?: boolean;
}

export interface TraverseStation {
  x: number;
  y: number;
  azimuthDeg: number;
  distance: number;
  latitude: number;
  departure: number;
}

export interface TraverseResult {
  raw: TraverseStation[];
  adjusted: TraverseStation[];
  misclosureNorth: number;
  misclosureEast: number;
  linearMisclosure: number;
  perimeter: number;
  /** Perimeter / linear misclosure. Infinity when the traverse already closes. */
  precision: number;
  method: TraverseSetup['method'];
  warnings: string[];
}

function wrap360(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

export function courseAzimuths(setup: Pick<TraverseSetup, 'startAzimuthDeg' | 'courses'>): { azimuths: number[]; warnings: string[] } {
  const azimuths: number[] = [];
  const warnings: string[] = [];
  let previous = wrap360(setup.startAzimuthDeg);
  setup.courses.forEach((course, index) => {
    let azimuth: number;
    if (Number.isFinite(course.azimuthDeg)) {
      azimuth = wrap360(course.azimuthDeg ?? 0);
    } else if (index === 0) {
      azimuth = previous;
    } else if (Number.isFinite(course.deflectionRightDeg)) {
      azimuth = wrap360(previous + (course.deflectionRightDeg ?? 0));
    } else if (Number.isFinite(course.angleRightDeg)) {
      azimuth = wrap360(previous + (course.angleRightDeg ?? 0) - 180);
    } else {
      azimuth = previous;
      warnings.push(`Course ${index + 1} has no direction. The previous azimuth was kept.`);
    }
    azimuths.push(azimuth);
    previous = azimuth;
  });
  return { azimuths, warnings };
}

export function adjustTraverse(setup: TraverseSetup): TraverseResult {
  const { azimuths, warnings } = courseAzimuths(setup);
  const raw: TraverseStation[] = [];
  let x = setup.startX;
  let y = setup.startY;
  let perimeter = 0;
  for (let i = 0; i < setup.courses.length; i++) {
    const distance = Math.max(0, setup.courses[i].distance);
    const radians = (azimuths[i] * Math.PI) / 180;
    const latitude = distance * Math.cos(radians);
    const departure = distance * Math.sin(radians);
    x += departure;
    y += latitude;
    perimeter += distance;
    raw.push({ x, y, azimuthDeg: azimuths[i], distance, latitude, departure });
  }
  const targetX = setup.closeX ?? (setup.closed === false ? x : setup.startX);
  const targetY = setup.closeY ?? (setup.closed === false ? y : setup.startY);
  const endX = raw.length > 0 ? raw[raw.length - 1].x : setup.startX;
  const endY = raw.length > 0 ? raw[raw.length - 1].y : setup.startY;
  const misclosureEast = endX - targetX;
  const misclosureNorth = endY - targetY;
  const linearMisclosure = Math.hypot(misclosureEast, misclosureNorth);
  const precision = linearMisclosure > 1e-12 ? perimeter / linearMisclosure : Infinity;

  const sumAbsLat = raw.reduce((sum, course) => sum + Math.abs(course.latitude), 0);
  const sumAbsDep = raw.reduce((sum, course) => sum + Math.abs(course.departure), 0);
  const adjusted: TraverseStation[] = [];
  let ax = setup.startX;
  let ay = setup.startY;
  for (const course of raw) {
    let dLat = 0;
    let dDep = 0;
    if (setup.method === 'compass' && perimeter > 1e-12) {
      dLat = (-misclosureNorth * course.distance) / perimeter;
      dDep = (-misclosureEast * course.distance) / perimeter;
    } else if (setup.method === 'transit') {
      dLat = sumAbsLat > 1e-12 ? (-misclosureNorth * Math.abs(course.latitude)) / sumAbsLat : 0;
      dDep = sumAbsDep > 1e-12 ? (-misclosureEast * Math.abs(course.departure)) / sumAbsDep : 0;
    }
    ax += course.departure + dDep;
    ay += course.latitude + dLat;
    adjusted.push({
      ...course,
      x: ax,
      y: ay,
      latitude: course.latitude + dLat,
      departure: course.departure + dDep,
    });
  }
  if (setup.method !== 'none' && linearMisclosure > 1e-8) {
    const remain = Math.hypot(ax - targetX, ay - targetY);
    if (remain > 1e-6) warnings.push('The adjustment did not close. Check for a zero-length course.');
  }
  return {
    raw,
    adjusted,
    misclosureNorth,
    misclosureEast,
    linearMisclosure,
    perimeter,
    precision,
    method: setup.method,
    warnings,
  };
}
