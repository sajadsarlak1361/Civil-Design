import type { Bounds } from '../engine/geometry';
import { dist } from '../engine/geometry';
import {
  alignmentPointsOf,
  arcFrom3,
  bulgeForTangent,
  entityArea,
  entityLength,
  entityPath,
  fmt,
  rotated,
  scaled,
  segmentTangent,
  mirrored,
  moved,
  v3,
  type DrawEntity,
  type DrawLine,
  type DrawingModel,
  type Vec3,
} from '../engine/drafting';
import {
  chamferLines,
  closestOnEntity,
  explodeEntity,
  extendEntity,
  filletLines,
  joinLines,
  joinPolylines,
  offsetEntity,
  polygonVertices,
  rectVertices,
  stretchEntity,
  trimAt,
} from '../engine/draftEdit';
import { parseColorInput } from '../engine/aci';
import { blockByName, explodeInsert } from '../engine/blocks';
import { ensureLibrary } from '../engine/cadLibrary';
import { activeClipboardBase } from '../engine/clipboard';
import { rectangleFromArea, rectangleVertices } from '../engine/curves';
import { parseCadEntity } from '../engine/entityOps';
import {
  beginLayerCommand,
  deleteLayer,
  deleteLayerAndObjects,
  endLayerCommand,
  findLayer,
  freezeLayer,
  layiso,
  layerTemplate,
  moveEntitiesToLayer,
} from '../engine/layers';
import { lockMessage, modelObject, partitionEditable, setLockedIds } from '../engine/objects';
import { listText, matchProperties, writeProp } from '../engine/properties';
import { REALTIME_NAV_PROMPT } from '../view/navigate';
import { HOME_COMMANDS } from './homeCatalog';
import { beginHome, homeBase, isHomeStep, previewHome, stepHome } from './homeSession';
import { matchKeyword, type PromptSpec } from './parser';

export interface Fig {
  points: Vec3[];
  closed?: boolean;
  circle?: { center: Vec3; radius: number };
}

export interface CadSettings {
  ortho: boolean;
  polar: boolean;
  polarAngle: number;
  otrack: boolean;
  dyn: boolean;
  osnap: boolean;
  osnapModes: ('endpoint' | 'midpoint' | 'center' | 'node' | 'intersection' | 'nearest')[];
  gridSnap: boolean;
  gridSpacing: number;
  filletRadius: number;
  chamfer1: number;
  chamfer2: number;
  offsetDist: number;
  textHeight: number;
  grips: boolean;
  filletTrim: boolean;
  lwdisplay: boolean;
  lwunits: 'mm' | 'in';
  laylockfadectl: number;
  pickadd: boolean;
}

export function defaultSettings(): CadSettings {
  return {
    ortho: false,
    polar: false,
    polarAngle: 90,
    otrack: false,
    dyn: true,
    osnap: true,
    osnapModes: ['endpoint', 'midpoint', 'center', 'node', 'intersection', 'nearest'],
    gridSnap: false,
    gridSpacing: 1,
    filletRadius: 0,
    chamfer1: 0,
    chamfer2: 0,
    offsetDist: 1,
    textHeight: 2.5,
    grips: true,
    filletTrim: true,
    lwdisplay: true,
    lwunits: 'mm',
    laylockfadectl: 50,
    pickadd: true,
  };
}

export interface Session {
  command: string;
  phase: string;
  ids: string[];
  pts: Vec3[];
  aux: string;
  n: number;
  n2: number;
  flag: boolean;
  window: Bounds | null;
  crossing: boolean;
  checked: boolean;
  /** Bulge of each polyline vertex, parallel to `pts`. */
  extra: number[];
}

export type SessionInput =
  | { kind: 'empty' }
  | { kind: 'cancel' }
  | { kind: 'point'; point: Vec3 }
  | { kind: 'number'; value: number }
  | { kind: 'keyword'; name: string }
  | { kind: 'text'; text: string }
  | { kind: 'invalid'; message: string }
  | { kind: 'picked'; ids: string[]; window: Bounds | null; crossing: boolean; at: Vec3 };

export type SessionEffect =
  | { type: 'zoom-extents' }
  | { type: 'zoom-window'; a: Vec3; b: Vec3 }
  | { type: 'zoom-scale'; factor: number }
  | { type: 'zoom-center'; point: Vec3; factor: number }
  | { type: 'zoom-previous' }
  | { type: 'pan-by'; a: Vec3; b: Vec3 }
  | { type: 'pan-displacement'; x: number; y: number }
  | { type: 'nav-mark' }
  | { type: 'zoom-original' }
  | { type: 'orbit-constrained' }
  | { type: 'redraw' }
  | { type: 'tool'; tool: 'boundary' | 'breakline' | 'alignment'; tangents?: boolean; curves?: boolean; spirals?: boolean }
  | { type: 'alignment-points'; points: Vec3[] }
  | { type: 'alignment-boundary' }
  | { type: 'unit'; unit: 'm' | 'ft' }
  | { type: 'dialog'; dialog: 'dimstyle' | 'insert' | 'groups' | 'mtext' | 'table' | 'battman' | 'style' | 'mleaderstyle' | 'block' }
  | { type: 'download'; filename: string; text: string; mime: string };

export interface SessionResult {
  session: Session | null;
  prompt: PromptSpec | null;
  messages: string[];
  effects: SessionEffect[];
  revert: boolean;
}

export const SESSION_COMMANDS = new Set<string>([
  'LINE', 'PLINE', 'CIRCLE', 'ARC', 'RECTANG', 'POLYGON', 'POINT', 'TEXT', 'MTEXT',
  'MOVE', 'COPY', 'ROTATE', 'SCALE', 'MIRROR', 'OFFSET', 'TRIM', 'EXTEND', 'FILLET', 'CHAMFER',
  'ERASE', 'EXPLODE', 'JOIN', 'STRETCH', 'LIST', 'DIST', 'ID', 'AREA', 'PROPERTIES',
  'ZOOM', 'PAN', '-PAN', 'LAYER', '-LAYER', 'LINETYPE', '-LINETYPE', 'LTSCALE', 'COLOR', 'CHPROP', '-CHPROP', 'MATCHPROP',
  'LOCKOBJECT', 'UNLOCKOBJECT',
  'LAYISO', 'LAYOFF', 'LAYFRZ', 'LAYLCK', 'LAYULK', 'LAYMCUR', 'LAYCUR', 'LAYMCH', 'LAYMRG', 'LAYDEL',
  'OSNAP', '-OSNAP', 'DSETTINGS', 'SNAP', 'UNITS', '-UNITS', 'PASTECLIP', 'CREATEALIGNMENTENTITIES',
  ...HOME_COMMANDS,
]);

function blank(command: string, phase: string): Session {
  return { command, phase, ids: [], pts: [], aux: '', n: 0, n2: 0, flag: false, window: null, crossing: false, checked: false, extra: [] };
}

function prompt(head: string, expect: PromptSpec['expect'], keywords: string[] = [], def?: string, spaceCommits = true): PromptSpec {
  return { head, expect, keywords: keywords.map((label) => ({ label })), def, spaceCommits };
}

function done(messages: string[] = [], effects: SessionEffect[] = []): SessionResult {
  return { session: null, prompt: null, messages, effects, revert: false };
}

function fail(session: Session, current: PromptSpec, message: string): SessionResult {
  return { session, prompt: current, messages: [message], effects: [], revert: false };
}

function show(session: Session, current: PromptSpec, messages: string[] = [], effects: SessionEffect[] = []): SessionResult {
  return { session, prompt: current, messages, effects, revert: false };
}

function end(session: Session, messages: string[] = [], effects: SessionEffect[] = [], revert = false): SessionResult {
  return { session: null, prompt: null, messages, effects, revert: revert && session.checked };
}

function kw(input: SessionInput, label: string): boolean {
  return input.kind === 'keyword' && input.name.toLowerCase() === label.toLowerCase();
}

function mark(session: Session, model: DrawingModel): void {
  if (!session.checked) {
    model.checkpoint(session.command);
    session.checked = true;
  }
}

function layerColor(model: DrawingModel): { layer: string; color: string; colorIndex?: number } {
  const colorIndex = model.doc.currentColorIndex;
  return colorIndex ? { layer: model.doc.currentLayer, color: model.doc.currentColor, colorIndex } : { layer: model.doc.currentLayer, color: model.doc.currentColor };
}

function selection(model: DrawingModel): string[] {
  return model.doc.selection.filter((id) => model.entity(id));
}

function addLine(model: DrawingModel, session: Session, a: Vec3, b: Vec3): void {
  mark(session, model);
  const id = model.nextId();
  const style = layerColor(model);
  model.add({ id, type: 'line', ...style, a, b });
  session.ids.push(id);
}

export function sessionBase(session: Session | null): Vec3 | null {
  if (!session || session.pts.length === 0) return null;
  if (session.command === 'LINE' || session.command === 'PLINE' || session.command === 'AREA') return session.pts[session.pts.length - 1];
  if (session.command === 'CIRCLE' && (session.phase === 'radius' || session.phase === 'diameter')) return session.pts[0];
  if (session.command === 'RECTANG' && session.phase === 'b') return session.pts[0];
  if (session.command === 'POLYGON' && session.phase === 'radius') return session.pts[0];
  if ((session.command === 'MOVE' || session.command === 'COPY' || session.command === 'ROTATE' || session.command === 'SCALE' || session.command === 'STRETCH') && session.phase === 'dest') {
    return session.pts[0];
  }
  if (session.command === 'MIRROR' && session.phase === 'p2') return session.pts[0];
  if (session.command === 'ARC' && session.phase === 'p2') return session.pts[0];
  if (session.command === 'ARC' && session.phase === 'p3') return session.pts[1];
  return homeBase(session) ?? session.pts[session.pts.length - 1];
}

export function sessionPreview(session: Session | null, cursor: Vec3 | null): Fig[] {
  if (!session || !cursor) return [];
  const last = session.pts[session.pts.length - 1];
  if (session.command === 'LINE' && last) return [{ points: [last, cursor] }];
  if (session.command === 'PLINE' && last) return [{ points: [...session.pts, cursor], closed: false }];
  if (session.command === 'CIRCLE' && session.phase === 'radius' && session.pts[0]) {
    return [{ points: [], circle: { center: session.pts[0], radius: dist(session.pts[0], cursor) } }];
  }
  if (session.command === 'CIRCLE' && session.phase === 'diameter' && session.pts[0]) {
    return [{ points: [], circle: { center: session.pts[0], radius: dist(session.pts[0], cursor) / 2 } }];
  }
  if (session.command === 'RECTANG' && session.phase === 'b' && session.pts[0]) {
    return [{ points: rectVertices(session.pts[0], cursor), closed: true }];
  }
  if (session.command === 'POLYGON' && session.phase === 'radius' && session.pts[0]) {
    return [{ points: polygonVertices(session.pts[0], dist(session.pts[0], cursor), Math.max(3, session.n)), closed: true }];
  }
  if (session.command === 'ARC' && session.phase === 'p3' && session.pts.length >= 2) {
    return [{ points: [session.pts[0], session.pts[1], cursor] }];
  }
  if (session.command === 'ARC' && session.phase === 'p2' && session.pts[0]) return [{ points: [session.pts[0], cursor] }];
  const homeFigs = previewHome(session, cursor);
  if (homeFigs.length > 0) return homeFigs;
  if ((session.command === 'MOVE' || session.command === 'COPY' || session.command === 'STRETCH') && session.phase === 'dest' && session.pts[0]) {
    return [{ points: [session.pts[0], cursor] }];
  }
  return [];
}

