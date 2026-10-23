import { navigationMode, subscribeCommandUi } from '../commands/runtime';
import { openNavMenu, setNavDrag } from './navUi';
import { classifyPointer, NAV_MENU_3D, wheelDeltaY, wheelZoomRatio, type NavCommand } from './navigate';
import { orbitConstrained, orbitFree, panGrab, pointAtDepth, rayFromPixel, targetDepth, zoomToward, type Pose, type Vec3 } from './pan3d';

export interface Nav3dView {
  pose: Pose;
  fov: number;
  aspect: number;
  orthoHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Constrained orbit keeps world Y up. Free orbit tumbles. */
  orbit: 'constrained' | 'free';
  minPolar: number;
  maxPolar: number;
}

export interface Nav3dApi {
  pick(clientX: number, clientY: number): { id: string; view: Nav3dView } | null;
  pose(id: string, clientX: number, clientY: number): Nav3dView | null;
  /** First surface under the ray, or null when the cursor misses the model. */
  hit(id: string, origin: Vec3, dir: Vec3): Vec3 | null;
  apply(id: string, pose: Pose): void;
  extents(id: string): void;
  render(): void;
}

/**
 * Pointer navigation for one or more 3D cameras.
 * Pan, zoom, and orbit write the camera only. The caller must not rebuild geometry.
 */
export function attach3dNav(element: HTMLElement, api: Nav3dApi): () => void {
  let drag: {
    id: string;
    kind: 'pan' | 'zoom' | 'orbit';
    grabbed: Vec3;
    originX: number;
    originY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    button: number;
  } | null = null;
  let lastMiddle = -1e9;

  const command = (): NavCommand => {
    const mode = navigationMode();
    if (mode === 'pan' || mode === 'zoom') return mode;
    return 'idle';
  };

  const syncCursor = () => {
    const mode = navigationMode();
    element.dataset.nav = mode ?? '';
    element.style.cursor = mode === 'pan' || mode === 'zoom' ? 'none' : '';
  };

  const focusOf = (id: string, view: Nav3dView): Vec3 => {
    const ray = rayFromPixel(view.pose, view.fov, view.aspect, view.x, view.y, view.width, view.height, view.orthoHeight);
    return api.hit(id, ray.origin, ray.dir) ?? pointAtDepth(view.pose, ray, targetDepth(view.pose));
  };

  const onDown = (event: PointerEvent) => {
    if (event.button > 2) return;
    const picked = api.pick(event.clientX, event.clientY);
    if (!picked) return;
    const kind = classifyPointer(event.button, event.shiftKey, '3d', command());
    if (kind === 'menu') {
      openNavMenu(event.clientX, event.clientY, NAV_MENU_3D);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (kind === 'passthrough') return;
    const view = picked.view;
    drag = {
      id: picked.id,
      kind: kind === 'orbit' ? 'orbit' : kind === 'zoom' ? 'zoom' : 'pan',
      grabbed: focusOf(picked.id, view),
      originX: view.x,
      originY: view.y,
      lastX: view.x,
      lastY: view.y,
      moved: false,
      button: event.button,
    };
    setNavDrag(drag.kind === 'zoom' ? 'zoom' : drag.kind === 'pan' ? 'pan' : null);
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic pointer, or the button was already released.
    }
    event.preventDefault();
  };

  const onMove = (event: PointerEvent) => {
    if (!drag) return;
    const view = api.pose(drag.id, event.clientX, event.clientY);
    if (!view) return;
    const dx = view.x - drag.lastX;
    const dy = view.y - drag.lastY;
    if (Math.hypot(view.x - drag.originX, view.y - drag.originY) > 2) drag.moved = true;
    let next = view.pose;
    if (drag.kind === 'pan') {
      const ray = rayFromPixel(view.pose, view.fov, view.aspect, view.x, view.y, view.width, view.height, view.orthoHeight);
      next = panGrab(view.pose, drag.grabbed, ray);
    } else if (drag.kind === 'zoom') {
      next = zoomToward(view.pose, drag.grabbed, Math.exp(-dy * 0.012));
    } else if (view.orbit === 'free') {
      next = orbitFree(view.pose, dx, dy, view.height);
    } else {
      next = orbitConstrained(view.pose, dx, dy, view.height, { minPolar: view.minPolar, maxPolar: view.maxPolar });
    }
    drag.lastX = view.x;
    drag.lastY = view.y;
    api.apply(drag.id, next);
    api.render();
  };

  const onUp = (event: PointerEvent) => {
    if (!drag || event.button !== drag.button) return;
    const moved = drag.moved;
    const button = drag.button;
    drag = null;
    setNavDrag(null);
    syncCursor();
    if (button === 1 && !moved && event.timeStamp - lastMiddle < 400 && event.timeStamp - lastMiddle > 0) {
      const picked = api.pick(event.clientX, event.clientY);
      if (picked) api.extents(picked.id);
      lastMiddle = -1e9;
      api.render();
      return;
    }
    if (button === 1 && !moved) lastMiddle = event.timeStamp;
  };

  const onWheel = (event: WheelEvent) => {
    const deltaY = wheelDeltaY(event);
    if (!deltaY) return;
    event.preventDefault();
    const picked = api.pick(event.clientX, event.clientY);
    if (!picked) return;
    const ratio = wheelZoomRatio(deltaY);
    if (ratio === 1) return;
    const { id, view } = picked;
    const next = zoomToward(view.pose, focusOf(id, view), ratio);
    api.apply(id, next);
    api.render();
  };

  const onMouseDown = (event: MouseEvent) => {
    if (event.button === 1) event.preventDefault();
  };
  const onMenu = (event: Event) => event.preventDefault();
  element.addEventListener('pointerdown', onDown);
  element.addEventListener('pointermove', onMove);
  element.addEventListener('pointerup', onUp);
  element.addEventListener('pointercancel', onUp);
  element.addEventListener('wheel', onWheel, { passive: false });
  element.addEventListener('mousedown', onMouseDown);
  element.addEventListener('auxclick', onMouseDown);
  element.addEventListener('contextmenu', onMenu);
  const unsub = subscribeCommandUi(syncCursor);
  syncCursor();
  return () => {
    element.removeEventListener('pointerdown', onDown);
    element.removeEventListener('pointermove', onMove);
    element.removeEventListener('pointerup', onUp);
    element.removeEventListener('pointercancel', onUp);
    element.removeEventListener('wheel', onWheel);
    element.removeEventListener('mousedown', onMouseDown);
    element.removeEventListener('auxclick', onMouseDown);
    element.removeEventListener('contextmenu', onMenu);
    unsub();
    if (drag) setNavDrag(null);
  };
}
