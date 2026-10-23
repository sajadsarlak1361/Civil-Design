import { describe, expect, it } from 'vitest';
import { v3 } from '../engine/drafting';
import { suggestCommands } from './autocomplete';
import { CIVIL_COMMANDS, suggestionSources } from './catalog';
import { appendLog, emptyRecall, pushRecall, recallStep } from './history';
import { keywordAbbrev, matchKeyword, parseCoordinate, parsePromptInput } from './parser';

describe('command parser', () => {
  it('parses absolute, relative, and polar coordinates', () => {
    expect(parseCoordinate('10,20', null)).toEqual({ x: 10, y: 20, z: 0 });
    expect(parseCoordinate('1,2,3', null)).toEqual({ x: 1, y: 2, z: 3 });
    expect(parseCoordinate('@5,0', v3(10, 4, 1))).toEqual({ x: 15, y: 4, z: 1 });
    const polar = parseCoordinate('@10<90', v3(0, 0, 0));
    expect(polar?.x).toBeCloseTo(0);
    expect(polar?.y).toBeCloseTo(10);
  });

  it('matches abbreviations ahead of longer prefixes and applies defaults', () => {
    expect(keywordAbbrev('eRase')).toBe('r');
    expect(matchKeyword('r', [{ label: 'eRase' }, { label: 'Copy' }])).toBe('eRase');
    expect(matchKeyword('E', [{ label: 'Extents' }, { label: 'eXit' }])).toBe('Extents');
    const zoom = { head: 'Specify', expect: 'any' as const, keywords: [{ label: 'Extents' }, { label: 'Window' }], def: 'Extents', spaceCommits: true };
    expect(parsePromptInput('', zoom, null, null)).toEqual({ kind: 'keyword', name: 'Extents' });
    const radius = { head: 'Radius', expect: 'number' as const, def: '2.5', spaceCommits: true };
    expect(parsePromptInput('', radius, null, null)).toEqual({ kind: 'number', value: 2.5 });
    const placed = parsePromptInput('5', { head: 'Next', expect: 'point', spaceCommits: true }, v3(0, 0), v3(0, 10));
    expect(placed.kind).toBe('point');
    if (placed.kind === 'point') {
      expect(placed.point.x).toBeCloseTo(0);
      expect(placed.point.y).toBeCloseTo(5);
    }
  });

  it('recalls command history and ranks design command names first', () => {
    let recall = pushRecall(pushRecall(emptyRecall(), 'LINE'), 'ZOOM');
    const up = recallStep(recall, 'up', '');
    expect(up.value).toBe('ZOOM');
    recall = up.state;
    expect(recallStep(recall, 'up', up.value).value).toBe('LINE');
    const log = appendLog([], { text: 'Command: LINE', kind: 'echo' });
    expect(log.at(-1)?.text).toBe('Command: LINE');
    const created = suggestCommands('CREATE', suggestionSources());
    expect(created[0]?.implemented).toBe(true);
    expect(created.some((item) => item.command === 'CREATESURFACE')).toBe(true);
    expect(created.some((item) => item.command === 'CREATECORRIDOR')).toBe(true);
    expect(CIVIL_COMMANDS.some((command) => command.name === created[0]?.command)).toBe(true);
    expect(suggestCommands('L', suggestionSources())[0]?.command).toBe('LINE');
  });
});
