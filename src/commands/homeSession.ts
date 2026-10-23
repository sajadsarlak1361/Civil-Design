import { explodeInsert, blockByName, blockLocalEntities, defineBlock, insertAttributes, purgeLibrary, usedBlockNames } from '../engine/blocks';
import { ensureLibrary, dimStyleByName, effectiveDimStyle, dimScaleOf, standardDimStyle } from '../engine/cadLibrary';
import type { DrawDimension, DrawMText, DimKind, Xyz } from '../engine/cadShapes';
import { drawingToDxf } from '../engine/cadDxf';
import {
  arcFromStartCenter,
  arcFromStartCenterAngle,
  arcFromStartCenterLength,
  arcFromStartEndAngle,
  arcFromStartEndDirection,
  arcFromStartEndRadius,
  blendCurve,
  circleTtr,
  circleTtt,
  cvSpline,
  divideDistances,
  ellipseFromAxes,
  ellipseFromCenterAxis,
  fitSpline,
  measureDistances,
  pointAtDistance,
  revisionCloud,
  splineLength,
  type Xy,
} from '../engine/curves';
import { lengthenDelta as lengthenByDelta, lengthenPercent, lengthenTotal, alignTransform, applyAlign, breakPolyline, overkillIndexes, reversePoints, moveDrawOrder } from '../engine/editGeom';
import {
  asPolyline,
  breakPolylineAt,
  entityChain,
  fitPolyline,
  insertVertex,
  joinChains,
  moveVertex,
  reversePolyline,
  setSegmentWidth,
  straightenRange,
  zeroBulges,
  type JoinChain,
} from '../engine/pedit';
import { measureDimension, signedOffset, formatDimension, continueFrom, baselineFrom, spaceDimensions } from '../engine/dimension';
import { boundaryAtPoint, hatchPattern } from '../engine/hatch';
import { parseCadEntity } from '../engine/entityOps';
import { createGroup, editGroup, groupByName, ungroup } from '../engine/groups';
import { similarEntities } from '../engine/selection';
import {
  entityPath,
  parseStoredEntity,
  v3,
  type DrawEntity,
  type DrawLine,
  type DrawPolyline,
  type DrawingModel,
  type Vec3,
} from '../engine/drafting';
import type { PromptSpec } from './parser';
import { takePrime } from './prime';
import { HOME_COMMANDS } from './homeCatalog';
import type { CadSettings, Fig, Session, SessionEffect, SessionInput, SessionResult } from './session';

const STEP = new Set<string>(HOME_COMMANDS.filter((name) => !['TRIMQUICK', 'EXTENDQUICK', 'RECTCHAMFER', 'RECTFILLET', 'RECTAREA', 'RECTDIMS', 'RECTROT', 'RECTWIDTH'].includes(name)));

export function isHomeStep(command: string): boolean {
  return STEP.has(command);
}

function blank(command: string, phase: string): Session {
  return { command, phase, ids: [], pts: [], aux: '', n: 0, n2: 0, flag: false, window: null, crossing: false, checked: false, extra: [] };
}

function prompt(head: string, expect: PromptSpec['expect'], keywords: string[] = [], def?: string): PromptSpec {
  return { head, expect, keywords: keywords.map((label) => ({ label })), def, spaceCommits: true };
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

function kw(input: SessionInput, label: string): boolean {
  return input.kind === 'keyword' && input.name.toLowerCase() === label.toLowerCase();
}

function mark(session: Session, model: DrawingModel): void {
  if (!session.checked) {
    model.checkpoint();
    session.checked = true;
  }
}

function style(model: DrawingModel): { layer: string; color: string; lineType: string; lineWeight: 'bylayer' } {
  return { layer: model.doc.currentLayer, color: model.doc.currentColor, lineType: 'bylayer', lineWeight: 'bylayer' };
}

type EntityInput = DrawEntity extends infer E
  ? E extends DrawEntity
    ? Omit<E, 'id' | 'layer' | 'color'> & { layer?: string; color?: string }
    : never
  : never;

function add(model: DrawingModel, session: Session, entity: EntityInput): DrawEntity {
  mark(session, model);
  const base = style(model);
  const record = { ...base, ...entity, id: model.nextId() } as DrawEntity;
  model.add(record);
  session.ids.push(record.id);
  return record;
}

function xyz(p: Xy | Vec3): Xyz {
  return { x: p.x, y: p.y, z: p.z ?? 0 };
}

function pt(p: Xy): Vec3 {
  return v3(p.x, p.y, p.z ?? 0);
}

function picked(input: SessionInput): { id: string; at: Vec3 } | null {
  if (input.kind !== 'picked' || input.ids.length === 0) return null;
  return { id: input.ids[0], at: input.at };
}

export function beginHome(command: string, model: DrawingModel, settings: CadSettings): SessionResult | null {
  void settings;
  const name = command.toUpperCase();
  const prime = takePrime();
  if (name === 'TRIMQUICK') return show(blank('TRIM', 'pick'), prompt('Select object to trim or', 'select', ['Undo']));
  if (name === 'EXTENDQUICK') return show(blank('EXTEND', 'pick'), prompt('Select object to extend or', 'select', ['Undo']));
  if (name === 'RECTFILLET') return show(Object.assign(blank('RECTANG', 'fillet'), { aux: prime }), prompt('Specify fillet radius for rectangles', 'number', [], '0'));
  if (name === 'RECTCHAMFER') return show(blank('RECTANG', 'chamfer1'), prompt('Specify first chamfer distance for rectangles', 'number', [], '0'));
  if (name === 'RECTAREA') return show(Object.assign(blank('RECTANG', 'area'), { flag: true }), prompt('Specify first corner point', 'point'));
  if (name === 'RECTDIMS') return show(Object.assign(blank('RECTANG', 'dimlen'), { flag: true }), prompt('Specify length for rectangles', 'number'));
  if (name === 'RECTROT') return show(blank('RECTANG', 'rot'), prompt('Specify rotation angle for rectangles', 'number', [], '0'));
  if (name === 'RECTWIDTH') return show(blank('RECTANG', 'width'), prompt('Specify line width for rectangles', 'number', [], '0'));
  if (!STEP.has(name) && name !== 'MTEXT') return null;
  if (name === 'ELLIPSE') return show(blank(name, 'a1'), prompt('Specify axis endpoint of ellipse or', 'point', ['Center', 'Arc']));
  if (name === 'ELLIPSEC') return show(blank('ELLIPSE', 'center'), prompt('Specify center of ellipse', 'point'));
  if (name === 'ELLIPSEA') return show(Object.assign(blank('ELLIPSE', 'a1'), { flag: true }), prompt('Specify axis endpoint of elliptical arc or', 'point', ['Center']));
  if (name === 'SPLINE') return show(blank(name, 'fit'), prompt('Specify first point or', 'point', ['CV']));
  if (name === 'SPLINECV') return show(blank('SPLINE', 'cv'), prompt('Specify first control point', 'point'));
  if (name === 'HATCH') return show(Object.assign(blank(name, 'pick'), { aux: JSON.stringify({ pattern: prime || 'ANSI31', scale: 1, angle: 0, associative: true }) }), prompt('Pick internal point or', 'point', ['Select objects', 'Settings']));
  if (name === 'HATCHEDIT') return show(blank(name, 'select'), prompt('Select hatch object', 'select'));
  if (name === 'BOUNDARY') return show(blank(name, 'pick'), prompt('Pick internal point', 'point'));
  if (name === 'REGION') return show(blank(name, 'select'), prompt('Select objects', 'select'));
  if (name === 'DIVIDE' || name === 'MEASURE') return show(blank(name, 'select'), prompt('Select object to divide', 'select'));
  if (name === 'XLINE') return show(blank(name, 'p1'), prompt('Specify a point or', 'point', ['Hor', 'Ver', 'Ang']));
  if (name === 'RAY') return show(blank(name, 'p1'), prompt('Specify start point', 'point'));
  if (name === 'REVCLOUD') return show(blank(name, 'pts'), prompt('Specify first point or', 'point', ['Arc length']));
  if (name === 'DONUT') return show(blank(name, 'inner'), prompt('Specify inside diameter of donut', 'number', [], '0'));
  if (name === 'WIPEOUT') return show(blank(name, 'pts'), prompt('Specify first point or', 'point', ['Polyline']));
  if (name === 'POINTM') return show(blank(name, 'point'), prompt('Specify a point', 'point'));
  if (name === 'BLEND') return show(blank(name, 'a'), prompt('Select first object', 'select'));
  if (name === 'ARRAY' || name === 'ARRAYRECT') return show(blank('ARRAYRECT', 'select'), prompt('Select objects', 'select'));
  if (name === 'ARRAYPATH') return show(blank(name, 'select'), prompt('Select objects to array', 'select'));
  if (name === 'ARRAYPOLAR') return show(blank(name, 'select'), prompt('Select objects to array', 'select'));
  if (name === 'ARRAYEDIT') return show(blank(name, 'select'), prompt('Select associative array', 'select'));
  if (name === 'BREAK') return show(blank(name, 'select'), prompt('Select object', 'select'));
  if (name === 'BREAKATPOINT') return show(blank(name, 'select'), prompt('Select object', 'select'));
  if (name === 'LENGTHEN') return show(blank(name, 'mode'), prompt('Select an object or', 'select', ['DElta', 'Percent', 'Total', 'Dynamic']));
  if (name === 'ALIGN') return show(blank(name, 'select'), prompt('Select objects', 'select'));
  if (name === 'REVERSE' || name === 'OVERKILL' || name === 'DRAWORDER') return show(blank(name, 'select'), prompt('Select objects', 'select'));
  if (name === 'PEDIT') {
    resetPeditUndo();
    return show(blank(name, 'select'), prompt('Select polyline or', 'select', ['Multiple']));
  }
  if (name === 'SPLINEDIT') return show(blank(name, 'select'), prompt('Select spline', 'select'));
  if (name === 'CHSPACE') return show(blank(name, 'select'), prompt('Select objects to change space', 'select'));
  if (name === 'TEXTTOFRONT') return bringFront(model, ['text', 'mtext', 'dimension', 'mleader']);
  if (name === 'HATCHTOBACK') return sendBack(model, ['hatch']);
  if (name === 'SELECTSIMILAR') return selectSimilar(model);
  if (name === 'STYLE') return show(blank(name, 'name'), prompt('Enter text style name', 'text', [], 'Standard'), [], [{ type: 'dialog', dialog: 'style' }]);
  if (name === 'MTEXT') return show(blank(name, 'a'), prompt('Specify first corner', 'point'));
  if (name === 'DIM') return show(blank(name, 'select'), prompt('Select objects or', 'select', ['Linear', 'Aligned', 'Radius', 'Diameter']));
  if (isDimDraw(name)) return show(blank(name, 'p1'), prompt(dimHead(name), 'point', ['Select object']));
  if (name === 'QDIM') return show(blank(name, 'select'), prompt('Select geometry to dimension', 'select'));
  if (name === 'DIMCONTINUE' || name === 'DIMBASELINE') return show(blank(name, 'next'), prompt('Specify a second extension line origin', 'point'));
  if (name === 'DIMJUSTL' || name === 'DIMJUSTC' || name === 'DIMJUSTR') {
    const justify = name === 'DIMJUSTL' ? 'left' : name === 'DIMJUSTR' ? 'right' : 'center';
    return show(Object.assign(blank('DIMTEDIT', 'select'), { aux: justify }), prompt('Select dimension', 'select'));
  }
  if (name === 'DIMSPACE' || name === 'DIMBREAK' || name === 'DIMINSPECT' || name === 'DIMJOGLINE' || name === 'DIMEDIT' || name === 'DIMTEDIT' || name === 'DIMREASSOCIATE') {
    return show(blank(name, 'select'), prompt('Select dimension', 'select'));
  }
  if (name === 'GROUPBBOX') {
    const library = ensureLibrary(model.doc);
    library.groupBBox = !library.groupBBox;
    model.emit();
    return done([library.groupBBox ? 'Group bounding box on.' : 'Group bounding box off.']);
  }
  if (name === 'DIMOVERRIDE') return show(blank(name, 'var'), prompt('Enter dimension variable name', 'text'));
  if (name === 'CENTERMARK' || name === 'CENTERLINE') return show(blank(name, 'select'), prompt(name === 'CENTERLINE' ? 'Select first circle' : 'Select circle or arc', 'select'));
  if (name === 'DIMLAYER') return show(blank(name, 'name'), prompt('Enter dimension layer name or . for none', 'text', [], '.'));
  if (name === 'DIMSTYLE') return done(['Dimension style manager.'], [{ type: 'dialog', dialog: 'dimstyle' }]);
  if (name === '-DIMSTYLE') return show(blank(name, 'apply'), prompt('Enter an option', 'any', ['Apply', 'Save', 'Restore'], 'Apply'));
  if (name === 'DIMSCALE') return show(blank(name, 'value'), prompt('Enter overall dimension scale', 'number', [], '1'));
  if (name === 'MLEADER') return show(blank(name, 'tip'), prompt('Specify leader arrowhead location', 'point'));
  if (name === 'MLEADERADD' || name === 'MLEADERREMOVE' || name === 'MLEADERALIGN' || name === 'MLEADERCOLLECT') return show(blank(name, 'select'), prompt('Select a multileader', 'select'));
  if (name === 'MLEADERSTYLE') return done(['Multileader style.'], [{ type: 'dialog', dialog: 'mleaderstyle' }]);
  if (name === 'TABLE') return show(blank(name, 'rows'), prompt('Enter number of rows or', 'number', ['Import'], '4'));
  if (name === 'TABLESTYLE') return done(['Table style.'], [{ type: 'dialog', dialog: 'table' }]);
  if (name === 'TABLEIMPORT') return show(blank('TABLE', 'csv'), prompt('Paste CSV text', 'text'));
  if (name === 'BLOCK') return show(blank(name, 'name'), prompt('Enter block name', 'text'), [], [{ type: 'dialog', dialog: 'block' }]);
  if (name === 'INSERT') return show(Object.assign(blank(name, 'name'), { aux: prime }), prompt('Enter block name or', 'text', ['?']), [], [{ type: 'dialog', dialog: 'insert' }]);
  if (name === 'BEDIT' || name === 'REFEDIT') return show(blank('BEDIT', 'name'), prompt('Enter block name to edit', 'text'));
  if (name === 'BCLOSE') return closeBlock(model);
  if (name === 'WBLOCK') return show(blank(name, 'name'), prompt('Enter block name to write', 'text'));
  if (name === 'ATTDEF') return show(blank(name, 'tag'), prompt('Enter attribute tag', 'text'));
  if (name === 'EATTEDIT' || name === 'ATTEDIT') return show(blank('ATTEDIT', 'select'), prompt('Select a block reference', 'select'));
  if (name === 'BATTMAN') return done(['Attribute manager.'], [{ type: 'dialog', dialog: 'battman' }]);
  if (name === 'PURGE') return purge(model);
  if (name === 'GROUP') return show(blank(name, 'name'), prompt('Enter a group name or', 'text', ['?'], '*'));
  if (name === 'UNGROUP') return show(blank(name, 'select'), prompt('Select grouped objects or', 'select', ['Name']));
  if (name === 'GROUPEDIT') return show(blank(name, 'name'), prompt('Enter group name', 'text'));
  if (name === 'PICKSTYLE') return togglePick(model);
  if (name === 'CLASSICGROUP') return done(['Group manager.'], [{ type: 'dialog', dialog: 'groups' }]);
  if (name === 'STATIONLABEL') return show(blank(name, 'base'), prompt('Select baseline', 'select'));
  if (name === 'SLOPELABEL') return show(blank(name, 'select'), prompt('Select a line', 'select'));
  if (name === 'CIRCLEDIA') return show(blank(name, 'center'), prompt('Specify center point for circle', 'point'));
  if (name === 'CIRCLE2P') return show(blank(name, 'a'), prompt('Specify first end point of circle diameter', 'point'));
  if (name === 'CIRCLE3P') return show(blank(name, 'a'), prompt('Specify first point on circle', 'point'));
  if (name === 'CIRCLETTR') return show(blank(name, 'a'), prompt('Specify first tangent line', 'select'));
  if (name === 'CIRCLETTT') return show(blank(name, 'a'), prompt('Specify first tangent line', 'select'));
  if (name.startsWith('ARC')) return show(blank(name, 'p1'), prompt(arcHead(name), 'point'));
  return null;
}

function isDimDraw(name: string): boolean {
  return ['DIMLINEAR', 'DIMALIGNED', 'DIMANGULAR', 'DIMARC', 'DIMRADIUS', 'DIMDIAMETER', 'DIMJOGGED', 'DIMORDINATE'].includes(name);
}

function dimHead(name: string): string {
  if (name === 'DIMRADIUS' || name === 'DIMDIAMETER' || name === 'DIMJOGGED' || name === 'DIMARC') return 'Select arc or circle';
  if (name === 'DIMANGULAR') return 'Select arc, circle, or line';
  return 'Specify first extension line origin or';
}

function arcHead(name: string): string {
  if (name === 'ARCCSE' || name === 'ARCCSA' || name === 'ARCCSL') return 'Specify center point of arc';
  if (name === 'ARCCONT') return 'The arc continues from the last line or arc. Specify end point';
  return 'Specify start point of arc';
}

export function homeBase(session: Session): Vec3 | null {
  if (!isHomeStep(session.command) && session.command !== 'MTEXT') return null;
  return session.pts[session.pts.length - 1] ?? null;
}

export function previewHome(session: Session, cursor: Vec3): Fig[] {
  if (!cursor) return [];
  if (session.command === 'ELLIPSE' && session.phase === 'other' && session.pts.length >= 2) {
    const built = ellipseFromAxes(session.pts[0], session.pts[1], cursor);
    if (!built) return [{ points: [session.pts[1], cursor] }];
    return [{ points: ellipseSamples(built.center, built.major, built.ratio) }];
  }
  if (session.command === 'ELLIPSE' && session.phase === 'minor' && session.pts.length >= 2) {
    const major = { x: session.pts[1].x - session.pts[0].x, y: session.pts[1].y - session.pts[0].y, z: 0 };
    const ratio = Math.min(1, Math.hypot(cursor.x - session.pts[0].x, cursor.y - session.pts[0].y) / (Math.hypot(major.x, major.y) || 1));
    return [{ points: ellipseSamples(session.pts[0], major, ratio) }];
  }
  if ((session.command === 'SPLINE' || session.phase === 'fit' || session.phase === 'cv') && session.pts.length > 0 && (session.command === 'SPLINE' || session.command === 'SPLINECV')) {
    const pts = session.phase === 'cv' ? cvSpline([...session.pts, cursor], 8, false) : fitSpline([...session.pts, cursor], 8, false);
    return [{ points: pts.map(pt) }];
  }
  if ((session.command === 'XLINE' || session.command === 'RAY') && session.phase === 'p2' && session.pts[0]) return [{ points: [session.pts[0], cursor] }];
  if ((session.command === 'REVCLOUD' || session.command === 'WIPEOUT') && session.pts.length > 0) return [{ points: [...session.pts, cursor], closed: false }];
  if (isDimDraw(session.command) && session.pts.length >= 1) return [{ points: [...session.pts, cursor] }];
  if (session.command === 'MTEXT' && session.phase === 'b' && session.pts[0]) return [{ points: rectRing(session.pts[0], cursor), closed: true }];
  return [];
}

function ellipseSamples(center: Xy, major: Xy, ratio: number): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i <= 32; i++) {
    const t = (i / 32) * Math.PI * 2;
    const minorX = -major.y * ratio;
    const minorY = major.x * ratio;
    pts.push(v3(center.x + Math.cos(t) * major.x + Math.sin(t) * minorX, center.y + Math.cos(t) * major.y + Math.sin(t) * minorY, center.z ?? 0));
  }
  return pts;
}

