import { useEffect, useState } from 'react';
import { DWG_VERSIONS, DWG_WRITE_LIMIT, ODA_MISSING, readDwgSettings, writeDwgSettings, type DwgEngineId, type DwgVersionId } from '../engine/formats/dwg';
import { probeOda } from '../lib/oda';

export function DwgSettingsDialog({ onClose }: { onClose: () => void }) {
  const initial = readDwgSettings();
  const [engine, setEngine] = useState<DwgEngineId>(initial.engine);
  const [odaPath, setOdaPath] = useState(initial.odaPath);
  const [version, setVersion] = useState<DwgVersionId>(initial.version);
  const [odaNote, setOdaNote] = useState(ODA_MISSING);

  useEffect(() => {
    let live = true;
    void probeOda(initial.odaPath).then((probe) => {
      if (!live) return;
      setOdaNote(probe.found ? `ODA File Converter found at ${probe.path}.` : probe.message || ODA_MISSING);
    });
    return () => {
      live = false;
    };
  }, [initial.odaPath]);

  const refreshOda = () => {
    void probeOda(odaPath).then((probe) => {
      setOdaNote(probe.found ? `ODA File Converter found at ${probe.path}.` : probe.message || ODA_MISSING);
    });
  };

  return (
    <div className="modal-back" role="presentation" onMouseDown={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-labelledby="dwg-settings-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          writeDwgSettings({ engine, odaPath, version });
          onClose();
        }}
      >
        <header>
          <h2 id="dwg-settings-title">DWG settings</h2>
          <p>LibreDWG is bundled and GPL-3.0. Auto uses ODA File Converter on the desktop when it is installed.</p>
        </header>
        <div className="modal-body">
          <label>
            Engine
            <select value={engine} onChange={(event) => setEngine(event.target.value as DwgEngineId)}>
              <option value="auto">Auto (ODA if found, else LibreDWG)</option>
              <option value="libredwg">LibreDWG</option>
              <option value="oda">ODA File Converter</option>
            </select>
          </label>
          <label>
            ODA File Converter path
            <input value={odaPath} placeholder="ODAFileConverter" onChange={(event) => setOdaPath(event.target.value)} onBlur={refreshOda} />
          </label>
          <label>
            Save version
            <select value={version} onChange={(event) => setVersion(event.target.value as DwgVersionId)}>
              {DWG_VERSIONS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">{odaNote}</p>
          <p className="hint">{DWG_WRITE_LIMIT}</p>
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Save settings
          </button>
        </footer>
      </form>
    </div>
  );
}