export function beginCommand(command: string, model: DrawingModel, settings: CadSettings, clipboard: DrawEntity[] = []): SessionResult {
  const name = command.toUpperCase();
  const home = beginHome(name, model, settings);
  if (home) return home;
  if (name === 'LINE') return show(blank(name, 'first'), prompt('Specify first point', 'point'));
  if (name === 'PLINE') return show(blank(name, 'first'), prompt('Specify start point', 'point'));
  if (name === 'CIRCLE') return show(blank(name, 'center'), prompt('Specify center point for circle or', 'point', ['3P', '2P']));
  if (name === 'ARC') return show(blank(name, 'p1'), prompt('Specify start point of arc or', 'point', ['Center']));
  if (name === 'RECTANG') return show(blank(name, 'a'), prompt('Specify first corner point or', 'point', RECT_KEYS));
  if (name === 'POLYGON') return show(blank(name, 'sides'), prompt('Enter number of sides', 'number', [], '4'));
  if (name === 'POINT') return show(blank(name, 'point'), prompt('Specify a point', 'point'));
  if (name === 'TEXT' || name === 'MTEXT') return show(blank(name, 'point'), prompt('Specify start point of text', 'point'));
  if (name === 'DIST') return show(blank(name, 'p1'), prompt('Specify first point', 'point'));
  if (name === 'ID') return show(blank(name, 'point'), prompt('Specify point', 'point'));
  if (name === 'AREA') return show(blank(name, 'points'), prompt('Specify first corner point or', 'point', ['Object', 'Undo']));
  if (name === 'ZOOM') return show(blank(name, 'main'), prompt('Specify corner of window, enter a scale factor, or', 'any', ['Extents', 'Window', 'Dynamic', 'Scale', 'Center', 'Previous', 'All'], 'Extents'));
  if (name === 'PAN') return show(blank(name, 'realtime'), realtimePrompt(), [], [{ type: 'nav-mark' }]);
  if (name === '-PAN') return show(blank(name, 'base'), prompt('Specify base point or displacement:', 'point'));
  if (name === 'OFFSET') {
    const session = blank(name, 'dist');
    return show(session, prompt('Specify offset distance or', 'number', ['Through'], fmt(settings.offsetDist, 3)));
  }
  if (name === 'FILLET') {
    return show(blank(name, 'first'), prompt(`Current radius = ${fmt(settings.filletRadius)}. Select first object or`, 'select', ['Radius', 'Polyline', 'Multiple', 'Undo']));
  }
  if (name === 'CHAMFER') {
    return show(blank(name, 'first'), prompt(`Distances = ${fmt(settings.chamfer1)} / ${fmt(settings.chamfer2)}. Select first line or`, 'select', ['Distance', 'Multiple']));
  }
  if (name === 'TRIM') return show(blank(name, 'cutters'), prompt('Select cutting edges, or press Enter to select all', 'select', ['Quick']));
  if (name === 'EXTEND') return show(blank(name, 'bounds'), prompt('Select boundary edges, or press Enter to select all', 'select', ['Quick']));
  if (name === '-LAYER') {
    return show(blank('-LAYER', 'menu'), prompt(`Current layer: "${model.doc.currentLayer}". Enter an option`, 'any', ['?', 'Make', 'Set', 'New', 'ON', 'OFF', 'Color']));
  }
  if (name === 'CHPROP' || name === '-CHPROP') {
    const ids = selection(model);
    if (ids.length > 0) {
      const next = occupy(name, ids);
      next.phase = 'prop';
      return show(next, prompt('Enter property to change', 'any', ['Color', 'Layer', 'Linetype', 'LtScale', 'LWeight', 'Transparency', 'Thickness', 'Locked'], undefined, false));
    }
    return show(blank(name, 'select'), prompt('Select objects', 'select'));
  }
  if (name === 'MATCHPROP') return show(blank(name, 'source'), prompt('Select source object', 'select'));
  if (name === 'LOCKOBJECT' || name === 'UNLOCKOBJECT') {
    const ids = selection(model);
    if (ids.length > 0) {
      model.checkpoint();
      const count = setLockedIds(model.doc, ids, name === 'LOCKOBJECT');
      model.emit();
      return done([`${count} ${name === 'LOCKOBJECT' ? 'locked' : 'unlocked'}.`]);
    }
    return show(blank(name, 'select'), prompt('Select objects', 'select'));
  }
  if (name === 'LAYISO' || name === 'LAYCUR' || name === 'LAYMCH') {
    const ids = selection(model);
    if (ids.length > 0 && name !== 'LAYMCH') return advanceSelect(occupy(name, ids), model, settings, { kind: 'empty' });
    return show(blank(name, 'select'), prompt(name === 'LAYMCH' ? 'Select objects to change' : 'Select objects', 'select'));
  }
  if (name === 'LAYOFF' || name === 'LAYFRZ' || name === 'LAYLCK' || name === 'LAYULK' || name === 'LAYMCUR' || name === 'LAYDEL' || name === 'LAYMRG') {
    return show(blank(name, 'pick'), prompt('Select an object on the desired layer', 'select'));
  }
  if (name === 'LINETYPE' || name === '-LINETYPE') {
    const current = model.layer(model.doc.currentLayer);
    return show(blank('LINETYPE', 'menu'), prompt(`Current linetype: "${current?.lineType ?? 'Continuous'}". Enter an option`, 'any', ['?', 'Set']));
  }
  if (name === 'LTSCALE') return show(blank(name, 'value'), prompt('Enter new linetype scale factor', 'number', [], fmt(model.doc.linetypeScale, 4)));
  if (name === 'COLOR') return show(blank(name, 'value'), prompt('New entity color [ByLayer, ByBlock, 1-255, or #hex]', 'any', [], model.doc.currentColor));
  if (name === 'OSNAP' || name === '-OSNAP') {
    return show(blank('OSNAP', 'menu'), prompt(`Current modes: ${settings.osnapModes.join(', ') || 'none'}. Toggle`, 'any', ['Endpoint', 'Midpoint', 'Center', 'Node', 'Intersection', 'Nearest', 'None', 'Off', 'On']));
  }
  if (name === 'DSETTINGS') {
    return show(blank(name, 'menu'), prompt('Toggle a drafting mode', 'any', ['Ortho', 'Polar', 'Otrack', 'Dyn', 'Osnap', 'Snap']));
  }
  if (name === 'SNAP') return show(blank(name, 'value'), prompt('Specify snap spacing or', 'number', ['ON', 'OFF'], fmt(settings.gridSpacing, 3)));
  if (name === 'UNITS' || name === '-UNITS') return show(blank('UNITS', 'menu'), prompt('Enter units', 'any', ['Meters', 'Feet']));
  if (name === 'PASTECLIP') {
    if (clipboard.length === 0) return done(['Clipboard is empty.']);
    return show(blank(name, 'point'), prompt('Specify insertion point', 'point'));
  }
  if (name === 'CREATEALIGNMENTENTITIES') {
    const picked = alignmentSource(model, selection(model));
    if (picked) return done([`Alignment from ${picked.type}.`], [{ type: 'alignment-points', points: alignmentPointsOf(picked) }]);
    return show(blank(name, 'select'), prompt('Select a line or polyline, or press Enter to use the surface boundary', 'select'));
  }
  const selectFirst = ['MOVE', 'COPY', 'ROTATE', 'SCALE', 'MIRROR', 'STRETCH', 'ERASE', 'EXPLODE', 'JOIN', 'LIST'];
  if (selectFirst.includes(name)) {
    const ids = selection(model);
    if (ids.length > 0 && name !== 'STRETCH') return advanceSelect(occupy(name, ids), model, settings, { kind: 'empty' });
    const head = name === 'STRETCH' ? 'Select objects to stretch by crossing window' : 'Select objects';
    return show(blank(name, 'select'), prompt(head, 'select'));
  }
  return done([`${name}: that command is not in this build.`]);
}

function occupy(command: string, ids: string[]): Session {
  const session = blank(command, 'select');
  session.ids = [...ids];
  return session;
}

function alignmentSource(model: DrawingModel, ids: string[]): DrawEntity | null {
  for (const id of ids) {
    const entity = model.entity(id);
    if (entity && (entity.type === 'polyline' || entity.type === 'line' || entity.type === 'arc')) return entity;
  }
  return null;
}

export function stepCommand(
  session: Session,
  model: DrawingModel,
  settings: CadSettings,
  input: SessionInput,
  clipboard: DrawEntity[] = [],
): SessionResult {
  if (input.kind === 'invalid') {
    const current = beginCommand(session.command, model, settings, clipboard);
    return fail(session, current.prompt ?? prompt('Command', 'any'), input.message);
  }
  if (input.kind === 'cancel') return cancel(session, model);
  try {
    if (isHomeStep(session.command)) {
      const home = stepHome(session, model, settings, input);
      if (home) return home;
    }
    return dispatch(session, model, settings, input, clipboard);
  } catch (error) {
    return end(session, [error instanceof Error ? error.message : 'The command failed.']);
  }
}

function cancel(session: Session, model: DrawingModel): SessionResult {
  if ((session.command === 'LINE' || session.command === 'PLINE' || session.command === 'POINT') && session.checked) {
    model.doc.selection = [];
    model.emit();
    return done();
  }
  if (session.checked) model.revert();
  return done(session.checked ? [] : []);
}

function dispatch(session: Session, model: DrawingModel, settings: CadSettings, input: SessionInput, clipboard: DrawEntity[]): SessionResult {
  switch (session.command) {
    case 'LINE':
      return line(session, model, input);
    case 'PLINE':
      return pline(session, model, input);
    case 'CIRCLE':
      return circle(session, model, input);
    case 'ARC':
      return arc(session, model, input);
    case 'RECTANG':
      return rect(session, model, input);
    case 'POLYGON':
      return polygon(session, model, input);
    case 'POINT':
      return point(session, model, input);
    case 'TEXT':
    case 'MTEXT':
      return text(session, model, settings, input);
    case 'MOVE':
    case 'COPY':
    case 'ROTATE':
    case 'SCALE':
    case 'MIRROR':
    case 'STRETCH':
    case 'ERASE':
    case 'EXPLODE':
    case 'JOIN':
    case 'LIST':
    case 'PROPERTIES':
      return modify(session, model, settings, input);
    case 'OFFSET':
      return offset(session, model, settings, input);
    case 'TRIM':
      return trim(session, model, input);
    case 'EXTEND':
      return extend(session, model, input);
    case 'FILLET':
      return fillet(session, model, settings, input);
    case 'CHAMFER':
      return chamfer(session, model, settings, input);
    case 'DIST':
      return distCmd(session, input);
    case 'ID':
      return idCmd(input);
    case 'AREA':
      return area(session, model, input);
    case 'ZOOM':
      return zoom(session, input);
    case 'PAN':
      return pan(session, input);
    case '-PAN':
      return panPoints(session, input);
    case 'LAYER':
    case '-LAYER':
      return layerCmd(session, model, input);
    case 'CHPROP':
    case '-CHPROP':
      return chprop(session, model, input);
    case 'MATCHPROP':
      return matchprop(session, model, input);
    case 'LOCKOBJECT':
    case 'UNLOCKOBJECT':
      return lockObjects(session, model, input);
    case 'LAYISO':
    case 'LAYOFF':
    case 'LAYFRZ':
    case 'LAYLCK':
    case 'LAYULK':
    case 'LAYMCUR':
    case 'LAYCUR':
    case 'LAYMCH':
    case 'LAYMRG':
    case 'LAYDEL':
      return layerTool(session, model, input);
    case 'LINETYPE':
      return linetype(session, model, input);
    case 'LTSCALE':
      return ltscale(session, model, input);
    case 'COLOR':
      return colorCmd(session, model, input);
    case 'OSNAP':
      return osnap(session, settings, input);
    case 'DSETTINGS':
      return dsettings(session, settings, input);
    case 'SNAP':
      return snap(session, settings, input);
    case 'UNITS':
      return units(session, input);
    case 'PASTECLIP':
      return paste(session, model, clipboard, input);
    case 'CREATEALIGNMENTENTITIES':
      return alignFrom(session, model, input);
    default:
      return done();
  }
}

function line(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (input.kind === 'empty' || input.kind === 'cancel') return session.pts.length === 0 ? end(session) : done();
  if (kw(input, 'Undo')) {
    if (session.ids.length === 0) {
      session.pts = [];
      session.phase = 'first';
      return show(session, prompt('Specify first point', 'point'));
    }
    const id = session.ids.pop();
    if (id) model.remove([id]);
    session.pts.pop();
    model.emit();
    return show(session, linePrompt(session));
  }
  if (kw(input, 'Close')) {
    if (session.pts.length < 3) return fail(session, linePrompt(session), 'A line needs two segments before it can close.');
    addLine(model, session, session.pts[session.pts.length - 1], session.pts[0]);
    model.emit();
    return done();
  }
  if (input.kind !== 'point') return fail(session, linePrompt(session), 'Point or option keyword required.');
  if (session.pts.length > 0) addLine(model, session, session.pts[session.pts.length - 1], input.point);
  session.pts.push(input.point);
  session.phase = 'next';
  model.emit();
  return show(session, linePrompt(session));
}

