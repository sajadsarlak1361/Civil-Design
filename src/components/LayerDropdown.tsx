import { useState } from 'react';
import { useSyncExternalStore } from 'react';
import { editLayers, getDrawingModel, runCommand } from '../commands/runtime';
import { aciHex } from '../engine/aci';
import { findLayer } from '../engine/layers';
import { ColorDialog } from './ColorDialog';

export function LayerDropdown() {
  const version = useSyncExternalStore(
    (listener) => getDrawingModel().subscribe(listener),
    () => getDrawingModel().version,
  );
  const doc = getDrawingModel().doc;
  const [open, setOpen] = useState(false);
  const [colorFor, setColorFor] = useState<string | null>(null);
  const current = findLayer(doc, doc.currentLayer);
  void version;

  return (
    <div className="layer-dropdown">
      <button type="button" className="layer-current" onClick={() => setOpen((value) => !value)} title="Layer">
        <i style={{ background: current?.color ?? '#fff' }} />
        <span>{doc.currentLayer}</span>
      </button>
      <button type="button" title="Layer Properties Manager" onClick={() => runCommand('LAYER')}>
        LA
      </button>
      {open && (
        <div className="layer-menu" role="listbox">
          {doc.layers.map((layer) => (
            <div key={layer.name} className={layer.name === doc.currentLayer ? 'current' : ''}>
              <button type="button" title="Set current" onClick={() => editLayers(() => { doc.currentLayer = layer.name; })}>
                {layer.name === doc.currentLayer ? '✓' : ''}
              </button>
              <button
                type="button"
                title={layer.visible ? 'On' : 'Off'}
                onClick={() => editLayers(() => { layer.visible = !layer.visible; })}
              >
                {layer.visible ? '☀' : '○'}
              </button>
              <button type="button" title={layer.frozen ? 'Frozen' : 'Thawed'} onClick={() => editLayers(() => { if (layer.name !== doc.currentLayer) layer.frozen = !layer.frozen; })}>
                {layer.frozen ? '❄' : '·'}
              </button>
              <button type="button" title={layer.locked ? 'Locked' : 'Unlocked'} onClick={() => editLayers(() => { layer.locked = !layer.locked; })}>
                {layer.locked ? '🔒' : '·'}
              </button>
              <button type="button" className="swatch" style={{ background: layer.color }} title="Color" onClick={() => setColorFor(layer.name)} />
              <button type="button" className="name" onClick={() => editLayers(() => { doc.currentLayer = layer.name; setOpen(false); })}>
                {layer.name}
              </button>
            </div>
          ))}
        </div>
      )}
      {colorFor && (
        <ColorDialog
          onClose={() => setColorFor(null)}
          onPick={(color, colorIndex) => {
            if (color === 'bylayer' || color === 'byblock') return;
            editLayers(() => {
              const layer = findLayer(doc, colorFor);
              if (!layer) return;
              layer.color = color;
              layer.colorIndex = colorIndex;
            });
            setColorFor(null);
          }}
        />
      )}
      <span className="sr-only">{aciHex(7)}</span>
    </div>
  );
}