function rectRing(a: Vec3, b: Vec3): Vec3[] {
  return [a, v3(b.x, a.y, a.z), b, v3(a.x, b.y, a.z)];
}

export function stepHome(session: Session, model: DrawingModel, settings: CadSettings, input: SessionInput): SessionResult | null {
  if (session.command === 'MTEXT') return mtext(session, model, settings, input);
  if (!isHomeStep(session.command)) return null;
  switch (session.command) {
    case 'ELLIPSE':
      return ellipse(session, model, input);
    case 'SPLINE':
      return spline(session, model, input);
    case 'HATCH':
      return hatch(session, model, input);
    case 'HATCHEDIT':
      return hatchEdit(session, model, input);
    case 'BOUNDARY':
      return boundary(session, model, input);
    case 'REGION':
      return region(session, model, input);
    case 'DIVIDE':
    case 'MEASURE':
      return divide(session, model, input);
    case 'XLINE':
    case 'RAY':
      return xline(session, model, input);
    case 'REVCLOUD':
      return revcloud(session, model, input);
    case 'DONUT':
      return donut(session, model, input);
    case 'WIPEOUT':
      return wipeout(session, model, input);
    case 'POINTM':
      return manyPoints(session, model, input);
    case 'BLEND':
      return blend(session, model, input);
    case 'ARRAYRECT':
      return arrayRect(session, model, input);
    case 'ARRAYPATH':
      return arrayPath(session, model, input);
    case 'ARRAYPOLAR':
      return arrayPolar(session, model, input);
    case 'ARRAYEDIT':
      return arrayEdit(session, model, input);
    case 'BREAK':
    case 'BREAKATPOINT':
      return brk(session, model, input);
    case 'LENGTHEN':
      return lengthen(session, model, input);
    case 'ALIGN':
      return align(session, model, input);
    case 'REVERSE':
      return reverse(session, model, input);
    case 'PEDIT':
      return pedit(session, model, input);
    case 'SPLINEDIT':
      return splinedit(session, model, input);
    case 'CHSPACE':
      return chspace(session, model, input);
    case 'OVERKILL':
      return overkill(session, model, input);
    case 'DRAWORDER':
      return drawOrder(session, model, input);
    case 'STYLE':
      return textStyle(session, model, input);
    case 'DIM':
    case 'DIMLINEAR':
    case 'DIMALIGNED':
    case 'DIMANGULAR':
    case 'DIMARC':
    case 'DIMRADIUS':
    case 'DIMDIAMETER':
    case 'DIMJOGGED':
    case 'DIMORDINATE':
      return dimension(session, model, input);
    case 'QDIM':
      return qdim(session, model, input);
    case 'DIMCONTINUE':
    case 'DIMBASELINE':
      return dimChain(session, model, input);
    case 'DIMSPACE':
      return dimSpace(session, model, input);
    case 'DIMBREAK':
      return dimBreak(session, model, input);
    case 'DIMINSPECT':
      return dimInspect(session, model, input);
    case 'DIMJOGLINE':
      return dimJog(session, model, input);
    case 'DIMEDIT':
      return dimOblique(session, model, input);
    case 'DIMTEDIT':
      return dimTedit(session, model, input);
    case 'DIMOVERRIDE':
      return dimOverride(session, model, input);
    case 'DIMREASSOCIATE':
      return dimReassoc(session, model, input);
    case '-DIMSTYLE':
      return dimStyleCmd(session, model, input);
    case 'DIMSCALE':
      return dimScale(session, model, input);
    case 'DIMLAYER':
      return dimLayer(session, model, input);
    case 'CENTERMARK':
    case 'CENTERLINE':
      return centers(session, model, input);
    case 'MLEADER':
    case 'MLEADERADD':
    case 'MLEADERREMOVE':
    case 'MLEADERALIGN':
    case 'MLEADERCOLLECT':
      return mleader(session, model, input);
    case 'TABLE':
      return table(session, model, input);
    case 'BLOCK':
    case 'INSERT':
    case 'BEDIT':
    case 'WBLOCK':
    case 'ATTDEF':
    case 'ATTEDIT':
      return blocks(session, model, input);
    case 'GROUP':
    case 'UNGROUP':
    case 'GROUPEDIT':
      return groups(session, model, input);
    case 'STATIONLABEL':
    case 'SLOPELABEL':
      return civilLabel(session, model, settings, input);
    default:
      if (session.command.startsWith('CIRCLE')) return circles(session, model, input);
      if (session.command.startsWith('ARC')) return arcs(session, model, input);
      return null;
  }
}

function ellipse(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (input.kind === 'empty') return done();
  if (session.phase === 'a1' && kw(input, 'Center')) return show({ ...session, phase: 'center' }, prompt('Specify center of ellipse', 'point'));
  if (session.phase === 'a1' && kw(input, 'Arc')) return show({ ...session, flag: true }, prompt('Specify axis endpoint of elliptical arc or', 'point', ['Center']));
  if ((session.phase === 'a1' || session.phase === 'center' || session.phase === 'major' || session.phase === 'a2' || session.phase === 'other' || session.phase === 'minor') && input.kind === 'point') {
    session.pts.push(input.point);
    if (session.phase === 'a1') return show({ ...session, phase: 'a2' }, prompt('Specify other endpoint of axis', 'point'));
    if (session.phase === 'a2') return show({ ...session, phase: 'other' }, prompt('Specify distance to other axis or', 'point'));
    if (session.phase === 'center') return show({ ...session, phase: 'major' }, prompt('Specify endpoint of axis', 'point'));
    if (session.phase === 'major') return show({ ...session, phase: 'minor' }, prompt('Specify distance to other axis or', 'point'));
    return commitEllipse(session, model);
  }
  if ((session.phase === 'other' || session.phase === 'minor') && input.kind === 'number') {
    session.n = input.value;
    return commitEllipse(session, model);
  }
  return fail(session, prompt('Specify a point', 'point'), 'Point or option keyword required.');
}

function commitEllipse(session: Session, model: DrawingModel): SessionResult {
  let center: Xyz;
  let major: Xyz;
  let ratio: number;
  if (session.phase === 'minor' || session.pts.length >= 3 && session.phase === 'minor') {
    center = session.pts[0];
    const end = session.pts[1];
    const dist = session.n > 0 ? session.n : Math.hypot(session.pts[2].x - center.x, session.pts[2].y - center.y);
    const built = ellipseFromCenterAxis(center, end, dist);
    if (!built) return done(['Axis length is zero.']);
    major = xyz(built.major);
    ratio = built.ratio;
  } else if (session.n > 0) {
    const built = ellipseFromCenterAxis(lerpMid(session.pts[0], session.pts[1]), session.pts[1], session.n);
    if (!built) return done(['Cannot build that ellipse.']);
    center = lerpMid(session.pts[0], session.pts[1]);
    major = xyz(built.major);
    ratio = built.ratio;
  } else {
    const built = ellipseFromAxes(session.pts[0], session.pts[1], session.pts[2]);
    if (!built) return done(['Cannot build that ellipse.']);
    center = xyz(built.center);
    major = xyz(built.major);
    ratio = built.ratio;
  }
  add(model, session, { type: 'ellipse', center, major, ratio, start: session.flag ? 0 : 0, end: session.flag ? Math.PI : Math.PI * 2 });
  model.emit();
  return done(['Ellipse created.']);
}

function lerpMid(a: Vec3, b: Vec3): Xyz {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: a.z };
}

function spline(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (kw(input, 'CV') && session.pts.length === 0) return show({ ...session, phase: 'cv' }, prompt('Specify first control point', 'point'));
  if (kw(input, 'Fit')) return show({ ...session, phase: 'fit' }, prompt('Specify next point or', 'point', ['Close', 'Undo']));
  if (kw(input, 'Undo')) {
    session.pts.pop();
    return show(session, prompt('Specify next point or', 'point', ['Close', 'Undo', session.phase === 'cv' ? 'Fit' : 'CV']));
  }
  if (input.kind === 'empty' || kw(input, 'Close')) {
    if (session.pts.length < 2) return done();
    const closed = kw(input, 'Close');
    add(model, session, { type: 'spline', mode: session.phase === 'cv' ? 'cv' : 'fit', points: session.pts.map(xyz), closed, degree: 3 });
    model.emit();
    return done(['Spline created.']);
  }
  if (input.kind !== 'point') return fail(session, prompt('Specify next point', 'point'), 'Point or option keyword required.');
  session.pts.push(input.point);
  const keys = session.pts.length >= 2 ? ['Close', 'Undo', session.phase === 'cv' ? 'Fit' : 'CV'] : ['Undo'];
  return show(session, prompt('Specify next point or', 'point', keys));
}

function hatchOpts(session: Session): { pattern: string; scale: number; angle: number; associative: boolean } {
  try {
    const raw = JSON.parse(session.aux || '{}') as { pattern?: string; scale?: number; angle?: number; associative?: boolean };
    return { pattern: raw.pattern || 'ANSI31', scale: raw.scale ?? 1, angle: raw.angle ?? 0, associative: raw.associative !== false };
  } catch {
    return { pattern: 'ANSI31', scale: 1, angle: 0, associative: true };
  }
}

function hatch(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  const opt = hatchOpts(session);
  if (kw(input, 'Settings') || session.phase === 'pattern' || session.phase === 'scale' || session.phase === 'angle') {
    if (session.phase === 'pick' || session.phase === 'select') return show({ ...session, phase: 'pattern' }, prompt('Enter pattern name', 'text', [], opt.pattern));
    if (session.phase === 'pattern') {
      const pattern = input.kind === 'text' ? input.text : input.kind === 'empty' ? opt.pattern : '';
      if (!pattern || !hatchPattern(pattern)) return fail(session, prompt('Enter pattern name', 'text', [], opt.pattern), 'Unknown pattern. Use ANSI31, ISO02, SOLID, or a GR_ gradient.');
      session.aux = JSON.stringify({ ...opt, pattern });
      return show({ ...session, phase: 'scale' }, prompt('Enter scale', 'number', [], String(opt.scale)));
    }
    if (session.phase === 'scale') {
      const scale = input.kind === 'number' ? input.value : opt.scale;
      session.aux = JSON.stringify({ ...opt, scale });
      return show({ ...session, phase: 'angle' }, prompt('Enter angle', 'number', [], String(opt.angle)));
    }
    const angle = input.kind === 'number' ? input.value : input.kind === 'empty' ? opt.angle : NaN;
    if (!Number.isFinite(angle)) return fail(session, prompt('Enter angle', 'number'), 'Requires a number.');
    session.aux = JSON.stringify({ ...opt, angle });
    return show({ ...session, phase: 'pick' }, prompt('Pick internal point or', 'point', ['Select objects', 'Settings']));
  }
  if (kw(input, 'Select objects')) return show({ ...session, phase: 'select', ids: [] }, prompt('Select objects', 'select'));
  if (session.phase === 'select') {
    if (input.kind === 'picked') {
      session.ids = [...new Set([...session.ids, ...input.ids])];
      return show(session, prompt('Select objects', 'select'));
    }
    if (input.kind === 'empty') {
      const selected = loopsFromIds(model, session.ids);
      return commitHatch(session, model, selected, session.ids, Math.max(0, selected.length - 1));
    }
    return fail(session, prompt('Select objects', 'select'), 'Select objects, or press Enter.');
  }
  if (input.kind !== 'point') return fail(session, prompt('Pick internal point or', 'point', ['Select objects', 'Settings']), 'Pick a point inside a closed boundary.');
  const catalog = closedLoops(model);
  const found = boundaryAtPoint(catalog.map((loop) => loop.points), input.point);
  if (!found) return fail(session, prompt('Pick internal point or', 'point', ['Select objects', 'Settings']), 'No closed boundary contains that point.');
  const ordered = [found.outer, ...found.holes, ...found.islands];
  const ids = ordered.map((points) => catalog.find((loop) => loop.points === points)?.id).filter((id): id is string => Boolean(id));
  return commitHatch(session, model, ordered, ids, found.holes.length);
}

function commitHatch(session: Session, model: DrawingModel, loopsIn: Xy[][], sourceIds: string[], holeCount = 0): SessionResult {
  const loops = loopsIn.map((loop) => loop.map(xyz));
  const opt = hatchOpts(session);
  const pattern = hatchPattern(opt.pattern);
  if (!loops[0] || loops[0].length < 3) return done(['The boundary is empty.']);
  const gradient = pattern?.family === 'gradient'
    ? { kind: pattern.gradient === 'none' ? 'linear' as const : pattern.gradient, color1: '#e8eef7', color2: '#1c1408', invert: opt.pattern.includes('INV') }
    : null;
  add(model, session, {
    type: 'hatch',
    pattern: opt.pattern,
    scale: opt.scale,
    angle: opt.angle,
    associative: opt.associative,
    gradient,
    loops,
    holes: Array.from({ length: Math.min(holeCount, Math.max(0, loops.length - 1)) }, (_, index) => index + 1),
    sourceIds,
  });
  model.emit();
  return done([`Hatch created (${opt.pattern}).`]);
}

function closedLoops(model: DrawingModel): { id: string; points: Xyz[] }[] {
  const loops: { id: string; points: Xyz[] }[] = [];
  for (const entity of model.doc.entities) {
    if (entity.type === 'polyline' && entity.closed) loops.push({ id: entity.id, points: entity.vertices.map(xyz) });
    if (entity.type === 'circle') {
      const points: Xyz[] = [];
      for (let i = 0; i < 48; i++) {
        const t = (i / 48) * Math.PI * 2;
        points.push({ x: entity.center.x + Math.cos(t) * entity.radius, y: entity.center.y + Math.sin(t) * entity.radius, z: entity.center.z });
      }
      loops.push({ id: entity.id, points });
    }
    if (entity.type === 'region') for (const loop of entity.loops) loops.push({ id: entity.id, points: loop });
  }
  return loops;
}

