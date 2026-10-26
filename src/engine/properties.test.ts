import { describe, expect, it } from 'vitest';
import { DrawingModel, emptyDrawing, type DrawLine, type DrawPolyline } from './drafting';
import { lockMessage, polylineWidthArea, setLockedIds, syncObjects } from './objects';
import { beginCommand, defaultSettings } from '../commands/session';
import { commonValue, fieldsFor, fieldsForSelection, listText, objectTypeName, patternRuns, readProp, selectByQuery, writeProp, VARIES } from './properties';

function line(): DrawLine {
  return { id: 'e1', type: 'line', layer: '0', color: 'bylayer', a: { x: 0, y: 0, z: 1 }, b: { x: 10, y: 0, z: 1 } };
}

function poly(): DrawPolyline {
  return {
    id: 'e2',
    type: 'polyline',
    layer: '0',
    color: 'bylayer',
    closed: true,
    vertices: [
      { x: 0, y: 0, z: 0, bulge: 0 },
      { x: 10, y: 0, z: 0, bulge: 0 },
      { x: 10, y: 5, z: 0, bulge: 0 },
      { x: 0, y: 5, z: 0, bulge: 0 },
    ],
  };
}

describe('properties', () => {
  it('reads and writes line geometry and ByLayer color', () => {
    const doc = emptyDrawing();
    doc.entities.push(line());
    expect(fieldsFor(doc.entities[0]).some((field) => field.key === 'type')).toBe(true);
    expect(readProp(doc, 'e1', 'type')).toBe('Line');
    expect(fieldsFor(doc.entities[0]).some((field) => field.key === 'startX')).toBe(true);
    expect(fieldsFor(doc.entities[0]).some((field) => field.label === 'Material')).toBe(false);
    expect(readProp(doc, 'e1', 'length')).toBe('10.000');
    expect(readProp(doc, 'e1', 'angle')).toBe('0.000');
    expect(readProp(doc, 'e1', 'color')).toBe('ByLayer');
    expect(writeProp(doc, 'e1', 'startX', '2')).toBeNull();
    expect(writeProp(doc, 'e1', 'color', '1')).toBeNull();
    const entity = doc.entities[0];
    if (entity.type === 'line') expect(entity.a.x).toBe(2);
    expect(entity.colorIndex).toBe(1);
    expect(readProp(doc, 'e1', 'color')).toBe('1');
    expect(writeProp(doc, 'e1', 'color', '#336699')).toBeNull();
    expect(entity.color).toBe('#336699');
    expect(listText(doc, entity).join('\n')).toContain('LINE');
  });

  it('edits polyline widths, bulge, and linetype generation', () => {
    const doc = emptyDrawing();
    const entity = poly();
    doc.entities.push(entity);
    expect(writeProp(doc, 'e2', 'globalWidth', '2')).toBeNull();
    expect(polylineWidthArea(entity)).toBeCloseTo(60);
    expect(writeProp(doc, 'e2', 'bulge', '0.5', 0)).toBeNull();
    expect(entity.vertices[0].bulge).toBeCloseTo(0.5);
    expect(polylineWidthArea(entity)).toBeGreaterThan(60);
    expect(writeProp(doc, 'e2', 'linetypeGeneration', 'Enabled')).toBeNull();
    expect(patternRuns(entity)).toBe(1);
    entity.linetypeGeneration = false;
    expect(patternRuns(entity)).toBe(4);
    expect(writeProp(doc, 'e2', 'closed', 'No')).toBeNull();
    expect(entity.closed).toBe(false);
    const threed = { ...entity, poly3d: true };
    expect(fieldsFor(threed).some((field) => field.key === 'vertexZ')).toBe(true);
    expect(fieldsFor(threed).some((field) => field.key === 'startWidth')).toBe(false);
    expect(fieldsFor(threed).some((field) => field.label === 'Material')).toBe(true);
  });

  it('shows *VARIES* and skips locked objects', () => {
    const doc = emptyDrawing();
    doc.entities.push(line(), { ...line(), id: 'e9', color: '#ff0000', a: { x: 0, y: 1, z: 0 }, b: { x: 4, y: 1, z: 0 } });
    expect(commonValue(doc, ['e1', 'e9'], 'color')).toBe(VARIES);
    expect(commonValue(doc, ['e1', 'e9'], 'layer')).toBe('0');
    doc.entities[0].locked = true;
    expect(writeProp(doc, 'e1', 'endX', '4')).toBe(lockMessage(1));
    expect(writeProp(doc, 'e1', 'locked', 'No')).toBeNull();
    expect(doc.entities[0].locked).toBe(false);
    doc.layers[0].locked = true;
    expect(writeProp(doc, 'e1', 'endX', '4')).toMatch(/locked/);
  });

  it('locks objects through the command and keeps civil color off the geometry', () => {
    const doc = emptyDrawing();
    doc.entities.push(line());
    const settings = defaultSettings();
    const model = new DrawingModel(doc);
    model.doc.selection = ['e1'];
    const locked = beginCommand('LOCKOBJECT', model, settings);
    expect(locked.messages.join(' ')).toMatch(/locked/);
    expect(model.doc.entities[0].locked).toBe(true);
    const moving = beginCommand('MOVE', model, settings);
    expect(moving.messages.join(' ')).toMatch(/1 object is locked/);
    const kept = model.doc.entities[0];
    if (kept.type === 'line') expect(kept.a.x).toBe(0);
    const surface = { id: 's1', points: new Array(1_500_000) };
    syncObjects(model.doc, [{ key: 'surface:s1', kind: 'surface', name: 'EG', layer: 'C-TOPO' }]);
    expect(writeProp(model.doc, 'surface:s1', 'color', '3')).toBeNull();
    expect(model.doc.objects[0].colorIndex).toBe(3);
    expect(surface.points.length).toBe(1_500_000);
    setLockedIds(model.doc, ['surface:s1'], true);
    expect(writeProp(model.doc, 'surface:s1', 'layer', '0')).toMatch(/locked/);
    const found = selectByQuery(model.doc, { kind: 'surface', property: 'locked', operator: '=', value: 'Yes' });
    expect(found).toEqual(['surface:s1']);
    expect(readProp(model.doc, 'surface:s1', 'type')).toBe('Surface');
    expect(readProp(model.doc, 'surface:s1', 'name')).toBe('EG');
  });

  it('keeps shared rows for a mixed selection and geometry for one type', () => {
    const doc = emptyDrawing();
    const other = line();
    other.id = 'e9';
    other.layer = 'Road';
    other.a = { x: 1, y: 2, z: 0 };
    doc.entities.push(line(), other, {
      id: 'c1',
      type: 'circle',
      layer: '0',
      color: 'bylayer',
      center: { x: 4, y: 5, z: 0 },
      radius: 3,
    });
    const mixed = fieldsForSelection([doc.entities[0], doc.entities[2]]);
    expect(mixed.some((field) => field.key === 'type')).toBe(true);
    expect(mixed.some((field) => field.key === 'layer')).toBe(true);
    expect(mixed.some((field) => field.key === 'startX')).toBe(false);
    expect(mixed.some((field) => field.key === 'radius')).toBe(false);
    expect(commonValue(doc, ['e1', 'c1'], 'type')).toBe(VARIES);
    const lines = fieldsForSelection([doc.entities[0], doc.entities[1]]);
    expect(lines.some((field) => field.key === 'startX')).toBe(true);
    expect(commonValue(doc, ['e1', 'e9'], 'type')).toBe('Line');
    expect(commonValue(doc, ['e1', 'e9'], 'layer')).toBe(VARIES);
    expect(objectTypeName(doc.entities[2])).toBe('Circle');
    expect(fieldsForSelection([])).toEqual([]);
  });
});
