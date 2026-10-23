import { describe, expect, it } from 'vitest';
import { dimScaleOf, standardDimStyle } from './cadLibrary';
import { boundaryAtPoint, hatchLines, hatchRegions } from './hatch';
import { formatAlternate, formatDimension, formatPrimary, formatTolerance, measureDimension } from './dimension';
import { DrawingModel, drawingDocFromFile, moved, parseDrawing, v3 } from './drafting';
import { beginCommand, defaultSettings, stepCommand, type SessionInput, type SessionResult } from '../commands/session';

function point(x: number, y: number): SessionInput {
  return { kind: 'point', point: v3(x, y) };
}

function picked(id: string, x = 0, y = 0): SessionInput {
  return { kind: 'picked', ids: [id], window: null, crossing: false, at: v3(x, y) };
}

function run(command: string, inputs: SessionInput[], model = new DrawingModel()): { model: DrawingModel; result: SessionResult } {
  const settings = defaultSettings();
  let result = beginCommand(command, model, settings);
  for (const input of inputs) {
    if (!result.session) break;
    result = stepCommand(result.session, model, settings, input);
  }
  return { model, result };
}

describe('dimension measurement and styles', () => {
  const style = standardDimStyle();

  it('measures linear, aligned, radial, and angular geometry', () => {
    expect(measureDimension({ kind: 'linear', p1: v3(0, 0), p2: v3(10, 4), p3: v3(0, 0), loc: v3(5, 8), horizontal: true })).toBeCloseTo(10);
    expect(measureDimension({ kind: 'linear', p1: v3(0, 0), p2: v3(10, 4), p3: v3(0, 0), loc: v3(12, 2), horizontal: false })).toBeCloseTo(4);
    expect(measureDimension({ kind: 'aligned', p1: v3(0, 0), p2: v3(3, 4), p3: v3(0, 0), loc: v3(0, 0) })).toBeCloseTo(5);
    expect(measureDimension({ kind: 'radius', p1: v3(5, 0), p2: v3(0, 0), p3: v3(0, 0), loc: v3(8, 0) })).toBeCloseTo(5);
    expect(measureDimension({ kind: 'diameter', p1: v3(5, 0), p2: v3(0, 0), p3: v3(0, 0), loc: v3(8, 0) })).toBeCloseTo(10);
    const quarter = measureDimension({ kind: 'angular', p1: v3(1, 0), p2: v3(0, 1), p3: v3(0, 0), loc: v3(1, 1) });
    expect(quarter).toBeCloseTo(Math.PI / 2);
  });

  it('formats primary units, alternate units, tolerances, inspection, and civil labels', () => {
    const custom = { ...style, dimdec: 3, dimpost: '<> m', dimalt: true, dimaltf: 25.4, dimaltd: 1, dimtol: true, dimtp: 0.1, dimtm: 0.05, dimtdec: 2 };
    expect(formatPrimary(12.5, custom)).toBe('12.500 m');
    expect(formatAlternate(1, { ...custom, dimapost: '[] mm' })).toBe('25.4 mm');
    expect(formatTolerance(10, custom)).toContain('+0.10');
    expect(formatTolerance(10, custom)).toContain('-0.05');
    const text = formatDimension({ text: '', measurement: 12.5, kind: 'linear', inspection: { label: 'A', rate: '100%' }, civil: '' }, custom);
    expect(text.startsWith('A | 12.500 m')).toBe(true);
    expect(text).toContain('100%');
    expect(formatDimension({ text: '', measurement: Math.PI / 2, kind: 'angular', inspection: null, civil: '' }, style)).toBe('90.00°');
    expect(formatDimension({ text: '', measurement: 1000, kind: 'linear', inspection: null, civil: 'station' }, style)).toBe('STA 1000.00');
    expect(formatDimension({ text: '', measurement: 2.5, kind: 'linear', inspection: null, civil: 'slope' }, style)).toBe('2.50%');
  });

  it('scales annotative styles by the annotation scale and treats DIMSCALE 0 as 1', () => {
    expect(dimScaleOf({ ...style, dimscale: 2, annotative: false }, 4)).toBe(2);
    expect(dimScaleOf({ ...style, dimscale: 2, annotative: true }, 4)).toBe(8);
    expect(dimScaleOf({ ...style, dimscale: 0, annotative: false }, 4)).toBe(1);
  });

  it('updates an associative dimension when the source line changes', () => {
    const model = new DrawingModel();
    model.add({ id: 'e1', type: 'line', layer: '0', color: 'bylayer', a: v3(0, 0), b: v3(10, 0) });
    const { model: drawn } = run('DIMLINEAR', [picked('e1', 5, 0), point(5, 3)], model);
    const dim = drawn.doc.entities.find((entity) => entity.type === 'dimension');
    expect(dim?.type).toBe('dimension');
    if (dim?.type !== 'dimension') return;
    expect(dim.measurement).toBeCloseTo(10);
    const line = drawn.entity('e1');
    if (!line || line.type !== 'line') throw new Error('line missing');
    drawn.replace({ ...line, b: v3(25, 0) });
    drawn.emit();
    const updated = drawn.entity(dim.id);
    expect(updated?.type).toBe('dimension');
    if (updated?.type === 'dimension') expect(updated.measurement).toBeCloseTo(25);
    const shifted = drawn.entity('e1');
    if (shifted) drawn.replace(moved(shifted, 0, 4));
    drawn.emit();
    const followed = drawn.entity(dim.id);
    if (followed?.type === 'dimension') expect(followed.p1.y).toBeCloseTo(4);
  });
});

