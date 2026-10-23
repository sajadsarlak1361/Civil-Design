import { describe, expect, it } from 'vitest';
import { emptyDrawing, type DrawEntity } from './drafting';
import { findText, quickSelect, replaceText, selectAll, selectSimilar } from './selecting';

function doc(entities: DrawEntity[]) {
  const drawing = emptyDrawing();
  drawing.entities = entities;
  return drawing;
}

const text = (id: string, content: string, layer = '0'): DrawEntity => ({
  id,
  type: 'text',
  layer,
  color: 'bylayer',
  p: { x: 0, y: 0, z: 0 },
  height: 2.5,
  rotation: 0,
  content,
});

const line = (id: string, layer = '0'): DrawEntity => ({
  id,
  type: 'line',
  layer,
  color: 'bylayer',
  a: { x: 0, y: 0, z: 0 },
  b: { x: 1, y: 0, z: 0 },
});

describe('find and select', () => {
  it('finds and replaces text, including a case-insensitive match', () => {
    const entities = [text('a', 'Flowline A'), text('b', 'BM'), line('c')];
    expect(findText(doc(entities), 'flow').map((hit) => hit.id)).toEqual(['a']);
    const replaced = replaceText(entities, 'flowline', 'CL');
    expect(replaced.count).toBe(1);
    expect(replaced.entities[0]).toMatchObject({ content: 'CL A' });
    expect(replaced.entities[2].type).toBe('line');
  });

  it('selects all, filters with quick select, and selects similar type and layer', () => {
    const drawing = doc([line('a', 'ROAD'), line('b', 'ROAD'), line('c', 'CURB'), text('d', 'STA')]);
    expect(selectAll(drawing)).toEqual(['a', 'b', 'c', 'd']);
    expect(quickSelect(drawing, { type: 'line', layer: 'CURB' })).toEqual(['c']);
    expect(selectSimilar(drawing, ['a'])).toEqual(['a', 'b']);
  });
});
