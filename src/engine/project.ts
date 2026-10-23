import type { AlignmentRecord } from './alignment';
import { parseXrefFile, type XrefFile } from './xref';
import type { CivilModel } from './civilModel';
import { parseCivil } from './civilModel';
import { parseDrawing, type DrawingFile } from './drafting';
import type { DesignPoint, MeshCrossSection } from './meshSection';
import type { LinearUnit, SurfaceStyle, SurveyPoint, Triangle, Vec2 } from './types';
import { defaultSurfaceStyle } from './types';

export type SurfaceKind = 'tin' | 'mesh';

export interface SurfaceRecord {
  id: string;
  name: string;
  visible: boolean;
  source: 'points' | 'landxml' | 'sample';
  sourcePoints: SurveyPoint[];
  points: SurveyPoint[];
  triangles: Triangle[];
  boundary: Vec2[] | null;
  breaklines: SurveyPoint[][];
  maxEdgeLength: number | null;
  style: SurfaceStyle;
  /** Absent on TINs written before 3D mesh support. */
  kind?: SurfaceKind;
  description?: string;
  layer?: string;
  locked?: boolean;
  /** Radii used by ball pivoting. Null means they were chosen from the point spacing. */
  meshRadii?: number[] | null;
  meshOrient?: 'auto' | 'outward' | 'toward-axis';
  meshFillHoles?: number;
}

export interface MeshSectionState {
  surfaceId: string;
  alignmentId: string | null;
  sections: MeshCrossSection[];
  design: DesignPoint[] | null;
}

export function isMeshSurface(surface: { kind?: string | null }): boolean {
  return surface.kind === 'mesh';
}

export interface VolumeSetup {
  baseId: string | null;
  mode: 'surface' | 'datum';
  comparisonId: string | null;
  datum: number;
}

export interface ProjectFile {
  format: 'fieldline-project';
  version: 1;
  name: string;
  unit: LinearUnit;
  activeId: string | null;
  surfaces: SurfaceRecord[];
  volumeSetup: VolumeSetup;
  showVolumeMap: boolean;
  alignments?: AlignmentRecord[];
  activeAlignmentId?: string | null;
  civil?: CivilModel;
  /** Plan entities. Absent in projects saved before the command line. */
  drawing?: DrawingFile;
  /** External references. Absent in projects saved before the xref palette. */
  xrefs?: XrefFile;
  /** Tunnel sections cut through a 3D mesh. Absent in older files. */
  meshSections?: MeshSectionState | null;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function asPoint(value: unknown): SurveyPoint | null {
  if (!value || typeof value !== 'object') return null;
  const point = value as SurveyPoint;
  if (!isNumber(point.x) || !isNumber(point.y) || !isNumber(point.z)) return null;
  return {
    x: point.x,
    y: point.y,
    z: point.z,
    number: typeof point.number === 'string' ? point.number : undefined,
    description: typeof point.description === 'string' ? point.description : undefined,
    role: point.role === 'boundary' || point.role === 'breakline' || point.role === 'survey' ? point.role : 'survey',
  };
}

function asPoints(value: unknown): SurveyPoint[] {
  if (!Array.isArray(value)) return [];
  return value.map(asPoint).filter((point): point is SurveyPoint => point !== null);
}

function asTriangles(value: unknown, count: number): Triangle[] {
  if (!Array.isArray(value)) return [];
  const triangles: Triangle[] = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length < 3) continue;
    const a = item[0];
    const b = item[1];
    const c = item[2];
    if (!isNumber(a) || !isNumber(b) || !isNumber(c)) continue;
    if (a < 0 || b < 0 || c < 0 || a >= count || b >= count || c >= count) continue;
    triangles.push([a, b, c]);
  }
  return triangles;
}

function asRing(value: unknown): Vec2[] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const ring: Vec2[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const point = item as Vec2;
    if (!isNumber(point.x) || !isNumber(point.y)) return null;
    ring.push({ x: point.x, y: point.y });
  }
  return ring;
}

function asStyle(value: unknown, index: number): SurfaceStyle {
  const base = defaultSurfaceStyle(index);
  if (!value || typeof value !== 'object') return base;
  const style = value as Partial<SurfaceStyle>;
  return {
    ...base,
    ...style,
    color: typeof style.color === 'string' ? style.color : base.color,
    opacity: isNumber(style.opacity) ? style.opacity : base.opacity,
    minorInterval: isNumber(style.minorInterval) && style.minorInterval > 0 ? style.minorInterval : base.minorInterval,
    majorInterval: isNumber(style.majorInterval) && style.majorInterval > 0 ? style.majorInterval : base.majorInterval,
    minorColor: typeof style.minorColor === 'string' ? style.minorColor : base.minorColor,
    majorColor: typeof style.majorColor === 'string' ? style.majorColor : base.majorColor,
    showPoints: Boolean(style.showPoints),
    showTriangles: Boolean(style.showTriangles),
    showContours: style.showContours !== false,
    showElevation: Boolean(style.showElevation),
    showSlope: Boolean(style.showSlope),
    contourLabels: style.contourLabels !== false,
  };
}

