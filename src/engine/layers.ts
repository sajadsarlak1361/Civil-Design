import type { DrawingDoc, DrawEntity } from './drafting';
import { aciHex } from './aci';
import { LINEWEIGHT_DEFAULT } from './lineweights';

export interface LayerRec {
  name: string;
  /** #rrggbb */
  color: string;
  colorIndex?: number;
  visible: boolean;
  frozen: boolean;
  locked: boolean;
  plot: boolean;
  lineType: string;
  /** Hundredths of a millimetre, or -1/-2/-3 sentinels. */
  lineWeight: number;
  /** 0 opaque … 90 most transparent. */
  transparency: number;
  plotStyle: string;
  description: string;
  /** Viewport ids where this layer is frozen. */
  vpFrozen: string[];
}

export interface LayerFilter {
  id: string;
  name: string;
  kind: 'all' | 'used' | 'property' | 'group';
  query?: { on?: boolean; frozen?: boolean; locked?: boolean; color?: string; name?: string };
  layers?: string[];
}

export interface LayerState {
  name: string;
  description?: string;
  layers: Partial<LayerRec>[];
  currentLayer?: string;
}

export interface ViewportRec {
  id: string;
  name: string;
}

const CIVIL_LAYERS: { name: string; colorIndex: number; description: string }[] = [
  { name: 'C-TOPO', colorIndex: 4, description: 'Surfaces and contours' },
  { name: 'C-ROAD', colorIndex: 2, description: 'Alignments and profiles' },
  { name: 'C-CORR', colorIndex: 30, description: 'Corridors and assemblies' },
  { name: 'C-FEAT', colorIndex: 3, description: 'Feature lines' },
  { name: 'C-GRADING', colorIndex: 40, description: 'Gradings' },
  { name: 'C-PARCEL', colorIndex: 6, description: 'Parcels' },
  { name: 'C-PIPE', colorIndex: 5, description: 'Pipe networks' },
  { name: 'C-PRESS', colorIndex: 1, description: 'Pressure networks' },
  { name: 'C-PNT', colorIndex: 7, description: 'COGO points' },
];

export function layerTemplate(name: string, colorIndex = 7, extras: Partial<LayerRec> = {}): LayerRec {
  const base: LayerRec = {
    name,
    color: aciHex(colorIndex),
    colorIndex,
    visible: true,
    frozen: false,
    locked: false,
    plot: name.toLowerCase() !== 'defpoints',
    lineType: 'Continuous',
    lineWeight: LINEWEIGHT_DEFAULT,
    transparency: 0,
    plotStyle: 'ByColor',
    description: '',
    vpFrozen: [],
    ...extras,
  };
  base.color = extras.color ?? aciHex(extras.colorIndex ?? base.colorIndex ?? colorIndex);
  base.name = name;
  return base;
}

export function defaultLayers(): LayerRec[] {
  return [
    layerTemplate('0', 7),
    layerTemplate('Defpoints', 7, { plot: false, description: 'Non-plotting layer' }),
    ...CIVIL_LAYERS.map((layer) => layerTemplate(layer.name, layer.colorIndex, { description: layer.description })),
  ];
}

function isLegacyWeight(layer: Partial<LayerRec>): boolean {
  return layer.plot === undefined && layer.frozen === undefined && (layer.lineWeight === undefined || layer.lineWeight === 1);
}

export function normalizeLayer(input: Partial<LayerRec> & { name: string }): LayerRec {
  const colorIndex = typeof input.colorIndex === 'number' ? input.colorIndex : undefined;
  const color = typeof input.color === 'string' && input.color.trim() ? input.color : colorIndex ? aciHex(colorIndex) : aciHex(7);
  const transparency = typeof input.transparency === 'number' && Number.isFinite(input.transparency) ? Math.min(90, Math.max(0, input.transparency)) : 0;
  return {
    name: input.name,
    color,
    colorIndex,
    visible: input.visible !== false,
    frozen: Boolean(input.frozen),
    locked: Boolean(input.locked),
    plot: input.name.toLowerCase() === 'defpoints' ? false : input.plot !== false,
    lineType: typeof input.lineType === 'string' && input.lineType ? input.lineType : 'Continuous',
    lineWeight: isLegacyWeight(input) ? LINEWEIGHT_DEFAULT : typeof input.lineWeight === 'number' ? input.lineWeight : LINEWEIGHT_DEFAULT,
    transparency,
    plotStyle: input.plotStyle || 'ByColor',
    description: input.description || '',
    vpFrozen: Array.isArray(input.vpFrozen) ? input.vpFrozen.filter((id) => typeof id === 'string') : [],
  };
}

export function ensureStandardLayers(layers: LayerRec[]): LayerRec[] {
  const next = layers.map((layer) => normalizeLayer(layer));
  for (const standard of defaultLayers()) {
    if (!next.some((layer) => layer.name.toLowerCase() === standard.name.toLowerCase())) next.push(standard);
  }
  const zero = next.findIndex((layer) => layer.name === '0');
  if (zero > 0) {
    const [layer] = next.splice(zero, 1);
    next.unshift(layer);
  }
  return next;
}

