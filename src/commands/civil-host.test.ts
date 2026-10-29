import { describe, expect, it } from 'vitest';
import type { CadHost } from './host';
import { bindHost, getCommandSnapshot, runCommand } from './runtime';

function host(open: (command: string) => void): CadHost {
  const noop = () => {};
  return {
    setView: noop,
    setTool: noop,
    cancelTool: noop,
    finishTool: noop,
    addDraftPoint: noop,
    popDraftPoint: noop,
    getTool: () => 'pan',
    prepareAlignment: noop,
    alignmentFromPoints: noop,
    alignmentFromBoundary: noop,
    showProfile: noop,
    createDesignProfile: noop,
    createSampleLines: noop,
    showSections: noop,
    beginPlacedView: noop,
    toggleContours: noop,
    showComingSoon: () => open('soon'),
    openCivilCommand: open,
    dismissCivilCommand: noop,
    openImport: noop,
    openProject: noop,
    saveProject: noop,
    exportKind: noop,
    showInspector: noop,
    openMeshCreate: noop,
    openMeshSection: noop,
    undoProject: () => false,
    redoProject: () => false,
    newProject: noop,
    setUnit: noop,
    createVolumeSurface: noop,
  };
}

describe('civil commands on the command line', () => {
  it('opens each former placeholder instead of saying it is not available', () => {
    const opened: string[] = [];
    bindHost(host((command) => opened.push(command)));
    const commands = [
      'CREATEPOINTS',
      'CREATEPOINTGROUP',
      'CREATEPARCELFROMOBJECTS',
      'CREATEFEATURELINES',
      'CREATEGRADING',
      'CREATEOFFSETALIGNMENT',
      'CALCULATESUPERELEVATION',
      'CREATEPROFILEFROMCORRIDOR',
      'CREATECORRIDOR',
      'CREATEMASSHAULDIAGRAM',
      'CREATEINTERSECTION',
      'CREATEASSEMBLY',
      'CREATEMULTIPLEPROFILEVIEW',
      'ADDPROFILEVIEWBANDS',
      'SUPERIMPOSEPROFILE',
      'CREATEQUICKPROFILE',
    ];
    for (const command of commands) runCommand(command);
    expect(opened).toEqual(commands);
    const text = getCommandSnapshot().lines.map((line) => line.text).join('\n');
    expect(text).not.toContain('not yet available');
    for (const command of ['TRAVERSEEDITOR', 'CREATESURVEYFIGURE', 'IMPORTSURVEYDATA', 'CREATEPIPENETWORK', 'CREATEPRESSURENETWORK']) {
      runCommand(command);
    }
    const after = getCommandSnapshot().lines.map((line) => line.text).join('\n');
    expect(after).toContain('TRAVERSEEDITOR: not available in this version');
    expect(after).toContain('CREATEPIPENETWORK: not available in this version');
    expect(opened).toEqual(commands);
  });

  it('runs the volume surface command on the host', () => {
    let built = false;
    bindHost({ ...host(() => {}), createVolumeSurface: () => { built = true; } });
    runCommand('CREATESURFACECOMPOSITE');
    expect(built).toBe(true);
    expect(getCommandSnapshot().lines.map((line) => line.text).join('\n')).not.toContain('not in this build');
  });
});
