import type { Vec2 } from '../engine/geometry';
import {
  DrawingModel,
  applyConstraint,
  bindDrawingHistory,
  drawingBounds,
  drawingDocFromFile,
  emptyDrawing,
  entityBounds,
  objectTrack,
  pickEntity,
  snapToDrawing,
  type DrawingFile,
  type DrawEntity,
  type SnapHit,
  type Vec3,
} from '../engine/drafting';
import { pasteEntities, rememberedClipboard, rememberClipboard, type ClipboardPayload } from '../engine/clipboard';
import { quickSelect, replaceText, selectAll, selectSimilar, type QuickFilter } from '../engine/selecting';
import { readClipboardPayload, writeClipboardPayload } from '../lib/clipboardPort';
import { requestUi } from '../lib/uiBus';
import type { DxfModel } from '../engine/formats/dxfDoc';
import type { DwgImport } from '../engine/formats/dwgMap';
import { normalizeLayer } from '../engine/layers';
import {
  attachXref,
  bindXref,
  dashXref,
  getXrefDoc,
  replaceXrefs,
  setXrefClip,
  xbindLayers,
  xrefBounds,
} from '../engine/xref';
import { LAZ_REASON } from '../engine/formats/las';
import { applyOrbit, applyPlan, applyPreset, applyViewportLayout } from '../view/viewCommands';
import { getWorkspace, patchChrome, rememberActiveView, setLocomotion, setVisualStyle, type ViewPreset, type ViewportCount, type VisualStyle } from '../view/workspace';
import { suggestCommands, type Suggestion } from './autocomplete';
import {
  helpText,
  resolveToken,
  suggestionSources,
  unavailableMessage,
  unknownMessage,
  type ResolvedCommand,
} from './catalog';
import { isRetired, retiredMessage } from '../features';
import { appendLog, emptyRecall, pushRecall, recallStep, type LogLine, type RecallState } from './history';
import { formatPrompt, parsePromptInput, type PromptSpec } from './parser';
import {
  beginCommand,
  defaultSettings,
  sessionBase,
  sessionPreview,
  stepCommand,
  SESSION_COMMANDS,
  type CadSettings,
  type Session,
  type SessionEffect,
  type SessionResult,
} from './session';
import { applyGrip, gripLabel, nearestGrip, nextGripMode, stepGripScale, type GripMode, type GripScalePhase } from './grips';
import { expandGroupSelection } from '../engine/groups';
import { clearEditHistory, dropLastDrawNote, noteEdit, takeRedo, takeUndo } from '../engine/editHistory';
import { beginLayerCommand, endLayerCommand, layuniso, restorePreviousLayers, setLayersOn, thawAll } from '../engine/layers';
import { lockMessage, partitionEditable } from '../engine/objects';
import { getHost, getView } from './host';

export { bindHost, bindView, getHost, getView } from './host';

export interface CommandSnapshot {
  lines: LogLine[];
  input: string;
  promptText: string;
  promptHead: string;
  keywords: string[];
  def: string | null;
  suggestions: Suggestion[];
  suggestionIndex: number;
  expanded: boolean;
  aliasEditor: boolean;
  ortho: boolean;
  polar: boolean;
  otrack: boolean;
  dyn: boolean;
  osnap: boolean;
  gridSnap: boolean;
  spaceCommits: boolean;
  dialog: 'dimstyle' | 'insert' | 'groups' | 'mtext' | 'table' | 'battman' | 'style' | 'mleaderstyle' | 'block' | null;
  gripMode: string | null;
  layerManagerOpen: boolean;
  propertiesOpen: boolean;
  qselectOpen: boolean;
  quickProperties: boolean;
  lwdisplay: boolean;
  pickadd: boolean;
  picking: boolean;
}

export interface Overlay {
  cursor: Vec3 | null;
  snap: SnapHit | null;
  figs: { points: Vec3[]; closed?: boolean; circle?: { center: Vec3; radius: number } }[];
  tracks: { a: Vec3; b: Vec3 }[];
  selectA: Vec2 | null;
  selectB: Vec2 | null;
  hoverId: string | null;
  lasso: Vec2[] | null;
}

const LOG_KEY = 'fieldline.commandLog';
const RECALL_KEY = 'fieldline.commandRecall';
const ALIAS_KEY = 'fieldline.userAliases';
const SETTINGS_KEY = 'fieldline.cadSettings';

const model = new DrawingModel();
let settings = defaultSettings();
let session: Session | null = null;
let prompt: PromptSpec | null = null;
let suspended: { session: Session; prompt: PromptSpec } | null = null;
let lines: LogLine[] = [];
let recall: RecallState = emptyRecall();
let input = '';
let suggestions: Suggestion[] = [];
let suggestionIndex = 0;
let suggestionArmed = false;
let expanded = false;
let aliasEditor = false;
let clipboard: DrawEntity[] = [];
let clipAsk: 'copybase' | 'pasteblock' | null = null;
let userAliases = new Map<string, string>();
let acquired: Vec3[] = [];
let overlay: Overlay = { cursor: null, snap: null, figs: [], tracks: [], selectA: null, selectB: null, hoverId: null, lasso: null };
let dialog: CommandSnapshot['dialog'] = null;
let grip: { id: string; index: number; origin: Vec3; mode: GripMode; phase: GripScalePhase; reference: number } | null = null;
let layerManagerOpen = false;
let propertiesOpen = false;
let qselectOpen = false;
let quickProperties = false;
let picking = false;
let vertexMarker: { id: string; index: number } | null = null;
let snapshot: CommandSnapshot = buildSnapshot();
const uiListeners = new Set<() => void>();
const viewListeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function loadPersistent(): void {
  const store = storage();
  if (!store) return;
  try {
    const savedLog = JSON.parse(store.getItem(LOG_KEY) || '[]') as LogLine[];
    if (Array.isArray(savedLog)) lines = savedLog.filter((line) => line && typeof line.text === 'string').slice(-400);
    const savedRecall = JSON.parse(store.getItem(RECALL_KEY) || '[]') as string[];
    if (Array.isArray(savedRecall)) recall = { items: savedRecall.filter((item) => typeof item === 'string').slice(-200), cursor: -1, draft: '' };
    const savedAliases = JSON.parse(store.getItem(ALIAS_KEY) || '[]') as { alias: string; command: string }[];
    if (Array.isArray(savedAliases)) {
      userAliases = new Map(savedAliases.filter((item) => item.alias && item.command).map((item) => [item.alias.toUpperCase(), item.command.toUpperCase()]));
    }
    const savedSettings = JSON.parse(store.getItem(SETTINGS_KEY) || 'null') as Partial<CadSettings> | null;
    if (savedSettings && typeof savedSettings === 'object') settings = { ...defaultSettings(), ...savedSettings, osnapModes: savedSettings.osnapModes ?? defaultSettings().osnapModes };
  } catch {
    lines = [];
  }
}

loadPersistent();
snapshot = buildSnapshot();

function persist(): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(LOG_KEY, JSON.stringify(lines.slice(-400)));
    store.setItem(RECALL_KEY, JSON.stringify(recall.items.slice(-200)));
    store.setItem(ALIAS_KEY, JSON.stringify([...userAliases.entries()].map(([alias, command]) => ({ alias, command }))));
    store.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private mode and file:// can refuse storage. The command line still works.
  }
}

function buildSnapshot(): CommandSnapshot {
  return {
    lines,
    input,
    promptText: prompt ? formatPrompt(prompt) : 'Command:',
    promptHead: prompt?.head ?? 'Command',
    keywords: prompt?.keywords?.map((keyword) => keyword.label) ?? [],
    def: prompt?.def ?? null,
    suggestions,
    suggestionIndex,
    expanded,
    aliasEditor,
    ortho: settings.ortho,
    polar: settings.polar,
    otrack: settings.otrack,
    dyn: settings.dyn,
    osnap: settings.osnap,
    gridSnap: settings.gridSnap,
    spaceCommits: prompt ? prompt.spaceCommits : true,
    dialog,
    gripMode: grip?.mode ?? null,
    layerManagerOpen,
    propertiesOpen,
    qselectOpen,
    quickProperties,
    lwdisplay: settings.lwdisplay,
    pickadd: settings.pickadd,
    picking,
  };
}

