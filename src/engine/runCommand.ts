import { applyAssembly, sectionAreas, stockLaneAssembly, type Assembly } from './assembly';
import { pointAtStation, solveAlignment, type AlignmentRecord } from './alignment';
import { elevationAt } from './tin';
import { boundsOf } from './geometry';
import type { CivilModel } from './civilModel';
import { emptyCivil } from './civilModel';
import { filterPointGroup, interpolatePoints, nextPointNumber, pointGrid, pointsAlongAlignment, type PointGroupQuery } from './cogo';
import { buildCorridor, profileFromCorridor } from './corridor';
import { featureLength2d, featureLineFromPlan, setFeatureGrade, type FeatureLine } from './featureLine';
import { gradeFeatureLine } from './grading';
import { alignmentCrossing, curbReturns } from './intersection';
import { massHaul, type EndAreaSample } from './masshaul';
import { offsetAlignmentPis } from './offsetAlignment';
import { buildParcel } from './parcels';
import { solveGravityNetwork, type PipeStructure } from './pipes';
import { solvePressureNetwork, type PressureNode } from './pressure';
import { quickProfile, superimposeProfile } from './profileSheet';
import { sampleLinesAlong, sectionFromSurface, surfaceProfile } from './profile';
import type { SurfaceRecord } from './project';
import { figuresFromPoints, parseSurveyBook } from './surveyFigures';
import { superelevationDiagram } from './superelevation';
import { adjustTraverse, type TraverseCourseInput } from './traverse';
import type { SurveyPoint, Triangle, Vec2 } from './types';
import { canonicalCivilCommand } from './commands';
import { elevationOnProfile, type VerticalPvi } from './vertical';

export type CommandArgs = Record<string, string | number | boolean | null | undefined>;

export interface BuiltSurface {
  name: string;
  points: SurveyPoint[];
  triangles: Triangle[];
  style?: { color?: string; showContours?: boolean; showElevation?: boolean; showTriangles?: boolean; opacity?: number };
}

export interface CommandContext {
  unit: 'm' | 'ft';
  surfaces: SurfaceRecord[];
  alignments: AlignmentRecord[];
  civil: CivilModel;
  activeSurfaceId: string | null;
  activeAlignmentId: string | null;
  nextId: (prefix: string) => string;
}

export interface CommandResult {
  ok: boolean;
  status: string;
  summary: string;
  civil: CivilModel;
  alignments: AlignmentRecord[];
  activeAlignmentId?: string | null;
  addSurfaces: BuiltSurface[];
  view?: 'plan' | 'profile' | 'section';
  /** When set, the view is inserted at a plan click instead of switching panes. */
  placeView?: 'profile' | 'section' | 'sections' | 'samples';
  profileBands?: boolean;
  profileSheetLength?: number | null;
  profileSheetOverlap?: number;
  diagram?: 'profile' | 'masshaul';
  superimposed?: { name: string; color: string; samples: { station: number; elevation: number }[] } | null;
  tool?: 'featureline' | 'parcel' | 'quickprofile' | 'point' | 'pan';
  /** Assembly section for the preview, when an assembly was created or edited. */
  assemblyPreview?: ReturnType<typeof applyAssembly>;
}