function linePrompt(session: Session): PromptSpec {
  return prompt(session.pts.length >= 3 ? 'Specify next point or' : 'Specify next point or', 'point', session.pts.length >= 3 ? ['Close', 'Undo'] : ['Undo']);
}

function pline(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (input.kind === 'empty') return session.pts.length < 2 ? end(session, [], [], true) : done();
  if (kw(input, 'Undo')) {
    session.pts.pop();
    session.extra.pop();
    if (session.pts.length < 2) {
      if (session.ids[0]) model.remove(session.ids);
      session.ids = [];
      session.phase = session.pts.length === 0 ? 'first' : 'next';
    } else writePoly(model, session, false);
    model.emit();
    return show(session, plinePrompt(session));
  }
  if (kw(input, 'Close')) {
    if (session.pts.length < 3) return fail(session, plinePrompt(session), 'A polyline needs three points to close.');
    writePoly(model, session, true);
    model.emit();
    return done();
  }
  if (kw(input, 'Arc')) {
    session.aux = 'arc';
    return show(session, prompt('Specify endpoint of arc or', 'point', ['Line', 'Undo']));
  }
  if (kw(input, 'Line')) {
    session.aux = '';
    return show(session, plinePrompt(session));
  }
  if (kw(input, 'Width') || kw(input, 'Halfwidth')) {
    session.aux = kw(input, 'Halfwidth') ? 'halfwidth' : 'width';
    return show({ ...session, phase: 'width' }, prompt(session.aux === 'halfwidth' ? 'Specify starting half-width' : 'Specify starting width', 'number', [], String(session.n || 0)));
  }
  if (session.phase === 'width') {
    const value = input.kind === 'number' ? input.value : NaN;
    if (!(value >= 0)) return fail(session, prompt('Specify starting width', 'number'), 'Width must be zero or positive.');
    session.n = session.aux === 'halfwidth' ? value * 2 : value;
    session.phase = session.pts.length === 0 ? 'first' : 'next';
    session.aux = '';
    if (session.ids[0]) writePoly(model, session, false);
    return show(session, plinePrompt(session));
  }
  if (kw(input, 'Length') && session.pts.length >= 1) return show({ ...session, phase: 'length' }, prompt('Specify length of line', 'number'));
  if (session.phase === 'length') {
    const length = input.kind === 'number' ? input.value : NaN;
    if (!Number.isFinite(length) || length === 0) return fail(session, prompt('Specify length of line', 'number'), 'Length must be non-zero.');
    const prev = session.pts[session.pts.length - 1];
    const before = session.pts.length >= 2 ? session.pts[session.pts.length - 2] : v3(prev.x - 1, prev.y, prev.z);
    const dx = prev.x - before.x;
    const dy = prev.y - before.y;
    const span = Math.hypot(dx, dy) || 1;
    session.extra[session.pts.length - 1] = session.extra[session.pts.length - 1] ?? 0;
    session.pts.push(v3(prev.x + (dx / span) * length, prev.y + (dy / span) * length, prev.z));
    session.phase = 'next';
    writePoly(model, session, false);
    model.emit();
    return show(session, plinePrompt(session));
  }
  if (input.kind !== 'point') return fail(session, plinePrompt(session), 'Point or option keyword required.');
  if (session.aux === 'arc' && session.pts.length >= 1) {
    const prev = session.pts[session.pts.length - 1];
    const before = session.pts.length >= 2 ? session.pts[session.pts.length - 2] : null;
    const tangent = before
      ? segmentTangent({ ...before, bulge: session.extra[session.pts.length - 2] ?? 0 }, { ...prev, bulge: 0 })
      : 0;
    session.n2 = bulgeForTangent(prev, input.point, tangent);
  } else session.n2 = 0;
  if (session.pts.length >= 1) session.extra[session.pts.length - 1] = session.n2;
  session.pts.push(input.point);
  session.extra[session.pts.length - 1] = 0;
  session.n2 = 0;
  writePoly(model, session, false);
  session.phase = 'next';
  model.emit();
  return show(session, plinePrompt(session));
}

function plinePrompt(session: Session): PromptSpec {
  const keys = session.pts.length >= 3 ? ['Arc', 'Close', 'Halfwidth', 'Length', 'Undo', 'Width'] : ['Arc', 'Halfwidth', 'Length', 'Undo', 'Width'];
  if (session.aux === 'arc') return prompt('Specify endpoint of arc or', 'point', ['Line', 'Close', 'Undo']);
  return prompt('Specify next point or', 'point', session.pts.length === 0 ? ['Halfwidth', 'Width'] : keys);
}

function writePoly(model: DrawingModel, session: Session, closed: boolean): void {
  if (session.pts.length < 2) return;
  const vertices = session.pts.map((point, index) => ({ ...point, bulge: session.extra[index] ?? 0 }));
  const width = session.n > 0 ? session.n : undefined;
  const existing = session.ids[0] ? model.entity(session.ids[0]) : undefined;
  if (!existing || existing.type !== 'polyline') {
    mark(session, model);
    const id = model.nextId();
    model.add({ id, type: 'polyline', ...layerColor(model), closed, vertices, width });
    session.ids = [id];
    return;
  }
  model.replace({ ...existing, vertices, closed, width });
}

function circle(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (input.kind === 'empty') return end(session, [], [], true);
  if (session.phase === 'center' && kw(input, '3P')) return show({ ...session, phase: '3p' }, prompt('Specify first point on circle', 'point'));
  if (session.phase === 'center' && kw(input, '2P')) return show({ ...session, phase: '2p' }, prompt('Specify first end point of circle diameter', 'point'));
  if ((session.phase === 'center' || session.phase === '3p' || session.phase === '2p') && input.kind === 'point') {
    session.pts.push(input.point);
    if (session.phase === 'center') return show({ ...session, phase: 'radius' }, prompt('Specify radius of circle or', 'number', ['Diameter']));
    if (session.pts.length < (session.phase === '3p' ? 3 : 2)) {
      return show(session, prompt(session.phase === '3p' && session.pts.length === 1 ? 'Specify second point on circle' : 'Specify next point', 'point'));
    }
    return commitCircle(session, model);
  }
  if (session.phase === 'radius' && kw(input, 'Diameter')) return show({ ...session, phase: 'diameter' }, prompt('Specify diameter of circle', 'number'));
  if (session.phase === 'radius' && (input.kind === 'number' || input.kind === 'point')) {
    const radius = input.kind === 'number' ? input.value : dist(session.pts[0], input.point);
    return commitRadius(session, model, radius);
  }
  if (session.phase === 'diameter' && (input.kind === 'number' || input.kind === 'point')) {
    const diameter = input.kind === 'number' ? input.value : dist(session.pts[0], input.point);
    return commitRadius(session, model, diameter / 2);
  }
  return fail(session, prompt('Specify a point or number', 'any'), 'Point or option keyword required.');
}

function commitRadius(session: Session, model: DrawingModel, radius: number): SessionResult {
  if (!(radius > 0)) return fail(session, prompt('Specify radius of circle or', 'number', ['Diameter']), 'Radius must be positive.');
  mark(session, model);
  model.add({ id: model.nextId(), type: 'circle', ...layerColor(model), center: session.pts[0], radius });
  model.emit();
  return done();
}

function commitCircle(session: Session, model: DrawingModel): SessionResult {
  if (session.phase === '2p' && session.pts.length >= 2) {
    const a = session.pts[0];
    const b = session.pts[1];
    const center = v3((a.x + b.x) / 2, (a.y + b.y) / 2, a.z);
    return commitRadius({ ...session, pts: [center] }, model, dist(a, b) / 2);
  }
  const arc = arcFrom3(session.pts[0], session.pts[1], session.pts[2]);
  if (!arc) return fail(session, prompt('Specify third point on circle', 'point'), 'Points are colinear.');
  return commitRadius({ ...session, pts: [arc.center] }, model, arc.radius);
}

function arc(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (input.kind === 'empty') return end(session, [], [], true);
  if (session.phase === 'p1' && kw(input, 'Center')) return show({ ...session, phase: 'center' }, prompt('Specify center point of arc', 'point'));
  if (input.kind !== 'point') return fail(session, prompt('Specify a point', 'point'), 'Point or option keyword required.');
  session.pts.push(input.point);
  if (session.phase === 'p1') return show({ ...session, phase: 'p2' }, prompt('Specify second point of arc', 'point'));
  if (session.phase === 'p2') return show({ ...session, phase: 'p3' }, prompt('Specify end point of arc', 'point'));
  if (session.phase === 'p3') {
    const built = arcFrom3(session.pts[0], session.pts[1], session.pts[2]);
    if (!built) return fail(session, prompt('Specify end point of arc', 'point'), 'Points are colinear.');
    mark(session, model);
    model.add({ id: model.nextId(), type: 'arc', ...layerColor(model), ...built });
    model.emit();
    return done();
  }
  if (session.phase === 'center') return show({ ...session, phase: 'cstart' }, prompt('Specify start point of arc', 'point'));
  if (session.phase === 'cstart') return show({ ...session, phase: 'cend' }, prompt('Specify end point of arc', 'point'));
  const center = session.pts[0];
  const start = session.pts[1];
  const endPoint = session.pts[2];
  const radius = dist(center, start);
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  let sweep = Math.atan2(endPoint.y - center.y, endPoint.x - center.x) - startAngle;
  while (sweep <= 0) sweep += Math.PI * 2;
  mark(session, model);
  model.add({ id: model.nextId(), type: 'arc', ...layerColor(model), center, radius, startAngle, endAngle: startAngle + sweep });
  model.emit();
  return done();
}

const RECT_KEYS = ['Chamfer', 'Elevation', 'Fillet', 'Thickness', 'Width', 'Area', 'Dimensions', 'Rotation'];

function rectPrompt(): PromptSpec {
  return prompt('Specify first corner point or', 'point', RECT_KEYS);
}

