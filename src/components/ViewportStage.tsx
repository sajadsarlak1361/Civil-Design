import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { bindView } from '../commands/runtime';
import { useProject } from '../state/store';
import { visibleBounds } from '../view/drawPlan';
import { attach3dNav, type Nav3dView } from '../view/nav3d';
import { type Pose } from '../view/pan3d';
import { releaseSurfaceGeometry, retainSurfaceGeometry, type SharedSurface } from '../view/surfaceBuffers';
import { activeSlot, setActiveCamera, setActivePreset, setActiveViewport, type ViewportSlot, type VisualStyle } from '../view/workspace';
import { useWorkspace } from '../view/useWorkspace';
import { NavBar } from './NavBar';
import { ViewCube } from './ViewCube';

export function ViewportStage() {
  const project = useProject();
  const ws = useWorkspace();
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cellRefs = useRef(new Map<string, HTMLDivElement>());
  const apiRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    root: THREE.Group;
    cameras: Map<string, THREE.Camera>;
    targets: Map<string, THREE.Vector3>;
    applied: Map<string, string>;
  } | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  const wsRef = useRef(ws);
  wsRef.current = ws;

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor('#0b0d11');
    renderer.setScissorTest(true);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b0d11');
    scene.add(new THREE.HemisphereLight('#d7e6f8', '#3a3328', 0.9));
    scene.add(new THREE.AmbientLight('#9aafc4', 0.35));
    const sun = new THREE.DirectionalLight('#ffffff', 0.65);
    sun.position.set(80, 160, 40);
    scene.add(sun);
    const root = new THREE.Group();
    scene.add(root);
    const api = { renderer, scene, root, cameras: new Map<string, THREE.Camera>(), targets: new Map<string, THREE.Vector3>(), applied: new Map<string, string>() };
    const benchPose = new URLSearchParams(window.location.search).get('bench') === '1';
    apiRef.current = api;

    let frame = 0;
    let alive = true;
    const draw = () => {
      if (!alive) return;
      frame = requestAnimationFrame(draw);
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (width < 2 || height < 2) return;
      const dpr = renderer.getPixelRatio();
      renderer.setSize(width, height, false);
      const current = wsRef.current;
      const bounds = visibleBounds(projectRef.current.state.surfaces);
      const span = bounds ? Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 20) : 100;
      const centerY = centerRef.current;
      for (const slot of current.slots) {
        const cell = cellRefs.current.get(slot.id);
        if (!cell) continue;
        const rect = cellRect(host, cell, dpr);
        if (rect.w < 1 || rect.h < 1) continue;
        const camera = cameraFor(api.cameras, slot, span, rect.w / rect.h);
        const signature = `${slot.preset}:${slot.azimuth.toFixed(4)}:${slot.polar.toFixed(4)}:${slot.distance}:${slot.ortho}:${centerY.toFixed(2)}`;
        const placed = api.applied.get(slot.id) !== signature;
        if (placed) {
          placeCamera(camera, slot, span, centerY);
          if (camera instanceof THREE.OrthographicCamera || camera instanceof THREE.PerspectiveCamera) {
            camera.zoom = 1;
            camera.updateProjectionMatrix();
          }
          api.targets.set(slot.id, new THREE.Vector3(0, centerY, 0));
          api.applied.set(slot.id, signature);
        }
        const target = api.targets.get(slot.id);
        if (target) camera.lookAt(target);
        if (benchPose && target) {
          cell.dataset.cam = `${camera.position.x.toFixed(2)},${camera.position.y.toFixed(2)},${camera.position.z.toFixed(2)}`;
          cell.dataset.target = `${target.x.toFixed(2)},${target.y.toFixed(2)},${target.z.toFixed(2)}`;
        }
        renderer.setViewport(rect.x, rect.y, rect.w, rect.h);
        renderer.setScissor(rect.x, rect.y, rect.w, rect.h);
        renderer.render(scene, camera);
      }
    };
    draw();
    const raycaster = new THREE.Raycaster();
    const viewFor = (id: string, clientX: number, clientY: number): Nav3dView | null => {
      const camera = api.cameras.get(id);
      const cell = cellRefs.current.get(id);
      const target = api.targets.get(id);
      if (!camera || !cell || !target) return null;
      const box = cell.getBoundingClientRect();
      const ortho = camera instanceof THREE.OrthographicCamera;
      const mode = wsRef.current.orbitMode;
      return {
        pose: {
          position: [camera.position.x, camera.position.y, camera.position.z],
          target: [target.x, target.y, target.z],
          up: [camera.up.x, camera.up.y, camera.up.z],
        },
        fov: camera instanceof THREE.PerspectiveCamera ? camera.fov : 42,
        aspect: box.width / Math.max(box.height, 1),
        orthoHeight: ortho ? (camera.top - camera.bottom) / 2 / Math.max(camera.zoom, 1e-6) : 0,
        x: clientX - box.left,
        y: clientY - box.top,
        width: box.width,
        height: box.height,
        orbit: mode === 'free' ? 'free' : 'constrained',
        minPolar: mode === 'free' ? 0 : 0.08,
        maxPolar: mode === 'free' ? Math.PI : Math.PI - 0.08,
      };
    };
    const cellAt = (clientX: number, clientY: number): string | null => {
      for (const [id, cell] of cellRefs.current) {
        const box = cell.getBoundingClientRect();
        if (clientX >= box.left && clientY >= box.top && clientX <= box.right && clientY <= box.bottom) return id;
      }
      return null;
    };
    const applyPose = (id: string, pose: Pose) => {
      const camera = api.cameras.get(id);
      if (!camera) return;
      const target = api.targets.get(id) ?? new THREE.Vector3();
      api.targets.set(id, target);
      const before = camera.position.distanceTo(target);
      camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
      target.set(pose.target[0], pose.target[1], pose.target[2]);
      camera.up.set(pose.up[0], pose.up[1], pose.up[2]);
      const after = camera.position.distanceTo(target);
      if (camera instanceof THREE.OrthographicCamera && before > 1e-6 && after > 1e-6) {
        camera.zoom *= before / after;
        camera.updateProjectionMatrix();
      }
      camera.lookAt(target);
    };
    const activePair = () => {
      const id = wsRef.current.activeId;
      return { id, camera: api.cameras.get(id), target: api.targets.get(id) };
    };
    const detachNav = attach3dNav(canvas, {
      pick: (clientX, clientY) => {
        const id = cellAt(clientX, clientY);
        if (!id) return null;
        setActiveViewport(id);
        const view = viewFor(id, clientX, clientY);
        return view ? { id, view } : null;
      },
      pose: (id, clientX, clientY) => viewFor(id, clientX, clientY),
      hit: (_id, origin, dir) => {
        raycaster.set(new THREE.Vector3(origin[0], origin[1], origin[2]), new THREE.Vector3(dir[0], dir[1], dir[2]).normalize());
        const hit = raycaster.intersectObjects(root.children, true)[0];
        return hit ? [hit.point.x, hit.point.y, hit.point.z] : null;
      },
      apply: applyPose,
      extents: (id) => {
        setActiveViewport(id);
        setActiveCamera({ distance: 1.35 });
      },
      render: () => undefined,
    });
    const distances: number[] = [];
    let original: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;
    bindView({
      zoomExtents: () => {
        distances.push(activeSlot().distance);
        setActiveCamera({ distance: 1.35 });
      },
      zoomWindow: () => {
        distances.push(activeSlot().distance);
        setActiveCamera({ distance: Math.max(0.05, activeSlot().distance / 2) });
      },
      zoomScale: (factor) => {
        if (!(factor > 0)) return;
        distances.push(activeSlot().distance);
        setActiveCamera({ distance: Math.max(0.05, activeSlot().distance / factor) });
      },
      zoomPrevious: () => {
        const distance = distances.pop();
        if (distance) setActiveCamera({ distance });
      },
      panBy: (a, b) => {
        const { camera, target } = activePair();
        if (!camera || !target) return;
        const delta = new THREE.Vector3(a.x - b.x, 0, -(a.y - b.y));
        camera.position.add(delta);
        target.add(delta);
      },
      panDisplacement: (x, y) => {
        const { camera, target } = activePair();
        if (!camera || !target) return;
        camera.position.x += x;
        target.x += x;
        camera.position.z -= y;
        target.z -= y;
      },
      markOriginal: () => {
        const { camera, target } = activePair();
        if (!camera || !target) return;
        original = { position: camera.position.clone(), target: target.clone() };
      },
      zoomOriginal: () => {
        const { camera, target } = activePair();
        if (!camera || !target || !original) return;
        camera.position.copy(original.position);
        target.copy(original.target);
      },
      panScreen: (direction) => {
        const { camera, target } = activePair();
        if (!camera || !target) return;
        const offset = camera.position.clone().sub(target);
        const dist = Math.max(offset.length(), 1);
        const view = offset.clone().negate().normalize();
        const right = new THREE.Vector3().crossVectors(view, camera.up).normalize();
        const up = new THREE.Vector3().crossVectors(right, view).normalize();
        const step = dist * 0.2;
        const delta = new THREE.Vector3();
        if (direction === 'left') delta.addScaledVector(right, -step);
        if (direction === 'right') delta.addScaledVector(right, step);
        if (direction === 'up') delta.addScaledVector(up, step);
        if (direction === 'down') delta.addScaledVector(up, -step);
        camera.position.add(delta);
        target.add(delta);
      },
      redraw: () => {
        const { camera } = activePair();
        if (camera) renderer.render(scene, camera);
      },
    });
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      detachNav();
      bindView(null);
      renderer.dispose();
      apiRef.current = null;
    };
  }, []);

  const { surfaces, exaggeration } = project.state;
  const heldRef = useRef<SharedSurface[]>([]);
  const centerRef = useRef(0);
  const color = surfaces.find((surface) => surface.visible)?.style.color ?? '#7dbeb8';

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const held: SharedSurface[] = [];
    const bounds = visibleBounds(surfaces);
    if (bounds) {
      const origin = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
      for (const surface of surfaces) {
        if (!surface.visible || surface.triangles.length === 0) continue;
        held.push(retainSurfaceGeometry(surface, origin, exaggeration));
      }
    }
    heldRef.current = held;
    centerRef.current = elevationCenter(surfaces, exaggeration);
    paintStyle(api.root, held, wsRef.current.visualStyle, color);
    return () => {
      clearRoot(api.root);
      for (const shared of held) releaseSurfaceGeometry(shared.geometry);
      heldRef.current = [];
    };
  }, [color, exaggeration, surfaces]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api || heldRef.current.length === 0) return;
    paintStyle(api.root, heldRef.current, ws.visualStyle, color);
  }, [color, ws.visualStyle]);

  const columns = ws.layout === 1 ? '1fr' : '1fr 1fr';
  return (
    <div className={`vp-stage layout-${ws.layout}`} ref={hostRef}>
      <canvas ref={canvasRef} className="vp-canvas" aria-label="Model viewports" />
      <div className="vp-grid" style={{ gridTemplateColumns: columns }}>
        {ws.slots.map((slot) => (
          <div
            key={slot.id}
            className={`vp-cell${slot.id === ws.activeId ? ' active' : ''}`}
            ref={(node) => {
              if (node) cellRefs.current.set(slot.id, node);
              else cellRefs.current.delete(slot.id);
            }}
          >
            <span className="vp-label">{slot.preset}</span>
            {slot.id === ws.activeId && ws.viewCube && <ViewCube onPreset={setActivePreset} />}
            {slot.id === ws.activeId && ws.navBar && <NavBar />}
          </div>
        ))}
      </div>
    </div>
  );
}