export function findLayer(doc: Pick<DrawingDoc, 'layers'>, name: string): LayerRec | undefined {
  return doc.layers.find((layer) => layer.name.toLowerCase() === name.toLowerCase());
}

/** Frozen and off layers are not drawn and are not regenerated. */
export function shouldDraw(layer: Pick<LayerRec, 'visible' | 'frozen'> | undefined): boolean {
  return !layer || (layer.visible && !layer.frozen);
}

export function layerAlpha(layer: Pick<LayerRec, 'transparency'> | undefined): number {
  const transparency = layer?.transparency ?? 0;
  return 1 - Math.min(90, Math.max(0, transparency)) / 100;
}

export function nextLayerName(layers: { name: string }[]): string {
  const taken = new Set(layers.map((layer) => layer.name.toLowerCase()));
  let index = 1;
  while (taken.has(`layer${index}`)) index += 1;
  return `Layer${index}`;
}

export function layerInUse(doc: DrawingDoc, name: string): boolean {
  const key = name.toLowerCase();
  if (doc.entities.some((entity) => entity.layer.toLowerCase() === key)) return true;
  return (doc.objects ?? []).some((object) => object.layer.toLowerCase() === key);
}

export function deleteLayer(doc: DrawingDoc, name: string): string | null {
  const layer = findLayer(doc, name);
  if (!layer) return `Layer "${name}" not found.`;
  const lower = layer.name.toLowerCase();
  if (lower === '0') return 'Cannot delete layer 0.';
  if (lower === 'defpoints') return 'Cannot delete layer Defpoints.';
  if (layer.name.toLowerCase() === doc.currentLayer.toLowerCase()) return 'Cannot delete the current layer.';
  if (layerInUse(doc, layer.name)) return `Cannot delete layer "${layer.name}" because it contains objects.`;
  doc.layers = doc.layers.filter((item) => item !== layer);
  return null;
}

/** LAYDEL removes the layer and its entities. Layer 0, Defpoints, and current still refuse. */
export function deleteLayerAndObjects(doc: DrawingDoc, name: string): string | null {
  const layer = findLayer(doc, name);
  if (!layer) return `Layer "${name}" not found.`;
  const lower = layer.name.toLowerCase();
  if (lower === '0') return 'Cannot delete layer 0.';
  if (lower === 'defpoints') return 'Cannot delete layer Defpoints.';
  if (layer.name.toLowerCase() === doc.currentLayer.toLowerCase()) return 'Cannot delete the current layer.';
  const key = layer.name.toLowerCase();
  doc.entities = doc.entities.filter((entity) => entity.layer.toLowerCase() !== key);
  doc.objects = (doc.objects ?? []).filter((object) => object.layer.toLowerCase() !== key);
  doc.selection = doc.selection.filter((id) => doc.entities.some((entity) => entity.id === id) || (doc.objects ?? []).some((object) => object.key === id));
  doc.layers = doc.layers.filter((item) => item !== layer);
  return null;
}

export function matchFilter(layer: LayerRec, filter: LayerFilter): boolean {
  if (filter.kind === 'all') return true;
  if (filter.kind === 'group') {
    const names = new Set((filter.layers ?? []).map((name) => name.toLowerCase()));
    return names.has(layer.name.toLowerCase());
  }
  if (filter.kind === 'property' && filter.query) {
    const query = filter.query;
    if (query.on !== undefined && layer.visible !== query.on) return false;
    if (query.frozen !== undefined && layer.frozen !== query.frozen) return false;
    if (query.locked !== undefined && layer.locked !== query.locked) return false;
    if (query.color && layer.color.toLowerCase() !== query.color.toLowerCase() && String(layer.colorIndex ?? '') !== query.color) return false;
    if (query.name && !layer.name.toLowerCase().includes(query.name.toLowerCase())) return false;
  }
  return true;
}

export function layersForView(doc: DrawingDoc, filter: LayerFilter, search: string): LayerRec[] {
  const used = new Set<string>();
  if (filter.kind === 'used') {
    for (const entity of doc.entities) used.add(entity.layer.toLowerCase());
    for (const object of doc.objects ?? []) used.add(object.layer.toLowerCase());
    used.add('0');
  }
  const needle = search.trim().toLowerCase();
  return doc.layers.filter((layer) => {
    if (filter.kind === 'used' && !used.has(layer.name.toLowerCase())) return false;
    if (!matchFilter(layer, filter)) return false;
    if (needle && !layer.name.toLowerCase().includes(needle)) return false;
    return true;
  });
}