function meshStyle(style: SurfaceStyle): SurfaceStyle {
  return { ...style, showContours: false, showSlope: false, contourLabels: false };
}

export function serializeProject(project: ProjectFile): string {
  return JSON.stringify(project, null, 2);
}

export function parseProject(text: string): ProjectFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Project file is not valid JSON.');
  }
  if (!data || typeof data !== 'object') throw new Error('Project file is empty.');
  const file = data as Partial<ProjectFile>;
  if (file.format !== 'fieldline-project' || file.version !== 1) {
    throw new Error('This file is not a Civil Design project (version 1).');
  }
  if (!Array.isArray(file.surfaces)) throw new Error('Project is missing its surface list.');
  const surfaces: SurfaceRecord[] = file.surfaces.map((item, index) => {
    const raw = (item ?? {}) as Partial<SurfaceRecord>;
    const points = asPoints(raw.points);
    const sourcePoints = asPoints(raw.sourcePoints);
    const triangles = asTriangles(raw.triangles, points.length);
    const kind = raw.kind === 'mesh' ? 'mesh' : 'tin';
    const style = asStyle(raw.style, index);
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : `surface-${index + 1}`,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : `Surface ${index + 1}`,
      visible: raw.visible !== false,
      source: raw.source === 'landxml' || raw.source === 'sample' ? raw.source : 'points',
      sourcePoints: sourcePoints.length > 0 ? sourcePoints : points.filter((point) => !point.role || point.role === 'survey'),
      points,
      triangles,
      boundary: asRing(raw.boundary),
      breaklines: Array.isArray(raw.breaklines) ? raw.breaklines.map((line) => asPoints(line)).filter((line) => line.length >= 2) : [],
      maxEdgeLength: isNumber(raw.maxEdgeLength) && raw.maxEdgeLength > 0 ? raw.maxEdgeLength : null,
      style: kind === 'mesh' ? meshStyle(style) : style,
      kind,
      description: typeof raw.description === 'string' ? raw.description : '',
      layer: typeof raw.layer === 'string' && raw.layer.trim() ? raw.layer : kind === 'mesh' ? 'MESH' : '0',
      locked: raw.locked === true,
      meshRadii: Array.isArray(raw.meshRadii) ? raw.meshRadii.filter((value) => isNumber(value) && value > 0) : null,
      meshOrient: raw.meshOrient === 'outward' || raw.meshOrient === 'toward-axis' ? raw.meshOrient : 'auto',
      meshFillHoles: isNumber(raw.meshFillHoles) && raw.meshFillHoles >= 3 ? Math.round(raw.meshFillHoles) : 0,
    };
  });
  const setup = file.volumeSetup;
  return {
    format: 'fieldline-project',
    version: 1,
    name: typeof file.name === 'string' && file.name.trim() ? file.name : 'Untitled',
    unit: file.unit === 'ft' ? 'ft' : 'm',
    activeId: typeof file.activeId === 'string' ? file.activeId : surfaces[0]?.id ?? null,
    surfaces,
    volumeSetup: {
      baseId: setup && typeof setup.baseId === 'string' ? setup.baseId : surfaces[0]?.id ?? null,
      mode: setup?.mode === 'datum' ? 'datum' : 'surface',
      comparisonId: setup && typeof setup.comparisonId === 'string' ? setup.comparisonId : surfaces[1]?.id ?? null,
      datum: setup && isNumber(setup.datum) ? setup.datum : 0,
    },
    showVolumeMap: Boolean(file.showVolumeMap),
    alignments: asAlignments(file.alignments),
    activeAlignmentId: typeof file.activeAlignmentId === 'string' ? file.activeAlignmentId : null,
    civil: parseCivil((data as { civil?: unknown }).civil),
    ...(file.drawing && typeof file.drawing === 'object' ? { drawing: parseDrawing(file.drawing) } : {}),
    ...((data as { xrefs?: unknown }).xrefs ? { xrefs: parseXrefFile((data as { xrefs?: unknown }).xrefs) } : {}),
    meshSections: asMeshSections(file.meshSections),
  };
}