function publishUi(): void {
  snapshot = buildSnapshot();
  for (const listener of uiListeners) listener();
}

function publishView(): void {
  for (const listener of viewListeners) listener();
}

export function subscribeCommandUi(listener: () => void): () => void {
  uiListeners.add(listener);
  return () => uiListeners.delete(listener);
}

export function getCommandSnapshot(): CommandSnapshot {
  return snapshot;
}

export function subscribeDrawing(listener: () => void): () => void {
  viewListeners.add(listener);
  return () => viewListeners.delete(listener);
}

export function getDrawingModel(): DrawingModel {
  return model;
}

export function getOverlay(): Overlay {
  return overlay;
}

export function getCadSettings(): CadSettings {
  return settings;
}

export function interactionMode(): 'idle' | 'point' | 'select' | 'tool' {
  const tool = getHost()?.getTool() ?? 'pan';
  if (picking) return 'select';
  if (clipAsk) return 'point';
  if (session && prompt?.expect === 'select') return 'select';
  if (session && prompt && prompt.expect !== 'text') return 'point';
  if (!session && tool !== 'pan') return 'tool';
  return 'idle';
}

export function importDrawing(entities: DrawEntity[], layers: string[], label: string, bulk?: DxfModel['bulk']): void {
  model.checkpoint(label);
  for (const name of layers) {
    if (!model.layer(name)) model.doc.layers.push(normalizeLayer({ name, color: '#e8eef7', lineType: 'Continuous' }));
  }
  for (const entity of entities) model.add({ ...entity, id: model.nextId() });
  if (bulk && bulk.entityCount > 0) model.doc.bulk = bulk;
  model.emit();
  publishView();
  frameImported();
  if (bulk?.truncated) say('Opened the first part of this DXF. The rest is larger than this session can hold.', 'message');
  else if (bulk && bulk.entityCount > 0) say(`Opened ${bulk.entityCount} objects.`, 'message');
}

export function importDxf(modelIn: DxfModel): void {
  const faces = modelIn.faces.flatMap((face) => {
    const edges: DrawEntity[] = [
      { id: 'f', type: 'line', layer: 'TIN', color: 'bylayer', a: face.a, b: face.b },
      { id: 'f', type: 'line', layer: 'TIN', color: 'bylayer', a: face.b, b: face.c },
      { id: 'f', type: 'line', layer: 'TIN', color: 'bylayer', a: face.c, b: face.a },
    ];
    return edges;
  });
  importDrawing([...modelIn.entities, ...faces], [...modelIn.layers, 'TIN'], 'DXFIN', modelIn.bulk);
  for (const layer of modelIn.layerRecords ?? []) {
    if (!model.layer(layer.name)) {
      model.doc.layers.push(normalizeLayer({ name: layer.name, color: layer.color, colorIndex: layer.colorIndex, lineType: layer.lineType, lineWeight: layer.lineWeight, frozen: layer.frozen, locked: layer.locked, visible: layer.visible }));
    }
  }
  if (modelIn.layerRecords?.length) model.emit();
}

export function importDwgModel(imported: DwgImport): void {
  model.checkpoint('DWGIN');
  for (const layer of imported.layers) {
    if (!model.layer(layer.name)) model.doc.layers.push(layer);
  }
  for (const entity of imported.entities) model.add({ ...entity, id: model.nextId() });
  model.emit();
  let doc = getXrefDoc();
  for (const xref of imported.xrefs) {
    doc = attachXref(doc, {
      name: xref.name,
      savedPath: xref.path,
      kind: 'dwg',
      attachType: xref.overlay ? 'overlay' : 'attach',
      insertion: xref.insertion,
      scale: xref.scale,
      rotation: xref.rotation,
      snapshot: { entities: xref.entities, layers: xref.layers },
      found: xref.entities.length > 0,
    });
    if (!xref.referenced) {
      const id = doc.records[doc.records.length - 1]?.id;
      doc = { ...doc, records: doc.records.map((record) => (record.id === id ? { ...record, referenced: false } : record)) };
    }
  }
  if (imported.xrefs.length > 0) {
    replaceXrefs(doc);
    patchChrome({ xrefs: true });
  }
  for (const note of imported.notes) say(note, 'message');
  publishView();
  frameImported();
}

function frameImported(): void {
  const box = drawingBounds(model.doc);
  const view = getView();
  if (!box || !view) return;
  view.zoomWindow({ x: box.minX, y: box.minY }, { x: box.maxX, y: box.maxY });
}

function commandDashXref(line: string): void {
  const result = dashXref(getXrefDoc(), line, model.doc.layers.map((layer) => layer.name));
  for (const layer of result.layers) {
    if (!model.layer(layer.name)) model.doc.layers.push(layer);
  }
  if (result.entities.length || result.layers.length) {
    model.checkpoint('XREF');
    for (const entity of result.entities) model.add(entity);
    model.emit();
  }
  replaceXrefs(result.doc);
  for (const row of result.message.split('\n')) say(row, 'message');
  publishUi();
  publishView();
}

function bindSelectedLayers(): void {
  const doc = getXrefDoc();
  const id = doc.selectedId ?? doc.records.find((record) => record.snapshot)?.id;
  const record = doc.records.find((item) => item.id === id);
  if (!record?.snapshot) {
    say('No external reference.', 'error');
    return;
  }
  const extracted = xbindLayers(doc, record.id, record.snapshot.layers.map((layer) => layer.name), model.doc.layers.map((layer) => layer.name));
  for (const layer of extracted.layers) model.doc.layers.push(layer);
  model.emit();
  publishView();
  say(`Xbind ${extracted.layers.length} layer${extracted.layers.length === 1 ? '' : 's'}.`, 'message');
}

function clipSelected(): void {
  const doc = getXrefDoc();
  const record = doc.records.find((item) => item.id === doc.selectedId) ?? doc.records[0];
  if (!record) {
    say('Select an external reference.', 'error');
    return;
  }
  if (record.clip?.enabled) {
    replaceXrefs(setXrefClip(doc, record.id, { ...record.clip, enabled: false }));
    say('XCLIP off.', 'message');
    publishView();
    return;
  }
  const bounds = xrefBounds(record);
  if (!bounds) {
    say('Nothing to clip.', 'error');
    return;
  }
  replaceXrefs(
    setXrefClip(doc, record.id, {
      shape: 'rect',
      points: [
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.maxY },
      ],
      invert: false,
      enabled: true,
    }),
  );
  say('XCLIP rectangle on.', 'message');
  publishView();
}

export function applyXrefBind(id: string, mode: 'bind' | 'insert'): void {
  const result = bindXref(getXrefDoc(), id, mode, model.doc.layers.map((layer) => layer.name));
  for (const layer of result.layers) {
    if (!model.layer(layer.name)) model.doc.layers.push(layer);
  }
  if (result.entities.length) {
    model.checkpoint(mode === 'bind' ? 'BIND' : 'INSERT');
    for (const entity of result.entities) model.add(entity);
    model.emit();
  }
  replaceXrefs(result.doc);
  publishView();
  say(mode === 'bind' ? 'Xref bound.' : 'Xref inserted.', 'message');
}

export function readDrawingFile(): DrawingFile {
  return model.toFile();
}

export function writeDrawingFile(file: DrawingFile | null): void {
  session = null;
  prompt = null;
  suspended = null;
  acquired = [];
  overlay = { cursor: null, snap: null, figs: [], tracks: [], selectA: null, selectB: null, hoverId: null, lasso: null };
  vertexMarker = null;
  picking = false;
  model.load(file ? drawingDocFromFile(file) : emptyDrawing());
  publishUi();
}

