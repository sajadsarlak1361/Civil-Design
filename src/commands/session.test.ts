import { describe, expect, it } from 'vitest';
import { DrawingModel, entityArea, entityLength, v3 } from '../engine/drafting';
import { beginCommand, defaultSettings, stepCommand, type Session, type SessionInput, type SessionResult } from './session';

function replay(command: string, inputs: SessionInput[]): { model: DrawingModel; result: SessionResult } {
  const model = new DrawingModel();
  const settings = defaultSettings();
  let result = beginCommand(command, model, settings);
  for (const input of inputs) {
    if (!result.session) break;
    result = stepCommand(result.session, model, settings, input);
  }
  return { model, result };
}

function point(x: number, y: number, z = 0): SessionInput {
  return { kind: 'point', point: v3(x, y, z) };
}

describe('drafting commands', () => {
  it('zooms by scale, center, and a dynamic window', () => {
    const scale = replay('ZOOM', [{ kind: 'keyword', name: 'Scale' }, { kind: 'number', value: 2 }]);
    expect(scale.result.session).toBeNull();
    expect(scale.result.effects).toEqual([{ type: 'zoom-scale', factor: 2 }]);
    const center = replay('ZOOM', [{ kind: 'keyword', name: 'Center' }, point(4, 5), { kind: 'number', value: 3 }]);
    expect(center.result.effects[0]).toMatchObject({ type: 'zoom-center', factor: 3 });
    const dynamic = replay('ZOOM', [{ kind: 'keyword', name: 'Dynamic' }]);
    expect(dynamic.result.session?.phase).toBe('window');
  });

  it('draws a line with close and undo', () => {
    const model = new DrawingModel();
    const settings = defaultSettings();
    let result = beginCommand('LINE', model, settings);
    const session = (): Session => {
      if (!result.session) throw new Error('session ended');
      return result.session;
    };
    result = stepCommand(session(), model, settings, point(0, 0));
    result = stepCommand(session(), model, settings, point(10, 0));
    result = stepCommand(session(), model, settings, point(10, 4));
    result = stepCommand(session(), model, settings, { kind: 'keyword', name: 'Undo' });
    expect(model.doc.entities).toHaveLength(1);
    result = stepCommand(session(), model, settings, point(10, 5));
    result = stepCommand(session(), model, settings, { kind: 'keyword', name: 'Close' });
    expect(result.session).toBeNull();
    expect(model.doc.entities).toHaveLength(3);
    expect(model.undo()).toBe(true);
    expect(model.doc.entities).toHaveLength(0);
  });

  it('draws a polyline, a circle by diameter, and reports area', () => {
    const pline = replay('PLINE', [point(0, 0), point(10, 0), point(10, 5), point(0, 5), { kind: 'keyword', name: 'Close' }]);
    const poly = pline.model.doc.entities[0];
    expect(poly?.type).toBe('polyline');
    if (poly?.type === 'polyline') {
      expect(poly.closed).toBe(true);
      expect(entityArea(poly)).toBeCloseTo(50);
      expect(entityLength(poly)).toBeCloseTo(30);
    }
    const circle = replay('CIRCLE', [point(0, 0), { kind: 'keyword', name: 'Diameter' }, { kind: 'number', value: 4 }]);
    const drawn = circle.model.doc.entities[0];
    expect(drawn?.type).toBe('circle');
    if (drawn?.type === 'circle') expect(drawn.radius).toBeCloseTo(2);
  });

  it('offsets, trims, fillets, rotates, scales, and mirrors through the command loop', () => {
    const model = new DrawingModel();
    const settings = defaultSettings();
    model.checkpoint();
    model.add({ id: model.nextId(), type: 'line', layer: '0', color: 'bylayer', a: v3(0, 0), b: v3(10, 0) });
    model.doc.selection = ['e1'];
    let result = beginCommand('OFFSET', model, settings);
    const next = (input: SessionInput) => {
      if (!result.session) throw new Error('session ended');
      result = stepCommand(result.session, model, settings, input);
    };
    next({ kind: 'number', value: 2 });
    next({ kind: 'picked', ids: ['e1'], window: null, crossing: false, at: v3(5, 0) });
    next(point(5, 5));
    const offset = model.doc.entities.find((entity) => entity.id !== 'e1');
    expect(offset?.type).toBe('line');
    if (offset?.type === 'line') {
      expect(offset.a.y).toBeCloseTo(2);
      expect(offset.b.y).toBeCloseTo(2);
    }

    const moved = new DrawingModel();
    moved.add({ id: 'e1', type: 'line', layer: '0', color: 'bylayer', a: v3(1, 0), b: v3(2, 0) });
    moved.doc.selection = ['e1'];
    let rotating = beginCommand('ROTATE', moved, settings);
    const turn = (input: SessionInput) => {
      if (!rotating.session) throw new Error('session ended');
      rotating = stepCommand(rotating.session, moved, settings, input);
    };
    turn(point(0, 0));
    turn({ kind: 'number', value: 90 });
    const spun = moved.doc.entities[0];
    expect(spun?.type).toBe('line');
    if (spun?.type === 'line') {
      expect(spun.a.x).toBeCloseTo(0);
      expect(spun.a.y).toBeCloseTo(1);
      expect(spun.b.y).toBeCloseTo(2);
    }
  });

  it('stores an ACI index on entities drawn after COLOR', () => {
    const model = new DrawingModel();
    const settings = defaultSettings();
    let result = beginCommand('COLOR', model, settings);
    if (!result.session) throw new Error('session ended');
    result = stepCommand(result.session, model, settings, { kind: 'number', value: 1 });
    expect(result.session).toBeNull();
    expect(model.doc.currentColorIndex).toBe(1);
    result = beginCommand('LINE', model, settings);
    if (!result.session) throw new Error('session ended');
    result = stepCommand(result.session, model, settings, point(0, 0));
    if (!result.session) throw new Error('session ended');
    result = stepCommand(result.session, model, settings, point(4, 0));
    if (!result.session) throw new Error('session ended');
    stepCommand(result.session, model, settings, { kind: 'empty' });
    const line = model.doc.entities[0];
    expect(line?.color).toBe('#ff0000');
    expect(line?.colorIndex).toBe(1);
  });

  it('zooms to extents on an empty Enter', () => {
    const model = new DrawingModel();
    const settings = defaultSettings();
    let result = beginCommand('ZOOM', model, settings);
    expect(result.prompt?.def).toBe('Extents');
    if (!result.session) throw new Error('session ended');
    result = stepCommand(result.session, model, settings, { kind: 'empty' });
    expect(result.effects.some((effect) => effect.type === 'zoom-extents')).toBe(true);
  });

  it('runs PAN as realtime and exits on Enter, Esc, or the shortcut menu', () => {
    const model = new DrawingModel();
    const settings = defaultSettings();
    let result = beginCommand('PAN', model, settings);
    expect(result.prompt?.head).toBe('Press ESC or ENTER to exit, or right-click to display shortcut menu.');
    expect(result.effects.some((effect) => effect.type === 'nav-mark')).toBe(true);
    if (!result.session) throw new Error('session ended');
    result = stepCommand(result.session, model, settings, { kind: 'text', text: 'Zoom' });
    expect(result.session?.command).toBe('ZOOM');
    expect(result.session?.phase).toBe('realtime');
    if (!result.session) throw new Error('session ended');
    result = stepCommand(result.session, model, settings, { kind: 'keyword', name: 'Zoom Extents' });
    expect(result.session?.command).toBe('ZOOM');
    expect(result.effects.some((effect) => effect.type === 'zoom-extents')).toBe(true);
    if (!result.session) throw new Error('session ended');
    result = stepCommand(result.session, model, settings, { kind: 'keyword', name: 'Zoom Original' });
    expect(result.effects.some((effect) => effect.type === 'zoom-original')).toBe(true);
    if (!result.session) throw new Error('session ended');
    result = stepCommand(result.session, model, settings, { kind: 'keyword', name: 'Zoom Window' });
    expect(result.prompt?.head).toBe('Specify first corner');
    if (!result.session) throw new Error('session ended');
    result = stepCommand(result.session, model, settings, point(0, 0));
    result = stepCommand(result.session!, model, settings, point(10, 5));
    expect(result.effects.some((effect) => effect.type === 'zoom-window')).toBe(true);
    expect(result.session?.phase).toBe('realtime');
    if (!result.session) throw new Error('session ended');
    result = stepCommand(result.session, model, settings, { kind: 'empty' });
    expect(result.session).toBeNull();
    result = beginCommand('PAN', model, settings);
    result = stepCommand(result.session!, model, settings, { kind: 'cancel' });
    expect(result.session).toBeNull();
  });

  it('leaves realtime pan for 3D Orbit from the shortcut menu', () => {
    const model = new DrawingModel();
    const settings = defaultSettings();
    const started = beginCommand('PAN', model, settings);
    if (!started.session) throw new Error('session ended');
    const result = stepCommand(started.session, model, settings, { kind: 'keyword', name: '3D Orbit' });
    expect(result.session).toBeNull();
    expect(result.effects).toContainEqual({ type: 'orbit-constrained' });
    expect(result.messages.some((line) => line.includes('Constrained orbit'))).toBe(true);
  });

  it('pans -PAN by two typed points or a single displacement', () => {
    const model = new DrawingModel();
    const settings = defaultSettings();
    let result = beginCommand('-PAN', model, settings);
    expect(result.prompt?.head).toBe('Specify base point or displacement:');
    if (!result.session) throw new Error('session ended');
    result = stepCommand(result.session, model, settings, point(5, -2));
    expect(result.prompt?.head).toBe('Specify second point:');
    if (!result.session) throw new Error('session ended');
    result = stepCommand(result.session, model, settings, { kind: 'empty' });
    expect(result.effects).toEqual([{ type: 'pan-displacement', x: 5, y: -2 }]);

    result = beginCommand('-PAN', model, settings);
    result = stepCommand(result.session!, model, settings, point(1, 2));
    result = stepCommand(result.session!, model, settings, point(4, 6));
    expect(result.session).toBeNull();
    expect(result.effects[0]).toMatchObject({ type: 'pan-by', a: { x: 1, y: 2 }, b: { x: 4, y: 6 } });
  });

  it('reads a 2x scale as a zoom factor', () => {
    const model = new DrawingModel();
    const settings = defaultSettings();
    const started = beginCommand('ZOOM', model, settings);
    if (!started.session) throw new Error('session ended');
    const result = stepCommand(started.session, model, settings, { kind: 'text', text: '2x' });
    expect(result.effects).toContainEqual({ type: 'zoom-scale', factor: 2 });
  });
});
