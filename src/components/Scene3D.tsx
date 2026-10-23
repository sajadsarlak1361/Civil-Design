import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  cutFillColor,
  elevationAt,
  elevationColor,
  slopeColor,
  triangleSlope,
  TriangleIndex,
  isMeshSurface,
  volumeColorScale,
  type SurfaceRecord,
} from '../engine';
import { heightfieldFromPacked, heightfieldMesh, lodResolution } from '../engine/lod';
import { bindView } from '../commands/runtime';
import { useProject } from '../state/store';
import { visibleBounds } from '../view/drawPlan';
import { attach3dNav, type Nav3dView } from '../view/nav3d';
import { navDrag } from '../view/navUi';
import { orbitConstrained, type Pose } from '../view/pan3d';
import { presetVectors, setActivePreset } from '../view/workspace';
import { useWorkspace } from '../view/useWorkspace';
import { NavBar } from './NavBar';
import { ViewCube } from './ViewCube';

export function Scene3D({ active = true, bind = false }: { active?: boolean; bind?: boolean }) {
  const project = useProject();
  const mountRef = useRef<HTMLDivElement>(null);
  const northRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    root: THREE.Group;
    directional: THREE.DirectionalLight;
  } | null>(null);
  const framed = useRef(-1);
  const fittedApi = useRef<typeof apiRef.current>(null);
  const prevEx = useRef(project.state.exaggeration);
  const projectRef = useRef(project);
  projectRef.current = project;
  const activeRef = useRef(active);
  activeRef.current = active;
  const requestRef = useRef<() => void>(() => {});
  const staleRef = useRef<() => void>(() => {});
  const flushRef = useRef<() => void>(() => {});
  const [apiEpoch, setApiEpoch] = useState(0);
  const sceneGen = useRef(0);
  const painted = useRef('');
  const fitRef = useRef<() => void>(() => {});
  const spanRef = useRef(100);
  const presetKey = useRef('');
  const ws = useWorkspace();
  const wsRef = useRef(ws);
  wsRef.current = ws;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor('#0b0d11');
    renderer.domElement.className = 'scene-canvas';
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b0d11');
    const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 100000);
    camera.position.set(120, 80, 120);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.target.set(0, 20, 0);
    // OrbitControls treats Shift as the opposite gesture and pans by the target
    // distance, so the point under the cursor slides. This view owns the pointer.
    controls.disconnect();
    controls.enabled = false;
    const root = new THREE.Group();
    scene.add(root);
    scene.add(new THREE.HemisphereLight('#d7e6f8', '#3a3328', 0.95));
    scene.add(new THREE.AmbientLight('#9aafc4', 0.28));
    const directional = new THREE.DirectionalLight('#ffffff', 0.7);
    directional.position.set(200, 320, 80);
    scene.add(directional);
    apiRef.current = { renderer, scene, camera, controls, root, directional };

    let sizedW = 0;
    let sizedH = 0;
    let requestRender = () => {};
    const resize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      if (width < 2 || height < 2) return;
      if (width === sizedW && height === sizedH) return;
      sizedW = width;
      sizedH = height;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      requestRender();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    const benchPose = new URLSearchParams(window.location.search).get('bench') === '1';

    const updateNorth = () => {
      const arrow = northRef.current;
      if (!arrow) return;
      const origin = controls.target.clone();
      const north = origin.clone().add(new THREE.Vector3(0, 0, -1));
      const o = origin.clone().project(camera);
      const n = north.clone().project(camera);
      const angle = Math.atan2(n.x - o.x, n.y - o.y);
      arrow.style.transform = `rotate(${angle}rad)`;
    };
    controls.addEventListener('change', updateNorth);

    let frame = 0;
    let alive = true;
    const paintKey = () => `${mount.clientWidth}x${mount.clientHeight}:${sceneGen.current}`;
    const readPose = (): Pose => ({
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: [controls.target.x, controls.target.y, controls.target.z],
      up: [camera.up.x, camera.up.y, camera.up.z],
    });
    const writePose = (pose: Pose) => {
      camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
      camera.up.set(pose.up[0], pose.up[1], pose.up[2]);
      controls.target.set(pose.target[0], pose.target[1], pose.target[2]);
      camera.lookAt(controls.target);
    };
    const flush = () => {
      if (!alive || mount.clientWidth < 2 || mount.clientHeight < 2) return false;
      const spinning = wsRef.current.orbitMode === 'continuous' && activeRef.current && !navDrag();
      if (spinning) {
        const mode = wsRef.current.orbitMode;
        writePose(orbitConstrained(readPose(), 1.2, 0, mount.clientHeight, {
          minPolar: mode === 'free' ? 0 : 0.08,
          maxPolar: mode === 'free' ? Math.PI : Math.PI - 0.08,
        }));
      }
      renderer.render(scene, camera);
      updateNorth();
      painted.current = paintKey();
      renderer.domElement.dataset.painted = String(sceneGen.current);
      if (benchPose) {
        renderer.domElement.dataset.cx = camera.position.x.toFixed(3);
        renderer.domElement.dataset.cy = camera.position.y.toFixed(3);
        renderer.domElement.dataset.cz = camera.position.z.toFixed(3);
        renderer.domElement.dataset.tx = controls.target.x.toFixed(3);
        renderer.domElement.dataset.ty = controls.target.y.toFixed(3);
        renderer.domElement.dataset.tz = controls.target.z.toFixed(3);
      }
      return spinning;
    };
    flushRef.current = flush;
    const renderFrame = () => {
      frame = 0;
      if (!alive) return;
      const moving = flush();
      if (moving && activeRef.current) frame = requestAnimationFrame(renderFrame);
    };
    requestRender = () => {
      if (!alive) return;
      if (!frame) frame = requestAnimationFrame(renderFrame);
    };
    requestRef.current = requestRender;
    staleRef.current = () => {
      if (painted.current === paintKey()) return;
      requestRender();
    };
    const raycaster = new THREE.Raycaster();
    const viewAt = (clientX: number, clientY: number): Nav3dView => {
      const rect = renderer.domElement.getBoundingClientRect();
      const mode = wsRef.current.orbitMode;
      return {
        pose: readPose(),
        fov: camera.fov,
        aspect: camera.aspect || rect.width / Math.max(rect.height, 1),
        orthoHeight: 0,
        x: clientX - rect.left,
        y: clientY - rect.top,
        width: rect.width,
        height: rect.height,
        orbit: mode === 'free' ? 'free' : 'constrained',
        minPolar: mode === 'free' ? 0 : 0.08,
        maxPolar: mode === 'free' ? Math.PI : Math.PI - 0.08,
      };
    };
    const detachNav = attach3dNav(renderer.domElement, {
      pick: (clientX, clientY) => ({ id: 'scene', view: viewAt(clientX, clientY) }),
      pose: (_id, clientX, clientY) => viewAt(clientX, clientY),
      hit: (_id, origin, dir) => {
        raycaster.set(new THREE.Vector3(origin[0], origin[1], origin[2]), new THREE.Vector3(dir[0], dir[1], dir[2]).normalize());
        const hit = raycaster.intersectObjects(root.children, true)[0];
        return hit ? [hit.point.x, hit.point.y, hit.point.z] : null;
      },
      apply: (_id, pose) => writePose(pose),
      extents: () => fitRef.current(),
      render: () => requestRef.current(),
    });
    requestRender();
    updateNorth();
    setApiEpoch(1);

    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.removeEventListener('change', updateNorth);
      detachNav();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    staleRef.current();
  }, [active]);

  useEffect(() => {
    if (!bind) return;
    let original: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;
    const shift = (dx: number, dy: number) => {
      const api = apiRef.current;
      if (!api) return;
      api.camera.position.x += dx;
      api.controls.target.x += dx;
      api.camera.position.z -= dy;
      api.controls.target.z -= dy;
      requestRef.current();
    };
    bindView({
      zoomExtents: () => fitRef.current(),
      zoomWindow: () => fitRef.current(),
      zoomScale: (factor) => {
        const api = apiRef.current;
        if (!api || !(factor > 0)) return;
        const offset = api.camera.position.clone().sub(api.controls.target);
        offset.multiplyScalar(1 / factor);
        api.camera.position.copy(api.controls.target).add(offset);
        requestRef.current();
      },
      zoomPrevious: () => undefined,
      panBy: (a, b) => shift(a.x - b.x, a.y - b.y),
      panDisplacement: (x, y) => shift(x, y),
      panScreen: (direction) => {
        const api = apiRef.current;
        if (!api) return;
        const offset = api.camera.position.clone().sub(api.controls.target);
        const dist = Math.max(offset.length(), 1);
        const viewDir = offset.clone().negate().normalize();
        const right = new THREE.Vector3().crossVectors(viewDir, api.camera.up).normalize();
        const up = new THREE.Vector3().crossVectors(right, viewDir).normalize();
        const step = dist * 0.2;
        const delta = new THREE.Vector3();
        if (direction === 'left') delta.addScaledVector(right, -step);
        if (direction === 'right') delta.addScaledVector(right, step);
        if (direction === 'up') delta.addScaledVector(up, step);
        if (direction === 'down') delta.addScaledVector(up, -step);
        api.camera.position.add(delta);
        api.controls.target.add(delta);
        requestRef.current();
      },
      markOriginal: () => {
        const api = apiRef.current;
        if (!api) return;
        original = { position: api.camera.position.clone(), target: api.controls.target.clone() };
      },
      zoomOriginal: () => {
        const api = apiRef.current;
        if (!api || !original) return;
        api.camera.position.copy(original.position);
        api.controls.target.copy(original.target);
        requestRef.current();
      },
      redraw: () => requestRef.current(),
    });
    return () => bindView(null);
  }, [bind]);

  const { surfaces, volumeResult, showVolumeMap, exaggeration, fitToken, volumeSetup, meshSections } = project.state;
  const contours = project.contours;

  useLayoutEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    sceneGen.current += 1;
    clearGroup(api.root);
    const bounds = visibleBounds(surfaces);
    if (!bounds) {
      return () => {
        if (apiRef.current) clearGroup(apiRef.current.root);
      };
    }
    const origin = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 20);
    spanRef.current = span;
    let minZ = Infinity;
    for (const surface of surfaces) {
      for (const point of surface.points) if (point.z < minZ) minZ = point.z;
    }
    const grid = new THREE.GridHelper(span * 1.35, 10, 0x3c4b63, 0x243044);
    grid.position.y = (Number.isFinite(minZ) ? minZ : 0) * exaggeration - span * 0.01;
    api.root.add(grid);

    surfaces.forEach((surface, index) => {
      if (!surface.visible || surface.triangles.length === 0) return;
      api.root.add(buildSurfaceMesh(surface, origin, exaggeration, index));
      if (surface.style.showTriangles && surface.triangles.length <= 250_000) {
        api.root.add(buildWire(surface, origin, exaggeration, Math.max(1, Math.ceil(surface.triangles.length / 60_000))));
      }
      const lines = contours.find((entry) => entry.id === surface.id)?.lines ?? [];
      if (!isMeshSurface(surface) && surface.style.showContours && lines.length > 0) {
        api.root.add(buildContours(lines, surface, origin, exaggeration, false));
        api.root.add(buildContours(lines, surface, origin, exaggeration, true));
      }
      const cloud = buildPointCloud(surface, origin, exaggeration);
      if (meshSections && meshSections.surfaceId === surface.id) {
        api.root.add(buildSectionLoops(meshSections.sections, origin, exaggeration));
      }
      if (cloud) api.root.add(cloud);
    });

    if (showVolumeMap && volumeResult && volumeResult.regions.length > 0) {
      const base = surfaces.find((surface) => surface.id === volumeSetup.baseId) ?? surfaces.find((surface) => surface.visible);
      if (base) api.root.add(buildVolumeMesh(volumeResult, base, origin, exaggeration));
    }

    // Strict mode disposes the first renderer after the fit runs. Fit again for the renderer that stays mounted.
    const fitView = () => {
      let zSum = 0;
      let zCount = 0;
      for (const surface of surfaces) {
        if (!surface.visible) continue;
        const step = Math.max(1, Math.floor(surface.points.length / 4000));
        for (let i = 0; i < surface.points.length; i += step) {
          zSum += surface.points[i].z;
          zCount += 1;
        }
      }
      const mean = (zCount ? zSum / zCount : 0) * exaggeration;
      api.camera.near = 0.5;
      api.camera.far = span * 60;
      api.camera.position.set(span * 0.82, mean + span * 0.46, span * 0.82);
      api.controls.target.set(0, mean * 0.2, 0);
      api.camera.lookAt(api.controls.target);
      api.camera.updateProjectionMatrix();
      api.directional.position.set(span, span * 1.6, span * 0.25);
      api.controls.update();
      requestRef.current();
    };
    fitRef.current = fitView;
    const shouldFit = fittedApi.current !== api || framed.current !== fitToken;
    if (shouldFit) {
      fitView();
      framed.current = fitToken;
      fittedApi.current = api;
    } else if (prevEx.current !== exaggeration && prevEx.current > 0) {
      const ratio = exaggeration / prevEx.current;
      api.camera.position.y *= ratio;
      api.controls.target.y *= ratio;
    }
    prevEx.current = exaggeration;
    api.renderer.domElement.dataset.scene = String(sceneGen.current);
    api.renderer.domElement.dataset.meshes = String(api.root.children.length);
    flushRef.current();
    return () => {
      if (apiRef.current) clearGroup(apiRef.current.root);
    };
  }, [apiEpoch, contours, exaggeration, fitToken, meshSections, showVolumeMap, surfaces, volumeResult, volumeSetup]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.controls.autoRotate = ws.orbitMode === 'continuous';
    api.controls.autoRotateSpeed = 1.4;
    api.controls.minPolarAngle = ws.orbitMode === 'free' ? 0 : 0.08;
    api.controls.maxPolarAngle = ws.orbitMode === 'free' ? Math.PI : Math.PI - 0.08;
    const slot = ws.slots.find((item) => item.id === ws.activeId) ?? ws.slots[0];
    if (slot && slot.preset !== 'custom') {
      const signature = `${slot.preset}:${slot.azimuth.toFixed(4)}:${slot.polar.toFixed(4)}:${slot.distance}`;
      const first = presetKey.current === '';
      if (first) presetKey.current = signature;
      if (!first && signature !== presetKey.current) {
        presetKey.current = signature;
        const vectors = presetVectors(slot.preset === 'plan' ? 'top' : slot.preset);
        const length = Math.hypot(vectors.position[0], vectors.position[1], vectors.position[2]) || 1;
        const radius = Math.max(spanRef.current, 1) * slot.distance;
        api.camera.up.set(vectors.up[0], vectors.up[1], vectors.up[2]);
        api.camera.position.set(
          api.controls.target.x + (radius * vectors.position[0]) / length,
          api.controls.target.y + (radius * vectors.position[1]) / length,
          api.controls.target.z + (radius * vectors.position[2]) / length,
        );
        api.camera.lookAt(api.controls.target);
      }
    }
    requestRef.current();
  }, [apiEpoch, ws]);

  return (
    <div className="scene-mount" ref={mountRef}>
      <div className="north-badge" ref={northRef} title="North">
        <span>N</span>
      </div>
      {ws.viewCube && <ViewCube onPreset={setActivePreset} />}
      {ws.navBar && <NavBar />}
      <div className="scene-hint">Middle-drag pans · Shift+middle orbits · scroll zooms · Y is elevation × {project.state.exaggeration.toFixed(1)}</div>
    </div>
  );
}

function clearGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeNode(child);
  }
}

function disposeNode(node: THREE.Object3D): void {
  node.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material?.dispose();
  });
}

function buildSurfaceMesh(surface: SurfaceRecord, origin: { x: number; y: number }, exaggeration: number, order: number): THREE.Mesh {
  if (surface.triangles.length > 250_000) return buildLodMesh(surface, origin, exaggeration, order);
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const shaded = surface.style.showElevation || surface.style.showSlope;
  if (surface.style.showSlope) {
    for (const [ia, ib, ic] of surface.triangles) {
      const a = surface.points[ia];
      const b = surface.points[ib];
      const c = surface.points[ic];
      const color = slopeColor(triangleSlope(a, b, c));
      const start = positions.length / 3;
      for (const point of [a, b, c]) {
        positions.push(point.x - origin.x, point.z * exaggeration, -(point.y - origin.y));
        colors.push(color.r / 255, color.g / 255, color.b / 255);
      }
      indices.push(start, start + 1, start + 2);
    }
  } else if (surface.style.showElevation) {
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const point of surface.points) {
      if (point.z < minZ) minZ = point.z;
      if (point.z > maxZ) maxZ = point.z;
    }
    for (const point of surface.points) {
      positions.push(point.x - origin.x, point.z * exaggeration, -(point.y - origin.y));
      const color = elevationColor(point.z, minZ, maxZ);
      colors.push(color.r / 255, color.g / 255, color.b / 255);
    }
    for (const [a, b, c] of surface.triangles) indices.push(a, b, c);
  } else {
    for (const point of surface.points) positions.push(point.x - origin.x, point.z * exaggeration, -(point.y - origin.y));
    for (const [a, b, c] of surface.triangles) indices.push(a, b, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (shaded) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  if (surface.points.length > 65_535) geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(indices), 1));
  else geometry.setIndex(indices);
  const opacity = Math.min(1, Math.max(0.2, surface.style.opacity));
  const material = new THREE.MeshLambertMaterial({
    color: shaded ? '#ffffff' : surface.style.color,
    vertexColors: shaded,
    flatShading: true,
    side: THREE.DoubleSide,
    transparent: opacity < 0.995,
    opacity,
    polygonOffset: true,
    polygonOffsetFactor: -1 - order,
    polygonOffsetUnits: -1,
  });
  return new THREE.Mesh(geometry, material);
}