export function userAliasEntries(): { alias: string; command: string }[] {
  return [...userAliases.entries()].map(([alias, command]) => ({ alias, command }));
}

export function setUserAlias(alias: string, command: string): string | null {
  const key = alias.trim().toUpperCase();
  const target = command.trim().toUpperCase();
  if (!/^[A-Z0-9?_-]+$/.test(key)) return 'Alias must be letters, digits, ?, _, or -.';
  const resolved = resolveToken(target);
  if (!resolved.known && !target) return 'Command name required.';
  if (!resolved.known) return `Unknown command "${target}".`;
  userAliases.set(key, resolved.command);
  persist();
  say(`Alias ${key} set to ${resolved.command}.`, 'message');
  return null;
}

export function removeUserAlias(alias: string): void {
  userAliases.delete(alias.toUpperCase());
  persist();
  publishUi();
}

export function setAliasEditor(open: boolean): void {
  aliasEditor = open;
  publishUi();
}

export function toggleExpanded(): void {
  expanded = !expanded;
  publishUi();
}

export function setExpanded(open: boolean): void {
  expanded = open;
  publishUi();
}

export function toggleSetting(name: 'ortho' | 'polar' | 'otrack' | 'dyn' | 'osnap' | 'gridSnap'): void {
  settings[name] = !settings[name];
  const label = { ortho: 'Ortho', polar: 'Polar', otrack: 'Otrack', dyn: 'Dynamic input', osnap: 'Object snap', gridSnap: 'Snap' }[name];
  say(`<${label} ${settings[name] ? 'on' : 'off'}>`, 'message');
  persist();
}

export function setInputValue(value: string): void {
  input = value;
  recall = { ...recall, cursor: -1 };
  refreshSuggestions();
  publishUi();
}

export function appendInput(char: string): void {
  setInputValue(input + char);
}

export function browseHistory(direction: 'up' | 'down'): void {
  if (suggestions.length > 0 && input.trim()) {
    if (!suggestionArmed) {
      suggestionArmed = true;
      suggestionIndex = direction === 'down' ? 0 : suggestions.length - 1;
    } else {
      suggestionIndex = direction === 'down' ? Math.min(suggestions.length - 1, suggestionIndex + 1) : Math.max(0, suggestionIndex - 1);
    }
    publishUi();
    return;
  }
  const next = recallStep(recall, direction, input);
  recall = next.state;
  input = next.value;
  refreshSuggestions();
  publishUi();
}

export function acceptSuggestion(): void {
  const pick = suggestions[suggestionIndex];
  if (!pick) return;
  input = '';
  suggestions = [];
  publishUi();
  execute(pick.command, pick.command);
}

function refreshSuggestions(): void {
  if (session || !input.trim()) {
    suggestions = [];
    suggestionIndex = 0;
    suggestionArmed = false;
    return;
  }
  suggestions = suggestCommands(input, suggestionSources(userAliases));
  suggestionIndex = 0;
  suggestionArmed = false;
}

export function reportLine(text: string, kind: LogLine['kind'] = 'message'): void {
  say(text, kind);
  publishUi();
}

function say(text: string, kind: LogLine['kind']): void {
  lines = appendLog(lines, { text, kind });
  persist();
  publishUi();
}

function applyResult(result: SessionResult): void {
  for (const message of result.messages) say(message, message.startsWith('Unknown') || message.includes('not yet') ? 'error' : 'message');
  session = result.session;
  if (result.revert) session = null;
  prompt = result.prompt;
  if (!session && suspended) {
    const held = suspended;
    suspended = null;
    session = held.session;
    prompt = held.prompt;
  }
  if (prompt) say(formatPrompt(prompt), 'prompt');
  for (const effect of result.effects) applyEffect(effect);
  if (!session) acquired = [];
  overlay = { ...overlay, figs: sessionPreview(session, overlay.cursor), selectA: null, selectB: null };
  refreshSuggestions();
  publishUi();
  publishView();
}

function applyEffect(effect: SessionEffect): void {
  const bridge = getView();
  const cad = getHost();
  if (effect.type === 'zoom-extents') bridge?.zoomExtents();
  if (effect.type === 'zoom-window') bridge?.zoomWindow(effect.a, effect.b);
  if (effect.type === 'zoom-scale') bridge?.zoomScale(effect.factor);
  if (effect.type === 'zoom-center') {
    if (bridge?.zoomCenter) bridge.zoomCenter(effect.point, effect.factor);
    else bridge?.zoomScale(effect.factor);
  }
  if (effect.type === 'zoom-previous') bridge?.zoomPrevious();
  if (effect.type === 'pan-by') bridge?.panBy(effect.a, effect.b);
  if (effect.type === 'pan-displacement') bridge?.panDisplacement(effect.x, effect.y);
  if (effect.type === 'nav-mark') bridge?.markOriginal();
  if (effect.type === 'zoom-original') bridge?.zoomOriginal();
  if (effect.type === 'orbit-constrained') applyOrbit('constrained');
  if (effect.type === 'redraw') bridge?.redraw();
  if (effect.type === 'tool') {
    cad?.prepareAlignment(effect.tangents ? 'tangents' : effect.curves ? 'curves' : effect.spirals ? 'spirals' : 'layout');
    cad?.setTool(effect.tool);
  }
  if (effect.type === 'alignment-points') cad?.alignmentFromPoints(effect.points);
  if (effect.type === 'alignment-boundary') cad?.alignmentFromBoundary();
  if (effect.type === 'unit') cad?.setUnit(effect.unit);
  if (effect.type === 'dialog') {
    dialog = effect.dialog;
    publishUi();
  }
  if (effect.type === 'download') cad?.downloadFile?.(effect.filename, effect.text, effect.mime);
}

export function runCommand(token: string, options?: { mode?: 'layout' | 'tangents' | 'curves' | 'spirals' }): void {
  const trimmed = token.trim();
  if (/^-XR(EF)?\b/i.test(trimmed)) {
    commandDashXref(trimmed);
    return;
  }
  if (trimmed.startsWith("'")) {
    execute(trimmed, '', undefined, options);
    return;
  }
  const resolved = resolveToken(token, userAliases);
  execute(resolved.token || token, resolved.command, resolved, options);
}

export function navigationMode(): 'pan' | 'zoom' | 'window' | null {
  if (!session) return null;
  if ((session.command === 'PAN' || session.command === 'ZOOM') && session.phase === 'realtime') {
    return session.command === 'ZOOM' ? 'zoom' : 'pan';
  }
  if (session.command === 'ZOOM' && session.phase === 'window') return 'window';
  return null;
}

export function navigationMenu(action: string): void {
  if (!session) return;
  if (session.command !== 'PAN' && session.command !== 'ZOOM') return;
  applyResult(stepCommand(session, model, settings, { kind: 'keyword', name: action }, clipboard));
}

