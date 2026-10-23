import { useMemo, useState } from 'react';
import { useSyncExternalStore } from 'react';
import { closeLayerManager, editLayers, getDrawingModel } from '../commands/runtime';
import { lineweightLabel } from '../engine/lineweights';
import { LINETYPES } from '../engine/linetypes';
import {
  BUILTIN_FILTERS,
  deleteLayer,
  layersForView,
  layerTemplate,
  nextLayerName,
  restoreNamedLayerState,
  saveLayerState,
  sortLayers,
  type LayerFilter,
  type LayerRec,
} from '../engine/layers';
import { ColorDialog } from './ColorDialog';

export function LayerManager() {
  const version = useSyncExternalStore(
    (listener) => getDrawingModel().subscribe(listener),
    () => getDrawingModel().version,
  );
  const doc = getDrawingModel().doc;
  const [filterId, setFilterId] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>(['0']);
  const [sort, setSort] = useState<{ column: keyof LayerRec; direction: 1 | -1 }>({ column: 'name', direction: 1 });
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [colorFor, setColorFor] = useState<string[] | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [stateName, setStateName] = useState('');
  void version;

  const filters = [...BUILTIN_FILTERS, ...(doc.filters ?? [])];
  const filter = filters.find((item) => item.id === filterId) ?? BUILTIN_FILTERS[0];
  const rows = useMemo(() => sortLayers(layersForView(doc, filter, search), sort.column, sort.direction), [doc, filter, search, sort]);
  const showVp = (doc.viewports ?? []).length > 0;

  const apply = (names: string[], patch: (layer: LayerRec) => void) => {
    editLayers(() => {
      for (const layer of doc.layers) if (names.includes(layer.name)) patch(layer);
    });
  };

  return (
    <div className="modal-back" onMouseDown={() => closeLayerManager()}>
      <div className="modal layer-manager" role="dialog" aria-label="Layer Properties Manager" onMouseDown={(event) => event.stopPropagation()} onClick={() => setMenu(null)}>
        <header>
          <strong>Layer Properties Manager</strong>
          <button type="button" onClick={() => closeLayerManager()} aria-label="Close">×</button>
        </header>
        <div className="layer-body">
          <aside>
            <h3>Filters</h3>
            {filters.map((item) => (
              <button key={item.id} type="button" className={item.id === filter.id ? 'active' : ''} onClick={() => setFilterId(item.id)}>
                {item.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                const name = `Filter${(doc.filters ?? []).length + 1}`;
                const created: LayerFilter = { id: name.toLowerCase(), name, kind: 'property', query: { on: true } };
                editLayers(() => { doc.filters = [...(doc.filters ?? []), created]; });
                setFilterId(created.id);
              }}
            >
              New property filter
            </button>
            <button
              type="button"
              onClick={() => {
                const name = `Group${(doc.filters ?? []).length + 1}`;
                const created: LayerFilter = { id: name.toLowerCase(), name, kind: 'group', layers: selected };
                editLayers(() => { doc.filters = [...(doc.filters ?? []), created]; });
                setFilterId(created.id);
              }}
            >
              New group filter
            </button>
          </aside>
          <div>
            <div className="layer-toolbar">
              <input value={search} placeholder="Search layers" onChange={(event) => setSearch(event.target.value)} />
              <button
                type="button"
                onClick={() => {
                  const name = nextLayerName(doc.layers);
                  editLayers(() => { doc.layers.push(layerTemplate(name)); });
                  setSelected([name]);
                  setRenaming(name);
                }}
              >
                New Layer
              </button>
              <button
                type="button"
                onClick={() => {
                  const name = selected[0];
                  if (!name) return;
                  editLayers(() => { doc.currentLayer = name; });
                }}
              >
                Set Current
              </button>
              <button
                type="button"
                onClick={() => {
                  const notes: string[] = [];
                  editLayers(() => {
                    for (const name of selected) {
                      const error = deleteLayer(doc, name);
                      if (error) notes.push(error);
                    }
                  });
                  if (notes[0]) window.alert(notes[0]);
                }}
              >
                Delete
              </button>
            </div>
            <div className="layer-table-wrap">
              <table className="layer-table">
                <thead>
                  <tr>
                    {columns(showVp).map((column) => (
                      <th key={column.key}>
                        <button type="button" onClick={() => setSort((current) => ({ column: column.key, direction: current.column === column.key && current.direction === 1 ? -1 : 1 }))}>
                          {column.label}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((layer) => (
                    <tr
                      key={layer.name}
                      className={selected.includes(layer.name) ? 'selected' : ''}
                      onClick={(event) => {
                        if (event.shiftKey || event.metaKey || event.ctrlKey) {
                          setSelected((current) => current.includes(layer.name) ? current.filter((name) => name !== layer.name) : [...current, layer.name]);
                        } else setSelected([layer.name]);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        if (!selected.includes(layer.name)) setSelected([layer.name]);
                        setMenu({ x: event.clientX, y: event.clientY });
                      }}
                    >
                      <td>{layer.name === doc.currentLayer ? '✓' : ''}</td>
                      <td>
                        {renaming === layer.name ? (
                          <input
                            autoFocus
                            defaultValue={layer.name}
                            onBlur={(event) => {
                              const next = event.target.value.trim();
                              if (next && !doc.layers.some((item) => item.name.toLowerCase() === next.toLowerCase() && item.name !== layer.name)) {
                                editLayers(() => {
                                  const found = doc.layers.find((item) => item.name === layer.name);
                                  if (!found) return;
                                  const previous = found.name;
                                  found.name = next;
                                  if (doc.currentLayer === previous) doc.currentLayer = next;
                                  for (const entity of doc.entities) if (entity.layer === previous) entity.layer = next;
                                  for (const object of doc.objects ?? []) if (object.layer === previous) object.layer = next;
                                });
                                setSelected([next]);
                              }
                              setRenaming(null);
                            }}
                          />
                        ) : (
                          <button type="button" className="link" onDoubleClick={() => setRenaming(layer.name)}>{layer.name}</button>
                        )}
                      </td>
                      <td><input type="checkbox" checked={layer.visible} onChange={() => apply(selected.includes(layer.name) ? selected : [layer.name], (item) => { item.visible = !item.visible; })} /></td>
                      <td><input type="checkbox" checked={layer.frozen} disabled={layer.name === doc.currentLayer} onChange={() => apply(selected.includes(layer.name) ? selected : [layer.name], (item) => { if (item.name !== doc.currentLayer) item.frozen = !item.frozen; })} /></td>
                      <td><input type="checkbox" checked={layer.locked} onChange={() => apply(selected.includes(layer.name) ? selected : [layer.name], (item) => { item.locked = !item.locked; })} /></td>
                      <td><input type="checkbox" checked={layer.plot} onChange={() => apply(selected.includes(layer.name) ? selected : [layer.name], (item) => { if (item.name.toLowerCase() !== 'defpoints') item.plot = !item.plot; })} /></td>
                      <td><button type="button" className="swatch" style={{ background: layer.color }} onClick={() => setColorFor(selected.includes(layer.name) ? selected : [layer.name])} /></td>
                      <td>
                        <select value={layer.lineType} onChange={(event) => apply(selected.includes(layer.name) ? selected : [layer.name], (item) => { item.lineType = event.target.value; })}>
                          {LINETYPES.map((entry) => <option key={entry.name}>{entry.name}</option>)}
                        </select>
                      </td>
                      <td>{lineweightLabel(layer.lineWeight)}</td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          max={90}
                          value={layer.transparency}
                          onChange={(event) => apply(selected.includes(layer.name) ? selected : [layer.name], (item) => { item.transparency = Math.min(90, Math.max(0, Number(event.target.value) || 0)); })}
                        />
                      </td>
                      <td>{layer.plotStyle}</td>
                      {showVp && <td>{layer.vpFrozen.length ? 'Frozen' : ''}</td>}
                      <td>{layer.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="layer-states">
              <input value={stateName} placeholder="Layer state name" onChange={(event) => setStateName(event.target.value)} />
              <button type="button" onClick={() => { if (stateName.trim()) editLayers(() => saveLayerState(doc, stateName.trim())); }}>Save state</button>
              <button type="button" onClick={() => { if (stateName.trim()) editLayers(() => restoreNamedLayerState(doc, stateName.trim())); }}>Restore</button>
              <span>{(doc.states ?? []).map((state) => state.name).join(', ')}</span>
            </div>
          </div>
        </div>
        {menu && (
          <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
            <button type="button" onClick={() => { const name = selected[0]; if (name) editLayers(() => { doc.currentLayer = name; }); setMenu(null); }}>Set Current</button>
            <button type="button" onClick={() => { const name = nextLayerName(doc.layers); editLayers(() => doc.layers.push(layerTemplate(name))); setSelected([name]); setRenaming(name); setMenu(null); }}>New Layer</button>
            <button type="button" onClick={() => setSelected(doc.layers.map((layer) => layer.name))}>Select All</button>
            <button type="button" onClick={() => { editLayers(() => { for (const layer of doc.layers) layer.visible = selected.includes(layer.name); }); setMenu(null); }}>Isolate</button>
          </div>
        )}
        {colorFor && (
          <ColorDialog
            onClose={() => setColorFor(null)}
            onPick={(color, colorIndex) => {
              if (color === 'bylayer' || color === 'byblock') return;
              apply(colorFor, (layer) => { layer.color = color; layer.colorIndex = colorIndex; });
              setColorFor(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

function columns(showVp: boolean): { key: keyof LayerRec; label: string }[] {
  const columns: { key: keyof LayerRec; label: string }[] = [
    { key: 'name', label: 'Status' },
    { key: 'name', label: 'Name' },
    { key: 'visible', label: 'On' },
    { key: 'frozen', label: 'Freeze' },
    { key: 'locked', label: 'Lock' },
    { key: 'plot', label: 'Plot' },
    { key: 'color', label: 'Color' },
    { key: 'lineType', label: 'Linetype' },
    { key: 'lineWeight', label: 'Lineweight' },
    { key: 'transparency', label: 'Transparency' },
    { key: 'plotStyle', label: 'Plot Style' },
  ];
  if (showVp) columns.push({ key: 'vpFrozen', label: 'New VP Freeze' });
  columns.push({ key: 'description', label: 'Description' });
  return columns;
}