export function sortLayers(layers: LayerRec[], column: keyof LayerRec, direction: 1 | -1): LayerRec[] {
  const copy = [...layers];
  copy.sort((a, b) => {
    const left = a[column];
    const right = b[column];
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction;
    if (typeof left === 'boolean' && typeof right === 'boolean') return (Number(left) - Number(right)) * direction;
    return String(left ?? '').localeCompare(String(right ?? '')) * direction;
  });
  return copy;
}

export function saveLayerState(doc: DrawingDoc, name: string, description = ''): void {
  const state: LayerState = {
    name,
    description,
    currentLayer: doc.currentLayer,
    layers: doc.layers.map((layer) => ({ ...layer, vpFrozen: [...layer.vpFrozen] })),
  };
  const states = doc.states ?? [];
  const index = states.findIndex((item) => item.name.toLowerCase() === name.toLowerCase());
  if (index >= 0) states[index] = state;
  else states.push(state);
  doc.states = states;
}

export function restoreNamedLayerState(doc: DrawingDoc, name: string): string | null {
  const state = (doc.states ?? []).find((item) => item.name.toLowerCase() === name.toLowerCase());
  if (!state) return `Layer state "${name}" not found.`;
  for (const saved of state.layers) {
    if (!saved.name) continue;
    const existing = findLayer(doc, saved.name);
    if (existing) Object.assign(existing, normalizeLayer({ ...existing, ...saved, name: existing.name }));
    else doc.layers.push(normalizeLayer(saved as Partial<LayerRec> & { name: string }));
  }
  if (state.currentLayer && findLayer(doc, state.currentLayer)) doc.currentLayer = findLayer(doc, state.currentLayer)!.name;
  return null;
}

let previousLayers: string | null = null;
let captureOpen = false;

export function beginLayerCommand(doc: DrawingDoc): void {
  if (captureOpen) return;
  previousLayers = JSON.stringify({ layers: doc.layers, currentLayer: doc.currentLayer });
  captureOpen = true;
}

export function endLayerCommand(): void {
  captureOpen = false;
}

export function restorePreviousLayers(doc: DrawingDoc): boolean {
  if (!previousLayers) return false;
  const saved = JSON.parse(previousLayers) as { layers: LayerRec[]; currentLayer: string };
  doc.layers = saved.layers;
  doc.currentLayer = saved.currentLayer;
  captureOpen = false;
  return true;
}

export function isolateLayers(doc: DrawingDoc, names: string[]): void {
  const keep = new Set(names.map((name) => name.toLowerCase()));
  keep.add('0');
  for (const layer of doc.layers) {
    if (layer.name.toLowerCase() === 'defpoints') continue;
    layer.visible = keep.has(layer.name.toLowerCase());
  }
}

let isolation: { name: string; visible: boolean }[] | null = null;

export function layiso(doc: DrawingDoc, names: string[]): void {
  isolation = doc.layers.map((layer) => ({ name: layer.name, visible: layer.visible }));
  isolateLayers(doc, names);
}

export function layuniso(doc: DrawingDoc): boolean {
  if (!isolation) return false;
  for (const saved of isolation) {
    const layer = findLayer(doc, saved.name);
    if (layer) layer.visible = saved.visible;
  }
  isolation = null;
  return true;
}

export function setLayersOn(doc: DrawingDoc, visible: boolean, names?: string[]): void {
  const wanted = names ? new Set(names.map((name) => name.toLowerCase())) : null;
  for (const layer of doc.layers) {
    if (wanted && !wanted.has(layer.name.toLowerCase())) continue;
    layer.visible = visible;
  }
}

export function thawAll(doc: DrawingDoc): void {
  for (const layer of doc.layers) layer.frozen = false;
}

export function freezeLayer(doc: DrawingDoc, name: string): string | null {
  const layer = findLayer(doc, name);
  if (!layer) return `Layer "${name}" not found.`;
  if (layer.name.toLowerCase() === doc.currentLayer.toLowerCase()) return 'Cannot freeze the current layer.';
  layer.frozen = true;
  return null;
}

export function entitiesOnLayer(doc: DrawingDoc, name: string): DrawEntity[] {
  const key = name.toLowerCase();
  return doc.entities.filter((entity) => entity.layer.toLowerCase() === key);
}

export function moveEntitiesToLayer(doc: DrawingDoc, ids: string[], layerName: string): number {
  const layer = findLayer(doc, layerName);
  if (!layer) return 0;
  let count = 0;
  for (const id of ids) {
    const entity = doc.entities.find((item) => item.id === id);
    if (entity) {
      entity.layer = layer.name;
      count += 1;
      continue;
    }
    const object = (doc.objects ?? []).find((item) => item.key === id);
    if (object) {
      object.layer = layer.name;
      count += 1;
    }
  }
  return count;
}

export const BUILTIN_FILTERS: LayerFilter[] = [
  { id: 'all', name: 'All', kind: 'all' },
  { id: 'used', name: 'All Used Layers', kind: 'used' },
];