export const IMMEDIATE_COMMANDS = [
  'UNDO', 'U', 'REDO', 'REGEN', 'REGENALL', 'REDRAW', 'REDRAWALL', 'ZOOMEXTENTS',
  'HELP', 'ALIASEDIT', 'NEW', 'OPEN', 'SAVE', 'QSAVE', 'SAVEAS', 'EXPORT', 'QUIT',
  'COPYCLIP', 'CUTCLIP', 'COPYBASE', 'COPYLINK', 'PASTEBLOCK', 'PASTEORIG', 'PASTESPEC',
  'AI_SELALL', 'FIND', 'SELECTSIMILAR',
  '3DORBIT', '3DFORBIT', '3DCORBIT', 'PLAN', 'CLEANSCREENON', 'CLEANSCREENOFF',
  'CAMERA', '3DWALK', '3DFLY', 'RENDER', 'OLELINKS', 'LASZIP', 'AUDIT', 'CREATESURFACECOMPOSITE',
'VPORTS', 'VIEW', 'UCSICON', 'NAVBARDISPLAY', 'VIEWCUBE', 'VSCURRENT',
  'XREF', 'XATTACH', 'IMAGEATTACH', 'XBIND', 'XCLIP',
  'ORTHO', 'POLAR', 'OTRACK', 'DYNMODE',
  'LAYER', 'PROPERTIES', 'PROPERTIESCLOSE', 'QSELECT', 'QUICKPROPERTIES', 'LWDISPLAY',
  'LAYUNISO', 'LAYON', 'LAYTHW', 'LAYERP', 'LAYP',
  'CREATESURFACE', 'CREATE3DMESH', 'MESHSECTION', 'ADDPOINTFILE', 'LANDXMLIN', 'IMPORTPOINTS',
  'ADDSURFACEBOUNDARIES', 'ADDSURFACEBREAKLINES', 'CONTOURS', 'EDITSURFACEPROPERTIES',
  'CREATEALIGNMENTLAYOUT', 'CREATEPROFILEFROMSURFACE', 'CREATEPROFILEVIEW',
  'CREATEPROFILELAYOUT', 'CREATESAMPLELINES', 'CREATESECTIONVIEW', 'CREATEMULTIPLESECTIONVIEW',
  'CREATEPOINTS', 'CREATEPOINTGROUP', 'IMPORTSURVEYDATA', 'TRAVERSEEDITOR', 'CREATESURVEYFIGURE',
  'CREATEFEATURELINES', 'CREATEPARCELFROMOBJECTS', 'CREATEGRADING', 'CREATEOFFSETALIGNMENT',
  'CALCULATESUPERELEVATION', 'CREATEPROFILEFROMCORRIDOR', 'CREATECORRIDOR', 'CREATEMASSHAULDIAGRAM',
  'CREATEINTERSECTION', 'CREATEASSEMBLY', 'CREATEPIPENETWORK', 'CREATEPRESSURENETWORK',
  'CREATEMULTIPLEPROFILEVIEW', 'SUPERIMPOSEPROFILE', 'CREATEQUICKPROFILE', 'ADDPROFILEVIEWBANDS',
] as const;

function execute(typed: string, command: string, resolved?: ResolvedCommand, options?: { mode?: 'layout' | 'tangents' | 'curves' | 'spirals' }): void {
  const raw = typed.trim();
  const quote = raw.startsWith("'");
  const body = quote ? raw.slice(1).trim() : raw;
  const hit = quote ? resolveToken(body, userAliases) : (resolved ?? resolveToken(typed, userAliases));
  if (quote && hit.command !== 'PAN' && hit.command !== 'ZOOM') {
    say(`${(hit.command || body || typed).toUpperCase()}: not a transparent command`, 'error');
    return;
  }
  if (session && !quote) {
    const cancelled = stepCommand(session, model, settings, { kind: 'cancel' }, clipboard);
    session = null;
    prompt = null;
    suspended = null;
    for (const message of cancelled.messages) say(message, 'message');
  }
  if (quote && session && prompt && !suspended) {
    suspended = { session, prompt };
    session = null;
    prompt = null;
  }
  if (getHost()?.getTool() !== 'pan') getHost()?.cancelTool();
  const shown = (quote ? `'${body}` : raw).toUpperCase() || command;
  say(`Command: ${shown}`, 'echo');
  recall = pushRecall(recall, shown);
  input = '';
  suggestions = [];
  if (!hit.known) {
    say(unknownMessage(shown), 'error');
    return;
  }
  if (hit.retired || isRetired(hit.command)) {
    say(retiredMessage(hit.command), 'error');
    return;
  }
  if (!hit.implemented) {
    say(unavailableMessage(hit.command), 'error');
    return;
  }
  if (hit.command === 'PASTECLIP' || hit.command === 'PASTEBLOCK' || hit.command === 'PASTEORIG' || hit.command === 'PASTESPEC') {
    void beginPaste(hit.command);
    return;
  }
  if (SESSION_COMMANDS.has(hit.command)) {
    cadView();
    applyResult(beginCommand(hit.command, model, settings, clipboard));
    return;
  }
  immediate(hit.command, options);
  publishUi();
  publishView();
}

function cadView(): void {
  const tool = getHost()?.getTool();
  if (tool && tool !== 'pan') getHost()?.cancelTool();
  const viewName = getHost();
  void viewName;
}

