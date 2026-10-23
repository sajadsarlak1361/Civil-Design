import { beforeEach, describe, expect, it } from 'vitest';
import { cancelInput, getCommandSnapshot, navigationMenu, navigationMode, runCommand, submitInput } from './runtime';
import { NAV_MENU_3D, REALTIME_NAV_PROMPT } from '../view/navigate';
import { getWorkspace, resetWorkspace } from '../view/workspace';

describe('transparent PAN and ZOOM', () => {
  beforeEach(() => {
    cancelInput();
    cancelInput();
  });

  it('suspends the current command for \'PAN and resumes it on Enter', () => {
    runCommand('LINE');
    expect(getCommandSnapshot().promptHead).toContain('first point');
    submitInput("'PAN");
    expect(navigationMode()).toBe('pan');
    expect(getCommandSnapshot().promptHead).toBe(REALTIME_NAV_PROMPT);
    submitInput('');
    expect(navigationMode()).toBeNull();
    expect(getCommandSnapshot().promptHead).toContain('first point');
  });

  it('refuses a transparent command that is not PAN or ZOOM', () => {
    runCommand('LINE');
    runCommand("'LINE");
    const snap = getCommandSnapshot();
    expect(snap.lines.some((line) => line.text.includes('not a transparent command'))).toBe(true);
    expect(snap.promptHead).toContain('first point');
  });

  it('starts constrained orbit from the 3D shortcut menu', () => {
    resetWorkspace();
    runCommand('PAN');
    expect(NAV_MENU_3D).toEqual(['Exit', 'Pan', 'Zoom', '3D Orbit', 'Zoom Window', 'Zoom Extents']);
    navigationMenu('3D Orbit');
    expect(navigationMode()).toBeNull();
    expect(getWorkspace().orbitMode).toBe('constrained');
    expect(getCommandSnapshot().lines.some((line) => line.text.includes('Constrained orbit'))).toBe(true);
  });

  it('keeps PAN alive across the shortcut menu', () => {
    runCommand('PAN');
    expect(navigationMode()).toBe('pan');
    navigationMenu('Zoom');
    expect(navigationMode()).toBe('zoom');
    expect(getCommandSnapshot().promptHead).toBe(REALTIME_NAV_PROMPT);
    navigationMenu('Exit');
    expect(navigationMode()).toBeNull();
  });
});
