import { useEffect, useRef, useState, useSyncExternalStore, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { contoursToDxf, generateContours, isMeshSurface, looksLikeLandXml, meshSectionCsv, meshToObj, meshToPly, meshToStl, surfaceToLandXml, trianglesToDxf, volumeReportCsv } from './engine';
import { parseDxf, drawingToDxf } from './engine/formats/dxfDoc';
import { classifyFile } from './engine/formats/ingest';
import { readImageInfo } from './engine/formats/image';
import { surfaceToGltf, surfaceToObj, surfaceToStl } from './engine/formats/mesh';
import { drawingToSvg, rgbToPdf } from './engine/formats/plot';
import { readShp } from './engine/formats/shp';
import { pointsToText } from './engine/points';
import { attachXref, markNeedsReload, replaceXrefs, sampleXrefs, updateXrefs } from './engine/xref';
import { getCpuLimit, setCpuLimit } from './engine/budget';
import { heavyBinary, heavyText, readDemOffThread, readGeoTiffOffThread, readLasOffThread, readMeshOffThread, readXyzGridOffThread } from './engine/importWork';
import { resizePool } from './engine/pool';
import { subscribeTasks, taskSnapshot, tasks } from './engine/tasks';
import type { TaskHandle } from './engine/tasks';
import { bindHost, getCommandSnapshot, getDrawingModel, importDrawing, importDxf, importDwgModel, installDrawingHistory, reportLine, subscribeCommandUi, syncToolPrompt } from './commands/runtime';
import { openDwg, saveDwg } from './engine/formats/dwgEngine';
import { DwgSettingsDialog } from './components/DwgSettingsDialog';
import { CommandLine } from './components/CommandLine';
import { LayerChrome, LwDisplayButton } from './components/LayerChrome';
import { MenuBar } from './components/MenuBar';
import { LayerPalette, ToolPalette, XrefPalette } from './components/Palettes';
import { ViewportStage } from './components/ViewportStage';
import { CommandPanel } from './components/CommandPanel';
import { ImportDialog } from './components/ImportDialog';
import { Inspector } from './components/Inspector';
import { Legend } from './components/Legend';
import { NavCursor, NavMenu } from './components/NavMenu';
import { PlanCanvas } from './components/PlanCanvas';
import { ProfileCanvas } from './components/ProfileCanvas';
import { ProjectPanel } from './components/ProjectPanel';
import { CadDialogs } from './components/CadDialogs';
import { PropertiesPalette } from './components/PropertiesPalette';
import { Ribbon } from './components/Ribbon';
import { Scene3D } from './components/Scene3D';
import { SectionCanvas } from './components/SectionCanvas';
import { MeshCreateDialog, MeshSectionDialog } from './components/MeshDialogs';
import { APP_TITLE, COPYRIGHT, COPYRIGHT_NOTE } from './brand';
import { downloadBytes, downloadText } from './lib/download';
import { desktopAvailable, desktopOpen, desktopSave, desktopWatch, onDesktopXrefChanged } from './lib/desktopFiles';
import { rememberRecent } from './lib/recentFiles';
import { onUi } from './lib/uiBus';
import { chromeMetrics, PALETTE_WIDTH } from './view/chromeLayout';
import { patchChrome, setLayout, setVisualStyle } from './view/workspace';
import { useWorkspace } from './view/useWorkspace';
import { fileSlug, formatNumber, formatSlope, unitLabels } from './lib/format';
import { usePlanCursor } from './state/cursor';
import { ProjectProvider, useProject } from './state/store';

export default function App() {
  return (
    <ProjectProvider>
      <Shell />
    </ProjectProvider>
  );
}

function Shell() {
  const project = useProject();
  const projectRef = useRef(project);
  projectRef.current = project;
  const inspectorRef = useRef<(open: boolean) => void>(() => {});
  const [projectOpen, setProjectOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState(PALETTE_WIDTH);
  const [rightWidth, setRightWidth] = useState(PALETTE_WIDTH);
  const [leftPin, setLeftPin] = useState(false);
  const [rightPin, setRightPin] = useState(false);
  const [commandExtra, setCommandExtra] = useState(0);
  const [frameH, setFrameH] = useState(() => (typeof window === 'undefined' ? 1080 : window.innerHeight));
  const ws = useWorkspace();
  const inspectorOpen = ws.properties;
  inspectorRef.current = (open: boolean) => patchChrome({ properties: open });
  const [importFile, setImportFile] = useState<{ name: string; text: string } | null>(null);
  const [meshDialog, setMeshDialog] = useState<null | 'create' | 'section'>(null);
  const [dwgSettings, setDwgSettings] = useState(false);
  const units = unitLabels(project.state.unit);
  const ingestRef = useRef<(name: string, bytes: Uint8Array) => void>(() => {});

  useEffect(() => {
    document.title = APP_TITLE;
    document.getElementById('splash')?.remove();
  }, []);

  useEffect(() => {
    tasks.setLogger((line) => reportLine(line));
  }, []);

  useEffect(() => {
    const onResize = () => setFrameH(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    installDrawingHistory();
    bindHost({
      setView: (view) => projectRef.current.setView(view),
      setTool: (tool) => projectRef.current.setTool(tool),
      cancelTool: () => projectRef.current.cancelTool(),
      finishTool: () => projectRef.current.finishTool(),
      addDraftPoint: (point) => projectRef.current.addDraftPoint(point),
      popDraftPoint: () => projectRef.current.popDraftPoint(),
      getTool: () => projectRef.current.state.tool,
      prepareAlignment: (mode) => projectRef.current.prepareAlignment(mode),
      alignmentFromPoints: (points) => projectRef.current.alignmentFromPoints(points),
      alignmentFromBoundary: () => projectRef.current.alignmentFromBoundary(),
      showProfile: () => projectRef.current.showProfile(),
      createDesignProfile: () => projectRef.current.createDesignProfile(),
      createSampleLines: () => projectRef.current.createSampleLines(),
      showSections: (layout) => projectRef.current.showSections(layout),
      toggleContours: () => projectRef.current.toggleContours(),
      showComingSoon: () => {},
      openCivilCommand: (command) => projectRef.current.openCommand(command),
      dismissCivilCommand: () => projectRef.current.dismissCommand(),
      downloadFile: (filename, text, mime) => downloadText(filename, text, mime),
      openImport: () => document.getElementById('import-file')?.click(),
      openProject: () => {
        void (async () => {
          if (desktopAvailable()) {
            const file = await desktopOpen();
            if (file) {
              ingestRef.current(file.name, file.bytes);
              return;
            }
          }
          document.getElementById('open-file')?.click();
        })();
      },
      saveProject: () => {
        const current = projectRef.current;
        const task = tasks.start({ command: 'QSAVE', title: `Saving "${current.state.name}"`, stages: ['Saving'], blocksInput: true });
        window.setTimeout(() => {
          void (async () => {
            try {
              const json = JSON.stringify(current.toProjectFile(), null, 2);
              const name = `${fileSlug(current.state.name)}.fieldline`;
              if (desktopAvailable()) {
                const result = await desktopSave(name, new TextEncoder().encode(json));
                if (result === 'saved' || result === 'cancelled') {
                  task.finish();
                  return;
                }
              }
              downloadText(`${fileSlug(current.state.name)}.fieldline.json`, json, 'application/json');
              task.finish();
            } catch (error) {
              task.finish();
              window.alert(error instanceof Error ? error.message : 'Could not save the project.');
            }
          })();
        }, 30);
      },
      exportKind: (kind) => {
        const current = projectRef.current;
        const state = current.state;
        const active = current.active;
        if (kind === 'contours' && active && !isMeshSurface(active)) {
          const lines = generateContours(active.points, active.triangles, active.style.minorInterval, active.style.majorInterval, true);
          downloadText(`${fileSlug(active.name)}-contours.dxf`, contoursToDxf(lines, state.unit), 'application/dxf');
        }
        if (kind === 'obj' && active && isMeshSurface(active)) {
          downloadText(`${fileSlug(active.name)}.obj`, meshToObj(active.name, active.points, active.triangles), 'model/obj');
        }
        if (kind === 'stl' && active && isMeshSurface(active)) {
          downloadText(`${fileSlug(active.name)}.stl`, meshToStl(active.name, active.points, active.triangles), 'model/stl');
        }
        if (kind === 'ply' && active && isMeshSurface(active)) {
          downloadText(`${fileSlug(active.name)}.ply`, meshToPly(active.points, active.triangles), 'model/ply');
        }
        if (kind === 'sections' && state.meshSections) {
          downloadText(`${fileSlug(state.name)}-sections.csv`, meshSectionCsv(state.meshSections.sections), 'text/csv');
        }
        if (kind === 'triangles' && active) {
          downloadText(`${fileSlug(active.name)}-tin.dxf`, trianglesToDxf(active.points, active.triangles, state.unit), 'application/dxf');
        }
        if (kind === 'landxml') {
          const xml = surfaceToLandXml(
            state.surfaces.map((surface) => ({ name: surface.name, points: surface.points, triangles: surface.triangles })),
            { projectName: state.name, unit: state.unit },
          );
          downloadText(`${fileSlug(state.name)}.xml`, xml, 'application/xml');
        }
        if (kind === 'volume' && state.volumeResult) {
          const result = state.volumeResult;
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
        }
      },
      showInspector: () => inspectorRef.current(true),
      openMeshCreate: () => setMeshDialog('create'),
      openMeshSection: () => setMeshDialog('section'),
      undoProject: () => projectRef.current.undoSurface(),
      redoProject: () => projectRef.current.redoSurface(),
      newProject: () => projectRef.current.newProject(),
      setUnit: (unit) => projectRef.current.setUnit(unit),
    });
  }, []);

  useEffect(() => {
    syncToolPrompt(project.state.tool, project.state.draft.length);
  }, [project.state.tool, project.state.draft.length]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1099px)');
    const onChange = () => {
      if (media.matches) {
        setProjectOpen(false);
        patchChrome({ properties: false });
      }
    };
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('bench') !== '1') return;
    const bench = {
      seedSurface(cols: number, rows: number, name = 'EG') {
        const count = cols * rows;
        const points = new Array<{ x: number; y: number; z: number }>(count);
        let n = 0;
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            points[n++] = { x, y, z: 30 + 12 * Math.sin(x / 70) + 8 * Math.cos(y / 55) + 0.002 * x };
          }
        }
        projectRef.current.addPoints(name, points);
        return { points: count };
      },
      setView(view: 'plan' | '3d' | 'split' | 'profile' | 'section') {
        projectRef.current.setView(view);
      },
      idle() {
        return taskSnapshot().idle;
      },
      newProject() {
        projectRef.current.newProject();
      },
      showNav() {
        patchChrome({ navBar: true });
      },
      viewports(count: 1 | 2 | 3 | 4) {
        setLayout(count);
        projectRef.current.setView('3d');
      },
      seedMesh(name = 'Scan') {
        const points: { x: number; y: number; z: number }[] = [];
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 16; x++) {
            const angle = (x / 16) * Math.PI * 2;
            points.push({ x: Math.cos(angle) * 18, y: y * 3, z: Math.sin(angle) * 18 + 40 });
          }
        }
        projectRef.current.addMesh({
          name,
          description: '',
          layer: 'MESH',
          color: '#c4a574',
          locked: false,
          points,
          radii: null,
          orient: 'outward',
          maxEdgeLength: null,
          fillHoles: 0,
        });
        return { points: points.length };
      },
    };
    (window as unknown as { fieldlineBench: typeof bench }).fieldlineBench = bench;
  }, []);

  useEffect(() => {
    const demo = new URLSearchParams(window.location.search).get('demo');
    if (demo === 'viewports' || demo === 'styles') {
      setLayout(demo === 'viewports' ? 4 : 1);
      setVisualStyle(demo === 'styles' ? 'elevation' : 'shaded-edges');
      patchChrome({ properties: false, viewCube: true });
      setProjectOpen(false);
      projectRef.current.setView('3d');
    }
    if (demo === 'xref') {
      replaceXrefs(sampleXrefs());
      patchChrome({ xrefs: true, properties: false });
      setProjectOpen(false);
    }
  }, []);

  const ingest = (name: string, bytes: Uint8Array) => {
    rememberRecent(name);
    const classified = classifyFile(name, bytes);
    const stem = name.replace(/\.[^.]+$/, '') || name;
    const textOf = () => new TextDecoder().decode(bytes);
    const fail = (error: unknown, fallback: string) => {
      if (error instanceof Error && error.name === 'AbortError') return;
      window.alert(error instanceof Error ? error.message : fallback);
    };
    const withBusy = <T,>(title: string, heavy: boolean, read: (task?: TaskHandle) => Promise<T>, apply: (value: T) => void, fallback: string) => {
      const task = heavy ? tasks.start({ command: 'OPEN', title, stages: [title], blocksInput: true }) : undefined;
      void read(task)
        .then((value) => {
          task?.finish();
          apply(value);
        })
        .catch((error: unknown) => {
          task?.finish();
          fail(error, fallback);
        });
    };
    if (classified.kind === 'laz') {
      window.alert(classified.reason ?? 'That format is not available offline.');
      return;
    }
    if (classified.kind === 'dwg') {
      withBusy(`Reading DWG "${stem}"`, true, () => openDwg(name, bytes), (imported) => importDwgModel(imported), 'Could not read that DWG.');
      return;
    }
    if (classified.kind === 'project') {
      try {
        project.loadProjectText(textOf());
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'Could not open that project.');
      }
      return;
    }
    if (classified.kind === 'landxml') {
      try {
        project.addLandXml(textOf());
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'Could not read that LandXML file.');
      }
      return;
    }
    if (classified.kind === 'dxf') {
      importDxf(parseDxf(bytes));
      return;
    }
    if (classified.kind === 'las') {
      withBusy(`Reading LAS "${stem}"`, heavyBinary(bytes), (task) => readLasOffThread(bytes, task), (points) => projectRef.current.addPoints(stem, points), 'Could not read that LAS file.');
      return;
    }
    if (classified.kind === 'dem') {
      const text = textOf();
      withBusy(`Reading DEM "${stem}"`, heavyText(text), (task) => readDemOffThread(text, task), (points) => projectRef.current.addPoints(stem, points), 'Could not read that DEM.');
      return;
    }
    if (classified.kind === 'xyz-grid') {
      const text = textOf();
      withBusy(`Reading XYZ grid "${stem}"`, heavyText(text), (task) => readXyzGridOffThread(text, task), (points) => projectRef.current.addPoints(stem, points), 'Could not read that XYZ grid.');
      return;
    }
    if (classified.kind === 'geotiff') {
      withBusy(`Reading GeoTIFF "${stem}"`, heavyBinary(bytes), (task) => readGeoTiffOffThread(bytes, task), (points) => projectRef.current.addPoints(stem, points), 'Could not read that GeoTIFF.');
      return;
    }
    if (classified.kind === 'obj' || classified.kind === 'stl' || classified.kind === 'gltf') {
      const text = textOf();
      const kind = classified.kind;
      withBusy(`Reading ${kind.toUpperCase()} "${stem}"`, heavyText(text), (task) => readMeshOffThread(kind, text, task), (mesh) => projectRef.current.addImportedMesh(stem, mesh.points, mesh.triangles), 'Could not read that mesh.');
      return;
    }
    if (classified.kind === 'shp') {
      const features = readShp(bytes);
      importDrawing(
        features.map((feature) => ({
          id: 's',
          type: 'polyline' as const,
          layer: 'SHP',
          color: 'bylayer',
          closed: feature.type === 'polygon',
          vertices: feature.points.map((point) => ({ x: point.x, y: point.y, z: 0, bulge: 0 })),
        })),
        ['SHP'],
        'SHP',
      );
      return;
    }
    if (classified.kind === 'image') {
      const info = readImageInfo(bytes);
      if (!info) return;
      updateXrefs((doc) =>
        attachXref(doc, {
          name: stem,
          kind: 'image',
          savedPath: name,
          pathType: 'relative',
          snapshot: { entities: [], layers: [] },
          image: info,
          size: bytes.length,
        }),
      );
      patchChrome({ xrefs: true });
      return;
    }
    setImportFile({ name, text: textOf() });
  };
  ingestRef.current = ingest;

  const attachDrawing = (name: string, bytes: Uint8Array, path = name) => {
    const classified = classifyFile(name, bytes);
    if (classified.kind === 'image') {
      ingest(name, bytes);
      return;
    }
    let snapshot = { entities: [] as ReturnType<typeof parseDxf>['entities'], layers: [] as { name: string; color: string; visible: boolean; locked: boolean; lineType: string }[] };
    if (classified.kind === 'dxf') {
      const model = parseDxf(bytes);
      snapshot = {
        entities: model.entities,
        layers: model.layers.map((layer) => ({ name: layer, color: '#e8eef7', visible: true, locked: false, lineType: 'Continuous' })),
      };
    } else if (classified.kind === 'project') {
      const drawing = JSON.parse(new TextDecoder().decode(bytes)) as { drawing?: { entities?: typeof snapshot.entities; layers?: typeof snapshot.layers } };
      snapshot = {
        entities: drawing.drawing?.entities ?? [],
        layers: drawing.drawing?.layers ?? [],
      };
    } else {
      window.alert('Attach a DXF or Civil Design drawing. Images use Image.');
      return;
    }
    updateXrefs((doc) =>
      attachXref(doc, {
        name: name.replace(/\.[^.]+$/, '') || name,
        kind: classified.kind === 'project' ? 'fieldline' : 'dxf',
        savedPath: path,
        pathType: path.includes('/') || path.includes('\\') ? 'full' : 'relative',
        snapshot,
        size: bytes.length,
      }),
    );
    patchChrome({ xrefs: true });
    if (path !== name) void desktopWatch(path);
  };

  const read = async (file: File) => {
    ingest(file.name, new Uint8Array(await file.arrayBuffer()));
  };

  useEffect(() => onDesktopXrefChanged((path) => {
    if (!path) return;
    updateXrefs((doc) => {
      let next = doc;
      for (const record of doc.records) {
        if (record.savedPath === path) next = markNeedsReload(next, record.id);
      }
      return next;
    });
  }), []);

  useEffect(() => onUi((request) => {
    if (request === 'dwg-settings') {
      setDwgSettings(true);
      return;
    }
    if (request === 'xref-attach' || request === 'image-attach') {
      void (async () => {
        if (desktopAvailable()) {
          const file = await desktopOpen();
          if (file) attachDrawing(file.name, file.bytes, file.path);
          return;
        }
        document.getElementById(request === 'image-attach' ? 'image-file' : 'xref-file')?.click();
      })();
      return;
    }
    const current = projectRef.current;
    const slug = fileSlug(current.state.name);
    const active = current.active;
    if (request === 'export-dxf') {
      const doc = getDrawingModel().doc;
      const faces = active
        ? active.triangles.map((triangle) => ({
            a: active.points[triangle[0]],
            b: active.points[triangle[1]],
            c: active.points[triangle[2]],
          }))
        : [];
      downloadText(`${slug}.dxf`, drawingToDxf({ entities: doc.entities, faces, layers: doc.layers.map((layer) => layer.name) }, current.state.unit), 'application/dxf');
    }
    if (request === 'export-landxml') {
      downloadText(
        `${slug}.xml`,
        surfaceToLandXml(
          current.state.surfaces.map((surface) => ({ name: surface.name, points: surface.points, triangles: surface.triangles })),
          {
            projectName: current.state.name,
            unit: current.state.unit,
            alignments: current.state.alignments.map((alignment) => ({
              name: alignment.name,
              startStation: alignment.startStation,
              pis: alignment.pis.map((pi) => ({ x: pi.x, y: pi.y })),
              profile: (alignment.designProfile ?? []).map((pvi) => ({ station: pvi.station, elevation: pvi.elevation })),
            })),
          },
        ),
        'application/xml',
      );
    }
    if (request === 'export-csv' && active) downloadText(`${slug}-points.csv`, pointsToText(active.points, 'PNEZD', ','), 'text/csv');
    if (request === 'export-svg') downloadText(`${slug}.svg`, drawingToSvg(getDrawingModel().doc.entities), 'image/svg+xml');
    if (request === 'export-dwg') {
      const doc = getDrawingModel().doc;
      const faces = active
        ? active.triangles.map((triangle) => ({
            a: active.points[triangle[0]],
            b: active.points[triangle[1]],
            c: active.points[triangle[2]],
          }))
        : [];
      const task = tasks.start({ command: 'DXFOUT', title: `Writing DWG "${current.state.name}"`, stages: ['Writing'], blocksInput: true });
      void saveDwg(
        { entities: doc.entities, faces, layers: doc.layers.map((layer) => layer.name), layerRecords: doc.layers.map((layer) => ({ name: layer.name, color: layer.color, colorIndex: layer.colorIndex ?? 7, lineType: layer.lineType, lineWeight: layer.lineWeight, frozen: layer.frozen, locked: layer.locked, visible: layer.visible })) },
        current.state.unit,
      )
        .then((saved) => {
          task.finish();
          downloadBytes(`${slug}.${saved.extension}`, saved.bytes, saved.extension === 'dwg' ? 'image/vnd.dwg' : 'application/dxf');
          if (saved.extension === 'dxf') window.alert(saved.note);
        })
        .catch((error: unknown) => {
          task.finish();
          window.alert(error instanceof Error ? error.message : 'Could not write that DWG.');
        });
    }
    if ((request === 'export-obj' || request === 'export-stl' || request === 'export-gltf') && active) {
      if (request === 'export-obj') downloadText(`${slug}.obj`, surfaceToObj(active.points, active.triangles), 'model/obj');
      if (request === 'export-stl') downloadText(`${slug}.stl`, surfaceToStl(active.points, active.triangles), 'model/stl');
      if (request === 'export-gltf') downloadText(`${slug}.gltf`, surfaceToGltf(active.points, active.triangles), 'model/gltf+json');
    }
    if (request === 'export-volume' && current.state.volumeResult) {
      const result = current.state.volumeResult;
      const base = current.state.surfaces.find((surface) => surface.id === current.state.volumeSetup.baseId);
      const comparison = current.state.surfaces.find((surface) => surface.id === current.state.volumeSetup.comparisonId);
      downloadText(
        `${slug}-volume.csv`,
        volumeReportCsv({
          project: current.state.name,
          unit: current.state.unit,
          baseName: base?.name ?? 'Base',
          comparisonName: current.state.volumeSetup.mode === 'datum' ? `Datum ${current.state.volumeSetup.datum}` : comparison?.name ?? 'Comparison',
          method: result.method === 'tin-to-tin' ? 'TIN-to-TIN composite' : 'Surface to datum',
          cut: result.cut,
          fill: result.fill,
          net: result.net,
          cutArea: result.cutArea,
          fillArea: result.fillArea,
        }),
        'text/csv',
      );
    }
    if (request === 'export-png' || request === 'export-pdf') {
      const canvas = document.querySelector('canvas.plan-canvas');
      if (!(canvas instanceof HTMLCanvasElement)) return;
      if (request === 'export-png') {
        canvas.toBlob((blob) => {
          if (!blob) return;
          void blob.arrayBuffer().then((buffer) => downloadBytes(`${slug}.png`, new Uint8Array(buffer), 'image/png'));
        }, 'image/png');
      } else {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const rgb = new Uint8Array(canvas.width * canvas.height * 3);
        for (let index = 0, target = 0; index < pixels.data.length; index += 4, target += 3) {
          rgb[target] = pixels.data[index];
          rgb[target + 1] = pixels.data[index + 1];
          rgb[target + 2] = pixels.data[index + 2];
        }
        void rgbToPdf(canvas.width, canvas.height, rgb).then((pdf) => downloadBytes(`${slug}.pdf`, pdf, 'application/pdf'));
      }
    }
  }), []);

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void read(file);
  };

  const view = project.state.view;
  const modelSpace = view === 'plan' || view === '3d' || view === 'split';
  const showStage = modelSpace && (ws.layout > 1 || (ws.visualStyle !== 'shaded' && view !== 'plan'));
  const showPlan = !showStage && (view === 'plan' || view === 'split');
  const show3d = !showStage && (view === '3d' || view === 'split');
  const showProfile = view === 'profile';
  const showSection = view === 'section';
  const toolLabel =
    project.state.tool === 'boundary'
      ? 'Outer boundary'
      : project.state.tool === 'breakline'
        ? 'Breakline'
        : project.state.tool === 'featureline'
          ? 'Feature line'
          : project.state.tool === 'parcel'
            ? 'Parcel'
            : project.state.tool === 'quickprofile'
              ? 'Quick profile'
              : project.state.tool === 'point'
                ? 'Point'
                : project.state.tool === 'sectionline'
                  ? 'Section line'
                  : 'Alignment';

  const clean = ws.cleanScreen;
  const commandSnap = useSyncExternalStore(subscribeCommandUi, getCommandSnapshot, getCommandSnapshot);
  const leftDock = !clean && (projectOpen || ws.layers || ws.xrefs || ws.toolPalettes);
  const rightDock = !clean && (inspectorOpen || commandSnap.propertiesOpen);
  const metrics = chromeMetrics(frameH, clean ? 'tabs' : ws.ribbonMode);
  const rows = [
    `${metrics.menu}px`,
    clean ? '0px' : `${metrics.ribbonWrap}px`,
    'minmax(0, 1fr)',
    !clean && ws.commandLine ? `${metrics.command + commandExtra}px` : '0px',
    !clean && ws.statusBar ? `${metrics.status}px` : '0px',
  ].join(' ');

  const busy = project.state.meshBusy || project.state.volumeBusy;
  const dragWidth = (start: number, event: ReactPointerEvent<HTMLButtonElement>, sign: 1 | -1, setWidth: (value: number) => void) => {
    event.preventDefault();
    const origin = event.clientX;
    const move = (ev: PointerEvent) => setWidth(Math.min(480, Math.max(180, start + sign * (ev.clientX - origin))));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className={`app${clean ? ' clean' : ''}${ws.commandLine ? '' : ' hide-command'}${busy ? ' busy is-progress' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
    <div
      className={`app-grid${metrics.short ? ' is-short' : ''}`}
      style={{
        gridTemplateRows: rows,
        ['--menu-h' as string]: `${metrics.menu}px`,
        ['--tab-h' as string]: `${metrics.tabs}px`,
        ['--ribbon-h' as string]: `${metrics.ribbon}px`,
        ['--status-h' as string]: `${metrics.status}px`,
      }}
    >
      <div className="menu-row">
        <MenuBar />
        <input className="project-name" aria-label="Project name" value={project.state.name} onChange={(event) => project.setName(event.target.value)} />
      </div>
      <Ribbon />
      <div
        className="workspace"
        style={{ gridTemplateColumns: `${leftDock ? `${leftWidth}px ` : ''}minmax(0, 1fr)${rightDock ? ` ${rightWidth}px` : ''}` }}
      >
        {leftDock && (
          <div className="dock-stack" onMouseLeave={() => { if (!leftPin) { setProjectOpen(false); patchChrome({ layers: false, xrefs: false, toolPalettes: false }); } }}>
            <div className="dock-head">
              <strong>Toolspace</strong>
              <button type="button" onClick={() => setLeftPin((pin) => !pin)}>{leftPin ? 'Pinned' : 'Auto-hide'}</button>
              <button type="button" aria-label="Close toolspace" onClick={() => { setProjectOpen(false); patchChrome({ layers: false, xrefs: false, toolPalettes: false }); }}>×</button>
            </div>
            <button type="button" className="dock-resize right" aria-label="Resize toolspace" onPointerDown={(event) => dragWidth(leftWidth, event, 1, setLeftWidth)} />
            {projectOpen && <ProjectPanel onImport={() => document.getElementById('import-file')?.click()} />}
            {ws.layers && <LayerPalette />}
            {ws.xrefs && <XrefPalette />}
            {ws.toolPalettes && <ToolPalette />}
          </div>
        )}
        <main className={`viewport ${view}`} data-drawing="model">
          {!leftDock && !clean && (
            <div className="dock-strips left">
              <button type="button" className="dock-strip" onClick={() => setProjectOpen(true)}>Toolspace</button>
              <button type="button" className="dock-strip" onClick={() => patchChrome({ layers: true })}>Layers</button>
            </div>
          )}
          {showStage && (
            <section className="pane pane-stage">
              <ViewportStage />
            </section>
          )}
          <section className={`pane pane-plan${showPlan ? '' : ' is-inactive'}`} inert={showPlan ? undefined : true}>
              <PlanCanvas active={showPlan} />
              <Legend />
              {project.state.sampleBanner && (
                <div className="banner">
                  <p>Sample project. The existing ground and proposed pad are synthetic terrain, not a survey or a design.</p>
                  <button type="button" onClick={() => project.dismissSample()}>
                    Dismiss
                  </button>
                </div>
              )}
              {project.state.tool !== 'pan' && (
                <div className="tool-chip">
                  <strong>{toolLabel}</strong>
                  {project.state.tool === 'alignment' && (
                    <>
                      <label className="chip-radius">
                        Radius
                        <input
                          type="number"
                          min={0}
                          step={1}
                          aria-label="Curve radius"
                          value={project.state.alignmentRadius}
                          onChange={(event) => project.setAlignmentRadius(Number(event.target.value))}
                        />
                      </label>
                      <label className="chip-radius">
                        Spiral
                        <input
                          type="number"
                          min={0}
                          step={1}
                          aria-label="Spiral length"
                          value={project.state.alignmentSpiral}
                          onChange={(event) => project.setAlignmentSpiral(Number(event.target.value))}
                        />
                      </label>
                    </>
                  )}
                  <span>
                    {project.state.tool === 'point'
                      ? 'Click to place a point · Esc to finish'
                      : `${project.state.draft.length} points · Enter to finish · Esc to cancel`}
                  </span>
                  {project.state.tool !== 'point' && (
                    <button type="button" className="primary" onClick={() => project.finishTool()}>
                      Finish
                    </button>
                  )}
                  <button type="button" onClick={() => project.cancelTool()}>
                    Cancel
                  </button>
                </div>
              )}
            </section>
          <section className={`pane pane-3d${show3d ? '' : ' is-inactive'}`} inert={show3d ? undefined : true}>
              <Scene3D active={show3d} bind={show3d && view === '3d'} />
            </section>
          <section className={`pane pane-profile${showProfile ? '' : ' is-inactive'}`} inert={showProfile ? undefined : true}>
              <ProfileCanvas active={showProfile} />
            </section>
          <section className={`pane pane-section${showSection ? '' : ' is-inactive'}`} inert={showSection ? undefined : true}>
              <SectionCanvas active={showSection} />
            </section>
          {project.state.command && <CommandPanel />}
          {project.state.booting && <div className="empty">Building sample terrain…</div>}
          {!project.state.booting && project.state.surfaces.length === 0 && (
            <div className="empty">
              <h2>No surfaces yet</h2>
              <p>Import points or a LandXML surface, or open the bundled sample terrain.</p>
              <div className="button-row">
                <button type="button" className="primary" onClick={() => void project.loadSample()}>
                  Load sample terrain
                </button>
                <button type="button" onClick={() => document.getElementById('import-file')?.click()}>
                  Import points
                </button>
              </div>
            </div>
          )}
          {!rightDock && !clean && (
            <div className="dock-strips right">
              <button type="button" className="dock-strip" onClick={() => patchChrome({ properties: true })}>Properties</button>
            </div>
          )}
        </main>
        {rightDock && (
          <div className="dock-stack right" onMouseLeave={() => { if (!rightPin) patchChrome({ properties: false }); }}>
            <div className="dock-head">
              <strong>Properties</strong>
              <button type="button" onClick={() => setRightPin((pin) => !pin)}>{rightPin ? 'Pinned' : 'Auto-hide'}</button>
              <button type="button" aria-label="Close properties" onClick={() => patchChrome({ properties: false })}>×</button>
            </div>
            <button type="button" className="dock-resize left" aria-label="Resize properties" onPointerDown={(event) => dragWidth(rightWidth, event, -1, setRightWidth)} />
            {commandSnap.propertiesOpen && <PropertiesPalette />}
            {inspectorOpen && <Inspector />}
          </div>
        )}
      </div>
      <CommandLine collapsed={!ws.commandLine || clean} heightPx={metrics.command + commandExtra} onHeight={(next) => setCommandExtra(Math.max(0, next - metrics.command))} />
      <StatusBar
        unit={units.linear}
        projectStatus={project.state.status}
        meshBusy={project.state.meshBusy}
        onCancelMesh={() => project.cancelMesh()}
        view={view}
        onView={(mode) => project.setView(mode)}
        exaggeration={project.state.exaggeration}
        onExaggeration={(value) => project.setExaggeration(value)}
      />
      </div>
      <div className="overlay-root">
        <BusyCursor />
        <NavMenu />
        <NavCursor />
        <CadDialogs />
        <LayerChrome />
      </div>
      <input
        id="import-file"
        className="hidden-input"
        type="file"
        accept=".csv,.txt,.xyz,.xml,.landxml,.dxf,.dwg,.dwt,.asc,.las,.shp,.tif,.tiff,.png,.jpg,.jpeg,.obj,.stl,.gltf,.fieldline,.json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void read(file);
        }}
      />
      <input
        id="xref-file"
        className="hidden-input"
        type="file"
        accept=".dxf,.json,.fieldline"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          void file.arrayBuffer().then((buffer) => attachDrawing(file.name, new Uint8Array(buffer)));
        }}
      />
      <input
        id="image-file"
        className="hidden-input"
        type="file"
        accept=".png,.jpg,.jpeg"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          void file.arrayBuffer().then((buffer) => ingest(file.name, new Uint8Array(buffer)));
        }}
      />
      <input
        id="open-file"
        className="hidden-input"
        type="file"
        accept=".fieldline,.json,.dxf,.dwg,.dwt,.xml,.landxml,.csv,.txt,.xyz,.asc,.las,.shp,.tif,.tiff,.png,.jpg,.jpeg,.obj,.stl,.gltf"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void read(file);
        }}
      />
      {meshDialog === 'create' && <MeshCreateDialog onClose={() => setMeshDialog(null)} />}
      {meshDialog === 'section' && <MeshSectionDialog onClose={() => setMeshDialog(null)} />}
      {dwgSettings && <DwgSettingsDialog onClose={() => setDwgSettings(false)} />}
      {importFile && (
        <ImportDialog
          filename={importFile.name}
          text={importFile.text}
          onClose={() => setImportFile(null)}
          onPoints={(name, points) => {
            project.addPoints(name, points);
            setImportFile(null);
          }}
          onLandXml={(xml) => {
            try {
              if (!looksLikeLandXml(xml)) throw new Error('Not a LandXML file.');
              project.addLandXml(xml);
              setImportFile(null);
            } catch (error) {
              window.alert(error instanceof Error ? error.message : 'Could not read that LandXML file.');
            }
          }}
        />
      )}
    </div>
  );
}

function BusyCursor() {
  const snap = useSyncExternalStore(subscribeTasks, taskSnapshot, taskSnapshot);
  useEffect(() => {
    const root = document.querySelector('.app');
    if (!root) return;
    root.classList.toggle('is-wait', snap.cursor === 'wait');
    root.classList.toggle('is-progress', snap.cursor === 'progress');
  }, [snap.cursor]);
  return null;
}

function StatusBar({
  unit,
  projectStatus,
  meshBusy,
  onCancelMesh,
  view,
  onView,
  exaggeration,
  onExaggeration,
}: {
  unit: string;
  projectStatus: string;
  meshBusy: boolean;
  onCancelMesh: () => void;
  view: 'plan' | '3d' | 'split' | 'profile' | 'section';
  onView: (view: 'plan' | '3d' | 'split' | 'profile' | 'section') => void;
  exaggeration: number;
  onExaggeration: (value: number) => void;
}) {
  const snap = useSyncExternalStore(subscribeTasks, taskSnapshot, taskSnapshot);
  const cursor = usePlanCursor();
  const [cpu, setCpu] = useState(() => Math.round(getCpuLimit() * 100));
  const meshOnly = meshBusy && snap.idle;
  useEffect(() => {
    if (snap.idle && !meshBusy) return;
    const id = window.setInterval(() => tasks.tick(), 250);
    return () => window.clearInterval(id);
  }, [meshBusy, snap.idle]);
  const primary = snap.tasks[0];
  return (
    <footer className="status" data-busy={snap.idle && !meshBusy ? 'false' : 'true'} data-cursor={meshOnly ? 'progress' : snap.cursor}>
      <span className="status-busy">
        {(!snap.idle || meshOnly) && (
          <svg className="busy-mark" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5 1.5h6M5 14.5h6M6 2.2c0 2.2 2 3 2 5.8s-2 3.4-2 5.5h4c0-2.1-2-2.7-2-5.5s2-3.6 2-5.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        )}
        <strong>{snap.idle ? (meshOnly ? `Busy — ${projectStatus}` : `Ready${projectStatus ? ` · ${projectStatus}` : ''}`) : snap.headline}</strong>
        {!snap.idle && snap.stageTrail && <em className="status-stages">{snap.stageTrail}</em>}
        {!snap.idle && (
          <em>
            {snap.elapsedSec.toFixed(1)} s{snap.etaSec != null ? ` · ETA ${Math.max(1, Math.round(snap.etaSec))} s` : ''}
          </em>
        )}
        {meshBusy ? (
          <button type="button" className="status-cancel" onClick={onCancelMesh}>
            Cancel
          </button>
        ) : (
          !snap.idle &&
          primary?.cancellable && (
            <button type="button" className="status-cancel" onClick={() => tasks.cancel(primary.id)}>
              Cancel
            </button>
          )
        )}
        <LwDisplayButton />
        <span className="status-views" role="group" aria-label="View">
          {(['plan', '3d', 'split', 'profile', 'section'] as const).map((mode) => (
            <button key={mode} type="button" data-view={mode} className={view === mode ? 'on' : ''} onClick={() => onView(mode)}>
              {mode === '3d' ? '3D' : mode === 'plan' ? 'Plan' : mode === 'split' ? 'Split' : mode === 'profile' ? 'Profile' : 'Section'}
            </button>
          ))}
        </span>
        {(view === '3d' || view === 'split') && (
          <label className="exaggeration">
            Exag.
            <input type="range" min={1} max={8} step={0.5} value={exaggeration} aria-label="Vertical exaggeration" onChange={(event) => onExaggeration(Number(event.target.value))} />
          </label>
        )}
        <label className="cpu-limit">
          CPU
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            aria-label="CPU usage limit"
            value={cpu}
            onChange={(event) => {
              const next = Number(event.target.value);
              setCpu(next);
              setCpuLimit(next / 100);
              resizePool();
            }}
          />
          <span>{cpu}%</span>
        </label>
      </span>
      <span className="legal" title={COPYRIGHT_NOTE}>{COPYRIGHT}</span>
      <span className="coords">
        {cursor ? (
          <>
            E {formatNumber(cursor.x, 3)} {unit}
            <i>N {formatNumber(cursor.y, 3)} {unit}</i>
            <i>Z {cursor.z === null ? '—' : `${formatNumber(cursor.z, 3)} ${unit}`}</i>
            <i>Slope {formatSlope(cursor.slope)}</i>
            {cursor.surface && <i>{cursor.surface}</i>}
          </>
        ) : (
          <i>Plan coordinates</i>
        )}
      </span>
    </footer>
  );
}