function asMeshSections(value: unknown): MeshSectionState | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<MeshSectionState>;
  if (!Array.isArray(raw.sections)) return null;
  const sections = raw.sections.filter((section) => section && typeof section === 'object' && isNumber((section as MeshCrossSection).station) && Array.isArray((section as MeshCrossSection).loops));
  return {
    surfaceId: typeof raw.surfaceId === 'string' ? raw.surfaceId : '',
    alignmentId: typeof raw.alignmentId === 'string' ? raw.alignmentId : null,
    sections,
    design: Array.isArray(raw.design) ? raw.design.filter((point) => point && isNumber(point.offset) && isNumber(point.z)) : null,
  };
}

function asAlignments(value: unknown): AlignmentRecord[] {
  if (!Array.isArray(value)) return [];
  const alignments: AlignmentRecord[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Partial<AlignmentRecord>;
    if (!Array.isArray(raw.pis) || raw.pis.length < 2) continue;
    const pis = raw.pis
      .map((pi) => {
        if (!pi || typeof pi !== 'object') return null;
        const point = pi as AlignmentRecord['pis'][number];
        if (!isNumber(point.x) || !isNumber(point.y)) return null;
        const spiralLength = isNumber(point.spiralLength) && point.spiralLength > 0 ? point.spiralLength : 0;
        return {
          x: point.x,
          y: point.y,
          radius: isNumber(point.radius) && point.radius > 0 ? point.radius : 0,
          ...(spiralLength > 0 ? { spiralLength } : {}),
        };
      })
      .filter((pi): pi is AlignmentRecord['pis'][number] => pi !== null);
    if (pis.length < 2) continue;
    const designProfile = asDesignProfile(raw.designProfile);
    alignments.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id : `alignment-${alignments.length + 1}`,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : `Alignment ${alignments.length + 1}`,
      visible: raw.visible !== false,
      startStation: isNumber(raw.startStation) ? raw.startStation : 0,
      pis,
      labelInterval: positive(raw.labelInterval, 20),
      profileInterval: positive(raw.profileInterval, 5),
      sampleSpacing: positive(raw.sampleSpacing, 20),
      sampleLeft: positive(raw.sampleLeft, 15),
      sampleRight: positive(raw.sampleRight, 15),
      sectionStep: positive(raw.sectionStep, 2),
      showSampleLines: Boolean(raw.showSampleLines),
      ...(designProfile ? { designProfile } : {}),
    });
  }
  return alignments;
}

function asDesignProfile(value: unknown): AlignmentRecord['designProfile'] | undefined {
  if (!Array.isArray(value)) return undefined;
  const pvis: { station: number; elevation: number; curveLength: number }[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const point = item as { station?: unknown; elevation?: unknown; curveLength?: unknown };
    if (!isNumber(point.station) || !isNumber(point.elevation)) continue;
    pvis.push({
      station: point.station,
      elevation: point.elevation,
      curveLength: isNumber(point.curveLength) && point.curveLength > 0 ? point.curveLength : 0,
    });
  }
  return pvis.length >= 2 ? pvis : undefined;
}

function positive(value: unknown, fallback: number): number {
  return isNumber(value) && value > 0 ? value : fallback;
}

export function volumeReportCsv(report: {
  project: string;
  unit: LinearUnit;
  baseName: string;
  comparisonName: string;
  method: string;
  cut: number;
  fill: number;
  net: number;
  cutArea: number;
  fillArea: number;
}): string {
  const volumeUnit = report.unit === 'ft' ? 'ft^3' : 'm^3';
  const areaUnit = report.unit === 'ft' ? 'ft^2' : 'm^2';
  const lines = [
    'Civil Design volume report',
    `Project,${csv(report.project)}`,
    `Method,${csv(report.method)}`,
    `Base surface,${csv(report.baseName)}`,
    `Comparison,${csv(report.comparisonName)}`,
    `Cut volume (${volumeUnit}),${report.cut}`,
    `Fill volume (${volumeUnit}),${report.fill}`,
    `Net volume (${volumeUnit}),${report.net}`,
    `Net meaning,Positive net is net fill (fill minus cut)`,
    `Cut area (${areaUnit}),${report.cutArea}`,
    `Fill area (${areaUnit}),${report.fillArea}`,
  ];
  if (report.unit === 'ft') {
    lines.push(`Cut volume (yd^3),${report.cut / 27}`);
    lines.push(`Fill volume (yd^3),${report.fill / 27}`);
    lines.push(`Net volume (yd^3),${report.net / 27}`);
  }
  lines.push('Note,TIN-to-TIN volumes cover only the plan overlap of the two surfaces.');
  return lines.join('\n') + '\n';
}

function csv(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
