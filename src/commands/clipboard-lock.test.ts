import { describe, expect, it } from 'vitest';
import { DrawingModel, v3 } from '../engine/drafting';
import { eraseSelection, getCommandSnapshot, getDrawingModel, runCommand, writeDrawingFile } from './runtime';

describe('edit menu and locked objects', () => {
  it('skips locked objects for Cut and Delete', () => {
    const model = new DrawingModel();
    model.add({ id: 'free', type: 'line', layer: '0', color: 'bylayer', a: v3(0, 0), b: v3(1, 0) });
    model.add({ id: 'held', type: 'line', layer: '0', color: 'bylayer', locked: true, a: v3(0, 1), b: v3(1, 1) });
    writeDrawingFile(model.toFile());
    getDrawingModel().doc.selection = ['free', 'held'];
    runCommand('CUTCLIP');
    expect(getDrawingModel().doc.entities.map((entity) => entity.id)).toEqual(['held']);
    expect(getCommandSnapshot().lines.map((line) => line.text).join('\n')).toContain('1 object is locked.');
    getDrawingModel().doc.selection = ['held'];
    eraseSelection();
    expect(getDrawingModel().doc.entities.map((entity) => entity.id)).toEqual(['held']);
    expect(getCommandSnapshot().lines.map((line) => line.text).join('\n')).toContain('1 object is locked.');
    writeDrawingFile(null);
  });
});
