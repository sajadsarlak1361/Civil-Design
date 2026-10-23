import type { Vec2 } from '../engine/geometry';

export type ProjectView = 'plan' | '3d' | 'split' | 'profile' | 'section';
export type ProjectTool = 'pan' | 'boundary' | 'breakline' | 'alignment' | 'featureline' | 'parcel' | 'quickprofile' | 'point' | 'sectionline';

export interface CadHost {
  setView(view: ProjectView): void;
  setTool(tool: ProjectTool): void;
  cancelTool(): void;
  finishTool(): void;
  addDraftPoint(point: Vec2): void;
  popDraftPoint(): void;
  getTool(): ProjectTool;
  prepareAlignment(mode?: 'layout' | 'tangents' | 'curves' | 'spirals'): void;
  alignmentFromPoints(points: Vec2[]): void;
  alignmentFromBoundary(): void;
  showProfile(): void;
  createDesignProfile(): void;
  createSampleLines(): void;
  showSections(layout: 'single' | 'multiple'): void;
  toggleContours(): void;
  showComingSoon(name: string, panel: string): void;
  /** Open the same command the Home ribbon uses. */
  openCivilCommand(command: string): void;
  dismissCivilCommand(): void;
  openImport(): void;
  openProject(): void;
  saveProject(): void;
  exportKind(kind: 'contours' | 'triangles' | 'landxml' | 'volume' | 'obj' | 'stl' | 'ply' | 'sections'): void;
  showInspector(): void;
  openMeshCreate(): void;
  openMeshSection(): void;
  undoProject(): boolean;
  redoProject(): boolean;
  newProject(): void;
  setUnit(unit: 'm' | 'ft'): void;
  /** Optional. Home drafting uses it for WBLOCK. */
  downloadFile?(filename: string, text: string, mime: string): void;
}

export interface ViewBridge {
  zoomExtents(): void;
  zoomWindow(a: Vec2, b: Vec2): void;
  zoomScale(factor: number): void;
  zoomPrevious(): void;
  panBy(a: Vec2, b: Vec2): void;
  panDisplacement(x: number, y: number): void;
  markOriginal(): void;
  zoomOriginal(): void;
  /** Nudge the view by a fraction of the screen. Implemented with the existing pan. */
  panScreen?(direction: 'left' | 'right' | 'up' | 'down'): void;
  redraw(): void;
}

let host: CadHost | null = null;
let view: ViewBridge | null = null;

export function bindHost(next: CadHost): void {
  host = next;
}

export function bindView(next: ViewBridge | null): void {
  view = next;
}

export function getHost(): CadHost | null {
  return host;
}

export function getView(): ViewBridge | null {
  return view;
}