function buildLodMesh(surface: SurfaceRecord, origin: { x: number; y: number }, exaggeration: number, order: number): THREE.Mesh {
  const count = surface.points.length;
  const xyz = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) {
    const point = surface.points[i];
    xyz[i * 3] = point.x;
    xyz[i * 3 + 1] = point.y;
    xyz[i * 3 + 2] = point.z;
  }
  const field = heightfieldFromPacked(xyz, lodResolution(count));
  const mesh = heightfieldMesh(field, exaggeration);
  const positions = mesh.positions;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= origin.x;
    positions[i + 2] += origin.y;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  const opacity = Math.min(1, Math.max(0.2, surface.style.opacity));
  const material = new THREE.MeshLambertMaterial({
    color: surface.style.color,
    flatShading: true,
    side: THREE.DoubleSide,
    transparent: opacity < 0.995,
    opacity,
    polygonOffset: true,
    polygonOffsetFactor: -1 - order,
    polygonOffsetUnits: -1,
  });
  return new THREE.Mesh(geometry, material);
}

function buildPointCloud(surface: SurfaceRecord, origin: { x: number; y: number }, exaggeration: number): THREE.Points | null {
  if (!surface.style.showPoints) return null;
  const source = surface.sourcePoints.length > 0 ? surface.sourcePoints : surface.points;
  const survey = source.filter((point) => !point.role || point.role === 'survey');
  if (survey.length === 0) return null;
  const kept = survey.length > 200_000 ? voxelDownsample(survey, 200_000) : survey;
  const positions = new Float32Array(kept.length * 3);
  const lift = 0.05 * exaggeration;
  for (let i = 0; i < kept.length; i++) {
    const point = kept[i];
    positions[i * 3] = point.x - origin.x;
    positions[i * 3 + 1] = point.z * exaggeration + lift;
    positions[i * 3 + 2] = -(point.y - origin.y);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: surface.style.color, size: 3, sizeAttenuation: false });
  return new THREE.Points(geometry, material);
}

