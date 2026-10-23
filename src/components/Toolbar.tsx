import { useEffect, useRef, useState } from 'react';
import { APP_NAME } from '../brand';
import { contoursToDxf, generateContours, surfaceToLandXml, trianglesToDxf, volumeReportCsv } from '../engine';
import { downloadText } from '../lib/download';
import { fileSlug } from '../lib/format';
import { useProject } from '../state/store';
import { IconFit } from './Icons';

interface ToolbarProps {
  onImport: () => void;
  onOpen: () => void;
  projectOpen: boolean;
  inspectorOpen: boolean;
  onToggleProject: () => void;
  onToggleInspector: () => void;
}

export function Toolbar({ onImport, onOpen, projectOpen, inspectorOpen, onToggleProject, onToggleInspector }: ToolbarProps) {
  const project = useProject();
  const { state } = project;
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(false);
    };
    window.addEventListener('pointerdown', onPointer);
    return () => window.removeEventListener('pointerdown', onPointer);
  }, [menu]);

  const active = project.active;

  const exportContours = () => {
    if (!active) return;
    const lines = generateContours(active.points, active.triangles, active.style.minorInterval, active.style.majorInterval, true);
    downloadText(`${fileSlug(active.name)}-contours.dxf`, contoursToDxf(lines, state.unit), 'application/dxf');
    setMenu(false);
  };
  const exportTriangles = () => {
    if (!active) return;
    downloadText(`${fileSlug(active.name)}-tin.dxf`, trianglesToDxf(active.points, active.triangles, state.unit), 'application/dxf');
    setMenu(false);
  };
  const exportXml = () => {
    const xml = surfaceToLandXml(
      state.surfaces.map((surface) => ({ name: surface.name, points: surface.points, triangles: surface.triangles })),
      { projectName: state.name, unit: state.unit },
    );
    downloadText(`${fileSlug(state.name)}.xml`, xml, 'application/xml');
    setMenu(false);
  };
  const exportVolume = () => {
    const result = state.volumeResult;
    if (!result) return;
    const base = state.surfaces.find((surface) => surface.id === state.volumeSetup.baseId);
    const comparison = state.surfaces.find((surface) => surface.id === state.volumeSetup.comparisonId);
    const csv = volumeReportCsv({
      project: state.name,
      unit: state.unit,
      baseName: base?.name ?? 'Base',
      comparisonName: state.volumeSetup.mode === 'datum' ? `Datum ${state.volumeSetup.datum}` : comparison?.name ?? 'Comparison',
      method: result.method === 'tin-to-tin' ? 'TIN-to-TIN composite' : 'Surface to datum',
      cut: result.cut,
      fill: result.fill,
      net: result.net,
      cutArea: result.cutArea,
      fillArea: result.fillArea,
    });
    downloadText(`${fileSlug(state.name)}-volume.csv`, csv, 'text/csv');
    setMenu(false);
  };
  const saveProject = () => {
    downloadText(`${fileSlug(state.name)}.fieldline.json`, JSON.stringify(project.toProjectFile(), null, 2), 'application/json');
  };

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="mark" aria-hidden="true" />
        <div>
          <strong>{APP_NAME}</strong>
          <em>Terrain</em>
        </div>
      </div>
      <input
        className="project-name"
        aria-label="Project name"
        value={state.name}
        onChange={(event) => project.setName(event.target.value)}
      />
      <div className="toolbar-group" role="group" aria-label="Panels">
        <button type="button" className={projectOpen ? 'active' : ''} onClick={onToggleProject}>
          Project
        </button>
        <button type="button" className={inspectorOpen ? 'active' : ''} onClick={onToggleInspector}>
          Inspect
        </button>
      </div>
      <div className="toolbar-group" role="group" aria-label="View">
        {(['plan', '3d', 'split', 'profile', 'section'] as const).map((mode) => (
          <button key={mode} type="button" data-view={mode} className={state.view === mode ? 'active' : ''} onClick={() => project.setView(mode)}>
            {mode === '3d' ? '3D' : mode === 'plan' ? 'Plan' : mode === 'split' ? 'Split' : mode === 'profile' ? 'Profile' : 'Section'}
          </button>
        ))}
        <button type="button" className="icon-btn" title="Zoom extents" onClick={() => project.requestFit()}>
          <IconFit />
        </button>
      </div>
      {(state.view === '3d' || state.view === 'split') && (
        <label className="exaggeration">
          Exag.
          <input
            type="range"
            min={1}
            max={8}
            step={0.5}
            value={state.exaggeration}
            aria-label="Vertical exaggeration"
            onChange={(event) => project.setExaggeration(Number(event.target.value))}
          />
          <span>{state.exaggeration.toFixed(1)}×</span>
        </label>
      )}
      <div className="toolbar-spacer" />
      <button type="button" onClick={onImport}>
        Import
      </button>
      <div className="menu" ref={menuRef}>
        <button type="button" className={menu ? 'active' : ''} onClick={() => setMenu((open) => !open)} aria-expanded={menu}>
          Export
        </button>
        {menu && (
          <div className="menu-pop" role="menu">
            <button type="button" disabled={!active} onClick={exportContours}>
              Contours DXF
            </button>
            <button type="button" disabled={!active} onClick={exportTriangles}>
              Triangles DXF
            </button>
            <button type="button" disabled={state.surfaces.length === 0} onClick={exportXml}>
              LandXML surfaces
            </button>
            <button type="button" disabled={!state.volumeResult} onClick={exportVolume}>
              Volume CSV
            </button>
          </div>
        )}
      </div>
      <button type="button" onClick={saveProject} disabled={state.surfaces.length === 0}>
        Save
      </button>
      <button type="button" onClick={onOpen}>
        Open
      </button>
    </header>
  );
}
