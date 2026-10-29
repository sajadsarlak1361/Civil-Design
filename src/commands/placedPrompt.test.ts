import { describe, expect, it } from 'vitest';
import { bindHost, cancelInput, clickWorld, getCommandSnapshot, interactionMode, promptForPoint, runCommand } from './runtime';
import type { CadHost } from './host';

function host(): CadHost {
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
    showComingSoon: noop,
    openCivilCommand: noop,
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

describe('view insertion prompt', () => {
  it('waits for a plan click and places nothing when cancelled', () => {
    bindHost(host());
    let placed: { x: number; y: number } | null = null;
    let cancelled = false;
    promptForPoint(
      'Specify section view insertion point',
      (point) => {
        placed = point;
      },
      () => {
        cancelled = true;
      },
    );
    expect(interactionMode()).toBe('point');
    expect(getCommandSnapshot().promptHead).toBe('Specify section view insertion point');
    cancelInput();
    expect(cancelled).toBe(true);
    expect(placed).toBeNull();
    expect(interactionMode()).toBe('idle');
  });

  it('inserts at the clicked world point', () => {
    bindHost(host());
    let placed: { x: number; y: number; z: number } | null = null;
    promptForPoint('Specify profile view insertion point', (point) => {
      placed = point;
    });
    expect(clickWorld({ x: 120, y: 45, z: 0 })).toBe(true);
    expect(placed).toEqual({ x: 120, y: 45, z: 0 });
    expect(interactionMode()).toBe('idle');
  });

  it('drops a pending insertion when another command starts', () => {
    bindHost(host());
    let cancelled = false;
    promptForPoint('Specify profile view insertion point', () => {}, () => {
      cancelled = true;
    });
    runCommand('LINE');
    expect(cancelled).toBe(true);
    cancelInput();
  });
});