function num(args: CommandArgs, key: string, fallback: number): number {
  const value = args[key];
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(args: CommandArgs, key: string, fallback = ''): string {
  const value = args[key];
  return typeof value === 'string' ? value : fallback;
}

function flag(args: CommandArgs, key: string): boolean {
  const value = args[key];
  return value === true || value === 'true' || value === 1 || value === '1';
}

function fail(ctx: CommandContext, status: string): CommandResult {
  return { ok: false, status, summary: status, civil: ctx.civil, alignments: ctx.alignments, addSurfaces: [] };
}

function activeSurface(ctx: CommandContext): SurfaceRecord | null {
  return ctx.surfaces.find((surface) => surface.id === ctx.activeSurfaceId) ?? ctx.surfaces.find((surface) => surface.triangles.length > 0) ?? null;
}

/** Corridor and pipe targets follow the big ground TIN, not the last small surface that was made active. */
function groundSurface(ctx: CommandContext): SurfaceRecord | null {
  let best: SurfaceRecord | null = null;
  for (const surface of ctx.surfaces) {
    if (surface.triangles.length === 0) continue;
    if (!best || surface.triangles.length > best.triangles.length) best = surface;
  }
  return best ?? activeSurface(ctx);
}

function activeAlignment(ctx: CommandContext): AlignmentRecord | null {
  return ctx.alignments.find((alignment) => alignment.id === ctx.activeAlignmentId) ?? ctx.alignments[0] ?? null;
}

function elevationOf(surface: SurfaceRecord | null): (x: number, y: number) => number | null {
  if (!surface || surface.triangles.length === 0) return () => null;
  return (x, y) => elevationAt(surface.points, surface.triangles, x, y);
}

function alignmentRecord(id: string, name: string, pis: AlignmentRecord['pis'], extra: Partial<AlignmentRecord> = {}): AlignmentRecord {
  return {
    id,
    name,
    visible: true,
    startStation: 0,
    pis,
    labelInterval: 20,
    profileInterval: 5,
    sampleSpacing: 20,
    sampleLeft: 20,
    sampleRight: 20,
    sectionStep: 2,
    showSampleLines: false,
    ...extra,
  };
}

function replaceAlignment(alignments: AlignmentRecord[], record: AlignmentRecord): AlignmentRecord[] {
  const index = alignments.findIndex((item) => item.id === record.id);
  if (index < 0) return [...alignments, record];
  return alignments.map((item) => (item.id === record.id ? record : item));
}

function parseCourses(value: string): TraverseCourseInput[] {
  const courses: TraverseCourseInput[] = [];
  for (const line of value.split(/\r?\n/)) {
    const parts = line.trim().split(/[, \t]+/).filter(Boolean);
    if (parts.length < 2) continue;
    const azimuth = Number(parts[0]);
    const distance = Number(parts[1]);
    if (!Number.isFinite(azimuth) || !Number.isFinite(distance)) continue;
    courses.push({ azimuthDeg: azimuth, distance });
  }
  return courses;
}

function surfaceEndAreas(base: SurfaceRecord, comparison: SurfaceRecord, alignment: AlignmentRecord): EndAreaSample[] {
  const solved = solveAlignment(alignment.pis);
  const lines = sampleLinesAlong(solved, alignment.startStation, alignment.sampleSpacing || 20, Math.max(alignment.sampleLeft, 25), Math.max(alignment.sampleRight, 25));
  return lines.map((line) => {
    const design = sectionFromSurface(comparison.points, comparison.triangles, line, 1).filter((sample) => sample.elevation !== null);
    const ground = sectionFromSurface(base.points, base.triangles, line, 1);
    const egAt = (offset: number) => {
      if (ground.length === 0) return null;
      if (offset <= ground[0].offset) return ground[0].elevation;
      const last = ground[ground.length - 1];
      if (offset >= last.offset) return last.elevation;
      for (let i = 1; i < ground.length; i++) {
        if (offset > ground[i].offset) continue;
        const span = ground[i].offset - ground[i - 1].offset;
        const t = span <= 1e-12 ? 0 : (offset - ground[i - 1].offset) / span;
        const z0 = ground[i - 1].elevation;
        const z1 = ground[i].elevation;
        if (z0 === null || z1 === null) return null;
        return z0 + (z1 - z0) * t;
      }
      return null;
    };
    const areas = sectionAreas(
      design.map((sample) => ({ code: 'Top', offset: sample.offset, elevation: sample.elevation ?? 0 })),
      egAt,
      1,
    );
    return { station: line.station, cut: areas.cut, fill: areas.fill };
  });
}

function defaultProfile(alignment: AlignmentRecord, surface: SurfaceRecord | null): VerticalPvi[] {
  if (alignment.designProfile && alignment.designProfile.length >= 2) return alignment.designProfile;
  const solved = solveAlignment(alignment.pis);
  if (!surface) {
    return [
      { station: alignment.startStation, elevation: 100, curveLength: 0 },
      { station: alignment.startStation + solved.length, elevation: 100, curveLength: 0 },
    ];
  }
  const profile = surfaceProfile(surface.points, surface.triangles, solved, alignment.startStation, Math.max(5, solved.length / 8));
  const known = profile.filter((vertex) => vertex.elevation !== null);
  if (known.length < 2) {
    return [
      { station: alignment.startStation, elevation: 100, curveLength: 0 },
      { station: alignment.startStation + solved.length, elevation: 100, curveLength: 0 },
    ];
  }
  const mid = known[Math.floor(known.length / 2)];
  return [
    { station: known[0].station, elevation: known[0].elevation ?? 0, curveLength: 0 },
    { station: mid.station, elevation: (mid.elevation ?? 0) + 0.5, curveLength: Math.min(40, solved.length * 0.25) },
    { station: known[known.length - 1].station, elevation: known[known.length - 1].elevation ?? 0, curveLength: 0 },
  ];
}

export function runCivilCommand(command: string, args: CommandArgs, ctx: CommandContext): CommandResult {
  const name = canonicalCivilCommand(command);
  const civil = ctx.civil ?? emptyCivil();
  const surface = activeSurface(ctx);
  const alignment = activeAlignment(ctx);
  switch (name) {
    case 'CREATEPOINTS':
      return createPoints(args, ctx, civil, surface, alignment);
    case 'CREATEPOINTGROUP':
      return createPointGroup(args, ctx, civil);
    case 'TRAVERSEEDITOR':
      return runTraverse(args, ctx, civil, alignment);
    case 'CREATESURVEYFIGURE':
      return surveyFigures(ctx, civil);
    case 'IMPORTSURVEYDATA':
      return importSurvey(args, ctx, civil);
    case 'CREATEPARCELFROMOBJECTS':
      return createParcel(args, ctx, civil, surface);
    case 'CREATEFEATURELINES':
      return createFeatureLine(args, ctx, civil, surface, alignment);
    case 'CREATEGRADING':
      return createGrading(args, ctx, civil, surface);
    case 'CREATEOFFSETALIGNMENT':
      return createOffset(args, ctx, alignment);
    case 'CALCULATESUPERELEVATION':
      return calculateSuper(args, ctx, civil, alignment);
    case 'CREATEASSEMBLY':
      return createAssembly(args, ctx, civil);
    case 'CREATECORRIDOR':
      return createCorridor(args, ctx, civil, groundSurface(ctx), alignment);
    case 'CREATEPROFILEFROMCORRIDOR':
      return profileFromCorridorCommand(args, ctx, civil, alignment);
    case 'CREATEINTERSECTION':
      return createIntersection(args, ctx, civil, alignment);
    case 'CREATEPIPENETWORK':
      return createPipes(args, ctx, civil, groundSurface(ctx), alignment);
    case 'CREATEPRESSURENETWORK':
      return createPressure(args, ctx, civil, groundSurface(ctx), alignment);
    case 'CREATEMASSHAULDIAGRAM':
      return createMassHaul(args, ctx, civil, surface, alignment);
    case 'CREATEMULTIPLEPROFILEVIEW':
      return multipleViews(args, ctx, alignment);
    case 'ADDPROFILEVIEWBANDS':
      return { ok: true, status: 'Specify profile view insertion point', summary: 'Station, elevation, and geometry bands are drawn under the profile.', civil, alignments: ctx.alignments, addSurfaces: [], placeView: 'profile', profileBands: true, diagram: 'profile' };
    case 'SUPERIMPOSEPROFILE':
      return superimpose(args, ctx, surface, alignment);
    case 'CREATEQUICKPROFILE':
      return runQuickProfile(args, ctx, surface);
    default:
      return fail(ctx, `Unknown command ${name}.`);
  }
}

function createPoints(args: CommandArgs, ctx: CommandContext, civil: CivilModel, surface: SurfaceRecord | null, alignment: AlignmentRecord | null): CommandResult {
  const mode = text(args, 'mode', 'grid');
  const description = text(args, 'description', mode === 'alignment' ? 'CL' : 'GS');
  const start = Math.round(num(args, 'startNumber', nextPointNumber(civil.points)));
  const idFor = (number: number) => ctx.nextId(`pt${number}`);
  let created: CivilModel['points'] = [];
  if (mode === 'manual') {
    created = [{ id: idFor(start), number: start, x: num(args, 'easting', 0), y: num(args, 'northing', 0), z: num(args, 'elevation', 0), description }];
  } else if (mode === 'interpolate') {
    created = interpolatePoints(
      { x: num(args, 'x1', 0), y: num(args, 'y1', 0), z: num(args, 'z1', 0) },
      { x: num(args, 'x2', 10), y: num(args, 'y2', 0), z: num(args, 'z2', 1) },
      num(args, 'segments', 4),
      start,
      description,
      idFor,
    );
  } else if (mode === 'alignment') {
    if (!alignment) return fail(ctx, 'Create an alignment before points along an alignment.');
    const solved = solveAlignment(alignment.pis);
    const z = elevationOf(surface);
    created = pointsAlongAlignment({
      solved,
      startStation: alignment.startStation,
      fromStation: num(args, 'fromStation', alignment.startStation),
      toStation: num(args, 'toStation', alignment.startStation + solved.length),
      interval: num(args, 'interval', 20),
      offset: num(args, 'offset', 0),
      elevationAt: z,
      fallbackZ: num(args, 'elevation', 0),
      startNumber: start,
      description,
      idFor,
    });
  } else {
    if (!surface) return fail(ctx, 'A surface is needed for a point grid.');
    const bounds = boundsOf(surface.points);
    if (!bounds) return fail(ctx, 'The surface has no points.');
    const padX = (bounds.maxX - bounds.minX) * 0.08;
    const padY = (bounds.maxY - bounds.minY) * 0.08;
    created = pointGrid({
      minX: num(args, 'minX', bounds.minX + padX),
      maxX: num(args, 'maxX', bounds.maxX - padX),
      minY: num(args, 'minY', bounds.minY + padY),
      maxY: num(args, 'maxY', bounds.maxY - padY),
      columns: num(args, 'columns', 6),
      rows: num(args, 'rows', 4),
      elevationAt: elevationOf(surface),
      fallbackZ: 0,
      startNumber: start,
      description,
      idFor,
    });
  }
  const points = [...civil.points, ...created];
  return {
    ok: true,
    status: `${created.length} COGO point${created.length === 1 ? '' : 's'} created.`,
    summary: created.slice(0, 8).map((point) => `${point.number}  E ${point.x.toFixed(3)}  N ${point.y.toFixed(3)}  Z ${point.z.toFixed(3)}  ${point.description}`).join('\n'),
    civil: { ...civil, points },
    alignments: ctx.alignments,
    addSurfaces: [],
    view: 'plan',
  };
}

function createPointGroup(args: CommandArgs, ctx: CommandContext, civil: CivilModel): CommandResult {
  const query: PointGroupQuery = {
    id: ctx.nextId('pg'),
    name: text(args, 'name', 'Point group'),
    description: text(args, 'description', '*'),
    minElevation: text(args, 'minElevation', '') === '' && args.minElevation === undefined ? null : num(args, 'minElevation', 0),
    maxElevation: args.maxElevation === undefined || args.maxElevation === '' ? null : num(args, 'maxElevation', 0),
    minNumber: args.minNumber === undefined || args.minNumber === '' ? null : num(args, 'minNumber', 0),
    maxNumber: args.maxNumber === undefined || args.maxNumber === '' ? null : num(args, 'maxNumber', 0),
    excludeNumbers: text(args, 'exclude', '')
      .split(/[, ]+/)
      .map(Number)
      .filter((value) => Number.isFinite(value)),
  };
  if (args.minElevation === undefined || args.minElevation === '') query.minElevation = null;
  const matched = filterPointGroup(civil.points, query);
  const addSurfaces: BuiltSurface[] = [];
  if (flag(args, 'addToSurface') && matched.length >= 3) {
    addSurfaces.push({
      name: query.name,
      points: matched.map((point) => ({ x: point.x, y: point.y, z: point.z, number: String(point.number), description: point.description, role: 'survey' as const })),
      triangles: [],
    });
  }
  const summary = `${query.name}: ${matched.length} of ${civil.points.length} points.`;
  return {
    ok: true,
    status: summary + (addSurfaces.length ? ' Added to a new surface.' : ''),
    summary,
    civil: { ...civil, pointGroups: [...civil.pointGroups, query] },
    alignments: ctx.alignments,
    addSurfaces,
    activeAlignmentId: ctx.activeAlignmentId,
    view: 'plan',
  };
}

function runTraverse(args: CommandArgs, ctx: CommandContext, civil: CivilModel, alignment: AlignmentRecord | null): CommandResult {
  const origin = alignment ? alignment.pis[0] : { x: num(args, 'startX', 0), y: num(args, 'startY', 0) };
  const courses = parseCourses(text(args, 'courses', '90,100\n180,100\n270,100\n0,100.2'));
  if (courses.length < 2) return fail(ctx, 'A traverse needs at least two courses, as azimuth and distance.');
  const method = text(args, 'method', 'compass');
  const result = adjustTraverse({
    startX: num(args, 'startX', origin.x),
    startY: num(args, 'startY', origin.y),
    startAzimuthDeg: num(args, 'azimuth', courses[0].azimuthDeg ?? 0),
    courses,
    method: method === 'transit' || method === 'none' ? method : 'compass',
    closed: true,
  });
  const id = ctx.nextId('tr');
  const line: FeatureLine = {
    id,
    name: text(args, 'name', 'Traverse'),
    points: [{ x: num(args, 'startX', origin.x), y: num(args, 'startY', origin.y), z: num(args, 'elevation', 0) }, ...result.adjusted.map((station) => ({ x: station.x, y: station.y, z: num(args, 'elevation', 0) }))],
  };
  const precision = Number.isFinite(result.precision) ? `1:${Math.round(result.precision)}` : 'closed';
  const summary = [
    `Linear misclosure ${result.linearMisclosure.toFixed(4)}`,
    `Precision ${precision}`,
    `North ${result.misclosureNorth.toFixed(4)}  East ${result.misclosureEast.toFixed(4)}`,
    `Method ${result.method}`,
    ...result.adjusted.map((station, index) => `Sta ${index + 1}  E ${station.x.toFixed(3)}  N ${station.y.toFixed(3)}`),
  ].join('\n');
  return {
    ok: true,
    status: `Traverse adjusted. Misclosure ${result.linearMisclosure.toFixed(4)}, precision ${precision}.`,
    summary,
    civil: { ...civil, featureLines: [...civil.featureLines, line] },
    alignments: ctx.alignments,
    addSurfaces: [],
    view: 'plan',
  };
}

function surveyFigures(ctx: CommandContext, civil: CivilModel): CommandResult {
  const figures = figuresFromPoints(civil.points).map((figure, index) => ({ ...figure, id: ctx.nextId(`fig${index}`) }));
  if (figures.length === 0) return fail(ctx, 'No figure codes on the COGO points. Import survey data or use codes such as EP1 B.');
  return {
    ok: true,
    status: `${figures.length} survey figure${figures.length === 1 ? '' : 's'} created.`,
    summary: figures.map((figure) => `${figure.name} · ${figure.points.length} points${figure.closed ? ' · closed' : ''}`).join('\n'),
    civil: { ...civil, featureLines: [...civil.featureLines, ...figures] },
    alignments: ctx.alignments,
    addSurfaces: [],
    view: 'plan',
  };
}

function importSurvey(args: CommandArgs, ctx: CommandContext, civil: CivilModel): CommandResult {
  const raw = text(args, 'text', DEFAULT_SURVEY);
  const parsed = parseSurveyBook(raw);
  if (parsed.points.length === 0) return fail(ctx, 'No survey points were read.');
  const start = nextPointNumber(civil.points);
  const points = parsed.points.map((point, index) => ({ ...point, id: ctx.nextId('sv'), number: start + index }));
  const figures = figuresFromPoints(points).map((figure) => ({ ...figure, id: ctx.nextId('fig') }));
  return {
    ok: true,
    status: `Imported ${points.length} survey points and ${figures.length} figures.`,
    summary: [...parsed.warnings, ...figures.map((figure) => `${figure.name} · ${figure.points.length} vertices`)].join('\n'),
    civil: { ...civil, points: [...civil.points, ...points], featureLines: [...civil.featureLines, ...figures] },
    alignments: ctx.alignments,
    addSurfaces: [],
    view: 'plan',
  };
}

const DEFAULT_SURVEY = `# Sample field book near the site. PNEZD with figure codes.
100,50120,10090,103.2,CL1 B
101,50128,10140,103.6,CL1
102,50120,10190,103.1,CL1 E
103,50112,10090,103.0,EP1 B
104,50112,10190,102.8,EP1 E
`;

function createParcel(args: CommandArgs, ctx: CommandContext, civil: CivilModel, surface: SurfaceRecord | null): CommandResult {
  if (text(args, 'mode', 'rectangle') === 'draw') {
    return { ok: true, status: 'Parcel · click the lot corners, Enter to close.', summary: 'Click the corners. Enter closes the parcel.', civil, alignments: ctx.alignments, addSurfaces: [], tool: 'parcel', view: 'plan' };
  }
  let ring: Vec2[] = [];
  const closed = civil.featureLines.find((line) => line.closed || (line.points.length > 2 && Math.hypot(line.points[0].x - line.points[line.points.length - 1].x, line.points[0].y - line.points[line.points.length - 1].y) < 0.05));
  if (text(args, 'mode', 'rectangle') === 'feature' && closed) ring = closed.points.map((point) => ({ x: point.x, y: point.y }));
  else if (surface?.boundary && surface.boundary.length >= 3 && text(args, 'mode', '') === 'boundary') ring = surface.boundary;
  else {
    const bounds = surface ? boundsOf(surface.points) : null;
    const minX = num(args, 'minX', bounds ? bounds.minX + (bounds.maxX - bounds.minX) * 0.35 : 0);
    const maxX = num(args, 'maxX', bounds ? bounds.minX + (bounds.maxX - bounds.minX) * 0.65 : 40);
    const minY = num(args, 'minY', bounds ? bounds.minY + (bounds.maxY - bounds.minY) * 0.35 : 0);
    const maxY = num(args, 'maxY', bounds ? bounds.minY + (bounds.maxY - bounds.minY) * 0.65 : 30);
    ring = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ];
  }
  const parcel = buildParcel(ctx.nextId('parcel'), text(args, 'name', `Parcel ${civil.parcels.length + 1}`), ring);
  const summary = `${parcel.name}\nArea ${parcel.area.toFixed(2)}\nPerimeter ${parcel.perimeter.toFixed(2)}\nMisclosure ${parcel.misclosure.toFixed(4)}\n` + parcel.segments.map((segment) => `${segment.bearing}  ${segment.distance.toFixed(3)}`).join('\n');
  return {
    ok: true,
    status: `${parcel.name} · area ${parcel.area.toFixed(1)}`,
    summary,
    civil: { ...civil, parcels: [...civil.parcels, parcel] },
    alignments: ctx.alignments,
    addSurfaces: [],
    view: 'plan',
  };
}

