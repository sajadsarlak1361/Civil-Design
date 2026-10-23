import { useEffect, useState, type ReactNode } from 'react';
import { APP_NAME, APP_VERSION, COPYRIGHT, COPYRIGHT_NOTE, INDEPENDENCE } from '../brand';
import {
  applyFindReplace,
  applyQuickSelect,
  commandRedo,
  commandUndo,
  eraseSelection,
  getDrawingModel,
  postMessage,
  runCommand,
  runPreset,
  runViewportLayout,
  runVisualStyle,
  startZoom,
  undoSteps,
  zoomSelection,
} from '../commands/runtime';
import { onUi, requestUi, type UiRequest } from '../lib/uiBus';
import { DWG_SETTINGS, FILE_ATTACH, FILE_EXPORT, FILE_IMPORT, type FileMenuAction } from './fileMenu';
import { detachXref, getXrefDoc, reloadXref, subscribeXrefs, updateXrefs } from '../engine/xref';
import { desktopAvailable, desktopOpenPath } from '../lib/desktopFiles';
import { recentFiles } from '../lib/recentFiles';
import { applyPlan, panDirection, restoreView, toggleChrome } from '../view/viewCommands';
import {
  getWorkspace,
  joinActive,
  PRESET_LABELS,
  rememberActiveView,
  VISUAL_STYLE_LABELS,
  VISUAL_STYLES,
  type ViewPreset,
  type ViewportCount,
  type VisualStyle,
} from '../view/workspace';
import { useWorkspace } from '../view/useWorkspace';