function loopsFromIds(model: DrawingModel, ids: string[]): Xyz[][] {
  return closedLoops(model).filter((loop) => ids.includes(loop.id)).map((loop) => loop.points);
}

function hatchEdit(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'select') {
    const hit = picked(input);
    const entity = hit ? model.entity(hit.id) : null;
    if (!entity || entity.type !== 'hatch') return fail(session, prompt('Select hatch object', 'select'), 'Select a hatch.');
    session.aux = hit!.id;
    return show({ ...session, phase: 'pattern' }, prompt('Enter pattern name', 'text', [], entity.pattern));
  }
  const entity = model.entity(session.aux);
  if (!entity || entity.type !== 'hatch') return done(['Hatch is gone.']);
  if (session.phase === 'pattern') {
    const pattern = input.kind === 'text' ? input.text : input.kind === 'empty' ? entity.pattern : '';
    if (!hatchPattern(pattern)) return fail(session, prompt('Enter pattern name', 'text'), 'Unknown pattern.');
    session.n = 1;
    session.extra = [entity.angle];
    session.aux = `${session.aux}|${pattern}`;
    return show({ ...session, phase: 'scale' }, prompt('Enter new scale', 'number', [], String(entity.scale)));
  }
  if (session.phase === 'scale') {
    session.n = input.kind === 'number' ? input.value : session.n;
    return show({ ...session, phase: 'angle' }, prompt('Enter new angle', 'number', [], '0'));
  }
  const angle = input.kind === 'number' ? input.value : input.kind === 'empty' ? entity.angle : NaN;
  if (!Number.isFinite(angle)) return fail(session, prompt('Enter new angle', 'number'), 'Requires a number.');
  const [id, pattern] = session.aux.split('|');
  mark(session, model);
  model.replace({ ...entity, pattern: pattern || entity.pattern, scale: session.n || entity.scale, angle });
  model.emit();
  void id;
  return done(['Hatch updated.']);
}

function boundary(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (input.kind !== 'point') return done();
  const found = boundaryAtPoint(closedLoops(model).map((loop) => loop.points), input.point);
  if (!found) return fail(session, prompt('Pick internal point', 'point'), 'No closed boundary contains that point.');
  add(model, session, { type: 'polyline', closed: true, vertices: found.outer.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0, bulge: 0 })) });
  model.emit();
  return done(['Boundary created.']);
}

function region(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (input.kind === 'picked') {
    session.ids = [...new Set([...session.ids, ...input.ids])];
    return show(session, prompt('Select objects', 'select'));
  }
  if (input.kind !== 'empty') return fail(session, prompt('Select objects', 'select'), 'Select closed objects.');
  const loops = loopsFromIds(model, session.ids);
  if (loops.length === 0) return done(['No closed objects selected.']);
  add(model, session, { type: 'region', loops });
  model.emit();
  return done([`${loops.length} loop region created.`]);
}

function divide(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'select') {
    const hit = picked(input);
    if (!hit) return fail(session, prompt('Select object to divide', 'select'), 'Select an object.');
    session.aux = hit.id;
    const head = session.command === 'DIVIDE' ? 'Enter the number of segments' : 'Specify length of segment';
    return show({ ...session, phase: 'n' }, prompt(head, 'number'));
  }
  const value = input.kind === 'number' ? input.value : NaN;
  const entity = model.entity(session.aux);
  if (!entity || !(value > 0)) return done(['Requires a positive number.']);
  const path = entityPath(entity, 24).map(xyz);
  const length = splineLength(path);
  const distances = session.command === 'DIVIDE' ? divideDistances(length, Math.round(value)) : measureDistances(length, value);
  for (const distance of distances) {
    const at = pointAtDistance(path, distance);
    if (at) add(model, session, { type: 'point', p: pt(at.point) });
  }
  model.emit();
  return done([`${distances.length} points placed.`]);
}

function xline(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'p1' && (kw(input, 'Hor') || kw(input, 'Ver') || kw(input, 'Ang'))) {
    session.aux = input.kind === 'keyword' ? input.name.toLowerCase() : '';
    return show({ ...session, phase: 'p1b' }, prompt('Specify through point', 'point'));
  }
  if (input.kind !== 'point') return input.kind === 'empty' ? done() : fail(session, prompt('Specify a point', 'point'), 'Point or option keyword required.');
  if (session.phase === 'p1' || session.phase === 'p1b') {
    session.pts.push(input.point);
    if (session.aux === 'hor' || session.aux === 'ver' || session.aux === 'ang') {
      const origin = input.point;
      const angle = session.aux === 'ver' ? Math.PI / 2 : session.aux === 'ang' ? (session.n * Math.PI) / 180 : 0;
      const end = v3(origin.x + Math.cos(angle), origin.y + Math.sin(angle), origin.z);
      add(model, session, { type: session.command === 'RAY' ? 'ray' : 'xline', a: origin, b: end });
      model.emit();
      return show({ ...session, pts: [], phase: 'p1b' }, prompt('Specify through point', 'point'));
    }
    return show({ ...session, phase: 'p2' }, prompt('Specify through point', 'point'));
  }
  add(model, session, { type: session.command === 'RAY' ? 'ray' : 'xline', a: session.pts[0], b: input.point });
  model.emit();
  session.pts = [session.pts[0]];
  return show(session, prompt('Specify through point', 'point'));
}

function revcloud(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (kw(input, 'Arc length')) return show({ ...session, phase: 'chord' }, prompt('Specify approximate chord length', 'number', [], '2'));
  if (session.phase === 'chord' && input.kind === 'number') {
    session.n = input.value;
    return show({ ...session, phase: 'pts' }, prompt('Specify first point', 'point'));
  }
  if (input.kind === 'empty' || kw(input, 'Close')) {
    if (session.pts.length < 2) return done();
    const vertices = revisionCloud(session.pts, session.n || 2, true);
    add(model, session, { type: 'revcloud', vertices, closed: true });
    model.emit();
    return done(['Revision cloud created.']);
  }
  if (input.kind !== 'point') return fail(session, prompt('Specify next point', 'point'), 'Point or option keyword required.');
  session.pts.push(input.point);
  return show(session, prompt('Specify next point or', 'point', session.pts.length > 1 ? ['Close'] : []));
}

function donut(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'inner') {
    const value = input.kind === 'number' ? input.value : input.kind === 'empty' ? 0 : NaN;
    if (!(value >= 0)) return fail(session, prompt('Specify inside diameter of donut', 'number'), 'Diameter must be zero or positive.');
    return show({ ...session, phase: 'outer', n: value }, prompt('Specify outside diameter of donut', 'number'));
  }
  if (session.phase === 'outer') {
    const value = input.kind === 'number' ? input.value : NaN;
    if (!(value > session.n)) return fail(session, prompt('Specify outside diameter of donut', 'number'), 'Outside diameter must be larger than the inside diameter.');
    return show({ ...session, phase: 'center', n2: value }, prompt('Specify center of donut', 'point'));
  }
  if (input.kind === 'empty') return done();
  if (input.kind !== 'point') return fail(session, prompt('Specify center of donut', 'point'), 'Point or Enter to stop.');
  add(model, session, { type: 'donut', center: input.point, inner: session.n / 2, outer: session.n2 / 2 });
  model.emit();
  return show(session, prompt('Specify center of donut', 'point'));
}

function wipeout(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (kw(input, 'Polyline')) return show({ ...session, phase: 'poly' }, prompt('Select a closed polyline', 'select'));
  if (session.phase === 'poly') {
    const hit = picked(input);
    const entity = hit ? model.entity(hit.id) : null;
    if (!entity || entity.type !== 'polyline') return fail(session, prompt('Select a closed polyline', 'select'), 'Select a polyline.');
    add(model, session, { type: 'wipeout', vertices: entity.vertices.map(xyz) });
    model.emit();
    return done(['Wipeout created.']);
  }
  if (input.kind === 'empty' || kw(input, 'Close')) {
    if (session.pts.length < 3) return done();
    add(model, session, { type: 'wipeout', vertices: session.pts.map(xyz) });
    model.emit();
    return done(['Wipeout created.']);
  }
  if (input.kind !== 'point') return fail(session, prompt('Specify next point', 'point'), 'Point or option keyword required.');
  session.pts.push(input.point);
  return show(session, prompt('Specify next point or', 'point', session.pts.length >= 3 ? ['Close'] : []));
}

function manyPoints(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (input.kind !== 'point') return done();
  add(model, session, { type: 'point', p: input.point });
  model.emit();
  return show(session, prompt('Specify a point', 'point'));
}

function blend(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  const hit = picked(input);
  if (!hit) return fail(session, prompt('Select object', 'select'), 'Select an object.');
  if (session.phase === 'a') return show({ ...session, phase: 'b', aux: hit.id, pts: [hit.at] }, prompt('Select second object', 'select'));
  const first = model.entity(session.aux);
  const second = model.entity(hit.id);
  if (!first || !second) return done(['Object is gone.']);
  const a = entityPath(first, 8);
  const b = entityPath(second, 8);
  if (a.length < 2 || b.length < 2) return done(['Those objects have no tangent.']);
  const aEnd = nearerEnd(a, session.pts[0] ?? hit.at);
  const bEnd = nearerEnd(b, hit.at);
  const curve = blendCurve(aEnd.point, aEnd.tan, bEnd.point, bEnd.tan, 16);
  add(model, session, { type: 'spline', mode: 'fit', points: curve.map(xyz), closed: false, degree: 3 });
  model.emit();
  return done(['Curves blended.']);
}

function nearerEnd(path: Vec3[], at: Vec3): { point: Xyz; tan: Xyz } {
  const start = Math.hypot(path[0].x - at.x, path[0].y - at.y);
  const end = Math.hypot(path[path.length - 1].x - at.x, path[path.length - 1].y - at.y);
  if (start <= end) {
    const dir = { x: path[0].x - path[1].x, y: path[0].y - path[1].y, z: 0 };
    return { point: path[0], tan: scaleTan(dir) };
  }
  const dir = { x: path[path.length - 1].x - path[path.length - 2].x, y: path[path.length - 1].y - path[path.length - 2].y, z: 0 };
  return { point: path[path.length - 1], tan: scaleTan(dir) };
}

function scaleTan(dir: Xyz): Xyz {
  const len = Math.hypot(dir.x, dir.y) || 1;
  return { x: (dir.x / len) * 10, y: (dir.y / len) * 10, z: 0 };
}

function arrayRect(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'select') return collect(session, model, input, 'Enter the number of rows', 'rows', 'number');
  if (session.phase === 'rows') return numPhase(session, input, 'rows', 'Enter the number of columns', 'cols');
  if (session.phase === 'cols') return numPhase(session, input, 'cols', 'Specify the distance between rows', 'rowgap');
  if (session.phase === 'rowgap') return numPhase(session, input, 'rowgap', 'Specify the distance between columns', 'colgap');
  if (session.phase !== 'colgap') return done();
  const cols = input.kind === 'number' ? input.value : NaN;
  if (!(cols > 0)) return fail(session, prompt('Specify the distance between columns', 'number'), 'Requires a positive distance.');
  const rows = session.extra[0] || 1;
  const colCount = session.extra[1] || 1;
  const rowGap = session.extra[2] || 0;
  const source = session.ids.map((id) => model.entity(id)).find((entity): entity is DrawEntity => Boolean(entity));
  if (!source) return done(['Nothing selected.']);
  add(model, session, {
    type: 'array',
    kind: 'rect',
    source: structuredClone(source),
    rows: Math.round(rows),
    cols: Math.round(colCount),
    rowGap,
    colGap: cols,
    path: [],
    count: Math.round(rows * colCount),
    center: { x: 0, y: 0, z: 0 },
    fillAngle: 0,
    associative: true,
  });
  model.emit();
  return done([`Rectangular array ${Math.round(rows)} x ${Math.round(colCount)}.`]);
}

function collect(session: Session, _model: DrawingModel, input: SessionInput, head: string, phase: string, expect: PromptSpec['expect']): SessionResult {
  if (input.kind === 'picked') {
    session.ids = [...new Set([...session.ids, ...input.ids])];
    return show(session, prompt('Select objects', 'select'));
  }
  if (input.kind !== 'empty') return fail(session, prompt('Select objects', 'select'), 'Select objects, or press Enter.');
  if (session.ids.length === 0) return done(['Nothing selected.']);
  return show({ ...session, phase }, prompt(head, expect));
}

function numPhase(session: Session, input: SessionInput, key: string, head: string, phase: string): SessionResult {
  const value = input.kind === 'number' ? input.value : NaN;
  if (!Number.isFinite(value)) return fail(session, prompt(head, 'number'), 'Requires a number.');
  session.extra = [...session.extra, value];
  void key;
  return show({ ...session, phase }, prompt(head, 'number'));
}

function arrayPath(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'select') return collect(session, model, input, 'Select the path curve', 'path', 'select');
  if (session.phase === 'path') {
    const hit = picked(input);
    if (!hit) return fail(session, prompt('Select the path curve', 'select'), 'Select a curve.');
    session.aux = hit.id;
    return show({ ...session, phase: 'count' }, prompt('Enter the number of items', 'number', [], '4'));
  }
  const count = input.kind === 'number' ? input.value : input.kind === 'empty' ? 4 : NaN;
  const pathEntity = model.entity(session.aux);
  const source = model.entity(session.ids[0]);
  if (!pathEntity || !source || !(count >= 1)) return done(['Cannot build that path array.']);
  add(model, session, {
    type: 'array',
    kind: 'path',
    source: structuredClone(source),
    rows: 1,
    cols: Math.round(count),
    rowGap: 0,
    colGap: 0,
    path: entityPath(pathEntity, 16).map(xyz),
    count: Math.round(count),
    center: { x: 0, y: 0, z: 0 },
    fillAngle: 0,
    associative: true,
  });
  model.emit();
  return done(['Path array created.']);
}

function arrayPolar(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'select') return collect(session, model, input, 'Specify center point of array', 'center', 'point');
  if (session.phase === 'center' && input.kind === 'point') return show({ ...session, phase: 'count', pts: [input.point] }, prompt('Enter the number of items', 'number', [], '6'));
  if (session.phase === 'count') {
    const count = input.kind === 'number' ? input.value : input.kind === 'empty' ? 6 : NaN;
    if (!(count >= 1)) return fail(session, prompt('Enter the number of items', 'number'), 'Requires a positive count.');
    return show({ ...session, phase: 'fill', n: count }, prompt('Specify the angle to fill', 'number', [], '360'));
  }
  const angle = input.kind === 'number' ? input.value : input.kind === 'empty' ? 360 : NaN;
  const source = model.entity(session.ids[0]);
  if (!source || !Number.isFinite(angle)) return done(['Nothing selected.']);
  add(model, session, {
    type: 'array',
    kind: 'polar',
    source: structuredClone(source),
    rows: 1,
    cols: Math.round(session.n),
    rowGap: 0,
    colGap: 0,
    path: [],
    count: Math.round(session.n),
    center: session.pts[0],
    fillAngle: (angle * Math.PI) / 180,
    associative: true,
  });
  model.emit();
  return done(['Polar array created.']);
}

function arrayEdit(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'select') {
    const hit = picked(input);
    const entity = hit ? model.entity(hit.id) : null;
    if (!entity || entity.type !== 'array') return fail(session, prompt('Select associative array', 'select'), 'Select an associative array.');
    return show({ ...session, phase: 'edit', aux: entity.id }, prompt('Enter an option', 'any', ['Rows', 'Columns', 'Count', 'Associative']));
  }
  const entity = model.entity(session.aux);
  if (!entity || entity.type !== 'array') return done(['Array is gone.']);
  if (session.phase === 'edit' && input.kind === 'keyword') {
    session.phase = input.name.toLowerCase();
    return show(session, prompt(`Enter new ${input.name}`, 'number'));
  }
  if (input.kind !== 'number' && !(session.phase === 'associative')) return fail(session, prompt('Enter an option', 'any', ['Rows', 'Columns', 'Count']), 'Enter an option.');
  mark(session, model);
  const value = input.kind === 'number' ? input.value : 0;
  if (session.phase === 'rows') entity.rows = Math.max(1, Math.round(value));
  if (session.phase === 'columns') entity.cols = Math.max(1, Math.round(value));
  if (session.phase === 'count') entity.count = Math.max(1, Math.round(value));
  model.replace(entity);
  model.emit();
  return done(['Array updated.']);
}

