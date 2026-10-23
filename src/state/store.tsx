/* eslint-disable react-refresh/only-export-components -- context module exports the provider, hook, and surface helper */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  alignmentFromPolyline,
  buildTin,
  bvhFor,
  defaultMeshStyle,
  defaultSurfaceStyle,
  elevationAt,
  generateContours,
  isMeshSurface,
  pointAtStation,
  parseLandXml,
  parsePointFile,
  parseProject,
  commitPlanDraft,
  emptyCivil,
  nextPointNumber,
  profileSheets,
  runCivilCommand,
  sampleDesignProfile,
  sampleLinesAlong,
  sectionFromSurface,
  solveAlignment,
  stationTicks,
  suggestContourInterval,
  surfaceProfile,
  depthPoints,
  volumeTinToTin,
  volumeToDatum,
  type AlignmentRecord,
  type CivilModel,
  type DesignPoint,
  type MeshOrient,
  type MeshCrossSection,
  type MeshSectionState,
  type SectionPlane,
  type CommandArgs,
  type CommandResult,
  type ContourPolyline,
  type LinearUnit,
  type ProfileSamplePoint,
  type ProfileVertex,
  type SampleLine,
  type SectionSample,
  type SolvedAlignment,
  type StationTick,
  type SurfaceRecord,
  type SurfaceStyle,
  type SurveyPoint,
  type Triangle,
  type Vec2,
  type VolumeResult,
  type VolumeSetup,
} from '../engine';
import { getDrawingModel, postMessage, readDrawingFile, writeDrawingFile } from '../commands/runtime';
import { emptyXrefs, getXrefDoc, replaceXrefs } from '../engine/xref';
import { hasBvh } from '../engine/bvh';
import { layerTemplate } from '../engine/layers';
import { buildMeshAsync, cancelActiveMesh, MeshCancelled, sectionMeshAsync } from '../engine/meshAsync';
import { isModelLocked, lockMessage } from '../engine/objects';
import { recordSurfaceUndo, stashSurfaceRedo, stashSurfaceUndo, takeSurfaceRedo, takeSurfaceUndo, type SurfaceUndo } from '../engine/surfaceHistory';
import { contoursOffThread, prepareSurface } from '../engine/surfaceWork';
import { tasks } from '../engine/tasks';
import { pictureKey, putPicture } from '../view/pictures';
import existingGroundCsv from '../../public/samples/existing-ground-pnezd.csv?raw';
import proposedPadCsv from '../../public/samples/proposed-pad-pnezd.csv?raw';

export type ViewMode = 'plan' | '3d' | 'split' | 'profile' | 'section';
export type DrawTool = 'pan' | 'boundary' | 'breakline' | 'alignment' | 'featureline' | 'parcel' | 'quickprofile' | 'point' | 'sectionline';
export type SectionLayout = 'single' | 'multiple';

export interface SuperimposedProfile {
  name: string;
  color: string;
  samples: { station: number; elevation: number }[];
}

export interface SurfaceProfileView {
  surfaceId: string;
  name: string;
  color: string;
  vertices: ProfileVertex[];
}

export interface SectionSheet {
  station: number;
  surfaces: { surfaceId: string; name: string; color: string; samples: SectionSample[] }[];
}

export interface AlignmentView {
  record: AlignmentRecord;
  solved: SolvedAlignment;
  ticks: StationTick[];
  profiles: SurfaceProfileView[];
  designSamples: ProfileSamplePoint[];
  sampleLines: SampleLine[];
  sections: SectionSheet[];
}

export interface AppState {
  name: string;
  unit: LinearUnit;
  surfaces: SurfaceRecord[];
  activeId: string | null;
  volumeSetup: VolumeSetup;
  showVolumeMap: boolean;
  volumeResult: VolumeResult | null;
  sampleBanner: boolean;
  booting: boolean;
  status: string;
  tool: DrawTool;
  draft: Vec2[];
  breaklineElevation: string;
  view: ViewMode;
  exaggeration: number;
  fitToken: number;
  volumeBusy: boolean;
  alignments: AlignmentRecord[];
  activeAlignmentId: string | null;
  alignmentRadius: number;
  alignmentSpiral: number;
  sectionLayout: SectionLayout;
  sectionIndex: number;
  civil: CivilModel;
  command: string | null;
  commandSummary: string;
  profileBands: boolean;
  profileSheetLength: number | null;
  profileSheetOverlap: number;
  profileSheetIndex: number;
  diagram: 'profile' | 'masshaul';
  superimposed: SuperimposedProfile | null;
  meshBusy: boolean;
  meshSections: MeshSectionState | null;
}

type Action =
  | { type: 'replace'; state: AppState }
  | { type: 'patch'; patch: Partial<AppState> }
  | { type: 'surfaces'; surfaces: SurfaceRecord[]; activeId?: string | null; clearVolume?: boolean };

function emptyState(): AppState {
  return {
    name: 'Untitled',
    unit: 'm',
    surfaces: [],
    activeId: null,
    volumeSetup: { baseId: null, mode: 'surface', comparisonId: null, datum: 100 },
    showVolumeMap: false,
    volumeResult: null,
    sampleBanner: false,
    booting: true,
    status: 'Loading sample terrain…',
    tool: 'pan',
    draft: [],
    breaklineElevation: '',
    view: 'plan',
    exaggeration: 2,
    fitToken: 1,
    volumeBusy: false,
    alignments: [],
    activeAlignmentId: null,
    alignmentRadius: 40,
    alignmentSpiral: 0,
    sectionLayout: 'single',
    sectionIndex: 0,
    civil: emptyCivil(),
    command: null,
    commandSummary: '',
    profileBands: false,
    profileSheetLength: null,
    profileSheetOverlap: 0,
    profileSheetIndex: 0,
    diagram: 'profile',
    superimposed: null,
    meshBusy: false,
    meshSections: null,
  };
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'replace':
      return action.state;
    case 'patch':
      return { ...state, ...action.patch };
    case 'surfaces':
      return {
        ...state,
        surfaces: action.surfaces,
        activeId: action.activeId === undefined ? state.activeId : action.activeId,
        volumeResult: action.clearVolume ? null : state.volumeResult,
        showVolumeMap: action.clearVolume ? false : state.showVolumeMap,
      };
    default:
      return state;
  }
}

function zRange(points: SurveyPoint[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const point of points) {
    if (point.z < min) min = point.z;
    if (point.z > max) max = point.z;
  }
  if (!Number.isFinite(min)) return { min: 0, max: 0 };
  return { min, max };
}

let sequence = 1;
let meshJob = 0;
let pendingSection: Omit<MeshSectionInput, 'stations' | 'line'> | null = null;

interface MeshBuildInput {
  name: string;
  description: string;
  layer: string;
  color: string;
  locked: boolean;
  points: SurveyPoint[];
  radii: number[] | null;
  orient: MeshOrient;
  maxEdgeLength: number | null;
  fillHoles: number;
}

interface MeshSectionInput {
  surfaceId: string;
  alignmentId: string | null;
  stations: number[];
  line: Vec2[] | null;
  design: DesignPoint[] | null;
  designPolyline: { x: number; y: number; z: number }[] | null;
  place3d: boolean;
}
function nextId(): string {
  sequence += 1;
  return `s-${sequence.toString(36)}`;
}

export function makeSurface(
  name: string,
  sourcePoints: SurveyPoint[],
  options: {
    index?: number;
    source?: SurfaceRecord['source'];
    style?: Partial<SurfaceStyle>;
    triangles?: SurfaceRecord['triangles'];
    points?: SurveyPoint[];
    kind?: 'tin' | 'mesh';
  } = {},
): SurfaceRecord {
  const survey = sourcePoints.some((point) => !point.role)
    ? sourcePoints.map((point) => ({ ...point, role: point.role ?? ('survey' as const) }))
    : sourcePoints;
  const range = zRange(survey);
  const suggested = suggestContourInterval(range.min, range.max);
  const mesh = options.kind === 'mesh';
  const style = {
    ...(mesh ? defaultMeshStyle(options.index ?? 0) : defaultSurfaceStyle(options.index ?? 0)),
    minorInterval: suggested.minor,
    majorInterval: suggested.major,
    ...options.style,
    ...(mesh ? { showContours: false, showSlope: false, contourLabels: false } : {}),
  };
  const provided = options.triangles && options.points && options.triangles.length > 0;
  const tin = mesh
    ? { points: options.points ?? survey, triangles: options.triangles ?? [] }
    : provided
      ? { points: options.points!, triangles: options.triangles! }
      : buildTin(survey);
  return {
    id: nextId(),
    name,
    visible: true,
    source: options.source ?? 'points',
    sourcePoints: survey,
    points: tin.points,
    triangles: tin.triangles,
    boundary: null,
    breaklines: [],
    maxEdgeLength: null,
    style,
    kind: mesh ? 'mesh' : 'tin',
    description: '',
    layer: mesh ? 'MESH' : '0',
    locked: false,
    meshRadii: null,
    meshOrient: 'auto',
    meshFillHoles: 0,
  };
}