describe('home drafting commands', () => {
  it('finds a hatch boundary and its hole', () => {
    const outer = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const hole = [{ x: 2, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 4 }, { x: 2, y: 4 }];
    const inside = boundaryAtPoint([outer, hole], { x: 8, y: 8 });
    expect(inside?.outer).toBe(outer);
    expect(inside?.holes).toEqual([hole]);
    expect(inside?.islands).toEqual([]);
    const inHole = boundaryAtPoint([outer, hole], { x: 3, y: 3 });
    expect(inHole?.outer).toBe(hole);
    expect(inHole?.holes).toEqual([]);
    expect(inHole?.islands).toEqual([]);
  });

  it('detects hatch islands and clips holes exactly', () => {
    const outer = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }];
    const hole = [{ x: 5, y: 5 }, { x: 25, y: 5 }, { x: 25, y: 25 }, { x: 5, y: 25 }];
    const island = [{ x: 10, y: 10 }, { x: 15, y: 10 }, { x: 15, y: 15 }, { x: 10, y: 15 }];
    const at = boundaryAtPoint([outer, hole, island], { x: 1, y: 1 });
    expect(at?.outer).toBe(outer);
    expect(at?.holes).toEqual([hole]);
    expect(at?.islands).toEqual([island]);
    const inHole = boundaryAtPoint([outer, hole, island], { x: 7, y: 7 });
    expect(inHole?.outer).toBe(hole);
    expect(inHole?.holes).toEqual([island]);
    expect(inHole?.islands).toEqual([]);
    const inIsland = boundaryAtPoint([outer, hole, island], { x: 12, y: 12 });
    expect(inIsland?.outer).toBe(island);
    expect(inIsland?.holes).toEqual([]);
    const box = (x0: number, y0: number, x1: number, y1: number) => [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ];
    const lines = hatchLines({ outer: box(0, 0, 20, 20), holes: [box(6, 6, 14, 14)], islands: [box(8, 8, 12, 12)] }, 0, 2);
    const mid = lines.filter((line) => Math.abs(line.a.y - 10) < 0.2 && Math.abs(line.b.y - 10) < 0.2);
    const spans = mid.map((line) => [Math.min(line.a.x, line.b.x), Math.max(line.a.x, line.b.x)]).sort((a, b) => a[0] - b[0]);
    expect(spans.map((span) => [Math.round(span[0]), Math.round(span[1])])).toEqual([
      [0, 6],
      [8, 12],
      [14, 20],
    ]);
    const stored = hatchRegions([outer, hole, island], [1]);
    expect(stored?.holes).toEqual([hole]);
    expect(stored?.islands).toEqual([island]);
  });

  it('hatches the smallest closed polyline and keeps the boundary associative', () => {
    const model = new DrawingModel();
    model.add({ id: 'outer', type: 'polyline', layer: '0', color: 'bylayer', closed: true, vertices: [v3(0, 0), v3(10, 0), v3(10, 10), v3(0, 10)].map((p) => ({ ...p, bulge: 0 })) });
    model.add({ id: 'hole', type: 'polyline', layer: '0', color: 'bylayer', closed: true, vertices: [v3(2, 2), v3(4, 2), v3(4, 4), v3(2, 4)].map((p) => ({ ...p, bulge: 0 })) });
    const { model: hatched } = run('HATCH', [point(8, 8)], model);
    const hatch = hatched.doc.entities.find((entity) => entity.type === 'hatch');
    expect(hatch?.type).toBe('hatch');
    if (hatch?.type === 'hatch') {
      expect(hatch.pattern).toBe('ANSI31');
      expect(hatch.associative).toBe(true);
      expect(hatch.holes.length).toBeGreaterThan(0);
    }
  });

  it('draws an ellipse, a filleted rectangle, and breaks a line into two pieces', () => {
    const ellipse = run('ELLIPSE', [point(0, 0), point(10, 0), point(0, 4)]);
    expect(ellipse.model.doc.entities[0]?.type).toBe('ellipse');
    const rect = run('RECTANG', [{ kind: 'keyword', name: 'Fillet' }, { kind: 'number', value: 1 }, point(0, 0), point(12, 6)]);
    const poly = rect.model.doc.entities[0];
    expect(poly?.type).toBe('polyline');
    if (poly?.type === 'polyline') expect(poly.vertices.some((vertex) => vertex.bulge !== 0)).toBe(true);
    const model = new DrawingModel();
    model.add({ id: 'e1', type: 'line', layer: '0', color: 'bylayer', a: v3(0, 0), b: v3(10, 0) });
    const broken = run('BREAK', [picked('e1', 3, 0), point(7, 0)], model);
    expect(broken.model.doc.entities.filter((entity) => entity.type === 'polyline')).toHaveLength(2);
  });

  it('lengthens to a total, deletes a duplicate with overkill, and defines a block and a group', () => {
    const model = new DrawingModel();
    model.add({ id: 'e1', type: 'line', layer: '0', color: 'bylayer', a: v3(0, 0), b: v3(10, 0) });
    model.add({ id: 'dup', type: 'line', layer: '0', color: 'bylayer', a: v3(0, 0), b: v3(10, 0) });
    const longer = run('LENGTHEN', [{ kind: 'keyword', name: 'Total' }, { kind: 'number', value: 20 }, picked('e1', 1, 0)], model);
    const line = longer.model.entity('e1');
    expect(line?.type).toBe('line');
    if (line?.type === 'line') expect(Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y)).toBeCloseTo(20);
    const cleaned = run('OVERKILL', [picked('e1'), picked('dup'), { kind: 'empty' }, { kind: 'number', value: 0 }], longer.model);
    expect(cleaned.model.doc.entities.filter((entity) => entity.type === 'line')).toHaveLength(1);
    const blocked = run('BLOCK', [{ kind: 'text', text: 'Widget' }, point(0, 0), picked('e1'), { kind: 'empty' }, { kind: 'keyword', name: 'Retain' }], cleaned.model);
    expect(blocked.model.doc.library?.blocks.some((block) => block.name === 'Widget')).toBe(true);
    const grouped = run('GROUP', [{ kind: 'text', text: 'Pair' }, { kind: 'text', text: 'notes' }, picked('e1'), { kind: 'empty' }], blocked.model);
    expect(grouped.model.doc.library?.groups.some((group) => group.name === 'Pair')).toBe(true);
  });

  it('writes a block definition and its geometry into a WBLOCK dxf', () => {
    const model = new DrawingModel();
    model.add({ id: 'e1', type: 'line', layer: '0', color: 'bylayer', a: v3(5, 5), b: v3(15, 5) });
    const blocked = run('BLOCK', [{ kind: 'text', text: 'Widget' }, point(5, 5), picked('e1'), { kind: 'empty' }, { kind: 'keyword', name: 'Retain' }], model);
    const written = run('WBLOCK', [{ kind: 'text', text: 'Widget' }], blocked.model);
    const effect = written.result.effects.find((item) => item.type === 'download');
    expect(effect?.type).toBe('download');
    if (effect?.type !== 'download') return;
    expect(effect.text).toContain('Widget');
    const nameAt = effect.text.indexOf('\nWidget\n');
    const endAt = effect.text.indexOf('ENDBLK', nameAt);
    const definition = effect.text.slice(nameAt, endAt);
    expect(definition).toContain('LINE');
    expect(definition).toContain('\n10\n0\n');
    expect(definition).toContain('\n11\n10\n');
  });

  it('stores hatch islands separately from holes', () => {
    const model = new DrawingModel();
    const ring = (id: string, x0: number, y0: number, x1: number, y1: number) => {
      model.add({
        id,
        type: 'polyline',
        layer: '0',
        color: 'bylayer',
        closed: true,
        vertices: [v3(x0, y0), v3(x1, y0), v3(x1, y1), v3(x0, y1)].map((p) => ({ ...p, bulge: 0 })),
      });
    };
    ring('outer', 0, 0, 30, 30);
    ring('hole', 5, 5, 25, 25);
    ring('island', 10, 10, 15, 15);
    const { model: hatched } = run('HATCH', [point(1, 1)], model);
    const hatch = hatched.doc.entities.find((entity) => entity.type === 'hatch');
    expect(hatch?.type).toBe('hatch');
    if (hatch?.type !== 'hatch') return;
    expect(hatch.loops).toHaveLength(3);
    expect(hatch.holes).toEqual([1]);
    expect(hatch.sourceIds).toEqual(['outer', 'hole', 'island']);
  });

  it('joins, fits, reverses, and vertex-edits a polyline', () => {
    const model = new DrawingModel();
    model.add({ id: 'e1', type: 'line', layer: '0', color: 'bylayer', a: v3(0, 0), b: v3(10, 0) });
    model.add({ id: 'e2', type: 'line', layer: '0', color: 'bylayer', a: v3(10.2, 0), b: v3(20, 0) });
    const joined = run(
      'PEDIT',
      [{ kind: 'keyword', name: 'Multiple' }, picked('e1'), picked('e2'), { kind: 'empty' }, { kind: 'number', value: 0.5 }, { kind: 'keyword', name: 'Join' }],
      model,
    );
    const poly = joined.model.doc.entities.find((entity) => entity.type === 'polyline');
    expect(joined.model.doc.entities.filter((entity) => entity.type === 'line' || entity.type === 'polyline')).toHaveLength(1);
    expect(poly?.type).toBe('polyline');
    if (poly?.type !== 'polyline') return;
    expect(poly.vertices.map((vertex) => vertex.x)).toEqual([0, 10, 20]);

    const curved = new DrawingModel();
    curved.add({
      id: 'p1',
      type: 'polyline',
      layer: '0',
      color: 'bylayer',
      closed: false,
      vertices: [v3(0, 0), v3(10, 0), v3(10, 10)].map((p, index) => ({ ...p, bulge: index === 0 ? 1 : 0 })),
    });
    const edited = run(
      'PEDIT',
      [
        picked('p1'),
        { kind: 'keyword', name: 'Reverse' },
        { kind: 'keyword', name: 'Undo' },
        { kind: 'keyword', name: 'Ltype gen' },
        { kind: 'keyword', name: 'ON' },
        { kind: 'keyword', name: 'Width' },
        { kind: 'number', value: 2 },
        { kind: 'keyword', name: 'Edit vertex' },
        { kind: 'keyword', name: 'Width' },
        { kind: 'number', value: 1 },
        { kind: 'number', value: 3 },
        { kind: 'keyword', name: 'eXit' },
        { kind: 'keyword', name: 'Fit' },
        { kind: 'keyword', name: 'Close' },
      ],
      curved,
    );
    const fit = edited.model.entity('p1');
    expect(fit?.type).toBe('polyline');
    if (fit?.type !== 'polyline') return;
    expect(fit.linetypeGeneration).toBe(true);
    expect(fit.globalWidth).toBe(2);
    expect(fit.closed).toBe(true);
    expect(fit.vertices[0]?.bulge).not.toBe(0);
    expect(fit.vertices.some((vertex) => vertex.startWidth === 1 && vertex.endWidth === 3)).toBe(true);

    const open = new DrawingModel();
    open.add({
      id: 'p2',
      type: 'polyline',
      layer: '0',
      color: 'bylayer',
      closed: false,
      vertices: [v3(0, 0), v3(5, 0), v3(10, 0), v3(15, 0)].map((p) => ({ ...p, bulge: 0 })),
    });
    const broken = run(
      'PEDIT',
      [
        picked('p2'),
        { kind: 'keyword', name: 'Edit vertex' },
        { kind: 'keyword', name: 'Next' },
        { kind: 'keyword', name: 'Break' },
        { kind: 'keyword', name: 'Go' },
        { kind: 'keyword', name: 'eXit' },
        { kind: 'keyword', name: 'Decurve' },
        { kind: 'keyword', name: 'Spline' },
      ],
      open,
    );
    expect(broken.model.doc.entities.some((entity) => entity.type === 'spline')).toBe(true);
    expect(broken.model.doc.entities.filter((entity) => entity.type === 'polyline')).toHaveLength(1);
  });

  it('round-trips an ellipse, hatch, dimension, and block library', () => {
    const model = new DrawingModel();
    model.add({ id: 'e1', type: 'line', layer: '0', color: 'bylayer', a: v3(0, 0), b: v3(8, 0) });
    run('ELLIPSE', [point(0, 0), point(6, 0), point(0, 2)], model);
    run('DIMLINEAR', [picked('e1', 4, 0), point(4, 2)], model);
    const file = model.toFile();
    const restored = new DrawingModel();
    restored.load(drawingDocFromFile(parseDrawing(file)));
    expect(restored.doc.entities.some((entity) => entity.type === 'ellipse')).toBe(true);
    expect(restored.doc.entities.some((entity) => entity.type === 'dimension')).toBe(true);
    expect(restored.doc.library?.dimStyles[0]?.dimdec).toBe(2);
    expect(restored.doc.library?.currentDimStyle).toBe('Standard');
  });
});
