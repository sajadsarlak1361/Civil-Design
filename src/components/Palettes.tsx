import { useState, useSyncExternalStore } from 'react';
import { applyXrefBind, getDrawingModel, getView, runCommand } from '../commands/runtime';
import { DWG_VERDICT } from '../engine/formats/dwg';
import {
  detachXref,
  displayStatus,
  getXrefDoc,
  markNeedsReload,
  reloadXref,
  setLayerOverride,
  setXrefPath,
  subscribeXrefs,
  unloadXref,
  updateXrefs,
  xrefLayerRows,
} from '../engine/xref';

const TOOLS = ['LINE', 'PLINE', 'CIRCLE', 'ARC', 'POINT', 'TEXT', 'MOVE', 'COPY', 'ERASE', 'ZOOM', 'PAN'];

export function LayerPalette() {
  const model = getDrawingModel();
  const [, refresh] = useState(0);
  const [filter, setFilter] = useState<'host' | 'xref'>('host');
  const doc = useSyncExternalStore(subscribeXrefs, getXrefDoc, getXrefDoc);
  const xrefRows = xrefLayerRows(doc);
  return (
    <aside className="panel left palette" aria-label="Layers">
      <div className="panel-head">
        <span>Layers</span>
        <span className="xref-actions">
          <button type="button" className={filter === 'host' ? 'active' : ''} onClick={() => setFilter('host')}>Host</button>
          <button type="button" className={filter === 'xref' ? 'active' : ''} onClick={() => setFilter('xref')}>Xref</button>
        </span>
      </div>
      <ul className="palette-list">
        {filter === 'host' && model.doc.layers.map((layer) => (
          <li key={layer.name}>
            <label>
              <input
                type="checkbox"
                checked={layer.visible}
                onChange={() => {
                  model.checkpoint('LAYER');
                  layer.visible = !layer.visible;
                  model.emit();
                  getView()?.redraw();
                  refresh((value) => value + 1);
                }}
              />
              <i style={{ background: layer.color }} />
              {layer.name}
            </label>
          </li>
        ))}
        {filter === 'xref' && xrefRows.length === 0 && <li>No xref layers.</li>}
        {filter === 'xref' && xrefRows.map((layer) => (
          <li key={layer.id}>
            <label>
              <input
                type="checkbox"
                checked={layer.visible}
                onChange={() => {
                  const splitAt = layer.id.indexOf(':');
                  const id = layer.id.slice(0, splitAt);
                  const name = layer.id.slice(splitAt + 1);
                  updateXrefs((current) => setLayerOverride(current, id, name, { visible: !layer.visible }));
                  getView()?.redraw();
                }}
              />
              <i style={{ background: layer.color }} />
              {layer.displayName}
            </label>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export function XrefPalette() {
  const doc = useSyncExternalStore(subscribeXrefs, getXrefDoc, getXrefDoc);
  const selected = doc.records.find((record) => record.id === doc.selectedId) ?? null;
  const act = (update: (id: string) => void) => {
    if (!selected) return;
    update(selected.id);
    getView()?.redraw();
  };
  return (
    <aside className="panel left palette" aria-label="External References">
      <div className="panel-head">
        <span>External References</span>
      </div>
      <div className="xref-actions">
        <button type="button" onClick={() => runCommand('XATTACH')}>Attach</button>
        <button type="button" onClick={() => runCommand('IMAGEATTACH')}>Image</button>
        <button type="button" title={DWG_VERDICT.reason} onClick={() => runCommand('OPEN')}>DWG</button>
        <button type="button" onClick={() => act((id) => updateXrefs((current) => detachXref(current, id)))}>Detach</button>
        <button type="button" onClick={() => act((id) => updateXrefs((current) => unloadXref(current, id)))}>Unload</button>
        <button type="button" onClick={() => act((id) => updateXrefs((current) => reloadXref(current, id, selected?.snapshot ?? null, selected?.snapshot != null)))}>Reload</button>
        <button type="button" onClick={() => selected && applyXrefBind(selected.id, 'bind')}>Bind</button>
        <button type="button" onClick={() => selected && applyXrefBind(selected.id, 'insert')}>Insert</button>
        <button type="button" onClick={() => runCommand('XBIND')}>XBind</button>
        <button type="button" onClick={() => runCommand('XCLIP')}>Clip</button>
        <button type="button" onClick={() => act((id) => updateXrefs((current) => setXrefPath(current, id, selected?.savedPath ?? '', selected?.pathType === 'full' ? 'relative' : selected?.pathType === 'relative' ? 'none' : 'full')))}>
          Path {selected?.pathType ?? ''}
        </button>
        <button type="button" onClick={() => act((id) => updateXrefs((current) => markNeedsReload(current, id)))}>Notify</button>
      </div>
      {doc.records.some((record) => record.notification) && (
        <p className="xref-note">{doc.records.map((record) => record.notification).filter(Boolean).join(' · ')}</p>
      )}
      <table className="xref-table">
        <thead>
          <tr>
            <th>Reference Name</th>
            <th>Status</th>
            <th>Size</th>
            <th>Type</th>
            <th>Date</th>
            <th>Saved Path</th>
          </tr>
        </thead>
        <tbody>
          {doc.records.length === 0 && (
            <tr>
              <td colSpan={6}>No external references in this drawing.</td>
            </tr>
          )}
          {doc.records.map((record) => (
            <tr
              key={record.id}
              className={record.id === doc.selectedId ? 'selected' : ''}
              onClick={() => updateXrefs((current) => ({ ...current, selectedId: record.id }))}
            >
              <td>{record.parentId ? `↳ ${record.name}` : record.name}</td>
              <td>{displayStatus(doc, record)}</td>
              <td>{record.size}</td>
              <td>{record.attachType}</td>
              <td>{record.date.slice(0, 10)}</td>
              <td title={record.savedPath}>{record.pathType}: {record.savedPath}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  );
}

export function ToolPalette() {
  return (
    <aside className="panel left palette" aria-label="Tool Palettes">
      <div className="panel-head">
        <span>Tool Palettes</span>
      </div>
      <div className="palette-tools">
        {TOOLS.map((command) => (
          <button key={command} type="button" onClick={() => runCommand(command)}>
            {command}
          </button>
        ))}
      </div>
    </aside>
  );
}
