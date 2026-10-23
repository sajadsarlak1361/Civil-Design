import { useMemo, useState } from 'react';
import { useSyncExternalStore } from 'react';
import {
  armPoint,
  beginPropertyPick,
  closeProperties,
  closeQuickSelect,
  editDrawing,
  getCommandSnapshot,
  getDrawingModel,
  getOverlay,
  postMessage,
  runCommand,
  setVertexMarker,
  subscribeCommandUi,
  subscribeDrawing,
  togglePickadd,
} from '../commands/runtime';
import { LINETYPES } from '../engine/linetypes';
import { LINEWEIGHT_VALUES, lineweightLabel, LINEWEIGHT_BYLAYER, LINEWEIGHT_BYBLOCK, LINEWEIGHT_DEFAULT } from '../engine/lineweights';
import {
  commonValue,
  fieldsFor,
  readProp,
  selectByQuery,
  targetOf,
  VARIES,
  writeProp,
  type PropField,
  type QuickQuery,
} from '../engine/properties';
import { ColorDialog } from './ColorDialog';

export function PropertiesPalette() {
  const version = useSyncExternalStore(
    (listener) => getDrawingModel().subscribe(listener),
    () => getDrawingModel().version,
  );
  const snapshot = useSyncExternalStore(subscribeCommandUi, getCommandSnapshot);
  const doc = getDrawingModel().doc;
  const [kind, setKind] = useState('*');
  const [vertex, setVertex] = useState(0);
  const [colorOpen, setColorOpen] = useState(false);
  const [pointKey, setPointKey] = useState<string | null>(null);
  void version;

  const ids = doc.selection.filter((id) => targetOf(doc, id));
  const kinds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const id of ids) {
      const target = targetOf(doc, id);
      if (!target) continue;
      const name = 'type' in target ? target.type : target.kind;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return counts;
  }, [doc, ids]);
  const shown = ids.filter((id) => {
    if (kind === '*') return true;
    const target = targetOf(doc, id);
    if (!target) return false;
    return ('type' in target ? target.type : target.kind) === kind;
  });
  const first = shown[0] ? targetOf(doc, shown[0]) : null;
  const fields = first ? fieldsFor(first) : [];
  const categories = ['general', 'geometry', 'misc'] as const;

  const commit = (key: string, value: string) => {
    editDrawing(() => {
      const notes: string[] = [];
      for (const id of shown) {
        const error = writeProp(doc, id, key, value, vertex);
        if (error && !notes.includes(error)) notes.push(error);
      }
      if (notes[0]) postMessage(notes[0]);
    });
  };

  const moveVertex = (delta: number) => {
    if (!first || !('type' in first) || first.type !== 'polyline') return;
    const count = first.vertices.length;
    const next = (vertex + delta + count) % count;
    setVertex(next);
    setVertexMarker({ id: first.id, index: next });
  };

  return (
    <aside className="properties-palette" aria-label="Properties">
      <header>
        <strong>Properties</strong>
        <button type="button" onClick={() => closeProperties()} aria-label="Close properties">×</button>
      </header>
      <div className="prop-tools">
        <select value={kind} onChange={(event) => setKind(event.target.value)} aria-label="Object type">
          <option value="*">All ({ids.length})</option>
          {[...kinds.entries()].map(([name, count]) => (
            <option key={name} value={name}>{name} ({count})</option>
          ))}
        </select>
        <button type="button" title="Quick Select" onClick={() => runCommand('QSELECT')}>QSELECT</button>
        <button type="button" title="Select objects" onClick={() => beginPropertyPick()}>{snapshot.picking ? 'Picking…' : 'Select'}</button>
        <button type="button" title="PICKADD" className={snapshot.pickadd ? 'on' : ''} onClick={() => togglePickadd()}>PICKADD</button>
      </div>
      {shown.length === 0 && <p className="prop-empty">No objects selected.</p>}
      {categories.map((category) => {
        const rows = fields.filter((field) => field.category === category);
        if (rows.length === 0) return null;
        return (
          <section key={category}>
            <h3>{category === 'general' ? 'General' : category === 'geometry' ? 'Geometry' : 'Misc'}</h3>
            {rows.map((field) => (
              <PropertyRow
                key={field.key}
                field={field}
                value={shown.length ? commonValue(doc, shown, field.key, vertex) : ''}
                vertex={vertex}
                onVertex={moveVertex}
                onChange={(value) => commit(field.key, value)}
                onColor={() => setColorOpen(true)}
                onPoint={() => setPointKey(field.key.startsWith('start') ? 'start' : 'end')}
              />
            ))}
          </section>
        );
      })}
      {colorOpen && (
        <ColorDialog
          onClose={() => setColorOpen(false)}
          onPick={(color, colorIndex) => {
            commit('color', color === 'bylayer' || color === 'byblock' ? color : colorIndex ? String(colorIndex) : color);
            setColorOpen(false);
          }}
        />
      )}
      {pointKey && (
        <p className="prop-empty">
          Click a point for {pointKey}.{' '}
          <button
            type="button"
            onClick={() => {
              const key = pointKey;
              armPoint((point) => {
                commit(key === 'start' ? 'startX' : 'endX', String(point.x));
                commit(key === 'start' ? 'startY' : 'endY', String(point.y));
                commit(key === 'start' ? 'startZ' : 'endZ', String(point.z));
              });
              setPointKey(null);
            }}
          >
            Arm pick
          </button>
        </p>
      )}
      {snapshot.qselectOpen && <QuickSelect onClose={() => closeQuickSelect()} />}
    </aside>
  );
}