function immediate(command: string, options?: { mode?: 'layout' | 'tangents' | 'curves' | 'spirals' }): void {
  const cad = getHost();
  const bridge = getView();
  switch (command) {
    case 'U':
    case 'UNDO':
      commandUndo();
      return;
    case 'REDO':
      commandRedo();
      return;
    case 'REGEN':
    case 'REGENALL':
      bridge?.redraw();
      say('Regenerating model.', 'message');
      return;
    case 'REDRAW':
    case 'REDRAWALL':
      bridge?.redraw();
      say('Redrawing.', 'message');
      return;
    case 'ZOOMEXTENTS':
      bridge?.zoomExtents();
      return;
    case 'HELP':
      for (const line of helpText()) say(line, 'message');
      return;
    case 'ALIASEDIT':
      aliasEditor = true;
      return;
    case 'NEW':
      cad?.newProject();
      return;
    case 'OPEN':
      cad?.openProject();
      return;
    case 'SAVE':
    case 'QSAVE':
    case 'SAVEAS':
      cad?.saveProject();
      say('Project saved.', 'message');
      return;
    case 'EXPORT':
      applyResult(beginExport());
      return;
    case 'XREF':
      patchChrome({ xrefs: true });
      say('External references.', 'message');
      return;
    case 'XATTACH':
      patchChrome({ xrefs: true });
      requestUi('xref-attach');
      return;
    case 'IMAGEATTACH':
      patchChrome({ xrefs: true });
      requestUi('image-attach');
      return;
    case 'XBIND':
      bindSelectedLayers();
      return;
    case 'XCLIP':
      clipSelected();
      return;
    case 'QUIT':
      say('Civil Design runs in the browser. Close the tab to exit.', 'message');
      return;
    case 'COPYCLIP':
      copyClip(false);
      return;
    case 'COPYLINK':
      copyClip(true);
      return;
    case 'CUTCLIP': {
      const parted = partitionEditable(model.doc, model.doc.selection);
      const entities = parted.editable.map((id) => model.entity(id)).filter((entity): entity is DrawEntity => Boolean(entity));
      if (parted.locked) say(lockMessage(parted.locked), 'message');
      if (entities.length === 0) {
        if (!parted.locked) say('No objects selected.', 'error');
        publishUi();
        return;
      }
      storeClipboard({ format: 'fieldline-clipboard', version: 1, base: null, link: false, entities: entities.map((entity) => structuredClone(entity)) });
      model.checkpoint('CUTCLIP');
      model.remove(entities.map((entity) => entity.id));
      model.emit();
      getView()?.redraw();
      say(`${entities.length} cut.`, 'message');
      return;
    }
    case 'COPYBASE':
      if (model.doc.selection.length === 0) {
        say('No objects selected.', 'error');
        return;
      }
      clipAsk = 'copybase';
      prompt = { head: 'Specify base point', expect: 'point', keywords: [], spaceCommits: false };
      say('Specify base point.', 'message');
      return;
    case 'AI_SELALL':
      model.doc.selection = selectAll(model.doc);
      model.emit();
      getView()?.redraw();
      say(`${model.doc.bulk && model.doc.bulk.entityCount > 0 ? model.doc.bulk.entityCount : model.doc.selection.length} selected.`, 'message');
      return;
    case 'SELECTSIMILAR':
      model.doc.selection = selectSimilar(model.doc, model.doc.selection);
      model.emit();
      getView()?.redraw();
      say(`${model.doc.selection.length} selected.`, 'message');
      return;
    case 'FIND':
      requestUi('find');
      return;
    case 'QSELECT':
      propertiesOpen = true;
      qselectOpen = true;
      say('Quick Select.', 'message');
      return;
    case 'CAMERA': {
      cad?.setView('3d');
      const taken = new Set(getWorkspace().namedViews.map((view) => view.name.toLowerCase()));
      let index = 1;
      while (taken.has(`camera ${index}`)) index += 1;
      const name = `Camera ${index}`;
      rememberActiveView(name);
      requestUi('named-views');
      say(`Camera "${name}" saved.`, 'message');
      return;
    }
    case '3DWALK':
      setLocomotion('walk');
      cad?.setView('3d');
      say('Walk. Arrow keys and WASD move. Esc stops.', 'message');
      return;
    case '3DFLY':
      setLocomotion('fly');
      cad?.setView('3d');
      say('Fly. Arrow keys move. Q and E change height. Esc stops.', 'message');
      return;
    case 'RENDER':
      setVisualStyle('realistic');
      cad?.setView('3d');
      requestUi('render');
      say('Rendering the view.', 'message');
      return;
    case 'OLELINKS':
      patchChrome({ xrefs: true });
      requestUi('links');
      say('Links.', 'message');
      return;
    case 'LASZIP':
      say(LAZ_REASON, 'error');
      cad?.openProject();
      return;
    case 'AUDIT':
      auditDrawing();
      return;
    case 'CREATESURFACECOMPOSITE':
      cad?.createVolumeSurface();
      return;
    case '3DORBIT':
      applyOrbit('constrained');
      say('Constrained orbit. Drag in the 3D view.', 'message');
      return;
    case '3DFORBIT':
      applyOrbit('free');
      say('Free orbit.', 'message');
      return;
    case '3DCORBIT':
      applyOrbit('continuous');
      say('Continuous orbit.', 'message');
      return;
    case 'PLAN':
      applyPlan();
      say('Plan view.', 'message');
      return;
    case 'CLEANSCREENON':
      patchChrome({ cleanScreen: true });
      say('Clean screen on.', 'message');
      return;
    case 'CLEANSCREENOFF':
      patchChrome({ cleanScreen: false });
      say('Clean screen off.', 'message');
      return;
    case 'VPORTS':
      requestUi('vports');
      return;
    case 'VIEW':
      requestUi('named-views');
      return;
    case 'UCSICON':
      patchChrome({ ucsIcon: !getWorkspace().ucsIcon });
      say(`UCS icon ${getWorkspace().ucsIcon ? 'on' : 'off'}.`, 'message');
      return;
    case 'LWDISPLAY':
      toggleLwDisplay();
      say(`Lineweight display ${settings.lwdisplay ? 'on' : 'off'}.`, 'message');
      return;
    case 'NAVBARDISPLAY':
      patchChrome({ navBar: !getWorkspace().navBar });
      return;
    case 'VIEWCUBE':
      patchChrome({ viewCube: !getWorkspace().viewCube });
      return;
    case 'VSCURRENT':
      requestUi('visual-styles');
      return;
    case 'ORTHO':
      toggleSetting('ortho');
      return;
    case 'POLAR':
      toggleSetting('polar');
      return;
    case 'OTRACK':
      toggleSetting('otrack');
      return;
    case 'DYNMODE':
      toggleSetting('dyn');
      return;
    case 'CREATE3DMESH':
      cad?.openMeshCreate();
      say('3D mesh · choose the points, then build.', 'message');
      return;
    case 'MESHSECTION':
      cad?.openMeshSection();
      say('Mesh section · choose stations or a section line.', 'message');
      return;
    case 'LAYER':
      layerManagerOpen = true;
      say('Layer Properties Manager.', 'message');
      return;
    case 'PROPERTIES':
      if (propertiesOpen || getWorkspace().properties) {
        closeProperties();
        say('Properties closed.', 'message');
        return;
      }
      propertiesOpen = true;
      patchChrome({ properties: true });
      say('Properties palette.', 'message');
      return;
    case 'PROPERTIESCLOSE':
      closeProperties();
      return;
    case 'QUICKPROPERTIES':
      quickProperties = !quickProperties;
      say(`Quick properties ${quickProperties ? 'on' : 'off'}.`, 'message');
      return;
    case 'LAYON':
      layerAction(() => {
        setLayersOn(model.doc, true);
      }, 'All layers on.');
      return;
    case 'LAYTHW':
      layerAction(() => {
        thawAll(model.doc);
      }, 'All layers thawed.');
      return;
    case 'LAYUNISO':
      model.checkpoint();
      say(layuniso(model.doc) ? 'Layer isolation restored.' : 'No LAYISO state to restore.', 'message');
      model.emit();
      publishView();
      return;
    case 'LAYERP':
    case 'LAYP':
      model.checkpoint();
      say(restorePreviousLayers(model.doc) ? 'Previous layer state restored.' : 'No previous layer state.', 'message');
      model.emit();
      publishView();
      return;
    case 'CREATESURFACE':
    case 'ADDPOINTFILE':
    case 'LANDXMLIN':
    case 'IMPORTPOINTS':
      cad?.openImport();
      say('Select a point file or LandXML surface.', 'message');
      return;
    case 'ADDSURFACEBOUNDARIES':
      cad?.setTool('boundary');
      return;
    case 'ADDSURFACEBREAKLINES':
      cad?.setTool('breakline');
      return;
    case 'CONTOURS':
      cad?.toggleContours();
      return;
    case 'EDITSURFACEPROPERTIES':
      cad?.showInspector();
      say('Surface properties opened.', 'message');
      return;
    case 'CREATEALIGNMENTLAYOUT':
      cad?.prepareAlignment(options?.mode ?? 'layout');
      cad?.setTool('alignment');
      cad?.setView('plan');
      return;
    case 'CREATEPROFILEFROMSURFACE':
    case 'CREATEPROFILEVIEW':
      cad?.showProfile();
      return;
    case 'CREATEPROFILELAYOUT':
      cad?.createDesignProfile();
      return;
    case 'CREATESAMPLELINES':
      cad?.createSampleLines();
      return;
    case 'CREATESECTIONVIEW':
      cad?.showSections('single');
      return;
    case 'CREATEMULTIPLESECTIONVIEW':
      cad?.showSections('multiple');
      return;
    case 'CREATEPOINTS':
    case 'CREATEPOINTGROUP':
    case 'IMPORTSURVEYDATA':
    case 'TRAVERSEEDITOR':
    case 'CREATESURVEYFIGURE':
    case 'CREATEFEATURELINES':
    case 'CREATEPARCELFROMOBJECTS':
    case 'CREATEGRADING':
    case 'CREATEOFFSETALIGNMENT':
    case 'CALCULATESUPERELEVATION':
    case 'CREATEPROFILEFROMCORRIDOR':
    case 'CREATECORRIDOR':
    case 'CREATEMASSHAULDIAGRAM':
    case 'CREATEINTERSECTION':
    case 'CREATEASSEMBLY':
    case 'CREATEPIPENETWORK':
    case 'CREATEPRESSURENETWORK':
    case 'CREATEMULTIPLEPROFILEVIEW':
    case 'SUPERIMPOSEPROFILE':
    case 'CREATEQUICKPROFILE':
    case 'ADDPROFILEVIEWBANDS':
      cad?.openCivilCommand(command);
      say(`${command} is ready. Set the values, then Run.`, 'message');
      return;
    default:
      say(unavailableMessage(command), 'error');
  }
}

function beginExport(): SessionResult {
  return {
    session: {
      command: 'EXPORT',
      phase: 'menu',
      ids: [],
      pts: [],
      aux: '',
      n: 0,
      n2: 0,
      flag: false,
      window: null,
      crossing: false,
      checked: false,
      extra: [],
    },
    prompt: {
      head: 'Export',
      expect: 'any',
      keywords: ['Contours', 'Triangles', 'LandXML', 'Volume', 'Obj', 'Stl', 'Ply', 'Sections'].map((label) => ({ label })),
      def: 'Contours',
      spaceCommits: true,
    },
    messages: [],
    effects: [],
    revert: false,
  };
}

