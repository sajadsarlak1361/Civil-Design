import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { editDrawing, getDrawingModel, postMessage, runCommand, runPreset, runViewportLayout, runVisualStyle } from '../commands/runtime';
import { civilCommand } from '../engine';
import { parseColorInput } from '../engine/aci';
import { contoursToDxf, generateContours, surfaceToLandXml, trianglesToDxf, volumeReportCsv } from '../engine';
import { applyColorToIds, lockMessage } from '../engine/objects';
import { features } from '../features';
import { DWG_SETTINGS, FILE_IMPORT, REFERENCE_MENU, type FileMenuAction } from './fileMenu';
import { downloadText } from '../lib/download';
import { requestUi } from '../lib/uiBus';
import { fileSlug } from '../lib/format';
import { useProject } from '../state/store';
import { panelsToCollapse } from '../view/chromeLayout';
import { cycleRibbon, patchChrome, rememberActiveView } from '../view/workspace';
import { useWorkspace } from '../view/useWorkspace';
import { DraftPanels } from './DraftRibbon';
import { RibbonIcon } from './RibbonIcon';
import { LayerDropdown } from './LayerDropdown';
import {
  ANALYZE_PANELS,
  ANNOTATE_PANELS,
  HOME_PANELS,
  INSERT_PANELS,
  MANAGE_PANELS,
  OUTPUT_PANELS,
  RIBBON_TABS,
  VIEW_PANELS,
  type RibbonTab,
} from './ribbonCatalog';

interface RibbonItem {
  label: string;
  hint: string;
  command?: string;
  run?: () => void;
}

interface RibbonGroup {
  id: string;
  label: string;
  items: RibbonItem[];
}