function PropertyRow({
  field,
  value,
  vertex,
  onVertex,
  onChange,
  onColor,
  onPoint,
}: {
  field: PropField;
  value: string;
  vertex: number;
  onVertex: (delta: number) => void;
  onChange: (value: string) => void;
  onColor: () => void;
  onPoint: () => void;
}) {
  const varies = value === VARIES;
  return (
    <label className="prop-row">
      <span>{field.label}</span>
      {field.key === 'vertex' ? (
        <span className="vertex-spin">
          <button type="button" onClick={() => onVertex(-1)} aria-label="Previous vertex">‹</button>
          <b>{vertex + 1}</b>
          <button type="button" onClick={() => onVertex(1)} aria-label="Next vertex">›</button>
        </span>
      ) : field.kind === 'color' ? (
        <button type="button" onClick={onColor}>{value || 'ByLayer'}</button>
      ) : field.kind === 'layer' ? (
        <select value={varies ? '' : value} onChange={(event) => onChange(event.target.value)}>
          {varies && <option value="">{VARIES}</option>}
          {getDrawingModel().doc.layers.map((layer) => <option key={layer.name}>{layer.name}</option>)}
        </select>
      ) : field.kind === 'linetype' ? (
        <select value={varies ? '' : value} onChange={(event) => onChange(event.target.value)}>
          {varies && <option value="">{VARIES}</option>}
          <option>ByLayer</option>
          <option>ByBlock</option>
          {LINETYPES.map((entry) => <option key={entry.name}>{entry.name}</option>)}
        </select>
      ) : field.kind === 'lineweight' ? (
        <select value={varies ? '' : value} onChange={(event) => onChange(event.target.value)}>
          {varies && <option value="">{VARIES}</option>}
          <option>{lineweightLabel(LINEWEIGHT_BYLAYER)}</option>
          <option>{lineweightLabel(LINEWEIGHT_BYBLOCK)}</option>
          <option>{lineweightLabel(LINEWEIGHT_DEFAULT)}</option>
          {LINEWEIGHT_VALUES.map((weight) => <option key={weight}>{lineweightLabel(weight)}</option>)}
        </select>
      ) : field.kind === 'yesno' ? (
        <select value={varies ? '' : value} onChange={(event) => onChange(event.target.value)}>
          {varies && <option value="">{VARIES}</option>}
          <option>Yes</option>
          <option>No</option>
        </select>
      ) : field.kind === 'enum' ? (
        <select value={varies ? '' : value} onChange={(event) => onChange(event.target.value)}>
          {varies && <option value="">{VARIES}</option>}
          {field.options?.map((option) => <option key={option}>{option}</option>)}
        </select>
      ) : field.kind === 'readonly' ? (
        <span className="readonly">{value}</span>
      ) : (
        <span className="prop-edit">
          <input key={`${field.key}:${value}:${vertex}`} defaultValue={varies ? '' : value} placeholder={varies ? VARIES : ''} onBlur={(event) => { if (event.target.value !== value) onChange(event.target.value); }} />
          {(field.key === 'startX' || field.key === 'endX') && <button type="button" title="Pick point" onClick={onPoint}>⌖</button>}
        </span>
      )}
    </label>
  );
}

function QuickSelect({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState<QuickQuery>({ kind: 'line', property: 'layer', operator: '=', value: '0' });
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal qselect" role="dialog" aria-label="Quick Select" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <strong>Quick Select</strong>
          <button type="button" onClick={onClose}>×</button>
        </header>
        <label>Object type
          <select value={query.kind} onChange={(event) => setQuery({ ...query, kind: event.target.value })}>
            <option value="*">All</option>
            {['line', 'polyline', 'circle', 'arc', 'text', 'point', 'block', 'dimension', 'surface', 'contour', 'alignment', 'profile', 'corridor', 'feature-line', 'parcel', 'cogo-point'].map((kind) => <option key={kind}>{kind}</option>)}
          </select>
        </label>
        <label>Property
          <select value={query.property} onChange={(event) => setQuery({ ...query, property: event.target.value as QuickQuery['property'] })}>
            <option value="color">Color</option>
            <option value="layer">Layer</option>
            <option value="linetype">Linetype</option>
            <option value="locked">Locked</option>
          </select>
        </label>
        <label>Operator
          <select value={query.operator} onChange={(event) => setQuery({ ...query, operator: event.target.value as QuickQuery['operator'] })}>
            <option value="=">=</option>
            <option value="<>">&lt;&gt;</option>
            <option value="*">*</option>
          </select>
        </label>
        <label>Value
          <input value={query.value} onChange={(event) => setQuery({ ...query, value: event.target.value })} />
        </label>
        <footer>
          <button
            type="button"
            className="primary"
            onClick={() => {
              const ids = selectByQuery(getDrawingModel().doc, query);
              editDrawing(() => { getDrawingModel().doc.selection = ids; });
              postMessage(`${ids.length} found.`);
              onClose();
            }}
          >
            OK
          </button>
        </footer>
      </div>
    </div>
  );
}

export function QuickProperties() {
  const snapshot = useSyncExternalStore(subscribeCommandUi, getCommandSnapshot);
  const hoverId = useSyncExternalStore(subscribeDrawing, () => getOverlay().hoverId);
  if (!snapshot.quickProperties || !hoverId) return null;
  const doc = getDrawingModel().doc;
  const entity = doc.entities.find((item) => item.id === hoverId);
  if (!entity) return null;
  return (
    <div className="quick-properties">
      <strong>{entity.type.toUpperCase()}</strong>
      <span>Color {readProp(doc, entity.id, 'color')}</span>
      <span>Layer {entity.layer}</span>
      <span>Locked {entity.locked ? 'Yes' : 'No'}</span>
    </div>
  );
}