function selectedEntities(): DrawEntity[] {
  return model.doc.selection.map((id) => model.entity(id)).filter((entity): entity is DrawEntity => Boolean(entity));
}

function storeClipboard(payload: ClipboardPayload): void {
  rememberClipboard(payload);
  clipboard = payload.entities.map((entity) => structuredClone(entity));
  void writeClipboardPayload(payload);
}

function copyClip(link: boolean, base: Vec3 | null = null): void {
  const entities = selectedEntities();
  if (entities.length === 0) {
    say('No objects selected.', 'error');
    return;
  }
  storeClipboard({ format: 'fieldline-clipboard', version: 1, base, link, entities: entities.map((entity) => structuredClone(entity)) });
  say(link ? `${entities.length} copied with a link.` : `${entities.length} copied.`, 'message');
}

async function syncClipboard(): Promise<void> {
  const payload = await readClipboardPayload();
  if (!payload || payload.entities.length === 0) return;
  storeClipboard(payload);
}

async function beginPaste(command: string): Promise<void> {
  await syncClipboard();
  if (clipboard.length === 0) {
    say('Clipboard is empty.', 'error');
    publishUi();
    return;
  }
  if (command === 'PASTEORIG') {
    placeClipboard('original', null);
    return;
  }
  if (command === 'PASTESPEC') {
    requestUi('paste-special');
    publishUi();
    return;
  }
  if (command === 'PASTEBLOCK') {
    clipAsk = 'pasteblock';
    prompt = { head: 'Specify insertion point', expect: 'point', keywords: [], spaceCommits: false };
    say('Specify insertion point.', 'message');
    publishUi();
    return;
  }
  applyResult(beginCommand('PASTECLIP', model, settings, clipboard));
  publishUi();
  publishView();
}

function placeClipboard(mode: 'point' | 'original' | 'block', at: Vec3 | null): void {
  const payload = rememberedClipboard() ?? { format: 'fieldline-clipboard' as const, version: 1 as const, base: null, link: false, entities: clipboard };
  if (payload.entities.length === 0) {
    say('Clipboard is empty.', 'error');
    return;
  }
  model.checkpoint(mode === 'block' ? 'PASTEBLOCK' : mode === 'original' ? 'PASTEORIG' : 'PASTECLIP');
  const placed = pasteEntities(payload, mode, at, () => model.nextId());
  for (const entity of placed.entities) model.add(entity);
  model.doc.selection = placed.entities.map((entity) => entity.id);
  model.emit();
  getView()?.redraw();
  say(placed.block ? `${placed.entities.length} pasted as ${placed.block.name}.` : `${placed.entities.length} pasted.`, 'message');
  publishUi();
  publishView();
}

function answerClipPoint(point: Vec3): void {
  const kind = clipAsk;
  clipAsk = null;
  prompt = null;
  if (kind === 'copybase') copyClip(false, point);
  if (kind === 'pasteblock') placeClipboard('block', point);
  publishUi();
}

export function startZoom(option?: string): void {
  runCommand('ZOOM');
  if (option) submitInput(option);
}

export function runViewportLayout(count: ViewportCount): void {
  applyViewportLayout(count);
  say(`${count} viewport${count === 1 ? '' : 's'}.`, 'message');
  publishUi();
}

export function runPreset(preset: ViewPreset): void {
  applyPreset(preset);
  say(`${preset} view.`, 'message');
  publishUi();
}

export function runVisualStyle(style: VisualStyle): void {
  setVisualStyle(style);
  say(`Visual style ${style}.`, 'message');
  publishUi();
}

export function zoomSelection(): void {
  const view = getView();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of model.doc.selection) {
    const entity = model.entity(id);
    const bounds = entity ? entityBounds(entity) : null;
    if (!bounds) continue;
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }
  if (!Number.isFinite(minX)) {
    say('No objects selected. Zoom extents.', 'message');
    view?.zoomExtents();
    return;
  }
  say('Zoom object.', 'message');
  view?.zoomWindow({ x: minX, y: minY }, { x: maxX, y: maxY });
}

export function applyFindReplace(query: string, replacement: string, matchCase: boolean): number {
  const result = replaceText(model.doc.entities, query, replacement, matchCase);
  if (result.count === 0) return 0;
  model.checkpoint('FIND');
  model.doc.entities = result.entities;
  model.emit();
  getView()?.redraw();
  return result.count;
}

export function undoSteps(count: number): void {
  let done = 0;
  let label: string | null = null;
  for (let i = 0; i < count; i++) {
    label = model.undoLabel() ?? label;
    if (!model.undo()) break;
    done += 1;
  }
  say(done ? (label ? `Undo ${label}.` : 'Undo.') : 'Nothing to undo.', 'message');
  publishView();
}

export function applyQuickSelect(filter: QuickFilter): number {
  model.doc.selection = quickSelect(model.doc, filter);
  model.emit();
  getView()?.redraw();
  say(`${model.doc.selection.length} selected.`, 'message');
  publishUi();
  publishView();
  return model.doc.selection.length;
}

export function submitInput(raw?: string): void {
  if (!session && picking && (raw === undefined || raw.trim() === '')) {
    picking = false;
    input = '';
    publishUi();
    publishView();
    return;
  }
  if (raw === undefined && suggestionArmed && suggestions[suggestionIndex] && !session && !clipAsk) {
    acceptSuggestion();
    return;
  }
  const text = raw ?? input;
  input = '';
  suggestions = [];
  suggestionArmed = false;
  if (clipAsk) {
    const parsed = parsePromptInput(text, prompt ?? { head: 'Specify a point', expect: 'point', keywords: [], spaceCommits: false }, null, overlay.cursor);
    if (parsed.kind === 'point') answerClipPoint(parsed.point);
    else say('Point required.', 'error');
    publishUi();
    return;
  }
  if (text.trim().startsWith("'")) {
    runCommand(text.trim());
    return;
  }
  if (session?.command === 'EXPORT') {
    const choice = (text.trim() || 'Contours').toLowerCase();
    const kind = choice.startsWith('obj')
      ? 'obj'
      : choice.startsWith('stl')
        ? 'stl'
        : choice.startsWith('ply')
          ? 'ply'
          : choice.startsWith('sec') || choice.startsWith('report')
            ? 'sections'
            : choice.startsWith('t')
              ? 'triangles'
              : choice.startsWith('l')
                ? 'landxml'
                : choice.startsWith('v')
                  ? 'volume'
                  : 'contours';
    session = null;
    prompt = null;
    getHost()?.exportKind(kind);
    publishUi();
    return;
  }
  if (grip && !session) {
    const parsed = parsePromptInput(text, gripPrompt(), grip.origin, overlay.cursor);
    if (parsed.kind === 'empty') {
      grip = null;
      prompt = null;
      publishUi();
      publishView();
      return;
    }
    if (grip.mode === 'scale' && parsed.kind === 'keyword' && parsed.name.toLowerCase() === 'reference') {
      const next = stepGripScale(grip.phase, grip.reference, 'reference', 0);
      if (!next.ok) {
        say('Reference is available while specifying the scale factor.', 'error');
        publishUi();
        return;
      }
      grip = { ...grip, phase: next.phase, reference: next.reference };
      prompt = gripPrompt();
      say(formatPrompt(prompt), 'prompt');
      publishUi();
      return;
    }
    if (grip.mode === 'scale' && (grip.phase === 'ref' || grip.phase === 'new') && (parsed.kind === 'number' || parsed.kind === 'point')) {
      const length = parsed.kind === 'number' ? parsed.value : Math.hypot(parsed.point.x - grip.origin.x, parsed.point.y - grip.origin.y);
      const next = stepGripScale(grip.phase, grip.reference, 'length', length);
      if (!next.ok || (grip.phase === 'new' && next.factor == null)) {
        say('Requires a positive length.', 'error');
        publishUi();
        return;
      }
      if (next.factor != null) {
        commitGrip(overlay.cursor ?? grip.origin, next.factor);
        return;
      }
      grip = { ...grip, phase: next.phase, reference: next.reference };
      prompt = gripPrompt();
      say(formatPrompt(prompt), 'prompt');
      publishUi();
      return;
    }
    if (grip.mode === 'scale' && grip.phase === 'run' && parsed.kind === 'number') {
      const next = stepGripScale(grip.phase, grip.reference, 'factor', parsed.value);
      if (!next.ok || next.factor == null) {
        say('Requires a positive scale factor.', 'error');
        publishUi();
        return;
      }
      commitGrip(overlay.cursor ?? grip.origin, next.factor);
      return;
    }
    if (parsed.kind === 'point') {
      commitGrip(parsed.point);
      return;
    }
    if (parsed.kind === 'invalid') {
      say(parsed.message, 'error');
      publishUi();
      return;
    }
    grip = null;
    prompt = null;
    runCommand(text);
    return;
  }
  if (session && prompt) {
    const parsed = parsePromptInput(text, prompt, sessionBase(session), overlay.cursor);
    applyResult(stepCommand(session, model, settings, parsed, clipboard));
    persist();
    return;
  }
  const cad = getHost();
  if (cad && cad.getTool() !== 'pan') {
    if (!text.trim()) {
      cad.finishTool();
      return;
    }
    const parsed = parsePromptInput(text, { head: 'Specify a point or', expect: 'point', keywords: [{ label: 'Undo' }, { label: 'Close' }], spaceCommits: true }, null, overlay.cursor);
    if (parsed.kind === 'point') cad.addDraftPoint(parsed.point);
    else if (parsed.kind === 'keyword' && parsed.name.toLowerCase() === 'undo') cad.popDraftPoint();
    else if (parsed.kind === 'keyword' && parsed.name.toLowerCase() === 'close') cad.finishTool();
    else say(parsed.kind === 'invalid' ? parsed.message : 'Point or option keyword required.', 'error');
    publishUi();
    return;
  }
  if (!text.trim()) {
    const last = recall.items[recall.items.length - 1];
    if (last) runCommand(last);
    return;
  }
  runCommand(text);
}