function brk(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'select') {
    const hit = picked(input);
    if (!hit) return fail(session, prompt('Select object', 'select'), 'Select an object.');
    session.aux = hit.id;
    session.pts = [hit.at];
    if (session.command === 'BREAKATPOINT') return finishBreak(session, model, hit.at, hit.at);
    return show({ ...session, phase: 'p2' }, prompt('Specify second break point', 'point'));
  }
  if (input.kind !== 'point') return fail(session, prompt('Specify second break point', 'point'), 'Point required.');
  return finishBreak(session, model, session.pts[0], input.point);
}

function finishBreak(session: Session, model: DrawingModel, a: Vec3, b: Vec3): SessionResult {
  const entity = model.entity(session.aux);
  if (!entity) return done(['Object is gone.']);
  const path = entityPath(entity, 32).map(xyz);
  const length = splineLength(path);
  const da = distanceAlong(path, a);
  const db = distanceAlong(path, b);
  const parts = session.command === 'BREAKATPOINT' || Math.hypot(a.x - b.x, a.y - b.y) < 1e-6
    ? [sliceTo(path, 0, da), sliceTo(path, da, length)]
    : breakPolyline(path, da, db);
  const useful = parts.filter((part) => part.length >= 2);
  if (useful.length === 0) return done(['Cannot break that object.']);
  mark(session, model);
  model.remove([entity.id]);
  for (const part of useful) {
    model.add({ id: model.nextId(), type: 'polyline', ...style(model), closed: false, vertices: part.map((p) => ({ ...pt(p), bulge: 0 })) });
  }
  model.emit();
  return done(['Object broken.']);
}

function distanceAlong(path: Xyz[], point: Vec3): number {
  let best = 0;
  let bestD = Infinity;
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const span = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.min(1, Math.max(0, ((point.x - path[i - 1].x) * dx + (point.y - path[i - 1].y) * dy) / len2));
    const x = path[i - 1].x + dx * t;
    const y = path[i - 1].y + dy * t;
    const dist = Math.hypot(point.x - x, point.y - y);
    if (dist < bestD) {
      bestD = dist;
      best = walked + span * t;
    }
    walked += span;
  }
  return best;
}

function sliceTo(path: Xyz[], start: number, end: number): Xyz[] {
  const a = pointAtDistance(path, start);
  const b = pointAtDistance(path, end);
  if (!a || !b) return [];
  return [xyz(a.point), xyz(b.point)];
}

function lengthen(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'mode' && input.kind === 'keyword') {
    session.aux = input.name.toLowerCase();
    const head = input.name.toLowerCase().startsWith('p') ? 'Enter percentage length' : input.name.toLowerCase().startsWith('t') ? 'Specify total length' : 'Enter delta length';
    return show({ ...session, phase: 'value' }, prompt(head, 'number'));
  }
  if (session.phase === 'mode' && input.kind === 'picked') {
    session.aux = 'delta';
    session.ids = [input.ids[0]];
    return show({ ...session, phase: 'value' }, prompt('Enter delta length', 'number'));
  }
  if (session.phase === 'value') {
    const value = input.kind === 'number' ? input.value : NaN;
    if (!Number.isFinite(value)) return fail(session, prompt('Enter a length', 'number'), 'Requires a number.');
    session.n = value;
    if (session.ids.length === 0) return show({ ...session, phase: 'select' }, prompt('Select object to change', 'select'));
    return applyLength(session, model, session.ids[0]);
  }
  const hit = picked(input);
  if (!hit) return input.kind === 'empty' ? done() : fail(session, prompt('Select object to change', 'select'), 'Select an object.');
  return applyLength(session, model, hit.id);
}

function applyLength(session: Session, model: DrawingModel, id: string): SessionResult {
  const entity = model.entity(id);
  if (!entity) return done(['Object is gone.']);
  const path = entityPath(entity, 24).map(xyz);
  const mode = session.aux;
  const next = mode.startsWith('p') ? lengthenPercent(path, session.n) : mode.startsWith('t') ? lengthenTotal(path, session.n) : lengthenByDelta(path, session.n);
  mark(session, model);
  if (entity.type === 'line' && next.length >= 2) model.replace({ ...entity, a: pt(next[0]), b: pt(next[next.length - 1]) });
  else if (entity.type === 'polyline') model.replace({ ...entity, vertices: next.map((p) => ({ ...pt(p), bulge: 0 })) });
  else model.replace({ ...entity });
  model.emit();
  return show(session, prompt('Select object to change', 'select'), ['Length updated.']);
}

function align(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'select') return collect(session, model, input, 'Specify first source point', 's1', 'point');
  if (input.kind !== 'point' && session.phase !== 'scale') {
    if (input.kind === 'empty' && session.pts.length >= 2) return show({ ...session, phase: 'scale' }, prompt('Scale objects based on alignment points?', 'any', ['Yes', 'No'], 'No'));
    return fail(session, prompt('Specify a point', 'point'), 'Point required.');
  }
  if (session.phase === 'scale') {
    const scale = kw(input, 'Yes');
    const pairs = pairPoints(session.pts);
    const transform = alignTransform(pairs, scale);
    if (!transform) return done(['Not enough points.']);
    mark(session, model);
    for (const id of session.ids) {
      const entity = model.entity(id);
      if (!entity) continue;
      const moved = mapPoints(entity, (p) => pt(applyAlign(p, transform)));
      if (moved) model.replace(moved);
    }
    model.emit();
    return done(['Objects aligned.']);
  }
  session.pts.push(input.kind === 'point' ? input.point : session.pts[0]);
  const heads = ['Specify first destination point', 'Specify second source point', 'Specify second destination point', 'Specify third source point or'];
  const phase = ['d1', 's2', 'd2', 's3'][session.pts.length - 1] ?? 'scale';
  if (session.pts.length >= 4) return show({ ...session, phase: 'scale' }, prompt('Scale objects based on alignment points?', 'any', ['Yes', 'No'], 'No'));
  return show({ ...session, phase }, prompt(heads[session.pts.length - 1] ?? 'Specify next point', 'point'));
}

function pairPoints(points: Vec3[]): { from: Xyz; to: Xyz }[] {
  const pairs = [];
  for (let i = 0; i + 1 < points.length; i += 2) pairs.push({ from: points[i], to: points[i + 1] });
  return pairs;
}

function mapPoints(entity: DrawEntity, fn: (p: Vec3) => Vec3): DrawEntity | null {
  if (entity.type === 'line') return { ...entity, a: fn(entity.a), b: fn(entity.b) };
  if (entity.type === 'point' || entity.type === 'text') return { ...entity, p: fn(entity.p) };
  if (entity.type === 'polyline') return { ...entity, vertices: entity.vertices.map((vertex) => ({ ...fn(vertex), bulge: vertex.bulge })) };
  if (entity.type === 'circle' || entity.type === 'arc') return { ...entity, center: fn(entity.center) };
  return null;
}

function reverse(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (input.kind === 'picked') {
    session.ids = [...new Set([...session.ids, ...input.ids])];
    return show(session, prompt('Select objects', 'select'));
  }
  if (input.kind !== 'empty') return fail(session, prompt('Select objects', 'select'), 'Select objects.');
  mark(session, model);
  for (const id of session.ids) {
    const entity = model.entity(id);
    if (!entity) continue;
    if (entity.type === 'line') model.replace({ ...entity, a: entity.b, b: entity.a });
    if (entity.type === 'polyline') model.replace({ ...entity, vertices: reversePoints(entity.vertices) });
    if (entity.type === 'spline') model.replace({ ...entity, points: reversePoints(entity.points) });
  }
  model.emit();
  return done(['Direction reversed.']);
}

interface PeditSnap {
  entities: DrawEntity[];
  added: string[];
}

const peditUndo: PeditSnap[] = [];
const peditTangents = new Map<string, (number | null)[]>();

function resetPeditUndo(): void {
  peditUndo.length = 0;
  peditTangents.clear();
}

function rememberPedit(model: DrawingModel, ids: string[]): PeditSnap {
  const snap: PeditSnap = {
    entities: ids.flatMap((id) => {
      const entity = model.entity(id);
      return entity ? [structuredClone(entity)] : [];
    }),
    added: [],
  };
  peditUndo.push(snap);
  return snap;
}

function undoPedit(model: DrawingModel): boolean {
  const snap = peditUndo.pop();
  if (!snap) return false;
  if (snap.added.length > 0) model.remove(snap.added);
  for (const entity of snap.entities) {
    if (model.entity(entity.id)) model.replace(structuredClone(entity));
    else model.add(structuredClone(entity));
  }
  model.emit();
  return true;
}

function peditIds(session: Session): string[] {
  return session.flag ? session.ids : session.aux ? [session.aux] : [];
}

function peditPrompt(session: Session, model: DrawingModel): PromptSpec | null {
  const polys = peditIds(session)
    .map((id) => model.entity(id))
    .filter((entity): entity is DrawPolyline => entity?.type === 'polyline');
  if (polys.length === 0) return null;
  const keywords = [
    ...(polys.some((poly) => !poly.closed) ? ['Close'] : []),
    ...(polys.some((poly) => poly.closed) ? ['Open'] : []),
    'Join',
    'Width',
    ...(session.flag ? [] : ['Edit vertex']),
    'Fit',
    'Spline',
    'Decurve',
    'Ltype gen',
    'Reverse',
    'Undo',
    'eXit',
  ];
  return prompt('Enter an option', 'any', keywords);
}

function peditStay(session: Session, model: DrawingModel, messages: string[]): SessionResult {
  const current = peditPrompt(session, model);
  if (!current) return done(messages);
  return show({ ...session, phase: 'edit' }, current, messages);
}

function absorbPedit(session: Session, model: DrawingModel, ids: string[]): { ids: string[]; converted: number } {
  const keep: string[] = [];
  const convert: DrawEntity[] = [];
  for (const id of ids) {
    const entity = model.entity(id);
    if (!entity || !entityChain(entity)) continue;
    keep.push(entity.id);
    if (entity.type !== 'polyline') convert.push(entity);
  }
  if (convert.length > 0) {
    rememberPedit(model, convert.map((entity) => entity.id));
    mark(session, model);
    for (const entity of convert) {
      const chain = entityChain(entity);
      if (chain) model.replace(asPolyline(entity, chain));
    }
    model.emit();
  }
  return { ids: keep, converted: convert.length };
}

function mutatePolys(session: Session, model: DrawingModel, fn: (poly: DrawPolyline) => DrawEntity | null): number {
  const planned = peditIds(session).flatMap((id) => {
    const entity = model.entity(id);
    if (entity?.type !== 'polyline') return [];
    const next = fn(entity);
    return next ? [{ next }] : [];
  });
  if (planned.length === 0) return 0;
  rememberPedit(model, planned.map((item) => item.next.id));
  mark(session, model);
  for (const item of planned) model.replace(item.next);
  model.emit();
  return planned.length;
}

function applyPeditJoin(session: Session, model: DrawingModel, ids: string[], fuzz: number): string {
  const chains: JoinChain[] = [];
  for (const id of [...new Set(ids)]) {
    const entity = model.entity(id);
    if (!entity) continue;
    const chain = entityChain(entity);
    if (!chain || chain.vertices.length < 2) continue;
    chains.push({ id: entity.id, vertices: chain.vertices, closed: chain.closed });
  }
  if (chains.length === 0) return 'Nothing to join.';
  if (!chains.some((chain) => !chain.closed)) return 'Cannot join a closed polyline.';
  rememberPedit(model, chains.map((chain) => chain.id));
  mark(session, model);
  const pool = chains.map((chain) => ({ ...chain, vertices: chain.vertices.map((vertex) => ({ ...vertex })) }));
  const survivors: string[] = [];
  let joined = 0;
  while (pool.length > 0) {
    const base = pool.shift()!;
    if (base.closed) {
      survivors.push(base.id);
      continue;
    }
    const result = joinChains(base.vertices, false, pool, fuzz);
    const entity = model.entity(base.id);
    if (entity?.type === 'polyline') model.replace({ ...entity, vertices: result.vertices, closed: result.closed });
    else if (entity) model.replace(asPolyline(entity, { vertices: result.vertices, closed: result.closed }));
    if (result.consumed.length > 0) {
      model.remove(result.consumed);
      joined += result.consumed.length;
      const drop = new Set(result.consumed);
      for (let index = pool.length - 1; index >= 0; index -= 1) if (drop.has(pool[index].id)) pool.splice(index, 1);
    }
    survivors.push(base.id);
  }
  model.emit();
  if (session.flag) {
    session.ids = survivors;
    session.aux = survivors[0] ?? '';
  }
  return joined > 0 ? `${joined} joined.` : 'No objects joined.';
}

function pedit(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (kw(input, 'eXit') && session.phase !== 'vertex' && !session.phase.startsWith('v')) return done(['PEDIT complete.']);
  if (session.phase === 'select') {
    if (kw(input, 'Multiple')) return show({ ...session, phase: 'multi', ids: [] }, prompt('Select objects', 'select'));
    if (input.kind === 'empty') return done(['Nothing selected.']);
    const hit = picked(input);
    const entity = hit ? model.entity(hit.id) : null;
    if (!entity || !entityChain(entity)) return fail(session, prompt('Select polyline or', 'select', ['Multiple']), 'Select a polyline, line, or arc.');
    const absorbed = absorbPedit(session, model, [entity.id]);
    session.aux = absorbed.ids[0] ?? entity.id;
    session.ids = [session.aux];
    session.flag = false;
    session.n2 = 0;
    const current = peditPrompt(session, model);
    if (!current) return done(['Nothing selected.']);
    return show({ ...session, phase: 'edit' }, current, absorbed.converted ? ['Object converted to a polyline.'] : []);
  }
  if (session.phase === 'multi') {
    if (input.kind === 'picked') {
      session.ids = [...new Set([...session.ids, ...input.ids])];
      return show(session, prompt('Select objects', 'select'));
    }
    if (input.kind !== 'empty') return fail(session, prompt('Select objects', 'select'), 'Select objects, or press Enter.');
    if (session.ids.length === 0) return done(['Nothing selected.']);
    return show({ ...session, phase: 'fuzz' }, prompt('Enter fuzz distance', 'number', [], '0'));
  }
  if (session.phase === 'fuzz') {
    const fuzz = input.kind === 'number' ? input.value : input.kind === 'empty' ? 0 : NaN;
    if (!Number.isFinite(fuzz) || fuzz < 0) return fail(session, prompt('Enter fuzz distance', 'number', [], '0'), 'Requires a positive distance or zero.');
    const absorbed = absorbPedit(session, model, session.ids);
    if (absorbed.ids.length === 0) return done(['No polyline, line, or arc selected.']);
    session.n2 = fuzz;
    session.flag = true;
    session.ids = absorbed.ids;
    session.aux = absorbed.ids[0] ?? '';
    const current = peditPrompt(session, model);
    if (!current) return done(['No polyline, line, or arc selected.']);
    const messages = absorbed.converted > 0 ? [`${absorbed.converted} converted to polylines.`] : [];
    return show({ ...session, phase: 'edit' }, current, messages);
  }
  if (session.phase === 'join') {
    if (input.kind === 'picked') {
      session.ids = [...new Set([...session.ids, ...input.ids.filter((id) => id !== session.aux)])];
      return show(session, prompt('Select objects', 'select'));
    }
    if (input.kind !== 'empty') return fail(session, prompt('Select objects', 'select'), 'Select objects, or press Enter.');
    const absorbed = absorbPedit(session, model, session.ids);
    const message = applyPeditJoin(session, model, [session.aux, ...absorbed.ids], session.n2);
    session.phase = 'edit';
    return peditStay(session, model, [message]);
  }
  if (session.phase === 'width') {
    const value = input.kind === 'number' ? input.value : input.kind === 'empty' ? 0 : NaN;
    if (!Number.isFinite(value) || value < 0) return fail(session, prompt('Specify new width for all segments', 'number', [], '0'), 'Requires a width of zero or more.');
    const count = mutatePolys(session, model, (poly) => ({ ...poly, width: value, globalWidth: value }));
    return peditStay(session, model, [count > 0 ? 'Width updated.' : 'Polyline is gone.']);
  }
  if (session.phase === 'ltype') {
    if (!kw(input, 'ON') && !kw(input, 'OFF')) return fail(session, prompt('Enter polyline linetype generation option', 'any', ['ON', 'OFF']), 'Enter ON or OFF.');
    const enabled = kw(input, 'ON');
    mutatePolys(session, model, (poly) => ({ ...poly, linetypeGeneration: enabled }));
    return peditStay(session, model, [`Linetype generation ${enabled ? 'on' : 'off'}.`]);
  }
  if (session.phase === 'vertex' || session.phase.startsWith('v')) return peditVertex(session, model, input);
  if (input.kind === 'empty' || kw(input, 'eXit')) return done(['PEDIT complete.']);
  if (kw(input, 'Undo')) {
    if (!undoPedit(model)) return fail(session, peditPrompt(session, model) ?? prompt('Enter an option', 'any'), 'Nothing to undo.');
    return peditStay(session, model, ['Undo.']);
  }
  if (kw(input, 'Close') || kw(input, 'Open')) {
    const closing = kw(input, 'Close');
    const count = mutatePolys(session, model, (poly) => (poly.closed === closing ? null : { ...poly, closed: closing }));
    return peditStay(session, model, [count > 0 ? (closing ? 'Polyline closed.' : 'Polyline opened.') : closing ? 'Already closed.' : 'Already open.']);
  }
  if (kw(input, 'Width')) return show({ ...session, phase: 'width' }, prompt('Specify new width for all segments', 'number', [], '0'));
  if (kw(input, 'Join')) {
    if (!session.flag) {
      const entity = model.entity(session.aux);
      if (entity?.type === 'polyline' && entity.closed) {
        const current = peditPrompt(session, model);
        return fail(session, current ?? prompt('Enter an option', 'any'), 'Cannot join a closed polyline.');
      }
      return show({ ...session, phase: 'join', ids: [] }, prompt('Select objects', 'select'));
    }
    return peditStay(session, model, [applyPeditJoin(session, model, session.ids, session.n2)]);
  }
  if (kw(input, 'Fit')) {
    const count = mutatePolys(session, model, (poly) => ({ ...poly, vertices: fitPolyline(poly.vertices, poly.closed, peditTangents.get(poly.id)) }));
    return peditStay(session, model, [count > 0 ? 'Fit curve applied.' : 'Polyline is gone.']);
  }
  if (kw(input, 'Spline')) {
    const count = mutatePolys(session, model, (poly) => ({
      id: poly.id,
      type: 'spline',
      layer: poly.layer,
      color: poly.color,
      mode: 'fit',
      points: fitSpline(poly.vertices, 8, poly.closed).map(xyz),
      closed: poly.closed,
      degree: 3,
    }));
    return done([count > 0 ? 'Polyline fit to a spline.' : 'Polyline is gone.']);
  }
  if (kw(input, 'Decurve')) {
    const count = mutatePolys(session, model, (poly) => {
      peditTangents.delete(poly.id);
      return { ...poly, vertices: zeroBulges(poly.vertices) };
    });
    return peditStay(session, model, [count > 0 ? 'Bulges removed.' : 'Polyline is gone.']);
  }
  if (kw(input, 'Ltype gen')) return show({ ...session, phase: 'ltype' }, prompt('Enter polyline linetype generation option', 'any', ['ON', 'OFF']));
  if (kw(input, 'Reverse')) {
    const count = mutatePolys(session, model, (poly) => ({ ...poly, vertices: reversePolyline(poly.vertices, poly.closed) }));
    return peditStay(session, model, [count > 0 ? 'Polyline reversed.' : 'Polyline is gone.']);
  }
  if (kw(input, 'Edit vertex') && !session.flag) {
    session.n = 0;
    session.extra = [];
    return show({ ...session, phase: 'vertex' }, prompt('Enter a vertex editing option', 'any', ['Next', 'Previous', 'Break', 'Insert', 'Move', 'Straighten', 'Tangent', 'Width', 'eXit']));
  }
  const current = peditPrompt(session, model);
  if (!current) return done(['Polyline is gone.']);
  return fail(session, current, 'Enter an option.');
}