function rect(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (input.kind === 'empty' && (session.phase === 'a' || session.phase === 'b' || session.phase === 'area')) return end(session);
  if (session.phase === 'fillet' || session.phase === 'chamfer1' || session.phase === 'chamfer2' || session.phase === 'elev' || session.phase === 'thick' || session.phase === 'width' || session.phase === 'rot' || session.phase === 'dimlen' || session.phase === 'dimwid' || session.phase === 'areaval') {
    const value = input.kind === 'number' ? input.value : input.kind === 'empty' ? 0 : NaN;
    if (!Number.isFinite(value)) return fail(session, prompt('Specify a distance', 'number'), 'Requires a number.');
    if (session.phase === 'fillet') session.extra[0] = Math.max(0, value);
    if (session.phase === 'chamfer1') {
      session.extra[1] = Math.max(0, value);
      return show({ ...session, phase: 'chamfer2' }, prompt('Specify second chamfer distance for rectangles', 'number', [], String(value)));
    }
    if (session.phase === 'chamfer2') session.extra[2] = Math.max(0, value);
    if (session.phase === 'elev') session.extra[3] = value;
    if (session.phase === 'thick') session.extra[4] = value;
    if (session.phase === 'width') session.n = Math.max(0, value);
    if (session.phase === 'rot') session.n2 = (value * Math.PI) / 180;
    if (session.phase === 'dimlen') {
      session.extra[5] = value;
      return show({ ...session, phase: 'dimwid' }, prompt('Specify width for rectangles', 'number'));
    }
    if (session.phase === 'dimwid') {
      session.extra[6] = value;
      session.aux = 'dims';
    }
    if (session.phase === 'areaval') {
      session.extra[7] = value;
      session.flag = true;
    }
    return show({ ...session, phase: 'a' }, rectPrompt());
  }
  if ((session.phase === 'a' || session.phase === 'area') && input.kind === 'keyword') {
    if (kw(input, 'Fillet')) return show({ ...session, phase: 'fillet' }, prompt('Specify fillet radius for rectangles', 'number', [], String(session.extra[0] || 0)));
    if (kw(input, 'Chamfer')) return show({ ...session, phase: 'chamfer1' }, prompt('Specify first chamfer distance for rectangles', 'number', [], String(session.extra[1] || 0)));
    if (kw(input, 'Elevation')) return show({ ...session, phase: 'elev' }, prompt('Specify elevation for rectangles', 'number', [], String(session.extra[3] || 0)));
    if (kw(input, 'Thickness')) return show({ ...session, phase: 'thick' }, prompt('Specify thickness for rectangles', 'number', [], String(session.extra[4] || 0)));
    if (kw(input, 'Width')) return show({ ...session, phase: 'width' }, prompt('Specify line width for rectangles', 'number', [], String(session.n || 0)));
    if (kw(input, 'Rotation')) return show({ ...session, phase: 'rot' }, prompt('Specify rotation angle for rectangles', 'number', [], '0'));
    if (kw(input, 'Dimensions')) return show({ ...session, phase: 'dimlen' }, prompt('Specify length for rectangles', 'number'));
    if (kw(input, 'Area')) return show({ ...session, phase: 'areaval', flag: true }, prompt('Enter area of rectangle', 'number'));
  }
  if (session.phase === 'area' && input.kind === 'point') return show({ ...session, phase: 'areaval', flag: true, pts: [input.point] }, prompt('Enter area of rectangle', 'number'));
  if (session.phase === 'arealen') {
    const length = input.kind === 'number' ? input.value : NaN;
    if (!Number.isFinite(length) || length === 0) return fail(session, prompt('Specify length of rectangle', 'number'), 'Length must be non-zero.');
    const other = rectangleFromArea(session.pts[0], length, session.extra[7] || 0);
    if (!other) return done(['Area is zero.']);
    return commitRect(session, model, session.pts[0], v3(other.x, other.y, other.z ?? session.pts[0].z));
  }
  if (input.kind !== 'point') return fail(session, session.phase === 'b' ? prompt('Specify other corner point or', 'point', ['Dimensions']) : rectPrompt(), 'Point or option keyword required.');
  if (session.phase === 'a') {
    if (session.aux === 'dims') {
      const length = session.extra[5] || 0;
      const width = session.extra[6] || 0;
      const ang = session.n2 || 0;
      const other = v3(input.point.x + length * Math.cos(ang) - width * Math.sin(ang), input.point.y + length * Math.sin(ang) + width * Math.cos(ang), input.point.z);
      return commitRect(session, model, input.point, other);
    }
    if (session.flag && session.extra[7]) return show({ ...session, phase: 'arealen', pts: [input.point] }, prompt('Specify length of rectangle', 'number'));
    return show({ ...session, phase: 'b', pts: [input.point] }, prompt('Specify other corner point or', 'point', ['Dimensions', 'Area', 'Rotation']));
  }
  return commitRect(session, model, session.pts[0], input.point);
}

function commitRect(session: Session, model: DrawingModel, a: Vec3, b: Vec3): SessionResult {
  const vertices = rectangleVertices(a, b, {
    fillet: session.extra[0] || 0,
    chamfer1: session.extra[1] || 0,
    chamfer2: session.extra[2] || 0,
    rotation: session.n2 || 0,
    elevation: session.extra[3] || 0,
  });
  mark(session, model);
  model.add({
    id: model.nextId(),
    type: 'polyline',
    ...layerColor(model),
    closed: true,
    vertices,
    width: session.n > 0 ? session.n : undefined,
    elevation: session.extra[3] || undefined,
    thickness: session.extra[4] || undefined,
  });
  model.emit();
  return done();
}

function polygon(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'sides') {
    const sides = input.kind === 'number' ? input.value : input.kind === 'empty' ? 4 : NaN;
    if (!Number.isInteger(sides) || sides < 3 || sides > 256) return fail(session, prompt('Enter number of sides', 'number', [], '4'), 'Enter an integer from 3 to 256.');
    return show({ ...session, phase: 'center', n: sides }, prompt('Specify center of polygon', 'point'));
  }
  if (input.kind !== 'point' && input.kind !== 'number') return fail(session, prompt('Specify center of polygon', 'point'), 'Point or option keyword required.');
  if (session.phase === 'center' && input.kind === 'point') return show({ ...session, phase: 'radius', pts: [input.point] }, prompt('Specify radius of polygon', 'number'));
  const radius = input.kind === 'number' ? input.value : dist(session.pts[0], input.kind === 'point' ? input.point : session.pts[0]);
  if (!(radius > 0)) return fail(session, prompt('Specify radius of polygon', 'number'), 'Radius must be positive.');
  mark(session, model);
  model.add({ id: model.nextId(), type: 'polyline', ...layerColor(model), closed: true, vertices: polygonVertices(session.pts[0], radius, session.n) });
  model.emit();
  return done();
}

function point(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (input.kind !== 'point') return end(session);
  mark(session, model);
  model.add({ id: model.nextId(), type: 'point', ...layerColor(model), p: input.point });
  model.emit();
  return done();
}

function text(session: Session, model: DrawingModel, settings: CadSettings, input: SessionInput): SessionResult {
  if (session.phase === 'point') {
    if (input.kind !== 'point') return end(session);
    return show({ ...session, phase: 'height', pts: [input.point] }, prompt('Specify height', 'number', [], fmt(settings.textHeight, 3)));
  }
  if (session.phase === 'height') {
    const height = input.kind === 'number' ? input.value : input.kind === 'point' ? dist(session.pts[0], input.point) : input.kind === 'empty' ? settings.textHeight : NaN;
    if (!(height > 0)) return fail(session, prompt('Specify height', 'number', [], fmt(settings.textHeight, 3)), 'Height must be positive.');
    settings.textHeight = height;
    return show({ ...session, phase: 'rot', n: height }, prompt('Specify rotation angle of text', 'number', [], '0'));
  }
  if (session.phase === 'rot') {
    const angle = input.kind === 'number' ? (input.value * Math.PI) / 180 : input.kind === 'empty' ? 0 : input.kind === 'point' ? Math.atan2(input.point.y - session.pts[0].y, input.point.x - session.pts[0].x) : NaN;
    if (!Number.isFinite(angle)) return fail(session, prompt('Specify rotation angle of text', 'number', [], '0'), 'Requires a numeric angle.');
    return show({ ...session, phase: 'text', n2: angle }, prompt('Enter text', 'text', [], undefined, false));
  }
  if (input.kind !== 'text' || !input.text.trim()) return end(session);
  mark(session, model);
  model.add({
    id: model.nextId(),
    type: 'text',
    ...layerColor(model),
    p: session.pts[0],
    height: session.n,
    rotation: session.n2,
    content: input.text,
  });
  model.emit();
  return done();
}

function absorbPick(session: Session, input: SessionInput, model: DrawingModel): Session | null {
  if (input.kind !== 'picked') return null;
  const ids = input.ids.length > 0 ? input.ids : [];
  session.ids = [...new Set([...session.ids, ...ids])];
  if (input.window) {
    session.window = input.window;
    session.crossing = input.crossing;
  }
  if (input.at) session.pts.push(input.at);
  model.doc.selection = [...session.ids];
  model.emit();
  return session;
}

function dropLocked(session: Session, model: DrawingModel): string[] {
  if (['LIST', 'LOCKOBJECT', 'UNLOCKOBJECT', 'LAYISO', 'LAYOFF', 'LAYFRZ', 'LAYLCK', 'LAYULK', 'LAYMCUR', 'LAYDEL', 'LAYMRG', 'MATCHPROP', 'CHPROP', '-CHPROP'].includes(session.command)) {
    return [];
  }
  const parted = partitionEditable(model.doc, session.ids);
  session.ids = parted.editable;
  model.doc.selection = [...session.ids];
  return parted.locked ? [lockMessage(parted.locked)] : [];
}

function advanceSelect(session: Session, model: DrawingModel, settings: CadSettings, input: SessionInput): SessionResult {
  if (session.ids.length === 0) return done(['Nothing selected.']);
  const lockedNote = dropLocked(session, model);
  if (session.ids.length === 0) return done(lockedNote.length ? lockedNote : ['Nothing selected.']);
  model.doc.selection = [...session.ids];
  if (session.command === 'ERASE') {
    mark(session, model);
    model.remove(session.ids);
    model.doc.selection = [];
    model.emit();
    return done([...lockedNote, `${session.ids.length} erased.`]);
  }
  if (session.command === 'LIST') {
    const lines: string[] = [];
    for (const id of session.ids) {
      const entity = model.entity(id);
      if (entity) lines.push(...listText(model.doc, entity), '');
      else {
        const object = modelObject(model.doc, id);
        if (object) lines.push(`${object.kind.toUpperCase()}  ${object.name}  Layer: "${object.layer}"  Color: ${object.color}  Locked: ${object.locked ? 'Yes' : 'No'}`, '');
      }
    }
    return done(lines);
  }
  if (session.command === 'EXPLODE') return explode(session, model);
  if (session.command === 'JOIN') return join(session, model);
  if (session.command === 'LAYISO' || session.command === 'LAYCUR' || session.command === 'LAYMCH') {
    return layerTool({ ...session, phase: session.command === 'LAYMCH' ? 'dest' : 'apply' }, model, { kind: 'empty' });
  }
  if (session.command === 'MOVE' || session.command === 'COPY' || session.command === 'STRETCH') {
    return show({ ...session, phase: 'base', pts: [] }, prompt('Specify base point', 'point'), lockedNote);
  }
  if (session.command === 'ROTATE') return show({ ...session, phase: 'base', pts: [] }, prompt('Specify base point', 'point'), lockedNote);
  if (session.command === 'SCALE') return show({ ...session, phase: 'base', pts: [] }, prompt('Specify base point', 'point'), lockedNote);
  if (session.command === 'MIRROR') return show({ ...session, phase: 'p1', pts: [] }, prompt('Specify first point of mirror line', 'point'), lockedNote);
  void settings;
  void input;
  return done();
}

