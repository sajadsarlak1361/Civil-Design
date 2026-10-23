/**
 * Model-space view state: tiled viewports, named views, visual style, and
 * which chrome is visible. Pan and zoom math stay on the plan camera and the
 * ZOOM/PAN commands. This module only records the layout and the preset.
 */

export const VIEW_PRESETS = ['top', 'bottom', 'left', 'right', 'front', 'back', 'sw', 'se', 'ne', 'nw', 'plan'] as const;
export type ViewPreset = (typeof VIEW_PRESETS)[number];

export const VISUAL_STYLES = [
  '2d-wireframe',
  'wireframe',
  'hidden',
  'realistic',
  'conceptual',
  'shaded',
  'shaded-edges',
  'xray',
  'elevation',
] as const;
export type VisualStyle = (typeof VISUAL_STYLES)[number];

import { nextRibbonMode, type RibbonMode } from './chromeLayout';

export type { RibbonMode };
export type OrbitMode = 'constrained' | 'free' | 'continuous';
export type ViewportCount = 1 | 2 | 3 | 4;

export interface ViewportSlot {
  id: string;
  preset: ViewPreset | 'custom';
  /** Radians around Y, atan2(x, z) in the Three.js scene. */
  azimuth: number;
  /** Radians from +Y. 0 looks straight down. */
  polar: number;
  /** Multiplier on the model span. Each viewport keeps its own value. */
  distance: number;
  ortho: boolean;
}

export interface NamedView {
  name: string;
  preset: ViewportSlot['preset'];
  azimuth: number;
  polar: number;
  distance: number;
  ortho: boolean;
}

export interface WorkspaceState {
  layout: ViewportCount;
  slots: ViewportSlot[];
  activeId: string;
  namedViews: NamedView[];
  visualStyle: VisualStyle;
  orbitMode: OrbitMode;
  /** Arrow keys move the 3D camera. Walk stays level; fly follows the look direction. */
  locomotion: 'none' | 'walk' | 'fly';
  viewCube: boolean;
  navBar: boolean;
  cleanScreen: boolean;
  commandLine: boolean;
  ucsIcon: boolean;
  lineweights: boolean;
  showGrid: boolean;
  textWindow: boolean;
  /** Draw the UCS icon at the world origin. Off keeps it in the corner. */
  ucsAtOrigin: boolean;
  properties: boolean;
  layers: boolean;
  xrefs: boolean;
  toolPalettes: boolean;
  statusBar: boolean;
  /** full panels, panel titles only, or tab names only. */
  ribbonMode: RibbonMode;
}

export interface PresetVectors {
  position: [number, number, number];
  up: [number, number, number];
  ortho: boolean;
}

/** Unit direction of the camera, in scene space (X east, Y elevation, Z = −north). */
export function presetVectors(preset: ViewPreset): PresetVectors {
  switch (preset) {
    case 'top':
    case 'plan':
      return { position: [0, 1, 0], up: [0, 0, -1], ortho: true };
    case 'bottom':
      return { position: [0, -1, 0], up: [0, 0, 1], ortho: true };
    case 'front':
      return { position: [0, 0, 1], up: [0, 1, 0], ortho: true };
    case 'back':
      return { position: [0, 0, -1], up: [0, 1, 0], ortho: true };
    case 'left':
      return { position: [-1, 0, 0], up: [0, 1, 0], ortho: true };
    case 'right':
      return { position: [1, 0, 0], up: [0, 1, 0], ortho: true };
    case 'sw':
      return { position: [-1, 1, 1], up: [0, 1, 0], ortho: false };
    case 'se':
      return { position: [1, 1, 1], up: [0, 1, 0], ortho: false };
    case 'ne':
      return { position: [1, 1, -1], up: [0, 1, 0], ortho: false };
    case 'nw':
      return { position: [-1, 1, -1], up: [0, 1, 0], ortho: false };
    default:
      return { position: [0, 1, 0], up: [0, 0, -1], ortho: true };
  }
}

export function presetCamera(preset: ViewPreset): Omit<ViewportSlot, 'id'> {
  const vectors = presetVectors(preset);
  const length = Math.hypot(vectors.position[0], vectors.position[1], vectors.position[2]) || 1;
  return {
    preset,
    azimuth: Math.atan2(vectors.position[0], vectors.position[2]),
    polar: Math.acos(Math.max(-1, Math.min(1, vectors.position[1] / length))),
    distance: 1.35,
    ortho: vectors.ortho,
  };
}

const LAYOUT_PRESETS: Record<ViewportCount, ViewPreset[]> = {
  1: ['plan'],
  2: ['plan', 'front'],
  3: ['plan', 'front', 'right'],
  4: ['top', 'front', 'right', 'sw'],
};

export function layoutSlots(count: ViewportCount): ViewportSlot[] {
  return LAYOUT_PRESETS[count].map((preset, index) => ({ id: `vp-${index + 1}`, ...presetCamera(preset) }));
}

export function joinViewports(slots: ViewportSlot[], keepId: string, dropId: string): ViewportSlot[] {
  if (keepId === dropId) return slots;
  if (!slots.some((slot) => slot.id === keepId) || !slots.some((slot) => slot.id === dropId)) return slots;
  return slots.filter((slot) => slot.id !== dropId);
}