export function MenuBar() {
  const ws = useWorkspace();
  const [open, setOpen] = useState<'file' | 'edit' | 'view' | 'help' | null>(null);
  const [dialog, setDialog] = useState<UiRequest | null>(null);
  const [about, setAbout] = useState(false);
  const model = getDrawingModel();
  const undo = model.undoLabel();
  const redo = model.redoLabel();

  useEffect(() => onUi((request) => {
    setOpen(null);
    setDialog(request);
  }), []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (event.composedPath().some((node) => node instanceof Element && node.classList.contains('menubar'))) return;
      const target = event.target;
      if (target instanceof Element && target.closest('.menubar')) return;
      setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null);
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(null);
  const go = (fn: () => void) => {
    close();
    fn();
  };
  const runAction = (item: FileMenuAction) => {
    if (item.disabled) return;
    if (item.command) runCommand(item.command);
    else if (item.request) requestUi(item.request);
  };

  return (
    <nav className="menubar" aria-label="Menu bar">
      <Root id="file" label="File" open={open} setOpen={setOpen}>
        <Item label="New" shortcut="Ctrl+N" onClick={() => go(() => runCommand('NEW'))} />
        <Item label="Open…" shortcut="Ctrl+O" onClick={() => go(() => runCommand('OPEN'))} />
        <Sub label="Import">
          {FILE_IMPORT.map((item) => (
            <Item key={item.id} label={item.label} disabled={item.disabled} title={item.title} onClick={() => go(() => runAction(item))} />
          ))}
        </Sub>
        <Item label={FILE_ATTACH.label} onClick={() => go(() => runAction(FILE_ATTACH))} />
        <Item label={DWG_SETTINGS.label} title={DWG_SETTINGS.title} onClick={() => go(() => runAction(DWG_SETTINGS))} />
        <Sep />
        <Item label="Save" shortcut="Ctrl+S" onClick={() => go(() => runCommand('QSAVE'))} />
        <Item label="Save As…" shortcut="Ctrl+Shift+S" onClick={() => go(() => runCommand('SAVEAS'))} />
        <Sub label="Export">
          {FILE_EXPORT.map((item) => (
            <Item key={item.id} label={item.label} disabled={item.disabled} title={item.title} onClick={() => go(() => runAction(item))} />
          ))}
        </Sub>
        <Sep />
        <Sub label="Recent Files">
          {recentFiles().length === 0 && <Item label="Open…" onClick={() => go(() => runCommand('OPEN'))} />}
          {recentFiles().map((name) => (
            <Item key={name} label={name} onClick={() => go(() => openRecent(name))} />
          ))}
        </Sub>
        <Sep />
        <Item label="Close" onClick={() => go(() => runCommand('QUIT'))} />
        <Item label="Exit" onClick={() => go(() => runCommand('QUIT'))} />
      </Root>
      <Root id="edit" label="Edit" open={open} setOpen={setOpen}>
        <Item label={undo ? `Undo ${undo}` : 'Undo'} shortcut="Ctrl+Z" disabled={!model.canUndo()} onClick={() => go(commandUndo)} />
        <Item label={redo ? `Redo ${redo}` : 'Redo'} shortcut="Ctrl+Y" disabled={!model.canRedo()} onClick={() => go(commandRedo)} />
        {model.undoHistory().slice(0, 8).map((label, index) => (
          <Item key={`${label}-${index}`} label={label} onClick={() => go(() => undoSteps(index + 1))} />
        ))}
        <Sep />
        <Item label="Cut" shortcut="Ctrl+X" onClick={() => go(() => runCommand('CUTCLIP'))} />
        <Item label="Copy" shortcut="Ctrl+C" onClick={() => go(() => runCommand('COPYCLIP'))} />
        <Item label="Copy with Base Point" shortcut="Ctrl+Shift+C" onClick={() => go(() => runCommand('COPYBASE'))} />
        <Item label="Copy Link" onClick={() => go(() => runCommand('COPYLINK'))} />
        <Sep />
        <Item label="Paste" shortcut="Ctrl+V" onClick={() => go(() => runCommand('PASTECLIP'))} />
        <Item label="Paste as Block" shortcut="Ctrl+Shift+V" onClick={() => go(() => runCommand('PASTEBLOCK'))} />
        <Item label="Paste to Original Coordinates" onClick={() => go(() => runCommand('PASTEORIG'))} />
        <Item label="Paste Special…" onClick={() => go(() => runCommand('PASTESPEC'))} />
        <Sep />
        <Item label="Clear" shortcut="Del" onClick={() => go(eraseSelection)} />
        <Item label="Select All" shortcut="Ctrl+A" onClick={() => go(() => runCommand('AI_SELALL'))} />
        <Sep />
        <Item label="OLE Links…" onClick={() => go(() => runCommand('OLELINKS'))} />
        <Sep />
        <Item label="Find and Replace…" onClick={() => go(() => runCommand('FIND'))} />
        <Item label="Quick Select…" onClick={() => go(() => runCommand('QSELECT'))} />
        <Item label="Select Similar" onClick={() => go(() => runCommand('SELECTSIMILAR'))} />
      </Root>
      <Root id="view" label="View" open={open} setOpen={setOpen}>
        <Item label="Redraw" shortcut="R" onClick={() => go(() => runCommand('REDRAW'))} />
        <Item label="Regen" shortcut="RE" onClick={() => go(() => runCommand('REGEN'))} />
        <Item label="Regen All" shortcut="REA" onClick={() => go(() => runCommand('REGENALL'))} />
        <Sep />
        <Sub label="Zoom">
          <Item label="Realtime" onClick={() => go(() => startZoom())} />
          <Item label="Previous" onClick={() => go(() => startZoom('Previous'))} />
          <Item label="Window" onClick={() => go(() => startZoom('Window'))} />
          <Item label="Dynamic" onClick={() => go(() => startZoom('Dynamic'))} />
          <Item label="Scale" onClick={() => go(() => startZoom('Scale'))} />
          <Item label="Center" onClick={() => go(() => startZoom('Center'))} />
          <Item label="Object" onClick={() => go(zoomSelection)} />
          <Item label="In" onClick={() => go(() => startZoom('2x'))} />
          <Item label="Out" onClick={() => go(() => startZoom('0.5x'))} />
          <Item label="All" onClick={() => go(() => startZoom('All'))} />
          <Item label="Extents" onClick={() => go(() => startZoom('Extents'))} />
        </Sub>
        <Sub label="Pan">
          <Item label="Realtime" onClick={() => go(() => runCommand('PAN'))} />
          <Item label="Point" onClick={() => go(() => runCommand('-PAN'))} />
          <Item label="Left" onClick={() => go(() => panDirection('left'))} />
          <Item label="Right" onClick={() => go(() => panDirection('right'))} />
          <Item label="Up" onClick={() => go(() => panDirection('up'))} />
          <Item label="Down" onClick={() => go(() => panDirection('down'))} />
        </Sub>
        <Sub label="Orbit">
          <Item label="Constrained Orbit" onClick={() => go(() => runCommand('3DORBIT'))} />
          <Item label="Free Orbit" onClick={() => go(() => runCommand('3DFORBIT'))} />
          <Item label="Continuous Orbit" onClick={() => go(() => runCommand('3DCORBIT'))} />
        </Sub>
        <Item label="Camera" onClick={() => go(() => runCommand('CAMERA'))} />
        <Item label="Walk" onClick={() => go(() => runCommand('3DWALK'))} />
        <Item label="Fly" onClick={() => go(() => runCommand('3DFLY'))} />
        <Sep />
        <Item label="Clean Screen" shortcut="Ctrl+0" checked={ws.cleanScreen} onClick={() => go(() => runCommand(ws.cleanScreen ? 'CLEANSCREENOFF' : 'CLEANSCREENON'))} />
        <Sep />
        <Sub label="Viewports">
          <Item label="Named Viewports…" onClick={() => go(() => runCommand('VPORTS'))} />
          <Sub label="New Viewports">
            {([1, 2, 3, 4] as ViewportCount[]).map((count) => (
              <Item key={count} label={`${count} Viewport${count === 1 ? '' : 's'}`} checked={ws.layout === count} onClick={() => go(() => runViewportLayout(count))} />
            ))}
          </Sub>
          <Sub label="Join">
            <Item label="Single viewport" checked={ws.layout === 1} onClick={() => go(() => runViewportLayout(1))} />
            {ws.slots.filter((slot) => slot.id !== ws.activeId).map((slot) => (
              <Item key={slot.id} label={PRESET_LABELS[slot.preset === 'custom' ? 'top' : slot.preset]} onClick={() => go(() => joinActive(slot.id))} />
            ))}
          </Sub>
        </Sub>
        <Item label="Named Views…" onClick={() => go(() => runCommand('VIEW'))} />
        <Sub label="3D Views">
          {(['top', 'bottom', 'left', 'right', 'front', 'back', 'sw', 'se', 'ne', 'nw'] as ViewPreset[]).map((preset) => (
            <Item key={preset} label={PRESET_LABELS[preset]} checked={ws.slots.find((slot) => slot.id === ws.activeId)?.preset === preset} onClick={() => go(() => runPreset(preset))} />
          ))}
          <Sep />
          <Sub label="Plan View">
            <Item label="Current UCS" onClick={() => go(applyPlan)} />
            <Item label="World" onClick={() => go(() => runPreset('top'))} />
          </Sub>
        </Sub>
        <Item label="ViewCube" checked={ws.viewCube} onClick={() => go(() => runCommand('VIEWCUBE'))} />
        <Item label="Navigation Bar" checked={ws.navBar} onClick={() => go(() => runCommand('NAVBARDISPLAY'))} />
        <Sep />
        <Sub label="Visual Styles">
          {VISUAL_STYLES.map((style) => (
            <Item key={style} label={VISUAL_STYLE_LABELS[style]} checked={ws.visualStyle === style} onClick={() => go(() => runVisualStyle(style))} />
          ))}
          <Sep />
          <Item label="Visual Styles Manager…" onClick={() => go(() => runCommand('VSCURRENT'))} />
        </Sub>
        <Item label="Render" onClick={() => go(() => runCommand('RENDER'))} />
        <Sep />
        <Sub label="Display">
          <Sub label="UCS Icon">
            <Item label="On" checked={ws.ucsIcon} onClick={() => go(() => { if (!ws.ucsIcon) runCommand('UCSICON'); })} />
            <Item label="Off" checked={!ws.ucsIcon} onClick={() => go(() => { if (ws.ucsIcon) runCommand('UCSICON'); })} />
            <Item label="Origin" checked={ws.ucsAtOrigin} onClick={() => go(() => { toggleChrome('ucsAtOrigin'); postMessage(getWorkspace().ucsAtOrigin ? 'UCS icon at the origin.' : 'UCS icon in the corner.'); })} />
          </Sub>
          <Item label="Text Window" shortcut="F2" checked={ws.textWindow} onClick={() => go(() => toggleChrome('textWindow'))} />
          <Item label="Lineweights" checked={ws.lineweights} onClick={() => go(() => runCommand('LWDISPLAY'))} />
          <Item label="Grid" checked={ws.showGrid} onClick={() => go(() => toggleChrome('showGrid'))} />
        </Sub>
        <Sub label="Toolbars">
          <Item label="Properties" checked={ws.properties} onClick={() => go(() => runCommand(ws.properties ? 'PROPERTIESCLOSE' : 'PROPERTIES'))} />
          <Item label="Layers" checked={ws.layers} onClick={() => go(() => toggleChrome('layers'))} />
          <Item label="External References" checked={ws.xrefs} onClick={() => go(() => toggleChrome('xrefs'))} />
          <Item label="Tool Palettes" checked={ws.toolPalettes} onClick={() => go(() => toggleChrome('toolPalettes'))} />
          <Item label="Command Line" shortcut="Ctrl+9" checked={ws.commandLine} onClick={() => go(() => toggleChrome('commandLine'))} />
          <Item label="Status Bar" checked={ws.statusBar} onClick={() => go(() => toggleChrome('statusBar'))} />
        </Sub>
      </Root>
      <Root id="help" label="Help" open={open} setOpen={setOpen}>
        <Item label="Command List" onClick={() => go(() => runCommand('HELP'))} />
        <Item label={`About ${APP_NAME}`} onClick={() => { close(); setAbout(true); }} />
      </Root>
      {about && <AboutDialog onClose={() => setAbout(false)} />}
      {dialog === 'links' && <LinksDialog onClose={() => setDialog(null)} />}
      {dialog === 'find' && <FindDialog onClose={() => setDialog(null)} />}
      {dialog === 'qselect' && <QuickDialog onClose={() => setDialog(null)} />}
      {dialog === 'paste-special' && <PasteDialog onClose={() => setDialog(null)} />}
      {dialog === 'named-views' && <ViewsDialog onClose={() => setDialog(null)} />}
      {dialog === 'visual-styles' && <StylesDialog onClose={() => setDialog(null)} />}
      {dialog === 'vports' && <VportsDialog onClose={() => setDialog(null)} />}
    </nav>
  );
}