function modify(session: Session, model: DrawingModel, settings: CadSettings, input: SessionInput): SessionResult {
  if (session.phase === 'select') {
    if (kw(input, 'All') || (input.kind === 'text' && input.text.toLowerCase() === 'all')) {
      session.ids = model.doc.entities.map((entity) => entity.id);
      return advanceSelect(session, model, settings, { kind: 'empty' });
    }
    if (input.kind === 'picked') {
      absorbPick(session, input, model);
      return show(session, prompt('Select objects', 'select'));
    }
    if (input.kind === 'empty') return advanceSelect(session, model, settings, input);
    return fail(session, prompt('Select objects', 'select'), 'Select objects, or press Enter to finish.');
  }
  if (session.phase === 'base' || session.phase === 'p1') {
    if (input.kind !== 'point') return fail(session, prompt('Specify base point', 'point'), 'Point or option keyword required.');
    const phase = session.command === 'MIRROR' ? 'p2' : session.command === 'ROTATE' ? 'angle' : session.command === 'SCALE' ? 'factor' : 'dest';
    const head = session.command === 'MIRROR' ? 'Specify second point of mirror line' : session.command === 'ROTATE' ? 'Specify rotation angle or' : session.command === 'SCALE' ? 'Specify scale factor or' : 'Specify second point';
    const keys = session.command === 'ROTATE' || session.command === 'SCALE' ? ['Reference', 'Copy'] : session.command === 'COPY' ? ['Array'] : [];
    return show({ ...session, phase, pts: [input.point] }, prompt(head, session.command === 'ROTATE' || session.command === 'SCALE' ? 'number' : 'point', keys));
  }
  if (session.phase === 'angle' && kw(input, 'Copy')) return show({ ...session, flag: true }, prompt('Specify rotation angle or', 'number', ['Reference']));
  if (session.phase === 'factor' && kw(input, 'Copy')) return show({ ...session, flag: true }, prompt('Specify scale factor or', 'number', ['Reference']));
  if ((session.phase === 'angle' || session.phase === 'factor') && kw(input, 'Reference')) {
    return show({ ...session, phase: 'ref' }, prompt('Specify reference angle or length', 'number'));
  }
  if (session.phase === 'ref') {
    if (input.kind !== 'number') return fail(session, prompt('Specify reference angle or length', 'number'), 'Requires a number.');
    return show({ ...session, phase: 'ref2', n: input.value }, prompt('Specify new angle or length', 'number'));
  }
  if (session.phase === 'angle' || session.phase === 'ref2' && session.command === 'ROTATE') {
    const angleDeg = input.kind === 'number' ? input.value : input.kind === 'point' ? (Math.atan2(input.point.y - session.pts[0].y, input.point.x - session.pts[0].x) * 180) / Math.PI : NaN;
    if (!Number.isFinite(angleDeg)) return fail(session, prompt('Specify rotation angle', 'number'), 'Requires an angle.');
    const delta = session.phase === 'ref2' ? angleDeg - session.n : angleDeg;
    transform(session, model, (entity) => rotated(entity, session.pts[0], (delta * Math.PI) / 180));
    return done();
  }
  if (session.phase === 'factor' || (session.phase === 'ref2' && session.command === 'SCALE')) {
    const value = input.kind === 'number' ? input.value : input.kind === 'point' ? dist(session.pts[0], input.point) : NaN;
    if (!(value > 0)) return fail(session, prompt('Specify scale factor', 'number'), 'Scale factor must be positive.');
    const factor = session.phase === 'ref2' ? value / (session.n || 1) : value;
    transform(session, model, (entity) => scaled(entity, session.pts[0], factor));
    return done();
  }
  if (session.phase === 'dest' && session.command === 'COPY' && kw(input, 'Array')) {
    return show({ ...session, phase: 'copycount' }, prompt('Enter number of items to array', 'number', [], '4'));
  }
  if (session.phase === 'copycount') {
    const count = input.kind === 'number' ? Math.round(input.value) : NaN;
    if (!(count >= 2)) return fail(session, prompt('Enter number of items to array', 'number'), 'Enter an integer of 2 or more.');
    return show({ ...session, phase: 'copyspan', n: count }, prompt('Specify second point', 'point'));
  }
  if (session.phase === 'copyspan' && input.kind === 'point') {
    const base = session.pts[0];
    const count = Math.max(2, Math.round(session.n));
    const dx = (input.point.x - base.x) / (count - 1);
    const dy = (input.point.y - base.y) / (count - 1);
    const dz = (input.point.z - base.z) / (count - 1);
    mark(session, model);
    const created: string[] = [];
    for (let i = 1; i < count; i++) {
      for (const id of session.ids) {
        const entity = model.entity(id);
        if (!entity) continue;
        const next = moved(entity, dx * i, dy * i, dz * i);
        next.id = model.nextId();
        model.add(next);
        created.push(next.id);
      }
    }
    model.doc.selection = created;
    model.emit();
    return done([`${count - 1} copied.`]);
  }
  if (session.phase === 'dest') {
    if (input.kind === 'empty') return done();
    if (input.kind !== 'point') return fail(session, prompt('Specify second point or', 'point', session.command === 'COPY' ? ['Array'] : []), 'Point or option keyword required.');
    const base = session.pts[0];
    const dx = input.point.x - base.x;
    const dy = input.point.y - base.y;
    const dz = input.point.z - base.z;
    if (session.command === 'STRETCH') {
      mark(session, model);
      for (const id of session.ids) {
        const entity = model.entity(id);
        if (entity) model.replace(stretchEntity(entity, session.crossing ? session.window : null, dx, dy));
      }
      model.emit();
      return done();
    }
    transform(session, model, (entity) => moved(entity, dx, dy, dz));
    if (session.command === 'COPY') return show(session, prompt('Specify second point or press Enter to end', 'point'));
    return done();
  }
  if (session.phase === 'p2') {
    if (input.kind !== 'point') return fail(session, prompt('Specify second point of mirror line', 'point'), 'Point or option keyword required.');
    session.pts.push(input.point);
    return show({ ...session, phase: 'erase' }, prompt('Erase source objects?', 'any', ['Yes', 'No'], 'No'));
  }
  if (session.phase === 'erase') {
    const erase = kw(input, 'Yes') || (input.kind === 'text' && input.text.toLowerCase().startsWith('y'));
    if (!erase && !(input.kind === 'empty' || kw(input, 'No') || (input.kind === 'text' && input.text.toLowerCase().startsWith('n')))) {
      return fail(session, prompt('Erase source objects?', 'any', ['Yes', 'No'], 'No'), 'Yes or No.');
    }
    const [a, b] = session.pts;
    transform(session, model, (entity) => mirrored(entity, a, b), !erase);
    model.emit();
    return done();
  }
  return done();
}

function transform(session: Session, model: DrawingModel, fn: (entity: DrawEntity) => DrawEntity, keepSource = false): void {
  mark(session, model);
  const created: string[] = [];
  const copy = session.command === 'COPY' || session.flag || keepSource;
  for (const id of session.ids) {
    const entity = model.entity(id);
    if (!entity) continue;
    const next = fn(entity);
    if (copy) {
      next.id = model.nextId();
      model.add(next);
      created.push(next.id);
    } else model.replace(next);
  }
  if (copy) model.doc.selection = created;
  model.emit();
}

function explode(session: Session, model: DrawingModel): SessionResult {
  mark(session, model);
  let count = 0;
  for (const id of [...session.ids]) {
    const entity = model.entity(id);
    if (!entity) continue;
    if (entity.type === 'insert') {
      const block = blockByName(ensureLibrary(model.doc), entity.name);
      if (!block) continue;
      const pieces = explodeInsert(entity, block, () => model.nextId(), (raw) => parseCadEntity(raw));
      model.remove([id]);
      for (const piece of pieces) model.add(piece);
      count += 1;
      continue;
    }
    const pieces = explodeEntity(entity, () => model.nextId());
    if (!pieces) continue;
    model.remove([id]);
    for (const piece of pieces) model.add(piece);
    count += 1;
  }
  model.doc.selection = [];
  model.emit();
  return done(count === 0 ? ['Nothing to explode.'] : [`${count} exploded.`]);
}

function join(session: Session, model: DrawingModel): SessionResult {
  const entities = session.ids.map((id) => model.entity(id)).filter((entity): entity is DrawEntity => Boolean(entity));
  const lines = entities.filter((entity): entity is DrawLine => entity.type === 'line');
  const polys = entities.filter((entity) => entity.type === 'polyline');
  mark(session, model);
  if (lines.length >= 2) {
    const joined = joinLines(lines, model.nextId());
    if (!joined) return end(session, ['Lines must touch and be colinear.'], [], true);
    model.remove(lines.map((line) => line.id));
    model.add(joined);
    model.emit();
    return done(['Lines joined.']);
  }
  if (polys.length >= 2 && polys.every((entity) => entity.type === 'polyline')) {
    const joined = joinPolylines(polys, model.nextId());
    if (!joined) return end(session, ['Polylines must share an endpoint.'], [], true);
    model.remove(polys.map((poly) => poly.id));
    model.add(joined);
    model.emit();
    return done(['Polylines joined.']);
  }
  return end(session, ['Select lines or polylines that touch.'], [], true);
}

function offset(session: Session, model: DrawingModel, settings: CadSettings, input: SessionInput): SessionResult {
  if (session.phase === 'dist') {
    if (kw(input, 'Through')) return show({ ...session, phase: 'object', flag: true }, prompt('Select object to offset or', 'select', ['Erase', 'Exit', 'Layer', 'Multiple', 'Undo']));
    if (kw(input, 'Erase')) return show({ ...session, phase: 'eraseopt' }, prompt('Erase source object after offsetting?', 'any', ['Yes', 'No'], 'No'));
    if (kw(input, 'Layer')) return show({ ...session, phase: 'layeropt' }, prompt('Enter layer option for offset objects', 'any', ['Current', 'Source'], 'Source'));
    if (kw(input, 'Multiple')) return show({ ...session, phase: 'object' }, prompt('Multiple mode. Select object to offset or', 'select', ['Erase', 'Exit', 'Layer', 'Undo']));
    const distance = input.kind === 'number' ? input.value : input.kind === 'empty' ? settings.offsetDist : NaN;
    if (!(distance > 0)) return fail(session, prompt('Specify offset distance or', 'number', ['Through'], fmt(settings.offsetDist, 3)), 'Distance must be positive.');
    settings.offsetDist = distance;
    return show({ ...session, phase: 'object', n: distance }, prompt('Select object to offset or', 'select', ['Erase', 'Exit', 'Layer', 'Multiple', 'Undo']));
  }
  if (session.phase === 'eraseopt') {
    session.extra[0] = kw(input, 'Yes') || (input.kind === 'text' && input.text.toLowerCase().startsWith('y')) ? 1 : 0;
    return show({ ...session, phase: 'object' }, prompt('Select object to offset or', 'select', ['Erase', 'Exit', 'Layer', 'Multiple', 'Undo']));
  }
  if (session.phase === 'layeropt') {
    session.extra[1] = kw(input, 'Current') || (input.kind === 'text' && input.text.toLowerCase().startsWith('c')) ? 1 : 0;
    return show({ ...session, phase: 'object' }, prompt('Select object to offset or', 'select', ['Erase', 'Exit', 'Layer', 'Multiple', 'Undo']));
  }
  if (kw(input, 'Exit') || input.kind === 'empty') return done();
  if (kw(input, 'Undo')) {
    const id = session.ids.pop();
    if (id) model.remove([id]);
    model.emit();
    return show(session, prompt('Select object to offset or', 'select', ['Exit', 'Undo']));
  }
  if (session.phase === 'object') {
    if (input.kind !== 'picked' || input.ids.length === 0) return fail(session, prompt('Select object to offset', 'select'), 'Select an object.');
    return show({ ...session, phase: 'side', aux: input.ids[0] }, prompt(session.flag ? 'Specify through point' : 'Specify point on side to offset', 'point'));
  }
  if (input.kind !== 'point') return fail(session, prompt('Specify point on side to offset', 'point'), 'Point or option keyword required.');
  const entity = model.entity(session.aux);
  if (!entity) return done(['Object is gone.']);
  const distance = session.flag ? Math.max(dist(input.point, closestOnEntity(entity, input.point)), 0) : session.n;
  const created = offsetEntity(entity, distance, input.point, model.nextId());
  if (!created) return fail(session, prompt('Select object to offset or', 'select', ['Exit', 'Undo']), 'Cannot offset that object.');
  mark(session, model);
  if (session.extra[1] === 1) {
    created.layer = model.doc.currentLayer;
    created.color = model.doc.currentColor;
  }
  model.add(created);
  if (session.extra[0] === 1) model.remove([entity.id]);
  session.ids.push(created.id);
  session.phase = 'object';
  model.emit();
  return show(session, prompt('Select object to offset or', 'select', ['Erase', 'Exit', 'Layer', 'Multiple', 'Undo']));
}

function trim(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'cutters') {
    if (kw(input, 'Quick')) return show({ ...session, phase: 'pick', ids: [] }, prompt('Select object to trim or', 'select', ['Undo']));
    if (input.kind === 'picked') {
      absorbPick(session, input, model);
      return show(session, prompt('Select cutting edges, or press Enter to select all', 'select'));
    }
    if (input.kind === 'empty') return show({ ...session, phase: 'pick' }, prompt('Select object to trim or', 'select', ['Undo']));
    return fail(session, prompt('Select cutting edges', 'select'), 'Select objects, or press Enter.');
  }
  if (kw(input, 'Undo')) {
    if (session.checked) model.revert();
    session.checked = false;
    return show(session, prompt('Select object to trim or', 'select', ['Undo']));
  }
  if (input.kind === 'empty') return done();
  if (input.kind !== 'picked' || input.ids.length === 0) return fail(session, prompt('Select object to trim', 'select'), 'Select an object to trim.');
  const edit = trimAt(model.doc, input.ids[0], session.ids, input.at, () => model.nextId());
  if (!edit) return fail(session, prompt('Select object to trim or', 'select', ['Undo']), 'Cannot trim that object.');
  mark(session, model);
  if (edit.remove.length) model.remove(edit.remove);
  for (const entity of edit.replace) model.replace(entity);
  for (const entity of edit.add) model.add(entity);
  model.emit();
  return show(session, prompt('Select object to trim or', 'select', ['Undo']));
}