function createFeatureLine(args: CommandArgs, ctx: CommandContext, civil: CivilModel, surface: SurfaceRecord | null, alignment: AlignmentRecord | null): CommandResult {
  if (text(args, 'mode', 'alignment') === 'draw') {
    return { ok: true, status: 'Feature line · click points, Enter to finish. Elevations come from the active surface.', summary: 'Click the vertices, then Enter.', civil, alignments: ctx.alignments, addSurfaces: [], tool: 'featureline', view: 'plan' };
  }
  let line: FeatureLine;
  if (text(args, 'mode', 'alignment') === 'grade' && civil.featureLines.length > 0) {
    const current = civil.featureLines[civil.featureLines.length - 1];
    line = setFeatureGrade(current, 0, current.points.length - 1, num(args, 'grade', -0.02));
    const featureLines = civil.featureLines.map((item) => (item.id === current.id ? line : item));
    return {
      ok: true,
      status: `${line.name} grade set to ${(num(args, 'grade', -0.02) * 100).toFixed(2)}%.`,
      summary: `2D length ${featureLength2d(line).toFixed(2)}. End elevation ${line.points[line.points.length - 1].z.toFixed(3)}.`,
      civil: { ...civil, featureLines },
      alignments: ctx.alignments,
      addSurfaces: [],
      view: 'plan',
    };
  }
  if (!alignment) return fail(ctx, 'Create an alignment, or draw the feature line.');
  const solved = solveAlignment(alignment.pis);
  const z = elevationOf(surface);
  const interval = num(args, 'interval', 10);
  const offset = num(args, 'offset', 0);
  const points: FeatureLine['points'] = [];
  for (let distance = 0; distance <= solved.length + 1e-6; distance += interval) {
    const station = alignment.startStation + Math.min(distance, solved.length);
    const point = pointAtStation(solved, alignment.startStation, station);
    if (!point) continue;
    const x = point.x + point.ty * offset;
    const y = point.y - point.tx * offset;
    points.push({ x, y, z: z(x, y) ?? elevationOnProfile(alignment.designProfile ?? [], station) ?? 0 });
    if (distance >= solved.length - 1e-6) break;
  }
  line = { id: ctx.nextId('fl'), name: text(args, 'name', `FL ${civil.featureLines.length + 1}`), points };
  return {
    ok: true,
    status: `${line.name} · ${featureLength2d(line).toFixed(1)} long.`,
    summary: `${line.points.length} vertices along ${alignment.name}.`,
    civil: { ...civil, featureLines: [...civil.featureLines, line] },
    alignments: ctx.alignments,
    addSurfaces: [],
    view: 'plan',
  };
}

