import { describe, expect, it } from 'vitest';
import { v3, type DrawEntity } from './drafting';
import { parseProject, serializeProject } from './project';
import {
  attachXref,
  bindXref,
  dashXref,
  detachXref,
  displayStatus,
  emptyXrefs,
  hostVisible,
  markNeedsReload,
  parseXrefFile,
  pointInClip,
  reloadXref,
  setLayerOverride,
  setReferenced,
  setXrefClip,
  setXrefPath,
  unloadXref,
  visibleXrefs,
  xbindLayers,
  type XrefSnapshot,
} from './xref';

function snap(layer = 'Curb'): XrefSnapshot {
  const entity: DrawEntity = { id: 'e1', type: 'line', layer, color: 'bylayer', a: v3(0, 0, 0), b: v3(10, 0, 0) };
  return { entities: [entity], layers: [{ name: layer, color: '#ff0000', visible: true, locked: false, lineType: 'Continuous' }] };
}

describe('external references', () => {
  it('attaches, unloads, reloads, and keeps layer overrides', () => {
    let doc = attachXref(emptyXrefs(), { name: 'Road', savedPath: '/survey/road.dxf', snapshot: snap() });
    const id = doc.records[0].id;
    expect(displayStatus(doc, doc.records[0])).toBe('loaded');
    doc = setLayerOverride(doc, id, 'Curb', { visible: false });
    doc = markNeedsReload(doc, id);
    expect(doc.records[0].status).toBe('needs-reload');
    expect(doc.records[0].notification).toMatch(/needs reloading/);
    const changed = snap();
    changed.entities[0] = { ...changed.entities[0], id: 'e2' };
    doc = reloadXref(doc, id, changed);
    expect(doc.records[0].status).toBe('loaded');
    expect(doc.records[0].layerOverrides.Curb.visible).toBe(false);
    doc = unloadXref(doc, id);
    expect(displayStatus(doc, doc.records[0])).toBe('unloaded');
    doc = setXrefPath(doc, id, '/survey/road.dxf', 'none');
    expect(doc.records[0].savedPath).toBe('road.dxf');
  });

  it('hides nested overlays and orphans a child when the parent is unloaded', () => {
    let doc = attachXref(emptyXrefs(), { name: 'Base', savedPath: 'base.dxf', snapshot: snap(), attachType: 'overlay' });
    const parent = doc.records[0].id;
    doc = attachXref(doc, { name: 'Nested', savedPath: 'nested.dxf', snapshot: snap('Pipe'), parentId: parent, attachType: 'attach' });
    doc = attachXref(doc, { name: 'Over', savedPath: 'over.dxf', snapshot: snap('Temp'), parentId: parent, attachType: 'overlay' });
    expect(visibleXrefs(doc).map((record) => record.name).sort()).toEqual(['Base', 'Nested']);
    expect(hostVisible(doc, doc.records[2])).toBe(false);
    doc = unloadXref(doc, parent);
    expect(displayStatus(doc, doc.records[1])).toBe('orphaned');
    expect(visibleXrefs(doc)).toHaveLength(0);
    doc = setReferenced(doc, doc.records[2].id, false);
    expect(displayStatus(doc, doc.records[2])).toBe('unreferenced');
  });

  it('binds with Name$0$Layer, inserts without a prefix, and xbinds one layer', () => {
    let doc = attachXref(emptyXrefs(), { name: 'Base', savedPath: 'base.dxf', snapshot: snap('0'), insertion: { x: 5, y: 0, z: 0 } });
    const bound = bindXref(doc, doc.records[0].id, 'bind', ['Base$0$0']);
    expect(bound.layers[0].name).toBe('Base$1$0');
    expect(bound.entities[0].type === 'line' && bound.entities[0].a.x).toBe(5);
    expect(bound.doc.records).toHaveLength(0);
    doc = attachXref(emptyXrefs(), { name: 'Base', savedPath: 'base.dxf', snapshot: snap('Curb') });
    const inserted = bindXref(doc, doc.records[0].id, 'insert', []);
    expect(inserted.layers[0].name).toBe('Curb');
    const extracted = xbindLayers(doc, doc.records[0].id, ['Curb'], []);
    expect(extracted.layers[0].name).toBe('Base$0$Curb');
    doc = attachXref(doc, { name: 'Child', savedPath: 'child.dxf', snapshot: snap(), parentId: doc.records[0].id });
    expect(detachXref(doc, doc.records[0].id).records).toHaveLength(0);
  });

  it('clips, lists from -XREF, and round-trips in the project file', () => {
    let doc = attachXref(emptyXrefs(), { name: 'Road', savedPath: 'road.dxf', snapshot: snap() });
    const clip = { shape: 'rect' as const, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], invert: false, enabled: true };
    expect(pointInClip(clip, 5, 5)).toBe(true);
    expect(pointInClip({ ...clip, invert: true }, 5, 5)).toBe(false);
    doc = setXrefClip(doc, doc.records[0].id, clip);
    const listed = dashXref(doc, '-XREF ?');
    expect(listed.message).toMatch(/Road loaded attach/);
    const detached = dashXref(doc, '-XREF Detach Road');
    expect(detached.doc.records).toHaveLength(0);
    const missing = dashXref(emptyXrefs(), '-XREF Attach missing.dxf');
    expect(missing.doc.records[0].status).toBe('not-found');
    const saved = serializeProject({
      format: 'fieldline-project',
      version: 1,
      name: 'X',
      unit: 'm',
      activeId: null,
      surfaces: [],
      volumeSetup: { baseId: null, mode: 'datum', comparisonId: null, datum: 0 },
      showVolumeMap: false,
      xrefs: doc,
    });
    expect(parseProject(saved).xrefs?.records[0].name).toBe('Road');
    expect(parseXrefFile(parseProject(saved).xrefs).records[0].clip?.enabled).toBe(true);
  });
});
