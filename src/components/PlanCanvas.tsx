import { useEffect, useRef, useState } from 'react';
import { alignmentFromPolyline, bvhFor, elevationAt, slopeAt, solveAlignment, type CivilModel } from '../engine';
import { drawingBounds, pickEntity, selectByBox, type DrawingDoc } from '../engine/drafting';
import type { Bounds } from '../engine/geometry';
import { getXrefDoc, pickXref, selectXref, subscribeXrefs, updateXrefs, visibleXrefs, xrefBounds } from '../engine/xref';
import { projectCatalog } from '../engine/objectCatalog';
import { objectPaint, setLockedIds, syncObjects } from '../engine/objects';
import { lassoIsFreeform, selectByLasso } from '../engine/selection';
import {
  beginGrip,
  bindView,
  clickWorld,
  commitGrip,
  dynamicReadout,
  editDrawing,
  getCadSettings,
  getDrawingModel,
  getOverlay,
  getVertexMarker,
  gripAt,
  gripState,
  hoverWorld,
  interactionMode,
  navigationMode,
  pickWorld,
  postMessage,
  setSelectRect,
  submitInput,
  subscribeCommandUi,
  subscribeDrawing,
} from '../commands/runtime';
import { setPlanCursor } from '../state/cursor';
import { useProject } from '../state/store';
import { fitCamera, panBy, screenToWorld, worldToScreen, type PlanCamera } from '../view/camera';
import { drawXrefs } from '../view/drawXrefs';
import { drawPlan, visibleBounds } from '../view/drawPlan';
import { paintGesture } from '../view/gestureDom';
import { openNavMenu } from '../view/navUi';
import { createGesture, reduceGesture, type NavCommand } from '../view/navigate';
import { getWorkspace, subscribeWorkspace } from '../view/workspace';

export interface CursorReadout {
  x: number;
  y: number;
  z: number | null;
  slope: number | null;
  surface: string | null;
}

