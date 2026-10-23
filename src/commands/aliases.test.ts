import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMMAND_ALIASES, IMPLEMENTED_COMMANDS } from './catalog';
import {
  aliasRows,
  bundledPgp,
  helpText,
  isImplemented,
  parsePgp,
  pgpAliases,
  resolveToken,
  unavailableMessage,
  unknownMessage,
} from './catalog';
import { getCommandSnapshot, IMMEDIATE_COMMANDS, runCommand, setInputValue, submitInput } from './runtime';
import { SESSION_COMMANDS } from './session';
import { getWorkspace, resetWorkspace } from '../view/workspace';

const famous: Record<string, string> = {
  L: 'LINE',
  PL: 'PLINE',
  C: 'CIRCLE',
  A: 'ARC',
  REC: 'RECTANG',
  RECTANGLE: 'RECTANG',
  E: 'ERASE',
  DELETE: 'ERASE',
  M: 'MOVE',
  CO: 'COPY',
  CP: 'COPY',
  RO: 'ROTATE',
  SC: 'SCALE',
  MI: 'MIRROR',
  O: 'OFFSET',
  TR: 'TRIM',
  EX: 'EXTEND',
  F: 'FILLET',
  CHA: 'CHAMFER',
  BR: 'BREAK',
  J: 'JOIN',
  X: 'EXPLODE',
  H: 'HATCH',
  LA: 'LAYER',
  '-LA': '-LAYER',
  LT: 'LINETYPE',
  LTS: 'LTSCALE',
  MA: 'MATCHPROP',
  PR: 'PROPERTIES',
  CH: 'PROPERTIES',
  MO: 'PROPERTIES',
  PROPS: 'PROPERTIES',
  PRCLOSE: 'PROPERTIESCLOSE',
  DI: 'DIST',
  Z: 'ZOOM',
  P: 'PAN',
  RE: 'REGEN',
  REA: 'REGENALL',
  R: 'REDRAW',
  RA: 'REDRAWALL',
  UN: 'UNITS',
  OS: 'OSNAP',
  DS: 'DSETTINGS',
  SE: 'DSETTINGS',
  SN: 'SNAP',
  GR: 'DDGRIPS',
  DT: 'TEXT',
  DTEXT: 'TEXT',
  T: 'MTEXT',
  MT: 'MTEXT',
  ST: 'STYLE',
  AA: 'AREA',
  LI: 'LIST',
  LS: 'LIST',
  PO: 'POINT',
  POL: 'POLYGON',
  DDUCS: 'UCSMAN',
  EXIT: 'QUIT',
  DXFIN: 'OPEN',
  DXFOUT: 'SAVEAS',
  SAVEURL: 'SAVE',
  OPENURL: 'OPEN',
  MAPCGADIST: 'AECCCGADIST',
  EXT: 'EXTRUDE',
};

