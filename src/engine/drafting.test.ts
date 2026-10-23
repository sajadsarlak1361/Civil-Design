import { describe, expect, it } from 'vitest';
import { parseProject, serializeProject } from './project';
import { defaultSurfaceStyle } from './types';
import {
  DrawingModel,
  applyConstraint,
  directDistance,
  emptyDrawing,
  mirrored,
  rotated,
  scaled,
  selectByBox,
  snapToDrawing,
  v3,
  type DrawLine,
} from './drafting';
import { filletLines, offsetLine, trimAt } from './draftEdit';

function line(id: string, x1: number, y1: number, x2: number, y2: number): DrawLine {
  return { id, type: 'line', layer: '0', color: 'bylayer', a: v3(x1, y1), b: v3(x2, y2) };
}

describe('plan drafting', () => {
  it('snaps to an endpoint and prefers it over a farther midpoint', () => {
    const model = new DrawingModel();
    model.add(line('e1', 0, 0, 10, 0));
    const hit = snapToDrawing(model.doc, v3(0.2, 0.2), 1, ['endpoint', 'midpoint', 'nearest']);
    expect(hit?.kind).toBe('endpoint');
    expect(hit?.point.x).toBeCloseTo(0);
  });

  it('selects by window and by crossing', () => {
    const model = new DrawingModel();
    model.add(line('e1', 0, 0, 20, 0));
    const window = selectByBox(model.doc, { x: -1, y: -1 }, { x: 21, y: 1 });
    expect(window.crossing).toBe(false);
    expect(window.ids).toEqual(['e1']);
    const partial = selectByBox(model.doc, { x: 0, y: -1 }, { x: 10, y: 1 });
    expect(partial.ids).toEqual([]);
    const crossing = selectByBox(model.doc, { x: 10, y: 1 }, { x: 0, y: -1 });
    expect(crossing.crossing).toBe(true);
    expect(crossing.ids).toEqual(['e1']);
  });

  it('offsets, trims, and fillets lines', () => {
    const source = line('e1', 0, 0, 10, 0);
    const offset = offsetLine(source, 2, v3(5, 5), 'e2');
    expect(offset?.a).toMatchObject({ x: 0, y: 2 });
    expect(offset?.b).toMatchObject({ x: 10, y: 2 });

    const model = new DrawingModel();
    model.add(line('cut', 0, 0, 10, 0));
    model.add(line('edge', 5, -5, 5, 5));
    const right = trimAt(model.doc, 'cut', ['edge'], v3(7, 0), () => 'n1');
    expect(right?.replace[0]).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 5, y: 0 } });
    const left = trimAt(model.doc, 'cut', ['edge'], v3(2, 0), () => 'n1');
    expect(left?.replace[0]).toMatchObject({ a: { x: 5, y: 0 }, b: { x: 10, y: 0 } });

    const fillet = filletLines(line('a', 0, 0, 10, 0), line('b', 0, 0, 0, 10), v3(8, 0), v3(0, 8), 2);
    expect(fillet).not.toBeNull();
    const near = (points: { x: number; y: number }[], x: number, y: number) =>
      points.some((point) => Math.hypot(point.x - x, point.y - y) < 1e-6);
    expect(near([fillet!.lineA.a, fillet!.lineA.b], 2, 0)).toBe(true);
    expect(near([fillet!.lineB.a, fillet!.lineB.b], 0, 2)).toBe(true);
    expect(fillet?.arc?.radius).toBeCloseTo(2);
  });

  it('rotates, scales, and mirrors about a base point', () => {
    const source = line('e1', 1, 0, 2, 0);
    const spun = rotated(source, v3(0, 0), Math.PI / 2);
    expect(spun.type).toBe('line');
    if (spun.type === 'line') {
      expect(spun.a.x).toBeCloseTo(0);
      expect(spun.a.y).toBeCloseTo(1);
      expect(spun.b.y).toBeCloseTo(2);
    }
    const shrunk = scaled(line('e2', 2, 0, 4, 0), v3(0, 0), 0.5);
    expect(shrunk.type).toBe('line');
    if (shrunk.type === 'line') {
      expect(shrunk.a.x).toBeCloseTo(1);
      expect(shrunk.b.x).toBeCloseTo(2);
    }
    const flipped = mirrored(line('e3', 0, 0, 1, 0), v3(0, 0), v3(0, 1));
    expect(flipped.type).toBe('line');
    if (flipped.type === 'line') expect(flipped.b.x).toBeCloseTo(-1);
  });

  it('locks ortho and places a direct distance', () => {
    const locked = applyConstraint(v3(0, 0), v3(3, 4), true, false, 90);
    expect(locked.x).toBeCloseTo(0);
    expect(locked.y).toBeCloseTo(4);
    const placed = directDistance(v3(0, 0), v3(0, 8), 10);
    expect(placed?.y).toBeCloseTo(10);
  });

  it('round-trips drawing entities inside a project file', () => {
    const drawing = emptyDrawing();
    drawing.entities.push(line('e1', 1, 2, 3, 4));
    const text = serializeProject({
      format: 'fieldline-project',
      version: 1,
      name: 'Pad',
      unit: 'm',
      activeId: null,
      surfaces: [],
      volumeSetup: { baseId: null, mode: 'datum', comparisonId: null, datum: 0 },
      showVolumeMap: false,
      drawing: {
        layers: drawing.layers,
        currentLayer: drawing.currentLayer,
        currentColor: drawing.currentColor,
        linetypeScale: drawing.linetypeScale,
        entities: drawing.entities,
      },
    });
    const project = parseProject(text);
    expect(project.drawing?.entities[0]).toMatchObject({ type: 'line', a: { x: 1, y: 2 }, b: { x: 3, y: 4 } });
    const legacy = parseProject(
      JSON.stringify({
        format: 'fieldline-project',
        version: 1,
        name: 'Old',
        unit: 'm',
        surfaces: [
          {
            id: 's1',
            name: 'EG',
            points: [],
            triangles: [],
            style: defaultSurfaceStyle(0),
          },
        ],
      }),
    );
    expect(legacy.drawing).toBeUndefined();
    expect(legacy.name).toBe('Old');
  });
});