function auditDrawing(): void {
  const doc = model.doc;
  const ids = new Set<string>();
  const layers = new Set(doc.layers.map((layer) => layer.name));
  let duplicate = 0;
  let zero = 0;
  let missing = 0;
  for (const entity of doc.entities) {
    if (ids.has(entity.id)) duplicate += 1;
    ids.add(entity.id);
    if (!layers.has(entity.layer)) missing += 1;
    if (entity.type === 'line') {
      const dx = entity.a.x - entity.b.x;
      const dy = entity.a.y - entity.b.y;
      const dz = entity.a.z - entity.b.z;
      if (dx * dx + dy * dy + dz * dz < 1e-12) zero += 1;
    }
  }
  const problems = duplicate + zero + missing;
  say(
    `Audit: ${doc.entities.length} objects, ${zero} zero-length, ${duplicate} duplicate ids, ${missing} missing layers.`,
    problems ? 'error' : 'message',
  );
}

export function cancelInput(): void {
  if (getWorkspace().locomotion !== 'none') {
    setLocomotion('none');
    say('Navigation stopped.', 'message');
    publishUi();
    return;
  }
  if (grip) {
    grip = null;
    prompt = null;
    say('Cancel.', 'message');
    publishUi();
    publishView();
    return;
  }
  if (clipAsk) {
    clipAsk = null;
    prompt = null;
    say('Cancel.', 'message');
    publishUi();
    return;
  }
  if (session) {
    applyResult(stepCommand(session, model, settings, { kind: 'cancel' }, clipboard));
    say('Cancel.', 'message');
    return;
  }
  if (input) {
    input = '';
    suggestions = [];
    publishUi();
    return;
  }
  const cad = getHost();
  if (cad && cad.getTool() !== 'pan') {
    cad.cancelTool();
    say('Cancel.', 'message');
    return;
  }
  cad?.dismissCivilCommand();
}

export function hoverWorld(world: Vec3, tolerance: number): void {
  const base = sessionBase(session);
  const snap = settings.osnap ? snapToDrawing(model.doc, world, tolerance, settings.osnapModes) : null;
  let point = snap ? snap.point : world;
  if (!snap) point = applyConstraint(base, world, settings.ortho, settings.polar, settings.polarAngle);
  if (!snap && settings.gridSnap && settings.gridSpacing > 0) {
    const step = settings.gridSpacing;
    point = { x: Math.round(point.x / step) * step, y: Math.round(point.y / step) * step, z: point.z };
  }
  let tracks = overlay.tracks;
  if (!snap && settings.otrack && settings.osnap && acquired.length > 0) {
    const angles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    if (settings.polar && settings.polarAngle > 0) {
      const step = (settings.polarAngle * Math.PI) / 180;
      for (let i = 0; i < Math.PI * 2 - 1e-6; i += step) angles.push(i);
    }
    const tracked = objectTrack(acquired, point, tolerance, angles);
    tracks = tracked ? tracked.lines : [];
    if (tracked) point = tracked.point;
  } else tracks = [];
  if (snap && settings.otrack && !acquired.some((item) => Math.hypot(item.x - snap.point.x, item.y - snap.point.y) < tolerance * 0.25)) {
    acquired = [...acquired, snap.point].slice(-8);
  }
  const hoverId = snap?.entityId ?? pickEntity(model.doc, point, tolerance);
  overlay = { ...overlay, cursor: point, snap, tracks, figs: grip ? [{ points: [grip.origin, point] }] : sessionPreview(session, point), hoverId };
  publishView();
}

let pointArm: ((point: Vec3) => void) | null = null;

export function armPoint(fn: ((point: Vec3) => void) | null): void {
  pointArm = fn;
}

export function clickWorld(point: Vec3): boolean {
  if (pointArm) {
    const fn = pointArm;
    pointArm = null;
    fn(point);
    return true;
  }
  if (clipAsk) {
    answerClipPoint(point);
    return true;
  }
  if (grip) {
    if (grip.mode === 'scale' && (grip.phase === 'ref' || grip.phase === 'new')) {
      const length = Math.hypot(point.x - grip.origin.x, point.y - grip.origin.y);
      const next = stepGripScale(grip.phase, grip.reference, 'length', length);
      if (!next.ok || (next.phase === 'run' && next.factor == null)) {
        say('Requires a positive length.', 'error');
        publishUi();
        return true;
      }
      if (next.factor != null) commitGrip(point, next.factor);
      else {
        grip = { ...grip, phase: next.phase, reference: next.reference };
        prompt = gripPrompt();
        say(formatPrompt(prompt), 'prompt');
        publishUi();
        publishView();
      }
      return true;
    }
    commitGrip(point);
    return true;
  }
  if (!session || !prompt) return false;
  if (prompt.expect === 'select') return false;
  input = '';
  applyResult(stepCommand(session, model, settings, { kind: 'point', point }, clipboard));
  return true;
}

export function pickWorld(ids: string[], at: Vec3, window: { minX: number; minY: number; maxX: number; maxY: number } | null, crossing: boolean, shift = false): void {
  const library = model.doc.library;
  const expanded = expandGroupSelection(library, ids, library?.pickStyle ?? 1);
  if (!session) {
    if (expanded.length === 0 && !shift) model.doc.selection = [];
    else if (shift) {
      const have = new Set(model.doc.selection);
      model.doc.selection = [
        ...model.doc.selection.filter((id) => !expanded.includes(id)),
        ...expanded.filter((id) => !have.has(id)),
      ];
    } else if (settings.pickadd || picking) model.doc.selection = [...new Set([...model.doc.selection, ...expanded])];
    else model.doc.selection = expanded;
    model.emit();
    publishView();
    publishUi();
    return;
  }
  applyResult(stepCommand(session, model, settings, { kind: 'picked', ids: expanded, window, crossing, at }, clipboard));
}

