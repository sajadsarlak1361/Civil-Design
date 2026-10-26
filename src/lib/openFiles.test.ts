import { describe, expect, it } from 'vitest';
import { OPEN_ACCEPT, OPEN_EXTENSIONS, OPEN_FILTERS, dialogPath, pathsFromDropPayload, saveFilters } from './openFiles';

describe('open file filters', () => {
  it('shows DXF and DWG in the default dialog filter and the browser accept list', () => {
    const first = OPEN_FILTERS[0];
    expect(first.name).toBe('All supported');
    expect(first.extensions.slice(0, 3)).toEqual(['dxf', 'dwg', 'dwt']);
    for (const extension of OPEN_EXTENSIONS) {
      expect(first.extensions).toContain(extension);
      expect(OPEN_ACCEPT.split(',')).toContain(`.${extension}`);
    }
    expect(OPEN_FILTERS.some((filter) => filter.extensions.includes('dxf'))).toBe(true);
    expect(OPEN_FILTERS.some((filter) => filter.extensions.includes('dwg'))).toBe(true);
    expect(OPEN_FILTERS.some((filter) => filter.extensions.includes('csv'))).toBe(true);
    expect(saveFilters('dwg')[0].extensions).toEqual(['dwg']);
    expect(saveFilters('dxf')[0].extensions).toEqual(['dxf']);
  });

  it('reads a path from a string, a file URL, and a tagged dialog result', () => {
    expect(dialogPath('C:\\drawings\\site.dxf')).toBe('C:\\drawings\\site.dxf');
    expect(dialogPath('file:///C:/drawings/site.dwg')).toBe('C:/drawings/site.dwg');
    expect(dialogPath({ Path: 'C:\\drawings\\site.dxf' })).toBe('C:\\drawings\\site.dxf');
    expect(dialogPath(['', { url: 'file:///tmp/entities.dxf' }])).toBe('/tmp/entities.dxf');
    expect(dialogPath(null)).toBeNull();
  });

  it('reads dropped drawing paths', () => {
    expect(pathsFromDropPayload({ paths: ['C:\\a.dxf', 'C:\\b.dwg'] })).toEqual(['C:\\a.dxf', 'C:\\b.dwg']);
    expect(pathsFromDropPayload({ payload: { paths: ['/tmp/entities.dxf'] } })).toEqual(['/tmp/entities.dxf']);
    expect(pathsFromDropPayload({ payload: '/tmp/entities.dwg' })).toEqual(['/tmp/entities.dwg']);
    expect(pathsFromDropPayload({ position: { x: 1, y: 2 } })).toEqual([]);
    expect(pathsFromDropPayload({ type: 'enter', paths: ['C:\\a.dxf'] })).toEqual([]);
    expect(pathsFromDropPayload({ type: 'over', paths: ['C:\\a.dxf'] })).toEqual([]);
    expect(pathsFromDropPayload({ type: 'leave' })).toEqual([]);
    expect(pathsFromDropPayload({ type: 'drop', paths: ['C:\\a.dxf', 'C:\\b.dwg'] })).toEqual(['C:\\a.dxf', 'C:\\b.dwg']);
  });
});