function Root({ id, label, open, setOpen, children }: { id: 'file' | 'edit' | 'view' | 'help'; label: string; open: string | null; setOpen: (id: 'file' | 'edit' | 'view' | 'help' | null) => void; children: ReactNode }) {
  const shown = open === id;
  return (
    <div className={`menu-root${shown ? ' open' : ''}`} onMouseEnter={() => { if (open) setOpen(id); }}>
      <button type="button" aria-expanded={shown} aria-haspopup="true" data-menu={id} onClick={() => setOpen(shown ? null : id)}>
        {label}
      </button>
      {shown && <div className="menu-drop" role="menu">{children}</div>}
    </div>
  );
}

function Sub({ label, children }: { label: string; children: ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <div className={`menu-sub${shown ? ' open' : ''}`} onMouseEnter={() => setShown(true)} onMouseLeave={() => setShown(false)}>
      <button
        type="button"
        role="menuitem"
        aria-haspopup="true"
        aria-expanded={shown}
        onClick={(event) => {
          event.stopPropagation();
          setShown(true);
        }}
      >
        <span>{label}</span>
        <span aria-hidden="true">▸</span>
      </button>
      <div className="menu-drop" role="menu">{children}</div>
    </div>
  );
}

function Item({ label, shortcut, onClick, disabled, title, checked }: { label: string; shortcut?: string; onClick: () => void; disabled?: boolean; title?: string; checked?: boolean }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} title={title} onClick={onClick}>
      <span>{checked ? `✓ ${label}` : label}</span>
      {shortcut ? <kbd>{shortcut}</kbd> : <span />}
    </button>
  );
}