export function saveNamedView(views: NamedView[], name: string, slot: ViewportSlot): NamedView[] {
  const trimmed = name.trim();
  if (!trimmed) return views;
  const next: NamedView = {
    name: trimmed,
    preset: slot.preset,
    azimuth: slot.azimuth,
    polar: slot.polar,
    distance: slot.distance,
    ortho: slot.ortho,
  };
  return [...views.filter((view) => view.name.toLowerCase() !== trimmed.toLowerCase()), next];
}

export function restoreNamedView(views: NamedView[], name: string): NamedView | null {
  return views.find((view) => view.name.toLowerCase() === name.trim().toLowerCase()) ?? null;
}

export function slotFromNamed(id: string, view: NamedView): ViewportSlot {
  return {
    id,
    preset: view.preset,
    azimuth: view.azimuth,
    polar: view.polar,
    distance: view.distance,
    ortho: view.ortho,
  };
}

function fresh(): WorkspaceState {
  const slots = layoutSlots(1);
  return {
    layout: 1,
    slots,
    activeId: slots[0].id,
    namedViews: [],
    visualStyle: 'shaded',
    orbitMode: 'constrained',
    locomotion: 'none',
    viewCube: true,
    navBar: false,
    cleanScreen: false,
    commandLine: true,
    ucsIcon: true,
    lineweights: true,
    showGrid: true,
    textWindow: false,
    ucsAtOrigin: false,
    properties: false,
    layers: false,
    xrefs: false,
    toolPalettes: false,
    statusBar: true,
    ribbonMode: 'full',
  };
}

export const VISUAL_STYLE_LABELS: Record<VisualStyle, string> = {
  '2d-wireframe': '2D Wireframe',
  wireframe: 'Wireframe',
  hidden: 'Hidden',
  realistic: 'Realistic',
  conceptual: 'Conceptual',
  shaded: 'Shaded',
  'shaded-edges': 'Shaded with Edges',
  xray: 'X-Ray',
  elevation: 'Elevation banding',
};

export const PRESET_LABELS: Record<ViewPreset, string> = {
  top: 'Top',
  bottom: 'Bottom',
  left: 'Left',
  right: 'Right',
  front: 'Front',
  back: 'Back',
  sw: 'SW Isometric',
  se: 'SE Isometric',
  ne: 'NE Isometric',
  nw: 'NW Isometric',
  plan: 'Plan',
};

let state = fresh();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getWorkspace(): WorkspaceState {
  return state;
}

export function subscribeWorkspace(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetWorkspace(): void {
  state = fresh();
  emit();
}

export function activeSlot(): ViewportSlot {
  return state.slots.find((slot) => slot.id === state.activeId) ?? state.slots[0];
}

export function setLayout(count: ViewportCount): void {
  const slots = layoutSlots(count);
  state = { ...state, layout: count, slots, activeId: slots[0].id };
  emit();
}

export function setActiveViewport(id: string): void {
  if (!state.slots.some((slot) => slot.id === id)) return;
  state = { ...state, activeId: id };
  emit();
}

export function joinActive(dropId: string): void {
  const slots = joinViewports(state.slots, state.activeId, dropId);
  const layout = Math.max(1, Math.min(4, slots.length)) as ViewportCount;
  state = { ...state, slots, layout, activeId: slots.some((slot) => slot.id === state.activeId) ? state.activeId : slots[0].id };
  emit();
}

export function setActivePreset(preset: ViewPreset): void {
  const slots = state.slots.map((slot) => (slot.id === state.activeId ? { ...slot, id: slot.id, ...presetCamera(preset) } : slot));
  state = { ...state, slots };
  emit();
}

export function setActiveCamera(patch: Partial<Pick<ViewportSlot, 'azimuth' | 'polar' | 'distance' | 'ortho' | 'preset'>>): void {
  const slots = state.slots.map((slot) => (slot.id === state.activeId ? { ...slot, ...patch } : slot));
  state = { ...state, slots };
  emit();
}

export function setVisualStyle(style: VisualStyle): void {
  state = { ...state, visualStyle: style };
  emit();
}

export function setOrbitMode(mode: OrbitMode): void {
  state = { ...state, orbitMode: mode };
  emit();
}

export function setLocomotion(locomotion: WorkspaceState['locomotion']): void {
  state = { ...state, locomotion };
  emit();
}

export function rememberActiveView(name: string): void {
  state = { ...state, namedViews: saveNamedView(state.namedViews, name, activeSlot()) };
  emit();
}

export function recallNamedView(name: string): boolean {
  const view = restoreNamedView(state.namedViews, name);
  if (!view) return false;
  const slots = state.slots.map((slot) => (slot.id === state.activeId ? slotFromNamed(slot.id, view) : slot));
  state = { ...state, slots };
  emit();
  return true;
}

export function patchChrome(patch: Partial<Pick<WorkspaceState, 'viewCube' | 'navBar' | 'cleanScreen' | 'commandLine' | 'ucsIcon' | 'lineweights' | 'showGrid' | 'textWindow' | 'ucsAtOrigin' | 'properties' | 'layers' | 'xrefs' | 'toolPalettes' | 'statusBar' | 'ribbonMode'>>): void {
  state = { ...state, ...patch };
  emit();
}

export function cycleRibbon(): RibbonMode {
  const ribbonMode = nextRibbonMode(state.ribbonMode);
  state = { ...state, ribbonMode };
  emit();
  return ribbonMode;
}
