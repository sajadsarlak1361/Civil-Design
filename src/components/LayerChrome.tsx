import { useSyncExternalStore } from 'react';
import { closeLayerManager, getCommandSnapshot, subscribeCommandUi, toggleLwDisplay } from '../commands/runtime';
import { LayerManager } from './LayerManager';
import { QuickProperties } from './PropertiesPalette';

export function LayerChrome() {
  const snapshot = useSyncExternalStore(subscribeCommandUi, getCommandSnapshot);
  return (
    <>
      {snapshot.layerManagerOpen && <LayerManager />}
      <QuickProperties />
    </>
  );
}

export function LwDisplayButton() {
  const snapshot = useSyncExternalStore(subscribeCommandUi, getCommandSnapshot);
  return (
    <button type="button" className={snapshot.lwdisplay ? 'on' : ''} title="LWDISPLAY" onClick={() => toggleLwDisplay()}>
      LW
    </button>
  );
}

export function closeLayers(): void {
  closeLayerManager();
}