function createGrading(args: CommandArgs, ctx: CommandContext, civil: CivilModel, surface: SurfaceRecord | null): CommandResult {
  if (!surface || surface.triangles.length === 0) return fail(ctx, 'Grading needs a target surface.');
  let feature = civil.featureLines.find((line) => line.id === text(args, 'featureLineId', '')) ?? civil.featureLines[civil.featureLines.length - 1];
  const featureLines = [...civil.featureLines];
  if (!feature) {
    const bounds = boundsOf(surface.points);
    if (!bounds) return fail(ctx, 'Draw a feature line before grading.');
    const y = bounds.minY + (bounds.maxY - bounds.minY) * 0.55;
    const z = elevationOf(surface);
    feature = {
      id: ctx.nextId('fl'),
      name: 'Grade edge',
      points: [
        { x: bounds.minX + (bounds.maxX - bounds.minX) * 0.3, y, z: (z(bounds.minX, y) ?? 0) + 1.5 },
        { x: bounds.minX + (bounds.maxX - bounds.minX) * 0.7, y, z: (z(bounds.maxX, y) ?? 0) + 1.5 },
      ],
    };
    featureLines.push(feature);
  }
  const side = text(args, 'side', 'left');
  const graded = gradeFeatureLine({
    footprint: feature,
    side: side === 'right' || side === 'both' ? side : 'left',
    cutSlope: num(args, 'cutSlope', 2),
    fillSlope: num(args, 'fillSlope', 3),
    points: surface.points,
    triangles: surface.triangles,
  });
  const record = {
    id: ctx.nextId('gr'),
    name: text(args, 'name', `Grading ${civil.gradings.length + 1}`),
    featureLineId: feature.id,
    side: (side === 'right' || side === 'both' ? side : 'left') as 'left' | 'right' | 'both',
    cutSlope: num(args, 'cutSlope', 2),
    fillSlope: num(args, 'fillSlope', 3),
    surfaceId: surface.id,
  };
  const daylightLines: FeatureLine[] = graded.daylight
    .filter((chain) => chain.length > 1)
    .map((chain, index) => ({ id: ctx.nextId('dl'), name: `${record.name} daylight ${index + 1}`, points: chain }));
  return {
    ok: graded.triangles.length > 0,
    status: graded.triangles.length > 0 ? `${record.name} daylighted to ${surface.name}.` : graded.warnings[0] ?? 'Grading did not meet the surface.',
    summary: [...graded.warnings, `${graded.triangles.length} grading triangles.`, ...daylightLines.map((line) => `${line.name} · ${featureLength2d(line).toFixed(1)}`)].join('\n'),
    civil: { ...civil, featureLines: [...featureLines, ...daylightLines], gradings: [...civil.gradings, record] },
    alignments: ctx.alignments,
    addSurfaces:
      graded.triangles.length > 0
        ? [{ name: record.name, points: graded.surfacePoints, triangles: graded.triangles, style: { color: '#d7c4a3', showContours: false, showElevation: true, opacity: 0.9 } }]
        : [],
    view: 'plan',
  };
}