export const Ribbon = memo(function Ribbon() {
  const ws = useWorkspace();
  const project = useProject();
  const [tab, setTab] = useState<RibbonTab>('Home');
  const [menuBox, setMenuBox] = useState<{ id: string; top: number; left: number } | null>(null);
  const bodyRef = useRef<HTMLElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!menuBox || !root) return;
    const close = () => setMenuBox(null);
    const onPointer = (event: PointerEvent) => {
      if (!root.contains(event.target as Node)) close();
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('resize', close);
    };
  }, [menuBox]);

  useEffect(() => {
    const node = bodyRef.current;
    if (!node) return;
    const fit = () => {
      const panels = [...node.querySelectorAll<HTMLElement>(':scope > .ribbon-panel')];
      if (ws.ribbonMode !== 'full') {
        panels.forEach((panel) => panel.classList.remove('is-collapsed'));
        return;
      }
      panels.forEach((panel) => {
        if (!panel.classList.contains('is-collapsed') && panel.offsetWidth > 32) panel.dataset.fullWidth = String(panel.offsetWidth);
      });
      const widths = panels.map((panel) => Number(panel.dataset.fullWidth) || panel.offsetWidth);
      const hide = panelsToCollapse(widths, node.clientWidth);
      panels.forEach((panel, index) => {
        const collapse = hide > 0 && index >= panels.length - hide;
        panel.classList.toggle('is-collapsed', collapse);
      });
    };
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    fit();
    return () => observer.disconnect();
  }, [tab, ws.ribbonMode]);

  const choose = (next: RibbonTab) => {
    setMenuBox(null);
    setTab(next);
    if (ws.ribbonMode === 'tabs') patchChrome({ ribbonMode: 'full' });
  };

  const civil = civilPanels();

  return (
    <div className={`ribbon-wrap mode-${ws.ribbonMode}`} ref={rootRef} data-ribbon-mode={ws.ribbonMode}>
      <div className="ribbon-tabs" role="tablist" aria-label="Ribbon tabs">
        {RIBBON_TABS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            data-ribbon-tab={item}
            className={tab === item ? 'active' : ''}
            aria-selected={tab === item}
            onClick={() => choose(item)}
            onDoubleClick={(event) => {
              event.preventDefault();
              cycleRibbon();
            }}
          >
            {item}
          </button>
        ))}
        <button type="button" className="ribbon-min" aria-label="Minimize ribbon" title="Cycle ribbon: full, titles, tabs" onClick={() => cycleRibbon()}>
          {ws.ribbonMode === 'full' ? '▴' : ws.ribbonMode === 'titles' ? '▸' : '▾'}
        </button>
      </div>
      <nav className="ribbon" ref={bodyRef} aria-label={`${tab} ribbon`}>
        {tab === 'Home' && (
          <>
            <DraftPanels names={['Draw', 'Modify', 'Annotation', 'Block', 'Groups']} />
            <LayersPanel />
            <PropertiesPanel />
            <CommandPanel title="Utilities" items={[['Distance', 'DIST'], ['Area', 'AREA'], ['ID', 'ID'], ['List', 'LIST'], ['Regen', 'REGEN']]} />
            <CommandPanel title="Clipboard" items={[['Cut', 'CUTCLIP'], ['Copy', 'COPYCLIP'], ['Paste', 'PASTECLIP'], ['Copy Base', 'COPYBASE']]} />
            <ViewHome projectView={project.state.view} onView={project.setView} onFit={() => { project.requestFit(); postMessage('Zoom extents.'); }} />
          </>
        )}
        {tab === 'Insert' && (
          <>
            <DraftPanels names={['Block']} />
            <ActionPanel title="Reference" items={REFERENCE_MENU} />
            <ActionPanel title="Import" items={[...FILE_IMPORT, DWG_SETTINGS]} />
            <CommandPanel title="Point Cloud" items={[['3D Mesh', 'CREATE3DMESH'], ['Mesh Section', 'MESHSECTION']]} />
          </>
        )}
        {tab === 'Annotate' && <DraftPanels names={['Text', 'Dimensions', 'Leaders', 'Tables', 'Markup']} />}
        {tab === 'View' && <ViewTab onView={project.setView} onFit={() => { project.requestFit(); postMessage('Zoom extents.'); }} />}
        {tab === 'Manage' && (
          <>
            <CommandPanel title="CAD Standards" items={[['Layers', 'LAYER'], ['Purge', 'PURGE'], ['Select Similar', 'SELECTSIMILAR']]} />
            <CommandPanel title="Cleanup" items={[['Overkill', 'OVERKILL'], ['Regen', 'REGEN'], ['Audit', 'REGENALL']]} />
          </>
        )}
        {tab === 'Output' && <OutputTab />}
        {tab === 'Analyze' && (
          <>
            <CommandPanel title="Inquiry" items={[['Distance', 'DIST'], ['Area', 'AREA'], ['ID', 'ID'], ['List', 'LIST']]} />
            <CommandPanel title="Volumes" items={[['Volume Surface', 'CREATESURFACECOMPOSITE'], ['Contours', 'CONTOURS']]} />
          </>
        )}
        {civil
          .filter((panel) => panel.title === tab)
          .map((panel) => (
            <section key={panel.title} className="ribbon-panel" aria-label={panel.title} data-panel={panel.title}>
              <div className="ribbon-tools stack">
                {panel.groups.map((group) => {
                  const primary = group.items.find((item) => item.run) ?? group.items[0];
                  const menu = group.items.length > 1;
                  return (
                    <div key={group.id} className={`ribbon-split sm${menuBox?.id === group.id ? ' open' : ''}`}>
                      <button
                        type="button"
                        className="ribbon-sm"
                        title={primary.hint}
                        data-command={primary.command}
                        onClick={() => {
                          setMenuBox(null);
                          primary.run?.();
                        }}
                      >
                        <RibbonIcon command={primary.command ?? group.id} />
                        <span>{group.label}</span>
                      </button>
                      {menu && (
                        <button
                          type="button"
                          className="ribbon-caret"
                          aria-label={`${group.label} tools`}
                          aria-expanded={menuBox?.id === group.id}
                          onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            const rect = event.currentTarget.getBoundingClientRect();
                            setMenuBox((current) => (current?.id === group.id ? null : { id: group.id, top: rect.bottom + 2, left: Math.min(rect.left, window.innerWidth - 240) }));
                          }}
                        >
                          ▾
                        </button>
                      )}
                      {menu && menuBox?.id === group.id && (
                        <div className="ribbon-menu" role="menu" style={{ top: menuBox.top, left: menuBox.left }}>
                          {group.items.map((item) => (
                            <button
                              key={item.label}
                              type="button"
                              role="menuitem"
                              data-command={item.command}
                              onClick={() => {
                                setMenuBox(null);
                                item.run?.();
                              }}
                            >
                              <strong>{item.label}</strong>
                              <em>{item.hint}</em>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <h2>
                <span>{panel.title}</span>
              </h2>
            </section>
          ))}
      </nav>
      <span className="sr-only">
        {HOME_PANELS.join(' ')} {INSERT_PANELS.join(' ')} {ANNOTATE_PANELS.join(' ')} {VIEW_PANELS.join(' ')} {MANAGE_PANELS.join(' ')} {OUTPUT_PANELS.join(' ')} {ANALYZE_PANELS.join(' ')}
      </span>
    </div>
  );
});

function civilPanels(): { title: string; groups: RibbonGroup[] }[] {
  const command = (id: string): RibbonItem => {
    const spec = civilCommand(id);
    return { label: spec?.label ?? id, hint: spec?.hint ?? id, command: id, run: () => runCommand(id) };
  };
  const panels = [
    {
      title: 'Create Ground Data',
      groups: [
        {
          id: 'points',
          label: 'Points',
          items: [command('CREATEPOINTS'), command('CREATEPOINTGROUP'), { label: 'Import Points', hint: 'CSV, TXT, or LandXML', command: 'IMPORTPOINTS', run: () => runCommand('IMPORTPOINTS') }],
        },
        {
          id: 'surfaces',
          label: 'Surfaces',
          items: [
            { label: 'Create Surface', hint: 'From a point file', command: 'CREATESURFACE', run: () => runCommand('CREATESURFACE') },
            { label: '3D Mesh', hint: 'Ball-pivoting mesh from a scan', command: 'CREATE3DMESH', run: () => runCommand('CREATE3DMESH') },
            { label: 'Mesh Section', hint: 'Tunnel sections along an alignment', command: 'MESHSECTION', run: () => runCommand('MESHSECTION') },
            { label: 'Create from Points', hint: 'PNEZD, PENZD, NEZ, ENZ', command: 'ADDPOINTFILE', run: () => runCommand('ADDPOINTFILE') },
            { label: 'Create from LandXML', hint: 'TIN surfaces and CgPoints', command: 'LANDXMLIN', run: () => runCommand('LANDXMLIN') },
            { label: 'Add Boundary', hint: 'Outer boundary of the active surface', command: 'ADDSURFACEBOUNDARIES', run: () => runCommand('ADDSURFACEBOUNDARIES') },
            { label: 'Add Breaklines', hint: 'Force edges into the TIN', command: 'ADDSURFACEBREAKLINES', run: () => runCommand('ADDSURFACEBREAKLINES') },
            { label: 'Contours', hint: 'Show or hide contours', command: 'CONTOURS', run: () => runCommand('CONTOURS') },
            { label: 'Edit Surface', hint: 'Style, intervals, and rebuild', command: 'EDITSURFACEPROPERTIES', run: () => runCommand('EDITSURFACEPROPERTIES') },
          ],
        },
        { id: 'traverse', label: 'Traverse', items: [command('TRAVERSEEDITOR')] },
        { id: 'figures', label: 'Figures', items: [command('CREATESURVEYFIGURE')] },
        { id: 'survey', label: 'Survey', items: [command('IMPORTSURVEYDATA')] },
      ],
    },
    {
      title: 'Create Design',
      groups: [
        { id: 'parcel', label: 'Parcel', items: [command('CREATEPARCELFROMOBJECTS')] },
        { id: 'feature', label: 'Feature Line', items: [command('CREATEFEATURELINES')] },
        { id: 'grading', label: 'Grading', items: [command('CREATEGRADING')] },
        {
          id: 'alignment',
          label: 'Alignment',
          items: [
            { label: 'Alignment Creation Tools', hint: 'Tangents and circular curves', command: 'CREATEALIGNMENTLAYOUT', run: () => runCommand('CREATEALIGNMENTLAYOUT', { mode: 'layout' }) },
            { label: 'Tangents', hint: 'Angle points, no curves', command: 'CREATEALIGNMENTLAYOUT', run: () => runCommand('CREATEALIGNMENTLAYOUT', { mode: 'tangents' }) },
            { label: 'Curves', hint: 'Circular fillet at each interior PI', command: 'CREATEALIGNMENTLAYOUT', run: () => runCommand('CREATEALIGNMENTLAYOUT', { mode: 'curves' }) },
            { label: 'Spirals', hint: 'Euler spiral into each circular curve', command: 'CREATEALIGNMENTLAYOUT', run: () => runCommand('CREATEALIGNMENTLAYOUT', { mode: 'spirals' }) },
            { label: 'Create from Polyline', hint: 'Use a plan polyline or the surface boundary', command: 'CREATEALIGNMENTENTITIES', run: () => runCommand('CREATEALIGNMENTENTITIES') },
            command('CREATEOFFSETALIGNMENT'),
            command('CALCULATESUPERELEVATION'),
          ],
        },
        {
          id: 'profile',
          label: 'Profile',
          items: [
            { label: 'Create Surface Profile', hint: 'Sample the TIN along the alignment', command: 'CREATEPROFILEFROMSURFACE', run: () => runCommand('CREATEPROFILEFROMSURFACE') },
            { label: 'Profile Creation Tools', hint: 'Parabolic vertical curve above the surface', command: 'CREATEPROFILELAYOUT', run: () => runCommand('CREATEPROFILELAYOUT') },
            command('CREATEPROFILEFROMCORRIDOR'),
          ],
        },
        { id: 'corridor', label: 'Corridor', items: [command('CREATECORRIDOR'), command('CREATEMASSHAULDIAGRAM')] },
        { id: 'intersections', label: 'Intersections', items: [command('CREATEINTERSECTION')] },
        { id: 'assembly', label: 'Assembly', items: [command('CREATEASSEMBLY')] },
        { id: 'pipes', label: 'Pipe Network', items: [command('CREATEPIPENETWORK')] },
        { id: 'pressure', label: 'Pressure Network', items: [command('CREATEPRESSURENETWORK')] },
      ],
    },
    {
      title: 'Profile & Section Views',
      groups: [
        {
          id: 'profile-view',
          label: 'Profile View',
          items: [
            { label: 'Create Profile View', hint: 'Station versus elevation', command: 'CREATEPROFILEVIEW', run: () => runCommand('CREATEPROFILEVIEW') },
            command('CREATEMULTIPLEPROFILEVIEW'),
          ],
        },
        { id: 'sample-lines', label: 'Sample Lines', items: [{ label: 'Sample Lines', hint: 'Lines perpendicular to the alignment', command: 'CREATESAMPLELINES', run: () => runCommand('CREATESAMPLELINES') }] },
        {
          id: 'sections',
          label: 'Section Views',
          items: [
            { label: 'Create Section View', hint: 'One station at a time', command: 'CREATESECTIONVIEW', run: () => runCommand('CREATESECTIONVIEW') },
            { label: 'Create Multiple Section Views', hint: 'Every sample line', command: 'CREATEMULTIPLESECTIONVIEW', run: () => runCommand('CREATEMULTIPLESECTIONVIEW') },
          ],
        },
        { id: 'bands', label: 'Data Bands', items: [command('ADDPROFILEVIEWBANDS')] },
        { id: 'superimpose', label: 'Superimpose', items: [command('SUPERIMPOSEPROFILE')] },
        { id: 'quick', label: 'Quick Profile', items: [command('CREATEQUICKPROFILE')] },
      ],
    },
  ];
  return panels.map((panel) => ({
    ...panel,
    groups: panel.groups.filter((group) => {
      if (!features.survey && (group.id === 'traverse' || group.id === 'figures' || group.id === 'survey')) return false;
      if (!features.pipeNetworks && (group.id === 'pipes' || group.id === 'pressure')) return false;
      return true;
    }),
  }));
}

function LayersPanel() {
  return (
    <section className="ribbon-panel" aria-label="Layers" data-panel="Layers">
      <div className="ribbon-tools layer-tools">
        <div className="ribbon-col">
          <LayerDropdown />
          <ColorControl />
          <button type="button" className="ribbon-sm" data-command="LAYER" title="Layer Properties Manager" onClick={() => runCommand('LAYER')}>
            <RibbonIcon command="LAYER" />
            <span>Properties</span>
          </button>
        </div>
      </div>
      <h2>
        <span>Layers</span>
      </h2>
    </section>
  );
}

function PropertiesPanel() {
  return (
    <CommandPanel title="Properties" items={[['Properties', 'PROPERTIES'], ['Match', 'MATCHPROP'], ['Quick Select', 'QSELECT']]} />
  );
}

function ActionPanel({ title, items }: { title: string; items: FileMenuAction[] }) {
  return (
    <section className="ribbon-panel" aria-label={title} data-panel={title}>
      <div className="ribbon-tools stack">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="ribbon-sm"
            disabled={item.disabled}
            title={item.title || item.command || item.label}
            data-command={item.command ?? item.request}
            onClick={() => {
              if (item.disabled) return;
              if (item.request) requestUi(item.request);
              else if (item.command) runCommand(item.command);
            }}
          >
            <RibbonIcon command={item.command ?? item.id} />
            <span>{item.label.replace('…', '')}</span>
          </button>
        ))}
      </div>
      <h2>
        <span>{title}</span>
      </h2>
    </section>
  );
}

function CommandPanel({ title, items, onRun }: { title: string; items: [string, string][]; onRun?: (command: string) => void }) {
  return (
    <section className="ribbon-panel" aria-label={title} data-panel={title}>
      <div className="ribbon-tools stack">
        {items.map(([label, command]) => (
          <button key={command + label} type="button" className="ribbon-sm" data-command={command} title={command} onClick={() => (onRun ? onRun(command) : runCommand(command))}>
            <RibbonIcon command={command} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <h2>
        <span>{title}</span>
      </h2>
    </section>
  );
}

function ViewHome({ projectView, onView, onFit }: { projectView: string; onView: (view: 'plan' | '3d' | 'split' | 'profile' | 'section') => void; onFit: () => void }) {
  return (
    <section className="ribbon-panel" aria-label="View" data-panel="View">
      <div className="ribbon-tools stack">
        <button type="button" className="ribbon-sm" data-command="ZOOM" title="Zoom extents" onClick={onFit}>
          <RibbonIcon command="ZOOM" />
          <span>Extents</span>
        </button>
        <button type="button" className="ribbon-sm" data-command="PAN" title="Pan" onClick={() => runCommand('PAN')}>
          <RibbonIcon command="PAN" />
          <span>Pan</span>
        </button>
        {(['plan', '3d', 'profile'] as const).map((mode) => (
          <button key={mode} type="button" className={`ribbon-sm${projectView === mode ? ' active' : ''}`} data-view={mode} onClick={() => onView(mode)}>
            <RibbonIcon command={mode === '3d' ? 'VIEW3D' : mode === 'profile' ? 'STATIONLABEL' : 'PLAN'} />
            <span>{mode === '3d' ? '3D' : mode === 'plan' ? 'Plan' : 'Profile'}</span>
          </button>
        ))}
      </div>
      <h2>
        <span>View</span>
      </h2>
    </section>
  );
}

function ViewTab({ onView, onFit }: { onView: (view: 'plan' | '3d' | 'split' | 'profile' | 'section') => void; onFit: () => void }) {
  const ws = useWorkspace();
  return (
    <>
      <CommandPanel title="Viewport Tools" items={[['Extents', 'ZOOMEXTENTS'], ['Pan', 'PAN'], ['Plan', 'PLAN']]} onRun={(command) => (command === 'ZOOMEXTENTS' ? onFit() : runCommand(command))} />
      <section className="ribbon-panel" aria-label="Model Viewports" data-panel="Model Viewports">
        <div className="ribbon-tools stack">
          {([1, 2, 3, 4] as const).map((count) => (
            <button key={count} type="button" className="ribbon-sm" onClick={() => runViewportLayout(count)}>
              <span>{count}</span>
            </button>
          ))}
          <button type="button" className="ribbon-sm" onClick={() => onView('split')}>
            <span>Split</span>
          </button>
        </div>
        <h2>
          <span>Model Viewports</span>
        </h2>
      </section>
      <section className="ribbon-panel" aria-label="Named Views" data-panel="Named Views">
        <div className="ribbon-tools stack">
          <button type="button" className="ribbon-sm" onClick={() => runPreset('top')}>
            <span>Top</span>
          </button>
          <button type="button" className="ribbon-sm" onClick={() => runPreset('sw')}>
            <span>SW</span>
          </button>
          <button type="button" className="ribbon-sm" onClick={() => { rememberActiveView('View 1'); postMessage('Saved view "View 1".'); }}>
            <span>Save View</span>
          </button>
        </div>
        <h2>
          <span>Named Views</span>
        </h2>
      </section>
      <section className="ribbon-panel" aria-label="Visual Styles" data-panel="Visual Styles">
        <div className="ribbon-tools stack">
          <button type="button" className="ribbon-sm" onClick={() => runVisualStyle('2d-wireframe')}>
            <span>2D Wire</span>
          </button>
          <button type="button" className="ribbon-sm" onClick={() => runVisualStyle('wireframe')}>
            <span>Wire</span>
          </button>
          <button type="button" className="ribbon-sm" onClick={() => runVisualStyle('shaded')}>
            <span>Shaded</span>
          </button>
          <button type="button" className="ribbon-sm" onClick={() => runVisualStyle('realistic')}>
            <span>Realistic</span>
          </button>
        </div>
        <h2>
          <span>Visual Styles</span>
        </h2>
      </section>
      <section className="ribbon-panel" aria-label="Palettes" data-panel="Palettes">
        <div className="ribbon-tools stack">
          <button type="button" className="ribbon-sm" onClick={() => patchChrome({ properties: true })}>
            <span>Properties</span>
          </button>
          <button type="button" className="ribbon-sm" onClick={() => patchChrome({ layers: true })}>
            <span>Layers</span>
          </button>
          <button type="button" className="ribbon-sm" onClick={() => patchChrome({ xrefs: true })}>
            <span>Xref</span>
          </button>
          <button type="button" className="ribbon-sm" onClick={() => patchChrome({ toolPalettes: true })}>
            <span>Tools</span>
          </button>
        </div>
        <h2>
          <span>Palettes</span>
        </h2>
      </section>
      <section className="ribbon-panel" aria-label="Interface" data-panel="Interface">
        <div className="ribbon-tools stack">
          <button type="button" className={`ribbon-sm${ws.cleanScreen ? ' active' : ''}`} onClick={() => patchChrome({ cleanScreen: !ws.cleanScreen })}>
            <span>Clean</span>
          </button>
          <button type="button" className={`ribbon-sm${ws.commandLine ? ' active' : ''}`} onClick={() => patchChrome({ commandLine: !ws.commandLine })}>
            <span>Command</span>
          </button>
          <button type="button" className={`ribbon-sm${ws.viewCube ? ' active' : ''}`} onClick={() => patchChrome({ viewCube: !ws.viewCube })}>
            <span>ViewCube</span>
          </button>
          <button type="button" className="ribbon-sm" onClick={() => cycleRibbon()}>
            <span>Ribbon</span>
          </button>
        </div>
        <h2>
          <span>Interface</span>
        </h2>
      </section>
    </>
  );
}

function OutputTab() {
  const project = useProject();
  const { state } = project;
  const active = project.active;
  const exportContours = () => {
    if (!active) return;
    const lines = generateContours(active.points, active.triangles, active.style.minorInterval, active.style.majorInterval, true);
    downloadText(`${fileSlug(active.name)}-contours.dxf`, contoursToDxf(lines, state.unit), 'application/dxf');
  };
  const exportTriangles = () => {
    if (!active) return;
    downloadText(`${fileSlug(active.name)}-tin.dxf`, trianglesToDxf(active.points, active.triangles, state.unit), 'application/dxf');
  };
  const exportXml = () => {
    const xml = surfaceToLandXml(
      state.surfaces.map((surface) => ({ name: surface.name, points: surface.points, triangles: surface.triangles })),
      { projectName: state.name, unit: state.unit },
    );
    downloadText(`${fileSlug(state.name)}.xml`, xml, 'application/xml');
  };
  const exportVolume = () => {
    const result = state.volumeResult;
    if (!result) return;
    const base = state.surfaces.find((surface) => surface.id === state.volumeSetup.baseId);
    const comparison = state.surfaces.find((surface) => surface.id === state.volumeSetup.comparisonId);
    downloadText(
      `${fileSlug(state.name)}-volume.csv`,
      volumeReportCsv({
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
      }),
      'text/csv',
    );
  };
  return (
    <>
      <section className="ribbon-panel" aria-label="Plot" data-panel="Plot">
        <div className="ribbon-tools stack">
          <button type="button" className="ribbon-sm" data-command="EXPORT" onClick={() => runCommand('EXPORT')}>
            <span>Export</span>
          </button>
          <button type="button" className="ribbon-sm" data-command="QSAVE" onClick={() => runCommand('QSAVE')}>
            <span>Save</span>
          </button>
        </div>
        <h2>
          <span>Plot</span>
        </h2>
      </section>
      <section className="ribbon-panel" aria-label="Export" data-panel="Export">
        <div className="ribbon-tools stack">
          <button type="button" className="ribbon-sm" disabled={!active} onClick={exportContours}>
            <span>Contours</span>
          </button>
          <button type="button" className="ribbon-sm" disabled={!active} onClick={exportTriangles}>
            <span>TIN</span>
          </button>
          <button type="button" className="ribbon-sm" disabled={state.surfaces.length === 0} onClick={exportXml}>
            <span>LandXML</span>
          </button>
          <button type="button" className="ribbon-sm" disabled={!state.volumeResult} onClick={exportVolume}>
            <span>Volume</span>
          </button>
        </div>
        <h2>
          <span>Export</span>
        </h2>
      </section>
    </>
  );
}

function ColorControl() {
  const version = useSyncExternalStore(
    (listener) => getDrawingModel().subscribe(listener),
    () => getDrawingModel().version,
  );
  const doc = getDrawingModel().doc;
  void version;
  return (
    <label className="ribbon-color" title="Color">
      <select
        aria-label="Color"
        value={doc.currentColorIndex ? String(doc.currentColorIndex) : doc.currentColor}
        onChange={(event) => {
          const parsed = parseColorInput(event.target.value);
          if (!parsed) return;
          editDrawing(() => {
            doc.currentColor = parsed.color;
            if (parsed.colorIndex) doc.currentColorIndex = parsed.colorIndex;
            else delete doc.currentColorIndex;
            const result = applyColorToIds(doc, doc.selection, event.target.value);
            if (result.locked) postMessage(lockMessage(result.locked));
          });
        }}
      >
        <option value="bylayer">ByLayer</option>
        <option value="byblock">ByBlock</option>
        <option value="1">1 Red</option>
        <option value="2">2 Yellow</option>
        <option value="3">3 Green</option>
        <option value="4">4 Cyan</option>
        <option value="5">5 Blue</option>
        <option value="6">6 Magenta</option>
        <option value="7">7 White</option>
      </select>
    </label>
  );
}