function extend(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'bounds') {
    if (kw(input, 'Quick')) return show({ ...session, phase: 'pick', ids: [] }, prompt('Select object to extend or', 'select', ['Undo']));
    if (input.kind === 'picked') {
      absorbPick(session, input, model);
      return show(session, prompt('Select boundary edges, or press Enter to select all', 'select'));
    }
    if (input.kind === 'empty') return show({ ...session, phase: 'pick' }, prompt('Select object to extend or', 'select', ['Undo']));
    return fail(session, prompt('Select boundary edges', 'select'), 'Select objects, or press Enter.');
  }
  if (input.kind === 'empty') return done();
  if (input.kind !== 'picked' || input.ids.length === 0) return fail(session, prompt('Select object to extend', 'select'), 'Select an object to extend.');
  const edit = extendEntity(model.doc, input.ids[0], session.ids, input.at);
  if (!edit) return fail(session, prompt('Select object to extend or', 'select', ['Undo']), 'Cannot extend that object.');
  mark(session, model);
  for (const entity of edit.replace) model.replace(entity);
  model.emit();
  return show(session, prompt('Select object to extend or', 'select', ['Undo']));
}

function entityPick(model: DrawingModel, input: SessionInput): { entity: DrawEntity; at: Vec3 } | null {
  if (input.kind !== 'picked' || input.ids.length === 0) return null;
  const entity = model.entity(input.ids[0]);
  if (!entity) return null;
  return { entity, at: input.at };
}

function fillet(session: Session, model: DrawingModel, settings: CadSettings, input: SessionInput): SessionResult {
  if (kw(input, 'Multiple')) return show({ ...session, flag: true }, prompt('Select first object or', 'select', ['Radius', 'Polyline', 'Multiple', 'Undo']));
  if (kw(input, 'Radius')) return show({ ...session, phase: 'radius' }, prompt('Specify fillet radius', 'number', [], fmt(settings.filletRadius, 3)));
  if (session.phase === 'radius') {
    if (input.kind !== 'number' || input.value < 0) return fail(session, prompt('Specify fillet radius', 'number'), 'Radius must be zero or positive.');
    settings.filletRadius = input.value;
    return show({ ...session, phase: 'first' }, prompt('Select first object or', 'select', ['Radius', 'Polyline', 'Multiple', 'Undo']));
  }
  if (kw(input, 'Undo')) {
    if (session.checked) model.revert();
    session.checked = false;
    return show({ ...session, phase: 'first', ids: [], pts: [] }, prompt('Select first object or', 'select', ['Radius', 'Polyline', 'Multiple', 'Undo']));
  }
  const picked = entityPick(model, input);
  if (!picked || (picked.entity.type !== 'line' && picked.entity.type !== 'polyline')) {
    return fail(session, prompt('Select first object or', 'select', ['Radius']), 'Select a line or polyline.');
  }
  if (kw(input, 'Polyline') || (session.phase === 'first' && picked.entity.type === 'polyline' && input.kind === 'picked' && false)) {
    return fail(session, prompt('Select first object', 'select'), 'Select two lines.');
  }
  if (session.phase === 'first' && picked.entity.type === 'polyline') {
    return fail(session, prompt('Select first object or', 'select', ['Radius']), 'Pick two lines to fillet. Polyline corners use Radius 0 join.');
  }
  if (session.phase === 'first') {
    return show({ ...session, phase: 'second', ids: [picked.entity.id], pts: [picked.at] }, prompt('Select second object', 'select'));
  }
  if (picked.entity.type !== 'line' || !model.entity(session.ids[0]) || model.entity(session.ids[0])?.type !== 'line') {
    return fail(session, prompt('Select second object', 'select'), 'Select a line.');
  }
  const first = model.entity(session.ids[0]) as DrawLine;
  const result = filletLines(first, picked.entity as DrawLine, session.pts[0], picked.at, settings.filletRadius);
  if (!result) return fail(session, prompt('Select second object or', 'select', ['Radius']), 'Lines do not intersect, or the radius does not fit.');
  mark(session, model);
  model.replace(result.lineA);
  model.replace(result.lineB);
  if (result.arc) {
    model.add({ id: model.nextId(), type: 'arc', ...layerColor(model), center: result.arc.center, radius: result.arc.radius, startAngle: result.arc.startAngle, endAngle: result.arc.endAngle });
  }
  model.emit();
  if (session.flag) return show({ ...session, phase: 'first', ids: [], pts: [] }, prompt('Select first object or', 'select', ['Radius', 'Multiple', 'Undo']));
  return done();
}

function chamfer(session: Session, model: DrawingModel, settings: CadSettings, input: SessionInput): SessionResult {
  if (kw(input, 'Distance')) return show({ ...session, phase: 'd1' }, prompt('Specify first chamfer distance', 'number', [], fmt(settings.chamfer1, 3)));
  if (session.phase === 'd1' && input.kind === 'number') {
    settings.chamfer1 = input.value;
    return show({ ...session, phase: 'd2' }, prompt('Specify second chamfer distance', 'number', [], fmt(input.value, 3)));
  }
  if (session.phase === 'd2' && input.kind === 'number') {
    settings.chamfer2 = input.value;
    return show({ ...session, phase: 'first' }, prompt('Select first line or', 'select', ['Distance']));
  }
  const picked = entityPick(model, input);
  if (!picked || picked.entity.type !== 'line') return fail(session, prompt('Select first line or', 'select', ['Distance']), 'Select a line.');
  if (session.phase === 'first') return show({ ...session, phase: 'second', ids: [picked.entity.id], pts: [picked.at] }, prompt('Select second line', 'select'));
  const first = model.entity(session.ids[0]);
  if (!first || first.type !== 'line') return done();
  const result = chamferLines(first, picked.entity as DrawLine, session.pts[0], picked.at, settings.chamfer1, settings.chamfer2);
  if (!result) return fail(session, prompt('Select second line', 'select'), 'Lines do not intersect.');
  mark(session, model);
  model.replace(result.lineA);
  model.replace(result.lineB);
  if (settings.chamfer1 > 0 || settings.chamfer2 > 0) {
    model.add({ id: model.nextId(), type: 'line', ...layerColor(model), a: result.chord[0], b: result.chord[1] });
  }
  model.emit();
  return done();
}

function distCmd(session: Session, input: SessionInput): SessionResult {
  if (input.kind !== 'point') return end(session);
  if (session.phase === 'p1') return show({ ...session, phase: 'p2', pts: [input.point] }, prompt('Specify second point or', 'point', ['Multiple']));
  const a = session.pts[0];
  const b = input.point;
  const distance = dist(a, b);
  const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const lines = [
    `Distance = ${fmt(distance)}, Angle in XY Plane = ${fmt(angle)}, Angle from XY Plane = ${fmt((Math.atan2(b.z - a.z, distance) * 180) / Math.PI)}`,
    `Delta X = ${fmt(b.x - a.x)}, Delta Y = ${fmt(b.y - a.y)}, Delta Z = ${fmt(b.z - a.z)}`,
  ];
  if (session.flag || kw(input, 'Multiple')) return show({ ...session, phase: 'p1', flag: true, pts: [] }, prompt('Specify first point', 'point'), lines);
  return done(lines);
}

function idCmd(input: SessionInput): SessionResult {
  if (input.kind !== 'point') return done();
  const p = input.point;
  return done([`X = ${fmt(p.x)}   Y = ${fmt(p.y)}   Z = ${fmt(p.z)}`]);
}

function area(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (kw(input, 'Object')) return show({ ...session, phase: 'object' }, prompt('Select object', 'select'));
  if (session.phase === 'object') {
    const picked = entityPick(model, input);
    if (!picked) return fail(session, prompt('Select object', 'select'), 'Select a closed polyline or circle.');
    const value = entityArea(picked.entity);
    if (value === null) return done(['That object has no area.']);
    return done([`Area = ${fmt(value)}, Length = ${fmt(entityLength(picked.entity))}`]);
  }
  if (kw(input, 'Undo')) {
    session.pts.pop();
    return show(session, prompt('Specify next point or', 'point', ['Undo']));
  }
  if (input.kind === 'empty') {
    if (session.pts.length < 3) return done(['Need at least three points.']);
    let sum = 0;
    for (let i = 0; i < session.pts.length; i++) {
      const a = session.pts[i];
      const b = session.pts[(i + 1) % session.pts.length];
      sum += a.x * b.y - b.x * a.y;
    }
    const areaValue = Math.abs(sum) / 2;
    let length = 0;
    for (let i = 0; i < session.pts.length; i++) length += dist(session.pts[i], session.pts[(i + 1) % session.pts.length]);
    return done([`Area = ${fmt(areaValue)}, Perimeter = ${fmt(length)}`]);
  }
  if (input.kind !== 'point') return fail(session, prompt('Specify next point', 'point'), 'Point or option keyword required.');
  session.pts.push(input.point);
  return show(session, prompt('Specify next point or', 'point', session.pts.length > 0 ? ['Undo', 'Object'] : ['Object']));
}

const NAV_KEYWORDS = ['Exit', 'Pan', 'Zoom', '3D Orbit', 'Zoom Window', 'Zoom Original', 'Zoom Extents'];

function realtimePrompt(): PromptSpec {
  return prompt(REALTIME_NAV_PROMPT, 'any');
}

function navChoice(input: SessionInput): string | null {
  if (input.kind === 'keyword') return input.name;
  if (input.kind === 'text') {
    const matched = matchKeyword(input.text, NAV_KEYWORDS.map((label) => ({ label })));
    return matched && matched !== 'ambiguous' ? matched : null;
  }
  return null;
}

function realtimeNav(session: Session, input: SessionInput): SessionResult {
  const again = realtimePrompt();
  if (input.kind === 'empty') return done();
  const choice = navChoice(input);
  if (!choice) return show(session, again);
  if (choice === 'Exit') return done();
  if (choice === 'Pan') return show({ ...session, command: 'PAN', phase: 'realtime', pts: [] }, again);
  if (choice === 'Zoom') return show({ ...session, command: 'ZOOM', phase: 'realtime', pts: [] }, again);
  if (choice === '3D Orbit') return done(['Constrained orbit. Drag in the 3D view.'], [{ type: 'orbit-constrained' }]);
  if (choice === 'Zoom Window') return show({ ...session, command: 'ZOOM', phase: 'window', pts: [], aux: 'menu' }, prompt('Specify first corner', 'point'));
  if (choice === 'Zoom Original') return show({ ...session, phase: 'realtime' }, again, [], [{ type: 'zoom-original' }]);
  if (choice === 'Zoom Extents') return show({ ...session, phase: 'realtime' }, again, [], [{ type: 'zoom-extents' }]);
  return show(session, again);
}

const ZOOM_KEYS = ['Extents', 'Window', 'Dynamic', 'Scale', 'Center', 'Previous', 'All'];

function zoomFactor(input: SessionInput): number | null {
  if (input.kind === 'number') return input.value;
  if (input.kind === 'text' && /^\d*\.?\d+x$/i.test(input.text.trim())) return Number.parseFloat(input.text);
  return null;
}