function createOffset(args: CommandArgs, ctx: CommandContext, alignment: AlignmentRecord | null): CommandResult {
  if (!alignment) return fail(ctx, 'Create an alignment before an offset alignment.');
  const offset = num(args, 'offset', 6);
  const solved = solveAlignment(alignment.pis);
  const offsetPis = offsetAlignmentPis(solved, offset);
  if (offsetPis.pis.length < 2) return fail(ctx, offsetPis.warnings[0] ?? 'The offset failed.');
  const record = alignmentRecord(ctx.nextId('oa'), text(args, 'name', `${alignment.name} offset ${offset}`), offsetPis.pis);
  const length = solveAlignment(record.pis).length;
  return {
    ok: true,
    status: `${record.name} · ${length.toFixed(1)}`,
    summary: [`Offset ${offset} (positive is right).`, ...offsetPis.warnings].join('\n'),
    civil: ctx.civil,
    alignments: [...ctx.alignments, record],
    activeAlignmentId: alignment.id,
    addSurfaces: [],
    view: 'plan',
  };
}

function calculateSuper(args: CommandArgs, ctx: CommandContext, civil: CivilModel, alignment: AlignmentRecord | null): CommandResult {
  if (!alignment) return fail(ctx, 'Create an alignment before superelevation.');
  const solved = solveAlignment(alignment.pis);
  const diagram = superelevationDiagram({
    solved,
    startStation: alignment.startStation,
    designSpeedKmh: num(args, 'speed', 60),
    emax: num(args, 'emax', 0.06),
    laneWidth: num(args, 'laneWidth', 3.6),
    normalCrown: num(args, 'crown', 0.02),
  });
  const summary = [
    ...diagram.curves.map((curve) => `${curve.turn} R ${curve.radius.toFixed(1)}  e ${(curve.rate * 100).toFixed(2)}%  runoff ${curve.runoff.toFixed(1)}`),
    ...diagram.stations.slice(0, 12).map((station) => `${station.station.toFixed(1)}  L ${(station.leftSlope * 100).toFixed(2)}%  R ${(station.rightSlope * 100).toFixed(2)}%  ${station.label}`),
    ...diagram.warnings,
  ].join('\n');
  return {
    ok: true,
    status: diagram.curves.length ? `Superelevation calculated for ${diagram.curves.length} curve${diagram.curves.length === 1 ? '' : 's'}.` : 'No curves needed superelevation.',
    summary,
    civil: { ...civil, superelevation: { alignmentId: alignment.id, stations: diagram.stations, curves: diagram.curves } },
    alignments: ctx.alignments,
    addSurfaces: [],
    view: 'plan',
  };
}

function createAssembly(args: CommandArgs, ctx: CommandContext, civil: CivilModel): CommandResult {
  const assembly: Assembly = stockLaneAssembly(ctx.nextId('asm'), text(args, 'name', 'Lane-Shoulder-Daylight'));
  assembly.right = [
    { kind: 'lane', name: 'Lane', width: num(args, 'laneWidth', 3.6), slope: num(args, 'laneSlope', -2) / 100, depth: num(args, 'depth', 0.15) },
    { kind: 'shoulder', name: 'Shoulder', width: num(args, 'shoulderWidth', 1.5), slope: num(args, 'shoulderSlope', -4) / 100, depth: num(args, 'depth', 0.15) },
    { kind: 'daylight', name: 'Daylight', cutSlope: num(args, 'cutSlope', 2), fillSlope: num(args, 'fillSlope', 3), maxWidth: num(args, 'maxWidth', 40) },
  ];
  const preview = applyAssembly(assembly, {
    centerElevation: 2,
    egAt: () => 0,
  });
  return {
    ok: true,
    status: `${assembly.name} saved.`,
    summary: `Lane ${num(args, 'laneWidth', 3.6)} at ${num(args, 'laneSlope', -2)}%, shoulder ${num(args, 'shoulderWidth', 1.5)}, daylight cut ${num(args, 'cutSlope', 2)}:1 fill ${num(args, 'fillSlope', 3)}:1.`,
    civil: { ...civil, assemblies: [...civil.assemblies, assembly] },
    alignments: ctx.alignments,
    addSurfaces: [],
    assemblyPreview: preview,
    view: 'plan',
  };
}