function voxelDownsample(points: { x: number; y: number; z: number }[], target: number): { x: number; y: number; z: number }[] {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.z < minZ) minZ = point.z;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
    if (point.z > maxZ) maxZ = point.z;
  }
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1);
  const cell = span / Math.max(8, Math.round(Math.sqrt(target)));
  const scale = 1 / cell;
  const seen = new Set<number>();
  const kept: { x: number; y: number; z: number }[] = [];
  for (const point of points) {
    const ix = Math.floor((point.x - minX) * scale);
    const iy = Math.floor((point.y - minY) * scale);
    const iz = Math.floor((point.z - minZ) * scale);
    const key = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(point);
    if (kept.length >= target) break;
  }
  return kept;
}

function buildSectionLoops(
  sections: { loops: { closed: boolean; points: { x: number; y: number; z: number }[] }[] }[],
  origin: { x: number; y: number },
  exaggeration: number,
): THREE.LineSegments {
  const positions: number[] = [];
  for (const section of sections) {
    for (const loop of section.loops) {
      const pts = loop.points;
      if (pts.length < 2) continue;
      const count = loop.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < count; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        positions.push(a.x - origin.x, a.z * exaggeration, -(a.y - origin.y), b.x - origin.x, b.z * exaggeration, -(b.y - origin.y));
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#f0d78c' }));
}

function buildWire(surface: SurfaceRecord, origin: { x: number; y: number }, exaggeration: number, stride = 1): THREE.LineSegments {
  const positions: number[] = [];
  for (let t = 0; t < surface.triangles.length; t += stride) {
    const [ia, ib, ic] = surface.triangles[t];
    const corners = [surface.points[ia], surface.points[ib], surface.points[ic], surface.points[ia]];
    for (let i = 0; i < 3; i++) {
      const a = corners[i];
      const b = corners[i + 1];
      positions.push(a.x - origin.x, a.z * exaggeration, -(a.y - origin.y), b.x - origin.x, b.z * exaggeration, -(b.y - origin.y));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: surface.style.color, transparent: true, opacity: 0.45 }),
  );
}

function buildContours(
  lines: { major: boolean; points: { x: number; y: number; z: number }[] }[],
  surface: SurfaceRecord,
  origin: { x: number; y: number },
  exaggeration: number,
  major: boolean,
): THREE.LineSegments {
  const positions: number[] = [];
  for (const line of lines) {
    if (line.major !== major || line.points.length < 2) continue;
    for (let i = 1; i < line.points.length; i++) {
      const a = line.points[i - 1];
      const b = line.points[i];
      const lift = 0.15 * exaggeration;
      positions.push(a.x - origin.x, a.z * exaggeration + lift, -(a.y - origin.y));
      positions.push(b.x - origin.x, b.z * exaggeration + lift, -(b.y - origin.y));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: major ? surface.style.majorColor : surface.style.minorColor }),
  );
}

function buildVolumeMesh(
  volume: NonNullable<ReturnType<typeof useProject>['state']['volumeResult']>,
  base: SurfaceRecord,
  origin: { x: number; y: number },
  exaggeration: number,
): THREE.Mesh {
  const index = new TriangleIndex(base.points, base.triangles);
  const scale = volumeColorScale(volume);
  const positions: number[] = [];
  const colors: number[] = [];
  for (const region of volume.regions) {
    if (region.ring.length < 3) continue;
    const samples = region.ring.map((point) => ({
      point,
      z: elevationAt(base.points, base.triangles, point.x, point.y, index),
    }));
    if (samples.some((sample) => sample.z === null)) continue;
    const color = cutFillColor(region.depth, scale);
    const lift = 0.2 * exaggeration;
    for (let i = 1; i < samples.length - 1; i++) {
      for (const sample of [samples[0], samples[i], samples[i + 1]]) {
        positions.push(sample.point.x - origin.x, (sample.z as number) * exaggeration + lift, -(sample.point.y - origin.y));
        colors.push(color.r / 255, color.g / 255, color.b / 255);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  return new THREE.Mesh(geometry, material);
}
