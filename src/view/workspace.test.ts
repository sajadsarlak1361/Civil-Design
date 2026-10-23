import { describe, expect, it } from 'vitest';
import { DrawingModel } from '../engine/drafting';
import {
  joinViewports,
  layoutSlots,
  presetCamera,
  presetVectors,
  restoreNamedView,
  saveNamedView,
  setLayout,
  resetWorkspace,
  getWorkspace,
  VISUAL_STYLES,
} from './workspace';

describe('viewport layouts and view presets', () => {
  it('builds one, two, three, and four independent viewports', () => {
    expect(layoutSlots(1).map((slot) => slot.preset)).toEqual(['plan']);
    expect(layoutSlots(2)).toHaveLength(2);
    expect(layoutSlots(3).map((slot) => slot.preset)).toEqual(['plan', 'front', 'right']);
    const four = layoutSlots(4);
    expect(four.map((slot) => slot.preset)).toEqual(['top', 'front', 'right', 'sw']);
    expect(new Set(four.map((slot) => slot.id)).size).toBe(4);
    expect(four[0].polar).not.toBe(four[3].polar);
  });

  it('joins two viewports and keeps the other cameras', () => {
    const slots = layoutSlots(4);
    const joined = joinViewports(slots, slots[0].id, slots[1].id);
    expect(joined).toHaveLength(3);
    expect(joined.some((slot) => slot.id === slots[1].id)).toBe(false);
    expect(joined[0].preset).toBe('top');
    expect(joinViewports(slots, 'missing', slots[0].id)).toHaveLength(4);
  });

  it('saves and restores a named view', () => {
    const slot = { id: 'vp-1', ...presetCamera('ne') };
    const saved = saveNamedView([], 'NE iso', slot);
    const again = saveNamedView(saved, 'ne iso', { ...slot, distance: 2 });
    expect(again).toHaveLength(1);
    expect(restoreNamedView(again, 'NE ISO')?.distance).toBe(2);
    expect(restoreNamedView(again, 'missing')).toBeNull();
  });

  it('points orthographic presets along an axis and isometric presets into a corner', () => {
    const top = presetVectors('top');
    expect(top.ortho).toBe(true);
    expect(top.position[1]).toBeGreaterThan(0);
    expect(top.up[2]).toBeLessThan(0);
    const sw = presetVectors('sw');
    expect(sw.ortho).toBe(false);
    expect(sw.position[0]).toBeLessThan(0);
    expect(sw.position[1]).toBeGreaterThan(0);
    expect(sw.position[2]).toBeGreaterThan(0);
    const front = presetVectors('front');
    expect(front.position[2]).toBeGreaterThan(0);
    expect(front.ortho).toBe(true);
  });

  it('includes the civil elevation banding visual style', () => {
    expect(VISUAL_STYLES).toContain('elevation');
    expect(VISUAL_STYLES).toContain('2d-wireframe');
    expect(VISUAL_STYLES).toContain('shaded-edges');
  });

  it('stores a four-viewport layout on the workspace', () => {
    resetWorkspace();
    setLayout(4);
    expect(getWorkspace().layout).toBe(4);
    expect(getWorkspace().slots).toHaveLength(4);
    resetWorkspace();
  });
});

describe('undo labels', () => {
  it('names the command that Undo and Redo will run', () => {
    const model = new DrawingModel();
    model.checkpoint('OFFSET');
    model.doc.entities = [];
    expect(model.undoLabel()).toBe('OFFSET');
    expect(model.undoHistory()).toEqual(['OFFSET']);
    expect(model.undo()).toBe(true);
    expect(model.canUndo()).toBe(false);
    expect(model.redoLabel()).toBe('OFFSET');
    expect(model.redo()).toBe(true);
    expect(model.undoLabel()).toBe('OFFSET');
  });
});