function createCorridor(args: CommandArgs, ctx: CommandContext, civil: CivilModel, surface: SurfaceRecord | null, alignment: AlignmentRecord | null): CommandResult {
  if (!alignment) return fail(ctx, 'A corridor needs an alignment.');
  const assembly = civil.assemblies[civil.assemblies.length - 1] ?? stockLaneAssembly(ctx.nextId('asm'));
  const assemblies = civil.assemblies.some((item) => item.id === assembly.id) ? civil.assemblies : [...civil.assemblies, assembly];
  const profile = defaultProfile(alignment, surface);
  const solved = solveAlignment(alignment.pis);
  const superStations = civil.superelevation?.alignmentId === alignment.id ? civil.superelevation.stations : undefined;
  const model = buildCorridor({
    solved,
    startStation: alignment.startStation,
    profile,
    assembly,
    frequency: num(args, 'frequency', 10),
    surfacePoints: surface?.points,
    surfaceTriangles: surface?.triangles,
    superelevation: superStations,
  });
  const record = {
    id: ctx.nextId('cor'),
    name: text(args, 'name', `Corridor - ${alignment.name}`),
    alignmentId: alignment.id,
    assemblyId: assembly.id,
    surfaceId: surface?.id ?? null,
    frequency: num(args, 'frequency', 10),
    cut: model.cut,
    fill: model.fill,
    pavementArea: model.pavementArea,
    shoulderArea: model.shoulderArea,
    featureLines: model.featureLines,
    endAreas: model.endAreas,
  };
  const withProfile = { ...alignment, designProfile: profile };
  const summary = [
    `${model.stations.length} stations`,
    `Cut ${model.cut.toFixed(1)}`,
    `Fill ${model.fill.toFixed(1)}`,
    `Pavement area ${model.pavementArea.toFixed(1)}`,
    `Shoulder area ${model.shoulderArea.toFixed(1)}`,
    ...model.warnings,
  ].join('\n');
  return {
    ok: model.stations.length >= 2,
    status: `${record.name} · cut ${model.cut.toFixed(0)} · fill ${model.fill.toFixed(0)}`,
    summary,
    civil: { ...civil, assemblies, corridors: [...civil.corridors, record] },
    alignments: replaceAlignment(ctx.alignments, withProfile),
    activeAlignmentId: alignment.id,
    addSurfaces:
      model.surfaceTriangles.length > 0
        ? [{ name: record.name, points: model.surfacePoints, triangles: model.surfaceTriangles, style: { color: '#e0b15a', showContours: false, showElevation: true, showTriangles: false, opacity: 0.92 } }]
        : [],
    view: 'plan',
  };
}

function profileFromCorridorCommand(args: CommandArgs, ctx: CommandContext, civil: CivilModel, alignment: AlignmentRecord | null): CommandResult {
  const corridor = civil.corridors[civil.corridors.length - 1];
  if (!corridor) return fail(ctx, 'Create a corridor before extracting a profile.');
  const code = text(args, 'code', corridor.featureLines.find((line) => line.code.startsWith('ETW'))?.code ?? corridor.featureLines[0]?.code ?? 'Crown');
  const model = { featureLines: corridor.featureLines, stations: [], surfacePoints: [], surfaceTriangles: [], endAreas: [], cut: 0, fill: 0, pavementArea: 0, shoulderArea: 0, curbLength: 0, warnings: [] };
  const samples = profileFromCorridor(model, code);
  if (samples.length < 2) return fail(ctx, `The corridor has no ${code} feature line.`);
  const target = alignment && alignment.id === corridor.alignmentId ? alignment : ctx.alignments.find((item) => item.id === corridor.alignmentId) ?? alignment;
  if (!target) return fail(ctx, 'The corridor alignment is missing.');
  const designProfile = samples.map((sample) => ({ station: sample.station, elevation: sample.elevation, curveLength: 0 }));
  return {
    ok: true,
    status: `Profile from ${code} written onto ${target.name}.`,
    summary: samples.slice(0, 6).map((sample) => `${sample.station.toFixed(2)}  ${sample.elevation.toFixed(3)}`).join('\n'),
    civil,
    alignments: replaceAlignment(ctx.alignments, { ...target, designProfile }),
    activeAlignmentId: target.id,
    addSurfaces: [],
    placeView: 'profile',
    diagram: 'profile',
  };
}

function createIntersection(args: CommandArgs, ctx: CommandContext, civil: CivilModel, alignment: AlignmentRecord | null): CommandResult {
  if (!alignment) return fail(ctx, 'An intersection needs an alignment.');
  let alignments = ctx.alignments;
  const solvedA = solveAlignment(alignment.pis);
  let other = alignments.find((item) => {
    if (item.id === alignment.id) return false;
    return alignmentCrossing(solvedA, alignment.startStation, solveAlignment(item.pis), item.startStation) !== null;
  });
  if (!other) {
    const mid = pointAtStation(solvedA, alignment.startStation, alignment.startStation + solvedA.length / 2);
    if (!mid) return fail(ctx, 'The alignment is too short.');
    const half = num(args, 'leg', 50);
    other = alignmentRecord(ctx.nextId('al'), `${alignment.name} crossing`, [
      { x: mid.x - mid.ty * half, y: mid.y + mid.tx * half, radius: 0 },
      { x: mid.x + mid.ty * half, y: mid.y - mid.tx * half, radius: 0 },
    ]);
    alignments = [...alignments, other];
  }
  const a = solvedA;
  const b = solveAlignment(other.pis);
  const crossing = alignmentCrossing(a, alignment.startStation, b, other.startStation);
  if (!crossing) return fail(ctx, 'Those alignments do not cross.');
  const returns = curbReturns(crossing, num(args, 'laneWidth', 3.6), num(args, 'radius', 8));
  const record = {
    id: ctx.nextId('ix'),
    name: text(args, 'name', `${alignment.name} / ${other.name}`),
    alignmentA: alignment.id,
    alignmentB: other.id,
    stationA: crossing.stationA,
    stationB: crossing.stationB,
    returns,
  };
  return {
    ok: returns.length > 0,
    status: returns.length ? `${record.name} · ${returns.length} curb returns.` : 'The alignments cross, but no curb return fit.',
    summary: returns.map((item, index) => `Return ${index + 1} ${item.turn} R ${item.radius.toFixed(2)} T ${item.tangent.toFixed(2)} L ${item.length.toFixed(2)}`).join('\n'),
    civil: { ...civil, intersections: [...civil.intersections, record] },
    alignments,
    activeAlignmentId: alignment.id,
    addSurfaces: [],
    view: 'plan',
  };
}