export function setSelectRect(a: Vec2 | null, b: Vec2 | null, lasso: Vec2[] | null = null): void {
  overlay = { ...overlay, selectA: a, selectB: b, lasso };
  publishView();
}

export function currentDialog(): CommandSnapshot['dialog'] {
  return dialog;
}

export function closeDialog(): void {
  dialog = null;
  publishUi();
}

export function submitDialogText(text: string): void {
  dialog = null;
  if (!session) {
    publishUi();
    return;
  }
  applyResult(stepCommand(session, model, settings, { kind: 'text', text }, clipboard));
  persist();
}

export function gripState(): { id: string; index: number; origin: Vec3; mode: GripMode } | null {
  return grip;
}

export function gripAt(world: Vec3, tolerance: number): { id: string; index: number; point: Vec3 } | null {
  if (session) return null;
  return nearestGrip(model.doc, world, tolerance);
}

function gripPrompt(): PromptSpec {
  if (grip?.mode === 'scale' && grip.phase === 'ref') return { head: 'Specify reference length', expect: 'number', keywords: [], spaceCommits: true };
  if (grip?.mode === 'scale' && grip.phase === 'new') return { head: 'Specify new length', expect: 'number', keywords: [], spaceCommits: true };
  if (grip?.mode === 'scale') return { head: gripLabel('scale'), expect: 'any', keywords: [{ label: 'Reference' }], spaceCommits: true };
  return { head: gripLabel(grip?.mode ?? 'stretch'), expect: 'point', keywords: [], spaceCommits: true };
}

export function beginGrip(id: string, index: number, origin: Vec3): void {
  grip = { id, index, origin, mode: 'stretch', phase: 'run', reference: 0 };
  prompt = gripPrompt();
  say(formatPrompt(prompt), 'prompt');
  publishUi();
  publishView();
}

export function cycleGrip(): boolean {
  if (!grip) return false;
  grip = { ...grip, mode: nextGripMode(grip.mode), phase: 'run', reference: 0 };
  prompt = gripPrompt();
  say(formatPrompt(prompt), 'prompt');
  publishUi();
  return true;
}

export function commitGrip(cursor: Vec3, scaleFactor?: number): void {
  if (!grip) return;
  const entity = model.entity(grip.id);
  if (!entity) {
    grip = null;
    prompt = null;
    publishUi();
    return;
  }
  model.checkpoint();
  model.replace(applyGrip(entity, grip.index, grip.mode, grip.origin, cursor, scaleFactor));
  model.emit();
  grip = null;
  prompt = null;
  say('Grip edit.', 'message');
  publishUi();
  publishView();
  persist();
}

export function cancelGrip(): boolean {
  if (!grip) return false;
  grip = null;
  prompt = null;
  publishUi();
  publishView();
  return true;
}

export function eraseSelection(): void {
  if (model.doc.selection.length === 0) {
    say('No objects selected.', 'error');
    return;
  }
  const parted = partitionEditable(model.doc, model.doc.selection);
  if (parted.locked) say(lockMessage(parted.locked), 'message');
  const entityIds = parted.editable.filter((id) => model.entity(id));
  if (entityIds.length === 0) {
    publishUi();
    return;
  }
  model.checkpoint('ERASE');
  model.remove(entityIds);
  model.emit();
  say(`${entityIds.length} erased.`, 'message');
  publishView();
}

function layerAction(fn: () => void, message: string): void {
  model.checkpoint();
  beginLayerCommand(model.doc);
  fn();
  endLayerCommand();
  model.emit();
  say(message, 'message');
  publishView();
}

export function editDrawing(fn: () => void): void {
  model.checkpoint();
  fn();
  model.emit();
  publishView();
}

export function editLayers(fn: () => void): void {
  model.checkpoint();
  beginLayerCommand(model.doc);
  fn();
  model.emit();
  publishUi();
  publishView();
}

export function closeLayerManager(): void {
  layerManagerOpen = false;
  endLayerCommand();
  publishUi();
}

export function closeProperties(): void {
  propertiesOpen = false;
  vertexMarker = null;
  picking = false;
  patchChrome({ properties: false });
  publishUi();
  publishView();
}

export function closeQuickSelect(): void {
  qselectOpen = false;
  publishUi();
}

export function setVertexMarker(marker: { id: string; index: number } | null): void {
  vertexMarker = marker;
  publishView();
}

export function getVertexMarker(): { id: string; index: number } | null {
  return vertexMarker;
}

export function beginPropertyPick(): void {
  picking = true;
  publishUi();
  publishView();
}

export function togglePickadd(): void {
  settings.pickadd = !settings.pickadd;
  persist();
  publishUi();
}

export function toggleLwDisplay(): void {
  settings.lwdisplay = !settings.lwdisplay;
  patchChrome({ lineweights: settings.lwdisplay });
  persist();
  publishUi();
  publishView();
}

export function postMessage(text: string): void {
  say(text, 'message');
  publishUi();
}

export function installDrawingHistory(): void {
  bindDrawingHistory({
    note: () => noteEdit('draw'),
    drop: () => dropLastDrawNote(),
    clear: () => clearEditHistory(),
  });
}

export function commandUndo(): void {
  if (session) {
    applyResult(stepCommand(session, model, settings, { kind: 'keyword', name: 'Undo' }, clipboard));
    return;
  }
  const kind = takeUndo();
  if (kind === 'surface') {
    say(getHost()?.undoProject() ? 'Undo.' : 'Nothing to undo.', 'message');
    publishView();
    return;
  }
  const label = model.undoLabel();
  say(model.undo() ? (label ? `Undo ${label}.` : 'Undo.') : 'Nothing to undo.', 'message');
  publishView();
}

export function commandRedo(): void {
  const kind = takeRedo();
  if (kind === 'surface') {
    say(getHost()?.redoProject() ? 'Redo.' : 'Nothing to redo.', 'message');
    publishView();
    return;
  }
  const label = model.redoLabel();
  say(model.redo() ? (label ? `Redo ${label}.` : 'Redo.') : 'Nothing to redo.', 'message');
  publishView();
}

export function dynamicReadout(): string | null {
  if (!settings.dyn || interactionMode() !== 'point' || !overlay.cursor) return null;
  if (input.trim()) return input;
  const base = sessionBase(session);
  const cursor = overlay.cursor;
  if (base) {
    const distance = Math.hypot(cursor.x - base.x, cursor.y - base.y);
    const angle = (Math.atan2(cursor.y - base.y, cursor.x - base.x) * 180) / Math.PI;
    return `${distance.toFixed(3)} < ${angle.toFixed(1)}`;
  }
  return `${cursor.x.toFixed(3)}, ${cursor.y.toFixed(3)}`;
}

export function syncToolPrompt(tool: string, draftCount: number): void {
  if (session) return;
  if (tool === 'pan') {
    if (prompt) {
      prompt = null;
      publishUi();
    }
    return;
  }
  const head =
    tool === 'boundary'
      ? `Outer boundary · ${draftCount} points. Specify next point or`
      : tool === 'breakline'
        ? `Breakline · ${draftCount} points. Specify next point or`
        : tool === 'featureline'
          ? `Feature line · ${draftCount} points. Specify next point or`
          : tool === 'parcel'
            ? `Parcel · ${draftCount} corners. Specify next point or`
            : tool === 'quickprofile'
              ? `Quick profile · ${draftCount} points. Specify next point or`
    : tool === 'point'
      ? 'Point · click to place, or Esc to finish'
      : tool === 'sectionline'
        ? `Section line · ${draftCount} of 2 points. Specify next point or`
        : `Alignment · ${draftCount} PIs. Specify next point or`;
  prompt = {
    head,
    expect: 'point',
    keywords: [{ label: 'Undo' }, { label: 'Close' }],
    spaceCommits: true,
  };
  publishUi();
  publishView();
}