function Sep() {
  return <div className="menu-sep" role="separator" />;
}

function openRecent(name: string): void {
  if (desktopAvailable() && /[/\\]/.test(name)) {
    void desktopOpenPath(name).catch(() => postMessage(`Could not open ${name}.`));
    return;
  }
  postMessage(`Choose ${name} in the file dialog.`);
  runCommand('OPEN');
}

function LinksDialog({ onClose }: { onClose: () => void }) {
  const [doc, setDoc] = useState(getXrefDoc);
  useEffect(() => subscribeXrefs(() => setDoc({ ...getXrefDoc() })), []);
  return (
    <div className="modal-back" role="presentation" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label="Links" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2>Links</h2>
          <p>Drawings and images linked into this model.</p>
        </header>
        <div className="modal-body">
          {doc.records.length === 0 && <p>No linked drawings or images.</p>}
          {doc.records.map((record) => (
            <p key={record.id}>
              {record.name} · {record.kind} · {record.status}
              {' '}
              <button type="button" onClick={() => updateXrefs((current) => reloadXref(current, record.id, record.snapshot, record.snapshot != null))}>Reload</button>
              {' '}
              <button type="button" onClick={() => updateXrefs((current) => detachXref(current, record.id))}>Detach</button>
            </p>
          ))}
        </div>
        <footer>
          <button type="button" onClick={() => { onClose(); runCommand('XATTACH'); }}>Attach</button>
          <button type="button" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-back" role="presentation" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label={`About ${APP_NAME}`} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2>{APP_NAME}</h2>
          <p>Version {APP_VERSION}</p>
        </header>
        <div className="modal-body">
          <p>{INDEPENDENCE}</p>
          <p>Terrain surfaces. After this page loads, it keeps working with no network.</p>
          <p>LibreDWG reads DWG offline in the browser and on the desktop. Saving writes DXF unless ODA File Converter is selected.</p>
          <p>{COPYRIGHT}</p>
          <p>{COPYRIGHT_NOTE}</p>
        </div>
        <footer><button type="button" onClick={onClose}>Close</button></footer>
      </div>
    </div>
  );
}

function FindDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  return (
    <div className="modal-back" role="presentation" onMouseDown={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-label="Find and Replace"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          setCount(applyFindReplace(query, replacement, matchCase));
        }}
      >
        <header>
          <h2>Find and Replace</h2>
          <p>Text, and attributes or dimensions when they carry text.</p>
        </header>
        <div className="modal-body">
          <label>Find<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <label>Replace<input value={replacement} onChange={(event) => setReplacement(event.target.value)} /></label>
          <label className="check-row"><input type="checkbox" checked={matchCase} onChange={(event) => setMatchCase(event.target.checked)} />Match case</label>
          {count !== null && <p className="panel-note">{count} replaced.</p>}
        </div>
        <footer>
          <button type="button" onClick={onClose}>Close</button>
          <button type="submit" className="primary">Replace</button>
        </footer>
      </form>
    </div>
  );
}

function QuickDialog({ onClose }: { onClose: () => void }) {
  const [type, setType] = useState('');
  const [layer, setLayer] = useState('');
  const [color, setColor] = useState('');
  return (
    <div className="modal-back" role="presentation" onMouseDown={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-label="Quick Select"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          applyQuickSelect({ type: type || undefined, layer: layer || undefined, color: color || undefined });
          onClose();
        }}
      >
        <header><h2>Quick Select</h2></header>
        <div className="modal-body">
          <label>Object type
            <select value={type} onChange={(event) => setType(event.target.value)}>
              <option value="">Any</option>
              {['point', 'line', 'polyline', 'circle', 'arc', 'text'].map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label>Layer<input value={layer} onChange={(event) => setLayer(event.target.value)} /></label>
          <label>Color<input value={color} onChange={(event) => setColor(event.target.value)} placeholder="#e8eef7" /></label>
        </div>
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary">Select</button>
        </footer>
      </form>
    </div>
  );
}

function PasteDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-back" role="presentation" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label="Paste Special" onMouseDown={(event) => event.stopPropagation()}>
        <header><h2>Paste Special</h2></header>
        <div className="modal-body button-row">
          <button type="button" onClick={() => { runCommand('PASTECLIP'); onClose(); }}>{APP_NAME} entities</button>
          <button type="button" onClick={() => { runCommand('PASTEORIG'); onClose(); }}>Original coordinates</button>
          <button type="button" onClick={() => { runCommand('PASTEBLOCK'); onClose(); }}>As a block</button>
        </div>
        <footer><button type="button" onClick={onClose}>Cancel</button></footer>
      </div>
    </div>
  );
}

function ViewsDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const [name, setName] = useState('View1');
  return (
    <div className="modal-back" role="presentation" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label="Named Views" onMouseDown={(event) => event.stopPropagation()}>
        <header><h2>View Manager</h2><p>Save and restore the active viewport.</p></header>
        <div className="modal-body">
          <label>Name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <div className="button-row">
            <button type="button" className="primary" onClick={() => rememberActiveView(name)}>Save</button>
          </div>
          <ul className="palette-list">
            {ws.namedViews.length === 0 && <li>No named views.</li>}
            {ws.namedViews.map((view) => (
              <li key={view.name}>
                <button type="button" onClick={() => { restoreView(view.name); onClose(); }}>{view.name}</button>
              </li>
            ))}
          </ul>
        </div>
        <footer><button type="button" onClick={onClose}>Close</button></footer>
      </div>
    </div>
  );
}

function StylesDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  return (
    <div className="modal-back" role="presentation" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label="Visual Styles Manager" onMouseDown={(event) => event.stopPropagation()}>
        <header><h2>Visual Styles Manager</h2><p>Current: {VISUAL_STYLE_LABELS[ws.visualStyle]}</p></header>
        <div className="modal-body style-grid">
          {VISUAL_STYLES.map((style) => (
            <button key={style} type="button" className={style === ws.visualStyle ? 'active' : ''} onClick={() => runVisualStyle(style as VisualStyle)}>
              {VISUAL_STYLE_LABELS[style]}
            </button>
          ))}
        </div>
        <footer><button type="button" onClick={onClose}>Close</button></footer>
      </div>
    </div>
  );
}

function VportsDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  return (
    <div className="modal-back" role="presentation" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label="Viewports" onMouseDown={(event) => event.stopPropagation()}>
        <header><h2>Viewports</h2><p>Tiled model space. Each viewport keeps its own camera.</p></header>
        <div className="modal-body">
          <div className="button-row">
            {([1, 2, 3, 4] as ViewportCount[]).map((count) => (
              <button key={count} type="button" className={ws.layout === count ? 'active' : ''} onClick={() => runViewportLayout(count)}>
                {count}
              </button>
            ))}
          </div>
          <ul className="palette-list">
            {ws.slots.map((slot) => (
              <li key={slot.id}>
                {slot.id === ws.activeId ? 'Active ' : ''}
                {slot.preset === 'custom' ? 'Custom' : PRESET_LABELS[slot.preset]}
                {slot.id !== ws.activeId && (
                  <button type="button" onClick={() => joinActive(slot.id)}>Join</button>
                )}
              </li>
            ))}
          </ul>
        </div>
        <footer><button type="button" onClick={onClose}>Close</button></footer>
      </div>
    </div>
  );
}