function createPipes(args: CommandArgs, ctx: CommandContext, civil: CivilModel, surface: SurfaceRecord | null, alignment: AlignmentRecord | null): CommandResult {
  if (!alignment) return fail(ctx, 'Lay the network out on an alignment first.');
  const solved = solveAlignment(alignment.pis);
  const interval = num(args, 'interval', 40);
  const offset = num(args, 'offset', 8);
  const diameter = num(args, 'diameter', 0.45);
  const slope = num(args, 'slope', 0.005);
  const structures: PipeStructure[] = [];
  const z = elevationOf(surface);
  for (let distance = 0; distance <= solved.length + 1e-6; distance += interval) {
    const at = pointAtStation(solved, alignment.startStation, alignment.startStation + Math.min(distance, solved.length));
    if (!at) continue;
    const x = at.x + at.ty * offset;
    const y = at.y - at.tx * offset;
    structures.push({ id: ctx.nextId('st'), name: `MH ${structures.length + 1}`, x, y, rim: z(x, y) ?? num(args, 'rim', 100) });
    if (distance >= solved.length - 1e-6) break;
    if (structures.length > 80) break;
  }
  if (structures.length < 2) return fail(ctx, 'The alignment is too short for two structures.');
  const pipes = structures.slice(0, -1).map((structure, index) => ({
    id: ctx.nextId('pipe'),
    name: `Pipe ${index + 1}`,
    fromId: structure.id,
    toId: structures[index + 1].id,
    diameter,
    manningN: num(args, 'manning', 0.013),
    slope,
    flow: num(args, 'flow', 0.02),
  }));
  const results = solveGravityNetwork({
    structures,
    pipes,
    unit: ctx.unit,
    minCover: num(args, 'minCover', 1),
    minSlope: num(args, 'minSlope', 0.003),
    designDepthRatio: num(args, 'depthRatio', 0.8),
  });
  const network = { id: ctx.nextId('pn'), name: text(args, 'name', 'Storm'), structures, pipes, results };
  const summary = results
    .map((pipe) => `${pipe.name} L ${pipe.length.toFixed(1)} S ${(pipe.slope * 100).toFixed(2)}% Q ${pipe.capacityDesign.toFixed(3)} V ${pipe.velocity.toFixed(2)} cover ${Math.min(pipe.coverFrom, pipe.coverTo).toFixed(2)}${pipe.warnings.length ? ` · ${pipe.warnings[0]}` : ''}`)
    .join('\n');
  return {
    ok: true,
    status: `${network.name}: ${structures.length} structures, ${pipes.length} pipes.`,
    summary,
    civil: { ...civil, pipeNetworks: [...civil.pipeNetworks, network] },
    alignments: ctx.alignments,
    addSurfaces: [],
    view: 'plan',
  };
}

function createPressure(args: CommandArgs, ctx: CommandContext, civil: CivilModel, surface: SurfaceRecord | null, alignment: AlignmentRecord | null): CommandResult {
  if (!alignment) return fail(ctx, 'A pressure network needs an alignment to follow.');
  const solved = solveAlignment(alignment.pis);
  const z = elevationOf(surface);
  const nodes: PressureNode[] = [];
  const count = 3;
  for (let i = 0; i < count; i++) {
    const distance = (solved.length * i) / (count - 1);
    const at = pointAtStation(solved, alignment.startStation, alignment.startStation + distance);
    if (!at) continue;
    const x = at.x - at.ty * 12;
    const y = at.y + at.tx * 12;
    const elevation = z(x, y) ?? 100;
    nodes.push({
      id: ctx.nextId('pn'),
      name: i === 0 ? 'Reservoir' : `J-${i}`,
      x,
      y,
      elevation,
      demand: i === 0 ? 0 : num(args, 'demand', 0.01) / (count - 1),
      ...(i === 0 ? { fixedHgl: elevation + num(args, 'head', 40) } : {}),
    });
  }
  const diameter = num(args, 'diameter', 0.2);
  const c = num(args, 'hazenWilliams', 140);
  const pipes = nodes.slice(0, -1).map((node, index) => ({
    id: ctx.nextId('pp'),
    name: `P-${index + 1}`,
    fromId: node.id,
    toId: nodes[index + 1].id,
    diameter,
    hazenWilliams: c,
  }));
  const result = solvePressureNetwork(nodes, pipes, ctx.unit);
  const network = { id: ctx.nextId('pr'), name: text(args, 'name', 'Water'), nodes, pipes, result };
  const summary = [
    ...result.nodes.map((node) => `${node.name}  HGL ${node.hgl.toFixed(2)}  head ${node.pressureHead.toFixed(2)}  ${node.pressureKpa.toFixed(1)} kPa`),
    ...result.flows.map((pipe) => `${pipe.name}  Q ${pipe.flow.toFixed(4)}  V ${pipe.velocity.toFixed(2)}  hf ${pipe.headLoss.toFixed(3)}`),
    ...result.warnings,
  ].join('\n');
  return {
    ok: true,
    status: `${network.name} solved.`,
    summary,
    civil: { ...civil, pressureNetworks: [...civil.pressureNetworks, network] },
    alignments: ctx.alignments,
    addSurfaces: [],
    view: 'plan',
  };
}

function createMassHaul(args: CommandArgs, ctx: CommandContext, civil: CivilModel, surface: SurfaceRecord | null, alignment: AlignmentRecord | null): CommandResult {
  const freeHaul = num(args, 'freeHaul', 50);
  const corridor = civil.corridors[civil.corridors.length - 1];
  let samples: EndAreaSample[] = corridor?.endAreas ?? [];
  let source = corridor ? corridor.name : '';
  if (samples.length < 2) {
    if (!alignment || ctx.surfaces.length < 1) return fail(ctx, 'Mass haul needs a corridor or an alignment across two surfaces.');
    const base = surface ?? ctx.surfaces[0];
    const comparison = ctx.surfaces.find((item) => item.id !== base.id) ?? base;
    samples = surfaceEndAreas(base, comparison, alignment);
    source = `${base.name} to ${comparison.name}`;
  }
  const diagram = massHaul(samples, freeHaul);
  const summary = [
    source,
    `Cut ${diagram.totalCut.toFixed(1)}`,
    `Fill ${diagram.totalFill.toFixed(1)}`,
    `Unbalanced ${diagram.unbalanced.toFixed(1)}`,
    `Free haul ${freeHaul}`,
    ...diagram.lobes.map((lobe, index) => `Lobe ${index + 1} peak ${lobe.peak.toFixed(1)} overhaul ${lobe.overhaul.toFixed(1)}`),
  ].join('\n');
  return {
    ok: diagram.stations.length >= 2,
    status: `Mass haul · cut ${diagram.totalCut.toFixed(0)} · fill ${diagram.totalFill.toFixed(0)}`,
    summary,
    civil: { ...civil, massHaul: diagram },
    alignments: ctx.alignments,
    addSurfaces: [],
    view: 'profile',
    diagram: 'masshaul',
  };
}

