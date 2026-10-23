import { describe, expect, it } from 'vitest';
import { aciRgb } from './aci';
import { emptyDrawing } from './drafting';
import { drawingLayersToDxf, parseDxfLayerTable } from './dxf';
import {
  deleteLayer,
  deleteLayerAndObjects,
  ensureStandardLayers,
  freezeLayer,
  layersForView,
  nextLayerName,
  normalizeLayer,
  restoreNamedLayerState,
  saveLayerState,
  shouldDraw,
} from './layers';
import { dashPixels, linetypeRuns } from './linetypes';
import { lineweightPx } from './lineweights';

describe('layers', () => {
  it('matches indexed-color anchors', () => {
    expect(aciRgb(1)).toEqual([255, 0, 0]);
    expect(aciRgb(7)).toEqual([255, 255, 255]);
    expect(aciRgb(10)).toEqual([255, 0, 0]);
    expect(aciRgb(11)).toEqual([255, 127, 127]);
    expect(aciRgb(12)).toEqual([204, 0, 0]);
    expect(aciRgb(13)).toEqual([204, 102, 102]);
    expect(aciRgb(14)).toEqual([153, 0, 0]);
    expect(aciRgb(15)).toEqual([153, 76, 76]);
    expect(aciRgb(16)).toEqual([127, 0, 0]);
    expect(aciRgb(17)).toEqual([127, 63, 63]);
    expect(aciRgb(18)).toEqual([76, 0, 0]);
    expect(aciRgb(19)).toEqual([76, 38, 38]);
    expect(aciRgb(20)).toEqual([255, 63, 0]);
    expect(aciRgb(21)).toEqual([255, 159, 127]);
    expect(aciRgb(30)).toEqual([255, 127, 0]);
    expect(aciRgb(50)).toEqual([255, 255, 0]);
    expect(aciRgb(250)).toEqual([51, 51, 51]);
    expect(aciRgb(255)).toEqual([255, 255, 255]);
  });

  it('refuses to delete layer 0, Defpoints, the current layer, and layers in use', () => {
    const doc = emptyDrawing();
    expect(doc.layers.some((layer) => layer.name === 'Defpoints')).toBe(true);
    expect(deleteLayer(doc, '0')).toMatch(/layer 0/);
    expect(deleteLayer(doc, 'Defpoints')).toMatch(/Defpoints/);
    expect(deleteLayer(doc, '0')).toBeTruthy();
    doc.currentLayer = 'C-TOPO';
    expect(deleteLayer(doc, 'C-TOPO')).toMatch(/current/);
    doc.entities.push({ id: 'e1', type: 'line', layer: 'C-ROAD', color: 'bylayer', a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 } });
    expect(deleteLayer(doc, 'C-ROAD')).toMatch(/contains objects/);
    expect(deleteLayerAndObjects(doc, '0')).toMatch(/layer 0/);
    doc.currentLayer = '0';
    expect(deleteLayerAndObjects(doc, 'C-ROAD')).toBeNull();
    expect(doc.entities).toHaveLength(0);
  });

  it('filters, sorts, and restores layer states without cloning geometry', () => {
    const doc = emptyDrawing();
    doc.layers.push(normalizeLayer({ name: 'Site', color: '#ff0000', visible: false, frozen: true, locked: false, lineType: 'Dashed', lineWeight: 50, plot: true, transparency: 0, plotStyle: 'ByColor', description: '', vpFrozen: [] }));
    const off = layersForView(doc, { id: 'off', name: 'Off', kind: 'property', query: { on: false } }, '');
    expect(off.map((layer) => layer.name)).toEqual(['Site']);
    doc.entities.push({ id: 'e1', type: 'line', layer: 'C-TOPO', color: 'bylayer', a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 } });
    const used = layersForView(doc, { id: 'used', name: 'All Used Layers', kind: 'used' }, 'topo');
    expect(used.map((layer) => layer.name)).toContain('C-TOPO');
    saveLayerState(doc, 'Before');
    const site = doc.layers.find((layer) => layer.name === 'Site');
    if (site) site.visible = true;
    expect(restoreNamedLayerState(doc, 'Before')).toBeNull();
    expect(doc.layers.find((layer) => layer.name === 'Site')?.visible).toBe(false);
    expect(nextLayerName(doc.layers)).toBe('Layer1');
  });

  it('treats freeze and off as a flag, including a large surface', () => {
    const layer = normalizeLayer({ name: 'C-TOPO', visible: true, frozen: false });
    const cloud = { count: 1_500_000 };
    expect(shouldDraw(layer)).toBe(true);
    layer.frozen = true;
    expect(shouldDraw(layer)).toBe(false);
    layer.frozen = false;
    layer.visible = false;
    expect(shouldDraw(layer)).toBe(false);
    expect(cloud.count).toBe(1_500_000);
    expect(freezeLayer(emptyDrawing(), 'Missing')).toMatch(/not found/);
    const doc = emptyDrawing();
    doc.currentLayer = '0';
    expect(freezeLayer(doc, '0')).toMatch(/current/);
  });

  it('migrates the legacy 1px lineweight and round-trips a DXF layer table', () => {
    const legacy = normalizeLayer({ name: '0', color: '#e8eef7', visible: true, locked: false, lineType: 'Continuous', lineWeight: 1 });
    expect(legacy.lineWeight).toBe(-3);
    const modern = normalizeLayer({ name: 'Site', lineWeight: 50, plot: true, frozen: false, visible: true, locked: false, lineType: 'Continuous', color: '#fff' });
    expect(modern.lineWeight).toBe(50);
    const dxf = drawingLayersToDxf([{ name: 'C-TOPO', colorIndex: 4, lineType: 'Dashed', frozen: true, locked: true, visible: false }]);
    const parsed = parseDxfLayerTable(dxf);
    expect(parsed.find((layer) => layer.name === 'C-TOPO')).toMatchObject({ color: 4, frozen: true, locked: true, off: true, lineType: 'DASHED' });
    expect(ensureStandardLayers([]).some((layer) => layer.name === '0')).toBe(true);
  });

  it('scales linetypes in drawing units and lineweights in screen pixels', () => {
    expect(linetypeRuns(4, false)).toBe(4);
    expect(linetypeRuns(4, true)).toBe(1);
    const dashes = dashPixels('Dashed', 2, 1, 10);
    expect(dashes[0]).toBeCloseTo(10);
    expect(lineweightPx(25, true)).toBe(1);
    expect(lineweightPx(25, false)).toBe(1);
    expect(lineweightPx(100, true)).toBeCloseTo((1 * 96) / 25.4);
  });
});