function peditVertex(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  const entity = model.entity(session.aux);
  if (!entity || entity.type !== 'polyline' || entity.vertices.length < 2) return done(['Polyline is gone.']);
  const count = entity.vertices.length;
  const vertexPrompt = prompt(`Enter a vertex editing option (${Math.min(session.n, count - 1) + 1})`, 'any', ['Next', 'Previous', 'Break', 'Insert', 'Move', 'Straighten', 'Tangent', 'Width', 'eXit']);
  const back = (): SessionResult => show({ ...session, phase: 'vertex' }, vertexPrompt);
  if (session.phase === 'vmove') {
    if (input.kind !== 'point') return fail(session, prompt('Specify new location for vertex', 'point'), 'Point required.');
    rememberPedit(model, [entity.id]);
    mark(session, model);
    model.replace({ ...entity, vertices: moveVertex(entity.vertices, session.n, input.point) });
    model.emit();
    return show({ ...session, phase: 'vertex' }, vertexPrompt, ['Vertex moved.']);
  }
  if (session.phase === 'vinsert') {
    if (input.kind !== 'point') return fail(session, prompt('Specify location for new vertex', 'point'), 'Point required.');
    rememberPedit(model, [entity.id]);
    mark(session, model);
    model.replace({ ...entity, vertices: insertVertex(entity.vertices, session.n, input.point) });
    model.emit();
    session.n += 1;
    return show({ ...session, phase: 'vertex' }, prompt(`Enter a vertex editing option (${session.n + 1})`, 'any', ['Next', 'Previous', 'Break', 'Insert', 'Move', 'Straighten', 'Tangent', 'Width', 'eXit']), ['Vertex inserted.']);
  }
  if (session.phase === 'vwidth') {
    const start = input.kind === 'number' ? input.value : input.kind === 'empty' ? 0 : NaN;
    if (!Number.isFinite(start) || start < 0) return fail(session, prompt('Specify starting width', 'number', [], '0'), 'Requires a width of zero or more.');
    session.extra = [session.extra[0] ?? 0, start];
    return show({ ...session, phase: 'vwidth2' }, prompt('Specify ending width', 'number', [], String(start)));
  }
  if (session.phase === 'vwidth2') {
    const end = input.kind === 'number' ? input.value : input.kind === 'empty' ? (session.extra[1] ?? 0) : NaN;
    if (!Number.isFinite(end) || end < 0) return fail(session, prompt('Specify ending width', 'number'), 'Requires a width of zero or more.');
    rememberPedit(model, [entity.id]);
    mark(session, model);
    model.replace({ ...entity, vertices: setSegmentWidth(entity.vertices, session.n, session.extra[1] ?? 0, end) });
    model.emit();
    return show({ ...session, phase: 'vertex' }, vertexPrompt, ['Segment width updated.']);
  }
  if (session.phase === 'vtangent') {
    const degrees = input.kind === 'number' ? input.value : NaN;
    if (!Number.isFinite(degrees)) return fail(session, prompt('Specify direction of vertex tangent', 'number'), 'Requires an angle.');
    const list = peditTangents.get(entity.id) ?? Array.from({ length: count }, () => null);
    while (list.length < count) list.push(null);
    list[session.n] = (degrees * Math.PI) / 180;
    peditTangents.set(entity.id, list);
    return show({ ...session, phase: 'vertex' }, vertexPrompt, ['Tangent set. Fit uses it.']);
  }
  if (session.phase === 'vbreak' || session.phase === 'vstraight') {
    const straight = session.phase === 'vstraight';
    const menu = prompt(straight ? 'Specify second straighten point or' : 'Specify second break point or', 'any', ['Next', 'Previous', 'Go', 'eXit']);
    if (kw(input, 'eXit')) return back();
    if (kw(input, 'Next') || kw(input, 'Previous')) {
      const step = kw(input, 'Next') ? 1 : -1;
      const cursor = session.extra[0] ?? session.n;
      session.extra = [(cursor + step + count) % count, session.extra[1] ?? 0];
      return show(session, menu);
    }
    if (!kw(input, 'Go') && input.kind !== 'empty') return fail(session, menu, 'Enter Next, Previous, Go, or eXit.');
    const from = session.n;
    const to = session.extra[0] ?? session.n;
    if (straight) {
      rememberPedit(model, [entity.id]);
      mark(session, model);
      model.replace({ ...entity, vertices: straightenRange(entity.vertices, from, to) });
      model.emit();
      session.n = Math.min(from, to);
      return show({ ...session, phase: 'vertex' }, prompt(`Enter a vertex editing option (${session.n + 1})`, 'any', ['Next', 'Previous', 'Break', 'Insert', 'Move', 'Straighten', 'Tangent', 'Width', 'eXit']), ['Straightened.']);
    }
    const broken = breakPolylineAt(entity.vertices, from, to, entity.closed);
    if (!broken) return fail(session, menu, 'Cannot break at that vertex.');
    const snap = rememberPedit(model, [entity.id]);
    mark(session, model);
    model.replace({ ...entity, vertices: broken.primary, closed: broken.closed });
    if (broken.extra && broken.extra.length >= 2) {
      const extraId = model.nextId();
      model.add({ ...entity, id: extraId, vertices: broken.extra, closed: false });
      snap.added.push(extraId);
    }
    model.emit();
    session.n = 0;
    return show({ ...session, phase: 'vertex' }, prompt('Enter a vertex editing option (1)', 'any', ['Next', 'Previous', 'Break', 'Insert', 'Move', 'Straighten', 'Tangent', 'Width', 'eXit']), ['Break complete.']);
  }
  if (input.kind === 'empty' || kw(input, 'eXit')) return peditStay(session, model, []);
  if (kw(input, 'Next') || kw(input, 'Previous')) {
    session.n = (session.n + (kw(input, 'Next') ? 1 : -1) + count) % count;
    return show(session, prompt(`Enter a vertex editing option (${session.n + 1})`, 'any', ['Next', 'Previous', 'Break', 'Insert', 'Move', 'Straighten', 'Tangent', 'Width', 'eXit']));
  }
  if (kw(input, 'Move')) return show({ ...session, phase: 'vmove' }, prompt('Specify new location for vertex', 'point'));
  if (kw(input, 'Insert')) return show({ ...session, phase: 'vinsert' }, prompt('Specify location for new vertex', 'point'));
  if (kw(input, 'Width')) return show({ ...session, phase: 'vwidth' }, prompt('Specify starting width', 'number', [], '0'));
  if (kw(input, 'Tangent')) return show({ ...session, phase: 'vtangent' }, prompt('Specify direction of vertex tangent', 'number'));
  if (kw(input, 'Break') || kw(input, 'Straighten')) {
    session.extra = [session.n, 0];
    const straight = kw(input, 'Straighten');
    return show({ ...session, phase: straight ? 'vstraight' : 'vbreak' }, prompt(straight ? 'Specify second straighten point or' : 'Specify second break point or', 'any', ['Next', 'Previous', 'Go', 'eXit']));
  }
  return fail(session, vertexPrompt, 'Enter a vertex editing option.');
}

function splinedit(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'select') {
    const hit = picked(input);
    const entity = hit ? model.entity(hit.id) : null;
    if (!entity || entity.type !== 'spline') return fail(session, prompt('Select spline', 'select'), 'Select a spline.');
    return show({ ...session, phase: 'edit', aux: entity.id }, prompt('Enter an option', 'any', ['Close', 'Reverse', 'Convert']));
  }
  const entity = model.entity(session.aux);
  if (!entity || entity.type !== 'spline') return done(['Spline is gone.']);
  mark(session, model);
  if (kw(input, 'Close')) model.replace({ ...entity, closed: true });
  else if (kw(input, 'Reverse')) model.replace({ ...entity, points: reversePoints(entity.points) });
  else if (kw(input, 'Convert')) {
    const sampled = (entity.mode === 'cv' ? cvSpline(entity.points, 8, entity.closed) : fitSpline(entity.points, 8, entity.closed)).map((p) => ({ ...pt(p), bulge: 0 }));
    model.replace({ id: entity.id, type: 'polyline', layer: entity.layer, color: entity.color, closed: entity.closed, vertices: sampled });
  } else return fail(session, prompt('Enter an option', 'any', ['Close', 'Reverse', 'Convert']), 'Enter an option.');
  model.emit();
  return done(['Spline edited.']);
}

function chspace(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (input.kind === 'picked') {
    session.ids = [...new Set([...session.ids, ...input.ids])];
    return show(session, prompt('Select objects to change space', 'select'));
  }
  if (input.kind !== 'empty') return fail(session, prompt('Select objects to change space', 'select'), 'Select objects.');
  const library = ensureLibrary(model.doc);
  mark(session, model);
  const paper = new Set(library.paperIds);
  for (const id of session.ids) {
    if (paper.has(id)) paper.delete(id);
    else paper.add(id);
  }
  library.paperIds = [...paper];
  model.emit();
  return done([`${session.ids.length} changed space. Paper-space objects are hidden in the model.`]);
}

function overkill(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (input.kind === 'picked') {
    session.ids = [...new Set([...session.ids, ...input.ids])];
    return show(session, prompt('Select objects', 'select'));
  }
  if (input.kind !== 'empty' && session.phase === 'select') return fail(session, prompt('Select objects', 'select'), 'Select objects.');
  if (session.phase === 'select') return show({ ...session, phase: 'tol' }, prompt('Enter numeric fuzz distance', 'number', [], '0'));
  const tol = input.kind === 'number' ? input.value : input.kind === 'empty' ? 0 : NaN;
  const lines = session.ids.map((id) => model.entity(id)).filter((entity): entity is DrawLine => entity?.type === 'line');
  const keep = new Set(overkillIndexes(lines.map((line) => ({ a: line.a, b: line.b })), Number.isFinite(tol) ? tol : 0).map((index) => lines[index].id));
  mark(session, model);
  const drop = lines.filter((line) => !keep.has(line.id)).map((line) => line.id);
  model.remove(drop);
  model.emit();
  return done([`${drop.length} duplicate objects deleted.`]);
}

function drawOrder(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'select') {
    if (input.kind === 'picked') {
      session.ids = [...new Set([...session.ids, ...input.ids])];
      return show(session, prompt('Select objects', 'select'));
    }
    if (input.kind !== 'empty') return fail(session, prompt('Select objects', 'select'), 'Select objects.');
    return show({ ...session, phase: 'mode' }, prompt('Enter object ordering option', 'any', ['Front', 'Back', 'Above', 'Under']));
  }
  if (kw(input, 'Above') || kw(input, 'Under')) return show({ ...session, phase: kw(input, 'Above') ? 'above' : 'under' }, prompt('Select reference object', 'select'));
  if (session.phase === 'above' || session.phase === 'under') {
    const hit = picked(input);
    if (!hit) return fail(session, prompt('Select reference object', 'select'), 'Select an object.');
    reorder(model, session, session.phase === 'above' ? 'above' : 'below', hit.id);
    return done(['Draw order updated.']);
  }
  if (kw(input, 'Front') || kw(input, 'Back')) {
    reorder(model, session, kw(input, 'Front') ? 'front' : 'back');
    return done(['Draw order updated.']);
  }
  return fail(session, prompt('Enter object ordering option', 'any', ['Front', 'Back', 'Above', 'Under']), 'Enter an option.');
}

function reorder(model: DrawingModel, session: Session, mode: 'front' | 'back' | 'above' | 'below', target?: string): void {
  mark(session, model);
  const order = moveDrawOrder(session.ids, model.doc.entities.map((entity) => entity.id), mode, target);
  const byId = new Map(model.doc.entities.map((entity) => [entity.id, entity]));
  model.doc.entities = order.flatMap((id) => {
    const entity = byId.get(id);
    return entity ? [entity] : [];
  });
  model.emit();
}

function bringFront(model: DrawingModel, types: string[]): SessionResult {
  const ids = model.doc.entities.filter((entity) => types.includes(entity.type)).map((entity) => entity.id);
  const session = blank('DRAWORDER', 'done');
  reorder(model, session, 'front');
  session.ids = ids;
  reorder(model, session, 'front');
  return done([`${ids.length} brought to front.`]);
}

function sendBack(model: DrawingModel, types: string[]): SessionResult {
  const ids = model.doc.entities.filter((entity) => types.includes(entity.type)).map((entity) => entity.id);
  const session = blank('DRAWORDER', 'done');
  session.ids = ids;
  reorder(model, session, 'back');
  return done([`${ids.length} sent to back.`]);
}

function selectSimilar(model: DrawingModel): SessionResult {
  const seeds = model.doc.selection.map((id) => model.entity(id)).filter((entity): entity is DrawEntity => Boolean(entity));
  if (seeds.length === 0) return done(['Select a source object first.']);
  model.doc.selection = similarEntities(model.doc, seeds);
  model.emit();
  return done([`${model.doc.selection.length} found.`]);
}