function zoom(session: Session, input: SessionInput): SessionResult {
  if (session.phase === 'realtime') return realtimeNav(session, input);
  if (session.phase === 'window') {
    if (input.kind !== 'point') return fail(session, prompt('Specify opposite corner', 'point'), 'Point or option keyword required.');
    if (session.pts.length === 0) return show({ ...session, pts: [input.point] }, prompt('Specify opposite corner', 'point'));
    const effect: SessionEffect = { type: 'zoom-window', a: session.pts[0], b: input.point };
    if (session.aux === 'menu') return show({ ...session, command: 'PAN', phase: 'realtime', pts: [], aux: '' }, realtimePrompt(), [], [effect]);
    return done([], [effect]);
  }
  if (session.phase === 'scale') {
    const factor = input.kind === 'empty' ? 2 : zoomFactor(input);
    if (factor === null || !(factor > 0)) return fail(session, prompt('Enter a scale factor', 'number', [], '2'), 'Scale factor must be positive.');
    return done([], [{ type: 'zoom-scale', factor }]);
  }
  if (session.phase === 'center') {
    if (input.kind !== 'point') return fail(session, prompt('Specify center point', 'point'), 'Point or option keyword required.');
    return show({ ...session, phase: 'magnify', pts: [input.point] }, prompt('Enter magnification', 'number', [], '2'));
  }
  if (session.phase === 'magnify') {
    const factor = input.kind === 'empty' ? 2 : zoomFactor(input);
    if (factor === null || !(factor > 0) || !session.pts[0]) return fail(session, prompt('Enter magnification', 'number', [], '2'), 'Scale factor must be positive.');
    return done([], [{ type: 'zoom-center', point: session.pts[0], factor }]);
  }
  if (kw(input, 'Extents') || kw(input, 'All') || (input.kind === 'empty' && session.phase === 'main')) return done([], [{ type: 'zoom-extents' }]);
  if (kw(input, 'Previous')) return done([], [{ type: 'zoom-previous' }]);
  if (kw(input, 'Window') || kw(input, 'Dynamic')) return show({ ...session, phase: 'window' }, prompt('Specify first corner', 'point'));
  if (kw(input, 'Scale')) return show({ ...session, phase: 'scale' }, prompt('Enter a scale factor', 'number', [], '2'));
  if (kw(input, 'Center')) return show({ ...session, phase: 'center' }, prompt('Specify center point', 'point'));
  if (input.kind === 'point') return show({ ...session, phase: 'window', pts: [input.point] }, prompt('Specify opposite corner', 'point'));
  if (input.kind === 'number') return done([], [{ type: 'zoom-scale', factor: input.value }]);
  const typed = zoomFactor(input);
  if (typed !== null) {
    if (!(typed > 0)) return fail(session, prompt('Specify corner of window, enter a scale factor, or', 'any', ZOOM_KEYS, 'Extents'), 'Scale factor must be positive.');
    return done([], [{ type: 'zoom-scale', factor: typed }]);
  }
  return fail(session, prompt('Specify corner of window, enter a scale factor, or', 'any', ZOOM_KEYS, 'Extents'), 'Point or option keyword required.');
}

function pan(session: Session, input: SessionInput): SessionResult {
  if (session.phase === 'realtime') return realtimeNav(session, input);
  return realtimeNav({ ...session, phase: 'realtime' }, input);
}

function panPoints(session: Session, input: SessionInput): SessionResult {
  if (session.phase === 'base') {
    if (input.kind === 'empty') return done();
    if (input.kind !== 'point') return fail(session, prompt('Specify base point or displacement:', 'point'), 'Point or option keyword required.');
    return show({ ...session, phase: 'second', pts: [input.point] }, prompt('Specify second point:', 'point'));
  }
  if (input.kind === 'empty') {
    const base = session.pts[0];
    return done([], [{ type: 'pan-displacement', x: base.x, y: base.y }]);
  }
  if (input.kind !== 'point') return fail(session, prompt('Specify second point:', 'point'), 'Point or option keyword required.');
  return done([], [{ type: 'pan-by', a: session.pts[0], b: input.point }]);
}

function layerNameOf(model: DrawingModel, id: string): string | null {
  return model.entity(id)?.layer ?? modelObject(model.doc, id)?.layer ?? null;
}

function chprop(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  const props = ['Color', 'Layer', 'Linetype', 'LtScale', 'LWeight', 'Transparency', 'Thickness', 'Locked'];
  if (session.phase === 'select') {
    if (kw(input, 'All') || (input.kind === 'text' && input.text.toLowerCase() === 'all')) {
      session.ids = model.doc.entities.map((entity) => entity.id);
      session.phase = 'prop';
      return show(session, prompt('Enter property to change', 'any', props, undefined, false));
    }
    if (input.kind === 'picked') {
      absorbPick(session, input, model);
      return show(session, prompt('Select objects', 'select'));
    }
    if (input.kind === 'empty') {
      if (session.ids.length === 0) return done(['Nothing selected.']);
      return show({ ...session, phase: 'prop' }, prompt('Enter property to change', 'any', props, undefined, false));
    }
    return fail(session, prompt('Select objects', 'select'), 'Select objects, or press Enter to finish.');
  }
  if (session.phase === 'prop') {
    const name = (input.kind === 'keyword' ? input.name : input.kind === 'text' ? input.text : '').toLowerCase();
    const key = name.startsWith('col') ? 'color' : name.startsWith('lay') ? 'layer' : name.startsWith('lt') && name.includes('s') ? 'linetypeScale' : name.startsWith('lt') || name.startsWith('lin') ? 'linetype' : name.startsWith('lw') ? 'lineweight' : name.startsWith('tr') ? 'transparency' : name.startsWith('th') ? 'thickness' : name.startsWith('lo') ? 'locked' : '';
    if (!key) return fail(session, prompt('Enter property to change', 'any', props, undefined, false), 'Property name required.');
    return show({ ...session, phase: 'value', aux: key }, prompt(`New value for ${key}`, 'text', [], undefined, false));
  }
  const raw = input.kind === 'text' ? input.text : input.kind === 'keyword' ? input.name : input.kind === 'number' ? String(input.value) : '';
  if (!raw) return fail(session, prompt('New value', 'text', [], undefined, false), 'Value required.');
  mark(session, model);
  let changed = 0;
  const notes: string[] = [];
  for (const id of session.ids) {
    const error = writeProp(model.doc, id, session.aux, raw);
    if (error) notes.push(error);
    else changed += 1;
  }
  model.emit();
  return done([`${changed} updated.`, ...notes.slice(0, 1)]);
}

function matchprop(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'source') {
    if (input.kind === 'picked') {
      const id = input.ids[input.ids.length - 1];
      if (!id) return show(session, prompt('Select source object', 'select'));
      model.doc.selection = [id];
      model.emit();
      return show({ ...session, phase: 'dest', aux: id, ids: [] }, prompt('Select destination objects', 'select'));
    }
    if (input.kind === 'empty') return done(['Nothing selected.']);
    return fail(session, prompt('Select source object', 'select'), 'Select a source object.');
  }
  if (input.kind === 'picked') {
    absorbPick(session, input, model);
    return show(session, prompt('Select destination objects', 'select'));
  }
  if (input.kind !== 'empty') return fail(session, prompt('Select destination objects', 'select'), 'Select destination objects.');
  const source = model.entity(session.aux) ?? modelObject(model.doc, session.aux);
  if (!source) return done(['Source object was not found.']);
  mark(session, model);
  let copied = 0;
  let locked = 0;
  for (const id of session.ids) {
    if (id === session.aux) continue;
    const entity = model.entity(id);
    const object = entity ?? modelObject(model.doc, id);
    if (!object) continue;
    if ((entity && entity.locked) || (!entity && modelObject(model.doc, id)?.locked)) {
      locked += 1;
      continue;
    }
    const layer = entity ? model.layer(entity.layer) : model.layer(modelObject(model.doc, id)?.layer ?? '');
    if (layer?.locked) {
      locked += 1;
      continue;
    }
    matchProperties(source, object);
    copied += 1;
  }
  model.emit();
  return done([`${copied} updated.`, ...(locked ? [lockMessage(locked)] : [])]);
}

function lockObjects(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (input.kind === 'picked') {
    absorbPick(session, input, model);
    return show(session, prompt('Select objects', 'select'));
  }
  if (input.kind !== 'empty' && !(kw(input, 'All') || (input.kind === 'text' && input.text.toLowerCase() === 'all'))) {
    return fail(session, prompt('Select objects', 'select'), 'Select objects, or press Enter to finish.');
  }
  if (kw(input, 'All') || (input.kind === 'text' && input.text.toLowerCase() === 'all')) {
    session.ids = model.doc.entities.map((entity) => entity.id);
  }
  if (session.ids.length === 0) return done(['Nothing selected.']);
  mark(session, model);
  const count = setLockedIds(model.doc, session.ids, session.command === 'LOCKOBJECT');
  model.emit();
  return done([`${count} ${session.command === 'LOCKOBJECT' ? 'locked' : 'unlocked'}.`]);
}

function layerTool(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  const picking = session.phase === 'pick' || session.phase === 'select';
  if (picking && input.kind === 'picked') {
    const id = input.ids[input.ids.length - 1];
    const layerName = id ? layerNameOf(model, id) : null;
    if (!layerName) return show(session, prompt('Select an object on the desired layer', 'select'), ['Object not found.']);
    if (session.command === 'LAYMRG' && session.phase === 'pick' && !session.aux) {
      return show({ ...session, aux: layerName, ids: id ? [id] : [] }, prompt('Select an object on the target layer', 'select'));
    }
    beginLayerCommand(model.doc);
    mark(session, model);
    if (session.command === 'LAYOFF') {
      const layer = findLayer(model.doc, layerName);
      if (layer) layer.visible = false;
      model.emit();
      return show(session, prompt('Select an object on the layer to turn off or press Enter', 'select'), [`Layer "${layerName}" is now off.`]);
    }
    if (session.command === 'LAYFRZ') {
      const error = freezeLayer(model.doc, layerName);
      model.emit();
      return show(session, prompt('Select an object on the layer to freeze or press Enter', 'select'), [error ?? `Layer "${layerName}" is frozen.`]);
    }
    if (session.command === 'LAYLCK' || session.command === 'LAYULK') {
      const layer = findLayer(model.doc, layerName);
      if (layer) layer.locked = session.command === 'LAYLCK';
      model.emit();
      return show(session, prompt('Select an object or press Enter', 'select'), [`Layer "${layerName}" ${session.command === 'LAYLCK' ? 'locked' : 'unlocked'}.`]);
    }
    if (session.command === 'LAYMCUR') {
      const layer = findLayer(model.doc, layerName);
      if (layer) model.doc.currentLayer = layer.name;
      model.emit();
      endLayerCommand();
      return done([`Current layer: "${model.doc.currentLayer}".`]);
    }
    if (session.command === 'LAYDEL') {
      const error = deleteLayerAndObjects(model.doc, layerName);
      model.emit();
      return show(session, prompt('Select an object on the layer to delete or press Enter', 'select'), [error ?? `Layer "${layerName}" deleted.`]);
    }
    if (session.command === 'LAYMRG') {
      if (session.aux.toLowerCase() === layerName.toLowerCase()) return done(['Cannot merge a layer with itself.']);
      const target = findLayer(model.doc, layerName);
      if (!target) return done([`Layer "${layerName}" not found.`]);
      for (const entity of model.doc.entities) {
        if (entity.layer.toLowerCase() === session.aux.toLowerCase()) entity.layer = target.name;
      }
      for (const object of model.doc.objects ?? []) {
        if (object.layer.toLowerCase() === session.aux.toLowerCase()) object.layer = target.name;
      }
      const refused = deleteLayer(model.doc, session.aux);
      model.emit();
      endLayerCommand();
      return done([refused ?? `Layer "${session.aux}" merged into "${target.name}".`]);
    }
  }
  if (session.phase === 'apply' || (input.kind === 'empty' && (session.command === 'LAYISO' || session.command === 'LAYCUR'))) {
    beginLayerCommand(model.doc);
    mark(session, model);
    if (session.command === 'LAYISO') {
      const names = session.ids.map((id) => layerNameOf(model, id)).filter((name): name is string => Boolean(name));
      layiso(model.doc, names);
      model.emit();
      endLayerCommand();
      return done([`Isolated ${names.length} layer${names.length === 1 ? '' : 's'}.`]);
    }
    if (session.command === 'LAYCUR') {
      const count = moveEntitiesToLayer(model.doc, session.ids, model.doc.currentLayer);
      model.emit();
      endLayerCommand();
      return done([`${count} moved to layer "${model.doc.currentLayer}".`]);
    }
  }
  if (session.command === 'LAYMCH') {
    if (session.phase === 'select') {
      if (input.kind === 'picked') {
        absorbPick(session, input, model);
        return show(session, prompt('Select objects to change', 'select'));
      }
      if (input.kind === 'empty') {
        if (session.ids.length === 0) return done(['Nothing selected.']);
        return show({ ...session, phase: 'dest' }, prompt('Select an object on the destination layer', 'select'));
      }
    }
    if (session.phase === 'dest' && input.kind === 'picked') {
      const id = input.ids[input.ids.length - 1];
      const layerName = id ? layerNameOf(model, id) : null;
      if (!layerName) return done(['Object not found.']);
      beginLayerCommand(model.doc);
      mark(session, model);
      const parted = partitionEditable(model.doc, session.ids);
      const count = moveEntitiesToLayer(model.doc, parted.editable, layerName);
      model.emit();
      endLayerCommand();
      return done([`${count} moved to layer "${layerName}".`, ...(parted.locked ? [lockMessage(parted.locked)] : [])]);
    }
  }
  if (input.kind === 'empty') {
    endLayerCommand();
    return done();
  }
  return fail(session, prompt('Select an object on the desired layer', 'select'), 'Select an object.');
}

