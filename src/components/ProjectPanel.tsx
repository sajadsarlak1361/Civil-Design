import { useState } from 'react';
import { formatStation, surfaceStats } from '../engine';
import { useProject } from '../state/store';
import { IconEye, IconTrash } from './Icons';

export function ProjectPanel({ onImport }: { onImport: () => void }) {
  const project = useProject();
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  return (
    <aside className="panel left">
      <div className="panel-head">
        <span>Prospector</span>
        <select
          aria-label="Linear unit"
          value={project.state.unit}
          onChange={(event) => project.setUnit(event.target.value === 'ft' ? 'ft' : 'm')}
        >
          <option value="m">meters</option>
          <option value="ft">feet</option>
        </select>
      </div>
      <div className="panel-actions">
        <button type="button" className="primary" onClick={() => void project.loadSample()}>
          Load sample
        </button>
        <button type="button" onClick={onImport}>
          Import
        </button>
        <button type="button" onClick={() => project.newProject()}>
          New
        </button>
      </div>
      <p className="panel-note">Surfaces draw in list order. Click a name to edit it. Double-click to rename.</p>
      <ul className="surface-list">
        {project.state.surfaces.length === 0 && <li className="surface-empty">No surfaces in this project.</li>}
        {project.state.surfaces.map((surface) => {
          const stats = surfaceStats(surface.points, surface.triangles);
          const active = surface.id === project.state.activeId;
          return (
            <li key={surface.id} className={active ? 'surface active' : 'surface'}>
              <button
                type="button"
                className="icon-btn"
                aria-label={surface.visible ? `Hide ${surface.name}` : `Show ${surface.name}`}
                onClick={() => project.toggleVisible(surface.id)}
              >
                <IconEye off={!surface.visible} />
              </button>
              <button type="button" className="swatch" style={{ background: surface.style.color }} aria-hidden="true" onClick={() => project.setActive(surface.id)} />
              <div className="surface-copy" onClick={() => project.setActive(surface.id)} onDoubleClick={() => setEditing(surface.id)}>
                {editing === surface.id ? (
                  <input
                    aria-label="Surface name"
                    autoFocus
                    defaultValue={surface.name}
                    onBlur={(event) => {
                      const name = event.target.value.trim();
                      if (name) project.rename(surface.id, name);
                      setEditing(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                      if (event.key === 'Escape') setEditing(null);
                    }}
                  />
                ) : (
                  <strong>{surface.name}</strong>
                )}
                <em>
                  {surface.kind === 'mesh' ? '3D mesh · ' : ''}{stats.triangleCount.toLocaleString()} triangles
                  {surface.source === 'sample' ? ' · sample' : surface.source === 'landxml' ? ' · LandXML' : ''}
                  {surface.boundary ? ' · boundary' : ''}
                  {surface.breaklines.length > 0 ? ` · ${surface.breaklines.length} breakline${surface.breaklines.length === 1 ? '' : 's'}` : ''}
                </em>
              </div>
              {confirm === surface.id ? (
                <span className="confirm">
                  <button type="button" className="danger" onClick={() => { project.removeSurface(surface.id); setConfirm(null); }}>
                    Delete
                  </button>
                  <button type="button" onClick={() => setConfirm(null)}>
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" className="icon-btn" aria-label={`Delete ${surface.name}`} onClick={() => setConfirm(surface.id)}>
                  <IconTrash />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="panel-head">
        <span>Alignments</span>
      </div>
      <ul className="surface-list">
        {project.state.alignments.length === 0 && <li className="surface-empty">No alignments yet.</li>}
        {project.design.map((item) => {
          const alignment = item.record;
          const active = alignment.id === project.state.activeAlignmentId;
          const length = formatStation(alignment.startStation + item.solved.length, project.state.unit);
          return (
            <li key={alignment.id} className={active ? 'surface active' : 'surface'}>
              <button
                type="button"
                className="icon-btn"
                aria-label={alignment.visible ? `Hide ${alignment.name}` : `Show ${alignment.name}`}
                onClick={() => project.toggleAlignmentVisible(alignment.id)}
              >
                <IconEye off={!alignment.visible} />
              </button>
              <div className="surface-copy" onClick={() => project.setActiveAlignment(alignment.id)} onDoubleClick={() => setEditing(alignment.id)}>
                {editing === alignment.id ? (
                  <input
                    aria-label="Alignment name"
                    autoFocus
                    defaultValue={alignment.name}
                    onBlur={(event) => {
                      const name = event.target.value.trim();
                      if (name) project.renameAlignment(alignment.id, name);
                      setEditing(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                      if (event.key === 'Escape') setEditing(null);
                    }}
                  />
                ) : (
                  <strong>{alignment.name}</strong>
                )}
                <em>
                  {length}
                  {alignment.showSampleLines ? ` · ${item.sampleLines.length} sample lines` : ''}
                </em>
              </div>
              {confirm === alignment.id ? (
                <span className="confirm">
                  <button type="button" className="danger" onClick={() => { project.removeAlignment(alignment.id); setConfirm(null); }}>
                    Delete
                  </button>
                  <button type="button" onClick={() => setConfirm(null)}>
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" className="icon-btn" aria-label={`Delete ${alignment.name}`} onClick={() => setConfirm(alignment.id)}>
                  <IconTrash />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