describe('classic CAD alias file', () => {
  const parsed = parsePgp(bundledPgp());

  it('keeps one row per alias and lets a later duplicate win', () => {
    const keys = parsed.aliases.map((entry) => entry.alias);
    expect(new Set(keys).size).toBe(keys.length);
    expect(pgpAliases().find((entry) => entry.alias === 'DDUCS')?.command).toBe('UCSMAN');
    expect(pgpAliases().find((entry) => entry.alias === 'CP')?.command).toBe('COPY');
    expect(parsed.externals.map((entry) => entry.name)).toEqual(expect.arrayContaining(['DEL', 'DIR', 'SH', 'SHELL', 'START', 'TYPE', 'EXPLORER', 'NOTEPAD', 'PBRUSH']));
  });

  it('resolves every bundled alias, with design command names and user aliases on top', () => {
    for (const [alias, command] of Object.entries(famous)) {
      expect(resolveToken(alias).command).toBe(command);
      expect(resolveToken(alias).known).toBe(true);
    }
    expect(resolveToken('ZE')).toMatchObject({ command: 'ZOOMEXTENTS', source: 'fieldline', implemented: true });
    expect(resolveToken('?')).toMatchObject({ command: 'HELP', source: 'fieldline' });
    expect(resolveToken('CREATESURFACE')).toMatchObject({ source: 'civil', implemented: true });
    expect(resolveToken('CREATECORRIDOR')).toMatchObject({ source: 'civil', implemented: true, known: true });
    expect(resolveToken('TRAVERSEEDITOR')).toMatchObject({ source: 'civil', known: true, retired: true, implemented: false });
    expect(resolveToken('CREATEMASSHAULDIAGRAM')).toMatchObject({ source: 'civil', implemented: true });
    expect(resolveToken('CALCULATESUPERELEVATION').implemented).toBe(true);
    expect(resolveToken('DEL')).toMatchObject({ source: 'external', known: true, implemented: false });
    expect(resolveToken('XYZ').known).toBe(false);
    expect(unknownMessage('XYZ')).toContain('Unknown command "XYZ"');
    expect(unavailableMessage('EXTRUDE')).toBe('EXTRUDE: that command is not in this build.');
    const user = new Map([['CREATESURFACE', 'LINE']]);
    expect(resolveToken('CREATESURFACE', user).command).toBe('LINE');
    for (const row of aliasRows()) {
      const resolved = resolveToken(row.alias);
      expect(resolved.known).toBe(true);
      expect(resolved.command).toBe(row.command);
    }
    const civil = aliasRows().filter((row) => row.source === 'design');
    expect(aliasRows().slice(0, civil.length).every((row) => row.source === 'design')).toBe(true);
    expect(helpText()[2]).toBe('Design commands');
  });

  it('gives every implemented command a handler', () => {
    const handlers = new Set<string>([...SESSION_COMMANDS, ...IMMEDIATE_COMMANDS]);
    for (const command of IMPLEMENTED_COMMANDS) expect(handlers.has(command), command).toBe(true);
    for (const command of handlers) expect(isImplemented(command), command).toBe(true);
  });

  it('writes the alias table used by the README', () => {
    const lines = ['| Alias | Command | Source | Status |', '| --- | --- | --- | --- |'];
    for (const row of aliasRows()) {
      lines.push(`| ${row.alias} | ${row.command} | ${row.source} | ${row.implemented ? 'runs' : 'recognized'} |`);
    }
    writeFileSync('/tmp/fieldline-alias-table.md', lines.join('\n') + '\n');
    expect(lines.length).toBeGreaterThan(400);
  });

  it('registers PR, CH, MO, and PROPS in the command registry and in classic.pgp', () => {
    for (const entry of COMMAND_ALIASES) {
      expect(pgpAliases().find((row) => row.alias === entry.alias)?.command, entry.alias).toBe(entry.command);
      expect(resolveToken(entry.alias), entry.alias).toMatchObject({ command: entry.command, implemented: true, known: true });
    }
  });

  it('opens and closes the Properties palette from the command line', () => {
    resetWorkspace();
    runCommand('PROPERTIESCLOSE');
    expect(getCommandSnapshot().propertiesOpen).toBe(false);
    for (const token of ['PR', 'PROPERTIES', 'CH', 'MO', 'PROPS']) {
      setInputValue(token);
      submitInput();
      const opened = getCommandSnapshot();
      expect(opened.propertiesOpen, token).toBe(true);
      expect(getWorkspace().properties, token).toBe(true);
      expect(opened.lines.at(-2)?.text, token).toBe(`Command: ${token}`);
      expect(opened.lines.at(-1)?.text, token).toBe('Properties palette.');
      setInputValue(token);
      submitInput();
      const closed = getCommandSnapshot();
      expect(closed.propertiesOpen, token).toBe(false);
      expect(getWorkspace().properties, token).toBe(false);
      expect(closed.lines.at(-2)?.text, token).toBe(`Command: ${token}`);
      expect(closed.lines.at(-1)?.text, token).toBe('Properties closed.');
    }
  });
});