function arcPoints(center: { x: number; y: number }, radius: number, start: number, sweep: number): { x: number; y: number }[] {
  const steps = Math.max(8, Math.ceil(Math.abs(sweep) / (Math.PI / 12)));
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = start + sweep * (i / steps);
    points.push({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
  }
  return points;
}

function planOverlay(civil: CivilModel, doc: DrawingDoc) {
  const tint = (key: string, fallback: string) => {
    const paint = objectPaint(doc, doc.objects.find((object) => object.key === key) ?? {
      key,
      kind: '',
      name: '',
      layer: '0',
      color: 'bylayer',
    });
    if (paint.hidden) return null;
    return paint.override ? paint.color : fallback;
  };
  const points = [
    ...civil.points.filter((point) => tint(`cogo-point:${point.id}`, '#f4f7fb') !== null).map((point) => ({ x: point.x, y: point.y, label: String(point.number) })),
    ...civil.pipeNetworks.flatMap((network) => network.structures.map((structure) => ({ x: structure.x, y: structure.y, label: structure.name }))),
    ...civil.pressureNetworks.flatMap((network) => network.nodes.map((node) => ({ x: node.x, y: node.y, label: node.name }))),
  ];
  const lines = [
    ...civil.featureLines.flatMap((line) => {
      const color = tint(`feature-line:${line.id}`, line.name.toLowerCase().includes('daylight') ? '#c6a15a' : '#8fd0b3');
      return color ? [{ points: line.points, color }] : [];
    }),
    ...civil.corridors.flatMap((corridor) =>
      corridor.featureLines
        .filter((line) => line.code.startsWith('ETW') || line.code.startsWith('Daylight') || line.code === 'Crown')
        .flatMap((line) => {
          const color = tint(`corridor:${corridor.id}`, line.code.startsWith('Daylight') ? '#d7c4a3' : '#e0b15a');
          return color ? [{ points: line.points, color }] : [];
        }),
    ),
    ...civil.pipeNetworks.flatMap((network) => {
      const color = tint(`pipe-network:${network.id}`, '#7eb6ff');
      if (!color) return [];
      return network.pipes.flatMap((pipe) => {
        const from = network.structures.find((structure) => structure.id === pipe.fromId);
        const to = network.structures.find((structure) => structure.id === pipe.toId);
        return from && to ? [{ points: [from, to], color }] : [];
      });
    }),
    ...civil.pressureNetworks.flatMap((network) => {
      const color = tint(`pressure-network:${network.id}`, '#e07a7a');
      if (!color) return [];
      return network.pipes.flatMap((pipe) => {
        const from = network.nodes.find((node) => node.id === pipe.fromId);
        const to = network.nodes.find((node) => node.id === pipe.toId);
        return from && to ? [{ points: [from, to], color }] : [];
      });
    }),
    ...civil.intersections.flatMap((intersection) => {
      const color = tint(`intersection:${intersection.id}`, '#f2d48a');
      if (!color) return [];
      return intersection.returns.map((item) => ({ points: arcPoints(item.center, item.radius, item.startAngle, item.sweep), color }));
    }),
  ];
  const fills = civil.parcels.flatMap((parcel) => {
    const color = tint(`parcel:${parcel.id}`, '#f2d48a');
    return color ? [{ points: parcel.ring, color, label: { x: parcel.centroid.x, y: parcel.centroid.y, text: parcel.name } }] : [];
  });
  return { points, lines, fills };
}

export function PlanCanvas({ active = true }: { active?: boolean }) {
  const project = useProject();
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dynRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<PlanCamera>({ cx: 0, cy: 0, scale: 1 });
  const historyRef = useRef<PlanCamera[]>([]);
  const fitted = useRef<number>(-1);
  const projectRef = useRef(project);
  projectRef.current = project;

  useEffect(() => {
    const doc = getDrawingModel().doc;
    const changed = syncObjects(
      doc,
      projectCatalog({
        surfaces: project.state.surfaces,
        alignments: project.state.alignments,
        civil: project.state.civil,
      }),
    );
    if (changed) getDrawingModel().emit();
  }, [project.state.surfaces, project.state.alignments, project.state.civil]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ownsView = active;
    const parent = canvas.parentElement;
    if (!parent) return;

    const pushCamera = () => {
      historyRef.current = [...historyRef.current, { ...cameraRef.current }].slice(-30);
    };

    const draw = () => {
      const current = projectRef.current;
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      if (width < 2 || height < 2) return;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const doc = getDrawingModel().doc;
      if (fitted.current !== current.state.fitToken) {
        let extra: Bounds | null = drawingBounds(doc);
        for (const record of visibleXrefs(getXrefDoc())) {
          const box = xrefBounds(record);
          if (!box) continue;
          extra = extra
            ? { minX: Math.min(extra.minX, box.minX), minY: Math.min(extra.minY, box.minY), maxX: Math.max(extra.maxX, box.maxX), maxY: Math.max(extra.maxY, box.maxY) }
            : box;
        }
        const bounds = visibleBounds(current.state.surfaces, extra);
        if (bounds) cameraRef.current = fitCamera(bounds, width, height);
        fitted.current = current.state.fitToken;
      }
      const preview =
        current.state.tool === 'alignment' && current.state.draft.length >= 2
          ? solveAlignment(alignmentFromPolyline(current.state.draft, current.state.alignmentRadius, current.state.alignmentSpiral)).entities
          : [];
      const overlay = getOverlay();
      drawPlan(ctx, width, height, cameraRef.current, {
        surfaces: current.state.surfaces,
        contours: current.contours,
        volume: current.state.volumeResult,
        showVolume: current.state.showVolumeMap,
        draft: current.state.draft,
        tool: current.state.tool,
        activeId: current.state.activeId,
        linearUnit: current.state.unit === 'ft' ? 'ft' : 'm',
        alignments: current.design
          .filter((item) => item.record.visible)
          .map((item) => ({
            id: item.record.id,
            active: item.record.id === current.state.activeAlignmentId,
            entities: item.solved.entities,
            ticks: item.ticks,
            sampleLines: item.sampleLines,
            pis: item.record.pis,
          })),
        preview,
        overlay: planOverlay(current.state.civil, doc),
        drawing: doc,
        figs: overlay.figs,
        snap: overlay.snap,
        tracks: overlay.tracks,
        selectA: overlay.selectA,
        selectB: overlay.selectB,
        lasso: overlay.lasso,
        hoverId: overlay.hoverId,
        grips: getCadSettings().grips,
        lwdisplay: getCadSettings().lwdisplay,
        lockFade: getCadSettings().laylockfadectl,
        vertex: getVertexMarker(),
        paint: Object.fromEntries((doc.objects ?? []).map((object) => [object.key, objectPaint(doc, object)])),
        showGrid: getWorkspace().showGrid,
        lineweights: getWorkspace().lineweights,
        ucsIcon: getWorkspace().ucsIcon,
        ucsAtOrigin: getWorkspace().ucsAtOrigin,
      });
      drawXrefs(ctx, cameraRef.current, getXrefDoc(), width, height);
      placeDyn(width, height);
    };

    const placeDyn = (width: number, height: number) => {
      const node = dynRef.current;
      if (!node) return;
      const text = dynamicReadout();
      const cursor = getOverlay().cursor;
      if (!text || !cursor) {
        node.hidden = true;
        return;
      }
      const screen = worldToScreen(cameraRef.current, cursor.x, cursor.y, width, height);
      node.hidden = false;
      node.style.left = `${screen.x + 14}px`;
      node.style.top = `${screen.y + 14}px`;
      node.textContent = text;
    };

    draw();
    const observer = new ResizeObserver(() => draw());
    observer.observe(parent);
    const unsubDraw = subscribeDrawing(() => draw());
    const unsubXref = subscribeXrefs(() => draw());
    let gesture = createGesture(false);
    let wheelTimer = 0;
    let original: PlanCamera | null = null;
    const syncNavCursor = () => {
      const nav = navigationMode();
      canvas.dataset.nav = nav ?? '';
      if (gesture.kind === 'none') canvas.style.cursor = nav === 'pan' || nav === 'zoom' ? 'none' : '';
    };
    const unsubWorkspace = subscribeWorkspace(() => draw());
    const unsubUi = subscribeCommandUi(() => {
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      placeDyn(width, height);
      syncNavCursor();
    });
    const commitCamera = (next: PlanCamera) => {
      pushCamera();
      cameraRef.current = next;
      canvas.style.transform = '';
      draw();
      syncNavCursor();
    };
    if (ownsView) {
      bindView({
        zoomExtents: () => {
          pushCamera();
          projectRef.current.requestFit();
        },
        zoomWindow: (a, b) => {
          pushCamera();
          const width = parent.clientWidth;
          const height = parent.clientHeight;
          cameraRef.current = fitCamera(
            { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) },
            width,
            height,
            0.04,
          );
          draw();
        },
        zoomScale: (factor) => {
          if (!(factor > 0)) return;
          pushCamera();
          cameraRef.current = { ...cameraRef.current, scale: cameraRef.current.scale * factor };
          draw();
        },
        zoomCenter: (point, factor) => {
          if (!(factor > 0)) return;
          pushCamera();
          cameraRef.current = { ...cameraRef.current, cx: point.x, cy: point.y, scale: cameraRef.current.scale * factor };
          draw();
        },
        zoomPrevious: () => {
          const previous = historyRef.current.pop();
          if (!previous) return;
          cameraRef.current = previous;
          draw();
        },
        panBy: (a, b) => {
          pushCamera();
          cameraRef.current = {
            ...cameraRef.current,
            cx: cameraRef.current.cx + (a.x - b.x),
            cy: cameraRef.current.cy + (a.y - b.y),
          };
          draw();
        },
        panDisplacement: (x, y) => {
          pushCamera();
          cameraRef.current = { ...cameraRef.current, cx: cameraRef.current.cx - x, cy: cameraRef.current.cy - y };
          draw();
        },
        markOriginal: () => {
          original = { ...cameraRef.current };
        },
        zoomOriginal: () => {
          if (!original) return;
          pushCamera();
          cameraRef.current = { ...original };
          draw();
        },
        panScreen: (direction) => {
          const width = parent.clientWidth;
          const height = parent.clientHeight;
          const dx = direction === 'left' ? width * 0.2 : direction === 'right' ? -width * 0.2 : 0;
          const dy = direction === 'up' ? height * 0.2 : direction === 'down' ? -height * 0.2 : 0;
          pushCamera();
          cameraRef.current = panBy(cameraRef.current, dx, dy);
          draw();
        },
        redraw: () => draw(),
      });
    }

    let dragging = false;
    let moved = false;
    let button = 0;
    let lastX = 0;
    let lastY = 0;
    let cursorFrame = 0;
    let selectOrigin: { x: number; y: number } | null = null;

    const commandOf = (): NavCommand => {
      const nav = navigationMode();
      if (nav === 'pan') return 'pan';
      if (nav === 'zoom') return 'zoom';
      return interactionMode() === 'idle' ? 'idle' : 'busy';
    };

    const localPoint = (event: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top, width: rect.width, height: rect.height };
    };

    const publishCursor = (x: number, y: number, width: number, height: number) => {
      cancelAnimationFrame(cursorFrame);
      cursorFrame = requestAnimationFrame(() => {
        const world = screenToWorld(cameraRef.current, x, y, width, height);
        const current = projectRef.current.state;
        let hit: CursorReadout = { x: world.x, y: world.y, z: null, slope: null, surface: null };
        for (let i = current.surfaces.length - 1; i >= 0; i--) {
          const surface = current.surfaces[i];
          if (!surface.visible) continue;
          const index = bvhFor(surface.points, surface.triangles);
          const z = elevationAt(surface.points, surface.triangles, world.x, world.y, index);
          if (z === null) continue;
          hit = {
            x: world.x,
            y: world.y,
            z,
            slope: slopeAt(surface.points, surface.triangles, world.x, world.y, index),
            surface: surface.name,
          };
          break;
        }
        setPlanCursor(hit);
      });
    };

    const tolerance = () => 10 / Math.max(cameraRef.current.scale, 1e-9);

    const onPointerDown = (event: PointerEvent) => {
      const point = localPoint(event);
      const result = reduceGesture(gesture, {
        type: 'down',
        x: point.x,
        y: point.y,
        button: event.button,
        shift: event.shiftKey,
        view: '2d',
        command: commandOf(),
        time: event.timeStamp,
        camera: cameraRef.current,
        width: point.width,
        height: point.height,
      });
      gesture = result.state;
      if (result.action === 'menu') {
        openNavMenu(event.clientX, event.clientY);
        event.preventDefault();
        return;
      }
      if (result.action === 'preview') {
        paintGesture(canvas, result, commitCamera);
        canvas.setPointerCapture(event.pointerId);
        return;
      }
      button = event.button;
      dragging = true;
      moved = false;
      lastX = event.clientX;
      lastY = event.clientY;
      selectOrigin = null;
      if (event.button === 0) {
        const mode = interactionMode();
        if (mode === 'select' || mode === 'idle') {
          selectOrigin = screenToWorld(cameraRef.current, point.x, point.y, point.width, point.height);
          setSelectRect(selectOrigin, selectOrigin, [selectOrigin]);
        }
      }
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      const point = localPoint(event);
      publishCursor(point.x, point.y, point.width, point.height);
      if (gesture.kind !== 'none') {
        const result = reduceGesture(gesture, { type: 'move', x: point.x, y: point.y, width: point.width, height: point.height });
        gesture = result.state;
        paintGesture(canvas, result, commitCamera);
        return;
      }
      const world = screenToWorld(cameraRef.current, point.x, point.y, point.width, point.height);
      const mode = interactionMode();
      hoverWorld({ x: world.x, y: world.y, z: 0 }, tolerance());
      if (!dragging) return;
      if (Math.hypot(event.clientX - lastX, event.clientY - lastY) > 4) moved = true;
      if (button === 0 && (mode === 'select' || mode === 'idle') && selectOrigin && moved) {
        const lasso = [...(getOverlay().lasso ?? []), world];
        setSelectRect(selectOrigin, world, lasso);
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      const point = localPoint(event);
      if (gesture.kind !== 'none' || event.button === 1) {
        const result = reduceGesture(gesture, {
          type: 'up',
          x: point.x,
          y: point.y,
          button: event.button,
          time: event.timeStamp,
          width: point.width,
          height: point.height,
        });
        gesture = result.state;
        paintGesture(canvas, result, commitCamera);
        if (result.action === 'extents') projectRef.current.requestFit();
        if (result.consumed) return;
      }
      if (!dragging) return;
      dragging = false;
      const world = screenToWorld(cameraRef.current, point.x, point.y, point.width, point.height);
      const mode = interactionMode();
      if (event.button === 2 && !moved) {
        setSelectRect(null, null, null);
        if (navigationMode() === 'pan' || navigationMode() === 'zoom') return;
        if (mode === 'idle') {
          const id = pickEntity(getDrawingModel().doc, world, tolerance());
          if (id) {
            setMenu({ x: event.clientX, y: event.clientY, id });
            return;
          }
        }
        setMenu(null);
        submitInput();
        return;
      }
      if (event.button === 0 && moved && (mode === 'select' || mode === 'idle') && selectOrigin) {
        const doc = getDrawingModel().doc;
        const lasso = getOverlay().lasso ?? [];
        const crossing = world.x < selectOrigin.x;
        const free = lassoIsFreeform(selectOrigin, lasso);
        const picked = selectByBox(doc, selectOrigin, world);
        const ids = free ? selectByLasso(doc, lasso, crossing) : picked.ids;
        pickWorld(ids, { x: world.x, y: world.y, z: 0 }, picked.box, crossing, event.shiftKey);
        setSelectRect(null, null, null);
        return;
      }
      if (event.button !== 0) return;
      if (moved) return;
      if (mode === 'idle' && gripState()) {
        commitGrip({ x: world.x, y: world.y, z: 0 });
        setSelectRect(null, null, null);
        return;
      }
      if (mode === 'idle' && !event.shiftKey) {
        const grip = gripAt({ x: world.x, y: world.y, z: 0 }, tolerance());
        if (grip) {
          beginGrip(grip.id, grip.index, grip.point);
          setSelectRect(null, null, null);
          return;
        }
      }
      if (mode === 'point') {
        const cursor = getOverlay().cursor ?? { x: world.x, y: world.y, z: 0 };
        clickWorld(cursor);
        return;
      }
      if (mode === 'select') {
        const id = pickEntity(getDrawingModel().doc, world, tolerance());
        pickWorld(id ? [id] : [], { x: world.x, y: world.y, z: 0 }, null, false, event.shiftKey);
        setSelectRect(null, null, null);
        return;
      }
      if (mode === 'tool') {
        const current = projectRef.current;
        const draft = current.state.draft;
        if (current.state.tool === 'boundary' && draft.length >= 3) {
          const first = draft[0];
          const screen = {
            x: (first.x - cameraRef.current.cx) * cameraRef.current.scale + point.width / 2,
            y: (cameraRef.current.cy - first.y) * cameraRef.current.scale + point.height / 2,
          };
          if (Math.hypot(screen.x - point.x, screen.y - point.y) < 12) {
            current.finishTool();
            return;
          }
        }
        current.addDraftPoint(world);
        return;
      }
const xrefId = pickXref(getXrefDoc(), world.x, world.y);
      if (xrefId) {
        updateXrefs((doc) => selectXref(doc, xrefId));
        draw();
        return;
      }
      if (getXrefDoc().selectedId) updateXrefs((doc) => selectXref(doc, null));
      if (clickWorld({ x: world.x, y: world.y, z: 0 })) return;
      const id = pickEntity(getDrawingModel().doc, world, tolerance());
      if (id) {
        pickWorld([id], { x: world.x, y: world.y, z: 0 }, null, false, event.shiftKey);
        return;
      }
      pickWorld([], { x: world.x, y: world.y, z: 0 }, null, false, event.shiftKey);
      const current = projectRef.current;
      for (let i = current.state.surfaces.length - 1; i >= 0; i--) {
        const surface = current.state.surfaces[i];
        if (!surface.visible) continue;
        const z = elevationAt(surface.points, surface.triangles, world.x, world.y, bvhFor(surface.points, surface.triangles));
        if (z !== null) {
          current.setActive(surface.id);
          break;
        }
      }
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = localPoint(event);
      const result = reduceGesture(gesture, {
        type: 'wheel',
        x: point.x,
        y: point.y,
        deltaY: event.deltaY,
        width: point.width,
        height: point.height,
        camera: cameraRef.current,
      });
      gesture = result.state;
      paintGesture(canvas, result, commitCamera);
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => {
        const committed = reduceGesture(gesture, { type: 'commit', width: point.width, height: point.height });
        gesture = committed.state;
        paintGesture(canvas, committed, commitCamera);
      }, 140);
    };
    const onLeave = () => setPlanCursor(null);

    const onContext = (event: Event) => event.preventDefault();
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContext);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(cursorFrame);
      window.clearTimeout(wheelTimer);
      unsubDraw();
      unsubXref();
      unsubWorkspace();
      unsubUi();
      if (ownsView) bindView(null);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContext);
    };
  }, [active, project.state.surfaces, project.state.fitToken, project.state.showVolumeMap, project.state.volumeResult, project.state.draft, project.state.tool, project.state.activeId, project.contours, project.state.unit, project.state.alignments, project.state.alignmentRadius, project.state.alignmentSpiral, project.state.activeAlignmentId, project.design, project.state.civil]);

  return (
    <>
      <canvas ref={canvasRef} className="plan-canvas" aria-label="Plan view" />
      <div ref={dynRef} className="dyn-input" hidden />
      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }} role="menu">
          <button
            type="button"
            onClick={() => {
              const entity = getDrawingModel().entity(menu.id);
              editDrawing(() => {
                setLockedIds(getDrawingModel().doc, [menu.id], !entity?.locked);
              });
              postMessage(entity?.locked ? '1 unlocked.' : '1 locked.');
              setMenu(null);
            }}
          >
            {getDrawingModel().entity(menu.id)?.locked ? 'Unlock object' : 'Lock object'}
          </button>
        </div>
      )}
    </>
  );
}