function multipleViews(args: CommandArgs, ctx: CommandContext, alignment: AlignmentRecord | null): CommandResult {
  if (!alignment) return fail(ctx, 'Create an alignment before profile sheets.');
  const length = num(args, 'sheetLength', 80);
  const overlap = num(args, 'overlap', 10);
  const solved = solveAlignment(alignment.pis);
  const sheets = Math.max(1, Math.ceil((solved.length - overlap) / Math.max(1, length - overlap)));
  return {
    ok: true,
    status: `${sheets} profile sheet${sheets === 1 ? '' : 's'} of ${length}.`,
    summary: `Sheet length ${length}, overlap ${overlap}. Pick where the sheets go on the plan.`,
    civil: ctx.civil,
    alignments: ctx.alignments,
    activeAlignmentId: alignment.id,
    addSurfaces: [],
    placeView: 'profile',
    profileSheetLength: length,
    profileSheetOverlap: overlap,
    diagram: 'profile',
  };
}

function superimpose(args: CommandArgs, ctx: CommandContext, surface: SurfaceRecord | null, alignment: AlignmentRecord | null): CommandResult {
  if (!alignment || !surface) return fail(ctx, 'Superimpose needs an alignment and a surface.');
  const offset = num(args, 'offset', 6);
  const solved = solveAlignment(alignment.pis);
  const offsetPis = offsetAlignmentPis(solved, offset);
  if (offsetPis.pis.length < 2) return fail(ctx, 'The offset for the superimposed profile failed.');
  const record = alignmentRecord(ctx.nextId('oa'), `${alignment.name} ${offset}`, offsetPis.pis);
  const offsetSolved = solveAlignment(record.pis);
  const profile = surfaceProfile(surface.points, surface.triangles, offsetSolved, 0, 5);
  const source = profile
    .filter((vertex) => vertex.elevation !== null)
    .map((vertex) => {
      const at = pointAtStation(offsetSolved, 0, vertex.station);
      return at && vertex.elevation !== null ? { x: at.x, y: at.y, elevation: vertex.elevation } : null;
    })
    .filter((point): point is { x: number; y: number; elevation: number } => point !== null);
  const samples = superimposeProfile(solved, alignment.startStation, source);
  return {
    ok: samples.length > 1,
    status: `Superimposed ${record.name} on ${alignment.name}.`,
    summary: `${samples.length} stations projected onto ${alignment.name}.`,
    civil: ctx.civil,
    alignments: [...ctx.alignments, record],
    activeAlignmentId: alignment.id,
    addSurfaces: [],
    placeView: 'profile',
    diagram: 'profile',
    superimposed: { name: record.name, color: '#8fd0b3', samples },
  };
}

function runQuickProfile(args: CommandArgs, ctx: CommandContext, surface: SurfaceRecord | null): CommandResult {
  if (text(args, 'mode', 'across') === 'draw') {
    return { ok: true, status: 'Quick profile · click a line, Enter, then pick the insertion point.', summary: 'Click two or more points, then Enter.', civil: ctx.civil, alignments: ctx.alignments, addSurfaces: [], tool: 'quickprofile', view: 'plan' };
  }
  if (!surface) return fail(ctx, 'Quick profile needs a surface.');
  const bounds = boundsOf(surface.points);
  if (!bounds) return fail(ctx, 'The surface has no extent.');
  const y = (bounds.minY + bounds.maxY) / 2;
  const line = [
    { x: bounds.minX, y },
    { x: bounds.maxX, y },
  ];
  const samples = quickProfile(line, ctx.surfaces.filter((item) => item.visible !== false && item.triangles.length > 0), num(args, 'interval', 5));
  const record = alignmentRecord(
    ctx.nextId('qp'),
    'Quick Profile',
    line.map((point) => ({ x: point.x, y: point.y, radius: 0 })),
  );
  const withoutOld = ctx.alignments.filter((item) => item.name !== 'Quick Profile');
  const known = samples.filter((sample) => sample.elevations.some((entry) => entry.elevation !== null));
  return {
    ok: known.length > 1,
    status: `Quick profile · ${known.length} samples.`,
    summary: known.slice(0, 6).map((sample) => `${sample.distance.toFixed(1)}  ${sample.elevations.map((entry) => entry.elevation?.toFixed(2) ?? '—').join(' / ')}`).join('\n'),
    civil: ctx.civil,
    alignments: [...withoutOld, record],
    activeAlignmentId: record.id,
    addSurfaces: [],
    placeView: 'profile',
    diagram: 'profile',
  };
}

export function commitPlanDraft(tool: string, draft: Vec2[], ctx: CommandContext): CommandResult {
  const civil = ctx.civil ?? emptyCivil();
  const surface = activeSurface(ctx);
  const z = elevationOf(surface);
  if (tool === 'featureline') {
    if (draft.length < 2) return fail(ctx, 'A feature line needs at least two points.');
    const line = featureLineFromPlan(draft, z, 0, ctx.nextId('fl'), `FL ${civil.featureLines.length + 1}`);
    return {
      ok: true,
      status: `${line.name} · ${featureLength2d(line).toFixed(1)}`,
      summary: `${line.points.length} vertices.`,
      civil: { ...civil, featureLines: [...civil.featureLines, line] },
      alignments: ctx.alignments,
      addSurfaces: [],
      tool: 'pan',
      view: 'plan',
    };
  }
  if (tool === 'parcel') {
    if (draft.length < 3) return fail(ctx, 'A parcel needs at least three corners.');
    const parcel = buildParcel(ctx.nextId('parcel'), `Parcel ${civil.parcels.length + 1}`, draft);
    return {
      ok: true,
      status: `${parcel.name} · area ${parcel.area.toFixed(1)}`,
      summary: `Perimeter ${parcel.perimeter.toFixed(2)}. Misclosure ${parcel.misclosure.toFixed(3)}.`,
      civil: { ...civil, parcels: [...civil.parcels, parcel] },
      alignments: ctx.alignments,
      addSurfaces: [],
      tool: 'pan',
      view: 'plan',
    };
  }
  if (tool === 'quickprofile') {
    if (draft.length < 2) return fail(ctx, 'A quick profile needs at least two points.');
    const record = alignmentRecord(
      ctx.nextId('qp'),
      'Quick Profile',
      draft.map((point) => ({ x: point.x, y: point.y, radius: 0 })),
    );
    return {
      ok: true,
      status: 'Quick profile.',
      summary: 'Surface profile along the line you drew.',
      civil,
      alignments: [...ctx.alignments.filter((item) => item.name !== 'Quick Profile'), record],
      activeAlignmentId: record.id,
      addSurfaces: [],
      tool: 'pan',
      placeView: 'profile',
      diagram: 'profile',
    };
  }
  return fail(ctx, 'Nothing to finish.');
}