function paintStyle(root: THREE.Group, held: SharedSurface[], style: VisualStyle, color: string): void {
  clearRoot(root);
  for (const shared of held) {
    root.add(new THREE.Mesh(shared.geometry, styleMaterial(style, color)));
    if (style === '2d-wireframe' || style === 'wireframe' || style === 'hidden' || style === 'shaded-edges') {
      root.add(new THREE.LineSegments(shared.edges, new THREE.LineBasicMaterial({ color: '#d5deea' })));
    }
  }
}

function clearRoot(root: THREE.Group): void {
  for (const child of [...root.children]) {
    root.remove(child);
    const mesh = child as THREE.Mesh;
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material?.dispose();
  }
}

function cameraFor(cameras: Map<string, THREE.Camera>, slot: ViewportSlot, span: number, aspect: number): THREE.Camera {
  const wantOrtho = slot.ortho && slot.preset !== 'custom';
  const existing = cameras.get(slot.id);
  if (existing && wantOrtho === existing instanceof THREE.OrthographicCamera) {
    if (existing instanceof THREE.PerspectiveCamera) {
      existing.aspect = aspect;
      existing.updateProjectionMatrix();
    }
    if (existing instanceof THREE.OrthographicCamera) {
      const half = span * 0.55 * slot.distance;
      existing.left = -half * aspect;
      existing.right = half * aspect;
      existing.top = half;
      existing.bottom = -half;
      existing.near = -span * 20;
      existing.far = span * 40;
      existing.updateProjectionMatrix();
    }
    return existing;
  }
  const half = span * 0.55 * slot.distance;
  const camera = wantOrtho
    ? new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, -span * 20, span * 40)
    : new THREE.PerspectiveCamera(42, aspect, Math.max(0.1, span / 400), span * 80);
  cameras.set(slot.id, camera);
  return camera;
}