function textStyle(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  const library = ensureLibrary(model.doc);
  if (session.phase === 'name') {
    const name = input.kind === 'text' ? input.text : input.kind === 'empty' ? 'Standard' : '';
    if (!name) return fail(session, prompt('Enter text style name', 'text'), 'Enter a name.');
    return show({ ...session, phase: 'font', aux: name }, prompt('Enter font name', 'text', [], 'IBM Plex Sans'));
  }
  if (session.phase === 'font') {
    session.extra = [];
    return show({ ...session, phase: 'height', n: 0, aux: `${session.aux}|${input.kind === 'text' ? input.text : 'IBM Plex Sans'}` }, prompt('Specify height', 'number', [], '0'));
  }
  if (session.phase === 'height') {
    const height = input.kind === 'number' ? input.value : 0;
    return show({ ...session, phase: 'width', n: height }, prompt('Specify width factor', 'number', [], '1'));
  }
  if (session.phase === 'width') {
    const width = input.kind === 'number' ? input.value : 1;
    return show({ ...session, phase: 'oblique', n2: width }, prompt('Specify oblique angle', 'number', [], '0'));
  }
  const oblique = input.kind === 'number' ? input.value : input.kind === 'empty' ? 0 : NaN;
  if (!Number.isFinite(oblique)) return fail(session, prompt('Specify oblique angle', 'number'), 'Requires a number.');
  const [name, font] = session.aux.split('|');
  const existing = library.textStyles.find((item) => item.name.toLowerCase() === name.toLowerCase());
  const record = { name, font: font || 'IBM Plex Sans', height: session.n, widthFactor: session.n2 || 1, oblique };
  if (existing) Object.assign(existing, record);
  else library.textStyles.push(record);
  library.currentTextStyle = name;
  model.emit();
  return done([`Style "${name}" saved.`]);
}

function mtext(session: Session, model: DrawingModel, settings: CadSettings, input: SessionInput): SessionResult {
  if (session.phase === 'a') {
    if (input.kind !== 'point') return done();
    return show({ ...session, phase: 'b', pts: [input.point] }, prompt('Specify opposite corner', 'point'));
  }
  if (session.phase === 'b') {
    if (input.kind !== 'point') return fail(session, prompt('Specify opposite corner', 'point'), 'Point required.');
    const width = Math.max(1, Math.abs(input.point.x - session.pts[0].x));
    return show({ ...session, phase: 'text', n: width, n2: settings.textHeight }, prompt('Enter text. Use \\P for a new line', 'text'), [], [{ type: 'dialog', dialog: 'mtext' }]);
  }
  if (input.kind !== 'text' || !input.text.trim()) return done();
  const content = input.text;
  const record = add(model, session, {
    type: 'mtext',
    p: session.pts[0],
    width: session.n,
    height: session.n2 || settings.textHeight,
    rotation: 0,
    content,
    style: ensureLibrary(model.doc).currentTextStyle,
    attachment: 1,
  }) as DrawMText;
  void record;
  model.emit();
  return done(['MTEXT created.']);
}

function dimension(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.command === 'DIM' && session.phase === 'select') {
    if (kw(input, 'Linear')) return show(blank('DIMLINEAR', 'p1'), prompt(dimHead('DIMLINEAR'), 'point', ['Select object']));
    if (kw(input, 'Aligned')) return show(blank('DIMALIGNED', 'p1'), prompt(dimHead('DIMALIGNED'), 'point', ['Select object']));
    if (kw(input, 'Radius')) return show(blank('DIMRADIUS', 'p1'), prompt(dimHead('DIMRADIUS'), 'point'));
    if (kw(input, 'Diameter')) return show(blank('DIMDIAMETER', 'p1'), prompt(dimHead('DIMDIAMETER'), 'point'));
    const hit = picked(input);
    if (!hit) return fail(session, prompt('Select objects or', 'select', ['Linear', 'Aligned', 'Radius', 'Diameter']), 'Select geometry.');
    const entity = model.entity(hit.id);
    if (!entity) return done();
    if (entity.type === 'circle' || entity.type === 'arc') return show(blank(entity.type === 'arc' ? 'DIMARC' : 'DIMRADIUS', 'loc'), prompt('Specify dimension line location', 'point'), []);
    if (entity.type === 'line') {
      const next = blank('DIMALIGNED', 'loc');
      next.pts = [entity.a, entity.b];
      next.ids = [entity.id];
      return show(next, prompt('Specify dimension line location', 'point'));
    }
    return fail(session, prompt('Select objects', 'select'), 'Select a line, arc, or circle.');
  }
  if (kw(input, 'Select object') || (session.phase === 'p1' && input.kind === 'picked')) {
    const hit = picked(input);
    const entity = hit ? model.entity(hit.id) : null;
    if (!entity) return fail(session, prompt('Select object', 'select'), 'Select an object.');
    if (entity.type === 'line') {
      session.pts = [entity.a, entity.b];
      session.ids = [entity.id];
      session.aux = 'line';
      return show({ ...session, phase: 'loc' }, prompt('Specify dimension line location', 'point'));
    }
    if (entity.type === 'circle' || entity.type === 'arc') {
      session.pts = [entity.type === 'arc' ? pointOn(entity, 0.5) : v3(entity.center.x + entity.radius, entity.center.y, entity.center.z), entity.center];
      session.ids = [entity.id];
      session.aux = entity.type;
      const command = session.command === 'DIM' ? (entity.type === 'arc' ? 'DIMARC' : 'DIMRADIUS') : session.command;
      return show({ ...session, command, phase: 'loc' }, prompt('Specify dimension line location', 'point'));
    }
    return fail(session, prompt('Select object', 'select'), 'Select a line, arc, or circle.');
  }
  if (input.kind !== 'point') return input.kind === 'empty' ? done() : fail(session, prompt('Specify a point', 'point'), 'Point required.');
  session.pts.push(input.point);
  if (session.phase === 'p1') return show({ ...session, phase: 'p2' }, prompt('Specify second extension line origin', 'point'));
  if (session.phase === 'p2' && needsThird(session.command)) return show({ ...session, phase: 'p3' }, prompt('Specify the vertex or dimension line location', 'point'));
  return commitDim(session, model, input.point);
}

function needsThird(command: string): boolean {
  return command === 'DIMANGULAR';
}

function pointOn(entity: { center: Vec3; radius: number; startAngle: number; endAngle: number }, t: number): Vec3 {
  const sweep = entity.endAngle - entity.startAngle;
  const angle = entity.startAngle + sweep * t;
  return v3(entity.center.x + Math.cos(angle) * entity.radius, entity.center.y + Math.sin(angle) * entity.radius, entity.center.z);
}

function kindOf(command: string): DimKind {
  if (command === 'DIMALIGNED') return 'aligned';
  if (command === 'DIMANGULAR') return 'angular';
  if (command === 'DIMARC') return 'arc';
  if (command === 'DIMRADIUS') return 'radius';
  if (command === 'DIMDIAMETER') return 'diameter';
  if (command === 'DIMJOGGED') return 'jogged';
  if (command === 'DIMORDINATE') return 'ordinate';
  if (command === 'DIMJOGLINE') return 'jogged-linear';
  return 'linear';
}

function commitDim(session: Session, model: DrawingModel, loc: Vec3): SessionResult {
  const library = ensureLibrary(model.doc);
  const kind = kindOf(session.command);
  let p1 = session.pts[0];
  let p2 = session.pts[1] ?? session.pts[0];
  let p3 = session.pts[2] ?? session.pts[1] ?? session.pts[0];
  if (session.aux === 'circle' || session.aux === 'arc' || kind === 'radius' || kind === 'diameter' || kind === 'jogged' || kind === 'arc') {
    p3 = session.pts[1] ?? p1;
    p1 = session.pts[0];
    p2 = session.pts[0];
  }
  const horizontal = kind === 'ordinate' ? Math.abs(loc.x - p1.x) >= Math.abs(loc.y - p1.y) : Math.abs(loc.y - (p1.y + p2.y) / 2) >= Math.abs(loc.x - (p1.x + p2.x) / 2);
  const measurement = measureDimension({ kind, p1, p2, p3, loc, horizontal });
  const offset = kind === 'linear' || kind === 'aligned' ? signedOffset(p1, kind === 'linear' && !horizontal ? { x: p1.x, y: p2.y, z: p1.z } : p2, loc) : signedOffset(p1, p2, loc);
  const assoc = session.ids[0]
    ? kind === 'radius' || kind === 'diameter' || kind === 'jogged' || kind === 'arc'
      ? [{ id: session.ids[0], role: 'center' as const }]
      : [{ id: session.ids[0], role: 'start' as const }, ...(session.ids[0] ? [{ id: session.ids[0], role: 'end' as const }] : [])]
    : [];
  const entity = add(model, session, {
    type: 'dimension',
    layer: library.dimLayer || model.doc.currentLayer,
    kind,
    style: library.currentDimStyle,
    p1, p2, p3, loc,
    text: '',
    textAngle: 0,
    oblique: 0,
    measurement,
    horizontal,
    jog: kind === 'jogged',
    inspection: null,
    breaks: [],
    overrides: {},
    assoc,
    offset,
    justify: 'center',
    civil: '',
    textShift: null,
  }) as DrawDimension;
  library.lastDimId = entity.id;
  const style = effectiveDimStyle(library, entity.style, entity.overrides);
  model.emit();
  return done([formatDimension(entity, style)]);
}

function qdim(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'select') {
    if (input.kind === 'picked') {
      session.ids = [...new Set([...session.ids, ...input.ids])];
      return show(session, prompt('Select geometry to dimension', 'select'));
    }
    if (input.kind !== 'empty') return fail(session, prompt('Select geometry', 'select'), 'Select objects.');
    return show({ ...session, phase: 'loc' }, prompt('Specify dimension line position', 'point'));
  }
  if (input.kind !== 'point') return fail(session, prompt('Specify dimension line position', 'point'), 'Point required.');
  let count = 0;
  for (const id of session.ids) {
    const entity = model.entity(id);
    if (!entity || entity.type !== 'line') continue;
    const child = blank('DIMALIGNED', 'loc');
    child.pts = [entity.a, entity.b];
    child.ids = [id];
    child.checked = session.checked;
    commitDim(child, model, input.point);
    session.checked = true;
    count += 1;
  }
  return done([`${count} dimensions placed.`]);
}

function dimChain(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  const library = ensureLibrary(model.doc);
  const previous = model.entity(library.lastDimId);
  if (!previous || previous.type !== 'dimension') return done(['No previous dimension.']);
  if (input.kind !== 'point') return input.kind === 'empty' ? done() : fail(session, prompt('Specify a second extension line origin', 'point'), 'Point required.');
  const spacing = dimScaleOf(dimStyleByName(library, previous.style), library.annotationScale) * dimStyleByName(library, previous.style).dimdli;
  const spec = session.command === 'DIMBASELINE' ? baselineFrom(previous, input.point, spacing) : continueFrom(previous, input.point);
  const child = blank(spec.kind === 'aligned' ? 'DIMALIGNED' : 'DIMLINEAR', 'loc');
  child.pts = [spec.p1, spec.p2];
  child.checked = session.checked;
  const result = commitDim(child, model, { ...spec.p1, x: spec.p1.x, y: spec.p1.y + spec.offset });
  return show(blank(session.command, 'next'), prompt('Specify a second extension line origin', 'point'), result.messages);
}

function selectedDims(model: DrawingModel, ids: string[]): DrawDimension[] {
  return ids.map((id) => model.entity(id)).filter((entity): entity is DrawDimension => entity?.type === 'dimension');
}

function dimSpace(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'select') {
    if (input.kind === 'picked') {
      session.ids = [...new Set([...session.ids, ...input.ids])];
      return show(session, prompt('Select dimensions', 'select'));
    }
    return show({ ...session, phase: 'gap' }, prompt('Enter spacing value or', 'number', ['Auto'], 'Auto'));
  }
  const library = ensureLibrary(model.doc);
  const dims = selectedDims(model, session.ids);
  const gap = input.kind === 'number' ? input.value : dimStyleByName(library, library.currentDimStyle).dimdli;
  mark(session, model);
  spaceDimensions(dims, gap);
  model.emit();
  return done(['Dimensions spaced.']);
}

function dimBreak(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  const hit = picked(input);
  const entity = hit ? model.entity(hit.id) : null;
  if (!entity || entity.type !== 'dimension') return fail(session, prompt('Select dimension', 'select'), 'Select a dimension.');
  mark(session, model);
  entity.breaks = [0.45, 0.55];
  model.replace(entity);
  model.emit();
  return done(['Dimension broken.']);
}

function dimInspect(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'select') {
    const hit = picked(input);
    if (!hit || model.entity(hit.id)?.type !== 'dimension') return fail(session, prompt('Select dimension', 'select'), 'Select a dimension.');
    return show({ ...session, phase: 'label', aux: hit.id }, prompt('Enter inspection label', 'text', [], 'A'));
  }
  if (session.phase === 'label') {
    const label = input.kind === 'text' ? input.text : 'A';
    return show({ ...session, phase: 'rate', n: 0, aux: `${session.aux}|${label}` }, prompt('Enter inspection rate', 'text', [], '100%'));
  }
  const rate = input.kind === 'text' ? input.text : '100%';
  const [id, label] = session.aux.split('|');
  const entity = model.entity(id);
  if (!entity || entity.type !== 'dimension') return done();
  mark(session, model);
  model.replace({ ...entity, inspection: { label, rate } });
  model.emit();
  return done(['Inspection data added.']);
}

function dimJog(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  const hit = picked(input);
  const entity = hit ? model.entity(hit.id) : null;
  if (!entity || entity.type !== 'dimension') return fail(session, prompt('Select dimension', 'select'), 'Select a dimension.');
  mark(session, model);
  model.replace({ ...entity, jog: !entity.jog, kind: entity.kind === 'linear' || entity.kind === 'aligned' ? 'jogged-linear' : entity.kind });
  model.emit();
  return done(['Jog toggled.']);
}

function dimOblique(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'select') {
    const hit = picked(input);
    if (!hit) return fail(session, prompt('Select dimension', 'select'), 'Select a dimension.');
    return show({ ...session, phase: 'angle', aux: hit.id }, prompt('Enter obliquing angle', 'number', [], '0'));
  }
  const angle = input.kind === 'number' ? input.value : NaN;
  const entity = model.entity(session.aux);
  if (!entity || entity.type !== 'dimension' || !Number.isFinite(angle)) return done(['Requires an angle.']);
  mark(session, model);
  model.replace({ ...entity, oblique: (angle * Math.PI) / 180 });
  model.emit();
  return done(['Oblique angle set.']);
}

function dimTedit(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'select') {
    const hit = picked(input);
    if (!hit) return fail(session, prompt('Select dimension', 'select'), 'Select a dimension.');
    if (session.aux === 'left' || session.aux === 'center' || session.aux === 'right') {
      const entity = model.entity(hit.id);
      if (!entity || entity.type !== 'dimension') return fail(session, prompt('Select dimension', 'select'), 'Select a dimension.');
      mark(session, model);
      model.replace({ ...entity, justify: session.aux });
      model.emit();
      return done([`Dimension text ${session.aux}.`]);
    }
    return show({ ...session, phase: 'edit', aux: hit.id }, prompt('Specify new location for dimension text or', 'point', ['Left', 'Center', 'Right', 'Angle']));
  }
  const entity = model.entity(session.aux);
  if (!entity || entity.type !== 'dimension') return done();
  mark(session, model);
  if (kw(input, 'Left') || kw(input, 'Center') || kw(input, 'Right')) {
    const justify = input.kind === 'keyword' ? (input.name.toLowerCase() as 'left' | 'center' | 'right') : 'center';
    model.replace({ ...entity, justify });
  } else if (kw(input, 'Angle')) return show(session, prompt('Specify angle for dimension text', 'number'));
  else if (input.kind === 'number') model.replace({ ...entity, textAngle: (input.value * Math.PI) / 180 });
  else if (input.kind === 'point') model.replace({ ...entity, textShift: { along: input.point.x - entity.loc.x, across: input.point.y - entity.loc.y } });
  else return fail(session, prompt('Specify new location for dimension text or', 'point', ['Left', 'Center', 'Right', 'Angle']), 'Point or option keyword required.');
  model.emit();
  return done(['Dimension text updated.']);
}