function alignmentFromDraft(points: Vec2[], radius: number, spiral: number, index: number, name?: string): { record: AlignmentRecord; status: string } {
  const solved = solveAlignment(alignmentFromPolyline(points, radius, spiral));
  const record: AlignmentRecord = {
    id: nextAlignmentId(),
    name: name ?? `Alignment ${index}`,
    visible: true,
    startStation: 0,
    pis: solved.pis.map((pi, piIndex) => ({
      x: pi.x,
      y: pi.y,
      radius: solved.radii[piIndex] ?? 0,
      spiralLength: solved.spirals[piIndex] ?? 0,
    })),
    labelInterval: 20,
    profileInterval: 5,
    sampleSpacing: 20,
    sampleLeft: 15,
    sampleRight: 15,
    sectionStep: 2,
    showSampleLines: false,
  };
  const length = solved.length.toLocaleString('en-US', { maximumFractionDigits: 1 });
  const warning = solved.warnings[0];
  return { record, status: warning ? `${record.name} · ${length} · ${warning}` : `${record.name} · ${length}` };
}

function sampleAlignment(): AlignmentRecord {
  const draft = solveAlignment([
    { x: 10070, y: 50100, radius: 0 },
    { x: 10140, y: 50120, radius: 50, spiralLength: 15 },
    { x: 10220, y: 50100, radius: 0 },
  ]);
  const end = draft.length;
  return {
    id: nextAlignmentId(),
    name: 'Access',
    visible: true,
    startStation: 0,
    pis: draft.pis.map((pi, index) => ({
      x: pi.x,
      y: pi.y,
      radius: draft.radii[index] ?? 0,
      spiralLength: draft.spirals[index] ?? 0,
    })),
    labelInterval: 40,
    designProfile: [
      { station: 0, elevation: 103.2, curveLength: 0 },
      { station: end / 2, elevation: 107.4, curveLength: Math.min(40, end * 0.28) },
      { station: end, elevation: 102.5, curveLength: 0 },
    ],
    profileInterval: 2,
    sampleSpacing: 20,
    sampleLeft: 15,
    sampleRight: 15,
    sectionStep: 2,
    showSampleLines: true,
  };
}

function nextAlignmentId(): string {
  sequence += 1;
  return `a-${sequence.toString(36)}`;
}

function deriveAlignmentsLite(alignments: AlignmentRecord[], surfaces: SurfaceRecord[]): AlignmentView[] {
  void surfaces;
  return alignments.map((record) => {
    const solved = solveAlignment(record.pis);
    const sampleLines = record.showSampleLines
      ? sampleLinesAlong(solved, record.startStation, record.sampleSpacing, record.sampleLeft, record.sampleRight)
      : [];
    return {
      record,
      solved,
      ticks: record.visible ? stationTicks(solved, record.startStation, record.labelInterval) : [],
      profiles: [],
      designSamples: record.designProfile?.length
        ? sampleDesignProfile(record.designProfile, record.startStation, solved.length, Math.min(record.profileInterval, 2))
        : [],
      sampleLines,
      sections: [],
    };
  });
}

export function deriveAlignments(alignments: AlignmentRecord[], surfaces: SurfaceRecord[]): AlignmentView[] {
  const sources = surfaces.filter((surface) => surface.visible && surface.triangles.length > 0 && !isMeshSurface(surface));
  return alignments.map((record) => {
    const solved = solveAlignment(record.pis);
    const sampleLines = record.showSampleLines
      ? sampleLinesAlong(solved, record.startStation, record.sampleSpacing, record.sampleLeft, record.sampleRight)
      : [];
    return {
      record,
      solved,
      ticks: record.visible ? stationTicks(solved, record.startStation, record.labelInterval) : [],
      profiles: sources.map((surface) => ({
        surfaceId: surface.id,
        name: surface.name,
        color: surface.style.color,
        vertices: surfaceProfile(surface.points, surface.triangles, solved, record.startStation, record.profileInterval),
      })),
      designSamples: record.designProfile?.length
        ? sampleDesignProfile(record.designProfile, record.startStation, solved.length, Math.min(record.profileInterval, 2))
        : [],
      sampleLines,
      sections: sampleLines.map((line) => ({
        station: line.station,
        surfaces: sources.map((surface) => ({
          surfaceId: surface.id,
          name: surface.name,
          color: surface.style.color,
          samples: sectionFromSurface(surface.points, surface.triangles, line, record.sectionStep),
        })),
      })),
    };
  });
}

function rebuild(surface: SurfaceRecord, patch: Partial<Pick<SurfaceRecord, 'boundary' | 'breaklines' | 'maxEdgeLength'>>): SurfaceRecord {
  const boundary = patch.boundary === undefined ? surface.boundary : patch.boundary;
  const breaklines = patch.breaklines === undefined ? surface.breaklines : patch.breaklines;
  const maxEdgeLength = patch.maxEdgeLength === undefined ? surface.maxEdgeLength : patch.maxEdgeLength;
  const tin = buildTin(surface.sourcePoints, { boundary, breaklines, maxEdgeLength });
  return { ...surface, boundary, breaklines, maxEdgeLength, points: tin.points, triangles: tin.triangles };
}

function elevationNear(vertices: ProfileVertex[], station: number): number | null {
  let previous: ProfileVertex | null = null;
  for (const vertex of vertices) {
    if (vertex.elevation === null) {
      previous = null;
      continue;
    }
    if (Math.abs(vertex.station - station) < 1e-6) return vertex.elevation;
    if (previous && previous.elevation !== null && previous.station <= station && vertex.station >= station) {
      const span = vertex.station - previous.station;
      const t = span === 0 ? 0 : (station - previous.station) / span;
      return previous.elevation + (vertex.elevation - previous.elevation) * t;
    }
    previous = vertex;
  }
  return null;
}

function nearestZ(points: SurveyPoint[], x: number, y: number): number {
  let best = points[0]?.z ?? 0;
  let bestD = Infinity;
  for (const point of points) {
    const d = (point.x - x) ** 2 + (point.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = point.z;
    }
  }
  return best;
}

function computeVolume(state: Pick<AppState, 'surfaces' | 'volumeSetup'>): VolumeResult | null {
  const base = state.surfaces.find((surface) => surface.id === state.volumeSetup.baseId);
  if (!base || base.triangles.length === 0) return null;
  if (state.volumeSetup.mode === 'datum') {
    return volumeToDatum(base.points, base.triangles, state.volumeSetup.datum);
  }
  const comparison = state.surfaces.find((surface) => surface.id === state.volumeSetup.comparisonId);
  if (!comparison || comparison.triangles.length === 0) return null;
  return volumeTinToTin(base.points, base.triangles, comparison.points, comparison.triangles);
}

interface ProjectApi {
  state: AppState;
  contours: { id: string; lines: ContourPolyline[] }[];
  design: AlignmentView[];
  activeAlignment: AlignmentView | null;
  active: SurfaceRecord | null;
  setName: (name: string) => void;
  setUnit: (unit: LinearUnit) => void;
  setActive: (id: string) => void;
  toggleVisible: (id: string) => void;
  rename: (id: string, name: string) => void;
  removeSurface: (id: string) => void;
  updateStyle: (id: string, patch: Partial<SurfaceStyle>) => void;
  applyBuild: (id: string, patch: Partial<Pick<SurfaceRecord, 'boundary' | 'breaklines' | 'maxEdgeLength'>>) => void;
  addPoints: (name: string, points: SurveyPoint[], source?: SurfaceRecord['source']) => void;
  addLandXml: (xml: string) => number;
  addImportedMesh: (name: string, points: SurveyPoint[], triangles: Triangle[]) => void;
  loadSample: () => Promise<void>;
  newProject: () => void;
  loadProjectText: (text: string) => void;
  toProjectFile: () => ReturnType<typeof projectSnapshot>;
  setTool: (tool: DrawTool) => void;
  cancelTool: () => void;
  addDraftPoint: (point: Vec2) => void;
  finishTool: () => void;
  setBreaklineElevation: (value: string) => void;
  setVolumeSetup: (patch: Partial<VolumeSetup>) => void;
  runVolume: () => void;
  createVolumeSurface: () => void;
  setShowVolumeMap: (show: boolean) => void;
  setView: (view: ViewMode) => void;
  setExaggeration: (value: number) => void;
  requestFit: () => void;
  dismissSample: () => void;
  setAlignmentRadius: (radius: number) => void;
  setAlignmentSpiral: (length: number) => void;
  createDesignProfile: () => void;
  setActiveAlignment: (id: string) => void;
  toggleAlignmentVisible: (id: string) => void;
  renameAlignment: (id: string, name: string) => void;
  removeAlignment: (id: string) => void;
  alignmentFromBoundary: () => void;
  alignmentFromPoints: (points: Vec2[], name?: string) => void;
  popDraftPoint: () => void;
  prepareAlignment: (mode?: 'layout' | 'tangents' | 'curves' | 'spirals') => void;
  showProfile: () => void;
  showSections: (layout: SectionLayout) => void;
  createSampleLines: () => void;
  stepSection: (delta: number) => void;
  toggleContours: () => void;
  openCommand: (command: string) => void;
  dismissCommand: () => void;
  runCommand: (command: string, args: CommandArgs) => void;
  stepProfileSheet: (delta: number) => void;
  setDiagram: (diagram: 'profile' | 'masshaul') => void;
  addMesh: (input: MeshBuildInput) => void;
  cancelMesh: () => void;
  runMeshSections: (input: MeshSectionInput) => void;
  beginSectionLine: (input: Omit<MeshSectionInput, 'stations' | 'line'>) => void;
  clearMeshSections: () => void;
  undoSurface: () => boolean;
  redoSurface: () => boolean;
  setSurfaceMeta: (id: string, patch: { description?: string; layer?: string; locked?: boolean }) => void;
}