function layerCmd(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  const menu = prompt(`Current layer: "${model.doc.currentLayer}". Enter an option`, 'any', ['?', 'Make', 'Set', 'New', 'ON', 'OFF', 'Color']);
  if (session.phase === 'menu') {
    if (input.kind === 'empty' || kw(input, '?')) {
      const lines = model.doc.layers.map((layer) => `${layer.name}${layer.name === model.doc.currentLayer ? '  (current)' : ''}  ${layer.visible ? 'On' : 'Off'}  ${layer.color}  ${layer.lineType}`);
      return input.kind === 'empty' ? done(lines) : show(session, menu, lines);
    }
    const option = input.kind === 'keyword' ? input.name : input.kind === 'text' ? input.text : '';
    const key = option.toLowerCase();
    if (!['make', 'set', 'new', 'on', 'off', 'color'].includes(key)) return fail(session, menu, 'Option keyword required.');
    return show({ ...session, phase: 'name', aux: key }, prompt(key === 'color' ? 'Enter layer name to color' : 'Enter layer name', 'text', [], undefined, false));
  }
  if (session.phase === 'name') {
    const name = input.kind === 'text' ? input.text.trim() : '';
    if (!name) return fail(session, prompt('Enter layer name', 'text', [], undefined, false), 'Layer name required.');
    if (session.aux === 'color') return show({ ...session, phase: 'color', aux: name }, prompt('Enter color (1-7, bylayer, or #hex)', 'text', [], undefined, false));
    return applyLayer(session, model, name, menu);
  }
  const color = input.kind === 'text' ? input.text.trim() : '';
  const layer = model.layer(session.aux);
  if (!layer) return done([`Layer "${session.aux}" not found.`]);
  const parsed = parseColorInput(color);
  if (!parsed || parsed.color === 'bylayer' || parsed.color === 'byblock') return fail(session, prompt('Enter color (1-255 or #hex)', 'text', [], undefined, false), 'Color must be an ACI index or a #hex color.');
  mark(session, model);
  layer.color = parsed.color;
  layer.colorIndex = parsed.colorIndex;
  model.emit();
  return done([`Layer "${layer.name}" color set.`]);
}

function applyLayer(session: Session, model: DrawingModel, name: string, menu: PromptSpec): SessionResult {
  const existing = model.layer(name);
  if (session.aux === 'new' || session.aux === 'make') {
    if (!existing) {
      mark(session, model);
      model.doc.layers.push(layerTemplate(name, (model.doc.layers.length % 6) + 1));
    }
    if (session.aux === 'make') model.doc.currentLayer = model.layer(name)?.name ?? name;
    model.emit();
    return show({ ...session, phase: 'menu', aux: '' }, menu, [`Layer "${name}" ${session.aux === 'make' ? 'made current' : 'created'}.`]);
  }
  if (!existing) return fail(session, prompt('Enter layer name', 'text', [], undefined, false), `Layer "${name}" not found.`);
  mark(session, model);
  if (session.aux === 'set') model.doc.currentLayer = existing.name;
  if (session.aux === 'on') existing.visible = true;
  if (session.aux === 'off') existing.visible = false;
  model.emit();
  return show({ ...session, phase: 'menu', aux: '' }, menu, [`Layer "${existing.name}" updated.`]);
}

function linetype(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  const menu = prompt('Enter an option', 'any', ['?', 'Set']);
  if (session.phase === 'menu') {
    if (input.kind === 'empty' || kw(input, '?')) {
      const lines = ['Continuous', 'Dashed', 'Hidden', 'Center', 'Phantom'];
      return input.kind === 'empty' ? done(lines) : show(session, menu, lines);
    }
    if (kw(input, 'Set') || (input.kind === 'text' && input.text.toLowerCase() === 'set')) {
      return show({ ...session, phase: 'name' }, prompt('Enter linetype name', 'text', [], undefined, false));
    }
    return fail(session, menu, 'Option keyword required.');
  }
  const name = input.kind === 'text' ? input.text.trim() : '';
  const known = ['Continuous', 'Dashed', 'Hidden', 'Center', 'Phantom'];
  const match = known.find((item) => item.toLowerCase() === name.toLowerCase());
  if (!match) return fail(session, prompt('Enter linetype name', 'text', [], undefined, false), 'Unknown linetype. Use Continuous, Dashed, Hidden, Center, or Phantom.');
  const layer = model.layer(model.doc.currentLayer);
  if (!layer) return done();
  mark(session, model);
  layer.lineType = match;
  model.emit();
  return done([`Linetype ${match} set on layer ${layer.name}.`]);
}

function ltscale(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  const value = input.kind === 'number' ? input.value : input.kind === 'empty' ? model.doc.linetypeScale : NaN;
  if (!(value > 0)) return fail(session, prompt('Enter new linetype scale factor', 'number'), 'Scale must be positive.');
  mark(session, model);
  model.doc.linetypeScale = value;
  model.emit();
  return done([`LTSCALE = ${fmt(value, 4)}`]);
}

function colorCmd(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  const raw = input.kind === 'text' ? input.text : input.kind === 'keyword' ? input.name : input.kind === 'number' ? String(input.value) : input.kind === 'empty' ? model.doc.currentColor : '';
  if (!raw) return end(session);
  const parsed = parseColorInput(raw);
  if (!parsed) return fail(session, prompt('New entity color [ByLayer, ByBlock, 1-255, or #hex]', 'any', [], model.doc.currentColor), 'Color must be ByLayer, ByBlock, an ACI index, or a #hex color.');
  mark(session, model);
  model.doc.currentColor = parsed.color;
  if (parsed.colorIndex) model.doc.currentColorIndex = parsed.colorIndex;
  else delete model.doc.currentColorIndex;
  const ids = model.doc.selection;
  let changed = 0;
  let locked = 0;
  for (const id of ids) {
    const error = writeProp(model.doc, id, 'color', raw);
    if (error) locked += 1;
    else changed += 1;
  }
  model.emit();
  const notes = [`Current color: ${parsed.color === 'bylayer' ? 'ByLayer' : parsed.color === 'byblock' ? 'ByBlock' : parsed.colorIndex ? String(parsed.colorIndex) : parsed.color.toUpperCase()}`];
  if (changed) notes.push(`${changed} updated.`);
  if (locked) notes.push(lockMessage(locked));
  return done(notes);
}

function osnap(session: Session, settings: CadSettings, input: SessionInput): SessionResult {
  const menu = prompt('Toggle an object snap', 'any', ['Endpoint', 'Midpoint', 'Center', 'Node', 'Intersection', 'Nearest', 'None', 'Off', 'On']);
  if (input.kind === 'empty') return done([`Object snaps ${settings.osnap ? 'on' : 'off'}: ${settings.osnapModes.join(', ')}`]);
  const name = (input.kind === 'keyword' ? input.name : input.kind === 'text' ? input.text : '').toLowerCase();
  if (name === 'off') settings.osnap = false;
  else if (name === 'on') settings.osnap = true;
  else if (name === 'none') settings.osnapModes = [];
  else {
    const mode = (['endpoint', 'midpoint', 'center', 'node', 'intersection', 'nearest'] as const).find((item) => item === name);
    if (!mode) return fail(session, menu, 'Option keyword required.');
    settings.osnap = true;
    settings.osnapModes = settings.osnapModes.includes(mode) ? settings.osnapModes.filter((item) => item !== mode) : [...settings.osnapModes, mode];
  }
  return done([`Object snaps ${settings.osnap ? 'on' : 'off'}: ${settings.osnapModes.join(', ') || 'none'}`]);
}

function dsettings(session: Session, settings: CadSettings, input: SessionInput): SessionResult {
  const name = (input.kind === 'keyword' ? input.name : input.kind === 'text' ? input.text : '').toLowerCase();
  if (!name) {
    return done([
      `Ortho ${settings.ortho ? 'on' : 'off'}  Polar ${settings.polar ? 'on' : 'off'}  Otrack ${settings.otrack ? 'on' : 'off'}`,
      `Dyn ${settings.dyn ? 'on' : 'off'}  Osnap ${settings.osnap ? 'on' : 'off'}  Snap ${settings.gridSnap ? 'on' : 'off'}`,
    ]);
  }
  if (name === 'ortho') settings.ortho = !settings.ortho;
  else if (name === 'polar') settings.polar = !settings.polar;
  else if (name === 'otrack') settings.otrack = !settings.otrack;
  else if (name === 'dyn') settings.dyn = !settings.dyn;
  else if (name === 'osnap') settings.osnap = !settings.osnap;
  else if (name === 'snap') settings.gridSnap = !settings.gridSnap;
  else return fail(session, prompt('Toggle a drafting mode', 'any', ['Ortho', 'Polar', 'Otrack', 'Dyn', 'Osnap', 'Snap']), 'Option keyword required.');
  return done([`${name} ${name === 'ortho' ? settings.ortho : name === 'polar' ? settings.polar : name === 'otrack' ? settings.otrack : name === 'dyn' ? settings.dyn : name === 'osnap' ? settings.osnap : settings.gridSnap ? 'on' : 'off'}`]);
}

function snap(session: Session, settings: CadSettings, input: SessionInput): SessionResult {
  if (kw(input, 'ON')) settings.gridSnap = true;
  else if (kw(input, 'OFF')) settings.gridSnap = false;
  else if (input.kind === 'number' && input.value > 0) {
    settings.gridSpacing = input.value;
    settings.gridSnap = true;
  } else if (input.kind === 'empty') settings.gridSnap = !settings.gridSnap;
  else return fail(session, prompt('Specify snap spacing or', 'number', ['ON', 'OFF']), 'Enter a spacing, ON, or OFF.');
  return done([`Snap ${settings.gridSnap ? 'on' : 'off'}  spacing ${fmt(settings.gridSpacing, 3)}`]);
}

function units(session: Session, input: SessionInput): SessionResult {
  if (kw(input, 'Meters') || (input.kind === 'text' && input.text.toLowerCase().startsWith('m'))) return done(['Units set to meters.'], [{ type: 'unit', unit: 'm' }]);
  if (kw(input, 'Feet') || (input.kind === 'text' && input.text.toLowerCase().startsWith('f'))) return done(['Units set to feet.'], [{ type: 'unit', unit: 'ft' }]);
  return fail(session, prompt('Enter units', 'any', ['Meters', 'Feet']), 'Meters or Feet.');
}

function paste(session: Session, model: DrawingModel, clipboard: DrawEntity[], input: SessionInput): SessionResult {
  if (input.kind !== 'point') return end(session);
  if (clipboard.length === 0) return done(['Clipboard is empty.']);
  const base = activeClipboardBase() ?? clipboardBase(clipboard);
  mark(session, model);
  const ids: string[] = [];
  for (const entity of clipboard) {
    const copy = moved(structuredClone(entity), input.point.x - base.x, input.point.y - base.y, input.point.z - base.z);
    copy.id = model.nextId();
    model.add(copy);
    ids.push(copy.id);
  }
  model.doc.selection = ids;
  model.emit();
  return done([`${ids.length} pasted.`]);
}

function clipboardBase(entities: DrawEntity[]): Vec3 {
  let minX = Infinity;
  let minY = Infinity;
  let z = 0;
  const visit = (p: Vec3) => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    z = p.z;
  };
  for (const entity of entities) entityPath(entity, 8).forEach(visit);
  return v3(Number.isFinite(minX) ? minX : 0, Number.isFinite(minY) ? minY : 0, z);
}

function alignFrom(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (input.kind === 'empty') return done(['Using the surface boundary when one exists.'], [{ type: 'alignment-boundary' }]);
  if (input.kind === 'picked') {
    const source = alignmentSource(model, input.ids.length ? input.ids : session.ids);
    if (!source) return fail(session, prompt('Select a line or polyline', 'select'), 'Select a line, arc, or polyline.');
    return done([`Alignment from ${source.type}.`], [{ type: 'alignment-points', points: alignmentPointsOf(source) }]);
  }
  return fail(session, prompt('Select a line or polyline, or press Enter to use the surface boundary', 'select'), 'Select an object.');
}