function dimOverride(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'var') {
    const name = input.kind === 'text' ? input.text.trim() : '';
    if (!name) return fail(session, prompt('Enter dimension variable name', 'text'), 'Enter a variable such as DIMDEC or DIMTXT.');
    return show({ ...session, phase: 'value', aux: name.toLowerCase() }, prompt('Enter new value', 'text'));
  }
  if (session.phase === 'value') {
    session.n = input.kind === 'number' ? input.value : Number(input.kind === 'text' ? input.text : NaN);
    session.aux = `${session.aux}|${input.kind === 'text' ? input.text : input.kind === 'number' ? input.value : ''}`;
    return show({ ...session, phase: 'select' }, prompt('Select objects', 'select'));
  }
  if (input.kind === 'picked') {
    session.ids = [...new Set([...session.ids, ...input.ids])];
    return show(session, prompt('Select objects', 'select'));
  }
  if (input.kind !== 'empty') return fail(session, prompt('Select objects', 'select'), 'Select dimensions.');
  const [name, raw] = session.aux.split('|');
  const numeric = Number(raw);
  const value: string | number | boolean = Number.isFinite(numeric) && raw.trim() !== '' ? numeric : raw === 'true' ? true : raw === 'false' ? false : raw;
  mark(session, model);
  for (const id of session.ids) {
    const entity = model.entity(id);
    if (!entity || entity.type !== 'dimension') continue;
    model.replace({ ...entity, overrides: { ...entity.overrides, [name]: value } });
  }
  model.emit();
  return done([`${name} overridden.`]);
}

function dimReassoc(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'select') {
    const hit = picked(input);
    if (!hit || model.entity(hit.id)?.type !== 'dimension') return fail(session, prompt('Select dimension', 'select'), 'Select a dimension.');
    return show({ ...session, phase: 'geom', aux: hit.id }, prompt('Select object to associate', 'select'));
  }
  const hit = picked(input);
  const dim = model.entity(session.aux);
  const geom = hit ? model.entity(hit.id) : null;
  if (!dim || dim.type !== 'dimension' || !geom) return done(['Select a dimension and geometry.']);
  mark(session, model);
  model.replace({ ...dim, assoc: [{ id: geom.id, role: 'start' }, { id: geom.id, role: 'end' }] });
  model.emit();
  return done(['Dimension reassociated.']);
}

function dimStyleCmd(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (kw(input, 'Apply') || input.kind === 'empty') return show({ ...session, phase: 'select' }, prompt('Select objects', 'select'));
  if (kw(input, 'Save') || kw(input, 'Restore')) return show({ ...session, phase: 'save', aux: input.kind === 'keyword' ? input.name.toLowerCase() : 'save' }, prompt('Enter style name', 'text', [], ensureLibrary(model.doc).currentDimStyle));
  if (session.phase === 'save') {
    const library = ensureLibrary(model.doc);
    const name = input.kind === 'text' ? input.text : library.currentDimStyle;
    if (session.aux === 'restore') {
      if (!library.dimStyles.some((item) => item.name.toLowerCase() === name.toLowerCase())) return done([`Style "${name}" was not found.`]);
      library.currentDimStyle = name;
      model.emit();
      return done([`Style "${name}" restored.`]);
    }
    const current = dimStyleByName(library, library.currentDimStyle);
    const copy = { ...current, name };
    const index = library.dimStyles.findIndex((item) => item.name.toLowerCase() === name.toLowerCase());
    if (index >= 0) library.dimStyles[index] = copy;
    else library.dimStyles.push(copy);
    library.currentDimStyle = name;
    model.emit();
    return done([`Style "${name}" saved.`]);
  }
  if (input.kind === 'picked') {
    session.ids = [...new Set([...session.ids, ...input.ids])];
    return show(session, prompt('Select objects', 'select'));
  }
  const library = ensureLibrary(model.doc);
  mark(session, model);
  for (const id of session.ids) {
    const entity = model.entity(id);
    if (entity?.type === 'dimension') model.replace({ ...entity, style: library.currentDimStyle, overrides: {} });
  }
  model.emit();
  return done(['Current style applied.']);
}

function dimScale(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  const value = input.kind === 'number' ? input.value : NaN;
  if (!(value >= 0)) return fail(session, prompt('Enter overall dimension scale', 'number'), 'Enter zero or a positive scale. Zero uses the annotation scale.');
  const library = ensureLibrary(model.doc);
  const style = library.dimStyles.find((item) => item.name === library.currentDimStyle) ?? library.dimStyles[0];
  style.dimscale = value;
  model.emit();
  void standardDimStyle;
  return done([`DIMSCALE = ${value}.`]);
}

function dimLayer(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  const name = input.kind === 'text' ? input.text.trim() : input.kind === 'empty' ? '.' : '';
  if (!name) return fail(session, prompt('Enter dimension layer name or . for none', 'text'), 'Enter a layer name.');
  ensureLibrary(model.doc).dimLayer = name === '.' ? '' : name;
  model.emit();
  return done([name === '.' ? 'Dimension layer override cleared.' : `New dimensions use layer "${name}".`]);
}

function centers(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  const hit = picked(input);
  const entity = hit ? model.entity(hit.id) : null;
  if (!entity || (entity.type !== 'circle' && entity.type !== 'arc')) return fail(session, prompt('Select circle or arc', 'select'), 'Select a circle or arc.');
  if (session.command === 'CENTERLINE') {
    if (!session.aux) return show({ ...session, aux: entity.id }, prompt('Select second circle', 'select'));
    const first = model.entity(session.aux);
    if (!first || (first.type !== 'circle' && first.type !== 'arc')) return done();
    add(model, session, { type: 'centerline', center: first.center, size: 0, a: first.center, b: entity.center, assoc: [first.id, entity.id] });
    model.emit();
    return done(['Centerline created.']);
  }
  const library = ensureLibrary(model.doc);
  const size = Math.abs(dimStyleByName(library, library.currentDimStyle).dimcen) || entity.radius * 0.1;
  const markSize = dimStyleByName(library, library.currentDimStyle).dimcen < 0 ? entity.radius * 0.1 : size;
  add(model, session, {
    type: 'centermark',
    center: entity.center,
    size: markSize,
    a: v3(entity.center.x - markSize, entity.center.y, entity.center.z),
    b: v3(entity.center.x + markSize, entity.center.y, entity.center.z),
    assoc: [entity.id],
  });
  model.emit();
  return done(['Center mark created.']);
}

function mleader(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.command === 'MLEADER') {
    if (session.phase === 'tip' && input.kind === 'point') return show({ ...session, phase: 'land', pts: [input.point] }, prompt('Specify leader landing location', 'point'));
    if (session.phase === 'land' && input.kind === 'point') return show({ ...session, phase: 'text', pts: [...session.pts, input.point] }, prompt('Enter text', 'text'));
    if (session.phase === 'text' && input.kind === 'text') {
      const library = ensureLibrary(model.doc);
      add(model, session, { type: 'mleader', style: library.currentLeaderStyle, leaders: [session.pts.map(xyz)], text: input.text, textPos: session.pts[1], dogleg: library.leaderStyles[0]?.dogleg ?? 2 });
      model.emit();
      return done(['Multileader created.']);
    }
    return input.kind === 'empty' ? done() : fail(session, prompt('Specify a point', 'point'), 'Point or text required.');
  }
  if (session.phase === 'select') {
    const hit = picked(input);
    const entity = hit ? model.entity(hit.id) : null;
    if (!entity || entity.type !== 'mleader') return fail(session, prompt('Select a multileader', 'select'), 'Select a multileader.');
    if (session.command === 'MLEADERREMOVE') {
      mark(session, model);
      model.replace({ ...entity, leaders: entity.leaders.slice(0, -1) });
      model.emit();
      return done(['Leader removed.']);
    }
    if (session.command === 'MLEADERCOLLECT') {
      mark(session, model);
      const text = entity.leaders.map(() => entity.text).join('\\P');
      model.replace({ ...entity, text });
      model.emit();
      return done(['Leaders collected.']);
    }
    return show({ ...session, phase: 'point', aux: entity.id }, prompt(session.command === 'MLEADERALIGN' ? 'Specify alignment point' : 'Specify arrowhead location', 'point'));
  }
  if (input.kind !== 'point') return fail(session, prompt('Specify a point', 'point'), 'Point required.');
  const entity = model.entity(session.aux);
  if (!entity || entity.type !== 'mleader') return done();
  mark(session, model);
  if (session.command === 'MLEADERADD') model.replace({ ...entity, leaders: [...entity.leaders, [input.point, entity.textPos]] });
  else model.replace({ ...entity, textPos: input.point, leaders: entity.leaders.map((leader) => [leader[0] ?? input.point, input.point]) });
  model.emit();
  return done(['Multileader updated.']);
}

function table(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'csv' || kw(input, 'Import')) {
    if (kw(input, 'Import')) return show({ ...session, phase: 'csv' }, prompt('Paste CSV text', 'text'));
    if (input.kind !== 'text') return fail(session, prompt('Paste CSV text', 'text'), 'Paste comma-separated text.');
    const rows = input.text.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line) => line.split(','));
    const cols = Math.max(...rows.map((row) => row.length));
    return placeTable(session, model, rows.length, cols, rows.flat().map((cell) => cell.trim()));
  }
  if (session.phase === 'rows') {
    const rows = input.kind === 'number' ? input.value : input.kind === 'empty' ? 4 : NaN;
    if (!(rows >= 1)) return fail(session, prompt('Enter number of rows', 'number'), 'Requires a positive number.');
    return show({ ...session, phase: 'cols', n: rows }, prompt('Enter number of columns', 'number', [], '3'));
  }
  if (session.phase === 'cols') {
    const cols = input.kind === 'number' ? input.value : input.kind === 'empty' ? 3 : NaN;
    if (!(cols >= 1)) return fail(session, prompt('Enter number of columns', 'number'), 'Requires a positive number.');
    return show({ ...session, phase: 'point', n2: cols }, prompt('Specify insertion point', 'point'));
  }
  if (input.kind !== 'point') return fail(session, prompt('Specify insertion point', 'point'), 'Point required.');
  const rows = Math.round(session.n || 4);
  const cols = Math.round(session.n2 || 3);
  const cells = Array.from({ length: rows * cols }, (_, index) => (index < cols ? `Col ${index + 1}` : ''));
  return placeTable(session, model, rows, cols, cells, input.point);
}

function placeTable(session: Session, model: DrawingModel, rows: number, cols: number, cells: string[], at?: Vec3): SessionResult {
  if (!at) return show({ ...session, phase: 'point', n: rows, n2: cols, aux: JSON.stringify(cells) }, prompt('Specify insertion point', 'point'));
  const stored = session.aux ? (JSON.parse(session.aux) as string[]) : cells;
  const library = ensureLibrary(model.doc);
  add(model, session, { type: 'table', p: at, style: library.currentTableStyle, cols, rows, colWidth: 20, rowHeight: 6, cells: stored });
  model.emit();
  return done(['Table created.']);
}

function blocks(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  const library = ensureLibrary(model.doc);
  if (session.command === 'BLOCK') return blockDef(session, model, input);
  if (session.command === 'INSERT') return blockInsert(session, model, input);
  if (session.command === 'BEDIT') {
    const name = input.kind === 'text' ? input.text : '';
    const block = blockByName(library, name);
    if (!block) return done([`Block "${name}" was not found.`]);
    mark(session, model);
    const ids: string[] = [];
    for (const raw of block.entities) {
      const entity = parseCadEntity(raw) ?? parseLoose(raw);
      if (!entity) continue;
      const copy = { ...entity, id: model.nextId() };
      model.add(copy);
      ids.push(copy.id);
    }
    library.editing = { name: block.name, ids };
    model.emit();
    return done([`Editing "${block.name}". BCLOSE saves it.`]);
  }
  if (session.command === 'WBLOCK') {
    const name = input.kind === 'text' ? input.text : '';
    const block = blockByName(library, name);
    if (!block) return done([`Block "${name}" was not found.`]);
    const entities = blockLocalEntities(block, (raw) => parseStoredEntity(raw));
    const doc = { ...model.doc, entities };
    return done([`Wrote ${block.name}.`], [{ type: 'download', filename: `${block.name}.dxf`, text: drawingToDxf(doc), mime: 'application/dxf' }]);
  }
  if (session.command === 'ATTDEF') return attdef(session, model, input);
  return attedit(session, model, input);
}

function parseLoose(raw: object): DrawEntity | null {
  return parseStoredEntity(raw);
}

function blockDef(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'name') {
    const name = input.kind === 'text' ? input.text.trim() : '';
    if (!name) return fail(session, prompt('Enter block name', 'text'), 'Enter a name.');
    return show({ ...session, phase: 'base', aux: name }, prompt('Specify insertion base point', 'point'));
  }
  if (session.phase === 'base' && input.kind === 'point') return show({ ...session, phase: 'select', pts: [input.point] }, prompt('Select objects', 'select'));
  if (session.phase === 'select') {
    if (input.kind === 'picked') {
      session.ids = [...new Set([...session.ids, ...input.ids])];
      return show(session, prompt('Select objects', 'select'));
    }
    if (input.kind !== 'empty') return fail(session, prompt('Select objects', 'select'), 'Select objects.');
    return show({ ...session, phase: 'mode' }, prompt('What to do with the objects?', 'any', ['Retain', 'Convert', 'Delete'], 'Convert'));
  }
  const mode = kw(input, 'Retain') ? 'retain' : kw(input, 'Delete') ? 'delete' : 'convert';
  const entities = session.ids.map((id) => model.entity(id)).filter((entity): entity is DrawEntity => Boolean(entity));
  defineBlock(ensureLibrary(model.doc), session.aux, session.pts[0], entities);
  mark(session, model);
  if (mode === 'delete') model.remove(session.ids);
  if (mode === 'convert') {
    model.remove(session.ids);
    const attdefs = entities.filter((entity): entity is Extract<DrawEntity, { type: 'attdef' }> => entity.type === 'attdef');
    model.add({
      id: model.nextId(),
      type: 'insert',
      ...style(model),
      name: session.aux,
      p: session.pts[0],
      sx: 1,
      sy: 1,
      rotation: 0,
      attributes: insertAttributes(attdefs, session.pts[0], 0, 1, 1),
    });
  }
  model.emit();
  return done([`Block "${session.aux}" defined.`]);
}

function blockInsert(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  const library = ensureLibrary(model.doc);
  if (session.phase === 'name') {
    if (kw(input, '?')) return show(session, prompt('Enter block name or', 'text', ['?']), [library.blocks.map((block) => block.name).join(', ') || 'No blocks defined.']);
    const name = (input.kind === 'text' ? input.text : input.kind === 'empty' ? session.aux : '').trim();
    if (!blockByName(library, name)) return fail(session, prompt('Enter block name', 'text'), `Block "${name}" was not found.`);
    return show({ ...session, phase: 'point', aux: name }, prompt('Specify insertion point', 'point'));
  }
  if (session.phase === 'point' && input.kind === 'point') return show({ ...session, phase: 'scale', pts: [input.point] }, prompt('Enter X scale factor', 'number', [], '1'));
  if (session.phase === 'scale') {
    const scale = input.kind === 'number' ? input.value : input.kind === 'empty' ? 1 : NaN;
    if (!(scale !== 0) || !Number.isFinite(scale)) return fail(session, prompt('Enter X scale factor', 'number'), 'Scale must be non-zero.');
    return show({ ...session, phase: 'rot', n: scale }, prompt('Specify rotation angle', 'number', [], '0'));
  }
  const angle = input.kind === 'number' ? input.value : input.kind === 'empty' ? 0 : NaN;
  if (!Number.isFinite(angle)) return fail(session, prompt('Specify rotation angle', 'number'), 'Requires an angle.');
  const block = blockByName(library, session.aux);
  if (!block) return done(['Block is gone.']);
  const defs = block.entities.flatMap((raw) => {
    const entity = parseStoredEntity(raw);
    return entity?.type === 'attdef' ? [entity] : [];
  });
  const insert = add(model, session, {
    type: 'insert',
    name: block.name,
    p: session.pts[0],
    sx: session.n || 1,
    sy: session.n || 1,
    rotation: (angle * Math.PI) / 180,
    attributes: insertAttributes(defs, session.pts[0], (angle * Math.PI) / 180, session.n || 1, session.n || 1),
  });
  if (session.flag) {
    const pieces = explodeInsert(insert.type === 'insert' ? insert : { ...style(model), id: insert.id, type: 'insert', name: block.name, p: session.pts[0], sx: 1, sy: 1, rotation: 0, attributes: [] }, block, () => model.nextId(), (raw) => parseStoredEntity(raw));
    model.remove([insert.id]);
    for (const piece of pieces) model.add(piece);
  }
  model.emit();
  return done([`Inserted "${block.name}".`]);
}

function closeBlock(model: DrawingModel): SessionResult {
  const library = ensureLibrary(model.doc);
  const editing = library.editing;
  if (!editing) return done(['No block is open for edit.']);
  const entities = editing.ids.map((id) => model.entity(id)).filter((entity): entity is DrawEntity => Boolean(entity));
  const block = blockByName(library, editing.name);
  if (block) block.entities = entities.map((entity) => structuredClone(entity));
  model.checkpoint();
  model.remove(editing.ids);
  library.editing = null;
  model.emit();
  return done([`Block "${editing.name}" saved.`]);
}