function elevationCenter(surfaces: { visible: boolean; points: { z: number }[] }[], exaggeration: number): number {
  let min = Infinity;
  let max = -Infinity;
  for (const surface of surfaces) {
    if (!surface.visible) continue;
    const step = surface.points.length > 200_000 ? Math.floor(surface.points.length / 2000) : 1;
    for (let i = 0; i < surface.points.length; i += step) {
      const z = surface.points[i].z;
      if (z < min) min = z;
      if (z > max) max = z;
    }
  }
  if (!Number.isFinite(min)) return 0;
  return ((min + max) / 2) * exaggeration;
}

function placeCamera(camera: THREE.Camera, slot: ViewportSlot, span: number, centerY: number): void {
  const radius = Math.max(span, 1) * slot.distance;
  const sin = Math.sin(slot.polar);
  camera.position.set(radius * sin * Math.sin(slot.azimuth), centerY + radius * Math.cos(slot.polar), radius * sin * Math.cos(slot.azimuth));
  if (slot.preset === 'top' || slot.preset === 'plan') camera.up.set(0, 0, -1);
  else if (slot.preset === 'bottom') camera.up.set(0, 0, 1);
  else camera.up.set(0, 1, 0);
  camera.lookAt(0, centerY, 0);
  if (camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera) camera.updateProjectionMatrix();
}

function cellRect(host: HTMLElement, cell: HTMLElement, dpr: number): { x: number; y: number; w: number; h: number } {
  const outer = host.getBoundingClientRect();
  const box = cell.getBoundingClientRect();
  return {
    x: (box.left - outer.left) * dpr,
    y: (outer.bottom - box.bottom) * dpr,
    w: Math.max(0, box.width) * dpr,
    h: Math.max(0, box.height) * dpr,
  };
}

function styleMaterial(style: VisualStyle, color: string): THREE.Material {
  if (style === 'hidden') return new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  if (style === '2d-wireframe' || style === 'wireframe') return new THREE.MeshBasicMaterial({ visible: false });
  if (style === 'elevation') return new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  if (style === 'xray') return new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
  if (style === 'realistic') return new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.04, side: THREE.DoubleSide });
  if (style === 'conceptual') return new THREE.MeshLambertMaterial({ color: '#d2c0a0', side: THREE.DoubleSide });
  return new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
}