function projectSnapshot(state: AppState) {
  return {
    format: 'fieldline-project' as const,
    version: 1 as const,
    name: state.name,
    unit: state.unit,
    activeId: state.activeId,
    surfaces: state.surfaces,
    volumeSetup: state.volumeSetup,
    showVolumeMap: state.showVolumeMap,
    alignments: state.alignments,
    activeAlignmentId: state.activeAlignmentId,
    civil: state.civil,
    meshSections: state.meshSections,
  };
}

const ProjectContext = createContext<ProjectApi | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, emptyState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const updateSurfaces = useCallback((surfaces: SurfaceRecord[], activeId?: string | null, clearVolume = false) => {
    dispatch({ type: 'surfaces', surfaces, activeId, clearVolume });
  }, []);

  const loadSample = useCallback(async () => {
    dispatch({ type: 'patch', patch: { booting: true, status: 'Loading sample terrain…' } });
    try {
      const existing = parsePointFile(existingGroundCsv, { format: 'PNEZD' });
      const pad = parsePointFile(proposedPadCsv, { format: 'PNEZD' });
      if (existing.points.length < 3 || pad.points.length < 3) {
        throw new Error('Sample files did not contain enough points.');
      }
      const contour = { minorInterval: 0.5, majorInterval: 2 };
      const eg = makeSurface('Existing Ground', existing.points, {
        index: 0,
        source: 'sample',
        style: {
          ...contour,
          showElevation: true,
          showContours: true,
          showTriangles: false,
          showPoints: false,
          color: '#7dbeb8',
          minorColor: '#7dbeb8',
          majorColor: '#f0d78c',
        },
      });
      const fg = makeSurface('Proposed Pad', pad.points, {
        index: 1,
        source: 'sample',
        style: {
          ...contour,
          color: '#e3a23a',
          opacity: 0.92,
          showElevation: false,
          showContours: true,
          showTriangles: true,
          showPoints: false,
          minorColor: '#8eb7ff',
          majorColor: '#ffb25e',
        },
      });
      const volume = volumeTinToTin(eg.points, eg.triangles, fg.points, fg.triangles);
      const alignment = sampleAlignment();
      replaceXrefs(emptyXrefs());
      const current = stateRef.current;
      dispatch({
        type: 'replace',
        state: {
          ...current,
          name: 'Sample site',
          unit: 'm',
          surfaces: [eg, fg],
          activeId: eg.id,
          volumeSetup: { baseId: eg.id, mode: 'surface', comparisonId: fg.id, datum: 100 },
          showVolumeMap: false,
          volumeResult: volume,
          sampleBanner: true,
          booting: false,
          status: `Sample terrain · ${existing.points.length} existing points · ${pad.points.length} pad points`,
          tool: 'pan',
          draft: [],
          fitToken: current.fitToken + 1,
          volumeBusy: false,
          alignments: [alignment],
          activeAlignmentId: alignment.id,
          alignmentRadius: 50,
          alignmentSpiral: 15,
          sectionLayout: 'single',
          sectionIndex: 0,
          civil: emptyCivil(),
          command: null,
          commandSummary: '',
          profileBands: false,
          profileSheetLength: null,
          profileSheetOverlap: 0,
          profileSheetIndex: 0,
          diagram: 'profile',
          superimposed: null,
          meshBusy: false,
          meshSections: null,
        },
      });
      writeDrawingFile(null);
    } catch (error) {
      dispatch({
        type: 'patch',
        patch: {
          booting: false,
          status: error instanceof Error ? error.message : 'Could not load the sample terrain.',
        },
      });
    }
  }, []);

  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void loadSample();
  }, [loadSample]);

  const contourCache = useRef(new Map<string, ContourPolyline[]>());
  const [contourEpoch, setContourEpoch] = useState(0);
  const contourKey = (surface: SurfaceRecord) =>
    `${surface.id}:${surface.triangles.length}:${surface.style.minorInterval}:${surface.style.majorInterval}`;
  const contours = useMemo(
    () =>
      state.surfaces.map((surface) => {
        if (!surface.visible || !surface.style.showContours || surface.triangles.length === 0 || isMeshSurface(surface)) {
          return { id: surface.id, lines: [] as ContourPolyline[] };
        }
        const key = contourKey(surface);
        const cached = contourCache.current.get(key);
        if (cached) return { id: surface.id, lines: cached };
        if (surface.triangles.length > 8_000) return { id: surface.id, lines: [] as ContourPolyline[] };
        const lines = generateContours(surface.points, surface.triangles, surface.style.minorInterval, surface.style.majorInterval, true);
        contourCache.current.set(key, lines);
        return { id: surface.id, lines };
      }),
    [contourEpoch, state.surfaces],
  );

  const heavySurface = state.surfaces.some((surface) => surface.visible && surface.triangles.length > 20_000 && !hasBvh(surface.triangles));
  const design = useMemo(
    () => (heavySurface ? deriveAlignmentsLite(state.alignments, state.surfaces) : deriveAlignments(state.alignments, state.surfaces)),
    [heavySurface, state.alignments, state.surfaces],
  );
  const activeAlignment = design.find((item) => item.record.id === state.activeAlignmentId) ?? design[0] ?? null;
  const designRef = useRef(design);
  designRef.current = design;

  useEffect(() => {
    let cancel = false;
    const pending = state.surfaces.filter((surface) => {
      if (!surface.visible || !surface.style.showContours || isMeshSurface(surface) || surface.triangles.length <= 8_000) return false;
      return !contourCache.current.has(contourKey(surface));
    });
    if (pending.length === 0) return;
    const task = tasks.start({
      command: 'CONTOURS',
      title: `Building contours for "${pending[0].name}"`,
      stages: ['Building contours'],
      blocksInput: false,
    });
    void (async () => {
      for (const surface of pending) {
        if (cancel || task.signal.aborted) break;
        const lines = await contoursOffThread(surface.points, surface.triangles, surface.style.minorInterval, surface.style.majorInterval, task.signal);
        if (cancel || task.signal.aborted) break;
        contourCache.current.set(contourKey(surface), lines);
      }
      if (!cancel && !task.signal.aborted) {
        setContourEpoch((value) => value + 1);
        task.finish();
      }
    })().catch(() => {
      if (!task.signal.aborted) task.finish();
    });
    return () => {
      cancel = true;
    };
  }, [state.surfaces]);

  const api = useMemo<ProjectApi>(() => {
    const patchSurface = (id: string, recipe: (surface: SurfaceRecord) => SurfaceRecord, clearVolume = false) => {
      const current = stateRef.current;
      updateSurfaces(
        current.surfaces.map((surface) => (surface.id === id ? recipe(surface) : surface)),
        current.activeId,
        clearVolume,
      );
    };
    const commitRebuild = (
      surface: SurfaceRecord,
      buildPatch: Partial<Pick<SurfaceRecord, 'boundary' | 'breaklines' | 'maxEdgeLength'>>,
      status: string,
    ) => {
      if (surface.locked) {
        dispatch({ type: 'patch', patch: { status: `${surface.name} is locked.` } });
        return;
      }
      if (isMeshSurface(surface)) {
        dispatch({ type: 'patch', patch: { status: 'A 3D mesh has no breaklines or outer boundary.' } });
        return;
      }
      const boundary = buildPatch.boundary === undefined ? surface.boundary : buildPatch.boundary;
      const breaklines = buildPatch.breaklines === undefined ? surface.breaklines : buildPatch.breaklines;
      const maxEdgeLength = buildPatch.maxEdgeLength === undefined ? surface.maxEdgeLength : buildPatch.maxEdgeLength;
      const apply = (points: SurveyPoint[], triangles: SurfaceRecord['triangles']) => {
        const latest = stateRef.current;
        const currentSurface = latest.surfaces.find((item) => item.id === surface.id) ?? surface;
        recordSurfaceUndo({ op: 'swap', id: surface.id, surface });
        updateSurfaces(
          latest.surfaces.map((item) =>
            item.id === surface.id ? { ...currentSurface, boundary, breaklines, maxEdgeLength, points, triangles } : item,
          ),
          surface.id,
          true,
        );
        dispatch({ type: 'patch', patch: { tool: 'pan', draft: [], status } });
      };
      if (surface.sourcePoints.length >= 25_000) {
        const task = tasks.start({
          command: 'CREATESURFACE',
          title: `Rebuilding TIN surface "${surface.name}" (${surface.sourcePoints.length.toLocaleString()} points)`,
          stages: ['Triangulating', 'Building contours', 'Indexing surface', 'Rendering'],
          blocksInput: false,
        });
        dispatch({ type: 'patch', patch: { status: `Rebuilding ${surface.name}…`, tool: 'pan', draft: [] } });
        void prepareSurface(
          surface.sourcePoints,
          { boundary, breaklines, maxEdgeLength, minor: surface.style.minorInterval, major: surface.style.majorInterval, shade: surface.style.showSlope ? 'slope' : 'elevation' },
          task,
        )
          .then((prepared) => {
            if (task.signal.aborted) return;
            contourCache.current.set(
              `${surface.id}:${prepared.tin.triangles.length}:${surface.style.minorInterval}:${surface.style.majorInterval}`,
              prepared.contours,
            );
            apply(prepared.tin.points, prepared.tin.triangles);
            task.finish();
          })
          .catch((error: unknown) => {
            if (!task.signal.aborted) task.finish();
            dispatch({ type: 'patch', patch: { status: error instanceof Error ? error.message : 'The TIN build failed.' } });
          });
        return;
      }
      const next = rebuild(surface, buildPatch);
      apply(next.points, next.triangles);
    };
    const commandContext = () => {
      const current = stateRef.current;
      return {
        unit: current.unit,
        surfaces: current.surfaces,
        alignments: current.alignments,
        civil: current.civil,
        activeSurfaceId: current.activeId,
        activeAlignmentId: current.activeAlignmentId,
        nextId: (prefix: string) => `${prefix}-${nextId()}`,
      };
    };
    const applyResult = (result: CommandResult) => {
      const current = stateRef.current;
      const created: SurfaceRecord[] = [];
      for (const built of result.addSurfaces) {
        if (built.points.length < 3 && built.triangles.length === 0) continue;
        created.push(
          makeSurface(built.name, built.points, {
            index: current.surfaces.length + created.length,
            source: 'points',
            ...(built.triangles.length > 0 ? { points: built.points, triangles: built.triangles } : {}),
            style: built.style,
          }),
        );
      }
      const surfaces = created.length > 0 ? [...current.surfaces, ...created] : current.surfaces;
      dispatch({
        type: 'patch',
        patch: {
          civil: result.civil,
          alignments: result.alignments,
          ...(result.activeAlignmentId !== undefined ? { activeAlignmentId: result.activeAlignmentId } : {}),
          surfaces,
          ...(created[0] ? { activeId: created[0].id, volumeResult: null, showVolumeMap: false } : {}),
          status: result.status,
          commandSummary: result.summary,
          ...(result.view ? { view: result.view } : {}),
          ...(result.profileBands !== undefined ? { profileBands: result.profileBands } : {}),
          ...(result.profileSheetLength !== undefined ? { profileSheetLength: result.profileSheetLength, profileSheetIndex: 0 } : {}),
          ...(result.profileSheetOverlap !== undefined ? { profileSheetOverlap: result.profileSheetOverlap } : {}),
          ...(result.diagram ? { diagram: result.diagram } : {}),
          ...(result.superimposed !== undefined ? { superimposed: result.superimposed } : {}),
          ...(result.tool ? { tool: result.tool, draft: [] } : {}),
          fitToken: result.ok ? current.fitToken + 1 : current.fitToken,
        },
      });
    };
    const applySurfaceChange = (item: SurfaceUndo): SurfaceUndo | null => {
      const current = stateRef.current;
      if (item.op === 'drop') {
        const index = current.surfaces.findIndex((entry) => entry.id === item.id);
        const surface = index >= 0 ? current.surfaces[index] : item.surface;
        const surfaces = current.surfaces.filter((entry) => entry.id !== item.id);
        dispatch({
          type: 'patch',
          patch: {
            surfaces,
            activeId: current.activeId === item.id ? surfaces[0]?.id ?? null : current.activeId,
            volumeResult: null,
            showVolumeMap: false,
            status: `Removed ${surface.name}.`,
          },
        });
        return { op: 'insert', index: index >= 0 ? index : item.index, surface };
      }
      if (item.op === 'insert') {
        const surfaces = current.surfaces.slice();
        const index = Math.min(Math.max(0, item.index), surfaces.length);
        surfaces.splice(index, 0, item.surface);
        dispatch({
          type: 'patch',
          patch: {
            surfaces,
            activeId: item.surface.id,
            volumeResult: null,
            showVolumeMap: false,
            status: `Restored ${item.surface.name}.`,
          },
        });
        return { op: 'drop', id: item.surface.id, index, surface: item.surface };
      }
      if (item.op === 'swap') {
        const index = current.surfaces.findIndex((entry) => entry.id === item.id);
        if (index < 0) return item;
        const previous = current.surfaces[index];
        const surfaces = current.surfaces.slice();
        surfaces[index] = item.surface;
        dispatch({
          type: 'patch',
          patch: {
            surfaces,
            activeId: item.surface.id,
            volumeResult: null,
            showVolumeMap: false,
            status: `Restored ${item.surface.name}.`,
          },
        });
        return { op: 'swap', id: item.id, surface: previous };
      }
      dispatch({
        type: 'patch',
        patch: {
          meshSections: item.value,
          sectionIndex: 0,
          view: item.value ? 'section' : current.view,
          status: item.value ? 'Mesh sections restored.' : 'Mesh sections cleared.',
        },
      });
      return { op: 'sections', value: current.meshSections };
    };
    const placeSectionPolylines = (sections: MeshCrossSection[]) => {
      const model = getDrawingModel();
      model.checkpoint();
      if (!model.layer('MESH-SECTION')) {
        model.doc.layers.push(layerTemplate('MESH-SECTION', 2));
      }
      for (const section of sections) {
        for (const loop of section.loops) {
          if (loop.points.length < 2) continue;
          model.add({
            id: model.nextId(),
            type: 'polyline',
            layer: 'MESH-SECTION',
            color: '#f0d78c',
            closed: loop.closed,
            vertices: loop.points.map((point) => ({ x: point.x, y: point.y, z: point.z, bulge: 0 })),
          });
        }
      }
      model.emit();
    };
    const cutMesh = (input: MeshSectionInput) => {
      const current = stateRef.current;
      const surface = current.surfaces.find((item) => item.id === input.surfaceId);
      if (!surface || !isMeshSurface(surface)) {
        dispatch({ type: 'patch', patch: { status: 'Mesh sections need a 3D mesh.' } });
        return;
      }
      if (surface.triangles.length === 0) {
        dispatch({ type: 'patch', patch: { status: `${surface.name} has no triangles.` } });
        return;
      }
      const planes: SectionPlane[] = [];
      if (input.line && input.line.length >= 2) {
        const a = input.line[0];
        const b = input.line[1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-9) {
          dispatch({ type: 'patch', patch: { status: 'The section line is too short.' } });
          return;
        }
        planes.push({
          ox: a.x,
          oy: a.y,
          oz: 0,
          nx: dx / len,
          ny: dy / len,
          nz: 0,
          rx: dy / len,
          ry: -dx / len,
          rz: 0,
          station: 0,
        });
      } else if (input.alignmentId) {
        const alignment = current.alignments.find((item) => item.id === input.alignmentId);
        if (!alignment) {
          dispatch({ type: 'patch', patch: { status: 'Select an alignment for the stations.' } });
          return;
        }
        const solved = solveAlignment(alignment.pis);
        for (const station of input.stations) {
          const at = pointAtStation(solved, alignment.startStation, station);
          if (!at) continue;
          const len = Math.hypot(at.tx, at.ty) || 1;
          planes.push({
            ox: at.x,
            oy: at.y,
            oz: 0,
            nx: at.tx / len,
            ny: at.ty / len,
            nz: 0,
            rx: at.ty / len,
            ry: -at.tx / len,
            rz: 0,
            station,
          });
        }
      }
      if (planes.length === 0) {
        dispatch({ type: 'patch', patch: { status: 'No section planes fell on the alignment.' } });
        return;
      }
      let design = input.design;
      if (input.designPolyline && input.designPolyline.length >= 3) {
        const plane = planes[0];
        design = input.designPolyline.map((point) => ({
          offset: (point.x - plane.ox) * plane.rx + (point.y - plane.oy) * plane.ry + (point.z - plane.oz) * plane.rz,
          z: point.z,
        }));
      }
      const job = ++meshJob;
      dispatch({ type: 'patch', patch: { meshBusy: true, status: `Cutting ${planes.length} section${planes.length === 1 ? '' : 's'}…` } });
      void sectionMeshAsync(surface.points, surface.triangles, planes, design)
        .then((sections) => {
          if (job !== meshJob) return;
          if (input.place3d) placeSectionPolylines(sections);
          recordSurfaceUndo({ op: 'sections', value: stateRef.current.meshSections });
          const closed = sections.reduce((sum, section) => sum + section.loops.filter((loop) => loop.closed).length, 0);
          dispatch({
            type: 'patch',
            patch: {
              meshBusy: false,
              meshSections: { surfaceId: surface.id, alignmentId: input.alignmentId, sections, design },
              sectionIndex: 0,
              sectionLayout: sections.length > 1 ? 'multiple' : 'single',
              view: 'section',
              activeId: surface.id,
              status: `${sections.length} section${sections.length === 1 ? '' : 's'} · ${closed} closed loop${closed === 1 ? '' : 's'}.`,
            },
          });
        })
        .catch((error: unknown) => {
          if (job !== meshJob) return;
          dispatch({
            type: 'patch',
            patch: {
              meshBusy: false,
              status: error instanceof MeshCancelled ? 'Mesh section cancelled.' : error instanceof Error ? error.message : 'Mesh section failed.',
            },
          });
        });
    };
    const refuseLocked = (key: string) => {
      if (!isModelLocked(getDrawingModel().doc, key)) return false;
      const message = lockMessage(1);
      postMessage(message);
      dispatch({ type: 'patch', patch: { status: message } });
      return true;
    };
    return {
      state,
      contours,
      design,
      activeAlignment,
      active: state.surfaces.find((surface) => surface.id === state.activeId) ?? null,
      setName: (name) => dispatch({ type: 'patch', patch: { name } }),
      setUnit: (unit) => dispatch({ type: 'patch', patch: { unit } }),
      setActive: (id) => dispatch({ type: 'patch', patch: { activeId: id } }),
      toggleVisible: (id) => patchSurface(id, (surface) => ({ ...surface, visible: !surface.visible })),
      rename: (id, name) => patchSurface(id, (surface) => ({ ...surface, name })),
      removeSurface: (id) => {
        if (refuseLocked(`surface:${id}`)) return;
        const current = stateRef.current;
        const index = current.surfaces.findIndex((surface) => surface.id === id);
        const removed = current.surfaces[index];
        if (!removed) return;
        if (removed.locked) {
          dispatch({ type: 'patch', patch: { status: `${removed.name} is locked.` } });
          return;
        }
        recordSurfaceUndo({ op: 'insert', index, surface: removed });
        const surfaces = current.surfaces.filter((surface) => surface.id !== id);
        const activeId = current.activeId === id ? surfaces[0]?.id ?? null : current.activeId;
        const volumeSetup = {
          ...current.volumeSetup,
          baseId: current.volumeSetup.baseId === id ? surfaces[0]?.id ?? null : current.volumeSetup.baseId,
          comparisonId: current.volumeSetup.comparisonId === id ? surfaces[1]?.id ?? surfaces[0]?.id ?? null : current.volumeSetup.comparisonId,
        };
        dispatch({
          type: 'patch',
          patch: { surfaces, activeId, volumeSetup, volumeResult: null, showVolumeMap: false, status: 'Surface deleted.' },
        });
      },
      updateStyle: (id, stylePatch) => {
        if (refuseLocked(`surface:${id}`)) return;
        patchSurface(id, (surface) => {
          const style = { ...surface.style, ...stylePatch };
          if (isMeshSurface(surface)) {
            style.showContours = false;
            style.showSlope = false;
            style.contourLabels = false;
          }
          return { ...surface, style };
        });
      },
      applyBuild: (id, buildPatch) => {
        if (refuseLocked(`surface:${id}`)) return;
        const current = stateRef.current;
        const surface = current.surfaces.find((item) => item.id === id);
        if (!surface) return;
        commitRebuild(surface, buildPatch, 'Surface rebuilt.');
      },
      addPoints: (name, points, source = 'points') => {
        const range = zRange(points);
        const suggested = suggestContourInterval(range.min, range.max);
        const task = tasks.start({
          command: 'CREATESURFACE',
          title: `Building TIN surface "${name}" (${points.length.toLocaleString()} points)`,
          stages: ['Triangulating', 'Building contours', 'Indexing surface', 'Rendering'],
          blocksInput: false,
        });
        void prepareSurface(points, { minor: suggested.minor, major: suggested.major, shade: 'elevation' }, task)
          .then((prepared) => {
            if (task.signal.aborted) return;
            const current = stateRef.current;
            const surface = makeSurface(name, prepared.tin.points, {
              index: current.surfaces.length,
              source,
              points: prepared.tin.points,
              triangles: prepared.tin.triangles,
              style: { minorInterval: suggested.minor, majorInterval: suggested.major, showElevation: true, showContours: true },
            });
            recordSurfaceUndo({ op: 'drop', id: surface.id, index: current.surfaces.length, surface });
            contourCache.current.set(contourKey(surface), prepared.contours);
            if (prepared.field && prepared.pixels) {
              putPicture(pictureKey(surface.id, surface.triangles.length, 'elevation', suggested.minor, suggested.major), prepared.pixels, prepared.field);
            }
            const surfaces = [...current.surfaces, surface];
            dispatch({
              type: 'patch',
              patch: {
                surfaces,
                activeId: surface.id,
                volumeResult: null,
                showVolumeMap: false,
                sampleBanner: false,
                fitToken: current.fitToken + 1,
                status: `${surface.name} · ${points.length.toLocaleString()} points · ${surface.triangles.length.toLocaleString()} triangles`,
                volumeSetup: {
                  ...current.volumeSetup,
                  baseId: current.volumeSetup.baseId ?? surface.id,
                  comparisonId: current.volumeSetup.comparisonId ?? (surfaces.length > 1 ? surface.id : null),
                },
              },
            });
            task.finish();
          })
          .catch((error: unknown) => {
            if (task.signal.aborted) return;
            task.finish();
            dispatch({
              type: 'patch',
              patch: { status: error instanceof Error ? error.message : 'The TIN build failed.' },
            });
          });
      },
      addLandXml: (xml) => {
        const read = parseLandXml(xml);
        const current = stateRef.current;
        const created: SurfaceRecord[] = [];
        for (const item of read.surfaces) {
          created.push(
            makeSurface(item.name, item.points, {
              index: current.surfaces.length + created.length,
              source: 'landxml',
              triangles: item.triangles,
              points: item.points,
            }),
          );
        }
        for (const group of read.pointGroups) {
          created.push(makeSurface(group.name, group.points, { index: current.surfaces.length + created.length, source: 'landxml' }));
        }
const alignments = read.alignments.map((item) => ({
          id: nextId(),
          name: item.name,
          visible: true,
          startStation: item.startStation,
          pis: item.pis.map((pi) => ({ x: pi.x, y: pi.y, radius: 0 })),
          labelInterval: 20,
          profileInterval: 10,
          sampleSpacing: 10,
          sampleLeft: 10,
          sampleRight: 10,
          sectionStep: 1,
          showSampleLines: false,
          ...(item.profile.length
            ? { designProfile: item.profile.map((pvi) => ({ station: pvi.station, elevation: pvi.elevation, curveLength: 0 })) }
            : {}),
        }));
        if (created.length === 0 && alignments.length === 0) throw new Error('No TIN surfaces, CgPoints, or alignments were found in that LandXML file.');
        for (let i = created.length - 1; i >= 0; i--) {
          recordSurfaceUndo({ op: 'drop', id: created[i].id, index: current.surfaces.length + i, surface: created[i] });
        }
        const surfaces = [...current.surfaces, ...created];
        dispatch({
          type: 'patch',
          patch: {
            surfaces,
            alignments: [...current.alignments, ...alignments],
            activeAlignmentId: current.activeAlignmentId ?? alignments[0]?.id ?? null,
            activeId: created[0]?.id ?? current.activeId,
            volumeResult: null,
            showVolumeMap: false,
            sampleBanner: false,
            fitToken: current.fitToken + 1,
            status: `Imported ${created.length} surface${created.length === 1 ? '' : 's'} and ${alignments.length} alignment${alignments.length === 1 ? '' : 's'} from LandXML.`,
            volumeSetup: {
              ...current.volumeSetup,
              baseId: current.volumeSetup.baseId ?? created[0]?.id ?? current.volumeSetup.baseId,
            },
          },
        });
        return created.length;
      },
      addImportedMesh: (name, points, triangles) => {
        if (points.length < 3 || triangles.length === 0) {
          dispatch({ type: 'patch', patch: { status: 'That mesh has no triangles.' } });
          return;
        }
        const current = stateRef.current;
        const surface = makeSurface(name, points, {
          index: current.surfaces.length,
          kind: 'mesh',
          points,
          triangles,
          source: 'points',
        });
        recordSurfaceUndo({ op: 'drop', id: surface.id, index: current.surfaces.length, surface });
        dispatch({
          type: 'patch',
          patch: {
            surfaces: [...current.surfaces, surface],
            activeId: surface.id,
            sampleBanner: false,
            volumeResult: null,
            showVolumeMap: false,
            fitToken: current.fitToken + 1,
            view: '3d',
            status: `${surface.name} · ${points.length.toLocaleString()} vertices · ${triangles.length.toLocaleString()} triangles`,
          },
        });
      },
      loadSample,
      newProject: () => {
        const current = stateRef.current;
        dispatch({
          type: 'replace',
          state: {
            ...emptyState(),
            booting: false,
            status: 'New project.',
            fitToken: current.fitToken + 1,
            view: current.view,
            exaggeration: current.exaggeration,
          },
        });
        writeDrawingFile(null);
        replaceXrefs(emptyXrefs());
      },
      loadProjectText: (text) => {
        const task = tasks.start({
          command: 'OPEN',
          title: 'Opening project',
          stages: ['Reading project'],
          blocksInput: true,
        });
        const file = parseProject(text);
        task.finish();
        const volume = file.showVolumeMap ? computeVolume(file) : null;
        const current = stateRef.current;
        dispatch({
          type: 'replace',
          state: {
            ...emptyState(),
            name: file.name,
            unit: file.unit,
            surfaces: file.surfaces,
            activeId: file.activeId,
            volumeSetup: file.volumeSetup,
            showVolumeMap: file.showVolumeMap,
            volumeResult: volume,
            alignments: file.alignments ?? [],
            activeAlignmentId: file.activeAlignmentId ?? file.alignments?.[0]?.id ?? null,
            civil: file.civil ?? emptyCivil(),
            sampleBanner: false,
            booting: false,
            status: `Opened ${file.name}.`,
            view: current.view,
            exaggeration: current.exaggeration,
            fitToken: current.fitToken + 1,
            meshSections: file.meshSections ?? null,
          },
        });
        writeDrawingFile(file.drawing ?? null);
        replaceXrefs(file.xrefs ?? emptyXrefs());
      },
      toProjectFile: () => {
        const xrefs = getXrefDoc();
        return {
          ...projectSnapshot(stateRef.current),
          drawing: readDrawingFile(),
          ...(xrefs.records.length > 0 ? { xrefs } : {}),
        };
      },
      setTool: (tool) => {
        const current = stateRef.current;
        if ((tool === 'boundary' || tool === 'breakline') && !current.activeId) {
          dispatch({ type: 'patch', patch: { status: 'Select a surface first.' } });
          return;
        }
        const status =
          tool === 'pan'
            ? current.status
            : tool === 'boundary'
              ? 'Outer boundary · click points, Enter to close.'
              : tool === 'breakline'
                ? 'Breakline · click points, Enter to finish.'
                : tool === 'featureline'
                  ? 'Feature line · click points, Enter to finish. Elevations come from the active surface.'
                  : tool === 'parcel'
                    ? 'Parcel · click the lot corners, Enter to close.'
                    : tool === 'quickprofile'
                      ? 'Quick profile · click a line, Enter to open it.'
                      : tool === 'point'
                        ? 'Point · click to place. Elevation comes from the active surface.'
                        : tool === 'sectionline'
                          ? 'Section line · click two points. The plane is vertical.'
                          : 'Alignment · click PIs, Enter to finish. Radius and spiral length apply at each interior PI.';
        const drawing = tool !== 'pan';
        dispatch({
          type: 'patch',
          patch: { tool, draft: [], view: drawing ? 'plan' : current.view, status },
        });
      },
      cancelTool: () => {
        pendingSection = null;
        dispatch({ type: 'patch', patch: { tool: 'pan', draft: [], status: 'Tool cancelled.' } });
      },
      addDraftPoint: (point) => {
        const current = stateRef.current;
        if (current.tool === 'point') {
          const surface =
            current.surfaces.find((item) => item.id === current.activeId && item.triangles.length > 0) ??
            current.surfaces.find((item) => item.triangles.length > 0);
          const z = surface
            ? elevationAt(surface.points, surface.triangles, point.x, point.y, bvhFor(surface.points, surface.triangles)) ?? 0
            : 0;
          const number = nextPointNumber(current.civil.points);
          const created = { id: `pt-${nextId()}`, number, x: point.x, y: point.y, z, description: 'MAN' };
          dispatch({
            type: 'patch',
            patch: {
              civil: { ...current.civil, points: [...current.civil.points, created] },
              status: `Point ${number} · Z ${z.toFixed(3)}`,
              commandSummary: `Point ${number}  E ${point.x.toFixed(3)}  N ${point.y.toFixed(3)}  Z ${z.toFixed(3)}\nKeep clicking. Esc finishes.`,
            },
          });
          return;
        }
        const last = current.draft[current.draft.length - 1];
        if (last && Math.hypot(last.x - point.x, last.y - point.y) < 1e-6) return;
        if (current.tool === 'sectionline') {
          const next = [...current.draft, point];
          if (next.length < 2) {
            dispatch({ type: 'patch', patch: { draft: next, status: 'Section line · click the second point.' } });
            return;
          }
          const request = pendingSection;
          pendingSection = null;
          dispatch({ type: 'patch', patch: { tool: 'pan', draft: [] } });
          if (request) cutMesh({ ...request, stations: [], line: next });
          return;
        }
        dispatch({ type: 'patch', patch: { draft: [...current.draft, point] } });
      },
      popDraftPoint: () => {
        const current = stateRef.current;
        if (current.draft.length === 0) return;
        dispatch({ type: 'patch', patch: { draft: current.draft.slice(0, -1) } });
      },
      prepareAlignment: (mode = 'layout') => {
        const current = stateRef.current;
        const radius = current.alignmentRadius > 0 ? current.alignmentRadius : 40;
        const spiral = current.alignmentSpiral > 0 ? current.alignmentSpiral : 25;
        if (mode === 'tangents') dispatch({ type: 'patch', patch: { alignmentRadius: 0, alignmentSpiral: 0 } });
        if (mode === 'curves') dispatch({ type: 'patch', patch: { alignmentRadius: radius, alignmentSpiral: 0 } });
        if (mode === 'spirals') dispatch({ type: 'patch', patch: { alignmentRadius: radius, alignmentSpiral: spiral } });
        if (mode === 'layout' && current.alignmentRadius <= 0) dispatch({ type: 'patch', patch: { alignmentRadius: 40 } });
      },
      finishTool: () => {
        const current = stateRef.current;
        if (current.tool === 'sectionline') {
          dispatch({ type: 'patch', patch: { status: 'A section line needs two points.' } });
          return;
        }
        if (current.tool === 'featureline' || current.tool === 'parcel' || current.tool === 'quickprofile') {
          applyResult(commitPlanDraft(current.tool, current.draft, commandContext()));
          return;
        }
        if (current.tool === 'alignment') {
          if (current.draft.length < 2) {
            dispatch({ type: 'patch', patch: { status: 'An alignment needs at least two PIs.' } });
            return;
          }
          const created = alignmentFromDraft(current.draft, current.alignmentRadius, current.alignmentSpiral, current.alignments.length + 1);
          dispatch({
            type: 'patch',
            patch: {
              alignments: [...current.alignments, created.record],
              activeAlignmentId: created.record.id,
              tool: 'pan',
              draft: [],
              view: 'plan',
              status: created.status,
            },
          });
          return;
        }
        const surface = current.surfaces.find((item) => item.id === current.activeId);
        if (!surface || current.tool === 'pan') {
          dispatch({ type: 'patch', patch: { tool: 'pan', draft: [] } });
          return;
        }
        if (current.tool === 'boundary') {
          if (current.draft.length < 3) {
            dispatch({ type: 'patch', patch: { status: 'A boundary needs at least 3 points.' } });
            return;
          }
          commitRebuild(surface, { boundary: current.draft }, `Boundary applied to ${surface.name}.`);
          return;
        }
        if (current.draft.length < 2) {
          dispatch({ type: 'patch', patch: { status: 'A breakline needs at least 2 points.' } });
          return;
        }
        const override = current.breaklineElevation.trim();
        const fixed = override === '' ? null : Number(override);
        if (fixed !== null && !Number.isFinite(fixed)) {
          dispatch({ type: 'patch', patch: { status: 'Breakline elevation is not a number.' } });
          return;
        }
        const line: SurveyPoint[] = current.draft.map((point, index) => ({
          x: point.x,
          y: point.y,
          z: fixed ?? elevationAt(surface.points, surface.triangles, point.x, point.y, bvhFor(surface.points, surface.triangles)) ?? nearestZ(surface.sourcePoints, point.x, point.y),
          description: 'BREAK',
          number: `BL${index + 1}`,
          role: 'breakline',
        }));
        commitRebuild(surface, { breaklines: [...surface.breaklines, line] }, `Breakline added to ${surface.name}.`);
      },
      setBreaklineElevation: (value) => dispatch({ type: 'patch', patch: { breaklineElevation: value } }),
      setVolumeSetup: (setupPatch) => {
        const current = stateRef.current;
        dispatch({ type: 'patch', patch: { volumeSetup: { ...current.volumeSetup, ...setupPatch }, volumeResult: null } });
      },
      createVolumeSurface: () => {
        const current = stateRef.current;
        const tins = current.surfaces.filter((surface) => !isMeshSurface(surface) && surface.triangles.length > 0 && surface.points.length >= 3);
        const base = tins.find((surface) => surface.id === current.volumeSetup.baseId) ?? tins.find((surface) => surface.id === current.activeId) ?? tins[0];
        if (!base) {
          dispatch({ type: 'patch', patch: { status: 'Create a TIN surface before a volume surface.' } });
          return;
        }
        const named = current.volumeSetup.comparisonId ? tins.find((surface) => surface.id === current.volumeSetup.comparisonId && surface.id !== base.id) : undefined;
        const other = named ?? tins.find((surface) => surface.id !== base.id);
        const useDatum = current.volumeSetup.mode === 'datum' || !other;
        const datum = current.volumeSetup.datum;
        const points = depthPoints(base.points, (x, y) => (useDatum || !other ? datum : elevationAt(other.points, other.triangles, x, y)));
        if (points.length < 3) {
          dispatch({ type: 'patch', patch: { status: 'The surfaces do not overlap, so there is no volume surface.' } });
          return;
        }
        const name = useDatum || !other ? `Volume ${base.name}` : `Volume ${base.name} - ${other.name}`;
        const created = makeSurface(name, points, { index: current.surfaces.length, source: 'points', style: { showElevation: true, showContours: true } });
        const result = useDatum || !other ? volumeToDatum(base.points, base.triangles, datum) : volumeTinToTin(base.points, base.triangles, other.points, other.triangles);
        dispatch({
          type: 'patch',
          patch: {
            surfaces: [...current.surfaces, created],
            activeId: created.id,
            volumeResult: result,
            showVolumeMap: result.cutArea + result.fillArea > 0,
            volumeSetup: {
              ...current.volumeSetup,
              baseId: base.id,
              mode: useDatum || !other ? 'datum' : 'surface',
              comparisonId: other && !useDatum ? other.id : current.volumeSetup.comparisonId,
            },
            view: 'plan',
            status: `Volume surface "${created.name}": cut ${Math.round(result.cut).toLocaleString()} · fill ${Math.round(result.fill).toLocaleString()}.`,
            fitToken: current.fitToken + 1,
          },
        });
      },
      runVolume: () => {
        const task = tasks.start({
          command: 'VOLUME',
          title: 'Computing earthwork volume',
          stages: ['Computing volume'],
          blocksInput: false,
        });
        dispatch({ type: 'patch', patch: { volumeBusy: true, status: 'Computing volume…' } });
        window.setTimeout(() => {
          const latest = stateRef.current;
          const base = latest.surfaces.find((surface) => surface.id === latest.volumeSetup.baseId);
          const comparison = latest.surfaces.find((surface) => surface.id === latest.volumeSetup.comparisonId);
          if ((base && isMeshSurface(base)) || (latest.volumeSetup.mode === 'surface' && comparison && isMeshSurface(comparison))) {
            dispatch({ type: 'patch', patch: { volumeBusy: false, status: 'Volume uses TIN surfaces. A 3D mesh is not a height field.' } });
            return;
          }
          const result = computeVolume(latest);
          task.finish();
          if (!result) {
            dispatch({ type: 'patch', patch: { volumeBusy: false, status: 'Choose a base surface and a comparison.' } });
            return;
          }
          const overlap = result.cutArea + result.fillArea;
          dispatch({
            type: 'patch',
            patch: {
              volumeBusy: false,
              volumeResult: result,
              showVolumeMap: overlap > 0,
              status:
                overlap <= 0
                  ? 'Volume is zero — the surfaces do not overlap in plan.'
                  : `Cut ${Math.round(result.cut).toLocaleString()} · fill ${Math.round(result.fill).toLocaleString()}`,
            },
          });
        }, 30);
      },
      setShowVolumeMap: (show) => dispatch({ type: 'patch', patch: { showVolumeMap: show } }),
      setView: (view) => dispatch({ type: 'patch', patch: { view } }),
      setExaggeration: (value) => dispatch({ type: 'patch', patch: { exaggeration: value } }),
      requestFit: () => {
        const current = stateRef.current;
        dispatch({ type: 'patch', patch: { fitToken: current.fitToken + 1 } });
      },
      dismissSample: () => dispatch({ type: 'patch', patch: { sampleBanner: false } }),
      setAlignmentRadius: (radius) => {
        if (!Number.isFinite(radius) || radius < 0) return;
        dispatch({ type: 'patch', patch: { alignmentRadius: radius } });
      },
      setAlignmentSpiral: (length) => {
        if (!Number.isFinite(length) || length < 0) return;
        dispatch({ type: 'patch', patch: { alignmentSpiral: length } });
      },
      createDesignProfile: () => {
        const current = stateRef.current;
        const alignment = current.alignments.find((item) => item.id === current.activeAlignmentId) ?? current.alignments[0];
        if (alignment && refuseLocked(`profile:${alignment.id}`)) return;
        const view = designRef.current.find((item) => item.record.id === alignment?.id);
        if (!alignment || !view) {
          dispatch({ type: 'patch', patch: { status: 'Create an alignment before a layout profile.' } });
          return;
        }
        const surface =
          current.surfaces.find((item) => item.id === current.activeId && item.visible && item.triangles.length > 0) ??
          current.surfaces.find((item) => item.visible && item.triangles.length > 0);
        const profile = view.profiles.find((item) => item.surfaceId === surface?.id) ?? view.profiles[0];
        const samples = profile?.vertices.filter((vertex) => vertex.elevation !== null) ?? [];
        if (!profile || samples.length < 2) {
          dispatch({ type: 'patch', patch: { status: 'The alignment does not cross a visible surface.' } });
          return;
        }
        const first = samples[0];
        const last = samples[samples.length - 1];
        const midStation = (first.station + last.station) / 2;
        const mid = elevationNear(profile.vertices, midStation);
        if (first.elevation === null || last.elevation === null || mid === null) {
          dispatch({ type: 'patch', patch: { status: 'The surface profile is too sparse for a vertical curve.' } });
          return;
        }
        const span = last.station - first.station;
        const designProfile = [
          { station: first.station, elevation: first.elevation, curveLength: 0 },
          { station: midStation, elevation: mid + 1, curveLength: Math.min(40, span * 0.35) },
          { station: last.station, elevation: last.elevation, curveLength: 0 },
        ];
        dispatch({
          type: 'patch',
          patch: {
            alignments: current.alignments.map((item) => (item.id === alignment.id ? { ...item, designProfile } : item)),
            activeAlignmentId: alignment.id,
            view: 'profile',
            fitToken: current.fitToken + 1,
            status: `Layout profile on ${alignment.name}. Crest is 1 ${current.unit} above ${profile.name} at mid-station.`,
          },
        });
      },
      setActiveAlignment: (id) => dispatch({ type: 'patch', patch: { activeAlignmentId: id, sectionIndex: 0 } }),
      toggleAlignmentVisible: (id) => {
        const current = stateRef.current;
        dispatch({
          type: 'patch',
          patch: {
            alignments: current.alignments.map((item) => (item.id === id ? { ...item, visible: !item.visible } : item)),
          },
        });
      },
      renameAlignment: (id, name) => {
        const current = stateRef.current;
        dispatch({
          type: 'patch',
          patch: {
            alignments: current.alignments.map((item) => (item.id === id ? { ...item, name } : item)),
          },
        });
      },
      removeAlignment: (id) => {
        if (refuseLocked(`alignment:${id}`)) return;
        const current = stateRef.current;
        const alignments = current.alignments.filter((item) => item.id !== id);
        dispatch({
          type: 'patch',
          patch: {
            alignments,
            activeAlignmentId: current.activeAlignmentId === id ? alignments[0]?.id ?? null : current.activeAlignmentId,
            sectionIndex: 0,
            status: 'Alignment deleted.',
          },
        });
      },
      alignmentFromBoundary: () => {
        const current = stateRef.current;
        const surface = current.surfaces.find((item) => item.id === current.activeId);
        const ring = surface?.boundary;
        if (!ring || ring.length < 2) {
          dispatch({
            type: 'patch',
            patch: {
              tool: 'alignment',
              draft: [],
              view: 'plan',
              status: 'No boundary on the active surface. Click the polyline vertices, then Enter.',
            },
          });
          return;
        }
        let points = ring.map((point) => ({ x: point.x, y: point.y }));
        const first = points[0];
        const last = points[points.length - 1];
        if (points.length > 2 && Math.hypot(first.x - last.x, first.y - last.y) < 1e-4) points = points.slice(0, -1);
        if (points.length < 2) {
          dispatch({ type: 'patch', patch: { status: 'That boundary is too short to become an alignment.' } });
          return;
        }
        const created = alignmentFromDraft(points, current.alignmentRadius, current.alignmentSpiral, current.alignments.length + 1, `${surface?.name ?? 'Boundary'} alignment`);
        dispatch({
          type: 'patch',
          patch: {
            alignments: [...current.alignments, created.record],
            activeAlignmentId: created.record.id,
            tool: 'pan',
            draft: [],
            view: 'plan',
            status: `Alignment from the ${surface?.name ?? 'surface'} boundary. ${created.status}`,
          },
        });
      },
      alignmentFromPoints: (points, name) => {
        if (points.length < 2) {
          dispatch({ type: 'patch', patch: { status: 'An alignment needs at least two points.' } });
          return;
        }
        const current = stateRef.current;
        const created = alignmentFromDraft(points, current.alignmentRadius, current.alignmentSpiral, current.alignments.length + 1, name);
        dispatch({
          type: 'patch',
          patch: {
            alignments: [...current.alignments, created.record],
            activeAlignmentId: created.record.id,
            tool: 'pan',
            draft: [],
            view: 'plan',
            status: created.status,
          },
        });
      },
      showProfile: () => {
        const current = stateRef.current;
        const alignment = current.alignments.find((item) => item.id === current.activeAlignmentId) ?? current.alignments[0];
        if (!alignment) {
          dispatch({ type: 'patch', patch: { status: 'Create an alignment before a surface profile.' } });
          return;
        }
        if (current.surfaces.every((surface) => !surface.visible || surface.triangles.length === 0)) {
          dispatch({ type: 'patch', patch: { status: 'A surface profile needs a visible TIN.' } });
          return;
        }
        dispatch({
          type: 'patch',
          patch: {
            activeAlignmentId: alignment.id,
            view: 'profile',
            fitToken: current.fitToken + 1,
            status: `Surface profile along ${alignment.name}.`,
          },
        });
      },
      showSections: (layout) => {
        const current = stateRef.current;
        const alignment = current.alignments.find((item) => item.id === current.activeAlignmentId) ?? current.alignments[0];
        if (!alignment) {
          dispatch({ type: 'patch', patch: { status: 'Create an alignment before section views.' } });
          return;
        }
        const withLines = { ...alignment, showSampleLines: true };
        dispatch({
          type: 'patch',
          patch: {
            alignments: current.alignments.map((item) => (item.id === alignment.id ? withLines : item)),
            activeAlignmentId: alignment.id,
            sectionLayout: layout,
            sectionIndex: 0,
            view: 'section',
            fitToken: current.fitToken + 1,
            status: layout === 'multiple' ? `Section views along ${alignment.name}.` : `Section view along ${alignment.name}.`,
          },
        });
      },
      createSampleLines: () => {
        const current = stateRef.current;
        const alignment = current.alignments.find((item) => item.id === current.activeAlignmentId) ?? current.alignments[0];
        if (alignment && refuseLocked(`sample-line:${alignment.id}`)) return;
        if (!alignment) {
          dispatch({ type: 'patch', patch: { status: 'Create an alignment before sample lines.' } });
          return;
        }
        dispatch({
          type: 'patch',
          patch: {
            alignments: current.alignments.map((item) => (item.id === alignment.id ? { ...item, showSampleLines: true } : item)),
            activeAlignmentId: alignment.id,
            view: 'plan',
            status: `Sample lines every ${alignment.sampleSpacing} ${current.unit} along ${alignment.name}.`,
          },
        });
      },
      stepSection: (delta) => {
        const current = stateRef.current;
        const sheet = designRef.current.find((item) => item.record.id === current.activeAlignmentId) ?? designRef.current[0];
        const meshCount = current.meshSections?.sections.length ?? 0;
        const count = meshCount > 0 ? meshCount : sheet?.sections.length ?? 0;
        const next = Math.min(Math.max(0, current.sectionIndex + delta), Math.max(0, count - 1));
        dispatch({ type: 'patch', patch: { sectionIndex: next } });
      },
      toggleContours: () => {
        const current = stateRef.current;
        const surface = current.surfaces.find((item) => item.id === current.activeId);
        if (!surface) {
          dispatch({ type: 'patch', patch: { status: 'Select a surface to change its contours.' } });
          return;
        }
        if (isMeshSurface(surface)) {
          dispatch({ type: 'patch', patch: { status: 'A 3D mesh does not generate contours.' } });
          return;
        }
        const showContours = !surface.style.showContours;
        updateSurfaces(
          current.surfaces.map((item) => (item.id === surface.id ? { ...item, style: { ...item.style, showContours } } : item)),
          surface.id,
        );
        dispatch({ type: 'patch', patch: { status: showContours ? `Contours on for ${surface.name}.` : `Contours off for ${surface.name}.` } });
      },
      openCommand: (command) => dispatch({ type: 'patch', patch: { command, commandSummary: '' } }),
      dismissCommand: () => dispatch({ type: 'patch', patch: { command: null } }),
      runCommand: (command, args) => applyResult(runCivilCommand(command, args, commandContext())),
      stepProfileSheet: (delta) => {
        const current = stateRef.current;
        const view = designRef.current.find((item) => item.record.id === current.activeAlignmentId) ?? designRef.current[0];
        if (!view || !current.profileSheetLength) return;
        const sheets = profileSheets(
          view.record.startStation,
          view.record.startStation + view.solved.length,
          current.profileSheetLength,
          current.profileSheetOverlap,
        );
        const next = Math.min(Math.max(0, current.profileSheetIndex + delta), Math.max(0, sheets.length - 1));
        dispatch({ type: 'patch', patch: { profileSheetIndex: next, fitToken: current.fitToken + 1 } });
      },
      setDiagram: (diagram) => {
        const current = stateRef.current;
        dispatch({ type: 'patch', patch: { diagram, view: 'profile', fitToken: current.fitToken + 1 } });
      },
      addMesh: (input) => {
        if (input.points.length < 3) {
          dispatch({ type: 'patch', patch: { status: 'A 3D mesh needs at least three points.' } });
          return;
        }
        const job = ++meshJob;
        dispatch({ type: 'patch', patch: { meshBusy: true, status: `Building 3D mesh from ${input.points.length.toLocaleString()} points…` } });
        void buildMeshAsync(
          input.points,
          {
            radii: input.radii ?? undefined,
            orient: input.orient,
            maxEdgeLength: input.maxEdgeLength,
            fillHoles: input.fillHoles,
            onProgress: (fraction, message) => {
              if (job !== meshJob) return;
              dispatch({ type: 'patch', patch: { status: `${message} (${Math.round(fraction * 100)}%)` } });
            },
          },
          (fraction, message) => {
            if (job !== meshJob) return;
            dispatch({ type: 'patch', patch: { status: `${message} (${Math.round(fraction * 100)}%)` } });
          },
        )
          .then((result) => {
            if (job !== meshJob) return;
            const current = stateRef.current;
            const surface = makeSurface(input.name.trim() || '3D Mesh', input.points, {
              index: current.surfaces.length,
              kind: 'mesh',
              points: result.points,
              triangles: result.triangles,
              style: { color: input.color },
            });
            surface.description = input.description;
            surface.layer = input.layer.trim() || 'MESH';
            surface.locked = input.locked;
            surface.meshRadii = result.radii;
            surface.meshOrient = input.orient;
            surface.meshFillHoles = input.fillHoles;
            surface.maxEdgeLength = input.maxEdgeLength;
            recordSurfaceUndo({ op: 'drop', id: surface.id, index: current.surfaces.length, surface });
            dispatch({
              type: 'patch',
              patch: {
                surfaces: [...current.surfaces, surface],
                activeId: surface.id,
                meshBusy: false,
                sampleBanner: false,
                volumeResult: null,
                showVolumeMap: false,
                fitToken: current.fitToken + 1,
                view: '3d',
                status: `${surface.name} · ${result.points.length.toLocaleString()} vertices · ${result.triangles.length.toLocaleString()} triangles · ${Math.round(result.timingMs).toLocaleString()} ms`,
              },
            });
          })
          .catch((error: unknown) => {
            if (job !== meshJob) return;
            dispatch({
              type: 'patch',
              patch: {
                meshBusy: false,
                status: error instanceof MeshCancelled ? '3D mesh cancelled.' : error instanceof Error ? error.message : '3D mesh build failed.',
              },
            });
          });
      },
      cancelMesh: () => {
        meshJob += 1;
        cancelActiveMesh();
        dispatch({ type: 'patch', patch: { meshBusy: false, status: '3D mesh cancelled.' } });
      },
      runMeshSections: (input) => cutMesh(input),
      beginSectionLine: (input) => {
        pendingSection = input;
        dispatch({
          type: 'patch',
          patch: { tool: 'sectionline', draft: [], view: 'plan', status: 'Section line · click two points. The plane is vertical.' },
        });
      },
      clearMeshSections: () => {
        const current = stateRef.current;
        if (!current.meshSections) return;
        recordSurfaceUndo({ op: 'sections', value: current.meshSections });
        dispatch({ type: 'patch', patch: { meshSections: null, status: 'Mesh sections cleared.' } });
      },
      undoSurface: () => {
        const item = takeSurfaceUndo();
        if (!item) return false;
        const inverse = applySurfaceChange(item);
        if (inverse) stashSurfaceRedo(inverse);
        return true;
      },
      redoSurface: () => {
        const item = takeSurfaceRedo();
        if (!item) return false;
        const inverse = applySurfaceChange(item);
        if (inverse) stashSurfaceUndo(inverse);
        return true;
      },
      setSurfaceMeta: (id, meta) => patchSurface(id, (surface) => ({ ...surface, ...meta })),
    };
  }, [activeAlignment, contours, design, loadSample, state, updateSurfaces]);

  return <ProjectContext.Provider value={api}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectApi {
  const value = useContext(ProjectContext);
  if (!value) throw new Error('useProject must be used inside ProjectProvider');
  return value;
}