function attdef(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'tag') {
    const tag = input.kind === 'text' ? input.text.trim() : '';
    if (!tag) return fail(session, prompt('Enter attribute tag', 'text'), 'Enter a tag.');
    return show({ ...session, phase: 'prompt', aux: tag }, prompt('Enter attribute prompt', 'text'));
  }
  if (session.phase === 'prompt') return show({ ...session, phase: 'default', aux: `${session.aux}|${input.kind === 'text' ? input.text : ''}` }, prompt('Enter default value', 'text'));
  if (session.phase === 'default') return show({ ...session, phase: 'point', aux: `${session.aux}|${input.kind === 'text' ? input.text : ''}` }, prompt('Specify start point', 'point'));
  if (session.phase === 'point' && input.kind === 'point') return show({ ...session, phase: 'height', pts: [input.point] }, prompt('Specify height', 'number', [], '2.5'));
  if (session.phase === 'height') {
    const height = input.kind === 'number' ? input.value : 2.5;
    const [tag, promptText, value] = session.aux.split('|');
    add(model, session, { type: 'attdef', tag, prompt: promptText, value, p: session.pts[0], height, rotation: 0, invisible: false, constant: false });
    model.emit();
    return done([`Attribute ${tag} defined.`]);
  }
  return fail(session, prompt('Enter text', 'text'), 'Enter a value.');
}

function attedit(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.phase === 'select') {
    const hit = picked(input);
    const entity = hit ? model.entity(hit.id) : null;
    if (!entity || entity.type !== 'insert') return fail(session, prompt('Select a block reference', 'select'), 'Select a block reference.');
    if (entity.attributes.length === 0) return done(['That block has no attributes.']);
    return show({ ...session, phase: 'tag', aux: entity.id }, prompt('Enter attribute tag', 'text', [], entity.attributes[0].tag));
  }
  if (session.phase === 'tag') {
    const tag = input.kind === 'text' ? input.text : input.kind === 'empty' ? '' : '';
    return show({ ...session, phase: 'value', n: 0, aux: `${session.aux}|${tag}` }, prompt('Enter new value', 'text'));
  }
  const value = input.kind === 'text' ? input.text : '';
  const [id, tag] = session.aux.split('|');
  const entity = model.entity(id);
  if (!entity || entity.type !== 'insert') return done();
  mark(session, model);
  model.replace({ ...entity, attributes: entity.attributes.map((attr) => (attr.tag.toLowerCase() === tag.toLowerCase() ? { ...attr, value } : attr)) });
  model.emit();
  return done([`${tag} = ${value}`]);
}

function purge(model: DrawingModel): SessionResult {
  const library = ensureLibrary(model.doc);
  const removed = purgeLibrary(library, usedBlockNames(model.doc.entities));
  model.emit();
  return done([removed.length === 0 ? 'Nothing to purge.' : `Purged ${removed.join(', ')}.`]);
}

function groups(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  const library = ensureLibrary(model.doc);
  if (session.command === 'GROUP') {
    if (session.phase === 'name') {
      if (kw(input, '?')) return show(session, prompt('Enter a group name', 'text'), [library.groups.map((group) => group.name).join(', ') || 'No groups.']);
      const name = input.kind === 'text' && input.text !== '*' ? input.text : `Group${library.groups.length + 1}`;
      return show({ ...session, phase: 'desc', aux: name }, prompt('Enter group description', 'text'));
    }
    if (session.phase === 'desc') return show({ ...session, phase: 'select', n: 0, aux: `${session.aux}|${input.kind === 'text' ? input.text : ''}` }, prompt('Select objects', 'select'));
    if (input.kind === 'picked') {
      session.ids = [...new Set([...session.ids, ...input.ids])];
      return show(session, prompt('Select objects', 'select'));
    }
    const [name, description] = session.aux.split('|');
    createGroup(library, name, session.ids, description);
    model.emit();
    return done([`Group "${name}" created.`]);
  }
  if (session.command === 'UNGROUP') {
    if (kw(input, 'Name')) return show({ ...session, phase: 'name' }, prompt('Enter group name', 'text'));
    if (session.phase === 'name' && input.kind === 'text') {
      return done([ungroup(library, input.text) ? `Group "${input.text}" removed.` : 'Group was not found.']);
    }
    const hit = picked(input);
    if (!hit) return input.kind === 'empty' ? done() : fail(session, prompt('Select grouped objects', 'select'), 'Select an object.');
    const group = library.groups.find((item) => item.ids.includes(hit.id));
    if (!group) return done(['That object is not in a group.']);
    ungroup(library, group.name);
    model.emit();
    return done([`Group "${group.name}" removed.`]);
  }
  if (session.phase === 'name') {
    const name = input.kind === 'text' ? input.text : '';
    if (!groupByName(library, name)) return done([`Group "${name}" was not found.`]);
    return show({ ...session, phase: 'mode', aux: name }, prompt('Enter an option', 'any', ['Add', 'Remove']));
  }
  if (session.phase === 'mode' && input.kind === 'keyword') return show({ ...session, phase: input.name.toLowerCase() }, prompt('Select objects', 'select'));
  if (input.kind === 'picked') {
    session.ids = [...new Set([...session.ids, ...input.ids])];
    return show(session, prompt('Select objects', 'select'));
  }
  const group = groupByName(library, session.aux);
  if (!group) return done();
  editGroup(group, session.phase === 'add' ? session.ids : [], session.phase === 'remove' ? session.ids : []);
  model.emit();
  return done([`Group "${group.name}" updated.`]);
}

function togglePick(model: DrawingModel): SessionResult {
  const library = ensureLibrary(model.doc);
  library.pickStyle = library.pickStyle === 0 ? 1 : 0;
  model.emit();
  return done([`Group selection ${library.pickStyle === 1 ? 'on' : 'off'}.`]);
}

function civilLabel(session: Session, model: DrawingModel, settings: CadSettings, input: SessionInput): SessionResult {
  if (session.command === 'SLOPELABEL') {
    const hit = picked(input);
    const entity = hit ? model.entity(hit.id) : null;
    if (!entity || entity.type !== 'line') return fail(session, prompt('Select a line', 'select'), 'Select a line.');
    const dx = entity.b.x - entity.a.x;
    const slope = Math.abs(dx) < 1e-9 ? 0 : ((entity.b.y - entity.a.y) / dx) * 100;
    add(model, session, { type: 'text', p: { x: (entity.a.x + entity.b.x) / 2, y: (entity.a.y + entity.b.y) / 2, z: entity.a.z }, height: settings.textHeight, rotation: Math.atan2(entity.b.y - entity.a.y, dx), content: `${slope.toFixed(2)}%` });
    model.emit();
    return done([`Slope ${slope.toFixed(2)}%.`]);
  }
  if (session.phase === 'base') {
    const hit = picked(input);
    const entity = hit ? model.entity(hit.id) : null;
    if (!entity || entity.type !== 'line') return fail(session, prompt('Select baseline', 'select'), 'Select a line.');
    return show({ ...session, phase: 'point', aux: entity.id }, prompt('Specify label point', 'point'));
  }
  if (input.kind !== 'point') return fail(session, prompt('Specify label point', 'point'), 'Point required.');
  const base = model.entity(session.aux);
  if (!base || base.type !== 'line') return done();
  const dx = base.b.x - base.a.x;
  const dy = base.b.y - base.a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = ((input.point.x - base.a.x) * dx + (input.point.y - base.a.y) * dy) / len2;
  const station = t * Math.hypot(dx, dy);
  const off = ((input.point.x - base.a.x) * -dy + (input.point.y - base.a.y) * dx) / Math.sqrt(len2);
  const sta = `${Math.floor(station / 1000)}+${(station % 1000).toFixed(2).padStart(6, '0')}`;
  add(model, session, { type: 'text', p: input.point, height: settings.textHeight, rotation: 0, content: `STA ${sta}  OFF ${off.toFixed(2)}` });
  model.emit();
  return done([`STA ${sta}  OFF ${off.toFixed(2)}`]);
}

function circles(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.command === 'CIRCLEDIA') {
    if (session.phase === 'center' && input.kind === 'point') return show({ ...session, phase: 'dia', pts: [input.point] }, prompt('Specify diameter of circle', 'number'));
    const diameter = input.kind === 'number' ? input.value : input.kind === 'point' ? Math.hypot(input.point.x - session.pts[0].x, input.point.y - session.pts[0].y) : NaN;
    if (!(diameter > 0)) return fail(session, prompt('Specify diameter of circle', 'number'), 'Diameter must be positive.');
    add(model, session, { type: 'circle', center: session.pts[0], radius: diameter / 2 });
    model.emit();
    return done();
  }
  if (session.command === 'CIRCLE2P' || session.command === 'CIRCLE3P') {
    if (input.kind !== 'point') return input.kind === 'empty' ? done() : fail(session, prompt('Specify a point', 'point'), 'Point required.');
    session.pts.push(input.point);
    const need = session.command === 'CIRCLE2P' ? 2 : 3;
    if (session.pts.length < need) return show(session, prompt(session.pts.length === 1 ? 'Specify second point' : 'Specify third point', 'point'));
    if (session.command === 'CIRCLE2P') {
      const a = session.pts[0];
      const b = session.pts[1];
      add(model, session, { type: 'circle', center: v3((a.x + b.x) / 2, (a.y + b.y) / 2, a.z), radius: Math.hypot(b.x - a.x, b.y - a.y) / 2 });
    } else {
      const built = circleFrom3(session.pts[0], session.pts[1], session.pts[2]);
      if (!built) return fail(session, prompt('Specify third point', 'point'), 'Points are colinear.');
      add(model, session, { type: 'circle', center: built.center, radius: built.radius });
    }
    model.emit();
    return done();
  }
  const hit = picked(input);
  if (session.phase === 'a' || session.phase === 'b' || session.phase === 'c') {
    if (!hit) return fail(session, prompt('Specify tangent line', 'select'), 'Select a line.');
    const entity = model.entity(hit.id);
    if (!entity || entity.type !== 'line') return fail(session, prompt('Specify tangent line', 'select'), 'Select a line.');
    session.ids.push(entity.id);
    session.pts.push(hit.at);
    if (session.command === 'CIRCLETTR' && session.ids.length < 2) return show({ ...session, phase: 'b' }, prompt('Specify second tangent line', 'select'));
    if (session.command === 'CIRCLETTR' && session.ids.length === 2) return show({ ...session, phase: 'r' }, prompt('Specify radius of circle', 'number'));
    if (session.command === 'CIRCLETTT' && session.ids.length < 3) return show({ ...session, phase: session.ids.length === 1 ? 'b' : 'c' }, prompt('Specify next tangent line', 'select'));
    if (session.command === 'CIRCLETTT') return commitTtt(session, model);
  }
  if (session.phase === 'r') {
    const radius = input.kind === 'number' ? input.value : NaN;
    const a = model.entity(session.ids[0]);
    const b = model.entity(session.ids[1]);
    if (!a || !b || a.type !== 'line' || b.type !== 'line' || !(radius > 0)) return done(['Radius must be positive.']);
    const built = circleTtr({ a: a.a, b: a.b }, { a: b.a, b: b.b }, radius, session.pts[0], session.pts[1]);
    if (!built) return done(['Those lines do not accept that radius.']);
    add(model, session, { type: 'circle', center: pt(built.center), radius: built.radius });
    model.emit();
    return done();
  }
  return fail(session, prompt('Specify tangent line', 'select'), 'Select a line.');
}

function commitTtt(session: Session, model: DrawingModel): SessionResult {
  const lines = session.ids.map((id) => model.entity(id)).filter((entity): entity is DrawLine => entity?.type === 'line');
  if (lines.length < 3) return done(['Select three lines.']);
  const built = circleTtt({ a: lines[0].a, b: lines[0].b }, { a: lines[1].a, b: lines[1].b }, { a: lines[2].a, b: lines[2].b });
  if (!built) return done(['Those lines are not a triangle.']);
  add(model, session, { type: 'circle', center: pt(built.center), radius: built.radius });
  model.emit();
  return done(['Tan-tan-tan circle created.']);
}

function circleFrom3(a: Vec3, b: Vec3, c: Vec3): { center: Vec3; radius: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { center: v3(x, y, a.z), radius: Math.hypot(x - a.x, y - a.y) };
}

function arcs(session: Session, model: DrawingModel, input: SessionInput): SessionResult {
  if (session.command === 'ARCCONT') {
    if (input.kind !== 'point') return input.kind === 'empty' ? done() : fail(session, prompt('Specify end point', 'point'), 'Point required.');
    const last = [...model.doc.entities].reverse().find((entity) => entity.type === 'line' || entity.type === 'arc');
    if (!last) return done(['No line or arc to continue.']);
    let start = v3(0, 0);
    let direction = 0;
    if (last.type === 'line') {
      start = last.b;
      direction = Math.atan2(last.b.y - last.a.y, last.b.x - last.a.x);
    } else {
      start = pointOn(last, 1);
      direction = last.endAngle + Math.PI / 2 * Math.sign(last.endAngle - last.startAngle || 1);
    }
    const built = arcFromStartEndDirection(start, input.point, direction);
    if (!built) return done(['Cannot continue that arc.']);
    add(model, session, { type: 'arc', ...built, center: pt(built.center) });
    model.emit();
    return done();
  }
  if (input.kind !== 'point' && input.kind !== 'number') return input.kind === 'empty' ? done() : fail(session, prompt('Specify a point', 'point'), 'Point or number required.');
  if (input.kind === 'point') session.pts.push(input.point);
  if (input.kind === 'number') session.n = input.value;
  const name = session.command;
  const need = arcNeeds(name, session);
  if (need) return show(session, prompt(need, need.includes('angle') || need.includes('length') || need.includes('radius') ? 'number' : 'point'));
  const built = buildArc(name, session);
  if (!built) return done(['Cannot build that arc.']);
  add(model, session, { type: 'arc', center: pt(built.center), radius: built.radius, startAngle: built.startAngle, endAngle: built.endAngle });
  model.emit();
  return done(['Arc created.']);
}

function arcNeeds(name: string, session: Session): string | null {
  const n = session.pts.length;
  if (name === 'ARCSEA' || name === 'ARCSED' || name === 'ARCSER') {
    if (n < 1) return 'Specify start point of arc';
    if (n < 2) return 'Specify end point of arc';
    if (session.n === 0 && name !== 'ARCSED') return name === 'ARCSEA' ? 'Specify included angle' : 'Specify radius of arc';
    if (name === 'ARCSED' && n < 3 && session.n === 0) return 'Specify tangent direction';
    return null;
  }
  if (name === 'ARCSCE' || name === 'ARCSCA' || name === 'ARCSCL') {
    if (n < 1) return 'Specify start point of arc';
    if (n < 2) return 'Specify center point of arc';
    if (name === 'ARCSCE' && n < 3) return 'Specify end point of arc';
    if (name !== 'ARCSCE' && session.n === 0) return name === 'ARCSCA' ? 'Specify included angle' : 'Specify chord length';
    return null;
  }
  if (n < 1) return 'Specify center point of arc';
  if (n < 2) return 'Specify start point of arc';
  if (name === 'ARCCSE' && n < 3) return 'Specify end point of arc';
  if (name !== 'ARCCSE' && session.n === 0) return name === 'ARCCSA' ? 'Specify included angle' : 'Specify chord length';
  return null;
}

function buildArc(name: string, session: Session): { center: Xy; radius: number; startAngle: number; endAngle: number } | null {
  const [a, b, c] = session.pts;
  const angle = (session.n * Math.PI) / 180;
  if (name === 'ARCSEA') return a && b ? arcFromStartEndAngle(a, b, angle || session.n) : null;
  if (name === 'ARCSED') return a && b && c ? arcFromStartEndDirection(a, b, Math.atan2(c.y - b.y, c.x - b.x)) : null;
  if (name === 'ARCSER') return a && b ? arcFromStartEndRadius(a, b, session.n) : null;
  if (name === 'ARCSCE') return a && b && c ? arcFromStartCenter(a, b, c) : null;
  if (name === 'ARCSCA') return a && b ? arcFromStartCenterAngle(a, b, angle) : null;
  if (name === 'ARCSCL') return a && b ? arcFromStartCenterLength(a, b, session.n) : null;
  if (name === 'ARCCSE') return a && b && c ? arcFromStartCenter(b, a, c) : null;
  if (name === 'ARCCSA') return a && b ? arcFromStartCenterAngle(b, a, angle) : null;
  if (name === 'ARCCSL') return a && b ? arcFromStartCenterLength(b, a, session.n) : null;
  return null;
}
